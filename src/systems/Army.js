/**
 * Army system – manages up to 3 squads.
 * Each squad has 1 general slot and up to MAX_SOLDIERS soldier slots.
 */

export const MAX_SOLDIERS = 10;
export const MAX_SQUADS   = 3;

// ---------------------------------------------------------------------------
// Unit
// ---------------------------------------------------------------------------

export class Unit {
  /**
   * @param {{id:number, name:string, type:'general'|'soldier', role:string, stats?:Object}} opts
   */
  constructor({ id, name, type, role, stats = {} }) {
    this.id    = id;
    this.name  = name;
    this.type  = type;  // 'general' | 'soldier'
    this.role  = role;  // e.g. 'hero', 'swordsman', 'archer'
    this.stats = { attack: 5, defense: 5, morale: 50, ...stats };
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

    /** @type {Unit|null} */
    this.general  = null;

    /** @type {Unit[]} */
    this.soldiers = [];
  }

  /** @param {Unit|null} unit */
  setGeneral(unit) {
    this.general = unit;
  }

  /**
   * @param {Unit} unit
   * @returns {boolean} true if added successfully
   */
  addSoldier(unit) {
    if (this.soldiers.length >= MAX_SOLDIERS) return false;
    this.soldiers.push(unit);
    return true;
  }

  /**
   * @param {number} unitId
   * @returns {boolean}
   */
  removeSoldier(unitId) {
    const idx = this.soldiers.findIndex(s => s.id === unitId);
    if (idx === -1) return false;
    this.soldiers.splice(idx, 1);
    return true;
  }

  /** @returns {boolean} */
  hasSoldierCapacity() {
    return this.soldiers.length < MAX_SOLDIERS;
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

    // The player character is always the general of Squad 0.
    const hero = new Unit({
      id:    this._nextUnitId++,
      name:  playerName,
      type:  'general',
      role:  'hero',
      stats: { attack: 10, defense: 10, morale: 100 },
    });
    this.squads[0].setGeneral(hero);
  }

  // -------------------------------------------------------------------------

  /**
   * Try to place a newly acquired unit into the first available slot.
   *
   * - Generals go to the first squad that has no general (skipping the player
   *   squad whose general is always the hero).
   * - Soldiers go to the first squad that has a general AND free soldier slots.
   *
   * @param {{name:string, type:'general'|'soldier', role:string, stats?:Object}} unitData
   * @returns {{ placed: boolean, unit: Unit, squad?: Squad }}
   */
  acquireUnit(unitData) {
    const unit = new Unit({ ...unitData, id: this._nextUnitId++ });

    if (unit.type === 'general') {
      const squad = this.squads.find(s => !s.isPlayerSquad && s.general === null);
      if (squad) {
        squad.setGeneral(unit);
        return { placed: true, unit, squad };
      }
    } else {
      const squad = this.squads.find(s => s.general !== null && s.hasSoldierCapacity());
      if (squad) {
        squad.addSoldier(unit);
        return { placed: true, unit, squad };
      }
    }

    return { placed: false, unit };
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
        general:       sq.general  ? { ...sq.general,  stats: { ...sq.general.stats  } } : null,
        soldiers:      sq.soldiers.map(s => ({ ...s, stats: { ...s.stats } })),
      })),
    };
  }

  /**
   * Restore army from a saved snapshot.
   * The game always uses exactly MAX_SQUADS squads, so saved data beyond that
   * index is intentionally ignored (no data loss – saves are written with the
   * same fixed squad count).
   * @param {{ nextUnitId: number, squads: Array }} state
   */
  loadState(state) {
    if (!state) return;
    this._nextUnitId = state.nextUnitId ?? this._nextUnitId;

    (state.squads ?? []).forEach((sqData, idx) => {
      const squad = this.squads[idx];
      if (!squad) return; // saved with more squads than current MAX_SQUADS – skip excess

      squad.general  = sqData.general
        ? new Unit(sqData.general)
        : null;
      squad.soldiers = (sqData.soldiers ?? []).map(u => new Unit(u));
    });
  }
}
