/**
 * pathfinder.worker.js – Web Worker for A* tile pathfinding.
 *
 * Offloads NPC army / missive path computation off the main thread so
 * long A* searches over the 200×200 map do not stall rendering.
 *
 * Protocol
 * --------
 * Message in (init):
 *   { type: 'init', tiles: Uint8Array }   – terrain tile buffer (MAP_WIDTH×MAP_HEIGHT)
 *
 * Message in (path request):
 *   { type: 'path', id: number, fromPx: {x,y}, toPx: {x,y} }
 *
 * Message out (path result):
 *   { id: number, path: {x,y}[]|null }
 *
 * Constants are duplicated here (no ES-module imports in a classic Worker).
 */

// ---------------------------------------------------------------------------
// Duplicated world constants
// ---------------------------------------------------------------------------

const TILE_SIZE  = 48;
const MAP_WIDTH  = 200;
const MAP_HEIGHT = 200;

// TERRAIN enum values (must match constants.js)
const T_WATER          = 0;
const T_SAND           = 1;
const T_GRASS          = 2;
const T_FOREST         = 3;
const T_MOUNTAIN       = 4;
const T_CASTLE_GROUND  = 5;
const T_VILLAGE_GROUND = 6;
const T_PORT_GROUND    = 7;
const T_HILL           = 8;

// ---------------------------------------------------------------------------
// Terrain data (received via 'init' message)
// ---------------------------------------------------------------------------

/** @type {Uint8Array|null} */
let _tiles = null;

function _getTerrain(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_WIDTH || ty >= MAP_HEIGHT) return T_WATER;
  return _tiles[ty * MAP_WIDTH + tx];
}

// ---------------------------------------------------------------------------
// Terrain cost table
// ---------------------------------------------------------------------------

const IMPASSABLE  = Infinity;
const FOREST_COST = 2.5; // 1 / FOREST_SPEED_MULT (0.4)

function _terrainCost(terrain) {
  switch (terrain) {
    case T_WATER:    return IMPASSABLE;
    case T_MOUNTAIN: return IMPASSABLE;
    case T_FOREST:   return FOREST_COST;
    default:         return 1.0;
  }
}

// ---------------------------------------------------------------------------
// Minimal binary min-heap (priority queue)
// ---------------------------------------------------------------------------

class MinHeap {
  constructor() {
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

const _key = (tx, ty) => ty * MAP_WIDTH + tx;

function _heuristic(ax, ay, bx, by) {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

// Reusable A* buffers (allocated once; safe because each worker is a single thread).
const _gCostBuf    = new Float64Array(MAP_WIDTH * MAP_HEIGHT);
const _cameFromBuf = new Int32Array(MAP_WIDTH * MAP_HEIGHT);

// ---------------------------------------------------------------------------
// Nearest-passable search
// ---------------------------------------------------------------------------

const NEAREST_PASSABLE_RADIUS = 8;

function _nearestPassable(tx, ty) {
  for (let r = 0; r <= NEAREST_PASSABLE_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
        if (_terrainCost(_getTerrain(nx, ny)) !== IMPASSABLE) return [nx, ny];
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Line-of-sight (Bresenham)
// ---------------------------------------------------------------------------

function _hasLos(ax, ay, bx, by) {
  let x0 = ax, y0 = ay, x1 = bx, y1 = by;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    if (_terrainCost(_getTerrain(x0, y0)) === IMPASSABLE) return false;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 <  dx) { err += dx; y0 += sy; }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Path simplification (LOS waypoint pruning)
// ---------------------------------------------------------------------------

function _simplify(tilePath) {
  if (tilePath.length <= 2) return tilePath;
  const result = [tilePath[0]];
  let anchor = 0;
  for (let i = 2; i < tilePath.length; i++) {
    const a = tilePath[anchor];
    const b = tilePath[i];
    if (!_hasLos(a[0], a[1], b[0], b[1])) {
      result.push(tilePath[i - 1]);
      anchor = i - 1;
    }
  }
  result.push(tilePath[tilePath.length - 1]);
  return result;
}

// ---------------------------------------------------------------------------
// Core A* search
// ---------------------------------------------------------------------------

function _buildPath(fromPx, toPx) {
  if (!_tiles) return null;

  const startTX = Math.floor(fromPx.x / TILE_SIZE);
  const startTY = Math.floor(fromPx.y / TILE_SIZE);
  const endTX   = Math.floor(toPx.x   / TILE_SIZE);
  const endTY   = Math.floor(toPx.y   / TILE_SIZE);

  const resolvedStart = _nearestPassable(startTX, startTY);
  const resolvedEnd   = _nearestPassable(endTX,   endTY);
  if (!resolvedStart || !resolvedEnd) return null;

  const [sx, sy] = resolvedStart;
  const [ex, ey] = resolvedEnd;

  if (sx === ex && sy === ey) {
    return [{ x: (sx + 0.5) * TILE_SIZE, y: (sy + 0.5) * TILE_SIZE }];
  }

  // ── A* search ─────────────────────────────────────────────────────────────
  const openSet  = new MinHeap();
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

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;

        const terrain = _getTerrain(nx, ny);
        const cost    = _terrainCost(terrain);
        if (cost === IMPASSABLE) continue;

        if (dx !== 0 && dy !== 0) {
          if (_terrainCost(_getTerrain(cx + dx, cy)) === IMPASSABLE) continue;
          if (_terrainCost(_getTerrain(cx, cy + dy)) === IMPASSABLE) continue;
        }

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

  // ── Reconstruct tile path ──────────────────────────────────────────────────
  if (cameFrom[endKey] === -1 && endKey !== startKey) return null;

  const tileKeys = [];
  let cur = endKey;
  while (cur !== -1) {
    tileKeys.push(cur);
    cur = cameFrom[cur];
  }
  tileKeys.reverse();

  const tilePath = tileKeys.map(k => [k % MAP_WIDTH, (k / MAP_WIDTH) | 0]);

  // ── Simplify ───────────────────────────────────────────────────────────────
  const simplified = _simplify(tilePath);

  return simplified.map(([tx, ty]) => ({
    x: (tx + 0.5) * TILE_SIZE,
    y: (ty + 0.5) * TILE_SIZE,
  }));
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg) return;

  if (msg.type === 'init') {
    _tiles = msg.tiles;
    return;
  }

  if (msg.type === 'path') {
    const path = _buildPath(msg.fromPx, msg.toPx);
    self.postMessage({ id: msg.id, path });
  }
};
