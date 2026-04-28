/** World / tile constants shared across all modules. */

/** Size of one terrain tile in world pixels. */
export const TILE_SIZE = 48;

/** Map dimensions in tiles. */
export const MAP_WIDTH  = 120;
export const MAP_HEIGHT = 120;

/** Tiles per chunk edge (a chunk is CHUNK_SIZE × CHUNK_SIZE tiles). */
export const CHUNK_SIZE = 12;

/** Terrain type enum. */
export const TERRAIN = Object.freeze({
  WATER:          0,
  SAND:           1,
  GRASS:          2,
  FOREST:         3,
  MOUNTAIN:       4,
  CASTLE_GROUND:  5,
});

/** Human-readable Chinese names shown in the HUD. */
export const TERRAIN_NAMES = {
  [TERRAIN.WATER]:         '河流 / 湖泊',
  [TERRAIN.SAND]:          '沙灘',
  [TERRAIN.GRASS]:         '草原',
  [TERRAIN.FOREST]:        '森林',
  [TERRAIN.MOUNTAIN]:      '山地',
  [TERRAIN.CASTLE_GROUND]: '城堡',
};
