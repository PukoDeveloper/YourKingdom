import { Game }             from './Game.js';
import { showTitleScreen }  from './TitleScreen.js';
import { MultiplayerClient } from './systems/MultiplayerClient.js';

(async () => {
  // Keep showing the title screen until the player successfully connects or
  // chooses single-player mode.  On connection failure the title screen is
  // re-displayed with the error message so the player can correct their input.
  let pendingError = '';
  while (true) { // eslint-disable-line no-constant-condition
    const choice = await showTitleScreen(pendingError);
    pendingError = '';

    let multiplayerClient = null;

    if (choice.mode === 'multi') {
      multiplayerClient = new MultiplayerClient(choice.ip, choice.name);
      try {
        await multiplayerClient.connect();
      } catch (err) {
        // Pass the error to the next showTitleScreen call so it can display it.
        pendingError = err.message;
        continue;
      }
    }

    // Successfully chose a mode (single or connected multi) – start the game.
    const game = new Game(multiplayerClient);
    game.init().catch((err) => {
      console.error('Failed to initialise game:', err);
    });
    break;
  }
})();
