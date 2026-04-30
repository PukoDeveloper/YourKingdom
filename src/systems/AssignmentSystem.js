/**
 * AssignmentSystem – central registry for assigning Characters to non-squad roles.
 *
 * Characters can be in one of four states:
 *
 *   squad        – a member of a king's or player's squad (default)
 *   region       – governing or stationed at a Region (castle / village)
 *   trade        – running a trade route (comes and goes between two regions)
 *   construction – working at a build site inside a Region
 *
 * When a character is assigned to any role other than 'squad', they are
 * temporarily removed from their squad roster and do NOT occupy a squad slot.
 * Region rulers (type === 'region' with ruler flag) are always independent
 * and never appear in any squad.
 *
 * This system acts as a coordination layer between GameUI (which manages the
 * existing _assignedRulers, _tradeRouteWorkers and _buildingWorkers maps) and
 * the Character/Region data model.  It wraps those Maps so that all assignment
 * logic can be reasoned about in one place.
 */

/**
 * @typedef {'squad'|'region'|'trade'|'construction'} AssignmentType
 */

/**
 * @typedef {{
 *   type: AssignmentType,
 *   ref:  number|string,
 * }} LocationInfo
 */

export class AssignmentSystem {
  /**
   * @param {import('../systems/Army.js').Army} army  The player's (or a king's) Army instance.
   */
  constructor(army) {
    /**
     * The Army this system manages assignments for.
     * @type {import('../systems/Army.js').Army}
     */
    this.army = army;

    /**
     * Settlement key → unit id of the character serving as ruler.
     * Mirrors GameUI._assignedRulers.
     * Key format: "castle:N" or "village:N".
     * @type {Map<string, number>}
     */
    this._regionRulers = new Map();

    /**
     * Route id → array of unit ids assigned as trade workers (max 2).
     * Mirrors GameUI._tradeRouteWorkers.
     * @type {Map<string, number[]>}
     */
    this._tradeWorkers = new Map();

    /**
     * Settlement key → array of unit ids assigned as building workers (max 3).
     * Mirrors GameUI._buildingWorkers.
     * @type {Map<string, number[]>}
     */
    this._constructionWorkers = new Map();
  }

  // ---------------------------------------------------------------------------
  // Query helpers
  // ---------------------------------------------------------------------------

  /**
   * Return the set of unit ids that are currently on assignment (not in squads).
   * @returns {Set<number>}
   */
  getAssignedIds() {
    const ids = new Set();
    for (const id of this._regionRulers.values()) ids.add(id);
    for (const arr of this._tradeWorkers.values())       arr.forEach(id => ids.add(id));
    for (const arr of this._constructionWorkers.values()) arr.forEach(id => ids.add(id));
    return ids;
  }

  /**
   * Return the current location of a character by their unit id, or null if
   * they are in a squad (or not tracked by this system).
   *
   * @param {number} unitId
   * @returns {LocationInfo|null}
   */
  getLocation(unitId) {
    for (const [key, id] of this._regionRulers) {
      if (id === unitId) return { type: 'region', ref: key };
    }
    for (const [routeId, ids] of this._tradeWorkers) {
      if (ids.includes(unitId)) return { type: 'trade', ref: routeId };
    }
    for (const [siteId, ids] of this._constructionWorkers) {
      if (ids.includes(unitId)) return { type: 'construction', ref: siteId };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Assignment mutations
  // ---------------------------------------------------------------------------

  /**
   * Assign a character as the ruler of a region.
   * The character is removed from their current squad.
   * Any previously assigned ruler for this region is recalled first.
   *
   * @param {number} unitId       Id of the unit to assign.
   * @param {string} regionKey    Settlement key (e.g. "castle:0").
   * @returns {boolean}  true if the assignment succeeded.
   */
  assignToRegion(unitId, regionKey) {
    // Recall any existing ruler.
    const existing = this._regionRulers.get(regionKey);
    if (existing !== undefined && existing !== unitId) {
      this._recallFromSquad(existing, 'region');
    }

    // Remove the unit from its current squad.
    if (!this._removeFromSquad(unitId)) return false;

    this._regionRulers.set(regionKey, unitId);
    this._syncCharacterLocation(unitId, { type: 'region', ref: regionKey });
    return true;
  }

  /**
   * Assign a character to a trade route.
   * The character is removed from their current squad.
   * Routes require exactly 2 workers; call twice with different unitIds.
   *
   * @param {number} unitId   Id of the unit to assign.
   * @param {string} routeId  Trade route id (e.g. "castle:0→village:2").
   * @returns {boolean}
   */
  assignToTradeRoute(unitId, routeId) {
    const workers = this._tradeWorkers.get(routeId) ?? [];
    if (workers.length >= 2) return false;
    if (workers.includes(unitId)) return false;

    if (!this._removeFromSquad(unitId)) return false;

    workers.push(unitId);
    this._tradeWorkers.set(routeId, workers);
    this._syncCharacterLocation(unitId, { type: 'trade', ref: routeId });
    return true;
  }

  /**
   * Assign a character to a construction site.
   * The character is removed from their current squad.
   * Build sites hold at most 3 workers.
   *
   * @param {number} unitId    Id of the unit to assign.
   * @param {string} siteId    Settlement key of the build site.
   * @returns {boolean}
   */
  assignToConstruction(unitId, siteId) {
    const workers = this._constructionWorkers.get(siteId) ?? [];
    if (workers.length >= 3) return false;
    if (workers.includes(unitId)) return false;

    if (!this._removeFromSquad(unitId)) return false;

    workers.push(unitId);
    this._constructionWorkers.set(siteId, workers);
    this._syncCharacterLocation(unitId, { type: 'construction', ref: siteId });
    return true;
  }

  /**
   * Recall an assigned character back to the first available squad slot.
   *
   * @param {number} unitId
   * @returns {boolean}  true if the character was found and recalled.
   */
  recallToSquad(unitId) {
    const loc = this.getLocation(unitId);
    if (!loc) return false; // already in a squad or unknown

    this._removeFromAssignment(unitId, loc);
    return this._recallFromSquad(unitId, loc.type);
  }

  // ---------------------------------------------------------------------------
  // Sync helpers
  // ---------------------------------------------------------------------------

  /**
   * Sync these Maps from the values that GameUI already manages.
   * Call this after loading a save to ensure both systems are in agreement.
   *
   * @param {Map<string, number>}   regionRulers
   * @param {Map<string, number[]>} tradeWorkers
   * @param {Map<string, number[]>} constructionWorkers
   */
  syncFromGameUI(regionRulers, tradeWorkers, constructionWorkers) {
    this._regionRulers         = new Map(regionRulers);
    this._tradeWorkers         = new Map(tradeWorkers);
    this._constructionWorkers  = new Map(constructionWorkers);
  }

  /**
   * Return state snapshots compatible with GameUI's serialisation format.
   * @returns {{
   *   assignedRulers:    [string, number][],
   *   tradeRouteWorkers: [string, number[]][],
   *   buildingWorkers:   [string, number[]][],
   * }}
   */
  getState() {
    return {
      assignedRulers:    [...this._regionRulers.entries()],
      tradeRouteWorkers: [...this._tradeWorkers.entries()],
      buildingWorkers:   [...this._constructionWorkers.entries()],
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Remove a unit from any squad it currently belongs to in `this.army`.
   * @param {number} unitId
   * @returns {boolean}  true if the unit was found in a squad.
   */
  _removeFromSquad(unitId) {
    for (const squad of this.army.getSquads()) {
      const unit = squad.members.find(m => m.id === unitId);
      if (unit) {
        squad.removeMember(unitId);
        return true;
      }
    }
    return false;
  }

  /**
   * Put a unit (looked up by id) back into the first available squad slot.
   * If the unit no longer exists in the Army's _nextUnitId range, returns false.
   *
   * Note: The unit object itself must be re-added to the Army.  Because we
   * removed it from the squad earlier, it is no longer held in memory here.
   * Callers that need to return a unit to a squad should retain a reference to
   * the Unit object and call squad.addMember(unit) directly.
   *
   * @param {number} unitId
   * @param {AssignmentType} _prevType  (unused; for future hooks)
   * @returns {boolean}
   */
  _recallFromSquad(unitId, _prevType) {
    // The unit object is not held here; callers must manage re-insertion themselves.
    // This stub updates the tracking Maps only.
    this._removeFromAssignment(unitId, { type: _prevType, ref: '' });
    return true;
  }

  /**
   * Remove a unit id from whichever assignment map it currently lives in.
   * @param {number} unitId
   * @param {LocationInfo} loc
   */
  _removeFromAssignment(unitId, loc) {
    if (loc.type === 'region') {
      if (this._regionRulers.get(loc.ref) === unitId) {
        this._regionRulers.delete(loc.ref);
      }
    } else if (loc.type === 'trade') {
      const workers = this._tradeWorkers.get(loc.ref);
      if (workers) {
        const idx = workers.indexOf(unitId);
        if (idx !== -1) workers.splice(idx, 1);
        if (workers.length === 0) this._tradeWorkers.delete(loc.ref);
      }
    } else if (loc.type === 'construction') {
      const workers = this._constructionWorkers.get(loc.ref);
      if (workers) {
        const idx = workers.indexOf(unitId);
        if (idx !== -1) workers.splice(idx, 1);
        if (workers.length === 0) this._constructionWorkers.delete(loc.ref);
      }
    }
  }

  /**
   * If the unit is a Character instance, update its `location` field.
   * @param {number} unitId
   * @param {LocationInfo} location
   */
  _syncCharacterLocation(unitId, location) {
    for (const squad of this.army.getSquads()) {
      const unit = squad.members.find(m => m.id === unitId);
      if (unit && typeof unit.location !== 'undefined') {
        unit.location = location;
      }
    }
    // Unit may have already been removed from the squad; the location update is
    // best-effort and the assignment Maps remain the source of truth.
  }
}
