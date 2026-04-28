/**
 * DiplomacySystem – manages diplomatic relations between nations (including the player).
 *
 * Relation value range: -100 (Hostile) to 100 (Allied).
 *
 * Initial relations are seed-deterministic (derived from NationSystem data) so
 * only the player's relation deltas need to be persisted.
 *
 * Factors that influence NPC-NPC base relations:
 *   - Distance between castles  (closer → more tension)
 *   - Average economy level     (both wealthy → slight positive)
 *   - Shared / complementary resources (overlap → competition; different → cooperative)
 *   - Ruler personality         (arrogant/warlike → negative; gentle → positive)
 */

import { MAP_WIDTH, MAP_HEIGHT } from '../world/constants.js';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Personality trait labels assigned to NPC rulers. */
export const PERSONALITY_GENTLE   = '溫和';
export const PERSONALITY_CAUTIOUS = '謹慎';
export const PERSONALITY_CUNNING  = '狡猾';
export const PERSONALITY_ARROGANT = '傲慢';
export const PERSONALITY_WARLIKE  = '好戰';

/** All personality types (index order used by NationSystem hash). */
export const ALL_PERSONALITIES = [
  PERSONALITY_GENTLE,
  PERSONALITY_CAUTIOUS,
  PERSONALITY_CUNNING,
  PERSONALITY_ARROGANT,
  PERSONALITY_WARLIKE,
];

/** Ordered relation tiers (highest first). */
export const RELATION_LEVELS = [
  { min:  60, label: '同盟',   color: '#43a047', icon: '🤝' },
  { min:  20, label: '友好',   color: '#66bb6a', icon: '😊' },
  { min: -20, label: '中立',   color: '#9e9e9e', icon: '😐' },
  { min: -60, label: '不友好', color: '#ef6c00', icon: '😠' },
  { min: -101, label: '敵對',  color: '#e53935', icon: '⚔️' },
];

/** CSS colours for each personality trait. */
export const PERSONALITY_COLORS = {
  [PERSONALITY_GENTLE]:   '#66bb6a',
  [PERSONALITY_CAUTIOUS]: '#9e9e9e',
  [PERSONALITY_CUNNING]:  '#ce93d8',
  [PERSONALITY_ARROGANT]: '#ef6c00',
  [PERSONALITY_WARLIKE]:  '#e53935',
};

// Max possible tile distance on the 200×200 map.
const MAX_MAP_DIST = Math.sqrt(MAP_WIDTH ** 2 + MAP_HEIGHT ** 2);

// ---------------------------------------------------------------------------
// DiplomacySystem
// ---------------------------------------------------------------------------

export class DiplomacySystem {
  /**
   * @param {import('./NationSystem.js').NationSystem} nationSystem
   * @param {import('../world/MapData.js').MapData}    mapData
   */
  constructor(nationSystem, mapData) {
    /** @type {import('./NationSystem.js').NationSystem} */
    this.nationSystem = nationSystem;

    /**
     * NPC-NPC relations.
     * Key: "A:B" where A < B (both are nation IDs).
     * @type {Map<string, number>}
     */
    this._npcRelations = new Map();

    /**
     * Player ↔ NPC relations.
     * Key: nationId (number).
     * @type {Map<number, number>}
     */
    this._playerRelations = new Map();

    /**
     * Nation IDs the player has already condemned this in-game day.
     * Cleared in onDayPassed().
     * @type {Set<number>}
     */
    this._condemnedToday = new Set();

    this._build(mapData);
  }

  // -------------------------------------------------------------------------
  // Build (seed-deterministic)
  // -------------------------------------------------------------------------

  _build(mapData) {
    const { nations, castleSettlements } = this.nationSystem;
    const castles = mapData.castles;

    // NPC-NPC relations
    for (let i = 0; i < nations.length; i++) {
      for (let j = i + 1; j < nations.length; j++) {
        const val = this._calcBaseRelation(i, j, castleSettlements, castles);
        this._npcRelations.set(`${i}:${j}`, val);
      }
    }

    // Player ↔ NPC base relations
    nations.forEach((_, id) => {
      const val = this._calcPlayerBaseRelation(id, castleSettlements);
      this._playerRelations.set(id, val);
    });
  }

  _calcBaseRelation(idA, idB, settlements, castles) {
    const sA = settlements[idA];
    const sB = settlements[idB];
    if (!sA || !sB) return 0;

    // Distance factor: normalise to [0, 1]; closer → more tense
    const dx = (castles[idA]?.x ?? 0) - (castles[idB]?.x ?? 0);
    const dy = (castles[idA]?.y ?? 0) - (castles[idB]?.y ?? 0);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const distRatio = Math.min(dist / MAX_MAP_DIST, 1.0);
    // Closer nations are -25 … further are +5
    const distMod = Math.round(-25 + distRatio * 30);

    // Economy factor: both wealthy → slightly cooperative
    const avgEco = (sA.economyLevel + sB.economyLevel) / 2;
    const ecoMod = Math.round((avgEco - 3) * 4); // -8 … +8

    // Resource factor: overlapping resources → competition
    const shared = sA.resources.filter(r => sB.resources.includes(r)).length;
    const resMod = shared > 0 ? -10 * shared : 8;

    // Personality modifiers
    const pA = this._rulerPersonality(sA);
    const pB = this._rulerPersonality(sB);
    let persM = 0;
    if (pA === PERSONALITY_ARROGANT) persM -= 15;
    if (pB === PERSONALITY_ARROGANT) persM -= 15;
    if (pA === PERSONALITY_WARLIKE)  persM -= 10;
    if (pB === PERSONALITY_WARLIKE)  persM -= 10;
    if (pA === PERSONALITY_GENTLE)   persM += 10;
    if (pB === PERSONALITY_GENTLE)   persM += 10;

    return Math.max(-100, Math.min(100, distMod + ecoMod + resMod + persM));
  }

  _calcPlayerBaseRelation(nationId, settlements) {
    const s = settlements[nationId];
    if (!s) return 0;

    let base = 10; // slight default goodwill toward the player

    const p = this._rulerPersonality(s);
    if (p === PERSONALITY_GENTLE)   base += 15;
    if (p === PERSONALITY_CAUTIOUS) base += 5;
    if (p === PERSONALITY_ARROGANT) base -= 20;
    if (p === PERSONALITY_WARLIKE)  base -= 10;

    // Wealthier nations have more to gain from positive relations
    base += (s.economyLevel - 3) * 3; // -6 … +6

    return Math.max(-100, Math.min(100, base));
  }

  /** Extract the personality trait from a settlement's ruler. */
  _rulerPersonality(settlement) {
    if (!settlement?.ruler) return PERSONALITY_CAUTIOUS;
    return settlement.ruler.traits.find(t => ALL_PERSONALITIES.includes(t)) ?? PERSONALITY_CAUTIOUS;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Relation between two NPC nations.
   * @param {number} idA
   * @param {number} idB
   * @returns {number}
   */
  getRelation(idA, idB) {
    if (idA === idB) return 100;
    const key = idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
    return this._npcRelations.get(key) ?? 0;
  }

  /**
   * Player's relation with a nation.
   * @param {number} nationId
   * @returns {number}
   */
  getPlayerRelation(nationId) {
    return this._playerRelations.get(nationId) ?? 0;
  }

  /**
   * Shift the player's relation with a nation (clamped to ±100).
   * @param {number} nationId
   * @param {number} delta
   */
  modifyPlayerRelation(nationId, delta) {
    const cur = this.getPlayerRelation(nationId);
    this._playerRelations.set(nationId, Math.max(-100, Math.min(100, cur + delta)));
  }

  /**
   * Player issues a condemnation against a nation.
   * Limited to once per in-game day per nation.
   *
   * @param {number} nationId
   * @returns {{ success: boolean, delta: number, alreadyDone: boolean }}
   */
  condemn(nationId) {
    if (this._condemnedToday.has(nationId)) {
      return { success: false, delta: 0, alreadyDone: true };
    }
    const delta = -(15 + Math.floor(Math.random() * 11)); // -15 … -25
    this.modifyPlayerRelation(nationId, delta);
    this._condemnedToday.add(nationId);
    return { success: true, delta, alreadyDone: false };
  }

  /** Call once per in-game day to reset daily limits and process NPC events. */
  onDayPassed() {
    this._condemnedToday.clear();
    return this._processNpcDailyEvents();
  }

  /**
   * NPC rulers with certain personalities may spontaneously change their
   * relation to the player each day.
   * @returns {{ nationId: number, delta: number, message: string }[]}
   */
  _processNpcDailyEvents() {
    const events = [];
    const settlements = this.nationSystem.castleSettlements;

    settlements.forEach((s, id) => {
      const p = this._rulerPersonality(s);
      const roll = Math.random();

      if (p === PERSONALITY_ARROGANT && roll < 0.3) {
        // Arrogant ruler condemns the player
        const delta = -(Math.floor(Math.random() * 10) + 8); // -8 … -17
        this.modifyPlayerRelation(id, delta);
        events.push({
          nationId: id,
          delta,
          message: `${s.ruler.name}（${s.ruler.role}）傲慢地譴責了你的行為，與 ${s.name} 的關係惡化 ${delta}。`,
        });
      } else if (p === PERSONALITY_WARLIKE && roll < 0.2) {
        // Warlike ruler threatens the player
        const delta = -(Math.floor(Math.random() * 8) + 5); // -5 … -12
        this.modifyPlayerRelation(id, delta);
        events.push({
          nationId: id,
          delta,
          message: `${s.ruler.name}（${s.ruler.role}）對你發出戰爭威脅，與 ${s.name} 的關係惡化 ${delta}。`,
        });
      } else if (p === PERSONALITY_GENTLE && roll < 0.15) {
        // Gentle ruler sends goodwill
        const delta = Math.floor(Math.random() * 6) + 3; // +3 … +8
        this.modifyPlayerRelation(id, delta);
        events.push({
          nationId: id,
          delta,
          message: `${s.ruler.name}（${s.ruler.role}）主動釋出善意，與 ${s.name} 的關係改善 +${delta}。`,
        });
      }
    });

    return events;
  }

  /**
   * Returns true when the player has already condemned this nation today.
   * @param {number} nationId
   * @returns {boolean}
   */
  hasCondemnedToday(nationId) {
    return this._condemnedToday.has(nationId);
  }

  /**
   * Classify a relation value into a labelled tier.
   * @param {number} value
   * @returns {{ label: string, color: string, icon: string }}
   */
  getRelationLevel(value) {
    return RELATION_LEVELS.find(l => value >= l.min) ?? RELATION_LEVELS[RELATION_LEVELS.length - 1];
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /** @returns {{ playerRelations: [number, number][] }} */
  getState() {
    return {
      playerRelations: [...this._playerRelations.entries()],
    };
  }

  /**
   * Restore from a saved snapshot.
   * @param {{ playerRelations?: [number, number][] }|null} state
   */
  loadState(state) {
    if (!state) return;
    if (Array.isArray(state.playerRelations)) {
      state.playerRelations.forEach(([id, value]) => {
        this._playerRelations.set(Number(id), Math.max(-100, Math.min(100, Number(value))));
      });
    }
  }
}
