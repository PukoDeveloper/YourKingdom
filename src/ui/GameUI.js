import { Inventory }                      from '../systems/Inventory.js';
import { Army, MAX_MEMBERS, TRAIT_CAPTAIN } from '../systems/Army.js';
import { TRAIT_RULER, PLAYER_NATION_ID }   from '../systems/NationSystem.js';
import {
  RELATION_LEVELS,
  PERSONALITY_COLORS,
  PERSONALITY_ARROGANT, PERSONALITY_WARLIKE, PERSONALITY_GENTLE,
  PERSONALITY_CUNNING,  PERSONALITY_CAUTIOUS, ALL_PERSONALITIES,
  GARRISON_TAX_PENALTY_PER_UNIT,
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
  FLAG_BG_COLORS,
  FLAG_STRIPE_COLORS,
  FLAG_STRIPE_STYLES,
  FLAG_SYMBOLS,
} from '../systems/AppearanceSystem.js';
import {
  BuildingSystem,
  Building,
  BLDG_PALACE, BLDG_CHIEF_HOUSE,
  BLDG_GENERAL, BLDG_BLACKSMITH, BLDG_MAGE, BLDG_TAVERN, BLDG_INN,
  BUILDING_META,
  CATALOG_GENERAL, CATALOG_BLACKSMITH, CATALOG_MAGE, CATALOG_TAVERN_FOOD,
} from '../systems/BuildingSystem.js';
import { TERRAIN, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from '../world/constants.js';

/** Display labels for FLAG_STRIPE_STYLES (same order). */
const _STRIPE_STYLE_LABELS = ['無', '橫紋', '縱紋', '斜紋', '十字', '箭形'];

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
const DEFAULT_APPEARANCE_INDICES = { bodyColorIdx: 0, headgearIdx: 0, armorColorIdx: 0, markColorIdx: 0 };

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

/** Port construction gold cost. */
const CONSTR_PORT_COST = 200;

/** Gold cost per tile to build a road. */
const CONSTR_ROAD_COST_PER_TILE = 20;

/** In-game hours to build one road tile (work hours only). */
const CONSTR_ROAD_HOURS_PER_TILE = 3;

/** In-game hours to demolish one road tile (work hours only). */
const CONSTR_ROAD_DEMO_HOURS_PER_TILE = 0.5;

/**
 * Work-hours advanced per phase transition.
 * Road crews only work during 白天 and 黃昏.
 */
const CONSTR_PHASE_HOURS = { '白天': 10, '黃昏': 2 };

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
   * @param {import('../entities/Player.js').Player|null} [player]  Live Player instance.
   * @param {import('../systems/DiplomacySystem.js').DiplomacySystem|null} [diplomacySystem]
   * @param {import('../world/DayNightCycle.js').DayNightCycle|null} [dayNightCycle]
   * @param {import('../world/MapData.js').MapData|null} [mapData]  Live MapData used for coastal checks.
   */
  constructor(savedState = null, onSave = null, nationSystem = null, onReset = null, player = null, diplomacySystem = null, dayNightCycle = null, mapData = null) {
    this.inventory = new Inventory();
    this.army      = new Army('主角');

    /** @type {import('../systems/NationSystem.js').NationSystem|null} */
    this.nationSystem = nationSystem;

    /** @type {import('../systems/DiplomacySystem.js').DiplomacySystem|null} */
    this.diplomacySystem = diplomacySystem;

    /** @type {import('../world/DayNightCycle.js').DayNightCycle|null} */
    this._dayNightCycle = dayNightCycle;

    /** @type {import('../entities/Player.js').Player|null} */
    this.player = player;

    /** @type {import('../world/MapData.js').MapData|null} */
    this._mapData = mapData;

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

    /** Active construction sub-tab: '建築' | '道路' | '港口' */
    this._constructionTab = '建築';

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
     * Callback invoked when the player builds a port.
     * The game uses this to rebuild map structures so the port marker is drawn.
     * @type {(() => void)|null}
     */
    this.onPortBuilt = null;

    /**
     * Per-settlement construction state.
     * Key: settlement key (e.g. "castle:0").
     * Value: {
     *   buildingQueue: [{ type: string, name: string, icon: string, daysLeft: number }],
     *   roads:         Map<roadKey, { targetKey, targetName, tilesTotal, hoursLeft, isDemo }>,
     *   builtRoads:    Set<roadKey>,
     *   hasPort:       boolean,
     *   portTile:      { tx: number, ty: number }|null
     * }
     * @type {Map<string, object>}
     */
    this._constructionState = new Map();

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
    // Loot
    this.inventory.addItem({ name: '金幣',     type: 'loot',      icon: '🪙', quantity: 50 });
    this.inventory.addItem({ name: '木材',     type: 'loot',      icon: '🪵', quantity: 20 });
    this.inventory.addItem({ name: '鐵礦石',   type: 'loot',      icon: '⛏️', quantity: 15 });
    // Equipment
    this.inventory.addItem({ name: '長劍',     type: 'weapon',    icon: '🗡️', quantity: 1,
      description: '鋒利的長劍，適合近戰。', stats: { attack: 12 } });
    this.inventory.addItem({ name: '鐵頭盔',   type: 'helmet',    icon: '⛑️', quantity: 1,
      description: '堅固的鐵製頭盔。', stats: { defense: 6 } });
    this.inventory.addItem({ name: '鎖甲',     type: 'chest',     icon: '🥋', quantity: 1,
      description: '由鐵環編織的護甲。', stats: { defense: 10 } });
    this.inventory.addItem({ name: '護腿甲',   type: 'legs',      icon: '🦵', quantity: 1,
      description: '保護腿部的金屬護甲。', stats: { defense: 4 } });
    this.inventory.addItem({ name: '皮靴',     type: 'boots',     icon: '👢', quantity: 1,
      description: '輕便耐用的皮革靴子。', stats: { speed: 2 } });
    // Accessories
    this.inventory.addItem({ name: '護身符',   type: 'accessory', icon: '📿', quantity: 1,
      description: '帶有神秘魔力的護身符。', stats: { morale: 5 } });
    this.inventory.addItem({ name: '玉佩',     type: 'accessory', icon: '💎', quantity: 1,
      description: '溫潤的翡翠玉佩。' });
    // Food
    this.inventory.addItem({ name: '乾糧',     type: 'food',      icon: '🍱', quantity: 10,
      description: '補充行軍所需的體力。' });
    this.inventory.addItem({ name: '肉乾',     type: 'food',      icon: '🥩', quantity: 5,
      description: '耐儲的高熱量食物。' });
    // Potions
    this.inventory.addItem({ name: '治療藥水', type: 'potion',    icon: '🧪', quantity: 3,
      description: '恢復生命值' });
    this.inventory.addItem({ name: '強化藥水', type: 'potion',    icon: '⚗️', quantity: 1,
      description: '暫時大幅提升攻擊力' });
    // Utility
    this.inventory.addItem({ name: '速度符',   type: 'utility',   icon: '💨', quantity: 1,
      description: '短暫提升移動速度' });
    this.inventory.addItem({ name: '偵察鷹',   type: 'utility',   icon: '🦅', quantity: 2,
      description: '派出鷹隼偵察地形' });
    // Trophies / war spoils
    this.inventory.addItem({ name: '敵將首級', type: 'trophy', icon: '🏆', quantity: 1,
      description: '擊倒敵方將領所獲得的戰功證明。' });
    this.inventory.addItem({ name: '勝利旗幟', type: 'trophy', icon: '🚩', quantity: 1,
      description: '從攻下的城池上取下的旗幟。' });
    // Map item
    this.inventory.addItem({ name: '地圖', type: 'map', icon: '🗺️', quantity: 1,
      stackable: false, description: '記錄王國全域地形的羊皮紙地圖，可查看整片大陸。' });

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
          <button id="ui-minimap-close">✕</button>
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
          <div class="mm-legend-item"><span class="mm-legend-swatch" style="background:#8D8D8D"></span>城堡</div>
          <div class="mm-legend-item"><span class="mm-legend-swatch" style="background:#C8A96E"></span>村落</div>
          <div class="mm-legend-item"><span class="mm-legend-swatch" style="background:#8B6914"></span>港口</div>
          <div class="mm-legend-item"><span class="mm-legend-swatch" style="background:#FFD700"></span>玩家位置</div>
        </div>
      </div>
    `;
    document.body.appendChild(minimap);

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
      loot: '資源', consumable: '消耗', trophy: '戰利品', map: '地圖',
    };
  }

  /** All item types that map to an explicit category (used for 其他 catch-all). */
  static get _KNOWN_TYPES() {
    return new Set([
      ...GameUI._EQUIP_TYPES,
      'accessory', 'food', 'potion', 'consumable', 'utility', 'loot', 'trophy', 'map',
    ]);
  }

  _filterItems(items) {
    const tab = this._backpackTab;
    if (tab === 'all')       return items;
    if (tab === 'equipment') return items.filter(i => i.type === this._equipSubTab);
    if (tab === 'potion')    return items.filter(i => i.type === 'potion' || i.type === 'consumable');
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
    const usable  = !isMap && ['consumable', 'potion', 'utility'].includes(item.type);
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
        ${usable  ? `<button class="btn-item-use" data-id="${item.id}">▶ 使用</button>` : ''}
        <button class="btn-item-discard" data-id="${item.id}">🗑 丟棄</button>
      </div>
    `;

    document.getElementById('ui-item-detail-overlay').classList.add('visible');

    const detailBody = document.getElementById('ui-item-detail-body');
    detailBody.querySelector('.btn-item-use')?.addEventListener('click', () => {
      if (isMap) {
        this._closeItemDetail();
        this._openMinimap();
        return;
      }
      const desc = this.inventory.useItem(item.id);
      if (desc) this._toast(desc);
      this._closeItemDetail();
      this._renderBackpack();
    });

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

  // -------------------------------------------------------------------------
  // Minimap overlay
  // -------------------------------------------------------------------------

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

    const SCALE = 2; // pixels per tile
    const canvas = document.getElementById('ui-minimap-canvas');
    const maxBoxWidth = Math.min(window.innerWidth * 0.88, 396) - 24; // 12px padding each side
    const displayScale = Math.min(1, maxBoxWidth / (MAP_WIDTH * SCALE));

    canvas.width  = MAP_WIDTH  * SCALE;
    canvas.height = MAP_HEIGHT * SCALE;
    canvas.style.width  = `${Math.round(MAP_WIDTH  * SCALE * displayScale)}px`;
    canvas.style.height = `${Math.round(MAP_HEIGHT * SCALE * displayScale)}px`;

    const ctx  = canvas.getContext('2d');
    const COLORS = GameUI._MINIMAP_COLORS;

    // Draw terrain tiles
    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
      for (let tx = 0; tx < MAP_WIDTH; tx++) {
        const terrain = this._mapData.tiles[ty * MAP_WIDTH + tx];
        ctx.fillStyle = COLORS[terrain] ?? '#1565C0';
        ctx.fillRect(tx * SCALE, ty * SCALE, SCALE, SCALE);
      }
    }

    // Draw player position marker
    this._drawMinimapPlayer(ctx, SCALE);

    document.getElementById('ui-minimap-overlay').classList.add('visible');
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

  _closeMinimap() {
    document.getElementById('ui-minimap-overlay').classList.remove('visible');
  }

  // -------------------------------------------------------------------------
  // Settings panel
  // -------------------------------------------------------------------------

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
    `;

    document.getElementById('btn-reset-game').addEventListener('click', () => {
      if (window.confirm('確定要重置遊戲嗎？\n所有存檔將被清除，無法復原。')) {
        if (typeof this.onReset === 'function') {
          this.onReset();
        }
      }
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

    const _swatch = (colors, selectedIdx, dataAttr) =>
      colors.map((c, i) =>
        `<button class="ap-swatch${i === selectedIdx ? ' selected' : ''}" data-${dataAttr}="${i}"
                 style="background:${c};width:28px;height:28px;border-radius:50%;cursor:pointer"></button>`
      ).join('');

    const headgearHTML = CHAR_HEADGEAR_TYPES.map((t, i) =>
      `<button class="ap-choice${i === app.headgearIdx ? ' selected' : ''}" data-headgear="${i}">${CHAR_HEADGEAR_LABELS[i]}</button>`
    ).join('');

    content.innerHTML = `
      <div class="ap-preview-row">
        <div id="ap-preview-wrap"></div>
        <span class="ap-preview-label">玩家外觀預覽</span>
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
        <div class="ap-section-title">標記顏色</div>
        <div class="ap-swatches" id="ap-mark-swatches">
          ${_swatch(CHAR_MARK_COLORS_CSS, app.markColorIdx, 'mark')}
        </div>
      </div>
    `;

    // Track pending changes without hitting the player object on every click
    let pending = {
      bodyColorIdx:  app.bodyColorIdx,
      headgearIdx:   app.headgearIdx,
      armorColorIdx: app.armorColorIdx,
      markColorIdx:  app.markColorIdx,
    };

    const _refreshPreview = () => {
      const preview = charAppearanceFromIndices(pending);
      document.getElementById('ap-preview-wrap').innerHTML = renderCharHTML(preview, 56);
    };
    _refreshPreview();

    const _apply = () => {
      if (this.player) this.player.setAppearance(pending);
      // Sync the hero Unit in the army so the party screen reflects the new look.
      // The hero is always in squad 0 and cannot be moved to another squad.
      if (this.army) {
        const heroUnit = this.army.squads[0]?.members.find(m => m.role === 'hero');
        if (heroUnit) heroUnit.appearance = charAppearanceFromIndices(pending);
      }
    };

    /**
     * Wire up swatch/choice buttons for one appearance part.
     * @param {string} attr      data attribute name (e.g. 'body', 'armor', 'mark')
     * @param {string} pendingKey key to update in the `pending` object
     */
    const _wireSwatches = (attr, pendingKey) => {
      const btns = content.querySelectorAll(`[data-${attr}]`);
      btns.forEach(btn => {
        btn.addEventListener('click', () => {
          pending[pendingKey] = Number(btn.dataset[attr]);
          btns.forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          _apply();
          _refreshPreview();
        });
      });
    };

    _wireSwatches('body',    'bodyColorIdx');
    _wireSwatches('headgear','headgearIdx');
    _wireSwatches('armor',   'armorColorIdx');
    _wireSwatches('mark',    'markColorIdx');
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

    const symbolHTML = FLAG_SYMBOLS.map((s, i) =>
      `<button class="ap-choice${i === k.flagSymbolIdx ? ' selected' : ''}" data-flag-symbol="${i}">${s}</button>`
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
               value="${k.name}" maxlength="20" placeholder="輸入國名…">
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
    const isPlayer  = settlement.controllingNationId < 0;
    const nation    = isPlayer
      ? this.getPlayerNation()
      : this.nationSystem.getNation(settlement);
    const ruler     = settlement.ruler;
    const ecoStars  = '⭐'.repeat(settlement.economyLevel) + '☆'.repeat(5 - settlement.economyLevel);
    const popStr    = settlement.population.toLocaleString();
    const typeLabel = settlement.type === 'castle' ? '城堡' : '村落';
    const flagHTML  = nation.flagApp ? renderFlagHTML(nation.flagApp, 48) : nation.emblem;

    // Colour-code personality traits
    const rulerTraitsHTML = ruler.traits.map(t => {
      const persColor = PERSONALITY_COLORS[t];
      const cls = t === TRAIT_RULER
        ? 'trait-ruler'
        : persColor ? 'trait-personality' : '';
      const style = persColor ? ` style="color:${persColor};border-color:${persColor}88"` : '';
      return `<span class="trait-tag ${cls}"${style}>${t}</span>`;
    }).join('');

    const playerBanner = isPlayer ? `
      <div class="sd-player-banner">
        ${renderFlagHTML(nation.flagApp, 20)} ${nation.name} · 已佔領
      </div>` : '';

    // Diplomacy relation info (only for NPC castle settlements)
    let diplomacyHTML = '';
    if (!isPlayer && settlement.type === 'castle' && this.diplomacySystem && this.nationSystem) {
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
      ${diplomacyHTML}
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
      </div>
    `;

    document.getElementById('ui-settlement-detail-overlay').classList.add('visible');
  }

  _closeSettlementDetail() {
    document.getElementById('ui-settlement-detail-overlay').classList.remove('visible');
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

    // Satisfaction drift: each player-owned settlement moves ±2/day toward 0.
    for (const [key, sat] of this._satisfactionMap) {
      if (sat < 0) {
        this._satisfactionMap.set(key, Math.min(0, sat + 2));
      } else if (sat > 0) {
        this._satisfactionMap.set(key, Math.max(0, sat - 2));
      }
    }

    // Tick building construction queues for every settlement.
    for (const [key, state] of this._constructionState) {
      if (state.buildingQueue.length === 0) continue;
      const toComplete = [];
      for (const item of state.buildingQueue) {
        item.daysLeft -= 1;
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

    if (this._activePanel === 'team' && this._teamInfoTab === 'info') {
      this._renderTeamInfo();
    }
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
              // Mark as built on both endpoints
              if (fromState) { fromState.roads.delete(rk); fromState.builtRoads.add(rk); }
              if (toState)   { toState.roads.delete(rk);   toState.builtRoads.add(rk); }
              const fromSett = this._getSettlementByKey(fromKey);
              const toSett   = this._getSettlementByKey(toKey);
              this._addInboxMessage('🛤️', `道路 ${fromSett?.name ?? fromKey} ↔ ${toSett?.name ?? toKey} 已建造完成！`);
            } else {
              // Demolition complete – just remove
              if (fromState) fromState.roads.delete(rk);
              if (toState)   toState.roads.delete(rk);
              const fromSett = this._getSettlementByKey(fromKey);
              const toSett   = this._getSettlementByKey(toKey);
              this._addInboxMessage('🪚', `道路 ${fromSett?.name ?? fromKey} ↔ ${toSett?.name ?? toKey} 已拆除完成。`);
            }
          } else {
            // Mirror updated hoursLeft to both endpoint road entries
            if (fromState?.roads.has(rk)) fromState.roads.get(rk).hoursLeft = road.hoursLeft;
            if (toState?.roads.has(rk))   toState.roads.get(rk).hoursLeft   = road.hoursLeft;
          }
        }
      }
    }
  }

  _renderSquadDetail(squad) {
    const detail = document.getElementById('squad-detail');
    const captain = squad.captain;

    const memberCards = [];
    for (let i = 0; i < MAX_MEMBERS; i++) {
      const m = squad.members[i];
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

    detail.innerHTML = `
      <div class="squad-stat">
        成員 ${squad.members.length} / ${MAX_MEMBERS}
        ${captain ? `&nbsp;｜&nbsp;隊長：${captain.name}` : '&nbsp;⚠ 無隊長'}
      </div>
      <div class="member-list">
        ${memberCards.join('')}
      </div>
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
      </div>
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
  // Unit acquisition
  // -------------------------------------------------------------------------

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
   * @param {'castle'|'village'|'port'|null} [terrainType] Used for ports which have no Settlement object.
   */
  setNearbySettlement(settlement, terrainType = null) {
    const wrap = document.getElementById('facility-action-wrap');
    if (!wrap) return;

    const prev = this._nearbySettlement;
    this._nearbySettlement = settlement ?? (terrainType === 'port' ? { type: 'port', name: '港口' } : null);

    const visible = this._nearbySettlement !== null;
    wrap.classList.toggle('visible', visible);

    if (visible) {
      const name = this._nearbySettlement.name ?? '設施';
      const enterBtn = document.getElementById('enter-facility-btn');
      if (enterBtn) enterBtn.textContent = `🚪 進入 ${name}`;

      // Show attack button only for castle/village settlements that the player does NOT own
      const attackBtn = document.getElementById('attack-facility-btn');
      if (attackBtn) {
        const s = this._nearbySettlement;
        const isAttackable = (s.type === 'castle' || s.type === 'village')
          && s.controllingNationId !== PLAYER_NATION_ID;
        attackBtn.classList.toggle('visible', isAttackable);
      }
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
    const icons = { castle: '🏰', village: '🏘️', port: '⚓' };
    document.getElementById('location-icon').textContent = icons[s.type] ?? '🏠';
    document.getElementById('location-title').textContent = s.name;

    let subtitle = '';
    if (s.type === 'castle' && this.nationSystem) {
      const nation = s.controllingNationId < 0
        ? this.getPlayerNation()
        : this.nationSystem.getNation(s);
      subtitle = `${nation.flagApp ? renderFlagHTML(nation.flagApp, 18) : nation.emblem} ${nation.name}`;
    } else if (s.type === 'village') {
      subtitle = '村落';
    } else if (s.type === 'port') {
      subtitle = '沿岸港口';
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
      nation = settlement.controllingNationId < 0
        ? this.getPlayerNation()
        : this.nationSystem.getNation(settlement);
    }
    const nationName = nation ? nation.name : settlement.name;

    const isPlayerOwned = settlement.controllingNationId < 0;
    const gateArt = isPlayerOwned ? '🛡️🏴🛡️' : '🛡️⚔️🛡️';
    const gateMsg = isPlayerOwned
      ? `兩名身著你方盔甲的士兵立正行禮。<br>
           「<em>主公歸來，城門大開！</em>」<br>
           「<em>請入內視察 ${nationName}。</em>」`
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
  }

  /** Facility list for the current settlement. */
  _renderLocationFacilities(settlement) {
    this._facilityView = null;
    const content = document.getElementById('location-content');

    // Port settlements use a minimal hardcoded list (no Building objects).
    if (settlement.type === 'port') {
      const portFacilities = [
        { icon: '⚓', name: '碼頭',   desc: '船運服務\n乘船出行' },
        { icon: '📦', name: '倉庫',   desc: '存放貨物\n物資管理' },
        { icon: '🍺', name: '酒館',   desc: '水手常聚\n打聽消息' },
        { icon: '🏪', name: '雜貨店', desc: '海貨特產\n補給物資' },
      ];
      const cards = portFacilities.map((f, i) => `
        <div class="facility-card" data-port-idx="${i}" role="button" tabindex="0">
          <div class="fc-icon">${f.icon}</div>
          <div class="fc-name">${f.name}</div>
          <div class="fc-desc">${f.desc.replace(/\n/g, '<br>')}</div>
        </div>`).join('');
      content.innerHTML = `
        <div class="loc-facilities-title">港口設施</div>
        <div class="loc-facilities-grid">${cards}</div>
      `;
      content.querySelectorAll('.facility-card[data-port-idx]').forEach(card => {
        const open = () => {
          const idx = Number(card.dataset.portIdx);
          this._toast(`${portFacilities[idx].icon} ${portFacilities[idx].name}：功能開發中…`);
        };
        card.addEventListener('click', open);
        card.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
      });
      return;
    }

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
      case BLDG_GENERAL:
        this._renderShop(building, settlement, this._buildGeneralCatalog(settlement));
        break;
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
      basePrice:   10,
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
   */
  _renderShop(building, settlement, catalog) {
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

    content.innerHTML = `
      ${this._facilityBackHTML(settlement)}
      <div class="fac-title">${building.icon} ${building.name}</div>
      ${this._goldBarHTML()}
      <div class="shop-item-list">${itemsHTML}</div>
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
  // Government building screen (王宮 / 村長家)
  // -------------------------------------------------------------------------

  /**
   * @param {import('../systems/BuildingSystem.js').Building} building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderGovBuilding(building, settlement) {
    const content = document.getElementById('location-content');
    if (!content) return;

    const ruler  = settlement.ruler;
    const traits = ruler?.traits?.filter(t => t !== '統治者') ?? [];
    const isOwnedByPlayer = this.isPlayerSettlement(settlement);

    // Tax section (player-owned only)
    const key = this._settlementKey(settlement);
    const satisfaction = isOwnedByPlayer
      ? (this._satisfactionMap.get(key) ?? -50)
      : null;

    // Satisfaction label / colour
    let satLabel = '', satColor = '#9e9e9e';
    if (satisfaction !== null) {
      if (satisfaction >= 0)        { satLabel = '穩定';   satColor = '#66bb6a'; }
      else if (satisfaction >= -30) { satLabel = '不滿';   satColor = '#ffa726'; }
      else if (satisfaction >= -60) { satLabel = '憤慨';   satColor = '#ef6c00'; }
      else                          { satLabel = '激憤';   satColor = '#e53935'; }
    }

    // Tax yield: economyLevel × 20 + floor(population / 100),
    // scaled by satisfaction, then reduced by garrison maintenance cost.
    let taxYield = 0;
    let taxHTML  = '';
    if (isOwnedByPlayer) {
      const baseTax  = (settlement.economyLevel ?? 1) * 20 + Math.floor(settlement.population / 100);
      // Satisfaction factor: -100 → 10 %, 0 → 100 % (capped at 100 %)
      const factor          = Math.min(1.0, 0.1 + 0.9 * ((satisfaction + 100) / 100));
      const afterSat        = Math.round(baseTax * factor);
      // Garrison penalty: every active soldier you maintain reduces tax income.
      const playerUnits     = this.army.getSquads()
        .reduce((sum, sq) => sum + sq.members.filter(m => m.active).length, 0);
      const garrisonPenalty = playerUnits * GARRISON_TAX_PENALTY_PER_UNIT;
      taxYield              = Math.max(1, afterSat - garrisonPenalty);

      const penaltyHTML = garrisonPenalty > 0
        ? `<div class="gov-stat-row-small">
             <span class="gov-stat-label">駐軍維持（${playerUnits} 人）</span>
             <span class="gov-stat-val" style="color:#ef6c00">-🪙${garrisonPenalty}</span>
           </div>`
        : '';

      taxHTML = `
        <div class="gov-tax-section">
          <div class="gov-tax-title">📋 地區管理</div>
          <div class="gov-stat-row-small">
            <span class="gov-stat-label">民心滿意度</span>
            <span class="gov-sat-val" style="color:${satColor}">${satLabel}（${satisfaction >= 0 ? '+' : ''}${satisfaction}）</span>
          </div>
          ${penaltyHTML}
          <div class="gov-stat-row-small">
            <span class="gov-stat-label">預期稅收</span>
            <span class="gov-stat-val">🪙${taxYield}</span>
          </div>
          <button class="btn-buy gov-tax-btn" id="btn-collect-tax">🏦 徵收稅款</button>
        </div>`;
    }

    content.innerHTML = `
      ${this._facilityBackHTML(settlement)}
      <div class="fac-title">${building.icon} ${building.name}</div>
      <div class="gov-ruler-section">
        <div class="gov-ruler-icon">👑</div>
        <div class="gov-ruler-info">
          <div class="gov-ruler-name">${ruler?.name ?? '不詳'}</div>
          <div class="gov-ruler-role">${ruler?.role ?? ''}</div>
          ${traits.length ? `<div class="gov-ruler-traits">${traits.join('・')}</div>` : ''}
        </div>
      </div>
      <div class="gov-stats-row">
        <div class="gov-stat"><span class="gov-stat-label">人口</span><span class="gov-stat-val">${settlement.population.toLocaleString()}</span></div>
        <div class="gov-stat"><span class="gov-stat-label">經濟</span><span class="gov-stat-val">${'⭐'.repeat(settlement.economyLevel ?? 1)}</span></div>
        <div class="gov-stat"><span class="gov-stat-label">資源</span><span class="gov-stat-val">${(settlement.resources ?? []).join('、') || '無'}</span></div>
      </div>
      ${taxHTML}
      ${isOwnedByPlayer ? `
        <button class="btn-buy gov-letter-btn" id="btn-send-letter">📨 派送信件</button>
        <button class="btn-buy gov-construction-btn" id="btn-open-construction">🏗️ 建設選項</button>
      ` : `<div id="gov-foreign-diplo"></div>`}
      <div class="gov-ruler-speech">
        <em>「${_GOV_GREETING[building.type] ?? '歡迎來訪。'}」</em>
      </div>
    `;

    this._attachFacilityBack(settlement);

    if (isOwnedByPlayer) {
      document.getElementById('btn-collect-tax')?.addEventListener('click', () => {
        const newSat = Math.max(-100, (this._satisfactionMap.get(key) ?? -50) - 10);
        this._satisfactionMap.set(key, newSat);
        this._addGold(taxYield);
        this._addInboxMessage('🏦', `已徵收 ${settlement.name} 稅款 +${taxYield} 🪙，民心 ${newSat >= 0 ? '+' : ''}${newSat}`);
        // Re-render to reflect updated satisfaction
        this._renderGovBuilding(building, settlement);
      });
      document.getElementById('btn-send-letter')?.addEventListener('click', () => {
        this._renderSendLetter(settlement);
      });
      document.getElementById('btn-open-construction')?.addEventListener('click', () => {
        this._renderConstructionPanel(building, settlement);
      });
    } else {
      this._renderForeignDiplomacy(building, settlement);
    }
  }

  // -------------------------------------------------------------------------
  // Foreign city-hall diplomacy UI
  // -------------------------------------------------------------------------

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

    const pactBadge = (active, label) => active
      ? `<span class="gov-pact-badge gov-pact-active">${label} 有效</span>`
      : '';

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
        </div>
      </div>
    `;

    const bindCard = (id, fn) => {
      const el = container.querySelector(`#${id}`);
      if (!el || el.classList.contains('disabled')) return;
      el.addEventListener('click', fn);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
      });
    };

    bindCard('diplo-nap',       () => this._renderNapProposal(building, settlement));
    bindCard('diplo-joint-war', () => this._renderJointWarProposal(building, settlement));
    bindCard('diplo-mpt',       () => this._renderMutualProtectionProposal(building, settlement));
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

  // -------------------------------------------------------------------------
  // Construction system – helpers
  // -------------------------------------------------------------------------

  /**
   * Return (or create) the construction state object for a settlement.
   * @param {string} key  Settlement key, e.g. "castle:0"
   * @returns {{ buildingQueue: object[], roads: Map<string,object>, builtRoads: Set<string>, hasPort: boolean, portTile: {tx:number,ty:number}|null }}
   */
  _getConstructionState(key) {
    if (!this._constructionState.has(key)) {
      this._constructionState.set(key, {
        buildingQueue: [],
        roads:         new Map(),
        builtRoads:    new Set(),
        hasPort:       false,
        portTile:      null,
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
   * Return an array of all player-built port sea-tile positions.
   * Used by Game.js and StructureRenderer to draw port markers.
   * @returns {{ tx: number, ty: number }[]}
   */
  getBuiltPortTiles() {
    const result = [];
    for (const state of this._constructionState.values()) {
      if (state.hasPort && state.portTile) {
        result.push(state.portTile);
      }
    }
    return result;
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
      if (settlement && state.buildingQueue.length > 0) {
        const center = this._getSettlementCenter(settlement);
        state.buildingQueue.forEach((item, i) => {
          workers.push({
            id:     `building:${key}:${i}`,
            type:   'building',
            worldX: (center.tx + 0.5) * TILE_SIZE,
            worldY: (center.ty + 0.5) * TILE_SIZE,
          });
        });
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
        const totalHours   = road.tilesTotal * hoursPerTile;
        const progress     = totalHours > 0
          ? Math.max(0, Math.min(1, 1 - road.hoursLeft / totalHours))
          : 0;

        const fromX = (fromCenter.tx + 0.5) * TILE_SIZE;
        const fromY = (fromCenter.ty + 0.5) * TILE_SIZE;
        const toX   = (toCenter.tx + 0.5) * TILE_SIZE;
        const toY   = (toCenter.ty + 0.5) * TILE_SIZE;

        workers.push({
          id:     `road:${rk}`,
          type:   road.isDemo ? 'demolish' : 'road',
          worldX: fromX + (toX - fromX) * progress,
          worldY: fromY + (toY - fromY) * progress,
        });
      }
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
   * Render the main construction panel with three tabs (建築 / 道路 / 港口).
   * @param {import('../systems/BuildingSystem.js').Building} building  Government building
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderConstructionPanel(building, settlement) {
    const content = document.getElementById('location-content');
    if (!content) return;

    const { coastal } = this._isCoastalSettlement(settlement);
    const tabs = ['建築', '道路', ...(coastal ? ['港口'] : [])];
    if (!this._constructionTab || !tabs.includes(this._constructionTab)) {
      this._constructionTab = '建築';
    }

    const tabsHTML = tabs.map(t => `
      <button class="constr-tab-btn${this._constructionTab === t ? ' active' : ''}" data-ctab="${t}">${t}</button>
    `).join('');

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

    content.querySelectorAll('.constr-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._constructionTab = btn.dataset.ctab;
        this._renderConstructionPanel(building, settlement);
      });
    });

    if (this._constructionTab === '建築') {
      this._renderBuildingConstructionTab(building, settlement);
    } else if (this._constructionTab === '道路') {
      this._renderRoadConstructionTab(building, settlement);
    } else if (this._constructionTab === '港口') {
      this._renderPortConstructionTab(building, settlement);
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

    // Already-built buildings
    const builtNames = (settlement.buildings ?? []).map(b => b.name);

    // In-progress buildings
    const queueHTML = state.buildingQueue.length > 0
      ? state.buildingQueue.map((q, i) => `
          <div class="constr-queue-row">
            <span class="cqr-icon">${q.icon}</span>
            <span class="cqr-name">${q.name}</span>
            <span class="cqr-timer">⏳ 剩 ${q.daysLeft} 天</span>
          </div>`).join('')
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
      <div class="constr-section-title">建築位置：${usedSlots} / ${maxSlots}</div>
      <div class="constr-built-list">
        ${builtNames.map(n => `<span class="constr-built-tag">✅ ${n}</span>`).join('')}
      </div>
      <div class="constr-section-title">建造中</div>
      <div class="constr-queue">${queueHTML}</div>
      ${freeSlots > 0 ? '<div class="constr-section-title">可新增建築</div>' : ''}
      <div class="constr-option-list">${availableHTML}</div>
    `;

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
        this._addInboxMessage('🏗️', `開始建造 ${meta.name}（${settlement.name}），預計 ${CONSTR_BUILDING_DAYS} 天後完工。`);
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
      // Built roads
      for (const rk of state.builtRoads) {
        const parts  = rk.split('↔');
        const other  = parts.find(p => p !== key) ?? '';
        const oSett  = this._getSettlementByKey(other);
        const name   = oSett ? `${oSett.type === 'castle' ? '🏰' : '🏘️'} ${oSett.name}` : other;
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
        const hoursPerTile = road.isDemo ? CONSTR_ROAD_DEMO_HOURS_PER_TILE : CONSTR_ROAD_HOURS_PER_TILE;
        const totalHours = road.tilesTotal * hoursPerTile;
        const pct        = Math.round((1 - road.hoursLeft / totalHours) * 100);
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

    // Build new road options
    const newRoadHTML = targets.length === 0
      ? '<div class="constr-empty-note">無可連接的己方地區</div>'
      : `<div class="constr-road-form">
          <label class="constr-road-label">目標地區</label>
          <select id="constr-road-target" class="constr-road-select">
            ${targets.map(t => `<option value="${t.key}" data-tiles="${this._getRoadTiles(settlement, t.settlement)}">${t.label}</option>`).join('')}
          </select>
          <div id="constr-road-info" class="constr-road-info"></div>
          <button class="btn-buy constr-road-build-btn" id="btn-build-road">🚧 開始建造</button>
        </div>`;

    panel.innerHTML = `
      <div class="constr-section-title">現有道路</div>
      <div class="constr-road-list">${roadsHTML}</div>
      <div class="constr-section-title">新建道路</div>
      ${newRoadHTML}
    `;

    // Update road info on target change
    const updateRoadInfo = () => {
      const sel = document.getElementById('constr-road-target');
      if (!sel) return;
      const opt   = sel.options[sel.selectedIndex];
      const tiles = Number(opt?.dataset?.tiles ?? 0);
      const hours = tiles * CONSTR_ROAD_HOURS_PER_TILE;
      const cost  = tiles * CONSTR_ROAD_COST_PER_TILE;
      const infoEl = document.getElementById('constr-road-info');
      if (infoEl) {
        const rk = this._roadKey(key, sel.value);
        const alreadyBuilt = state.builtRoads.has(rk);
        const inProgress   = state.roads.has(rk);
        if (alreadyBuilt) {
          infoEl.innerHTML = '<span style="color:#66bb6a">✅ 此路段已完成</span>';
        } else if (inProgress) {
          infoEl.innerHTML = '<span style="color:#ffa726">⚠️ 此路段正在施工</span>';
        } else {
          infoEl.innerHTML = `路程約 ${tiles} 格 · 預計 ${hours} 工時 · 費用 🪙${cost}`;
        }
      }
    };

    document.getElementById('constr-road-target')?.addEventListener('change', updateRoadInfo);
    updateRoadInfo();

    document.getElementById('btn-build-road')?.addEventListener('click', () => {
      const sel = document.getElementById('constr-road-target');
      if (!sel) return;
      const targetKey  = sel.value;
      const opt        = sel.options[sel.selectedIndex];
      const tiles      = Number(opt?.dataset?.tiles ?? 0);
      const cost       = tiles * CONSTR_ROAD_COST_PER_TILE;
      const rk         = this._roadKey(key, targetKey);

      if (state.builtRoads.has(rk)) { this._toast('✅ 此路段已建完！'); return; }
      if (state.roads.has(rk))      { this._toast('⚠️ 此路段已在施工中！'); return; }
      if (tiles < 1)                 { this._toast('目標太近，無需建造道路。'); return; }
      if (this._getGold() < cost)   { this._toast('💸 金幣不足！'); return; }

      this._spendGold(cost);

      // Find target name for display
      const targetSett = this._getSettlementByKey(targetKey);
      const targetName = targetSett ? targetSett.name : targetKey;

      // Add road to this settlement's queue
      state.roads.set(rk, {
        targetKey,
        targetName,
        tilesTotal:  tiles,
        hoursLeft:   tiles * CONSTR_ROAD_HOURS_PER_TILE,
        isDemo:      false,
      });

      // Mirror the in-progress road state to the target settlement so the
      // target side also shows the road when the player visits there.
      const targetState = this._getConstructionState(targetKey);
      targetState.roads.set(rk, {
        targetKey: key,
        targetName: settlement.name,
        tilesTotal:  tiles,
        hoursLeft:   tiles * CONSTR_ROAD_HOURS_PER_TILE,
        isDemo:      false,
      });

      this._addInboxMessage('🚧', `開始修建 ${settlement.name} → ${targetName} 的道路（${tiles} 格，需 ${tiles * CONSTR_ROAD_HOURS_PER_TILE} 工時）。`);
      this._renderConstructionPanel(govBuilding, settlement);
    });

    // Demolish road
    panel.querySelectorAll('.crr-demo-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const rk = btn.dataset.rkey;
        if (!state.builtRoads.has(rk)) return;
        state.builtRoads.delete(rk);

        // Determine tiles (use both settlement keys to find target)
        const other      = rk.split('↔').find(p => p !== key) ?? '';
        const otherSett  = this._getSettlementByKey(other);
        const tiles      = otherSett ? this._getRoadTiles(settlement, otherSett) : 1;

        // Also remove from target side built roads
        const targetState = this._getConstructionState(other);
        targetState.builtRoads.delete(rk);

        // Queue demolition
        state.roads.set(rk, {
          targetKey:   other,
          targetName:  otherSett?.name ?? other,
          tilesTotal:  tiles,
          hoursLeft:   tiles * CONSTR_ROAD_DEMO_HOURS_PER_TILE,
          isDemo:      true,
        });
        targetState.roads.set(rk, {
          targetKey:   key,
          targetName:  settlement.name,
          tilesTotal:  tiles,
          hoursLeft:   tiles * CONSTR_ROAD_DEMO_HOURS_PER_TILE,
          isDemo:      true,
        });

        this._addInboxMessage('🪚', `開始拆除 ${settlement.name} 的道路。`);
        this._renderConstructionPanel(govBuilding, settlement);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Construction – port tab
  // -------------------------------------------------------------------------

  /**
   * @param {import('../systems/BuildingSystem.js').Building} govBuilding
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderPortConstructionTab(govBuilding, settlement) {
    const panel = document.getElementById('constr-tab-content');
    if (!panel) return;

    const key   = this._settlementKey(settlement);
    const state = this._getConstructionState(key);
    const { coastal, tile: portTile } = this._isCoastalSettlement(settlement);

    if (!coastal) {
      panel.innerHTML = '<div class="constr-empty-note">此地非濱海地區，無法建造港口。</div>';
      return;
    }

    if (state.hasPort) {
      panel.innerHTML = `
        <div class="constr-port-status built">
          <span class="cps-icon">⚓</span>
          <div class="cps-info">
            <div class="cps-title">港口已建造</div>
            <div class="cps-desc">玩家可在此出海，返回陸地後需回到此港口方可再次入海。</div>
          </div>
        </div>
      `;
      return;
    }

    panel.innerHTML = `
      <div class="constr-port-status pending">
        <span class="cps-icon">🚢</span>
        <div class="cps-info">
          <div class="cps-title">可建造港口</div>
          <div class="cps-desc">在濱海地塊自動建造港口，建成後玩家可從此出海。</div>
          ${this._goldBarHTML()}
          <button class="btn-buy constr-port-build-btn" id="btn-build-port">⚓ 建造港口（🪙${CONSTR_PORT_COST}）</button>
        </div>
      </div>
    `;

    document.getElementById('btn-build-port')?.addEventListener('click', () => {
      if (this._getGold() < CONSTR_PORT_COST) { this._toast('💸 金幣不足！'); return; }
      this._spendGold(CONSTR_PORT_COST);
      state.hasPort   = true;
      state.portTile  = portTile;
      this._addInboxMessage('⚓', `${settlement.name} 港口建造完成！玩家可在此出海。`);
      if (typeof this.onPortBuilt === 'function') this.onPortBuilt();
      this._renderConstructionPanel(govBuilding, settlement);
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
   * Show the letter type selector.
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _renderSendLetter(settlement) {
    const content = document.getElementById('location-content');
    if (!content) return;

    content.innerHTML = `
      ${this._facilityBackHTML(settlement)}
      <div class="fac-title">📨 派送信件</div>
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

    this._attachFacilityBack(settlement);

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

      const ok = this.diplomacySystem.sendCondemnationLetter({ receiverNationId: targetId, fromSettlement });
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

      const ok = this.diplomacySystem.sendGiftLetter({ receiverNationId: targetId, fromSettlement, goldAmount: goldInput });
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

      const ok = this.diplomacySystem.sendWarDeclaration({ receiverNationId: targetId, fromSettlement, reason });
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
      `敵 ${enemy.hp}/${enemy.maxHp}  ⚔  我 ${player.hp}/${player.maxHp}`;

    // Enemy unit row (ruler icon + troop icons, faded when defeated)
    const enemyAlive = Math.max(0, Math.ceil(enemy.troopCount * enemyPct / 100));
    const enemyIcons = [
      `<span class="btl-unit-enemy btl-leader${enemyPct === 0 ? ' btl-fallen' : ''}" title="${enemy.name} ${enemy.role}">👑</span>`,
      ...Array.from({ length: enemy.troopCount }, (_, i) =>
        `<span class="btl-unit-enemy${i < enemyAlive ? '' : ' btl-fallen'}">⚔</span>`
      ),
    ];
    document.getElementById('battle-enemy-row').innerHTML =
      `<div class="btl-row-label">敵軍陣列</div><div class="btl-unit-row">${enemyIcons.join('')}</div>`;

    // Player unit row (character avatars, faded when defeated)
    const aliveCount   = Math.ceil(player.memberCount * playerPct / 100);
    const memberIcons  = player.members.map((m, idx) => {
      const alive    = idx < aliveCount;
      const charHtml = m.appearance ? renderCharHTML(m.appearance, 28) : '👤';
      return `<span class="btl-unit-player${alive ? '' : ' btl-fallen'}" title="${m.name}${alive ? '' : ' (陣亡)'}">${charHtml}</span>`;
    });
    document.getElementById('battle-player-row').innerHTML =
      `<div class="btl-unit-row">${memberIcons.join('')}</div><div class="btl-row-label">我方陣列</div>`;

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
      const alreadyCaptured = result === 'victory' && this.isPlayerSettlement(settlement);
      const captureBtn = result === 'victory' && !alreadyCaptured
        ? `<button id="btn-battle-capture" class="btn-battle-capture">🏴 佔領 ${settlement.name}</button>`
        : result === 'victory' && alreadyCaptured
          ? `<div class="btl-captured-badge">🏴 已佔領</div>`
          : '';
      actionsEl.innerHTML = `
        <div class="btl-result ${r.cls}">${r.icon} ${r.label}</div>
        ${captureBtn}
        <button id="btn-battle-exit" class="btn-battle-exit">離開戰場</button>`;
      if (result === 'victory' && !alreadyCaptured) {
        actionsEl.querySelector('#btn-battle-capture').addEventListener('click', () => {
          this._captureSettlement(settlement);
          this._renderBattleScene(); // re-render to flip button → badge
        });
      }
      actionsEl.querySelector('#btn-battle-exit').addEventListener('click', () => this._closeBattleScene());
    } else {
      actionsEl.innerHTML = `
        <button class="btn-battle-cmd" id="btn-battle-attack">⚔ 進攻</button>
        <button class="btn-battle-cmd" id="btn-battle-defend">🛡 防守</button>
        <button class="btn-battle-cmd" id="btn-battle-retreat">🏃 後退</button>`;
      actionsEl.querySelector('#btn-battle-attack').addEventListener('click', () => this._handleBattleCommand('attack'));
      actionsEl.querySelector('#btn-battle-defend').addEventListener('click', () => this._handleBattleCommand('defend'));
      actionsEl.querySelector('#btn-battle-retreat').addEventListener('click', () => this._handleBattleCommand('retreat'));
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
        m.stats.hp = Math.max(0, m.stats.hp - share);
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
        builtRoads: [...state.builtRoads],
        hasPort: state.hasPort,
        portTile: state.portTile,
      });
    }

    return {
      inventory:            this.inventory.getState(),
      army:                 this.army.getState(),
      playerKingdom:        { ...this._playerKingdom },
      capturedSettlements:  [...this._capturedSettlements],
      tavernState:          Object.fromEntries(this._tavernState),
      satisfactionMap:      Object.fromEntries(this._satisfactionMap),
      inbox:                [...this._inbox],
      constructionState,
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
      // Apply playerOwned flag to Settlement objects so StructureRenderer
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
          builtRoads:    new Set(entry.builtRoads ?? []),
          hasPort:       entry.hasPort ?? false,
          portTile:      entry.portTile ?? null,
        });
      }
    }
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
      this._setSettlementOwnership(s, key !== '' && this._capturedSettlements.has(key));
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

    this._setSettlementOwnership(settlement, true);
    this._capturedSettlements.add(key);
    this._playerSettlementCount = this._capturedSettlements.size;

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
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
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

    // Mark all visible messages as read (but not un-responded peace offers).
    this._inbox.forEach(m => {
      if (!m.isPeaceOffer || m.responded) m.read = true;
    });
    this._inboxUnread = this._inbox.filter(m => !m.read).length;
    this._updateInboxBadge();

    if (this._inbox.length === 0) {
      content.innerHTML = `<div class="ui-empty">📭 信件夾是空的</div>`;
      return;
    }

    const rows = this._inbox.map((m, i) => {
      const actionBtns = (m.isPeaceOffer && !m.responded)
        ? `<div class="inbox-peace-actions">
             <button class="btn-buy inbox-accept-btn" data-idx="${i}">✅ 同意</button>
             <button class="inbox-ignore-btn" data-idx="${i}">❌ 無視</button>
           </div>`
        : '';
      const respondedLabel = (m.isPeaceOffer && m.responded)
        ? `<span class="inbox-responded-label">${m._acceptedPeace === true ? '（已同意）' : '（已無視）'}</span>`
        : '';
      return `
        <div class="inbox-row${m.read && (!m.isPeaceOffer || m.responded) ? '' : ' inbox-unread'}" data-idx="${i}">
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

    // Bind peace offer buttons
    content.querySelectorAll('.inbox-accept-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        this._inbox[idx]._acceptedPeace = true;
        this._respondToPeaceOffer(idx, true);
      });
    });
    content.querySelectorAll('.inbox-ignore-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        this._inbox[idx]._acceptedPeace = false;
        this._respondToPeaceOffer(idx, false);
      });
    });
  }
}
