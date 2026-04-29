import { Container, Graphics } from 'pixi.js';
import { TILE_SIZE } from './constants.js';

// Road surface colours
const ROAD_SURFACE_COLOR = 0xC49A6C; // warm sandy brown
const ROAD_BORDER_COLOR  = 0x8D6E63; // dark earthy brown
const ROAD_WIDTH         = 10;       // surface width in world pixels
const ROAD_BORDER_EXTRA  = 4;        // extra pixels on each side for the border
const ROAD_ALPHA         = 0.88;

/**
 * Renders built roads as dirt paths on the world map.
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

    const g = new Graphics();

    // Draw border first (underneath surface) so it peeks out on both sides.
    for (const tiles of tilePaths) {
      this._drawSegments(g, tiles, ROAD_BORDER_COLOR, ROAD_WIDTH + ROAD_BORDER_EXTRA, 0.70);
    }
    // Draw surface on top.
    for (const tiles of tilePaths) {
      this._drawSegments(g, tiles, ROAD_SURFACE_COLOR, ROAD_WIDTH, ROAD_ALPHA);
    }

    this._graphics = g;
    this.container.addChild(g);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Draw line segments connecting consecutive tile centres for one road path.
   *
   * @param {Graphics} g
   * @param {{ tx: number, ty: number }[]} tiles
   * @param {number} color    Fill colour (numeric)
   * @param {number} width    Line width in world pixels
   * @param {number} alpha    Opacity 0–1
   */
  _drawSegments(g, tiles, color, width, alpha) {
    if (!tiles || tiles.length < 2) return;

    for (let i = 0; i < tiles.length - 1; i++) {
      const a = tiles[i];
      const b = tiles[i + 1];
      const ax = (a.tx + 0.5) * TILE_SIZE;
      const ay = (a.ty + 0.5) * TILE_SIZE;
      const bx = (b.tx + 0.5) * TILE_SIZE;
      const by = (b.ty + 0.5) * TILE_SIZE;

      g.moveTo(ax, ay)
        .lineTo(bx, by)
        .stroke({ color, width, alpha, cap: 'round', join: 'round' });
    }
  }
}
