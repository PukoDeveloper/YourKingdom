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

    /**
     * Per-nation memory log of recent events that affected their relations.
     * Key: nationId; Value: array of { desc, delta, day }.
     * @type {Map<number, Array<{desc: string, delta: number, day: number}>>}
     */
    this._nationMemory = new Map();

    /**
     * Current in-game day counter (incremented in onDayPassed).
     * @type {number}
     */
    this._currentDay = 0;

    /**
     * Sovereignty map – internal only, not shown to the player.
     * Each nation records the settlement keys it claims as its own territory.
     * Key: nationId; Value: Set of settlement keys ("castle:0", "village:3").
     * Only changes when a treaty is signed.
     * @type {Map<number, Set<string>>}
     */
    this._sovereigntyMap = new Map();

    this._build(mapData);
    this._initSovereignty();
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
   * Shift a NPC-NPC relation between two nations (clamped to ±100).
   * @param {number} idA
   * @param {number} idB
   * @param {number} delta
   */
  modifyNpcRelation(idA, idB, delta) {
    if (idA === idB) return;
    const key = idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
    const cur = this._npcRelations.get(key) ?? 0;
    this._npcRelations.set(key, Math.max(-100, Math.min(100, cur + delta)));
  }

  /**
   * Add an event entry to a nation's memory log (keeps the latest 10).
   * @param {number} nationId
   * @param {string} desc   Human-readable description of the event.
   * @param {number} delta  Relation change caused by this event.
   */
  _addMemoryEntry(nationId, desc, delta) {
    if (!this._nationMemory.has(nationId)) {
      this._nationMemory.set(nationId, []);
    }
    const log = this._nationMemory.get(nationId);
    log.push({ desc, delta, day: this._currentDay });
    if (log.length > 10) log.splice(0, log.length - 10);
  }

  /**
   * Return the memory log for a nation (most recent last).
   * @param {number} nationId
   * @returns {Array<{desc: string, delta: number, day: number}>}
   */
  getNationMemory(nationId) {
    return this._nationMemory.get(nationId) ?? [];
  }

  /**
   * Record an attack event and propagate relation changes to all nations.
   *
   * Direct effect   – attacker ↔ target relation decreases significantly.
   * Allied ripple   – nations allied with the target (relation ≥ 60) grow hostile to the attacker.
   * Enemy ripple    – nations hostile toward the target (relation ≤ -60) warm up to the attacker.
   *
   * @param {object} opts
   * @param {number}  opts.attackerNationId     Attacker's nation id; use -1 for the player.
   * @param {number}  opts.targetNationId       Target nation id.
   * @param {string}  opts.settlementName       Name of the attacked settlement.
   * @param {string}  opts.attackerDisplayName  Human-readable name of the attacker.
   * @param {boolean} [opts.victory=false]      Whether the attack was a victory.
   */
  recordAttackEvent({ attackerNationId, targetNationId, settlementName, attackerDisplayName, victory = false }) {
    const nations = this.nationSystem.nations;
    const targetNation = nations[targetNationId];
    if (!targetNation) return;

    // Direct relation delta for the attacked nation
    const directDelta = victory
      ? -(30 + Math.floor(Math.random() * 20)) // -30 … -49
      : -(10 + Math.floor(Math.random() * 10)); // -10 … -19

    if (attackerNationId === -1) {
      this.modifyPlayerRelation(targetNationId, directDelta);
    } else {
      this.modifyNpcRelation(attackerNationId, targetNationId, directDelta);
    }

    // Target records the event in its memory
    const sign = directDelta >= 0 ? `+${directDelta}` : `${directDelta}`;
    this._addMemoryEntry(
      targetNationId,
      `${attackerDisplayName} 攻打了我國的 ${settlementName}，關係 ${sign}`,
      directDelta,
    );

    // Propagate to third-party nations
    nations.forEach((cNation, cId) => {
      if (!cNation) return;
      if (cId === targetNationId) return;
      if (attackerNationId !== -1 && cId === attackerNationId) return;

      const cToTarget = this.getRelation(cId, targetNationId);
      let thirdDelta = 0;
      let memDesc = '';

      if (cToTarget >= 60) {
        // C is allied with the target → C dislikes the attacker
        thirdDelta = -(5 + Math.floor(Math.random() * 10)); // -5 … -14
        const thirdSign = `${thirdDelta}`;
        memDesc = `${attackerDisplayName} 攻打了我們的盟友 ${targetNation.name}（${settlementName}），關係 ${thirdSign}`;
      } else if (cToTarget <= -60) {
        // C is enemy of the target → C likes the attacker
        thirdDelta = 5 + Math.floor(Math.random() * 10); // +5 … +14
        memDesc = `${attackerDisplayName} 攻打了我們的敵人 ${targetNation.name}（${settlementName}），關係 +${thirdDelta}`;
      }

      if (thirdDelta !== 0) {
        if (attackerNationId === -1) {
          this.modifyPlayerRelation(cId, thirdDelta);
        } else {
          this.modifyNpcRelation(attackerNationId, cId, thirdDelta);
        }
        this._addMemoryEntry(cId, memDesc, thirdDelta);
      }
    });
  }

  /**
   * Initialise the sovereignty map from the current NationSystem state.
   * Each nation initially claims all settlements assigned to it.
   * This is called once in the constructor and does not need to be persisted
   * because it is deterministic from the world seed.
   */
  _initSovereignty() {
    const { nations, castleSettlements, villageSettlements } = this.nationSystem;
    nations.forEach((_, id) => {
      this._sovereigntyMap.set(id, new Set());
    });
    castleSettlements.forEach((s, idx) => {
      const set = this._sovereigntyMap.get(s.nationId);
      if (set) set.add(`castle:${idx}`);
    });
    villageSettlements.forEach((s, idx) => {
      const set = this._sovereigntyMap.get(s.nationId);
      if (set) set.add(`village:${idx}`);
    });
  }

  /**
   * Return the settlement keys this nation claims sovereignty over.
   * @param {number} nationId
   * @returns {string[]}
   */
  getSovereigntyList(nationId) {
    return [...(this._sovereigntyMap.get(nationId) ?? [])];
  }

  /**
   * Transfer sovereignty of a settlement from one nation to another
   * (call this when a treaty formally cedes territory).
   * @param {string} settlementKey   e.g. "castle:0" or "village:3"
   * @param {number} fromNationId
   * @param {number} toNationId
   */
  transferSovereignty(settlementKey, fromNationId, toNationId) {
    this._sovereigntyMap.get(fromNationId)?.delete(settlementKey);
    if (!this._sovereigntyMap.has(toNationId)) {
      this._sovereigntyMap.set(toNationId, new Set());
    }
    this._sovereigntyMap.get(toNationId).add(settlementKey);
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
    this._addMemoryEntry(nationId, `玩家公開譴責了我國，關係 ${delta}`, delta);
    this._condemnedToday.add(nationId);
    return { success: true, delta, alreadyDone: false };
  }

  /** Call once per in-game day to reset daily limits and process NPC events. */
  onDayPassed() {
    this._currentDay++;
    this._condemnedToday.clear();
    return this._processNpcDailyEvents();
  }

  /**
   * NPC rulers with certain personalities may spontaneously change their
   * relation to the player each day.
   * Warlike / arrogant nations may also launch attacks against hostile neighbours.
   * @returns {{ nationId: number, delta: number, message: string }[]}
   */
  _processNpcDailyEvents() {
    const events = [];
    const settlements = this.nationSystem.castleSettlements;
    const nations     = this.nationSystem.nations;

    settlements.forEach((s, id) => {
      const p          = this._rulerPersonality(s);
      const roll       = Math.random();
      const nationName = nations[id]?.name ?? s.name;

      if (p === PERSONALITY_ARROGANT && roll < 0.3) {
        // Arrogant ruler condemns the player
        const delta = -(Math.floor(Math.random() * 10) + 8); // -8 … -17
        this.modifyPlayerRelation(id, delta);
        this._addMemoryEntry(id, `我方統治者傲慢地對玩家發出譴責，關係 ${delta}`, delta);
        events.push({
          nationId: id,
          delta,
          message: `${s.ruler.name}（${s.ruler.role}）傲慢地譴責了你的行為，與 ${nationName} 的關係惡化 ${delta}。`,
        });
      } else if (p === PERSONALITY_WARLIKE && roll < 0.2) {
        // Warlike ruler threatens the player
        const delta = -(Math.floor(Math.random() * 8) + 5); // -5 … -12
        this.modifyPlayerRelation(id, delta);
        this._addMemoryEntry(id, `我方統治者向玩家發出戰爭威脅，關係 ${delta}`, delta);
        events.push({
          nationId: id,
          delta,
          message: `${s.ruler.name}（${s.ruler.role}）對你發出戰爭威脅，與 ${nationName} 的關係惡化 ${delta}。`,
        });
      } else if (p === PERSONALITY_GENTLE && roll < 0.15) {
        // Gentle ruler sends goodwill
        const delta = Math.floor(Math.random() * 6) + 3; // +3 … +8
        this.modifyPlayerRelation(id, delta);
        this._addMemoryEntry(id, `我方統治者主動向玩家釋出善意，關係 +${delta}`, delta);
        events.push({
          nationId: id,
          delta,
          message: `${s.ruler.name}（${s.ruler.role}）主動釋出善意，與 ${nationName} 的關係改善 +${delta}。`,
        });
      }

      // Warlike / arrogant nations may launch NPC-NPC attacks
      const attackRoll = Math.random();
      const willAttack = (p === PERSONALITY_WARLIKE  && attackRoll < 0.10) ||
                         (p === PERSONALITY_ARROGANT && attackRoll < 0.05);
      if (willAttack) {
        // Find the most hostile neighbour
        let worstRel = -20; // Only attack clearly hostile nations
        let targetId = -1;
        nations.forEach((tNation, tid) => {
          if (!tNation) return;
          if (tid === id) return;
          const rel = this.getRelation(id, tid);
          if (rel < worstRel) { worstRel = rel; targetId = tid; }
        });

        if (targetId >= 0) {
          const targetSettlement = this.nationSystem.castleSettlements[targetId];
          const settlementName   = targetSettlement?.name ?? nations[targetId]?.name ?? '未知';
          const victory          = Math.random() < 0.5;
          this.recordAttackEvent({
            attackerNationId:    id,
            targetNationId:      targetId,
            settlementName,
            attackerDisplayName: nationName,
            victory,
          });
          events.push({
            nationId: id,
            delta:    0,
            message:  `${s.ruler.name}（${s.ruler.role}）率兵進攻 ${nations[targetId]?.name ?? '鄰國'} 的 ${settlementName}！`,
          });
        }
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

  /** @returns {{ playerRelations: [number, number][], npcRelations: [string, number][], nationMemory: [number, object[]][], currentDay: number }} */
  getState() {
    return {
      playerRelations: [...this._playerRelations.entries()],
      npcRelations:    [...this._npcRelations.entries()],
      nationMemory:    [...this._nationMemory.entries()],
      currentDay:      this._currentDay,
    };
  }

  /**
   * Restore from a saved snapshot.
   * @param {{ playerRelations?: [number, number][], npcRelations?: [string, number][], nationMemory?: [number, object[]][], currentDay?: number }|null} state
   */
  loadState(state) {
    if (!state) return;
    if (Array.isArray(state.playerRelations)) {
      state.playerRelations.forEach(([id, value]) => {
        this._playerRelations.set(Number(id), Math.max(-100, Math.min(100, Number(value))));
      });
    }
    if (Array.isArray(state.npcRelations)) {
      state.npcRelations.forEach(([key, value]) => {
        if (typeof key === 'string' && /^\d+:\d+$/.test(key)) {
          this._npcRelations.set(key, Math.max(-100, Math.min(100, Number(value))));
        }
      });
    }
    if (Array.isArray(state.nationMemory)) {
      state.nationMemory.forEach(([id, entries]) => {
        if (Array.isArray(entries)) {
          this._nationMemory.set(Number(id), entries);
        }
      });
    }
    if (typeof state.currentDay === 'number') {
      this._currentDay = state.currentDay;
    }
  }
}
