/**
 * NationSystem – manages nations, castle/village settlements, and their rulers.
 *
 * Every castle is automatically assigned one nation at world-generation time.
 * Villages are assigned to the nation of the nearest castle.
 * Every settlement (castle or village) has:
 *   - population, economy level (1-5), abundant resources
 *   - a ruler unit (same Unit type as army members, but carrying TRAIT_RULER)
 *
 * The entire system is seed-deterministic, so it requires no explicit save state;
 * it regenerates identically from the world seed on each load.
 */

import { Unit } from './Army.js';
import { FLAG_STRIPE_STYLES, FLAG_STRIPE_COLORS } from './AppearanceSystem.js';
import { ALL_PERSONALITIES } from './DiplomacySystem.js';

/** Trait constant shared with Army.js – marks a unit as a settlement ruler. */
export const TRAIT_RULER = '統治者';

/**
 * Special nation ID assigned to the player's kingdom.
 * Settlement.controllingNationId is set to this value when the player captures a settlement.
 */
export const PLAYER_NATION_ID = -1;

// ---------------------------------------------------------------------------
// Static data tables
// ---------------------------------------------------------------------------

/** One entry per possible nation. Castles cycle through this list. */
const NATION_TEMPLATES = [
  { name: '鐵鷹王國', color: '#C62828', emblem: '🦅' },
  { name: '青龍帝國', color: '#1565C0', emblem: '🐉' },
  { name: '白虎聯邦', color: '#78909C', emblem: '🐯' },
  { name: '玄武公國', color: '#2E7D32', emblem: '🐢' },
  { name: '朱雀王朝', color: '#E65100', emblem: '🦚' },
  { name: '金鳳侯國', color: '#F9A825', emblem: '🦜' },
  { name: '銀狼部落', color: '#546E7A', emblem: '🐺' },
  { name: '紫麟聖域', color: '#6A1B9A', emblem: '🦄' },
  { name: '翠鯨海邦', color: '#00695C', emblem: '🌊' },
];

const RESOURCES = [
  '木材', '農產', '礦石', '絲綢', '煤炭',
  '草藥', '魚獲', '皮毛', '食鹽', '陶器',
];

const RULER_SURNAMES = ['趙', '錢', '孫', '李', '周', '吳', '鄭', '王', '馮', '陳'];
const RULER_GIVEN    = ['文', '武', '德', '仁', '義', '禮', '智', '信', '忠', '勇'];
const CASTLE_TITLES  = ['國王', '女王', '大君', '皇帝', '霸主'];
const VILLAGE_TITLES = ['村長', '里正', '鄉紳', '族長', '耆老'];

/** Unique directional/geographical suffixes for village names. */
const VILLAGE_SUFFIXES = [
  '東村', '西村', '南村', '北村', '上村', '下村', '新村', '舊村',
  '大村', '小村', '河村', '山村', '林村', '石村', '金村', '銀村',
];

/** Geographic/natural prefixes for village names (independent of nation). */
const VILLAGE_NAME_PREFIXES = [
  '青石', '桃花', '梅嶺', '松坡', '竹林', '柳溪', '楓橋', '茅屋',
  '荷塘', '菊田', '桑葉', '杏花', '黃沙', '白雲', '烏雀', '翠谷',
];

/** Poetic/geographic prefixes for castle names (independent of nation). */
const CASTLE_NAME_PREFIXES = [
  '雲頂', '鐵壁', '龍牙', '鳳翔', '玉門', '劍峰', '天關', '北疆',
  '南嶠', '東陵', '西域', '金剛', '銀月', '紫霞', '翠嶺', '烈焰',
  '寒冰', '碧霄', '黃龍', '赤炎',
];

/** Suffixes for castle names. */
const CASTLE_NAME_SUFFIXES = ['城', '堡', '關', '砦', '要塞', '城堡'];

/** Maps a nation emblem emoji to a Pixi-drawable symbolShape string. */
const EMBLEM_TO_SHAPE = {
  '⚔️': 'cross', '🛡️': 'diamond', '👑': 'crown', '⭐': 'star',
  '🌙': 'circle', '☀️': 'sun', '⚡': 'bolt', '🔥': 'flame',
  '🌊': 'wave', '🦅': 'bird', '🐉': 'dragon', '🌿': 'leaf',
};

// ---------------------------------------------------------------------------
// Internal hash helpers (seed-deterministic, no imports needed)
// ---------------------------------------------------------------------------

/** Maps any real number → [0, 1). */
function _h(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return Math.abs(s) % 1.0;
}

/** Derives a float in [0,1) from two integers and an offset. */
function _hash(a, b, offset = 0) {
  return _h(a * 9973 + b * 3571 + offset * 1597);
}

/** Picks a random element from arr using a seed value in [0,1). */
function _pick(arr, seedVal) {
  return arr[Math.floor(seedVal * arr.length)];
}

// ---------------------------------------------------------------------------
// Settlement class
// ---------------------------------------------------------------------------

export class Settlement {
  /**
   * @param {{
   *   type:         'castle'|'village',
   *   name:         string,
   *   nationId:     number,
   *   population:   number,
   *   economyLevel: number,
   *   resources:    string[],
   *   ruler:        Unit
   * }} opts
   */
  constructor({ type, name, nationId, population, economyLevel, resources, ruler }) {
    /** @type {'castle'|'village'} */
    this.type = type;
    this.name = name;
    /** Index into NationSystem.nations (≥ 0) – the founding/original nation. */
    this.nationId = nationId;
    /**
     * The nation that currently controls this settlement.
     * Initially equals `nationId`; changes to PLAYER_NATION_ID when the player captures it,
     * or to another nation's id if future NPC conquest is implemented.
     */
    this.controllingNationId = nationId;
    this.population = population;
    /** 1 – 5 stars. */
    this.economyLevel = economyLevel;
    /** Array of resource names (usually 1–2). */
    this.resources = resources;
    /** The ruling Unit – same class as army members, but with TRAIT_RULER. */
    this.ruler = ruler;
    /**
     * True when the player has captured this settlement.
     * Derived from `controllingNationId === PLAYER_NATION_ID`; kept in sync by GameUI.
     */
    this.playerOwned = false;
  }
}

// ---------------------------------------------------------------------------
// NationSystem class
// ---------------------------------------------------------------------------

export class NationSystem {
  /**
   * @param {import('../world/MapData.js').MapData} mapData
   */
  constructor(mapData) {
    this.seed = mapData.seed;

    /** @type {{ id: number, name: string, color: string, emblem: string, flagApp: object }[]} */
    this.nations = [];

    /** @type {Settlement[]} – parallel array to mapData.castles */
    this.castleSettlements = [];

    /** @type {Settlement[]} – parallel array to mapData.villages */
    this.villageSettlements = [];

    this._build(mapData);
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  _build(mapData) {
    const { castles, villages, seed } = mapData;

    // One nation per castle
    castles.forEach((c, i) => {
      const tpl     = NATION_TEMPLATES[i % NATION_TEMPLATES.length];
      const seedX = c.x + seed, seedY = c.y + i * 37;
      const flagApp = {
        bgColor:     tpl.color,
        stripeStyle: FLAG_STRIPE_STYLES[Math.floor(_hash(seedX, seedY, 1) * FLAG_STRIPE_STYLES.length)],
        stripeColor: FLAG_STRIPE_COLORS[Math.floor(_hash(seedX, seedY, 2) * FLAG_STRIPE_COLORS.length)],
        symbol:      tpl.emblem,
        symbolShape: EMBLEM_TO_SHAPE[tpl.emblem] ?? 'circle',
      };
      this.nations.push({ id: i, name: tpl.name, color: tpl.color, emblem: tpl.emblem, flagApp });
    });

    // Castle settlements
    castles.forEach((c, i) => {
      const h = (o) => _hash(c.x + seed, c.y, o);
      const pop        = Math.floor(2000 + h(1) * 18000);
      const eco        = Math.max(1, Math.min(5, Math.ceil(h(2) * 5)));
      const resA       = _pick(RESOURCES, h(3));
      const resB       = _pick(RESOURCES, h(4));
      const resources  = resA !== resB ? [resA, resB] : [resA];
      const rulerName  = _pick(RULER_SURNAMES, h(5)) + _pick(RULER_GIVEN, h(6));
      const rulerRole  = _pick(CASTLE_TITLES, h(7));
      const personality = _pick(ALL_PERSONALITIES, h(12));
      const castleName  = _pick(CASTLE_NAME_PREFIXES, h(13)) + _pick(CASTLE_NAME_SUFFIXES, h(14));

      const ruler = new Unit({
        id:     -(i + 1),       // negative IDs mark NPC rulers
        name:   rulerName,
        role:   rulerRole,
        traits: [TRAIT_RULER, personality],
        stats: {
          attack:  Math.floor(8  + h(8)  * 12),
          defense: Math.floor(8  + h(9)  * 12),
          morale:  Math.floor(60 + h(10) * 40),
        },
      });

      this.castleSettlements.push(new Settlement({
        type:         'castle',
        name:         castleName,
        nationId:     i,
        population:   pop,
        economyLevel: eco,
        resources,
        ruler,
      }));
    });

    // Village settlements – assign to nearest castle's nation
    villages.forEach((v, i) => {
      const h = (o) => _hash(v.x + seed, v.y + 500, o);
      const pop        = Math.floor(200 + h(1) * 1800);
      const eco        = Math.max(1, Math.min(5, Math.ceil(h(2) * 4)));
      const resources  = [_pick(RESOURCES, h(3))];
      const rulerName  = _pick(RULER_SURNAMES, h(5)) + _pick(RULER_GIVEN, h(6));
      const rulerRole  = _pick(VILLAGE_TITLES, h(7));
      const nationId   = this._nearestCastleNation(v.x, v.y, castles);

      const ruler = new Unit({
        id:     -(1000 + i + 1),
        name:   rulerName,
        role:   rulerRole,
        traits: [TRAIT_RULER],
        stats: {
          attack:  Math.floor(3 + h(8) * 7),
          defense: Math.floor(3 + h(9) * 7),
          morale:  Math.floor(40 + h(10) * 40),
        },
      });

      const villagePrefix = _pick(VILLAGE_NAME_PREFIXES, h(12));
      const villageSuffix = _pick(VILLAGE_SUFFIXES, h(11));

      this.villageSettlements.push(new Settlement({
        type:         'village',
        name:         `${villagePrefix}${villageSuffix}`,
        nationId,
        population:   pop,
        economyLevel: eco,
        resources,
        ruler,
      }));
    });
  }

  /** Return the index of the castle (= nation id) closest to (vx, vy). */
  _nearestCastleNation(vx, vy, castles) {
    if (castles.length === 0) return -1;
    let best = 0;
    let bestDist = Infinity;
    castles.forEach((c, i) => {
      const d = (vx - c.x) ** 2 + (vy - c.y) ** 2;
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  // -------------------------------------------------------------------------
  // Public helpers
  // -------------------------------------------------------------------------

  /**
   * Return the settlement at a tile position (if any).
   * Castles occupy 4×4 tiles; villages occupy 2×2 tiles.
   *
   * @param {number} tileX
   * @param {number} tileY
   * @param {import('../world/MapData.js').MapData} mapData
   * @returns {{ settlement: Settlement, index: number }|null}
   */
  getSettlementAtTile(tileX, tileY, mapData) {
    for (let i = 0; i < mapData.castles.length; i++) {
      const c = mapData.castles[i];
      if (tileX >= c.x && tileX < c.x + 4 && tileY >= c.y && tileY < c.y + 4) {
        return { settlement: this.castleSettlements[i], index: i };
      }
    }
    for (let i = 0; i < mapData.villages.length; i++) {
      const v = mapData.villages[i];
      if (tileX >= v.x && tileX < v.x + 2 && tileY >= v.y && tileY < v.y + 2) {
        return { settlement: this.villageSettlements[i], index: i };
      }
    }
    return null;
  }

  /**
   * Return the nation object for a given settlement.
   * @param {Settlement} settlement
   * @returns {{ id: number, name: string, color: string, emblem: string }}
   */
  getNation(settlement) {
    if (settlement.nationId < 0) {
      return {
        id:      -1,
        name:    '中立',
        color:   '#9E9E9E',
        emblem:  '⚑',
        flagApp: { bgColor: '#9E9E9E', stripeStyle: 'none', stripeColor: '#FFFFFF', symbol: '⚑', symbolShape: 'circle' },
      };
    }
    return this.nations[settlement.nationId];
  }

  /**
   * Return the nation that currently controls a settlement.
   * Returns null when controlled by the player (controllingNationId = PLAYER_NATION_ID).
   * @param {Settlement} settlement
   * @returns {{ id: number, name: string, color: string, emblem: string, flagApp: object }|null}
   */
  getControllingNation(settlement) {
    if (settlement.controllingNationId < 0) return null; // player-owned
    if (settlement.controllingNationId >= this.nations.length) {
      return {
        id:      -1,
        name:    '中立',
        color:   '#9E9E9E',
        emblem:  '⚑',
        flagApp: { bgColor: '#9E9E9E', stripeStyle: 'none', stripeColor: '#FFFFFF', symbol: '⚑', symbolShape: 'circle' },
      };
    }
    return this.nations[settlement.controllingNationId];
  }

  /**
   * Returns true when every settlement originally belonging to this nation
   * has been captured (i.e., no settlement still has controllingNationId === nationId).
   * @param {number} nationId
   * @returns {boolean}
   */
  isNationExtinct(nationId) {
    if (nationId < 0) return false;
    return ![...this.castleSettlements, ...this.villageSettlements]
      .some(s => s.controllingNationId === nationId);
  }
}
