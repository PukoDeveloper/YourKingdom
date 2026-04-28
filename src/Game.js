import { Application, Container, Graphics } from 'pixi.js';
import { MapData }          from './world/MapData.js';
import { MapRenderer }      from './world/MapRenderer.js';
import { StructureRenderer } from './world/StructureRenderer.js';
import { Player }           from './entities/Player.js';
import { Camera }           from './Camera.js';
import { InputManager }     from './controls/InputManager.js';
import { VirtualJoystick }  from './controls/VirtualJoystick.js';
import { TILE_SIZE, TERRAIN, TERRAIN_NAMES } from './world/constants.js';
import { DayNightCycle }    from './world/DayNightCycle.js';
import { WeatherSystem }    from './world/WeatherSystem.js';
import { GameUI }           from './ui/GameUI.js';
import { SaveManager }      from './systems/SaveManager.js';
import { NationSystem }     from './systems/NationSystem.js';
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
    this._structureRenderer = new StructureRenderer(this._mapData, this._nationSystem, getPlayerNation);
    this._world.addChild(this._structureRenderer.container);
    this._reportLoading(90);
    await this._yieldFrame();

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
    );

    // Rebuild structures now that GameUI is ready (restores player flags from save).
    if (savedState) {
      this._structureRenderer.rebuild();
    }

    // Rebuild map structures whenever the player captures a new settlement.
    this._gameUI.onCaptureSettlement = () => this._structureRenderer.rebuild();

    // Rebuild map structures whenever the player changes their kingdom flag or name.
    this._gameUI.onPlayerKingdomChanged = () => this._structureRenderer.rebuild();

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
    const overlay = this._dayNight.getOverlay();
    const og = this._dayNightOverlay;
    og.clear();
    if (overlay.alpha > 0.005) {
      og.rect(0, 0, this.app.screen.width, this.app.screen.height)
        .fill({ color: overlay.color, alpha: overlay.alpha });
    }

    // Weather
    this._weather.update(dt);

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
        if (hit.settlement.controllingNationId < 0) {
          const pk = this._gameUI.getPlayerNation();
          nationLine = `🏴 ${pk.name}`;
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
