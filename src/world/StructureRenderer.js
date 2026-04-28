import { Container, Graphics } from 'pixi.js';
import { TILE_SIZE } from './constants.js';
import { drawCastleBuilding, drawVillageBuilding, drawPortBuilding } from './TileDrawer.js';

/**
 * Draws large structures (castles, villages, ports) on top of the terrain layer.
 */
export class StructureRenderer {
  /**
   * @param {import('./MapData.js').MapData} mapData
   * @param {import('../systems/NationSystem.js').NationSystem|null} [nationSystem]
   */
  constructor(mapData, nationSystem = null) {
    this.container = new Container();
    this._build(mapData, nationSystem);
  }

  _build(mapData, nationSystem) {
    const g = new Graphics();

    for (let i = 0; i < mapData.castles.length; i++) {
      const { x, y } = mapData.castles[i];
      let flagColor = 0xE53935;
      if (nationSystem) {
        const settlement = nationSystem.castleSettlements[i];
        if (settlement) {
          const nation = nationSystem.getNation(settlement);
          flagColor = parseInt(nation.color.slice(1), 16);
        }
      }
      drawCastleBuilding(g, x * TILE_SIZE, y * TILE_SIZE, flagColor);
    }

    for (let i = 0; i < mapData.villages.length; i++) {
      const { x, y } = mapData.villages[i];
      let flagColor = 0xBF360C;
      if (nationSystem) {
        const settlement = nationSystem.villageSettlements[i];
        if (settlement) {
          const nation = nationSystem.getNation(settlement);
          flagColor = parseInt(nation.color.slice(1), 16);
        }
      }
      drawVillageBuilding(g, x * TILE_SIZE, y * TILE_SIZE, flagColor);
    }

    for (const { x, y } of mapData.ports) {
      drawPortBuilding(g, x * TILE_SIZE, y * TILE_SIZE);
    }

    this.container.addChild(g);
  }
}
