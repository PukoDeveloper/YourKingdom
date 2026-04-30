/**
 * NpcKingEntity – the visible, movable map-presence for an NPC nation's king.
 *
 * Each NPC nation king is represented by a Character (stored on their castle
 * Region as the ruler).  NpcKingEntity wraps that Character with a Pixi sprite
 * and the shared movement / terrain-collision logic from MovingEntity, so that
 * kings can eventually roam the world map or march with their armies.
 *
 * In the current implementation kings are positioned at the centre of their
 * home castle and do not move autonomously (that is delegated to
 * DiplomacySystem army marches).  The entity exists so that the architecture
 * is in place and Game.js can add king sprites to the scene if desired.
 */

import { MovingEntity } from './MovingEntity.js';
import { generateCharAppearance } from '../systems/AppearanceSystem.js';
import { TILE_SIZE } from '../world/constants.js';

export class NpcKingEntity extends MovingEntity {
  /**
   * @param {import('../characters/Character.js').Character} character
   *   The king's Character data object (usually the castle region's ruler).
   * @param {{ x: number, y: number }} castleTile
   *   Top-left tile of the king's home castle (4×4 tile footprint).
   */
  constructor(character, castleTile) {
    // Position the king at the visual centre of their castle (tile centre + 2 tile offset).
    const worldX = (castleTile.x + 2) * TILE_SIZE;
    const worldY = (castleTile.y + 2) * TILE_SIZE;

    // Use the character's existing appearance if available; otherwise generate
    // one deterministically from the character id.
    const appearance = character.appearance
      ?? generateCharAppearance(character.id * 17, character.id * 31 + 7);

    super(worldX, worldY, appearance);

    /**
     * The king's full Character data (name, traits, stats, nation loyalty…).
     * @type {import('../characters/Character.js').Character}
     */
    this.character = character;

    /**
     * Nation id this king leads.  Mirrors character.loyalNationId.
     * @type {number}
     */
    this.nationId = character.loyalNationId ?? -1;
  }

  // ---------------------------------------------------------------------------
  // Convenience accessors
  // ---------------------------------------------------------------------------

  /** @returns {string} */
  get name() { return this.character.name; }

  /** @returns {object} */
  get appearance() { return this._appearance; }
}
