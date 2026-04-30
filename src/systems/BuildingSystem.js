/**
 * BuildingSystem – seed-deterministic building generation per settlement.
 *
 * Each settlement gets a fixed set of buildings derived from its seed/position:
 *   - Village: 1 government building (村長家) + 2 randomly selected buildings
 *   - Castle:  1 government building (王宮)   + 3 randomly selected buildings
 *
 * Prices vary per settlement using a per-building multiplier (0.7 – 1.3).
 * Local resources are sold at a 70 % discount in the 雜貨舖.
 */

// ---------------------------------------------------------------------------
// Building type IDs
// ---------------------------------------------------------------------------

export const BLDG_PALACE      = 'palace';        // 王宮      (castle government)
export const BLDG_CHIEF_HOUSE = 'chief_house';   // 村長家    (village government)
export const BLDG_GENERAL     = 'general_store'; // 雜貨舖   (goods + local resources)
export const BLDG_BLACKSMITH  = 'blacksmith';    // 鐵匠舖   (weapons & armour)
export const BLDG_MAGE        = 'mage_pavilion'; // 法師亭   (potions & accessories)
export const BLDG_TAVERN      = 'tavern';        // 酒館      (food + recruit)
export const BLDG_INN         = 'inn';           // 旅店      (rest & HP recovery)

// ---------------------------------------------------------------------------
// Building metadata
// ---------------------------------------------------------------------------

/** Display metadata for each building type. */
export const BUILDING_META = {
  [BLDG_PALACE]:      { icon: '🏯', name: '王宮',   desc: '國王接見廳\n覲見統治者' },
  [BLDG_CHIEF_HOUSE]: { icon: '🏠', name: '村長家', desc: '委託任務\n了解近況'     },
  [BLDG_GENERAL]:     { icon: '🏪', name: '雜貨舖', desc: '買賣物資\n補充補給'     },
  [BLDG_BLACKSMITH]:  { icon: '⚒️', name: '鐵匠舖', desc: '鍛造武器\n強化裝備'    },
  [BLDG_MAGE]:        { icon: '🔮', name: '法師亭', desc: '購買藥水\n施展魔法'     },
  [BLDG_TAVERN]:      { icon: '🍺', name: '酒館',   desc: '打聽情報\n招募夥伴'     },
  [BLDG_INN]:         { icon: '🛏️', name: '旅店',   desc: '安心休憩\n恢復體力'     },
};

// ---------------------------------------------------------------------------
// Shop catalogs (base prices in gold)
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   icon: string,
 *   type: string,
 *   basePrice: number,
 *   quantity: number,
 *   description?: string,
 *   stats?: object
 * }} CatalogItem
 */

/** Items sold by 雜貨舖 (local resources added dynamically at point of sale). */
export const CATALOG_GENERAL = [
  { id: 'dry_ration',  name: '乾糧',   icon: '🍱', type: 'food',    basePrice:  5, quantity: 5, description: '補充行軍所需的體力。' },
  { id: 'jerky',       name: '肉乾',   icon: '🥩', type: 'food',    basePrice:  8, quantity: 3, description: '耐儲的高熱量食物。' },
  { id: 'speed_rune',  name: '速度符', icon: '💨', type: 'utility', basePrice: 20, quantity: 1, description: '短暫提升移動速度' },
  { id: 'scout_hawk',  name: '偵察鷹', icon: '🦅', type: 'utility', basePrice: 25, quantity: 1, description: '派出鷹隼偵察地形' },
  { id: 'rope',        name: '繩索',   icon: '🧵', type: 'utility', basePrice:  6, quantity: 3, description: '多用途繩索，野外必備。' },
  { id: 'torch',       name: '火把',   icon: '🔦', type: 'utility', basePrice:  4, quantity: 5, description: '照亮黑暗的火把。' },
];

/** Items sold by 鐵匠舖. */
export const CATALOG_BLACKSMITH = [
  { id: 'long_sword',    name: '長劍',   icon: '🗡️', type: 'weapon', basePrice:  80, quantity: 1, description: '鋒利的長劍，適合近戰。',     stats: { attack: 12 } },
  { id: 'short_sword',   name: '短劍',   icon: '⚔️', type: 'weapon', basePrice:  50, quantity: 1, description: '短小靈活的雙手短劍。',         stats: { attack: 8  } },
  { id: 'spear',         name: '長槍',   icon: '🪃', type: 'weapon', basePrice:  65, quantity: 1, description: '步兵常用的長柄槍。',           stats: { attack: 10 } },
  { id: 'iron_helm',     name: '鐵頭盔', icon: '⛑️', type: 'helmet', basePrice:  60, quantity: 1, description: '堅固的鐵製頭盔。',             stats: { defense: 6  } },
  { id: 'chain_mail',    name: '鎖甲',   icon: '🥋', type: 'chest',  basePrice: 120, quantity: 1, description: '由鐵環編織的護甲。',           stats: { defense: 10 } },
  { id: 'leg_guard',     name: '護腿甲', icon: '🦵', type: 'legs',   basePrice:  40, quantity: 1, description: '保護腿部的金屬護甲。',         stats: { defense: 4  } },
  { id: 'leather_boots', name: '皮靴',   icon: '👢', type: 'boots',  basePrice:  30, quantity: 1, description: '輕便耐用的皮革靴子。',         stats: { speed: 2    } },
];

/** Items sold by 法師亭. */
export const CATALOG_MAGE = [
  { id: 'heal_potion', name: '治療藥水', icon: '🧪', type: 'potion',    basePrice: 25, quantity: 2, description: '恢復生命值' },
  { id: 'atk_potion',  name: '強化藥水', icon: '⚗️', type: 'potion',    basePrice: 40, quantity: 1, description: '暫時大幅提升攻擊力' },
  { id: 'def_potion',  name: '護盾藥水', icon: '🫙', type: 'potion',    basePrice: 35, quantity: 1, description: '暫時提升防禦力' },
  { id: 'antidote',    name: '解毒藥',   icon: '💊', type: 'potion',    basePrice: 18, quantity: 2, description: '解除毒素效果' },
  { id: 'amulet',      name: '護身符',   icon: '📿', type: 'accessory', basePrice: 55, quantity: 1, description: '帶有神秘魔力的護身符。', stats: { morale: 5 } },
];

/** Food sold by 酒館. */
export const CATALOG_TAVERN_FOOD = [
  { id: 'ale',          name: '麥酒', icon: '🍺', type: 'food', basePrice:  3, quantity: 3, description: '消除疲勞的麥芽酒。' },
  { id: 'roasted_meat', name: '烤肉', icon: '🍖', type: 'food', basePrice:  6, quantity: 3, description: '香氣四溢的烤肉。' },
  { id: 'bread',        name: '麵包', icon: '🍞', type: 'food', basePrice:  4, quantity: 5, description: '扎實的軍糧麵包。' },
];

// ---------------------------------------------------------------------------
// Recruit data
// ---------------------------------------------------------------------------

/** Recruit role templates offered by 酒館. */
export const RECRUIT_TEMPLATES = [
  { role: '劍士',   traits: ['重步兵'], stats: { attack: 7,  defense: 6,  morale: 60 } },
  { role: '弓手',   traits: ['神射手'], stats: { attack: 9,  defense: 3,  morale: 55 } },
  { role: '長槍兵', traits: [],         stats: { attack: 6,  defense: 8,  morale: 60 } },
  { role: '騎兵',   traits: [],         stats: { attack: 10, defense: 5,  morale: 65 } },
  { role: '斥候',   traits: ['輕步兵'], stats: { attack: 6,  defense: 4,  morale: 70 } },
  { role: '武將',   traits: ['隊長'],   stats: { attack: 11, defense: 7,  morale: 75 } },
];

const _RECRUIT_SURNAMES = ['趙', '錢', '孫', '李', '周', '吳', '鄭', '王', '馮', '陳',
                            '諸', '葛', '張', '劉', '曹', '夏', '侯', '司', '馬', '楊'];
const _RECRUIT_GIVEN    = ['文', '武', '德', '仁', '義', '禮', '智', '信', '忠', '勇',
                            '虎', '豹', '雄', '健', '威', '猛', '慧', '英', '傑', '豪'];

// ---------------------------------------------------------------------------
// Internal hash helpers (same algorithm as NationSystem for consistency)
// ---------------------------------------------------------------------------

function _h(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return Math.abs(s) % 1.0;
}

function _hash(a, b, offset = 0) {
  return _h(a * 9973 + b * 3571 + offset * 1597);
}

function _pick(arr, seedVal) {
  return arr[Math.floor(seedVal * arr.length)];
}

// ---------------------------------------------------------------------------
// Building class
// ---------------------------------------------------------------------------

export class Building {
  /**
   * @param {string} type      One of the BLDG_* constants.
   * @param {number} priceMult Price multiplier applied to catalog base prices (0.7 – 1.3).
   */
  constructor(type, priceMult = 1.0) {
    this.type      = type;
    /** @type {number} Price multiplier for this building's catalog (0.7 – 1.3). */
    this.priceMult = priceMult;

    const meta    = BUILDING_META[type] ?? { icon: '🏠', name: type, desc: '' };
    this.icon     = meta.icon;
    this.name     = meta.name;
    this.desc     = meta.desc;
  }
}

// ---------------------------------------------------------------------------
// BuildingSystem
// ---------------------------------------------------------------------------

/** Non-government building types that can appear in a settlement. */
const _RANDOM_POOL = [
  BLDG_GENERAL,
  BLDG_BLACKSMITH,
  BLDG_MAGE,
  BLDG_TAVERN,
  BLDG_INN,
];

export class BuildingSystem {
  /**
   * Generate the building list for a settlement (deterministic from seed).
   *
   * Hash offsets 20 – 39 are reserved here; NationSystem uses 1 – 14 so
   * there is no collision.
   *
   * @param {'castle'|'village'} type     Settlement type.
   * @param {number}             sx       Settlement tile-x (hash input).
   * @param {number}             sy       Settlement tile-y (hash input).
   * @param {number}             worldSeed World seed.
   * @returns {Building[]}
   */
  static generate(type, sx, sy, worldSeed) {
    const h = (o) => _hash(sx + worldSeed, sy, o);

    // Government building is always index 0.
    const govType = type === 'castle' ? BLDG_PALACE : BLDG_CHIEF_HOUSE;
    const buildings = [new Building(govType, 1.0)];

    // Number of randomly chosen buildings (excludes government).
    const slotCount = type === 'castle' ? 3 : 2;

    // Pick without repetition from the pool.
    const pool = [..._RANDOM_POOL];
    for (let i = 0; i < slotCount && pool.length > 0; i++) {
      const poolIdx  = Math.floor(h(20 + i) * pool.length);
      const bType    = pool.splice(poolIdx, 1)[0];
      // Price multiplier: 0.7 – 1.3, encoded in two decimal places.
      const mult     = 0.7 + h(30 + i) * 0.6;
      buildings.push(new Building(bType, Math.round(mult * 100) / 100));
    }

    return buildings;
  }

  /**
   * Compute the actual selling price for a catalog item at this building.
   * Items matching a settlement's local resources are sold at 70 % of their
   * computed price (the settlement produces them, so supply is abundant).
   *
   * @param {CatalogItem} item
   * @param {Building}    building
   * @param {string[]}    localResources  Settlement's own resource names.
   * @returns {number} Price in gold (minimum 1).
   */
  static computePrice(item, building, localResources = []) {
    let price = item.basePrice * building.priceMult;
    if (localResources.includes(item.name)) {
      price *= 0.7;
    }
    return Math.max(1, Math.round(price));
  }

  /**
   * Compute the price a shop will PAY the player for a resource item.
   *
   * Sell prices are deliberately kept below buy prices at every settlement to
   * prevent players from exploiting a single location for infinite gold.
   *
   * Multipliers (applied to item.basePrice):
   *   – Demanded resource (settlement wants it):  0.60
   *   – Normal resource (neither local nor demanded): 0.50
   *   – Locally produced resource (abundant here):   0.30
   *
   * The cheapest possible BUY price for any item is basePrice × 0.7
   * (minimum priceMult 0.7) × 0.7 (local discount) ≈ 0.49 × basePrice.
   * Because demanded-resource sell price (0.60) exceeds that floor only for
   * the local-discount case, which is not applicable to demanded resources,
   * all sell prices remain strictly below the matching buy price.
   *
   * @param {CatalogItem} item
   * @param {string[]}    localResources  Settlement's own resource names.
   * @param {string}      [demandResource]  The resource currently demanded by this settlement.
   * @returns {number} Price in gold the shop pays (minimum 1).
   */
  static computeSellPrice(item, localResources = [], demandResource = '') {
    let mult;
    if (item.name === demandResource) {
      mult = 0.60; // settlement needs it – premium
    } else if (localResources.includes(item.name)) {
      mult = 0.30; // already abundant locally – depressed
    } else {
      mult = 0.50; // standard resale value
    }
    return Math.max(1, Math.round(item.basePrice * mult));
  }

  /**
   * Generate the recruit roster available at a tavern on a given day.
   * The result is deterministic: same inputs → same recruits.
   *
   * @param {number} sx        Settlement tile-x.
   * @param {number} sy        Settlement tile-y.
   * @param {number} worldSeed World seed.
   * @param {number} day       Current in-game day number (for daily refresh).
   * @returns {{ name: string, role: string, traits: string[], stats: object, hireCost: number }[]}
   */
  static generateRecruits(sx, sy, worldSeed, day) {
    const h = (o) => _hash(sx + worldSeed + day * 7, sy + day * 13, o);

    const count = 2 + Math.floor(h(0) * 3); // 2 – 4 recruits
    const results = [];

    for (let i = 0; i < count; i++) {
      const tpl     = _pick(RECRUIT_TEMPLATES, h(1 + i * 6));
      const surname = _pick(_RECRUIT_SURNAMES, h(2 + i * 6));
      const given   = _pick(_RECRUIT_GIVEN,    h(3 + i * 6));
      const name    = surname + given;

      // Stat variance in ±3
      const v = (o) => Math.round((h(4 + i * 6 + o) - 0.5) * 6);
      const stats = {
        attack:  Math.max(1,  tpl.stats.attack  + v(0)),
        defense: Math.max(1,  tpl.stats.defense + v(1)),
        morale:  Math.max(10, tpl.stats.morale  + v(2) * 2),
      };

      const hireCost = Math.max(10, 10 + stats.attack + stats.defense);
      results.push({ name, role: tpl.role, traits: [...tpl.traits], stats, hireCost });
    }

    return results;
  }
}
