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
 *   { type: 'move', x: <number>, y: <number>, angle: <number> }
 *
 * The server broadcasts the current player state to all clients every
 * TICK_MS milliseconds:
 *   { type: 'state', players: { '<id>': { x, y, angle, name } }, ts: <ms>, time: <number>, weather: <number> }
 *
 * When a client disconnects the server broadcasts:
 *   { type: 'leave', id: '<id>' }
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

const PORT                = Number(process.env.PORT ?? 3000);
const TICK_MS             = 50;     // broadcast interval (20 Hz)
const RECONNECT_GRACE_MS  = 30_000; // token-based grace period after disconnect
/** Maximum length accepted for a player name. */
const MAX_NAME_LEN        = 20;

// World seed: fixed for the lifetime of this server process so every client
// that connects (or reconnects) generates the same deterministic map.
const WORLD_SEED = Math.floor(Math.random() * 0xFFFFFF);

// ---------------------------------------------------------------------------
// Authoritative world time and weather
// ---------------------------------------------------------------------------

/** Seconds for one full in-game day – must match DayNightCycle.DEFAULT_DAY_DURATION. */
const DAY_DURATION = 300;

/** In-game time fraction [0, 1). 0.27 ≈ just after dawn, matching the client default. */
let WORLD_TIME = 0.27;

/**
 * Weather state (integer index matching the client-side WEATHER constants):
 *   0 = CLEAR, 1 = CLOUDY, 2 = RAIN, 3 = STORM
 */
let WORLD_WEATHER = 0;

/**
 * Possible next weather states for each current state (mirrors WeatherSystem.js TRANSITIONS).
 * Weighted by repetition: CLEAR → mostly stays clear, etc.
 */
const WEATHER_TRANSITIONS = [
  /* CLEAR  */ [0, 0, 0, 1],
  /* CLOUDY */ [0, 1, 1, 2],
  /* RAIN   */ [1, 2, 2, 3],
  /* STORM  */ [2, 3, 3, 1],
];

const MIN_WEATHER_DURATION = 30;   // seconds before state may change
const MAX_WEATHER_DURATION = 100;  // seconds maximum state duration

/** Countdown until next weather transition (seconds). */
let _weatherTimer = MIN_WEATHER_DURATION + Math.random() * (MAX_WEATHER_DURATION - MIN_WEATHER_DURATION);

const wss = new WebSocketServer({ port: PORT });

/** @type {Map<string, { ws: import('ws').WebSocket, x: number, y: number, angle: number, name: string }>} */
const players = new Map();

/**
 * Token-based sessions kept alive during the reconnection grace period.
 * Key: sessionToken  Value: { id, name, x, y, angle, timer }
 * @type {Map<string, { id: string, name: string, x: number, y: number, angle: number, timer: ReturnType<typeof setTimeout> }>}
 */
const pendingReconnect = new Map();

/**
 * Persistent name-based identity store.
 * Key: playerName (lowercase)  Value: { id, x, y, angle }
 * Entries are never deleted – they persist for the lifetime of the server process.
 * @type {Map<string, { id: string, x: number, y: number, angle: number }>}
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
    players.set(id, { ws, x: session.x, y: session.y, angle: session.angle, name });
    // Keep the namedSession in sync with the restored position.
    if (name) namedSessions.set(name.toLowerCase(), { id, x: session.x, y: session.y, angle: session.angle });
    ws.send(JSON.stringify({ type: 'welcome', id, seed: WORLD_SEED, time: WORLD_TIME, weather: WORLD_WEATHER, sessionToken: incomingToken, name }));
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

    const sessionToken = generateToken();

    if (namedSessions.has(nameKey)) {
      // Restore existing named session (same id, last-known position).
      const prev = namedSessions.get(nameKey);
      const { id } = prev;
      players.set(id, { ws, x: prev.x, y: prev.y, angle: prev.angle, name: incomingName });
      ws.send(JSON.stringify({ type: 'welcome', id, seed: WORLD_SEED, time: WORLD_TIME, weather: WORLD_WEATHER, sessionToken, name: incomingName }));
      console.log(`[↩] Player "${incomingName}" restored named session (total: ${players.size})`);
      _attachHandlers(ws, id, sessionToken, incomingName);
    } else {
      // New named player.
      const id = generateId();
      players.set(id, { ws, x: 0, y: 0, angle: 0, name: incomingName });
      namedSessions.set(nameKey, { id, x: 0, y: 0, angle: 0 });
      ws.send(JSON.stringify({ type: 'welcome', id, seed: WORLD_SEED, time: WORLD_TIME, weather: WORLD_WEATHER, sessionToken, name: incomingName }));
      console.log(`[+] Player "${incomingName}" connected (total: ${players.size})`);
      _attachHandlers(ws, id, sessionToken, incomingName);
    }
    return;
  }

  // --- Anonymous connection (no name) ---
  const id           = generateId();
  const sessionToken = generateToken();
  players.set(id, { ws, x: 0, y: 0, angle: 0, name: '' });
  ws.send(JSON.stringify({ type: 'welcome', id, seed: WORLD_SEED, time: WORLD_TIME, weather: WORLD_WEATHER, sessionToken, name: '' }));
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
      player.x     = typeof msg.x     === 'number' ? msg.x     : player.x;
      player.y     = typeof msg.y     === 'number' ? msg.y     : player.y;
      player.angle = typeof msg.angle === 'number' ? msg.angle : player.angle;
      // Keep the persistent named session position up to date.
      if (name) {
        const ns = namedSessions.get(name.toLowerCase());
        if (ns) { ns.x = player.x; ns.y = player.y; ns.angle = player.angle; }
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
    broadcast(JSON.stringify({ type: 'leave', id }));

    // Persist latest position in namedSessions so the player can rejoin by name.
    if (name) namedSessions.set(name.toLowerCase(), { id, ...snapshot });

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

  /** @type {Record<string, { x: number, y: number, angle: number, name: string }>} */
  const snapshot = {};
  for (const [pid, data] of players) {
    snapshot[pid] = { x: data.x, y: data.y, angle: data.angle, name: data.name };
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

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

wss.on('listening', () => {
  console.log(`YourKingdom 伺服器已啟動，監聽埠口 ${PORT}  世界種子：${WORLD_SEED}`);
  console.log(`客戶端連線位址：ws://<你的IP>:${PORT}`);
});
