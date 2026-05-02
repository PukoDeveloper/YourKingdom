/**
 * TitleScreen – displays the title overlay with Single Player and Multiplayer
 * mode selection.  Returns a Promise that resolves once the player has chosen
 * a mode, passing back a descriptor object that main.js uses to start the game.
 *
 * @returns {Promise<{ mode: 'single' } | { mode: 'multi', ip: string }>}
 */
export function showTitleScreen() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('title-screen');
    const btnSingle = document.getElementById('title-btn-single');
    const btnMulti  = document.getElementById('title-btn-multi');
    const ipWrap    = document.getElementById('title-ip-wrap');
    const ipInput   = document.getElementById('title-ip-input');
    const btnConnect = document.getElementById('title-btn-connect');
    const ipError   = document.getElementById('title-ip-error');

    let multiExpanded = false;

    function hide() {
      overlay.classList.add('hidden');
      setTimeout(() => { overlay.style.display = 'none'; }, 500);
    }

    btnSingle.addEventListener('click', () => {
      hide();
      resolve({ mode: 'single' });
    });

    btnMulti.addEventListener('click', () => {
      multiExpanded = !multiExpanded;
      ipWrap.style.display = multiExpanded ? 'flex' : 'none';
      btnMulti.textContent  = multiExpanded ? '▲ 取消多人連線' : '🌐 多人模式';
    });

    function tryConnect() {
      const raw = ipInput.value.trim();
      if (!raw) {
        ipError.textContent = '請輸入伺服器位址';
        return;
      }
      ipError.textContent = '';
      hide();
      resolve({ mode: 'multi', ip: raw });
    }

    btnConnect.addEventListener('click', tryConnect);
    ipInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryConnect();
    });

    // Reveal the title screen (it starts hidden so the DOM is ready first).
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.remove('hidden'));
  });
}
