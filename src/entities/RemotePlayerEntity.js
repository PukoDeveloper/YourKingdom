/**
 * RemotePlayerEntity – lightweight Pixi container that represents another
 * player's position in multiplayer mode.  It is intentionally simple: a
 * coloured circle + a small name label, smoothly interpolated toward the
 * last received server position.
 */

import { Container, Graphics, Text } from 'pixi.js';

/** Interpolation speed: how quickly the visual snaps to the target (units/s). */
const LERP_SPEED = 12;

/** Colour used for all remote player sprites. */
const REMOTE_COLOUR = 0x64b5f6; // light blue

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

    this.container = this._build();
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  _build() {
    const c = new Container();

    const g = new Graphics();
    g.circle(0, 0, RADIUS).fill({ color: REMOTE_COLOUR, alpha: 0.9 });
    g.circle(0, 0, RADIUS).stroke({ color: 0xffffff, alpha: 0.7, width: 2 });
    // Small directional indicator (triangle at the top).
    g.poly([-5, -RADIUS + 2, 0, -RADIUS - 7, 5, -RADIUS + 2]).fill({ color: 0xffffff, alpha: 0.85 });
    c.addChild(g);

    const label = new Text({ text: `玩家`, style: {
      fontFamily: "'PingFang SC','Microsoft YaHei',sans-serif",
      fontSize:   11,
      fill:       0xffffff,
      stroke:     { color: 0x000000, width: 3 },
      align:      'center',
    }});
    label.anchor.set(0.5, 0);
    label.position.set(0, RADIUS + 3);
    c.addChild(label);

    this._label = label;
    c.x = this.x;
    c.y = this.y;
    return c;
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
   * Advance the visual interpolation by one frame.
   * @param {number} dt  Delta-time in seconds.
   */
  update(dt) {
    const t = Math.min(1, LERP_SPEED * dt);
    this.x += (this._targetX - this.x) * t;
    this.y += (this._targetY - this.y) * t;

    this.container.x        = this.x;
    this.container.y        = this.y;
    this.container.rotation = this._targetAngle;
  }
}
