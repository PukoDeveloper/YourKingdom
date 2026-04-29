/**
 * npc-ai.worker.js – Web Worker for NPC AI decision-tree computation.
 *
 * This worker receives a serialised snapshot of the game state and returns
 * a priority-ordered list of action decisions for each NPC nation.  All
 * heavy evaluation (trait modifiers, weakness scores, diplomatic probability
 * calculations) runs off the main thread; the main thread only executes
 * the resulting actions (pathfinding, state mutation).
 *
 * Message in  → { type: 'compute', state: NpcAiSnapshot }
 * Message out → { decisions: NpcDecision[] }
 *
 * @typedef {{
 *   nations:               ({ id: number, name: string }|null)[],
 *   settlements:           SettlementSnap[],
 *   npcRelations:          [string, number][],
 *   playerRelations:       [number, number][],
 *   npcGold:               [number, number][],
 *   garrisonSizes:         [string, number][],
 *   warPairs:              string[],
 *   nonAggressionPacts:    string[],
 *   mutualProtectionPacts: string[],
 *   surrenderIndices:      [number, number][],
 *   currentDay:            number,
 *   pendingMarchNationIds: number[],
 *   pendingMissiveNationIds: number[],
 *   activeTradeRouteKeys:  string[],
 * }} NpcAiSnapshot
 *
 * @typedef {{
 *   idx:                number,
 *   type:               'castle'|'village',
 *   nationId:           number,
 *   controllingNationId: number,
 *   economyLevel:       number,
 *   resources:          string[],
 *   rulerTraits:        string[],
 *   buildingTypes:      string[],
 * }} SettlementSnap
 *
 * @typedef {{
 *   nationId:        number,
 *   type:            string,
 *   priority:        number,
 *   targetNationId?: number,
 *   targetType?:     'castle'|'village',
 *   targetIdx?:      number,
 *   settlementKey?:  string,
 *   buildingType?:   string,
 *   cost?:           number,
 * }} NpcDecision
 */

// ---------------------------------------------------------------------------
// Duplicated constants (no imports in a classic Web Worker)
// ---------------------------------------------------------------------------

const PERSONALITY_GENTLE   = '溫和';
const PERSONALITY_CAUTIOUS = '謹慎';
const PERSONALITY_CUNNING  = '狡猾';
const PERSONALITY_ARROGANT = '傲慢';
const PERSONALITY_WARLIKE  = '好戰';

const ALL_PERSONALITIES = [
  PERSONALITY_GENTLE,
  PERSONALITY_CAUTIOUS,
  PERSONALITY_CUNNING,
  PERSONALITY_ARROGANT,
  PERSONALITY_WARLIKE,
];

const TRAIT_ATHLETE    = '天生運動員';
const TRAIT_METICULOUS = '一絲不苟';
const TRAIT_DIPLOMAT   = '善交際';
const TRAIT_BRAVE      = '勇猛';
const TRAIT_TACTICIAN  = '策略家';
const TRAIT_SHIELDWALL = '銅牆鐵壁';

const BLDG_GENERAL    = 'general_store';
const BLDG_BLACKSMITH = 'blacksmith';
const BLDG_MAGE       = 'mage_pavilion';
const BLDG_TAVERN     = 'tavern';
const BLDG_INN        = 'inn';

/** NPC gold cost to construct each building type. */
const NPC_BUILD_COSTS = {
  [BLDG_INN]:        80,
  [BLDG_GENERAL]:   100,
  [BLDG_TAVERN]:    150,
  [BLDG_BLACKSMITH]: 200,
  [BLDG_MAGE]:      250,
};

/** Minimum player-relation threshold for NPCs to propose a trade route. */
const TRADE_ROUTE_MIN_RELATION = -10;

/** Minimum gold required before a meticulous NPC considers building construction. */
const METICULOUS_BUILD_THRESHOLD = 80;

/** Minimum gold required before any NPC considers building construction. */
const DEFAULT_BUILD_THRESHOLD = 120;

/** Default build priority order (Tavern → General → Blacksmith → Inn → Mage). */
const DEFAULT_BUILD_ORDER = Object.freeze([BLDG_TAVERN, BLDG_GENERAL, BLDG_BLACKSMITH, BLDG_INN, BLDG_MAGE]);

/**
 * Minimum relation for an NPC–NPC NAP proposal.
 * Only nations that are somewhat hostile but not at war will propose it.
 */
const NAP_PROPOSAL_REL_MIN = -50;
const NAP_PROPOSAL_REL_MAX = 20;

/** Minimum NPC–NPC relation for a mutual protection pact proposal. */
const MPP_PROPOSAL_REL_MIN = 45;

const _PLAYER_NATION_ID = -1;

const NPC_ACTION_STAGGER_PERIOD = 2;

/** Garrison unit threshold below which a nation is considered critically weak. */
const CRITICAL_GARRISON = 2;

/** Loss ratio above which a nation is considered to be losing badly. */
const CRISIS_LOSS_RATIO = 0.6;

/** Surrender index above which a nation will seek peace with the player. */
const PEACE_SURRENDER_THRESHOLD = 65;

/** WAR personality threshold: personality → minimum weakness score to attack. */
const WAR_THRESHOLD = {
  [PERSONALITY_WARLIKE]:  20,
  [PERSONALITY_ARROGANT]: 35,
  [PERSONALITY_CUNNING]:  55,
  [PERSONALITY_CAUTIOUS]: 70,
  [PERSONALITY_GENTLE]:   90,
};

// Decision priority levels (higher = processed first).
const PRIORITY_CRISIS     = 4;
const PRIORITY_MILITARY   = 3;
const PRIORITY_DIPLOMATIC = 2;
const PRIORITY_ECONOMIC   = 1;

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/** Extract personality trait from ruler trait array. */
function _getPersonality(rulerTraits) {
  return rulerTraits.find(t => ALL_PERSONALITIES.includes(t)) ?? PERSONALITY_CAUTIOUS;
}

/** Get relation between two nations (supports player id = -1). */
function _getRelation(relNpcMap, relPlayerMap, idA, idB) {
  if (idA === idB) return 100;
  if (idA === _PLAYER_NATION_ID || idB === _PLAYER_NATION_ID) {
    const npcId = idA === _PLAYER_NATION_ID ? idB : idA;
    return relPlayerMap.get(npcId) ?? 0;
  }
  const key = idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
  return relNpcMap.get(key) ?? 0;
}

function _isAtWar(warSet, idA, idB) {
  const a = Math.min(idA, idB);
  const b = Math.max(idA, idB);
  return warSet.has(`${a}:${b}`);
}

function _hasNap(napSet, idA, idB) {
  const a = Math.min(idA, idB);
  const b = Math.max(idA, idB);
  return napSet.has(`${a}:${b}`);
}

function _hasMpp(mppSet, idA, idB) {
  const a = Math.min(idA, idB);
  const b = Math.max(idA, idB);
  return mppSet.has(`${a}:${b}`);
}

function _hasActiveTradeRoute(tradeRouteSet, idA, idB) {
  const a = Math.min(idA, idB);
  const b = Math.max(idA, idB);
  // Check both NPC-NPC and NPC-player routes
  return tradeRouteSet.has(`${a}:${b}`);
}

// ---------------------------------------------------------------------------
// Decision-tree computation (one nation at a time)
// ---------------------------------------------------------------------------

/**
 * Run the priority-ordered decision tree for a single NPC nation.
 *
 * Returns at most ONE decision per nation (the highest-priority action found).
 * Returns null when no action is warranted this cycle.
 *
 * @param {number}          id         Nation id
 * @param {NpcAiSnapshot}   snap       Deserialised snapshot
 * @param {Map<string,number>} relNpc
 * @param {Map<number,number>} relPlayer
 * @param {Map<number,number>} goldMap
 * @param {Map<string,number>} garrisonMap
 * @param {Set<string>}     warSet
 * @param {Set<string>}     napSet
 * @param {Set<string>}     mppSet
 * @param {Set<string>}     tradeRouteSet
 * @param {Map<number,number>} surrenderMap
 * @param {Set<number>}     marchSet
 * @param {Set<number>}     missiveSet
 * @returns {NpcDecision|null}
 */
function _decideForNation(
  id, snap,
  relNpc, relPlayer, goldMap, garrisonMap,
  warSet, napSet, mppSet, tradeRouteSet, surrenderMap,
  marchSet, missiveSet,
) {
  const { nations, settlements, currentDay } = snap;

  // Apply per-nation day stagger so all nations do not act simultaneously.
  if ((currentDay % NPC_ACTION_STAGGER_PERIOD) !== (id % NPC_ACTION_STAGGER_PERIOD)) return null;

  // Nation must control its own home castle.
  const homeCastle = settlements.find(
    s => s.type === 'castle' && s.nationId === id && s.controllingNationId === id,
  );
  if (!homeCastle) return null;

  const rulerTraits  = homeCastle.rulerTraits ?? [];
  const personality  = _getPersonality(rulerTraits);
  const gold         = goldMap.get(id) ?? 0;
  const garrison     = garrisonMap.get(`castle:${id}`) ?? 0;
  const surrenderIdx = surrenderMap.get(id) ?? 0;

  // Compute territorial loss ratio.
  const ownAll  = settlements.filter(s => s.nationId === id);
  const lostAll = ownAll.filter(s => s.controllingNationId !== id);
  const lossRatio = ownAll.length > 0 ? lostAll.length / ownAll.length : 0;

  // Wars this nation is involved in.
  const atWarWithPlayer = _isAtWar(warSet, id, _PLAYER_NATION_ID);
  const warsWithNpcs    = nations
    .map((_, tid) => tid)
    .filter(tid => tid !== id && nations[tid] && _isAtWar(warSet, id, tid));

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 1 – CRISIS (checked first – immediate existential threats)
  // ──────────────────────────────────────────────────────────────────────────

  // 1a. Under heavy player pressure → spontaneous peace initiative.
  if (atWarWithPlayer && surrenderIdx > PEACE_SURRENDER_THRESHOLD) {
    if (!missiveSet.has(id) && Math.random() < 0.25) {
      return { nationId: id, type: 'peace_initiative', priority: PRIORITY_CRISIS };
    }
  }

  // 1b. Lost most territory AND garrison critically low → emergency recruit.
  if (lossRatio > CRISIS_LOSS_RATIO && garrison < CRITICAL_GARRISON) {
    return { nationId: id, type: 'emergency_recruit', priority: PRIORITY_CRISIS };
  }

  // 1c. At war with NPC AND garrison critically low → seek ally.
  if (warsWithNpcs.length > 0 && garrison < CRITICAL_GARRISON) {
    let bestAllyId = -1;
    let bestRel    = 20;
    nations.forEach((n, aid) => {
      if (!n || aid === id) return;
      if (_isAtWar(warSet, id, aid)) return;
      const rel = _getRelation(relNpc, relPlayer, id, aid);
      if (rel > bestRel) { bestRel = rel; bestAllyId = aid; }
    });
    if (bestAllyId >= 0) {
      return {
        nationId:       id,
        type:           'seek_ally',
        targetNationId: bestAllyId,
        priority:       PRIORITY_CRISIS,
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 2 – MILITARY
  // ──────────────────────────────────────────────────────────────────────────

  if (!marchSet.has(id) && garrison >= CRITICAL_GARRISON) {
    // Effective war threshold modified by traits.
    const baseThreshold = WAR_THRESHOLD[personality] ?? 55;
    // 勇猛 (Brave): more aggressive – lowers the threshold.
    const braveAdj     = rulerTraits.includes(TRAIT_BRAVE)     ? -10 : 0;
    // 策略家 (Tactician): more careful – raises the threshold.
    const tacticianAdj = rulerTraits.includes(TRAIT_TACTICIAN) ?  10 : 0;
    const effectiveThreshold = baseThreshold + braveAdj + tacticianAdj;

    let bestTarget   = null;
    let bestWeakness = effectiveThreshold;

    nations.forEach((_, tid) => {
      if (tid === id || !nations[tid]) return;
      const rel = _getRelation(relNpc, relPlayer, id, tid);
      if (rel > -20) return;                    // not hostile enough
      if (_hasNap(napSet, id, tid)) return;     // NAP prevents attack

      // Evaluate each settlement controlled by the target nation.
      settlements.forEach(ts => {
        if (ts.controllingNationId !== tid) return;
        const defGarrison = garrisonMap.get(`${ts.type}:${ts.idx}`) ?? 0;
        const weakness = Math.max(0, (1 - defGarrison / 10) * 60) + ts.economyLevel * 4;
        if (weakness > bestWeakness) {
          bestWeakness = weakness;
          bestTarget   = { nationId: tid, targetType: ts.type, targetIdx: ts.idx };
        }
      });
    });

    if (bestTarget) {
      // 銅牆鐵壁 (Shieldwall): defensive-minded ruler – half the attack probability.
      const shieldwallMult = rulerTraits.includes(TRAIT_SHIELDWALL) ? 0.5 : 1.0;
      if (Math.random() < shieldwallMult) {
        return {
          nationId: id,
          type:     'attack',
          priority: PRIORITY_MILITARY,
          ...bestTarget,
        };
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 3 – DIPLOMATIC
  // ──────────────────────────────────────────────────────────────────────────

  const diplomatBonus  = rulerTraits.includes(TRAIT_DIPLOMAT)  ? 0.20 : 0.0;
  const athleteBonus   = rulerTraits.includes(TRAIT_ATHLETE)   ? 0.05 : 0.0;

  // 3a. NPC–NPC Non-Aggression Pact proposal.
  {
    let napTargetId = -1;
    let napBestRel  = NAP_PROPOSAL_REL_MIN - 1; // start below the valid range
    nations.forEach((n, tid) => {
      if (!n || tid === id) return;
      if (_isAtWar(warSet, id, tid))  return; // already at war
      if (_hasNap(napSet, id, tid))   return; // already have one
      const rel = _getRelation(relNpc, relPlayer, id, tid);
      if (rel >= NAP_PROPOSAL_REL_MIN && rel < NAP_PROPOSAL_REL_MAX && rel > napBestRel) {
        napBestRel  = rel;
        napTargetId = tid;
      }
    });

    if (napTargetId >= 0) {
      let chance = 0.08 + diplomatBonus;
      if (personality === PERSONALITY_GENTLE)   chance += 0.05;
      if (personality === PERSONALITY_CAUTIOUS) chance += 0.03;
      if (personality === PERSONALITY_WARLIKE)  chance -= 0.05;
      if (Math.random() < Math.max(0, chance)) {
        return {
          nationId:       id,
          type:           'nap_proposal',
          targetNationId: napTargetId,
          priority:       PRIORITY_DIPLOMATIC,
        };
      }
    }
  }

  // 3b. NPC–NPC Mutual Protection Pact proposal.
  {
    let mppTargetId = -1;
    let mppBestRel  = MPP_PROPOSAL_REL_MIN - 1;
    nations.forEach((n, tid) => {
      if (!n || tid === id) return;
      if (_hasMpp(mppSet, id, tid)) return; // already have one
      const rel = _getRelation(relNpc, relPlayer, id, tid);
      if (rel >= MPP_PROPOSAL_REL_MIN && rel > mppBestRel) {
        mppBestRel  = rel;
        mppTargetId = tid;
      }
    });

    if (mppTargetId >= 0) {
      let chance = 0.06 + diplomatBonus;
      if (personality === PERSONALITY_GENTLE)   chance += 0.08;
      if (personality === PERSONALITY_CAUTIOUS) chance += 0.04;
      if (personality === PERSONALITY_WARLIKE)  chance -= 0.06;
      if (Math.random() < Math.max(0, chance)) {
        return {
          nationId:       id,
          type:           'mpp_proposal',
          targetNationId: mppTargetId,
          priority:       PRIORITY_DIPLOMATIC,
        };
      }
    }
  }

  // 3c. Trade route request to player.
  {
    const relWithPlayer = relPlayer.get(id) ?? 0;
    const alreadyHasRoute = _hasActiveTradeRoute(tradeRouteSet, id, _PLAYER_NATION_ID);
    if (!alreadyHasRoute && relWithPlayer >= TRADE_ROUTE_MIN_RELATION) {
      const chance = 0.05 + diplomatBonus + athleteBonus;
      // 狡猾 (Cunning) rulers also value economic opportunities.
      const cunningAdj = personality === PERSONALITY_CUNNING ? 0.03 : 0;
      if (Math.random() < Math.max(0, chance + cunningAdj)) {
        return {
          nationId: id,
          type:     'trade_request',
          priority: PRIORITY_DIPLOMATIC,
        };
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 4 – ECONOMIC (building construction)
  // ──────────────────────────────────────────────────────────────────────────

  {
    // 一絲不苟 (Meticulous) rulers invest earlier (lower gold threshold).
    const goldThreshold = rulerTraits.includes(TRAIT_METICULOUS)
      ? METICULOUS_BUILD_THRESHOLD
      : DEFAULT_BUILD_THRESHOLD;
    if (gold >= goldThreshold) {
      const existingTypes = new Set(homeCastle.buildingTypes);

      // Build a prioritised order without duplicates based on active traits.
      // Start with trait-specific priorities, then append remaining defaults.
      const prioritySet = new Set();
      if (rulerTraits.includes(TRAIT_SHIELDWALL)) {
        prioritySet.add(BLDG_INN);
        prioritySet.add(BLDG_BLACKSMITH);
      }
      if (rulerTraits.includes(TRAIT_METICULOUS)) {
        prioritySet.add(BLDG_TAVERN);
        prioritySet.add(BLDG_GENERAL);
      }
      // Append remaining types from the default order without repeating.
      for (const t of DEFAULT_BUILD_ORDER) prioritySet.add(t);
      const buildOrder = [...prioritySet];

      for (const bType of buildOrder) {
        if (existingTypes.has(bType)) continue;
        const cost = NPC_BUILD_COSTS[bType] ?? 150;
        if (gold >= cost) {
          return {
            nationId:      id,
            type:          'build',
            settlementKey: `castle:${id}`,
            buildingType:  bType,
            cost,
            priority:      PRIORITY_ECONOMIC,
          };
        }
      }
    }
  }

  return null; // no action this cycle
}

// ---------------------------------------------------------------------------
// Main computation entry point
// ---------------------------------------------------------------------------

/**
 * Compute AI decisions for every NPC nation in one pass.
 * @param {NpcAiSnapshot} snap
 * @returns {NpcDecision[]}
 */
function computeDecisions(snap) {
  const {
    nations,
    npcRelations,
    playerRelations,
    npcGold,
    garrisonSizes,
    warPairs,
    nonAggressionPacts,
    mutualProtectionPacts,
    surrenderIndices,
    pendingMarchNationIds,
    pendingMissiveNationIds,
    activeTradeRouteKeys,
  } = snap;

  // Reconstruct Maps / Sets from serialised arrays.
  const relNpc        = new Map(npcRelations);
  const relPlayer     = new Map(playerRelations);
  const goldMap       = new Map(npcGold);
  const garrisonMap   = new Map(garrisonSizes);
  const surrenderMap  = new Map(surrenderIndices);
  const warSet        = new Set(warPairs);
  const napSet        = new Set(nonAggressionPacts);
  const mppSet        = new Set(mutualProtectionPacts);
  const tradeRouteSet = new Set(activeTradeRouteKeys ?? []);
  const marchSet      = new Set(pendingMarchNationIds);
  const missiveSet    = new Set(pendingMissiveNationIds);

  const decisions = [];

  nations.forEach((nation, id) => {
    if (!nation) return;
    const decision = _decideForNation(
      id, snap,
      relNpc, relPlayer, goldMap, garrisonMap,
      warSet, napSet, mppSet, tradeRouteSet, surrenderMap,
      marchSet, missiveSet,
    );
    if (decision) decisions.push(decision);
  });

  return decisions;
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = function onWorkerMessage(e) {
  if (!e.data || e.data.type !== 'compute') return;
  try {
    const decisions = computeDecisions(e.data.state);
    self.postMessage({ decisions });
  } catch (err) {
    // Surface errors back to main thread for debugging.
    self.postMessage({ decisions: [], error: String(err) });
  }
};
