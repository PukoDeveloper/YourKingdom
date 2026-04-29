/**
 * CharacterSystem – unified trait system for all characters in the game.
 *
 * Every entity that can carry traits (soldiers, kings, regional rulers,
 * trade envoys, construction workers) uses this shared trait registry.
 * Trait effects are computed by context-aware helper functions exported here.
 *
 * Relationship to other systems:
 *   - Army.js       uses generateRandomTraits() when creating new recruits.
 *   - NationSystem  uses generateRandomTraits() when building ruler units.
 *   - DiplomacySystem uses getSpeedBonus() for NPC march calculations.
 *   - GameUI        uses getTaxBonus() / getTradeBonus() for income, and
 *                   provides the "replace ruler" town-management UI.
 */

// ---------------------------------------------------------------------------
// Trait constants
// ---------------------------------------------------------------------------

/** Diplomacy / personality traits – shared with DiplomacySystem. */
export const TRAIT_WARLIKE    = '好戰';
export const TRAIT_GENTLE     = '溫和';
export const TRAIT_ARROGANT   = '傲慢';
export const TRAIT_CUNNING    = '狡猾';
export const TRAIT_CAUTIOUS   = '謹慎';

/** Combat / leadership traits. */
export const TRAIT_BRAVE      = '勇猛';      // +morale in battle
export const TRAIT_TACTICIAN  = '策略家';    // +attack bonus in battle
export const TRAIT_SHIELDWALL = '銅牆鐵壁';  // +defense bonus in battle

/** Specialty traits with context-specific effects. */
export const TRAIT_ATHLETE    = '天生運動員'; // +speed when leading a squad or trade route
export const TRAIT_METICULOUS = '一絲不苟';  // +tax when serving as settlement ruler
export const TRAIT_DIPLOMAT   = '善交際';    // +relation bonus from diplomatic actions

/** Role/title traits – assigned programmatically, never randomly. */
export const TRAIT_CAPTAIN    = '隊長';     // Can lead a squad
export const TRAIT_RULER      = '統治者';   // Settlement ruler

// ---------------------------------------------------------------------------
// Trait definitions: metadata for every trait
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   label:       string,
 *   icon:        string,
 *   description: string,
 *   context:     string[],
 *   speedBonus?:  number,
 *   taxBonus?:    number,
 *   tradeBonus?:  number,
 *   moraleBonus?: number,
 *   attackBonus?: number,
 *   defenseBonus?: number,
 *   relationBonus?: number,
 * }} TraitDef
 */

/** @type {Record<string, TraitDef>} */
export const TRAIT_DEFS = {
  [TRAIT_WARLIKE]:    {
    label: '好戰', icon: '⚔️',
    description: '對敵人傾向採取攻擊性行動，易主動開戰。',
    context: ['diplomacy'],
  },
  [TRAIT_GENTLE]:     {
    label: '溫和', icon: '🕊',
    description: '外交上較為寬和，不輕易宣戰，易接受和平提案。',
    context: ['diplomacy'],
  },
  [TRAIT_ARROGANT]:   {
    label: '傲慢', icon: '😤',
    description: '自尊心強，易引發外交摩擦，拒絕他人善意。',
    context: ['diplomacy'],
  },
  [TRAIT_CUNNING]:    {
    label: '狡猾', icon: '🦊',
    description: '計謀過人，行動靈活多變，擅於利用機會。',
    context: ['diplomacy'],
  },
  [TRAIT_CAUTIOUS]:   {
    label: '謹慎', icon: '🛡',
    description: '行事小心，輕易不冒進，戰略保守。',
    context: ['diplomacy'],
  },
  [TRAIT_BRAVE]:      {
    label: '勇猛', icon: '🔥',
    description: '戰鬥中士氣加成 +10，激勵同伴奮勇作戰。',
    context: ['battle'],
    moraleBonus: 10,
  },
  [TRAIT_TACTICIAN]:  {
    label: '策略家', icon: '📜',
    description: '隊伍攻擊力加成 +15%，擅於制定作戰計畫。',
    context: ['battle'],
    attackBonus: 0.15,
  },
  [TRAIT_SHIELDWALL]: {
    label: '銅牆鐵壁', icon: '🏰',
    description: '隊伍防禦力加成 +15%，構築堅不可摧的防線。',
    context: ['battle'],
    defenseBonus: 0.15,
  },
  [TRAIT_ATHLETE]:    {
    label: '天生運動員', icon: '🏃',
    description: '擔任隊伍領頭或管理貿易路線時，速度/效率提升 25%。',
    context: ['squad_leader', 'trade_route'],
    speedBonus: 0.25,
    tradeBonus: 0.25,
  },
  [TRAIT_METICULOUS]: {
    label: '一絲不苟', icon: '📋',
    description: '擔任地區領導者時，稅收提升 20%，治理井然有序。',
    context: ['settlement_ruler'],
    taxBonus: 0.20,
  },
  [TRAIT_DIPLOMAT]:   {
    label: '善交際', icon: '🤝',
    description: '外交行動效果加成，贈禮/抗議的關係值影響 +10。',
    context: ['diplomacy'],
    relationBonus: 10,
  },
  // Role traits (metadata only, no random assignment)
  [TRAIT_CAPTAIN]:    {
    label: '隊長', icon: '🎖',
    description: '可擔任小隊隊長，指揮隊伍行動。',
    context: ['leadership'],
  },
  [TRAIT_RULER]:      {
    label: '統治者', icon: '🏯',
    description: '負責管理聚落，代表該地區對外發言。',
    context: ['settlement'],
  },
};

// ---------------------------------------------------------------------------
// Pools for random assignment
// ---------------------------------------------------------------------------

/**
 * Traits that can be randomly assigned to any character.
 * Does NOT include role/title traits (隊長, 統治者).
 */
export const RANDOM_TRAITS = [
  TRAIT_WARLIKE, TRAIT_GENTLE, TRAIT_ARROGANT, TRAIT_CUNNING, TRAIT_CAUTIOUS,
  TRAIT_BRAVE, TRAIT_TACTICIAN, TRAIT_SHIELDWALL,
  TRAIT_ATHLETE, TRAIT_METICULOUS, TRAIT_DIPLOMAT,
];

/**
 * Non-personality traits suitable for adding on top of an existing
 * personality trait (e.g. for NPC rulers who already have a personality).
 */
export const SPECIALTY_TRAITS = [
  TRAIT_BRAVE, TRAIT_TACTICIAN, TRAIT_SHIELDWALL,
  TRAIT_ATHLETE, TRAIT_METICULOUS, TRAIT_DIPLOMAT,
];

// ---------------------------------------------------------------------------
// Deterministic hash helper
// ---------------------------------------------------------------------------

/** Maps any real number → [0, 1). */
function _h(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return Math.abs(s) % 1.0;
}

// ---------------------------------------------------------------------------
// Random trait generation
// ---------------------------------------------------------------------------

/**
 * Generate 0–2 random traits for a new character from RANDOM_TRAITS.
 *
 * Probability distribution:
 *   ~30% chance of 0 traits
 *   ~50% chance of 1 trait
 *   ~20% chance of 2 traits
 *
 * @param {number} seed  Any numeric seed (e.g. unit id × prime).
 * @param {string[]} [exclude=[]]  Trait strings to exclude (e.g. already-held traits).
 * @returns {string[]}
 */
export function generateRandomTraits(seed, exclude = []) {
  const p     = _h(seed * 11.3 + 17.7);
  const count = p < 0.30 ? 0 : p < 0.80 ? 1 : 2;
  if (count === 0) return [];

  const pool  = RANDOM_TRAITS.filter(t => !exclude.includes(t));
  if (pool.length === 0) return [];

  const t1 = pool[Math.floor(_h(seed * 3.7 + 1.1) * pool.length)];
  if (count === 1) return [t1];

  const pool2 = pool.filter(t => t !== t1);
  if (pool2.length === 0) return [t1];
  const t2 = pool2[Math.floor(_h(seed * 7.3 + 2.9) * pool2.length)];
  return [t1, t2];
}

/**
 * Generate 0–1 specialty trait for an NPC ruler (on top of their personality).
 * Uses SPECIALTY_TRAITS pool so diplomacy personality is not duplicated.
 *
 * @param {number} seed
 * @param {string[]} [exclude=[]]
 * @returns {string[]}
 */
export function generateRulerSpecialtyTrait(seed, exclude = []) {
  const p = _h(seed * 5.9 + 23.1);
  if (p < 0.40) return []; // 40% chance of no extra trait

  const pool = SPECIALTY_TRAITS.filter(t => !exclude.includes(t));
  if (pool.length === 0) return [];

  const t = pool[Math.floor(_h(seed * 13.1 + 4.7) * pool.length)];
  return [t];
}

// ---------------------------------------------------------------------------
// Effect computation helpers
// ---------------------------------------------------------------------------

/**
 * Get the march speed multiplier bonus when this unit leads a squad.
 * @param {import('./Army.js').Unit|null} unit
 * @returns {number}  Value to add to the base speed multiplier (e.g. 0.25 = +25%).
 */
export function getSpeedBonus(unit) {
  if (!unit) return 0;
  return unit.traits.includes(TRAIT_ATHLETE)
    ? (TRAIT_DEFS[TRAIT_ATHLETE].speedBonus ?? 0)
    : 0;
}

/**
 * Get the trade route income multiplier bonus when this unit manages a route.
 * @param {import('./Army.js').Unit|null} unit
 * @returns {number}
 */
export function getTradeBonus(unit) {
  if (!unit) return 0;
  return unit.traits.includes(TRAIT_ATHLETE)
    ? (TRAIT_DEFS[TRAIT_ATHLETE].tradeBonus ?? 0)
    : 0;
}

/**
 * Get the tax income multiplier bonus when this unit is a settlement ruler.
 * @param {import('./Army.js').Unit|null} unit
 * @returns {number}
 */
export function getTaxBonus(unit) {
  if (!unit) return 0;
  return unit.traits.includes(TRAIT_METICULOUS)
    ? (TRAIT_DEFS[TRAIT_METICULOUS].taxBonus ?? 0)
    : 0;
}

/**
 * Get the morale bonus contributed by this unit in battle.
 * @param {import('./Army.js').Unit|null} unit
 * @returns {number}
 */
export function getMoraleBonus(unit) {
  if (!unit) return 0;
  return unit.traits.includes(TRAIT_BRAVE)
    ? (TRAIT_DEFS[TRAIT_BRAVE].moraleBonus ?? 0)
    : 0;
}

/**
 * Get the attack multiplier bonus contributed by this unit in battle.
 * @param {import('./Army.js').Unit|null} unit
 * @returns {number}
 */
export function getAttackBonus(unit) {
  if (!unit) return 0;
  return unit.traits.includes(TRAIT_TACTICIAN)
    ? (TRAIT_DEFS[TRAIT_TACTICIAN].attackBonus ?? 0)
    : 0;
}

/**
 * Get the defense multiplier bonus contributed by this unit in battle.
 * @param {import('./Army.js').Unit|null} unit
 * @returns {number}
 */
export function getDefenseBonus(unit) {
  if (!unit) return 0;
  return unit.traits.includes(TRAIT_SHIELDWALL)
    ? (TRAIT_DEFS[TRAIT_SHIELDWALL].defenseBonus ?? 0)
    : 0;
}

/**
 * Get the diplomacy relation bonus when this unit is involved in a diplomatic action.
 * @param {import('./Army.js').Unit|null} unit
 * @returns {number}
 */
export function getRelationBonus(unit) {
  if (!unit) return 0;
  return unit.traits.includes(TRAIT_DIPLOMAT)
    ? (TRAIT_DEFS[TRAIT_DIPLOMAT].relationBonus ?? 0)
    : 0;
}

/**
 * Return a HTML string listing all traits of a unit with colour-coded badges.
 * Suitable for inserting directly into innerHTML.
 *
 * @param {string[]} traits
 * @param {Record<string, string>} [personalityColors]  Optional colour map for personality traits.
 * @returns {string}
 */
export function renderTraitBadgesHTML(traits, personalityColors = {}) {
  return traits.map(t => {
    const def       = TRAIT_DEFS[t];
    const persColor = personalityColors[t];
    if (t === TRAIT_RULER) {
      return `<span class="trait-tag trait-ruler">${t}</span>`;
    }
    if (persColor) {
      return `<span class="trait-tag trait-personality" style="color:${persColor};border-color:${persColor}88" title="${def?.description ?? ''}">${t}</span>`;
    }
    if (def?.context?.includes('battle')) {
      return `<span class="trait-tag trait-combat" title="${def.description ?? ''}">${def.icon ?? ''} ${t}</span>`;
    }
    if (def?.context?.some(c => ['squad_leader', 'trade_route', 'settlement_ruler'].includes(c))) {
      return `<span class="trait-tag trait-specialty" title="${def.description ?? ''}">${def.icon ?? ''} ${t}</span>`;
    }
    return `<span class="trait-tag" title="${def?.description ?? ''}">${t}</span>`;
  }).join('');
}
