import { Container, Graphics } from 'pixi.js';
import { TERRAIN, TILE_SIZE } from './constants.js';
import {
  drawLumberCampBuilding,
  drawMineBuilding,
  drawBridgeBuilding,
} from './TileDrawer.js';

/**
 * Compute the 4-bit water-neighbour mask for a bridge tile.
 *   bit 0 (1)  = North neighbour is WATER
 *   bit 1 (2)  = East  neighbour is WATER
 *   bit 2 (4)  = South neighbour is WATER
 *   bit 3 (8)  = West  neighbour is WATER
 *
 * @param {number} tx
 * @param {number} ty
 * @param {import('./MapData.js').MapData|null} mapData
 * @returns {number}
 */
function _bridgeNeighborMask(tx, ty, mapData) {
  if (!mapData) return 0b1010; // default E-W straight if no map data
  const DIRS = [
    [0, -1, 1],   // North → bit 0
    [1,  0, 2],   // East  → bit 1
    [0,  1, 4],   // South → bit 2
    [-1, 0, 8],   // West  → bit 3
  ];
  let mask = 0;
  for (const [dx, dy, bit] of DIRS) {
    if (mapData.getTerrain(tx + dx, ty + dy) === TERRAIN.WATER) mask |= bit;
  }
  return mask !== 0 ? mask : 0b1010;
}

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
   * @param {import('./MapData.js').MapData|null} [mapData]  Used to compute bridge orientation.
   */
  rebuild(buildings, mapData = null) {
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
        case 'bridge': {
          const mask = _bridgeNeighborMask(b.tx, b.ty, mapData);
          drawBridgeBuilding(g, px, py, mask);
          break;
        }
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
