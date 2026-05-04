/**
 * Region – a concrete place in the world (castle or village settlement).
 *
 * Drop-in replacement for the original `Settlement` class, extended with
 * governance data that tracks each inhabited location independently of any
 * king's personal army:
 *
 *   satisfaction      – resident happiness (–100 to 100). Positive = content;
 *                       negative = unrest. Affects tax yield and revolt risk.
 *   rulerId           – id of the Character who governs this region.
 *                       The ruler is an *independent* person: they are never
 *                       counted in any king's or player's squad slots.
 *   assignedCharacters – ids of Characters currently stationed here
 *                       (workers, garrison officers, etc.). These characters
 *                       are also absent from squad rosters while assigned.
 *
 * Backward compatibility: Region has all Settlement properties (type, name,
 * nationId, controllingNationId, population, economyLevel, resources, ruler,
 * buildings, playerOwned) so all existing code continues to work unchanged.
 *
 * This class is intentionally standalone (no import from NationSystem) to
 * avoid a circular-dependency cycle.
 */

export class Region {
  /**
   * @param {{
   *   type:               'castle'|'village',
   *   name:               string,
   *   nationId:           number,
   *   population:         number,
   *   economyLevel:       number,
   *   resources:          string[],
   *   ruler:              import('../systems/Army.js').Unit,
   *   buildings?:         import('../systems/BuildingSystem.js').Building[],
   *   satisfaction?:      number,
   *   assignedCharacters?: (number|string)[],
   * }} opts
   */
  constructor({ type, name, nationId, population, economyLevel, resources, ruler, buildings = [], satisfaction = 0, assignedCharacters = [] }) {
    /** @type {'castle'|'village'} */
    this.type = type;
    this.name = name;
    /** Index into NationSystem.nations (≥ 0) – the founding/original nation. */
    this.nationId = nationId;
    /**
     * The nation that currently controls this region.
     * Initially equals `nationId`; changes to PLAYER_NATION_ID (-1) when
     * captured by the player, or another nation's id on NPC conquest.
     */
    this.controllingNationId = nationId;
    this.population   = population;
    /** 1 – 5 stars. */
    this.economyLevel = economyLevel;
    /** Array of resource names (usually 1–2). */
    this.resources    = resources;

    /**
     * The ruling Unit/Character – same class as army members but independent.
     * Use the `ruler` setter (below) to keep `rulerId` in sync.
     * @type {import('../systems/Army.js').Unit|null}
     */
    this._ruler = ruler ?? null;

    /**
     * @type {import('../systems/BuildingSystem.js').Building[]}
     */
    this.buildings = buildings;

    /**
     * True when the player has captured this region.
     * Derived from `controllingNationId === PLAYER_NATION_ID`; kept in sync
     * by GameUI.
     */
    this.playerOwned = false;

    /**
     * Kingdom info of the player who controls this settlement, set by the
     * multiplayer world-state sync (Game._applyWorldState / _applyWorldDelta).
     * null when unset (NPC, neutral) or when controlled by the local player
     * (StructureRenderer uses the local player's kingdom in that case).
     * Not persisted – reconstructed from server broadcasts at runtime.
     * @type {{ color: string, flagApp: object|null }|null}
     */
    this.ownerKingdom = null;

    // -----------------------------------------------------------------------
    // Region-specific fields
    // -----------------------------------------------------------------------

    /**
     * Resident satisfaction level in the range [–100, 100].
     * 0  = neutral; positive = content; negative = unrest.
     * Starts at 0 for seed-generated regions; captured regions start at –50.
     * @type {number}
     */
    this.satisfaction = satisfaction;

    /**
     * The id of the Character who governs this region.
     * Always kept in sync with `this._ruler.id` via the `ruler` setter.
     * Ruler is an independent person: not counted in any squad slot.
     * @type {number|null}
     */
    this.rulerId = ruler?.id ?? null;

    /**
     * Ids of Characters currently assigned to work in this region
     * (construction workers, stationed specialists, etc.).
     * These characters are absent from squad rosters while assigned here.
     * @type {(number|string)[]}
     */
    this.assignedCharacters = [...assignedCharacters];
  }

  // ---------------------------------------------------------------------------
  // ruler accessor – keep rulerId in sync with the stored Unit/Character object
  // ---------------------------------------------------------------------------

  /**
   * Replace the settlement ruler. Automatically keeps `rulerId` in sync.
   * @param {import('../systems/Army.js').Unit|null} value
   */
  set ruler(value) {
    this._ruler  = value ?? null;
    this.rulerId = value?.id ?? null;
  }

  /** @returns {import('../systems/Army.js').Unit|null} */
  get ruler() {
    return this._ruler;
  }
}
