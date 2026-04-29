import { Container, Graphics } from 'pixi.js';
import { TILE_SIZE } from './constants.js';
import { drawRoadTile } from './TileDrawer.js';

/**
 * Renders built roads as per-tile dirt paths on the world map.
 *
 * Each tile in a road path is drawn individually using `drawRoadTile`, with
 * directional arm flags set according to which neighbouring tiles are also
 * part of any built road.  This gives seamlessly connected road visuals.
 *
 * Roads are drawn above the terrain layer but below structures and units.
 * Call `rebuild(tilePaths)` whenever the set of built roads changes.
 *
 * @example
 * const rr = new RoadRenderer();
 * worldContainer.addChild(rr.container);
 * rr.rebuild(gameUI.getBuiltRoadTilePaths());
 */
export class RoadRenderer {
  constructor() {
    /** Root container – insert into the world scene graph above the terrain. */
    this.container = new Container();
    /** @type {Graphics|null} */
    this._graphics = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Rebuild all road graphics from the supplied tile paths.
   * Any previously drawn graphics are destroyed first.
   *
   * @param {{ tx: number, ty: number }[][]} tilePaths
   *   Array of tile-coordinate arrays; each sub-array is one road's path from
   *   one settlement centre to another.
   */
  rebuild(tilePaths) {
    if (this._graphics) {
      this.container.removeChild(this._graphics);
      this._graphics.destroy();
      this._graphics = null;
    }

    if (!tilePaths || tilePaths.length === 0) return;

    // Collect every unique road tile across all paths.
    const tileSet = new Set();
    for (const path of tilePaths) {
      for (const { tx, ty } of path) {
        tileSet.add(`${tx},${ty}`);
      }
    }

    const g = new Graphics();

    for (const key of tileSet) {
      const commaIdx = key.indexOf(',');
      const tx = parseInt(key.slice(0, commaIdx), 10);
      const ty = parseInt(key.slice(commaIdx + 1), 10);
      drawRoadTile(g, tx * TILE_SIZE, ty * TILE_SIZE, {
        n: tileSet.has(`${tx},${ty - 1}`),
        s: tileSet.has(`${tx},${ty + 1}`),
        e: tileSet.has(`${tx + 1},${ty}`),
        w: tileSet.has(`${tx - 1},${ty}`),
      });
    }

    this._graphics = g;
    this.container.addChild(g);
  }
}

