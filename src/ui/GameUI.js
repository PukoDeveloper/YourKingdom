import { Inventory }                      from '../systems/Inventory.js';
import { Army, MAX_MEMBERS, TRAIT_CAPTAIN } from '../systems/Army.js';
import { TRAIT_RULER }                     from '../systems/NationSystem.js';
import {
  RELATION_LEVELS,
  PERSONALITY_COLORS,
  PERSONALITY_ARROGANT, PERSONALITY_WARLIKE, PERSONALITY_GENTLE,
  PERSONALITY_CUNNING,  PERSONALITY_CAUTIOUS, ALL_PERSONALITIES,
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
   */
  constructor(savedState = null, onSave = null, nationSystem = null, onReset = null, player = null, diplomacySystem = null) {
    this.inventory = new Inventory();
    this.army      = new Army('主角');

    /** @type {import('../systems/NationSystem.js').NationSystem|null} */
    this.nationSystem = nationSystem;

    /** @type {import('../systems/DiplomacySystem.js').DiplomacySystem|null} */
    this.diplomacySystem = diplomacySystem;

    /** @type {import('../entities/Player.js').Player|null} */
    this.player = player;

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

    /** Callback invoked when the player manually triggers a save. */
    this.onSave = onSave;

    /** Callback invoked when the player confirms a game reset. */
    this.onReset = onReset;

    /**
     * Callback invoked after a settlement is captured by the player.
     * The game can use this to rebuild map visuals.
     * @type {(() => void)|null}
     */
    this.onCaptureSettlement = null;

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

    // NOTE: Battle preview overlay and battle scene overlay are declared in index.html
    // (static HTML) so they are always available when _attachListeners() runs.
  }

  _attachListeners() {
    document.getElementById('btn-backpack').addEventListener('click', () => this._togglePanel('backpack'));
    document.getElementById('btn-team').addEventListener('click',     () => this._togglePanel('team'));
    document.getElementById('btn-nations').addEventListener('click',  () => this._togglePanel('nations'));
    document.getElementById('btn-appearance').addEventListener('click', () => this._togglePanel('appearance'));
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
      loot: '資源', consumable: '消耗', trophy: '戰利品',
    };
  }

  /** All item types that map to an explicit category (used for 其他 catch-all). */
  static get _KNOWN_TYPES() {
    return new Set([
      ...GameUI._EQUIP_TYPES,
      'accessory', 'food', 'potion', 'consumable', 'utility', 'loot', 'trophy',
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
    const usable  = ['consumable', 'potion', 'utility'].includes(item.type);
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
        ${usable ? `<button class="btn-item-use" data-id="${item.id}">▶ 使用</button>` : ''}
        <button class="btn-item-discard" data-id="${item.id}">🗑 丟棄</button>
      </div>
    `;

    document.getElementById('ui-item-detail-overlay').classList.add('visible');

    const detailBody = document.getElementById('ui-item-detail-body');
    detailBody.querySelector('.btn-item-use')?.addEventListener('click', () => {
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
    nameInput.addEventListener('input', () => {
      this._playerKingdom.name = nameInput.value || DEFAULT_KINGDOM.name;
      nameDisplay.textContent = this._playerKingdom.name;
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
   * @returns {{ color: string, emblem: string, name: string, flagApp: object }}
   */
  getPlayerNation() {
    return {
      color:   '#e2c97e',
      emblem:  '🏴',
      name:    this._playerKingdom.name,
      flagApp: this._getPlayerFlagApp(),
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

    // Group villages by nationId for quick lookup
    const villagesByNation = {};
    villageSettlements.forEach((v, idx) => {
      if (!villagesByNation[v.nationId]) villagesByNation[v.nationId] = [];
      villagesByNation[v.nationId].push({ s: v, idx });
    });

    const _personalityLabel = (traits) => {
      const p = traits.find(t => ALL_PERSONALITIES.includes(t));
      if (!p) return '';
      const color = PERSONALITY_COLORS[p] ?? '#fff';
      return `<span class="dipl-personality" style="color:${color}">${p}</span>`;
    };

    const nationCardsHTML = nations.map((nation, id) => {
      const castle  = castleSettlements[id];
      const val     = this.diplomacySystem.getPlayerRelation(id);
      const level   = this.diplomacySystem.getRelationLevel(val);
      const flagH   = nation.flagApp ? renderFlagHTML(nation.flagApp, 32) : `<span>${nation.emblem}</span>`;
      const alreadyCondemned = this.diplomacySystem.hasCondemnedToday(id);
      const isOwned = castle?.playerOwned;
      const villages = villagesByNation[id] ?? [];

      // Relation bar + level header
      const relVal = val > 0 ? `+${val}` : `${val}`;
      const headerHTML = `
        <div class="dn-header">
          <span class="dn-flag">${flagH}</span>
          <div class="dn-title-col">
            <div class="dn-name">
              ${nation.name}
              ${isOwned ? '<span class="sc-player-badge">我方</span>' : ''}
            </div>
            <div class="dn-ruler-line">
              ${castle ? `${castle.ruler.name}（${castle.ruler.role}） ${_personalityLabel(castle.ruler.traits)}` : ''}
            </div>
          </div>
          <div class="dn-rel-col">
            <div class="dn-level" style="color:${level.color}">${level.icon} ${level.label}</div>
            <div class="dn-val" style="color:${level.color}">${relVal}</div>
          </div>
          ${!isOwned ? `<button class="dipl-condemn-btn${alreadyCondemned ? ' used' : ''}" data-nation-id="${id}"
                   ${alreadyCondemned ? 'disabled title="今日已譴責"' : ''}>
              ${alreadyCondemned ? '✓ 已譴責' : '📢 譴責'}
            </button>` : ''}
        </div>
        <div class="dn-bar-wrap">
          <div class="dn-bar" style="width:${(val + 100) / 2}%;background:${level.color}"></div>
        </div>`;

      // Settlement rows
      const castleRow = castle ? `
        <div class="dn-settlement-row" data-ns-type="castle" data-ns-idx="${id}" role="button" tabindex="0">
          <span class="dn-s-icon">🏰</span>
          <span class="dn-s-name">${castle.name}</span>
          <span class="dn-s-pop">👥 ${castle.population.toLocaleString()}</span>
          <span class="dn-s-eco">${'⭐'.repeat(castle.economyLevel)}</span>
          <span class="dn-s-res">${castle.resources.join('、')}</span>
          <span class="dn-s-arrow">›</span>
        </div>` : '';

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
          <div class="dn-settlements">${castleRow}${villageRows}</div>
          ${memoryHTML}
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="dipl-intro">各國外交關係受距離、資源競爭及統治者性格影響。<br>
        <span style="color:#ef6c00">傲慢</span>、<span style="color:#e53935">好戰</span>的統治者可能自發惡化關係；
        <span style="color:#66bb6a">溫和</span>的統治者會主動釋出善意。</div>
      <div class="dipl-nation-list">${nationCardsHTML}</div>`;

    // Condemn buttons
    el.querySelectorAll('.dipl-condemn-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const nationId = Number(btn.dataset.nationId);
        const result = this.diplomacySystem.condemn(nationId);
        if (result.success) {
          const nation = this.nationSystem.nations[nationId];
          this._toast(`📢 你公開譴責了 ${nation.name}，關係惡化 ${result.delta}。`);
          this._renderDiplomacy();
        } else {
          this._toast('今日已對此國發出譴責，明日再試。');
        }
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
  // Settlement detail overlay
  // -------------------------------------------------------------------------

  /**
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _openSettlementDetail(settlement) {
    const isPlayer  = settlement.playerOwned;
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
        this._toast(`⚠ 糧食不足！缺少 ${toConsume} 份糧食`);
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
      this._toast(`💊 ${recoveredCount} 名士兵已從重傷中恢復，可重新參戰！`);
    }

    // Diplomacy: NPC daily events (arrogant rulers condemn, gentle rulers show goodwill, etc.)
    if (this.diplomacySystem) {
      const events = this.diplomacySystem.onDayPassed();
      if (events.length > 0) {
        // Show one random event to avoid toast spam
        const ev = events[Math.floor(Math.random() * events.length)];
        this._toast(ev.message);
      }
    }

    if (this._activePanel === 'team' && this._teamInfoTab === 'info') {
      this._renderTeamInfo();
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
          && !s.playerOwned;
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
      const nation = s.playerOwned
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
      nation = settlement.playerOwned
        ? this.getPlayerNation()
        : this.nationSystem.getNation(settlement);
    }
    const nationName = nation ? nation.name : settlement.name;

    const isPlayerOwned = this.isPlayerSettlement(settlement);
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
    const content = document.getElementById('location-content');

    let facilities;
    let sectionTitle;

    if (settlement.type === 'castle') {
      sectionTitle = '城內設施';
      facilities = [
        { icon: '🏯', name: '王宮',  desc: '國王接見廳\n覲見統治者' },
        { icon: '🏨', name: '旅店',  desc: '安心休憩之所\n恢復體力' },
        { icon: '🍺', name: '酒館',  desc: '打聽情報\n招募夥伴' },
        { icon: '🏪', name: '雜貨店', desc: '買賣物資\n補充補給' },
        { icon: '⚒️', name: '鐵匠',  desc: '鍛造武器\n強化裝備' },
        { icon: '🛡️', name: '守衛所', desc: '城衛指揮所\n申請護衛' },
      ];
    } else if (settlement.type === 'village') {
      sectionTitle = '村內設施';
      facilities = [
        { icon: '🏠', name: '村長家', desc: '委託任務\n了解近況' },
        { icon: '🛒', name: '市集',   desc: '交易物資\n農產買賣' },
        { icon: '🛏️', name: '旅舍',   desc: '歇腳休息\n補充體力' },
        { icon: '🏪', name: '雜貨鋪', desc: '日常用品\n基本補給' },
      ];
    } else {
      // port
      sectionTitle = '港口設施';
      facilities = [
        { icon: '⚓', name: '碼頭',  desc: '船運服務\n乘船出行' },
        { icon: '📦', name: '倉庫',  desc: '存放貨物\n物資管理' },
        { icon: '🍺', name: '酒館',  desc: '水手常聚\n打聽消息' },
        { icon: '🏪', name: '雜貨店', desc: '海貨特產\n補給物資' },
      ];
    }

    const backRow = settlement.type === 'castle' ? `
      <div class="loc-back-row">
        <button class="btn-loc-back" id="btn-loc-back">← 返回城門</button>
      </div>` : '';

    const facilityCards = facilities.map((f, i) => `
      <div class="facility-card" data-facility-idx="${i}" role="button" tabindex="0">
        <div class="fc-icon">${f.icon}</div>
        <div class="fc-name">${f.name}</div>
        <div class="fc-desc">${f.desc.replace(/\n/g, '<br>')}</div>
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

    content.querySelectorAll('.facility-card[data-facility-idx]').forEach(card => {
      const open = () => {
        const idx = Number(card.dataset.facilityIdx);
        const f   = facilities[idx];
        this._toast(`${f.icon} ${f.name}：功能開發中…`);
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  }

  // -------------------------------------------------------------------------
  // Battle preview
  // -------------------------------------------------------------------------

  /**
   * Generate enemy force stats from a settlement.
   * @param {import('../systems/NationSystem.js').Settlement} settlement
   */
  _generateEnemyForce(settlement) {
    const ruler = settlement.ruler;
    const econ  = settlement.economyLevel;
    const isCastle = settlement.type === 'castle';

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
    const nation    = this.nationSystem ? this.nationSystem.getNation(settlement) : null;
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
      this._triggerBattleAttackDiplomacy(state.settlement, state.result === 'victory');
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
    if (!nation || nation.id < 0 || settlement.playerOwned) return;
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
        this._toast(`⚠ ${woundedCount} 名士兵受重傷，需要靜養恢復！`);
      }
    }

    document.getElementById('battle-scene-overlay')?.classList.remove('visible');
    this._battleState = null;
  }

  /** @returns {{ inventory: object, army: object, playerKingdom: object, capturedSettlements: string[] }} serialisable snapshot */
  getState() {
    return {
      inventory:            this.inventory.getState(),
      army:                 this.army.getState(),
      playerKingdom:        { ...this._playerKingdom },
      capturedSettlements:  [...this._capturedSettlements],
    };
  }

  /**
   * Restore inventory and army from a saved snapshot (skips demo seed).
   * @param {{ inventory?: object, army?: object, playerKingdom?: object, capturedSettlements?: string[] }} state
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
  }

  /**
   * Iterate `_capturedSettlements` and set `playerOwned = true` on the
   * matching Settlement objects in NationSystem.
   * Also clears `playerOwned` on settlements not in the set.
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
      s.playerOwned = key !== '' && this._capturedSettlements.has(key);
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
    return settlement?.playerOwned === true;
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

    settlement.playerOwned = true;
    this._capturedSettlements.add(key);
    this._playerSettlementCount = this._capturedSettlements.size;

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
}
