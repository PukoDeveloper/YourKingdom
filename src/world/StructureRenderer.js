import { Container, Graphics } from 'pixi.js';
import { TILE_SIZE } from './constants.js';
import { drawCastleBuilding, drawVillageBuilding, drawPortBuilding } from './TileDrawer.js';

/**
 * Draws large structures (castles, villages, ports) on top of the terrain layer.
 */
export class StructureRenderer {
  /**
   * @param {import('./MapData.js').MapData} mapData
   */
  constructor(mapData) {
    this.container = new Container();
    this._build(mapData);
  }

  _build(mapData) {
    const g = new Graphics();

    for (const { x, y } of mapData.castles) {
      drawCastleBuilding(g, x * TILE_SIZE, y * TILE_SIZE);
    }

    for (const { x, y } of mapData.villages) {
      drawVillageBuilding(g, x * TILE_SIZE, y * TILE_SIZE);
    }

    for (const { x, y } of mapData.ports) {
      drawPortBuilding(g, x * TILE_SIZE, y * TILE_SIZE);
    }

    this.container.addChild(g);
  }
}
