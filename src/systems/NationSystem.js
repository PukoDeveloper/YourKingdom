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

import { Character } from '../characters/Character.js';
import { Region } from '../regions/Region.js';
import { FLAG_STRIPE_STYLES, FLAG_STRIPE_COLORS } from './AppearanceSystem.js';
import { ALL_PERSONALITIES } from './DiplomacySystem.js';
import { BuildingSystem } from './BuildingSystem.js';
import { generateRandomTraits } from './CharacterSystem.js';

/** Trait constant shared with Army.js – marks a unit as a settlement ruler. */
export const TRAIT_RULER = '統治者';

/** Titles used for auto-generated neutral (liberated) settlement leaders. */
const NEUTRAL_CASTLE_TITLES  = ['自治領袖', '議事長', '獨立領主', '自由議長', '民選君主'];
const NEUTRAL_VILLAGE_TITLES = ['自治長', '鄉民代表', '村議長', '民選里正', '自治耆老'];

/**
 * Special nation ID assigned to the player's kingdom.
 * Settlement.controllingNationId is set to this value when the player captures a settlement.
 */
export const PLAYER_NATION_ID = -1;

/**
 * Special nation ID for neutral (liberated) settlements.
 * Settlement.controllingNationId is set to this value when the player liberates a settlement,
 * releasing it from its original nation's control without annexing it.
 */
export const NEUTRAL_NATION_ID = -2;

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

/**
 * Settlement – legacy alias for Region, kept for backward compatibility.
 *
 * All new code should use Region directly.  NationSystem now creates Region
 * instances (which carry all Settlement properties plus satisfaction,
 * rulerId, and assignedCharacters).
 *
 * Existing consumers that import `Settlement` from this module continue to
 * work because Region has the same public interface.
 */
export { Region as Settlement };

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

      // Traits: personality is guaranteed for NPC diplomacy AI; additional traits
      // are drawn from the unified random pool (same as player army recruits).
      const extraTraits = generateRandomTraits(c.x * 7 + c.y * 13 + seed, [TRAIT_RULER, personality]);
      // Castle ruler is a Character with isKing: true (they rule a nation).
      const ruler = new Character({
        id:           -(i + 1),   // negative IDs mark NPC rulers
        name:         rulerName,
        role:         rulerRole,
        traits:       [TRAIT_RULER, personality, ...extraTraits],
        stats: {
          attack:    Math.floor(8  + h(8)  * 12),
          defense:   Math.floor(8  + h(9)  * 12),
          morale:    Math.floor(60 + h(10) * 40),
          moveSpeed: 3 + Math.floor((h(11) % 1.0) * 6),
        },
        loyalNationId: i,
        location:      { type: 'region', ref: `castle:${i}` },
        isKing:        true,
      });

      this.castleSettlements.push(new Region({
        type:         'castle',
        name:         castleName,
        nationId:     i,
        population:   pop,
        economyLevel: eco,
        resources,
        ruler,
        buildings:    BuildingSystem.generate('castle', c.x, c.y, seed),
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

      // Traits: village rulers use the unified random pool (no forced personality).
      const vExtraTraits = generateRandomTraits(v.x * 7 + v.y * 13 + seed + 500, [TRAIT_RULER]);
      // Village rulers are Characters independent of any squad.
      const ruler = new Character({
        id:     -(1000 + i + 1),
        name:   rulerName,
        role:   rulerRole,
        traits: [TRAIT_RULER, ...vExtraTraits],
        stats: {
          attack:    Math.floor(3 + h(8) * 7),
          defense:   Math.floor(3 + h(9) * 7),
          morale:    Math.floor(40 + h(10) * 40),
          moveSpeed: 3 + Math.floor((h(11) % 1.0) * 6),
        },
        loyalNationId: nationId,
        location:      { type: 'region', ref: `village:${i}` },
        isKing:        false,
      });

      const villagePrefix = _pick(VILLAGE_NAME_PREFIXES, h(12));
      const villageSuffix = _pick(VILLAGE_SUFFIXES, h(11));

      this.villageSettlements.push(new Region({
        type:         'village',
        name:         `${villagePrefix}${villageSuffix}`,
        nationId,
        population:   pop,
        economyLevel: eco,
        resources,
        ruler,
        buildings:    BuildingSystem.generate('village', v.x, v.y, seed),
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
   * Returns a neutral descriptor when controllingNationId = NEUTRAL_NATION_ID.
   * @param {Settlement} settlement
   * @returns {{ id: number, name: string, color: string, emblem: string, flagApp: object }|null}
   */
  getControllingNation(settlement) {
    if (settlement.controllingNationId === PLAYER_NATION_ID) return null; // player-owned
    if (settlement.controllingNationId === NEUTRAL_NATION_ID) {
      return {
        id:      NEUTRAL_NATION_ID,
        name:    '中立',
        color:   '#FFFFFF',
        emblem:  '🏳',
        flagApp: { bgColor: '#FFFFFF', stripeStyle: 'none', stripeColor: '#FFFFFF', symbol: '🏳', symbolShape: 'circle' },
      };
    }
    if (settlement.controllingNationId >= this.nations.length || settlement.controllingNationId < 0) {
      // Fallback for unexpected / uninitialised IDs
      return {
        id:      -1,
        name:    '未知',
        color:   '#9E9E9E',
        emblem:  '❓',
        flagApp: { bgColor: '#9E9E9E', stripeStyle: 'none', stripeColor: '#FFFFFF', symbol: '❓', symbolShape: 'circle' },
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

/**
 * Generate a deterministic independent ruler for a neutral (liberated) settlement.
 * The ruler is seeded from the settlement type and index so it is always the same
 * for a given settlement regardless of when liberation occurs, which means no
 * extra save/load state is required.
 *
 * @param {'castle'|'village'} type   Settlement type.
 * @param {number}             index  Index in the corresponding settlements array.
 * @returns {Character}
 */
export function generateNeutralRuler(type, index) {
  const isCastle = type === 'castle';
  // Use a large, type-specific salt so neutral rulers never collide with
  // the world-seed-generated nation rulers.
  const salt = isCastle ? 1_000_000 : 2_000_000;
  const h = (o) => _hash(index + salt, 0, o);

  const name    = _pick(RULER_SURNAMES, h(1)) + _pick(RULER_GIVEN, h(2));
  const titles  = isCastle ? NEUTRAL_CASTLE_TITLES : NEUTRAL_VILLAGE_TITLES;
  const role    = _pick(titles, h(3));

  const extraTraits = generateRandomTraits(Math.floor(h(4) * 99991), [TRAIT_RULER]);
  const settKey = `${isCastle ? 'castle' : 'village'}:${index}`;

  return new Character({
    // Castle neutral rulers: IDs -(3000…3999); village neutral rulers: -(4000…4999).
    // Both ranges are clear of world-seed ruler IDs (-(1)…-(9) for castles,
    // -(1001)…-(1xxx) for villages).
    id:     -(3000 + (isCastle ? 0 : 1000) + index),
    name,
    role,
    traits: [TRAIT_RULER, ...extraTraits],
    stats: {
      attack:    Math.floor(3  + h(5) * 10),
      defense:   Math.floor(3  + h(6) * 10),
      morale:    Math.floor(40 + h(7) * 40),
      moveSpeed: 3 + Math.floor(h(8) * 6),
    },
    loyalNationId: null,           // neutral rulers owe no allegiance
    location:      { type: 'region', ref: settKey },
    isKing:        false,
  });
}
