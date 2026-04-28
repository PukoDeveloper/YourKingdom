import { Game } from './Game.js';

const game = new Game();
game.init().catch((err) => {
  console.error('Failed to initialise game:', err);
});
