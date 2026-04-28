import { Container, Graphics } from 'pixi.js';
import { drawFlagGraphics, cssToNum } from '../systems/AppearanceSystem.js';

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/** Radius of the army-token body circle in world pixels. */
const TOKEN_RADIUS = 10;

/** Height of the flagpole above the token centre (upward). */
const POLE_HEIGHT = 28;

/** Flag rectangle dimensions drawn at the pole top. */
const FLAG_W = 16;
const FLAG_H = 11;

// ---------------------------------------------------------------------------
// NpcArmyRenderer
// ---------------------------------------------------------------------------

/**
 * Renders active NPC army marches as visible tokens on the world map.
 *
 * Each token shows:
 *   - A coloured circle (nation colour) with a small sword cross
 *   - A thin flagpole rising above the circle
 *   - The nation's composite flag drawn at the pole top
 *
 * Usage:
 *   1. Add `npcArmyRenderer.container` to the world scene graph.
 *   2. Call `sync(marches, mapData)` every game-loop frame after
 *      `diplomacySystem.updateMarches(dt, mapData)`.
 */
export class NpcArmyRenderer {
  /**
   * @param {import('../systems/NationSystem.js').NationSystem} nationSystem
   */
  constructor(nationSystem) {
    this._nationSystem = nationSystem;

    /** Root container added to the world scene graph. */
    this.container = new Container();

    /**
     * Map from march.id → Graphics token.
     * @type {Map<number, Graphics>}
     */
    this._tokens = new Map();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Synchronise visual tokens with the current pending-march list.
   * Tokens for marches that no longer exist are destroyed; new tokens are
   * created for newly queued marches; all tokens are repositioned using the
   * current world-pixel position stored in `march.worldX` / `march.worldY`.
   *
   * @param {ReadonlyArray<object>} marches  From `diplomacySystem.getPendingMarches()`
   * @param {import('./MapData.js').MapData}  mapData
   */
  sync(marches, mapData) {
    // ── Remove stale tokens ──────────────────────────────────────────────────
    const activeIds = new Set(marches.map(m => m.id));
    for (const [id, token] of this._tokens) {
      if (!activeIds.has(id)) {
        this.container.removeChild(token);
        token.destroy();
        this._tokens.delete(id);
      }
    }

    // ── Create / reposition tokens ───────────────────────────────────────────
    for (const march of marches) {
      // Guard: worldX/worldY must be set (they are set at march creation time).
      if (march.worldX == null || march.worldY == null) continue;

      let token = this._tokens.get(march.id);
      if (!token) {
        token = this._buildToken(march);
        this._tokens.set(march.id, token);
        this.container.addChild(token);
      }

      token.x = march.worldX;
      token.y = march.worldY;
    }
  }

  /** Destroy all tokens and the container. */
  destroy() {
    for (const token of this._tokens.values()) {
      token.destroy();
    }
    this._tokens.clear();
    this.container.destroy({ children: true });
  }

  // ---------------------------------------------------------------------------
  // Token construction
  // ---------------------------------------------------------------------------

  /**
   * Build a single army-token Graphics object for `march`.
   * The token is centred at (0, 0); `sync` positions it via `.x / .y`.
   *
   * @param {object} march
   * @returns {Graphics}
   */
  _buildToken(march) {
    const { nations } = this._nationSystem;
    const nation   = nations[march.attackerNationId];
    const colorNum = nation?.color ? cssToNum(nation.color) : 0xE53935;
    const flagApp  = nation?.flagApp ?? null;

    const g = new Graphics();

    // ── Drop shadow ──────────────────────────────────────────────────────────
    g.ellipse(0, TOKEN_RADIUS * 0.6, TOKEN_RADIUS + 3, 4)
      .fill({ color: 0x000000, alpha: 0.22 });

    // ── Body circle (nation colour) ──────────────────────────────────────────
    g.circle(0, 0, TOKEN_RADIUS)
      .fill(colorNum)
      .stroke({ color: 0xFFFFFF, width: 1.5, alpha: 0.75 });

    // ── Crossed swords symbol (white) ────────────────────────────────────────
    // Vertical bar
    g.rect(-1, -TOKEN_RADIUS * 0.55, 2, TOKEN_RADIUS * 1.1).fill(0xFFFFFF);
    // Horizontal bar
    g.rect(-TOKEN_RADIUS * 0.55, -1, TOKEN_RADIUS * 1.1, 2).fill(0xFFFFFF);

    // ── Second-squad indicator (extra small bar if both squads sent) ─────────
    if (march.sendBoth) {
      g.circle(TOKEN_RADIUS - 3, -TOKEN_RADIUS + 3, 4)
        .fill(0xFFFFFF)
        .stroke({ color: colorNum, width: 1 });
    }

    // ── Flagpole ─────────────────────────────────────────────────────────────
    const poleTop = -(TOKEN_RADIUS + POLE_HEIGHT);
    g.rect(-1, poleTop, 2, POLE_HEIGHT + TOKEN_RADIUS * 0.5)
      .fill(0x8D6E63);

    // ── Mini flag at pole top ─────────────────────────────────────────────────
    if (flagApp) {
      drawFlagGraphics(g, 1, poleTop, FLAG_W, FLAG_H, flagApp);
    } else {
      // Fallback triangular pennant in nation colour.
      g.poly([
        1,          poleTop,
        1 + FLAG_W, poleTop + FLAG_H / 2,
        1,          poleTop + FLAG_H,
      ]).fill(colorNum);
    }

    return g;
  }
}
