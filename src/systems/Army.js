/**
 * Army system – manages up to 3 squads.
 * Each squad holds up to MAX_MEMBERS members (no separate general slot).
 * Any member that has the TRAIT_CAPTAIN trait can be set as the squad captain.
 */

import { generateCharAppearance, charAppearanceFromIndices } from './AppearanceSystem.js';

export const MAX_MEMBERS   = 10;
export const MAX_SQUADS    = 3;
export const TRAIT_CAPTAIN = '隊長';

// ---------------------------------------------------------------------------
// Unit
// ---------------------------------------------------------------------------

export class Unit {
  /**
   * @param {{
   *   id:          number,
   *   name:        string,
   *   role:        string,
   *   traits?:     string[],
   *   stats?:      Object,
   *   active?:     boolean,
   *   appearance?: Object
   * }} opts
   */
  constructor({ id, name, role, traits = [], stats = {}, active = true, appearance = null }) {
    this.id     = id;
    this.name   = name;
    this.role   = role;
    this.traits = [...traits];
    this.stats = { attack: 5, defense: 5, morale: 50, ...stats };
    // HP derived from defense if not explicitly saved.
    if (this.stats.maxHp === undefined) {
      this.stats.maxHp = 50 + this.stats.defense * 5;
    }
    if (this.stats.hp === undefined) {
      this.stats.hp = this.stats.maxHp;
    }
    /** Whether this unit participates in battle. */
    this.active = active !== false;

    /**
     * Modular appearance parts.  Auto-generated from the unit id if not
     * explicitly supplied (so every soldier gets a deterministic random look).
     * @type {{ bodyColorIdx: number, headgearIdx: number, armorColorIdx: number, markColorIdx: number,
     *          bodyColor: number, bodyColorCSS: string, headgear: string,
     *          armorColor: number, armorColorCSS: string, markColor: number, markColorCSS: string }}
     */
    if (appearance && appearance.bodyColorIdx !== undefined) {
      this.appearance = charAppearanceFromIndices(appearance);
    } else {
      this.appearance = generateCharAppearance(id * 17, id * 31 + 7);
    }
  }

  /** @returns {boolean} true when the unit carries the captain trait */
  canLead() {
    return this.traits.includes(TRAIT_CAPTAIN);
  }
}

// ---------------------------------------------------------------------------
// Squad
// ---------------------------------------------------------------------------

export class Squad {
  /**
   * @param {number}  id
   * @param {boolean} isPlayerSquad
   */
  constructor(id, isPlayerSquad = false) {
    this.id            = id;
    this.isPlayerSquad = isPlayerSquad;

    /** @type {Unit[]} */
    this.members = [];

    /** @type {number|null} id of the unit currently serving as captain */
    this.captainId = null;
  }

  /** @returns {Unit|null} */
  get captain() {
    return this.members.find(m => m.id === this.captainId) ?? null;
  }

  /**
   * @param {Unit} unit
   * @returns {boolean} true if added successfully
   */
  addMember(unit) {
    if (this.members.length >= MAX_MEMBERS) return false;
    this.members.push(unit);
    return true;
  }

  /**
   * Remove a member by id. Clears captainId if the removed unit was captain.
   * @param {number} unitId
   * @returns {Unit|null} the removed unit, or null if not found
   */
  removeMember(unitId) {
    const idx = this.members.findIndex(m => m.id === unitId);
    if (idx === -1) return null;
    if (this.captainId === unitId) this.captainId = null;
    return this.members.splice(idx, 1)[0];
  }

  /**
   * Assign a captain. Returns false if the unit is not in this squad or
   * does not have the TRAIT_CAPTAIN trait.
   * @param {number} unitId
   * @returns {boolean}
   */
  setCaptain(unitId) {
    const unit = this.members.find(m => m.id === unitId);
    if (!unit || !unit.canLead()) return false;
    this.captainId = unitId;
    return true;
  }

  /** @returns {boolean} */
  hasCapacity() {
    return this.members.length < MAX_MEMBERS;
  }
}

// ---------------------------------------------------------------------------
// Army
// ---------------------------------------------------------------------------

export class Army {
  /** @param {string} [playerName='主角'] */
  constructor(playerName = '主角') {
    this._nextUnitId = 1;

    this.squads = [
      new Squad(0, /* isPlayerSquad */ true),
      new Squad(1),
      new Squad(2),
    ];

    // The player hero is always the first member of Squad 0 and its captain.
    const hero = new Unit({
      id:     this._nextUnitId++,
      name:   playerName,
      role:   'hero',
      traits: [TRAIT_CAPTAIN],
      stats:  { attack: 10, defense: 10, morale: 100 },
    });
    this.squads[0].members.push(hero);
    this.squads[0].captainId = hero.id;
  }

  // -------------------------------------------------------------------------

  /**
   * Acquire a new unit and place it in the first squad that has capacity
   * (or a specific squad when squadId is supplied).
   *
   * If the target squad has no captain yet and the new unit can lead, it is
   * automatically promoted to captain.
   *
   * @param {{name:string, role:string, traits?:string[], stats?:Object}} unitData
   * @param {number|null} [squadId] optional target squad id
   * @returns {{ placed: boolean, unit: Unit, squad?: Squad }}
   */
  acquireUnit(unitData, squadId = null) {
    const unit = new Unit({ ...unitData, id: this._nextUnitId++, traits: unitData.traits ?? [] });

    const squad = squadId !== null
      ? this.squads.find(s => s.id === squadId && s.hasCapacity())
      : this.squads.find(s => s.hasCapacity());

    if (squad) {
      squad.addMember(unit);
      if (squad.captainId === null && unit.canLead()) {
        squad.captainId = unit.id;
      }
      return { placed: true, unit, squad };
    }

    return { placed: false, unit };
  }

  /**
   * Move a unit from one squad to another.
   * The player hero (role === 'hero') cannot be moved.
   *
   * @param {number} unitId
   * @param {number} fromSquadId
   * @param {number} toSquadId
   * @returns {boolean}
   */
  moveUnit(unitId, fromSquadId, toSquadId) {
    if (fromSquadId === toSquadId) return false;
    const fromSquad = this.squads.find(s => s.id === fromSquadId);
    const toSquad   = this.squads.find(s => s.id === toSquadId);
    if (!fromSquad || !toSquad || !toSquad.hasCapacity()) return false;

    const unit = fromSquad.members.find(m => m.id === unitId);
    if (!unit || unit.role === 'hero') return false;

    fromSquad.removeMember(unitId);
    toSquad.addMember(unit);
    if (toSquad.captainId === null && unit.canLead()) {
      toSquad.captainId = unit.id;
    }
    return true;
  }

  /**
   * Toggle whether a unit participates in battle.
   *
   * @param {number} squadId
   * @param {number} unitId
   * @param {boolean} active
   * @returns {boolean}
   */
  setUnitActive(squadId, unitId, active) {
    const squad = this.squads.find(s => s.id === squadId);
    if (!squad) return false;
    const unit = squad.members.find(m => m.id === unitId);
    if (!unit) return false;
    unit.active = active;
    return true;
  }

  /**
   * Set the captain of a squad.
   *
   * @param {number} squadId
   * @param {number} unitId
   * @returns {boolean}
   */
  setSquadCaptain(squadId, unitId) {
    const squad = this.squads.find(s => s.id === squadId);
    return squad ? squad.setCaptain(unitId) : false;
  }

  /** @returns {Squad[]} */
  getSquads() {
    return this.squads;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /** @returns {{ nextUnitId: number, squads: Array }} serialisable snapshot */
  getState() {
    return {
      nextUnitId: this._nextUnitId,
      squads: this.squads.map(sq => ({
        id:            sq.id,
        isPlayerSquad: sq.isPlayerSquad,
        captainId:     sq.captainId,
        members:       sq.members.map(m => ({
          ...m,
          stats:      { ...m.stats },
          traits:     [...m.traits],
          appearance: {
            bodyColorIdx:  m.appearance.bodyColorIdx,
            headgearIdx:   m.appearance.headgearIdx,
            armorColorIdx: m.appearance.armorColorIdx,
            markColorIdx:  m.appearance.markColorIdx,
          },
        })),
      })),
    };
  }

  /**
   * Restore army from a saved snapshot.
   * @param {{ nextUnitId: number, squads: Array }} state
   */
  loadState(state) {
    if (!state) return;
    this._nextUnitId = state.nextUnitId ?? this._nextUnitId;

    (state.squads ?? []).forEach((sqData, idx) => {
      const squad = this.squads[idx];
      if (!squad) return;

      squad.members   = (sqData.members ?? []).map(u => new Unit(u));
      squad.captainId = sqData.captainId ?? null;
    });
  }
}
