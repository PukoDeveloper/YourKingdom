import { Game }             from './Game.js';
import { showTitleScreen }  from './TitleScreen.js';
import { MultiplayerClient } from './systems/MultiplayerClient.js';

(async () => {
  const choice = await showTitleScreen();

  let multiplayerClient = null;

  if (choice.mode === 'multi') {
    multiplayerClient = new MultiplayerClient(choice.ip);
    try {
      await multiplayerClient.connect();
    } catch (err) {
      // Show error feedback on the title screen and abort.
      const errEl = document.getElementById('title-ip-error');
      if (errEl) errEl.textContent = `連線失敗：${err.message}`;
      // Re-show the title overlay for another attempt.
      const overlay = document.getElementById('title-screen');
      if (overlay) {
        overlay.style.display = 'flex';
        overlay.classList.remove('hidden');
        const ipWrap = document.getElementById('title-ip-wrap');
        if (ipWrap) ipWrap.style.display = 'flex';
      }
      return;
    }
  }

  const game = new Game(multiplayerClient);
  game.init().catch((err) => {
    console.error('Failed to initialise game:', err);
  });
})();
