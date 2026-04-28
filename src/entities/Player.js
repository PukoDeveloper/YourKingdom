import { Container, Graphics } from 'pixi.js';
import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from '../world/constants.js';

const SPEED  = 200; // world pixels per second
const RADIUS = 12;  // player body radius in world pixels

export class Player {
  /**
   * @param {number} worldX  starting world-pixel X
   * @param {number} worldY  starting world-pixel Y
   */
  constructor(worldX, worldY) {
    this.x = worldX;
    this.y = worldY;

    /** Last non-zero movement direction for idle facing. */
    this._facingAngle = -Math.PI / 2; // facing north by default

    this.container = this._buildSprite();
  }

  // ---------------------------------------------------------------------------
  // Sprite creation
  // ---------------------------------------------------------------------------

  _buildSprite() {
    const c = new Container();
    const g = new Graphics();

    // Drop shadow
    g.ellipse(0, 5, RADIUS + 3, 6).fill({ color: 0x000000, alpha: 0.28 });

    // Body
    g.circle(0, 0, RADIUS).fill(0xE53935).stroke({ color: 0x8B0000, width: 2 });

    // Face (brighter circle for head)
    g.circle(0, -2, 6).fill(0xFFCDD2);

    // Eyes
    g.circle(-3, -4, 2).fill(0x212121);
    g.circle( 3, -4, 2).fill(0x212121);

    // Direction indicator (small triangle at top, points "forward")
    g.poly([0, -(RADIUS + 2), -4, -(RADIUS + 8), 4, -(RADIUS + 8)]).fill(0xE53935);

    c.addChild(g);
    return c;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /**
   * @param {number} dt   delta-time in seconds
   * @param {number} dirX horizontal direction component (may be > 1 before normalise)
   * @param {number} dirY vertical direction component
   */
  update(dt, dirX, dirY) {
    const len = Math.sqrt(dirX * dirX + dirY * dirY);

    if (len > 0.01) {
      const nx = dirX / len;
      const ny = dirY / len;

      this.x += nx * SPEED * dt;
      this.y += ny * SPEED * dt;

      this._facingAngle = Math.atan2(ny, nx) + Math.PI / 2;
    }

    // Clamp to map bounds
    const margin = RADIUS + 2;
    this.x = Math.max(margin, Math.min(MAP_WIDTH  * TILE_SIZE - margin, this.x));
    this.y = Math.max(margin, Math.min(MAP_HEIGHT * TILE_SIZE - margin, this.y));

    // Sync sprite
    this.container.x        = this.x;
    this.container.y        = this.y;
    this.container.rotation = this._facingAngle;
  }
}
