import { Container, Graphics } from 'pixi.js';
import { TILE_SIZE } from './constants.js';
import { drawCastleBuilding, drawVillageBuilding, drawPortBuilding } from './TileDrawer.js';

/** Convert a CSS hex colour string (e.g. '#C62828') to a numeric value. */
function _hexToNum(color) {
  if (typeof color === 'string' && color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    if (!isNaN(n)) return n;
  }
  return null;
}

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
      let flagApp   = null;
      if (nationSystem) {
        const settlement = nationSystem.castleSettlements[i];
        if (settlement) {
          const nation = nationSystem.getNation(settlement);
          const parsed = _hexToNum(nation.color);
          if (parsed !== null) flagColor = parsed;
          flagApp = nation.flagApp ?? null;
        }
      }
      drawCastleBuilding(g, x * TILE_SIZE, y * TILE_SIZE, flagColor, flagApp);
    }

    for (let i = 0; i < mapData.villages.length; i++) {
      const { x, y } = mapData.villages[i];
      let flagColor = 0xBF360C;
      let flagApp   = null;
      if (nationSystem) {
        const settlement = nationSystem.villageSettlements[i];
        if (settlement) {
          const nation = nationSystem.getNation(settlement);
          const parsed = _hexToNum(nation.color);
          if (parsed !== null) flagColor = parsed;
          flagApp = nation.flagApp ?? null;
        }
      }
      drawVillageBuilding(g, x * TILE_SIZE, y * TILE_SIZE, flagColor, flagApp);
    }

    for (const { x, y } of mapData.ports) {
      drawPortBuilding(g, x * TILE_SIZE, y * TILE_SIZE);
    }

    this.container.addChild(g);
  }
}
