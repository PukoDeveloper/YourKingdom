import { Application, Container, Graphics } from 'pixi.js';
import { MapData }          from './world/MapData.js';
import { MapRenderer }      from './world/MapRenderer.js';
import { StructureRenderer } from './world/StructureRenderer.js';
import { NpcArmyRenderer }  from './world/NpcArmyRenderer.js';
import { MissiveRenderer }  from './world/MissiveRenderer.js';
import { WorkerRenderer }   from './world/WorkerRenderer.js';
import { Player }           from './entities/Player.js';
import { Camera }           from './Camera.js';
import { InputManager }     from './controls/InputManager.js';
import { VirtualJoystick }  from './controls/VirtualJoystick.js';
import { TILE_SIZE, TERRAIN, TERRAIN_NAMES } from './world/constants.js';
import { DayNightCycle }    from './world/DayNightCycle.js';
import { WeatherSystem }    from './world/WeatherSystem.js';
import { GameUI }           from './ui/GameUI.js';
import { SaveManager }      from './systems/SaveManager.js';
import { NationSystem, PLAYER_NATION_ID, NEUTRAL_NATION_ID }     from './systems/NationSystem.js';
import { DiplomacySystem }  from './systems/DiplomacySystem.js';

/** Auto-save interval in milliseconds. */
const AUTO_SAVE_INTERVAL_MS = 60_000;

export class Game {
  async init() {
    // -----------------------------------------------------------------------
    // Pixi application
    // -----------------------------------------------------------------------
    this.app = new Application();
    await this.app.init({
      resizeTo:        window,
      backgroundColor: 0x0d1b2a, // dark ocean – visible only outside map bounds
      antialias:       false,
      resolution:      window.devicePixelRatio || 1,
      autoDensity:     true,
    });

    document.getElementById('game-container').appendChild(this.app.canvas);

    // -----------------------------------------------------------------------
    // Scene graph
    // -----------------------------------------------------------------------

    /** World container: camera-moved, holds terrain + structures + player. */
    this._world = new Container();
    this.app.stage.addChild(this._world);

    /** UI container: fixed on screen, holds joystick. */
    this._ui = new Container();
    this.app.stage.addChild(this._ui);

    // Day/night overlay sits between the world and the UI so it tints the world
    // but does not dim the joystick or HUD labels.
    this._dayNightOverlay = new Graphics();
    this.app.stage.addChildAt(this._dayNightOverlay, 1); // index 1 = above _world

    // -----------------------------------------------------------------------
    // World content
    // -----------------------------------------------------------------------

    this._reportLoading(5);
    this._setLoadingStatus('初始化引擎...');
    await this._yieldFrame();

    // Try to restore a previous session; fall back to a fresh random world.
    const savedState = SaveManager.load();
    const seed = savedState?.seed ?? Math.floor(Math.random() * 0xFFFFFF); // 24-bit seed range: 0 – 16 777 215
    this._seed = seed;

    this._setLoadingStatus('生成世界地圖...');
    await this._yieldFrame();
    this._mapData = new MapData(seed);
    this._reportLoading(15);
    await this._yieldFrame();

    // Nation system (deterministic from seed – no separate save state needed)
    this._nationSystem = new NationSystem(this._mapData);

    // Diplomacy system (initial relations derived from NationSystem; player deltas persisted)
    this._diplomacySystem = new DiplomacySystem(this._nationSystem, this._mapData);
    if (savedState?.diplomacy) {
      this._diplomacySystem.loadState(savedState.diplomacy);
    }

    // Terrain chunks
    this._setLoadingStatus('繪製地形...');
    this._mapRenderer = new MapRenderer(this.app, this._mapData, (done, total) => {
      this._reportLoading(15 + Math.floor((done / total) * 70));
    });
    await this._mapRenderer.build();
    this._world.addChild(this._mapRenderer.container);
    this._reportLoading(85);
    await this._yieldFrame();

    // Castle structures (drawn on top of terrain)
    this._setLoadingStatus('建造城池與村落...');
    // getPlayerNation is evaluated lazily so _gameUI exists by the time it is called.
    const getPlayerNation = () => this._gameUI?.getPlayerNation() ?? { color: '#e2c97e', flagApp: null };
    // getBuiltPorts is evaluated lazily so _gameUI exists by the time it is called.
    const getBuiltPorts = () => this._gameUI?.getBuiltPortTiles() ?? [];
    this._structureRenderer = new StructureRenderer(this._mapData, this._nationSystem, getPlayerNation, getBuiltPorts);
    this._world.addChild(this._structureRenderer.container);
    this._reportLoading(90);
    await this._yieldFrame();

    // NPC army marching tokens (above structures, below the player)
    this._npcArmyRenderer = new NpcArmyRenderer(this._nationSystem);
    this._world.addChild(this._npcArmyRenderer.container);

    // Missive (messenger) tokens – same layer as army tokens
    this._missiveRenderer = new MissiveRenderer();
    this._world.addChild(this._missiveRenderer.container);

    // Construction worker tokens – same layer as other unit tokens
    this._workerRenderer = new WorkerRenderer();
    this._world.addChild(this._workerRenderer.container);

    // Player
    this._setLoadingStatus('召喚玩家...');
    const { tileX, tileY } = this._mapData.findStartTile();
    const defaultX = (tileX + 0.5) * TILE_SIZE;
    const defaultY = (tileY + 0.5) * TILE_SIZE;
    const startX = savedState?.player?.x ?? defaultX;
    const startY = savedState?.player?.y ?? defaultY;
    this._player = new Player(startX, startY, savedState?.playerAppearance ?? null);
    this._world.addChild(this._player.container);

    // -----------------------------------------------------------------------
    // Camera
    // -----------------------------------------------------------------------
    this._camera = new Camera(this.app.screen.width, this.app.screen.height);
    // Snap to player immediately (no initial lag)
    this._camera.x = startX;
    this._camera.y = startY;
    this._camera.follow(startX, startY);
    this._camera.apply(this._world);

    // -----------------------------------------------------------------------
    // Input
    // -----------------------------------------------------------------------
    this._input = new InputManager();

    this._joystick = new VirtualJoystick(
      this.app,
      this.app.screen.width,
      this.app.screen.height,
      (x, y) => this._input.setJoystickDirection(x, y),
    );
    this._ui.addChild(this._joystick.container);

    // -----------------------------------------------------------------------
    // Day / Night cycle & Weather
    // -----------------------------------------------------------------------
    this._setLoadingStatus('準備天氣系統...');
    this._dayNight = new DayNightCycle(
      undefined,
      savedState?.dayTime ?? undefined,
    );
    this._weather  = new WeatherSystem(this.app.screen.width, this.app.screen.height);
    this._ui.addChild(this._weather.container);

    // -----------------------------------------------------------------------
    // HUD DOM refs
    // -----------------------------------------------------------------------
    this._terrainLabel = document.getElementById('terrain-label');
    this._timeLabel    = document.getElementById('time-label');
    this._weatherLabel = document.getElementById('weather-label');

    // -----------------------------------------------------------------------
    // Resize handler
    // -----------------------------------------------------------------------
    window.addEventListener('resize', () => this._onResize());

    this._prevDayTime = this._dayNight.time;
    /** @type {string} Previous day/night phase (used to detect phase transitions for NPC AI). */
    this._prevPhase   = this._dayNight.getPhaseName();

    // -----------------------------------------------------------------------
    // Game UI (Backpack + Team panels)
    // -----------------------------------------------------------------------
    this._gameUI = new GameUI(
      savedState ?? null,
      () => this.save(),
      this._nationSystem,
      () => this._resetGame(),
      this._player,
      this._diplomacySystem,
      this._dayNight,
      this._mapData,
    );

    // Rebuild structures now that GameUI is ready (restores player flags from save).
    if (savedState) {
      this._structureRenderer.rebuild();
    }

    // Rebuild map structures whenever the player captures a new settlement.
    this._gameUI.onCaptureSettlement = () => this._structureRenderer.rebuild();

    // Rebuild map structures whenever the player changes their kingdom flag or name.
    this._gameUI.onPlayerKingdomChanged = () => this._structureRenderer.rebuild();

    // Rebuild map structures whenever the player builds a new port.
    this._gameUI.onPortBuilt = () => this._structureRenderer.rebuild();

    // Advance in-game days when resting at an inn.
    this._gameUI.onAdvanceDays = (n) => {
      for (let i = 0; i < n; i++) {
        this._gameUI.onDayPassed();
      }
      // Keep the day-detection tracker in sync so the regular game loop
      // does not fire onDayPassed again for the same rollover.
      this._prevDayTime = this._dayNight.time;
    };

    // -----------------------------------------------------------------------
    // Game loop
    // -----------------------------------------------------------------------
    this.app.ticker.add((ticker) => this._update(ticker.deltaMS / 1000));

    // Hide loading screen
    this._reportLoading(100);
    this._setLoadingStatus('進入王國...');
    await this._yieldFrame();
    this._hideLoading();

    // -----------------------------------------------------------------------
    // Save / auto-save
    // -----------------------------------------------------------------------
    if (savedState) {
      this._gameUI.showToast('已載入上次存檔 ✓');
    }
    this._startAutoSave();
  }

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------

  _update(dt) {
    const dir = this._input.getDirection();
    this._player.update(dt, dir.x, dir.y, this._mapData);

    this._camera.follow(this._player.x, this._player.y);
    this._camera.update(dt);
    this._camera.apply(this._world);

    // Day / Night cycle
    this._dayNight.update(dt);
    const prevDayTime = this._prevDayTime;
    const currDayTime = this._dayNight.time;
    if (currDayTime < prevDayTime) {
      // Day has rolled over – consume food for all active members
      this._gameUI.onDayPassed();
    }
    this._prevDayTime = currDayTime;

    // Phase transitions trigger NPC AI phase actions.
    const currPhase = this._dayNight.getPhaseName();
    if (currPhase !== this._prevPhase) {
      this._gameUI.onPhaseChanged(currPhase);
      this._prevPhase = currPhase;
    }
    const overlay = this._dayNight.getOverlay();
    const og = this._dayNightOverlay;
    og.clear();
    if (overlay.alpha > 0.005) {
      og.rect(0, 0, this.app.screen.width, this.app.screen.height)
        .fill({ color: overlay.color, alpha: overlay.alpha });
    }

    // Weather
    this._weather.update(dt);

    // NPC army marches: advance progress and resolve arrivals.
    if (this._diplomacySystem && this._npcArmyRenderer) {
      const { messages, structureRebuildNeeded } =
        this._diplomacySystem.updateMarches(dt, this._mapData);
      if (messages.length > 0) {
        messages.forEach(m => this._gameUI.addSystemMessage('⚔', m.message));
      }
      if (structureRebuildNeeded) {
        this._structureRenderer.rebuild();
        this._gameUI.refreshNationsPanel();
      }
      this._npcArmyRenderer.sync(
        this._diplomacySystem.getPendingMarches(),
        this._mapData,
      );
    }

    // Peace missives: advance messengers and surface arrivals to GameUI.
    if (this._diplomacySystem) {
      const missiveResults = this._diplomacySystem.updateMissives(dt);
      missiveResults.forEach(result => {
        // Always free the messenger unit when a missive resolves.
        this._gameUI.onMissiveDelivered(result.missive);

        if (result.type === 'player_offer') {
          this._gameUI.onPeaceOfferReceived(result.missive);
        } else if (result.type === 'npc_response') {
          this._gameUI.onPeaceTreatyResponse(result.missive, result.accepted);
          if (result.accepted) {
            this._structureRenderer.rebuild();
            this._gameUI.refreshNationsPanel();
          }
        } else if (result.type === 'player_condemn_delivered') {
          const nation = this._nationSystem.nations[result.missive.receiverNationId];
          this._gameUI.addSystemMessage('📢', `你的譴責信已送達 ${nation?.name ?? '對方'}，關係惡化 ${result.delta}。`);
          this._gameUI.refreshNationsPanel();
        } else if (result.type === 'player_gift_delivered') {
          const nation = this._nationSystem.nations[result.missive.receiverNationId];
          this._gameUI.addSystemMessage('🎁', `禮物已送達 ${nation?.name ?? '對方'}，關係改善 +${result.delta}。`);
          this._gameUI.refreshNationsPanel();
        } else if (result.type === 'player_war_declared') {
          const nation = this._nationSystem.nations[result.missive.receiverNationId];
          this._gameUI.addSystemMessage('⚔', `已向 ${nation?.name ?? '對方'} 正式宣戰！`);
          this._gameUI.refreshNationsPanel();
        }
      });
      // Sync messenger tokens with updated positions.
      this._missiveRenderer.sync(this._diplomacySystem.getPendingMissives());
    }

    // Construction worker tokens + trade caravan tokens.
    if (this._gameUI && this._workerRenderer) {
      const workers  = this._gameUI.getConstructionWorkers();
      const caravans = this._gameUI.getTradeCaravans();
      this._workerRenderer.sync([...workers, ...caravans]);
    }

    // HUD: terrain name (+ nation when inside a settlement)
    if (this._terrainLabel) {
      const t = this._mapData.getTerrainAtWorld(this._player.x, this._player.y);
      let label = TERRAIN_NAMES[t] ?? '';
      const tileX = Math.floor(this._player.x / TILE_SIZE);
      const tileY = Math.floor(this._player.y / TILE_SIZE);
      const hit = this._nationSystem.getSettlementAtTile(tileX, tileY, this._mapData);
      if (hit) {
        const settlIcon = hit.settlement.type === 'castle' ? '🏰' : '🏘️';
        let nationLine, regionLine;
        if (hit.settlement.controllingNationId === PLAYER_NATION_ID) {
          const pk = this._gameUI.getPlayerNation();
          nationLine = `🏴 ${pk.name}`;
        } else if (hit.settlement.controllingNationId === NEUTRAL_NATION_ID) {
          nationLine = `🏳 中立`;
        } else {
          const nation = this._nationSystem.getNation(hit.settlement);
          nationLine = `${nation.emblem} ${nation.name}`;
        }
        regionLine = `${settlIcon} ${hit.settlement.name}`;
        this._terrainLabel.innerHTML =
          `<span class="hud-nation-line">${nationLine}</span>` +
          `<span class="hud-region-line">${regionLine}</span>`;
      } else {
        this._terrainLabel.textContent = label;
      }

      // Show / hide the enter-facility button
      const isPort = t === TERRAIN.PORT_GROUND;
      this._gameUI.setNearbySettlement(
        hit ? hit.settlement : null,
        isPort ? 'port' : null,
      );

      // Grant sea access when the player stands on a player-built port tile.
      const playerTile = { tx: Math.floor(this._player.x / TILE_SIZE), ty: Math.floor(this._player.y / TILE_SIZE) };
      const builtPorts = this._gameUI.getBuiltPortTiles();
      const onBuiltPort = builtPorts.some(p => p.tx === playerTile.tx && p.ty === playerTile.ty);
      if (onBuiltPort && !this._player.atSea) {
        this._player.canEmbark = true;
      }
    }

    // HUD: time & weather
    if (this._timeLabel) {
      this._timeLabel.textContent =
        `${this._dayNight.getPhaseName()}  ${this._dayNight.getTimeString()}`;
    }
    if (this._weatherLabel) {
      this._weatherLabel.textContent = this._weather.getName();
    }
  }

  // ---------------------------------------------------------------------------
  // Save / load
  // ---------------------------------------------------------------------------

  /** Collect full game state and persist it to localStorage. */
  save() {
    const ok = SaveManager.save({
      seed:             this._seed,
      player:           { x: this._player.x, y: this._player.y },
      playerAppearance: this._player.getAppearanceState(),
      dayTime:          this._dayNight.time,
      diplomacy:        this._diplomacySystem.getState(),
      ...this._gameUI.getState(),
    });
    this._gameUI.showToast(ok ? '遊戲已儲存 💾' : '儲存失敗 ✗');
  }

  /** Start auto-save: every AUTO_SAVE_INTERVAL_MS, on tab hide, and on page unload. */
  _startAutoSave() {
    this._autoSaveTimer = setInterval(() => this.save(), AUTO_SAVE_INTERVAL_MS);

    this._onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') this.save();
    };
    this._onBeforeUnload = () => this.save();

    document.addEventListener('visibilitychange', this._onVisibilityChange);
    window.addEventListener('beforeunload', this._onBeforeUnload);
  }

  /** Clear save data and reload for a fresh start. */
  _resetGame() {
    // Remove auto-save listeners so they don't re-save during the reload.
    clearInterval(this._autoSaveTimer);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    window.removeEventListener('beforeunload', this._onBeforeUnload);

    SaveManager.clear();
    window.location.reload();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _reportLoading(percent) {
    const bar = document.getElementById('loading-bar');
    if (bar) bar.style.width = `${percent}%`;
  }

  _setLoadingStatus(text) {
    const el = document.getElementById('loading-status');
    if (el) el.textContent = text;
  }

  /** Yields control back to the browser for one animation frame so the UI can repaint. */
  _yieldFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  _hideLoading() {
    const overlay = document.getElementById('loading');
    if (!overlay) return;
    overlay.classList.add('hidden');
    setTimeout(() => { overlay.style.display = 'none'; }, 600);
  }

  _onResize() {
    this._camera.resize(this.app.screen.width, this.app.screen.height);
    this._joystick.resize(this.app.screen.width, this.app.screen.height);
    this._weather.resize(this.app.screen.width, this.app.screen.height);
    this._camera.apply(this._world);
  }
}
