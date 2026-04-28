import { Inventory }                      from '../systems/Inventory.js';
import { Army, MAX_MEMBERS, TRAIT_CAPTAIN } from '../systems/Army.js';

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
   */
  constructor(savedState = null, onSave = null) {
    this.inventory = new Inventory();
    this.army      = new Army('主角');

    /** @type {'backpack'|'team'|null} */
    this._activePanel  = null;
    this._activeSquad  = 0;

    /** Active backpack category tab and equipment sub-tab. */
    this._backpackTab  = 'all';
    this._equipSubTab  = 'weapon';

    /** Id of the unit whose move-target panel is currently open, or null. */
    this._movingUnitId = null;

    /** Callback invoked when the player manually triggers a save. */
    this.onSave = onSave;

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
      <button id="btn-backpack" class="ui-tab-btn" title="背包">🎒</button>
      <button id="btn-team"     class="ui-tab-btn" title="隊伍">⚔️</button>
      <button id="btn-save"     class="ui-tab-btn" title="儲存">💾</button>
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
  }

  // -------------------------------------------------------------------------
  // Listeners
  // -------------------------------------------------------------------------

  _attachListeners() {
    document.getElementById('btn-backpack').addEventListener('click', () => this._togglePanel('backpack'));
    document.getElementById('btn-team').addEventListener('click',     () => this._togglePanel('team'));
    document.getElementById('ui-panel-close').addEventListener('click', () => this._closePanel());

    document.getElementById('btn-save').addEventListener('click', () => {
      if (typeof this.onSave === 'function') {
        this.onSave();
      }
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
    document.getElementById('btn-backpack').classList.toggle('active', type === 'backpack');
    document.getElementById('btn-team').classList.toggle('active',     type === 'team');

    if (type === 'backpack') {
      document.getElementById('ui-panel-title').textContent = '🎒 背包';
      this._renderBackpack();
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
      loot: '資源', consumable: '消耗',
    };
  }

  _filterItems(items) {
    const tab = this._backpackTab;
    const EQUIP = GameUI._EQUIP_TYPES;
    if (tab === 'all')       return items;
    if (tab === 'equipment') return items.filter(i => i.type === this._equipSubTab);
    if (tab === 'potion')    return items.filter(i => i.type === 'potion' || i.type === 'consumable');
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
  // Team
  // -------------------------------------------------------------------------

  _renderTeam() {
    const content = document.getElementById('ui-panel-content');
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

  _renderSquadDetail(squad) {
    const detail = document.getElementById('squad-detail');
    const captain = squad.captain;

    const memberCards = [];
    for (let i = 0; i < MAX_MEMBERS; i++) {
      const m = squad.members[i];
      if (m) {
        const isCaptain = m.id === squad.captainId;
        memberCards.push(`
          <div class="unit-card-compact${isCaptain ? ' captain' : ''}${m.active ? '' : ' inactive'}"
               data-id="${m.id}" role="button" tabindex="0">
            <span class="ucc-badge">${isCaptain ? '⭐' : '👤'}</span>
            <span class="ucc-name">${m.name}</span>
            <span class="ucc-role">${m.role}</span>
            <span class="ucc-status${m.active ? ' active' : ''}">${m.active ? '參戰' : '待命'}</span>
            <span class="ucc-arrow">›</span>
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

    document.getElementById('ui-unit-detail-body').innerHTML = `
      <div class="ud-row">
        <span class="ud-label">職業</span>
        <span class="ud-value">${unit.role}</span>
      </div>
      <div class="ud-row">
        <span class="ud-label">狀態</span>
        <button class="btn-toggle-active${unit.active ? ' is-active' : ''}" data-id="${unit.id}">
          ${unit.active ? '✅ 參戰中' : '💤 待命中'}
        </button>
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
      ${!isHero ? `
      <div class="ud-actions">
        ${captainBtn}
        <div class="ud-move-section">
          <span class="ud-label">移至小隊</span>
          <div class="move-targets">${moveTargetsHTML}</div>
        </div>
        <button class="btn-remove-member" data-id="${unit.id}">❌ 移除成員</button>
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
  // Persistence
  // -------------------------------------------------------------------------

  /** @returns {{ inventory: object, army: object }} serialisable snapshot */
  getState() {
    return {
      inventory: this.inventory.getState(),
      army:      this.army.getState(),
    };
  }

  /**
   * Restore inventory and army from a saved snapshot (skips demo seed).
   * @param {{ inventory?: object, army?: object }} state
   */
  loadState(state) {
    if (!state) return;
    if (state.inventory) this.inventory.loadState(state.inventory);
    if (state.army)      this.army.loadState(state.army);
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
