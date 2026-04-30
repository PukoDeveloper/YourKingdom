/**
 * PlayerEntity – the player's renderable, movable presence on the world map.
 *
 * Extends MovingEntity for all movement / terrain-collision logic and adds a
 * reference to a Character data object that is the authoritative source for
 * the player's name, appearance, traits and stats.
 *
 * The public interface is intentionally identical to the old Player class so
 * that all existing Game.js and GameUI.js call-sites continue to work without
 * modification.
 */

import { MovingEntity } from './MovingEntity.js';
import {
  generateCharAppearance,
  charAppearanceFromIndices,
} from '../systems/AppearanceSystem.js';
import { Character } from '../characters/Character.js';
import { PLAYER_NATION_ID } from '../systems/NationSystem.js';

/** Default player name used when no saved name is present. */
const DEFAULT_PLAYER_NAME = '主角';

export class PlayerEntity extends MovingEntity {
  /**
   * @param {number}      worldX             Starting world-pixel X.
   * @param {number}      worldY             Starting world-pixel Y.
   * @param {object|null} [appearanceIndices] Saved appearance index snapshot, or null.
   */
  constructor(worldX, worldY, appearanceIndices = null) {
    const resolvedAppearance = appearanceIndices
      ? charAppearanceFromIndices(appearanceIndices)
      : generateCharAppearance(0, 42);

    super(worldX, worldY, resolvedAppearance);

    /**
     * The player's Character data model.
     * All identity information (name, traits, stats) lives here.
     * @type {Character}
     */
    this.character = new Character({
      id:           0,   // player always has id 0
      name:         appearanceIndices?.playerName || DEFAULT_PLAYER_NAME,
      role:         'hero',
      traits:       [],
      stats:        { attack: 10, defense: 10, morale: 100 },
      appearance:   appearanceIndices ?? undefined,
      loyalNationId: PLAYER_NATION_ID,
      location:     { type: 'squad', ref: 0 },
      isKing:       true,
    });
  }

  // ---------------------------------------------------------------------------
  // Convenience accessors that delegate to the Character
  // ---------------------------------------------------------------------------

  /** @returns {string} */
  get name() { return this.character.name; }
  set name(v) { this.character.name = v; }

  /** @returns {object} Resolved appearance object. */
  get appearance() { return this._appearance; }

  // ---------------------------------------------------------------------------
  // Appearance management (mirrors the old Player API)
  // ---------------------------------------------------------------------------

  /**
   * Change the player's appearance and rebuild the sprite.
   * @param {{ bodyColorIdx: number, headgearIdx: number, armorColorIdx: number,
   *           markColorIdx: number, bodyShapeIdx?: number, faceAccIdx?: number,
   *           playerName?: string }} indices
   */
  setAppearance(indices) {
    if (indices.playerName !== undefined) {
      this.character.name = indices.playerName || DEFAULT_PLAYER_NAME;
    }
    const resolved = charAppearanceFromIndices(indices);
    this._rebuildGraphics(resolved);
  }

  /** Return a serialisable appearance index snapshot. */
  getAppearanceState() {
    const a = this._appearance;
    return {
      playerName:    this.character.name,
      bodyColorIdx:  a.bodyColorIdx,
      headgearIdx:   a.headgearIdx,
      armorColorIdx: a.armorColorIdx,
      markColorIdx:  a.markColorIdx,
      bodyShapeIdx:  a.bodyShapeIdx  ?? 0,
      faceAccIdx:    a.faceAccIdx    ?? 0,
    };
  }
}
