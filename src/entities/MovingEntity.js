/**
 * MovingEntity – base class for all entities that move on the world map.
 *
 * Contains the shared movement logic, terrain-collision detection, facing
 * direction tracking and Pixi sprite management that was previously embedded
 * exclusively in Player.js.  Both the player's entity and NPC kings extend
 * this class so they share identical terrain-awareness rules.
 */

import { Container, Graphics } from 'pixi.js';
import { TERRAIN, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from '../world/constants.js';
import { drawCharGraphics } from '../systems/AppearanceSystem.js';

const SPEED             = 200;  // world pixels per second
const RADIUS            = 12;   // body radius in world pixels
const FOREST_SPEED_MULT = 0.4;
const HILL_SPEED_MULT   = 0.65;
const ROAD_SPEED_MULT   = 1.25;
const ROAD_SPEED_CAP    = 1.2;

export class MovingEntity {
  /**
   * @param {number} worldX  Starting world-pixel X.
   * @param {number} worldY  Starting world-pixel Y.
   * @param {object} appearance  Resolved appearance object (from AppearanceSystem).
   */
  constructor(worldX, worldY, appearance) {
    this.x = worldX;
    this.y = worldY;

    /** Last non-zero movement direction for idle facing. */
    this._facingAngle = 0;

    /** True when the entity may step onto WATER tiles. */
    this.canEmbark = false;

    /** True while the entity is on a WATER tile. */
    this.atSea = false;

    this._appearance = appearance;
    this.container   = this._buildSprite(appearance);
  }

  // ---------------------------------------------------------------------------
  // Sprite
  // ---------------------------------------------------------------------------

  _buildSprite(appearance) {
    const c = new Container();
    this._graphics = new Graphics();
    drawCharGraphics(this._graphics, RADIUS, appearance);
    c.addChild(this._graphics);
    return c;
  }

  /** Redraw the sprite with a new appearance object. */
  _rebuildGraphics(appearance) {
    this._appearance = appearance;
    this._graphics.clear();
    drawCharGraphics(this._graphics, RADIUS, appearance);
  }

  // ---------------------------------------------------------------------------
  // Facing direction
  // ---------------------------------------------------------------------------

  /**
   * Return the unit vector in the direction the entity is currently facing.
   * @returns {{ dx: number, dy: number }}
   */
  getFacingDirection() {
    return {
      dx:  Math.sin(this._facingAngle),
      dy: -Math.cos(this._facingAngle),
    };
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /**
   * Advance movement by one frame.
   *
   * @param {number}  dt            Delta-time in seconds.
   * @param {number}  dirX          Horizontal direction component.
   * @param {number}  dirY          Vertical direction component.
   * @param {import('../world/MapData.js').MapData|null} mapData
   * @param {Set<string>|null} [roadTileSet]
   * @param {Set<string>|null} [bridgeTileSet]
   */
  update(dt, dirX, dirY, mapData, roadTileSet = null, bridgeTileSet = null) {
    const len = Math.sqrt(dirX * dirX + dirY * dirY);

    if (len > 0.01) {
      const nx = dirX / len;
      const ny = dirY / len;

      const terrain = mapData ? mapData.getTerrainAtWorld(this.x, this.y) : null;
      let speedMult = 1;
      if (roadTileSet) {
        const tx = Math.floor(this.x / TILE_SIZE);
        const ty = Math.floor(this.y / TILE_SIZE);
        if (roadTileSet.has(`${tx},${ty}`)) {
          const base = terrain === TERRAIN.FOREST ? FOREST_SPEED_MULT
                     : terrain === TERRAIN.HILL   ? HILL_SPEED_MULT
                     : 1.0;
          speedMult = Math.min(ROAD_SPEED_CAP, base * ROAD_SPEED_MULT);
        } else {
          if (terrain === TERRAIN.FOREST) speedMult = FOREST_SPEED_MULT;
          else if (terrain === TERRAIN.HILL) speedMult = HILL_SPEED_MULT;
        }
      } else {
        if (terrain === TERRAIN.FOREST) speedMult = FOREST_SPEED_MULT;
        else if (terrain === TERRAIN.HILL) speedMult = HILL_SPEED_MULT;
      }
      const step = SPEED * speedMult * dt;

      const nextX = this.x + nx * step;
      if (!mapData || (!this._touchesMountain(mapData, nextX, this.y) && !this._touchesWater(mapData, nextX, this.y, bridgeTileSet))) {
        this.x = nextX;
      }

      const nextY = this.y + ny * step;
      if (!mapData || (!this._touchesMountain(mapData, this.x, nextY) && !this._touchesWater(mapData, this.x, nextY, bridgeTileSet))) {
        this.y = nextY;
      }

      this._facingAngle = Math.atan2(ny, nx) + Math.PI / 2;
    }

    // Track sea state and clear embark permission on landing.
    if (mapData) {
      const tx = Math.floor(this.x / TILE_SIZE);
      const ty = Math.floor(this.y / TILE_SIZE);
      const onBridge = bridgeTileSet ? bridgeTileSet.has(`${tx},${ty}`) : false;
      const onWater  = !onBridge && mapData.getTerrainAtWorld(this.x, this.y) === TERRAIN.WATER;
      if (this.atSea && !onWater) {
        this.canEmbark = false;
      }
      this.atSea = onWater;
    }

    // Clamp to map bounds.
    const margin = RADIUS + 2;
    this.x = Math.max(margin, Math.min(MAP_WIDTH  * TILE_SIZE - margin, this.x));
    this.y = Math.max(margin, Math.min(MAP_HEIGHT * TILE_SIZE - margin, this.y));

    // Sync sprite.
    this.container.x        = this.x;
    this.container.y        = this.y;
    this.container.rotation = this._facingAngle;
  }

  // ---------------------------------------------------------------------------
  // Collision helpers
  // ---------------------------------------------------------------------------

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

  _touchesWater(mapData, worldX, worldY, bridgeTileSet = null) {
    if (this.atSea || this.canEmbark) return false;
    const isBlockingWater = (wx, wy) => {
      if (mapData.getTerrainAtWorld(wx, wy) !== TERRAIN.WATER) return false;
      if (bridgeTileSet) {
        const tx = Math.floor(wx / TILE_SIZE);
        const ty = Math.floor(wy / TILE_SIZE);
        if (bridgeTileSet.has(`${tx},${ty}`)) return false;
      }
      return true;
    };
    return (
      isBlockingWater(worldX,          worldY         ) ||
      isBlockingWater(worldX + RADIUS, worldY         ) ||
      isBlockingWater(worldX - RADIUS, worldY         ) ||
      isBlockingWater(worldX,          worldY + RADIUS) ||
      isBlockingWater(worldX,          worldY - RADIUS)
    );
  }
}
