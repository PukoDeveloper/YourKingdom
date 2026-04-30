/**
 * SaveManager – thin wrapper around localStorage for persisting game state.
 *
 * Save format version 1:
 * {
 *   version  : 1,
 *   savedAt  : <ISO timestamp>,
 *   seed     : number,          // world seed
 *   player   : { x, y },
 *   dayTime  : number,          // DayNightCycle._time fraction [0,1)
 *   inventory: { nextId, items[] },
 *   army     : { nextUnitId, squads[] }
 * }
 *
 * Save format version 4 (current) adds:
 * {
 *   playerCharacter: object,   // Character.toJSON() snapshot for the player character
 *   regionState: [             // per-region satisfaction and assigned character ids
 *     { key: string, satisfaction: number, assignedCharacters: (number|string)[] }
 *   ]
 * }
 */

const SAVE_KEY     = 'yk_save';
const SAVE_VERSION = 4;

export class SaveManager {
  /** @returns {boolean} true when a compatible save exists in localStorage */
  static hasSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      return data?.version === SAVE_VERSION;
    } catch {
      return false;
    }
  }

  /**
   * Persist a game-state snapshot.
   * @param {object} state
   * @returns {boolean} true on success
   */
  static save(state) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        version: SAVE_VERSION,
        savedAt: new Date().toISOString(),
        ...state,
      }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retrieve the saved snapshot.
   * Returns null when absent or from an older (incompatible) version so the
   * game starts fresh.
   * @returns {object|null} parsed data or null if absent / incompatible
   */
  static load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data?.version === SAVE_VERSION ? data : null;
    } catch {
      return null;
    }
  }

  /** Remove the save slot. */
  static clear() {
    localStorage.removeItem(SAVE_KEY);
  }
}
