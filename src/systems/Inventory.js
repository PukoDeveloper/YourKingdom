/**
 * Inventory – stores loot and consumable items the player carries.
 */
export class Inventory {
  constructor() {
    /** @type {Array<{id:number, name:string, type:string, icon:string, quantity:number, description:string}>} */
    this._items  = [];
    this._nextId = 1;
  }

  /**
   * Add an item to the backpack.
   * Stackable items (same name + same type) are merged.
   *
   * @param {{name:string, type:'loot'|'consumable', icon?:string, quantity?:number, description?:string, stackable?:boolean}} item
   */
  addItem(item) {
    const qty = item.quantity ?? 1;

    if (item.stackable !== false) {
      const existing = this._items.find(
        i => i.name === item.name && i.type === item.type,
      );
      if (existing) {
        existing.quantity += qty;
        return;
      }
    }

    this._items.push({
      id:          this._nextId++,
      name:        item.name,
      type:        item.type,
      icon:        item.icon        ?? '📦',
      quantity:    qty,
      description: item.description ?? '',
    });
  }

  /**
   * Remove `quantity` units of the item with the given id.
   * Automatically deletes the entry when quantity reaches 0.
   *
   * @param {number} id
   * @param {number} [quantity=1]
   * @returns {boolean}
   */
  removeItem(id, quantity = 1) {
    const idx = this._items.findIndex(i => i.id === id);
    if (idx === -1) return false;

    this._items[idx].quantity -= quantity;
    if (this._items[idx].quantity <= 0) this._items.splice(idx, 1);
    return true;
  }

  /**
   * Use one consumable item (removes 1 from stack).
   * Returns the item's description so the caller can apply an effect.
   *
   * @param {number} id
   * @returns {string|null} description string, or null on failure
   */
  useItem(id) {
    const item = this._items.find(i => i.id === id);
    const usable = ['consumable', 'potion', 'utility'];
    if (!item || !usable.includes(item.type)) return null;
    const desc = item.description;
    this.removeItem(id, 1);
    return desc;
  }

  /** @returns {Array} shallow copy of the item list */
  getItems() {
    return [...this._items];
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /** @returns {{ nextId: number, items: Array }} serialisable snapshot */
  getState() {
    return {
      nextId: this._nextId,
      items:  this._items.map(i => ({ ...i })),
    };
  }

  /**
   * Restore inventory from a saved snapshot.
   * @param {{ nextId: number, items: Array }} state
   */
  loadState(state) {
    if (!state) return;
    this._items  = (state.items ?? []).map(i => ({ ...i }));
    this._nextId = state.nextId ?? (this._items.length + 1);
  }
}
