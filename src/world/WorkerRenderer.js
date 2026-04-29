import { Container, Graphics } from 'pixi.js';

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/** Radius of the worker-token body in world pixels. */
const TOKEN_RADIUS = 7;

/**
 * Fill colours keyed by worker type.
 * 'building' = warm brown (builder)
 * 'road'     = sandy tan (road crew)
 * 'demolish' = slate gray (demolition crew)
 */
const TYPE_COLOR = {
  building: 0x8D6E63, // warm brown
  road:     0xBCAAA4, // sandy tan
  demolish: 0x90A4AE, // slate blue-gray
};

const DEFAULT_COLOR = 0xA0A0A0;

// ---------------------------------------------------------------------------
// WorkerRenderer
// ---------------------------------------------------------------------------

/**
 * Renders active construction worker units as small tokens on the world map.
 *
 * Worker positions are recalculated by `GameUI.getConstructionWorkers()` on
 * each phase change (road workers interpolate between endpoints; building
 * workers stay at the settlement centre).
 *
 * Usage:
 *   1. Add `workerRenderer.container` to the world scene graph.
 *   2. Call `sync(workers)` every game-loop frame, passing the array returned
 *      by `gameUI.getConstructionWorkers()`.
 */
export class WorkerRenderer {
  constructor() {
    /** Root container added to the world scene graph. */
    this.container = new Container();

    /**
     * Map from worker.id → Graphics token.
     * @type {Map<string, Graphics>}
     */
    this._tokens = new Map();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Synchronise visual tokens with the current worker list.
   * Tokens for workers that no longer exist are destroyed; new tokens are
   * created for new workers; all tokens are repositioned.
   *
   * @param {Array<{ id: string, type: string, worldX: number, worldY: number }>} workers
   */
  sync(workers) {
    // ── Remove stale tokens ──────────────────────────────────────────────────
    const activeIds = new Set(workers.map(w => w.id));
    for (const [id, token] of this._tokens) {
      if (!activeIds.has(id)) {
        this.container.removeChild(token);
        token.destroy();
        this._tokens.delete(id);
      }
    }

    // ── Create / reposition tokens ───────────────────────────────────────────
    for (const worker of workers) {
      if (worker.worldX == null || worker.worldY == null) continue;

      let token = this._tokens.get(worker.id);
      if (!token) {
        token = this._buildToken(worker);
        this._tokens.set(worker.id, token);
        this.container.addChild(token);
      }

      token.x = worker.worldX;
      token.y = worker.worldY;
    }
  }

  /** Destroy all tokens and the container. */
  destroy() {
    for (const token of this._tokens.values()) token.destroy();
    this._tokens.clear();
    this.container.destroy({ children: true });
  }

  // ---------------------------------------------------------------------------
  // Token construction
  // ---------------------------------------------------------------------------

  /**
   * Build a single worker-token Graphics object for `worker`.
   * The token is centred at (0, 0); `sync` positions it via `.x / .y`.
   *
   * @param {{ id: string, type: string }} worker
   * @returns {Graphics}
   */
  _buildToken(worker) {
    const color = TYPE_COLOR[worker.type] ?? DEFAULT_COLOR;
    const g = new Graphics();

    // ── Drop shadow ──────────────────────────────────────────────────────────
    g.ellipse(0, TOKEN_RADIUS * 0.6, TOKEN_RADIUS + 2, 3)
      .fill({ color: 0x000000, alpha: 0.20 });

    // ── Body circle ──────────────────────────────────────────────────────────
    g.circle(0, 0, TOKEN_RADIUS)
      .fill(color)
      .stroke({ color: 0xFFFFFF, width: 1.5, alpha: 0.85 });

    if (worker.type === 'building') {
      // ── Hammer symbol: vertical handle + angled head ─────────────────────
      const r = TOKEN_RADIUS;
      // Handle: vertical bar slightly offset right
      g.rect(1, -r * 0.5, 2, r * 1.0).fill(0xFFFFFF);
      // Head: horizontal block at top
      g.rect(-r * 0.35, -r * 0.55, r * 0.85, r * 0.32).fill(0xFFFFFF);
    } else if (worker.type === 'road') {
      // ── Pickaxe symbol: diagonal lines forming an X with longer bottom ───
      const r = TOKEN_RADIUS * 0.5;
      // First stroke (top-left to bottom-right)
      g.moveTo(-r, -r).lineTo(r * 0.6, r)
        .stroke({ color: 0xFFFFFF, width: 2, alpha: 1 });
      // Cross stroke (perpendicular)
      g.moveTo(-r * 0.6, r).lineTo(r, -r)
        .stroke({ color: 0xFFFFFF, width: 2, alpha: 1 });
    } else if (worker.type === 'demolish') {
      // ── X symbol ─────────────────────────────────────────────────────────
      const r = TOKEN_RADIUS * 0.5;
      g.moveTo(-r, -r).lineTo(r, r)
        .stroke({ color: 0xFFFFFF, width: 2, alpha: 1 });
      g.moveTo(r, -r).lineTo(-r, r)
        .stroke({ color: 0xFFFFFF, width: 2, alpha: 1 });
    }

    return g;
  }
}
