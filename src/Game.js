import { Application, Container } from 'pixi.js';
import { MapData }          from './world/MapData.js';
import { MapRenderer }      from './world/MapRenderer.js';
import { StructureRenderer } from './world/StructureRenderer.js';
import { Player }           from './entities/Player.js';
import { Camera }           from './Camera.js';
import { InputManager }     from './controls/InputManager.js';
import { VirtualJoystick }  from './controls/VirtualJoystick.js';
import { TILE_SIZE, TERRAIN_NAMES } from './world/constants.js';

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

    // -----------------------------------------------------------------------
    // World content
    // -----------------------------------------------------------------------

    this._reportLoading(5);

    this._mapData = new MapData(/* seed= */ 42);
    this._reportLoading(15);

    // Terrain chunks
    this._mapRenderer = new MapRenderer(this.app, this._mapData, (done, total) => {
      this._reportLoading(15 + Math.floor((done / total) * 70));
    });
    this._mapRenderer.build();
    this._world.addChild(this._mapRenderer.container);
    this._reportLoading(85);

    // Castle structures (drawn on top of terrain)
    this._structureRenderer = new StructureRenderer(this._mapData);
    this._world.addChild(this._structureRenderer.container);
    this._reportLoading(90);

    // Player
    const { tileX, tileY } = this._mapData.findStartTile();
    const startX = (tileX + 0.5) * TILE_SIZE;
    const startY = (tileY + 0.5) * TILE_SIZE;
    this._player = new Player(startX, startY);
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
    // HUD DOM refs
    // -----------------------------------------------------------------------
    this._terrainLabel = document.getElementById('terrain-label');

    // -----------------------------------------------------------------------
    // Resize handler
    // -----------------------------------------------------------------------
    window.addEventListener('resize', () => this._onResize());

    // -----------------------------------------------------------------------
    // Game loop
    // -----------------------------------------------------------------------
    this.app.ticker.add((ticker) => this._update(ticker.deltaMS / 1000));

    // Hide loading screen
    this._reportLoading(100);
    this._hideLoading();
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

    // HUD: terrain name
    if (this._terrainLabel) {
      const t = this._mapData.getTerrainAtWorld(this._player.x, this._player.y);
      this._terrainLabel.textContent = TERRAIN_NAMES[t] ?? '';
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _reportLoading(percent) {
    const bar = document.getElementById('loading-bar');
    if (bar) bar.style.width = `${percent}%`;
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
    this._camera.apply(this._world);
  }
}
