import { defineConfig } from 'vite';

export default defineConfig({
  // Must match the GitHub repository name so asset paths resolve correctly
  // when served from https://pukodeveloper.github.io/YourKingdom/
  base: '/YourKingdom/',
});
