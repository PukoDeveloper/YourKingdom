import { TERRAIN, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from './constants.js';

// ---------------------------------------------------------------------------
// Noise helpers
// ---------------------------------------------------------------------------

/** Deterministic 2-D hash → [0, 1). */
function hash(x, y, seed) {
  const n = x * 127.1 + y * 311.7 + seed * 74.3;
  const s = Math.sin(n * 329.7) * 12413.1 + Math.sin(n * 113.3) * 8234.7;
  return Math.abs(s) % 1.0;
}

/** Bilinear-interpolated smooth noise. */
function smoothNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix,     iy,     seed);
  const b = hash(ix + 1, iy,     seed);
  const c = hash(ix,     iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractional Brownian Motion – sums multiple noise octaves. */
function fbm(x, y, seed, octaves = 5, persistence = 0.5) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    value     += smoothNoise(x * frequency, y * frequency, seed + i * 100) * amplitude;
    max       += amplitude;
    amplitude *= persistence;
    frequency *= 2;
  }
  return value / max;
}

// ---------------------------------------------------------------------------
// MapData class
// ---------------------------------------------------------------------------

export class MapData {
  /**
   * @param {number} seed  – world seed (any integer)
   */
  constructor(seed = 42) {
    this.seed = seed;
    /** Flat typed array: index = y * MAP_WIDTH + x, value = TERRAIN enum. */
    this.tiles = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
    /**
     * Castle anchor positions (top-left tile of each 4×4 castle block).
     * @type {{ x: number, y: number }[]}
     */
    this.castles = [];
    this._generate();
  }

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------

  _generate() {
    const H_SCALE  = 0.045;   // height noise frequency
    const M_SCALE  = 0.038;   // moisture noise frequency
    const R_SCALE  = 0.070;   // river noise frequency

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const height   = fbm(x * H_SCALE, y * H_SCALE, this.seed,       5);
        const moisture = fbm(x * M_SCALE, y * M_SCALE, this.seed + 500, 4);
        const river    = smoothNoise(x * R_SCALE, y * R_SCALE, this.seed + 1000);

        let t;
        if (height < 0.32) {
          t = TERRAIN.WATER;
        } else if (height < 0.38) {
          t = TERRAIN.SAND;
        } else if (height > 0.72) {
          t = TERRAIN.MOUNTAIN;
        } else if (moisture > 0.56) {
          t = TERRAIN.FOREST;
        } else {
          t = TERRAIN.GRASS;
        }

        // Overlay rivers: thin winding bands on non-mountain land
        if (t !== TERRAIN.MOUNTAIN && t !== TERRAIN.WATER) {
          if (Math.abs(river - 0.5) < 0.024) {
            t = TERRAIN.WATER;
          }
        }

        this.tiles[y * MAP_WIDTH + x] = t;
      }
    }

    this._placeCastles();
  }

  _placeCastles() {
    // Desired castle positions (roughly near map quadrant centres)
    const targets = [
      { x: Math.floor(MAP_WIDTH * 0.22), y: Math.floor(MAP_HEIGHT * 0.22) },
      { x: Math.floor(MAP_WIDTH * 0.70), y: Math.floor(MAP_HEIGHT * 0.22) },
      { x: Math.floor(MAP_WIDTH * 0.22), y: Math.floor(MAP_HEIGHT * 0.72) },
      { x: Math.floor(MAP_WIDTH * 0.72), y: Math.floor(MAP_HEIGHT * 0.72) },
    ];

    for (const target of targets) {
      // Search outward for a grassy region with enough room for a 4×4 block
      const found = this._findGrassySpot(target.x, target.y, 4);
      if (!found) continue;

      const { x, y } = found;
      // Mark 4×4 area as castle ground
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          this.tiles[(y + dy) * MAP_WIDTH + (x + dx)] = TERRAIN.CASTLE_GROUND;
        }
      }
      this.castles.push({ x, y });
    }
  }

  /**
   * Spiral-search outward from (cx, cy) for a spot where a `size×size` block
   * fits entirely on GRASS tiles.
   */
  _findGrassySpot(cx, cy, size) {
    for (let r = 0; r < 18; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only perimeter
          const ox = cx + dx;
          const oy = cy + dy;
          if (ox < 1 || oy < 1 || ox + size >= MAP_WIDTH - 1 || oy + size >= MAP_HEIGHT - 1) continue;
          if (this._allGrass(ox, oy, size)) return { x: ox, y: oy };
        }
      }
    }
    return null;
  }

  _allGrass(x, y, size) {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (this.tiles[(y + dy) * MAP_WIDTH + (x + dx)] !== TERRAIN.GRASS) return false;
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Public helpers
  // -------------------------------------------------------------------------

  /** @returns {number} TERRAIN enum value */
  getTerrain(tileX, tileY) {
    if (tileX < 0 || tileY < 0 || tileX >= MAP_WIDTH || tileY >= MAP_HEIGHT) {
      return TERRAIN.WATER;
    }
    return this.tiles[tileY * MAP_WIDTH + tileX];
  }

  /** @returns {number} TERRAIN enum for the tile at world-pixel position */
  getTerrainAtWorld(worldX, worldY) {
    return this.getTerrain(
      Math.floor(worldX / TILE_SIZE),
      Math.floor(worldY / TILE_SIZE),
    );
  }

  /** @returns {{ tileX: number, tileY: number }} recommended player start tile */
  findStartTile() {
    const cx = Math.floor(MAP_WIDTH  / 2);
    const cy = Math.floor(MAP_HEIGHT / 2);
    for (let r = 0; r < 30; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (this.getTerrain(tx, ty) === TERRAIN.GRASS) {
            return { tileX: tx, tileY: ty };
          }
        }
      }
    }
    return { tileX: cx, tileY: cy };
  }
}
