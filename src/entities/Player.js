import { Container, Graphics } from 'pixi.js';
import { TERRAIN, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from '../world/constants.js';

const SPEED              = 200;  // world pixels per second
const RADIUS             = 12;   // player body radius in world pixels
const FOREST_SPEED_MULT  = 0.4;  // speed multiplier when inside forest

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
   * @param {number}  dt      delta-time in seconds
   * @param {number}  dirX    horizontal direction component (may be > 1 before normalise)
   * @param {number}  dirY    vertical direction component
   * @param {MapData} mapData map data used for terrain collision
   */
  update(dt, dirX, dirY, mapData) {
    const len = Math.sqrt(dirX * dirX + dirY * dirY);

    if (len > 0.01) {
      const nx = dirX / len;
      const ny = dirY / len;

      // Apply forest speed penalty based on the tile the player currently stands on
      const terrain   = mapData ? mapData.getTerrainAtWorld(this.x, this.y) : null;
      const speedMult = terrain === TERRAIN.FOREST ? FOREST_SPEED_MULT : 1;
      const step      = SPEED * speedMult * dt;

      // Attempt X and Y movement independently so the player can slide along
      // mountain / water edges rather than being stopped completely.
      const nextX = this.x + nx * step;
      if (!mapData || (!this._touchesMountain(mapData, nextX, this.y) && !this._touchesWater(mapData, nextX, this.y))) {
        this.x = nextX;
      }

      const nextY = this.y + ny * step;
      if (!mapData || (!this._touchesMountain(mapData, this.x, nextY) && !this._touchesWater(mapData, this.x, nextY))) {
        this.y = nextY;
      }

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

  /**
   * Returns true if the player's body (centre + cardinal-edge probe points)
   * would overlap a MOUNTAIN tile at the given world position.
   *
   * @param {MapData} mapData
   * @param {number}  worldX
   * @param {number}  worldY
   */
  _touchesMountain(mapData, worldX, worldY) {
    const isMtn = (wx, wy) => mapData.getTerrainAtWorld(wx, wy) === TERRAIN.MOUNTAIN;
    return (
      isMtn(worldX,          worldY         ) ||
      isMtn(worldX + RADIUS, worldY         ) ||
      isMtn(worldX - RADIUS, worldY         ) ||
      isMtn(worldX,          worldY + RADIUS) ||
      isMtn(worldX,          worldY - RADIUS)
    );
  }

  /**
   * Returns true if the player's body (centre + cardinal-edge probe points)
   * would overlap a WATER tile at the given world position.
   *
   * @param {MapData} mapData
   * @param {number}  worldX
   * @param {number}  worldY
   */
  _touchesWater(mapData, worldX, worldY) {
    const isWater = (wx, wy) => mapData.getTerrainAtWorld(wx, wy) === TERRAIN.WATER;
    return (
      isWater(worldX,          worldY         ) ||
      isWater(worldX + RADIUS, worldY         ) ||
      isWater(worldX - RADIUS, worldY         ) ||
      isWater(worldX,          worldY + RADIUS) ||
      isWater(worldX,          worldY - RADIUS)
    );
  }
}
