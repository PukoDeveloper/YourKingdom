import { Container, Graphics } from 'pixi.js';
import { TILE_SIZE } from './constants.js';
import { drawCastleBuilding, drawVillageBuilding, drawPortBuilding } from './TileDrawer.js';
import { PLAYER_NATION_ID, NEUTRAL_NATION_ID } from '../systems/NationSystem.js';

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
   * @param {(() => { color: string, flagApp: object|null })|null} [getPlayerNation]
   *   Returns the player's kingdom info (color + flagApp) used when a settlement
   *   is player-owned.  If omitted the NPC nation is always used.
   */
  constructor(mapData, nationSystem = null, getPlayerNation = null) {
    this._mapData        = mapData;
    this._nationSystem   = nationSystem;
    this._getPlayerNation = getPlayerNation;
    this.container = new Container();
    this._build();
  }

  _build() {
    const { _mapData: mapData, _nationSystem: nationSystem } = this;

    /** Return the nation info to use for rendering a settlement. */
    const _nation = (settlement) => {
      if (settlement?.controllingNationId === PLAYER_NATION_ID) {
        // If a remote player owns this settlement, use their kingdom colour/flag.
        if (settlement.ownerKingdom) return settlement.ownerKingdom;
        if (this._getPlayerNation) return this._getPlayerNation();
      }
      if (settlement?.controllingNationId === NEUTRAL_NATION_ID) {
        return { color: '#FFFFFF', flagApp: { bgColor: '#FFFFFF', stripeStyle: 'none', stripeColor: '#FFFFFF', symbol: '🏳', symbolShape: 'circle' } };
      }
      return nationSystem ? nationSystem.getNation(settlement) : { color: '#9E9E9E', flagApp: null };
    };

    const g = new Graphics();

    for (let i = 0; i < mapData.castles.length; i++) {
      const { x, y } = mapData.castles[i];
      let flagColor = 0xE53935;
      let flagApp   = null;
      if (nationSystem) {
        const settlement = nationSystem.castleSettlements[i];
        if (settlement) {
          const nation = _nation(settlement);
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
          const nation = _nation(settlement);
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

  /**
   * Destroy the current graphics and redraw all structures.
   * Call this whenever the effective nation for any settlement changes
   * (e.g. after the player captures a settlement).
   */
  rebuild() {
    while (this.container.children.length) {
      this.container.removeChildAt(0).destroy();
    }
    this._build();
  }
}
