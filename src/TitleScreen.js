/**
 * TitleScreen – displays the title overlay with Single Player and Multiplayer
 * mode selection.  Returns a Promise that resolves once the player has chosen
 * a mode, passing back a descriptor object that main.js uses to start the game.
 * The function can be called multiple times; each call registers fresh one-shot
 * listeners so there is no risk of duplicate-click handlers.
 *
 * @param {string} [prefillError]  Optional error message to show immediately
 *   (e.g. "name taken" message from a previous connection attempt).
 * @returns {Promise<{ mode: 'single' } | { mode: 'multi', ip: string, name: string }>}
 */

/** localStorage key used to remember the last-used player name. */
const NAME_STORAGE_KEY = 'yk_mp_name';

export function showTitleScreen(prefillError = '') {
  return new Promise((resolve) => {
    const overlay    = document.getElementById('title-screen');
    const btnSingle  = document.getElementById('title-btn-single');
    const btnMulti   = document.getElementById('title-btn-multi');
    const ipWrap     = document.getElementById('title-ip-wrap');
    const nameInput  = document.getElementById('title-name-input');
    const ipInput    = document.getElementById('title-ip-input');
    const btnConnect = document.getElementById('title-btn-connect');
    const ipError    = document.getElementById('title-ip-error');

    // Pre-fill the name from the previous session.
    try {
      const savedName = localStorage.getItem(NAME_STORAGE_KEY);
      if (savedName && !nameInput.value) nameInput.value = savedName;
    } catch { /* localStorage unavailable */ }

    // Show any error from a previous attempt (e.g. name taken).
    if (prefillError) {
      ipError.textContent = prefillError;
      // Ensure the multi panel is open so the player can see & correct the error.
      ipWrap.style.display = 'flex';
      btnMulti.textContent = '▲ 取消多人連線';
    }

    let multiExpanded = ipWrap.style.display === 'flex';
    let resolved = false;

    function done(value) {
      if (resolved) return;
      resolved = true;
      resolve(value);
    }

    function hide() {
      overlay.classList.add('hidden');
      setTimeout(() => { overlay.style.display = 'none'; }, 500);
    }

    btnSingle.addEventListener('click', () => {
      hide();
      done({ mode: 'single' });
    }, { once: true });

    btnMulti.addEventListener('click', () => {
      multiExpanded = !multiExpanded;
      ipWrap.style.display = multiExpanded ? 'flex' : 'none';
      btnMulti.textContent  = multiExpanded ? '▲ 取消多人連線' : '🌐 多人模式';
    });

    function tryConnect() {
      const rawIp   = ipInput.value.trim();
      const rawName = nameInput.value.trim();
      if (!rawName) {
        ipError.textContent = '請輸入玩家名稱';
        nameInput.focus();
        return;
      }
      if (!rawIp) {
        ipError.textContent = '請輸入伺服器位址';
        ipInput.focus();
        return;
      }
      ipError.textContent = '';
      // Persist the name so it auto-fills next time.
      try { localStorage.setItem(NAME_STORAGE_KEY, rawName); } catch { /* ignore */ }
      hide();
      done({ mode: 'multi', ip: rawIp, name: rawName });
    }

    btnConnect.addEventListener('click', tryConnect, { once: true });
    ipInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryConnect();
    }, { once: true });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ipInput.focus();
    });

    // Reveal the title screen (it starts hidden so the DOM is ready first).
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.remove('hidden'));
  });
}
