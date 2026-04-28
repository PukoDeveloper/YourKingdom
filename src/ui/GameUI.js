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
    this.inventory.addItem({ name: '金幣',     type: 'loot',        icon: '🪙', quantity: 50 });
    this.inventory.addItem({ name: '木材',     type: 'loot',        icon: '🪵', quantity: 20 });
    this.inventory.addItem({ name: '鐵礦石',   type: 'loot',        icon: '⛏️', quantity: 15 });
    this.inventory.addItem({ name: '治療藥水', type: 'consumable',  icon: '🧪', quantity: 3,
      description: '恢復生命值' });
    this.inventory.addItem({ name: '速度符',   type: 'consumable',  icon: '💨', quantity: 1,
      description: '短暫提升移動速度' });

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

  _renderBackpack() {
    const content = document.getElementById('ui-panel-content');
    const items   = this.inventory.getItems();

    if (items.length === 0) {
      content.innerHTML = '<p class="ui-empty">背包是空的</p>';
      return;
    }

    content.innerHTML = `
      <div class="item-grid">
        ${items.map(it => `
          <div class="item-card">
            <span class="item-icon">${it.icon}</span>
            <span class="item-name">${it.name}</span>
            <span class="item-qty">×${it.quantity}</span>
            ${it.description ? `<span class="item-desc">${it.description}</span>` : ''}
            ${it.type === 'consumable'
              ? `<button class="btn-use" data-id="${it.id}">使用</button>`
              : ''}
          </div>
        `).join('')}
      </div>
    `;

    content.querySelectorAll('.btn-use').forEach(btn => {
      btn.addEventListener('click', () => {
        const desc = this.inventory.useItem(Number(btn.dataset.id));
        if (desc) this._toast(desc);
        this._renderBackpack();
      });
    });
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
    const detail  = document.getElementById('squad-detail');
    const squads  = this.army.getSquads();
    const captain = squad.captain;

    const memberCards = [];
    for (let i = 0; i < MAX_MEMBERS; i++) {
      const m = squad.members[i];
      if (m) {
        const isCaptain = m.id === squad.captainId;
        const isHero    = m.role === 'hero';
        const isMoving  = this._movingUnitId === m.id;

        const traitsHTML = m.traits.length > 0
          ? `<div class="unit-traits">${
              m.traits.map(t =>
                `<span class="trait-tag${t === TRAIT_CAPTAIN ? ' trait-captain' : ''}">${t}</span>`
              ).join('')
            }</div>`
          : '';

        const captainBtn = (!isCaptain && m.canLead())
          ? `<button class="btn-set-captain" data-id="${m.id}">⭐設隊長</button>`
          : '';

        const moveTargetsHTML = isMoving
          ? squads
              .filter(s => s.id !== squad.id)
              .map(s => `<button class="btn-move-to" data-id="${m.id}" data-target="${s.id}"
                          ${!s.hasCapacity() ? 'disabled' : ''}>
                          → 小隊${s.id + 1}${s.hasCapacity() ? '' : '（滿）'}
                        </button>`)
              .join('')
          : '';

        const movePanelHTML = isMoving
          ? `<div class="move-targets">${moveTargetsHTML}</div>`
          : '';

        memberCards.push(`
          <div class="unit-card member${isCaptain ? ' captain' : ''}${m.active ? '' : ' inactive'}">
            <span class="unit-badge">${isCaptain ? '⭐隊長' : '👤隊員'}</span>
            <span class="unit-name">${m.name}</span>
            <span class="unit-role">${m.role}</span>
            <button class="btn-toggle-active${m.active ? ' is-active' : ''}" data-id="${m.id}">${m.active ? '✅參戰' : '💤待命'}</button>
            ${traitsHTML}
            <div class="unit-stats">攻 ${m.stats.attack}&nbsp;防 ${m.stats.defense}&nbsp;士氣 ${m.stats.morale}</div>
            <div class="unit-card-actions">
              ${captainBtn}
              ${!isHero ? `<button class="btn-move${isMoving ? ' active' : ''}" data-id="${m.id}">🔀移動${isMoving ? '▲' : '▼'}</button>` : ''}
              ${!isHero ? `<button class="btn-remove-member" data-id="${m.id}">❌移除</button>` : ''}
            </div>
            ${movePanelHTML}
          </div>`);
      } else {
        memberCards.push(`
          <div class="unit-card empty member-empty">
            <span class="unit-badge">👤隊員</span>
            <span class="unit-empty">空缺 ${i + 1}</span>
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

    // Toggle active status
    detail.querySelectorAll('.btn-toggle-active').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid  = Number(btn.dataset.id);
        const unit = squad.members.find(m => m.id === uid);
        if (unit) {
          this.army.setUnitActive(squad.id, uid, !unit.active);
          this._renderSquadDetail(squad);
        }
      });
    });

    // Set captain
    detail.querySelectorAll('.btn-set-captain').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = Number(btn.dataset.id);
        if (this.army.setSquadCaptain(squad.id, uid)) {
          const unit = squad.members.find(m => m.id === uid);
          this._toast(`${unit?.name ?? '單位'} 已設為隊長`);
          this._renderSquadDetail(squad);
        }
      });
    });

    // Toggle move-target panel
    detail.querySelectorAll('.btn-move').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = Number(btn.dataset.id);
        this._movingUnitId = this._movingUnitId === uid ? null : uid;
        this._renderSquadDetail(squad);
      });
    });

    // Execute move
    detail.querySelectorAll('.btn-move-to').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid      = Number(btn.dataset.id);
        const targetId = Number(btn.dataset.target);
        const unit     = squad.members.find(m => m.id === uid);
        if (this.army.moveUnit(uid, squad.id, targetId)) {
          this._movingUnitId = null;
          this._toast(`${unit?.name ?? '單位'} 已移至小隊 ${targetId + 1}`);
          this._renderTeam();
        } else {
          this._toast('移動失敗（目標小隊已滿）');
        }
      });
    });

    // Remove member
    detail.querySelectorAll('.btn-remove-member').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid  = Number(btn.dataset.id);
        const unit = squad.members.find(m => m.id === uid);
        squad.removeMember(uid);
        this._toast(`${unit?.name ?? '單位'} 已從小隊移除`);
        this._renderTeam();
      });
    });
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
