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
   * @param {(() => { color: string, flagApp: object|null })|null} [getPlayerNation]
   *   Returns the player's kingdom info (color + flagApp) used when a settlement
   *   is player-owned.  If omitted the NPC nation is always used.
   * @param {(() => { tx: number, ty: number }[])|null} [getBuiltPorts]
   *   Returns an array of tile positions for player-built port sea-markers.
   *   If omitted no custom port markers are drawn.
   */
  constructor(mapData, nationSystem = null, getPlayerNation = null, getBuiltPorts = null) {
    this._mapData        = mapData;
    this._nationSystem   = nationSystem;
    this._getPlayerNation = getPlayerNation;
    this._getBuiltPorts   = getBuiltPorts;
    this.container = new Container();
    this._build();
  }

  _build() {
    const { _mapData: mapData, _nationSystem: nationSystem } = this;

    /** Return the nation info to use for rendering a settlement. */
    const _nation = (settlement) => {
      if (settlement?.controllingNationId < 0 && this._getPlayerNation) {
        return this._getPlayerNation();
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

    // Draw small ⚓ markers for player-built ports (on the sea tile adjacent to the port).
    if (this._getBuiltPorts) {
      const builtPorts = this._getBuiltPorts();
      for (const { tx, ty } of builtPorts) {
        this._drawSeaPortMarker(g, tx * TILE_SIZE, ty * TILE_SIZE);
      }
    }

    this.container.addChild(g);
  }

  /**
   * Draw a small ⚓ port marker at a sea tile (world-pixel position px, py).
   * @param {import('pixi.js').Graphics} g
   * @param {number} px  World-pixel X
   * @param {number} py  World-pixel Y
   */
  _drawSeaPortMarker(g, px, py) {
    // Semi-transparent teal circle background
    g.circle(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 14)
      .fill({ color: 0x006064, alpha: 0.75 });
    g.circle(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 14)
      .stroke({ color: 0x26C6DA, alpha: 0.9, width: 1.5 });
    // Anchor symbol using a simple cross + ring drawn with Graphics
    const cx = px + TILE_SIZE / 2;
    const cy = py + TILE_SIZE / 2;
    g.moveTo(cx, cy - 9).lineTo(cx, cy + 9)
      .stroke({ color: 0x80DEEA, alpha: 1, width: 2 });
    g.moveTo(cx - 7, cy - 5).lineTo(cx + 7, cy - 5)
      .stroke({ color: 0x80DEEA, alpha: 1, width: 2 });
    g.moveTo(cx - 7, cy + 7).lineTo(cx - 3, cy + 9)
      .stroke({ color: 0x80DEEA, alpha: 1, width: 1.5 });
    g.moveTo(cx + 7, cy + 7).lineTo(cx + 3, cy + 9)
      .stroke({ color: 0x80DEEA, alpha: 1, width: 1.5 });
    g.arc(cx, cy + 7, 4, 0, Math.PI)
      .stroke({ color: 0x80DEEA, alpha: 1, width: 1.5 });
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
