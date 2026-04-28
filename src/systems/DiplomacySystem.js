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
import { BuildingSystem, BLDG_TAVERN } from './BuildingSystem.js';

// ---------------------------------------------------------------------------
// NPC AI constants
// ---------------------------------------------------------------------------

/** Maximum number of armies (squads) a castle settlement can garrison. */
export const NPC_CASTLE_MAX_ARMIES = 2;
/** Maximum number of armies (squads) a village settlement can garrison. */
export const NPC_VILLAGE_MAX_ARMIES = 1;
/** Maximum units per NPC squad. */
export const NPC_SQUAD_MAX_MEMBERS = 10;

/** Minimum weakness score (0-100) required to consider attacking, by personality. */
const WAR_THRESHOLD = {
  '好戰': 20,
  '傲慢': 35,
  '狡猾': 55,
  '謹慎': 70,
  '溫和': 90,
};

/** Gold earned per day per economy level for each controlled settlement type. */
const TAX_PER_ECON_CASTLE  = 15;
const TAX_PER_ECON_VILLAGE = 5;

/** NPC gold cap. */
const NPC_GOLD_CAP = 3000;

/** Probability that the attacker wins an NPC-initiated war action. */
const NPC_WAR_VICTORY_CHANCE = 0.45;

/** Number of garrison units removed from the defeated settlement per NPC war victory. */
const NPC_WAR_CASUALTY_COUNT = 2;

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
     * Castle positions indexed by nation id, used for distance calculations.
     * Index i corresponds to nation id i (mirrors the NationSystem convention
     * where castles[i] is always assigned to nation id i during world generation).
     * @type {{ x: number, y: number }[]}
     */
    this._castlePositions = (mapData.castles ?? []).map(c => ({ x: c.x, y: c.y }));

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

    /**
     * Surrender index per nation (0 – 100).
     * A higher value indicates a nation is more likely to consider surrendering.
     * Factors: enemy combined strength, occupied home territories, ruler traits, ally count.
     * @type {Map<number, number>}
     */
    this._surrenderIndex = new Map();

    /**
     * NPC gold treasury per nation.
     * Key: nationId; Value: gold amount.
     * @type {Map<number, number>}
     */
    this._npcGold = new Map();

    /**
     * NPC garrison armies per settlement.
     * Key: settlement key ("castle:0", "village:3").
     * Value: array of squads; each squad is an array of plain unit objects.
     * Castle supports up to NPC_CASTLE_MAX_ARMIES squads, village up to NPC_VILLAGE_MAX_ARMIES.
     * Each plain unit: { name, role, traits, stats: { attack, defense, morale, hp, maxHp } }
     * @type {Map<string, Array<Array<{name:string,role:string,traits:string[],stats:object}>>>}
     */
    this._npcArmies = new Map();

    this._build(mapData);
    this._initSovereignty();
    this._initNpcState();
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

  /**
   * Distance-based multiplier for relation-change ripple effects.
   * Nations farther from the conflict zone are less affected.
   *
   * @param {number} observerNationId  The third-party nation observing the conflict.
   * @param {number} conflictNationId  The nation at the centre of the conflict (typically the target).
   * @returns {number}  A value in [0.2, 1.0]; 1.0 = adjacent, 0.2 = opposite end of the map.
   */
  _distanceFactor(observerNationId, conflictNationId) {
    const posO = this._castlePositions[observerNationId];
    const posC = this._castlePositions[conflictNationId];
    if (!posO || !posC) return 1.0;
    const dx   = posO.x - posC.x;
    const dy   = posO.y - posC.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Linearly interpolate: dist 0 → factor 1.0, dist MAX → factor 0.2
    const factor = 1.0 - (dist / MAX_MAP_DIST) * 0.8;
    return Math.max(0.2, Math.min(1.0, factor));
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
        const baseDelta = -(5 + Math.floor(Math.random() * 10)); // -5 … -14
        const distFactor = this._distanceFactor(cId, targetNationId);
        thirdDelta = Math.round(baseDelta * distFactor);
        const thirdSign = `${thirdDelta}`;
        memDesc = `${attackerDisplayName} 攻打了我們的盟友 ${targetNation.name}（${settlementName}），關係 ${thirdSign}`;
      } else if (cToTarget <= -60) {
        // C is enemy of the target → C likes the attacker
        const baseDelta = 5 + Math.floor(Math.random() * 10); // +5 … +14
        const distFactor = this._distanceFactor(cId, targetNationId);
        thirdDelta = Math.round(baseDelta * distFactor);
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
   * Initialise NPC gold and garrison armies.
   * Called once after world generation; safe to call again (idempotent – only
   * fills entries that are not yet present so loadState() data is preserved).
   */
  _initNpcState() {
    const { nations, castleSettlements, villageSettlements } = this.nationSystem;

    // Gold: each nation starts with economy-weighted treasury.
    nations.forEach((_, id) => {
      if (!this._npcGold.has(id)) {
        const eco = castleSettlements[id]?.economyLevel ?? 3;
        this._npcGold.set(id, eco * 80);
      }
    });

    // Garrison armies for each castle (2 squads max).
    castleSettlements.forEach((s, idx) => {
      const key = `castle:${idx}`;
      if (!this._npcArmies.has(key)) {
        this._npcArmies.set(key, this._generateInitialGarrison('castle', s, idx));
      }
    });

    // Garrison armies for each village (1 squad max).
    villageSettlements.forEach((s, idx) => {
      const key = `village:${idx}`;
      if (!this._npcArmies.has(key)) {
        this._npcArmies.set(key, this._generateInitialGarrison('village', s, idx));
      }
    });
  }

  /**
   * Generate the initial garrison squads for a settlement deterministically.
   * @param {'castle'|'village'} type
   * @param {import('./NationSystem.js').Settlement} settlement
   * @param {number} idx  Settlement index (used as part of the hash seed).
   * @returns {Array<Array<object>>}  Array of squads (each squad = array of unit objects).
   */
  _generateInitialGarrison(type, settlement, idx) {
    const isCastle  = type === 'castle';
    const maxSquads = isCastle ? NPC_CASTLE_MAX_ARMIES : NPC_VILLAGE_MAX_ARMIES;
    const eco       = settlement.economyLevel;
    // Number of initial units per squad: 1 for eco 1 → 7 for eco 5 (roughly eco * 1.5)
    const unitsPerSquad = Math.floor(eco * 1.5);
    const squads = [];

    const ROLES  = ['劍士', '弓手', '長槍兵', '騎兵', '斥候'];
    const TRAITS = [['重步兵'], ['神射手'], [], [], ['輕步兵']];
    const SURNAMES = ['趙', '錢', '孫', '李', '周', '吳', '鄭', '王', '馮', '陳'];
    const GIVEN    = ['文', '武', '德', '仁', '義', '禮', '智', '信', '忠', '勇'];

    for (let sq = 0; sq < maxSquads; sq++) {
      const squad = [];
      for (let u = 0; u < unitsPerSquad; u++) {
        const seed = (idx * 37 + sq * 13 + u * 7 + settlement.population) % 10000;
        const roleIdx    = seed % ROLES.length;
        const surnameIdx = (seed * 3 + sq) % SURNAMES.length;
        const givenIdx   = (seed * 7 + u)  % GIVEN.length;
        const atk = 4 + Math.floor(eco * 1.2) + (seed % 4);
        const def = 3 + Math.floor(eco * 1.0) + ((seed * 2) % 4);
        const mor = 45 + eco * 5 + (seed % 15);
        const maxHp = 50 + def * 5;
        squad.push({
          name:   SURNAMES[surnameIdx] + GIVEN[givenIdx],
          role:   ROLES[roleIdx],
          traits: [...TRAITS[roleIdx]],
          stats:  { attack: atk, defense: def, morale: mor, hp: maxHp, maxHp },
        });
      }
      squads.push(squad);
    }
    return squads;
  }

  /**
   * Compute the settlement hash coordinates used for tavern roster keys.
   * Mirrors the formula in GameUI._settlementHashCoords so NPC and player
   * share the same key-space.
   * @param {'castle'|'village'} type
   * @param {number} idx
   * @returns {{ sx: number, sy: number }}
   */
  _settlementHashCoords(type, idx) {
    if (type === 'castle') {
      return { sx: idx * 137, sy: idx * 251 };
    }
    return { sx: idx * 173 + 5000, sy: idx * 293 + 5000 };
  }

  // -------------------------------------------------------------------------
  // NPC AI – phase-based actions
  // -------------------------------------------------------------------------

  /**
   * Dispatch phase-based NPC AI.
   * Called by GameUI.onPhaseChanged() when a day/night phase transition occurs.
   *
   * @param {'清晨'|'白天'|'黃昏'|'夜晚'} phase
   * @param {Map<string, {lastVisitDay: number, recruitedIndices: number[]}>} tavernState
   *   The shared tavern state map from GameUI (mutated in-place for competition).
   * @returns {{ message: string }[]}  Player-visible notification messages.
   */
  onPhaseChanged(phase, tavernState) {
    const messages = [];
    if (phase === '清晨') {
      this._npcTaxPhase(messages);
    } else if (phase === '白天') {
      this._npcWarPhase(messages);
    } else if (phase === '黃昏') {
      this._npcRecruitPhase(tavernState, messages);
    }
    return messages;
  }

  /**
   * Morning phase: NPC nations collect taxes from their controlled settlements.
   * @param {{ message: string }[]} messages
   */
  _npcTaxPhase(messages) {
    const { nations, castleSettlements, villageSettlements } = this.nationSystem;

    nations.forEach((nation, id) => {
      if (!nation) return;
      let income = 0;

      castleSettlements.forEach(s => {
        if (s.controllingNationId === id) {
          income += s.economyLevel * TAX_PER_ECON_CASTLE;
        }
      });
      villageSettlements.forEach(s => {
        if (s.controllingNationId === id) {
          income += s.economyLevel * TAX_PER_ECON_VILLAGE;
        }
      });

      if (income > 0) {
        const cur = this._npcGold.get(id) ?? 0;
        this._npcGold.set(id, Math.min(NPC_GOLD_CAP, cur + income));
      }
    });
  }

  /**
   * Daytime phase: NPC nations assess enemies and may declare war.
   * @param {{ message: string }[]} messages
   */
  _npcWarPhase(messages) {
    const { nations, castleSettlements } = this.nationSystem;

    castleSettlements.forEach((s, id) => {
      if (!s || s.controllingNationId !== id) return; // skip if conquered

      const personality = this._rulerPersonality(s);
      const threshold   = WAR_THRESHOLD[personality] ?? 55;

      // Find the weakest hostile neighbour (relation ≤ -20).
      let bestTargetId  = -1;
      let bestWeakness  = threshold; // must beat the threshold to attack

      nations.forEach((_, tid) => {
        if (tid === id) return;
        const rel = this.getRelation(id, tid);
        if (rel > -20) return; // not hostile enough

        const weakness = this._assessEnemyWeakness(id, tid);
        if (weakness > bestWeakness) {
          bestWeakness  = weakness;
          bestTargetId  = tid;
        }
      });

      if (bestTargetId < 0) return;

      const targetSettlement = castleSettlements[bestTargetId];
      if (!targetSettlement) return;

      const victory = Math.random() < NPC_WAR_VICTORY_CHANCE;
      const attackerName = nations[id]?.name ?? s.name;
      this.recordAttackEvent({
        attackerNationId:    id,
        targetNationId:      bestTargetId,
        settlementName:      targetSettlement.name,
        attackerDisplayName: attackerName,
        victory,
      });

      // If victorious, reduce the defender's garrison.
      if (victory) {
        const defKey    = `castle:${bestTargetId}`;
        const defArmies = this._npcArmies.get(defKey);
        if (defArmies) {
          // Remove up to NPC_WAR_CASUALTY_COUNT units from the last occupied squad.
          for (let sq = defArmies.length - 1; sq >= 0; sq--) {
            const losses = Math.min(NPC_WAR_CASUALTY_COUNT, defArmies[sq].length);
            defArmies[sq].splice(defArmies[sq].length - losses, losses);
            if (losses > 0) break;
          }
        }
      }

      messages.push({
        message: `⚔ ${attackerName} 進攻了 ${nations[bestTargetId]?.name ?? '鄰國'} 的 ${targetSettlement.name}！${victory ? '（勝利）' : '（失敗）'}`,
      });
    });
  }

  /**
   * Dusk phase: NPC nations recruit from taverns in their settlements.
   * Uses the shared tavernState so NPCs compete with the player.
   * @param {Map<string, {lastVisitDay: number, recruitedIndices: number[]}>} tavernState
   * @param {{ message: string }[]} messages
   */
  _npcRecruitPhase(tavernState, messages) {
    if (!tavernState) return;

    const { nations, castleSettlements, villageSettlements } = this.nationSystem;
    const day = this._currentDay;

    const tryRecruit = (s, settlementType, idx) => {
      const nationId = s.controllingNationId;
      if (nationId < 0) return; // player-owned

      // Check if this settlement has a tavern.
      const hasTavern = s.buildings?.some(b => b.type === BLDG_TAVERN);
      if (!hasTavern) return;

      const armyKey   = `${settlementType}:${idx}`;
      const armies    = this._npcArmies.get(armyKey);
      if (!armies) return;

      const maxSquads = settlementType === 'castle' ? NPC_CASTLE_MAX_ARMIES : NPC_VILLAGE_MAX_ARMIES;

      // Count current total garrison size.
      const totalUnits = armies.reduce((sum, sq) => sum + sq.length, 0);
      const capacity   = maxSquads * NPC_SQUAD_MAX_MEMBERS;
      if (totalUnits >= capacity) return; // garrison is full

      // Get or initialise tavern state.
      const { sx, sy } = this._settlementHashCoords(settlementType, idx);
      const tKey = `${sx}_${sy}`;
      let tState = tavernState.get(tKey);
      if (!tState || day - tState.lastVisitDay >= 5) {
        tState = { lastVisitDay: day, recruitedIndices: [] };
        tavernState.set(tKey, tState);
      }

      const recruits = BuildingSystem.generateRecruits(sx, sy, 0, tState.lastVisitDay);

      for (let i = 0; i < recruits.length; i++) {
        if (tState.recruitedIndices.includes(i)) continue; // already taken
        const r = recruits[i];
        // Re-fetch gold on each iteration so multiple purchases within one
        // phase correctly deduct from the running total.
        const currentGold = this._npcGold.get(nationId) ?? 0;
        if (currentGold < r.hireCost) continue;

        // Check army capacity again (we may have just filled a slot above).
        const filledNow = armies.reduce((sum, sq) => sum + sq.length, 0);
        if (filledNow >= capacity) break;

        // Find the first squad with space.
        let targetSquad = armies.find(sq => sq.length < NPC_SQUAD_MAX_MEMBERS);
        if (!targetSquad) {
          if (armies.length < maxSquads) {
            targetSquad = [];
            armies.push(targetSquad);
          } else {
            break;
          }
        }

        // Deduct gold and add recruit.
        this._npcGold.set(nationId, currentGold - r.hireCost);
        tState.recruitedIndices.push(i);
        targetSquad.push({
          name:   r.name,
          role:   r.role,
          traits: [...r.traits],
          stats:  {
            attack:  r.stats.attack,
            defense: r.stats.defense,
            morale:  r.stats.morale,
            hp:      50 + r.stats.defense * 5,
            maxHp:   50 + r.stats.defense * 5,
          },
        });

        const nationName = nations[nationId]?.name ?? '';
        messages.push({
          message:    `🍺 ${nationName} 在 ${s.name} 的酒館招募了 ${r.name}（${r.role}）`,
          settlementKey: armyKey,
        });
        break; // one recruit per settlement per dusk
      }
    };

    castleSettlements.forEach((s, idx) => tryRecruit(s, 'castle', idx));
    villageSettlements.forEach((s, idx) => tryRecruit(s, 'village', idx));
  }

  /**
   * Assess how "weak" a target nation currently is from an attacker's perspective.
   * Returns a score in [0, 100]: higher = weaker = easier target.
   *
   * Factors:
   *   - Economy weakness : (5 - avgEconomy) / 5 × 30
   *   - Territory losses : (lost / total) × 40
   *   - Army weakness    : max(0, 1 - armySize / 20) × 30
   *
   * @param {number} attackerId  Nation id of the attacker (unused for now but available for future asymmetry).
   * @param {number} targetId    Nation id of the target.
   * @returns {number}
   */
  _assessEnemyWeakness(attackerId, targetId) {
    const { castleSettlements, villageSettlements } = this.nationSystem;
    const allSettlements = [...castleSettlements, ...villageSettlements];

    const own   = allSettlements.filter(s => s.nationId === targetId);
    const total = own.length;
    if (total === 0) return 100; // extinct nation

    const lost   = own.filter(s => s.controllingNationId !== targetId).length;
    const lossRatio = lost / total;

    const avgEco = own.reduce((sum, s) => sum + s.economyLevel, 0) / total;
    const ecoWeakness = Math.max(0, (5 - avgEco) / 5 * 30);

    // Army size across all controlled settlements.
    const castleSet = new Set(castleSettlements);
    let armySize = 0;
    allSettlements.forEach(s => {
      if (s.controllingNationId !== targetId) return;
      const isCastle = castleSet.has(s);
      const sType = isCastle ? 'castle' : 'village';
      const sArr  = isCastle ? castleSettlements : villageSettlements;
      const sIdx  = sArr.indexOf(s);
      const key     = `${sType}:${sIdx}`;
      const armies  = this._npcArmies.get(key);
      if (armies) armySize += armies.reduce((sum, sq) => sum + sq.length, 0);
    });
    const armyWeakness = Math.max(0, (1 - armySize / 20) * 30);

    return Math.min(100, Math.round(ecoWeakness + lossRatio * 40 + armyWeakness));
  }

  /**
   * Return the current NPC gold for a nation.
   * @param {number} nationId
   * @returns {number}
   */
  getNpcGold(nationId) {
    return this._npcGold.get(nationId) ?? 0;
  }

  /**
   * Return the garrison armies for a settlement.
   * @param {string} settlementKey  e.g. "castle:0" or "village:3"
   * @returns {Array<Array<object>>}
   */
  getNpcArmies(settlementKey) {
    return this._npcArmies.get(settlementKey) ?? [];
  }

  /**
   * Reduce a settlement's garrison by removing wounded/killed units after a battle.
   * @param {string} settlementKey
   * @param {number} losses  Number of units to remove.
   */
  applyGarrisonLosses(settlementKey, losses) {
    const armies = this._npcArmies.get(settlementKey);
    if (!armies || losses <= 0) return;
    let remaining = losses;
    for (let sq = armies.length - 1; sq >= 0 && remaining > 0; sq--) {
      const remove = Math.min(remaining, armies[sq].length);
      armies[sq].splice(armies[sq].length - remove, remove);
      remaining -= remove;
    }
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

  // -------------------------------------------------------------------------
  // Surrender index
  // -------------------------------------------------------------------------

  /**
   * Compute and store the surrender index for a nation currently at war.
   * The index (0 – 100) reflects how close the nation is to considering surrender.
   * A higher value indicates greater pressure to capitulate.
   *
   * Factors (not yet used for AI decisions):
   *   - Enemy combined strength  : sum of settlements held by all hostile nations (relation ≤ -60)
   *   - Occupied home territory  : proportion of own settlements already lost
   *   - Ruler trait              : warlike / arrogant rulers resist; gentle / cautious rulers yield more easily
   *   - Ally support             : each allied nation (relation ≥ 60) reduces the index
   *
   * @param {number} nationId  Nation to evaluate (must be a valid NPC nation id).
   */
  updateSurrenderIndex(nationId) {
    const { nations, castleSettlements, villageSettlements } = this.nationSystem;
    if (nationId < 0 || nationId >= nations.length || !nations[nationId]) return;

    const allSettlements = [...castleSettlements, ...villageSettlements];

    // ── Occupied territory pressure (0 – 40) ──────────────────────────────
    const ownTotal = allSettlements.filter(s => s.nationId === nationId).length;
    const ownLost  = allSettlements.filter(
      s => s.nationId === nationId && s.controllingNationId !== nationId,
    ).length;
    const occupationRatio   = ownTotal > 0 ? ownLost / ownTotal : 0;
    const occupationPressure = Math.round(occupationRatio * 40);

    // ── Enemy combined strength (0 – 30) ──────────────────────────────────
    let enemySettlements = 0;
    nations.forEach((_, eid) => {
      if (eid === nationId) return;
      const rel = this.getRelation(nationId, eid);
      if (rel <= -60) {
        enemySettlements += allSettlements.filter(s => s.controllingNationId === eid).length;
      }
    });
    const maxExpectedEnemySettlements = Math.max(1, allSettlements.length / 2);
    const enemyPressure = Math.round(
      Math.min(enemySettlements / maxExpectedEnemySettlements, 1.0) * 30,
    );

    // ── Ruler trait modifier (-10 … +15) ──────────────────────────────────
    const p = this._rulerPersonality(castleSettlements[nationId]);
    let traitMod = 0;
    if (p === PERSONALITY_WARLIKE)  traitMod = -10;
    if (p === PERSONALITY_ARROGANT) traitMod = -5;
    if (p === PERSONALITY_CAUTIOUS) traitMod = 5;
    if (p === PERSONALITY_GENTLE)   traitMod = 15;

    // ── Ally support (-20 … 0) ────────────────────────────────────────────
    let allyCount = 0;
    nations.forEach((_, aid) => {
      if (aid === nationId) return;
      const rel = this.getRelation(nationId, aid);
      if (rel >= 60) allyCount++;
    });
    const allyReduction = Math.min(allyCount * 5, 20);

    const raw = occupationPressure + enemyPressure + traitMod - allyReduction;
    this._surrenderIndex.set(nationId, Math.max(0, Math.min(100, raw)));
  }

  /**
   * Return the current surrender index for a nation.
   * Returns 0 for unknown or player-owned nations.
   * @param {number} nationId
   * @returns {number}  Value in [0, 100].
   */
  getSurrenderIndex(nationId) {
    return this._surrenderIndex.get(nationId) ?? 0;
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
          message: `📢 ${s.ruler.name}（${s.ruler.role}）傲慢地譴責了你的行為，與 ${nationName} 的關係惡化 ${delta}。`,
        });
      } else if (p === PERSONALITY_WARLIKE && roll < 0.2) {
        // Warlike ruler threatens the player
        const delta = -(Math.floor(Math.random() * 8) + 5); // -5 … -12
        this.modifyPlayerRelation(id, delta);
        this._addMemoryEntry(id, `我方統治者向玩家發出戰爭威脅，關係 ${delta}`, delta);
        events.push({
          nationId: id,
          delta,
          message: `⚠ ${s.ruler.name}（${s.ruler.role}）對你發出戰爭威脅，與 ${nationName} 的關係惡化 ${delta}。`,
        });
      } else if (p === PERSONALITY_GENTLE && roll < 0.15) {
        // Gentle ruler sends goodwill
        const delta = Math.floor(Math.random() * 6) + 3; // +3 … +8
        this.modifyPlayerRelation(id, delta);
        this._addMemoryEntry(id, `我方統治者主動向玩家釋出善意，關係 +${delta}`, delta);
        events.push({
          nationId: id,
          delta,
          message: `🕊 ${s.ruler.name}（${s.ruler.role}）主動釋出善意，與 ${nationName} 的關係改善 +${delta}。`,
        });
      }

      // ── NPC-NPC diplomatic events ─────────────────────────────────────────
      // Each nation also interacts with other NPC nations based on personality.

      // Arrogant rulers publicly condemn hostile neighbours.
      if (p === PERSONALITY_ARROGANT && Math.random() < 0.18) {
        const targetId = this._findHostileNpc(id, -10);
        if (targetId >= 0) {
          const targetName = nations[targetId]?.name ?? '鄰國';
          const delta = -(Math.floor(Math.random() * 8) + 5); // -5 … -12
          this.modifyNpcRelation(id, targetId, delta);
          this._addMemoryEntry(id, `我方統治者公開譴責了 ${targetName}，關係 ${delta}`, delta);
          this._addMemoryEntry(targetId, `${nationName} 公開譴責了我國，關係 ${delta}`, delta);
          events.push({
            nationId: id,
            delta,
            message: `📢 ${nationName} 的 ${s.ruler.name} 公開譴責了 ${targetName}，兩國關係惡化 ${delta}。`,
          });
        }
      }

      // Warlike rulers issue threats to hostile neighbours.
      if (p === PERSONALITY_WARLIKE && Math.random() < 0.18) {
        const targetId = this._findHostileNpc(id, -10);
        if (targetId >= 0) {
          const targetName = nations[targetId]?.name ?? '鄰國';
          const delta = -(Math.floor(Math.random() * 7) + 4); // -4 … -10
          this.modifyNpcRelation(id, targetId, delta);
          this._addMemoryEntry(id, `我方統治者向 ${targetName} 發出戰爭威脅，關係 ${delta}`, delta);
          this._addMemoryEntry(targetId, `${nationName} 向我國發出戰爭威脅，關係 ${delta}`, delta);
          events.push({
            nationId: id,
            delta,
            message: `⚠ ${nationName} 的 ${s.ruler.name} 向 ${targetName} 發出戰爭威脅，兩國關係緊張 ${delta}。`,
          });
        }
      }

      // Cunning rulers issue subtle insults toward rivals.
      if (p === PERSONALITY_CUNNING && Math.random() < 0.12) {
        const targetId = this._findHostileNpc(id, -5);
        if (targetId >= 0) {
          const targetName = nations[targetId]?.name ?? '鄰國';
          const delta = -(Math.floor(Math.random() * 5) + 3); // -3 … -7
          this.modifyNpcRelation(id, targetId, delta);
          this._addMemoryEntry(id, `我方統治者暗中侮辱了 ${targetName}，關係 ${delta}`, delta);
          this._addMemoryEntry(targetId, `${nationName} 暗中侮辱了我國，關係 ${delta}`, delta);
          events.push({
            nationId: id,
            delta,
            message: `💬 ${nationName} 的 ${s.ruler.name} 暗中散播對 ${targetName} 的不利傳言，關係 ${delta}。`,
          });
        }
      }

      // Gentle rulers extend goodwill gestures toward neutral or friendly neighbours.
      if (p === PERSONALITY_GENTLE && Math.random() < 0.15) {
        const targetId = this._findFriendlyNpc(id, 0);
        if (targetId >= 0) {
          const targetName = nations[targetId]?.name ?? '鄰國';
          const delta = Math.floor(Math.random() * 5) + 3; // +3 … +7
          this.modifyNpcRelation(id, targetId, delta);
          this._addMemoryEntry(id, `我方統治者向 ${targetName} 釋出善意，關係 +${delta}`, delta);
          this._addMemoryEntry(targetId, `${nationName} 向我國釋出善意，關係 +${delta}`, delta);
          events.push({
            nationId: id,
            delta,
            message: `🕊 ${nationName} 的 ${s.ruler.name} 向 ${targetName} 遞出橄欖枝，兩國關係改善 +${delta}。`,
          });
        }
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
            message:  `⚔ ${s.ruler.name}（${s.ruler.role}）率兵進攻 ${nations[targetId]?.name ?? '鄰國'} 的 ${settlementName}！`,
          });
        }
      }
    });

    return events;
  }

  /**
   * Find an NPC nation that `id` has a relation with at or below `maxRel`
   * (the most hostile one).  Returns -1 if none found.
   * @param {number} id
   * @param {number} maxRel  Upper bound for hostility (e.g. -10 means "at least somewhat hostile").
   * @returns {number}
   */
  _findHostileNpc(id, maxRel) {
    const nations = this.nationSystem.nations;
    let worstRel = maxRel;
    let targetId = -1;
    nations.forEach((n, tid) => {
      if (!n) return;
      if (tid === id) return;
      const rel = this.getRelation(id, tid);
      if (rel <= worstRel) { worstRel = rel; targetId = tid; }
    });
    return targetId;
  }

  /**
   * Find an NPC nation that `id` has a relation with at or above `minRel`
   * (the friendliest one), excluding the same nation.  Returns -1 if none found.
   * @param {number} id
   * @param {number} minRel  Lower bound for friendliness (e.g. 0 = at least neutral).
   * @returns {number}
   */
  _findFriendlyNpc(id, minRel) {
    const nations = this.nationSystem.nations;
    let bestRel = minRel;
    let targetId = -1;
    nations.forEach((n, tid) => {
      if (!n) return;
      if (tid === id) return;
      const rel = this.getRelation(id, tid);
      if (rel >= bestRel) { bestRel = rel; targetId = tid; }
    });
    return targetId;
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

  /** @returns {{ playerRelations: [number, number][], npcRelations: [string, number][], nationMemory: [number, object[]][], currentDay: number, surrenderIndex: [number, number][], npcGold: [number, number][], npcArmies: [string, object[][][]][] }} */
  getState() {
    return {
      playerRelations: [...this._playerRelations.entries()],
      npcRelations:    [...this._npcRelations.entries()],
      nationMemory:    [...this._nationMemory.entries()],
      currentDay:      this._currentDay,
      surrenderIndex:  [...this._surrenderIndex.entries()],
      npcGold:         [...this._npcGold.entries()],
      npcArmies:       [...this._npcArmies.entries()],
    };
  }

  /**
   * Restore from a saved snapshot.
   * @param {{ playerRelations?: [number, number][], npcRelations?: [string, number][], nationMemory?: [number, object[]][], currentDay?: number, surrenderIndex?: [number, number][], npcGold?: [number, number][], npcArmies?: [string, object[][][]][] }|null} state
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
    if (Array.isArray(state.surrenderIndex)) {
      state.surrenderIndex.forEach(([id, value]) => {
        this._surrenderIndex.set(Number(id), Math.max(0, Math.min(100, Number(value))));
      });
    }
    if (Array.isArray(state.npcGold)) {
      state.npcGold.forEach(([id, value]) => {
        this._npcGold.set(Number(id), Math.max(0, Math.min(NPC_GOLD_CAP, Number(value))));
      });
    }
    if (Array.isArray(state.npcArmies)) {
      state.npcArmies.forEach(([key, squads]) => {
        if (typeof key === 'string' && Array.isArray(squads)) {
          this._npcArmies.set(key, squads.map(sq => (Array.isArray(sq) ? sq : [])));
        }
      });
    }
    // Re-run init to fill any keys missing from the save (e.g., from new settlements).
    this._initNpcState();
  }
}
