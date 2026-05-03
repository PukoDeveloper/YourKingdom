/**
 * YourKingdom – Multiplayer WebSocket Server
 *
 * Usage:
 *   node server.js              # listens on port 3000
 *   PORT=8080 node server.js    # listens on a custom port
 *
 * Each connected client receives:
 *   { type: 'welcome', id: string, seed: number, sessionToken: string }
 *
 * Clients send:
 *   { type: 'move', x: <number>, y: <number>, angle: <number> }
 *
 * The server broadcasts the current player state to all clients every
 * TICK_MS milliseconds:
 *   { type: 'state', players: { '<id>': { x, y, angle } }, ts: <ms> }
 *
 * When a client disconnects the server broadcasts:
 *   { type: 'leave', id: '<id>' }
 *
 * Reconnection:
 *   Clients that possess a sessionToken (stored in localStorage) append it
 *   as ?token=<sessionToken> when opening the WebSocket URL.  The server
 *   looks up the token in its pendingReconnect registry; if found within
 *   RECONNECT_GRACE_MS the player's previous id and position are restored.
 */

import { WebSocketServer } from 'ws';
import { randomBytes }    from 'crypto';

const PORT                = Number(process.env.PORT ?? 3000);
const TICK_MS             = 50;   // broadcast interval (20 Hz)
const RECONNECT_GRACE_MS  = 30_000; // session kept alive after disconnect

// World seed: fixed for the lifetime of this server process so every client
// that connects (or reconnects) generates the same deterministic map.
const WORLD_SEED = Math.floor(Math.random() * 0xFFFFFF);

const wss = new WebSocketServer({ port: PORT });

/** @type {Map<string, { ws: import('ws').WebSocket, x: number, y: number, angle: number }>} */
const players = new Map();

/**
 * Sessions kept alive during the reconnection grace period.
 * Key: sessionToken  Value: { id, x, y, angle, timer }
 * @type {Map<string, { id: string, x: number, y: number, angle: number, timer: ReturnType<typeof setTimeout> }>}
 */
const pendingReconnect = new Map();

let _idCounter = 0;
function generateId() {
  _idCounter += 1;
  return `p${Date.now().toString(36)}${_idCounter}`;
}

function generateToken() {
  return randomBytes(24).toString('hex');
}

// ---------------------------------------------------------------------------
// Connection handler
// ---------------------------------------------------------------------------

wss.on('connection', (ws, req) => {
  // Parse optional session token from the WebSocket URL query string.
  // req.url is a relative path such as "/?token=xxx"; splitting on "?" avoids
  // the need for a synthetic base URL and works regardless of hostname.
  const incomingToken = new URLSearchParams(req.url.split('?')[1] ?? '').get('token') ?? null;

  // --- Reconnection path ---
  if (incomingToken && pendingReconnect.has(incomingToken)) {
    const session = pendingReconnect.get(incomingToken);
    clearTimeout(session.timer);
    pendingReconnect.delete(incomingToken);

    const id = session.id;
    players.set(id, { ws, x: session.x, y: session.y, angle: session.angle });
    ws.send(JSON.stringify({ type: 'welcome', id, seed: WORLD_SEED, sessionToken: incomingToken }));
    console.log(`[~] Player ${id} reconnected (total: ${players.size})`);
    _attachHandlers(ws, id, incomingToken);
    return;
  }

  // --- New connection path ---
  const id           = generateId();
  const sessionToken = generateToken();
  players.set(id, { ws, x: 0, y: 0, angle: 0 });
  ws.send(JSON.stringify({ type: 'welcome', id, seed: WORLD_SEED, sessionToken }));
  console.log(`[+] Player ${id} connected  (total: ${players.size})`);
  _attachHandlers(ws, id, sessionToken);
});

/**
 * Attach message / close / error event handlers to a WebSocket for player `id`.
 * @param {import('ws').WebSocket} ws
 * @param {string} id
 * @param {string} sessionToken
 */
function _attachHandlers(ws, id, sessionToken) {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'move') {
      const player = players.get(id);
      if (!player) return;
      player.x     = typeof msg.x     === 'number' ? msg.x     : player.x;
      player.y     = typeof msg.y     === 'number' ? msg.y     : player.y;
      player.angle = typeof msg.angle === 'number' ? msg.angle : player.angle;
    }
  });

  ws.on('close', () => {
    const player   = players.get(id);
    const snapshot = player
      ? { x: player.x, y: player.y, angle: player.angle }
      : { x: 0, y: 0, angle: 0 };
    players.delete(id);
    console.log(`[-] Player ${id} disconnected (total: ${players.size})`);
    // Notify remaining clients immediately.
    broadcast(JSON.stringify({ type: 'leave', id }));

    // Keep the session alive so the player can rejoin within the grace period.
    const timer = setTimeout(() => {
      pendingReconnect.delete(sessionToken);
      console.log(`[x] Session for player ${id} expired`);
    }, RECONNECT_GRACE_MS);
    pendingReconnect.set(sessionToken, { id, ...snapshot, timer });
  });

  ws.on('error', (err) => {
    console.error(`[!] Error from ${id}:`, err.message);
  });
}

// ---------------------------------------------------------------------------
// Broadcast tick
// ---------------------------------------------------------------------------

setInterval(() => {
  if (players.size === 0) return;

  /** @type {Record<string, { x: number, y: number, angle: number }>} */
  const snapshot = {};
  for (const [pid, data] of players) {
    snapshot[pid] = { x: data.x, y: data.y, angle: data.angle };
  }

  broadcast(JSON.stringify({ type: 'state', players: snapshot, ts: Date.now() }));
}, TICK_MS);

function broadcast(payload) {
  for (const { ws } of players.values()) {
    if (ws.readyState === ws.OPEN) {
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
