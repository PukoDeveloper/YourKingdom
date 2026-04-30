/**
 * PathfinderWorker – main-thread wrapper around pathfinder.worker.js.
 *
 * Usage:
 *   const pfw = new PathfinderWorker();
 *   pfw.init(mapData.tiles);   // send terrain once after map generation
 *   pfw.requestPath(fromPx, toPx, (path) => { ... });  // async A*
 *   pfw.dispose();             // on game teardown
 *
 * Falls back gracefully when Web Workers are not supported: `requestPath`
 * immediately invokes the callback with `null`, leaving the caller to use
 * its own straight-line fallback.
 */
export class PathfinderWorker {
  constructor() {
    /** @type {Worker|null} */
    this._worker = null;

    /**
     * Pending result callbacks keyed by request id.
     * @type {Map<number, function({x:number,y:number}[]|null): void>}
     */
    this._pending = new Map();

    /** Monotonically-increasing request id. */
    this._nextId = 0;

    /** True once init() has been called and tiles sent to the worker. */
    this._ready = false;

    if (typeof Worker === 'undefined') return;

    try {
      this._worker = new Worker(
        new URL('./pathfinder.worker.js', import.meta.url),
        { type: 'classic' },
      );

      this._worker.onmessage = (e) => {
        const { id, path } = e.data ?? {};
        const cb = this._pending.get(id);
        if (cb) {
          this._pending.delete(id);
          cb(path ?? null);
        }
      };

      this._worker.onerror = (err) => {
        console.warn('[PathfinderWorker] Worker error:', err.message);
      };
    } catch {
      this._worker = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** True when the worker is running and has received terrain data. */
  get available() {
    return this._worker !== null && this._ready;
  }

  /**
   * Send the terrain tile buffer to the worker.  Call once after map generation.
   * The buffer is copied so the caller retains ownership of `mapData.tiles`.
   *
   * @param {Uint8Array} tiles  `mapData.tiles` flat terrain array.
   */
  init(tiles) {
    if (!this._worker) return;
    // Copy so the main thread keeps its buffer intact.
    this._worker.postMessage({ type: 'init', tiles: new Uint8Array(tiles) });
    this._ready = true;
  }

  /**
   * Request an A* path between two world-pixel positions.
   * The callback is invoked asynchronously with the resulting waypoint array,
   * or null if no path could be found.
   *
   * @param {{ x: number, y: number }} fromPx  Start world-pixel position.
   * @param {{ x: number, y: number }} toPx    Target world-pixel position.
   * @param {function({x:number,y:number}[]|null): void} callback
   */
  requestPath(fromPx, toPx, callback) {
    if (!this._worker || !this._ready) {
      // Worker unavailable – caller should use its synchronous fallback.
      callback(null);
      return;
    }
    const id = this._nextId++;
    this._pending.set(id, callback);
    this._worker.postMessage({ type: 'path', id, fromPx, toPx });
  }

  /**
   * Terminate the worker and flush all pending callbacks with null.
   * Call on game teardown / reset.
   */
  dispose() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
    for (const cb of this._pending.values()) {
      cb(null);
    }
    this._pending.clear();
    this._ready = false;
  }
}
