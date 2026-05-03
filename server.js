/**
 * YourKingdom – Multiplayer WebSocket Server
 *
 * Usage:
 *   node server.js              # listens on port 3000
 *   PORT=8080 node server.js    # listens on a custom port
 *
 * Each connected client receives one of:
 *   { type: 'welcome',    id, seed, time, weather, sessionToken, name }
 *   { type: 'name_taken', name }   (then the server closes the connection)
 *
 * Clients send:
 *   { type: 'move',      x: <number>, y: <number>, angle: <number> }
 *   { type: 'info',      appearance: <object>, kingdom: { name, color } }
 *   { type: 'territory', captured: string[], liberated: string[] }
 *   { type: 'save',      gameState: <object> }   (persists full game state for the named account)
 *
 * The server broadcasts the current player state to all clients every
 * TICK_MS milliseconds:
 *   { type: 'state', players: { '<id>': { x, y, angle, name,
 *                                                    appearance, kingdom,
 *                                                    captured, liberated } },
 *                   ts: <ms>, time: <number>, weather: <number> }
 *
 * When the server rejects a client's position (teleport / speed violation) it
 * sends a correction directly to that client:
 *   { type: 'correction', x: <number>, y: <number>, angle: <number> }
 *
 * When a player connects the server broadcasts (to existing players only):
 *   { type: 'join', id: '<id>', name: '<name>' }
 *
 * When a client disconnects the server broadcasts:
 *   { type: 'leave', id: '<id>', name: '<name>' }
 *
 * Identity:
 *   1. Token-based (fast reconnect within RECONNECT_GRACE_MS):
 *      Client appends ?token=<sessionToken> – server restores id & position.
 *   2. Name-based (persistent across sessions):
 *      Client appends ?name=<playerName> – server looks up namedSessions and
 *      restores the player's last-known position indefinitely (until the server
 *      process restarts).  If the name is already used by an active connection
 *      the server sends { type: 'name_taken', name } and closes.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes }               from 'crypto';
import { MapData }                   from './src/world/MapData.js';
import { TILE_SIZE }                 from './src/world/constants.js';

const PORT                = Number(process.env.PORT ?? 3000);
const TICK_MS             = 50;     // broadcast interval (20 Hz)
const RECONNECT_GRACE_MS  = 30_000; // token-based grace period after disconnect
/** Maximum length accepted for a player name. */
const MAX_NAME_LEN        = 20;

// World seed: fixed for the lifetime of this server process so every client
// that connects (or reconnects) generates the same deterministic map.
const WORLD_SEED = Math.floor(Math.random() * 0xFFFFFF);

// ---------------------------------------------------------------------------
// Server-authoritative world geometry (for validation)
// ---------------------------------------------------------------------------

/**
 * Deterministic world map generated from WORLD_SEED.
 * The server uses settlement positions to validate territory claims.
 * @type {import('./src/world/MapData.js').MapData}
 */
const _worldData = new MapData(WORLD_SEED);

// ---------------------------------------------------------------------------
// Movement and territory validation constants
// ---------------------------------------------------------------------------

/**
 * Maximum player speed in world-pixels per second used for anti-cheat.
 * Set slightly above the client's maximum (200 px/s × 1.25 road boost = 250 px/s)
 * to tolerate minor floating-point differences.
 */
const MAX_PLAYER_SPEED_PX_S = 260;

/**
 * Extra milliseconds added to the elapsed-time window when checking movement
 * distance.  Absorbs network jitter and server-processing delay without
 * requiring precise clock synchronisation between client and server.
 */
const MOVE_JITTER_MS = 300;

/**
 * Maximum world-pixel distance from a settlement's centre that a player must
 * be within before the server accepts a new territory claim for that settlement.
 * Covers the full extent of a castle (4×4 tiles = 192 px) plus one extra tile.
 */
const TERRITORY_CAPTURE_RADIUS_PX = 5 * TILE_SIZE;

// ---------------------------------------------------------------------------
// Authoritative world time and weather
// ---------------------------------------------------------------------------

/** Seconds for one full in-game day – must match DEFAULT_DAY_DURATION in src/world/DayNightCycle.js. */
const DAY_DURATION = 300;

/**
 * Starting in-game time fraction [0, 1) – just after dawn, matching the
 * DayNightCycle client default (0.27 ≈ 06:29 in-game).
 */
const DEFAULT_WORLD_TIME = 0.27;

/** In-game time fraction [0, 1). Authoritative value broadcast to all clients. */
let WORLD_TIME = DEFAULT_WORLD_TIME;

// Weather state constants – must match the WEATHER object in src/world/WeatherSystem.js.
const WEATHER_CLEAR  = 0;
const WEATHER_CLOUDY = 1;
const WEATHER_RAIN   = 2;
const WEATHER_STORM  = 3;

/** Authoritative weather state index broadcast to all clients. */
let WORLD_WEATHER = WEATHER_CLEAR;

/**
 * Possible next weather states for each current state.
 * Mirrors the TRANSITIONS table in src/world/WeatherSystem.js exactly so that
 * server-side transitions produce the same distribution as the client would
 * (weighted by repetition: CLEAR → mostly stays clear, etc.).
 */
const WEATHER_TRANSITIONS = [
  /* CLEAR  */ [WEATHER_CLEAR,  WEATHER_CLEAR,  WEATHER_CLEAR,  WEATHER_CLOUDY],
  /* CLOUDY */ [WEATHER_CLEAR,  WEATHER_CLOUDY, WEATHER_CLOUDY, WEATHER_RAIN  ],
  /* RAIN   */ [WEATHER_CLOUDY, WEATHER_RAIN,   WEATHER_RAIN,   WEATHER_STORM ],
  /* STORM  */ [WEATHER_RAIN,   WEATHER_STORM,  WEATHER_STORM,  WEATHER_CLOUDY],
];

const MIN_WEATHER_DURATION = 30;   // seconds before state may change
const MAX_WEATHER_DURATION = 100;  // seconds maximum state duration

/** Countdown until next weather transition (seconds). */
let _weatherTimer = MIN_WEATHER_DURATION + Math.random() * (MAX_WEATHER_DURATION - MIN_WEATHER_DURATION);

const wss = new WebSocketServer({ port: PORT });

/**
 * @type {Map<string, {
 *   ws: import('ws').WebSocket,
 *   x: number, y: number, angle: number,
 *   name: string,
 *   hasPosition: boolean,
 *   lastMoveMs: number,
 *   appearance: object|null,
 *   kingdom: { name: string, color: string }|null,
 *   captured: string[],
 *   liberated: string[],
 * }>}
 * hasPosition: false until the client sends its first 'move' message, so we
 * don't broadcast the placeholder (0,0) position to other players.
 * lastMoveMs: server timestamp (ms) of the last accepted 'move' message, used
 * for movement-speed validation.
 */
const players = new Map();

/**
 * Token-based sessions kept alive during the reconnection grace period.
 * Key: sessionToken  Value: { id, name, x, y, angle, timer }
 * @type {Map<string, { id: string, name: string, x: number, y: number, angle: number, timer: ReturnType<typeof setTimeout> }>}
 */
const pendingReconnect = new Map();

/**
 * Persistent name-based identity store.
 * Key: playerName (lowercase)  Value: { id, x, y, angle, gameState }
 * Entries are never deleted – they persist for the lifetime of the server process.
 * gameState holds the full serialised game snapshot uploaded by the client via a
 * 'save' message, or null when no save has been received yet.
 * @type {Map<string, { id: string, x: number, y: number, angle: number, gameState: object|null }>}
 */
const namedSessions = new Map();

let _idCounter = 0;
function generateId() {
  _idCounter += 1;
  return `p${Date.now().toString(36)}${_idCounter}`;
}

function generateToken() {
  return randomBytes(24).toString('hex');
}

/** Sanitise a player name: trim, limit length, strip control chars. */
function sanitiseName(raw) {
  return String(raw).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, MAX_NAME_LEN);
}

// ---------------------------------------------------------------------------
// Connection handler
// ---------------------------------------------------------------------------

wss.on('connection', (ws, req) => {
  const qs            = new URLSearchParams(req.url.split('?')[1] ?? '');
  const incomingToken = qs.get('token') ?? null;
  const incomingName  = qs.has('name') ? sanitiseName(qs.get('name')) : '';

  // --- Token-based reconnect (highest priority: within grace period) ---
  if (incomingToken && pendingReconnect.has(incomingToken)) {
    const session = pendingReconnect.get(incomingToken);
    clearTimeout(session.timer);
    pendingReconnect.delete(incomingToken);

    const { id, name } = session;
    // hasPosition: true – the server already has a valid last-known position.
    players.set(id, { ws, x: session.x, y: session.y, angle: session.angle, name, hasPosition: true, lastMoveMs: Date.now(), appearance: null, kingdom: null, captured: [], liberated: [] });
    // Keep the namedSession in sync with the restored position; preserve existing gameState.
    const existingNs = name ? namedSessions.get(name.toLowerCase()) : null;
    if (name) namedSessions.set(name.toLowerCase(), { id, x: session.x, y: session.y, angle: session.angle, gameState: existingNs?.gameState ?? null });
    const tokenGameState = existingNs?.gameState ?? null;
    ws.send(JSON.stringify({ type: 'welcome', id, seed: WORLD_SEED, time: WORLD_TIME, weather: WORLD_WEATHER, sessionToken: incomingToken, name, gameState: tokenGameState }));
    broadcastExcept(id, JSON.stringify({ type: 'join', id, name }));
    console.log(`[~] Player "${name || id}" reconnected via token (total: ${players.size})`);
    _attachHandlers(ws, id, incomingToken, name);
    return;
  }

  // --- Name-based reconnect / new named connection ---
  if (incomingName) {
    const nameKey = incomingName.toLowerCase();

    // Reject if this name is already held by an active (connected) player.
    const activeEntry = [...players.values()].find(p => p.name.toLowerCase() === nameKey);
    if (activeEntry) {
      ws.send(JSON.stringify({ type: 'name_taken', name: incomingName }));
      ws.close();
      console.log(`[!] Name "${incomingName}" is already taken – rejected new connection`);
      return;
    }

    // If a pendingReconnect session exists for this name, cancel it so the old
    // token can no longer be used to steal back the identity after the new player
    // has taken it.  This prevents a race where both the old token and the new
    // name-based connection resolve to the same player id simultaneously.
    for (const [token, session] of pendingReconnect) {
      if (session.name && session.name.toLowerCase() === nameKey) {
        clearTimeout(session.timer);
        pendingReconnect.delete(token);
        console.log(`[~] Cancelled pending token for "${incomingName}" (name-based reconnect)`);
        break;
      }
    }

    const sessionToken = generateToken();

    if (namedSessions.has(nameKey)) {
      // Restore existing named session (same id, last-known position, and saved game state).
      const prev = namedSessions.get(nameKey);
      const { id } = prev;
      // hasPosition: true – we have the last-known position from namedSessions.
      players.set(id, { ws, x: prev.x, y: prev.y, angle: prev.angle, name: incomingName, hasPosition: true, lastMoveMs: Date.now(), appearance: null, kingdom: null, captured: [], liberated: [] });
      ws.send(JSON.stringify({ type: 'welcome', id, seed: WORLD_SEED, time: WORLD_TIME, weather: WORLD_WEATHER, sessionToken, name: incomingName, gameState: prev.gameState ?? null }));
      broadcastExcept(id, JSON.stringify({ type: 'join', id, name: incomingName }));
      console.log(`[↩] Player "${incomingName}" restored named session (total: ${players.size})`);
      _attachHandlers(ws, id, sessionToken, incomingName);
    } else {
      // New named player – position unknown until client sends its first 'move'.
      const id = generateId();
      players.set(id, { ws, x: 0, y: 0, angle: 0, name: incomingName, hasPosition: false, lastMoveMs: Date.now(), appearance: null, kingdom: null, captured: [], liberated: [] });
      namedSessions.set(nameKey, { id, x: 0, y: 0, angle: 0, gameState: null });
      ws.send(JSON.stringify({ type: 'welcome', id, seed: WORLD_SEED, time: WORLD_TIME, weather: WORLD_WEATHER, sessionToken, name: incomingName, gameState: null }));
      broadcastExcept(id, JSON.stringify({ type: 'join', id, name: incomingName }));
      console.log(`[+] Player "${incomingName}" connected (total: ${players.size})`);
      _attachHandlers(ws, id, sessionToken, incomingName);
    }
    return;
  }

  // --- Anonymous connection (no name) ---
  const id           = generateId();
  const sessionToken = generateToken();
  // hasPosition: false until the client sends its first 'move'.
  players.set(id, { ws, x: 0, y: 0, angle: 0, name: '', hasPosition: false, lastMoveMs: Date.now(), appearance: null, kingdom: null, captured: [], liberated: [] });
  ws.send(JSON.stringify({ type: 'welcome', id, seed: WORLD_SEED, time: WORLD_TIME, weather: WORLD_WEATHER, sessionToken, name: '' }));
  broadcastExcept(id, JSON.stringify({ type: 'join', id, name: '' }));
  console.log(`[+] Anonymous player ${id} connected (total: ${players.size})`);
  _attachHandlers(ws, id, sessionToken, '');
});

/**
 * Attach message / close / error event handlers to a WebSocket for player `id`.
 * @param {import('ws').WebSocket} ws
 * @param {string} id
 * @param {string} sessionToken
 * @param {string} name
 */
function _attachHandlers(ws, id, sessionToken, name) {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'move') {
      const player = players.get(id);
      if (!player) return;

      const newX     = typeof msg.x     === 'number' ? msg.x     : player.x;
      const newY     = typeof msg.y     === 'number' ? msg.y     : player.y;
      const newAngle = typeof msg.angle === 'number' ? msg.angle : player.angle;

      // Server-authoritative movement validation.
      // Skip speed check on the very first move (hasPosition is false and the
      // player is teleporting from the spawn origin to wherever they actually are).
      if (player.hasPosition) {
        const now       = Date.now();
        const elapsedMs = now - player.lastMoveMs;
        const maxDist   = MAX_PLAYER_SPEED_PX_S * ((elapsedMs + MOVE_JITTER_MS) / 1000);
        const dx        = newX - player.x;
        const dy        = newY - player.y;
        const dist      = Math.sqrt(dx * dx + dy * dy);

        if (dist > maxDist) {
          // Movement exceeds what is physically possible: clamp to the maximum
          // reachable position along the same direction and notify the client so
          // it can snap its local sprite to the corrected position.
          const ratio = maxDist / dist;
          player.x     = player.x + dx * ratio;
          player.y     = player.y + dy * ratio;
          player.angle = newAngle;
          player.lastMoveMs = now;
          ws.send(JSON.stringify({ type: 'correction', x: player.x, y: player.y, angle: player.angle }));
          console.log(`[⚠] Speed violation from "${name || id}" (dist=${dist.toFixed(0)} max=${maxDist.toFixed(0)}) – corrected`);
        } else {
          player.x     = newX;
          player.y     = newY;
          player.angle = newAngle;
          player.lastMoveMs = now;
        }
      } else {
        // First move: accept unconditionally and initialise the timer.
        player.x          = newX;
        player.y          = newY;
        player.angle      = newAngle;
        player.hasPosition = true;
        player.lastMoveMs  = Date.now();
      }

      // Keep the persistent named session position up to date.
      if (name) {
        const ns = namedSessions.get(name.toLowerCase());
        if (ns) { ns.x = player.x; ns.y = player.y; ns.angle = player.angle; }
      }
    }

    if (msg.type === 'info') {
      const player = players.get(id);
      if (!player) return;
      // Sanitise: only accept well-typed fields; ignore anything unexpected.
      if (msg.appearance && typeof msg.appearance === 'object') {
        player.appearance = msg.appearance;
      }
      if (msg.kingdom && typeof msg.kingdom === 'object') {
        // Only store name (string) and color (CSS string) – the minimum needed by peers.
        const kName  = typeof msg.kingdom.name  === 'string' ? msg.kingdom.name.slice(0, 40)  : '';
        const kColor = typeof msg.kingdom.color === 'string' ? msg.kingdom.color.slice(0, 12) : '#64b5f6';
        player.kingdom = { name: kName, color: kColor };
      }
    }

    if (msg.type === 'territory') {
      const player = players.get(id);
      if (!player) return;

      const isValidKey = k => typeof k === 'string' && /^(castle|village):\d+$/.test(k);

      if (Array.isArray(msg.captured)) {
        const oldCapturedSet = new Set(player.captured ?? []);
        // Re-validate every key in the incoming list:
        //   • Keys the player already held are preserved without a proximity check
        //     (they could be far from those settlements after capturing them earlier).
        //   • Newly added keys are accepted only when the player is currently
        //     within TERRITORY_CAPTURE_RADIUS_PX of the settlement centre.
        player.captured = msg.captured
          .filter(k => isValidKey(k) && (oldCapturedSet.has(k) || _isNearSettlement(player, k)))
          .slice(0, 200);
      }
      if (Array.isArray(msg.liberated)) {
        // Liberation (neutralising a settlement) is accepted without a proximity
        // check; there is no incentive to fake-liberate one's own territory.
        player.liberated = msg.liberated
          .filter(isValidKey)
          .slice(0, 200);
      }
    }


    if (msg.type === 'save' && name) {
      // Accept gameState: <object> to persist, or gameState: null to clear the saved state.
      const isValidSave = msg.gameState !== undefined &&
        (msg.gameState === null || typeof msg.gameState === 'object');
      if (isValidSave) {
        const ns = namedSessions.get(name.toLowerCase());
        if (ns) {
          ns.gameState = msg.gameState;
          if (msg.gameState) {
            console.log(`[💾] Saved game state for "${name}"`);
          } else {
            console.log(`[🗑] Cleared game state for "${name}"`);
          }
        }
      }
    }
  });

  ws.on('close', () => {
    const player   = players.get(id);
    const snapshot = player
      ? { x: player.x, y: player.y, angle: player.angle }
      : { x: 0, y: 0, angle: 0 };
    players.delete(id);
    console.log(`[-] Player "${name || id}" disconnected (total: ${players.size})`);
    broadcast(JSON.stringify({ type: 'leave', id, name }));

    // Persist latest position in namedSessions so the player can rejoin by name.
    // Preserve the existing gameState so it survives the disconnect.
    if (name) {
      const prevNs = namedSessions.get(name.toLowerCase());
      namedSessions.set(name.toLowerCase(), { id, ...snapshot, gameState: prevNs?.gameState ?? null });
    }

    // Also keep the short-lived token-based session for fast reconnect.
    const timer = setTimeout(() => {
      pendingReconnect.delete(sessionToken);
      console.log(`[x] Token session for "${name || id}" expired`);
    }, RECONNECT_GRACE_MS);
    pendingReconnect.set(sessionToken, { id, name, ...snapshot, timer });
  });

  ws.on('error', (err) => {
    console.error(`[!] Error from "${name || id}":`, err.message);
  });
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Return the world-pixel centre of a settlement identified by its key,
 * or null if the key is invalid or out-of-bounds.
 * @param {string} key  e.g. 'castle:0' or 'village:3'
 * @returns {{ cx: number, cy: number }|null}
 */
function _settlementCenter(key) {
  const colonIdx = key.indexOf(':');
  if (colonIdx < 0) return null;
  const type = key.slice(0, colonIdx);
  const idx  = parseInt(key.slice(colonIdx + 1), 10);
  if (isNaN(idx)) return null;

  if (type === 'castle') {
    const c = _worldData.castles[idx];
    if (!c) return null;
    // Castle occupies a 4×4 tile block; world-pixel centre is at anchor+2 tiles.
    return { cx: (c.x + 2) * TILE_SIZE, cy: (c.y + 2) * TILE_SIZE };
  }
  if (type === 'village') {
    const v = _worldData.villages[idx];
    if (!v) return null;
    // Village occupies a 2×2 tile block; world-pixel centre is at anchor+1 tile.
    return { cx: (v.x + 1) * TILE_SIZE, cy: (v.y + 1) * TILE_SIZE };
  }
  return null;
}

/**
 * Returns true when the player's current server-side position is within
 * TERRITORY_CAPTURE_RADIUS_PX of the settlement identified by `key`.
 * @param {{ x: number, y: number }} player
 * @param {string} key
 * @returns {boolean}
 */
function _isNearSettlement(player, key) {
  const center = _settlementCenter(key);
  if (!center) return false;
  const dx = player.x - center.cx;
  const dy = player.y - center.cy;
  return Math.sqrt(dx * dx + dy * dy) <= TERRITORY_CAPTURE_RADIUS_PX;
}

// ---------------------------------------------------------------------------
// Broadcast tick
// ---------------------------------------------------------------------------

setInterval(() => {
  // Advance authoritative world time (always, even with no players connected).
  WORLD_TIME = (WORLD_TIME + (TICK_MS / 1000) / DAY_DURATION) % 1;

  // Advance authoritative weather timer and transition when due.
  _weatherTimer -= TICK_MS / 1000;
  if (_weatherTimer <= 0) {
    const opts    = WEATHER_TRANSITIONS[WORLD_WEATHER];
    WORLD_WEATHER = opts[Math.floor(Math.random() * opts.length)];
    _weatherTimer = MIN_WEATHER_DURATION + Math.random() * (MAX_WEATHER_DURATION - MIN_WEATHER_DURATION);
  }

  if (players.size === 0) return;

  /** @type {Record<string, { x: number, y: number, angle: number, name: string, appearance: object|null, kingdom: object|null, captured: string[], liberated: string[] }>} */
  const snapshot = {};
  for (const [pid, data] of players) {
    // Omit players whose position isn't known yet (no 'move' received).
    if (!data.hasPosition) continue;
    snapshot[pid] = {
      x: data.x, y: data.y, angle: data.angle, name: data.name,
      appearance: data.appearance ?? null,
      kingdom:    data.kingdom    ?? null,
      captured:   data.captured  ?? [],
      liberated:  data.liberated ?? [],
    };
  }

  broadcast(JSON.stringify({ type: 'state', players: snapshot, ts: Date.now(), time: WORLD_TIME, weather: WORLD_WEATHER }));
}, TICK_MS);

function broadcast(payload) {
  for (const { ws } of players.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

/**
 * Send `payload` to every connected player except the one with id `excludeId`.
 * Used for join/leave notifications so the subject doesn't receive their own event.
 * @param {string} excludeId
 * @param {string} payload
 */
function broadcastExcept(excludeId, payload) {
  for (const [pid, { ws }] of players) {
    if (pid !== excludeId && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

wss.on('listening', () => {
  console.log(`YourKingdom 伺服器已啟動，監聽埠口 ${PORT}  世界種子：${WORLD_SEED}`);
  console.log(`客戶端連線位址：ws://<你的IP>:${PORT}`);
});
