/**
 * NpcPathfinder – tile-based A* for NPC army marches.
 *
 * Rules:
 *  - MOUNTAIN and WATER tiles are impassable.
 *  - FOREST tiles cost 2.5× (matches the player's FOREST_SPEED_MULT = 0.4 → 1/0.4 = 2.5).
 *  - All other passable tiles cost 1.0.
 *  - 8-directional movement (orthogonal cost 1.0, diagonal cost √2).
 *
 * `buildPath(mapData, fromPx, toPx)` returns an array of world-pixel waypoints
 * from the start position to the target position.  The array always starts with
 * a point near `fromPx` and ends near `toPx`.
 * Returns null when no path exists (source or target is inside an impassable block).
 */

import { TERRAIN, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from './constants.js';

// ---------------------------------------------------------------------------
// Terrain cost table
// ---------------------------------------------------------------------------

const IMPASSABLE  = Infinity;
const FOREST_COST = 2.5; // 1 / FOREST_SPEED_MULT (0.4)

/** Per-tile movement cost multiplier (> 0; Infinity = impassable). */
function _terrainCost(terrain) {
  switch (terrain) {
    case TERRAIN.WATER:    return IMPASSABLE;
    case TERRAIN.MOUNTAIN: return IMPASSABLE;
    case TERRAIN.FOREST:   return FOREST_COST;
    default:               return 1.0;
  }
}

// ---------------------------------------------------------------------------
// Minimal binary min-heap (priority queue)
// ---------------------------------------------------------------------------

class MinHeap {
  constructor() {
    /** @type {Array<{key: number, priority: number}>} */
    this._data = [];
  }

  get size() { return this._data.length; }

  push(key, priority) {
    this._data.push({ key, priority });
    this._bubbleUp(this._data.length - 1);
  }

  pop() {
    const top  = this._data[0];
    const last = this._data.pop();
    if (this._data.length > 0) {
      this._data[0] = last;
      this._siftDown(0);
    }
    return top;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._data[parent].priority <= this._data[i].priority) break;
      [this._data[parent], this._data[i]] = [this._data[i], this._data[parent]];
      i = parent;
    }
  }

  _siftDown(i) {
    const n = this._data.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this._data[l].priority < this._data[smallest].priority) smallest = l;
      if (r < n && this._data[r].priority < this._data[smallest].priority) smallest = r;
      if (smallest === i) break;
      [this._data[smallest], this._data[i]] = [this._data[i], this._data[smallest]];
      i = smallest;
    }
  }
}

// ---------------------------------------------------------------------------
// A* helpers
// ---------------------------------------------------------------------------

/** Encode tile coords as a single 32-bit integer key. */
const _key = (tx, ty) => ty * MAP_WIDTH + tx;

/** Octile distance heuristic (admissible for 8-directional movement). */
function _heuristic(ax, ay, bx, by) {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

// ---------------------------------------------------------------------------
// Reusable A* buffers (allocated once; reset per call with fill())
// Safe because JavaScript is single-threaded on the main thread.
// ---------------------------------------------------------------------------

const _gCostBuf    = new Float64Array(MAP_WIDTH * MAP_HEIGHT);
const _cameFromBuf = new Int32Array(MAP_WIDTH * MAP_HEIGHT);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find a path between two world-pixel positions, navigating around impassable
 * terrain (MOUNTAIN, WATER).  Forest tiles are traversable but slow.
 *
 * @param {import('./MapData.js').MapData} mapData
 * @param {{ x: number, y: number }} fromPx  Start world-pixel position.
 * @param {{ x: number, y: number }} toPx    Target world-pixel position.
 * @returns {{ x: number, y: number }[]|null}
 *   Array of world-pixel waypoints (tile centres) from start → target,
 *   or null if no path can be found.
 */
export function buildPath(mapData, fromPx, toPx) {
  // Convert pixel positions to tile coordinates.
  const startTX = Math.floor(fromPx.x / TILE_SIZE);
  const startTY = Math.floor(fromPx.y / TILE_SIZE);
  const endTX   = Math.floor(toPx.x   / TILE_SIZE);
  const endTY   = Math.floor(toPx.y   / TILE_SIZE);

  // Snap start/end to passable tiles.
  const resolvedStart = _nearestPassable(mapData, startTX, startTY);
  const resolvedEnd   = _nearestPassable(mapData, endTX,   endTY);
  if (!resolvedStart || !resolvedEnd) return null;

  const [sx, sy] = resolvedStart;
  const [ex, ey] = resolvedEnd;

  // Trivial case.
  if (sx === ex && sy === ey) {
    return [_tileCenterPx(sx, sy)];
  }

  // ── A* search ───────────────────────────────────────────────────────────
  const openSet  = new MinHeap();
  // Reuse module-level buffers to avoid 480 KB of allocation per call.
  _gCostBuf.fill(Infinity);
  _cameFromBuf.fill(-1);
  const gCost    = _gCostBuf;
  const cameFrom = _cameFromBuf;

  const startKey = _key(sx, sy);
  gCost[startKey] = 0;
  openSet.push(startKey, _heuristic(sx, sy, ex, ey));

  const endKey = _key(ex, ey);

  while (openSet.size > 0) {
    const { key: currentKey } = openSet.pop();

    if (currentKey === endKey) break;

    const cx = currentKey % MAP_WIDTH;
    const cy = (currentKey / MAP_WIDTH) | 0;

    // Explore 8 neighbours.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;

        const terrain = mapData.getTerrain(nx, ny);
        const cost    = _terrainCost(terrain);
        if (cost === IMPASSABLE) continue;

        // Prevent diagonal corner cutting: require both orthogonal neighbours
        // of a diagonal step to be passable, so entities cannot slip through
        // a gap between two diagonally-touching impassable tiles.
        if (dx !== 0 && dy !== 0) {
          if (_terrainCost(mapData.getTerrain(cx + dx, cy)) === IMPASSABLE) continue;
          if (_terrainCost(mapData.getTerrain(cx, cy + dy)) === IMPASSABLE) continue;
        }

        // Diagonal moves cost √2 times the terrain cost.
        const moveCost = (dx !== 0 && dy !== 0) ? cost * Math.SQRT2 : cost;
        const nKey     = _key(nx, ny);
        const newG     = gCost[currentKey] + moveCost;

        if (newG < gCost[nKey]) {
          gCost[nKey]    = newG;
          cameFrom[nKey] = currentKey;
          openSet.push(nKey, newG + _heuristic(nx, ny, ex, ey));
        }
      }
    }
  }

  // ── Reconstruct path ────────────────────────────────────────────────────
  if (cameFrom[endKey] === -1 && endKey !== startKey) {
    // No path found.
    return null;
  }

  const tilePath = [];
  let cur = endKey;
  while (cur !== -1) {
    tilePath.push(cur);
    cur = cameFrom[cur];
  }
  tilePath.reverse();

  // Convert tile indices to world-pixel centres and simplify the path.
  const pixelPath = tilePath.map(k => _tileCenterPx(k % MAP_WIDTH, (k / MAP_WIDTH) | 0));
  return _simplify(pixelPath, mapData);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** World-pixel centre of tile (tx, ty). */
function _tileCenterPx(tx, ty) {
  return { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
}

/**
 * Find the nearest passable tile within a small radius of (tx, ty).
 * The radius cap of NEAREST_PASSABLE_RADIUS tiles is large enough to escape
 * any typical structure footprint (castles are 4×4) while keeping the search
 * bounded.
 * Returns [resolvedTX, resolvedTY] or null.
 */
const NEAREST_PASSABLE_RADIUS = 8;

function _nearestPassable(mapData, tx, ty) {
  for (let r = 0; r <= NEAREST_PASSABLE_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only perimeter
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
        const cost = _terrainCost(mapData.getTerrain(nx, ny));
        if (cost !== IMPASSABLE) return [nx, ny];
      }
    }
  }
  return null;
}

/**
 * Line-of-sight simplification: remove waypoints that are directly visible
 * from the previous kept point (i.e. the straight line between them never
 * crosses an impassable tile).  This reduces the waypoint count significantly
 * on open terrain while keeping the path correct around obstacles.
 *
 * @param {{ x: number, y: number }[]} path
 * @param {import('./MapData.js').MapData} mapData
 * @returns {{ x: number, y: number }[]}
 */
function _simplify(path, mapData) {
  if (path.length <= 2) return path;

  const result = [path[0]];
  let anchor = 0;

  for (let i = 2; i < path.length; i++) {
    if (!_hasLos(mapData, path[anchor], path[i])) {
      result.push(path[i - 1]);
      anchor = i - 1;
    }
  }
  result.push(path[path.length - 1]);
  return result;
}

/**
 * Bresenham line-of-sight check: returns true if every tile along the
 * straight line from `a` to `b` (both in world-pixels) is passable.
 */
function _hasLos(mapData, a, b) {
  const atx = Math.floor(a.x / TILE_SIZE);
  const aty = Math.floor(a.y / TILE_SIZE);
  const btx = Math.floor(b.x / TILE_SIZE);
  const bty = Math.floor(b.y / TILE_SIZE);

  let x0 = atx, y0 = aty, x1 = btx, y1 = bty;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    const cost = _terrainCost(mapData.getTerrain(x0, y0));
    if (cost === IMPASSABLE) return false;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 <  dx) { err += dx; y0 += sy; }
  }
  return true;
}
