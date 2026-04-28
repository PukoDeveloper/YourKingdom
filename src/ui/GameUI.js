import { Inventory }       from '../systems/Inventory.js';
import { Army, MAX_SOLDIERS } from '../systems/Army.js';

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
  constructor() {
    this.inventory = new Inventory();
    this.army      = new Army('主角');

    /** @type {'backpack'|'team'|null} */
    this._activePanel  = null;
    this._activeSquad  = 0;

    this._seedDemo();
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

    // Demo soldiers already in squad 0
    this.army.acquireUnit({ name: '趙一',   type: 'soldier', role: '劍士',  stats: { attack: 8,  defense: 6  } });
    this.army.acquireUnit({ name: '錢二',   type: 'soldier', role: '弓手',  stats: { attack: 10, defense: 3  } });
    this.army.acquireUnit({ name: '孫三',   type: 'soldier', role: '長槍兵', stats: { attack: 7,  defense: 8  } });
    // Demo general for squad 2
    this.army.acquireUnit({ name: '李四',   type: 'general', role: '武將',  stats: { attack: 12, defense: 9, morale: 80 } });
    this.army.acquireUnit({ name: '王五',   type: 'soldier', role: '劍士',  stats: { attack: 9,  defense: 7  } });
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
        this._activeSquad = Number(btn.dataset.squad);
        this._renderTeam();
      });
    });

    this._renderSquadDetail(squads[this._activeSquad]);
  }

  _renderSquadDetail(squad) {
    const detail = document.getElementById('squad-detail');

    // General slot
    const genHTML = squad.general
      ? `<div class="unit-card general">
           <div class="unit-badge">⭐ 將領</div>
           <div class="unit-name">${squad.general.name}</div>
           <div class="unit-role">${squad.general.role}</div>
           <div class="unit-stats">
             攻 ${squad.general.stats.attack}&nbsp;
             防 ${squad.general.stats.defense}&nbsp;
             士氣 ${squad.general.stats.morale}
           </div>
           ${(squad.isPlayerSquad && squad.general?.role === 'hero')
             ? ''
             : `<button class="btn-remove-gen">解除</button>`}
         </div>`
      : `<div class="unit-card empty">
           <div class="unit-badge">⭐ 將領</div>
           <div class="unit-empty">（空缺）</div>
         </div>`;

    // Soldier slots
    const soldierCards = [];
    for (let i = 0; i < MAX_SOLDIERS; i++) {
      const s = squad.soldiers[i];
      if (s) {
        soldierCards.push(`
          <div class="unit-card soldier">
            <div class="unit-badge">🗡 士兵</div>
            <div class="unit-name">${s.name}</div>
            <div class="unit-role">${s.role}</div>
            <div class="unit-stats">攻 ${s.stats.attack}&nbsp;防 ${s.stats.defense}</div>
            <button class="btn-remove-sol" data-id="${s.id}">移除</button>
          </div>`);
      } else {
        soldierCards.push(`
          <div class="unit-card empty soldier-empty">
            <div class="unit-badge">🗡 士兵</div>
            <div class="unit-empty">空缺 ${i + 1}</div>
          </div>`);
      }
    }

    detail.innerHTML = `
      <div class="squad-stat">
        士兵 ${squad.soldiers.length} / ${MAX_SOLDIERS}
        ${squad.general ? '' : '&nbsp;⚠ 無將領，無法部署'}
      </div>
      <div class="unit-section">
        <div class="section-label">將領</div>
        ${genHTML}
      </div>
      <div class="unit-section">
        <div class="section-label">士兵</div>
        <div class="soldier-grid">${soldierCards.join('')}</div>
      </div>
    `;

    // Remove general
    const removeGenBtn = detail.querySelector('.btn-remove-gen');
    if (removeGenBtn) {
      removeGenBtn.addEventListener('click', () => {
        const genName = squad.general?.name ?? '將領';
        squad.setGeneral(null);
        this._toast(`${genName} 已解除`);
        this._renderTeam();
      });
    }

    // Remove soldiers
    detail.querySelectorAll('.btn-remove-sol').forEach(btn => {
      btn.addEventListener('click', () => {
        squad.removeSoldier(Number(btn.dataset.id));
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
   * @param {{name:string, type:'general'|'soldier', role:string, stats?:Object}} unitData
   */
  tryAcquireUnit(unitData) {
    // Check availability before creating the real unit
    const squads   = this.army.getSquads();
    let canPlace   = false;

    if (unitData.type === 'general') {
      canPlace = squads.some(s => !s.isPlayerSquad && s.general === null);
    } else {
      canPlace = squads.some(s => s.general !== null && s.hasSoldierCapacity());
    }

    const typeName = unitData.type === 'general' ? '將領' : '士兵';
    const dlg      = document.getElementById('ui-acquire-overlay');
    const placeBtn = document.getElementById('btn-acq-place');

    document.getElementById('ui-acquire-title').textContent =
      `獲得了${typeName}：${unitData.name}`;
    document.getElementById('ui-acquire-desc').textContent =
      canPlace
        ? `角色：${unitData.role}　攻 ${unitData.stats?.attack ?? '?'}　防 ${unitData.stats?.defense ?? '?'}`
        : `目前沒有空位安置此${typeName}，請選擇處理方式：`;

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
