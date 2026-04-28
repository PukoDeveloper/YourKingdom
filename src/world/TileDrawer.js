import { Graphics } from 'pixi.js';
import { TERRAIN, TILE_SIZE } from './constants.js';

const T = TILE_SIZE; // 48

/**
 * Draw a single terrain tile (T×T pixels) at local pixel position
 * (localX, localY) into the provided Graphics object.
 */
export function drawTile(g, localX, localY, terrain) {
  const x = localX;
  const y = localY;

  switch (terrain) {
    // ------------------------------------------------------------------
    case TERRAIN.WATER:
      g.rect(x, y, T, T).fill(0x1565C0);
      // Ripple highlights
      g.rect(x + 4,  y + 13, 16, 4).fill(0x1976D2);
      g.rect(x + 23, y + 27, 18, 4).fill(0x1976D2);
      g.rect(x + 6,  y + 38, 12, 3).fill(0x42A5F5);
      break;

    // ------------------------------------------------------------------
    case TERRAIN.SAND:
      g.rect(x, y, T, T).fill(0xE8D5A3);
      g.circle(x + 10, y + 10, 3).fill(0xC9B88A);
      g.circle(x + 36, y + 34, 3).fill(0xC9B88A);
      g.circle(x + 22, y + 40, 2).fill(0xD4C190);
      g.circle(x + 38, y + 13, 2).fill(0xD4C190);
      break;

    // ------------------------------------------------------------------
    case TERRAIN.GRASS:
      g.rect(x, y, T, T).fill(0x4CAF50);
      // Random-looking darker patches (deterministic by position)
      g.rect(x + 3,  y + 6,  8, 6).fill(0x388E3C);
      g.rect(x + 28, y + 8,  9, 6).fill(0x2E7D32);
      g.rect(x + 7,  y + 34, 7, 8).fill(0x43A047);
      g.rect(x + 32, y + 30, 10, 7).fill(0x388E3C);
      break;

    // ------------------------------------------------------------------
    case TERRAIN.FOREST:
      g.rect(x, y, T, T).fill(0x2E7D32);
      // Trunk
      g.rect(x + 20, y + 34, 8, 13).fill(0x5D4037);
      // Canopy — three overlapping triangles for a fir-tree look
      g.poly([x + 4,  y + 42, x + 24, y + 22, x + 44, y + 42]).fill(0x1B5E20);
      g.poly([x + 7,  y + 34, x + 24, y + 12, x + 41, y + 34]).fill(0x2E7D32);
      g.poly([x + 10, y + 26, x + 24, y + 4,  x + 38, y + 26]).fill(0x33691E);
      break;

    // ------------------------------------------------------------------
    case TERRAIN.MOUNTAIN:
      g.rect(x, y, T, T).fill(0x546E7A);
      // Main peak
      g.poly([x + 2,  y + 46, x + 24, y + 4,  x + 46, y + 46]).fill(0x757575);
      // Shadow face (right side)
      g.poly([x + 24, y + 4,  x + 46, y + 46, x + 24, y + 46]).fill(0x4A4A4A);
      // Snow cap
      g.poly([x + 17, y + 22, x + 24, y + 4,  x + 31, y + 22]).fill(0xEEEEEE);
      break;

    // ------------------------------------------------------------------
    case TERRAIN.CASTLE_GROUND:
      g.rect(x, y, T, T).fill(0x8D8D8D);
      // Stone-block pattern (four blocks with grout lines)
      g.rect(x + 2,  y + 2,  21, 21).fill(0x9E9E9E);
      g.rect(x + 25, y + 2,  21, 21).fill(0x9E9E9E);
      g.rect(x + 2,  y + 25, 21, 21).fill(0x9E9E9E);
      g.rect(x + 25, y + 25, 21, 21).fill(0x9E9E9E);
      break;

    // ------------------------------------------------------------------
    default:
      g.rect(x, y, T, T).fill(0x1565C0);
  }
}

// ---------------------------------------------------------------------------
// Castle building (drawn as one large structure over 4×4 tile area = 192×192px)
// ---------------------------------------------------------------------------

/**
 * Draw a detailed castle building at world-pixel position (px, py).
 * The building occupies 4×4 tiles = (4 * TILE_SIZE)² pixels.
 */
export function drawCastleBuilding(g, px, py) {
  const S = T * 4; // 192

  // --- Outer defensive ground ---
  g.rect(px, py, S, S).fill(0x78909C);

  // --- Outer wall ring ---
  g.rect(px + 10, py + 10, S - 20, S - 20).fill(0x607D8B);

  // --- Courtyard floor ---
  g.rect(px + 22, py + 22, S - 44, S - 44).fill(0x8D8D8D);
  // Cobblestone blocks in courtyard
  const blockSize = 18;
  for (let by = 0; by < 3; by++) {
    for (let bx = 0; bx < 3; bx++) {
      g.rect(
        px + 24 + bx * (blockSize + 2),
        py + 24 + by * (blockSize + 2),
        blockSize, blockSize,
      ).fill(0x9E9E9E);
    }
  }

  // --- Central keep ---
  g.rect(px + 68, py + 68, 56, 56).fill(0x37474F);
  g.rect(px + 72, py + 72, 48, 48).fill(0x455A64);
  // Keep inner floor
  g.rect(px + 78, py + 78, 36, 36).fill(0x4A5568);

  // Keep arrow-slit windows (4 directions)
  g.rect(px + 88, py + 70, 16, 10).fill(0x263238); // north
  g.rect(px + 88, py + 112, 16, 10).fill(0x263238); // south
  g.rect(px + 70, py + 88, 10, 16).fill(0x263238); // west
  g.rect(px + 112, py + 88, 10, 16).fill(0x263238); // east

  // --- Corner towers (round) ---
  const towerCentres = [
    [px + 14, py + 14],
    [px + S - 14, py + 14],
    [px + 14, py + S - 14],
    [px + S - 14, py + S - 14],
  ];
  for (const [tx, ty] of towerCentres) {
    g.circle(tx, ty, 16).fill(0x455A64);
    g.circle(tx, ty, 10).fill(0x37474F);
    g.circle(tx, ty, 5).fill(0x263238);
  }

  // --- Battlements along outer-wall top edge (north side) ---
  for (let bx = 16; bx < S - 16; bx += 14) {
    g.rect(px + bx, py + 8, 8, 8).fill(0x37474F); // north
    g.rect(px + bx, py + S - 16, 8, 8).fill(0x37474F); // south
    g.rect(px + 8,  py + bx, 8, 8).fill(0x37474F); // west
    g.rect(px + S - 16, py + bx, 8, 8).fill(0x37474F); // east
  }

  // --- Gate arch (south face) ---
  g.rect(px + 80, py + S - 22, 32, 22).fill(0x263238);
  g.circle(px + 96, py + S - 22, 16).fill(0x263238);
  // Portcullis bars
  for (let bar = 0; bar < 3; bar++) {
    g.rect(px + 84 + bar * 9, py + S - 22, 3, 16).fill(0x37474F);
  }
  g.rect(px + 84, py + S - 14, 24, 3).fill(0x37474F); // horizontal bar

  // --- Flagpole + banner on keep ---
  g.rect(px + 94, py + 54, 4, 22).fill(0x8D6E63);
  g.poly([
    px + 98, py + 54,
    px + 118, py + 62,
    px + 98, py + 70,
  ]).fill(0xE53935);
}
