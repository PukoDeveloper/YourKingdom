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
 *
 * NPC AI decision tree (evaluated per nation each cycle, highest priority first):
 *   1. Crisis   – peace initiative / emergency recruit / seek ally
 *   2. Military – attack weakest hostile settlement
 *   3. Diplomatic – NAP/MPP proposals, trade-route requests, personality events
 *   4. Economic – build missing buildings when gold allows
 *
 * Heavy evaluation is offloaded to a Web Worker (npc-ai.worker.js) to keep the
 * main thread free.  The worker computes decisions asynchronously; the main
 * thread applies them on the next phase that matches each decision type.
 */

import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, TERRAIN } from '../world/constants.js';
import { Building, BuildingSystem, BLDG_TAVERN,
         BLDG_GENERAL, BLDG_BLACKSMITH, BLDG_MAGE, BLDG_INN } from './BuildingSystem.js';
import { buildPath } from '../world/NpcPathfinder.js';
import { getSpeedBonus, getUnitMoveSpeed } from './CharacterSystem.js';

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

/**
 * Gold deducted from a settlement's tax income for each garrisoned soldier.
 * Represents the economic burden of maintaining a standing army.
 * Exported so GameUI can apply the same penalty to player-collected taxes.
 */
export const GARRISON_TAX_PENALTY_PER_UNIT = 2;

/** NPC gold cap. */
const NPC_GOLD_CAP = 3000;

// ---------------------------------------------------------------------------
// NPC building construction
// ---------------------------------------------------------------------------

/** Gold cost for an NPC nation to construct each building type. */
const NPC_BUILD_COSTS = {
  [BLDG_INN]:        80,
  [BLDG_GENERAL]:   100,
  [BLDG_TAVERN]:    150,
  [BLDG_BLACKSMITH]: 200,
  [BLDG_MAGE]:      250,
};

/** Minimum gold required before a meticulous NPC considers building construction. */
const METICULOUS_BUILD_THRESHOLD = 80;

/** Minimum gold required before any NPC considers building construction. */
const DEFAULT_BUILD_THRESHOLD = 120;

/** Default build priority order (Tavern → General → Blacksmith → Inn → Mage). */
const DEFAULT_BUILD_ORDER = Object.freeze([BLDG_TAVERN, BLDG_GENERAL, BLDG_BLACKSMITH, BLDG_INN, BLDG_MAGE]);

// ---------------------------------------------------------------------------
// NPC trade routes
// ---------------------------------------------------------------------------

/** Daily gold income earned by each participant in an active NPC–player trade route. */
export const TRADE_ROUTE_DAILY_INCOME = 8;

/** Daily gold income for each nation in an NPC–NPC trade route. */
const NPC_NPC_TRADE_ROUTE_INCOME = 5;

/** World pixels per second for NPC army marches on open terrain. */
const NPC_MARCH_SPEED_PX = 240;

/** World pixels per second for peace messengers. */
const MISSIVE_SPEED_PX = 180;

/** Default messenger movement speed for missive dispatch. */
const DEFAULT_MESSENGER_MOVE_SPEED = 5;

/** Speed multiplier on FOREST tiles (mirrors Player.js FOREST_SPEED_MULT). */
const MARCH_FOREST_SPEED_MULT = 0.4;

/** Speed multiplier on HILL tiles (mirrors Player.js HILL_SPEED_MULT). */
const MARCH_HILL_SPEED_MULT = 0.65;

/**
 * Terrain-aware speed multiplier at a world-pixel position.
 * Mirrors the terrain rules the player follows (FOREST 0.4×, HILL 0.65×).
 * @param {import('../world/MapData.js').MapData} mapData
 * @param {number} wx  World-pixel X
 * @param {number} wy  World-pixel Y
 * @returns {number}
 */
function _marchSpeedMult(mapData, wx, wy) {
  const terrain = mapData.getTerrainAtWorld(wx, wy);
  if (terrain === TERRAIN.FOREST) return MARCH_FOREST_SPEED_MULT;
  if (terrain === TERRAIN.HILL)   return MARCH_HILL_SPEED_MULT;
  return 1.0;
}

/**
 * Win-rate threshold for a single squad: if the estimated win chance using only
 * the first squad falls below this value, the NPC will commit both squads.
 */
const NPC_SINGLE_SQUAD_WIN_THRESHOLD = 0.55;

/** Number of garrison units removed from the defending settlement on attacker victory. */
const NPC_WAR_CASUALTY_COUNT = 2;

/**
 * Period (in days) used to stagger phase-based NPC AI actions across nations.
 * Each nation evaluates war / recruit only once every this many days, offset by
 * its own id so that different nations act on different days.
 */
const NPC_ACTION_STAGGER_PERIOD = 2;

/** Proportion of NPC gold offered in a spontaneous peace missive. */
const NPC_PEACE_OFFER_GOLD_RATIO = 0.2;

/** Probability that two NPC nations accept each other's peace treaty. */
const NPC_NPC_PEACE_ACCEPT_CHANCE = 0.4;

/** Minimum relation value for NPC to be considered hostile enough to be a joint-war target. */
const JOINT_WAR_HOSTILITY_THRESHOLD = -30;

/**
 * Minimum / maximum NPC-NPC relation for a spontaneous NAP proposal.
 * Must be hostile enough to need reassurance but not yet at war.
 */
const NAP_PROPOSAL_REL_MIN = -50;
const NAP_PROPOSAL_REL_MAX =  20;

/** Minimum NPC-NPC relation for a spontaneous MPP proposal. */
const MPP_PROPOSAL_REL_MIN = 45;

/** Minimum player-relation threshold for an NPC to propose a trade route. */
const TRADE_ROUTE_MIN_RELATION = -10;

/**
 * Nation id of the player – mirrors PLAYER_NATION_ID from NationSystem.js.
 * Defined here to avoid a circular import.
 */
const _PLAYER_NATION_ID = -1;

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

/**
 * Return the Chinese label for the number of squads dispatched in a march.
 * @param {boolean} sendBoth
 * @returns {string}
 */
function _squadLabel(sendBoth) {
  return sendBoth ? '兩支部隊' : '一支部隊';
}

// ---------------------------------------------------------------------------
// March pixel-position helpers (module-level so updateMarches can use them)
// ---------------------------------------------------------------------------

/**
 * World-pixel centre of a castle (4×4 tiles).
 * @param {{ x: number, y: number }|undefined} castle  MapData castle entry
 * @returns {{ x: number, y: number }|null}
 */
function _marchCastlePx(castle) {
  if (!castle) return null;
  return { x: (castle.x + 2) * TILE_SIZE, y: (castle.y + 2) * TILE_SIZE };
}

/**
 * World-pixel centre of a village (2×2 tiles).
 * @param {{ x: number, y: number }|undefined} village  MapData village entry
 * @returns {{ x: number, y: number }|null}
 */
function _marchVillagePx(village) {
  if (!village) return null;
  return { x: (village.x + 1) * TILE_SIZE, y: (village.y + 1) * TILE_SIZE };
}

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
     * Map data reference – kept for pathfinding when armies are dispatched.
     * @type {import('../world/MapData.js').MapData}
     */
    this._mapData = mapData;

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

    /**
     * Active NPC army marches (armies moving toward a target settlement).
     * Each entry holds everything needed to advance, render, and resolve the march.
     * @type {Array<{
     *   id: number,
     *   attackerNationId: number,
     *   attackerCastleIdx: number,
     *   targetNationId: number,
     *   targetType: 'castle'|'village',
     *   targetIdx: number,
     *   sendBoth: boolean,
     *   victory: boolean,
     *   atkLoss: number,
     *   worldX: number,
     *   worldY: number,
     *   _path: { x: number, y: number }[],
     *   _pathSegIdx: number,
     *   _atkKey: string,
     *   _defKey: string,
     *   _attackerName: string,
     *   _targetSettlement: object
     * }>}
     */
    this._pendingMarches = [];

    /** Monotonically increasing id generator for marches. */
    this._marchNextId = 0;

    /**
     * Active war pairs. Key: "A:B" where A < B (player = -1).
     * @type {Set<string>}
     */
    this._warPairs = new Set();

    /**
     * Active non-aggression pacts. Key: "A:B" where A < B (player = -1).
     * Nations with an active NAP will not attack each other.
     * @type {Set<string>}
     */
    this._nonAggressionPacts = new Set();

    /**
     * Active mutual protection pacts. Key: "A:B" where A < B (player = -1).
     * If either nation is attacked, the other automatically declares war on the attacker.
     * @type {Set<string>}
     */
    this._mutualProtectionPacts = new Set();

    /**
     * Peace missives currently in transit.
     * Each entry: { id, senderNationId, receiverNationId, terms, worldX, worldY, _path, _pathSegIdx }
     * @type {Array<object>}
     */
    this._pendingMissives = [];

    /** Monotonically increasing id generator for peace missives. */
    this._missiveNextId = 0;

    /**
     * Number of consecutive player settlement captures (conquests) without
     * a day-based cool-down period elapsing.
     * Used to scale the "conquest fear" penalty applied to all surrounding nations.
     * Decays by 1 per in-game day in onDayPassed() and is persisted in getState().
     * @type {number}
     */
    this._playerConquestStreak = 0;

    /**
     * Active trade routes between two parties.
     * Key: "A:B" where A < B (player = -1).
     * Value: { nationA, nationB, dailyIncome, startDay }
     * @type {Map<string, {nationA: number, nationB: number, dailyIncome: number, startDay: number}>}
     */
    this._activeTradeRoutes = new Map();

    /**
     * Accumulated pending gold for the player from active NPC trade routes.
     * Collected each morning alongside regular tax income.
     * @type {number}
     */
    this._playerTradeIncome = 0;

    /**
     * Queue of action decisions computed by the Web Worker.
     * Consumed during phase transitions (war phase, diplomacy phase, build phase).
     * @type {Array<import('./npc-ai.worker.js').NpcDecision>}
     */
    this._pendingWorkerDecisions = [];

    /**
     * Map backing _pendingWorkerDecisions, keyed by nationId, for O(1) merges.
     * Always kept in sync with _pendingWorkerDecisions.
     * @type {Map<number, object>}
     */
    this._pendingWorkerDecisionsMap = new Map();

    /**
     * The NPC AI Web Worker instance.  null when Web Workers are unsupported.
     * @type {Worker|null}
     */
    this._aiWorker = null;

    this._build(mapData);
    this._initSovereignty();
    this._initNpcState();
    this._initWorker();
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

    // An attack constitutes an act of war.
    this.declareWar(attackerNationId, targetNationId);

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

    // ── Mutual Protection Pact trigger ────────────────────────────────────────
    // If the target has mutual protection allies, those allies automatically
    // join the war against the attacker.
    const mpAllies = this.getMutualProtectionAllies(targetNationId);
    mpAllies.forEach(allyId => {
      if (allyId === attackerNationId) return; // already fighting
      this.declareWar(allyId, attackerNationId);
      const allyName = this.nationSystem.nations[allyId]?.name ?? '同盟國';
      const attackerName = attackerNationId === _PLAYER_NATION_ID
        ? '玩家'
        : (this.nationSystem.nations[attackerNationId]?.name ?? '未知國家');
      this._addMemoryEntry(
        allyId,
        `依互保條約，我國向攻打 ${targetNation.name} 的 ${attackerName} 宣戰`,
        0,
      );
      if (attackerNationId === _PLAYER_NATION_ID) {
        const penaltyDelta = -(10 + Math.floor(Math.random() * 10));
        this.modifyPlayerRelation(allyId, penaltyDelta);
      }
    });
  }

  /**
   * Record that the player has annexed (captured) a settlement and propagate
   * a "conquest fear" penalty to every surviving nation.
   *
   * The penalty escalates with the player's consecutive conquest streak so that
   * rapid serial annexations alarm the whole world far more than isolated raids.
   *
   * Penalty formula (per nation, before distance scaling):
   *   basePenalty = -(10 + streak * 8), capped at -50
   * Then multiplied by the distance factor so nearby nations feel it more.
   *
   * @param {object} opts
   * @param {string} opts.settlementName      Name of the captured settlement.
   * @param {string} opts.attackerDisplayName Human-readable attacker name.
   * @param {number} opts.targetNationId      Nation id of the settlement's original owner.
   */
  recordConquest({ settlementName, attackerDisplayName, targetNationId }) {
    this._playerConquestStreak++;
    const streak = this._playerConquestStreak;

    // Base fear penalty this conquest generates (escalates with streak, capped).
    const rawBase = -(10 + streak * 8);
    const basePenalty = Math.max(-50, rawBase);

    const nations = this.nationSystem.nations;

    nations.forEach((nation, nId) => {
      if (!nation) return;
      if (this.nationSystem.isNationExtinct(nId)) return;
      // Skip the directly attacked nation – it was already penalised by recordAttackEvent.
      if (nId === targetNationId) return;

      // Scale by geographic proximity: neighbours fear the player more than
      // distant nations.
      const distFactor = this._distanceFactor(nId, targetNationId);
      const delta = Math.round(basePenalty * distFactor);
      if (delta === 0) return;

      this.modifyPlayerRelation(nId, delta);

      const streakLabel = streak >= 5
        ? '天下震驚'
        : streak >= 3
          ? '列國恐慌'
          : '鄰國警惕';
      this._addMemoryEntry(
        nId,
        `${attackerDisplayName} 接連攻下 ${settlementName}（第 ${streak} 次征服），${streakLabel}，關係 ${delta}`,
        delta,
      );
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
  // Web Worker – async decision computation
  // -------------------------------------------------------------------------

  /**
   * Create and wire up the NPC AI Web Worker.
   * Falls back gracefully when Web Workers are not supported.
   */
  _initWorker() {
    if (typeof Worker === 'undefined') return; // SSR / unsupported environment
    try {
      this._aiWorker = new Worker(
        new URL('./npc-ai.worker.js', import.meta.url),
        { type: 'classic' },
      );
      this._aiWorker.onmessage = (e) => {
        const { decisions, error } = e.data ?? {};
        if (error) {
          console.warn('[NpcAI] Worker error:', error);
          return;
        }
        if (Array.isArray(decisions)) {
          // Merge new decisions into the backing Map (O(1) per decision) then
          // rebuild the array from it so _pendingWorkerDecisions stays consistent.
          decisions.forEach(d => this._pendingWorkerDecisionsMap.set(d.nationId, d));
          this._pendingWorkerDecisions = [...this._pendingWorkerDecisionsMap.values()];
        }
      };
      this._aiWorker.onerror = (e) => {
        console.warn('[NpcAI] Worker uncaught error:', e.message);
      };
    } catch {
      this._aiWorker = null;
    }
  }

  /**
   * Serialise the current game state into a snapshot for the Web Worker.
   * Only includes data the worker needs; avoids transferring large objects.
   * @returns {object}  A plain, structured-clone-safe object.
   */
  _buildWorkerSnapshot() {
    const { nations, castleSettlements, villageSettlements } = this.nationSystem;

    // Serialise settlement data (minimal fields).
    const settlements = [];
    castleSettlements.forEach((s, idx) => {
      settlements.push({
        idx,
        type:                'castle',
        nationId:            s.nationId,
        controllingNationId: s.controllingNationId,
        economyLevel:        s.economyLevel,
        resources:           s.resources,
        rulerTraits:         s.ruler?.traits ?? [],
        buildingTypes:       s.buildings.map(b => b.type),
      });
    });
    villageSettlements.forEach((s, idx) => {
      settlements.push({
        idx,
        type:                'village',
        nationId:            s.nationId,
        controllingNationId: s.controllingNationId,
        economyLevel:        s.economyLevel,
        resources:           s.resources,
        rulerTraits:         s.ruler?.traits ?? [],
        buildingTypes:       s.buildings.map(b => b.type),
      });
    });

    // Garrison totals (sum of all units across all squads).
    const garrisonSizes = [];
    this._npcArmies.forEach((squads, key) => {
      garrisonSizes.push([key, squads.reduce((sum, sq) => sum + sq.length, 0)]);
    });

    return {
      nations:               nations.map((n, id) => n ? { id, name: n.name } : null),
      settlements,
      npcRelations:          [...this._npcRelations.entries()],
      playerRelations:       [...this._playerRelations.entries()],
      npcGold:               [...this._npcGold.entries()],
      garrisonSizes,
      warPairs:              [...this._warPairs],
      nonAggressionPacts:    [...this._nonAggressionPacts],
      mutualProtectionPacts: [...this._mutualProtectionPacts],
      surrenderIndices:      [...this._surrenderIndex.entries()],
      currentDay:            this._currentDay,
      pendingMarchNationIds: this._pendingMarches.map(m => m.attackerNationId),
      pendingMissiveNationIds: this._pendingMissives.map(m => m.senderNationId),
      activeTradeRouteKeys:  [...this._activeTradeRoutes.keys()],
    };
  }

  /**
   * Send the current state snapshot to the worker for asynchronous computation.
   * If the worker is unavailable this is a no-op (decisions remain empty and the
   * synchronous fallback paths in each phase method will run instead).
   */
  _scheduleWorkerUpdate() {
    if (!this._aiWorker) return;
    try {
      this._aiWorker.postMessage({ type: 'compute', state: this._buildWorkerSnapshot() });
    } catch (err) {
      console.warn('[NpcAI] Failed to post snapshot to worker:', err);
    }
  }

  /**
   * Drain and return all pending worker decisions of a specific type.
   * Removes the consumed decisions from the queue.
   * @param {string} type  Decision type string (e.g. 'attack', 'build').
   * @returns {Array<object>}
   */
  _drainWorkerDecisions(type) {
    const matched   = this._pendingWorkerDecisions.filter(d => d.type === type);
    this._pendingWorkerDecisions = this._pendingWorkerDecisions.filter(d => d.type !== type);
    // Keep the backing Map in sync.
    if (this._pendingWorkerDecisionsMap) {
      matched.forEach(d => this._pendingWorkerDecisionsMap.delete(d.nationId));
    }
    return matched;
  }

  // -------------------------------------------------------------------------
  // Trade routes – public API
  // -------------------------------------------------------------------------

  /**
   * Establish an active trade route between two parties.
   * Call this when both sides have agreed (player accepted, or NPC-NPC auto-accepted).
   *
   * @param {number} idA     Nation id (use -1 for player).
   * @param {number} idB     Nation id.
   * @param {number} [dailyIncome]  Override default daily income.
   * @returns {string}  The route key (for persistence).
   */
  openTradeRoute(idA, idB, dailyIncome) {
    const a   = Math.min(idA, idB);
    const b   = Math.max(idA, idB);
    const key = `${a}:${b}`;
    const income = dailyIncome
      ?? ((idA === _PLAYER_NATION_ID || idB === _PLAYER_NATION_ID)
        ? TRADE_ROUTE_DAILY_INCOME
        : NPC_NPC_TRADE_ROUTE_INCOME);
    this._activeTradeRoutes.set(key, { nationA: a, nationB: b, dailyIncome: income, startDay: this._currentDay });
    return key;
  }

  /**
   * Close a trade route between two parties.
   * @param {number} idA
   * @param {number} idB
   */
  closeTradeRoute(idA, idB) {
    const a = Math.min(idA, idB);
    const b = Math.max(idA, idB);
    this._activeTradeRoutes.delete(`${a}:${b}`);
  }

  /**
   * Return true when an active trade route exists between the two parties.
   * @param {number} idA
   * @param {number} idB
   * @returns {boolean}
   */
  hasTradeRoute(idA, idB) {
    const a = Math.min(idA, idB);
    const b = Math.max(idA, idB);
    return this._activeTradeRoutes.has(`${a}:${b}`);
  }

  /**
   * Return a snapshot of all active trade routes for UI display.
   * @returns {Array<{nationA: number, nationB: number, dailyIncome: number, startDay: number}>}
   */
  getActiveTradeRoutes() {
    return [...this._activeTradeRoutes.values()];
  }

  /**
   * Drain and return the player's accumulated trade-route gold since the last call.
   * Should be called by GameUI when collecting morning taxes.
   * @returns {number}
   */
  collectPlayerTradeIncome() {
    const amount = this._playerTradeIncome;
    this._playerTradeIncome = 0;
    return amount;
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
      this._npcTradeRouteIncomePhase(messages);
      // Schedule worker computation so decisions are ready for the daytime phase.
      this._scheduleWorkerUpdate();
    } else if (phase === '白天') {
      this._npcWarPhase(messages);
    } else if (phase === '黃昏') {
      this._npcRecruitPhase(tavernState, messages);
      this._npcBuildPhase(messages);
      this._npcSpontaneousDiplomacyPhase(messages);
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

      castleSettlements.forEach((s, idx) => {
        if (s.controllingNationId !== id) return;
        const gross   = s.economyLevel * TAX_PER_ECON_CASTLE;
        const garrisonUnits = (this._npcArmies.get(`castle:${idx}`) ?? [])
          .reduce((sum, sq) => sum + sq.length, 0);
        const penalty = garrisonUnits * GARRISON_TAX_PENALTY_PER_UNIT;
        income += Math.max(0, gross - penalty);
      });
      villageSettlements.forEach((s, idx) => {
        if (s.controllingNationId !== id) return;
        const gross   = s.economyLevel * TAX_PER_ECON_VILLAGE;
        const garrisonUnits = (this._npcArmies.get(`village:${idx}`) ?? [])
          .reduce((sum, sq) => sum + sq.length, 0);
        const penalty = garrisonUnits * GARRISON_TAX_PENALTY_PER_UNIT;
        income += Math.max(0, gross - penalty);
      });

      if (income > 0) {
        const cur = this._npcGold.get(id) ?? 0;
        this._npcGold.set(id, Math.min(NPC_GOLD_CAP, cur + income));
      }
    });
  }

  /**
   * Morning sub-phase: distribute daily income from active trade routes.
   * NPC-NPC routes add gold to both treasuries; NPC-player routes accumulate
   * in _playerTradeIncome (collected via collectPlayerTradeIncome()).
   * @param {{ message: string }[]} messages
   */
  _npcTradeRouteIncomePhase(messages) {
    this._activeTradeRoutes.forEach((route) => {
      const { nationA, nationB, dailyIncome } = route;
      const isPlayerRoute = nationA === _PLAYER_NATION_ID || nationB === _PLAYER_NATION_ID;
      if (isPlayerRoute) {
        // Accumulate for the player; NPC also earns its share.
        this._playerTradeIncome += dailyIncome;
        const npcId = nationA === _PLAYER_NATION_ID ? nationB : nationA;
        if (npcId >= 0) {
          const cur = this._npcGold.get(npcId) ?? 0;
          this._npcGold.set(npcId, Math.min(NPC_GOLD_CAP, cur + dailyIncome));
        }
      } else {
        // NPC-NPC: both nations earn.
        [nationA, nationB].forEach(nId => {
          if (nId >= 0) {
            const cur = this._npcGold.get(nId) ?? 0;
            this._npcGold.set(nId, Math.min(NPC_GOLD_CAP, cur + dailyIncome));
          }
        });
      }
    });
  }

  /**
   * Daytime phase: NPC nations assess enemies and dispatch marching armies toward
   * target settlements.  Combat is resolved later when the army arrives
   * (see updateMarches).  Each nation may have at most one march in progress at
   * a time.
   *
   * When the Web Worker has computed attack decisions, they are used to choose
   * targets; otherwise the inline evaluation runs as a synchronous fallback.
   * @param {{ message: string }[]} messages
   */
  _npcWarPhase(messages) {
    const { nations, castleSettlements, villageSettlements } = this.nationSystem;

    // Consume worker-computed attack decisions (if available) indexed by nationId.
    const workerAttacks = new Map(
      this._drainWorkerDecisions('attack').map(d => [d.nationId, d]),
    );

    castleSettlements.forEach((s, id) => {
      if (!s || s.controllingNationId !== id) return; // nation must hold its home castle

      // Stagger: each nation only evaluates war on its own day offset to avoid
      // all nations launching attacks simultaneously.
      if ((this._currentDay % NPC_ACTION_STAGGER_PERIOD) !== (id % NPC_ACTION_STAGGER_PERIOD)) return;

      // Only one march at a time per nation.
      if (this._pendingMarches.some(m => m.attackerNationId === id)) return;

      const personality = this._rulerPersonality(s);
      const rulerTraits = s.ruler?.traits ?? [];
      // 勇猛 lowers the threshold; 策略家 raises it.
      const baseThreshold = WAR_THRESHOLD[personality] ?? 55;
      const threshold = baseThreshold
        + (rulerTraits.includes('勇猛')   ? -10 : 0)
        + (rulerTraits.includes('策略家') ?  10 : 0);

      // Attacker's two garrison squads at the home castle.
      const atkKey    = `castle:${id}`;
      const atkArmies = this._npcArmies.get(atkKey) ?? [];
      const squad1    = atkArmies[0] ?? [];
      const squad2    = atkArmies[1] ?? [];
      if (squad1.length === 0 && squad2.length === 0) return; // no troops to dispatch

      // ── Determine attack target ──────────────────────────────────────────────
      // Use worker-computed target when available; fall back to inline evaluation.
      let bestTarget = null;

      const workerDecision = workerAttacks.get(id);
      if (workerDecision) {
        // Worker identified a target — resolve it to actual settlement objects.
        const tType = workerDecision.targetType;
        const tIdx  = workerDecision.targetIdx;
        const tNationId = workerDecision.targetNationId;
        const ts = tType === 'castle'
          ? castleSettlements[tIdx]
          : villageSettlements[tIdx];
        if (ts && ts.controllingNationId === tNationId) {
          const defStr = this._settlementGarrisonStrength(tType, tIdx);
          bestTarget = { nationId: tNationId, settlement: ts, type: tType, idx: tIdx, defStr };
        }
      }

      // Inline fallback (also runs when worker gave no valid target).
      if (!bestTarget) {
        let bestWeakness = threshold;

        nations.forEach((_, tid) => {
          if (tid === id) return;
          const rel = this.getRelation(id, tid);
          if (rel > -20) return; // must be hostile

          // Respect non-aggression pacts: skip this target if a NAP is active.
          if (this.hasNonAggressionPact(id, tid)) return;

          // Evaluate each castle controlled by the target nation.
          castleSettlements.forEach((ts, tidx) => {
            if (!ts || ts.controllingNationId !== tid) return;
            const defStr   = this._settlementGarrisonStrength('castle', tidx);
            const eco      = ts.economyLevel;
            const weakness = Math.max(0, (1 - defStr / 30) * 60) + eco * 4;
            if (weakness > bestWeakness) {
              bestWeakness = weakness;
              bestTarget = { nationId: tid, settlement: ts, type: 'castle', idx: tidx, defStr };
            }
          });

          // Evaluate each village controlled by the target nation.
          villageSettlements.forEach((ts, tidx) => {
            if (!ts || ts.controllingNationId !== tid) return;
            const defStr   = this._settlementGarrisonStrength('village', tidx);
            const eco      = ts.economyLevel;
            const weakness = Math.max(0, (1 - defStr / 10) * 50) + eco * 3;
            if (weakness > bestWeakness) {
              bestWeakness = weakness;
              bestTarget = { nationId: tid, settlement: ts, type: 'village', idx: tidx, defStr };
            }
          });
        });
      }

      if (!bestTarget) return;

      // ── Decide how many squads to send based on estimated win rate ──────────
      const s1Str    = this._squadStrength(squad1);
      const s2Str    = this._squadStrength(squad2);
      const defStr   = bestTarget.defStr;
      // If squad1 is empty fall back to 0 win rate so we always commit squad2 when available.
      // The `+ 1` in the denominator is a baseline defender advantage that prevents
      // division-by-zero and ensures even zero-strength defenders win occasionally.
      const winRate1 = squad1.length > 0 && s1Str > 0 ? s1Str / (s1Str + defStr + 1) : 0;
      const totalStr = s1Str + s2Str;
      const winRate2 = totalStr > 0 ? totalStr / (totalStr + defStr + 1) : 0;

      // Commit both squads when a single squad would win less than 55% of the time.
      const sendBoth = winRate1 < NPC_SINGLE_SQUAD_WIN_THRESHOLD && squad2.length > 0;
      const winRate  = sendBoth ? winRate2 : winRate1;
      const victory  = Math.random() < winRate;

      // ── Apply attacker casualties at dispatch (troops leave the garrison) ───
      // Victorious attackers lose fewer troops; defeat costs twice as many.
      // Committing both squads doubles the absolute loss in either outcome.
      const atkLoss = victory
        ? (sendBoth ? 2 : 1)   // light losses on victory
        : (sendBoth ? 4 : 2);  // heavy losses on defeat
      this.applyGarrisonLosses(atkKey, atkLoss);

      // ── Queue the march ─────────────────────────────────────────────────────
      const attackerName = nations[id]?.name ?? s.name;
      const squadLabel   = _squadLabel(sendBoth);

      // Pre-compute the A* path from the attacker's castle to the target.
      const fromPx = _marchCastlePx(this._mapData.castles[id]);
      const toPx   = bestTarget.type === 'castle'
        ? _marchCastlePx(this._mapData.castles[bestTarget.idx])
        : _marchVillagePx(this._mapData.villages[bestTarget.idx]);

      let path;
      if (fromPx && toPx) {
        // A* path; fall back to a direct two-point line if pathfinder returns null
        // (e.g. both endpoints happen to be surrounded by water — extremely rare).
        path = buildPath(this._mapData, fromPx, toPx) ?? [fromPx, toPx];
      } else {
        return; // cannot determine positions – skip this march
      }

      this._pendingMarches.push({
        id:                this._marchNextId++,
        attackerNationId:  id,
        attackerCastleIdx: id, // castle index mirrors nation id (one home castle per nation)
        targetNationId:    bestTarget.nationId,
        targetType:        bestTarget.type,
        targetIdx:         bestTarget.idx,
        sendBoth,
        victory,
        atkLoss,
        worldX:            path[0].x,
        worldY:            path[0].y,
        _path:             path,
        _pathSegIdx:       0,
        _atkKey:           atkKey,
        _defKey:           `${bestTarget.type}:${bestTarget.idx}`,
        _attackerName:     attackerName,
        _targetSettlement: bestTarget.settlement,
      });

      messages.push({
        message: `⚔ ${attackerName} 派出${squadLabel}向 ${nations[bestTarget.nationId]?.name ?? '鄰國'} 的 ${bestTarget.settlement.name} 進軍！`,
      });
    });
  }

  /**
   * Resolve a completed march: record diplomatic effects, capture/apply losses.
   * @param {object} march  A march entry from _pendingMarches.
   * @returns {{ message: string }[]}  Messages to show the player.
   */
  _resolveMarch(march) {
    const messages = [];
    const { nations } = this.nationSystem;
    const {
      attackerNationId, targetNationId, victory, sendBoth,
      _defKey, _attackerName, _targetSettlement,
    } = march;

    // ── Diplomatic ripple ───────────────────────────────────────────────────
    this.recordAttackEvent({
      attackerNationId,
      targetNationId,
      settlementName:      _targetSettlement.name,
      attackerDisplayName: _attackerName,
      victory,
    });

    if (victory) {
      // Capture: transfer control to the attacker.
      _targetSettlement.controllingNationId = attackerNationId;

      // Clear the defeated garrison.
      const defArmies = this._npcArmies.get(_defKey);
      if (defArmies) defArmies.forEach(sq => { sq.length = 0; });

      // Check whether the defeated nation has been eliminated.
      if (this.nationSystem.isNationExtinct(targetNationId)) {
        this.handleNationExtinction(targetNationId);
        const defeatedNation = nations[targetNationId];
        if (defeatedNation) {
          messages.push({
            message: `💀 ${defeatedNation.name} 失去了所有領地，國家滅亡！所有主權移交給玩家。`,
          });
        }
      }
    } else {
      // Failed assault – defender also takes a small loss.
      this.applyGarrisonLosses(_defKey, 1);
    }

    const squadLabel = _squadLabel(sendBoth);
    const targetName = nations[targetNationId]?.name ?? '鄰國';
    messages.push({
      message: victory
        ? `⚔ ${_attackerName} 的${squadLabel}成功佔領了 ${targetName} 的 ${_targetSettlement.name}！`
        : `⚔ ${_attackerName} 的${squadLabel}進攻 ${targetName} 的 ${_targetSettlement.name} 失敗！`,
      structureRebuild: victory, // hint to caller to rebuild structure visuals
    });

    return messages;
  }

  /**
   * Advance all pending NPC marches by `dt` seconds along their A*-computed
   * paths.  Armies slow down on FOREST tiles (same penalty as the player) and
   * cannot cut through MOUNTAIN or WATER tiles (blocked by the path itself).
   *
   * Must be called every game-loop frame from Game.js.
   *
   * @param {number} dt  Delta-time in real seconds.
   * @param {import('../world/MapData.js').MapData} mapData
   * @returns {{ messages: { message: string, structureRebuild?: boolean }[], structureRebuildNeeded: boolean }}
   */
  updateMarches(dt, mapData) {
    if (!mapData || this._pendingMarches.length === 0) {
      return { messages: [], structureRebuildNeeded: false };
    }

    const messages = [];
    let structureRebuildNeeded = false;
    const resolved = [];

    for (const march of this._pendingMarches) {
      const path = march._path;
      if (!path || path.length < 2) {
        // Invalid path – resolve immediately without effect.
        resolved.push(march);
        continue;
      }

      // How many world-pixels can the army travel this frame?
      // Apply 天生運動員 speed bonus if the attacker's castle ruler has the trait.
      // Also apply moveSpeed stat bonus (each point above 5 = +5% speed).
      const attackerRuler  = this.nationSystem?.castleSettlements?.[march.attackerCastleIdx]?.ruler ?? null;
      const traitSpeedMult = 1.0 + getSpeedBonus(attackerRuler);
      const moveSpeedBonus = (getUnitMoveSpeed(attackerRuler) - 5) / 20; // ±25% range
      const speedMult  = _marchSpeedMult(mapData, march.worldX, march.worldY);
      let   remaining  = NPC_MARCH_SPEED_PX * speedMult * traitSpeedMult * (1.0 + moveSpeedBonus) * dt;

      // Consume `remaining` pixels by stepping along waypoints.
      while (remaining > 0 && march._pathSegIdx < path.length - 1) {
        const next = path[march._pathSegIdx + 1];
        const dx   = next.x - march.worldX;
        const dy   = next.y - march.worldY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= remaining) {
          // Advance fully to the next waypoint.
          march.worldX       = next.x;
          march.worldY       = next.y;
          remaining         -= dist;
          march._pathSegIdx += 1;
        } else {
          // Partial advance along this segment.
          const t      = remaining / dist;
          march.worldX = march.worldX + dx * t;
          march.worldY = march.worldY + dy * t;
          remaining    = 0;
        }
      }

      // Check arrival: reached the last waypoint.
      if (march._pathSegIdx >= path.length - 1) {
        resolved.push(march);
        const resMessages = this._resolveMarch(march);
        messages.push(...resMessages);
        if (resMessages.some(m => m.structureRebuild)) structureRebuildNeeded = true;
      }
    }

    if (resolved.length > 0) {
      const resolvedSet = new Set(resolved);
      this._pendingMarches = this._pendingMarches.filter(m => !resolvedSet.has(m));
    }

    return { messages, structureRebuildNeeded };
  }

  /**
   * Return a read-only snapshot of currently pending marches for the renderer.
   * @returns {ReadonlyArray<object>}
   */
  getPendingMarches() {
    return this._pendingMarches;
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

      // Stagger: each settlement recruits on its own day offset to prevent all
      // settlements hiring simultaneously on every dusk phase.
      if ((day % NPC_ACTION_STAGGER_PERIOD) !== (idx % NPC_ACTION_STAGGER_PERIOD)) return;

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
   * Dusk sub-phase: NPC nations construct new buildings in their home castle when
   * they have enough gold and a building slot is missing.
   *
   * Uses worker-computed 'build' decisions if available; otherwise evaluates inline.
   * @param {{ message: string }[]} messages
   */
  _npcBuildPhase(messages) {
    const { nations, castleSettlements } = this.nationSystem;

    // Collect worker-computed build decisions indexed by nationId.
    const workerBuilds = new Map(
      this._drainWorkerDecisions('build').map(d => [d.nationId, d]),
    );

    castleSettlements.forEach((s, id) => {
      if (!s || s.controllingNationId !== id) return;

      // Stagger by nation id.
      if ((this._currentDay % NPC_ACTION_STAGGER_PERIOD) !== (id % NPC_ACTION_STAGGER_PERIOD)) return;

      const nationId    = id;
      const nationName  = nations[nationId]?.name ?? s.name;
      const rulerTraits = s.ruler?.traits ?? [];
      const gold        = this._npcGold.get(nationId) ?? 0;

      // 一絲不苟 (Meticulous) lowers the gold threshold before building.
      const goldThreshold = rulerTraits.includes('一絲不苟')
        ? METICULOUS_BUILD_THRESHOLD
        : DEFAULT_BUILD_THRESHOLD;
      if (gold < goldThreshold) return;

      let bType = null;
      let bCost  = 0;

      // Use worker decision when available.
      const wd = workerBuilds.get(nationId);
      if (wd && wd.settlementKey === `castle:${id}`) {
        const cost = NPC_BUILD_COSTS[wd.buildingType] ?? 150;
        if (gold >= cost && !s.buildings.some(b => b.type === wd.buildingType)) {
          bType = wd.buildingType;
          bCost  = cost;
        }
      }

      // Inline fallback: build prioritised order without duplicates.
      if (!bType) {
        const prioritySet = new Set();
        if (rulerTraits.includes('銅牆鐵壁')) { prioritySet.add(BLDG_INN); prioritySet.add(BLDG_BLACKSMITH); }
        if (rulerTraits.includes('一絲不苟'))  { prioritySet.add(BLDG_TAVERN); prioritySet.add(BLDG_GENERAL); }
        for (const t of DEFAULT_BUILD_ORDER) prioritySet.add(t);

        for (const t of prioritySet) {
          const cost = NPC_BUILD_COSTS[t] ?? 150;
          if (gold >= cost && !s.buildings.some(b => b.type === t)) {
            bType = t;
            bCost  = cost;
            break;
          }
        }
      }

      if (!bType) return;

      // Construct the building.
      this._npcGold.set(nationId, gold - bCost);
      s.buildings.push(new Building(bType, 1.0));

      messages.push({
        message: `🏗 ${nationName} 在 ${s.name} 新建了「${s.buildings[s.buildings.length - 1].name}」（耗資 🪙${bCost}）`,
      });
    });
  }

  /**
   * Dusk sub-phase: NPC nations spontaneously propose Non-Aggression Pacts,
   * Mutual Protection Pacts, and trade route requests based on worker decisions
   * or inline evaluation.
   * @param {{ message: string }[]} messages
   */
  _npcSpontaneousDiplomacyPhase(messages) {
    const { nations, castleSettlements } = this.nationSystem;

    // Consume all diplomacy-type decisions from the worker.
    const napDecisions   = this._drainWorkerDecisions('nap_proposal');
    const mppDecisions   = this._drainWorkerDecisions('mpp_proposal');
    const tradeDecisions = this._drainWorkerDecisions('trade_request');

    // ── Inline fallback when the Web Worker is unavailable ──────────────────
    // In environments without Web Worker support the arrays above are always
    // empty, so NPC-NPC diplomatic events would never fire.  Evaluate each
    // nation's diplomatic opportunities directly on the main thread instead.
    if (!this._aiWorker) {
      castleSettlements.forEach((s, id) => {
        if (!s || s.controllingNationId !== id) return;
        if ((this._currentDay % NPC_ACTION_STAGGER_PERIOD) !== (id % NPC_ACTION_STAGGER_PERIOD)) return;

        const personality   = this._rulerPersonality(s);
        const rulerTraits   = s.ruler?.traits ?? [];
        const diplomatBonus = rulerTraits.includes('善交際') ? 0.20 : 0.0;

        // NAP proposal: target the nation with the best (least hostile) relation
        // in the "wary but not yet an enemy" band.
        if (!napDecisions.some(d => d.nationId === id)) {
          let napTargetId = -1, napBestRel = NAP_PROPOSAL_REL_MIN - 1;
          nations.forEach((n, tid) => {
            if (!n || tid === id) return;
            if (this.isAtWar(id, tid) || this.hasNonAggressionPact(id, tid)) return;
            const rel = this.getRelation(id, tid);
            if (rel >= NAP_PROPOSAL_REL_MIN && rel < NAP_PROPOSAL_REL_MAX && rel > napBestRel) {
              napBestRel = rel; napTargetId = tid;
            }
          });
          if (napTargetId >= 0) {
            let chance = 0.08 + diplomatBonus;
            if (personality === PERSONALITY_GENTLE)   chance += 0.05;
            if (personality === PERSONALITY_CAUTIOUS) chance += 0.03;
            if (personality === PERSONALITY_WARLIKE)  chance -= 0.05;
            if (Math.random() < Math.max(0, chance)) {
              napDecisions.push({ nationId: id, targetNationId: napTargetId });
            }
          }
        }

        // MPP proposal: target the nation with the highest friendly relation.
        if (!mppDecisions.some(d => d.nationId === id)) {
          let mppTargetId = -1, mppBestRel = MPP_PROPOSAL_REL_MIN - 1;
          nations.forEach((n, tid) => {
            if (!n || tid === id) return;
            if (this.hasMutualProtectionPact(id, tid)) return;
            const rel = this.getRelation(id, tid);
            if (rel >= MPP_PROPOSAL_REL_MIN && rel > mppBestRel) {
              mppBestRel = rel; mppTargetId = tid;
            }
          });
          if (mppTargetId >= 0) {
            let chance = 0.06 + diplomatBonus;
            if (personality === PERSONALITY_GENTLE)   chance += 0.08;
            if (personality === PERSONALITY_CAUTIOUS) chance += 0.04;
            if (personality === PERSONALITY_WARLIKE)  chance -= 0.06;
            if (Math.random() < Math.max(0, chance)) {
              mppDecisions.push({ nationId: id, targetNationId: mppTargetId });
            }
          }
        }

        // Trade route request to player.
        if (!tradeDecisions.some(d => d.nationId === id) &&
            !this.hasTradeRoute(id, _PLAYER_NATION_ID)) {
          const relWithPlayer = this.getPlayerRelation(id);
          if (relWithPlayer >= TRADE_ROUTE_MIN_RELATION) {
            const cunningAdj = personality === PERSONALITY_CUNNING ? 0.03 : 0.0;
            const chance = 0.05 + diplomatBonus + cunningAdj;
            if (Math.random() < Math.max(0, chance)) {
              tradeDecisions.push({ nationId: id });
            }
          }
        }
      });
    }

    // ── NPC-NPC NAP proposals ───────────────────────────────────────────────
    napDecisions.forEach(d => {
      const { nationId, targetNationId } = d;
      if (nationId < 0 || targetNationId < 0) return;
      if (this.hasNonAggressionPact(nationId, targetNationId)) return;
      if (this.isAtWar(nationId, targetNationId)) return;

      // Target evaluates the proposal based on its own relations.
      const tPersonality = this._rulerPersonality(castleSettlements[targetNationId]);
      const rel          = this.getRelation(nationId, targetNationId);
      let acceptChance   = 0.50 + rel / 200;
      if (tPersonality === '溫和')   acceptChance += 0.20;
      if (tPersonality === '謹慎') acceptChance += 0.10;
      if (tPersonality === '好戰')  acceptChance -= 0.25;
      if (tPersonality === '傲慢') acceptChance -= 0.15;

      if (Math.random() < Math.max(0, Math.min(0.95, acceptChance))) {
        this.signNonAggressionPact(nationId, targetNationId);
        const nameA = nations[nationId]?.name       ?? '一國';
        const nameB = nations[targetNationId]?.name ?? '另一國';
        messages.push({ message: `🤝 ${nameA} 與 ${nameB} 簽署了互不侵犯條約！` });
        this._addMemoryEntry(nationId,       `與 ${nameB} 締結互不侵犯條約`, 10);
        this._addMemoryEntry(targetNationId, `與 ${nameA} 締結互不侵犯條約`, 10);
      }
    });

    // ── NPC-NPC MPP proposals ───────────────────────────────────────────────
    mppDecisions.forEach(d => {
      const { nationId, targetNationId } = d;
      if (nationId < 0 || targetNationId < 0) return;
      if (this.hasMutualProtectionPact(nationId, targetNationId)) return;
      if (this.isAtWar(nationId, targetNationId)) return;

      const tPersonality = this._rulerPersonality(castleSettlements[targetNationId]);
      const rel          = this.getRelation(nationId, targetNationId);
      let acceptChance   = 0.40 + rel / 200;
      if (tPersonality === '溫和')   acceptChance += 0.25;
      if (tPersonality === '謹慎') acceptChance += 0.15;
      if (tPersonality === '好戰')  acceptChance -= 0.20;
      if (tPersonality === '傲慢') acceptChance -= 0.10;

      if (Math.random() < Math.max(0, Math.min(0.90, acceptChance))) {
        this.signMutualProtectionPact(nationId, targetNationId);
        const nameA = nations[nationId]?.name       ?? '一國';
        const nameB = nations[targetNationId]?.name ?? '另一國';
        messages.push({ message: `🛡 ${nameA} 與 ${nameB} 締結了互保條約！` });
        this._addMemoryEntry(nationId,       `與 ${nameB} 締結互保條約`, 20);
        this._addMemoryEntry(targetNationId, `與 ${nameA} 締結互保條約`, 20);
      }
    });

    // ── NPC trade-route requests to player ──────────────────────────────────
    tradeDecisions.forEach(d => {
      const { nationId } = d;
      if (nationId < 0) return;
      if (this.hasTradeRoute(nationId, _PLAYER_NATION_ID)) return;
      // Check: player needs at least one settlement for the missive to reach.
      const s = castleSettlements[nationId];
      if (!s || s.controllingNationId !== nationId) return;
      const fromPx = _marchCastlePx(this._mapData.castles[nationId]);
      if (!fromPx) return;
      // Missive will be delivered to the player's nearest settlement.
      this.sendTradeRouteMissive({ senderNationId: nationId, fromPx });
      const nationName = nations[nationId]?.name ?? '一國';
      messages.push({ message: `📨 ${nationName} 派使者前來商討貿易路線……` });
    });
  }

  /**
   * Compute the total combat strength of a single garrison squad.
   * Sums attack + defense + a morale bonus for each unit.
   * @param {Array<{stats:{attack:number,defense:number,morale:number}}>} squad
   * @returns {number}
   */
  _squadStrength(squad) {
    if (!squad || squad.length === 0) return 0;
    return squad.reduce((sum, u) => {
      const atk    = u.stats?.attack  ?? 5;
      const def    = u.stats?.defense ?? 5;
      const morale = u.stats?.morale  ?? 50;
      return sum + atk + def + Math.floor(morale / 20);
    }, 0);
  }

  /**
   * Return the total garrison strength of a specific settlement.
   * @param {'castle'|'village'} type
   * @param {number} idx
   * @returns {number}
   */
  _settlementGarrisonStrength(type, idx) {
    const armies = this._npcArmies.get(`${type}:${idx}`) ?? [];
    return armies.reduce((sum, sq) => sum + this._squadStrength(sq), 0);
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
  // War state management
  // -------------------------------------------------------------------------

  /** @param {number} idA @param {number} idB @returns {string} */
  _warKey(idA, idB) {
    const a = Math.min(idA, idB);
    const b = Math.max(idA, idB);
    return `${a}:${b}`;
  }

  /**
   * Mark two nations as being at war with each other.
   * @param {number} idA  Nation id (use -1 for player).
   * @param {number} idB  Nation id (use -1 for player).
   */
  declareWar(idA, idB) {
    if (idA === idB) return;
    this._warPairs.add(this._warKey(idA, idB));
  }

  /**
   * End the war between two nations (called after a peace treaty is accepted).
   * @param {number} idA
   * @param {number} idB
   */
  endWar(idA, idB) {
    this._warPairs.delete(this._warKey(idA, idB));
  }

  /**
   * Returns true when the two given nations are currently at war.
   * @param {number} idA
   * @param {number} idB
   * @returns {boolean}
   */
  isAtWar(idA, idB) {
    if (idA === idB) return false;
    return this._warPairs.has(this._warKey(idA, idB));
  }

  /**
   * Return the list of nation IDs currently at war with `nationId`.
   * @param {number} nationId
   * @returns {number[]}
   */
  getWarsInvolving(nationId) {
    const result = [];
    for (const key of this._warPairs) {
      const parts = key.split(':');
      const a = Number(parts[0]);
      const b = Number(parts[1]);
      if (a === nationId) result.push(b);
      else if (b === nationId) result.push(a);
    }
    return result;
  }

  /**
   * Scan all settlements for sovereignty conflicts (controller ≠ founding nation)
   * and register those pairs as being at war. Safe to call multiple times.
   */
  _detectCurrentWars() {
    const { castleSettlements, villageSettlements } = this.nationSystem;
    [...castleSettlements, ...villageSettlements].forEach(s => {
      if (s.nationId < 0) return;
      const ctrl = s.controllingNationId;
      if (ctrl === s.nationId) return; // no conflict
      this.declareWar(s.nationId, ctrl);
    });
  }

  // -------------------------------------------------------------------------
  // Non-Aggression Pact (互不侵犯條約)
  // -------------------------------------------------------------------------

  /** @param {number} idA @param {number} idB @returns {string} */
  _pactKey(idA, idB) {
    const a = Math.min(idA, idB);
    const b = Math.max(idA, idB);
    return `${a}:${b}`;
  }

  /**
   * Check whether two nations have an active non-aggression pact.
   * @param {number} idA
   * @param {number} idB
   * @returns {boolean}
   */
  hasNonAggressionPact(idA, idB) {
    if (idA === idB) return false;
    return this._nonAggressionPacts.has(this._pactKey(idA, idB));
  }

  /**
   * Establish a non-aggression pact between two nations.
   * Improves their relation by a small amount as a sign of goodwill.
   * @param {number} idA  Nation id (use -1 for player).
   * @param {number} idB  Nation id.
   */
  signNonAggressionPact(idA, idB) {
    if (idA === idB) return;
    this._nonAggressionPacts.add(this._pactKey(idA, idB));
    // Relation boost from formalising the agreement.
    if (idA === _PLAYER_NATION_ID || idB === _PLAYER_NATION_ID) {
      const npcId = idA === _PLAYER_NATION_ID ? idB : idA;
      this.modifyPlayerRelation(npcId, 10);
      this._addMemoryEntry(npcId, '與玩家締結互不侵犯條約，關係 +10', 10);
    } else {
      this.modifyNpcRelation(idA, idB, 10);
    }
  }

  /**
   * Break a non-aggression pact (penalty applied to the breaker's relation).
   * @param {number} breakerNationId  The nation that breaks the pact (use -1 for player).
   * @param {number} otherNationId    The other party.
   */
  breakNonAggressionPact(breakerNationId, otherNationId) {
    if (!this.hasNonAggressionPact(breakerNationId, otherNationId)) return;
    this._nonAggressionPacts.delete(this._pactKey(breakerNationId, otherNationId));
    const delta = -20;
    if (breakerNationId === _PLAYER_NATION_ID) {
      this.modifyPlayerRelation(otherNationId, delta);
      this._addMemoryEntry(otherNationId, `玩家撕毀了互不侵犯條約，關係 ${delta}`, delta);
    } else if (otherNationId === _PLAYER_NATION_ID) {
      this.modifyPlayerRelation(breakerNationId, delta);
      this._addMemoryEntry(breakerNationId, `對方撕毀了互不侵犯條約，關係 ${delta}`, delta);
    } else {
      this.modifyNpcRelation(breakerNationId, otherNationId, delta);
    }
  }

  // -------------------------------------------------------------------------
  // Mutual Protection Pact (互保條約)
  // -------------------------------------------------------------------------

  /**
   * Check whether two nations have an active mutual protection pact.
   * @param {number} idA
   * @param {number} idB
   * @returns {boolean}
   */
  hasMutualProtectionPact(idA, idB) {
    if (idA === idB) return false;
    return this._mutualProtectionPacts.has(this._pactKey(idA, idB));
  }

  /**
   * Establish a mutual protection pact between two nations.
   * Each party agrees to declare war on any nation that attacks the other.
   * @param {number} idA  Nation id (use -1 for player).
   * @param {number} idB  Nation id.
   */
  signMutualProtectionPact(idA, idB) {
    if (idA === idB) return;
    this._mutualProtectionPacts.add(this._pactKey(idA, idB));
    if (idA === _PLAYER_NATION_ID || idB === _PLAYER_NATION_ID) {
      const npcId = idA === _PLAYER_NATION_ID ? idB : idA;
      this.modifyPlayerRelation(npcId, 20);
      this._addMemoryEntry(npcId, '與玩家締結互保條約，關係 +20', 20);
    } else {
      this.modifyNpcRelation(idA, idB, 20);
    }
  }

  /**
   * Break a mutual protection pact with a substantial relation penalty.
   * @param {number} breakerNationId
   * @param {number} otherNationId
   */
  breakMutualProtectionPact(breakerNationId, otherNationId) {
    if (!this.hasMutualProtectionPact(breakerNationId, otherNationId)) return;
    this._mutualProtectionPacts.delete(this._pactKey(breakerNationId, otherNationId));
    const delta = -30;
    if (breakerNationId === _PLAYER_NATION_ID) {
      this.modifyPlayerRelation(otherNationId, delta);
      this._addMemoryEntry(otherNationId, `玩家撕毀了互保條約，關係 ${delta}`, delta);
    } else if (otherNationId === _PLAYER_NATION_ID) {
      this.modifyPlayerRelation(breakerNationId, delta);
      this._addMemoryEntry(breakerNationId, `對方撕毀了互保條約，關係 ${delta}`, delta);
    } else {
      this.modifyNpcRelation(breakerNationId, otherNationId, delta);
    }
  }

  /**
   * Return all nation IDs that have a mutual protection pact with `nationId`.
   * @param {number} nationId
   * @returns {number[]}
   */
  getMutualProtectionAllies(nationId) {
    const result = [];
    for (const key of this._mutualProtectionPacts) {
      const parts = key.split(':');
      const a = Number(parts[0]);
      const b = Number(parts[1]);
      if (a === nationId) result.push(b);
      else if (b === nationId) result.push(a);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Joint War Declaration (合意宣戰第三國)
  // -------------------------------------------------------------------------

  /**
   * Both the player and an NPC ally jointly declare war on a third nation.
   * Improves player–ally relation and reduces both parties' relation with the target.
   *
   * @param {number} allyNationId    NPC ally that agreed to the joint war.
   * @param {number} targetNationId  The nation being declared on.
   * @returns {{ messages: string[] }}
   */
  applyJointWarDeclaration(allyNationId, targetNationId) {
    const messages = [];
    const nations  = this.nationSystem.nations;

    // Declare war on the target from both sides.
    this.declareWar(_PLAYER_NATION_ID, targetNationId);
    this.declareWar(allyNationId, targetNationId);

    // Break any NAP with the target (since we're now at war).
    if (this.hasNonAggressionPact(_PLAYER_NATION_ID, targetNationId)) {
      this.breakNonAggressionPact(_PLAYER_NATION_ID, targetNationId);
    }
    if (this.hasNonAggressionPact(allyNationId, targetNationId)) {
      this.breakNonAggressionPact(allyNationId, targetNationId);
    }

    const allyName   = nations[allyNationId]?.name   ?? '同盟國';
    const targetName = nations[targetNationId]?.name ?? '第三國';

    // Relation effects.
    const allianceBonus = 15;
    this.modifyPlayerRelation(allyNationId, allianceBonus);
    this._addMemoryEntry(allyNationId, `與玩家合意宣戰 ${targetName}，同盟關係加深 +${allianceBonus}`, allianceBonus);

    const targetDelta = -(20 + Math.floor(Math.random() * 15));
    this.modifyPlayerRelation(targetNationId, targetDelta);
    this.modifyNpcRelation(allyNationId, targetNationId, targetDelta);
    this._addMemoryEntry(targetNationId, `玩家與 ${allyName} 聯合宣戰，關係 ${targetDelta}`, targetDelta);

    messages.push(`⚔ ${allyName} 與我方聯合向 ${targetName} 宣戰！`);
    return { messages };
  }

  // -------------------------------------------------------------------------
  // Direct diplomacy evaluation (face-to-face, no missive needed)
  // -------------------------------------------------------------------------

  /**
   * Evaluate whether an NPC nation accepts a direct diplomatic proposal.
   * Called when the player visits the NPC's city hall in person.
   *
   * Proposal types:
   *   - 'nap'              : Non-aggression pact
   *   - 'joint_war'        : Joint war against a third nation (data.targetNationId required)
   *   - 'mutual_protection': Mutual protection pact
   *
   * @param {number} nationId       NPC nation being approached.
   * @param {'nap'|'joint_war'|'mutual_protection'} type
   * @param {{ targetNationId?: number }} [data]
   * @returns {boolean}  true = accepted
   */
  evaluateDirectDiploProposal(nationId, type, data = {}) {
    const p   = this._rulerPersonality(this.nationSystem.castleSettlements[nationId]);
    const rel = this.getPlayerRelation(nationId);

    if (type === 'nap') {
      // Base chance 50 %, scaled by relation (range ±100 → ±0.5 adjustment).
      let chance = 0.50 + rel / 200;
      if (p === PERSONALITY_GENTLE)   chance += 0.20;
      if (p === PERSONALITY_CAUTIOUS) chance += 0.10;
      if (p === PERSONALITY_WARLIKE)  chance -= 0.25;
      if (p === PERSONALITY_ARROGANT) chance -= 0.15;
      return Math.random() < Math.max(0.05, Math.min(0.95, chance));
    }

    if (type === 'joint_war') {
      const targetId = data.targetNationId ?? -99;
      const relWithTarget = this.getRelation(nationId, targetId);
      // NPC must be hostile toward the target (-30 or below).
      if (relWithTarget > JOINT_WAR_HOSTILITY_THRESHOLD) return false;
      // Stronger hatred → higher acceptance:
      // relWithTarget = -30 → 0 bonus → 40 % base; -100 → 50 % bonus → ~90 % base.
      let chance = 0.40 + (-relWithTarget + JOINT_WAR_HOSTILITY_THRESHOLD) / 140;
      if (p === PERSONALITY_WARLIKE)  chance += 0.20;
      if (p === PERSONALITY_ARROGANT) chance += 0.10;
      if (p === PERSONALITY_GENTLE)   chance -= 0.20;
      if (p === PERSONALITY_CAUTIOUS) chance -= 0.10;
      return Math.random() < Math.max(0.05, Math.min(0.95, chance));
    }

    if (type === 'mutual_protection') {
      // Base chance 40 %, scaled by relation (range ±100 → ±0.5 adjustment).
      let chance = 0.40 + rel / 200;
      if (p === PERSONALITY_GENTLE)   chance += 0.25;
      if (p === PERSONALITY_CAUTIOUS) chance += 0.15;
      if (p === PERSONALITY_WARLIKE)  chance -= 0.20;
      if (p === PERSONALITY_ARROGANT) chance -= 0.10;
      return Math.random() < Math.max(0.05, Math.min(0.90, chance));
    }

    if (type === 'trade_route') {
      // Base chance 55 %, scaled by relation (range ±100 → ±0.5 adjustment).
      let chance = 0.55 + rel / 200;
      if (p === PERSONALITY_GENTLE)   chance += 0.10;
      if (p === PERSONALITY_CAUTIOUS) chance += 0.05;
      if (p === PERSONALITY_CUNNING)  chance += 0.10; // cunning rulers value economic gain
      if (p === PERSONALITY_WARLIKE)  chance -= 0.20;
      if (p === PERSONALITY_ARROGANT) chance -= 0.15;
      // Demand bonus: player can supply what the foreign settlement needs
      if (data.demandMet) chance += 0.20;
      return Math.random() < Math.max(0.05, Math.min(0.90, chance));
    }

    return false;
  }



  /**
   * Return the world-pixel position of a settlement (castle or village).
   * @param {import('./NationSystem.js').Settlement} settlement
   * @returns {{ x: number, y: number }|null}
   */
  _getSettlementPx(settlement) {
    const ci = this.nationSystem.castleSettlements.indexOf(settlement);
    if (ci >= 0) return _marchCastlePx(this._mapData.castles[ci]);
    const vi = this.nationSystem.villageSettlements.indexOf(settlement);
    if (vi >= 0) return _marchVillagePx(this._mapData.villages[vi]);
    return null;
  }

  /**
   * Find the world-pixel position of the player's nearest controlled settlement.
   * Returns null if the player controls no settlements.
   * @param {{ x: number, y: number }} fromPx
   * @returns {{ x: number, y: number }|null}
   */
  _findNearestPlayerSettlement(fromPx) {
    const { castleSettlements, villageSettlements } = this.nationSystem;
    let bestDist = Infinity;
    let bestPx = null;

    castleSettlements.forEach((s, idx) => {
      if (s.controllingNationId !== _PLAYER_NATION_ID) return;
      const castle = this._mapData.castles[idx];
      if (!castle) return;
      const px = _marchCastlePx(castle);
      const d = (px.x - fromPx.x) ** 2 + (px.y - fromPx.y) ** 2;
      if (d < bestDist) { bestDist = d; bestPx = px; }
    });

    villageSettlements.forEach((s, idx) => {
      if (s.controllingNationId !== _PLAYER_NATION_ID) return;
      const village = this._mapData.villages[idx];
      if (!village) return;
      const px = _marchVillagePx(village);
      const d = (px.x - fromPx.x) ** 2 + (px.y - fromPx.y) ** 2;
      if (d < bestDist) { bestDist = d; bestPx = px; }
    });

    return bestPx;
  }

  /**
   * Resolve a settlement key (e.g. "castle:0") back to a Settlement object.
   * @param {string} key
   * @returns {import('./NationSystem.js').Settlement|null}
   */
  _getSettlementByKey(key) {
    const parts = key.split(':');
    const type  = parts[0];
    const idx   = Number(parts[1]);
    if (type === 'castle')  return this.nationSystem.castleSettlements[idx]  ?? null;
    if (type === 'village') return this.nationSystem.villageSettlements[idx] ?? null;
    return null;
  }

  /**
   * Create and dispatch a peace treaty missive.
   *
   * Terms object shape:
   * ```
   * {
   *   goldFromSender:          number,  // Gold sender pays receiver
   *   goldFromNpc:             number,  // Extra gold NPC pays (when NPC sends)
   *   playerAcknowledgesDefeat: boolean,
   *   npcAcknowledgesDefeat:   boolean,
   *   cededBySender:           string[], // Settlement keys sender gives up
   *   cededByReceiver:         string[], // Settlement keys receiver gives up
   * }
   * ```
   *
   * @param {{ senderNationId: number, receiverNationId: number, fromSettlement?: object|null, fromPx?: object|null, terms: object }} opts
   * @returns {boolean}  true if the missive was successfully queued.
   */
  sendPeaceTreaty({ senderNationId, receiverNationId, fromSettlement = null, fromPx: explicitFromPx = null, terms, messengerUnitId = null, messengerAppearance = null, messengerMoveSpeed = 5 }) {
    const fromPx = explicitFromPx ?? (fromSettlement ? this._getSettlementPx(fromSettlement) : null);
    if (!fromPx) return false;

    let toPx = null;
    if (receiverNationId === _PLAYER_NATION_ID) {
      toPx = this._findNearestPlayerSettlement(fromPx);
    } else {
      const castle = this._mapData.castles[receiverNationId];
      toPx = castle ? _marchCastlePx(castle) : null;
    }
    if (!toPx) return false;

    const path = buildPath(this._mapData, fromPx, toPx) ?? [fromPx, toPx];
    this._pendingMissives.push({
      id:               this._missiveNextId++,
      type:             'peace',
      senderNationId,
      receiverNationId,
      terms,
      worldX:           path[0].x,
      worldY:           path[0].y,
      _path:            path,
      _pathSegIdx:      0,
      messengerUnitId,
      messengerAppearance,
      messengerMoveSpeed,
    });
    return true;
  }

  /**
   * Dispatch a condemnation letter from the player to a target nation.
   * @param {{ receiverNationId: number, fromSettlement: object }} opts
   * @returns {boolean}
   */
  sendCondemnationLetter({ receiverNationId, fromSettlement, messengerUnitId = null, messengerAppearance = null, messengerMoveSpeed = 5 }) {
    const fromPx = this._getSettlementPx(fromSettlement);
    if (!fromPx) return false;
    const castle = this._mapData.castles[receiverNationId];
    const toPx = castle ? _marchCastlePx(castle) : null;
    if (!toPx) return false;

    const path = buildPath(this._mapData, fromPx, toPx) ?? [fromPx, toPx];
    this._pendingMissives.push({
      id:               this._missiveNextId++,
      type:             'condemn',
      senderNationId:   _PLAYER_NATION_ID,
      receiverNationId,
      worldX:           path[0].x,
      worldY:           path[0].y,
      _path:            path,
      _pathSegIdx:      0,
      messengerUnitId,
      messengerAppearance,
      messengerMoveSpeed,
    });
    return true;
  }

  /**
   * Dispatch a gift letter from the player to a target nation.
   * @param {{ receiverNationId: number, fromSettlement: object, goldAmount: number }} opts
   * @returns {boolean}
   */
  sendGiftLetter({ receiverNationId, fromSettlement, goldAmount, messengerUnitId = null, messengerAppearance = null, messengerMoveSpeed = 5 }) {
    const fromPx = this._getSettlementPx(fromSettlement);
    if (!fromPx) return false;
    const castle = this._mapData.castles[receiverNationId];
    const toPx = castle ? _marchCastlePx(castle) : null;
    if (!toPx) return false;

    const path = buildPath(this._mapData, fromPx, toPx) ?? [fromPx, toPx];
    this._pendingMissives.push({
      id:               this._missiveNextId++,
      type:             'gift',
      senderNationId:   _PLAYER_NATION_ID,
      receiverNationId,
      goldAmount:       Math.max(0, goldAmount),
      worldX:           path[0].x,
      worldY:           path[0].y,
      _path:            path,
      _pathSegIdx:      0,
      messengerUnitId,
      messengerAppearance,
      messengerMoveSpeed,
    });
    return true;
  }

  /**
   * Dispatch a formal war declaration letter from the player to a target nation.
   * The declaration takes effect when the messenger arrives.
   * @param {{ receiverNationId: number, fromSettlement: object, reason: string }} opts
   * @returns {boolean}
   */
  sendWarDeclaration({ receiverNationId, fromSettlement, reason = '', messengerUnitId = null, messengerAppearance = null, messengerMoveSpeed = 5 }) {
    const fromPx = this._getSettlementPx(fromSettlement);
    if (!fromPx) return false;
    const castle = this._mapData.castles[receiverNationId];
    const toPx = castle ? _marchCastlePx(castle) : null;
    if (!toPx) return false;

    const path = buildPath(this._mapData, fromPx, toPx) ?? [fromPx, toPx];
    this._pendingMissives.push({
      id:               this._missiveNextId++,
      type:             'war_declaration',
      senderNationId:   _PLAYER_NATION_ID,
      receiverNationId,
      reason,
      worldX:           path[0].x,
      worldY:           path[0].y,
      _path:            path,
      _pathSegIdx:      0,
      messengerUnitId,
      messengerAppearance,
      messengerMoveSpeed,
    });
    return true;
  }

  /**
   * Dispatch a trade-route request missive from an NPC nation to the player.
   * When the missive arrives, the player will be prompted to accept or decline.
   *
   * @param {{ senderNationId: number, fromSettlement?: object|null, fromPx?: object|null, messengerMoveSpeed?: number }} opts
   * @returns {boolean}  true if the missive was successfully queued.
   */
  sendTradeRouteMissive({ senderNationId, fromSettlement = null, fromPx: explicitFromPx = null, messengerMoveSpeed = DEFAULT_MESSENGER_MOVE_SPEED }) {
    const fromPx = explicitFromPx ?? (fromSettlement ? this._getSettlementPx(fromSettlement) : null);
    if (!fromPx) return false;
    const toPx = this._findNearestPlayerSettlement(fromPx);
    if (!toPx) return false;

    const path = buildPath(this._mapData, fromPx, toPx) ?? [fromPx, toPx];
    this._pendingMissives.push({
      id:               this._missiveNextId++,
      type:             'trade_request',
      senderNationId,
      receiverNationId: _PLAYER_NATION_ID,
      worldX:           path[0].x,
      worldY:           path[0].y,
      _path:            path,
      _pathSegIdx:      0,
      messengerMoveSpeed,
    });
    return true;
  }

  /**
   * Evaluate whether an NPC nation would accept a peace offer.
   * @param {number} nationId  Nation evaluating the offer.
   * @param {object} terms     Treaty terms.
   * @returns {boolean}
   */
  _npcEvaluatePeaceOffer(nationId, terms) {
    this.updateSurrenderIndex(nationId);
    const si = this.getSurrenderIndex(nationId) / 100; // 0..1
    const p  = this._rulerPersonality(this.nationSystem.castleSettlements[nationId]);

    // Base acceptance driven by how desperate the nation is.
    let chance = si * 0.75;

    // Terms favourable to the NPC improve acceptance.
    if ((terms.goldFromSender ?? 0) > 0) chance += 0.15;
    if (terms.playerAcknowledgesDefeat) chance += 0.10;
    if ((terms.cededBySender ?? []).length > 0) chance += (terms.cededBySender.length) * 0.10;

    // Terms unfavourable to the NPC reduce acceptance.
    const npcGold = this._npcGold.get(nationId) ?? 0;
    const requestedGold = terms.goldFromNpc ?? 0;
    if (requestedGold > 0) {
      chance -= requestedGold > npcGold ? 0.40 : 0.15;
    }
    if (terms.npcAcknowledgesDefeat) chance -= 0.15;
    if ((terms.cededByReceiver ?? []).length > 0) chance -= (terms.cededByReceiver.length) * 0.15;

    // Personality modifiers.
    if (p === PERSONALITY_WARLIKE)  chance -= 0.25;
    if (p === PERSONALITY_ARROGANT) chance -= 0.15;
    if (p === PERSONALITY_CAUTIOUS) chance += 0.10;
    if (p === PERSONALITY_GENTLE)   chance += 0.20;

    return Math.random() < Math.max(0, Math.min(1, chance));
  }

  /**
   * Apply agreed peace treaty terms.
   * NPC-side gold changes and territory control are handled here.
   * Returns the net gold change for the player (caller must apply this to player inventory).
   *
   * @param {number} senderNationId   -1 for player.
   * @param {number} receiverNationId -1 for player.
   * @param {object} terms
   * @returns {{ playerGoldGain: number, structureRebuildNeeded: boolean }}
   */
  applyPeaceTreaty(senderNationId, receiverNationId, terms) {
    this.endWar(senderNationId, receiverNationId);

    let playerGoldGain = 0;
    let structureRebuildNeeded = false;

    // ── Gold from sender to receiver ────────────────────────────────────────
    const goldFromSender = terms.goldFromSender ?? 0;
    if (goldFromSender > 0) {
      if (senderNationId !== _PLAYER_NATION_ID) {
        const cur = this._npcGold.get(senderNationId) ?? 0;
        this._npcGold.set(senderNationId, Math.max(0, cur - goldFromSender));
        if (receiverNationId === _PLAYER_NATION_ID) {
          playerGoldGain += goldFromSender;
        } else {
          const rcur = this._npcGold.get(receiverNationId) ?? 0;
          this._npcGold.set(receiverNationId, Math.min(NPC_GOLD_CAP, rcur + goldFromSender));
        }
      } else {
        // Player pays NPC
        playerGoldGain -= goldFromSender;
      }
    }

    // ── Additional gold from NPC to player (used in NPC-initiated offers) ───
    const goldFromNpc = terms.goldFromNpc ?? 0;
    if (goldFromNpc > 0) {
      const npcId = senderNationId !== _PLAYER_NATION_ID ? senderNationId : receiverNationId;
      if (npcId >= 0) {
        const cur = this._npcGold.get(npcId) ?? 0;
        this._npcGold.set(npcId, Math.max(0, cur - goldFromNpc));
      }
      if (senderNationId === _PLAYER_NATION_ID || receiverNationId === _PLAYER_NATION_ID) {
        playerGoldGain += goldFromNpc;
      }
    }

    // ── Territory ceded by sender → goes to receiver ────────────────────────
    (terms.cededBySender ?? []).forEach(key => {
      const s = this._getSettlementByKey(key);
      if (!s) return;
      s.controllingNationId = receiverNationId;
      if (receiverNationId !== _PLAYER_NATION_ID) s.playerOwned = false;
      this.transferSovereignty(key, senderNationId, receiverNationId);
      structureRebuildNeeded = true;
    });

    // ── Territory ceded by receiver → goes to sender ────────────────────────
    (terms.cededByReceiver ?? []).forEach(key => {
      const s = this._getSettlementByKey(key);
      if (!s) return;
      s.controllingNationId = senderNationId;
      if (senderNationId !== _PLAYER_NATION_ID) s.playerOwned = false;
      this.transferSovereignty(key, receiverNationId, senderNationId);
      structureRebuildNeeded = true;
    });

    // ── Relation improvement after peace ────────────────────────────────────
    if (senderNationId === _PLAYER_NATION_ID || receiverNationId === _PLAYER_NATION_ID) {
      const npcId = senderNationId === _PLAYER_NATION_ID ? receiverNationId : senderNationId;
      this.modifyPlayerRelation(npcId, 35);
    } else {
      this.modifyNpcRelation(senderNationId, receiverNationId, 40);
    }

    return { playerGoldGain, structureRebuildNeeded };
  }

  /**
   * Return the live array of missives currently in transit.
   * Each entry has at minimum: { id, type, senderNationId, receiverNationId, worldX, worldY }
   * @returns {ReadonlyArray<object>}
   */
  getPendingMissives() {
    return this._pendingMissives;
  }

  /**
   * Advance all pending peace missives along their paths.
   * Call this every game-loop frame from Game.js.
   *
   * @param {number} dt  Delta-time in real seconds.
   * @returns {Array<{ type: 'player_offer'|'npc_response'|'npc_npc', missive: object, accepted?: boolean }>}
   */
  updateMissives(dt) {
    if (this._pendingMissives.length === 0) return [];

    const resolved  = [];
    const remaining = [];

    for (const m of this._pendingMissives) {
      const path = m._path;
      if (!path || path.length < 2) { resolved.push(m); continue; }

      // Scale movement speed by terrain at current position + messenger move speed.
      const terrainMult  = this._mapData ? _marchSpeedMult(this._mapData, m.worldX, m.worldY) : 1.0;
      const unitSpeed    = m.messengerMoveSpeed ?? 5;  // default moveSpeed = 5
      const speedScale   = terrainMult * (unitSpeed / 5);
      let rem = MISSIVE_SPEED_PX * speedScale * dt;
      while (rem > 0 && m._pathSegIdx < path.length - 1) {
        const next = path[m._pathSegIdx + 1];
        const dx   = next.x - m.worldX;
        const dy   = next.y - m.worldY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= rem) {
          m.worldX = next.x; m.worldY = next.y;
          rem -= dist; m._pathSegIdx++;
        } else {
          const t  = rem / dist;
          m.worldX += dx * t; m.worldY += dy * t;
          rem = 0;
        }
      }

      if (m._pathSegIdx >= path.length - 1) resolved.push(m);
      else remaining.push(m);
    }

    this._pendingMissives = remaining;
    return resolved.map(m => this._resolveMissive(m));
  }

  /**
   * @param {object} missive
   * @returns {{ type: string, missive: object, accepted?: boolean }}
   */
  _resolveMissive(missive) {
    const { type = 'peace', senderNationId, receiverNationId } = missive;

    // ── Condemnation letter ──────────────────────────────────────────────────
    if (type === 'condemn') {
      const delta = -(15 + Math.floor(Math.random() * 11)); // -15 … -25
      this.modifyPlayerRelation(receiverNationId, delta);
      this._addMemoryEntry(receiverNationId, `玩家派使者公開譴責了我國，關係 ${delta}`, delta);
      // Also ripple to third-party nations (milder than an attack)
      const nations = this.nationSystem.nations;
      nations.forEach((n, cId) => {
        if (!n || cId === receiverNationId) return;
        const cToTarget = this.getRelation(cId, receiverNationId);
        if (cToTarget >= 60) {
          const ripple = Math.round(-(2 + Math.floor(Math.random() * 5)) * this._distanceFactor(cId, receiverNationId));
          this.modifyPlayerRelation(cId, ripple);
        }
      });
      return { type: 'player_condemn_delivered', missive, delta };
    }

    // ── Gift letter ──────────────────────────────────────────────────────────
    if (type === 'gift') {
      const gold   = missive.goldAmount ?? 0;
      const delta  = 10 + Math.floor(gold / 20); // base +10, +1 per 20 gold
      const capped = Math.min(delta, 40);
      this.modifyPlayerRelation(receiverNationId, capped);
      this._addMemoryEntry(receiverNationId, `玩家派使者送來禮物（🪙${gold}），關係 +${capped}`, capped);
      // Small NPC gold gain
      const cur = this._npcGold.get(receiverNationId) ?? 0;
      this._npcGold.set(receiverNationId, Math.min(NPC_GOLD_CAP, cur + gold));
      return { type: 'player_gift_delivered', missive, delta: capped };
    }

    // ── War declaration ──────────────────────────────────────────────────────
    if (type === 'war_declaration') {
      this.declareWar(_PLAYER_NATION_ID, receiverNationId);
      const reason = missive.reason ?? '';
      const hasReason = reason.length > 0;
      // With a stated reason the direct relation penalty is smaller and ripple is halved.
      const directDelta = hasReason
        ? -(15 + Math.floor(Math.random() * 10)) // -15 … -24
        : -(25 + Math.floor(Math.random() * 15)); // -25 … -39
      this.modifyPlayerRelation(receiverNationId, directDelta);
      this._addMemoryEntry(
        receiverNationId,
        `玩家正式向我國宣戰${hasReason ? `（理由：${reason}）` : '（無正當理由）'}，關係 ${directDelta}`,
        directDelta,
      );
      // Ripple to third parties
      const nations = this.nationSystem.nations;
      nations.forEach((n, cId) => {
        if (!n || cId === receiverNationId) return;
        const cToTarget = this.getRelation(cId, receiverNationId);
        let ripple = 0;
        if (cToTarget >= 60) {
          const base = -(5 + Math.floor(Math.random() * 10));
          ripple = Math.round(base * this._distanceFactor(cId, receiverNationId) * (hasReason ? 0.5 : 1));
        } else if (cToTarget <= -60) {
          const base = 3 + Math.floor(Math.random() * 7);
          ripple = Math.round(base * this._distanceFactor(cId, receiverNationId));
        }
        if (ripple !== 0) this.modifyPlayerRelation(cId, ripple);
      });
      return { type: 'player_war_declared', missive, directDelta };
    }

    // ── Trade-route request ──────────────────────────────────────────────────
    if (type === 'trade_request') {
      // Surface to the player (GameUI decides whether to accept/reject via UI).
      return { type: 'npc_trade_request', missive };
    }

    // ── Peace treaty ────────────────────────────────────────────────────────
    const terms = missive.terms ?? {};

    // NPC receives player's peace offer → evaluate acceptance
    if (senderNationId === _PLAYER_NATION_ID && receiverNationId >= 0) {
      const accepted = this._npcEvaluatePeaceOffer(receiverNationId, terms);
      return { type: 'npc_response', missive, accepted };
    }

    // Player receives NPC's peace offer → surface to GameUI
    if (receiverNationId === _PLAYER_NATION_ID && senderNationId >= 0) {
      return { type: 'player_offer', missive };
    }

    // NPC-NPC peace (simplified)
    const accepted = Math.random() < NPC_NPC_PEACE_ACCEPT_CHANCE;
    if (accepted) {
      this.applyPeaceTreaty(senderNationId, receiverNationId, terms);
    }
    return { type: 'npc_npc', missive, accepted };
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
   * Transfer all sovereignty claims of an extinct nation to the player.
   * Safe to call multiple times (idempotent once the claim set is empty).
   * @param {number} nationId  The extinct NPC nation id.
   */
  handleNationExtinction(nationId) {
    if (nationId < 0) return;
    const sovSet = this._sovereigntyMap.get(nationId);
    if (!sovSet || sovSet.size === 0) return;

    if (!this._sovereigntyMap.has(_PLAYER_NATION_ID)) {
      this._sovereigntyMap.set(_PLAYER_NATION_ID, new Set());
    }
    const playerSov = this._sovereigntyMap.get(_PLAYER_NATION_ID);
    sovSet.forEach(key => playerSov.add(key));
    sovSet.clear();
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
    // Conquest streak decays by 1 per day so a period of peace gradually
    // reduces the world-wide fear bonus.
    if (this._playerConquestStreak > 0) {
      this._playerConquestStreak--;
    }
    // Re-compute surrender indices and schedule a fresh worker pass for next cycle.
    this._scheduleWorkerUpdate();
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
      // Skip extinct nations – they have no influence and should not condemn anyone.
      if (this.nationSystem.isNationExtinct(id)) return;

      // Stagger: each nation processes its daily diplomatic events on its own
      // day offset so that all nations do not fire simultaneously on every day.
      if ((this._currentDay % NPC_ACTION_STAGGER_PERIOD) !== (id % NPC_ACTION_STAGGER_PERIOD)) return;

      const p            = this._rulerPersonality(s);
      const rulerTraits  = s.ruler?.traits ?? [];
      const roll         = Math.random();
      const nationName   = nations[id]?.name ?? s.name;

      // 善交際 (Diplomat) trait increases the probability of positive interactions.
      const diplomatBonus = rulerTraits.includes('善交際') ? 0.08 : 0.0;

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
      } else if (p === PERSONALITY_WARLIKE) {
        // Warlike ruler threatens the player.
        // 一絲不苟 (Meticulous) slightly dampens aggression (prefers economy first).
        const warChance = rulerTraits.includes('一絲不苟') ? 0.12 : 0.20;
        if (roll < warChance) {
          const delta = -(Math.floor(Math.random() * 8) + 5); // -5 … -12
          this.modifyPlayerRelation(id, delta);
          this._addMemoryEntry(id, `我方統治者向玩家發出戰爭威脅，關係 ${delta}`, delta);
          events.push({
            nationId: id,
            delta,
            message: `⚠ ${s.ruler.name}（${s.ruler.role}）對你發出戰爭威脅，與 ${nationName} 的關係惡化 ${delta}。`,
          });
        }
      } else if (p === PERSONALITY_GENTLE && roll < 0.15 + diplomatBonus) {
        // Gentle ruler sends goodwill; 善交際 increases the chance.
        const delta = Math.floor(Math.random() * 6) + 3; // +3 … +8
        this.modifyPlayerRelation(id, delta);
        this._addMemoryEntry(id, `我方統治者主動向玩家釋出善意，關係 +${delta}`, delta);
        events.push({
          nationId: id,
          delta,
          message: `🕊 ${s.ruler.name}（${s.ruler.role}）主動釋出善意，與 ${nationName} 的關係改善 +${delta}。`,
        });
      } else if (rulerTraits.includes('善交際') && roll < 0.10 + diplomatBonus) {
        // 善交際 rulers proactively build good relations even without a gentle personality.
        const delta = Math.floor(Math.random() * 4) + 2; // +2 … +5
        this.modifyPlayerRelation(id, delta);
        this._addMemoryEntry(id, `善交際統治者主動親善，關係 +${delta}`, delta);
        events.push({
          nationId: id,
          delta,
          message: `🤝 ${s.ruler.name}（${s.ruler.role}）以外交手腕增進了與你的關係 +${delta}。`,
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
      // ── NPC peace initiative ──────────────────────────────────────────────
      // When a nation is under heavy pressure and at war with the player, it may
      // spontaneously send a peace treaty missive to the nearest player settlement.
      this.updateSurrenderIndex(id);
      if (this.getSurrenderIndex(id) > 65 && this.isAtWar(id, _PLAYER_NATION_ID)) {
        const hasPendingToPlayer = this._pendingMissives.some(
          m => m.senderNationId === id && m.receiverNationId === _PLAYER_NATION_ID,
        );
        if (!hasPendingToPlayer && Math.random() < 0.25) {
          const fromPx = _marchCastlePx(this._mapData.castles[id]);
          const toPx   = fromPx ? this._findNearestPlayerSettlement(fromPx) : null;
          if (fromPx && toPx) {
            const offeredGold = Math.floor((this._npcGold.get(id) ?? 0) * NPC_PEACE_OFFER_GOLD_RATIO);
            const terms = {
              goldFromSender: 0,
              goldFromNpc:    offeredGold,
              playerAcknowledgesDefeat: false,
              npcAcknowledgesDefeat:    false,
              cededBySender:   [],
              cededByReceiver: [],
            };
            this.sendPeaceTreaty({ senderNationId: id, receiverNationId: _PLAYER_NATION_ID, fromPx, terms });
            events.push({
              nationId: id,
              delta:    0,
              message:  `🕊 ${nationName} 派出和談使者，前往你的領地……`,
            });
          }
        }
      }
    });

    return events;
  }

  /**
   * Find an NPC nation that `id` has a relation with strictly below `maxRel`
   * (the most hostile one).  Returns -1 if none found.
   * @param {number} id
   * @param {number} maxRel  Strict upper bound for hostility (e.g. -10 means "relation < -10").
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
      if (rel < worstRel) { worstRel = rel; targetId = tid; }
    });
    return targetId;
  }

  /**
   * Find an NPC nation that `id` has a relation with strictly above `minRel`
   * (the friendliest one), excluding the same nation.  Returns -1 if none found.
   * @param {number} id
   * @param {number} minRel  Strict lower bound for friendliness (e.g. 0 = relation > 0).
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
      if (rel > bestRel) { bestRel = rel; targetId = tid; }
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

  /** @returns {object} Serialisable game state snapshot. */
  getState() {
    return {
      playerRelations:       [...this._playerRelations.entries()],
      npcRelations:          [...this._npcRelations.entries()],
      nationMemory:          [...this._nationMemory.entries()],
      currentDay:            this._currentDay,
      surrenderIndex:        [...this._surrenderIndex.entries()],
      npcGold:               [...this._npcGold.entries()],
      npcArmies:             [...this._npcArmies.entries()],
      warPairs:              [...this._warPairs],
      nonAggressionPacts:    [...this._nonAggressionPacts],
      mutualProtectionPacts: [...this._mutualProtectionPacts],
      playerConquestStreak:  this._playerConquestStreak,
      activeTradeRoutes:     [...this._activeTradeRoutes.entries()].map(([key, v]) => ({ key, ...v })),
    };
  }

  /**
   * Restore from a saved snapshot.
   * @param {object|null} state
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
    // Restore war state: use saved pairs if present, otherwise detect from control vs nationality.
    if (Array.isArray(state.warPairs)) {
      state.warPairs.forEach(key => {
        if (typeof key === 'string') this._warPairs.add(key);
      });
    } else {
      this._detectCurrentWars();
    }
    // Restore pact state.
    if (Array.isArray(state.nonAggressionPacts)) {
      state.nonAggressionPacts.forEach(key => {
        if (typeof key === 'string') this._nonAggressionPacts.add(key);
      });
    }
    if (Array.isArray(state.mutualProtectionPacts)) {
      state.mutualProtectionPacts.forEach(key => {
        if (typeof key === 'string') this._mutualProtectionPacts.add(key);
      });
    }
    if (typeof state.playerConquestStreak === 'number') {
      this._playerConquestStreak = Math.max(0, Math.floor(state.playerConquestStreak));
    }
    // Restore active trade routes.
    if (Array.isArray(state.activeTradeRoutes)) {
      state.activeTradeRoutes.forEach(r => {
        if (r && typeof r.key === 'string') {
          this._activeTradeRoutes.set(r.key, {
            nationA:     Number(r.nationA),
            nationB:     Number(r.nationB),
            dailyIncome: Number(r.dailyIncome) || TRADE_ROUTE_DAILY_INCOME,
            startDay:    Number(r.startDay)    || this._currentDay,
          });
        }
      });
    }
  }
}
