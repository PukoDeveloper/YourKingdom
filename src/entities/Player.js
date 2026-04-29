import { Container, Graphics } from 'pixi.js';
import { TERRAIN, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from '../world/constants.js';
import {
  generateCharAppearance,
  charAppearanceFromIndices,
  drawCharGraphics,
} from '../systems/AppearanceSystem.js';

const SPEED              = 200;  // world pixels per second
const RADIUS             = 12;   // player body radius in world pixels
const FOREST_SPEED_MULT  = 0.4;  // speed multiplier when inside forest
const HILL_SPEED_MULT    = 0.65; // speed multiplier when traversing hills

/** Default player name used when no saved name is present. */
const DEFAULT_PLAYER_NAME = '主角';

export class Player {
  /**
   * @param {number} worldX  starting world-pixel X
   * @param {number} worldY  starting world-pixel Y
   * @param {object|null} [appearanceIndices]  saved appearance index object, or null for default
   */
  constructor(worldX, worldY, appearanceIndices = null) {
    this.x = worldX;
    this.y = worldY;

    /** Player's display name. */
    this.name = appearanceIndices?.playerName || DEFAULT_PLAYER_NAME;

    /** Last non-zero movement direction for idle facing. */
    this._facingAngle = -Math.PI / 2; // facing north by default

    /** Current appearance (modular parts). */
    this.appearance = appearanceIndices
      ? charAppearanceFromIndices(appearanceIndices)
      : generateCharAppearance(0, 42); // default hero look

    /**
     * True when the player is allowed to step onto WATER tiles.
     * Set to true by Game.js when the player stands on a built port tile.
     * Cleared automatically when the player leaves water back onto land.
     */
    this.canEmbark = false;

    /**
     * True while the player is physically on a WATER tile.
     * Used to detect the land-landing transition that clears `canEmbark`.
     */
    this.atSea = false;

    this.container = this._buildSprite();
  }

  // ---------------------------------------------------------------------------
  // Sprite creation / update
  // ---------------------------------------------------------------------------

  _buildSprite() {
    const c = new Container();
    this._graphics = new Graphics();
    drawCharGraphics(this._graphics, RADIUS, this.appearance);
    c.addChild(this._graphics);
    return c;
  }

  /**
   * Change the player's appearance and rebuild the sprite.
   * @param {{ bodyColorIdx: number, headgearIdx: number, armorColorIdx: number, markColorIdx: number,
   *           bodyShapeIdx?: number, faceAccIdx?: number, playerName?: string }} indices
   */
  setAppearance(indices) {
    if (indices.playerName !== undefined) {
      this.name = indices.playerName || DEFAULT_PLAYER_NAME;
    }
    this.appearance = charAppearanceFromIndices(indices);
    this._graphics.clear();
    drawCharGraphics(this._graphics, RADIUS, this.appearance);
  }

  /** Return serialisable appearance index snapshot. */
  getAppearanceState() {
    const a = this.appearance;
    return {
      playerName:    this.name,
      bodyColorIdx:  a.bodyColorIdx,
      headgearIdx:   a.headgearIdx,
      armorColorIdx: a.armorColorIdx,
      markColorIdx:  a.markColorIdx,
      bodyShapeIdx:  a.bodyShapeIdx  ?? 0,
      faceAccIdx:    a.faceAccIdx    ?? 0,
    };
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

      // Apply forest/hill speed penalty based on the tile the player currently stands on
      const terrain   = mapData ? mapData.getTerrainAtWorld(this.x, this.y) : null;
      let speedMult = 1;
      if (terrain === TERRAIN.FOREST) speedMult = FOREST_SPEED_MULT;
      else if (terrain === TERRAIN.HILL) speedMult = HILL_SPEED_MULT;
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

    // Track sea state: detect landing (water → land) and clear embark permission.
    if (mapData) {
      const onWater = mapData.getTerrainAtWorld(this.x, this.y) === TERRAIN.WATER;
      if (this.atSea && !onWater) {
        // Just stepped onto land after being at sea – revoke sea access.
        this.canEmbark = false;
      }
      this.atSea = onWater;
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
   * Returns false when the player has sea access (canEmbark or already atSea).
   *
   * @param {MapData} mapData
   * @param {number}  worldX
   * @param {number}  worldY
   */
  _touchesWater(mapData, worldX, worldY) {
    // Allow water movement when the player is already at sea or has embark access.
    if (this.atSea || this.canEmbark) return false;
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
