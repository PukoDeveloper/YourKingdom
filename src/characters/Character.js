/**
 * Character – full data model for every named person in the game.
 *
 * Extends the lightweight `Unit` class (used by Army squads) with additional
 * fields that are only meaningful for characters who can have an independent
 * life outside of a squad:
 *
 *   loyalNationId  – the nation the character currently serves.
 *                    Uses PLAYER_NATION_ID (-1) for the player's own characters.
 *   location       – where the character currently is:
 *                    { type: 'squad',        ref: squadId }
 *                    { type: 'region',       ref: regionId }
 *                    { type: 'trade',        ref: routeId }
 *                    { type: 'construction', ref: siteId }
 *   isKing         – true for the player and each NPC nation king.
 *                    Kings are the only ones who can command up to 3 squads.
 *
 * Backward compatibility: Character is a drop-in replacement for Unit.
 * All existing code that reads Unit properties will work unchanged.
 */

import { Unit } from '../systems/Army.js';

export class Character extends Unit {
  /**
   * @param {{
   *   id:             number,
   *   name:           string,
   *   role:           string,
   *   traits?:        string[],
   *   stats?:         Object,
   *   active?:        boolean,
   *   appearance?:    Object,
   *   loyalNationId?: number,
   *   location?:      { type: string, ref: number|string }|null,
   *   isKing?:        boolean,
   * }} opts
   */
  constructor(opts) {
    super(opts);

    /**
     * The nation this character is loyal to.
     * -1 = player's nation (PLAYER_NATION_ID), ≥0 = NPC nation index.
     * null = unaffiliated / independent (e.g. neutral settlement ruler).
     * @type {number|null}
     */
    this.loyalNationId = opts.loyalNationId ?? null;

    /**
     * Current assignment / whereabouts.
     * null  = not yet placed anywhere.
     * { type: 'squad',        ref: squadId }     – in a military squad
     * { type: 'region',       ref: regionId }    – governing / stationed at a region
     * { type: 'trade',        ref: routeId }     – on a trade route (comes and goes)
     * { type: 'construction', ref: siteId }      – working at a build site
     * @type {{ type: 'squad'|'region'|'trade'|'construction', ref: number|string }|null}
     */
    this.location = opts.location ?? null;

    /**
     * True for the player character and each NPC nation king.
     * Kings can command up to 3 squads via an Army instance.
     * @type {boolean}
     */
    this.isKing = opts.isKing ?? false;
  }

  // ---------------------------------------------------------------------------
  // Serialisation
  // ---------------------------------------------------------------------------

  /**
   * Return a plain-object snapshot suitable for JSON serialisation.
   * Includes all Unit fields plus the Character-specific ones.
   * @returns {object}
   */
  toJSON() {
    return {
      id:           this.id,
      name:         this.name,
      role:         this.role,
      traits:       [...this.traits],
      stats:        { ...this.stats },
      active:       this.active,
      appearance: {
        bodyColorIdx:  this.appearance.bodyColorIdx,
        headgearIdx:   this.appearance.headgearIdx,
        armorColorIdx: this.appearance.armorColorIdx,
        markColorIdx:  this.appearance.markColorIdx,
        bodyShapeIdx:  this.appearance.bodyShapeIdx  ?? 0,
        faceAccIdx:    this.appearance.faceAccIdx    ?? 0,
      },
      loyalNationId: this.loyalNationId,
      location:      this.location ? { ...this.location } : null,
      isKing:        this.isKing,
    };
  }

  /**
   * Create a Character from a plain-object snapshot (reverse of toJSON).
   * @param {object} data
   * @returns {Character}
   */
  static fromJSON(data) {
    return new Character(data);
  }
}
