import { Inventory }                      from '../systems/Inventory.js';
import { Army, MAX_MEMBERS, TRAIT_CAPTAIN } from '../systems/Army.js';
import { TRAIT_RULER, PLAYER_NATION_ID, NEUTRAL_NATION_ID, generateNeutralRuler }   from '../systems/NationSystem.js';
import { AssignmentSystem } from '../systems/AssignmentSystem.js';
import {
  RELATION_LEVELS,
  PERSONALITY_COLORS,
  PERSONALITY_ARROGANT, PERSONALITY_WARLIKE, PERSONALITY_GENTLE,
  PERSONALITY_CUNNING,  PERSONALITY_CAUTIOUS, ALL_PERSONALITIES,
  GARRISON_TAX_PENALTY_PER_UNIT,
  TRADE_ROUTE_DAILY_INCOME,
} from '../systems/DiplomacySystem.js';
import {
  renderFlagHTML,
  renderCharHTML,
  charAppearanceFromIndices,
  flagAppFromIndices,
  CHAR_BODY_COLORS_CSS,
  CHAR_HEADGEAR_TYPES,
  CHAR_HEADGEAR_LABELS,
  CHAR_ARMOR_COLORS_CSS,
  CHAR_MARK_COLORS_CSS,
  CHAR_BODY_SHAPES,
  CHAR_BODY_SHAPE_LABELS,
  CHAR_FACE_ACCESSORIES,
  CHAR_FACE_ACCESSORY_LABELS,
  FLAG_BG_COLORS,
  FLAG_STRIPE_COLORS,
  FLAG_STRIPE_STYLES,
  FLAG_SYMBOL_LABELS,
  FLAG_SYMBOLS,
} from '../systems/AppearanceSystem.js';
import {
  BuildingSystem,
  Building,
  BLDG_PALACE, BLDG_CHIEF_HOUSE,
  BLDG_GENERAL, BLDG_BLACKSMITH, BLDG_MAGE, BLDG_TAVERN, BLDG_INN,
  BUILDING_META,
  CATALOG_GENERAL, CATALOG_BLACKSMITH, CATALOG_MAGE, CATALOG_TAVERN_FOOD,
  RESOURCE_BASE_PRICE,
} from '../systems/BuildingSystem.js';
import { TERRAIN, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from '../world/constants.js';
import {
  TRAIT_DEFS,
  getTaxBonus,
  getTradeBonus,
  getConstructBonus,
  getUnitMoveSpeed,
  renderTraitBadgesHTML,
} from '../systems/CharacterSystem.js';
import { buildPath } from '../world/NpcPathfinder.js';

/** Display labels for FLAG_STRIPE_STYLES (same order). */
const _STRIPE_STYLE_LABELS = ['無', '橫紋', '縱紋', '斜紋', '十字', '箭形', '三色橫', '三色縱', '斜十字', '邊框'];

/** Kingdom type definitions. requiresSettlement = true means locked until the player controls a settlement. */
const _KINGDOM_TYPES = [
  { id: '騎士團', requiresSettlement: false },
  { id: '王國',   requiresSettlement: true  },
  { id: '公國',   requiresSettlement: true  },
  { id: '帝國',   requiresSettlement: true  },
  { id: '聯邦',   requiresSettlement: true  },
  { id: '部落',   requiresSettlement: true  },
];

/** Default player kingdom state. */
const DEFAULT_KINGDOM = {
  name:               '我的騎士團',
  type:               '騎士團',
  flagBgIdx:          0,
  flagStripeStyleIdx: 0,
  flagStripeColorIdx: 0,
  flagSymbolIdx:      0,
};

/** Default appearance indices used when no player is available. */
const DEFAULT_APPEARANCE_INDICES = { bodyColorIdx: 0, headgearIdx: 0, armorColorIdx: 0, markColorIdx: 0, bodyShapeIdx: 0, faceAccIdx: 0 };

/**
 * Compute the world-pixel position at fraction `t` (0→1) along a waypoint path.
 * Returns the last waypoint when t >= 1.
 * @param {{ x: number, y: number }[]} path
 * @param {number} t  Fraction in [0, 1]
 * @returns {{ x: number, y: number }}
 */
function _positionAlongPath(path, t) {
  if (!path || path.length < 2) return path?.[0] ?? { x: 0, y: 0 };
  let totalLen = 0;
  const segs = [];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    const d  = Math.sqrt(dx * dx + dy * dy);
    segs.push(d);
    totalLen += d;
  }
  if (totalLen === 0) return path[0];
  const target = Math.min(t, 1) * totalLen;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i] >= target) {
      const segT = segs[i] > 0 ? (target - acc) / segs[i] : 0;
      return {
        x: path[i].x + (path[i + 1].x - path[i].x) * segT,
        y: path[i].y + (path[i + 1].y - path[i].y) * segT,
      };
    }
    acc += segs[i];
  }
  return path[path.length - 1];
}

/** Terrain themes applied to the battle scene background. */
const _BATTLE_THEMES = {
  castle:  {
    name:   '🏰 城堡攻防戰',
    bg:     'linear-gradient(180deg, #0d1020 0%, #1a1a2a 55%, #2a2a1a 100%)',
  },
  village: {
    name:   '🏘 村落爭奪戰',
    bg:     'linear-gradient(180deg, #0d2010 0%, #122a14 55%, #1a3a10 100%)',
  },
  port:    {
    name:   '⚓ 港口爭奪戰',
    bg:     'linear-gradient(180deg, #091a2a 0%, #0d2030 55%, #0d2820 100%)',
  },
  grass:   {
    name:   '🌿 草原野戰',
    bg:     'linear-gradient(180deg, #182a14 0%, #0d2410 55%, #1a3a10 100%)',
  },
};

/**
 * Amount of HP a unit recovers per in-game day (10% of maxHp, minimum 1).
 * @param {number} maxHp
 * @returns {number}
 */
function _dailyHpRecovery(maxHp) {
  return Math.max(1, Math.floor(maxHp * 0.1));
}

/** Greeting lines spoken by government-building NPCs. */
const _GOV_GREETING = {
  palace:      '本王近來為治理疆土而殫精竭慮，汝此番到訪，所為何事？',
  chief_house: '哎呀，稀客稀客！快請進，我讓內人沏茶。近來村裡一切都好，有勞掛念。',
};

/**
 * Escape a string for safe use inside an HTML attribute value.
 * @param {string} s
 * @returns {string}
 */
function _escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Player nation ID constant (mirrors NationSystem value). */
const _PLAYER_NATION_ID_UI = -1;

/** Minimum NPC hostility value (relation ≤ this) for joint-war target eligibility. */
const _JOINT_WAR_HOSTILITY_THRESHOLD = -30;

// ---------------------------------------------------------------------------
// Construction system constants
// ---------------------------------------------------------------------------

/** Maximum total buildings per settlement type (including the government building). */
const CONSTR_MAX_BUILDINGS = { castle: 6, village: 4 };

/** Days required to construct a new building. */
const CONSTR_BUILDING_DAYS = 10;

// ---------------------------------------------------------------------------
// Map building constants
// ---------------------------------------------------------------------------

/** Gold cost to build a lumber camp on a FOREST tile. */
const MAP_BLDG_LUMBER_CAMP_COST = 50;

/** Gold cost to build a mine on a MOUNTAIN tile. */
const MAP_BLDG_MINE_COST = 80;

/** Gold cost to build a bridge on a WATER tile. */
const MAP_BLDG_BRIDGE_COST = 60;

/** Gold delivered per lumber camp worker arrival. */
const MAP_BLDG_LUMBER_GOLD = 5;

/** Gold delivered per mine worker arrival. */
const MAP_BLDG_MINE_GOLD = 8;

/**
 * Number of working phases (白天/黃昏) between worker spawns.
 * 2 phases = ~1 in-game day.
 */
const MAP_BLDG_SPAWN_INTERVAL = 2;

/** Maximum Manhattan tile distance from building to city for workers to spawn. */
const MAP_BLDG_WORKER_REACH = 10;

/** A* traversal cost when crossing a bridge tile (treated as slightly costly land). */
const ROAD_PATH_COST_BRIDGE = 1.5;

/** Gold cost per road tile when the tile has a bridge. */
const ROAD_GOLD_PER_TILE_BRIDGE = 40;

/** Work-hours per road tile when the tile has a bridge. */
const ROAD_HOURS_PER_TILE_BRIDGE = 4.0;

/** Gold cost per tile to build a road (fallback for unknown terrain). */
const CONSTR_ROAD_COST_PER_TILE = 20;

/** In-game hours to build one road tile (fallback for unknown terrain). */
const CONSTR_ROAD_HOURS_PER_TILE = 3;

/** In-game hours to demolish one road tile (work hours only). */
const CONSTR_ROAD_DEMO_HOURS_PER_TILE = 0.5;

/**
 * Maximum tile radius to search when snapping a settlement centre to the
 * nearest non-impassable tile (used in _computeRoadPath).
 */
const ROAD_SNAP_RADIUS = 8;

/**
 * A* pathfinding traversal cost per terrain type.
 * Lower = preferred route.  WATER and MOUNTAIN are impassable (Infinity).
 */
const ROAD_PATH_COST = {
  [TERRAIN.GRASS]:          1.0,
  [TERRAIN.SAND]:           0.9,
  [TERRAIN.HILL]:           1.8,
  [TERRAIN.FOREST]:         1.5,
  [TERRAIN.CASTLE_GROUND]:  0.5,
  [TERRAIN.VILLAGE_GROUND]: 0.5,
  [TERRAIN.PORT_GROUND]:    0.5,
};

/** Gold cost per tile based on terrain type (road construction). */
const ROAD_GOLD_PER_TILE = {
  [TERRAIN.GRASS]:          18,
  [TERRAIN.SAND]:           12,
  [TERRAIN.HILL]:           35,
  [TERRAIN.FOREST]:         28,
  [TERRAIN.CASTLE_GROUND]:  5,
  [TERRAIN.VILLAGE_GROUND]: 5,
  [TERRAIN.PORT_GROUND]:    5,
};

/** Work-hours per tile based on terrain type (road construction). */
const ROAD_HOURS_PER_TILE_TERRAIN = {
  [TERRAIN.GRASS]:          2.5,
  [TERRAIN.SAND]:           1.5,
  [TERRAIN.HILL]:           6.0,
  [TERRAIN.FOREST]:         5.0,
  [TERRAIN.CASTLE_GROUND]:  1.0,
  [TERRAIN.VILLAGE_GROUND]: 1.0,
  [TERRAIN.PORT_GROUND]:    1.0,
};

// ---------------------------------------------------------------------------
// Road pathfinding helper (module-level, outside the class)
// ---------------------------------------------------------------------------

/**
 * Bresenham line walk: returns true if any WATER tile lies on the straight
 * line between (x0, y0) and (x1, y1).
 */
function _hasWaterOnLine(tiles, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  let x  = x0;
  let y  = y0;
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  for (;;) {
    if (x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT) {
      if (tiles[y * MAP_WIDTH + x] === TERRAIN.WATER) return true;
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 <  dx) { err += dx; y += sy; }
  }
  return false;
}

/**
 * Work-hours advanced per phase transition.
 * Road crews only work during 白天 and 黃昏.
 */
const CONSTR_PHASE_HOURS = { '白天': 10, '黃昏': 2 };

/** Base plunder gold for a castle (added to economy level × PLUNDER_ECONOMY_CASTLE). */
const PLUNDER_BASE_CASTLE   = 80;
/** Gold multiplier per economy level when plundering a castle. */
const PLUNDER_ECONOMY_CASTLE = 25;
/** Base plunder gold for a village (added to economy level × PLUNDER_ECONOMY_VILLAGE). */
const PLUNDER_BASE_VILLAGE   = 30;
/** Gold multiplier per economy level when plundering a village. */
const PLUNDER_ECONOMY_VILLAGE = 15;
/** Resource quantity awarded per resource type when plundering. */
const PLUNDER_RESOURCE_QTY   = 8;

/** Gold earned per economy level per active trade route (neutral settlement) per day. */
const TRADE_INCOME_PER_ECONOMY_LEVEL = 3;

/**
 * Bonus added to the player's combined-strength score for each captured
 * settlement, used in the "建議統治" (Suggest Rule) diplomacy check.
 */
const SETTLEMENT_STRENGTH_BONUS = 50;

/**
 * Economy-level multiplier for the "resistance" score of a neutral settlement
 * in the "建議統治" success-chance calculation.
 */
const ECONOMY_STRENGTH_MULTIPLIER = 60;

/**
 * Population divisor for the "resistance" score of a neutral settlement
 * in the "建議統治" success-chance calculation (population / this value).
 */
const POPULATION_STRENGTH_DIVISOR = 20;

/** Gold cost to hold a festival in a player-owned settlement. */
const FESTIVAL_COST = 50;
/** Satisfaction points gained from holding a festival (+, can push sat into positive). */
const FESTIVAL_SATISFACTION_BOOST = 20;
/** Minimum days between festivals in the same settlement. */
const FESTIVAL_COOLDOWN_DAYS = 7;
/** Gold cost multiplied by the current economy level for the Invest & Develop action. */
const INVEST_BASE_COST = 100;

/** Refund ratio when demolishing a player-built building (50 %). */
const DEMOLISH_REFUND_RATIO = 0.5;
/** Days between automatic demand-resource rotations. */
const DEMAND_ROTATION_INTERVAL = 10;
/**
 * All resource type names (must match NationSystem's internal RESOURCES list).
 * Used for computing settlement demand and checking supply via trade routes.
 */
const RESOURCE_TYPES = ['木材', '農產', '礦石', '絲綢', '煤炭', '草藥', '魚獲', '皮毛', '食鹽', '陶器'];
/** Minimum diplomatic relation required for foreign-settlement trade. */
const TRADE_MIN_FOREIGN_RELATION = -20;

/** Relation penalty applied when the player cancels a foreign nation's import trade route. */
const TRADE_CANCEL_RELATION_PENALTY = -15;

/** Minimum relation required for the player to propose building a connecting road. */
const CONNECT_ROAD_MIN_RELATION = 20;
/** Relation gain when the foreign nation accepts a connecting road proposal. */
const CONNECT_ROAD_RELATION_GAIN = 10;
/** Gold cost the player pays to propose the road (token goodwill payment). */
const CONNECT_ROAD_PROPOSAL_COST = 50;

/** Base gold cost for a banquet (宴請) at a foreign settlement. */
const BANQUET_BASE_COST = 30;
/** Additional gold cost per economy level for a banquet. */
const BANQUET_ECO_COST  = 10;
/** Relation gain from a banquet, indexed by ruler personality. */
const BANQUET_RELATION_GAIN = {
  '溫和': 18, '謹慎': 12, '狡猾': 10, '好戰': 7, '傲慢': 5,
};
/** Default relation gain when ruler personality is unknown. */
const BANQUET_RELATION_DEFAULT = 10;

/**
 * Gold tribute demanded per economy level in a 要求 (Demand) action.
 * Total = economy × DEMAND_GOLD_PER_ECO + DEMAND_GOLD_BASE.
 */
const DEMAND_GOLD_PER_ECO = 20;
const DEMAND_GOLD_BASE    = 20;

/** Relation delta when a demand succeeds: player gains gold, nation is resentful. */
const DEMAND_SUCCESS_REL_BASE     = 10;
const DEMAND_SUCCESS_REL_VARIANCE = 8;

/** Relation delta when a demand fails: nation is offended. */
const DEMAND_FAILURE_REL_BASE     = 18;
const DEMAND_FAILURE_REL_VARIANCE = 12;

/**
 * Buildable building catalogue (types that can be constructed by the player).
 * Excludes government buildings (palace / chief_house).
 */
const _BUILDABLE_TYPES = [BLDG_GENERAL, BLDG_BLACKSMITH, BLDG_MAGE, BLDG_TAVERN, BLDG_INN];

/** Gold cost to construct each building type. */
const _BUILDING_COSTS = {
  [BLDG_GENERAL]:    100,
  [BLDG_BLACKSMITH]: 120,
  [BLDG_MAGE]:       120,
  [BLDG_TAVERN]:      80,
  [BLDG_INN]:         80,
};

/** Maximum player-controlled garrison units per castle settlement. */
const PLAYER_CASTLE_GARRISON_MAX = 20;
/** Maximum player-controlled garrison units per village settlement. */
const PLAYER_VILLAGE_GARRISON_MAX = 10;

/**
 * GameUI – manages the Backpack and Team DOM panels.
 *
 * Attach it to the game after init:
 *   this._gameUI = new GameUI();
 *
 * To try acquiring a unit from gameplay code:
 *   this._gameUI.tryAcquireUnit({ name:'張飛', type:'general', role:'武將', stats:{attack:15} });
 */
export class GameUI {
  /**
   * @param {{ inventory?: object, army?: object }|null} [savedState]
   *   If provided the UI is initialised from the save instead of the demo seed.
   * @param {() => void} [onSave]  Called when the player presses the save button.
   * @param {import('../systems/NationSystem.js').NationSystem|null} [nationSystem]
   * @param {() => void} [onReset] Called when the player confirms a game reset.
   * @param {import('../entities/PlayerEntity.js').PlayerEntity|null} [player]  Live PlayerEntity instance.
   * @param {import('../systems/DiplomacySystem.js').DiplomacySystem|null} [diplomacySystem]
   * @param {import('../world/DayNightCycle.js').DayNightCycle|null} [dayNightCycle]
   * @param {import('../world/MapData.js').MapData|null} [mapData]  Live MapData used for coastal checks.
   * @param {import('../world/PathfinderWorker.js').PathfinderWorker|null} [pathfinderWorker]  Optional async pathfinder.
   */
  constructor(savedState = null, onSave = null, nationSystem = null, onReset = null, player = null, diplomacySystem = null, dayNightCycle = null, mapData = null, pathfinderWorker = null) {
    this.inventory = new Inventory();
    this.army      = new Army('主角');

    /**
     * Assignment system – coordinates assigning army members to regions,
     * trade routes and construction sites.  Wraps the existing _assignedRulers,
     * _tradeRouteWorkers and _buildingWorkers Maps.
     * @type {AssignmentSystem}
     */
    this.assignmentSystem = new AssignmentSystem(this.army);

    /** @type {import('../systems/NationSystem.js').NationSystem|null} */
    this.nationSystem = nationSystem;

    /** @type {import('../systems/DiplomacySystem.js').DiplomacySystem|null} */
    this.diplomacySystem = diplomacySystem;

    /** @type {import('../world/DayNightCycle.js').DayNightCycle|null} */
    this._dayNightCycle = dayNightCycle;

    /** @type {import('../entities/PlayerEntity.js').PlayerEntity|null} */
    this.player = player;

    /** @type {import('../world/MapData.js').MapData|null} */
    this._mapData = mapData;

    /** @type {import('../world/PathfinderWorker.js').PathfinderWorker|null} */
    this._pathfinderWorker = pathfinderWorker;

    /** @type {'backpack'|'team'|'nations'|'settings'|null} */
    this._activePanel  = null;
    this._activeSquad  = 0;

    /** Active backpack category tab and equipment sub-tab. */
    this._backpackTab  = 'all';
    this._equipSubTab  = 'weapon';

    /** Active nations sub-tab: only 'diplomacy' is used now */
    this._nationsTab = 'diplomacy';

    /** Active team panel main tab: 'squads' | 'info' */
    this._teamInfoTab = 'squads';

    /** Active appearance panel tab: 'character' | 'kingdom' */
    this._appearanceTab = 'character';

    /** Active construction sub-tab: '建築' | '道路' */
    this._constructionTab = '建築';

    /** Currently active minimap layer: 'terrain' | 'territory' */
    this._minimapLayer = 'terrain';

    /** Minimap zoom multiplier (1 = 100%, range 1–4). */
    this._minimapZoom = 1;

    /** Minimap canvas pan offset in logical canvas pixels. */
    this._minimapPanX = 0;
    this._minimapPanY = 0;

    /** Guide overlay page index: -1 = nav/index page, 0..N-1 = chapter index. */
    this._guidePageIndex = -1;

    /** The settlement the player is currently standing on, or null. */
    this._nearbySettlement = null;

    /** Settlement targeted for battle (set when battle preview opens). */
    this._battleSettlement = null;
    /** Squads selected for dispatch in the battle preview. */
    this._selectedSquadIds = [];
    /** Active battle state, or null when no battle is in progress. */
    this._battleState = null;

    /** Location screen stage: 'gate' (castle entrance) | 'inside' (facility list). */
    this._locationStage = 'gate';

    /** Settlement currently displayed in the location overlay, or null. */
    this._locationSettlement = null;

    /**
     * When a specific building is open inside the location screen, this holds
     * { building: Building, settlement: Settlement }.  Null when showing the
     * facility list.
     * @type {{ building: import('../systems/BuildingSystem.js').Building, settlement: import('../systems/NationSystem.js').Settlement }|null}
     */
    this._facilityView = null;

    /** Player's custom kingdom state (flag, name, type). */
    this._playerKingdom = { ...DEFAULT_KINGDOM };

    /** Number of settlements (castles + villages) the player currently controls. */
    this._playerSettlementCount = 0;

    /**
     * Set of settlement keys the player has captured.
     * Keys are formatted as "castle:<idx>" or "village:<idx>".
     * @type {Set<string>}
     */
    this._capturedSettlements = new Set();

    /**
     * Set of settlement keys the player has liberated (released as neutral).
     * Keys are formatted as "castle:<idx>" or "village:<idx>".
     * @type {Set<string>}
     */
    this._liberatedSettlements = new Set();

    /** Id of the unit whose move-target panel is currently open, or null. */
    this._movingUnitId = null;

    /**
     * Per-settlement tavern state.
     * Key: "${sx}_${sy}" (from _settlementHashCoords).
     * Value: { lastVisitDay: number, recruitedIndices: number[] }
     * @type {Map<string, { lastVisitDay: number, recruitedIndices: number[] }>}
     */
    this._tavernState = new Map();

    /**
     * Per-settlement satisfaction.
     * Key: settlement key from _settlementKey() (e.g. "castle:0").
     * Value: number in [-100, 100]. Newly-captured settlements start at -50.
     * Drifts +2/day toward 0; collecting tax reduces it by 10.
     * @type {Map<string, number>}
     */
    this._satisfactionMap = new Map();

    /**
     * Inbox message log.  Each entry: { icon: string, text: string, day: number, read: boolean }
     * Capped at MAX_INBOX_MESSAGES.  Persisted in save state.
     * @type {{ icon: string, text: string, day: number, read: boolean }[]}
     */
    this._inbox = [];

    /** Number of unread inbox messages. */
    this._inboxUnread = 0;

    /** Callback invoked when the player manually triggers a save. */
    this.onSave = onSave;

    /** Callback invoked when the player confirms a game reset. */
    this.onReset = onReset;

    /**
     * Callback invoked when the player rests at an inn.
     * Argument is the number of in-game days to advance (1 or more).
     * Wired up by Game.js to call onDayPassed() N times and keep the
     * day-night tracker in sync.
     * @type {((days: number) => void)|null}
     */
    this.onAdvanceDays = null;

    /**
     * Callback invoked after a settlement is captured by the player.
     * The game can use this to rebuild map visuals.
     * @type {(() => void)|null}
     */
    this.onCaptureSettlement = null;

    /**
     * Callback invoked whenever the player changes their kingdom name, flag,
     * or any other visual property.  The game uses this to rebuild map
     * structures so the updated flag is reflected immediately on the map.
     * @type {(() => void)|null}
     */
    this.onPlayerKingdomChanged = null;

    /**
     * Callback invoked whenever the player edits their character appearance
     * (body colour, headgear, etc.).  Used in multiplayer to broadcast the
     * updated look to other players.
     * @type {(() => void)|null}
     */
    this.onPlayerAppearanceChanged = null;

    /**
     * Callback invoked whenever a road is completed or demolished.
     * The game uses this to rebuild the road overlay on the world map.
     * @type {(() => void)|null}
     */
    this.onRoadBuilt = null;

    /**
     * Per-settlement construction state.
     * Key: settlement key (e.g. "castle:0").
     * Value: {
     *   buildingQueue: [{ type: string, name: string, icon: string, daysLeft: number }],
     *   roads:         Map<roadKey, { targetKey, targetName, tilesTotal, totalHours, hoursLeft, isDemo, path }>,
     *   builtRoads:    Map<roadKey, { tiles: {tx,ty}[] }>
     * }
     * @type {Map<string, object>}
     */
    this._constructionState = new Map();

    /**
     * Active trade routes between settlements.
     * Key: routeId in the format "${fromKey}→${toKey}".
     * Value: { fromKey, fromName, toKey, toName, resources: string[], dailyGold: number }
     * Daily gold is earned by the player when they own the fromKey settlement.
     * Routes connect player↔player, player↔neutral, or player↔foreign settlements.
     * Persisted in getState() / loadState().
     * @type {Map<string, { fromKey: string, fromName: string, toKey: string, toName: string, resources: string[], dailyGold: number }>}
     */
    this._tradeRoutes = new Map();

    /**
     * Festival cooldowns per player settlement.
     * Key: settlementKey.  Value: in-game day number from which the next festival is allowed.
     * @type {Map<string, number>}
     */
    this._festivalCooldowns = new Map();

    /**
     * Player-assigned rulers for settlements.
     * Key: settlementKey (e.g. "castle:0").
     * Value: unit ID (number) of the army member assigned as ruler.
     * When set, this unit's traits apply to the settlement (e.g. 一絲不苟 → +tax).
     * @type {Map<string, number>}
     */
    this._assignedRulers = new Map();

    /**
     * Workers assigned to each trade route (exactly 2 required for income).
     * Key: routeId (e.g. "castle:0→village:2").
     * Value: array of unit IDs (max 2).
     * @type {Map<string, number[]>}
     */
    this._tradeRouteWorkers = new Map();

    /**
     * Workers assigned to construction for each player settlement (max 3).
     * Key: settlementKey (e.g. "castle:0").
     * Value: array of unit IDs (max 3).
     * Each worker drives one simultaneous construction slot.
     * @type {Map<string, number[]>}
     */
    this._buildingWorkers = new Map();

    /**
     * Unit IDs currently serving as messengers for in-transit missives.
     * Prevents double-assignment while a letter is being carried.
     * Cleared automatically when the missive is resolved.
     * @type {Set<number>}
     */
    this._messengerUnitIds = new Set();

    /**
     * The army unit tentatively selected as messenger in the letter-dispatch UI.
     * Set during _renderSendLetter and consumed when the letter is actually sent.
     * @type {import('../systems/Army.js').Unit|null}
     */
    this._pendingMessengerUnit = null;

    /**
     * Regional treasury – tax and trade income accumulated per settlement.
     * Key: settlementKey (e.g. "castle:0").
     * Value: number (gold amount waiting to be collected by the player).
     * @type {Map<string, number>}
     */
    this._regionalTreasury = new Map();

    /**
     * City planning automation settings per settlement.
     * Key: settlementKey.
     * Value: {
     *   autoTax: boolean,
     *   autoFestival: boolean,
     *   autoInvest: boolean,
     *   minSatisfaction: number,  // -100..100; auto actions only fire above this threshold
     * }
     * @type {Map<string, { autoTax: boolean, autoFestival: boolean, autoInvest: boolean, minSatisfaction: number }>}
     */
    this._cityPlans = new Map();

    /**
     * Player garrison units per owned settlement.
     * Key: settlementKey (e.g. "castle:0").
     * Value: array of unit IDs stationed as garrison.
     * Only these units count towards the garrison tax penalty for that settlement.
     * @type {Map<string, number[]>}
     */
    this._playerGarrisons = new Map();

    /** Active city-hall department tab: 'gov' | 'construction' | 'planning' */
    this._cityHallTab = 'gov';

    /**
     * Player-placed map buildings (lumber camps, mines, bridges).
     * @type {{ id: number, type: 'lumberCamp'|'mine'|'bridge', tx: number, ty: number, phaseTick: number }[]}
     */
    this._mapBuildings = [];

    /** Auto-increment ID for map buildings. */
    this._mapBuildingIdSeq = 0;

    /**
     * Active map building workers walking toward a player city.
     * @type {{ id: string, buildingId: number, type: 'lumberCamp'|'mine', tx: number, ty: number, targetKey: string, gold: number }[]}
     */
    this._mapBuildingWorkers = [];

    /** Currently detected buildable terrain tile under the player (or null). */
    this._nearbyBuildableTile = null;

    /** Currently detected map building on the tile under the player (or null). */
    this._nearbyMapBuilding = null;

    /**
     * Callback invoked when a bridge is built or removed.
     * The game uses this to re-evaluate road pathfinding previews.
     * @type {(() => void)|null}
     */
    this.onBridgeBuilt = null;

    /**
     * Callback invoked whenever any map building is added (lumber camp, mine, bridge).
     * The game uses this to rebuild the MapBuildingRenderer and bridge tile set.
     * @type {(() => void)|null}
     */
    this.onMapBuildingChanged = null;

    if (savedState) {
      this.loadState(savedState);
    } else {
      this._seedDemo();
    }
    this._buildDOM();
    this._attachListeners();
  }

  // -------------------------------------------------------------------------
  // Demo seed
  // -------------------------------------------------------------------------

  _seedDemo() {
    // Money
    this.inventory.addItem({ name: '金幣', type: 'loot', icon: '🪙', quantity: 50 });
    // Food
    this.inventory.addItem({ name: '乾糧', type: 'food', icon: '🍱', quantity: 10,
      description: '補充行軍所需的體力。' });
    // Map item
    this.inventory.addItem({ name: '地圖', type: 'map', icon: '🗺️', quantity: 1,
      stackable: false, description: '記錄王國全域地形的羊皮紙地圖，可查看整片大陸。' });
    // Guide item
    this.inventory.addItem({ name: '開國指南', type: 'guide', icon: '📖', quantity: 1,
      stackable: false, description: '新手必讀的王國建設指南，涵蓋移動操控、背包管理、隊伍建設、城池攻略等完整教程。' });

    // Squad 0 – already has the hero; add three more members
    this.army.acquireUnit({ name: '趙一', role: '劍士',   traits: ['重步兵'],           stats: { attack: 8,  defense: 6  } }, 0);
    this.army.acquireUnit({ name: '錢二', role: '弓手',   traits: ['神射手'],           stats: { attack: 10, defense: 3  } }, 0);
    this.army.acquireUnit({ name: '孫三', role: '長槍兵', traits: [],                   stats: { attack: 7,  defense: 8  } }, 0);

    // Squad 1 – a captain-capable general leads
    this.army.acquireUnit({ name: '李四', role: '武將',   traits: [TRAIT_CAPTAIN, '策略家'], stats: { attack: 12, defense: 9, morale: 80 } }, 1);
    this.army.acquireUnit({ name: '周六', role: '騎兵',   traits: [],                   stats: { attack: 11, defense: 5  } }, 1);

    // Squad 2 – another captain-capable leader
    this.army.acquireUnit({ name: '王五', role: '劍士',   traits: [TRAIT_CAPTAIN],      stats: { attack: 9,  defense: 7  } }, 2);
  }

  // -------------------------------------------------------------------------
  // DOM construction
  // -------------------------------------------------------------------------

  _buildDOM() {
    // Tab buttons (top-right, stacked below weather label)
    const tabBar = document.createElement('div');
    tabBar.id = 'ui-tab-bar';
    tabBar.innerHTML = `
      <button id="btn-backpack"   class="ui-tab-btn" title="背包">🎒</button>
      <button id="btn-team"       class="ui-tab-btn" title="隊伍">⚔️</button>
      <button id="btn-nations"    class="ui-tab-btn" title="王國">🏰</button>
      <button id="btn-appearance" class="ui-tab-btn" title="外觀">🎨</button>
      <button id="btn-inbox"      class="ui-tab-btn inbox-tab-btn" title="信件夾">📬<span id="inbox-badge" class="inbox-badge" style="display:none">0</span></button>
      <button id="btn-save"       class="ui-tab-btn" title="儲存">💾</button>
      <button id="btn-settings"   class="ui-tab-btn" title="設定">⚙️</button>
    `;
    document.body.appendChild(tabBar);

    // Slide-in panel
    const panel = document.createElement('div');
    panel.id = 'ui-panel';
    panel.innerHTML = `
      <div id="ui-panel-inner">
        <div id="ui-panel-header">
          <span id="ui-panel-title"></span>
          <button id="ui-panel-close">✕</button>
        </div>
        <div id="ui-panel-content"></div>
      </div>
    `;
    document.body.appendChild(panel);

    // Unit detail overlay (shown when a unit card is clicked)
    const unitDetail = document.createElement('div');
    unitDetail.id = 'ui-unit-detail-overlay';
    unitDetail.innerHTML = `
      <div id="ui-unit-detail-box">
        <div id="ui-unit-detail-header">
          <span id="ui-unit-detail-name"></span>
          <button id="ui-unit-detail-close">✕</button>
        </div>
        <div id="ui-unit-detail-body"></div>
      </div>
    `;
    document.body.appendChild(unitDetail);

    // Item detail overlay (shown when a backpack item is clicked)
    const itemDetail = document.createElement('div');
    itemDetail.id = 'ui-item-detail-overlay';
    itemDetail.innerHTML = `
      <div id="ui-item-detail-box">
        <div id="ui-item-detail-header">
          <span id="ui-item-detail-icon"></span>
          <span id="ui-item-detail-name"></span>
          <button id="ui-item-detail-close">✕</button>
        </div>
        <div id="ui-item-detail-body"></div>
      </div>
    `;
    document.body.appendChild(itemDetail);

    // Acquire dialog
    const dlg = document.createElement('div');
    dlg.id = 'ui-acquire-overlay';
    dlg.innerHTML = `
      <div id="ui-acquire-box">
        <div id="ui-acquire-title"></div>
        <div id="ui-acquire-desc"></div>
        <div id="ui-acquire-actions">
          <button id="btn-acq-place">✅ 安置</button>
          <button id="btn-acq-sell" >💰 賣掉</button>
          <button id="btn-acq-exile">🚶 流放</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);

    // Toast notification
    const toast = document.createElement('div');
    toast.id = 'ui-toast';
    document.body.appendChild(toast);

    // Settlement detail overlay (nations panel → click a settlement)
    const settlementDetail = document.createElement('div');
    settlementDetail.id = 'ui-settlement-detail-overlay';
    settlementDetail.innerHTML = `
      <div id="ui-settlement-detail-box">
        <div id="ui-settlement-detail-header">
          <span id="ui-settlement-detail-icon"></span>
          <span id="ui-settlement-detail-name"></span>
          <button id="ui-settlement-detail-close">✕</button>
        </div>
        <div id="ui-settlement-detail-body"></div>
      </div>
    `;
    document.body.appendChild(settlementDetail);

    // Minimap overlay (opened by the 地圖 map item)
    const minimap = document.createElement('div');
    minimap.id = 'ui-minimap-overlay';
    minimap.innerHTML = `
      <div id="ui-minimap-box">
        <div id="ui-minimap-header">
          <span id="ui-minimap-title">🗺️ 王國地圖</span>
          <div id="ui-minimap-zoom">
            <button class="mm-zoom-btn" id="mm-zoom-out" title="縮小">−</button>
            <span id="mm-zoom-label">100%</span>
            <button class="mm-zoom-btn" id="mm-zoom-in"  title="放大">＋</button>
          </div>
          <button id="ui-minimap-close">✕</button>
        </div>
        <div id="ui-minimap-tabs">
          <button class="mm-tab-btn active" data-layer="terrain">地形</button>
          <button class="mm-tab-btn" data-layer="territory">領土</button>
        </div>
        <div id="ui-minimap-canvas-wrap">
          <canvas id="ui-minimap-canvas"></canvas>
        </div>
        <div id="ui-minimap-legend">
          <div class="mm-legend-item"><span class="mm-legend-swatch" style="background:#1565C0"></span>水域</div>
          <div class="mm-legend-item"><span class="mm-legend-swatch" style="background:#E8D5A3"></span>沙灘</div>
          <div class="mm-legend-item"><span class="mm-legend-swatch" style="background:#4CAF50"></span>草原</div>
          <div class="mm-legend-item"><span class="mm-legend-swatch" style="background:#2E7D32"></span>森林</div>
          <div class="mm-legend-item"><span class="mm-legend-swatch" style="background:#8D9A5A"></span>丘陵</div>
          <div class="mm-legend-item"><span class="mm-legend-swatch" style="background:#546E7A"></span>山地</div>
          <div class="mm-legend-item mm-legend-icon">🏰 城堡</div>
          <div class="mm-legend-item mm-legend-icon">🏘️ 村落</div>
          <div class="mm-legend-item mm-legend-icon">🌟 玩家位置</div>
        </div>
      </div>
    `;
    document.body.appendChild(minimap);

    // Guide overlay (opened by the 開國指南 guide item)
    const guide = document.createElement('div');
    guide.id = 'ui-guide-overlay';
    guide.innerHTML = `
      <div id="ui-guide-box">
        <div id="ui-guide-header">
          <span id="ui-guide-back" role="button" tabindex="0">← 目錄</span>
          <span id="ui-guide-title">📖 開國指南</span>
          <button id="ui-guide-close">✕</button>
        </div>
        <div id="ui-guide-body"></div>
        <div id="ui-guide-footer">
          <button class="guide-nav-btn" id="ui-guide-prev">← 上一章</button>
          <span id="ui-guide-page-label"></span>
          <button class="guide-nav-btn" id="ui-guide-next">下一章 →</button>
        </div>
      </div>
    `;
    document.body.appendChild(guide);
    const mapBuildOverlay = document.createElement('div');
    mapBuildOverlay.id = 'map-build-overlay';
    mapBuildOverlay.innerHTML = `
      <div id="map-build-box">
        <div id="map-build-header">
          <span id="map-build-title">🌍 建造</span>
          <button id="map-build-close">✕</button>
        </div>
        <div id="map-build-body"></div>
      </div>
    `;
    document.body.appendChild(mapBuildOverlay);

    // NOTE: Battle preview overlay and battle scene overlay are declared in index.html
    // (static HTML) so they are always available when _attachListeners() runs.
  }

  _attachListeners() {
    document.getElementById('btn-backpack').addEventListener('click', () => this._togglePanel('backpack'));
    document.getElementById('btn-team').addEventListener('click',     () => this._togglePanel('team'));
    document.getElementById('btn-nations').addEventListener('click',  () => this._togglePanel('nations'));
    document.getElementById('btn-appearance').addEventListener('click', () => this._togglePanel('appearance'));
    document.getElementById('btn-inbox').addEventListener('click',    () => this._togglePanel('inbox'));
    document.getElementById('btn-settings').addEventListener('click', () => this._togglePanel('settings'));
    document.getElementById('ui-panel-close').addEventListener('click', () => this._closePanel());

    document.getElementById('btn-save').addEventListener('click', () => {
      if (typeof this.onSave === 'function') {
        this.onSave();
      }
    });

    // Enter-facility button
    document.getElementById('enter-facility-btn').addEventListener('click', () => {
      if (this._nearbySettlement) this._openLocationScreen(this._nearbySettlement);
    });

    // Attack-facility button
    document.getElementById('attack-facility-btn').addEventListener('click', () => {
      if (this._nearbySettlement) this._openBattlePreview(this._nearbySettlement);
    });

    // Map build button
    document.getElementById('map-build-btn')?.addEventListener('click', () => {
      if (!this._nearbyBuildableTile) return;
      const { tx, ty, terrainType } = this._nearbyBuildableTile;
      this._openMapBuildPanel(tx, ty, terrainType);
    });

    // Map building info button (shown when an existing building is nearby)
    document.getElementById('map-bldg-info-btn')?.addEventListener('click', () => {
      if (!this._nearbyMapBuilding) return;
      this._openMapBuildingInfo(this._nearbyMapBuilding);
    });

    // Close map-build overlay via backdrop or close button
    document.getElementById('map-build-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'map-build-overlay') {
        document.getElementById('map-build-overlay').classList.remove('visible');
      }
    });
    document.getElementById('map-build-close')?.addEventListener('click', () => {
      document.getElementById('map-build-overlay')?.classList.remove('visible');
    });

    // Battle preview overlay – close via backdrop or close button
    document.getElementById('battle-preview-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'battle-preview-overlay') this._closeBattlePreview();
    });
    document.getElementById('battle-preview-close').addEventListener('click', () => this._closeBattlePreview());

    // Close location overlay
    document.getElementById('location-close').addEventListener('click', () => this._closeLocationScreen());
    document.getElementById('location-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'location-overlay') this._closeLocationScreen();
    });

    // Close panel when tapping the backdrop
    document.getElementById('ui-panel').addEventListener('click', (e) => {
      if (e.target.id === 'ui-panel') this._closePanel();
    });

    // Close unit detail overlay when tapping backdrop or close button
    document.getElementById('ui-unit-detail-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'ui-unit-detail-overlay') this._closeUnitDetail();
    });
    document.getElementById('ui-unit-detail-close').addEventListener('click', () => this._closeUnitDetail());

    // Close item detail overlay when tapping backdrop or close button
    document.getElementById('ui-item-detail-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'ui-item-detail-overlay') this._closeItemDetail();
    });
    document.getElementById('ui-item-detail-close').addEventListener('click', () => this._closeItemDetail());

    // Close settlement detail overlay when tapping backdrop or close button
    document.getElementById('ui-settlement-detail-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'ui-settlement-detail-overlay') this._closeSettlementDetail();
    });
    document.getElementById('ui-settlement-detail-close').addEventListener('click', () => this._closeSettlementDetail());

    // Close minimap overlay when tapping backdrop or close button
    document.getElementById('ui-minimap-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'ui-minimap-overlay') this._closeMinimap();
    });
    document.getElementById('ui-minimap-close').addEventListener('click', () => this._closeMinimap());

    // Minimap layer tabs
    document.getElementById('ui-minimap-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.mm-tab-btn');
      if (!btn) return;
      document.querySelectorAll('.mm-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this._minimapLayer = btn.dataset.layer;
      this._redrawMinimap();
    });

    // Minimap zoom buttons
    document.getElementById('mm-zoom-in').addEventListener('click',  () => this._minimapZoomBy(+1));
    document.getElementById('mm-zoom-out').addEventListener('click', () => this._minimapZoomBy(-1));

    // Minimap canvas drag-to-pan (pointer events — works for both mouse and touch)
    const wrap = document.getElementById('ui-minimap-canvas-wrap');
    let _panActive = false;
    let _panLastX  = 0;
    let _panLastY  = 0;

    wrap.addEventListener('pointerdown', (e) => {
      if (this._minimapZoom <= 1) return; // no pan needed at 1× zoom
      _panActive = true;
      _panLastX  = e.clientX;
      _panLastY  = e.clientY;
      wrap.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    wrap.addEventListener('pointermove', (e) => {
      if (!_panActive) return;
      const dx = e.clientX - _panLastX;
      const dy = e.clientY - _panLastY;
      _panLastX = e.clientX;
      _panLastY = e.clientY;
      this._minimapPanBy(dx, dy);
      e.preventDefault();
    });

    const _endPan = () => { _panActive = false; };
    wrap.addEventListener('pointerup',     _endPan);
    wrap.addEventListener('pointercancel', _endPan);

    // Mouse-wheel zoom on the canvas wrap
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._minimapZoomBy(e.deltaY < 0 ? +1 : -1);
    }, { passive: false });

    // Guide overlay – close via backdrop or close button; nav via back/prev/next
    document.getElementById('ui-guide-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'ui-guide-overlay') this._closeGuide();
    });
    document.getElementById('ui-guide-close').addEventListener('click', () => this._closeGuide());
    const guideBack = document.getElementById('ui-guide-back');
    guideBack.addEventListener('click', () => this._renderGuide(-1));
    guideBack.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._renderGuide(-1); } });
    document.getElementById('ui-guide-prev').addEventListener('click', () => this._renderGuide(this._guidePageIndex - 1));
    document.getElementById('ui-guide-next').addEventListener('click', () => this._renderGuide(this._guidePageIndex + 1));
    // Chapter card clicks delegated on the persistent body element
    const guideBody = document.getElementById('ui-guide-body');
    guideBody.addEventListener('click', (e) => {
      const card = e.target.closest('.guide-chapter-card');
      if (card) this._renderGuide(Number(card.dataset.chapter));
    });
    guideBody.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.guide-chapter-card');
      if (card) { e.preventDefault(); this._renderGuide(Number(card.dataset.chapter)); }
    });
  }

  // -------------------------------------------------------------------------
  // Panel management
  // -------------------------------------------------------------------------

  _togglePanel(type) {
    if (this._activePanel === type) {
      this._closePanel();
    } else {
      this._openPanel(type);
    }
  }

  _openPanel(type) {
    this._activePanel = type;
    const panel = document.getElementById('ui-panel');
    panel.classList.add('visible');
    document.getElementById('btn-backpack').classList.toggle('active',   type === 'backpack');
    document.getElementById('btn-team').classList.toggle('active',       type === 'team');
    document.getElementById('btn-nations').classList.toggle('active',    type === 'nations');
    document.getElementById('btn-appearance').classList.toggle('active', type === 'appearance');
    document.getElementById('btn-inbox').classList.toggle('active',      type === 'inbox');
    document.getElementById('btn-settings').classList.toggle('active',   type === 'settings');

    if (type === 'backpack') {
      document.getElementById('ui-panel-title').textContent = '🎒 背包';
      this._renderBackpack();
    } else if (type === 'nations') {
      document.getElementById('ui-panel-title').textContent = '🏰 王國';
      this._renderNations();
    } else if (type === 'appearance') {
      document.getElementById('ui-panel-title').textContent = '🎨 外觀';
      this._renderAppearance();
    } else if (type === 'inbox') {
      document.getElementById('ui-panel-title').textContent = '📬 信件夾';
      this._renderInbox();
    } else if (type === 'settings') {
      document.getElementById('ui-panel-title').textContent = '⚙️ 設定';
      this._renderSettings();
    } else {
      document.getElementById('ui-panel-title').textContent = '⚔️ 隊伍';
      this._renderTeam();
    }
  }

  _closePanel() {
    this._activePanel = null;
    document.getElementById('ui-panel').classList.remove('visible');
    document.getElementById('btn-backpack').classList.remove('active');
    document.getElementById('btn-team').classList.remove('active');
    document.getElementById('btn-nations').classList.remove('active');
    document.getElementById('btn-appearance').classList.remove('active');
    document.getElementById('btn-inbox').classList.remove('active');
    document.getElementById('btn-settings').classList.remove('active');
  }

  // -------------------------------------------------------------------------
  // Backpack
  // -------------------------------------------------------------------------

  // Category / sub-tab metadata
  static get _BP_CATS() {
    return [
      { id: 'all',       label: '全部' },
      { id: 'equipment', label: '裝備' },
      { id: 'accessory', label: '飾品' },
      { id: 'food',      label: '糧食' },
      { id: 'potion',    label: '藥水' },
      { id: 'utility',   label: '實用' },
      { id: 'loot',      label: '資源' },
      { id: 'trophy',    label: '戰利品' },
      { id: 'map',       label: '地圖' },
      { id: 'other',     label: '其他' },
    ];
  }
  static get _EQUIP_SUBS() {
    return [
      { id: 'weapon', label: '武器' },
      { id: 'helmet', label: '頭盔' },
      { id: 'chest',  label: '胸甲' },
      { id: 'legs',   label: '護腿' },
      { id: 'boots',  label: '靴子' },
    ];
  }
  static get _EQUIP_TYPES() {
    return ['weapon', 'helmet', 'chest', 'legs', 'boots'];
  }
  static get _TYPE_LABEL() {
    return {
      weapon: '武器', helmet: '頭盔', chest: '胸甲', legs: '護腿', boots: '靴子',
      accessory: '飾品', food: '糧食', potion: '藥水', utility: '實用',
      loot: '資源', consumable: '消耗', trophy: '戰利品', map: '地圖', guide: '指南',
    };
  }

  /** All item types that map to an explicit category (used for 其他 catch-all). */
  static get _KNOWN_TYPES() {
    return new Set([
      ...GameUI._EQUIP_TYPES,
      'accessory', 'food', 'potion', 'consumable', 'utility', 'loot', 'trophy', 'map', 'guide',
    ]);
  }

  _filterItems(items) {
    const tab = this._backpackTab;
    if (tab === 'all')       return items;
    if (tab === 'equipment') return items.filter(i => i.type === this._equipSubTab);
    if (tab === 'potion')    return items.filter(i => i.type === 'potion' || i.type === 'consumable');
    if (tab === 'map')       return items.filter(i => i.type === 'map' || i.type === 'guide');
    if (tab === 'other')     return items.filter(i => !GameUI._KNOWN_TYPES.has(i.type));
    return items.filter(i => i.type === tab);
  }

  _renderBackpack() {
    const content  = document.getElementById('ui-panel-content');
    const allItems = this.inventory.getItems();
    const cats     = GameUI._BP_CATS;
    const subs     = GameUI._EQUIP_SUBS;
    const EQUIP    = GameUI._EQUIP_TYPES;
    const LABEL    = GameUI._TYPE_LABEL;

    // Count per top-level tab (for badge visibility)
    const countFor = (id) => {
      if (id === 'all')       return allItems.length;
      if (id === 'equipment') return allItems.filter(i => EQUIP.includes(i.type)).length;
      if (id === 'potion')    return allItems.filter(i => i.type === 'potion' || i.type === 'consumable').length;
      if (id === 'map')       return allItems.filter(i => i.type === 'map' || i.type === 'guide').length;
      if (id === 'other')     return allItems.filter(i => !GameUI._KNOWN_TYPES.has(i.type)).length;
      return allItems.filter(i => i.type === id).length;
    };

    const catTabsHTML = `
      <div class="bp-cat-tabs">
        ${cats.map(c => {
          const cnt = countFor(c.id);
          return `<button class="bp-cat-btn${this._backpackTab === c.id ? ' active' : ''}" data-cat="${c.id}">
            ${c.label}${cnt > 0 ? `<span class="bp-cnt">${cnt}</span>` : ''}
          </button>`;
        }).join('')}
      </div>`;

    const subTabsHTML = this._backpackTab === 'equipment' ? `
      <div class="bp-sub-tabs">
        ${subs.map(s => {
          const cnt = allItems.filter(i => i.type === s.id).length;
          return `<button class="bp-sub-btn${this._equipSubTab === s.id ? ' active' : ''}" data-sub="${s.id}">
            ${s.label}${cnt > 0 ? `<span class="bp-cnt">${cnt}</span>` : ''}
          </button>`;
        }).join('')}
      </div>` : '';

    const filtered = this._filterItems(allItems);

    const listHTML = filtered.length === 0
      ? '<p class="ui-empty">此分類沒有物品</p>'
      : `<div class="item-rows">
          ${filtered.map(it => `
            <div class="item-row" data-id="${it.id}" role="button" tabindex="0">
              <span class="ir-icon">${it.icon}</span>
              <span class="ir-name">${it.name}</span>
              ${this._backpackTab === 'all'
                ? `<span class="ir-type-tag">${LABEL[it.type] ?? it.type}</span>`
                : ''}
              ${it.quantity > 1 ? `<span class="ir-qty">×${it.quantity}</span>` : ''}
              <span class="ir-arrow">›</span>
            </div>`).join('')}
        </div>`;

    content.innerHTML = catTabsHTML + subTabsHTML + listHTML;

    content.querySelectorAll('.bp-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._backpackTab = btn.dataset.cat;
        this._renderBackpack();
      });
    });
    content.querySelectorAll('.bp-sub-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._equipSubTab = btn.dataset.sub;
        this._renderBackpack();
      });
    });
    content.querySelectorAll('.item-row[data-id]').forEach(row => {
      const open = () => {
        const item = allItems.find(i => i.id === Number(row.dataset.id));
        if (item) this._openItemDetail(item);
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  // -------------------------------------------------------------------------
  // Item detail overlay
  // -------------------------------------------------------------------------

  _openItemDetail(item) {
    const LABEL   = GameUI._TYPE_LABEL;
    const isMap   = item.type === 'map';
    const isGuide = item.type === 'guide';
    const usable  = !isMap && !isGuide && ['consumable', 'potion', 'utility'].includes(item.type);
    const equipSlot = GameUI._getEquipSlot(item.type);
    const statsKeys = item.stats ? Object.keys(item.stats) : [];
    const STAT_LABEL = { attack: '攻擊', defense: '防禦', speed: '速度', morale: '士氣' };

    const statsHTML = statsKeys.length > 0
      ? `<div class="id-stats-row">
          ${statsKeys.map(k => `
            <div class="id-stat">
              <span class="id-stat-label">${STAT_LABEL[k] ?? k}</span>
              <span class="id-stat-val">${item.stats[k] >= 0 ? '+' : ''}${item.stats[k]}</span>
            </div>`).join('')}
        </div>`
      : '';

    document.getElementById('ui-item-detail-icon').textContent = item.icon;
    document.getElementById('ui-item-detail-name').textContent = item.name;
    document.getElementById('ui-item-detail-body').innerHTML = `
      <div class="id-row">
        <span class="id-label">分類</span>
        <span class="id-value id-type-tag">${LABEL[item.type] ?? item.type}</span>
      </div>
      ${item.quantity > 1 ? `
      <div class="id-row">
        <span class="id-label">數量</span>
        <span class="id-value">×${item.quantity}</span>
      </div>` : ''}
      ${item.description ? `
      <div class="id-row id-desc-row">
        <span class="id-desc">${item.description}</span>
      </div>` : ''}
      ${statsHTML}
      <div class="id-actions">
        ${isMap   ? `<button class="btn-item-use" data-id="${item.id}">🗺️ 查看地圖</button>` : ''}
        ${isGuide ? `<button class="btn-item-use" data-id="${item.id}">📖 開啟指南</button>` : ''}
        ${usable  ? `<button class="btn-item-use" data-id="${item.id}">▶ 使用</button>` : ''}
        ${equipSlot ? `<button class="btn-item-equip-char" data-id="${item.id}">⚔️ 裝備到人物…</button>` : ''}
        <button class="btn-item-discard" data-id="${item.id}">🗑 丟棄</button>
      </div>
      ${equipSlot ? '<div class="id-char-picker" style="display:none"></div>' : ''}
    `;

    document.getElementById('ui-item-detail-overlay').classList.add('visible');

    const detailBody = document.getElementById('ui-item-detail-body');
    detailBody.querySelector('.btn-item-use')?.addEventListener('click', () => {
      if (isMap) {
        this._closeItemDetail();
        this._openMinimap();
        return;
      }
      if (isGuide) {
        this._closeItemDetail();
        this._openGuide();
        return;
      }
      const desc = this.inventory.useItem(item.id);
      if (desc) this._toast(desc);
      this._closeItemDetail();
      this._renderBackpack();
    });

    // "裝備到人物" button – show inline character picker
    if (equipSlot) {
      detailBody.querySelector('.btn-item-equip-char')?.addEventListener('click', () => {
        this._showCharEquipPicker(detailBody.querySelector('.id-char-picker'), item, equipSlot);
      });
    }

    detailBody.querySelector('.btn-item-discard')?.addEventListener('click', () => {
      this.inventory.removeItem(item.id, item.quantity);
      this._toast(`已丟棄 ${item.name}`);
      this._closeItemDetail();
      this._renderBackpack();
    });
  }

  _closeItemDetail() {
    document.getElementById('ui-item-detail-overlay').classList.remove('visible');
  }

  /**
   * Show an inline character picker inside the item detail overlay so the
   * player can choose which unit to equip the item on.
   * @param {HTMLElement} pickerEl
   * @param {object} item  Inventory item
   * @param {'weapon'|'armor'|'accessory'} slotKey
   */
  _showCharEquipPicker(pickerEl, item, slotKey) {
    const SLOT_LABEL = { weapon: '武器', armor: '裝備', accessory: '飾品' };
    const allUnits = [];
    for (const sq of this.army.getSquads()) {
      for (const m of sq.members) allUnits.push({ unit: m, squad: sq });
    }

    const rowsHTML = allUnits.length === 0
      ? `<div class="id-char-picker-empty">沒有可裝備的人物</div>`
      : allUnits.map(({ unit, squad }) => {
          const cur = unit.equipment?.[slotKey];
          const curText = cur ? `（已裝備：${cur.name}）` : '';
          return `
            <div class="id-char-picker-item" data-unit-id="${unit.id}" data-squad-id="${squad.id}" role="button" tabindex="0">
              <span class="id-char-picker-item-name">${unit.name}</span>
              <span class="id-char-picker-item-slot">${curText}</span>
            </div>`;
        }).join('');

    pickerEl.innerHTML = `
      <div class="id-char-picker-header">
        <span>選擇人物（${SLOT_LABEL[slotKey]}欄）</span>
        <button class="btn-equip-picker-cancel">✕</button>
      </div>
      ${rowsHTML}`;
    pickerEl.style.display = 'block';

    pickerEl.querySelector('.btn-equip-picker-cancel').addEventListener('click', () => {
      pickerEl.style.display = 'none';
    });

    pickerEl.querySelectorAll('.id-char-picker-item').forEach(row => {
      const confirm = () => {
        const unitId  = Number(row.dataset.unitId);
        const squadId = Number(row.dataset.squadId);
        const squad   = this.army.getSquads().find(s => s.id === squadId);
        const unit    = squad?.members.find(m => m.id === unitId);
        if (!unit) return;
        this._equipItemToUnit(unit, slotKey, item);
        this._closeItemDetail();
        this._renderBackpack();
      };
      row.addEventListener('click', confirm);
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); confirm(); } });
    });
  }



  /** Terrain colour palette for the minimap canvas. */
  static get _MINIMAP_COLORS() {
    return {
      0: '#1565C0', // WATER
      1: '#E8D5A3', // SAND
      2: '#4CAF50', // GRASS
      3: '#2E7D32', // FOREST
      4: '#546E7A', // MOUNTAIN
      5: '#8D8D8D', // CASTLE_GROUND
      6: '#C8A96E', // VILLAGE_GROUND
      7: '#8B6914', // PORT_GROUND
      8: '#8D9A5A', // HILL
    };
  }

  _openMinimap() {
    if (!this._mapData) return;

    const SCALE = 2; // pixels per tile (CSS-pixel space)
    const dpr   = window.devicePixelRatio || 1;
    const canvas = document.getElementById('ui-minimap-canvas');
    const wrap   = document.getElementById('ui-minimap-canvas-wrap');

    // Canvas bitmap size scaled by devicePixelRatio for sharp text on HiDPI screens
    canvas.width  = MAP_WIDTH  * SCALE * dpr;
    canvas.height = MAP_HEIGHT * SCALE * dpr;
    // Store dpr in instance state so _redrawMinimap can apply the matching ctx scale
    this._minimapDpr = dpr;

    // Natural display size at zoom=1 – fit inside the box
    const maxBoxWidth = Math.min(window.innerWidth * 0.88, 396) - 24;
    const displayScale = Math.min(1, maxBoxWidth / (MAP_WIDTH * SCALE));
    const naturalW = Math.round(MAP_WIDTH  * SCALE * displayScale);
    const naturalH = Math.round(MAP_HEIGHT * SCALE * displayScale);

    canvas.style.width  = `${naturalW}px`;
    canvas.style.height = `${naturalH}px`;
    // Store natural size so zoom/pan calculations are consistent
    canvas._naturalW = naturalW;
    canvas._naturalH = naturalH;
    wrap.style.height = `${naturalH + 24}px`; // match canvas + padding

    // Reset zoom / pan on every open
    this._minimapZoom = 1;
    this._minimapPanX = 0;
    this._minimapPanY = 0;
    this._applyMinimapTransform();

    // Sync tab button UI to current layer state
    document.querySelectorAll('.mm-tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.layer === this._minimapLayer);
    });

    this._redrawMinimap();
    document.getElementById('ui-minimap-overlay').classList.add('visible');
  }

  /**
   * (Re)draw the minimap canvas for the currently active layer.
   * Called when layer changes or when the minimap is opened.
   */
  _redrawMinimap() {
    if (!this._mapData) return;
    const SCALE = 2;
    const canvas = document.getElementById('ui-minimap-canvas');
    const ctx = canvas.getContext('2d');
    const dpr = this._minimapDpr || 1;
    // Reset and apply devicePixelRatio scale so all drawing is in CSS-pixel space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const COLORS = GameUI._MINIMAP_COLORS;

    // --- Base terrain layer ---
    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
      for (let tx = 0; tx < MAP_WIDTH; tx++) {
        const terrain = this._mapData.tiles[ty * MAP_WIDTH + tx];
        ctx.fillStyle = COLORS[terrain] ?? '#1565C0';
        ctx.fillRect(tx * SCALE, ty * SCALE, SCALE, SCALE);
      }
    }

    // --- Territory overlay layer ---
    if (this._minimapLayer === 'territory' && this.nationSystem) {
      this._drawMinimapTerritoryOverlay(ctx, SCALE);
    }

    // --- Settlement icons ---
    this._drawMinimapSettlements(ctx, SCALE);

    // --- Player marker ---
    this._drawMinimapPlayer(ctx, SCALE);
  }

  /**
   * Draw semi-transparent colored blobs for each nation's controlled territory,
   * plus a small nation name label.
   */
  _drawMinimapTerritoryOverlay(ctx, scale) {
    if (!this.nationSystem) return;
    const { castleSettlements, villageSettlements, nations } = this.nationSystem;
    const pk = this.getPlayerNation();

    /** Font size (px) for the territory nation-name labels. */
    const TERRITORY_LABEL_FONT_SIZE = 10;

    // Collect all settlements with their controlling color
    const allSettlements = [
      ...castleSettlements.map((s, i) => ({ s, tilePos: this._mapData.castles[i], size: 4 })),
      ...villageSettlements.map((s, i) => ({ s, tilePos: this._mapData.villages[i], size: 2 })),
    ];

    for (const { s, tilePos, size } of allSettlements) {
      if (!tilePos) continue;
      let color;
      if (s.controllingNationId === PLAYER_NATION_ID) {
        color = pk.color;
      } else if (s.controllingNationId === NEUTRAL_NATION_ID) {
        color = '#FFFFFF';
      } else {
        const nation = nations[s.controllingNationId];
        color = nation ? nation.color : '#9E9E9E';
      }

      // Draw a blurred/soft color blob covering the settlement footprint + a halo
      const radius = (size * scale) + scale * 3;
      const cx = (tilePos.x + size / 2) * scale;
      const cy = (tilePos.y + size / 2) * scale;

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, color + 'AA');
      grad.addColorStop(0.5, color + '55');
      grad.addColorStop(1, color + '00');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Small label for the controlling nation
      let label;
      if (s.controllingNationId === PLAYER_NATION_ID) {
        label = pk.name;
      } else if (s.controllingNationId === NEUTRAL_NATION_ID) {
        label = '中立';
      } else {
        const nation = nations[s.controllingNationId];
        label = nation ? nation.name : '';
      }
      if (label) {
        const lx = cx;
        const ly = cy + size * scale + scale * 3;
        ctx.font = `bold ${TERRITORY_LABEL_FONT_SIZE}px 'PingFang SC', 'Microsoft YaHei', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        // Outline for readability
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.lineWidth = 3;
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = color;
        ctx.fillText(label, lx, ly);
      }
    }
  }

  /**
   * Draw emoji-style icons for castles, villages, and ports on the minimap.
   * Uses a small font to stamp recognisable glyphs at each structure centre.
   */
  _drawMinimapSettlements(ctx, scale) {
    if (!this._mapData) return;
    /** Multiplier applied to `scale` to derive the icon font size in canvas pixels. */
    const ICON_SCALE_MULTIPLIER = 5;
    const iconSize = Math.max(9, scale * ICON_SCALE_MULTIPLIER); // font size in canvas pixels
    ctx.font = `${iconSize}px 'PingFang SC', 'Microsoft YaHei', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const drawIcon = (tileX, tileY, structSize, emoji) => {
      const cx = (tileX + structSize / 2) * scale;
      const cy = (tileY + structSize / 2) * scale;
      // Dark shadow for contrast on any background
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(emoji, cx + 0.5, cy + 0.5);
      ctx.fillStyle = '#fff';
      ctx.fillText(emoji, cx, cy);
    };

    for (const { x, y } of this._mapData.castles) {
      drawIcon(x, y, 4, '🏰');
    }
    for (const { x, y } of this._mapData.villages) {
      drawIcon(x, y, 2, '🏘️');
    }
  }

  _drawMinimapPlayer(ctx, scale) {
    if (!this.player) return;
    const tx = this.player.x / TILE_SIZE;
    const ty = this.player.y / TILE_SIZE;
    const px = tx * scale;
    const py = ty * scale;
    const r  = scale * 1.5;

    ctx.beginPath();
    ctx.arc(px, py, r + 1, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = '#FFD700';
    ctx.fill();
  }

  /**
   * Apply the current zoom/pan state to the minimap canvas via CSS transform.
   * Also updates the zoom percentage label.
   */
  _applyMinimapTransform() {
    const canvas = document.getElementById('ui-minimap-canvas');
    const wrap   = document.getElementById('ui-minimap-canvas-wrap');
    if (!canvas) return;

    const z  = this._minimapZoom;
    const px = this._minimapPanX;
    const py = this._minimapPanY;

    // Clamp pan so canvas never scrolls fully out of view
    const nw = canvas._naturalW ?? canvas.clientWidth;
    const nh = canvas._naturalH ?? canvas.clientHeight;
    const maxPanX = ((z - 1) * nw) / 2;
    const maxPanY = ((z - 1) * nh) / 2;
    this._minimapPanX = Math.max(-maxPanX, Math.min(maxPanX, this._minimapPanX));
    this._minimapPanY = Math.max(-maxPanY, Math.min(maxPanY, this._minimapPanY));

    canvas.style.transform       = `scale(${z}) translate(${this._minimapPanX / z}px, ${this._minimapPanY / z}px)`;
    canvas.style.transformOrigin = 'center center';

    // Centre the canvas in the wrap at all times (wrap uses flexbox center)
    const zoomLabel = document.getElementById('mm-zoom-label');
    if (zoomLabel) zoomLabel.textContent = `${Math.round(z * 100)}%`;

    // Disable drag cursor when not zoomed in
    if (wrap) wrap.style.cursor = z > 1 ? 'grab' : 'default';
  }

  /**
   * Change zoom level by `steps` (positive = zoom in, negative = zoom out).
   * Zoom steps: 1× → 1.5× → 2× → 3× → 4×
   */
  _minimapZoomBy(steps) {
    const LEVELS = [1, 1.5, 2, 3, 4];
    const current = this._minimapZoom;
    let idx = LEVELS.findIndex(l => Math.abs(l - current) < 0.01);
    if (idx === -1) idx = 0;
    idx = Math.max(0, Math.min(LEVELS.length - 1, idx + steps));
    this._minimapZoom = LEVELS[idx];
    // When zooming out to 1× reset pan
    if (this._minimapZoom === 1) {
      this._minimapPanX = 0;
      this._minimapPanY = 0;
    }
    this._applyMinimapTransform();
  }

  /**
   * Pan the minimap by `dx`/`dy` CSS pixels.
   */
  _minimapPanBy(dx, dy) {
    this._minimapPanX += dx;
    this._minimapPanY += dy;
    this._applyMinimapTransform();
  }

  _closeMinimap() {
    document.getElementById('ui-minimap-overlay').classList.remove('visible');
  }

  // -------------------------------------------------------------------------
  // Guide overlay (開國指南)
  // -------------------------------------------------------------------------

  /** Tutorial chapter definitions. */
  static get _GUIDE_CHAPTERS() {
    return [
      {
        icon: '🚶',
        name: '基礎操作',
        summary: '移動與鏡頭控制',
        content: `
          <div class="guide-section">
            <div class="guide-section-heading">角色移動</div>
            <p>使用 <span class="guide-key">W</span><span class="guide-key">A</span><span class="guide-key">S</span><span class="guide-key">D</span> 或方向鍵在地圖上移動角色。</p>
            <p>在行動裝置上，可使用畫面左下角的虛擬搖桿控制移動方向。</p>
          </div>
          <div class="guide-section">
            <div class="guide-section-heading">鏡頭控制</div>
            <p>滑鼠滾輪可縮放鏡頭。畫面右下角顯示當前地形類型。</p>
            <p>鏡頭會自動跟隨主角，讓你隨時掌握周圍環境。</p>
          </div>
          <div class="guide-section">
            <div class="guide-section-heading">地形標示</div>
            <p>左下角的地形標籤會顯示你目前所在的地形（草原、森林、沙灘、山地等），不同地形對移動速度有所影響。</p>
          </div>
          <div class="guide-tip">💡 靠近城堡或村落時，畫面會出現「進入設施」或「進攻」按鈕。</div>
        `,
      },
      {
        icon: '🎒',
        name: '背包管理',
        summary: '物品分類與使用',
        content: `
          <div class="guide-section">
            <div class="guide-section-heading">開啟背包</div>
            <p>點選畫面右上角的 🎒 按鈕即可開啟背包。物品依類型分為多個分頁：裝備、飾品、糧食、藥水、實用、資源、戰利品、地圖（含指南）、其他。</p>
          </div>
          <div class="guide-section">
            <div class="guide-section-heading">查看與使用物品</div>
            <p>點選物品列表中的任一項目，可查看其詳細說明與屬性。</p>
            <p>藥水、糧食等消耗品可點選「使用」按鈕來觸發效果。地圖可開啟全域地圖檢視。</p>
          </div>
          <div class="guide-section">
            <div class="guide-section-heading">丟棄物品</div>
            <p>在物品詳情頁點選「🗑 丟棄」按鈕，可將物品從背包中移除。</p>
          </div>
          <div class="guide-tip">💡 同名、同類的物品會自動疊加，節省背包空間。</div>
        `,
      },
      {
        icon: '⚔️',
        name: '隊伍管理',
        summary: '小隊編制與成員',
        content: `
          <div class="guide-section">
            <div class="guide-section-heading">隊伍面板</div>
            <p>點選 ⚔️ 按鈕可開啟隊伍面板，查看目前所有小隊的成員狀況。</p>
            <p>你可以管理多支小隊，每支小隊有固定的人員上限。</p>
          </div>
          <div class="guide-section">
            <div class="guide-section-heading">隊長制度</div>
            <p>擁有「隊長」特性的成員可擔任小隊隊長，提升整支小隊的士氣與戰力。</p>
            <p>派遣擁有策略、重步兵等特性的武將，可獲得額外的戰鬥加成。</p>
          </div>
          <div class="guide-section">
            <div class="guide-section-heading">成員詳情</div>
            <p>點選成員卡片可查看其角色、攻擊、防禦、特性等詳細資訊，並可選擇移除或調換至其他小隊。</p>
          </div>
          <div class="guide-tip">💡 在酒館中可招募新的成員加入你的隊伍。</div>
        `,
      },
      {
        icon: '🏰',
        name: '建設王國',
        summary: '攻城略地與建造',
        content: `
          <div class="guide-section">
            <div class="guide-section-heading">攻佔定居點</div>
            <p>靠近城堡或村落後，點選「⚔ 進攻」按鈕開啟戰前部署，勝利後即可佔領該定居點。</p>
            <p>佔領定居點後，可在 🏰 王國面板中查看領土資訊及資源收益。</p>
          </div>
          <div class="guide-section">
            <div class="guide-section-heading">地圖建造</div>
            <p>在可建造地形（草原、丘陵等）旁邊，畫面會出現「建造」按鈕。點選後可選擇建造農場、伐木場、礦場等資源設施。</p>
          </div>
          <div class="guide-section">
            <div class="guide-section-heading">王國類型</div>
            <p>初始為「騎士團」，攻佔定居點後可在外觀面板升格為王國、公國、帝國等更強大的政體。</p>
          </div>
          <div class="guide-tip">💡 駐守軍隊雖能提升定居點安全，但會降低稅收效率。</div>
        `,
      },
      {
        icon: '🤝',
        name: '外交系統',
        summary: '勢力關係與貿易',
        content: `
          <div class="guide-section">
            <div class="guide-section-heading">勢力關係</div>
            <p>點選 🏰 按鈕開啟王國面板，可查看與各勢力的外交關係。關係分為：友好、中立、緊張、敵對等等級。</p>
            <p>不同個性的統治者（傲慢、好戰、溫和、狡猾、謹慎）對外交行動反應各異。</p>
          </div>
          <div class="guide-section">
            <div class="guide-section-heading">貿易路線</div>
            <p>與友好勢力建立貿易路線，每天可獲得固定的金幣收入，是穩定財政的重要手段。</p>
          </div>
          <div class="guide-section">
            <div class="guide-section-heading">外交行動</div>
            <p>在各勢力卡片中可執行送禮、宣戰、求和等外交行動。選擇合適的時機，以最小代價實現擴張目標。</p>
          </div>
          <div class="guide-tip">💡 定期查看「關係網」可掌握各勢力之間的動態，從中漁利。</div>
        `,
      },
      {
        icon: '⚔️',
        name: '戰鬥指南',
        summary: '部署、交戰與撤退',
        content: `
          <div class="guide-section">
            <div class="guide-section-heading">戰前部署</div>
            <p>點選「進攻」後開啟戰前部署面板，勾選要出戰的小隊，確認後進入戰鬥。</p>
            <p>選擇隊長強、人數多的小隊可大幅提升勝率。</p>
          </div>
          <div class="guide-section">
            <div class="guide-section-heading">戰鬥指令</div>
            <p><strong>⚔ 進攻</strong>：主動出擊，攻擊力加成但防禦降低。<br>
            <strong>🛡 防守</strong>：加強防禦，適合消耗敵方兵力。<br>
            <strong>🏃 後退</strong>：嘗試撤退，保存有生力量。</p>
          </div>
          <div class="guide-section">
            <div class="guide-section-heading">勝負判定</div>
            <p>一方 HP 歸零或選擇後退則戰鬥結束。勝利後可佔領定居點並獲得戰利品；失敗則需重整旗鼓再戰。</p>
          </div>
          <div class="guide-tip">💡 攻城前先派「偵察鷹」道具偵察，可事先了解敵方兵力配置。</div>
        `,
      },
    ];
  }

  _openGuide() {
    this._renderGuide(-1);
    document.getElementById('ui-guide-overlay').classList.add('visible');
  }

  _closeGuide() {
    document.getElementById('ui-guide-overlay').classList.remove('visible');
  }

  /**
   * Render the guide overlay for a given page index.
   * @param {number} pageIndex  -1 = nav/index page; 0..N-1 = chapter
   */
  _renderGuide(pageIndex) {
    const chapters = GameUI._GUIDE_CHAPTERS;
    // Clamp to valid range: -1 (nav) or 0..N-1 (chapter)
    const clamped = Math.max(-1, Math.min(chapters.length - 1, pageIndex));
    this._guidePageIndex = clamped;

    const isNav = clamped < 0;
    const backEl   = document.getElementById('ui-guide-back');
    const titleEl  = document.getElementById('ui-guide-title');
    const bodyEl   = document.getElementById('ui-guide-body');
    const footerEl = document.getElementById('ui-guide-footer');
    const prevBtn  = document.getElementById('ui-guide-prev');
    const nextBtn  = document.getElementById('ui-guide-next');
    const pageLabel = document.getElementById('ui-guide-page-label');

    if (isNav) {
      backEl.style.display = 'none';
      titleEl.textContent = '📖 開國指南';
      footerEl.classList.remove('visible');

      bodyEl.innerHTML = `
        <p class="guide-intro">歡迎來到《你的王國》！本指南將帶你快速掌握遊戲的核心系統，點選下方章節開始閱讀。</p>
        <div class="guide-chapter-grid">
          ${chapters.map((ch, i) => `
            <div class="guide-chapter-card" data-chapter="${i}" role="button" tabindex="0">
              <span class="guide-chapter-icon">${ch.icon}</span>
              <span class="guide-chapter-name">${ch.name}</span>
              <span class="guide-chapter-summary">${ch.summary}</span>
            </div>`).join('')}
        </div>
      `;

    } else {
      const ch = chapters[clamped];
      backEl.style.display = '';
      titleEl.textContent = `${ch.icon} ${ch.name}`;
      footerEl.classList.add('visible');

      prevBtn.disabled = clamped === 0;
      nextBtn.disabled = clamped === chapters.length - 1;
      pageLabel.textContent = `${clamped + 1} / ${chapters.length}`;

      bodyEl.innerHTML = ch.content;
    }

    bodyEl.scrollTop = 0;
  }

  _renderSettings() {
    const content = document.getElementById('ui-panel-content');
    content.innerHTML = `
      <div class="settings-section">
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="settings-row-icon">🔄</span>
            <div>
              <div class="settings-row-title">重置遊戲</div>
              <div class="settings-row-desc">清除所有存檔，重新開始全新的冒險</div>
            </div>
          </div>
          <button id="btn-reset-game" class="btn-danger">重置</button>
        </div>
      </div>

      <div class="settings-section settings-dev-section">
        <div class="settings-dev-header">🛠 開發者工具</div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="settings-row-icon">🪙</span>
            <div>
              <div class="settings-row-title">金幣操作</div>
              <div class="settings-row-desc">目前持有：<span id="dev-gold-display">${this._getGold()}</span> 金幣</div>
            </div>
          </div>
          <div class="dev-gold-btns">
            <button id="dev-btn-add100"   class="dev-gold-btn">+100</button>
            <button id="dev-btn-add1000"  class="dev-gold-btn">+1000</button>
            <button id="dev-btn-sub100"   class="dev-gold-btn dev-gold-btn-sub">−100</button>
            <button id="dev-btn-sub1000"  class="dev-gold-btn dev-gold-btn-sub">−1000</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-reset-game').addEventListener('click', () => {
      if (window.confirm('確定要重置遊戲嗎？\n所有存檔將被清除，無法復原。')) {
        if (typeof this.onReset === 'function') {
          this.onReset();
        }
      }
    });

    const _refreshDevGold = () => {
      const el = document.getElementById('dev-gold-display');
      if (el) el.textContent = this._getGold();
    };

    document.getElementById('dev-btn-add100').addEventListener('click', () => {
      this._addGold(100);
      _refreshDevGold();
    });
    document.getElementById('dev-btn-add1000').addEventListener('click', () => {
      this._addGold(1000);
      _refreshDevGold();
    });
    document.getElementById('dev-btn-sub100').addEventListener('click', () => {
      this._spendGold(100);
      _refreshDevGold();
    });
    document.getElementById('dev-btn-sub1000').addEventListener('click', () => {
      this._spendGold(1000);
      _refreshDevGold();
    });
  }

  // -------------------------------------------------------------------------
  // Appearance customization panel
  // -------------------------------------------------------------------------

  _renderAppearance() {
    const content = document.getElementById('ui-panel-content');
    const tab = this._appearanceTab;

    content.innerHTML = `
      <div class="ap-main-tabs">
        <button class="ap-main-tab-btn${tab === 'character' ? ' active' : ''}" data-ap-tab="character">👤 角色</button>
        <button class="ap-main-tab-btn${tab === 'kingdom'   ? ' active' : ''}" data-ap-tab="kingdom">🏴 王國</button>
      </div>
      <div id="ap-tab-content"></div>
    `;

    content.querySelectorAll('.ap-main-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._appearanceTab = btn.dataset.apTab;
        this._renderAppearance();
      });
    });

    if (tab === 'kingdom') {
      this._renderAppearanceKingdom();
    } else {
      this._renderAppearanceCharacter();
    }
  }

  _renderAppearanceCharacter() {
    const content = document.getElementById('ap-tab-content');

    const app = this.player
      ? this.player.appearance
      : charAppearanceFromIndices(DEFAULT_APPEARANCE_INDICES);

    const playerName = this.player?.name ?? '主角';

    const _swatch = (colors, selectedIdx, dataAttr) =>
      colors.map((c, i) =>
        `<button class="ap-swatch${i === selectedIdx ? ' selected' : ''}" data-${dataAttr}="${i}"
                 style="background:${c};width:28px;height:28px;border-radius:50%;cursor:pointer"></button>`
      ).join('');

    const headgearHTML = CHAR_HEADGEAR_TYPES.map((t, i) =>
      `<button class="ap-choice${i === app.headgearIdx ? ' selected' : ''}" data-headgear="${i}">${CHAR_HEADGEAR_LABELS[i]}</button>`
    ).join('');

    const bodyShapeHTML = CHAR_BODY_SHAPES.map((s, i) =>
      `<button class="ap-choice${i === (app.bodyShapeIdx ?? 0) ? ' selected' : ''}" data-body-shape="${i}">${CHAR_BODY_SHAPE_LABELS[i]}</button>`
    ).join('');

    const faceAccHTML = CHAR_FACE_ACCESSORIES.map((a, i) =>
      `<button class="ap-choice${i === (app.faceAccIdx ?? 0) ? ' selected' : ''}" data-face-acc="${i}">${CHAR_FACE_ACCESSORY_LABELS[i]}</button>`
    ).join('');

    content.innerHTML = `
      <div class="ap-preview-row">
        <div id="ap-preview-wrap"></div>
        <span class="ap-preview-label">玩家外觀預覽</span>
      </div>
      <div class="ap-section">
        <div class="ap-section-title">角色名稱</div>
        <input type="text" id="ap-name-input" class="kp-name-input"
               value="${_escapeAttr(playerName)}" maxlength="16" placeholder="輸入角色名稱…"
               inputmode="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      </div>
      <div class="ap-section">
        <div class="ap-section-title">體型</div>
        <div class="ap-choices">${bodyShapeHTML}</div>
      </div>
      <div class="ap-section">
        <div class="ap-section-title">衣甲顏色</div>
        <div class="ap-swatches" id="ap-body-swatches">
          ${_swatch(CHAR_BODY_COLORS_CSS, app.bodyColorIdx, 'body')}
        </div>
      </div>
      <div class="ap-section">
        <div class="ap-section-title">頭部造型</div>
        <div class="ap-choices">${headgearHTML}</div>
      </div>
      <div class="ap-section">
        <div class="ap-section-title">護甲顏色</div>
        <div class="ap-swatches" id="ap-armor-swatches">
          ${_swatch(CHAR_ARMOR_COLORS_CSS, app.armorColorIdx, 'armor')}
        </div>
      </div>
      <div class="ap-section">
        <div class="ap-section-title">臉部飾品</div>
        <div class="ap-choices">${faceAccHTML}</div>
      </div>
      <div class="ap-section">
        <div class="ap-section-title">標記顏色</div>
        <div class="ap-swatches" id="ap-mark-swatches">
          ${_swatch(CHAR_MARK_COLORS_CSS, app.markColorIdx, 'mark')}
        </div>
      </div>
    `;

    // Track pending changes without hitting the player object on every click
    let pending = {
      playerName:    playerName,
      bodyColorIdx:  app.bodyColorIdx,
      headgearIdx:   app.headgearIdx,
      armorColorIdx: app.armorColorIdx,
      markColorIdx:  app.markColorIdx,
      bodyShapeIdx:  app.bodyShapeIdx  ?? 0,
      faceAccIdx:    app.faceAccIdx    ?? 0,
    };

    const _refreshPreview = () => {
      const preview = charAppearanceFromIndices(pending);
      document.getElementById('ap-preview-wrap').innerHTML = renderCharHTML(preview, 56);
    };
    _refreshPreview();

    const _apply = () => {
      if (this.player) this.player.setAppearance(pending);
      // Sync the hero Unit in the army so the party screen reflects the new look.
      if (this.army) {
        const heroUnit = this.army.squads[0]?.members.find(m => m.role === 'hero');
        if (heroUnit) {
          heroUnit.appearance = charAppearanceFromIndices(pending);
          heroUnit.name = pending.playerName;
        }
      }
      // Notify multiplayer so the updated appearance is broadcast to other players.
      if (typeof this.onPlayerAppearanceChanged === 'function') {
        this.onPlayerAppearanceChanged();
      }
    };

    // Player name input
    const nameInput = content.querySelector('#ap-name-input');
    let _nameTimer = null;
    nameInput.addEventListener('input', () => {
      pending.playerName = nameInput.value.trim() || '主角';
      clearTimeout(_nameTimer);
      _nameTimer = setTimeout(() => _apply(), 300);
    });

    /**
     * Wire up swatch/choice buttons for one appearance part.
     * @param {string} attr      data attribute name
     * @param {string} pendingKey key to update in the `pending` object
     */
    const _wireSwatches = (attr, pendingKey) => {
      const camelAttr = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const btns = content.querySelectorAll(`[data-${attr}]`);
      btns.forEach(btn => {
        btn.addEventListener('click', () => {
          pending[pendingKey] = Number(btn.dataset[camelAttr]);
          btns.forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          _apply();
          _refreshPreview();
        });
      });
    };

    _wireSwatches('body',       'bodyColorIdx');
    _wireSwatches('headgear',   'headgearIdx');
    _wireSwatches('armor',      'armorColorIdx');
    _wireSwatches('mark',       'markColorIdx');
    _wireSwatches('body-shape', 'bodyShapeIdx');
    _wireSwatches('face-acc',   'faceAccIdx');
  }

  _renderAppearanceKingdom() {
    const content = document.getElementById('ap-tab-content');
    const k = this._playerKingdom;
    const hasSettlements = this._playerSettlementCount > 0;

    const _flagApp = () => flagAppFromIndices({
      bgIdx:          this._playerKingdom.flagBgIdx,
      stripeStyleIdx: this._playerKingdom.flagStripeStyleIdx,
      stripeColorIdx: this._playerKingdom.flagStripeColorIdx,
      symbolIdx:      this._playerKingdom.flagSymbolIdx,
    });

    const bgSwatchesHTML = FLAG_BG_COLORS.map((c, i) =>
      `<button class="ap-swatch${i === k.flagBgIdx ? ' selected' : ''}" data-flag-bg="${i}"
               style="background:${c};width:28px;height:28px;border-radius:50%;cursor:pointer"></button>`
    ).join('');

    const stripeStyleHTML = FLAG_STRIPE_STYLES.map((s, i) =>
      `<button class="ap-choice${i === k.flagStripeStyleIdx ? ' selected' : ''}" data-flag-stripe-style="${i}">${_STRIPE_STYLE_LABELS[i]}</button>`
    ).join('');

    const stripeColorHTML = FLAG_STRIPE_COLORS.map((c, i) =>
      `<button class="ap-swatch${i === k.flagStripeColorIdx ? ' selected' : ''}" data-flag-stripe-color="${i}"
               style="background:${c};width:28px;height:28px;border-radius:50%;cursor:pointer"></button>`
    ).join('');

    const symbolHTML = FLAG_SYMBOL_LABELS.map((label, i) =>
      `<button class="ap-choice${i === k.flagSymbolIdx ? ' selected' : ''}" data-flag-symbol="${i}" title="${label}">${label}</button>`
    ).join('');

    const kingdomTypeHTML = _KINGDOM_TYPES.map(t => {
      const locked = t.requiresSettlement && !hasSettlements;
      return `<button class="ap-choice${k.type === t.id ? ' selected' : ''}${locked ? ' kp-locked' : ''}"
                      data-kingdom-type="${t.id}" ${locked ? 'disabled title="需要控制城堡或村落才能解鎖"' : ''}>${t.id}</button>`;
    }).join('');

    content.innerHTML = `
      <div class="ap-preview-row kp-preview-row">
        <div id="kp-flag-preview">${renderFlagHTML(_flagApp(), 64)}</div>
        <div class="kp-preview-info">
          <span class="kp-preview-name" id="kp-name-display">${k.name}</span>
          <span class="kp-preview-type" id="kp-type-display">${k.type}</span>
        </div>
      </div>

      <div class="ap-section">
        <div class="ap-section-title">國名</div>
        <input type="text" id="kp-name-input" class="kp-name-input"
               value="${k.name}" maxlength="20" placeholder="輸入國名…"
               inputmode="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      </div>

      <div class="ap-section">
        <div class="ap-section-title">國體</div>
        <div class="ap-choices">${kingdomTypeHTML}</div>
        ${!hasSettlements ? '<div class="kp-lock-hint">⚠ 控制城堡或村落後可解鎖更多國體</div>' : ''}
      </div>

      <div class="ap-section">
        <div class="ap-section-title">旗幟底色</div>
        <div class="ap-swatches">${bgSwatchesHTML}</div>
      </div>

      <div class="ap-section">
        <div class="ap-section-title">紋路樣式</div>
        <div class="ap-choices">${stripeStyleHTML}</div>
      </div>

      <div class="ap-section">
        <div class="ap-section-title">紋路顏色</div>
        <div class="ap-swatches">${stripeColorHTML}</div>
      </div>

      <div class="ap-section">
        <div class="ap-section-title">旗幟符號</div>
        <div class="ap-choices">${symbolHTML}</div>
      </div>
    `;

    const _refreshFlagPreview = () => {
      document.getElementById('kp-flag-preview').innerHTML = renderFlagHTML(_flagApp(), 64);
    };

    // Kingdom name input
    const nameInput = content.querySelector('#kp-name-input');
    const nameDisplay = document.getElementById('kp-name-display');
    let _nameChangeTimer = null;
    nameInput.addEventListener('input', () => {
      this._playerKingdom.name = nameInput.value || DEFAULT_KINGDOM.name;
      nameDisplay.textContent = this._playerKingdom.name;
      // Debounce map rebuild so it doesn't fire on every keystroke.
      clearTimeout(_nameChangeTimer);
      _nameChangeTimer = setTimeout(() => {
        if (typeof this.onPlayerKingdomChanged === 'function') {
          this.onPlayerKingdomChanged();
        }
      }, 400);
    });

    // Kingdom type buttons
    content.querySelectorAll('[data-kingdom-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._playerKingdom.type = btn.dataset.kingdomType;
        content.querySelectorAll('[data-kingdom-type]').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('kp-type-display').textContent = this._playerKingdom.type;
      });
    });

    /**
     * Wire flag-swatch/choice buttons for one flag property.
     * @param {string} dataAttr   data-* attribute (e.g. 'flag-bg')
     * @param {string} kingdomKey key to update in `this._playerKingdom`
     */
    const _wireFlagPart = (dataAttr, kingdomKey) => {
      const btns = content.querySelectorAll(`[data-${dataAttr}]`);
      const camel = dataAttr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      btns.forEach(btn => {
        btn.addEventListener('click', () => {
          this._playerKingdom[kingdomKey] = Number(btn.dataset[camel]);
          btns.forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          _refreshFlagPreview();
          if (typeof this.onPlayerKingdomChanged === 'function') {
            this.onPlayerKingdomChanged();
          }
        });
      });
    };

    _wireFlagPart('flag-bg',           'flagBgIdx');
    _wireFlagPart('flag-stripe-style', 'flagStripeStyleIdx');
    _wireFlagPart('flag-stripe-color', 'flagStripeColorIdx');
    _wireFlagPart('flag-symbol',       'flagSymbolIdx');
  }

  // -------------------------------------------------------------------------
  // Player nation helpers
  // -------------------------------------------------------------------------

  /** Build the player's flag appearance object from their current kingdom settings. */
  _getPlayerFlagApp() {
    return flagAppFromIndices({
      bgIdx:          this._playerKingdom.flagBgIdx,
      stripeStyleIdx: this._playerKingdom.flagStripeStyleIdx,
      stripeColorIdx: this._playerKingdom.flagStripeColorIdx,
      symbolIdx:      this._playerKingdom.flagSymbolIdx,
    });
  }

  /**
   * Return a nation-shaped object representing the player's kingdom.
   * Uses the flag's background colour as the display colour so every
   * consumer (settlement detail, map structures, diplomacy panel) reads
   * from the same computed source.
   * @returns {{ color: string, emblem: string, name: string, flagApp: object }}
   */
  getPlayerNation() {
    const flagApp = this._getPlayerFlagApp();
    return {
      color:   flagApp.bgColor,
      emblem:  '🏴',
      name:    this._playerKingdom.name,
      flagApp,
    };
  }

  // -------------------------------------------------------------------------
  // Nations panel
  // -------------------------------------------------------------------------

  _renderNations() {
    const content = document.getElementById('ui-panel-content');

    if (!this.nationSystem) {
      content.innerHTML = '<p class="ui-empty">王國系統尚未初始化</p>';
      return;
    }

    content.innerHTML = '<div id="ns-diplomacy-content"></div>';
    this._renderDiplomacy();
  }

  // -------------------------------------------------------------------------
  // Diplomacy panel
  // -------------------------------------------------------------------------

  _renderDiplomacy() {
    const el = document.getElementById('ns-diplomacy-content');
    if (!el) return;

    if (!this.diplomacySystem || !this.nationSystem) {
      el.innerHTML = '<p class="ui-empty">外交系統尚未初始化</p>';
      return;
    }

    const { nations, castleSettlements, villageSettlements } = this.nationSystem;

    // Group villages by controllingNationId for quick lookup
    const villagesByController = {};
    villageSettlements.forEach((v, idx) => {
      const cid = v.controllingNationId;
      if (!villagesByController[cid]) villagesByController[cid] = [];
      villagesByController[cid].push({ s: v, idx });
    });

    // Group castles by controllingNationId
    const castlesByController = {};
    castleSettlements.forEach((c, idx) => {
      const cid = c.controllingNationId;
      if (!castlesByController[cid]) castlesByController[cid] = [];
      castlesByController[cid].push({ s: c, idx });
    });

    const _personalityLabel = (traits) => {
      const p = traits.find(t => ALL_PERSONALITIES.includes(t));
      if (!p) return '';
      const color = PERSONALITY_COLORS[p] ?? '#fff';
      return `<span class="dipl-personality" style="color:${color}">${p}</span>`;
    };

    // -----------------------------------------------------------------------
    // Player nation card (shown when the player controls any settlement)
    // -----------------------------------------------------------------------
    const pk = this.getPlayerNation();
    const playerCastles  = castlesByController[PLAYER_NATION_ID]  ?? [];
    const playerVillages = villagesByController[PLAYER_NATION_ID] ?? [];
    let playerSectionHTML = '';

    if (playerCastles.length > 0 || playerVillages.length > 0) {
      const flagH = pk.flagApp ? renderFlagHTML(pk.flagApp, 32) : '🏴';
      const pCastleRows = playerCastles.map(({ s, idx }) => `
        <div class="dn-settlement-row" data-ns-type="castle" data-ns-idx="${idx}" role="button" tabindex="0">
          <span class="dn-s-icon">🏰</span>
          <span class="dn-s-name">${s.name}</span>
          <span class="dn-s-pop">👥 ${s.population.toLocaleString()}</span>
          <span class="dn-s-eco">${'⭐'.repeat(s.economyLevel)}</span>
          <span class="dn-s-res">${s.resources.join('、')}</span>
          <span class="dn-s-arrow">›</span>
        </div>`).join('');
      const pVillageRows = playerVillages.map(({ s, idx }) => `
        <div class="dn-settlement-row" data-ns-type="village" data-ns-idx="${idx}" role="button" tabindex="0">
          <span class="dn-s-icon">🏘️</span>
          <span class="dn-s-name">${s.name}</span>
          <span class="dn-s-pop">👥 ${s.population.toLocaleString()}</span>
          <span class="dn-s-eco">${'⭐'.repeat(s.economyLevel)}</span>
          <span class="dn-s-res">${s.resources.join('、')}</span>
          <span class="dn-s-arrow">›</span>
        </div>`).join('');

      playerSectionHTML = `
        <div class="dipl-nation-card dipl-player-card" style="--nc-color:${pk.color};border-color:${pk.color}44">
          <div class="dn-header">
            <span class="dn-flag">${flagH}</span>
            <div class="dn-title-col">
              <div class="dn-name">${pk.name} <span class="sc-player-badge">我方</span></div>
              <div class="dn-ruler-line">${this._playerKingdom.type}</div>
            </div>
          </div>
          <div class="dn-settlements">${pCastleRows}${pVillageRows}</div>
        </div>`;
    }

    // -----------------------------------------------------------------------
    // NPC nation cards
    // -----------------------------------------------------------------------
    const nationCardsHTML = nations.map((nation, id) => {
      const castle = castleSettlements[id];
      const castleControlled = castle?.controllingNationId === id;
      const villages = villagesByController[id] ?? [];
      const isExtinct = !castleControlled && villages.length === 0;

      // Extinct nations are completely removed from the panel.
      if (isExtinct) return '';

      const val     = this.diplomacySystem.getPlayerRelation(id);
      const level   = this.diplomacySystem.getRelationLevel(val);
      const atWar   = this.diplomacySystem.isAtWar(_PLAYER_NATION_ID_UI, id);
      const hasNap  = this.diplomacySystem.hasNonAggressionPact(_PLAYER_NATION_ID_UI, id);
      const hasMpt  = this.diplomacySystem.hasMutualProtectionPact(_PLAYER_NATION_ID_UI, id);

      const flagH = nation.flagApp
        ? renderFlagHTML(nation.flagApp, 32)
        : `<span>${nation.emblem}</span>`;

      const relVal = val > 0 ? `+${val}` : `${val}`;
      const warBadge = atWar ? `<span class="dipl-war-badge">⚔ 戰爭中</span>` : '';
      const napBadge = hasNap ? `<span class="dipl-pact-badge dipl-nap-badge">☮ 互不侵犯</span>` : '';
      const mptBadge = hasMpt ? `<span class="dipl-pact-badge dipl-mpt-badge">🛡 互保</span>` : '';
      const headerHTML = `
        <div class="dn-header">
          <span class="dn-flag">${flagH}</span>
          <div class="dn-title-col">
            <div class="dn-name">
              ${nation.name} ${warBadge}${napBadge}${mptBadge}
            </div>
            <div class="dn-ruler-line">
              ${castle ? `${castle.ruler.name}（${castle.ruler.role}） ${_personalityLabel(castle.ruler.traits)}` : ''}
            </div>
          </div>
          <div class="dn-rel-col">
            <div class="dn-level" style="color:${level.color}">${level.icon} ${level.label}</div>
            <div class="dn-val" style="color:${level.color}">${relVal}</div>
          </div>
          <button class="dipl-relations-btn" data-nation-id="${id}" title="查看與各國關係">🔍 關係網</button>
        </div>
        <div class="dn-bar-wrap">
          <div class="dn-bar" style="width:${(val + 100) / 2}%;background:${level.color}"></div>
        </div>
        <div class="dn-relations-panel" id="dn-relp-${id}" style="display:none"></div>`;

      // Castle row: show if still controlled by this nation, or mark as captured
      let castleRowHTML = '';
      if (castle) {
        if (castleControlled) {
          castleRowHTML = `
            <div class="dn-settlement-row" data-ns-type="castle" data-ns-idx="${id}" role="button" tabindex="0">
              <span class="dn-s-icon">🏰</span>
              <span class="dn-s-name">${castle.name}</span>
              <span class="dn-s-pop">👥 ${castle.population.toLocaleString()}</span>
              <span class="dn-s-eco">${'⭐'.repeat(castle.economyLevel)}</span>
              <span class="dn-s-res">${castle.resources.join('、')}</span>
              <span class="dn-s-arrow">›</span>
            </div>`;
        } else {
          // Castle has been captured (by another NPC or the player)
          castleRowHTML = `
            <div class="dn-settlement-row dn-captured-row" data-ns-type="castle" data-ns-idx="${id}" role="button" tabindex="0">
              <span class="dn-s-icon">🏰</span>
              <span class="dn-s-name">${castle.name}
                <span class="sc-player-badge">已佔領</span>
              </span>
              <span class="dn-s-pop">👥 ${castle.population.toLocaleString()}</span>
              <span class="dn-s-arrow">›</span>
            </div>`;
        }
      }

      const villageRows = villages.map(({ s, idx }) => `
        <div class="dn-settlement-row" data-ns-type="village" data-ns-idx="${idx}" role="button" tabindex="0">
          <span class="dn-s-icon">🏘️</span>
          <span class="dn-s-name">${s.name}</span>
          <span class="dn-s-pop">👥 ${s.population.toLocaleString()}</span>
          <span class="dn-s-eco">${'⭐'.repeat(s.economyLevel)}</span>
          <span class="dn-s-res">${s.resources.join('、')}</span>
          <span class="dn-s-arrow">›</span>
        </div>`).join('');

      // Memory log (most recent entries, shown newest first)
      const memory = this.diplomacySystem.getNationMemory(id);
      let memoryHTML = '';
      if (memory.length > 0) {
        const entries = memory.slice(-5).reverse();
        const rows = entries.map(e => {
          const sign  = e.delta >= 0 ? `+${e.delta}` : `${e.delta}`;
          const color = e.delta >= 0 ? '#43a047' : '#e53935';
          return `<div class="dn-memory-entry">
            <span class="dn-mem-desc">${e.desc}</span>
            <span class="dn-mem-delta" style="color:${color}">${sign}</span>
          </div>`;
        }).join('');
        memoryHTML = `<div class="dn-memory">
          <div class="dn-memory-title">📋 近期記憶</div>
          ${rows}
        </div>`;
      }

      return `
        <div class="dipl-nation-card" style="--nc-color:${nation.color};border-color:${nation.color}44">
          ${headerHTML}
          <div class="dn-settlements">${castleRowHTML}${villageRows}</div>
          ${memoryHTML}
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="dipl-intro">各國外交關係受距離、資源競爭及統治者性格影響。<br>
        <span style="color:#ef6c00">傲慢</span>、<span style="color:#e53935">好戰</span>的統治者可能自發惡化關係；
        <span style="color:#66bb6a">溫和</span>的統治者會主動釋出善意。</div>
      ${playerSectionHTML}
      <div class="dipl-nation-list">${nationCardsHTML}</div>`;

    // "查看關係網" buttons – toggle inline inter-nation relations panel
    el.querySelectorAll('.dipl-relations-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const nationId = Number(btn.dataset.nationId);
        const panel = document.getElementById(`dn-relp-${nationId}`);
        if (!panel) return;
        if (panel.style.display !== 'none') {
          panel.style.display = 'none';
          btn.classList.remove('active');
          return;
        }
        btn.classList.add('active');
        this._renderNationRelationsPanel(nationId, panel);
        panel.style.display = '';
      });
    });

    // Settlement row clicks → open detail overlay
    el.querySelectorAll('.dn-settlement-row[data-ns-type]').forEach(row => {
      const open = () => {
        const idx  = Number(row.dataset.nsIdx);
        const type = row.dataset.nsType;
        const s    = type === 'castle'
          ? this.nationSystem.castleSettlements[idx]
          : this.nationSystem.villageSettlements[idx];
        if (s) this._openSettlementDetail(s);
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  }

  // -------------------------------------------------------------------------
  // Inter-nation relations panel (collapsible inside each nation card)
  // -------------------------------------------------------------------------

  /**
   * Populate the inline relations panel for a given nation card.
   * Shows that nation's relation with every other non-extinct NPC nation
   * and with the player.
   * @param {number} nationId
   * @param {HTMLElement} panel
   */
  _renderNationRelationsPanel(nationId, panel) {
    if (!this.diplomacySystem || !this.nationSystem) { panel.textContent = '無資料'; return; }

    const { nations } = this.nationSystem;
    const rows = [];

    // Relation to player
    const playerRel   = this.diplomacySystem.getPlayerRelation(nationId);
    const playerLevel = this.diplomacySystem.getRelationLevel(playerRel);
    const playerRelStr = playerRel > 0 ? `+${playerRel}` : `${playerRel}`;
    const pk = this.getPlayerNation();
    rows.push(`
      <div class="dn-relrow">
        <span class="dn-relrow-name">${pk.name} <span class="sc-player-badge">我方</span></span>
        <span class="dn-relrow-val" style="color:${playerLevel.color}">${playerLevel.icon} ${playerRelStr}</span>
      </div>`);

    // Relations with all other NPC nations
    nations.forEach((other, oid) => {
      if (!other || oid === nationId) return;
      if (this.nationSystem.isNationExtinct(oid)) return;
      const rel   = this.diplomacySystem.getRelation(nationId, oid);
      const level = this.diplomacySystem.getRelationLevel(rel);
      const relStr = rel > 0 ? `+${rel}` : `${rel}`;
      const atWar = this.diplomacySystem.isAtWar(nationId, oid);
      const warTag = atWar ? ' <span class="dipl-war-badge" style="font-size:9px;padding:0 3px">⚔</span>' : '';
      rows.push(`
        <div class="dn-relrow">
          <span class="dn-relrow-name">${other.name}${warTag}</span>
          <span class="dn-relrow-val" style="color:${level.color}">${level.icon} ${relStr}</span>
        </div>`);
    });

    panel.innerHTML = `
      <div class="dn-relp-title">與各國關係</div>
      <div class="dn-relp-list">${rows.join('')}</div>`;
  }

  // -------------------------------------------------------------------------
  // Settlement detail overlay
  // -------------------------------------------------------------------------

  /**
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _openSettlementDetail(settlement) {
    const isPlayer  = settlement.controllingNationId === PLAYER_NATION_ID;
    const isNeutral = settlement.controllingNationId === NEUTRAL_NATION_ID;
    const nation    = isPlayer
      ? this.getPlayerNation()
      : isNeutral
        ? { name: '中立自治', color: '#9e9e9e', emblem: '🏳', flagApp: { bgColor: '#FFFFFF', stripeStyle: 'none', stripeColor: '#FFFFFF', symbol: '🏳', symbolShape: 'circle' } }
        : this.nationSystem.getNation(settlement);
    const ruler     = this._getEffectiveRuler(settlement);
    const ecoStars  = '⭐'.repeat(settlement.economyLevel) + '☆'.repeat(5 - settlement.economyLevel);
    const popStr    = settlement.population.toLocaleString();
    const typeLabel = settlement.type === 'castle' ? '城堡' : '村落';
    const flagHTML  = nation.flagApp ? renderFlagHTML(nation.flagApp, 48) : nation.emblem;

    const playerBanner = isPlayer ? `
      <div class="sd-player-banner">
        ${renderFlagHTML(nation.flagApp, 20)} ${nation.name} · 已佔領
      </div>` : '';

    // Diplomacy relation info (only for NPC castle settlements that are not neutral)
    let diplomacyHTML = '';
    if (!isPlayer && !isNeutral && settlement.type === 'castle' && this.diplomacySystem && this.nationSystem) {
      const nationId = settlement.nationId;
      const relVal   = this.diplomacySystem.getPlayerRelation(nationId);
      const relLevel = this.diplomacySystem.getRelationLevel(relVal);
      diplomacyHTML = `
        <div class="sd-row sd-diplomacy-row">
          <span class="sd-label">外交關係</span>
          <span class="sd-value" style="color:${relLevel.color}">
            ${relLevel.icon} ${relLevel.label}（${relVal > 0 ? '+' : ''}${relVal}）
          </span>
        </div>`;
    }

    // Ruler section
    let rulerHTML = '';
    if (ruler) {
      const rulerTraitsHTML = renderTraitBadgesHTML(ruler.traits, PERSONALITY_COLORS);
      rulerHTML = `
        <div class="sd-ruler-section">
          <div class="sd-ruler-title">👑 統治者</div>
          <div class="sd-ruler-card">
            <div class="sd-ruler-name">${ruler.name}
              <span class="sd-ruler-role">${ruler.role}</span>
            </div>
            <div class="sd-ruler-traits">${rulerTraitsHTML}</div>
            <div class="sd-ruler-stats">
              <div class="sd-r-stat"><span>攻擊</span><strong>${ruler.stats.attack}</strong></div>
              <div class="sd-r-stat"><span>防禦</span><strong>${ruler.stats.defense}</strong></div>
              <div class="sd-r-stat"><span>士氣</span><strong>${ruler.stats.morale}</strong></div>
            </div>
          </div>
        </div>`;
    }

    // Neutral-settlement action buttons (建議統治 / 進行貿易)
    let neutralActionsHTML = '';
    if (isNeutral) {
      const sKey = this._settlementKey(settlement);
      // New route format: find any route that involves this settlement
      const existingRoute = sKey
        ? [...this._tradeRoutes.values()].find(r => r.toKey === sKey || r.fromKey === sKey)
        : null;

      // Player strength vs settlement independence – determine suggest-rule label
      const playerStr  = this._getPlayerStrength();
      const settlementStr = settlement.economyLevel * ECONOMY_STRENGTH_MULTIPLIER
                          + Math.floor(settlement.population / POPULATION_STRENGTH_DIVISOR);
      const ratio = playerStr / (playerStr + settlementStr || 1);
      const ruleChanceLabel = ratio >= 0.7
        ? '（勝算高）'
        : ratio >= 0.4
          ? '（勝算中等）'
          : '（勝算低）';

      const tradeRouteInfo = existingRoute
        ? `<div class="sd-trade-active">🛤 貿易路線已建立 · 每日 +${existingRoute.dailyGold} 金幣（${existingRoute.fromName} → ${existingRoute.toName}）</div>`
        : '';

      const { ok: tradeOk, reason: tradeReason } = this._canEstablishTradeWith(settlement);

      neutralActionsHTML = `
        <div class="sd-neutral-section">
          <div class="sd-neutral-title">🏳 中立自治區</div>
          <div class="sd-neutral-note">此地宣告中立，由在地自治領袖管理。</div>
          ${tradeRouteInfo}
          <div class="sd-neutral-actions">
            <button class="btn-sd-suggest-rule" id="btn-sd-suggest-rule">
              ⚔ 建議統治<span class="btn-sd-chance">${ruleChanceLabel}</span>
            </button>
            <button class="btn-sd-trade${existingRoute ? ' active' : ''}${!tradeOk && !existingRoute ? ' disabled' : ''}"
                    id="btn-sd-trade"
                    ${!tradeOk && !existingRoute ? 'title="' + tradeReason + '"' : ''}>
              ${existingRoute ? '🛤 查看貿易' : '🤝 進行貿易'}
            </button>
          </div>
          ${!tradeOk && !existingRoute ? `<div class="sd-neutral-reason">${tradeReason}</div>` : ''}
        </div>`;
    }

    // Demand resource row (shown for all settlement types)
    const sKey        = this._settlementKey(settlement);
    const demandRes   = sKey ? this._getSettlementDemand(sKey, settlement) : null;
    const demandMet   = sKey && isPlayer ? this._isSettlementDemandMet(sKey, settlement) : null;
    const demandHTML  = demandRes ? `
      <div class="sd-row sd-demand-row">
        <span class="sd-label">需求資源</span>
        <span class="sd-value sd-demand-val${demandMet === false ? ' unmet' : (demandMet === true ? ' met' : '')}">
          ${demandRes}${demandMet === true ? ' ✅' : demandMet === false ? ' ⚠ 未供應' : ''}
        </span>
      </div>` : '';

    document.getElementById('ui-settlement-detail-icon').innerHTML = flagHTML;
    document.getElementById('ui-settlement-detail-name').textContent = settlement.name;
    document.getElementById('ui-settlement-detail-body').innerHTML = `
      ${playerBanner}
      <div class="sd-nation-banner" style="background: ${nation.color}22; border-color: ${nation.color}55">
        <span class="sd-nation-flag">${flagHTML}</span>
        <span class="sd-nation-name" style="color:${nation.color}">${nation.name}</span>
        <span class="sd-type-tag">${typeLabel}</span>
      </div>
      <div class="sd-stats-grid">
        <div class="sd-stat">
          <span class="sd-stat-label">人口</span>
          <span class="sd-stat-val">👥 ${popStr}</span>
        </div>
        <div class="sd-stat">
          <span class="sd-stat-label">經濟</span>
          <span class="sd-stat-val">${ecoStars}</span>
        </div>
      </div>
      <div class="sd-row">
        <span class="sd-label">盛產資源</span>
        <span class="sd-value">${settlement.resources.join('、')}</span>
      </div>
      ${demandHTML}
      ${diplomacyHTML}
      ${rulerHTML}
      ${neutralActionsHTML}
    `;

    // Wire up neutral action buttons after innerHTML is set
    if (isNeutral) {
      const suggestBtn = document.getElementById('btn-sd-suggest-rule');
      const tradeBtn   = document.getElementById('btn-sd-trade');
      if (suggestBtn) {
        suggestBtn.addEventListener('click', () => {
          this._suggestRule(settlement);
          this._closeSettlementDetail();
        });
      }
      if (tradeBtn && !tradeBtn.classList.contains('disabled')) {
        tradeBtn.addEventListener('click', () => {
          this._establishTradeToNearest(settlement);
          // Re-open to refresh trade status
          this._closeSettlementDetail();
          this._openSettlementDetail(settlement);
        });
      }
    }

    document.getElementById('ui-settlement-detail-overlay').classList.add('visible');
  }

  _closeSettlementDetail() {
    document.getElementById('ui-settlement-detail-overlay').classList.remove('visible');
  }

  // -------------------------------------------------------------------------
  // Neutral-settlement diplomacy helpers
  // -------------------------------------------------------------------------

  /**
   * Compute the player's combined strength score used for neutral-settlement
   * diplomatic checks.  Formula: sum of all active units' (attack + defense)
   * across every squad, plus a bonus of 50 per controlled settlement.
   * @returns {number}
   */
  _getPlayerStrength() {
    const squads = this.army.getSquads();
    const combatPower = squads.reduce((total, sq) => {
      return total + sq.members
        .filter(m => m.active)
        .reduce((s, m) => s + m.stats.attack + m.stats.defense, 0);
    }, 0);
    return combatPower + this._capturedSettlements.size * SETTLEMENT_STRENGTH_BONUS;
  }

  /**
   * Compute the demanded resource for a settlement.
   * The demand rotates every DEMAND_ROTATION_INTERVAL days and is always
   * a resource the settlement does not itself produce.
   * @param {string} key  Settlement key (e.g. "castle:0").
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @returns {string} Resource name.
   */
  _getSettlementDemand(key, settlement) {
    const currentDay = this.diplomacySystem?._currentDay ?? 0;
    const period     = Math.floor(currentDay / DEMAND_ROTATION_INTERVAL);
    const produces   = new Set(settlement.resources ?? []);
    const available  = RESOURCE_TYPES.filter(r => !produces.has(r));
    if (available.length === 0) return (settlement.resources ?? ['木材'])[0];
    // Deterministic seeded hash so different settlements pick different resources.
    let seed = 0;
    for (let i = 0; i < key.length; i++) seed = ((seed * 31) + key.charCodeAt(i)) >>> 0;
    seed = (seed + period * 1597) >>> 0;
    return available[seed % available.length];
  }

  /**
   * Check whether a player-owned settlement's demand resource is supplied.
   * Returns true if the settlement produces it itself, or if any trade route
   * delivering goods TO this settlement carries that resource.
   * @param {string} key
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @returns {boolean}
   */
  _isSettlementDemandMet(key, settlement) {
    const demand = this._getSettlementDemand(key, settlement);
    if ((settlement.resources ?? []).includes(demand)) return true;
    for (const [, route] of this._tradeRoutes) {
      if (route.toKey === key && Array.isArray(route.resources) && route.resources.includes(demand)) return true;
    }
    return false;
  }

  /**
   * Check whether the player can establish a trade route with a given settlement.
   * Returns { ok: boolean, reason: string }.
   * @param {import('../systems/NationSystem.js').Settlement} toSettlement
   * @returns {{ ok: boolean, reason: string }}
   */
  _canEstablishTradeWith(toSettlement) {
    const cid = toSettlement.controllingNationId;
    if (cid === PLAYER_NATION_ID) return { ok: true, reason: '' };
    if (cid === NEUTRAL_NATION_ID) {
      const playerStr = this._getPlayerStrength();
      const settlStr  = toSettlement.economyLevel * ECONOMY_STRENGTH_MULTIPLIER
                      + Math.floor(toSettlement.population / POPULATION_STRENGTH_DIVISOR);
      if (playerStr / (playerStr + settlStr || 1) >= 0.3) return { ok: true, reason: '' };
      return { ok: false, reason: '玩家實力不足，無法說服此地區開放通商' };
    }
    if (this.diplomacySystem && cid >= 0) {
      const rel = this.diplomacySystem.getPlayerRelation(cid);
      if (rel >= TRADE_MIN_FOREIGN_RELATION) return { ok: true, reason: '' };
      return { ok: false, reason: `關係值 ${rel} 過低（需 ≥ ${TRADE_MIN_FOREIGN_RELATION}）` };
    }
    return { ok: false, reason: '無法建立貿易路線' };
  }

  /**
   * Attempt to convince a neutral settlement to accept player governance.
   * Success probability depends on the player's combined strength vs. the
   * settlement's resistance (population + economy).
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _suggestRule(settlement) {
    const playerStr     = this._getPlayerStrength();
    const settlementStr = settlement.economyLevel * ECONOMY_STRENGTH_MULTIPLIER
                        + Math.floor(settlement.population / POPULATION_STRENGTH_DIVISOR);
    const successChance = playerStr / (playerStr + settlementStr || 1);
    const roll          = Math.random();

    if (roll < successChance) {
      // Success – annex the settlement peacefully
      this._captureSettlement(settlement);
      this._addInboxMessage('🏰', `${settlement.name} 接受了玩家的統治建議，和平納入版圖！`);
      if (this._activePanel === 'nations') this._renderDiplomacy();
    } else {
      // Failure – the settlement refuses
      const chancePercent = Math.round(successChance * 100);
      this._addInboxMessage('❌', `${settlement.name} 拒絕了統治建議（成功率約 ${chancePercent}%），民心尚未歸附。`);
    }
  }

  /**
   * Establish a fixed daily trade route between a neutral settlement and
   * the nearest player-controlled city.
   * If no player city exists the route is stored but yields 0 gold until
   * the player captures a settlement.
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  /**
   * Establish a trade route between two explicit settlements.
   * The player must own `fromSettlement`.
   * @param {import('../systems/NationSystem.js').Settlement} fromSettlement  Player-owned origin.
   * @param {import('../systems/NationSystem.js').Settlement} toSettlement    Target settlement.
   */
  _establishTrade(fromSettlement, toSettlement) {
    const fromKey = this._settlementKey(fromSettlement);
    const toKey   = this._settlementKey(toSettlement);
    if (!fromKey || !toKey || fromKey === toKey) return;

    const routeId = `${fromKey}→${toKey}`;
    if (this._tradeRoutes.has(routeId)) {
      const r = this._tradeRoutes.get(routeId);
      this._addInboxMessage('🛤', `貿易路線 ${r.fromName} → ${r.toName} 已建立中（每日 +${r.dailyGold} 金幣）。`);
      return;
    }

    // Check conditions
    const { ok, reason } = this._canEstablishTradeWith(toSettlement);
    if (!ok) {
      this._addInboxMessage('❌', `無法與 ${toSettlement.name} 建立貿易路線：${reason}`);
      return;
    }

    const resources = [...(fromSettlement.resources ?? [])];
    const dailyGold = Math.max(1, toSettlement.economyLevel * TRADE_INCOME_PER_ECONOMY_LEVEL);
    this._tradeRoutes.set(routeId, {
      fromKey,
      fromName:  fromSettlement.name,
      toKey,
      toName:    toSettlement.name,
      resources,
      dailyGold,
    });

    this._addInboxMessage('🤝', `與 ${toSettlement.name} 建立貿易路線！${fromSettlement.name} → ${toSettlement.name}，運送：${resources.join('、')}，每日 +${dailyGold} 金幣。`);
  }

  /**
   * Convenience wrapper used by the neutral-settlement detail "進行貿易" button.
   * Automatically picks the nearest player-controlled city as the origin.
   * @param {import('../systems/NationSystem.js').Settlement} toSettlement  Neutral or foreign target.
   */
  _establishTradeToNearest(toSettlement) {
    if (!this.nationSystem || !this._mapData) {
      this._addInboxMessage('❌', '地圖資料尚未載入，無法建立貿易路線。');
      return;
    }

    const toKey = this._settlementKey(toSettlement);
    if (!toKey) return;

    // Check if any route already ends at this settlement
    const existing = [...this._tradeRoutes.values()].find(r => r.toKey === toKey);
    if (existing) {
      this._addInboxMessage('🛤', `${toSettlement.name} 的貿易路線已建立，每日 +${existing.dailyGold} 金幣（來自 ${existing.fromName}）。`);
      return;
    }

    // Find nearest player-controlled settlement
    let nearestSett = null;
    let minDist     = Infinity;

    const toIdx  = toSettlement.type === 'castle'
      ? this.nationSystem.castleSettlements.indexOf(toSettlement)
      : this.nationSystem.villageSettlements.indexOf(toSettlement);
    const toTile = toSettlement.type === 'castle'
      ? this._mapData.castles[toIdx]
      : this._mapData.villages[toIdx];

    if (toTile) {
      const checkArr = (arr, mapArr, typeLabel) => {
        arr.forEach((ps, i) => {
          const pKey = `${typeLabel}:${i}`;
          if (!this._capturedSettlements.has(pKey)) return;
          const tile = mapArr[i];
          if (!tile) return;
          const dx = tile.x - toTile.x;
          const dy = tile.y - toTile.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDist) { minDist = dist; nearestSett = ps; }
        });
      };
      checkArr(this.nationSystem.castleSettlements,  this._mapData.castles,  'castle');
      checkArr(this.nationSystem.villageSettlements, this._mapData.villages, 'village');
    }

    if (!nearestSett) {
      this._addInboxMessage('❌', '尚未佔領任何城市，無法派出商隊。');
      return;
    }

    this._establishTrade(nearestSett, toSettlement);
  }

  // -------------------------------------------------------------------------
  // Team
  // -------------------------------------------------------------------------

  _renderTeam() {
    const content = document.getElementById('ui-panel-content');

    content.innerHTML = `
      <div class="team-main-tabs">
        <button class="team-main-tab-btn${this._teamInfoTab === 'squads' ? ' active' : ''}" data-tab="squads">⚔️ 隊伍</button>
        <button class="team-main-tab-btn${this._teamInfoTab === 'info'   ? ' active' : ''}" data-tab="info">📊 資訊</button>
      </div>
      <div id="team-tab-content"></div>
    `;

    content.querySelectorAll('.team-main-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._teamInfoTab = btn.dataset.tab;
        this._renderTeam();
      });
    });

    if (this._teamInfoTab === 'info') {
      this._renderTeamInfo();
    } else {
      this._renderTeamSquads();
    }
  }

  _renderTeamSquads() {
    const content = document.getElementById('team-tab-content');
    const squads  = this.army.getSquads();

    content.innerHTML = `
      <div class="squad-tabs">
        ${squads.map(s => `
          <button
            class="squad-tab-btn ${s.id === this._activeSquad ? 'active' : ''}"
            data-squad="${s.id}">
            小隊${s.id + 1}${s.isPlayerSquad ? '<br><small>主角</small>' : ''}
          </button>
        `).join('')}
      </div>
      <div id="squad-detail"></div>
    `;

    content.querySelectorAll('.squad-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._activeSquad  = Number(btn.dataset.squad);
        this._movingUnitId = null;
        this._renderTeam();
      });
    });

    this._renderSquadDetail(squads[this._activeSquad]);
  }

  _renderTeamInfo() {
    const content = document.getElementById('team-tab-content');
    if (!content) return;

    const squads = this.army.getSquads();

    // Per-squad stats
    const squadStats = squads.map(sq => {
      const activeMembers = sq.members.filter(m => m.active);
      const totalAttack  = activeMembers.reduce((s, m) => s + m.stats.attack,  0);
      const totalDefense = activeMembers.reduce((s, m) => s + m.stats.defense, 0);
      const totalMorale  = activeMembers.reduce((s, m) => s + m.stats.morale,  0);
      const avgMorale    = activeMembers.length > 0 ? Math.round(totalMorale / activeMembers.length) : 0;
      const woundedCount = sq.members.reduce((n, m) => n + (m.stats.hp <= 0 ? 1 : 0), 0);
      return {
        id:           sq.id,
        totalMembers: sq.members.length,
        activeCount:  activeMembers.length,
        woundedCount,
        totalAttack,
        totalDefense,
        combatPower:  totalAttack + totalDefense,
        avgMorale,
      };
    });

    const totalMembers  = squadStats.reduce((s, sq) => s + sq.totalMembers, 0);
    const totalActive   = squadStats.reduce((s, sq) => s + sq.activeCount,  0);
    const totalCombat   = squadStats.reduce((s, sq) => s + sq.combatPower,  0);
    const totalWounded  = squadStats.reduce((s, sq) => s + sq.woundedCount, 0);

    // Food stats
    const foodItems      = this.inventory.getItems().filter(i => i.type === 'food');
    const totalFood      = foodItems.reduce((s, i) => s + i.quantity, 0);
    const dailyConsume   = totalActive; // 1 food per active member per day

    let daysLeftText;
    if (dailyConsume === 0) {
      daysLeftText = '∞（無人參戰）';
    } else if (totalFood === 0) {
      daysLeftText = '已斷糧！';
    } else {
      daysLeftText = `約 ${Math.floor(totalFood / dailyConsume)} 天`;
    }
    const foodWarn = totalFood === 0 && dailyConsume > 0;

    content.innerHTML = `
      <div class="team-info-section">
        <div class="team-info-title">📋 總覽</div>
        <div class="team-info-row">
          <span class="team-info-label">總人數</span>
          <span class="team-info-value">${totalMembers} 人</span>
        </div>
        <div class="team-info-row">
          <span class="team-info-label">參戰人數</span>
          <span class="team-info-value">${totalActive} 人</span>
        </div>
        <div class="team-info-row">
          <span class="team-info-label">重傷人數</span>
          <span class="team-info-value${totalWounded > 0 ? ' warn' : ''}">${totalWounded} 人</span>
        </div>
        <div class="team-info-row">
          <span class="team-info-label">總戰力</span>
          <span class="team-info-value">${totalCombat}</span>
        </div>
      </div>

      <div class="team-info-section">
        <div class="team-info-title">⚔️ 各小隊概況</div>
        ${squadStats.map(sq => `
          <div class="team-info-squad-row">
            <span class="team-info-squad-name">小隊${sq.id + 1}</span>
            <span class="team-info-squad-stat">${sq.activeCount}/${sq.totalMembers} 人</span>
            ${sq.woundedCount > 0 ? `<span class="team-info-squad-stat warn">傷 ${sq.woundedCount}</span>` : ''}
            <span class="team-info-squad-stat">攻 ${sq.totalAttack}</span>
            <span class="team-info-squad-stat">防 ${sq.totalDefense}</span>
            <span class="team-info-squad-stat">士氣 ${sq.avgMorale}</span>
          </div>
        `).join('')}
      </div>

      <div class="team-info-section">
        <div class="team-info-title">🍱 糧食概況</div>
        <div class="team-info-row">
          <span class="team-info-label">現有糧食</span>
          <span class="team-info-value">${totalFood} 份</span>
        </div>
        <div class="team-info-row">
          <span class="team-info-label">每日消耗</span>
          <span class="team-info-value">${dailyConsume} 份（每人 1 份）</span>
        </div>
        <div class="team-info-row">
          <span class="team-info-label">預計耗盡</span>
          <span class="team-info-value${foodWarn ? ' warn' : ''}">${daysLeftText}</span>
        </div>
      </div>
    `;
  }

  /**
   * Called once per in-game day to consume food for all active members,
   * recover HP for wounded soldiers, and process NPC diplomacy events.
   */
  onDayPassed() {
    const squads = this.army.getSquads();
    const totalActive = squads.reduce((sum, sq) =>
      sum + sq.members.filter(m => m.active).length, 0);

    if (totalActive > 0) {
      let toConsume = totalActive;
      const foodItems = this.inventory.getItems().filter(i => i.type === 'food');
      for (const item of foodItems) {
        if (toConsume <= 0) break;
        const deduct = Math.min(item.quantity, toConsume);
        this.inventory.removeItem(item.id, deduct);
        toConsume -= deduct;
      }

      if (toConsume > 0) {
        this._addInboxMessage('⚠', `糧食不足！缺少 ${toConsume} 份糧食`);
      }
    }

    // Daily HP recovery for all wounded units.
    let recoveredCount = 0;
    squads.forEach(sq => {
      sq.members.forEach(m => {
        if (m.stats.hp < m.stats.maxHp) {
          const wasDown = m.stats.hp <= 0;
          const recovery = _dailyHpRecovery(m.stats.maxHp);
          m.stats.hp = Math.min(m.stats.maxHp, m.stats.hp + recovery);
          if (wasDown && m.stats.hp > 0) {
            recoveredCount++;
          }
        }
      });
    });

    if (recoveredCount > 0) {
      this._addInboxMessage('💊', `${recoveredCount} 名士兵已從重傷中恢復，可重新參戰！`);
    }

    // Diplomacy: NPC daily events (arrogant rulers condemn, gentle rulers show goodwill, etc.)
    if (this.diplomacySystem) {
      const events = this.diplomacySystem.onDayPassed();
      // Add all events to inbox with contextual icon extracted from the message.
      events.forEach(ev => {
        const firstChar = ev.message.codePointAt(0);
        // Check if the message starts with an emoji in the common emoji blocks:
        // Misc Symbols (2600-26FF), Dingbats (2700-27BF), Supplemental Symbols (1F300-1FAFF).
        const isEmoji = (firstChar >= 0x2600 && firstChar <= 0x27BF) ||
                        (firstChar >= 0x1F300 && firstChar <= 0x1FAFF);
        const icon = isEmoji ? String.fromCodePoint(firstChar) : '📜';
        const text = ev.message.replace(/^\S+ /, '');
        this._addInboxMessage(icon, text);
      });
    }

    // Demand rotation notification every DEMAND_ROTATION_INTERVAL days
    {
      const currentDay = this.diplomacySystem?._currentDay ?? 0;
      if (currentDay > 0 && currentDay % DEMAND_ROTATION_INTERVAL === 0 && this._satisfactionMap.size > 0) {
        const parts = [];
        for (const [key] of this._satisfactionMap) {
          const s = this._getSettlementByKey(key);
          if (s) parts.push(`${s.name}：需要 ${this._getSettlementDemand(key, s)}`);
        }
        if (parts.length > 0) {
          this._addInboxMessage('📊', `各地區需求資源已更新──${parts.join('、')}`);
        }
      }
    }

    // Satisfaction drift: each player-owned settlement moves ±2/day toward 0.
    // Drift is paused for settlements whose demand resource is not being supplied.
    for (const [key, sat] of this._satisfactionMap) {
      const s = this._getSettlementByKey(key);
      if (s && !this._isSettlementDemandMet(key, s)) continue; // demand unmet – skip
      if (sat < 0) {
        this._satisfactionMap.set(key, Math.min(0, sat + 2));
      } else if (sat > 0) {
        this._satisfactionMap.set(key, Math.max(0, sat - 2));
      }
    }

    // Trade-route income: collect gold from each active trade route.
    // Requires 2 assigned workers; income is zero without them.
    // Workers with 天生運動員 apply a trade bonus.
    if (this._tradeRoutes.size > 0) {
      let totalTradeGold = 0;
      const brokenRoutes = [];
      for (const [routeId, route] of this._tradeRoutes) {
        // Skip old-format routes (migration safety: old format used settlement key directly)
        if (!route.fromKey || !route.toKey) {
          brokenRoutes.push({ routeId, name: routeId });
          continue;
        }
        const fromSett = this._getSettlementByKey(route.fromKey);
        const toSett   = this._getSettlementByKey(route.toKey);
        // Break if either settlement no longer exists
        if (!fromSett || !toSett) {
          brokenRoutes.push({ routeId, name: `${route.fromName ?? route.fromKey} → ${route.toName ?? route.toKey}` });
          continue;
        }
        const fromIsPlayer = fromSett.controllingNationId === PLAYER_NATION_ID;
        const toIsPlayer   = toSett.controllingNationId   === PLAYER_NATION_ID;

        if (route.isImport) {
          // Import route: foreign → player.  Break if destination is no longer player-owned.
          if (!toIsPlayer) {
            brokenRoutes.push({ routeId, name: `${route.fromName} → ${route.toName}` });
            continue;
          }
          // Break if the source nation is now at war with the player.
          if (fromSett.controllingNationId >= 0 && this.diplomacySystem) {
            const atWar = this.diplomacySystem.isAtWar(_PLAYER_NATION_ID_UI, fromSett.controllingNationId);
            if (atWar) {
              brokenRoutes.push({ routeId, name: `${route.fromName} → ${route.toName}` });
              continue;
            }
          }
          // Import routes require no worker assignment – the foreign merchants handle it.
          const routeIncome = route.dailyGold ?? 0;
          totalTradeGold += routeIncome;
          // Accumulate import income in the destination settlement's regional treasury.
          const destKey = route.toKey;
          const tCur = this._regionalTreasury.get(destKey) ?? 0;
          this._regionalTreasury.set(destKey, tCur + routeIncome);
          continue;
        }

        // Export route: player → other.
        // Break if from-settlement is no longer player-owned
        if (!fromIsPlayer) {
          brokenRoutes.push({ routeId, name: `${route.fromName} → ${route.toName}` });
          continue;
        }
        // Break if target is foreign and player is at war with them
        if (!toIsPlayer && toSett.controllingNationId >= 0 && this.diplomacySystem) {
          const atWar = this.diplomacySystem.isAtWar(_PLAYER_NATION_ID_UI, toSett.controllingNationId);
          if (atWar) {
            brokenRoutes.push({ routeId, name: `${route.fromName} → ${route.toName}` });
            continue;
          }
        }
        // Require exactly 2 workers assigned to generate income
        const workers = this._getRouteWorkerUnits(routeId);
        if (workers.length < 2) continue; // no income without 2 workers

        // Trade bonus: each worker with 天生運動員 contributes
        const tradeBonus = workers.reduce((sum, u) => sum + getTradeBonus(u), 0);
        const routeIncome  = Math.round(route.dailyGold * (1.0 + tradeBonus));

        // Accumulate into the regional treasury of the from-settlement.
        const cur = this._regionalTreasury.get(route.fromKey) ?? 0;
        this._regionalTreasury.set(route.fromKey, cur + routeIncome);
        totalTradeGold += routeIncome;
      }
      if (totalTradeGold > 0) {
        // Income goes to regional treasuries (already accumulated above for export routes).
        // Import routes go to the player destination settlement treasury.
        // The old direct-add is replaced; treasury accumulation is done per-route above.
      }
      brokenRoutes.forEach(({ routeId, name }) => {
        this._tradeRouteWorkers.delete(routeId);
        this._tradeRoutes.delete(routeId);
        this._addInboxMessage('🛤', `貿易路線 ${name} 已中斷。`);
      });
    }

    // Tick building construction queues for every settlement.
    // Each assigned worker drives one simultaneous construction slot.
    // Workers with 天生運動員 reduce daysLeft by 2 instead of 1.
    // Without assigned workers, construction does not progress.
    for (const [key, state] of this._constructionState) {
      if (state.buildingQueue.length === 0) continue;
      const workers  = this._getBuildingWorkerUnits(key);
      const slots    = Math.min(workers.length, state.buildingQueue.length);
      if (slots === 0) continue; // no workers – construction paused
      const toComplete = [];
      for (let wi = 0; wi < slots; wi++) {
        const item       = state.buildingQueue[wi];
        const reduction  = 1 + Math.round(getConstructBonus(workers[wi]));
        item.daysLeft   -= reduction;
        if (item.daysLeft <= 0) toComplete.push(item);
      }
      for (const item of toComplete) {
        // Remove from queue
        state.buildingQueue.splice(state.buildingQueue.indexOf(item), 1);
        // Add to the actual settlement
        const settlement = this._getSettlementByKey(key);
        if (settlement) {
          const meta = BUILDING_META[item.type];
          if (meta) {
            settlement.buildings = settlement.buildings ?? [];
            settlement.buildings.push(new Building(item.type, meta.priceMult ?? 1));
          }
          this._addInboxMessage('🏗️', `${settlement.name} 的 ${item.icon} ${item.name} 建造完成！`);
        }
      }
    }

    // Sweep player-assigned rulers: if a settlement is no longer player-owned,
    // free the assigned ruler and notify the player.
    for (const [key] of [...this._assignedRulers]) {
      const sett = this._getSettlementByKey(key);
      if (sett && sett.controllingNationId !== PLAYER_NATION_ID) {
        this._assignedRulers.delete(key);
        this._addInboxMessage('👑', `${sett.name} 失守，指派的統治者已撤離！`);
      }
    }

    // Release garrison assignments for any lost settlements.
    for (const [key] of [...this._playerGarrisons]) {
      const sett = this._getSettlementByKey(key);
      if (sett && sett.controllingNationId !== PLAYER_NATION_ID) {
        const hadUnits = (this._playerGarrisons.get(key) ?? []).length > 0;
        this._playerGarrisons.delete(key);
        if (hadUnits) this._addInboxMessage('🛡', `${sett.name} 失守，駐軍已解散！`);
      }
    }

    // City planning automation – run auto-tax / auto-festival / auto-invest
    // for each player settlement that has a plan configured.
    this._processCityPlanAutomation();

    // Notify player when any regional treasury has accumulated income.
    {
      let total = 0;
      const parts = [];
      for (const [key, amount] of this._regionalTreasury) {
        if (amount > 0) {
          total += amount;
          const s = this._getSettlementByKey(key);
          if (s) parts.push(`${s.name} 🪙${amount}`);
        }
      }
      if (total > 0 && parts.length > 0) {
        this._addInboxMessage('🏦', `各地金庫有新收入待領取（${parts.join('、')}），請親自前往城市提取。`);
      }
    }

    if (this._activePanel === 'team' && this._teamInfoTab === 'info') {
      this._renderTeamInfo();
    }
  }

  /**
   * Process city planning automation for all settlements that have auto settings enabled.
   * Called at the end of each in-game day.
   */
  _processCityPlanAutomation() {
    const currentDay = this.diplomacySystem?._currentDay ?? 0;
    for (const [key, plan] of this._cityPlans) {
      const settlement = this._getSettlementByKey(key);
      if (!settlement || settlement.controllingNationId !== PLAYER_NATION_ID) continue;

      const sat = this._satisfactionMap.get(key) ?? -50;
      const minSat = plan.minSatisfaction ?? -100;

      // Gather tax info for auto-tax
      if (plan.autoTax && sat > minSat) {
        const ruler = this._getEffectiveRuler(settlement);
        const baseTax = (settlement.economyLevel ?? 1) * 20 + Math.floor(settlement.population / 100);
        const factor  = Math.min(1.0, 0.1 + 0.9 * ((sat + 100) / 100));
        const taxBonusMult = 1.0 + getTaxBonus(ruler);
        const playerUnits  = (this._playerGarrisons.get(key) ?? []).length;
        const garrisonPenalty = playerUnits * GARRISON_TAX_PENALTY_PER_UNIT;
        const taxYield = Math.max(1, Math.round(baseTax * factor * taxBonusMult) - garrisonPenalty);
        // Deposit tax into regional treasury (player picks up at city hall)
        const cur = this._regionalTreasury.get(key) ?? 0;
        this._regionalTreasury.set(key, cur + taxYield);
        // Collect tax reduces satisfaction
        const newSat = Math.max(-100, sat - 10);
        this._satisfactionMap.set(key, newSat);
        this._addInboxMessage('🏦', `【自動徵稅】${settlement.name} 本日自動收稅 🪙${taxYield}，存入地區金庫（民心 ${newSat >= 0 ? '+' : ''}${newSat}）。`);
      }

      // Auto-festival: fire if satisfaction is below minSat threshold AND festival is ready
      if (plan.autoFestival) {
        const cooldownExpiry = this._festivalCooldowns.get(key) ?? 0;
        const festivalReady  = currentDay >= cooldownExpiry;
        // Only auto-festival when satisfaction is low (below minSat or below -20 if not set)
        const festivalThreshold = Math.max(minSat, -20);
        const currentSat = this._satisfactionMap.get(key) ?? -50;
        if (festivalReady && currentSat < festivalThreshold) {
          const gold = this._getGold();
          if (gold >= FESTIVAL_COST) {
            this._spendGold(FESTIVAL_COST);
            const prevSat = currentSat;
            const newSat  = Math.min(100, prevSat + FESTIVAL_SATISFACTION_BOOST);
            this._satisfactionMap.set(key, newSat);
            this._festivalCooldowns.set(key, currentDay + FESTIVAL_COOLDOWN_DAYS);
            this._addInboxMessage('🎉', `【自動節慶】${settlement.name} 自動舉辦節慶！民心 ${prevSat >= 0 ? '+' : ''}${prevSat} → ${newSat >= 0 ? '+' : ''}${newSat}（消耗 🪙${FESTIVAL_COST}）。`);
          } else {
            this._addInboxMessage('⚠', `【自動節慶】${settlement.name} 想舉辦節慶，但金幣不足（需 🪙${FESTIVAL_COST}）。`);
          }
        }
      }

      // Auto-invest: fire when satisfaction is acceptable and economy not maxed.
      // Uses `lastAutoInvestEcoLevel` to gate one investment per economy level, so the
      // flag stays enabled but the same level isn't invested repeatedly each day.
      if (plan.autoInvest && sat > minSat) {
        const ecoLevel = settlement.economyLevel ?? 1;
        const maxEco   = ecoLevel >= 5;
        const cost     = INVEST_BASE_COST * ecoLevel;
        const alreadyInvestedThisLevel = plan.lastAutoInvestEcoLevel === ecoLevel;
        if (!maxEco && !alreadyInvestedThisLevel && this._getGold() >= cost) {
          this._spendGold(cost);
          settlement.economyLevel = Math.min(5, ecoLevel + 1);
          plan.lastAutoInvestEcoLevel = ecoLevel; // remember the level we just upgraded from
          this._addInboxMessage('💰', `【自動投資】${settlement.name} 自動投資發展！經濟等級升至 ${'⭐'.repeat(settlement.economyLevel)}（消耗 🪙${cost}）。`);
        }
      }
    }
  }

  /**
   * Return the city planning settings for a settlement, creating defaults if absent.
   * @param {string} key
   * @returns {{ autoTax: boolean, autoFestival: boolean, autoInvest: boolean, minSatisfaction: number }}
   */
  _getCityPlan(key) {
    if (!this._cityPlans.has(key)) {
      this._cityPlans.set(key, { autoTax: false, autoFestival: false, autoInvest: false, minSatisfaction: -30 });
    }
    return this._cityPlans.get(key);
  }

  /**
   * Called when the day/night phase changes (清晨, 白天, 黃昏, 夜晚).
   * Dispatches phase-specific NPC AI actions and optionally notifies the player.
   * @param {'清晨'|'白天'|'黃昏'|'夜晚'} phase
   */
  onPhaseChanged(phase) {
    if (!this.diplomacySystem) return;
    const messages = this.diplomacySystem.onPhaseChanged(phase, this._tavernState);
    if (messages.length > 0) {
      // Find if any recruitment happened at a settlement the player is currently in.
      const nearbyKey = this._nearbySettlement
        ? this._settlementKey(this._nearbySettlement)
        : null;
      messages.forEach(m => {
        const isNearbyRecruit = nearbyKey && m.settlementKey === nearbyKey;
        const icon = isNearbyRecruit ? '🍺' : m.message.startsWith('⚔') ? '⚔' : '📋';
        const text = isNearbyRecruit
          ? `競爭招募！${m.message.replace(/^🍺 /, '')}`
          : m.message.replace(/^[⚔📋🍺] /, '');
        this._addInboxMessage(icon, text);
      });
    }

    // Advance road construction only during working phases (白天 / 黃昏).
    const workHours = CONSTR_PHASE_HOURS[phase] ?? 0;
    if (workHours > 0) {
      // Collect all unique road keys that are in-progress to avoid double-advancing
      // (roads are mirrored on both endpoints).
      const advanced = new Set();
      for (const [, state] of this._constructionState) {
        for (const [rk, road] of [...state.roads]) {
          if (advanced.has(rk)) continue;
          advanced.add(rk);
          road.hoursLeft = Math.max(0, road.hoursLeft - workHours);
          const [fromKey, toKey] = rk.split('↔');
          const fromState = this._constructionState.get(fromKey);
          const toState   = this._constructionState.get(toKey);
          if (road.hoursLeft <= 0) {
            // Road construction / demolition complete.
            const isDemo = road.isDemo;

            if (!isDemo) {
              // Mark as built on both endpoints, storing the tile path.
              const roadTiles = road.path ?? [];
              if (fromState) { fromState.roads.delete(rk); fromState.builtRoads.set(rk, { tiles: roadTiles }); }
              if (toState)   { toState.roads.delete(rk);   toState.builtRoads.set(rk, { tiles: roadTiles }); }
              const fromSett = this._getSettlementByKey(fromKey);
              const toSett   = this._getSettlementByKey(toKey);
              this._addInboxMessage('🛤️', `道路 ${fromSett?.name ?? fromKey} ↔ ${toSett?.name ?? toKey} 已建造完成！`);
              // Apply relation bonus for connecting roads agreed with a foreign nation
              if (road.connectRoadNationId !== null && road.connectRoadNationId !== undefined && this.diplomacySystem) {
                const nid   = road.connectRoadNationId;
                const bonus = road.connectRoadRelBonus ?? CONNECT_ROAD_RELATION_GAIN;
                this.diplomacySystem.modifyPlayerRelation(nid, bonus);
                this.diplomacySystem._addMemoryEntry(nid,
                  `共建連結道路完成，關係 +${bonus}`, bonus);
                const nationName = this.nationSystem?.nations?.[nid]?.name ?? `國家${nid}`;
                this._addInboxMessage('🛣️', `連結道路建成！與 ${nationName} 的關係 +${bonus}。`);
              }
              if (this.onRoadBuilt) this.onRoadBuilt();
            } else {
              // Demolition complete – just remove
              if (fromState) fromState.roads.delete(rk);
              if (toState)   toState.roads.delete(rk);
              const fromSett = this._getSettlementByKey(fromKey);
              const toSett   = this._getSettlementByKey(toKey);
              this._addInboxMessage('🪚', `道路 ${fromSett?.name ?? fromKey} ↔ ${toSett?.name ?? toKey} 已拆除完成。`);
              if (this.onRoadBuilt) this.onRoadBuilt();
            }
          } else {
            // Mirror updated hoursLeft to both endpoint road entries
            if (fromState?.roads.has(rk)) fromState.roads.get(rk).hoursLeft = road.hoursLeft;
            if (toState?.roads.has(rk))   toState.roads.get(rk).hoursLeft   = road.hoursLeft;
          }
        }
      }

      // Tick map building workers (lumber camps and mines)
      this._tickMapBuildingWorkers();
    }
  }

  _renderSquadDetail(squad) {
    const detail = document.getElementById('squad-detail');
    const captain = squad.captain;

    // Separate members into "present" and "on mission" in a single pass.
    const assignedIds = this._getAllAssignedUnitIds();

    const presentMembers = [];
    const missionMembers = [];
    for (const m of squad.members) {
      (assignedIds.has(m.id) ? missionMembers : presentMembers).push(m);
    }

    const memberCards = [];
    for (let i = 0; i < MAX_MEMBERS; i++) {
      const m = presentMembers[i];
      if (m) {
        const isCaptain = m.id === squad.captainId;
        const avatarHTML = m.appearance ? renderCharHTML(m.appearance, 32) : '';
        const hpPct    = m.stats.maxHp > 0 ? Math.max(0, Math.round(m.stats.hp / m.stats.maxHp * 100)) : 0;
        const isDown   = m.stats.hp <= 0;
        const hpColor  = isDown ? '#e53935' : hpPct <= 30 ? '#ff8f00' : '#43a047';
        const statusLabel = isDown ? '重傷' : (m.active ? '參戰' : '待命');
        const statusClass = isDown ? ' wounded' : (m.active ? ' active' : '');
        memberCards.push(`
          <div class="unit-card-compact${isCaptain ? ' captain' : ''}${m.active && !isDown ? '' : ' inactive'}"
               data-id="${m.id}" role="button" tabindex="0">
            <span class="ucc-avatar">${avatarHTML}</span>
            <span class="ucc-badge">${isCaptain ? '⭐' : ''}</span>
            <div class="ucc-info">
              <div class="ucc-top">
                <span class="ucc-name">${m.name}</span>
                <span class="ucc-role">${m.role}</span>
                <span class="ucc-status${statusClass}">${statusLabel}</span>
                <span class="ucc-arrow">›</span>
              </div>
              <div class="ucc-hp-bar-wrap">
                <div class="ucc-hp-bar" style="width:${hpPct}%;background:${hpColor}"></div>
              </div>
            </div>
          </div>`);
      } else {
        memberCards.push(`
          <div class="unit-card-compact empty">
            <span class="ucc-badge">👤</span>
            <span class="ucc-name ucc-empty">空缺 ${i + 1}</span>
          </div>`);
      }
    }

    // Build "on mission" section for dispatched members.
    // Pre-compute a map of unitId → missionLabel to avoid repeated iteration inside .map().
    const missionLabelMap = new Map();
    for (const id of this._messengerUnitIds) missionLabelMap.set(id, '📨 信使中');
    for (const [, unitId] of this._assignedRulers) {
      if (!missionLabelMap.has(unitId)) missionLabelMap.set(unitId, '🏯 地區統治');
    }
    for (const arr of this._tradeRouteWorkers.values()) {
      for (const id of arr) { if (!missionLabelMap.has(id)) missionLabelMap.set(id, '🛤 貿易路線'); }
    }
    for (const arr of this._buildingWorkers.values()) {
      for (const id of arr) { if (!missionLabelMap.has(id)) missionLabelMap.set(id, '🏗 建設工程'); }
    }
    for (const arr of this._playerGarrisons.values()) {
      for (const id of arr) { if (!missionLabelMap.has(id)) missionLabelMap.set(id, '🛡 地區駐軍'); }
    }

    const missionCards = missionMembers.map(m => {
      const isCaptain  = m.id === squad.captainId;
      const avatarHTML = m.appearance ? renderCharHTML(m.appearance, 32) : '';
      const missionLabel = missionLabelMap.get(m.id) ?? '執行任務中';
      return `
        <div class="unit-card-compact on-mission${isCaptain ? ' captain' : ''}"
             data-id="${m.id}" role="button" tabindex="0">
          <span class="ucc-avatar">${avatarHTML}</span>
          <span class="ucc-badge">${isCaptain ? '⭐' : ''}</span>
          <div class="ucc-info">
            <div class="ucc-top">
              <span class="ucc-name">${m.name}</span>
              <span class="ucc-role">${m.role}</span>
              <span class="ucc-status ucc-status-mission">${missionLabel}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    const missionSection = missionMembers.length > 0
      ? `<div class="squad-mission-section">
           <div class="squad-mission-title">📤 派遣中（${missionMembers.length} 人）</div>
           ${missionCards}
         </div>`
      : '';

    detail.innerHTML = `
      <div class="squad-stat">
        成員 ${presentMembers.length} / ${MAX_MEMBERS}
        ${missionMembers.length > 0 ? `（${missionMembers.length} 人派遣中）` : ''}
        ${captain && !assignedIds.has(captain.id) ? `&nbsp;｜&nbsp;隊長：${captain.name}` : captain ? `&nbsp;｜&nbsp;隊長：${captain.name}（派遣中）` : '&nbsp;⚠ 無隊長'}
      </div>
      <div class="member-list">
        ${memberCards.join('')}
      </div>
      ${missionSection}
    `;

    detail.querySelectorAll('.unit-card-compact[data-id]').forEach(card => {
      const open = () => {
        const uid  = Number(card.dataset.id);
        const unit = squad.members.find(m => m.id === uid);
        if (unit) this._openUnitDetail(unit, squad);
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  // -------------------------------------------------------------------------
  // Unit detail overlay
  // -------------------------------------------------------------------------

  _openUnitDetail(unit, squad) {
    const squads    = this.army.getSquads();
    const isCaptain = unit.id === squad.captainId;
    const isHero    = unit.role === 'hero';

    const traitsHTML = unit.traits.length > 0
      ? `<div class="unit-traits">${
          unit.traits.map(t =>
            `<span class="trait-tag${t === TRAIT_CAPTAIN ? ' trait-captain' : ''}">${t}</span>`
          ).join('')
        }</div>`
      : '<div class="unit-traits"><span class="unit-no-traits">無特質</span></div>';

    const captainBtn = (!isCaptain && unit.canLead())
      ? `<button class="btn-set-captain" data-id="${unit.id}">⭐ 設為隊長</button>`
      : '';

    const moveTargetsHTML = squads
      .filter(s => s.id !== squad.id)
      .map(s => `<button class="btn-move-to" data-id="${unit.id}" data-target="${s.id}"
                  ${!s.hasCapacity() ? 'disabled' : ''}>
                  → 小隊${s.id + 1}${s.hasCapacity() ? '' : '（滿）'}
                </button>`)
      .join('');

    document.getElementById('ui-unit-detail-name').textContent =
      `${isCaptain ? '⭐ ' : ''}${unit.name}`;

    const hpPct   = unit.stats.maxHp > 0 ? Math.max(0, Math.round(unit.stats.hp / unit.stats.maxHp * 100)) : 0;
    const isDown  = unit.stats.hp <= 0;
    const hpColor = isDown ? '#e53935' : hpPct <= 30 ? '#ff8f00' : '#43a047';
    const daysToRecover = isDown || unit.stats.hp < unit.stats.maxHp
      ? Math.ceil((unit.stats.maxHp - unit.stats.hp) / _dailyHpRecovery(unit.stats.maxHp))
      : 0;
    const hpStatusText = isDown
      ? `重傷（約 ${daysToRecover} 天恢復）`
      : unit.stats.hp < unit.stats.maxHp
        ? `受傷（約 ${daysToRecover} 天全癒）`
        : '健康';
    const hpHTML = `
      <div class="ud-hp-section">
        <div class="ud-hp-label-row">
          <span class="ud-hp-label">生命值</span>
          <span class="ud-hp-nums">${Math.ceil(unit.stats.hp)} / ${Math.ceil(unit.stats.maxHp)}</span>
          <span class="ud-hp-status" style="color:${hpColor}">${hpStatusText}</span>
        </div>
        <div class="ud-hp-bar-wrap">
          <div class="ud-hp-bar" style="width:${hpPct}%;background:${hpColor}"></div>
        </div>
      </div>`;

    document.getElementById('ui-unit-detail-body').innerHTML = `
      ${hpHTML}
      <div class="ud-row">
        <span class="ud-label">職業</span>
        <span class="ud-value">${unit.role}</span>
      </div>
      <div class="ud-row">
        <span class="ud-label">狀態</span>
        ${isDown
          ? `<span class="ud-value ud-wounded">🤕 重傷中，靜養恢復</span>`
          : `<button class="btn-toggle-active${unit.active ? ' is-active' : ''}" data-id="${unit.id}">
              ${unit.active ? '✅ 參戰中' : '💤 待命中'}
            </button>`
        }
      </div>
      <div class="ud-row">
        <span class="ud-label">特質</span>
        <span class="ud-value">${traitsHTML}</span>
      </div>
      <div class="ud-stats-row">
        <div class="ud-stat"><span class="ud-stat-label">攻擊</span><span class="ud-stat-val">${unit.stats.attack}</span></div>
        <div class="ud-stat"><span class="ud-stat-label">防禦</span><span class="ud-stat-val">${unit.stats.defense}</span></div>
        <div class="ud-stat"><span class="ud-stat-label">士氣</span><span class="ud-stat-val">${unit.stats.morale}</span></div>
        <div class="ud-stat"><span class="ud-stat-label">速度</span><span class="ud-stat-val">${unit.stats.moveSpeed ?? 5}</span></div>
      </div>
      ${this._buildEquipSlotsHTML(unit)}
      ${captainBtn ? `<div class="ud-actions">${captainBtn}</div>` : ''}
      ${!isHero ? `
      <div class="ud-actions">
        <div class="ud-move-section">
          <span class="ud-label">移至小隊</span>
          <div class="move-targets">${moveTargetsHTML}</div>
        </div>
        <div class="ud-remove-row">
          <span class="ud-remove-warning">⚠ 移除後將無法復原，請謹慎操作</span>
          <button class="btn-remove-member" data-id="${unit.id}">❌ 移除成員</button>
        </div>
      </div>` : ''}
    `;

    const overlay = document.getElementById('ui-unit-detail-overlay');
    overlay.classList.add('visible');

    // Attach equipment slot event handlers
    this._attachEquipSlotHandlers(overlay, unit, squad);

    // Toggle active status
    overlay.querySelectorAll('.btn-toggle-active').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = Number(btn.dataset.id);
        this.army.setUnitActive(squad.id, uid, !unit.active);
        // Re-open with updated unit data from squad
        this._closeUnitDetail();
        this._renderSquadDetail(squad);
        const updated = squad.members.find(m => m.id === uid);
        if (updated) this._openUnitDetail(updated, squad);
      });
    });

    // Set captain
    overlay.querySelectorAll('.btn-set-captain').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = Number(btn.dataset.id);
        if (this.army.setSquadCaptain(squad.id, uid)) {
          this._toast(`${unit.name} 已設為隊長`);
          this._closeUnitDetail();
          this._renderSquadDetail(squad);
        }
      });
    });

    // Execute move
    overlay.querySelectorAll('.btn-move-to').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid      = Number(btn.dataset.id);
        const targetId = Number(btn.dataset.target);
        if (this.army.moveUnit(uid, squad.id, targetId)) {
          this._toast(`${unit.name} 已移至小隊 ${targetId + 1}`);
          this._closeUnitDetail();
          this._renderTeam();
        } else {
          this._toast('移動失敗（目標小隊已滿）');
        }
      });
    });

    // Remove member
    overlay.querySelectorAll('.btn-remove-member').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!window.confirm(`確定要移除 ${unit.name}？\n此操作無法復原。`)) return;
        const uid = Number(btn.dataset.id);
        squad.removeMember(uid);
        this._toast(`${unit.name} 已從小隊移除`);
        this._closeUnitDetail();
        this._renderTeam();
      });
    });
  }

  _closeUnitDetail() {
    document.getElementById('ui-unit-detail-overlay').classList.remove('visible');
  }

  // -------------------------------------------------------------------------
  // Equipment slots helpers
  // -------------------------------------------------------------------------

  /** Maps an item type string to the equipment slot key it belongs to. */
  static _getEquipSlot(type) {
    if (type === 'weapon') return 'weapon';
    if (['helmet', 'chest', 'legs', 'boots'].includes(type)) return 'armor';
    if (type === 'accessory') return 'accessory';
    return null;
  }

  /** Returns a small string summarising equipment stats (e.g. "攻擊 +3"). */
  static _equipStatsText(item) {
    if (!item?.stats) return '';
    const STAT_LABEL = { attack: '攻擊', defense: '防禦', speed: '速度', morale: '士氣' };
    return Object.entries(item.stats)
      .map(([k, v]) => `${STAT_LABEL[k] ?? k}${v >= 0 ? ' +' : ' '}${v}`)
      .join(' ');
  }

  /**
   * Build the HTML for the equipment-slots section shown inside the unit
   * detail overlay.
   * @param {import('../systems/Army.js').Unit} unit
   * @returns {string}
   */
  _buildEquipSlotsHTML(unit) {
    const SLOT_META = [
      { key: 'weapon',    label: '武器', icon: '⚔️' },
      { key: 'armor',     label: '裝備', icon: '🛡️' },
      { key: 'accessory', label: '飾品', icon: '💍' },
    ];
    const slotsHTML = SLOT_META.map(({ key, label }) => {
      const item = unit.equipment?.[key] ?? null;
      const stats = GameUI._equipStatsText(item);
      if (item) {
        return `
          <div class="ud-equip-slot ud-equip-slot-filled" data-slot="${key}">
            <span class="ud-equip-slot-label">${label}</span>
            <span class="ud-equip-slot-icon">${item.icon ?? '📦'}</span>
            <span class="ud-equip-slot-name">${item.name}</span>
            ${stats ? `<span class="ud-equip-slot-stats">${stats}</span>` : ''}
            <button class="btn-unequip" data-slot="${key}">卸下</button>
          </div>`;
      }
      return `
        <div class="ud-equip-slot ud-equip-slot-empty" data-slot="${key}">
          <span class="ud-equip-slot-label">${label}</span>
          <span class="ud-equip-slot-empty-text">空</span>
          <button class="btn-equip-slot" data-slot="${key}">裝備</button>
        </div>`;
    }).join('');
    return `
      <div class="ud-equip-section">
        <div class="ud-section-title">裝備欄</div>
        <div class="ud-equip-slots">${slotsHTML}</div>
        <div class="ud-equip-picker" style="display:none"></div>
      </div>`;
  }

  /**
   * Attach event handlers for equip/unequip buttons inside the unit detail overlay.
   * @param {HTMLElement} overlay
   * @param {import('../systems/Army.js').Unit} unit
   * @param {import('../systems/Army.js').Squad} squad
   */
  _attachEquipSlotHandlers(overlay, unit, squad) {
    const picker = overlay.querySelector('.ud-equip-picker');

    // Unequip button – returns item to backpack
    overlay.querySelectorAll('.btn-unequip').forEach(btn => {
      btn.addEventListener('click', () => {
        const slotKey = btn.dataset.slot;
        this._unequipItemFromUnit(unit, slotKey);
        this._closeUnitDetail();
        this._openUnitDetail(unit, squad);
      });
    });

    // Equip button – opens inline picker for compatible backpack items
    overlay.querySelectorAll('.btn-equip-slot').forEach(btn => {
      btn.addEventListener('click', () => {
        const slotKey = btn.dataset.slot;
        this._showEquipPicker(picker, unit, squad, slotKey);
      });
    });
  }

  /**
   * Show the inline item picker inside the equipment section.
   * @param {HTMLElement} pickerEl
   * @param {import('../systems/Army.js').Unit} unit
   * @param {import('../systems/Army.js').Squad} squad
   * @param {'weapon'|'armor'|'accessory'} slotKey
   */
  _showEquipPicker(pickerEl, unit, squad, slotKey) {
    const SLOT_TYPES = {
      weapon:    ['weapon'],
      armor:     ['helmet', 'chest', 'legs', 'boots'],
      accessory: ['accessory'],
    };
    const SLOT_LABEL = { weapon: '武器', armor: '裝備', accessory: '飾品' };
    const compatibleTypes = SLOT_TYPES[slotKey] ?? [];
    const allItems = this.inventory.getItems();
    const compatible = allItems.filter(i => compatibleTypes.includes(i.type));

    const itemsHTML = compatible.length === 0
      ? `<div class="ud-equip-picker-empty">背包中沒有可裝備的${SLOT_LABEL[slotKey]}</div>`
      : compatible.map(it => {
          const stats = GameUI._equipStatsText(it);
          return `
            <div class="ud-equip-picker-item" data-item-id="${it.id}" role="button" tabindex="0">
              <span class="ud-equip-picker-item-icon">${it.icon}</span>
              <span class="ud-equip-picker-item-name">${it.name}</span>
              ${stats ? `<span class="ud-equip-picker-item-stats">${stats}</span>` : ''}
            </div>`;
        }).join('');

    pickerEl.innerHTML = `
      <div class="ud-equip-picker-header">
        <span>選擇${SLOT_LABEL[slotKey]}</span>
        <button class="btn-equip-picker-cancel">✕</button>
      </div>
      ${itemsHTML}`;
    pickerEl.style.display = 'block';

    pickerEl.querySelector('.btn-equip-picker-cancel').addEventListener('click', () => {
      pickerEl.style.display = 'none';
    });

    pickerEl.querySelectorAll('.ud-equip-picker-item').forEach(row => {
      const confirm = () => {
        const item = allItems.find(i => i.id === Number(row.dataset.itemId));
        if (!item) return;
        this._equipItemToUnit(unit, slotKey, item);
        this._closeUnitDetail();
        this._openUnitDetail(unit, squad);
      };
      row.addEventListener('click', confirm);
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); confirm(); } });
    });
  }

  /**
   * Equip an item from the backpack to the given slot on a unit.
   * If the slot already has an item it is returned to the backpack first.
   * @param {import('../systems/Army.js').Unit} unit
   * @param {'weapon'|'armor'|'accessory'} slotKey
   * @param {object} item  Inventory item object
   */
  _equipItemToUnit(unit, slotKey, item) {
    // Return previously equipped item to backpack (preserve original stackable behaviour)
    const existing = unit.equipment?.[slotKey] ?? null;
    if (existing) {
      this.inventory.addItem({ ...existing });
    }
    // Remove 1 unit of the new item from backpack
    this.inventory.removeItem(item.id, 1);
    // Store a snapshot (quantity always 1 – a single item occupies the slot)
    const { quantity: _q, ...itemWithoutQty } = item;
    unit.equipment[slotKey] = { ...itemWithoutQty, quantity: 1 };
    this._toast(`${unit.name} 裝備了 ${item.icon} ${item.name}`);
  }

  /**
   * Unequip an item from the given slot and return it to the backpack.
   * @param {import('../systems/Army.js').Unit} unit
   * @param {'weapon'|'armor'|'accessory'} slotKey
   */
  _unequipItemFromUnit(unit, slotKey) {
    const item = unit.equipment?.[slotKey] ?? null;
    if (!item) return;
    unit.equipment[slotKey] = null;
    // Return item to backpack, preserving original stackable behaviour
    this.inventory.addItem({ ...item });
    this._toast(`${unit.name} 卸下了 ${item.icon} ${item.name}`);
  }



  /**
   * Call this when the player earns a new unit (e.g., after battle).
   * Shows a dialog asking the player what to do with the unit.
   *
   * @param {{name:string, role:string, traits?:string[], stats?:Object}} unitData
   */
  tryAcquireUnit(unitData) {
    const squads   = this.army.getSquads();
    const canPlace = squads.some(s => s.hasCapacity());

    const dlg      = document.getElementById('ui-acquire-overlay');
    const placeBtn = document.getElementById('btn-acq-place');

    document.getElementById('ui-acquire-title').textContent =
      `獲得了新角色：${unitData.name}`;

    const traits = unitData.traits?.length ? `　特質：${unitData.traits.join('、')}` : '';
    document.getElementById('ui-acquire-desc').textContent = canPlace
      ? `職業：${unitData.role}　攻 ${unitData.stats?.attack ?? '?'}　防 ${unitData.stats?.defense ?? '?'}${traits}`
      : '目前所有小隊都已滿員，請選擇處理方式：';

    placeBtn.disabled = !canPlace;
    dlg.classList.add('visible');

    const close = () => dlg.classList.remove('visible');

    placeBtn.onclick = () => {
      const result = this.army.acquireUnit(unitData);
      if (result.placed) {
        this._toast(`${unitData.name} 已安置於小隊 ${result.squad.id + 1}`);
        if (this._activePanel === 'team') this._renderTeam();
      }
      close();
    };

    document.getElementById('btn-acq-sell').onclick = () => {
      this.inventory.addItem({ name: '金幣', type: 'loot', icon: '🪙', quantity: 20 });
      this._toast(`已賣掉 ${unitData.name}，獲得 20 金幣`);
      if (this._activePanel === 'backpack') this._renderBackpack();
      close();
    };

    document.getElementById('btn-acq-exile').onclick = () => {
      this._toast(`${unitData.name} 已被流放`);
      close();
    };
  }

  // -------------------------------------------------------------------------
  // Enter-facility button / Location screen
  // -------------------------------------------------------------------------

  /**
   * Called every frame from Game._update() with the settlement the player
   * is currently standing on (or null if outside any settlement).
   * Shows / hides the "enter facility" floating button accordingly.
   *
   * @param {import('../systems/NationSystem.js').Settlement|null} settlement
   */
  setNearbySettlement(settlement) {
    const wrap = document.getElementById('facility-action-wrap');
    if (!wrap) return;

    const prev = this._nearbySettlement;
    this._nearbySettlement = settlement ?? null;

    // The wrap is visible when either a settlement is nearby OR the map-build button is shown.
    const settlementVisible = this._nearbySettlement !== null;
    const buildVisible      = this._nearbyBuildableTile !== null;
    wrap.classList.toggle('visible', settlementVisible || buildVisible);

    const enterBtn = document.getElementById('enter-facility-btn');
    if (enterBtn) enterBtn.style.display = settlementVisible ? '' : 'none';

    if (settlementVisible) {
      const name = this._nearbySettlement.name ?? '設施';
      if (enterBtn) enterBtn.textContent = `🚪 進入 ${name}`;

      // Show attack button only for castle/village settlements that the player does NOT own
      const attackBtn = document.getElementById('attack-facility-btn');
      if (attackBtn) {
        const s = this._nearbySettlement;
        const isAttackable = (s.type === 'castle' || s.type === 'village')
          && s.controllingNationId !== PLAYER_NATION_ID;
        attackBtn.classList.toggle('visible', isAttackable);
      }
    } else {
      const attackBtn = document.getElementById('attack-facility-btn');
      if (attackBtn) attackBtn.classList.remove('visible');
    }

    // Hide the enter button if the player walked away while the screen is open
    if (prev && !this._nearbySettlement) {
      this._closeLocationScreen();
    }
  }

  /**
   * Open the location screen for a settlement (or port placeholder).
   * @param {import('../systems/NationSystem.js').Settlement|{type:'port',name:string}} settlement
   */
  _openLocationScreen(settlement) {
    const overlay = document.getElementById('location-overlay');
    if (!overlay) return;

    // Castle shows gate first; villages and ports go straight to facilities.
    if (settlement.type === 'castle') {
      this._locationStage = 'gate';
    } else {
      this._locationStage = 'inside';
    }

    this._locationSettlement = settlement;
    this._renderLocationScreen();
    overlay.classList.add('visible');
  }

  _closeLocationScreen() {
    document.getElementById('location-overlay')?.classList.remove('visible');
    this._locationSettlement = null;
  }

  _renderLocationScreen() {
    const s = this._locationSettlement;
    if (!s) return;

    // Header
    const icons = { castle: '🏰', village: '🏘️' };
    document.getElementById('location-icon').textContent = icons[s.type] ?? '🏠';
    document.getElementById('location-title').textContent = s.name;

    let subtitle = '';
    if (s.type === 'castle' && this.nationSystem) {
      const nation = s.controllingNationId === PLAYER_NATION_ID
        ? this.getPlayerNation()
        : this.nationSystem.getNation(s);
      subtitle = `${nation.flagApp ? renderFlagHTML(nation.flagApp, 18) : nation.emblem} ${nation.name}`;
    } else if (s.type === 'village') {
      subtitle = '村落';
    }
    document.getElementById('location-subtitle').innerHTML = subtitle;

    if (this._locationStage === 'gate') {
      this._renderLocationGate(s);
    } else {
      this._renderLocationFacilities(s);
    }
  }

  /** Castle gate scene – player first encounters the guards. */
  _renderLocationGate(settlement) {
    let nation = null;
    if (this.nationSystem) {
      if (settlement.controllingNationId === PLAYER_NATION_ID) {
        nation = this.getPlayerNation();
      } else if (settlement.controllingNationId === NEUTRAL_NATION_ID) {
        nation = { name: '中立', emblem: '🏳' };
      } else {
        nation = this.nationSystem.getNation(settlement);
      }
    }
    const nationName = nation ? nation.name : settlement.name;

    const isPlayerOwned = settlement.controllingNationId === PLAYER_NATION_ID;
    const isNeutral     = settlement.controllingNationId === NEUTRAL_NATION_ID;
    const gateArt = isPlayerOwned ? '🛡️🏴🛡️' : isNeutral ? '🏳🕊️🏳' : '🛡️⚔️🛡️';
    const gateMsg = isPlayerOwned
      ? `兩名身著你方盔甲的士兵立正行禮。<br>
           「<em>主公歸來，城門大開！</em>」<br>
           「<em>請入內視察 ${nationName}。</em>」`
      : isNeutral
        ? `一名手持白旗的使者在城門前迎候。<br>
           「<em>歡迎旅人，此地已宣告中立。</em>」<br>
           「<em>城門對所有人開放，請自由入城。</em>」`
        : `兩名身著銀甲的守衛持槍攔下了你。<br>
           「<em>停！這裡是 ${nationName} 的城門。</em>」<br>
           「<em>說明來意，方可入城。</em>」`;

    const content = document.getElementById('location-content');
    content.innerHTML = `
      <div class="loc-gate-scene">
        <div class="loc-gate-art">${gateArt}</div>
        <div class="loc-gate-msg">
          ${gateMsg}
        </div>
        <div class="loc-gate-actions">
          <button class="btn-loc-enter" id="btn-city-enter">進城 →</button>
          ${!isPlayerOwned && !isNeutral ? `<button class="btn-loc-banquet" id="btn-gate-banquet">🍷 宴請</button>` : ''}
          ${!isPlayerOwned && !isNeutral ? `<button class="btn-loc-demand"  id="btn-gate-demand">⚖ 要求</button>` : ''}
          <button class="btn-loc-leave" id="btn-city-leave">離開</button>
        </div>
      </div>
    `;

    document.getElementById('btn-city-enter').addEventListener('click', () => {
      this._locationStage = 'inside';
      this._renderLocationScreen();
    });
    document.getElementById('btn-city-leave').addEventListener('click', () => {
      this._closeLocationScreen();
    });

    if (!isPlayerOwned && !isNeutral) {
      const backToGate = () => this._renderLocationGate(settlement);
      document.getElementById('btn-gate-banquet')?.addEventListener('click', () => {
        this._renderBanquetProposal(settlement, backToGate);
      });
      document.getElementById('btn-gate-demand')?.addEventListener('click', () => {
        this._renderDemandProposal(settlement, backToGate);
      });
    }
  }

  /** Facility list for the current settlement. */
  _renderLocationFacilities(settlement) {
    this._facilityView = null;
    const content = document.getElementById('location-content');

    if (!settlement.buildings || settlement.buildings.length === 0) {
      content.innerHTML = '<p class="ui-empty">暫無設施</p>';
      return;
    }

    const backRow = settlement.type === 'castle' ? `
      <div class="loc-back-row">
        <button class="btn-loc-back" id="btn-loc-back">← 返回城門</button>
      </div>` : '';

    const sectionTitle = settlement.type === 'castle' ? '城內設施' : '村內設施';

    const facilityCards = settlement.buildings.map((bldg, i) => `
      <div class="facility-card" data-bldg-idx="${i}" role="button" tabindex="0">
        <div class="fc-icon">${bldg.icon}</div>
        <div class="fc-name">${bldg.name}</div>
        <div class="fc-desc">${bldg.desc.replace(/\n/g, '<br>')}</div>
      </div>
    `).join('');

    content.innerHTML = `
      ${backRow}
      <div class="loc-facilities-title">${sectionTitle}</div>
      <div class="loc-facilities-grid">${facilityCards}</div>
    `;

    if (settlement.type === 'castle') {
      document.getElementById('btn-loc-back')?.addEventListener('click', () => {
        this._locationStage = 'gate';
        this._renderLocationScreen();
      });
    }

    content.querySelectorAll('.facility-card[data-bldg-idx]').forEach(card => {
      const open = () => {
        const idx  = Number(card.dataset.bldgIdx);
        const bldg = settlement.buildings[idx];
        if (bldg) this._openFacility(bldg, settlement);
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  }

  // -------------------------------------------------------------------------
  // Gold helpers
  // -------------------------------------------------------------------------

  /** Return the player's current gold total. */
  _getGold() {
    return this.inventory.getItems()
      .filter(i => i.name === '金幣' && i.type === 'loot')
      .reduce((sum, i) => sum + i.quantity, 0);
  }

  /**
   * Add `amount` gold to the player's inventory.
   * @param {number} amount
   */
  _addGold(amount) {
    if (amount <= 0) return;
    this.inventory.addItem({ name: '金幣', type: 'loot', icon: '🪙', quantity: amount });
  }

  /**
   * Deduct `amount` gold from the player's inventory.
   * Returns true on success, false if not enough gold.
   * @param {number} amount
   * @returns {boolean}
   */
  _spendGold(amount) {
    if (amount <= 0) return true;
    let remaining = amount;
    const goldItems = this.inventory.getItems()
      .filter(i => i.name === '金幣' && i.type === 'loot');
    for (const gi of goldItems) {
      if (remaining <= 0) break;
      const deduct = Math.min(gi.quantity, remaining);
      this.inventory.removeItem(gi.id, deduct);
      remaining -= deduct;
    }
    return remaining <= 0;
  }

  // -------------------------------------------------------------------------
  // Facility dispatcher
  // -------------------------------------------------------------------------

  /**
   * Open a specific building's interface inside the location screen.
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _openFacility(building, settlement) {
    this._facilityView = { building, settlement };
    const content = document.getElementById('location-content');
    if (!content) return;

    switch (building.type) {
      case BLDG_GENERAL: {
        const sKey      = this._settlementKey(settlement);
        const demandRes = sKey ? this._getSettlementDemand(sKey, settlement) : '';
        this._renderShop(building, settlement, this._buildGeneralCatalog(settlement), demandRes);
        break;
      }
      case BLDG_BLACKSMITH:
        this._renderShop(building, settlement, CATALOG_BLACKSMITH);
        break;
      case BLDG_MAGE:
        this._renderShop(building, settlement, CATALOG_MAGE);
        break;
      case BLDG_TAVERN:
        this._renderTavern(building, settlement);
        break;
      case BLDG_INN:
        this._renderInn(building, settlement);
        break;
      case BLDG_PALACE:
      case BLDG_CHIEF_HOUSE:
        this._renderGovBuilding(building, settlement);
        break;
      default:
        this._toast(`${building.icon} ${building.name}：功能開發中…`);
        this._facilityView = null;
        this._renderLocationFacilities(settlement);
    }
  }

  /** Build the 雜貨舖 catalog, prepending local resource items. */
  _buildGeneralCatalog(settlement) {
    const resourceIcon = {
      '木材': '🪵', '農產': '🌾', '礦石': '⛏️', '絲綢': '🧵',
      '煤炭': '🪨', '草藥': '🌿', '魚獲': '🐟', '皮毛': '🦊',
      '食鹽': '🧂', '陶器': '🏺',
    };
    const localItems = (settlement.resources ?? []).map((res, i) => ({
      id:          `local_res_${i}`,
      name:        res,
      icon:        resourceIcon[res] ?? '📦',
      type:        'loot',
      basePrice:   RESOURCE_BASE_PRICE,
      quantity:    5,
      description: `本地特產：${res}（折扣）`,
    }));
    return [...localItems, ...CATALOG_GENERAL];
  }

  /** Shared back-button HTML for facility screens. */
  _facilityBackHTML(settlement) {
    return `
      <div class="fac-back-row">
        <button class="btn-fac-back" id="btn-fac-back">← 返回設施列表</button>
      </div>`;
  }

  /** Gold display bar HTML. */
  _goldBarHTML() {
    return `<div class="fac-gold-bar">🪙 持有金幣：<span id="fac-gold-display">${this._getGold()}</span></div>`;
  }

  /** Attach the back button after rendering a facility screen. */
  _attachFacilityBack(settlement) {
    document.getElementById('btn-fac-back')?.addEventListener('click', () => {
      this._facilityView = null;
      this._renderLocationFacilities(settlement);
    });
  }

  /** Refresh the gold display inside the currently open facility screen. */
  _refreshGoldDisplay() {
    const el = document.getElementById('fac-gold-display');
    if (el) el.textContent = this._getGold();
  }

  // -------------------------------------------------------------------------
  // Shop screen (雜貨舖 / 鐵匠舖 / 法師亭)
  // -------------------------------------------------------------------------

  /**
   * Render a generic shop interface.
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @param {import('../systems/BuildingSystem.js').CatalogItem[]} catalog
   * @param {string} [demandResource]  Resource currently demanded by this settlement.
   *   When provided a "sell to shop" panel is shown for loot-type inventory items.
   */
  _renderShop(building, settlement, catalog, demandResource = '') {
    const content = document.getElementById('location-content');
    if (!content) return;

    const STAT_LABEL = { attack: '攻擊', defense: '防禦', speed: '速度', morale: '士氣' };

    const itemsHTML = catalog.map(item => {
      const price   = BuildingSystem.computePrice(item, building, settlement.resources ?? []);
      const statsHTML = item.stats
        ? Object.entries(item.stats).map(([k, v]) =>
            `<span class="sir-stat">${STAT_LABEL[k] ?? k} ${v >= 0 ? '+' : ''}${v}</span>`
          ).join(' ')
        : '';
      return `
        <div class="shop-item-row" data-item-id="${item.id}" data-price="${price}">
          <span class="sir-icon">${item.icon}</span>
          <div class="sir-info">
            <div class="sir-name">${item.name} ${statsHTML}</div>
            ${item.description ? `<div class="sir-desc">${item.description}</div>` : ''}
            <div class="sir-desc">數量：×${item.quantity}</div>
          </div>
          <span class="sir-price">🪙${price}</span>
          <button class="btn-buy" data-item-id="${item.id}" data-price="${price}">購買</button>
        </div>`;
    }).join('');

    // Build sell panel (only for General Store, i.e. when demandResource is provided)
    const localResources = settlement.resources ?? [];

    let sellHTML = '';
    if (demandResource !== '') {
      const sellableItems = this.inventory.getItems().filter(i => i.type === 'loot' && RESOURCE_TYPES.includes(i.name));
      if (sellableItems.length === 0) {
        sellHTML = `<div class="shop-sell-empty">（背包中無可販賣的物資）</div>`;
      } else {
        sellHTML = sellableItems.map(invItem => {
          const sellPrice = BuildingSystem.computeSellPrice(invItem.name, RESOURCE_BASE_PRICE, localResources, demandResource);
          const isDemand  = invItem.name === demandResource;
          const isLocal   = localResources.includes(invItem.name);
          const tag       = isDemand ? '🔥 需求' : isLocal ? '📦 本地' : '';
          return `
            <div class="shop-item-row" data-inv-id="${invItem.id}" data-sell-price="${sellPrice}">
              <span class="sir-icon">${invItem.icon}</span>
              <div class="sir-info">
                <div class="sir-name">${invItem.name}${tag ? ` <span class="sir-stat">${tag}</span>` : ''}</div>
                <div class="sir-desc">持有：×${invItem.quantity}</div>
              </div>
              <span class="sir-price">🪙${sellPrice}</span>
              <button class="btn-sell" data-inv-id="${invItem.id}" data-sell-price="${sellPrice}">出售</button>
            </div>`;
        }).join('');
      }
    }

    const demandNote = demandResource
      ? `<div class="shop-demand-note">📋 本地需求：<strong>${demandResource}</strong>（高價收購）</div>`
      : '';

    content.innerHTML = `
      ${this._facilityBackHTML(settlement)}
      <div class="fac-title">${building.icon} ${building.name}</div>
      ${this._goldBarHTML()}
      <div class="shop-section-title">購買</div>
      <div class="shop-item-list">${itemsHTML}</div>
      ${demandResource !== '' ? `
      <div class="shop-section-title">出售物資</div>
      ${demandNote}
      <div class="shop-item-list shop-sell-list">${sellHTML}</div>` : ''}
    `;

    this._attachFacilityBack(settlement);

    content.querySelectorAll('.btn-buy').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.itemId;
        const price  = Number(btn.dataset.price);
        const item   = catalog.find(i => i.id === itemId);
        if (!item) return;

        if (this._getGold() < price) {
          this._toast('💸 金幣不足！');
          return;
        }
        this._spendGold(price);
        this.inventory.addItem({
          name:        item.name,
          type:        item.type,
          icon:        item.icon,
          quantity:    item.quantity,
          description: item.description ?? '',
          stats:       item.stats,
        });
        this._toast(`✅ 購買了 ${item.icon} ${item.name}（-${price} 🪙）`);
        this._refreshGoldDisplay();
      });
    });

    // Sell buttons (General Store only)
    content.querySelectorAll('.btn-sell').forEach(btn => {
      btn.addEventListener('click', () => {
        const invId    = Number(btn.dataset.invId);
        const sellPrice = Number(btn.dataset.sellPrice);
        const invItem  = this.inventory.getItems().find(i => i.id === invId);
        if (!invItem) return;

        this.inventory.removeItem(invId, 1);
        this.inventory.addItem({ name: '金幣', type: 'loot', icon: '🪙', quantity: sellPrice });
        this._toast(`💰 出售了 ${invItem.icon} ${invItem.name}（+${sellPrice} 🪙）`);
        this._refreshGoldDisplay();
        // Re-render to update quantities
        this._renderShop(building, settlement, catalog, demandResource);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Inn screen (旅店)
  // -------------------------------------------------------------------------

  /**
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderInn(building, settlement) {
    const content = document.getElementById('location-content');
    if (!content) return;

    // Base nightly cost scales with economy level.
    const baseCost   = 5 + (settlement.economyLevel ?? 1) * 2;
    const cost1Night = Math.round(baseCost * building.priceMult);
    const cost3Night = Math.round(baseCost * building.priceMult * 2.5);

    const allMembers = this.army.getSquads().flatMap(s => s.members);
    const woundedCount = allMembers.filter(m => m.stats.hp < m.stats.maxHp).length;

    content.innerHTML = `
      ${this._facilityBackHTML(settlement)}
      <div class="fac-title">${building.icon} ${building.name}</div>
      ${this._goldBarHTML()}
      <div class="inn-scene-art">🛏️</div>
      <div class="inn-scene-msg">掌櫃笑著迎上來：<br><em>「歡迎光臨！請問要住幾晚？」</em></div>
      ${woundedCount > 0 ? `<div class="inn-wounded-note">⚠️ 目前有 ${woundedCount} 名成員受傷，休息可加速恢復。</div>` : ''}
      <div class="inn-options">
        <div class="inn-option-card" id="inn-opt-1">
          <span class="ioc-icon">🌙</span>
          <div class="ioc-info">
            <div class="ioc-title">休息一晚</div>
            <div class="ioc-desc">恢復所有成員 20% HP・消耗一天糧食</div>
          </div>
          <span class="sir-price">🪙${cost1Night}</span>
          <button class="btn-buy" id="btn-inn-1" data-cost="${cost1Night}" data-days="1">入住</button>
        </div>
        <div class="inn-option-card" id="inn-opt-3">
          <span class="ioc-icon">🌟</span>
          <div class="ioc-info">
            <div class="ioc-title">休息三晚</div>
            <div class="ioc-desc">完全恢復所有成員 HP・消耗三天糧食</div>
          </div>
          <span class="sir-price">🪙${cost3Night}</span>
          <button class="btn-buy" id="btn-inn-3" data-cost="${cost3Night}" data-days="3">入住</button>
        </div>
      </div>
    `;

    this._attachFacilityBack(settlement);

    content.querySelectorAll('.btn-buy[data-days]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cost = Number(btn.dataset.cost);
        const days = Number(btn.dataset.days);

        if (this._getGold() < cost) {
          this._toast('💸 金幣不足！');
          return;
        }
        this._spendGold(cost);

        // Restore HP
        let restored = 0;
        this.army.getSquads().forEach(sq => {
          sq.members.forEach(m => {
            if (m.stats.hp < m.stats.maxHp) {
              if (days >= 3) {
                m.stats.hp = m.stats.maxHp;
              } else {
                m.stats.hp = Math.min(m.stats.maxHp, m.stats.hp + Math.ceil(m.stats.maxHp * 0.2));
              }
              // Reactivate downed units after full rest
              if (days >= 3 && !m.active) m.active = true;
              restored++;
            }
          });
        });

        // Advance days (food consumption + HP recovery ticks)
        if (typeof this.onAdvanceDays === 'function') {
          this.onAdvanceDays(days);
        }

        const msg = days >= 3
          ? `😴 休息了三晚，所有成員完全恢復！(-${cost} 🪙)`
          : `😴 休息了一晚，成員恢復 20% HP。(-${cost} 🪙)`;
        this._toast(msg);
        this._refreshGoldDisplay();
        // Re-render to update wounded count
        this._renderInn(building, settlement);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Tavern screen (酒館)
  // -------------------------------------------------------------------------

  /**
   * Derive stable pseudo-random hash inputs for a settlement.
   * Since we don't have tile coordinates here, we use the settlement's
   * index within its array (scaled to avoid hash collisions between castles
   * and villages).
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @returns {{ sx: number, sy: number }}
   */
  _settlementHashCoords(settlement) {
    if (!this.nationSystem) return { sx: 0, sy: 0 };
    const castleIdx  = this.nationSystem.castleSettlements.indexOf(settlement);
    if (castleIdx >= 0) {
      // Castles: spread across a large integer range to minimise collisions.
      return { sx: castleIdx * 137, sy: castleIdx * 251 };
    }
    const villageIdx = this.nationSystem.villageSettlements.indexOf(settlement);
    if (villageIdx >= 0) {
      // Villages: offset from castles by +5000 to avoid hash overlap.
      return { sx: villageIdx * 173 + 5000, sy: villageIdx * 293 + 5000 };
    }
    return { sx: 0, sy: 0 };
  }

  /**
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderTavern(building, settlement) {
    const content = document.getElementById('location-content');
    if (!content) return;

    const day = this.diplomacySystem?._currentDay ?? 0;
    const { sx, sy } = this._settlementHashCoords(settlement);
    const settlementKey = `${sx}_${sy}`;

    // Retrieve or initialise tavern state; refresh roster if ≥5 days have passed.
    let tState = this._tavernState.get(settlementKey);
    if (!tState || day - tState.lastVisitDay >= 5) {
      tState = { lastVisitDay: day, recruitedIndices: [] };
      this._tavernState.set(settlementKey, tState);
    }

    // Always generate the same roster that was present on the last-visit day.
    const recruits = BuildingSystem.generateRecruits(sx, sy, 0, tState.lastVisitDay);

    // Food catalog with prices
    const foodItems = CATALOG_TAVERN_FOOD.map(item => ({
      ...item,
      price: BuildingSystem.computePrice(item, building, settlement.resources ?? []),
    }));

    const STAT_LABEL = { attack: '攻擊', defense: '防禦', morale: '士氣' };

    const foodHTML = foodItems.map(item => `
      <div class="shop-item-row">
        <span class="sir-icon">${item.icon}</span>
        <div class="sir-info">
          <div class="sir-name">${item.name}</div>
          ${item.description ? `<div class="sir-desc">${item.description}</div>` : ''}
          <div class="sir-desc">×${item.quantity}</div>
        </div>
        <span class="sir-price">🪙${item.price}</span>
        <button class="btn-buy tavern-food-buy" data-id="${item.id}" data-price="${item.price}">購買</button>
      </div>`).join('');

    const recruitHTML = recruits.map((r, i) => {
      const statLine = Object.entries(r.stats)
        .map(([k, v]) => `${STAT_LABEL[k] ?? k}:${v}`).join(' ');
      const traitLine = r.traits.length ? r.traits.join('・') : '';
      const hired = tState.recruitedIndices.includes(i);
      return `
        <div class="recruit-card${hired ? ' recruited' : ''}">
          <div class="rc-info">
            <div class="rc-name">${r.name} <span class="rc-role">${r.role}</span></div>
            <div class="rc-stats">${statLine}</div>
            ${traitLine ? `<div class="rc-traits">${traitLine}</div>` : ''}
          </div>
          <span class="sir-price">🪙${r.hireCost}</span>
          <button class="btn-buy tavern-recruit-btn" data-recruit-idx="${i}" data-cost="${r.hireCost}"${hired ? ' disabled aria-disabled="true"' : ''}>
            ${hired ? '已招募' : '招募'}
          </button>
        </div>`;
    }).join('');

    content.innerHTML = `
      ${this._facilityBackHTML(settlement)}
      <div class="fac-title">${building.icon} ${building.name}</div>
      ${this._goldBarHTML()}
      <div class="tavern-section-title">🍽 食物與飲品</div>
      <div class="shop-item-list">${foodHTML}</div>
      <div class="tavern-section-title">⚔ 可招募的冒險者</div>
      <div class="recruit-list">${recruitHTML}</div>
    `;

    this._attachFacilityBack(settlement);

    // Food buy buttons
    content.querySelectorAll('.tavern-food-buy').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.id;
        const price  = Number(btn.dataset.price);
        const item   = CATALOG_TAVERN_FOOD.find(i => i.id === itemId);
        if (!item) return;
        if (this._getGold() < price) { this._toast('💸 金幣不足！'); return; }
        this._spendGold(price);
        this.inventory.addItem({
          name: item.name, type: item.type, icon: item.icon,
          quantity: item.quantity, description: item.description ?? '',
        });
        this._toast(`✅ 購買了 ${item.icon} ${item.name}（-${price} 🪙）`);
        this._refreshGoldDisplay();
      });
    });

    // Recruit buttons
    content.querySelectorAll('.tavern-recruit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx  = Number(btn.dataset.recruitIdx);
        const cost = Number(btn.dataset.cost);
        const r    = recruits[idx];
        if (!r) return;
        if (this._getGold() < cost) { this._toast('💸 金幣不足！'); return; }
        this._spendGold(cost);
        this._toast(`✅ 招募了 ${r.name}（-${cost} 🪙）`);
        this._refreshGoldDisplay();
        this.tryAcquireUnit({ name: r.name, role: r.role, traits: r.traits, stats: r.stats });
        // Mark recruit as hired and re-render the tavern screen.
        if (!tState.recruitedIndices.includes(idx)) {
          tState.recruitedIndices.push(idx);
        }
        this._renderTavern(building, settlement);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Government building screen (王宮 / 村長家) – multi-department hub
  // -------------------------------------------------------------------------

  /**
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @param {string} [tab]  Override the active department tab.
   */
  _renderGovBuilding(building, settlement, tab) {
    const content = document.getElementById('location-content');
    if (!content) return;

    const isOwnedByPlayer = this.isPlayerSettlement(settlement);

    // For non-player settlements just render the simple foreign view (no tabs)
    if (!isOwnedByPlayer) {
      this._renderGovBuildingForeign(building, settlement);
      return;
    }

    if (tab) this._cityHallTab = tab;

    const tabs = [
      { id: 'gov',          icon: '📋', label: '政務廳' },
      { id: 'construction', icon: '🏗️', label: '建設部' },
      { id: 'planning',     icon: '⚙️', label: '城市規劃' },
    ];

    const tabsHTML = tabs.map(t => `
      <button class="ch-tab-btn${this._cityHallTab === t.id ? ' active' : ''}" data-chtab="${t.id}">
        ${t.icon} ${t.label}
      </button>`).join('');

    content.innerHTML = `
      ${this._facilityBackHTML(settlement)}
      <div class="fac-title">${building.icon} ${building.name}</div>
      <div class="ch-tabs">${tabsHTML}</div>
      <div id="ch-tab-content"></div>
    `;

    this._attachFacilityBack(settlement);

    content.querySelectorAll('.ch-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._cityHallTab = btn.dataset.chtab;
        this._renderGovBuilding(building, settlement);
      });
    });

    switch (this._cityHallTab) {
      case 'gov':          this._renderGovTabContent(building, settlement); break;
      case 'construction': this._renderConstructionPanel(building, settlement, true); break;
      case 'planning':     this._renderCityPlanningTab(building, settlement); break;
    }
  }

  /**
   * Render the simple gov screen for a foreign (non-player-owned) settlement.
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderGovBuildingForeign(building, settlement) {
    const content = document.getElementById('location-content');
    if (!content) return;
    const ruler = this._getEffectiveRuler(settlement);
    const traits = ruler?.traits?.filter(t => t !== '統治者') ?? [];
    const traitBadgesHTML = renderTraitBadgesHTML(ruler?.traits ?? [], PERSONALITY_COLORS);
    content.innerHTML = `
      ${this._facilityBackHTML(settlement)}
      <div class="fac-title">${building.icon} ${building.name}</div>
      <div class="gov-ruler-section">
        <div class="gov-ruler-icon">👑</div>
        <div class="gov-ruler-info">
          <div class="gov-ruler-name">${ruler?.name ?? '不詳'}</div>
          <div class="gov-ruler-role">${ruler?.role ?? ''}</div>
          ${traits.length ? `<div class="gov-ruler-traits">${traitBadgesHTML}</div>` : ''}
        </div>
      </div>
      <div class="gov-stats-row">
        <div class="gov-stat"><span class="gov-stat-label">人口</span><span class="gov-stat-val">${settlement.population.toLocaleString()}</span></div>
        <div class="gov-stat"><span class="gov-stat-label">經濟</span><span class="gov-stat-val">${'⭐'.repeat(settlement.economyLevel ?? 1)}</span></div>
        <div class="gov-stat"><span class="gov-stat-label">資源</span><span class="gov-stat-val">${(settlement.resources ?? []).join('、') || '無'}</span></div>
      </div>
      <div id="gov-foreign-diplo"></div>
      <div class="gov-ruler-speech"><em>「${_GOV_GREETING[building.type] ?? '歡迎來訪。'}」</em></div>
    `;
    this._attachFacilityBack(settlement);
    this._renderForeignDiplomacy(building, settlement);
  }

  /**
   * Render the 政務廳 department content into #ch-tab-content.
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderGovTabContent(building, settlement) {
    const panel = document.getElementById('ch-tab-content');
    if (!panel) return;

    const key          = this._settlementKey(settlement);
    const ruler        = this._getEffectiveRuler(settlement);
    const traits       = ruler?.traits?.filter(t => t !== '統治者') ?? [];
    const isAssigned   = key && !!this._getAssignedRulerUnit(key);
    const satisfaction = this._satisfactionMap.get(key) ?? -50;

    // Satisfaction label / colour
    let satLabel = '', satColor = '#9e9e9e';
    if (satisfaction >= 0)        { satLabel = '穩定';   satColor = '#66bb6a'; }
    else if (satisfaction >= -30) { satLabel = '不滿';   satColor = '#ffa726'; }
    else if (satisfaction >= -60) { satLabel = '憤慨';   satColor = '#ef6c00'; }
    else                          { satLabel = '激憤';   satColor = '#e53935'; }

    const baseTax        = (settlement.economyLevel ?? 1) * 20 + Math.floor(settlement.population / 100);
    const factor         = Math.min(1.0, 0.1 + 0.9 * ((satisfaction + 100) / 100));
    const taxBonusMult   = 1.0 + getTaxBonus(ruler);
    const playerUnits    = (this._playerGarrisons.get(key) ?? []).length;
    const garrisonPenalty = playerUnits * GARRISON_TAX_PENALTY_PER_UNIT;
    const taxYield        = Math.max(1, Math.round(baseTax * factor * taxBonusMult) - garrisonPenalty);

    const traitBadgesHTML = renderTraitBadgesHTML(ruler?.traits ?? [], PERSONALITY_COLORS);

    // Garrison info for the panel
    const garrisonIds   = this._playerGarrisons.get(key) ?? [];
    const garrisonMax   = settlement.type === 'castle' ? PLAYER_CASTLE_GARRISON_MAX : PLAYER_VILLAGE_GARRISON_MAX;
    const garrisonUnits = garrisonIds
      .map(id => this.army.getSquads().flatMap(sq => sq.members).find(m => m.id === id))
      .filter(Boolean);
    const garrisonListHTML = garrisonUnits.length > 0
      ? garrisonUnits.map(u => `
          <div class="gov-garrison-row">
            <span class="gov-garrison-name">${u.name}</span>
            <span class="gov-garrison-role">${u.role}</span>
            <button class="btn-buy gov-garrison-remove" data-unit-id="${u.id}" style="font-size:11px;padding:2px 8px">撤回</button>
          </div>`).join('')
      : '<div class="gov-garrison-empty">（尚無駐軍）</div>';

    // Regional treasury
    const treasury = this._regionalTreasury.get(key) ?? 0;
    const treasuryHTML = `
      <div class="gov-treasury-section">
        <div class="gov-tax-title">🏦 地區金庫</div>
        <div class="gov-stat-row-small">
          <span class="gov-stat-label">庫存金幣</span>
          <span class="gov-stat-val" style="color:${treasury > 0 ? '#ffd54f' : '#9e9e9e'}">🪙${treasury}</span>
        </div>
        <button class="btn-buy gov-tax-btn${treasury <= 0 ? ' disabled' : ''}" id="btn-collect-treasury"
          ${treasury <= 0 ? 'disabled' : ''}>
          💰 提取金庫存款（🪙${treasury}）
        </button>
      </div>`;

    const rulerBonusHTML = taxBonusMult > 1.0
      ? `<div class="gov-stat-row-small">
           <span class="gov-stat-label">領導者加成（一絲不苟）</span>
           <span class="gov-stat-val" style="color:#66bb6a">×${taxBonusMult.toFixed(2)}</span>
         </div>`
      : '';
    const penaltyHTML = garrisonPenalty > 0
      ? `<div class="gov-stat-row-small">
           <span class="gov-stat-label">駐軍維持（${playerUnits} 人）</span>
           <span class="gov-stat-val" style="color:#ef6c00">-🪙${garrisonPenalty}</span>
         </div>`
      : '';

    const demandRes  = this._getSettlementDemand(key, settlement);
    const demandMet  = this._isSettlementDemandMet(key, settlement);
    const demandColor = demandMet ? '#66bb6a' : '#ef6c00';
    const demandNote  = demandMet ? '✅ 已供應' : '⚠ 未供應 – 滿意度無法自動恢復';

    const currentDay     = this.diplomacySystem?._currentDay ?? 0;
    const cooldownExpiry = this._festivalCooldowns.get(key) ?? 0;
    const festivalReady  = currentDay >= cooldownExpiry;
    const daysLeft       = cooldownExpiry - currentDay;
    const investCost     = INVEST_BASE_COST * (settlement.economyLevel ?? 1);
    const maxEco         = (settlement.economyLevel ?? 1) >= 5;

    panel.innerHTML = `
      <div class="gov-ruler-section">
        <div class="gov-ruler-icon">👑</div>
        <div class="gov-ruler-info">
          <div class="gov-ruler-name">${ruler?.name ?? '不詳'}${isAssigned ? ' <span class="gov-ruler-assigned-badge">（指派）</span>' : ''}</div>
          <div class="gov-ruler-role">${ruler?.role ?? ''}</div>
          ${traits.length ? `<div class="gov-ruler-traits">${traitBadgesHTML}</div>` : ''}
        </div>
        <button class="btn-buy gov-replace-ruler-btn" id="btn-replace-ruler">👥 替換統治者</button>
      </div>
      <div class="gov-stats-row">
        <div class="gov-stat"><span class="gov-stat-label">人口</span><span class="gov-stat-val">${settlement.population.toLocaleString()}</span></div>
        <div class="gov-stat"><span class="gov-stat-label">經濟</span><span class="gov-stat-val">${'⭐'.repeat(settlement.economyLevel ?? 1)}</span></div>
        <div class="gov-stat"><span class="gov-stat-label">資源</span><span class="gov-stat-val">${(settlement.resources ?? []).join('、') || '無'}</span></div>
      </div>
      ${treasuryHTML}
      <div class="gov-tax-section">
        <div class="gov-tax-title">📋 地區管理</div>
        <div class="gov-stat-row-small">
          <span class="gov-stat-label">民心滿意度</span>
          <span class="gov-sat-val" style="color:${satColor}">${satLabel}（${satisfaction >= 0 ? '+' : ''}${satisfaction}）</span>
        </div>
        ${rulerBonusHTML}
        ${penaltyHTML}
        <div class="gov-stat-row-small">
          <span class="gov-stat-label">預期稅收</span>
          <span class="gov-stat-val">🪙${taxYield}</span>
        </div>
        <div class="gov-stat-row-small">
          <span class="gov-stat-label">需求資源</span>
          <span class="gov-stat-val" style="color:${demandColor}">${demandRes}（${demandNote}）</span>
        </div>
        <button class="btn-buy gov-tax-btn" id="btn-collect-tax">🏦 手動徵收稅款（存入金庫）</button>
      </div>
      <div class="gov-garrison-section">
        <div class="gov-garrison-title">🛡 駐軍管理</div>
        <div class="gov-stat-row-small">
          <span class="gov-stat-label">駐軍人數</span>
          <span class="gov-stat-val">${garrisonIds.length} / ${garrisonMax} 人</span>
        </div>
        <div class="gov-garrison-list" id="gov-garrison-list">${garrisonListHTML}</div>
        <button class="btn-buy gov-garrison-btn" id="btn-manage-garrison">⚔ 調整駐軍</button>
      </div>
      <div class="gov-civic-section">
        <div class="gov-civic-title">🏙 市政活動</div>
        <button class="btn-buy gov-festival-btn${festivalReady ? '' : ' disabled'}"
                id="btn-festival"
                ${festivalReady ? '' : 'disabled title="冷卻中"'}>
          🎉 舉辦節慶<span class="gov-civic-cost">-🪙${FESTIVAL_COST}</span>
          ${!festivalReady ? `<span class="gov-civic-cd">（${daysLeft} 天後可用）</span>` : ''}
        </button>
        <button class="btn-buy gov-invest-btn${maxEco ? ' disabled' : ''}"
                id="btn-invest"
                ${maxEco ? 'disabled title="已達最高等級"' : ''}>
          💰 投資發展<span class="gov-civic-cost">-🪙${maxEco ? '—' : investCost}</span>
          ${maxEco ? '<span class="gov-civic-cd">（已達最高）</span>' : ''}
        </button>
        <button class="btn-buy gov-trade-route-btn" id="btn-manage-trade">
          🛤 管理貿易路線
        </button>
      </div>
      <button class="btn-buy gov-letter-btn" id="btn-send-letter">📨 派送信件</button>
      <div class="gov-ruler-speech"><em>「${_GOV_GREETING[building.type] ?? '歡迎來訪。'}」</em></div>
    `;

    // Wire up buttons
    document.getElementById('btn-replace-ruler')?.addEventListener('click', () => {
      this._openReplaceRulerModal(building, settlement);
    });

    document.getElementById('btn-collect-treasury')?.addEventListener('click', () => {
      const amount = this._regionalTreasury.get(key) ?? 0;
      if (amount <= 0) { this._toast('金庫目前為空。'); return; }
      this._addGold(amount);
      this._regionalTreasury.set(key, 0);
      this._addInboxMessage('💰', `已從 ${settlement.name} 金庫提取 🪙${amount}。`);
      this._refreshGoldDisplay();
      this._renderGovTabContent(building, settlement);
    });

    document.getElementById('btn-collect-tax')?.addEventListener('click', () => {
      const newSat = Math.max(-100, (this._satisfactionMap.get(key) ?? -50) - 10);
      this._satisfactionMap.set(key, newSat);
      // Store tax in regional treasury instead of directly in inventory
      const cur = this._regionalTreasury.get(key) ?? 0;
      this._regionalTreasury.set(key, cur + taxYield);
      this._addInboxMessage('🏦', `已在 ${settlement.name} 徵收稅款 🪙${taxYield}，存入地區金庫。民心 ${newSat >= 0 ? '+' : ''}${newSat}`);
      this._renderGovTabContent(building, settlement);
    });

    document.getElementById('btn-festival')?.addEventListener('click', () => {
      const gold = this._getGold();
      if (gold < FESTIVAL_COST) { this._toast('💸 金幣不足！'); return; }
      this._spendGold(FESTIVAL_COST);
      const prevSat = this._satisfactionMap.get(key) ?? -50;
      const newSat  = Math.min(100, prevSat + FESTIVAL_SATISFACTION_BOOST);
      this._satisfactionMap.set(key, newSat);
      this._festivalCooldowns.set(key, currentDay + FESTIVAL_COOLDOWN_DAYS);
      this._addInboxMessage('🎉', `${settlement.name} 舉辦了節慶！民心 ${prevSat >= 0 ? '+' : ''}${prevSat} → ${newSat >= 0 ? '+' : ''}${newSat}（消耗 ${FESTIVAL_COST} 🪙）`);
      this._refreshGoldDisplay();
      this._renderGovTabContent(building, settlement);
    });

    document.getElementById('btn-invest')?.addEventListener('click', () => {
      const cost = INVEST_BASE_COST * (settlement.economyLevel ?? 1);
      const gold = this._getGold();
      if (gold < cost) { this._toast('💸 金幣不足！'); return; }
      if ((settlement.economyLevel ?? 1) >= 5) { this._toast('⭐ 已達最高經濟等級！'); return; }
      this._spendGold(cost);
      settlement.economyLevel = Math.min(5, (settlement.economyLevel ?? 1) + 1);
      this._addInboxMessage('💰', `${settlement.name} 投資發展完成！經濟等級提升至 ${'⭐'.repeat(settlement.economyLevel)}（消耗 ${cost} 🪙）`);
      this._refreshGoldDisplay();
      this._renderGovTabContent(building, settlement);
    });

    document.getElementById('btn-manage-trade')?.addEventListener('click', () => {
      this._renderTradeRoutePanel(building, settlement);
    });

    document.getElementById('btn-send-letter')?.addEventListener('click', () => {
      this._renderSendLetter(settlement);
    });

    // Garrison: remove individual unit
    document.querySelectorAll('.gov-garrison-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const unitId = Number(btn.dataset.unitId);
        const ids = (this._playerGarrisons.get(key) ?? []).filter(id => id !== unitId);
        this._playerGarrisons.set(key, ids);
        this._renderGovTabContent(building, settlement);
      });
    });

    // Garrison: open assignment panel
    document.getElementById('btn-manage-garrison')?.addEventListener('click', () => {
      this._openGarrisonPanel(building, settlement);
    });
  }

  // -------------------------------------------------------------------------
  // City Planning tab
  // -------------------------------------------------------------------------

  /**
   * Render the 城市規劃 tab content into #ch-tab-content.
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderCityPlanningTab(building, settlement) {
    const panel = document.getElementById('ch-tab-content');
    if (!panel) return;

    const key  = this._settlementKey(settlement);
    const plan = this._getCityPlan(key);

    const checkHTML = (id, label, checked, desc) => `
      <label class="cp-toggle-row">
        <input type="checkbox" class="cp-toggle" id="${id}" ${checked ? 'checked' : ''}>
        <span class="cp-toggle-label">${label}</span>
        <span class="cp-toggle-desc">${desc}</span>
      </label>`;

    panel.innerHTML = `
      <div class="cp-section-title">🗓 自動城市管理</div>
      <div class="cp-note">以下功能在每日結算時自動執行，收入存入地區金庫，費用從玩家持有金幣扣除。</div>
      ${checkHTML('cp-auto-tax',      '自動徵稅',   plan.autoTax,      '每日自動對本地區徵稅，稅款存入地區金庫。')}
      ${checkHTML('cp-auto-festival', '自動節慶',   plan.autoFestival, `當民心低於下方閾值時，自動舉辦節慶（消耗 🪙${FESTIVAL_COST}）。`)}
      ${checkHTML('cp-auto-invest',   '自動投資',   plan.autoInvest,   `當民心達閾值以上時，自動投資發展（單次觸發，完成後需重新啟用）。`)}

      <div class="cp-section-title" style="margin-top:12px">⚡ 最低民心閾值</div>
      <div class="cp-note">自動徵稅與自動投資只在民心高於此值時執行；自動節慶在民心低於此值時觸發。</div>
      <div class="cp-slider-row">
        <span class="cp-slider-label">閾值：<span id="cp-minsatval">${plan.minSatisfaction}</span></span>
        <input type="range" id="cp-minsat" class="cp-slider" min="-100" max="100" step="5" value="${plan.minSatisfaction}">
      </div>
      <div class="cp-info-row">
        <span style="color:#9e9e9e">目前民心：<strong style="color:#fff">${this._satisfactionMap.get(key) ?? -50}</strong></span>
      </div>
      <button class="btn-buy cp-save-btn" id="btn-save-plan" style="margin-top:10px">💾 儲存規劃</button>
    `;

    document.getElementById('cp-minsat')?.addEventListener('input', (e) => {
      const el = document.getElementById('cp-minsatval');
      if (el) el.textContent = e.target.value;
    });

    document.getElementById('btn-save-plan')?.addEventListener('click', () => {
      plan.autoTax      = !!(document.getElementById('cp-auto-tax')?.checked);
      plan.autoFestival = !!(document.getElementById('cp-auto-festival')?.checked);
      plan.autoInvest   = !!(document.getElementById('cp-auto-invest')?.checked);
      plan.minSatisfaction = Number(document.getElementById('cp-minsat')?.value ?? -30);
      this._cityPlans.set(key, plan);
      this._toast('✅ 城市規劃已儲存！');
      this._renderCityPlanningTab(building, settlement);
    });
  }

  // -------------------------------------------------------------------------
  // Replace ruler modal (town management)
  // -------------------------------------------------------------------------

  /**
   * Open an inline ruler-replacement panel showing all army members.
   * The player can assign any member as the settlement ruler.
   * Closing the panel returns to the gov building screen.
   *
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _openReplaceRulerModal(building, settlement) {
    const content = document.getElementById('location-content');
    if (!content) return;

    const key          = this._settlementKey(settlement);
    const assignedUnit = key ? this._getAssignedRulerUnit(key) : null;

    // Gather all army members (across all squads), excluding the hero
    const allUnits = [];
    this.army.getSquads().forEach(sq => {
      sq.members.forEach(m => {
        if (m.role !== 'hero') allUnits.push({ unit: m, squad: sq });
      });
    });

    const renderUnitRow = ({ unit }) => {
      const isCurrentlyAssigned = assignedUnit?.id === unit.id;
      const traitBadges = renderTraitBadgesHTML(unit.traits, PERSONALITY_COLORS);
      const taxB  = getTaxBonus(unit);
      const trdB  = getTradeBonus(unit);
      const effectHints = [
        taxB  > 0 ? `<span class="ruler-effect-hint" style="color:#66bb6a">稅收 +${Math.round(taxB * 100)}%</span>` : '',
        trdB  > 0 ? `<span class="ruler-effect-hint" style="color:#42a5f5">貿易 +${Math.round(trdB * 100)}%</span>` : '',
      ].filter(Boolean).join(' ');
      return `
        <div class="ruler-candidate-row${isCurrentlyAssigned ? ' ruler-candidate-active' : ''}"
             data-unit-id="${unit.id}">
          <div class="ruler-candidate-info">
            <div class="ruler-candidate-name">${unit.name}
              <span class="ruler-candidate-role">${unit.role}</span>
              ${isCurrentlyAssigned ? '<span class="gov-ruler-assigned-badge">（當前）</span>' : ''}
            </div>
            <div class="ruler-candidate-traits">${traitBadges}</div>
            ${effectHints ? `<div class="ruler-candidate-effects">${effectHints}</div>` : ''}
            <div class="ruler-candidate-stats">
              攻 ${unit.stats.attack} 　防 ${unit.stats.defense} 　士氣 ${unit.stats.morale}
            </div>
          </div>
          <button class="btn-buy ruler-assign-btn${isCurrentlyAssigned ? ' disabled' : ''}"
                  data-unit-id="${unit.id}"
                  ${isCurrentlyAssigned ? 'disabled' : ''}>
            ${isCurrentlyAssigned ? '✓ 已指派' : '指派'}
          </button>
        </div>`;
    };

    const unassignBtn = assignedUnit
      ? `<button class="btn-buy gov-replace-ruler-btn" id="btn-unassign-ruler" style="margin-bottom:8px">
           🔄 恢復原始統治者（${settlement.ruler?.name ?? '原統治者'}）
         </button>`
      : '';

    content.innerHTML = `
      <div class="ruler-replace-panel">
        <div class="fac-title">👥 選擇地區統治者</div>
        <div class="ruler-replace-note">
          選擇一名成員擔任 <strong>${settlement.name}</strong> 的領導者。
          擁有「一絲不苟」特質的人物可提升稅收，擁有「天生運動員」者可加速貿易。
        </div>
        ${unassignBtn}
        <div class="ruler-candidate-list">
          ${allUnits.length > 0
            ? allUnits.map(renderUnitRow).join('')
            : '<div class="ruler-no-candidates">隊伍中暫無可指派的成員。</div>'}
        </div>
        <button class="btn-buy" id="btn-ruler-replace-back" style="margin-top:8px">← 返回</button>
      </div>
    `;

    // Back button
    document.getElementById('btn-ruler-replace-back')?.addEventListener('click', () => {
      this._renderGovBuilding(building, settlement);
    });

    // Unassign button
    document.getElementById('btn-unassign-ruler')?.addEventListener('click', () => {
      if (key) {
        this._assignedRulers.delete(key);
        this._addInboxMessage('👑', `${settlement.name} 的統治者已恢復為原始領導者 ${settlement.ruler?.name ?? ''}。`);
      }
      this._renderGovBuilding(building, settlement);
    });

    // Assign buttons
    content.querySelectorAll('.ruler-assign-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const unitId = Number(btn.dataset.unitId);
        if (!key || isNaN(unitId)) return;

        // Check if this unit is already assigned as ruler to another settlement
        for (const [existingKey, existingId] of this._assignedRulers) {
          if (existingId === unitId && existingKey !== key) {
            const otherSett = this._getSettlementByKey(existingKey);
            this._toast(`❌ ${this._findUnitById(unitId)?.name ?? '此人'} 已擔任 ${otherSett?.name ?? existingKey} 的統治者。`);
            return;
          }
        }

        this._assignedRulers.set(key, unitId);
        const unit = this._findUnitById(unitId);
        this._addInboxMessage('👑', `已指派 ${unit?.name ?? '成員'} 擔任 ${settlement.name} 的統治者！`);
        this._renderGovBuilding(building, settlement);
      });
    });
  }

  /**
   * Find a unit across all army squads by id.
   * @param {number} unitId
   * @returns {import('../systems/Army.js').Unit|null}
   */
  _findUnitById(unitId) {
    for (const squad of this.army.getSquads()) {
      const unit = squad.members.find(m => m.id === unitId);
      if (unit) return unit;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Worker assignment helpers
  // -------------------------------------------------------------------------

  /**
   * Return the (up to 2) live unit objects assigned to a trade route.
   * Stale unit IDs (unit no longer in army) are automatically pruned.
   * @param {string} routeId
   * @returns {import('../systems/Army.js').Unit[]}
   */
  _getRouteWorkerUnits(routeId) {
    const ids = this._tradeRouteWorkers.get(routeId) ?? [];
    const live = ids.map(id => this._findUnitById(id)).filter(Boolean);
    if (live.length !== ids.length) {
      this._tradeRouteWorkers.set(routeId, live.map(u => u.id));
    }
    return live;
  }

  /**
   * Return the (up to 3) live unit objects assigned to construction for a settlement key.
   * Stale unit IDs are automatically pruned.
   * @param {string} settKey
   * @returns {import('../systems/Army.js').Unit[]}
   */
  _getBuildingWorkerUnits(settKey) {
    const ids = this._buildingWorkers.get(settKey) ?? [];
    const live = ids.map(id => this._findUnitById(id)).filter(Boolean);
    if (live.length !== ids.length) {
      this._buildingWorkers.set(settKey, live.map(u => u.id));
    }
    return live;
  }

  /**
   * Return a set of all unit IDs that are currently assigned to any role
   * (ruler, trade route worker, building worker) for quick conflict checking.
   * @returns {Set<number>}
   */
  _getAllAssignedUnitIds() {
    const ids = new Set();
    for (const id of this._assignedRulers.values()) ids.add(id);
    for (const arr of this._tradeRouteWorkers.values()) arr.forEach(id => ids.add(id));
    for (const arr of this._buildingWorkers.values()) arr.forEach(id => ids.add(id));
    for (const id of this._messengerUnitIds) ids.add(id);
    for (const arr of this._playerGarrisons.values()) arr.forEach(id => ids.add(id));
    return ids;
  }

  /**
   * Return caravan position objects for active trade routes that have 2 workers.
   * Caravans oscillate between origin and destination over a 60-second cycle,
   * following the A* path stored on the route (computed when the route was created).
   *
   * @returns {Array<{ id: string, type: string, worldX: number, worldY: number,
   *                   workerUnits: import('../systems/Army.js').Unit[] }>}
   */
  getTradeCaravans() {
    const caravans = [];
    const now = Date.now();
    for (const [routeId, route] of this._tradeRoutes) {
      if (!route.fromKey || !route.toKey) continue;
      const workers = this._getRouteWorkerUnits(routeId);
      if (workers.length < 2) continue; // only render active (staffed) routes

      const fromSett = this._getSettlementByKey(route.fromKey);
      const toSett   = this._getSettlementByKey(route.toKey);
      if (!fromSett || !toSett) continue;

      // Oscillate back and forth; cycle length: 60 s
      const CYCLE_MS = 60_000;
      const cyclePos = (now % CYCLE_MS) / CYCLE_MS; // 0..1
      // Triangle wave: 0→1→0
      const t = cyclePos < 0.5 ? cyclePos * 2 : (1 - cyclePos) * 2;
      // Speed bonus from worker stats shortens effective cycle.
      const speedMult = 1.0 + workers.reduce((s, u) => s + (getUnitMoveSpeed(u) - 5) / 20, 0);
      const adjT = Math.min(1, t * speedMult);

      // Lazily compute A* path for the route so caravans follow terrain.
      // When a pathfinder worker is available the search runs off the main
      // thread; the route starts with a straight-line fallback and is
      // updated with the A* result once the worker responds.
      if (!route._path && !route._pathPending && this._mapData) {
        const fromCenter = this._getSettlementCenter(fromSett);
        const toCenter   = this._getSettlementCenter(toSett);
        const fromPx = { x: (fromCenter.tx + 0.5) * TILE_SIZE, y: (fromCenter.ty + 0.5) * TILE_SIZE };
        const toPx   = { x: (toCenter.tx   + 0.5) * TILE_SIZE, y: (toCenter.ty   + 0.5) * TILE_SIZE };

        if (this._pathfinderWorker?.available) {
          route._path       = [fromPx, toPx]; // straight-line fallback while A* runs
          route._pathPending = true;
          this._pathfinderWorker.requestPath(fromPx, toPx, (result) => {
            route._pathPending = false;
            if (result) route._path = result;
          });
        } else {
          route._path = buildPath(this._mapData, fromPx, toPx) ?? [fromPx, toPx];
        }
      }

      let worldX, worldY;
      if (route._path && route._path.length >= 2) {
        const pos = _positionAlongPath(route._path, adjT);
        worldX = pos.x;
        worldY = pos.y;
      } else {
        const fromCenter = this._getSettlementCenter(fromSett);
        const toCenter   = this._getSettlementCenter(toSett);
        const fromX = (fromCenter.tx + 0.5) * TILE_SIZE;
        const fromY = (fromCenter.ty + 0.5) * TILE_SIZE;
        const toX   = (toCenter.tx + 0.5) * TILE_SIZE;
        const toY   = (toCenter.ty + 0.5) * TILE_SIZE;
        worldX = fromX + (toX - fromX) * adjT;
        worldY = fromY + (toY - fromY) * adjT;
      }

      caravans.push({
        id:          `caravan:${routeId}`,
        type:        'trade',
        worldX,
        worldY,
        workerUnits: workers,
        // Pass the representative unit's full appearance for the renderer.
        appearance:  workers[0].appearance ?? null,
      });
    }
    return caravans;
  }



  /**
   * Open an inline worker-assignment panel.
   *
   * @param {'trade'|'building'} context   What type of assignment
   * @param {string}             entityKey  routeId or settlementKey
   * @param {number}             maxSlots   Max workers (2 for trade, 3 for building)
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @param {()=>void}           onBack     Callback when done / back button pressed
   */
  _openAssignWorkerPanel(context, entityKey, maxSlots, building, settlement, onBack) {
    const content = document.getElementById('location-content');
    if (!content) return;

    const currentMap  = context === 'trade' ? this._tradeRouteWorkers : this._buildingWorkers;
    const currentIds  = currentMap.get(entityKey) ?? [];
    const assignedAll = this._getAllAssignedUnitIds();

    // All army members across squads (including hero)
    const allUnits = [];
    for (const squad of this.army.getSquads()) {
      for (const m of squad.members) allUnits.push(m);
    }

    const contextLabel = context === 'trade'
      ? '貿易路線（需 2 人）'
      : '工程建設（最多 3 人）';

    const unitRows = allUnits.map(unit => {
      const isAssignedHere = currentIds.includes(unit.id);
      const isAssignedElse = !isAssignedHere && assignedAll.has(unit.id);
      const traitBadges    = renderTraitBadgesHTML(unit.traits.slice(0, 3), PERSONALITY_COLORS);
      const isFull         = currentIds.length >= maxSlots && !isAssignedHere;
      const canAssign      = !isAssignedElse && !isFull;

      const bonus = context === 'trade'
        ? (getTradeBonus(unit) > 0 ? `🛤 +${Math.round(getTradeBonus(unit) * 100)}%` : '')
        : (getConstructBonus(unit) > 0 ? `🏗 +${Math.round(getConstructBonus(unit) * 100)}%` : '');

      return `
        <div class="assign-worker-row${isAssignedHere ? ' assigned-here' : ''}${isAssignedElse ? ' assigned-elsewhere' : ''}">
          <span class="awr-name">${unit.name}</span>
          <span class="awr-speed">🏃${unit.stats?.moveSpeed ?? 5}</span>
          <span class="awr-traits">${traitBadges}</span>
          ${bonus ? `<span class="awr-bonus">${bonus}</span>` : ''}
          ${isAssignedElse ? '<span class="awr-conflict">已指派他處</span>' : ''}
          ${isAssignedHere
            ? `<button class="btn-buy awr-remove" data-unit-id="${unit.id}">解除</button>`
            : `<button class="btn-buy awr-assign${!canAssign ? ' disabled' : ''}" data-unit-id="${unit.id}"
               ${!canAssign ? 'disabled' : ''}>指派</button>`
          }
        </div>`;
    }).join('');

    content.innerHTML = `
      <button class="fac-back-btn" id="aw-back">← 返回</button>
      <div class="fac-title">👷 指派人員：${contextLabel}</div>
      <div class="assign-worker-list">${unitRows}</div>
    `;

    document.getElementById('aw-back')?.addEventListener('click', onBack);

    content.querySelectorAll('.awr-assign:not(.disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        const unitId = Number(btn.dataset.unitId);
        const ids    = [...(currentMap.get(entityKey) ?? [])];
        if (ids.length < maxSlots && !ids.includes(unitId)) {
          ids.push(unitId);
          currentMap.set(entityKey, ids);
        }
        onBack();
      });
    });

    content.querySelectorAll('.awr-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const unitId = Number(btn.dataset.unitId);
        const ids    = (currentMap.get(entityKey) ?? []).filter(id => id !== unitId);
        currentMap.set(entityKey, ids);
        this._openAssignWorkerPanel(context, entityKey, maxSlots, building, settlement, onBack);
      });
    });
  }

  /**
   * Open the garrison assignment panel for a player-owned settlement.
   * Allows assigning and removing units from the local garrison.
   *
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _openGarrisonPanel(building, settlement) {
    const content = document.getElementById('location-content');
    if (!content) return;

    const key        = this._settlementKey(settlement);
    const garrisonMax = settlement.type === 'castle' ? PLAYER_CASTLE_GARRISON_MAX : PLAYER_VILLAGE_GARRISON_MAX;
    const currentIds  = this._playerGarrisons.get(key) ?? [];
    const assignedAll = this._getAllAssignedUnitIds();

    // All army members across squads
    const allUnits = [];
    for (const squad of this.army.getSquads()) {
      for (const m of squad.members) allUnits.push(m);
    }

    const unitRows = allUnits.map(unit => {
      const isAssignedHere  = currentIds.includes(unit.id);
      const isAssignedElse  = !isAssignedHere && assignedAll.has(unit.id);
      const traitBadges     = renderTraitBadgesHTML(unit.traits.slice(0, 3), PERSONALITY_COLORS);
      const isFull          = currentIds.length >= garrisonMax && !isAssignedHere;
      const canAssign       = !isAssignedElse && !isFull;

      return `
        <div class="assign-worker-row${isAssignedHere ? ' assigned-here' : ''}${isAssignedElse ? ' assigned-elsewhere' : ''}">
          <span class="awr-name">${unit.name}</span>
          <span class="awr-speed">${unit.role}</span>
          <span class="awr-traits">${traitBadges}</span>
          ${isAssignedElse ? '<span class="awr-conflict">已指派他處</span>' : ''}
          ${isAssignedHere
            ? `<button class="btn-buy awr-remove" data-unit-id="${unit.id}">撤回</button>`
            : `<button class="btn-buy awr-assign${!canAssign ? ' disabled' : ''}" data-unit-id="${unit.id}"
               ${!canAssign ? 'disabled' : ''}>派駐</button>`
          }
        </div>`;
    }).join('');

    content.innerHTML = `
      <button class="fac-back-btn" id="garrison-back">← 返回</button>
      <div class="fac-title">🛡 調整駐軍：${settlement.name}</div>
      <div class="gov-stat-row-small" style="padding:4px 0 10px">
        <span class="gov-stat-label">駐軍名額</span>
        <span class="gov-stat-val">${currentIds.length} / ${garrisonMax} 人</span>
      </div>
      <div class="assign-worker-list">${unitRows}</div>
    `;

    const goBack = () => this._renderGovBuilding(building, settlement, 'gov');

    document.getElementById('garrison-back')?.addEventListener('click', goBack);

    content.querySelectorAll('.awr-assign:not(.disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        const unitId = Number(btn.dataset.unitId);
        const ids    = [...(this._playerGarrisons.get(key) ?? [])];
        ids.push(unitId);
        this._playerGarrisons.set(key, ids);
        this._openGarrisonPanel(building, settlement);
      });
    });

    content.querySelectorAll('.awr-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const unitId = Number(btn.dataset.unitId);
        const ids    = (this._playerGarrisons.get(key) ?? []).filter(id => id !== unitId);
        this._playerGarrisons.set(key, ids);
        this._openGarrisonPanel(building, settlement);
      });
    });
  }

  /**
   * Render the diplomatic proposal panel inside a foreign nation's government
   * building.  The player can propose a Non-Aggression Pact, a Joint War
   * Declaration, or a Mutual Protection Pact directly (no missive needed —
   * the ruler is right there).
   *
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement  Foreign settlement.
   */
  _renderForeignDiplomacy(building, settlement) {
    const container = document.getElementById('gov-foreign-diplo');
    if (!container) return;
    if (!this.diplomacySystem || !this.nationSystem) return;

    const nationId  = settlement.nationId;
    const relVal    = this.diplomacySystem.getPlayerRelation(nationId);
    const relLevel  = this.diplomacySystem.getRelationLevel(relVal);
    const atWar     = this.diplomacySystem.isAtWar(_PLAYER_NATION_ID_UI, nationId);
    const hasNap    = this.diplomacySystem.hasNonAggressionPact(_PLAYER_NATION_ID_UI, nationId);
    const hasMpt    = this.diplomacySystem.hasMutualProtectionPact(_PLAYER_NATION_ID_UI, nationId);
    const relStr    = relVal > 0 ? `+${relVal}` : `${relVal}`;

    // Conditions for each proposal type
    const canNap    = !atWar && !hasNap  && relVal >= -20;
    const canMpt    = !atWar && !hasMpt  && relVal >= 60;
    // Joint war: need relation ≥ 20 and there must be at least one nation the NPC is hostile toward
    const potentialTargets = this.nationSystem.nations.filter((n, tid) =>
      n && tid !== nationId && tid >= 0 &&
      !this.nationSystem.isNationExtinct(tid) &&
      this.diplomacySystem.getRelation(nationId, tid) <= _JOINT_WAR_HOSTILITY_THRESHOLD,
    );
    const canJointWar = !atWar && relVal >= 20 && potentialTargets.length > 0;

    // Trade route proposal: check if already have an import route from this settlement
    const settlKey       = this._settlementKey(settlement);
    const alreadyImporting = settlKey
      ? [...this._tradeRoutes.values()].some(r => r.fromKey === settlKey && r.isImport)
      : false;
    const canTrade = !atWar && !alreadyImporting && relVal >= TRADE_MIN_FOREIGN_RELATION;
    const tradeDesc = alreadyImporting
      ? '進口貿易路線已建立'
      : atWar
        ? '戰爭狀態下無法提議'
        : relVal >= TRADE_MIN_FOREIGN_RELATION
          ? `向對方提議開放商路，進口其資源（需 ≥ ${TRADE_MIN_FOREIGN_RELATION}）`
          : `關係值過低（需 ≥ ${TRADE_MIN_FOREIGN_RELATION}）`;

    // Banquet (宴請): always available when not at war; costs gold
    const banquetCost = BANQUET_BASE_COST + (settlement.economyLevel ?? 1) * BANQUET_ECO_COST;
    const canBanquet  = !atWar && this._getGold() >= banquetCost;
    const banquetDesc = atWar
      ? '戰爭狀態下無法舉辦'
      : this._getGold() < banquetCost
        ? `金幣不足（需 🪙${banquetCost}）`
        : `花費 🪙${banquetCost} 設宴款待，改善雙方關係`;

    // Demand (要求): available when player has military strength
    const playerStr = this._getPlayerStrength();
    const canDemand = playerStr > 0;
    const demandGold = DEMAND_GOLD_BASE + (settlement.economyLevel ?? 1) * DEMAND_GOLD_PER_ECO;
    const demandDesc = playerStr > 0
      ? `以軍事壓力索取 🪙${demandGold} 進貢（有風險）`
      : '你沒有足夠的軍事力量發出要求';

    const pactBadge = (active, label) => active
      ? `<span class="gov-pact-badge gov-pact-active">${label} 有效</span>`
      : '';

    // Connecting road proposal: needs friendly relation and player to own at least one settlement
    const playerHasSettlement = this.nationSystem && (
      this.nationSystem.castleSettlements.some(s => s.controllingNationId === PLAYER_NATION_ID) ||
      this.nationSystem.villageSettlements.some(s => s.controllingNationId === PLAYER_NATION_ID)
    );
    const canConnectRoad = !atWar && relVal >= CONNECT_ROAD_MIN_RELATION && playerHasSettlement
                           && this._getGold() >= CONNECT_ROAD_PROPOSAL_COST;
    const connectRoadDesc = atWar
      ? '戰爭狀態下無法提議'
      : !playerHasSettlement
        ? '你尚未控制任何地區'
        : relVal < CONNECT_ROAD_MIN_RELATION
          ? `關係值過低（需 ≥ ${CONNECT_ROAD_MIN_RELATION}）`
          : this._getGold() < CONNECT_ROAD_PROPOSAL_COST
            ? `金幣不足（需 🪙${CONNECT_ROAD_PROPOSAL_COST}）`
            : `花費 🪙${CONNECT_ROAD_PROPOSAL_COST} 提議共建連結道路，加深往來`;

    container.innerHTML = `
      <div class="gov-foreign-diplo-section">
        <div class="gov-foreign-diplo-title">🤝 外交提案</div>
        <div class="gov-foreign-diplo-rel" style="color:${relLevel.color}">
          目前關係：${relLevel.icon} ${relLevel.label}（${relStr}）
          ${atWar ? '<span class="dipl-war-badge">⚔ 戰爭中</span>' : ''}
        </div>
        ${hasNap ? pactBadge(true, '☮ 互不侵犯條約') : ''}
        ${hasMpt ? pactBadge(true, '🛡 互保條約') : ''}
        <div class="gov-diplo-proposals">
          <div class="gov-diplo-proposal-card${canBanquet ? '' : ' disabled'}" id="diplo-banquet" role="button" tabindex="${canBanquet ? 0 : -1}">
            <span class="gdp-icon">🍷</span>
            <div class="gdp-info">
              <div class="gdp-name">宴請統治者</div>
              <div class="gdp-desc">${banquetDesc}</div>
            </div>
            <span class="gdp-arrow">${canBanquet ? '›' : '🔒'}</span>
          </div>
          <div class="gov-diplo-proposal-card${canDemand ? '' : ' disabled'}" id="diplo-demand" role="button" tabindex="${canDemand ? 0 : -1}">
            <span class="gdp-icon">⚖</span>
            <div class="gdp-info">
              <div class="gdp-name">要求進貢</div>
              <div class="gdp-desc">${demandDesc}</div>
            </div>
            <span class="gdp-arrow">${canDemand ? '›' : '🔒'}</span>
          </div>
          <div class="gov-diplo-proposal-card${canNap ? '' : ' disabled'}" id="diplo-nap" role="button" tabindex="${canNap ? 0 : -1}">
            <span class="gdp-icon">☮</span>
            <div class="gdp-info">
              <div class="gdp-name">互不侵犯條約</div>
              <div class="gdp-desc">${hasNap ? '條約已締結' : !atWar ? (relVal >= -20 ? '雙方同意在協議期間不互相攻伐' : '需要關係值 ≥ -20') : '戰爭狀態下無法締結'}</div>
            </div>
            <span class="gdp-arrow">${canNap ? '›' : '🔒'}</span>
          </div>
          <div class="gov-diplo-proposal-card${canJointWar ? '' : ' disabled'}" id="diplo-joint-war" role="button" tabindex="${canJointWar ? 0 : -1}">
            <span class="gdp-icon">⚔</span>
            <div class="gdp-info">
              <div class="gdp-name">合意宣戰第三國</div>
              <div class="gdp-desc">${!atWar ? (relVal >= 20 ? (potentialTargets.length > 0 ? '聯合對共同敵人發動戰爭' : '對方目前無合適的共同敵人') : '需要關係值 ≥ 20') : '戰爭狀態下無法進行'}</div>
            </div>
            <span class="gdp-arrow">${canJointWar ? '›' : '🔒'}</span>
          </div>
          <div class="gov-diplo-proposal-card${canMpt ? '' : ' disabled'}" id="diplo-mpt" role="button" tabindex="${canMpt ? 0 : -1}">
            <span class="gdp-icon">🛡</span>
            <div class="gdp-info">
              <div class="gdp-name">互保條約</div>
              <div class="gdp-desc">${hasMpt ? '條約已締結' : !atWar ? (relVal >= 60 ? '雙方同意在任一方受攻擊時共同應戰' : '需要關係值 ≥ 60（盟友）') : '戰爭狀態下無法締結'}</div>
            </div>
            <span class="gdp-arrow">${canMpt ? '›' : '🔒'}</span>
          </div>
          <div class="gov-diplo-proposal-card${canTrade ? '' : ' disabled'}" id="diplo-trade-route" role="button" tabindex="${canTrade ? 0 : -1}">
            <span class="gdp-icon">🛤</span>
            <div class="gdp-info">
              <div class="gdp-name">提議建立貿易路線</div>
              <div class="gdp-desc">${tradeDesc}</div>
            </div>
            <span class="gdp-arrow">${canTrade ? '›' : (alreadyImporting ? '✅' : '🔒')}</span>
          </div>
          <div class="gov-diplo-proposal-card${canConnectRoad ? '' : ' disabled'}" id="diplo-connect-road" role="button" tabindex="${canConnectRoad ? 0 : -1}">
            <span class="gdp-icon">🛣️</span>
            <div class="gdp-info">
              <div class="gdp-name">建立連結道路</div>
              <div class="gdp-desc">${connectRoadDesc}</div>
            </div>
            <span class="gdp-arrow">${canConnectRoad ? '›' : '🔒'}</span>
          </div>
        </div>
      </div>
    `;

    const backFn = () => this._renderGovBuilding(building, settlement);

    const bindCard = (id, fn) => {
      const el = container.querySelector(`#${id}`);
      if (!el || el.classList.contains('disabled')) return;
      el.addEventListener('click', fn);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
      });
    };

    bindCard('diplo-banquet',      () => this._renderBanquetProposal(settlement, backFn));
    bindCard('diplo-demand',       () => this._renderDemandProposal(settlement, backFn));
    bindCard('diplo-nap',          () => this._renderNapProposal(building, settlement));
    bindCard('diplo-joint-war',    () => this._renderJointWarProposal(building, settlement));
    bindCard('diplo-mpt',          () => this._renderMutualProtectionProposal(building, settlement));
    bindCard('diplo-trade-route',  () => this._renderForeignTradeProposal(building, settlement));
    bindCard('diplo-connect-road', () => this._renderConnectingRoadProposal(building, settlement));
  }

  // -------------------------------------------------------------------------
  // Trade route management panel (player-owned government building)
  // -------------------------------------------------------------------------

  /**
   * Show the trade route management screen for a player-owned settlement.
   * Lists existing routes (with 2-worker assignment UI) and lets the player
   * add new ones.
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement  Player-owned.
   */
  _renderTradeRoutePanel(building, settlement) {
    const content = document.getElementById('location-content');
    if (!content) return;

    const fromKey = this._settlementKey(settlement);
    if (!fromKey) return;

    // Routes originating from this settlement (exports)
    const myRoutes = [...this._tradeRoutes.entries()]
      .filter(([, r]) => r.fromKey === fromKey && !r.isImport)
      .map(([id, r]) => ({ id, ...r }));

    // Import routes arriving at this settlement (foreign merchants coming here)
    const importRoutes = [...this._tradeRoutes.entries()]
      .filter(([, r]) => r.toKey === fromKey && r.isImport)
      .map(([id, r]) => ({ id, ...r }));

    // Helper: render the 2-slot worker assignment row for a route
    const renderRouteWorkerSlots = (routeId) => {
      const workers = this._getRouteWorkerUnits(routeId);
      const slots = [0, 1].map(i => {
        const unit = workers[i];
        if (unit) {
          return `<span class="tr-worker-slot tr-worker-filled" data-route-id="${routeId}" data-slot="${i}" title="點擊解除">
            ${renderTraitBadgesHTML(unit.traits.slice(0, 1), PERSONALITY_COLORS)}
            ${unit.name} <span class="tr-worker-speed">🏃${unit.stats?.moveSpeed ?? 5}</span>
            <button class="tr-worker-remove" data-route-id="${routeId}" data-unit-id="${unit.id}">✕</button>
          </span>`;
        }
        return `<span class="tr-worker-slot tr-worker-empty" data-route-id="${routeId}" data-slot="${i}">空位 ${i + 1}</span>`;
      });
      const active = workers.length >= 2;
      return `<div class="tr-route-workers">
        <span class="tr-workers-label">👤 工作人員 ${active ? '<span class="tr-active-badge">運作中</span>' : '<span class="tr-inactive-badge">需 2 人</span>'}</span>
        ${slots.join('')}
        ${workers.length < 2 ? `<button class="btn-buy tr-assign-worker-btn" data-route-id="${routeId}">指派</button>` : ''}
      </div>`;
    };

    const existingHTML = myRoutes.length > 0
      ? myRoutes.map(r => {
          const workers = this._getRouteWorkerUnits(r.id);
          const bonus   = workers.reduce((s, u) => s + getTradeBonus(u), 0);
          const effectiveGold = Math.round(r.dailyGold * (1 + bonus));
          return `
          <div class="tr-route-card">
            <div class="tr-route-row">
              <span class="tr-route-dest">${r.toName}</span>
              <span class="tr-route-goods">${(r.resources ?? []).join('、') || '—'}</span>
              <span class="tr-route-gold">
                +${r.dailyGold} 🪙/日
                ${bonus > 0 ? `<span style="color:#42a5f5">(實得 ${effectiveGold})</span>` : ''}
              </span>
              <button class="tr-route-del" data-route-id="${r.id}" title="取消路線">✕</button>
            </div>
            ${renderRouteWorkerSlots(r.id)}
          </div>`;
        }).join('')
      : '<div class="tr-empty">尚無對外出口路線</div>';

    // Import routes (foreign merchants coming to this settlement)
    const importHTML = importRoutes.length > 0
      ? importRoutes.map(r => {
          const fromSett = this._getSettlementByKey(r.fromKey);
          const isForeign = fromSett && fromSett.controllingNationId >= 0 &&
                            fromSett.controllingNationId !== PLAYER_NATION_ID;
          return `
          <div class="tr-route-card" style="border-color:#64b5f6">
            <div class="tr-route-row">
              <span class="tr-route-dest" style="color:#64b5f6">← ${r.fromName}</span>
              <span class="tr-route-goods">${(r.resources ?? []).join('、') || '—'}</span>
              <span class="tr-route-gold">+${r.dailyGold} 🪙/日</span>
              ${isForeign
                ? `<button class="tr-import-cancel" data-route-id="${r.id}"
                     title="終止此外國進口路線（關係 ${TRADE_CANCEL_RELATION_PENALTY}）">終止</button>`
                : `<button class="tr-route-del" data-route-id="${r.id}" title="取消路線">✕</button>`
              }
            </div>
            ${isForeign ? `<div class="tr-import-warn">⚠ 終止後將影響與 ${fromSett.name} 所屬國的關係（${TRADE_CANCEL_RELATION_PENALTY}）</div>` : ''}
          </div>`;
        }).join('')
      : '';

    // All other settlements as potential destinations
    const allSettlements = [
      ...(this.nationSystem?.castleSettlements  ?? []).map((s, i) => ({ s, k: `castle:${i}` })),
      ...(this.nationSystem?.villageSettlements ?? []).map((s, i) => ({ s, k: `village:${i}` })),
    ].filter(({ k }) => k !== fromKey);

    // Compute distances for sorting
    let sTile = null;
    if (this._mapData) {
      const sIdx = settlement.type === 'castle'
        ? this.nationSystem.castleSettlements.indexOf(settlement)
        : this.nationSystem.villageSettlements.indexOf(settlement);
      sTile = settlement.type === 'castle'
        ? this._mapData.castles[sIdx]
        : this._mapData.villages[sIdx];
    }

    const candidates = allSettlements.map(({ s, k }) => {
      let dist = 9999;
      if (sTile && this._mapData) {
        const tIdx = s.type === 'castle'
          ? this.nationSystem.castleSettlements.indexOf(s)
          : this.nationSystem.villageSettlements.indexOf(s);
        const tile = s.type === 'castle' ? this._mapData.castles[tIdx] : this._mapData.villages[tIdx];
        if (tile) { const dx = tile.x - sTile.x, dy = tile.y - sTile.y; dist = Math.round(Math.sqrt(dx*dx + dy*dy)); }
      }
      const alreadyConnected = this._tradeRoutes.has(`${fromKey}→${k}`) || this._tradeRoutes.has(`${k}→${fromKey}`);
      const { ok, reason }   = this._canEstablishTradeWith(s);
      // Determine label by ownership
      let typeLabel = '', typeColor = '#9e9e9e';
      if (s.controllingNationId === PLAYER_NATION_ID) { typeLabel = '己方'; typeColor = '#e2c97e'; }
      else if (s.controllingNationId === NEUTRAL_NATION_ID) { typeLabel = '中立'; typeColor = '#90a4ae'; }
      else { typeLabel = '外國'; typeColor = '#64b5f6'; }
      return { s, k, dist, ok, reason, alreadyConnected, typeLabel, typeColor };
    }).sort((a, b) => a.dist - b.dist);

    const candidatesHTML = candidates.map(c => {
      const gold   = Math.max(1, c.s.economyLevel * TRADE_INCOME_PER_ECONOMY_LEVEL);
      const demand = this._getSettlementDemand(c.k, c.s);
      return `
        <div class="tr-cand-row${c.ok && !c.alreadyConnected ? '' : ' tr-cand-locked'}">
          <span class="tr-cand-type" style="color:${c.typeColor}">${c.typeLabel}</span>
          <div class="tr-cand-info">
            <span class="tr-cand-name">${c.s.name}</span>
            <span class="tr-cand-detail">需求：${demand}　距離：${c.dist}</span>
            ${!c.ok && !c.alreadyConnected ? `<span class="tr-cand-reason">${c.reason}</span>` : ''}
          </div>
          <button class="tr-cand-btn${c.alreadyConnected ? ' connected' : ''}${c.ok && !c.alreadyConnected ? '' : ' disabled'}"
                  data-to-key="${c.k}"
                  ${c.ok && !c.alreadyConnected ? '' : 'disabled'}>
            ${c.alreadyConnected ? '已連接' : `+${gold}🪙`}
          </button>
        </div>`;
    }).join('');

    // ── Foreign trade relationship summary ────────────────────────────────────
    // For each foreign nation, determine whether we export to them, they import
    // to us, or both, then show a → / ← / ↔ indicator.
    const foreignRelMap = new Map(); // nationId → { nationName, hasExport, hasImport }
    for (const [, route] of this._tradeRoutes) {
      const otherKey = route.isImport ? route.fromKey : route.toKey;
      const selfKey  = route.isImport ? route.toKey   : route.fromKey;
      if (selfKey !== fromKey) continue; // not about this settlement
      const otherSett = this._getSettlementByKey(otherKey);
      if (!otherSett) continue;
      const nid = otherSett.controllingNationId;
      if (nid === PLAYER_NATION_ID || nid === NEUTRAL_NATION_ID) continue;
      if (!foreignRelMap.has(nid)) {
        const nName = this.nationSystem?.nations?.[nid]?.name ?? otherSett.name;
        foreignRelMap.set(nid, { nationName: nName, hasExport: false, hasImport: false });
      }
      const entry = foreignRelMap.get(nid);
      if (route.isImport) entry.hasImport = true;
      else                entry.hasExport = true;
    }
    // Also include NPC-level trade routes from DiplomacySystem (nation-to-nation).
    if (this.diplomacySystem && this._capturedSettlements.has(fromKey)) {
      for (const r of this.diplomacySystem.getActiveTradeRoutes()) {
        const isPlayerA = r.nationA === _PLAYER_NATION_ID_UI;
        const isPlayerB = r.nationB === _PLAYER_NATION_ID_UI;
        if (!isPlayerA && !isPlayerB) continue;
        const nid = isPlayerA ? r.nationB : r.nationA;
        if (!foreignRelMap.has(nid)) {
          const nName = this.nationSystem?.nations?.[nid]?.name ?? `國家${nid}`;
          foreignRelMap.set(nid, { nationName: nName, hasExport: false, hasImport: false });
        }
        // DiplomacySystem routes are bidirectional at the nation level.
        const entry = foreignRelMap.get(nid);
        entry.hasExport = true;
        entry.hasImport = true;
      }
    }

    let foreignRelHTML = '';
    if (foreignRelMap.size > 0) {
      const rows = [...foreignRelMap.values()].map(({ nationName, hasExport, hasImport }) => {
        let arrow, arrowTitle;
        if (hasExport && hasImport) {
          arrow = '↔'; arrowTitle = '雙向貿易';
        } else if (hasExport) {
          arrow = '→'; arrowTitle = '我方出口至對方';
        } else {
          arrow = '←'; arrowTitle = '對方進口至我方';
        }
        return `<div class="tr-foreign-rel-row">
          <span class="tr-foreign-rel-arrow" title="${arrowTitle}">${arrow}</span>
          <span class="tr-foreign-rel-name">${nationName}</span>
          <span class="tr-foreign-rel-type">${arrowTitle}</span>
        </div>`;
      }).join('');
      foreignRelHTML = `
        <div class="tr-section-title">外國貿易關係</div>
        <div class="tr-foreign-rel-list">${rows}</div>`;
    }

    content.innerHTML = `
      ${this._facilityBackHTML(settlement)}
      <div class="fac-title">🛤 貿易路線管理</div>
      <div class="tr-worker-note">💡 建立路線時需指派 2 名人員；進口路線由外國商隊負責。</div>
      ${importRoutes.length > 0 ? `<div class="tr-section-title">進口路線（外國商隊來此）</div><div class="tr-route-list">${importHTML}</div>` : ''}
      <div class="tr-section-title">現有出口路線</div>
      <div class="tr-route-list">${existingHTML}</div>
      ${foreignRelHTML}
      <div class="tr-section-title">可建立出口路線</div>
      <div class="tr-candidates">${candidatesHTML || '<div class="tr-empty">無可用目標</div>'}</div>
    `;

    this._attachFacilityBack(settlement);

    // Delete route buttons
    content.querySelectorAll('.tr-route-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const routeId = btn.dataset.routeId;
        const route   = this._tradeRoutes.get(routeId);
        if (!route) return;
        this._tradeRouteWorkers.delete(routeId);
        this._tradeRoutes.delete(routeId);
        this._addInboxMessage('🛤', `已取消 ${route.fromName} → ${route.toName} 的貿易路線。`);
        this._renderTradeRoutePanel(building, settlement);
      });
    });

    // Cancel foreign import route (with relation penalty)
    content.querySelectorAll('.tr-import-cancel').forEach(btn => {
      btn.addEventListener('click', () => {
        const routeId = btn.dataset.routeId;
        const route   = this._tradeRoutes.get(routeId);
        if (!route) return;
        const fromSett = this._getSettlementByKey(route.fromKey);
        const nationId = fromSett?.controllingNationId;
        if (!window.confirm(`確定要終止來自 ${route.fromName} 的貿易路線？\n此舉將令對方不滿（關係 ${TRADE_CANCEL_RELATION_PENALTY}）。`)) return;
        this._tradeRouteWorkers.delete(routeId);
        this._tradeRoutes.delete(routeId);
        // Apply relation penalty
        if (this.diplomacySystem && nationId >= 0) {
          this.diplomacySystem.modifyPlayerRelation(nationId, TRADE_CANCEL_RELATION_PENALTY);
          this.diplomacySystem._addMemoryEntry(nationId,
            `玩家單方面終止了與我國的貿易路線，關係 ${TRADE_CANCEL_RELATION_PENALTY}`,
            TRADE_CANCEL_RELATION_PENALTY);
        }
        this._addInboxMessage('🛤', `已終止來自 ${route.fromName} 的進口路線（關係 ${TRADE_CANCEL_RELATION_PENALTY}）。`);
        this._renderTradeRoutePanel(building, settlement);
      });
    });

    // Remove worker from route
    content.querySelectorAll('.tr-worker-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const routeId = btn.dataset.routeId;
        const unitId  = Number(btn.dataset.unitId);
        const ids = this._tradeRouteWorkers.get(routeId) ?? [];
        this._tradeRouteWorkers.set(routeId, ids.filter(id => id !== unitId));
        this._renderTradeRoutePanel(building, settlement);
      });
    });

    // Assign workers to routes
    content.querySelectorAll('.tr-assign-worker-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const routeId = btn.dataset.routeId;
        this._openAssignWorkerPanel('trade', routeId, 2, building, settlement,
          () => this._renderTradeRoutePanel(building, settlement));
      });
    });

    // Add route buttons — open worker picker first; route is only saved after 2 workers are confirmed.
    content.querySelectorAll('.tr-cand-btn:not(.disabled):not(.connected)').forEach(btn => {
      btn.addEventListener('click', () => {
        const toKey  = btn.dataset.toKey;
        const toSett = this._getSettlementByKey(toKey);
        if (!toSett) return;
        this._openNewRouteWorkerPanel(building, settlement, toSett);
      });
    });
  }

  /**
   * Worker-picker shown when the player wants to create a new export trade route.
   * The route is only stored once 2 workers are confirmed; clicking back cancels.
   *
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} fromSettlement  Player-owned origin.
   * @param {import('../systems/NationSystem.js').Settlement} toSettlement    Target settlement.
   */
  _openNewRouteWorkerPanel(building, fromSettlement, toSettlement) {
    const content = document.getElementById('location-content');
    if (!content) return;

    const assignedAll   = this._getAllAssignedUnitIds();
    const allUnits      = [];
    for (const squad of this.army.getSquads()) {
      for (const m of squad.members) allUnits.push(m);
    }

    // Track selected unit IDs locally (toggled by the player).
    const selected = new Set();

    const render = () => {
      const unitRows = allUnits.map(unit => {
        const isBusy      = assignedAll.has(unit.id);
        const isSel       = selected.has(unit.id);
        const traitBadges = renderTraitBadgesHTML(unit.traits.slice(0, 3), PERSONALITY_COLORS);
        const bonus       = getTradeBonus(unit) > 0 ? `🛤 +${Math.round(getTradeBonus(unit) * 100)}%` : '';
        return `
          <div class="assign-worker-row${isSel ? ' assigned-here' : ''}${isBusy ? ' assigned-elsewhere' : ''}">
            <span class="awr-name">${unit.name}</span>
            <span class="awr-speed">🏃${unit.stats?.moveSpeed ?? 5}</span>
            <span class="awr-traits">${traitBadges}</span>
            ${bonus ? `<span class="awr-bonus">${bonus}</span>` : ''}
            ${isBusy ? '<span class="awr-conflict">已派遣他處</span>' : ''}
            ${!isBusy ? `<button class="btn-buy awr-assign${isSel ? ' awr-desel' : ''}" data-unit-id="${unit.id}">
              ${isSel ? '取消' : '選擇'}
            </button>` : ''}
          </div>`;
      }).join('');

      const ready    = selected.size >= 2;
      const fromKey  = this._settlementKey(fromSettlement);
      const toKey    = this._settlementKey(toSettlement);
      const routeId  = `${fromKey}→${toKey}`;
      const dailyGold = Math.max(1, toSettlement.economyLevel * TRADE_INCOME_PER_ECONOMY_LEVEL);

      content.innerHTML = `
        <button class="fac-back-btn" id="nrw-back">← 返回</button>
        <div class="fac-title">👤 指派路線人員</div>
        <div class="tr-worker-note">目標：${fromSettlement.name} → ${toSettlement.name}，每日 +${dailyGold}🪙<br>
          請選擇 2 名人員負責此路線（已選：${selected.size} / 2）</div>
        <div class="assign-worker-list">${unitRows}</div>
        <button class="btn-buy treaty-send-btn${ready ? '' : ' disabled'}" id="nrw-confirm" ${ready ? '' : 'disabled'}>
          🛤 建立路線（${selected.size}/2 人）
        </button>
      `;

      document.getElementById('nrw-back')?.addEventListener('click', () => {
        this._renderTradeRoutePanel(building, fromSettlement);
      });

      document.getElementById('nrw-confirm')?.addEventListener('click', () => {
        if (selected.size < 2) return;
        this._establishTrade(fromSettlement, toSettlement);
        if (this._tradeRoutes.has(routeId)) {
          this._tradeRouteWorkers.set(routeId, [...selected].slice(0, 2));
        }
        this._renderTradeRoutePanel(building, fromSettlement);
      });

      content.querySelectorAll('.awr-assign').forEach(btn => {
        btn.addEventListener('click', () => {
          const unitId = Number(btn.dataset.unitId);
          if (selected.has(unitId)) {
            selected.delete(unitId);
          } else if (selected.size < 2) {
            selected.add(unitId);
          }
          render();
        });
      });
    };

    render();
  }

  /**
   * Banquet (宴請) proposal screen.
   * Player spends gold to hold a banquet for the foreign ruler, improving relations.
   * Can be triggered from both the gate screen (backFn = re-render gate) and from
   * the government building (backFn = re-render gov building).
   *
   * @param {import('../systems/NationSystem.js').Settlement} settlement  Foreign settlement.
   * @param {function} backFn  Callback to navigate back.
   */
  _renderBanquetProposal(settlement, backFn) {
    const content = document.getElementById('location-content');
    if (!content || !this.diplomacySystem || !this.nationSystem) return;

    const nationId   = settlement.nationId;
    const nation     = this.nationSystem.nations[nationId];
    const ruler      = settlement.ruler;
    const nationName = nation?.name ?? settlement.name;
    const cost       = BANQUET_BASE_COST + (settlement.economyLevel ?? 1) * BANQUET_ECO_COST;

    // Determine expected relation gain based on personality
    const personality = ruler?.traits?.find(t => ALL_PERSONALITIES.includes(t)) ?? '謹慎';
    const gain        = BANQUET_RELATION_GAIN[personality] ?? BANQUET_RELATION_DEFAULT;
    const playerGold  = this._getGold();

    content.innerHTML = `
      <button class="fac-back-btn" id="diplo-back">← 返回</button>
      <div class="fac-title">🍷 宴請統治者</div>
      <div class="treaty-form">
        <div class="diplo-proposal-intro">
          你打算設宴款待 <strong>${ruler?.name ?? '統治者'}</strong>（${nationName}），以宴席拉近雙方關係。<br>
          佳餚美酒需要花費一筆金幣，但能有效改善外交氛圍。
        </div>
        <div class="treaty-row">
          <span class="treaty-label">宴請費用</span>
          <span style="color:#ffd54f">🪙${cost}（持有：${playerGold}）</span>
        </div>
        <div class="treaty-row">
          <span class="treaty-label">預期關係改善</span>
          <span style="color:#66bb6a">+${gain}（${ruler?.name ?? '統治者'} 個性：${personality}）</span>
        </div>
        <div class="treaty-note">統治者的個性決定他對宴請的接受程度；傲慢的統治者改善幅度較小，溫和的統治者則最為受用。</div>
        <button class="btn-buy treaty-send-btn${playerGold < cost ? ' disabled' : ''}" id="diplo-banquet-confirm"
          ${playerGold < cost ? 'disabled' : ''}>
          🍷 確認宴請（花費 🪙${cost}）
        </button>
      </div>
    `;

    document.getElementById('diplo-back')?.addEventListener('click', backFn);

    document.getElementById('diplo-banquet-confirm')?.addEventListener('click', () => {
      if (!this._spendGold(cost)) {
        this._toast('💸 金幣不足！');
        return;
      }
      this.diplomacySystem.modifyPlayerRelation(nationId, gain);
      this._refreshGoldDisplay();
      this._addInboxMessage('🍷', `你在 ${nationName} 設宴款待 ${ruler?.name ?? '統治者'}，雙方關係改善 +${gain}。`);
      this._toast(`🍷 宴請成功！與 ${nationName} 的關係 +${gain}`);
      backFn();
    });
  }

  /**
   * Demand (要求) proposal screen.
   * Player leverages military strength to demand a gold tribute from the foreign ruler.
   * On success: player receives gold but the nation's relation drops (resentment).
   * On failure: relation drops; warlike rulers may even declare war.
   *
   * @param {import('../systems/NationSystem.js').Settlement} settlement  Foreign settlement.
   * @param {function} backFn  Callback to navigate back.
   */
  _renderDemandProposal(settlement, backFn) {
    const content = document.getElementById('location-content');
    if (!content || !this.diplomacySystem || !this.nationSystem) return;

    const nationId   = settlement.nationId;
    const nation     = this.nationSystem.nations[nationId];
    const ruler      = settlement.ruler;
    const nationName = nation?.name ?? settlement.name;
    const demandGold = DEMAND_GOLD_BASE + (settlement.economyLevel ?? 1) * DEMAND_GOLD_PER_ECO;

    // Rough success-chance indicator for the player (no guarantees)
    const playerStr      = this._getPlayerStrength();
    const settlementStr  = (settlement.economyLevel ?? 1) * ECONOMY_STRENGTH_MULTIPLIER
                         + Math.floor((settlement.population ?? 0) / POPULATION_STRENGTH_DIVISOR);
    const strengthRatio  = playerStr / (playerStr + settlementStr || 1);
    const chanceLabel    = strengthRatio >= 0.65
      ? '高'
      : strengthRatio >= 0.40
        ? '中'
        : '低';

    const personality = ruler?.traits?.find(t => ALL_PERSONALITIES.includes(t)) ?? '謹慎';
    const atWar       = this.diplomacySystem.isAtWar(_PLAYER_NATION_ID_UI, nationId);

    content.innerHTML = `
      <button class="fac-back-btn" id="diplo-back">← 返回</button>
      <div class="fac-title">⚖ 要求進貢</div>
      <div class="treaty-form">
        <div class="diplo-proposal-intro">
          你以武力威懾，要求 <strong>${ruler?.name ?? '統治者'}</strong>（${nationName}）繳納進貢。<br>
          若對方屈服，你將獲得一筆金幣；若對方拒絕，雙方關係將惡化，好戰的統治者甚至可能宣戰。
        </div>
        <div class="treaty-row">
          <span class="treaty-label">索取金幣</span>
          <span style="color:#ffd54f">🪙${demandGold}</span>
        </div>
        <div class="treaty-row">
          <span class="treaty-label">成功機率</span>
          <span style="color:${chanceLabel === '高' ? '#66bb6a' : chanceLabel === '中' ? '#ffa726' : '#ef6c00'}">
            ${chanceLabel}（你的武力：${playerStr}）
          </span>
        </div>
        <div class="treaty-row">
          <span class="treaty-label">統治者個性</span>
          <span>${personality}</span>
        </div>
        <div class="treaty-note">成功後雙方關係仍會下降（對方心存怨恨）；失敗則關係大幅惡化，好戰型統治者可能立即宣戰。</div>
        <button class="btn-buy treaty-send-btn war-send-btn" id="diplo-demand-confirm">⚖ 提出要求</button>
      </div>
    `;

    document.getElementById('diplo-back')?.addEventListener('click', backFn);

    document.getElementById('diplo-demand-confirm')?.addEventListener('click', () => {
      const accepted = this.diplomacySystem.evaluateDirectDiploProposal(nationId, 'demand', {
        strengthRatio,
      });

      if (accepted) {
        // Ruler complies – player gets gold, relation drops (resentment)
        this._addGold(demandGold);
        const relDelta = -(DEMAND_SUCCESS_REL_BASE + Math.floor(Math.random() * DEMAND_SUCCESS_REL_VARIANCE));
        this.diplomacySystem.modifyPlayerRelation(nationId, relDelta);
        this._refreshGoldDisplay();
        this._addInboxMessage(
          '⚖',
          `${nationName} 屈服於你的要求，繳納了 🪙${demandGold} 進貢，但雙方關係惡化 ${relDelta}。`,
        );
        this._toast(`✅ ${nationName} 繳納了 🪙${demandGold} 進貢！`);
      } else {
        // Ruler refuses – stronger penalty; warlike personality may declare war
        const relDelta = -(DEMAND_FAILURE_REL_BASE + Math.floor(Math.random() * DEMAND_FAILURE_REL_VARIANCE));
        this.diplomacySystem.modifyPlayerRelation(nationId, relDelta);
        this._addInboxMessage(
          '❌',
          `${nationName} 斷然拒絕了進貢要求，雙方關係惡化 ${relDelta}。`,
        );
        // Warlike rulers respond with immediate war declaration
        if ((personality === '好戰' || personality === '傲慢') && !atWar) {
          this.diplomacySystem.declareWar(_PLAYER_NATION_ID_UI, nationId);
          this._addInboxMessage(
            '⚔',
            `${nationName} 的 ${ruler?.name ?? '統治者'} 大怒，宣佈對你開戰！`,
          );
          this._toast(`⚔ ${nationName} 宣戰！`);
        } else {
          this._toast(`❌ ${nationName} 拒絕了你的要求，關係 ${relDelta}。`);
        }
      }
      backFn();
    });
  }

  /**
   * Non-Aggression Pact proposal screen.
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderNapProposal(building, settlement) {
    const content = document.getElementById('location-content');
    if (!content || !this.diplomacySystem || !this.nationSystem) return;

    const nationId   = settlement.nationId;
    const nation     = this.nationSystem.nations[nationId];
    const ruler      = settlement.ruler;
    const nationName = nation?.name ?? settlement.name;

    content.innerHTML = `
      <button class="fac-back-btn" id="diplo-back">← 返回</button>
      <div class="fac-title">☮ 互不侵犯條約</div>
      <div class="treaty-form">
        <div class="diplo-proposal-intro">
          你向 <strong>${ruler?.name ?? '統治者'}</strong>（${nationName}）提出互不侵犯條約。<br>
          雙方同意在條約有效期間內不互相攻伐，違約方將承受關係懲罰。
        </div>
        <div class="treaty-note">統治者將當場回應你的提案。</div>
        <button class="btn-buy treaty-send-btn" id="diplo-nap-confirm">☮ 提出條約</button>
      </div>
    `;

    document.getElementById('diplo-back')?.addEventListener('click', () => {
      this._renderGovBuilding(building, settlement);
    });

    document.getElementById('diplo-nap-confirm')?.addEventListener('click', () => {
      const accepted = this.diplomacySystem.evaluateDirectDiploProposal(nationId, 'nap');
      if (accepted) {
        this.diplomacySystem.signNonAggressionPact(_PLAYER_NATION_ID_UI, nationId);
        this._addInboxMessage('☮', `${nationName} 接受了互不侵犯條約！雙方關係改善 +10。`);
        this._toast(`✅ ${nationName} 接受了互不侵犯條約！`);
      } else {
        const relDelta = -(3 + Math.floor(Math.random() * 5));
        this.diplomacySystem.modifyPlayerRelation(nationId, relDelta);
        this._addInboxMessage('❌', `${nationName} 拒絕了互不侵犯條約，關係 ${relDelta}。`);
        this._toast(`❌ ${nationName} 拒絕了提案。`);
      }
      this._renderGovBuilding(building, settlement);
    });
  }

  /**
   * Joint War Declaration proposal screen.
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderJointWarProposal(building, settlement) {
    const content = document.getElementById('location-content');
    if (!content || !this.diplomacySystem || !this.nationSystem) return;

    const nationId   = settlement.nationId;
    const nation     = this.nationSystem.nations[nationId];
    const ruler      = settlement.ruler;
    const nationName = nation?.name ?? settlement.name;

    // Build target list: nations the NPC is hostile toward (relation ≤ threshold)
    const targets = this.nationSystem.nations.filter((n, tid) =>
      n && tid !== nationId && tid >= 0 && !this.nationSystem.isNationExtinct(tid) &&
      this.diplomacySystem.getRelation(nationId, tid) <= _JOINT_WAR_HOSTILITY_THRESHOLD,
    ).map(n => `<option value="${n.id}">${n.name}（我方與之關係 ${this.diplomacySystem.getRelation(nationId, n.id)}）</option>`).join('');

    content.innerHTML = `
      <button class="fac-back-btn" id="diplo-back">← 返回</button>
      <div class="fac-title">⚔ 合意宣戰第三國</div>
      <div class="treaty-form">
        <div class="diplo-proposal-intro">
          你向 <strong>${ruler?.name ?? '統治者'}</strong>（${nationName}）提議聯合向共同敵人宣戰。<br>
          若對方接受，雙方將同時向目標國宣戰，且同盟關係將加深。
        </div>
        <div class="treaty-row">
          <label class="treaty-label">目標國家</label>
          <select id="joint-war-target-select" class="treaty-select">${targets}</select>
        </div>
        <div class="treaty-note">統治者將評估目標是否符合其戰略利益後當場回應。</div>
        <button class="btn-buy treaty-send-btn war-send-btn" id="diplo-joint-war-confirm">⚔ 提出聯合宣戰</button>
      </div>
    `;

    document.getElementById('diplo-back')?.addEventListener('click', () => {
      this._renderGovBuilding(building, settlement);
    });

    document.getElementById('diplo-joint-war-confirm')?.addEventListener('click', () => {
      const targetId = Number(document.getElementById('joint-war-target-select')?.value ?? -1);
      if (targetId < 0) { this._toast('請選擇目標國家'); return; }

      const targetNation = this.nationSystem.nations[targetId];
      const accepted = this.diplomacySystem.evaluateDirectDiploProposal(nationId, 'joint_war', { targetNationId: targetId });
      if (accepted) {
        const { messages } = this.diplomacySystem.applyJointWarDeclaration(nationId, targetId);
        messages.forEach(msg => this._addInboxMessage('⚔', msg));
        this._toast(`✅ ${nationName} 同意聯合對 ${targetNation?.name ?? '目標國'} 宣戰！`);
      } else {
        const relDelta = -(2 + Math.floor(Math.random() * 4));
        this.diplomacySystem.modifyPlayerRelation(nationId, relDelta);
        this._addInboxMessage('❌', `${nationName} 拒絕了聯合宣戰提案，關係 ${relDelta}。`);
        this._toast(`❌ ${nationName} 拒絕了提案。`);
      }
      this._renderGovBuilding(building, settlement);
    });
  }

  /**
   * Mutual Protection Pact proposal screen.
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderMutualProtectionProposal(building, settlement) {
    const content = document.getElementById('location-content');
    if (!content || !this.diplomacySystem || !this.nationSystem) return;

    const nationId   = settlement.nationId;
    const nation     = this.nationSystem.nations[nationId];
    const ruler      = settlement.ruler;
    const nationName = nation?.name ?? settlement.name;

    content.innerHTML = `
      <button class="fac-back-btn" id="diplo-back">← 返回</button>
      <div class="fac-title">🛡 互保條約</div>
      <div class="treaty-form">
        <div class="diplo-proposal-intro">
          你向 <strong>${ruler?.name ?? '統治者'}</strong>（${nationName}）提出互保條約。<br>
          雙方同意：若任一方遭受攻擊，另一方將自動向攻擊者宣戰。<br>
          這是最深層的軍事同盟，違約代價極重（關係 -30）。
        </div>
        <div class="treaty-note">統治者將評估是否信任你後當場回應。</div>
        <button class="btn-buy treaty-send-btn" id="diplo-mpt-confirm">🛡 提出互保條約</button>
      </div>
    `;

    document.getElementById('diplo-back')?.addEventListener('click', () => {
      this._renderGovBuilding(building, settlement);
    });

    document.getElementById('diplo-mpt-confirm')?.addEventListener('click', () => {
      const accepted = this.diplomacySystem.evaluateDirectDiploProposal(nationId, 'mutual_protection');
      if (accepted) {
        this.diplomacySystem.signMutualProtectionPact(_PLAYER_NATION_ID_UI, nationId);
        this._addInboxMessage('🛡', `${nationName} 接受了互保條約！雙方關係改善 +20。`);
        this._toast(`✅ ${nationName} 接受了互保條約！`);
      } else {
        const relDelta = -(3 + Math.floor(Math.random() * 5));
        this.diplomacySystem.modifyPlayerRelation(nationId, relDelta);
        this._addInboxMessage('❌', `${nationName} 拒絕了互保條約，關係 ${relDelta}。`);
        this._toast(`❌ ${nationName} 拒絕了提案。`);
      }
      this._renderGovBuilding(building, settlement);
    });
  }

  /**
   * Foreign trade route proposal screen.
   * Shown when the player asks a foreign government to open a trade route.
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement  Foreign settlement.
   */
  _renderForeignTradeProposal(building, settlement) {
    const content = document.getElementById('location-content');
    if (!content || !this.diplomacySystem || !this.nationSystem) return;

    const nationId   = settlement.nationId;
    const nation     = this.nationSystem.nations[nationId];
    const ruler      = settlement.ruler;
    const nationName = nation?.name ?? settlement.name;
    const relVal     = this.diplomacySystem.getPlayerRelation(nationId);
    const relStr     = relVal >= 0 ? `+${relVal}` : `${relVal}`;

    const settlKey      = this._settlementKey(settlement);
    const foreignDemand = settlKey ? this._getSettlementDemand(settlKey, settlement) : null;

    // Check if player can supply the foreign nation's demanded resource.
    const playerCanSupply = foreignDemand
      ? [...this._capturedSettlements].some(pk => {
          const ps = this._getSettlementByKey(pk);
          return ps && (ps.resources ?? []).includes(foreignDemand);
        })
      : false;

    const resources  = (settlement.resources ?? []).join('、') || '無';
    const foreignResSet = new Set(settlement.resources ?? []);
    const economyStr = '⭐'.repeat(Math.max(1, settlement.economyLevel ?? 1));
    const dailyGold  = Math.max(1, (settlement.economyLevel ?? 1) * TRADE_INCOME_PER_ECONOMY_LEVEL);

    // Build "my settlement demands" block so the player can see which of their
    // regions would benefit from this trade route.
    const myDemandsHTML = (() => {
      if (this._capturedSettlements.size === 0) return '';
      const rows = [...this._capturedSettlements].map(pk => {
        const ps = this._getSettlementByKey(pk);
        if (!ps) return '';
        const demand  = this._getSettlementDemand(pk, ps);
        const already = this._isSettlementDemandMet(pk, ps);
        const canFill = foreignResSet.has(demand);
        let statusIcon, statusColor;
        if (already) {
          statusIcon  = '✅';
          statusColor = 'rgba(255,255,255,0.35)';
        } else if (canFill) {
          statusIcon  = '💡';
          statusColor = '#66bb6a';
        } else {
          statusIcon  = '⚠';
          statusColor = '#ef6c00';
        }
        return `
          <div class="trade-my-demand-row">
            <span class="trade-my-demand-name">${ps.name}</span>
            <span class="trade-my-demand-res" style="color:${statusColor}">
              ${statusIcon} 需求：${demand}${canFill && !already ? '（此商路可供應）' : (already ? '（已滿足）' : '')}
            </span>
          </div>`;
      }).filter(Boolean).join('');
      if (!rows) return '';
      return `
        <div class="trade-my-demands-block">
          <div class="trade-my-demands-title">📋 我的地區需求</div>
          ${rows}
        </div>`;
    })();

    content.innerHTML = `
      <button class="fac-back-btn" id="diplo-back">← 返回</button>
      <div class="fac-title">🛤 提議貿易路線</div>
      <div class="treaty-form">
        <div class="diplo-proposal-intro">
          你向 <strong>${ruler?.name ?? '統治者'}</strong>（${nationName}）提議建立貿易路線。<br>
          若對方同意，${nationName} 的商隊將前往你最近的城市通商，你可從中獲取物資與收益。
        </div>
        <div class="treaty-row">
          <span class="treaty-label">對方出口資源</span>
          <span>${resources}</span>
        </div>
        <div class="treaty-row">
          <span class="treaty-label">對方經濟水平</span>
          <span>${economyStr}</span>
        </div>
        <div class="treaty-row">
          <span class="treaty-label">預計每日收益</span>
          <span>+${dailyGold} 🪙</span>
        </div>
        ${foreignDemand ? `
        <div class="treaty-row">
          <span class="treaty-label">對方目前需求</span>
          <span style="color:${playerCanSupply ? '#66bb6a' : '#ef6c00'}">
            ${foreignDemand} ${playerCanSupply ? '（你可供應 +成功率）' : '（你無法供應）'}
          </span>
        </div>` : ''}
        ${myDemandsHTML}
        <div class="treaty-note">統治者將根據雙方關係（${relStr}）${playerCanSupply ? '及你能供應其需求，' : ''}評估是否同意。</div>
        <button class="btn-buy treaty-send-btn" id="diplo-trade-confirm">🛤 提出貿易請求</button>
      </div>
    `;

    document.getElementById('diplo-back')?.addEventListener('click', () => {
      this._renderGovBuilding(building, settlement);
    });

    document.getElementById('diplo-trade-confirm')?.addEventListener('click', () => {
      const accepted = this.diplomacySystem.evaluateDirectDiploProposal(nationId, 'trade_route', {
        demandMet: playerCanSupply,
      });
      if (accepted) {
        // Check player has at least one settlement before showing picker
        if (this._capturedSettlements.size === 0) {
          this._addInboxMessage('🛤', `${nationName} 同意了，但你尚未佔領任何城市，無法接待商隊。`);
          this._toast('❌ 你尚未佔領任何城市，商隊無法前往！');
          this._renderGovBuilding(building, settlement);
          return;
        }
        // Let the player choose which settlement will receive the import route
        this._renderImportTradeDestPicker(building, settlement, nationId, nationName, resources, dailyGold);
      } else {
        const relDelta = -(1 + Math.floor(Math.random() * 3));
        this.diplomacySystem.modifyPlayerRelation(nationId, relDelta);
        this._addInboxMessage('❌', `${nationName} 拒絕了貿易路線提案，關係 ${relDelta}。`);
        this._toast(`❌ ${nationName} 拒絕了提案。`);
        this._renderGovBuilding(building, settlement);
      }
    });
  }

  /**
   * Show a picker so the player can choose which of their settlements will
   * receive the accepted import trade route from a foreign nation.
   *
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} foreignSettlement  The foreign origin.
   * @param {number} nationId
   * @param {string} nationName
   * @param {string} resources  Formatted resource string for the message.
   * @param {number} dailyGold
   */
  _renderImportTradeDestPicker(building, foreignSettlement, nationId, nationName, resources, dailyGold) {
    const content = document.getElementById('location-content');
    if (!content) return;

    // Build list of player-owned settlements that don't already have an import route from this foreign settlement
    const fromKey = this._settlementKey(foreignSettlement);
    const playerSettlements = [];
    const addArr = (arr, mapArr, typeLabel) => {
      arr.forEach((s, i) => {
        const key = `${typeLabel}:${i}`;
        if (!this._capturedSettlements.has(key)) return;
        const alreadyRouted = fromKey
          ? [...this._tradeRoutes.values()].some(r => r.fromKey === fromKey && r.toKey === key && r.isImport)
          : false;
        let dist = null;
        if (this._mapData && fromKey) {
          const srcIdx = foreignSettlement.type === 'castle'
            ? this.nationSystem.castleSettlements.indexOf(foreignSettlement)
            : this.nationSystem.villageSettlements.indexOf(foreignSettlement);
          const srcTile = foreignSettlement.type === 'castle'
            ? this._mapData.castles[srcIdx]
            : this._mapData.villages[srcIdx];
          const tile = mapArr[i];
          if (srcTile && tile) {
            const dx = tile.x - srcTile.x;
            const dy = tile.y - srcTile.y;
            dist = Math.round(Math.sqrt(dx * dx + dy * dy));
          }
        }
        playerSettlements.push({ s, key, dist, alreadyRouted });
      });
    };
    addArr(this.nationSystem.castleSettlements, this._mapData?.castles ?? [], 'castle');
    addArr(this.nationSystem.villageSettlements, this._mapData?.villages ?? [], 'village');
    playerSettlements.sort((a, b) => (a.dist ?? 9999) - (b.dist ?? 9999));

    const foreignResSet = new Set(foreignSettlement.resources ?? []);

    const rowsHTML = playerSettlements.map(({ s, key, dist, alreadyRouted }) => {
      const demand   = this._getSettlementDemand(key, s);
      const already  = this._isSettlementDemandMet(key, s);
      const canFill  = foreignResSet.has(demand);
      let demandNote = '', demandColor = 'rgba(255,255,255,0.4)';
      if (alreadyRouted) {
        demandNote  = '';
      } else if (already) {
        demandNote  = `需求：${demand}（已滿足）`;
        demandColor = 'rgba(255,255,255,0.35)';
      } else if (canFill) {
        demandNote  = `💡 需求：${demand}（此商路可供應）`;
        demandColor = '#66bb6a';
      } else {
        demandNote  = `⚠ 需求：${demand}`;
        demandColor = '#ef6c00';
      }
      return `
      <div class="tr-cand-row${alreadyRouted ? ' tr-cand-locked' : ''}">
        <div class="tr-cand-info">
          <span class="tr-cand-name">${s.name}</span>
          <span class="tr-cand-detail">
            ${dist != null ? `距離：${dist}` : ''}
            ${demandNote ? `&nbsp;&nbsp;<span style="color:${demandColor}">${demandNote}</span>` : ''}
          </span>
        </div>
        <button class="tr-cand-btn${alreadyRouted ? ' connected' : ''}"
                data-dest-key="${key}"
                ${alreadyRouted ? 'disabled' : ''}>
          ${alreadyRouted ? '已接收' : '選擇此地'}
        </button>
      </div>`;
    }).join('');

    content.innerHTML = `
      <button class="fac-back-btn" id="itdp-back">← 返回</button>
      <div class="fac-title">🛤 選擇接收地區</div>
      <div class="treaty-form">
        <div class="diplo-proposal-intro">
          ${nationName} 同意建立貿易路線！請選擇哪個地區接收此進口商路。<br>
          商隊將帶來：${resources || '各類物資'}，每日 +${dailyGold} 🪙。
        </div>
        <div class="tr-candidates">${rowsHTML || '<div class="tr-empty">無可用地區</div>'}</div>
      </div>
    `;

    document.getElementById('itdp-back')?.addEventListener('click', () => {
      this._renderGovBuilding(building, foreignSettlement);
    });

    content.querySelectorAll('.tr-cand-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const destKey = btn.dataset.destKey;
        const destSett = this._getSettlementByKey(destKey);
        if (!destSett) return;
        const ok = this._establishImportTrade(foreignSettlement, destSett);
        if (ok) {
          this.diplomacySystem.modifyPlayerRelation(nationId, 5);
          this._addInboxMessage('🛤', `${nationName} 同意建立進口貿易路線！商隊將前往 ${destSett.name}，每日 +${dailyGold} 🪙，帶來：${resources || '各類物資'}。關係 +5。`);
          this._toast(`✅ ${nationName} 同意建立貿易路線！`);
        } else {
          this._addInboxMessage('❌', `無法建立進口貿易路線。`);
          this._toast('❌ 建立進口路線失敗。');
        }
        this._renderGovBuilding(building, foreignSettlement);
      });
    });
  }

  /**
   * Establish an import trade route from a foreign settlement to a
   * player-owned settlement.
   *
   * @param {import('../systems/NationSystem.js').Settlement} fromSettlement  Foreign settlement.
   * @param {import('../systems/NationSystem.js').Settlement} [toSettlement]  Explicit player
   *   destination. When omitted the nearest player-controlled settlement is used (legacy fallback
   *   used by NPC-initiated missives).
   * @returns {boolean}  true if the route was created (or already exists).
   */
  _establishImportTrade(fromSettlement, toSettlement = null) {
    if (!this.nationSystem || !this._mapData) return false;

    const fromKey = this._settlementKey(fromSettlement);
    if (!fromKey) return false;

    // If an explicit destination was provided, use it directly.
    if (toSettlement) {
      const toKey = this._settlementKey(toSettlement);
      if (!toKey) return false;
      // If a route for this exact pair already exists, treat as success.
      const routeId = `${fromKey}→${toKey}`;
      if (this._tradeRoutes.has(routeId)) return true;
      const resources = [...(fromSettlement.resources ?? [])];
      const dailyGold = Math.max(1, (fromSettlement.economyLevel ?? 1) * TRADE_INCOME_PER_ECONOMY_LEVEL);
      this._tradeRoutes.set(routeId, {
        fromKey,
        fromName: fromSettlement.name,
        toKey,
        toName:   toSettlement.name,
        resources,
        dailyGold,
        isImport: true,
      });
      return true;
    }

    // Legacy path: find nearest player-controlled settlement.

    // If an import route from this settlement already exists, treat as success.
    if ([...this._tradeRoutes.values()].some(r => r.fromKey === fromKey && r.isImport)) return true;

    const isCastleSrc = fromSettlement.type === 'castle';
    const srcIdx      = (isCastleSrc ? this.nationSystem.castleSettlements : this.nationSystem.villageSettlements).indexOf(fromSettlement);
    const srcTile     = srcIdx >= 0 ? (isCastleSrc ? this._mapData.castles : this._mapData.villages)[srcIdx] : null;

    let nearestSett = null;
    let minDist = Infinity;

    const _check = (arr, mapArr, typeLabel) => {
      arr.forEach((ps, i) => {
        if (!this._capturedSettlements.has(`${typeLabel}:${i}`)) return;
        const tile = mapArr[i];
        if (!tile || !srcTile) return;
        const dx = tile.x - srcTile.x;
        const dy = tile.y - srcTile.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < minDist) { minDist = d; nearestSett = ps; }
      });
    };
    _check(this.nationSystem.castleSettlements, this._mapData.castles, 'castle');
    _check(this.nationSystem.villageSettlements, this._mapData.villages, 'village');

    if (!nearestSett) return false;

    const toKey = this._settlementKey(nearestSett);
    if (!toKey) return false;

    const routeId   = `${fromKey}→${toKey}`;
    const resources = [...(fromSettlement.resources ?? [])];
    const dailyGold = Math.max(1, (fromSettlement.economyLevel ?? 1) * TRADE_INCOME_PER_ECONOMY_LEVEL);

    this._tradeRoutes.set(routeId, {
      fromKey,
      fromName: fromSettlement.name,
      toKey,
      toName:   nearestSett.name,
      resources,
      dailyGold,
      isImport: true,
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // Connecting Road diplomatic proposal
  // -------------------------------------------------------------------------

  /**
   * Render the connecting road proposal screen.
   * The player pays a token fee (CONNECT_ROAD_PROPOSAL_COST) to propose
   * building a road between their nearest settlement and the foreign nation's
   * settlement.  If the NPC accepts, the road construction is started
   * automatically and the relation improves.
   *
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement  Foreign settlement.
   */
  _renderConnectingRoadProposal(building, settlement) {
    const content = document.getElementById('location-content');
    if (!content || !this.diplomacySystem || !this.nationSystem) return;

    const nationId   = settlement.nationId;
    const nation     = this.nationSystem.nations[nationId];
    const ruler      = settlement.ruler;
    const nationName = nation?.name ?? settlement.name;
    const relVal     = this.diplomacySystem.getPlayerRelation(nationId);
    const relStr     = relVal >= 0 ? `+${relVal}` : `${relVal}`;
    const gold       = this._getGold();

    // Find the player-owned settlement closest to the foreign settlement.
    const foreignSett = settlement;
    const foreignIdx  = foreignSett.type === 'castle'
      ? this.nationSystem.castleSettlements.indexOf(foreignSett)
      : this.nationSystem.villageSettlements.indexOf(foreignSett);
    const foreignTile = foreignSett.type === 'castle'
      ? this._mapData?.castles[foreignIdx]
      : this._mapData?.villages[foreignIdx];

    let nearestPlayerSett = null, nearestDist = Infinity;
    if (this.nationSystem && this._mapData) {
      const check = (arr, mapArr, typeLabel) => {
        arr.forEach((s, i) => {
          if (!this._capturedSettlements.has(`${typeLabel}:${i}`)) return;
          const tile = mapArr[i];
          if (!tile || !foreignTile) return;
          const d = Math.sqrt((tile.x - foreignTile.x) ** 2 + (tile.y - foreignTile.y) ** 2);
          if (d < nearestDist) { nearestDist = d; nearestPlayerSett = s; }
        });
      };
      check(this.nationSystem.castleSettlements, this._mapData.castles, 'castle');
      check(this.nationSystem.villageSettlements, this._mapData.villages, 'village');
    }

    // Compute road path for preview
    let roadPreviewHTML = '';
    let roadResult = null;
    if (nearestPlayerSett && this._mapData) {
      roadResult = this._computeRoadPath(nearestPlayerSett, foreignSett);
      if (roadResult.path) {
        roadPreviewHTML = `
          <div class="treaty-row">
            <span class="treaty-label">路程</span>
            <span>${roadResult.path.length} 格</span>
          </div>
          <div class="treaty-row">
            <span class="treaty-label">預計工時</span>
            <span>${roadResult.totalHours} 小時</span>
          </div>
          <div class="treaty-row">
            <span class="treaty-label">建造費用</span>
            <span>🪙${roadResult.totalCost + CONNECT_ROAD_PROPOSAL_COST}（含提案費 ${CONNECT_ROAD_PROPOSAL_COST}）</span>
          </div>`;
      } else if (roadResult.blockedByRiver) {
        roadPreviewHTML = '<div class="treaty-note" style="color:#ef5350">🌊 被河流阻擋，需先建橋才能連通。</div>';
      } else {
        roadPreviewHTML = '<div class="treaty-note" style="color:#ef5350">⛰️ 無可行路線（山地阻擋）。</div>';
      }
    }

    const totalCost = CONNECT_ROAD_PROPOSAL_COST + (roadResult?.totalCost ?? 0);
    const canConfirm = nearestPlayerSett && roadResult?.path && gold >= totalCost;

    content.innerHTML = `
      <button class="fac-back-btn" id="diplo-back">← 返回</button>
      <div class="fac-title">🛣️ 提議建立連結道路</div>
      <div class="treaty-form">
        <div class="diplo-proposal-intro">
          向 <strong>${ruler?.name ?? '統治者'}</strong>（${nationName}）提議在雙方地區之間修建連結道路。<br>
          道路有助於商貿往來，可加深兩國友誼。
        </div>
        <div class="treaty-row">
          <span class="treaty-label">目前關係</span>
          <span>${relStr}</span>
        </div>
        <div class="treaty-row">
          <span class="treaty-label">接受後關係</span>
          <span style="color:#66bb6a">+${CONNECT_ROAD_RELATION_GAIN}（建成後）</span>
        </div>
        <div class="treaty-row">
          <span class="treaty-label">連接地區</span>
          <span>${nearestPlayerSett ? nearestPlayerSett.name : '（尚無可用地區）'} ↔ ${settlement.name}</span>
        </div>
        ${roadPreviewHTML}
        <div class="treaty-note">若對方同意，道路建設將立即啟動，建成後雙方關係改善 +${CONNECT_ROAD_RELATION_GAIN}。<br>
          統治者的性格與雙方關係將影響接受意願。</div>
        <button class="btn-buy treaty-send-btn${canConfirm ? '' : ' disabled'}" id="diplo-road-confirm"
          ${canConfirm ? '' : 'disabled'}>
          🛣️ 提交提案（花費 🪙${totalCost}）
        </button>
        ${!nearestPlayerSett ? '<div class="treaty-note" style="color:#ef9a9a">⚠ 你尚未佔領任何地區。</div>' : ''}
        ${nearestPlayerSett && !roadResult?.path ? '' : ''}
        ${gold < totalCost && canConfirm === false && nearestPlayerSett && roadResult?.path ? `<div class="treaty-note" style="color:#ef9a9a">⚠ 金幣不足（需 🪙${totalCost}，持有 🪙${gold}）。</div>` : ''}
      </div>
    `;

    document.getElementById('diplo-back')?.addEventListener('click', () => {
      this._renderGovBuilding(building, settlement);
    });

    document.getElementById('diplo-road-confirm')?.addEventListener('click', () => {
      if (!nearestPlayerSett || !roadResult?.path) return;
      if (this._getGold() < totalCost) { this._toast('💸 金幣不足！'); return; }

      // Evaluate NPC acceptance
      const accepted = this.diplomacySystem.evaluateDirectDiploProposal(nationId, 'connect_road', {});
      if (!accepted) {
        const relDelta = -(1 + Math.floor(Math.random() * 3));
        this.diplomacySystem.modifyPlayerRelation(nationId, relDelta);
        this._addInboxMessage('❌', `${nationName} 拒絕了連結道路提案，關係 ${relDelta}。`);
        this._toast(`❌ ${nationName} 拒絕了提案。`);
        this._renderGovBuilding(building, settlement);
        return;
      }

      // Deduct cost
      this._spendGold(totalCost);

      // Start road construction
      const fromKey = this._settlementKey(nearestPlayerSett);
      const toKey   = this._settlementKey(foreignSett);
      const rk      = this._roadKey(fromKey, toKey);
      const tiles   = roadResult.path.length;

      const fromState = this._getConstructionState(fromKey);
      const toState   = this._getConstructionState(toKey);

      // Only start if not already built or in progress
      if (!fromState.builtRoads.has(rk) && !fromState.roads.has(rk)) {
        fromState.roads.set(rk, {
          targetKey:  toKey,
          targetName: foreignSett.name,
          tilesTotal: tiles,
          totalHours: roadResult.totalHours,
          hoursLeft:  roadResult.totalHours,
          isDemo:     false,
          path:       roadResult.path,
          // Flag so completion can grant the relation bonus
          connectRoadNationId: nationId,
          connectRoadRelBonus: CONNECT_ROAD_RELATION_GAIN,
        });
        toState.roads.set(rk, {
          targetKey:  fromKey,
          targetName: nearestPlayerSett.name,
          tilesTotal: tiles,
          totalHours: roadResult.totalHours,
          hoursLeft:  roadResult.totalHours,
          isDemo:     false,
          path:       roadResult.path,
        });
      }

      this.diplomacySystem._addMemoryEntry(nationId,
        `與玩家合作修建連結道路，關係 +${CONNECT_ROAD_RELATION_GAIN}（建成後）`, CONNECT_ROAD_RELATION_GAIN);
      this._addInboxMessage('🛣️', `${nationName} 同意了！開始修建 ${nearestPlayerSett.name} ↔ ${foreignSett.name} 的連結道路（${tiles} 格），建成後關係 +${CONNECT_ROAD_RELATION_GAIN}。`);
      this._toast(`✅ ${nationName} 同意建立連結道路！`);
      this._renderGovBuilding(building, settlement);
    });
  }

  // -------------------------------------------------------------------------
  // Construction system – helpers
  // -------------------------------------------------------------------------

  /**
   * Return (or create) the construction state object for a settlement.
   * @param {string} key  Settlement key, e.g. "castle:0"
   * @returns {{ buildingQueue: object[], roads: Map<string,object>, builtRoads: Map<string,{tiles:{tx:number,ty:number}[]}> }}
   */
  _getConstructionState(key) {
    if (!this._constructionState.has(key)) {
      this._constructionState.set(key, {
        buildingQueue: [],
        roads:         new Map(),
        builtRoads:    new Map(),
      });
    }
    return this._constructionState.get(key);
  }

  /**
   * Check whether a settlement is on the coast (has a SAND tile adjacent to WATER
   * within a short radius of its footprint).
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @returns {{ coastal: boolean, tile: { tx: number, ty: number }|null }}
   */
  _isCoastalSettlement(settlement) {
    if (!this._mapData || !this.nationSystem) return { coastal: false, tile: null };
    const isCastle = settlement.type === 'castle';
    const arr    = isCastle ? this.nationSystem.castleSettlements : this.nationSystem.villageSettlements;
    const mapArr = isCastle ? this._mapData.castles             : this._mapData.villages;
    const idx    = arr.indexOf(settlement);
    if (idx < 0) return { coastal: false, tile: null };
    const { x: sx, y: sy } = mapArr[idx];
    const size = isCastle ? 4 : 2;
    // Number of tiles to scan beyond the settlement footprint in each direction.
    const COASTAL_SCAN_BORDER = 2;

    // Scan a 2-tile border around the settlement for SAND tiles adjacent to WATER.
    for (let dy = -COASTAL_SCAN_BORDER; dy <= size + COASTAL_SCAN_BORDER - 1; dy++) {
      for (let dx = -COASTAL_SCAN_BORDER; dx <= size + COASTAL_SCAN_BORDER - 1; dx++) {
        const tx = sx + dx;
        const ty = sy + dy;
        if (this._mapData.getTerrain(tx, ty) === TERRAIN.SAND) {
          for (const [ndx, ndy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            if (this._mapData.getTerrain(tx + ndx, ty + ndy) === TERRAIN.WATER) {
              return { coastal: true, tile: { tx: tx + ndx, ty: ty + ndy } };
            }
          }
        }
      }
    }
    return { coastal: false, tile: null };
  }

  /**
   * Return the tile-centre position of a settlement.
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @returns {{ tx: number, ty: number }}
   */
  _getSettlementCenter(settlement) {
    if (!this.nationSystem) return { tx: 0, ty: 0 };
    const isCastle = settlement.type === 'castle';
    const arr    = isCastle ? this.nationSystem.castleSettlements : this.nationSystem.villageSettlements;
    const mapArr = isCastle ? (this._mapData?.castles ?? [])      : (this._mapData?.villages ?? []);
    const idx    = arr.indexOf(settlement);
    if (idx < 0) return { tx: 0, ty: 0 };
    const { x, y } = mapArr[idx];
    const half = isCastle ? 2 : 1;
    return { tx: x + half, ty: y + half };
  }

  /**
   * Calculate the road tile distance between two settlements (Manhattan tiles).
   * @param {import('../systems/NationSystem.js').Settlement} from
   * @param {import('../systems/NationSystem.js').Settlement} to
   * @returns {number}
   */
  _getRoadTiles(from, to) {
    const a = this._getSettlementCenter(from);
    const b = this._getSettlementCenter(to);
    return Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty);
  }

  /**
   * Return the tile paths for all built roads, deduplicated by road key.
   * Used by `RoadRenderer` to draw the road overlay on the world map.
   * @returns {{ tx: number, ty: number }[][]}
   */
  getBuiltRoadTilePaths() {
    const result = [];
    const seen   = new Set();
    for (const state of this._constructionState.values()) {
      for (const [rk, data] of state.builtRoads) {
        if (!seen.has(rk) && data.tiles && data.tiles.length > 1) {
          seen.add(rk);
          result.push(data.tiles);
        }
      }
    }
    return result;
  }

  /**
   * Return a Set of `"tx,ty"` strings for every tile that belongs to a built
   * road.  Used by Player to check whether it is standing on a road tile
   * (and apply the speed bonus).
   * @returns {Set<string>}
   */
  getBuiltRoadTileSet() {
    const set = new Set();
    for (const state of this._constructionState.values()) {
      for (const data of state.builtRoads.values()) {
        for (const { tx, ty } of (data.tiles ?? [])) {
          set.add(`${tx},${ty}`);
        }
      }
    }
    return set;
  }

  // -------------------------------------------------------------------------
  // Map buildings – helpers
  // -------------------------------------------------------------------------

  /**
   * Return a Set of `"tx,ty"` strings for every bridge tile.
   * Used by `_computeRoadPath` to treat bridges as passable land.
   * @returns {Set<string>}
   */
  getBridgeTileSet() {
    const set = new Set();
    for (const b of this._mapBuildings) {
      if (b.type === 'bridge') set.add(`${b.tx},${b.ty}`);
    }
    return set;
  }

  /**
   * Return a shallow copy of all player-placed map buildings.
   * Used by `MapBuildingRenderer` to rebuild its graphics.
   * @returns {{ id: number, type: string, tx: number, ty: number, phaseTick: number }[]}
   */
  getMapBuildings() {
    return this._mapBuildings.map(b => ({ ...b }));
  }

  /**
   * Return the player's current territory as plain arrays, safe to iterate
   * without exposing the internal Set instances.
   * @returns {{ captured: string[], liberated: string[] }}
   */
  getTerritoryState() {
    return {
      captured:  [...this._capturedSettlements],
      liberated: [...this._liberatedSettlements],
    };
  }

  /**
   * Returns true if any player-placed building of `bldgType` exists within
   * `distance` Chebyshev tiles of (tx, ty).
   * @param {number} tx
   * @param {number} ty
   * @param {string} bldgType
   * @param {number} [distance=3]
   * @returns {boolean}
   */
  _hasNearbyBuilding(tx, ty, bldgType, distance = 3) {
    return this._mapBuildings.some(
      b => b.type === bldgType &&
           Math.max(Math.abs(b.tx - tx), Math.abs(b.ty - ty)) <= distance,
    );
  }

  /**
   * Returns true if at least one player-owned settlement is within
   * `MAP_BLDG_WORKER_REACH` Manhattan tiles of (tx, ty).
   * @param {number} tx
   * @param {number} ty
   * @returns {boolean}
   */
  _hasPlayerCityInRange(tx, ty) {
    if (!this.nationSystem) return false;
    const inRange = (arr) => arr.some(s => {
      if (s.controllingNationId !== PLAYER_NATION_ID) return false;
      const center = this._getSettlementCenter(s);
      return Math.abs(center.tx - tx) + Math.abs(center.ty - ty) <= MAP_BLDG_WORKER_REACH;
    });
    return inRange(this.nationSystem.castleSettlements) ||
           inRange(this.nationSystem.villageSettlements);
  }

  /**
   * Update the nearby-buildable-terrain state and show/hide the map-build button.
   * @param {number|null} tx
   * @param {number|null} ty
   * @param {number|null} terrainType
   */
  setNearbyBuildableTerrain(tx, ty, terrainType) {
    const btn     = document.getElementById('map-build-btn');
    const infoBtn = document.getElementById('map-bldg-info-btn');
    const wrap    = document.getElementById('facility-action-wrap');
    if (!btn) return;

    const MAP_BUILD_LABELS = {
      [TERRAIN.FOREST]:   '🪵 建造伐木場',
      [TERRAIN.MOUNTAIN]: '⛏️ 建造採礦場',
      [TERRAIN.WATER]:    '🌉 建造橋樑',
    };

    const MAP_BLDG_TYPE_FOR_TERRAIN = {
      [TERRAIN.FOREST]:   'lumberCamp',
      [TERRAIN.MOUNTAIN]: 'mine',
    };

    const label = terrainType != null ? MAP_BUILD_LABELS[terrainType] : null;

    // Hide info button by default; will be shown when existing building detected.
    this._nearbyMapBuilding = null;
    if (infoBtn) infoBtn.classList.remove('visible');

    if (!label || tx == null) {
      this._nearbyBuildableTile = null;
      btn.disabled = false;
      btn.classList.remove('visible');
      // Update wrap visibility to settlement-only
      if (wrap) wrap.classList.toggle('visible', this._nearbySettlement !== null);
      return;
    }

    // If a building already exists on this tile, show an info button instead
    // (except for bridges, which don't need an info panel).
    const existing = this._mapBuildings.find(b => b.tx === tx && b.ty === ty);
    if (existing) {
      this._nearbyBuildableTile = null;
      if (existing.type === 'bridge') {
        // Bridge already built here – just hide all buttons.
        this._nearbyMapBuilding = null;
        btn.disabled = false;
        btn.classList.remove('visible');
        if (infoBtn) infoBtn.classList.remove('visible');
        if (wrap) wrap.classList.toggle('visible', this._nearbySettlement !== null);
      } else {
        this._nearbyMapBuilding = existing;
        btn.disabled = false;
        btn.classList.remove('visible');
        if (infoBtn) infoBtn.classList.add('visible');
        if (wrap) wrap.classList.add('visible');
      }
      return;
    }

    // Check if a same-type building is within 3 tiles.
    const bldgTypeCheck = MAP_BLDG_TYPE_FOR_TERRAIN[terrainType];
    const tooClose = bldgTypeCheck != null && this._hasNearbyBuilding(tx, ty, bldgTypeCheck);

    // For resource buildings (lumber camp / mine), also require a player city within reach.
    const needsCityCheck = terrainType === TERRAIN.FOREST || terrainType === TERRAIN.MOUNTAIN;
    const noCityInRange  = needsCityCheck && !this._hasPlayerCityInRange(tx, ty);

    this._nearbyBuildableTile = { tx, ty, terrainType };
    if (tooClose) {
      btn.textContent = terrainType === TERRAIN.FOREST ? '🪵 附近已有伐木場' : '⛏️ 附近已有採礦場';
    } else if (noCityInRange) {
      btn.textContent = terrainType === TERRAIN.FOREST ? '🪵 超出城市接收範圍' : '⛏️ 超出城市接收範圍';
    } else {
      btn.textContent = label;
    }
    btn.disabled = tooClose || noCityInRange;
    btn.classList.add('visible');
    // Ensure the wrap is visible
    if (wrap) wrap.classList.add('visible');
  }

  /**
   * Open the map-build dialog for the given tile and terrain type.
   * @param {number} tx  Tile X
   * @param {number} ty  Tile Y
   * @param {number} terrainType  TERRAIN enum value
   */
  _openMapBuildPanel(tx, ty, terrainType) {
    const overlay = document.getElementById('map-build-overlay');
    if (!overlay) return;

    const BLDG_INFO = {
      [TERRAIN.FOREST]:   {
        type: 'lumberCamp',
        icon: '🪵',
        name: '伐木場',
        cost: MAP_BLDG_LUMBER_CAMP_COST,
        goldPerWorker: MAP_BLDG_LUMBER_GOLD,
        desc: '在森林中建造伐木場。每隔一天自動派出一顆資源點，將木材收益送往距離 10 格以內最近的玩家城市，抵達後存入城市金庫。三格內不可重複建造。',
      },
      [TERRAIN.MOUNTAIN]: {
        type: 'mine',
        icon: '⛏️',
        name: '採礦場',
        cost: MAP_BLDG_MINE_COST,
        goldPerWorker: MAP_BLDG_MINE_GOLD,
        desc: '在山地中建造採礦場。每隔一天自動派出一顆資源點，將礦石收益送往距離 10 格以內最近的玩家城市，抵達後存入城市金庫。三格內不可重複建造。',
      },
      [TERRAIN.WATER]:    {
        type: 'bridge',
        icon: '🌉',
        name: '橋樑',
        cost: MAP_BLDG_BRIDGE_COST,
        goldPerWorker: 0,
        desc: '在河流上建造橋樑。建成後，道路規劃可通過此格，視為陸地。',
      },
    };

    const info = BLDG_INFO[terrainType];
    if (!info) return;

    const gold = this._getGold();
    const isResourceBldg = info.type === 'lumberCamp' || info.type === 'mine';
    const canAfford    = gold >= info.cost;
    const tooClose     = isResourceBldg && this._hasNearbyBuilding(tx, ty, info.type);
    const noCityInRange = isResourceBldg && !this._hasPlayerCityInRange(tx, ty);
    const canBuild     = canAfford && !tooClose && !noCityInRange;

    document.getElementById('map-build-title').textContent = `${info.icon} 建造${info.name}`;
    document.getElementById('map-build-body').innerHTML = `
      <div class="mb-desc">${info.desc}</div>
      ${tooClose ? `<div class="mb-warn">⚠️ 三格內已有同類建築，無法建造。</div>` : ''}
      ${noCityInRange ? `<div class="mb-warn">⚠️ 附近 ${MAP_BLDG_WORKER_REACH} 格內無玩家城市，資源無法送達，無法建造。</div>` : ''}
      <div class="mb-cost">建造費用：🪙${info.cost}　持有：🪙${gold}</div>
      ${info.goldPerWorker > 0
        ? `<div class="mb-income">每次送達：🪙${info.goldPerWorker}</div>`
        : ''}
      <div class="mb-actions">
        <button class="btn-buy mb-confirm-btn" id="btn-map-build-confirm" ${canBuild ? '' : 'disabled'}>
          ${tooClose ? '🚫 距離太近' : noCityInRange ? '🚫 超出城市接收範圍' : canAfford ? `✅ 建造（🪙${info.cost}）` : '💸 金幣不足'}
        </button>
        <button class="mb-cancel-btn" id="btn-map-build-cancel">取消</button>
      </div>
    `;

    overlay.classList.add('visible');

    // Replace buttons with clones to avoid accumulating duplicate listeners
    // from repeated opens of the same overlay.
    const confirmBtn = document.getElementById('btn-map-build-confirm');
    const cancelBtn  = document.getElementById('btn-map-build-cancel');
    if (confirmBtn) {
      const newConfirm = confirmBtn.cloneNode(true);
      confirmBtn.replaceWith(newConfirm);
      newConfirm.addEventListener('click', () => {
        if (this._getGold() < info.cost) { this._toast('💸 金幣不足！'); return; }
        if (info.type !== 'bridge' && this._hasNearbyBuilding(tx, ty, info.type)) {
          this._toast('⚠️ 三格內已有同類建築，無法建造！'); return;
        }
        if ((info.type === 'lumberCamp' || info.type === 'mine') && !this._hasPlayerCityInRange(tx, ty)) {
          this._toast(`⚠️ 附近 ${MAP_BLDG_WORKER_REACH} 格內無玩家城市，無法建造！`); return;
        }
        this._spendGold(info.cost);
        const id = ++this._mapBuildingIdSeq;
        this._mapBuildings.push({ id, type: info.type, tx, ty, phaseTick: 0 });
        this._addInboxMessage(info.icon, `已在地圖 (${tx}, ${ty}) 建造${info.name}！`);
        if (info.type === 'bridge' && this.onBridgeBuilt) this.onBridgeBuilt();
        if (this.onMapBuildingChanged) this.onMapBuildingChanged();
        overlay.classList.remove('visible');
        // Pass null coordinates to properly hide the button (tile is now occupied)
        this.setNearbyBuildableTerrain(null, null, null);
      });
    }
    if (cancelBtn) {
      const newCancel = cancelBtn.cloneNode(true);
      cancelBtn.replaceWith(newCancel);
      newCancel.addEventListener('click', () => {
        overlay.classList.remove('visible');
      });
    }
  }

  /**
   * Open the map-build overlay in "info" mode for an existing map building.
   * Displays the building type, location, estimated income, nearest target city,
   * and current worker status.
   * @param {{ id: number, type: 'lumberCamp'|'mine'|'bridge', tx: number, ty: number }} bldg
   */
  _openMapBuildingInfo(bldg) {
    const overlay = document.getElementById('map-build-overlay');
    if (!overlay) return;

    const BLDG_META = {
      lumberCamp: { icon: '🪵', name: '伐木場', goldPerWorker: MAP_BLDG_LUMBER_GOLD },
      mine:       { icon: '⛏️', name: '採礦場', goldPerWorker: MAP_BLDG_MINE_GOLD  },
      bridge:     { icon: '🌉', name: '橋樑',   goldPerWorker: 0                    },
    };
    const meta = BLDG_META[bldg.type] ?? { icon: '🏗️', name: bldg.type, goldPerWorker: 0 };

    // Estimated daily income: one delivery per MAP_BLDG_SPAWN_INTERVAL phases,
    // 2 working phases (白天 + 黃昏) per day.
    const deliveriesPerDay = 2 / MAP_BLDG_SPAWN_INTERVAL;
    const estimatedDaily   = Math.round(meta.goldPerWorker * deliveriesPerDay);

    // Nearest target city name
    let nearestCityName = '—';
    if (this.nationSystem && bldg.type !== 'bridge') {
      let bestKey  = null;
      let bestDist = Infinity;
      const checkList = (arr, prefix) => {
        arr.forEach((s, i) => {
          if (s.controllingNationId !== PLAYER_NATION_ID) return;
          const center = this._getSettlementCenter(s);
          const dist   = Math.abs(center.tx - bldg.tx) + Math.abs(center.ty - bldg.ty);
          if (dist <= MAP_BLDG_WORKER_REACH && dist < bestDist) {
            bestDist = dist;
            bestKey  = `${prefix}:${i}`;
          }
        });
      };
      checkList(this.nationSystem.castleSettlements, 'castle');
      checkList(this.nationSystem.villageSettlements, 'village');
      if (bestKey) {
        const s = this._getSettlementByKey(bestKey);
        if (s) nearestCityName = s.name;
      }
    }

    // Dot status
    const activeDots = this._mapBuildingWorkers.filter(w => w.buildingId === bldg.id);
    const workerStatusHTML = activeDots.length > 0
      ? '<span>資源點送貨中 🔴</span>'
      : '<span style="color:#9e9e9e">等待派送中</span>';

    document.getElementById('map-build-title').textContent = `${meta.icon} ${meta.name} 資訊`;
    document.getElementById('map-build-body').innerHTML = `
      <div class="mb-desc">地塊位置：(${bldg.tx}, ${bldg.ty})</div>
      ${meta.goldPerWorker > 0 ? `
        <div class="mb-income">每次送達：🪙${meta.goldPerWorker}</div>
        <div class="mb-income">預估日收入：🪙${estimatedDaily}（每日 ${deliveriesPerDay} 次）</div>
        <div class="mb-income">最近目標城市：${nearestCityName}</div>
        <div class="mb-income">工人狀態：${workerStatusHTML}</div>
      ` : `
        <div class="mb-desc">橋樑建成後，玩家可直接步行穿越此水域格。</div>
      `}
      <div class="mb-actions">
        <button class="mb-cancel-btn" id="btn-map-bldg-info-close">關閉</button>
      </div>
    `;

    overlay.classList.add('visible');

    const closeBtn = document.getElementById('btn-map-bldg-info-close');
    if (closeBtn) {
      const newClose = closeBtn.cloneNode(true);
      closeBtn.replaceWith(newClose);
      newClose.addEventListener('click', () => {
        overlay.classList.remove('visible');
      });
    }
  }
  _tickMapBuildingWorkers() {
    // ── Advance spawn tick and spawn dots ─────────────────────────────────────
    for (const bldg of this._mapBuildings) {
      if (bldg.type === 'bridge') continue; // bridges don't spawn dots
      // Only one dot per building at a time.
      const hasDot = this._mapBuildingWorkers.some(w => w.buildingId === bldg.id);
      if (hasDot) continue;
      bldg.phaseTick = (bldg.phaseTick ?? 0) + 1;
      if (bldg.phaseTick >= MAP_BLDG_SPAWN_INTERVAL) {
        bldg.phaseTick = 0;
        this._spawnMapBuildingWorker(bldg);
      }
    }

    // ── Move dots one step toward their target ────────────────────────────────
    const arrived = [];

    for (const w of this._mapBuildingWorkers) {
      const targetSett = this._getSettlementByKey(w.targetKey);
      if (!targetSett) { arrived.push(w); continue; }

      const center = this._getSettlementCenter(targetSett);
      const dx = center.tx - w.tx;
      const dy = center.ty - w.ty;

      if (dx === 0 && dy === 0) {
        arrived.push(w);
      } else if (Math.abs(dx) >= Math.abs(dy)) {
        w.tx += Math.sign(dx);
      } else {
        w.ty += Math.sign(dy);
      }
    }

    // ── Deliver gold for arrived dots and remove them ─────────────────────────
    for (const w of arrived) {
      if (w.targetKey) {
        const cur = this._regionalTreasury.get(w.targetKey) ?? 0;
        this._regionalTreasury.set(w.targetKey, cur + w.gold);

        const sett = this._getSettlementByKey(w.targetKey);
        const bldgLabel = w.type === 'lumberCamp' ? '伐木場' : '採礦場';
        if (sett) {
          this._addInboxMessage('💰', `${bldgLabel}資源點抵達 ${sett.name}，獲得 🪙${w.gold}，已存入城市金庫。`);
        }
      }
      const idx = this._mapBuildingWorkers.indexOf(w);
      if (idx >= 0) this._mapBuildingWorkers.splice(idx, 1);
    }
  }

  /**
   * Spawn a resource dot from a map building toward the nearest player-owned
   * settlement within `MAP_BLDG_WORKER_REACH` Manhattan tiles.
   * @param {{ id: number, type: string, tx: number, ty: number }} bldg
   */
  _spawnMapBuildingWorker(bldg) {
    if (!this.nationSystem) return;

    let bestKey  = null;
    let bestDist = Infinity;

    const checkList = (arr, prefix) => {
      arr.forEach((s, i) => {
        if (s.controllingNationId !== PLAYER_NATION_ID) return;
        const center = this._getSettlementCenter(s);
        const dist   = Math.abs(center.tx - bldg.tx) + Math.abs(center.ty - bldg.ty);
        if (dist <= MAP_BLDG_WORKER_REACH && dist < bestDist) {
          bestDist = dist;
          bestKey  = `${prefix}:${i}`;
        }
      });
    };

    checkList(this.nationSystem.castleSettlements, 'castle');
    checkList(this.nationSystem.villageSettlements, 'village');

    if (!bestKey) return; // no reachable player city – skip

    const gold = bldg.type === 'lumberCamp' ? MAP_BLDG_LUMBER_GOLD : MAP_BLDG_MINE_GOLD;
    this._mapBuildingWorkers.push({
      id:         `mbw:${++this._mapBuildingIdSeq}`,
      buildingId: bldg.id,
      type:       bldg.type,
      tx:         bldg.tx,
      ty:         bldg.ty,
      targetKey:  bestKey,
      gold,
    });
  }

  /**
   * Compute the actual A* road path between two settlements (4-directional,
   * avoids WATER and MOUNTAIN).  Returns the tile path plus terrain-based
   * gold cost and work-hour totals.
   *
   * Bridge tiles (from `_mapBuildings`) are treated as passable land.
   *
   * @param {import('../systems/NationSystem.js').Settlement} fromSett
   * @param {import('../systems/NationSystem.js').Settlement} toSett
   * @returns {{
   *   path:            { tx: number, ty: number }[] | null,
   *   blockedByRiver:  boolean,
   *   totalCost:       number,
   *   totalHours:      number
   * }}
   */
  _computeRoadPath(fromSett, toSett) {
    if (!this._mapData) {
      return { path: null, blockedByRiver: false, totalCost: 0, totalHours: 0 };
    }

    const tiles      = this._mapData.tiles;
    const from       = this._getSettlementCenter(fromSett);
    const to         = this._getSettlementCenter(toSett);
    const bridgeTiles = this.getBridgeTileSet();

    // Snap coordinates to the nearest non-impassable tile.
    const snap = (tx0, ty0) => {
      for (let r = 0; r <= ROAD_SNAP_RADIUS; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const x = tx0 + dx, y = ty0 + dy;
            if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) continue;
            const t = tiles[y * MAP_WIDTH + x];
            if (t !== TERRAIN.MOUNTAIN && (t !== TERRAIN.WATER || bridgeTiles.has(`${x},${y}`))) return [x, y];
          }
        }
      }
      return null;
    };

    const startSnap = snap(from.tx, from.ty);
    const endSnap   = snap(to.tx,   to.ty);

    if (!startSnap || !endSnap) {
      const blocked = _hasWaterOnLine(tiles, from.tx, from.ty, to.tx, to.ty);
      return { path: null, blockedByRiver: blocked, totalCost: 0, totalHours: 0 };
    }

    const [sx, sy] = startSnap;
    const [ex, ey] = endSnap;

    if (sx === ex && sy === ey) {
      return { path: [{ tx: sx, ty: sy }], blockedByRiver: false, totalCost: 0, totalHours: 0 };
    }

    // ── 4-directional A* ────────────────────────────────────────────────────
    const N    = MAP_WIDTH * MAP_HEIGHT;
    const KEY  = (x, y) => y * MAP_WIDTH + x;
    const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const heur = (x, y) => Math.abs(x - ex) + Math.abs(y - ey);

    // Inline binary min-heap (priority queue)
    const heapData = [];
    const heapPush = (key, pri) => {
      heapData.push({ key, pri });
      let i = heapData.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapData[p].pri <= heapData[i].pri) break;
        [heapData[p], heapData[i]] = [heapData[i], heapData[p]];
        i = p;
      }
    };
    const heapPop = () => {
      const top  = heapData[0];
      const last = heapData.pop();
      if (heapData.length > 0) {
        heapData[0] = last;
        let i = 0;
        for (;;) {
          let s = i;
          const l = 2 * i + 1, r = l + 1;
          if (l < heapData.length && heapData[l].pri < heapData[s].pri) s = l;
          if (r < heapData.length && heapData[r].pri < heapData[s].pri) s = r;
          if (s === i) break;
          [heapData[s], heapData[i]] = [heapData[i], heapData[s]];
          i = s;
        }
      }
      return top;
    };

    const gCost = new Float32Array(N).fill(Infinity);
    const parent = new Int32Array(N).fill(-1);

    const sk = KEY(sx, sy);
    gCost[sk] = 0;
    heapPush(sk, heur(sx, sy));
    const ek = KEY(ex, ey);

    while (heapData.length > 0) {
      const { key: ck } = heapPop();
      if (ck === ek) break;

      const cx = ck % MAP_WIDTH;
      const cy = (ck / MAP_WIDTH) | 0;

      for (const [ddx, ddy] of DIRS) {
        const nx = cx + ddx, ny = cy + ddy;
        if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;

        const t = tiles[ny * MAP_WIDTH + nx];
        if (t === TERRAIN.MOUNTAIN) continue;
        if (t === TERRAIN.WATER && !bridgeTiles.has(`${nx},${ny}`)) continue;

        const isBridge = t === TERRAIN.WATER && bridgeTiles.has(`${nx},${ny}`);
        const moveCost = isBridge ? ROAD_PATH_COST_BRIDGE : (ROAD_PATH_COST[t] ?? 1.0);
        const nk  = KEY(nx, ny);
        const ng  = gCost[ck] + moveCost;
        if (ng < gCost[nk]) {
          gCost[nk]  = ng;
          parent[nk] = ck;
          heapPush(nk, ng + heur(nx, ny));
        }
      }
    }

    if (parent[ek] === -1 && ek !== sk) {
      const blockedByRiver = _hasWaterOnLine(tiles, sx, sy, ex, ey);
      return { path: null, blockedByRiver, totalCost: 0, totalHours: 0 };
    }

    // ── Reconstruct path ────────────────────────────────────────────────────
    const keyPath = [];
    let cur = ek;
    while (cur !== -1) { keyPath.push(cur); cur = parent[cur]; }
    keyPath.reverse();

    let totalCost  = 0;
    let totalHours = 0;
    const path = keyPath.map(k => {
      const tx = k % MAP_WIDTH;
      const ty = (k / MAP_WIDTH) | 0;
      const t  = tiles[ty * MAP_WIDTH + tx];
      const isBridge = t === TERRAIN.WATER && bridgeTiles.has(`${tx},${ty}`);
      totalCost  += isBridge ? ROAD_GOLD_PER_TILE_BRIDGE  : (ROAD_GOLD_PER_TILE[t]          ?? CONSTR_ROAD_COST_PER_TILE);
      totalHours += isBridge ? ROAD_HOURS_PER_TILE_BRIDGE : (ROAD_HOURS_PER_TILE_TERRAIN[t] ?? CONSTR_ROAD_HOURS_PER_TILE);
      return { tx, ty };
    });

    return {
      path,
      blockedByRiver: false,
      totalCost:  Math.round(totalCost),
      totalHours: Math.round(totalHours * 10) / 10,
    };
  }

  /**
   * Return worker objects for all in-progress construction tasks so that
   * `WorkerRenderer` can draw moving tokens on the world map.
   *
   * Each worker object:
   * ```
   * {
   *   id:    string,   // unique identifier (stable within a session)
   *   type:  'road' | 'demolish' | 'building',
   *   worldX: number,  // current world-pixel X
   *   worldY: number,  // current world-pixel Y
   * }
   * ```
   *
   * Road workers walk from the FROM settlement toward the TO settlement,
   * reaching the target when hoursLeft reaches zero.
   * Building workers stay at the settlement centre.
   *
   * @returns {Array<{ id: string, type: string, worldX: number, worldY: number }>}
   */
  getConstructionWorkers() {
    const workers  = [];
    const processed = new Set();

    for (const [key, state] of this._constructionState) {
      // ── Building workers ────────────────────────────────────────────────────
      const settlement = this._getSettlementByKey(key);
      const assignedBuildWorkers = this._getBuildingWorkerUnits(key);
      if (settlement && state.buildingQueue.length > 0) {
        const center = this._getSettlementCenter(settlement);
        // Emit one token per queued building (all visible on map).
        // Only items with an assigned worker show that worker's color.
        for (let wi = 0; wi < state.buildingQueue.length; wi++) {
          const unit = assignedBuildWorkers[wi];
          workers.push({
            id:         `building:${key}:${wi}`,
            type:       'building',
            worldX:     (center.tx + 0.5) * TILE_SIZE,
            worldY:     (center.ty + 0.5) * TILE_SIZE,
            // Pass full unit appearance so the renderer can draw the character.
            appearance: unit?.appearance ?? null,
            unitId:     unit?.id ?? null,
          });
        }
      }

      // ── Road workers ────────────────────────────────────────────────────────
      for (const [rk, road] of state.roads) {
        if (processed.has(rk)) continue;   // mirror entry – skip
        processed.add(rk);

        const [fromKey, toKey] = rk.split('↔');
        const fromSett = this._getSettlementByKey(fromKey);
        const toSett   = this._getSettlementByKey(toKey);
        if (!fromSett || !toSett) continue;

        const fromCenter = this._getSettlementCenter(fromSett);
        const toCenter   = this._getSettlementCenter(toSett);

        const hoursPerTile = road.isDemo ? CONSTR_ROAD_DEMO_HOURS_PER_TILE : CONSTR_ROAD_HOURS_PER_TILE;
        const totalHours   = road.totalHours ?? (road.tilesTotal * hoursPerTile);
        const progress     = totalHours > 0
          ? Math.max(0, Math.min(1, 1 - road.hoursLeft / totalHours))
          : 0;

        const fromX = (fromCenter.tx + 0.5) * TILE_SIZE;
        const fromY = (fromCenter.ty + 0.5) * TILE_SIZE;
        const toX   = (toCenter.tx + 0.5) * TILE_SIZE;
        const toY   = (toCenter.ty + 0.5) * TILE_SIZE;

        // Use the road-construction workers from the origin settlement.
        const roadWorkers = this._getBuildingWorkerUnits(fromKey);
        const repUnit     = roadWorkers[0];

        workers.push({
          id:        `road:${rk}`,
          type:      road.isDemo ? 'demolish' : 'road',
          worldX:    fromX + (toX - fromX) * progress,
          worldY:    fromY + (toY - fromY) * progress,
          appearance: repUnit?.appearance ?? null,
          unitId:    repUnit?.id ?? null,
        });
      }
    }

    // ── Map building resource workers (lumber camp / mine) ───────────────────
    for (const w of this._mapBuildingWorkers) {
      workers.push({
        id:     w.id,
        type:   'resource',
        worldX: (w.tx + 0.5) * TILE_SIZE,
        worldY: (w.ty + 0.5) * TILE_SIZE,
      });
    }

    return workers;
  }

  /**
   * Canonical road key for a pair of settlement keys (always smaller key first).
   * @param {string} keyA
   * @param {string} keyB
   * @returns {string}
   */
  _roadKey(keyA, keyB) {
    return keyA < keyB ? `${keyA}↔${keyB}` : `${keyB}↔${keyA}`;
  }

  // -------------------------------------------------------------------------
  // Construction system – main panel renderer
  // -------------------------------------------------------------------------

  /**
   * Render the main construction panel with two tabs (建築 / 道路).
   * @param {import('../systems/BuildingSystem.js').Building} building  Government building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @param {boolean} [inCityHall]  When true, render inside #ch-tab-content instead of full screen.
   */
  _renderConstructionPanel(building, settlement, inCityHall = false) {
    // When embedded in city hall, render into #ch-tab-content
    const target = inCityHall ? document.getElementById('ch-tab-content') : document.getElementById('location-content');
    if (!target) return;

    const tabs = ['建築', '道路'];
    if (!this._constructionTab || !tabs.includes(this._constructionTab)) {
      this._constructionTab = '建築';
    }

    const tabsHTML = tabs.map(t => `
      <button class="constr-tab-btn${this._constructionTab === t ? ' active' : ''}" data-ctab="${t}">${t}</button>
    `).join('');

    if (inCityHall) {
      target.innerHTML = `
        ${this._goldBarHTML()}
        <div class="constr-tabs">${tabsHTML}</div>
        <div id="constr-tab-content"></div>
      `;
    } else {
      const content = document.getElementById('location-content');
      if (!content) return;
      content.innerHTML = `
        ${this._facilityBackHTML(settlement)}
        <div class="fac-title">🏗️ 建設選項</div>
        ${this._goldBarHTML()}
        <div class="constr-tabs">${tabsHTML}</div>
        <div id="constr-tab-content"></div>
      `;
      // Back to the government building (not the facilities list)
      document.getElementById('btn-fac-back')?.addEventListener('click', () => {
        this._constructionTab = '建築';
        this._renderGovBuilding(building, settlement);
      });
    }

    target.querySelectorAll('.constr-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._constructionTab = btn.dataset.ctab;
        this._renderConstructionPanel(building, settlement, inCityHall);
      });
    });

    if (this._constructionTab === '建築') {
      this._renderBuildingConstructionTab(building, settlement);
    } else if (this._constructionTab === '道路') {
      this._renderRoadConstructionTab(building, settlement);
    }
  }

  // -------------------------------------------------------------------------
  // Construction – building tab
  // -------------------------------------------------------------------------

  /**
   * @param {import('../systems/BuildingSystem.js').Building} govBuilding
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderBuildingConstructionTab(govBuilding, settlement) {
    const panel = document.getElementById('constr-tab-content');
    if (!panel) return;

    const key     = this._settlementKey(settlement);
    const state   = this._getConstructionState(key);
    const maxSlots = CONSTR_MAX_BUILDINGS[settlement.type] ?? 4;
    const usedSlots = (settlement.buildings?.length ?? 0) + state.buildingQueue.length;
    const freeSlots = maxSlots - usedSlots;

    // Assigned construction workers (max 3)
    const assignedWorkers = this._getBuildingWorkerUnits(key);
    const workerSlotsHTML = [0, 1, 2].map(i => {
      const unit = assignedWorkers[i];
      if (unit) {
        const bonus = getConstructBonus(unit);
        return `<span class="cw-slot cw-filled">
          ${unit.name} 🏃${unit.stats?.moveSpeed ?? 5}
          ${bonus > 0 ? `<span style="color:#66bb6a">×${(1 + bonus).toFixed(2)}</span>` : ''}
          <button class="cw-remove" data-unit-id="${unit.id}">✕</button>
        </span>`;
      }
      return `<span class="cw-slot cw-empty">工位 ${i + 1}</span>`;
    }).join('');

    const activeWorkers = assignedWorkers.length;
    const simultaneousNote = activeWorkers === 0
      ? '<span style="color:#ef9a9a">⚠ 未指派工人，建造暫停</span>'
      : `可同時建造 ${activeWorkers} 棟`;

    // Already-built buildings (with demolish option for non-government buildings)
    const builtBuildingsHTML = (settlement.buildings ?? []).map((b, idx) => {
      const isGovBldg = b.type === BLDG_PALACE || b.type === BLDG_CHIEF_HOUSE;
      // Use recorded build cost; fall back to 0 for seed-generated buildings that weren't player-built.
      const cost      = _BUILDING_COSTS[b.type] ?? 0;
      const refund    = Math.floor(cost * DEMOLISH_REFUND_RATIO);
      const refundLabel = refund > 0 ? `退還 🪙${refund}` : '無退款（非玩家建造）';
      return `<div class="constr-built-row">
        <span class="constr-built-tag">✅ ${b.name}</span>
        ${!isGovBldg ? `<button class="btn-buy constr-demolish-btn" data-bldg-idx="${idx}" data-refund="${refund}" title="拆除 · ${refundLabel}">🪚 拆除</button>` : ''}
      </div>`;
    }).join('') || '';

    // In-progress buildings
    const queueHTML = state.buildingQueue.length > 0
      ? state.buildingQueue.map((q, i) => {
          const w = assignedWorkers[i];
          const active = i < activeWorkers;
          return `
          <div class="constr-queue-row${active ? '' : ' paused'}">
            <span class="cqr-icon">${q.icon}</span>
            <span class="cqr-name">${q.name}</span>
            <span class="cqr-timer">⏳ 剩 ${q.daysLeft} 天${active && w ? ` · ${w.name}施工` : ' · 暫停'}</span>
          </div>`;
        }).join('')
      : '<div class="constr-empty-note">（無建造中的建築）</div>';

    // Buildable types (not already built, not in queue)
    const inQueueTypes  = new Set(state.buildingQueue.map(q => q.type));
    const builtTypes    = new Set((settlement.buildings ?? []).map(b => b.type));
    const availableHTML = freeSlots <= 0
      ? '<div class="constr-empty-note">建築位置已滿</div>'
      : _BUILDABLE_TYPES
          .filter(t => !builtTypes.has(t) && !inQueueTypes.has(t))
          .map(t => {
            const meta = BUILDING_META[t];
            if (!meta) return '';
            const cost = _BUILDING_COSTS[t] ?? 100;
            return `
              <div class="constr-option-card" data-btype="${t}" role="button" tabindex="0">
                <span class="coc-icon">${meta.icon}</span>
                <div class="coc-info">
                  <div class="coc-name">${meta.name}</div>
                  <div class="coc-desc">建造需 ${CONSTR_BUILDING_DAYS} 天 · 🪙${cost}</div>
                </div>
                <button class="btn-buy coc-build-btn" data-btype="${t}" data-cost="${cost}">建造</button>
              </div>`;
          }).join('') || '<div class="constr-empty-note">所有建築類型已建造</div>';

    panel.innerHTML = `
      <div class="constr-section-title">工人團隊（最多 3 人，${simultaneousNote}）</div>
      <div class="cw-slots">${workerSlotsHTML}</div>
      <button class="btn-buy cw-assign-btn" id="btn-assign-build-workers">👷 指派工人</button>
      <div class="constr-section-title">建築位置：${usedSlots} / ${maxSlots}</div>
      <div class="constr-built-list">${builtBuildingsHTML}</div>
      <div class="constr-section-title">建造中</div>
      <div class="constr-queue">${queueHTML}</div>
      ${freeSlots > 0 ? '<div class="constr-section-title">可新增建築</div>' : ''}
      <div class="constr-option-list">${availableHTML}</div>
    `;

    // Remove worker button
    panel.querySelectorAll('.cw-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const unitId = Number(btn.dataset.unitId);
        const ids = (this._buildingWorkers.get(key) ?? []).filter(id => id !== unitId);
        this._buildingWorkers.set(key, ids);
        this._renderBuildingConstructionTab(govBuilding, settlement);
      });
    });

    // Assign workers button
    document.getElementById('btn-assign-build-workers')?.addEventListener('click', () => {
      this._openAssignWorkerPanel('building', key, 3, govBuilding, settlement,
        () => this._renderConstructionPanel(govBuilding, settlement));
    });

    // Demolish building buttons
    panel.querySelectorAll('.constr-demolish-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx    = Number(btn.dataset.bldgIdx);
        const refund = Number(btn.dataset.refund);
        const bldg   = settlement.buildings?.[idx];
        if (!bldg) return;
        if (!confirm(`確定要拆除「${bldg.name}」嗎？退還 🪙${refund} 金幣。`)) return;
        settlement.buildings.splice(idx, 1);
        if (refund > 0) this._addGold(refund);
        this._addInboxMessage('🪚', `${settlement.name} 拆除了「${bldg.name}」，退還 🪙${refund}。`);
        this._renderBuildingConstructionTab(govBuilding, settlement);
      });
    });

    panel.querySelectorAll('.coc-build-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const btype = btn.dataset.btype;
        const cost  = Number(btn.dataset.cost);
        const meta  = BUILDING_META[btype];
        if (!meta) return;

        if (this._getGold() < cost) { this._toast('💸 金幣不足！'); return; }
        if (freeSlots <= 0)         { this._toast('建築位置已滿！'); return; }

        this._spendGold(cost);
        state.buildingQueue.push({ type: btype, name: meta.name, icon: meta.icon, daysLeft: CONSTR_BUILDING_DAYS });
        this._addInboxMessage('🏗️', `開始建造 ${meta.name}（${settlement.name}），預計 ${CONSTR_BUILDING_DAYS} 天後完工（需指派工人才能進行）。`);
        this._renderConstructionPanel(govBuilding, settlement);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Construction – road tab
  // -------------------------------------------------------------------------

  /**
   * @param {import('../systems/BuildingSystem.js').Building} govBuilding
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderRoadConstructionTab(govBuilding, settlement) {
    const panel = document.getElementById('constr-tab-content');
    if (!panel) return;

    const key   = this._settlementKey(settlement);
    const state = this._getConstructionState(key);

    // Collect all other player-owned settlements as connection targets.
    const targets = [];
    if (this.nationSystem) {
      this.nationSystem.castleSettlements.forEach((s, i) => {
        const tkey = `castle:${i}`;
        if (tkey !== key && s.controllingNationId === PLAYER_NATION_ID) {
          targets.push({ settlement: s, key: tkey, label: `🏰 ${s.name}` });
        }
      });
      this.nationSystem.villageSettlements.forEach((s, i) => {
        const tkey = `village:${i}`;
        if (tkey !== key && s.controllingNationId === PLAYER_NATION_ID) {
          targets.push({ settlement: s, key: tkey, label: `🏘️ ${s.name}` });
        }
      });
    }

    // Existing roads: built + in-progress
    const roadsHTML = (() => {
      const rows = [];
      // Built roads (builtRoads is now a Map<roadKey, {tiles}>)
      for (const [rk] of state.builtRoads) {
        const other = rk.split('↔').find(p => p !== key) ?? '';
        const oSett = this._getSettlementByKey(other);
        const name  = oSett ? `${oSett.type === 'castle' ? '🏰' : '🏘️'} ${oSett.name}` : other;
        rows.push(`
          <div class="constr-road-row">
            <span class="crr-icon">🛤️</span>
            <span class="crr-name">${name}</span>
            <span class="crr-status built">已完成</span>
            <button class="btn-buy crr-demo-btn" data-rkey="${rk}">🪚 拆除</button>
          </div>`);
      }
      // Roads in progress
      for (const [rk, road] of state.roads) {
        const other      = rk.split('↔').find(p => p !== key) ?? '';
        const oSett      = this._getSettlementByKey(other);
        const name       = oSett ? `${oSett.type === 'castle' ? '🏰' : '🏘️'} ${oSett.name}` : road.targetName;
        const totalHours = road.totalHours ?? (road.tilesTotal * (road.isDemo ? CONSTR_ROAD_DEMO_HOURS_PER_TILE : CONSTR_ROAD_HOURS_PER_TILE));
        const pct        = Math.round((1 - road.hoursLeft / Math.max(totalHours, 0.01)) * 100);
        const label      = road.isDemo ? `🪚 拆除中 ${pct}%` : `🚧 施工中 ${pct}%`;
        rows.push(`
          <div class="constr-road-row">
            <span class="crr-icon">${road.isDemo ? '🪚' : '🚧'}</span>
            <span class="crr-name">${name}</span>
            <span class="crr-status">${label}</span>
          </div>`);
      }
      return rows.length ? rows.join('') : '<div class="constr-empty-note">（尚無道路）</div>';
    })();

    // Build new road form
    const newRoadHTML = targets.length === 0
      ? '<div class="constr-empty-note">無可連接的己方地區</div>'
      : `<div class="constr-road-form">
          <label class="constr-road-label">目標地區</label>
          <select id="constr-road-target" class="constr-road-select">
            ${targets.map(t => `<option value="${t.key}">${t.label}</option>`).join('')}
          </select>
          <div id="constr-road-info" class="constr-road-info">計算路線中…</div>
          <button class="btn-buy constr-road-build-btn" id="btn-build-road" disabled>🚧 開始建造</button>
        </div>`;

    panel.innerHTML = `
      <div class="constr-section-title">現有道路</div>
      <div class="constr-road-list">${roadsHTML}</div>
      <div class="constr-section-title">新建道路</div>
      ${newRoadHTML}
    `;

    // Cached path result for the currently selected target.
    let cachedRoadPath = null;

    const updateRoadInfo = () => {
      const sel    = document.getElementById('constr-road-target');
      const infoEl = document.getElementById('constr-road-info');
      const buildBtn = document.getElementById('btn-build-road');
      if (!sel || !infoEl) return;

      const targetKey  = sel.value;
      const rk         = this._roadKey(key, targetKey);
      cachedRoadPath   = null;

      if (state.builtRoads.has(rk)) {
        infoEl.innerHTML = '<span style="color:#66bb6a">✅ 此路段已完成</span>';
        if (buildBtn) buildBtn.disabled = true;
        return;
      }
      if (state.roads.has(rk)) {
        infoEl.innerHTML = '<span style="color:#ffa726">⚠️ 此路段正在施工</span>';
        if (buildBtn) buildBtn.disabled = true;
        return;
      }

      const targetSett = this._getSettlementByKey(targetKey);
      if (!targetSett) {
        infoEl.textContent = '（找不到目標地區）';
        if (buildBtn) buildBtn.disabled = true;
        return;
      }

      // Compute the actual A* route.
      const result = this._computeRoadPath(settlement, targetSett);
      if (!result.path) {
        if (result.blockedByRiver) {
          infoEl.innerHTML = '<span style="color:#ef5350">🌊 被河流阻擋，需要建造橋樑才可通過</span>';
        } else {
          infoEl.innerHTML = '<span style="color:#ef5350">⛰️ 無可行路線（山地阻擋）</span>';
        }
        if (buildBtn) buildBtn.disabled = true;
      } else {
        infoEl.innerHTML =
          `路程 ${result.path.length} 格 · 預計 ${result.totalHours} 工時 · 費用 🪙${result.totalCost}`;
        if (buildBtn) buildBtn.disabled = false;
        cachedRoadPath = { ...result, rk, targetKey };
      }
    };

    document.getElementById('constr-road-target')?.addEventListener('change', updateRoadInfo);
    updateRoadInfo();

    document.getElementById('btn-build-road')?.addEventListener('click', () => {
      if (!cachedRoadPath?.path) { this._toast('⚠️ 請先選擇可行路線'); return; }

      const { path, totalCost, totalHours, rk, targetKey } = cachedRoadPath;

      if (state.builtRoads.has(rk)) { this._toast('✅ 此路段已建完！'); return; }
      if (state.roads.has(rk))      { this._toast('⚠️ 此路段已在施工中！'); return; }
      if (this._getGold() < totalCost) { this._toast('💸 金幣不足！'); return; }

      this._spendGold(totalCost);

      const targetSett = this._getSettlementByKey(targetKey);
      const targetName = targetSett ? targetSett.name : targetKey;
      const tiles      = path.length;

      // Add road to this settlement's in-progress queue.
      state.roads.set(rk, {
        targetKey,
        targetName,
        tilesTotal:  tiles,
        totalHours,
        hoursLeft:   totalHours,
        isDemo:      false,
        path,
      });

      // Mirror to the target settlement so it shows in its road tab too.
      const targetState = this._getConstructionState(targetKey);
      targetState.roads.set(rk, {
        targetKey:  key,
        targetName: settlement.name,
        tilesTotal: tiles,
        totalHours,
        hoursLeft:  totalHours,
        isDemo:     false,
        path,
      });

      this._addInboxMessage('🚧', `開始修建 ${settlement.name} → ${targetName} 的道路（${tiles} 格，需 ${totalHours} 工時）。`);
      this._renderConstructionPanel(govBuilding, settlement);
    });

    // Demolish road
    panel.querySelectorAll('.crr-demo-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const rk       = btn.dataset.rkey;
        const roadData = state.builtRoads.get(rk);
        if (!roadData) return;

        state.builtRoads.delete(rk);

        const other       = rk.split('↔').find(p => p !== key) ?? '';
        const otherSett   = this._getSettlementByKey(other);
        const roadTiles   = roadData.tiles ?? [];
        const tiles       = roadTiles.length || 1;
        const demoHours   = tiles * CONSTR_ROAD_DEMO_HOURS_PER_TILE;

        const targetState = this._getConstructionState(other);
        targetState.builtRoads.delete(rk);

        state.roads.set(rk, {
          targetKey:   other,
          targetName:  otherSett?.name ?? other,
          tilesTotal:  tiles,
          totalHours:  demoHours,
          hoursLeft:   demoHours,
          isDemo:      true,
          path:        roadTiles,
        });
        targetState.roads.set(rk, {
          targetKey:   key,
          targetName:  settlement.name,
          tilesTotal:  tiles,
          totalHours:  demoHours,
          hoursLeft:   demoHours,
          isDemo:      true,
          path:        roadTiles,
        });

        this._addInboxMessage('🪚', `開始拆除 ${settlement.name} 的道路。`);
        this._renderConstructionPanel(govBuilding, settlement);
      });
    });
  }

  /**
   * Return the Settlement object for a given settlement key.
   * @param {string} key  e.g. "castle:0" or "village:3"
   * @returns {import('../systems/NationSystem.js').Settlement|null}
   */
  _getSettlementByKey(key) {
    if (!this.nationSystem || !key) return null;
    const [type, idxStr] = key.split(':');
    const idx = Number(idxStr);
    if (type === 'castle') return this.nationSystem.castleSettlements[idx] ?? null;
    if (type === 'village') return this.nationSystem.villageSettlements[idx] ?? null;
    return null;
  }

  // -------------------------------------------------------------------------
  // Send Letter / Peace Treaty UI (player-owned government building)
  // -------------------------------------------------------------------------

  /**
   * Show the messenger-picker step, then the letter type selector.
   * The player must assign an available army unit as the messenger before
   * choosing the letter type.
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderSendLetter(settlement) {
    // Reset any previously selected messenger.
    this._pendingMessengerUnit = null;
    this._renderMessengerPicker(settlement);
  }

  /**
   * Render the messenger assignment screen.
   * Shows all army units and lets the player pick one as the courier.
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderMessengerPicker(settlement) {
    const content = document.getElementById('location-content');
    if (!content) return;

    const assignedAll = this._getAllAssignedUnitIds();
    const allUnits    = [];
    for (const squad of this.army.getSquads()) {
      for (const m of squad.members) allUnits.push(m);
    }

    const unitRows = allUnits.map(unit => {
      const isBusy    = assignedAll.has(unit.id);
      const traitBadges = renderTraitBadgesHTML(unit.traits.slice(0, 3), PERSONALITY_COLORS);
      return `
        <div class="assign-worker-row${isBusy ? ' assigned-elsewhere' : ''}">
          <span class="awr-name">${unit.name}</span>
          <span class="awr-speed">🏃${unit.stats?.moveSpeed ?? 5}</span>
          <span class="awr-traits">${traitBadges}</span>
          ${isBusy ? '<span class="awr-conflict">已派遣他處</span>' : ''}
          <button class="btn-buy awr-assign${isBusy ? ' disabled' : ''}" data-unit-id="${unit.id}"
                  ${isBusy ? 'disabled' : ''}>選為信使</button>
        </div>`;
    }).join('');

    content.innerHTML = `
      ${this._facilityBackHTML(settlement)}
      <div class="fac-title">📨 派送信件</div>
      <div class="letter-intro">請先指派一名人員擔任此次信使，信使在送達期間不可執行其他任務。</div>
      <div class="assign-worker-list">${unitRows || '<div class="ui-empty">尚無可用士兵</div>'}</div>
    `;

    this._attachFacilityBack(settlement);

    content.querySelectorAll('.awr-assign:not(.disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        const unitId = Number(btn.dataset.unitId);
        const unit   = allUnits.find(u => u.id === unitId);
        if (!unit) return;
        this._pendingMessengerUnit = unit;
        this._renderSendLetterTypes(settlement);
      });
    });
  }

  /**
   * Show the letter type selector (after messenger is chosen).
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderSendLetterTypes(settlement) {
    const content = document.getElementById('location-content');
    if (!content) return;

    const messenger = this._pendingMessengerUnit;
    const messengerInfo = messenger
      ? `<div class="letter-messenger-badge">✉ 信使：<strong>${messenger.name}</strong>（🏃${messenger.stats?.moveSpeed ?? 5}）</div>`
      : '';

    content.innerHTML = `
      <button class="fac-back-btn" id="letter-back-to-picker">← 重新選擇信使</button>
      <div class="fac-title">📨 派送信件</div>
      ${messengerInfo}
      <div class="letter-intro">選擇要派送的信件類型</div>
      <div class="letter-type-list">
        <div class="letter-type-card" id="letter-type-peace" role="button" tabindex="0">
          <span class="ltc-icon">🕊</span>
          <div class="ltc-info">
            <div class="ltc-name">和平條約</div>
            <div class="ltc-desc">向指定國家提出和談，設定雙方履行的條款</div>
          </div>
          <span class="ltc-arrow">›</span>
        </div>
        <div class="letter-type-card" id="letter-type-condemn" role="button" tabindex="0">
          <span class="ltc-icon">📢</span>
          <div class="ltc-info">
            <div class="ltc-name">譴責信</div>
            <div class="ltc-desc">派使者公開譴責指定國家，惡化雙方關係</div>
          </div>
          <span class="ltc-arrow">›</span>
        </div>
        <div class="letter-type-card" id="letter-type-gift" role="button" tabindex="0">
          <span class="ltc-icon">🎁</span>
          <div class="ltc-info">
            <div class="ltc-name">送禮</div>
            <div class="ltc-desc">贈送金幣給指定國家，改善外交關係</div>
          </div>
          <span class="ltc-arrow">›</span>
        </div>
        <div class="letter-type-card" id="letter-type-war" role="button" tabindex="0">
          <span class="ltc-icon">⚔</span>
          <div class="ltc-info">
            <div class="ltc-name">正式宣戰</div>
            <div class="ltc-desc">正式向指定國家宣戰，可附上宣戰理由</div>
          </div>
          <span class="ltc-arrow">›</span>
        </div>
      </div>
    `;

    document.getElementById('letter-back-to-picker')?.addEventListener('click', () => {
      this._pendingMessengerUnit = null;
      this._renderMessengerPicker(settlement);
    });

    const bind = (id, fn) => {
      const el = document.getElementById(id);
      el?.addEventListener('click', fn);
      el?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
    };
    bind('letter-type-peace',   () => this._renderPeaceTreatyComposer(settlement));
    bind('letter-type-condemn', () => this._renderCondemnComposer(settlement));
    bind('letter-type-gift',    () => this._renderGiftComposer(settlement));
    bind('letter-type-war',     () => this._renderWarDeclarationComposer(settlement));
  }

  /**
   * Lock the pending messenger unit and return messenger dispatch params.
   * Adds the unit to `_messengerUnitIds` so it cannot be double-assigned.
   * @returns {{ messengerUnitId: number|null, messengerAppearance: object|null, messengerMoveSpeed: number }}
   */
  _consumeMessengerUnit() {
    const unit = this._pendingMessengerUnit;
    this._pendingMessengerUnit = null;
    if (!unit) return { messengerUnitId: null, messengerAppearance: null, messengerMoveSpeed: 5 };
    this._messengerUnitIds.add(unit.id);
    return {
      messengerUnitId:      unit.id,
      messengerAppearance:  unit.appearance ?? null,
      messengerMoveSpeed:   unit.stats?.moveSpeed ?? 5,
    };
  }

  /**
   * Release a messenger unit when the missive is delivered (or cancelled).
   * Called from Game.js whenever updateMissives() resolves a missive.
   * @param {object} missive  The resolved missive object (must carry `messengerUnitId`).
   */
  onMissiveDelivered(missive) {
    if (missive?.messengerUnitId != null) {
      this._messengerUnitIds.delete(missive.messengerUnitId);
    }
  }

  /**
   * Render the peace treaty composer form.
   * @param {import('../systems/NationSystem.js').Settlement} fromSettlement
   */
  _renderPeaceTreatyComposer(fromSettlement) {
    const content = document.getElementById('location-content');
    if (!content || !this.diplomacySystem || !this.nationSystem) return;

    const nations = this.nationSystem.nations;
    // Build list of nations (exclude extinct and player).
    const activeNations = nations.filter(n => n && !this.nationSystem.isNationExtinct(n.id));

    const nationOptions = activeNations.map(n =>
      `<option value="${n.id}">${n.name}</option>`
    ).join('');

    if (!nationOptions) {
      content.innerHTML = `
        ${this._facilityBackHTML(fromSettlement)}
        <div class="fac-title">🕊 和平條約</div>
        <div class="ui-empty">目前沒有可和談的國家</div>`;
      this._attachFacilityBack(fromSettlement);
      return;
    }

    // Compute list of player settlements captured from each nation.
    const playerGold = this._getGold();

    content.innerHTML = `
      <button class="fac-back-btn" id="treaty-back">← 返回</button>
      <div class="fac-title">🕊 和平條約</div>
      <div class="treaty-form">

        <div class="treaty-row">
          <label class="treaty-label">目標國家</label>
          <select id="treaty-nation-select" class="treaty-select">${nationOptions}</select>
        </div>

        <div class="treaty-section-title">── 我方條款 ──</div>
        <div class="treaty-row">
          <label class="treaty-label">我方賠償金額 🪙</label>
          <input id="treaty-gold-from-player" type="number" min="0" max="${playerGold}" value="0" class="treaty-input" />
        </div>
        <div class="treaty-row treaty-check-row">
          <label class="treaty-label">承認戰敗</label>
          <input id="treaty-player-defeat" type="checkbox" class="treaty-checkbox" />
        </div>
        <div class="treaty-row">
          <label class="treaty-label">歸還佔領地區（可多選）</label>
          <div id="treaty-cede-player-list" class="treaty-territory-list">
            <div class="treaty-territory-empty">—</div>
          </div>
        </div>

        <div class="treaty-section-title">── 要求對方 ──</div>
        <div class="treaty-row">
          <label class="treaty-label">要求賠償金額 🪙</label>
          <input id="treaty-gold-from-npc" type="number" min="0" value="0" class="treaty-input" />
        </div>
        <div class="treaty-row treaty-check-row">
          <label class="treaty-label">要求承認戰敗</label>
          <input id="treaty-npc-defeat" type="checkbox" class="treaty-checkbox" />
        </div>

        <div class="treaty-note">信使將步行至對方最近的城市，抵達後對方才會評估條約。</div>
        <button class="btn-buy treaty-send-btn" id="treaty-send-btn">📨 派出信使</button>
      </div>
    `;

    document.getElementById('treaty-back')?.addEventListener('click', () => {
      this._renderSendLetter(fromSettlement);
    });

    const updateCedeList = () => {
      const targetId = Number(document.getElementById('treaty-nation-select')?.value ?? -1);
      const listEl = document.getElementById('treaty-cede-player-list');
      if (!listEl) return;

      // Find player-owned settlements that originally belong to the selected nation.
      const cands = [];
      if (this.nationSystem) {
        this.nationSystem.castleSettlements.forEach((s, idx) => {
          if (s.nationId === targetId && s.controllingNationId === _PLAYER_NATION_ID_UI) {
            cands.push({ key: `castle:${idx}`, label: `🏰 ${s.name}` });
          }
        });
        this.nationSystem.villageSettlements.forEach((s, idx) => {
          if (s.nationId === targetId && s.controllingNationId === _PLAYER_NATION_ID_UI) {
            cands.push({ key: `village:${idx}`, label: `🏘 ${s.name}` });
          }
        });
      }

      if (cands.length === 0) {
        listEl.innerHTML = '<div class="treaty-territory-empty">（無可歸還地區）</div>';
      } else {
        listEl.innerHTML = cands.map(c =>
          `<label class="treaty-territory-item">
            <input type="checkbox" class="treaty-cede-chk" data-key="${c.key}" />
            ${c.label}
          </label>`
        ).join('');
      }
    };

    document.getElementById('treaty-nation-select')?.addEventListener('change', updateCedeList);
    updateCedeList();

    document.getElementById('treaty-send-btn')?.addEventListener('click', () => {
      const targetId = Number(document.getElementById('treaty-nation-select')?.value ?? -1);
      if (targetId < 0) { this._toast('請選擇目標國家'); return; }

      const goldFromPlayer = Math.max(0, Number(document.getElementById('treaty-gold-from-player')?.value ?? 0));
      const goldFromNpc    = Math.max(0, Number(document.getElementById('treaty-gold-from-npc')?.value    ?? 0));
      const playerDefeat   = document.getElementById('treaty-player-defeat')?.checked ?? false;
      const npcDefeat      = document.getElementById('treaty-npc-defeat')?.checked    ?? false;

      if (goldFromPlayer > playerGold) {
        this._toast('💸 金幣不足，無法完成約定的賠償！'); return;
      }

      const cededBySender = [];
      document.querySelectorAll('.treaty-cede-chk:checked').forEach(chk => {
        cededBySender.push(chk.dataset.key);
      });

      const terms = {
        goldFromSender:          goldFromPlayer,
        goldFromNpc:             goldFromNpc,
        playerAcknowledgesDefeat: playerDefeat,
        npcAcknowledgesDefeat:   npcDefeat,
        cededBySender,
        cededByReceiver: [],
      };

      const ok = this.diplomacySystem.sendPeaceTreaty({
        senderNationId:   _PLAYER_NATION_ID_UI,
        receiverNationId: targetId,
        fromSettlement:   fromSettlement,
        terms,
        ...this._consumeMessengerUnit(),
      });

      if (ok) {
        const nation = this.nationSystem.nations[targetId];
        this._addInboxMessage('🕊', `已派出和談信使前往 ${nation?.name ?? '對方'}，請等候回音。`);
        // Return to the Send Letter screen.
        this._renderSendLetter(fromSettlement);
      } else {
        this._toast('⚠ 無法派出信使（找不到目標位置）');
      }
    });
  }

  /**
   * Render the condemnation letter composer.
   * @param {import('../systems/NationSystem.js').Settlement} fromSettlement
   */
  _renderCondemnComposer(fromSettlement) {
    const content = document.getElementById('location-content');
    if (!content || !this.diplomacySystem || !this.nationSystem) return;

    const activeNations = this.nationSystem.nations.filter(n => n && !this.nationSystem.isNationExtinct(n.id));
    const nationOptions = activeNations.map(n => `<option value="${n.id}">${n.name}</option>`).join('');

    if (!nationOptions) {
      content.innerHTML = `${this._facilityBackHTML(fromSettlement)}<div class="fac-title">📢 譴責信</div><div class="ui-empty">目前沒有可譴責的國家</div>`;
      this._attachFacilityBack(fromSettlement);
      return;
    }

    content.innerHTML = `
      <button class="fac-back-btn" id="condemn-back">← 返回</button>
      <div class="fac-title">📢 譴責信</div>
      <div class="treaty-form">
        <div class="treaty-row">
          <label class="treaty-label">目標國家</label>
          <select id="condemn-nation-select" class="treaty-select">${nationOptions}</select>
        </div>
        <div class="treaty-note">信使將步行至對方城市，信件送達後雙方關係將惡化，對方盟友也可能受到影響。</div>
        <button class="btn-buy treaty-send-btn" id="condemn-send-btn">📢 派出信使</button>
      </div>
    `;

    document.getElementById('condemn-back')?.addEventListener('click', () => this._renderSendLetter(fromSettlement));
    document.getElementById('condemn-send-btn')?.addEventListener('click', () => {
      const targetId = Number(document.getElementById('condemn-nation-select')?.value ?? -1);
      if (targetId < 0) { this._toast('請選擇目標國家'); return; }

      const ok = this.diplomacySystem.sendCondemnationLetter({ receiverNationId: targetId, fromSettlement, ...this._consumeMessengerUnit() });
      if (ok) {
        const nation = this.nationSystem.nations[targetId];
        this._addInboxMessage('📢', `已派出信使前往 ${nation?.name ?? '對方'}送達譴責信。`);
        this._renderSendLetter(fromSettlement);
      } else {
        this._toast('⚠ 無法派出信使（找不到目標位置）');
      }
    });
  }

  /**
   * Render the gift letter composer.
   * @param {import('../systems/NationSystem.js').Settlement} fromSettlement
   */
  _renderGiftComposer(fromSettlement) {
    const content = document.getElementById('location-content');
    if (!content || !this.diplomacySystem || !this.nationSystem) return;

    const activeNations = this.nationSystem.nations.filter(n => n && !this.nationSystem.isNationExtinct(n.id));
    const nationOptions = activeNations.map(n => `<option value="${n.id}">${n.name}</option>`).join('');
    const playerGold    = this._getGold();

    if (!nationOptions) {
      content.innerHTML = `${this._facilityBackHTML(fromSettlement)}<div class="fac-title">🎁 送禮</div><div class="ui-empty">目前沒有可送禮的國家</div>`;
      this._attachFacilityBack(fromSettlement);
      return;
    }

    content.innerHTML = `
      <button class="fac-back-btn" id="gift-back">← 返回</button>
      <div class="fac-title">🎁 送禮</div>
      <div class="treaty-form">
        <div class="treaty-row">
          <label class="treaty-label">目標國家</label>
          <select id="gift-nation-select" class="treaty-select">${nationOptions}</select>
        </div>
        <div class="treaty-row">
          <label class="treaty-label">贈送金幣數量 🪙</label>
          <input id="gift-gold-input" type="number" min="1" max="${playerGold}" value="50" class="treaty-input" />
        </div>
        <div class="treaty-note">信使送達後，對方將收到禮物，雙方關係依贈送金額改善（每 20 🪙 約 +1 關係）。目前持有：🪙${playerGold}</div>
        <button class="btn-buy treaty-send-btn" id="gift-send-btn">🎁 派出信使</button>
      </div>
    `;

    document.getElementById('gift-back')?.addEventListener('click', () => this._renderSendLetter(fromSettlement));
    document.getElementById('gift-send-btn')?.addEventListener('click', () => {
      const targetId  = Number(document.getElementById('gift-nation-select')?.value ?? -1);
      const goldInput = Math.max(1, Number(document.getElementById('gift-gold-input')?.value ?? 0));
      if (targetId < 0) { this._toast('請選擇目標國家'); return; }
      if (goldInput > this._getGold()) { this._toast('💸 持有金幣不足！'); return; }

      // Deduct gold immediately when the messenger departs.
      this._spendGold(goldInput);
      this._refreshGoldDisplay();

      const ok = this.diplomacySystem.sendGiftLetter({ receiverNationId: targetId, fromSettlement, goldAmount: goldInput, ...this._consumeMessengerUnit() });
      if (ok) {
        const nation = this.nationSystem.nations[targetId];
        this._addInboxMessage('🎁', `已派出信使攜帶 🪙${goldInput} 前往 ${nation?.name ?? '對方'}。`);
        this._renderSendLetter(fromSettlement);
      } else {
        // Refund if we couldn't send
        this._addGold(goldInput);
        this._refreshGoldDisplay();
        this._toast('⚠ 無法派出信使（找不到目標位置）');
      }
    });
  }

  /**
   * Render the formal war declaration composer.
   * @param {import('../systems/NationSystem.js').Settlement} fromSettlement
   */
  _renderWarDeclarationComposer(fromSettlement) {
    const content = document.getElementById('location-content');
    if (!content || !this.diplomacySystem || !this.nationSystem) return;

    const activeNations = this.nationSystem.nations.filter(n => n && !this.nationSystem.isNationExtinct(n.id));
    const nationOptions = activeNations.map(n => `<option value="${n.id}">${n.name}</option>`).join('');

    if (!nationOptions) {
      content.innerHTML = `${this._facilityBackHTML(fromSettlement)}<div class="fac-title">⚔ 正式宣戰</div><div class="ui-empty">目前沒有可宣戰的國家</div>`;
      this._attachFacilityBack(fromSettlement);
      return;
    }

    const reasonOptions = [
      { value: '',        label: '（無正當理由）' },
      { value: '保護同盟', label: '保護同盟' },
      { value: '奪回失土', label: '奪回失土' },
      { value: '資源糾紛', label: '資源糾紛' },
      { value: '擴張領土', label: '擴張領土' },
      { value: '復仇雪恥', label: '復仇雪恥' },
    ].map(r => `<option value="${r.value}">${r.label}</option>`).join('');

    content.innerHTML = `
      <button class="fac-back-btn" id="war-decl-back">← 返回</button>
      <div class="fac-title">⚔ 正式宣戰</div>
      <div class="treaty-form">
        <div class="treaty-row">
          <label class="treaty-label">宣戰對象</label>
          <select id="war-decl-nation-select" class="treaty-select">${nationOptions}</select>
        </div>
        <div class="treaty-row">
          <label class="treaty-label">宣戰理由</label>
          <select id="war-decl-reason-select" class="treaty-select">${reasonOptions}</select>
        </div>
        <div class="treaty-note war-decl-note">信使送達後，正式宣戰生效。<br>有正當理由時，對第三方國家的關係影響較小；無理由則被視為侵略，各國關係將顯著惡化。</div>
        <button class="btn-buy treaty-send-btn war-send-btn" id="war-decl-send-btn">⚔ 派出宣戰使者</button>
      </div>
    `;

    document.getElementById('war-decl-back')?.addEventListener('click', () => this._renderSendLetter(fromSettlement));
    document.getElementById('war-decl-send-btn')?.addEventListener('click', () => {
      const targetId = Number(document.getElementById('war-decl-nation-select')?.value ?? -1);
      const reason   = document.getElementById('war-decl-reason-select')?.value ?? '';
      if (targetId < 0) { this._toast('請選擇宣戰對象'); return; }

      const ok = this.diplomacySystem.sendWarDeclaration({ receiverNationId: targetId, fromSettlement, reason, ...this._consumeMessengerUnit() });
      if (ok) {
        const nation = this.nationSystem.nations[targetId];
        const reasonStr = reason ? `（理由：${reason}）` : '（無理由）';
        this._addInboxMessage('⚔', `已派出宣戰使者前往 ${nation?.name ?? '對方'}${reasonStr}，等待送達。`);
        this._renderSendLetter(fromSettlement);
      } else {
        this._toast('⚠ 無法派出使者（找不到目標位置）');
      }
    });
  }

  // -------------------------------------------------------------------------
  // Peace offer callbacks (called from Game.js via updateMissives results)
  // -------------------------------------------------------------------------

  /**
   * Called when an NPC peace missive arrives at a player settlement.
   * Adds a special inbox entry with Accept / Ignore buttons.
   * @param {{ senderNationId: number, terms: object }} missive
   */
  onPeaceOfferReceived(missive) {
    const { senderNationId, terms } = missive;
    const nation = this.nationSystem?.nations[senderNationId];
    const nationName = nation?.name ?? '未知國家';

    const goldOffer = terms.goldFromNpc ?? 0;
    let termsList = [];
    if (goldOffer > 0) termsList.push(`賠償 🪙${goldOffer}`);
    if (terms.npcAcknowledgesDefeat) termsList.push('承認戰敗');
    if (!termsList.length) termsList.push('停止敵對行動');
    const termsStr = termsList.join('、');

    const day = this.diplomacySystem?._currentDay ?? 0;
    const time = this._dayNightCycle?.getTimeString() ?? '';

    this._inbox.unshift({
      icon:           '🕊',
      text:           `${nationName} 提出和平條約：${termsStr}`,
      day,
      time,
      read:           false,
      isPeaceOffer:   true,
      responded:      false,
      senderNationId,
      terms,
    });
    if (this._inbox.length > GameUI._MAX_INBOX) {
      this._inbox.length = GameUI._MAX_INBOX;
    }
    this._inboxUnread = this._inbox.filter(m => !m.read).length;
    this._updateInboxBadge();
    this._toast(`🕊 ${nationName} 派出使者提出和平條約！`);
    if (this._activePanel === 'inbox') this._renderInbox();
  }

  /**
   * Called when an NPC responds to a player-sent peace treaty.
   * @param {{ senderNationId: number, receiverNationId: number, terms: object }} missive
   * @param {boolean} accepted
   */
  onPeaceTreatyResponse(missive, accepted) {
    const { receiverNationId, terms } = missive;
    const nation = this.nationSystem?.nations[receiverNationId];
    const nationName = nation?.name ?? '對方';

    if (accepted) {
      const { playerGoldGain, structureRebuildNeeded } =
        this.diplomacySystem.applyPeaceTreaty(_PLAYER_NATION_ID_UI, receiverNationId, terms);

      if (playerGoldGain > 0) this._addGold(playerGoldGain);
      else if (playerGoldGain < 0) this._spendGold(-playerGoldGain);

      // Sync settlement ownership flags for any ceded territories.
      if (structureRebuildNeeded) {
        this._syncSettlementOwnership();
      }

      this._refreshGoldDisplay();
      this._addInboxMessage('✅', `${nationName} 接受了和平條約，雙方停戰！`);
      if (this._activePanel === 'nations') this._renderDiplomacy();
    } else {
      this._addInboxMessage('❌', `${nationName} 拒絕了和平條約。`);
    }
  }

  /**
   * Player accepts or ignores an NPC peace offer from the inbox.
   * @param {number} inboxIdx  Index into `_inbox`.
   * @param {boolean} accept
   */
  _respondToPeaceOffer(inboxIdx, accept) {
    const entry = this._inbox[inboxIdx];
    if (!entry || !entry.isPeaceOffer || entry.responded) return;
    entry.responded = true;
    entry.read = true;

    if (accept) {
      const { playerGoldGain, structureRebuildNeeded } =
        this.diplomacySystem.applyPeaceTreaty(entry.senderNationId, _PLAYER_NATION_ID_UI, entry.terms);

      if (playerGoldGain > 0) this._addGold(playerGoldGain);
      else if (playerGoldGain < 0) this._spendGold(-playerGoldGain);

      if (structureRebuildNeeded) {
        this._syncSettlementOwnership();
        if (typeof this.onCaptureSettlement === 'function') this.onCaptureSettlement();
      }

      this._refreshGoldDisplay();
      const nation = this.nationSystem?.nations[entry.senderNationId];
      this._addInboxMessage('✅', `你接受了 ${nation?.name ?? '對方'} 的和平條約，雙方停戰！`);
      if (this._activePanel === 'nations') this._renderDiplomacy();
    } else {
      this._addInboxMessage('📨', `你無視了和平條約請求。`);
    }
    this._renderInbox();
  }

  // -------------------------------------------------------------------------
  // NPC proactive diplomacy toward player
  // -------------------------------------------------------------------------

  /**
   * Called when an NPC trade-route request missive arrives at a player settlement.
   * Adds an inbox entry with Accept / Decline buttons.
   * @param {{ senderNationId: number }} missive
   */
  onNpcTradeRequest(missive) {
    const { senderNationId } = missive;
    const nation = this.nationSystem?.nations[senderNationId];
    const nationName = nation?.name ?? '未知國家';
    const day  = this.diplomacySystem?._currentDay ?? 0;
    const time = this._dayNightCycle?.getTimeString() ?? '';

    this._inbox.unshift({
      icon:             '🛤',
      text:             `${nationName} 的使者抵達，希望與你建立貿易路線。`,
      day, time,
      read:             false,
      isTradeRequest:   true,
      responded:        false,
      senderNationId,
    });
    if (this._inbox.length > GameUI._MAX_INBOX) this._inbox.length = GameUI._MAX_INBOX;
    this._inboxUnread = this._inbox.filter(m => !m.read).length;
    this._updateInboxBadge();
    this._toast(`🛤 ${nationName} 派使者前來商討貿易路線！`);
    if (this._activePanel === 'inbox') this._renderInbox();
  }

  /**
   * Player responds to an NPC trade-route request.
   * @param {number} inboxIdx
   * @param {boolean} accept
   */
  _respondToTradeRequest(inboxIdx, accept) {
    const entry = this._inbox[inboxIdx];
    if (!entry || !entry.isTradeRequest || entry.responded) return;
    entry.responded = true;
    entry.read = true;

    const nation = this.nationSystem?.nations[entry.senderNationId];
    const nationName = nation?.name ?? '對方';

    if (accept) {
      if (!this.diplomacySystem || !this.nationSystem) {
        this._addInboxMessage('❌', '系統尚未就緒，無法建立貿易路線。');
        this._renderInbox();
        return;
      }
      // Find a player-controlled destination settlement for the caravan to visit.
      const playerSettlements = [];
      this.nationSystem.castleSettlements.forEach(s => {
        if (s.controllingNationId === _PLAYER_NATION_ID_UI) playerSettlements.push(s);
      });
      this.nationSystem.villageSettlements.forEach(s => {
        if (s.controllingNationId === _PLAYER_NATION_ID_UI) playerSettlements.push(s);
      });

      if (playerSettlements.length === 0) {
        this._addInboxMessage('❌', `${nationName} 同意建立貿易路線，但你尚未佔領任何城市，無法接待商隊。`);
        this._renderInbox();
        return;
      }

      // Establish the route; use a standard daily income.
      this.diplomacySystem.openTradeRoute(entry.senderNationId, _PLAYER_NATION_ID_UI, TRADE_ROUTE_DAILY_INCOME);
      this.diplomacySystem.modifyPlayerRelation(entry.senderNationId, 5);
      this._addInboxMessage('🛤', `與 ${nationName} 建立了貿易路線！每日 +${TRADE_ROUTE_DAILY_INCOME} 🪙，關係 +5。`);
      if (this._activePanel === 'nations') this._renderDiplomacy();
    } else {
      if (this.diplomacySystem) {
        const delta = -(3 + Math.floor(Math.random() * 4));
        this.diplomacySystem.modifyPlayerRelation(entry.senderNationId, delta);
      }
      this._addInboxMessage('❌', `拒絕了 ${nationName} 的貿易路線請求，關係略微惡化。`);
    }
    this._renderInbox();
  }

  /**
   * Called when an NPC NAP proposal missive arrives at a player settlement.
   * @param {{ senderNationId: number }} missive
   */
  onNpcNapProposal(missive) {
    const { senderNationId } = missive;
    const nation = this.nationSystem?.nations[senderNationId];
    const nationName = nation?.name ?? '未知國家';
    const day  = this.diplomacySystem?._currentDay ?? 0;
    const time = this._dayNightCycle?.getTimeString() ?? '';

    this._inbox.unshift({
      icon:            '☮',
      text:            `${nationName} 提議與你簽署互不侵犯條約（NAP），雙方承諾不主動宣戰。`,
      day, time,
      read:            false,
      isNapProposal:   true,
      responded:       false,
      senderNationId,
    });
    if (this._inbox.length > GameUI._MAX_INBOX) this._inbox.length = GameUI._MAX_INBOX;
    this._inboxUnread = this._inbox.filter(m => !m.read).length;
    this._updateInboxBadge();
    this._toast(`☮ ${nationName} 提議簽署互不侵犯條約！`);
    if (this._activePanel === 'inbox') this._renderInbox();
  }

  /**
   * Player responds to an NPC NAP proposal.
   * @param {number} inboxIdx
   * @param {boolean} accept
   */
  _respondToNapProposal(inboxIdx, accept) {
    const entry = this._inbox[inboxIdx];
    if (!entry || !entry.isNapProposal || entry.responded) return;
    entry.responded = true;
    entry.read = true;

    const nation = this.nationSystem?.nations[entry.senderNationId];
    const nationName = nation?.name ?? '對方';

    if (accept) {
      if (this.diplomacySystem) {
        // signNonAggressionPact already applies +10 relation.
        this.diplomacySystem.signNonAggressionPact(entry.senderNationId, _PLAYER_NATION_ID_UI);
      }
      this._addInboxMessage('☮', `你接受了 ${nationName} 的互不侵犯條約！雙方關係改善 +10。`);
      if (this._activePanel === 'nations') this._renderDiplomacy();
    } else {
      if (this.diplomacySystem) {
        const delta = -(5 + Math.floor(Math.random() * 6));
        this.diplomacySystem.modifyPlayerRelation(entry.senderNationId, delta);
      }
      this._addInboxMessage('❌', `拒絕了 ${nationName} 的互不侵犯條約，對方感到失望，關係惡化。`);
    }
    this._renderInbox();
  }

  /**
   * Called when an NPC MPP proposal missive arrives at a player settlement.
   * @param {{ senderNationId: number }} missive
   */
  onNpcMppProposal(missive) {
    const { senderNationId } = missive;
    const nation = this.nationSystem?.nations[senderNationId];
    const nationName = nation?.name ?? '未知國家';
    const day  = this.diplomacySystem?._currentDay ?? 0;
    const time = this._dayNightCycle?.getTimeString() ?? '';

    this._inbox.unshift({
      icon:            '🛡',
      text:            `${nationName} 提議與你締結互保條約（MPP），任一方遭受攻擊時雙方共同作戰。`,
      day, time,
      read:            false,
      isMppProposal:   true,
      responded:       false,
      senderNationId,
    });
    if (this._inbox.length > GameUI._MAX_INBOX) this._inbox.length = GameUI._MAX_INBOX;
    this._inboxUnread = this._inbox.filter(m => !m.read).length;
    this._updateInboxBadge();
    this._toast(`🛡 ${nationName} 提議締結互保條約！`);
    if (this._activePanel === 'inbox') this._renderInbox();
  }

  /**
   * Player responds to an NPC MPP proposal.
   * @param {number} inboxIdx
   * @param {boolean} accept
   */
  _respondToMppProposal(inboxIdx, accept) {
    const entry = this._inbox[inboxIdx];
    if (!entry || !entry.isMppProposal || entry.responded) return;
    entry.responded = true;
    entry.read = true;

    const nation = this.nationSystem?.nations[entry.senderNationId];
    const nationName = nation?.name ?? '對方';

    if (accept) {
      if (this.diplomacySystem) {
        // signMutualProtectionPact already applies +20 relation.
        this.diplomacySystem.signMutualProtectionPact(entry.senderNationId, _PLAYER_NATION_ID_UI);
      }
      this._addInboxMessage('🛡', `你接受了 ${nationName} 的互保條約！雙方關係改善 +20。`);
      if (this._activePanel === 'nations') this._renderDiplomacy();
    } else {
      if (this.diplomacySystem) {
        const delta = -(8 + Math.floor(Math.random() * 8));
        this.diplomacySystem.modifyPlayerRelation(entry.senderNationId, delta);
      }
      this._addInboxMessage('❌', `拒絕了 ${nationName} 的互保條約，對方感到失望，關係惡化。`);
    }
    this._renderInbox();
  }

  /**
   * Called when an NPC goodwill gift messenger arrives.
   * Gold is automatically credited; no player decision needed.
   * @param {{ senderNationId: number }} missive
   * @param {number} gold   Amount of gold received.
   * @param {number} relDelta  Relation improvement already applied by DiplomacySystem.
   */
  onNpcGiftDelivered(missive, gold, relDelta) {
    const { senderNationId } = missive;
    const nation = this.nationSystem?.nations[senderNationId];
    const nationName = nation?.name ?? '未知國家';

    // Credit the player's treasury.
    if (gold > 0) this._addGold(gold);
    this._refreshGoldDisplay();

    this._addInboxMessage('🎁', `${nationName} 贈送了 🪙${gold} 作為友誼禮物！關係改善 +${relDelta}。`);
    this._toast(`🎁 ${nationName} 送來禮物 🪙${gold}！`);
    if (this._activePanel === 'inbox') this._renderInbox();
  }

  /**
   * Generate enemy force stats from a settlement.
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _generateEnemyForce(settlement) {
    const ruler = settlement.ruler;
    const econ  = settlement.economyLevel;
    const isCastle = settlement.type === 'castle';

    // If the diplomacy system has garrison data for this settlement, derive
    // the enemy force from the actual NPC armies (makes battles dynamic).
    if (this.diplomacySystem) {
      const key = this._settlementKey(settlement);
      if (key) {
        const armies = this.diplomacySystem.getNpcArmies(key);
        const allUnits = armies.flatMap(sq => sq);
        if (allUnits.length > 0) {
          const totalAtk = allUnits.reduce((s, u) => s + u.stats.attack,  0);
          const totalDef = allUnits.reduce((s, u) => s + u.stats.defense, 0);
          const morSum   = allUnits.reduce((s, u) => s + u.stats.morale,  0);
          const totalHp  = allUnits.reduce((s, u) => s + u.stats.hp,      0);
          const maxHp    = allUnits.reduce((s, u) => s + u.stats.maxHp,   0);
          return {
            name:       ruler.name,
            role:       ruler.role,
            troopCount: allUnits.length,
            attack:     totalAtk,
            defense:    totalDef,
            morale:     Math.round(morSum / allUnits.length),
            hp:         Math.max(1, totalHp),
            maxHp:      Math.max(1, maxHp),
          };
        }
      }
    }

    // Fallback: generate based on ruler stats (used for player-owned settlements
    // or settlements whose garrison has not been initialised yet).
    const troopCount = isCastle ? 4 + econ : 2 + Math.ceil(econ / 2);
    const multiplier = 1 + troopCount * 0.3 + econ * 0.05;

    const attack  = Math.floor(ruler.stats.attack  * multiplier);
    const defense = Math.floor(ruler.stats.defense * multiplier);
    const maxHp   = Math.floor((ruler.stats.defense + troopCount * 4) * 10 + econ * 15);

    return {
      name:  ruler.name,
      role:  ruler.role,
      troopCount,
      attack,
      defense,
      morale: ruler.stats.morale,
      hp:     maxHp,
      maxHp,
    };
  }

  /**
   * Calculate player force from a set of squad IDs.
   * @param {number[]} squadIds
   */
  _calculatePlayerForce(squadIds) {
    const squads  = this.army.getSquads().filter(s => squadIds.includes(s.id));
    // Only active, able-bodied units (hp > 0) participate.
    const members = squads.flatMap(s => s.members.filter(m => m.active && m.stats.hp > 0));

    const totalAtk   = members.reduce((sum, m) => sum + m.stats.attack,  0);
    const totalDef   = members.reduce((sum, m) => sum + m.stats.defense, 0);
    const moraleSum  = members.reduce((sum, m) => sum + m.stats.morale,  0);
    const avgMor     = members.length > 0 ? Math.round(moraleSum / members.length) : 0;
    const totalHp    = members.reduce((sum, m) => sum + m.stats.hp,      0);
    const totalMaxHp = members.reduce((sum, m) => sum + m.stats.maxHp,   0);

    return {
      memberCount: members.length,
      attack:  totalAtk,
      defense: totalDef,
      morale:  avgMor,
      hp:      Math.max(1, totalHp),
      maxHp:   Math.max(1, totalMaxHp),
      members,
    };
  }

  /** Open the battle preview dialog for a settlement. */
  _openBattlePreview(settlement) {
    if (!settlement || (settlement.type !== 'castle' && settlement.type !== 'village')) return;

    this._battleSettlement = settlement;
    this._selectedSquadIds = [0]; // default: squad 0 selected

    const overlay = document.getElementById('battle-preview-overlay');
    if (!overlay) return;
    this._renderBattlePreview();
    overlay.classList.add('visible');
  }

  _renderBattlePreview() {
    const settlement = this._battleSettlement;
    if (!settlement) return;

    const enemy      = this._generateEnemyForce(settlement);
    const squads     = this.army.getSquads();
    const selectedIds = this._selectedSquadIds;

    const typeLabel = settlement.type === 'castle' ? '城堡' : '村落';
    const nation    = this.nationSystem ? this.nationSystem.getControllingNation(settlement) : null;
    const nationBadge = nation
      ? `<span class="bpv-nation" style="color:${nation.color}">${nation.emblem} ${nation.name}</span>`
      : '';

    const squadSelHTML = squads.map(sq => {
      const active   = sq.members.filter(m => m.active);
      const totalPow = active.reduce((s, m) => s + m.stats.attack + m.stats.defense, 0);
      const sel      = selectedIds.includes(sq.id);
      return `
        <div class="bpv-squad-row${sel ? ' selected' : ''}" data-squad-id="${sq.id}" role="button" tabindex="0">
          <span class="bpv-sq-check">${sel ? '✅' : '⬜'}</span>
          <span class="bpv-sq-name">小隊 ${sq.id + 1}${sq.isPlayerSquad ? ' (主角)' : ''}</span>
          <span class="bpv-sq-count">${active.length} 名參戰</span>
          <span class="bpv-sq-power">戰力 ${totalPow}</span>
        </div>`;
    }).join('');

    const playerForce = this._calculatePlayerForce(selectedIds);

    const body = document.getElementById('battle-preview-body');
    body.innerHTML = `
      <div class="bpv-section">
        <div class="bpv-section-title">👁 敵軍情報</div>
        <div class="bpv-enemy-banner">
          <div class="bpv-enemy-icon">🏴</div>
          <div class="bpv-enemy-info">
            <div class="bpv-enemy-name">${enemy.name}<span class="bpv-enemy-role">${enemy.role}</span></div>
            <div class="bpv-enemy-meta">${typeLabel} ${nationBadge}</div>
          </div>
        </div>
        <div class="bpv-enemy-stats">
          <div class="bpv-stat"><span>兵力</span><strong>${enemy.troopCount} 隊</strong></div>
          <div class="bpv-stat"><span>攻擊</span><strong>${enemy.attack}</strong></div>
          <div class="bpv-stat"><span>防禦</span><strong>${enemy.defense}</strong></div>
          <div class="bpv-stat"><span>士氣</span><strong>${enemy.morale}</strong></div>
        </div>
      </div>
      <div class="bpv-section">
        <div class="bpv-section-title">🎖 派遣隊伍</div>
        <div class="bpv-squad-list">${squadSelHTML}</div>
        <div class="bpv-player-summary">
          我方派遣：${playerForce.memberCount} 人　攻擊 ${playerForce.attack}　防禦 ${playerForce.defense}
        </div>
      </div>
      <div class="bpv-actions">
        <button id="btn-bpv-cancel" class="btn-bpv-cancel">✕ 取消</button>
        <button id="btn-bpv-start" class="btn-bpv-start"${playerForce.memberCount === 0 ? ' disabled' : ''}>⚔ 開戰！</button>
      </div>
    `;

    // Squad selection toggle
    body.querySelectorAll('.bpv-squad-row').forEach(row => {
      const toggle = () => {
        const id = Number(row.dataset.squadId);
        if (this._selectedSquadIds.includes(id)) {
          this._selectedSquadIds = this._selectedSquadIds.filter(x => x !== id);
        } else {
          this._selectedSquadIds.push(id);
        }
        this._renderBattlePreview();
      };
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });

    body.querySelector('#btn-bpv-cancel').addEventListener('click', () => this._closeBattlePreview());
    body.querySelector('#btn-bpv-start').addEventListener('click', () => {
      if (playerForce.memberCount > 0) {
        this._startBattle(settlement, this._selectedSquadIds);
      }
    });
  }

  _closeBattlePreview() {
    document.getElementById('battle-preview-overlay')?.classList.remove('visible');
    this._battleSettlement = null;
    this._selectedSquadIds = [];
  }

  // -------------------------------------------------------------------------
  // Battle scene
  // -------------------------------------------------------------------------

  /**
   * Start a battle: close preview, build state, open battle scene.
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @param {number[]} selectedSquadIds
   */
  _startBattle(settlement, selectedSquadIds) {
    this._closeBattlePreview();

    const enemy  = this._generateEnemyForce(settlement);
    const player = this._calculatePlayerForce(selectedSquadIds);

    this._battleState = {
      settlement,
      player,
      enemy,
      round:            0,
      log:              ['⚔ 戰鬥開始！雙方列陣，準備開戰…'],
      finished:         false,
      result:           null,
      diplomacyApplied: false,
      plundered:        false,
    };

    const overlay = document.getElementById('battle-scene-overlay');
    if (!overlay) return;

    const theme = _BATTLE_THEMES[settlement.type] ?? _BATTLE_THEMES.grass;
    overlay.style.setProperty('--battle-bg', theme.bg);

    this._renderBattleScene();
    overlay.classList.add('visible');
  }

  _renderBattleScene() {
    const state = this._battleState;
    if (!state) return;

    const { settlement, player, enemy, round, log, finished, result } = state;
    const theme = _BATTLE_THEMES[settlement.type] ?? _BATTLE_THEMES.grass;

    document.getElementById('battle-scene-terrain-name').textContent = theme.name;
    document.getElementById('battle-scene-round-label').textContent  = `第 ${round} 回合`;

    // HP bars
    const enemyPct  = Math.max(0, Math.round(enemy.hp  / enemy.maxHp  * 100));
    const playerPct = Math.max(0, Math.round(player.hp / player.maxHp * 100));
    document.getElementById('battle-enemy-hp-bar').style.width  = `${enemyPct}%`;
    document.getElementById('battle-player-hp-bar').style.width = `${playerPct}%`;
    document.getElementById('battle-scene-vs').textContent =
      `敵 ${Math.round(enemy.hp)}/${enemy.maxHp}  ⚔  我 ${Math.round(player.hp)}/${player.maxHp}`;

    // Enemy unit row – build DOM structure once, then only toggle btl-fallen classes
    const enemyRowEl  = document.getElementById('battle-enemy-row');
    const playerRowEl = document.getElementById('battle-player-row');

    if (!state._unitRowsRendered) {
      const enemyIcons = [
        `<span class="btl-unit-enemy btl-leader" data-btl-leader title="${enemy.name} ${enemy.role}">👑</span>`,
        ...Array.from({ length: enemy.troopCount }, (_, i) =>
          `<span class="btl-unit-enemy" data-btl-enemy-idx="${i}">⚔</span>`
        ),
      ];
      enemyRowEl.innerHTML =
        `<div class="btl-row-label">敵軍陣列</div><div class="btl-unit-row">${enemyIcons.join('')}</div>`;

      const memberIcons = player.members.map((m, idx) => {
        const charHtml = m.appearance ? renderCharHTML(m.appearance, 28) : '👤';
        return `<span class="btl-unit-player" data-btl-player-idx="${idx}" title="${m.name}">${charHtml}</span>`;
      });
      playerRowEl.innerHTML =
        `<div class="btl-unit-row">${memberIcons.join('')}</div><div class="btl-row-label">我方陣列</div>`;

      state._unitRowsRendered = true;
    }

    // Update fallen state for enemy units
    const enemyAlive = Math.max(0, Math.ceil(enemy.troopCount * enemyPct / 100));
    const leaderEl = enemyRowEl.querySelector('[data-btl-leader]');
    if (leaderEl) leaderEl.classList.toggle('btl-fallen', enemyPct === 0);
    enemyRowEl.querySelectorAll('[data-btl-enemy-idx]').forEach(el => {
      const i = parseInt(el.dataset.btlEnemyIdx, 10);
      el.classList.toggle('btl-fallen', i >= enemyAlive);
    });

    // Update fallen state for player units
    const aliveCount = Math.ceil(player.memberCount * playerPct / 100);
    playerRowEl.querySelectorAll('[data-btl-player-idx]').forEach(el => {
      const idx   = parseInt(el.dataset.btlPlayerIdx, 10);
      const alive = idx < aliveCount;
      el.classList.toggle('btl-fallen', !alive);
      const m = player.members[idx];
      if (m) el.title = m.name + (alive ? '' : ' (陣亡)');
    });

    // Battle log (last 3 lines)
    document.getElementById('battle-scene-log').innerHTML =
      log.slice(-3).map(l => `<div class="btl-log-line">${l}</div>`).join('');

    // Command buttons or result banner
    const actionsEl = document.getElementById('battle-scene-actions');
    if (finished) {
      const resultMeta = {
        victory: { icon: '🏆', label: '大勝！',  cls: 'btl-result-victory' },
        defeat:  { icon: '💀', label: '落敗…',   cls: 'btl-result-defeat'  },
        draw:    { icon: '🤝', label: '平局',     cls: 'btl-result-draw'   },
        retreat: { icon: '🏃', label: '撤退',     cls: 'btl-result-retreat'},
      };
      const r = resultMeta[result] ?? resultMeta.retreat;
      const alreadyCaptured   = result === 'victory' && this.isPlayerSettlement(settlement);
      const isNeutralTarget   = result === 'victory' && settlement.controllingNationId === NEUTRAL_NATION_ID;
      const alreadyPlundered  = result === 'victory' && state.plundered;
      // An "alreadyLiberated" badge is no longer shown for neutral targets –
      // instead the player may choose to Govern or Plunder even if they
      // previously liberated the settlement.

      let victoryActions = '';
      if (result === 'victory') {
        if (alreadyCaptured) {
          victoryActions = `<div class="btl-captured-badge">🏴 已佔領</div>`;
        } else if (alreadyPlundered) {
          victoryActions = `<div class="btl-captured-badge">💰 已掠奪</div>`;
        } else if (isNeutralTarget) {
          // Neutral territory: offer Govern or Plunder (no Liberate – already neutral)
          victoryActions = `
            <button id="btn-battle-govern"  class="btn-battle-capture">🏰 統治</button>
            <button id="btn-battle-plunder" class="btn-battle-plunder">💰 掠奪</button>`;
        } else {
          victoryActions = `
            <button id="btn-battle-capture"  class="btn-battle-capture">🏴 佔領</button>
            <button id="btn-battle-plunder"  class="btn-battle-plunder">💰 掠奪</button>
            <button id="btn-battle-liberate" class="btn-battle-liberate">🕊 解放</button>`;
        }
      }

      actionsEl.innerHTML = `
        <div class="btl-result ${r.cls}">${r.icon} ${r.label}</div>
        ${victoryActions}
        <button id="btn-battle-exit" class="btn-battle-exit">離開戰場</button>`;

      if (result === 'victory' && !alreadyCaptured && !alreadyPlundered) {
        if (isNeutralTarget) {
          actionsEl.querySelector('#btn-battle-govern')?.addEventListener('click', () => {
            this._captureSettlement(settlement);
            this._renderBattleScene();
          });
          actionsEl.querySelector('#btn-battle-plunder')?.addEventListener('click', () => {
            this._plunderSettlement(settlement);
            this._renderBattleScene();
          });
        } else {
          actionsEl.querySelector('#btn-battle-capture')?.addEventListener('click', () => {
            this._captureSettlement(settlement);
            this._renderBattleScene();
          });
          actionsEl.querySelector('#btn-battle-plunder')?.addEventListener('click', () => {
            this._plunderSettlement(settlement);
            this._renderBattleScene();
          });
          actionsEl.querySelector('#btn-battle-liberate')?.addEventListener('click', () => {
            this._liberateSettlement(settlement);
            this._renderBattleScene();
          });
        }
      }
      actionsEl.querySelector('#btn-battle-exit').addEventListener('click', () => this._closeBattleScene());
    } else if (!state._actionsRendered) {
      // Render command buttons only once – they don't change during active battle
      actionsEl.innerHTML = `
        <button class="btn-battle-cmd" id="btn-battle-attack">⚔ 進攻</button>
        <button class="btn-battle-cmd" id="btn-battle-defend">🛡 防守</button>
        <button class="btn-battle-cmd" id="btn-battle-retreat">🏃 後退</button>`;
      actionsEl.querySelector('#btn-battle-attack').addEventListener('click', () => this._handleBattleCommand('attack'));
      actionsEl.querySelector('#btn-battle-defend').addEventListener('click', () => this._handleBattleCommand('defend'));
      actionsEl.querySelector('#btn-battle-retreat').addEventListener('click', () => this._handleBattleCommand('retreat'));
      state._actionsRendered = true;
    }
  }

  /**
   * Process one battle round.
   * @param {'attack'|'defend'|'retreat'} cmd
   */
  _handleBattleCommand(cmd) {
    const state = this._battleState;
    if (!state || state.finished) return;

    state.round++;

    if (cmd === 'retreat') {
      state.finished = true;
      state.result   = 'retreat';
      state.log.push(`第 ${state.round} 回合 — 你下令撤退，部隊有序撤出戰場。`);
      this._renderBattleScene();
      return;
    }

    const randomMultiplier = () => 0.7 + Math.random() * 0.6; // 0.7 – 1.3
    let playerDmg, enemyDmg, logMsg;

    if (cmd === 'attack') {
      playerDmg = Math.max(1, Math.floor(state.player.attack * randomMultiplier()));
      enemyDmg  = Math.max(1, Math.floor(state.enemy.attack  * randomMultiplier()));
      logMsg = `第 ${state.round} 回合 ⚔ — 我方猛攻，對敵造成 ${playerDmg} 傷害；敵方還擊造成 ${enemyDmg} 傷害。`;
    } else {
      playerDmg = Math.max(1, Math.floor(state.player.attack * (0.4 + Math.random() * 0.3)));
      enemyDmg  = Math.max(1, Math.floor(state.enemy.attack  * (0.3 + Math.random() * 0.25)));
      logMsg = `第 ${state.round} 回合 🛡 — 我方防守，對敵造成 ${playerDmg} 傷害；敵方減弱，造成 ${enemyDmg} 傷害。`;
    }

    state.enemy.hp  = Math.max(0, state.enemy.hp  - playerDmg);

    // Distribute enemy damage to individual units proportionally to their maxHp.
    const aliveMembers = state.player.members.filter(m => m.stats.hp > 0);
    if (aliveMembers.length > 0) {
      const totalAliveMaxHp = aliveMembers.reduce((sum, m) => sum + m.stats.maxHp, 0);
      aliveMembers.forEach(m => {
        const share = (m.stats.maxHp / totalAliveMaxHp) * enemyDmg;
        m.stats.hp = Math.max(0, Math.round(m.stats.hp - share));
      });
    }
    // Sync aggregate HP from individual unit totals.
    state.player.hp = Math.max(0, state.player.members.reduce((sum, m) => sum + m.stats.hp, 0));

    state.log.push(logMsg);

    // Check end conditions
    const playerDead = state.player.hp <= 0;
    const enemyDead  = state.enemy.hp  <= 0;

    if (playerDead && enemyDead) {
      state.finished = true;
      state.result   = 'draw';
      state.log.push('雙方俱損，以平局收場。');
    } else if (enemyDead) {
      state.finished = true;
      state.result   = 'victory';
      state.log.push(`🏆 ${state.settlement.name} 已被攻下！`);
    } else if (playerDead) {
      state.finished = true;
      state.result   = 'defeat';
      state.log.push('💀 我方全軍覆沒，撤出戰場。');
    }

    // Apply diplomacy effects once when the battle concludes
    if (state.finished && !state.diplomacyApplied) {
      state.diplomacyApplied = true;
      // Log battle outcome to inbox.
      if (state.result === 'victory') {
        this._addInboxMessage('🏆', `攻下 ${state.settlement.name}！`);
      } else if (state.result === 'defeat') {
        this._addInboxMessage('💀', `進攻 ${state.settlement.name} 失敗，全軍撤退。`);
      } else {
        this._addInboxMessage('⚔', `進攻 ${state.settlement.name} 以平局告終。`);
      }
      this._triggerBattleAttackDiplomacy(state.settlement, state.result === 'victory');
      // Reduce the defeated settlement's garrison to reflect combat losses.
      if ((state.result === 'victory' || state.result === 'draw') && this.diplomacySystem) {
        const key   = this._settlementKey(state.settlement);
        const losses = Math.max(1, Math.floor(state.enemy.troopCount * 0.6));
        this.diplomacySystem.applyGarrisonLosses(key, losses);
      }
    }

    this._renderBattleScene();
  }

  /**
   * Notify the diplomacy system that the player attacked a settlement.
   * Propagates relation changes to allied / hostile third-party nations.
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @param {boolean} victory
   */
  _triggerBattleAttackDiplomacy(settlement, victory) {
    if (!this.diplomacySystem || !this.nationSystem) return;
    const nation = this.nationSystem.getNation(settlement);
    // Do not fire for already-owned or neutral settlements
    if (!nation || nation.id < 0 || settlement.controllingNationId !== settlement.nationId) return;
    const pk = this.getPlayerNation();
    this.diplomacySystem.recordAttackEvent({
      attackerNationId:    -1,
      targetNationId:      nation.id,
      settlementName:      settlement.name,
      attackerDisplayName: pk.name,
      victory,
    });
    // Refresh diplomacy panel if it's open
    if (this._activePanel === 'nations') {
      this._renderDiplomacy();
    }
  }

  _closeBattleScene() {
    // Mark units with hp ≤ 0 as inactive (wounded – needs recovery time).
    if (this._battleState) {
      let woundedCount = 0;
      this._battleState.player.members.forEach(m => {
        if (m.stats.hp <= 0) {
          m.active = false;
          woundedCount++;
        }
      });
      if (woundedCount > 0) {
        this._addInboxMessage('⚠', `${woundedCount} 名士兵受重傷，需要靜養恢復！`);
      }
    }

    document.getElementById('battle-scene-overlay')?.classList.remove('visible');
    this._battleState = null;
  }

  /** @returns {{ inventory: object, army: object, playerKingdom: object, capturedSettlements: string[], tavernState: object, satisfactionMap: object, inbox: object[], constructionState: object[] }} serialisable snapshot */
  getState() {
    // Serialise constructionState: convert inner Maps/Sets to arrays.
    const constructionState = [];
    for (const [key, state] of this._constructionState) {
      constructionState.push({
        key,
        buildingQueue: state.buildingQueue,
        roads: [...state.roads.entries()].map(([rk, r]) => ({ roadKey: rk, ...r })),
        builtRoads: [...state.builtRoads.entries()].map(([rk, data]) => ({ roadKey: rk, tiles: data.tiles ?? [] })),
      });
    }

    // Serialise per-settlement mutable state (economyLevel, population, buildings).
    // NationSystem is rebuilt deterministically from seed, so only mutations need saving.
    const settlementState = [];
    if (this.nationSystem) {
      this.nationSystem.castleSettlements.forEach((s, i) => {
        settlementState.push({
          key:          `castle:${i}`,
          economyLevel: s.economyLevel,
          population:   s.population,
          buildings:    (s.buildings ?? []).map(b => ({ type: b.type, priceMult: b.priceMult ?? 1 })),
        });
      });
      this.nationSystem.villageSettlements.forEach((s, i) => {
        settlementState.push({
          key:          `village:${i}`,
          economyLevel: s.economyLevel,
          population:   s.population,
          buildings:    (s.buildings ?? []).map(b => ({ type: b.type, priceMult: b.priceMult ?? 1 })),
        });
      });
    }

    return {
      inventory:            this.inventory.getState(),
      army:                 this.army.getState(),
      playerKingdom:        { ...this._playerKingdom },
      capturedSettlements:  [...this._capturedSettlements],
      liberatedSettlements: [...this._liberatedSettlements],
      tavernState:          Object.fromEntries(this._tavernState),
      satisfactionMap:      Object.fromEntries(this._satisfactionMap),
      inbox:                [...this._inbox],
      constructionState,
      settlementState,
      tradeRoutes:          [...this._tradeRoutes.entries()].map(([k, v]) => {
        // Strip computed/cached fields that should not be persisted.
        const { _path, _pathDists, _pathLen, ...rest } = v;
        return [k, rest];
      }),
      festivalCooldowns:     Object.fromEntries(this._festivalCooldowns),
      assignedRulers:       [...this._assignedRulers.entries()],
      tradeRouteWorkers:    [...this._tradeRouteWorkers.entries()],
      buildingWorkers:      [...this._buildingWorkers.entries()],
      regionalTreasury:     Object.fromEntries(this._regionalTreasury),
      cityPlans:            [...this._cityPlans.entries()],
      playerGarrisons:      [...this._playerGarrisons.entries()],
      mapBuildings:         this._mapBuildings.map(b => ({ ...b })),
      mapBuildingWorkers:   this._mapBuildingWorkers.map(w => ({ ...w })),
      mapBuildingIdSeq:     this._mapBuildingIdSeq,
    };
  }

  /**
   * Restore inventory and army from a saved snapshot (skips demo seed).
   * @param {{ inventory?: object, army?: object, playerKingdom?: object, capturedSettlements?: string[], tavernState?: object, satisfactionMap?: object, inbox?: object[], constructionState?: object[] }} state
   */
  loadState(state) {
    if (!state) return;
    if (state.inventory)     this.inventory.loadState(state.inventory);
    if (state.army)          this.army.loadState(state.army);
    if (state.playerKingdom) this._playerKingdom = { ...DEFAULT_KINGDOM, ...state.playerKingdom };
    if (Array.isArray(state.capturedSettlements)) {
      this._capturedSettlements = new Set(state.capturedSettlements);
      this._playerSettlementCount = this._capturedSettlements.size;
    }
    if (Array.isArray(state.liberatedSettlements)) {
      this._liberatedSettlements = new Set(state.liberatedSettlements);
    }
    if (Array.isArray(state.capturedSettlements) || Array.isArray(state.liberatedSettlements)) {
      // Apply playerOwned / neutral flags to Settlement objects so StructureRenderer
      // and all UI code can read ownership directly from the settlement.
      this._syncSettlementOwnership();
    }
    if (state.tavernState && typeof state.tavernState === 'object') {
      this._tavernState = new Map(Object.entries(state.tavernState));
    }
    if (state.satisfactionMap && typeof state.satisfactionMap === 'object') {
      this._satisfactionMap = new Map(
        Object.entries(state.satisfactionMap).map(([k, v]) => [k, Number(v)]),
      );
    }
    if (Array.isArray(state.inbox)) {
      this._inbox = state.inbox.slice(0, GameUI._MAX_INBOX);
      this._inboxUnread = this._inbox.filter(m => !m.read).length;
    }
    if (Array.isArray(state.constructionState)) {
      this._constructionState = new Map();
      for (const entry of state.constructionState) {
        const roads = new Map();
        for (const r of (entry.roads ?? [])) {
          const { roadKey, ...rest } = r;
          roads.set(roadKey, rest);
        }
        this._constructionState.set(entry.key, {
          buildingQueue: entry.buildingQueue ?? [],
          roads,
          builtRoads: (() => {
            const m = new Map();
            for (const r of (entry.builtRoads ?? [])) {
              if (typeof r === 'string') {
                // Legacy format: just the road key string, no tile path.
                m.set(r, { tiles: [] });
              } else if (r?.roadKey) {
                m.set(r.roadKey, { tiles: r.tiles ?? [] });
              }
            }
            return m;
          })(),
        });
      }
    }
    if (Array.isArray(state.tradeRoutes)) {
      this._tradeRoutes = new Map(
        state.tradeRoutes
          .filter(([k, v]) => typeof k === 'string' && v && typeof v === 'object')
          .map(([k, v]) => [k, v]),
      );
    }
    if (state.festivalCooldowns && typeof state.festivalCooldowns === 'object') {
      this._festivalCooldowns = new Map(
        Object.entries(state.festivalCooldowns).map(([k, v]) => [k, Number(v)]),
      );
    }
    if (Array.isArray(state.assignedRulers)) {
      this._assignedRulers = new Map(
        state.assignedRulers.filter(([k, v]) => typeof k === 'string' && typeof v === 'number'),
      );
    }
    if (Array.isArray(state.tradeRouteWorkers)) {
      this._tradeRouteWorkers = new Map(
        state.tradeRouteWorkers.filter(([k, v]) => typeof k === 'string' && Array.isArray(v)),
      );
    }
    if (Array.isArray(state.buildingWorkers)) {
      this._buildingWorkers = new Map(
        state.buildingWorkers.filter(([k, v]) => typeof k === 'string' && Array.isArray(v)),
      );
    }
    if (state.regionalTreasury && typeof state.regionalTreasury === 'object') {
      this._regionalTreasury = new Map(
        Object.entries(state.regionalTreasury).map(([k, v]) => [k, Number(v)]),
      );
    }
    if (Array.isArray(state.cityPlans)) {
      this._cityPlans = new Map(
        state.cityPlans.filter(([k, v]) => typeof k === 'string' && v && typeof v === 'object'),
      );
    }
    if (Array.isArray(state.playerGarrisons)) {
      this._playerGarrisons = new Map(
        state.playerGarrisons.filter(([k, v]) => typeof k === 'string' && Array.isArray(v)),
      );
    }
    if (Array.isArray(state.mapBuildings)) {
      this._mapBuildings = state.mapBuildings.filter(
        b => b && typeof b.type === 'string' && typeof b.tx === 'number' && typeof b.ty === 'number',
      );
    }
    if (Array.isArray(state.mapBuildingWorkers)) {
      this._mapBuildingWorkers = state.mapBuildingWorkers
        .filter(w => w && typeof w.type === 'string' && typeof w.tx === 'number' && typeof w.ty === 'number')
        .map(w => ({
          ...w,
          // Drop legacy return-phase fields; keep only what the new dot system needs.
          phase:  undefined,
          homeTx: undefined,
          homeTy: undefined,
        }));
    }
    if (typeof state.mapBuildingIdSeq === 'number') {
      this._mapBuildingIdSeq = state.mapBuildingIdSeq;
    }
    // Restore mutable settlement state (economyLevel, population, buildings).
    // Must run after nationSystem is already populated (it is passed to the constructor).
    if (Array.isArray(state.settlementState) && this.nationSystem) {
      for (const ss of state.settlementState) {
        if (!ss || typeof ss.key !== 'string') continue;
        const sett = this._getSettlementByKey(ss.key);
        if (!sett) continue;
        if (typeof ss.economyLevel === 'number') {
          sett.economyLevel = Math.max(1, Math.min(5, ss.economyLevel));
        }
        if (typeof ss.population === 'number') {
          sett.population = Math.max(0, ss.population);
        }
        if (Array.isArray(ss.buildings)) {
          sett.buildings = ss.buildings
            .filter(b => b && typeof b.type === 'string')
            .map(b => new Building(b.type, typeof b.priceMult === 'number' ? b.priceMult : 1));
        }
      }
    }

    // Sync the AssignmentSystem so it reflects the restored assignment Maps.
    this.assignmentSystem.syncFromGameUI(
      this._assignedRulers,
      this._tradeRouteWorkers,
      this._buildingWorkers,
    );
  }

  /**
   * Set the ownership state of a settlement, keeping `playerOwned` and
   * `controllingNationId` in sync.
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @param {boolean} isOwned  true = player owns it, false = restore to founding nation
   */
  _setSettlementOwnership(settlement, isOwned) {
    settlement.playerOwned = isOwned;
    settlement.controllingNationId = isOwned ? PLAYER_NATION_ID : settlement.nationId;
  }

  /**
   * Iterate `_capturedSettlements` and set ownership on the matching
   * Settlement objects in NationSystem. Clears ownership on all others.
   * Also restores `NEUTRAL_NATION_ID` for liberated settlements.
   * Safe to call multiple times (idempotent).
   */
  _syncSettlementOwnership() {
    if (!this.nationSystem) return;
    const allSettlements = [
      ...this.nationSystem.castleSettlements,
      ...this.nationSystem.villageSettlements,
    ];
    allSettlements.forEach(s => {
      const key = this._settlementKey(s);
      if (key !== '' && this._capturedSettlements.has(key)) {
        this._setSettlementOwnership(s, true);
      } else if (key !== '' && this._liberatedSettlements.has(key)) {
        s.playerOwned = false;
        s.controllingNationId = NEUTRAL_NATION_ID;
        // Regenerate the independent neutral ruler (deterministic from key).
        const [type, idxStr] = key.split(':');
        s.ruler = generateNeutralRuler(type, parseInt(idxStr, 10));
      } else {
        this._setSettlementOwnership(s, false);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Settlement capture helpers
  // -------------------------------------------------------------------------

  /**
   * Build a stable string key for a settlement (used in `_capturedSettlements`).
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @returns {string} e.g. "castle:0" or "village:3"
   */
  _settlementKey(settlement) {
    if (!this.nationSystem) return '';
    const arr = settlement.type === 'castle'
      ? this.nationSystem.castleSettlements
      : this.nationSystem.villageSettlements;
    const idx = arr.indexOf(settlement);
    return idx >= 0 ? `${settlement.type}:${idx}` : '';
  }

  /**
   * Return the army Unit assigned as the ruler of a player-owned settlement,
   * or null if no explicit assignment has been made.
   * @param {string} key  Settlement key (e.g. "castle:0").
   * @returns {import('../systems/Army.js').Unit|null}
   */
  _getAssignedRulerUnit(key) {
    const unitId = this._assignedRulers.get(key);
    if (unitId == null) return null;
    for (const squad of this.army.getSquads()) {
      const unit = squad.members.find(m => m.id === unitId);
      if (unit) return unit;
    }
    // Unit no longer exists (e.g. removed) – clear the assignment.
    this._assignedRulers.delete(key);
    return null;
  }

  /**
   * Return the effective ruler for a settlement.
   * For player-owned settlements: returns the player-assigned unit if set,
   * otherwise returns the original settlement ruler.
   * For all other settlements: returns the original ruler.
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @returns {import('../systems/Army.js').Unit|null}
   */
  _getEffectiveRuler(settlement) {
    const key = this._settlementKey(settlement);
    if (key && settlement.controllingNationId === PLAYER_NATION_ID) {
      const assigned = this._getAssignedRulerUnit(key);
      if (assigned) return assigned;
    }
    return settlement.ruler ?? null;
  }

  /**
   * Returns true when the player currently controls the given settlement.
   * Reads directly from `settlement.playerOwned` (the authoritative source).
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   * @returns {boolean}
   */
  isPlayerSettlement(settlement) {
    return settlement?.controllingNationId === PLAYER_NATION_ID;
  }

  /**
   * Mark a settlement as captured by the player:
   * - Sets `settlement.playerOwned = true` on the Settlement object
   * - Records it in `_capturedSettlements`
   * - Updates `_playerSettlementCount`
   * - Awards gold + the settlement's resources as spoils
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _captureSettlement(settlement) {
    const key = this._settlementKey(settlement);
    if (!key || this._capturedSettlements.has(key)) return;

    // Track whether this was a neutral (liberated) settlement before we mutate state.
    const wasNeutral = this._liberatedSettlements.has(key);

    // If previously liberated, remove from that set first.
    this._liberatedSettlements.delete(key);

    // Clear any stale ruler assignment for this settlement key
    // (in case it was previously captured, assigned, then lost, then recaptured).
    this._assignedRulers.delete(key);

    this._setSettlementOwnership(settlement, true);
    this._capturedSettlements.add(key);
    this._playerSettlementCount = this._capturedSettlements.size;

    // Clear the NPC garrison – former defenders are dispersed on capture.
    if (this.diplomacySystem) {
      const armies = this.diplomacySystem.getNpcArmies(key);
      armies.forEach(sq => { sq.length = 0; });
    }

    // Initialise satisfaction at -50 for newly-conquered settlements.
    this._satisfactionMap.set(key, -50);

    // Notify the game so it can update map visuals.
    if (typeof this.onCaptureSettlement === 'function') {
      this.onCaptureSettlement();
    }

    // Award gold based on economy level and type.
    const goldReward = settlement.type === 'castle'
      ? 50 + settlement.economyLevel * 20
      : 20 + settlement.economyLevel * 10;
    this.inventory.addItem({ name: '金幣', type: 'loot', icon: '🪙', quantity: goldReward });

    // Award one unit of each of the settlement's resources.
    const iconMap = {
      '木材': '🪵', '農產': '🌾', '礦石': '⛏️', '絲綢': '🧵',
      '煤炭': '🪨', '草藥': '🌿', '魚獲': '🐟', '皮毛': '🦊',
      '食鹽': '🧂', '陶器': '🏺',
    };
    settlement.resources.forEach(res => {
      this.inventory.addItem({
        name: res, type: 'loot', icon: iconMap[res] ?? '📦', quantity: 5,
      });
    });

    // Check if the original nation has been completely wiped out
    if (this.nationSystem && settlement.nationId >= 0) {
      const foundingNation = this.nationSystem.nations[settlement.nationId];
      if (foundingNation && this.nationSystem.isNationExtinct(settlement.nationId)) {
        // Transfer all sovereignty claims to the player.
        if (this.diplomacySystem) {
          this.diplomacySystem.handleNationExtinction(settlement.nationId);
        }
        this._addInboxMessage('🏴', `${foundingNation.name} 失去了所有領地，國家滅亡！所有主權移交給玩家。`);
        // Refresh diplomacy panel immediately if it is open.
        if (this._activePanel === 'nations') this._renderNations();
      }
    }

    // Propagate conquest fear to all surrounding nations.
    // For formerly-neutral settlements use NEUTRAL_NATION_ID so that no single
    // nation is wrongly excluded from the fear penalty (neutral zones are not
    // part of any nation's territory and cannot be "skipped" as their direct owner).
    if (this.diplomacySystem) {
      const pk = this.getPlayerNation();
      this.diplomacySystem.recordConquest({
        settlementName:      settlement.name,
        attackerDisplayName: pk.name,
        targetNationId:      wasNeutral ? NEUTRAL_NATION_ID : settlement.nationId,
      });
      // Refresh diplomacy panel if it's open so players see the impact immediately.
      if (this._activePanel === 'nations') {
        this._renderDiplomacy();
      }
    }
  }

  /**
   * Plunder a settlement after victory: award gold and resources without annexing it.
   * The settlement remains under its original nation's control.
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _plunderSettlement(settlement) {
    // Mark the current battle as plundered so the UI shows the badge on re-render.
    if (this._battleState) this._battleState.plundered = true;

    const iconMap = {
      '木材': '🪵', '農產': '🌾', '礦石': '⛏️', '絲綢': '🧵',
      '煤炭': '🪨', '草藥': '🌿', '魚獲': '🐟', '皮毛': '🦊',
      '食鹽': '🧂', '陶器': '🏺',
    };

    // Award plunder gold (slightly more than capture since you're explicitly looting).
    const goldReward = settlement.type === 'castle'
      ? PLUNDER_BASE_CASTLE   + settlement.economyLevel * PLUNDER_ECONOMY_CASTLE
      : PLUNDER_BASE_VILLAGE  + settlement.economyLevel * PLUNDER_ECONOMY_VILLAGE;
    this.inventory.addItem({ name: '金幣', type: 'loot', icon: '🪙', quantity: goldReward });

    // Award resources (more than capture since this is pure plunder).
    settlement.resources.forEach(res => {
      this.inventory.addItem({
        name: res, type: 'loot', icon: iconMap[res] ?? '📦', quantity: PLUNDER_RESOURCE_QTY,
      });
    });

    // Plundering damages the settlement's economy (min level 1).
    const prevEco = settlement.economyLevel;
    settlement.economyLevel = Math.max(1, settlement.economyLevel - 1);
    const ecoNote = settlement.economyLevel < prevEco
      ? `　經濟遭受破壞（⭐ ${prevEco} → ${settlement.economyLevel}）。`
      : '';

    this._addInboxMessage('💰', `掠奪了 ${settlement.name}，獲得金幣 ${goldReward} 枚及物資。${ecoNote}`);

    // Notify map to rebuild (garrison may have changed).
    if (typeof this.onCaptureSettlement === 'function') {
      this.onCaptureSettlement();
    }
  }

  /**
   * Liberate a settlement after victory: release it as a neutral city.
   * The settlement is freed from its original nation's control and flies a white flag.
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _liberateSettlement(settlement) {
    const key = this._settlementKey(settlement);
    if (!key) return;

    // Remove from captured set if it was previously captured.
    if (this._capturedSettlements.has(key)) {
      this._capturedSettlements.delete(key);
      this._playerSettlementCount = this._capturedSettlements.size;
    }

    // Mark as liberated (neutral).
    this._liberatedSettlements.add(key);
    settlement.playerOwned = false;
    settlement.controllingNationId = NEUTRAL_NATION_ID;

    // Generate a new independent self-governing ruler for this neutral settlement.
    // The ruler is deterministic from the settlement key so save/load is not needed.
    const [type, idxStr] = key.split(':');
    settlement.ruler = generateNeutralRuler(type, parseInt(idxStr, 10));

    this._addInboxMessage('🕊', `解放了 ${settlement.name}，該地區恢復中立，升起白旗。`);

    // Notify map to rebuild so the white flag is shown immediately.
    if (typeof this.onCaptureSettlement === 'function') {
      this.onCaptureSettlement();
    }
  }

  /**
   * Update the number of settlements the player currently controls.
   * Call this from the game whenever castles/villages are captured or lost.
   * @param {number} count
   */
  setPlayerSettlementCount(count) {
    this._playerSettlementCount = count;
    // If the player no longer controls any settlements and the current type
    // requires settlements, fall back to 騎士團.
    if (count === 0) {
      const typeInfo = _KINGDOM_TYPES.find(t => t.id === this._playerKingdom.type);
      if (typeInfo?.requiresSettlement) {
        this._playerKingdom.type = DEFAULT_KINGDOM.type;
      }
    }
  }

  /** Public helper – display a toast notification. */
  showToast(msg) {
    this._toast(msg);
  }

  /**
   * Add a system/world-event message to the inbox with an explicit icon.
   * Used by Game.js to surface NPC march events without going through onPhaseChanged.
   * @param {string} icon
   * @param {string} text
   */
  addSystemMessage(icon, text) {
    this._addInboxMessage(icon, text);
  }

  /**
   * Re-render the nations / diplomacy panel if it is currently visible.
   * Call this after any external event that changes settlement ownership.
   */
  refreshNationsPanel() {
    if (this._activePanel === 'nations') this._renderNations();
  }

  // -------------------------------------------------------------------------
  // Toast helper
  // -------------------------------------------------------------------------

  _toast(msg) {
    const el = document.getElementById('ui-toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    // Show longer for longer messages: at least 3 s, up to 8 s
    const duration = Math.min(8000, Math.max(3000, msg.length * 80));
    this._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  // -------------------------------------------------------------------------
  // Inbox helpers
  // -------------------------------------------------------------------------

  /** Maximum number of messages kept in the inbox. */
  static get _MAX_INBOX() { return 60; }

  /**
   * Add a message to the inbox AND show a toast.
   * Automatically trims the log to MAX_INBOX entries (oldest removed first).
   *
   * @param {string} icon  Emoji icon for the message category.
   * @param {string} text  Message body.
   */
  _addInboxMessage(icon, text) {
    const day  = this.diplomacySystem?._currentDay ?? 0;
    const time = this._dayNightCycle?.getTimeString() ?? '';
    this._inbox.unshift({ icon, text, day, time, read: false });
    if (this._inbox.length > GameUI._MAX_INBOX) {
      this._inbox.length = GameUI._MAX_INBOX;
    }
    this._inboxUnread = this._inbox.filter(m => !m.read).length;
    this._updateInboxBadge();
    this._toast(`${icon} ${text}`);
    // Refresh inbox panel if open.
    if (this._activePanel === 'inbox') this._renderInbox();
  }

  /** Update the numeric badge on the inbox tab button. */
  _updateInboxBadge() {
    const badge = document.getElementById('inbox-badge');
    if (!badge) return;
    if (this._inboxUnread > 0) {
      badge.textContent = this._inboxUnread > 99 ? '99+' : String(this._inboxUnread);
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }

  // -------------------------------------------------------------------------
  // Inbox panel renderer
  // -------------------------------------------------------------------------

  _renderInbox() {
    const content = document.getElementById('ui-panel-content');
    if (!content) return;

    // Mark all visible messages as read (but not un-responded interactive proposals).
    this._inbox.forEach(m => {
      const interactive = (m.isPeaceOffer || m.isTradeRequest || m.isNapProposal || m.isMppProposal);
      if (!interactive || m.responded) m.read = true;
    });
    this._inboxUnread = this._inbox.filter(m => !m.read).length;
    this._updateInboxBadge();

    if (this._inbox.length === 0) {
      content.innerHTML = `<div class="ui-empty">📭 信件夾是空的</div>`;
      return;
    }

    const rows = this._inbox.map((m, i) => {
      // Build action buttons for any interactive proposal that hasn't been answered.
      let actionBtns = '';
      if (!m.responded) {
        if (m.isPeaceOffer || m.isTradeRequest || m.isNapProposal || m.isMppProposal) {
          const ACCEPT_LABELS = {
            isTradeRequest: '✅ 接受',
            isNapProposal:  '✅ 簽署',
            isMppProposal:  '✅ 締結',
            isPeaceOffer:   '✅ 同意',
          };
          const acceptLabel = ACCEPT_LABELS[Object.keys(ACCEPT_LABELS).find(k => m[k])] ?? '✅ 同意';
          actionBtns = `<div class="inbox-peace-actions">
            <button class="btn-buy inbox-accept-btn" data-idx="${i}">${acceptLabel}</button>
            <button class="inbox-ignore-btn" data-idx="${i}">❌ 拒絕</button>
          </div>`;
        }
      }

      const isInteractive = m.isPeaceOffer || m.isTradeRequest || m.isNapProposal || m.isMppProposal;
      let respondedLabel = '';
      if (isInteractive && m.responded) {
        respondedLabel = `<span class="inbox-responded-label">${m._accepted ? '（已接受）' : '（已拒絕）'}</span>`;
      }

      return `
        <div class="inbox-row${m.read && (!isInteractive || m.responded) ? '' : ' inbox-unread'}" data-idx="${i}">
          <span class="inbox-icon">${m.icon}</span>
          <div class="inbox-body">
            <div class="inbox-text">${m.text}${respondedLabel}</div>
            <div class="inbox-day">第 ${m.day} 天${m.time ? ' ' + m.time : ''}</div>
            ${actionBtns}
          </div>
        </div>`;
    }).join('');

    content.innerHTML = `
      <div class="inbox-toolbar">
        <span class="inbox-count">${this._inbox.length} 則訊息</span>
        <button id="inbox-clear-btn" class="inbox-clear-btn">🗑 清除全部</button>
      </div>
      <div class="inbox-list">${rows}</div>`;

    document.getElementById('inbox-clear-btn')?.addEventListener('click', () => {
      this._inbox.length = 0;
      this._inboxUnread = 0;
      this._updateInboxBadge();
      this._renderInbox();
    });

    // Bind accept / reject buttons for all proposal types.
    content.querySelectorAll('.inbox-accept-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        const m = this._inbox[idx];
        if (!m) return;
        m._accepted = true;
        if (m.isPeaceOffer)         this._respondToPeaceOffer(idx, true);
        else if (m.isTradeRequest)  this._respondToTradeRequest(idx, true);
        else if (m.isNapProposal)   this._respondToNapProposal(idx, true);
        else if (m.isMppProposal)   this._respondToMppProposal(idx, true);
      });
    });
    content.querySelectorAll('.inbox-ignore-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        const m = this._inbox[idx];
        if (!m) return;
        m._accepted = false;
        if (m.isPeaceOffer)         this._respondToPeaceOffer(idx, false);
        else if (m.isTradeRequest)  this._respondToTradeRequest(idx, false);
        else if (m.isNapProposal)   this._respondToNapProposal(idx, false);
        else if (m.isMppProposal)   this._respondToMppProposal(idx, false);
      });
    });
  }
}
