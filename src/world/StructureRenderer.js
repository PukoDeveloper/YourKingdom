import { Container, Graphics } from 'pixi.js';
import { TILE_SIZE } from './constants.js';
import { drawCastleBuilding } from './TileDrawer.js';

/**
 * Draws large castle structures on top of the terrain layer.
 * Each castle occupies 4×4 tiles and is drawn as a single Graphics.
 */
export class StructureRenderer {
  /**
   * @param {import('./MapData.js').MapData} mapData
   */
  constructor(mapData) {
    this.container = new Container();
    this._build(mapData.castles);
  }

  _build(castles) {
    const g = new Graphics();
    for (const { x, y } of castles) {
      drawCastleBuilding(g, x * TILE_SIZE, y * TILE_SIZE);
    }
    this.container.addChild(g);
  }
}
