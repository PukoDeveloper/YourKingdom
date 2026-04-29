import { Container, Graphics } from 'pixi.js';

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/** Radius of the messenger-token body in world pixels. */
const TOKEN_RADIUS = 7;

/**
 * Fill colours keyed by missive type.
 * The border (stroke) is always white for visibility.
 */
const TYPE_COLOR = {
  peace:            0x26C6DA, // teal   – peace dove
  condemn:          0xEF6C00, // orange – condemnation
  gift:             0xF9A825, // amber  – gift
  war_declaration:  0xC62828, // dark red – war
};

/** Default colour when the type is unknown. */
const DEFAULT_COLOR = 0xE0E0E0;

// ---------------------------------------------------------------------------
// MissiveRenderer
// ---------------------------------------------------------------------------

/**
 * Renders active peace missives / messenger letters as visible tokens on the
 * world map.  Each token is a small coloured circle with a central envelope
 * cross pattern so it is distinguishable from army tokens at a glance.
 *
 * Usage:
 *   1. Add `missiveRenderer.container` to the world scene graph (above structures).
 *   2. Call `sync(missives)` every game-loop frame after
 *      `diplomacySystem.updateMissives(dt)` has advanced the positions.
 */
export class MissiveRenderer {
  constructor() {
    /** Root container added to the world scene graph. */
    this.container = new Container();

    /**
     * Map from missive.id → Graphics token.
     * @type {Map<number, Graphics>}
     */
    this._tokens = new Map();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Synchronise visual tokens with the current pending-missive list.
   * Tokens for missives that no longer exist are destroyed; new tokens are
   * created for newly queued missives; all tokens are repositioned using the
   * `worldX` / `worldY` stored in each missive.
   *
   * @param {ReadonlyArray<object>} missives  From `diplomacySystem.getPendingMissives()`
   */
  sync(missives) {
    // ── Remove stale tokens ──────────────────────────────────────────────────
    const activeIds = new Set(missives.map(m => m.id));
    for (const [id, token] of this._tokens) {
      if (!activeIds.has(id)) {
        this.container.removeChild(token);
        token.destroy();
        this._tokens.delete(id);
      }
    }

    // ── Create / reposition tokens ───────────────────────────────────────────
    for (const missive of missives) {
      if (missive.worldX == null || missive.worldY == null) continue;

      let token = this._tokens.get(missive.id);
      if (!token) {
        token = this._buildToken(missive);
        this._tokens.set(missive.id, token);
        this.container.addChild(token);
      }

      token.x = missive.worldX;
      token.y = missive.worldY;
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
   * Build a single messenger-token Graphics object for `missive`.
   * The token is centred at (0, 0); `sync` positions it via `.x / .y`.
   *
   * @param {object} missive
   * @returns {Graphics}
   */
  _buildToken(missive) {
    const color = TYPE_COLOR[missive.type] ?? DEFAULT_COLOR;
    const g = new Graphics();

    // ── Drop shadow ──────────────────────────────────────────────────────────
    g.ellipse(0, TOKEN_RADIUS * 0.6, TOKEN_RADIUS + 2, 3)
      .fill({ color: 0x000000, alpha: 0.20 });

    // ── Body circle ──────────────────────────────────────────────────────────
    g.circle(0, 0, TOKEN_RADIUS)
      .fill(color)
      .stroke({ color: 0xFFFFFF, width: 1.5, alpha: 0.9 });

    // ── Envelope symbol (letter cross pattern) ────────────────────────────────
    // Horizontal bar
    g.rect(-TOKEN_RADIUS * 0.55, -1, TOKEN_RADIUS * 1.1, 2).fill(0xFFFFFF);
    // Diagonal flaps (V-shape at top)
    const half = TOKEN_RADIUS * 0.45;
    g.poly([-half, -half, 0, 0, half, -half]).stroke({ color: 0xFFFFFF, width: 1.2, alpha: 0.9 });

    return g;
  }
}
