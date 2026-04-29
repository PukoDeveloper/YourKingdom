import { Container, Graphics } from 'pixi.js';
import { TILE_SIZE } from './constants.js';
import {
  drawLumberCampBuilding,
  drawMineBuilding,
  drawBridgeBuilding,
} from './TileDrawer.js';

/**
 * Renders player-placed map buildings (lumber camps, mines, bridges) as
 * tile-sized graphics above the terrain layer.
 *
 * Usage:
 *   1. Add `mapBuildingRenderer.container` to the world scene graph (above
 *      roads but below structures and units).
 *   2. Call `rebuild(buildings)` whenever the building list changes.
 */
export class MapBuildingRenderer {
  constructor() {
    /** Root container – insert into the world scene graph. */
    this.container = new Container();
    /** @type {Graphics|null} */
    this._graphics = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Rebuild all map-building graphics from the supplied building list.
   * Any previously drawn graphics are destroyed first.
   *
   * @param {{ id: number, type: 'lumberCamp'|'mine'|'bridge', tx: number, ty: number }[]} buildings
   */
  rebuild(buildings) {
    if (this._graphics) {
      this.container.removeChild(this._graphics);
      this._graphics.destroy();
      this._graphics = null;
    }

    if (!buildings || buildings.length === 0) return;

    const g = new Graphics();

    for (const b of buildings) {
      const px = b.tx * TILE_SIZE;
      const py = b.ty * TILE_SIZE;
      switch (b.type) {
        case 'lumberCamp': drawLumberCampBuilding(g, px, py); break;
        case 'mine':       drawMineBuilding(g, px, py);       break;
        case 'bridge':     drawBridgeBuilding(g, px, py);     break;
        default: break;
      }
    }

    this._graphics = g;
    this.container.addChild(g);
  }

  /** Destroy all graphics and the container. */
  destroy() {
    if (this._graphics) {
      this._graphics.destroy();
      this._graphics = null;
    }
    this.container.destroy({ children: true });
  }
}
