import { Application, Container, Graphics } from 'pixi.js';
import { RemotePlayerEntity } from './entities/RemotePlayerEntity.js';
import { MapData }          from './world/MapData.js';
import { MapRenderer }      from './world/MapRenderer.js';
import { StructureRenderer } from './world/StructureRenderer.js';
import { RoadRenderer }     from './world/RoadRenderer.js';
import { MapBuildingRenderer } from './world/MapBuildingRenderer.js';
import { NpcArmyRenderer }  from './world/NpcArmyRenderer.js';
import { MissiveRenderer }  from './world/MissiveRenderer.js';
import { WorkerRenderer }   from './world/WorkerRenderer.js';
import { PlayerEntity }     from './entities/PlayerEntity.js';
import { NpcKingEntity }    from './entities/NpcKingEntity.js';
import { Camera }           from './Camera.js';
import { InputManager }     from './controls/InputManager.js';
import { VirtualJoystick }  from './controls/VirtualJoystick.js';
import { TILE_SIZE, TERRAIN, TERRAIN_NAMES } from './world/constants.js';
import { cssToNum } from './systems/AppearanceSystem.js';
import { DayNightCycle }    from './world/DayNightCycle.js';
import { WeatherSystem }    from './world/WeatherSystem.js';
import { GameUI }           from './ui/GameUI.js';
import { SaveManager }      from './systems/SaveManager.js';
import { NationSystem, PLAYER_NATION_ID, NEUTRAL_NATION_ID }     from './systems/NationSystem.js';
import { DiplomacySystem }  from './systems/DiplomacySystem.js';
import { PathfinderWorker } from './world/PathfinderWorker.js';

/** Auto-save interval in milliseconds. */
const AUTO_SAVE_INTERVAL_MS = 60_000;

/**
 * Fixed orthogonal offsets used when scanning for adjacent impassable tiles
 * (mountain/water) next to the player.  Sorted at call-time by facing direction.
 */
const ADJACENT_OFFSETS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

export class Game {
  /**
   * @param {import('./systems/MultiplayerClient.js').MultiplayerClient|null} [multiplayerClient]
   */
  constructor(multiplayerClient = null) {
    /** @type {import('./systems/MultiplayerClient.js').MultiplayerClient|null} */
    this._mp = multiplayerClient;
    /** Remote player entities keyed by server id. @type {Map<string, RemotePlayerEntity>} */
    this._remotePlayers = new Map();
  }

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

    const canvas = this.app.canvas;
    document.getElementById('game-container').appendChild(canvas);
    // Prevent the canvas from stealing focus from UI input elements on mobile.
    canvas.setAttribute('tabindex', '-1');
    canvas.style.outline = 'none';

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

    // In multiplayer, restore from the server-side saved game state for this named account
    // (received in the 'welcome' message).  For single-player, load from localStorage.
    const savedState = this._mp ? (this._mp.gameState ?? null) : SaveManager.load();
    // In multiplayer the server sends a shared seed so every client generates
    // the same deterministic world.  Fall back to a local save seed or a fresh
    // random value for single-player.
    const seed = this._mp?.seed ?? savedState?.seed ?? Math.floor(Math.random() * 0xFFFFFF); // 24-bit seed range: 0 – 16 777 215
    this._seed = seed;

    this._setLoadingStatus('生成世界地圖...');
    await this._yieldFrame();
    this._mapData = new MapData(seed);
    this._reportLoading(15);
    await this._yieldFrame();

    // Nation system (deterministic from seed – no separate save state needed)
    this._nationSystem = new NationSystem(this._mapData);

    // Restore per-region satisfaction and assignedCharacters from save.
    if (savedState?.regionState && Array.isArray(savedState.regionState)) {
      const restoreRegions = (settlements, prefix) => {
        savedState.regionState.forEach(entry => {
          if (!entry.key.startsWith(`${prefix}:`)) return;
          const idx = parseInt(entry.key.slice(prefix.length + 1), 10);
          const region = settlements[idx];
          if (!region) return;
          if (typeof entry.satisfaction === 'number') region.satisfaction = entry.satisfaction;
          if (Array.isArray(entry.assignedCharacters)) region.assignedCharacters = entry.assignedCharacters;
        });
      };
      restoreRegions(this._nationSystem.castleSettlements, 'castle');
      restoreRegions(this._nationSystem.villageSettlements, 'village');
    }

    // Pathfinding worker – offloads A* searches off the main thread.
    this._pathfinderWorker = new PathfinderWorker();
    this._pathfinderWorker.init(this._mapData.tiles);

    // Diplomacy system (initial relations derived from NationSystem; player deltas persisted)
    this._diplomacySystem = new DiplomacySystem(this._nationSystem, this._mapData);
    this._diplomacySystem.setPathfinderWorker(this._pathfinderWorker);
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

    // Road overlay (drawn on top of terrain, below structures).
    this._roadRenderer = new RoadRenderer();
    this._world.addChild(this._roadRenderer.container);

    // Map-building overlay (lumber camps, mines, bridges) – above roads.
    this._mapBuildingRenderer = new MapBuildingRenderer();
    this._world.addChild(this._mapBuildingRenderer.container);

    // Blue build-preview overlay (shown when a buildable tile is detected nearby).
    this._buildPreviewGraphics = new Graphics();
    this._world.addChild(this._buildPreviewGraphics);

    // Castle structures (drawn on top of terrain)
    this._setLoadingStatus('建造城池與村落...');
    // getPlayerNation is evaluated lazily so _gameUI exists by the time it is called.
    const getPlayerNation = () => this._gameUI?.getPlayerNation() ?? { color: '#e2c97e', flagApp: null };
    this._structureRenderer = new StructureRenderer(this._mapData, this._nationSystem, getPlayerNation);
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

    // Remote territory overlay – shows other players' captured/liberated
    // settlements as small coloured flag markers above each settlement.
    // Rendered above structures/armies but below entity sprites.
    this._remoteTerritoryContainer = new Container();
    this._world.addChild(this._remoteTerritoryContainer);
    /** @type {Map<string, import('pixi.js').Graphics>} */
    this._remoteTerritoryGraphics = new Map();

    // Player
    this._setLoadingStatus('召喚玩家...');
    const { tileX, tileY } = this._mapData.findStartTile();
    const defaultX = (tileX + 0.5) * TILE_SIZE;
    const defaultY = (tileY + 0.5) * TILE_SIZE;
    const startX = savedState?.player?.x ?? defaultX;
    const startY = savedState?.player?.y ?? defaultY;
    this._player = new PlayerEntity(startX, startY, savedState?.playerAppearance ?? null);
    this._world.addChild(this._player.container);

    // NPC king entities – one per NPC nation, stationed at their castle.
    // Kings are created here but only added to the scene if you wish to show
    // them on the map; for now they live as data objects with Pixi containers
    // that can be added to the world when needed.
    this._npcKings = this._mapData.castles.map((castle, i) => {
      const region = this._nationSystem.castleSettlements[i];
      if (!region?.ruler) return null;
      return new NpcKingEntity(region.ruler, castle);
    }).filter(Boolean);

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
    // In multiplayer, initialise from server-provided values so all clients
    // start in sync.  Fall back to the saved state or the built-in defaults
    // for single-player.
    this._dayNight = new DayNightCycle(
      undefined,
      this._mp?.dayTime ?? savedState?.dayTime ?? undefined,
    );
    this._weather  = new WeatherSystem(this.app.screen.width, this.app.screen.height);
    if (this._mp !== null && this._mp.weather !== null) {
      this._weather.setState(this._mp.weather);
    }
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
      this._pathfinderWorker,
    );

    // Wire the player power callback so DiplomacySystem can factor the player's
    // combined strength into NPC surrender pressure calculations.
    this._diplomacySystem.setPlayerPowerFn(() => this._gameUI._getPlayerStrength());

    // Rebuild structures now that GameUI is ready (restores player flags from save).
    if (savedState) {
      this._structureRenderer.rebuild();
    }

    // Cached road-tile Set (rebuilt whenever roads change; passed to Player every frame).
    this._builtRoadTileSet = new Set();

    // Cached bridge-tile Set (rebuilt whenever a bridge is added; passed to Player every frame).
    this._builtBridgeTileSet = new Set();

    // HUD tile cache: avoid redundant settlement / build-button DOM updates every frame.
    /** @type {number} */
    this._hudTileX = -1;
    /** @type {number} */
    this._hudTileY = -1;
    /** @type {object|null} */
    this._hudHit   = null;
    /** @type {number|null} Cached terrain type for the current tile. */
    this._hudTerrainType = null;
    /** @type {string} Cached terrain label for the current tile. */
    this._hudLabel = '';
    /** @type {number} Last facing octant (0–7) used for buildable-tile detection; -1 = uninitialised. */
    this._hudFacingOctant = -1;
    /** @type {boolean} Whether the day/night overlay was visible last frame. */
    this._prevOverlayVisible = false;

    // Restore built roads from save data.
    if (savedState) {
      this._roadRenderer.rebuild(this._gameUI.getBuiltRoadTilePaths());
      this._builtRoadTileSet   = this._gameUI.getBuiltRoadTileSet();
      this._mapBuildingRenderer.rebuild(this._gameUI.getMapBuildings(), this._mapData);
      this._builtBridgeTileSet = this._gameUI.getBridgeTileSet();
    }

    // Rebuild map structures whenever the player captures a new settlement.
    // Also invalidate the HUD tile cache so the terrain label updates immediately.
    this._gameUI.onCaptureSettlement = () => {
      this._structureRenderer.rebuild();
      this._hudTileX = -1; // force HUD refresh next frame
      this._hudFacingOctant = -1;
      this._mpSendTerritory();
    };

    // Rebuild map structures whenever the player changes their kingdom flag or name.
    this._gameUI.onPlayerKingdomChanged = () => {
      this._structureRenderer.rebuild();
      this._mpSendInfo();
    };

    // Re-broadcast appearance to peers when the player edits their character look.
    this._gameUI.onPlayerAppearanceChanged = () => this._mpSendInfo();

    // Rebuild road overlay whenever a road is completed or demolished.
    this._gameUI.onRoadBuilt = () => {
      this._roadRenderer.rebuild(this._gameUI.getBuiltRoadTilePaths());
      this._builtRoadTileSet = this._gameUI.getBuiltRoadTileSet();
    };

    // Rebuild map-building overlay and bridge tile set whenever a map building changes.
    this._gameUI.onMapBuildingChanged = () => {
      this._mapBuildingRenderer.rebuild(this._gameUI.getMapBuildings(), this._mapData);
      this._builtBridgeTileSet = this._gameUI.getBridgeTileSet();
    };

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

    // -----------------------------------------------------------------------
    // Multiplayer wiring
    // -----------------------------------------------------------------------
    if (this._mp) {
      this._mp.onStateUpdate  = (players) => this._onRemoteStateUpdate(players);
      this._mp.onPlayerLeft   = (id, name) => {
        this._removeRemotePlayer(id);
        this._gameUI?.showToast(`${name || '玩家'} 離開了遊戲`);
      };
      this._mp.onPlayerJoined = (id, name) => {
        this._gameUI?.showToast(`${name || '玩家'} 加入了遊戲 ✓`);
      };
      this._mp.onDisconnect   = () => this._gameUI?.showToast('與伺服器斷線 ✗');
      this._mp.onWorldSync    = (time, weather) => this._syncWorld(time, weather);
      // When the server corrects our position (speed-violation detected), snap
      // the local player sprite to the authoritative coordinates immediately.
      this._mp.onPositionCorrection = (x, y, angle) => this._onServerCorrection(x, y, angle);
      // Broadcast our initial appearance, kingdom info and territory immediately
      // after init so other already-connected players see our look right away.
      this._mpSendInfo();
      this._mpSendTerritory();
    }

    // Hide loading screen
    this._reportLoading(100);
    this._setLoadingStatus('進入王國...');
    await this._yieldFrame();
    this._hideLoading();

    // -----------------------------------------------------------------------
    // Save / auto-save
    // -----------------------------------------------------------------------
    if (savedState) {
      this._gameUI.showToast(this._mp ? '已從伺服器載入存檔 ✓' : '已載入上次存檔 ✓');
    }
    // Auto-save works in both single-player (localStorage) and multiplayer (server).
    this._startAutoSave();
  }

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------

  _update(dt) {
    const dir = this._input.getDirection();
    this._player.update(dt, dir.x, dir.y, this._mapData, this._builtRoadTileSet, this._builtBridgeTileSet);

    // Multiplayer: broadcast local player position and advance remote entities.
    if (this._mp) {
      this._mp.sendMove(this._player.x, this._player.y, this._player.container.rotation);
      this._remotePlayers.forEach(rp => rp.update(dt));
    }

    this._camera.follow(this._player.x, this._player.y);
    this._camera.update(dt);
    this._camera.apply(this._world);

    // Day / Night cycle
    this._dayNight.update(dt);
    const prevDayTime = this._prevDayTime;
    const currDayTime = this._dayNight.time;
    // In multiplayer the server is the authority for day rollovers; _syncWorld()
    // handles them when the server broadcasts the new time.  Skip the local
    // rollover check here to prevent double-firing onDayPassed in the same tick.
    if (!this._mp && currDayTime < prevDayTime) {
      // Day has rolled over – consume food for all active members
      this._gameUI.onDayPassed();
    }
    this._prevDayTime = currDayTime;

    // Phase transitions trigger NPC AI phase actions.
    // In multiplayer, _syncWorld() keeps _prevPhase in sync with server time, so
    // this check still fires exactly once per transition on each client.
    const currPhase = this._dayNight.getPhaseName();
    if (currPhase !== this._prevPhase) {
      this._gameUI.onPhaseChanged(currPhase);
      this._prevPhase = currPhase;
    }
    const overlay = this._dayNight.getOverlay();
    const og = this._dayNightOverlay;
    const overlayVisible = overlay.alpha > 0.005;
    if (overlayVisible || this._prevOverlayVisible) {
      og.clear();
      if (overlayVisible) {
        og.rect(0, 0, this.app.screen.width, this.app.screen.height)
          .fill({ color: overlay.color, alpha: overlay.alpha });
      }
    }
    this._prevOverlayVisible = overlayVisible;

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
        this._hudTileX = -1; // force terrain label refresh next frame
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
        } else if (result.type === 'npc_trade_request') {
          this._gameUI.onNpcTradeRequest(result.missive);
        } else if (result.type === 'npc_nap_proposal') {
          this._gameUI.onNpcNapProposal(result.missive);
        } else if (result.type === 'npc_mpp_proposal') {
          this._gameUI.onNpcMppProposal(result.missive);
        } else if (result.type === 'npc_gift_delivered') {
          this._gameUI.onNpcGiftDelivered(result.missive, result.gold, result.relDelta);
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
      const tileX = Math.floor(this._player.x / TILE_SIZE);
      const tileY = Math.floor(this._player.y / TILE_SIZE);

      // Re-run settlement / build-button queries when the player tile changes.
      // Also re-run the facing-dependent buildable-tile detection when the player's
      // facing octant changes, so the highlighted tile updates as the player turns
      // even without stepping to a new tile.
      const tileChanged = tileX !== this._hudTileX || tileY !== this._hudTileY;
      const facing = this._player.getFacingDirection();
      // Map the continuous facing angle to one of 8 octants (0 = N, clockwise).
      // atan2 produces an angle in radians; dividing by π/4 converts it to octant
      // units; rounding snaps to the nearest octant; +8 ensures a positive value
      // before the &7 bitmask wraps the result into the 0–7 range.
      const facingOctant = (Math.round(Math.atan2(facing.dx, -facing.dy) / (Math.PI / 4)) + 8) & 7;
      const facingChanged = facingOctant !== this._hudFacingOctant;

      if (tileChanged) {
        this._hudTileX = tileX;
        this._hudTileY = tileY;
        this._hudHit   = this._nationSystem.getSettlementAtTile(tileX, tileY, this._mapData);

        // Cache terrain type and label for the non-settlement case; use tile coords directly
        // (equivalent to getTerrainAtWorld but avoids the per-call pixel→tile division).
        const t = this._mapData.getTerrain(tileX, tileY);
        this._hudTerrainType = t;
        this._hudLabel = TERRAIN_NAMES[t] ?? '';

        this._gameUI.setNearbySettlement(
          this._hudHit ? this._hudHit.settlement : null,
        );
      }

      if (tileChanged || facingChanged) {
        this._hudFacingOctant = facingOctant;
        let nearbyBuildTile = null;
        if (!this._hudHit) {
          const terrainType = this._hudTerrainType;
          if (terrainType === TERRAIN.FOREST) {
            nearbyBuildTile = { tx: tileX, ty: tileY, terrainType: TERRAIN.FOREST };
          } else {
            const sortedOffsets = [...ADJACENT_OFFSETS].sort(
              ([ax, ay], [bx, by]) =>
                (bx * facing.dx + by * facing.dy) - (ax * facing.dx + ay * facing.dy),
            );
            for (const [dx, dy] of sortedOffsets) {
              const adjT = this._mapData.getTerrain(tileX + dx, tileY + dy);
              if (adjT === TERRAIN.MOUNTAIN) {
                nearbyBuildTile = { tx: tileX + dx, ty: tileY + dy, terrainType: adjT };
                break;
              }
              if (adjT === TERRAIN.WATER && this._isBridgeableTile(tileX + dx, tileY + dy)) {
                nearbyBuildTile = { tx: tileX + dx, ty: tileY + dy, terrainType: adjT };
                break;
              }
            }
          }
        }
        if (nearbyBuildTile) {
          this._gameUI.setNearbyBuildableTerrain(nearbyBuildTile.tx, nearbyBuildTile.ty, nearbyBuildTile.terrainType);
        } else {
          this._gameUI.setNearbyBuildableTerrain(null, null, null);
        }
        this._updateBuildPreview(nearbyBuildTile);
      }

      const hit = this._hudHit;
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
        const newHTML =
          `<span class="hud-nation-line">${nationLine}</span>` +
          `<span class="hud-region-line">${regionLine}</span>`;
        // Only write innerHTML when content has actually changed to avoid
        // forcing a browser re-parse on every frame.
        if (this._terrainLabel.innerHTML !== newHTML) {
          this._terrainLabel.innerHTML = newHTML;
        }
      } else {
        this._terrainLabel.textContent = this._hudLabel;
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

  /** Collect and return the full serialisable game state. */
  _collectSaveState() {
    // Collect per-region satisfaction and assignedCharacters for persistence.
    const regionState = [];
    const collectRegionState = (settlements, prefix) => {
      settlements.forEach((region, i) => {
        regionState.push({
          key:                `${prefix}:${i}`,
          satisfaction:       region.satisfaction ?? 0,
          assignedCharacters: region.assignedCharacters ?? [],
        });
      });
    };
    if (this._nationSystem) {
      collectRegionState(this._nationSystem.castleSettlements, 'castle');
      collectRegionState(this._nationSystem.villageSettlements, 'village');
    }

    return {
      seed:             this._seed,
      player:           { x: this._player.x, y: this._player.y },
      playerAppearance: this._player.getAppearanceState(),
      playerCharacter:  this._player.character?.toJSON?.() ?? null,
      dayTime:          this._dayNight.time,
      diplomacy:        this._diplomacySystem.getState(),
      regionState,
      ...this._gameUI.getState(),
    };
  }

  /** Persist the current game state (to server in multiplayer, to localStorage in single-player). */
  save() {
    const state = this._collectSaveState();

    if (this._mp) {
      // Send state to the server for persistence under the player's named account.
      this._mp.sendSave(state);
      this._gameUI.showToast('遊戲已儲存至伺服器 ☁');
      return;
    }

    const ok = SaveManager.save(state);
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

    if (this._mp) {
      // Clear the server-side save for this named account before reloading.
      this._mp.sendSave(null);
    }
    SaveManager.clear();
    window.location.reload();
  }

  // ---------------------------------------------------------------------------
  // Multiplayer helpers
  // ---------------------------------------------------------------------------

  /**
   * Handle a full state update from the server: create/update/remove remote
   * player entities as needed.
   * @param {Record<string, {x:number, y:number, angle:number}>} players
   */
  _onRemoteStateUpdate(players) {
    const localId = this._mp?.id;

    // Update or create entities for players in the snapshot.
    for (const [id, state] of Object.entries(players)) {
      if (id === localId) continue; // skip ourselves

      let rp = this._remotePlayers.get(id);
      if (!rp) {
        rp = new RemotePlayerEntity(id, state.x, state.y);
        this._world.addChild(rp.container);
        this._remotePlayers.set(id, rp);
      }
      rp.setTarget(state.x, state.y, state.angle);
      if (state.name       !== undefined) rp.setName(state.name);
      if (state.appearance)               rp.setAppearance(state.appearance);
      if (state.kingdom)                  rp.setKingdom(state.kingdom.name, state.kingdom.color);

      // Update the territory overlay whenever captured/liberated lists are present.
      if (state.captured !== undefined || state.liberated !== undefined) {
        this._updateRemoteTerritory(
          id,
          state.captured  ?? [],
          state.liberated ?? [],
          state.kingdom?.color ?? '#64b5f6',
        );
      }
    }

    // Remove entities that are no longer in the snapshot.
    for (const id of this._remotePlayers.keys()) {
      if (!(id in players) || id === localId) {
        this._removeRemotePlayer(id);
      }
    }
  }

  /**
   * Remove a single remote player entity from the scene.
   * @param {string} id
   */
  _removeRemotePlayer(id) {
    const rp = this._remotePlayers.get(id);
    if (rp) {
      this._world.removeChild(rp.container);
      this._remotePlayers.delete(id);
    }
    // Clean up the territory overlay for this player.
    const tg = this._remoteTerritoryGraphics?.get(id);
    if (tg) {
      this._remoteTerritoryContainer?.removeChild(tg);
      this._remoteTerritoryGraphics.delete(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Multiplayer helpers: sending local state
  // ---------------------------------------------------------------------------

  /**
   * Snap the local player to the server-corrected position.
   * Called when the server detects a movement-speed violation and sends a
   * `correction` message with the authoritative coordinates.
   * @param {number} x
   * @param {number} y
   * @param {number} angle
   */
  _onServerCorrection(x, y, angle) {
    if (!this._player) return;
    this._player.x = x;
    this._player.y = y;
    this._player.container.x        = x;
    this._player.container.y        = y;
    this._player.container.rotation = angle;
    this._player._facingAngle       = angle;
  }

  /**
   * Send the local player's current appearance indices and kingdom info to the
   * server so other players' clients can render the correct sprite and label.
   * No-op when not connected.
   */
  _mpSendInfo() {
    if (!this._mp) return;
    const appearance  = this._player?.getAppearanceState() ?? null;
    const playerNation = this._gameUI?.getPlayerNation();
    const kingdom = playerNation
      ? { name: playerNation.name, color: playerNation.color }
      : null;
    this._mp.sendInfo(appearance, kingdom);
  }

  /**
   * Send the local player's captured/liberated settlement keys to the server.
   * Other clients will show a territory-flag overlay for these settlements.
   * No-op when not connected or GameUI not ready.
   */
  _mpSendTerritory() {
    if (!this._mp || !this._gameUI) return;
    const { captured, liberated } = this._gameUI.getTerritoryState();
    this._mp.sendTerritory(captured, liberated);
  }

  // ---------------------------------------------------------------------------
  // Remote territory overlay
  // ---------------------------------------------------------------------------

  /**
   * Redraw the territory-flag markers for one remote player.
   *
   * Each captured settlement gets a small coloured flag marker (pole + banner)
   * drawn just above the settlement's centre.  Liberated (neutral) settlements
   * get a grey marker instead.  The markers are purely visual; they do not
   * affect this client's local game-state in any way.
   *
   * @param {string}   id        Remote player id.
   * @param {string[]} captured  Keys like 'castle:0', 'village:2'.
   * @param {string[]} liberated Keys of liberated (neutral) settlements.
   * @param {string}   color     Kingdom CSS colour, e.g. '#C62828'.
   */
  _updateRemoteTerritory(id, captured, liberated, color) {
    // Acquire or create a Graphics object for this player.
    let g = this._remoteTerritoryGraphics.get(id);
    if (!g) {
      g = new Graphics();
      this._remoteTerritoryContainer.addChild(g);
      this._remoteTerritoryGraphics.set(id, g);
    }
    g.clear();

    const colNum    = cssToNum(color);
    const captSet   = new Set(captured);
    const allKeys   = [...new Set([...captured, ...liberated])];

    for (const key of allKeys) {
      const pos = this._settlementWorldPos(key);
      if (!pos) continue;

      const isCaptured = captSet.has(key);
      const flagColor  = isCaptured ? colNum : 0xAAAAAA;
      const { x, y }   = pos;

      // Flag pole (2 × 16 px, white)
      g.rect(x - 1, y - 28, 2, 16).fill({ color: 0xffffff, alpha: 0.75 });
      // Flag banner (14 × 9 px in the player's kingdom colour)
      g.rect(x + 1, y - 28, 14, 9).fill({ color: flagColor, alpha: 0.88 });
    }
  }

  /**
   * Return the world-pixel centre of a settlement identified by its key.
   * @param {string} key  e.g. 'castle:0' or 'village:3'
   * @returns {{ x: number, y: number }|null}
   */
  _settlementWorldPos(key) {
    if (!this._mapData) return null;
    const colonIdx = key.indexOf(':');
    if (colonIdx < 0) return null;
    const type = key.slice(0, colonIdx);
    const idx  = parseInt(key.slice(colonIdx + 1), 10);
    if (isNaN(idx)) return null;

    if (type === 'castle') {
      const c = this._mapData.castles[idx];
      if (!c) return null;
      // Castle occupies 4×4 tiles; centre is at (cx+2, cy+2) in tile coordinates.
      return { x: (c.x + 2) * TILE_SIZE, y: (c.y + 2) * TILE_SIZE };
    }
    if (type === 'village') {
      const v = this._mapData.villages[idx];
      if (!v) return null;
      // Village occupies 2×2 tiles; centre is at (vx+1, vy+1) in tile coordinates.
      return { x: (v.x + 1) * TILE_SIZE, y: (v.y + 1) * TILE_SIZE };
    }
    return null;
  }

  /**
   * Apply server-authoritative world time and weather.
   * Called on every 'state' broadcast from the server (~20 Hz).
   *
   * Syncing the day/night time here keeps all multiplayer clients in
   * lock-step without relying on each client's local clock drift.
   * Updating _prevDayTime to the synced value prevents the day-rollover
   * detector in _update() from firing spuriously when the server correction
   * nudges the time fractionally backwards.
   * Updating _prevPhase to the current phase after the time snap prevents a
   * spurious phase-transition event from firing in the same frame when the
   * corrected time happens to cross a phase boundary.
   *
   * Day-rollover detection: because the server is authoritative and advances
   * time independently, the rollover (time wrapping ~1 → ~0) is observed here
   * rather than in _update()'s local drift check.  We detect it by comparing
   * the new server time against the locally-tracked previous time: a decrease
   * of more than 0.5 (half a day) can only happen due to a wrap-around.
   *
   * @param {number} time     Authoritative in-game time fraction [0, 1).
   * @param {number} weather  Authoritative weather state index.
   */
  _syncWorld(time, weather) {
    // Detect day rollover from the server's perspective and fire the day-passed
    // event that single-player detects locally in _update().
    const prevTime = this._dayNight.time;
    if (time < prevTime - 0.5) {
      this._gameUI?.onDayPassed();
    }

    this._prevDayTime = time;
    this._dayNight.time = time;
    this._prevPhase = this._dayNight.getPhaseName();
    this._weather.setState(weather);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns true if (tx, ty) is a bridgeable water tile – i.e. both opposite
   * sides in at least one axis (N+S or E+W) are non-water terrain.
   * This ensures the bridge connects land to land, not river to river.
   */
  _isBridgeableTile(tx, ty) {
    if (!this._mapData) return false;
    const isLand = (x, y) => {
      const t = this._mapData.getTerrain(x, y);
      return t !== TERRAIN.WATER;
    };
    const nsLand = isLand(tx, ty - 1) && isLand(tx, ty + 1);
    const ewLand = isLand(tx - 1, ty) && isLand(tx + 1, ty);
    return nsLand || ewLand;
  }

  /**
   * Draw or clear the blue placement-preview box on the world.
   * @param {{ tx: number, ty: number }|null} tile
   */
  _updateBuildPreview(tile) {
    if (!this._buildPreviewGraphics) return;
    this._buildPreviewGraphics.clear();
    if (!tile) return;
    const px = tile.tx * TILE_SIZE;
    const py = tile.ty * TILE_SIZE;
    const s  = TILE_SIZE;
    this._buildPreviewGraphics
      .rect(px + 2, py + 2, s - 4, s - 4)
      .fill({ color: 0x2196F3, alpha: 0.22 })
      .stroke({ color: 0x64B5F6, alpha: 0.9, width: 2 });
  }

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
