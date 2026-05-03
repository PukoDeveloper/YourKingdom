/**
 * RemotePlayerEntity – lightweight Pixi container that represents another
 * player's position in multiplayer mode.
 *
 * The sprite is rendered using the same `drawCharGraphics` function that
 * `MovingEntity` uses, so remote players look identical to the local player
 * when appearance data has been received.  Before appearance data arrives the
 * entity falls back to a plain coloured circle.
 *
 * The directional sprite is placed in an inner container that rotates with the
 * player's facing angle, while the name/kingdom labels stay in the outer
 * container and always remain upright on-screen.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { charAppearanceFromIndices, drawCharGraphics, cssToNum } from '../systems/AppearanceSystem.js';

/** Interpolation speed: how quickly the visual snaps to the target (units/s). */
const LERP_SPEED = 12;

/** Colour used when no appearance data has been received yet. */
const DEFAULT_COLOUR = 0x64b5f6; // light blue

/** Circle radius in world pixels – matches MovingEntity's RADIUS. */
const RADIUS = 12;

export class RemotePlayerEntity {
  /**
   * @param {string} id    Server-assigned player id.
   * @param {number} x     Initial world-pixel X.
   * @param {number} y     Initial world-pixel Y.
   */
  constructor(id, x, y) {
    /** Server-assigned id. @type {string} */
    this.id = id;

    /** Current visual position (interpolated). */
    this.x = x;
    this.y = y;

    /** Target position from the latest server state message. */
    this._targetX = x;
    this._targetY = y;
    this._targetAngle = 0;

    /** Whether appearance data from the server has been applied yet. */
    this._hasAppearance = false;

    this.container = this._build();
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  _build() {
    // Outer container – moves with the player's world position; labels live here
    // so they never rotate.
    const c = new Container();

    // Inner container – rotates with the player's facing angle.
    this._spriteContainer = new Container();
    this._graphics = new Graphics();
    this._drawFallback();
    this._spriteContainer.addChild(this._graphics);
    c.addChild(this._spriteContainer);

    // Name label (always upright)
    const nameLabel = new Text({ text: '玩家', style: {
      fontFamily: "'PingFang SC','Microsoft YaHei',sans-serif",
      fontSize:   11,
      fill:       0xffffff,
      stroke:     { color: 0x000000, width: 3 },
      align:      'center',
    }});
    nameLabel.anchor.set(0.5, 0);
    nameLabel.position.set(0, RADIUS + 3);
    c.addChild(nameLabel);
    this._nameLabel = nameLabel;

    // Kingdom label – shown below the name once kingdom data arrives.
    const kingdomLabel = new Text({ text: '', style: {
      fontFamily: "'PingFang SC','Microsoft YaHei',sans-serif",
      fontSize:   10,
      fill:       DEFAULT_COLOUR,
      stroke:     { color: 0x000000, width: 2 },
      align:      'center',
    }});
    kingdomLabel.anchor.set(0.5, 0);
    kingdomLabel.position.set(0, RADIUS + 16);
    kingdomLabel.visible = false;
    c.addChild(kingdomLabel);
    this._kingdomLabel = kingdomLabel;

    c.x = this.x;
    c.y = this.y;
    return c;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Draw the default fallback sprite (coloured circle with direction triangle). */
  _drawFallback() {
    const g = this._graphics;
    g.clear();
    g.circle(0, 0, RADIUS).fill({ color: DEFAULT_COLOUR, alpha: 0.9 });
    g.circle(0, 0, RADIUS).stroke({ color: 0xffffff, alpha: 0.7, width: 2 });
    // Small directional indicator (triangle pointing upward = forward direction).
    g.poly([-5, -RADIUS + 2, 0, -RADIUS - 7, 5, -RADIUS + 2]).fill({ color: 0xffffff, alpha: 0.85 });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Receive a new position from the server and set it as the lerp target.
   * @param {number} x
   * @param {number} y
   * @param {number} angle
   */
  setTarget(x, y, angle) {
    this._targetX     = x;
    this._targetY     = y;
    this._targetAngle = angle;
  }

  /**
   * Update the name label shown above this player's sprite.
   * @param {string} name
   */
  setName(name) {
    const label = name?.trim() || '玩家';
    if (this._nameLabel.text !== label) {
      this._nameLabel.text = label;
    }
  }

  /**
   * Apply appearance index data received from the server.
   * Rebuilds the sprite using the full `drawCharGraphics` renderer.
   * @param {{ bodyColorIdx: number, headgearIdx: number, armorColorIdx: number,
   *            markColorIdx: number, bodyShapeIdx?: number, faceAccIdx?: number }} indices
   */
  setAppearance(indices) {
    if (!indices || typeof indices !== 'object') return;
    const appearance = charAppearanceFromIndices(indices);
    this._graphics.clear();
    drawCharGraphics(this._graphics, RADIUS, appearance);
    this._hasAppearance = true;
  }

  /**
   * Apply kingdom name and colour received from the server.
   * Shows a second label below the player name in the kingdom's colour.
   * @param {string} name   Kingdom display name.
   * @param {string} color  Kingdom background colour (CSS string, e.g. '#C62828').
   */
  setKingdom(name, color) {
    const displayName = name?.trim() || '';
    const colorHex    = cssToNum(color);
    this._kingdomLabel.visible = !!displayName;
    if (displayName) {
      if (this._kingdomLabel.text !== displayName) {
        this._kingdomLabel.text = displayName;
      }
      this._kingdomLabel.style.fill = colorHex;
    }
  }

  /**
   * Advance the visual interpolation by one frame.
   * @param {number} dt  Delta-time in seconds.
   */
  update(dt) {
    const t = Math.min(1, LERP_SPEED * dt);
    this.x += (this._targetX - this.x) * t;
    this.y += (this._targetY - this.y) * t;

    this.container.x = this.x;
    this.container.y = this.y;
    // Only the inner sprite container rotates; labels stay upright.
    this._spriteContainer.rotation = this._targetAngle;
  }
}
