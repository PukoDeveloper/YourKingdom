/**
 * YourKingdom – Multiplayer WebSocket Server
 *
 * Usage:
 *   node server.js              # listens on port 3000
 *   PORT=8080 node server.js    # listens on a custom port
 *
 * Each connected client receives:
 *   { type: 'welcome', id: '<uuid-like string>' }
 *
 * Clients send:
 *   { type: 'move', x: <number>, y: <number>, angle: <number> }
 *
 * The server broadcasts the current player state to all clients every
 * TICK_MS milliseconds:
 *   { type: 'state', players: { '<id>': { x, y, angle }, … } }
 *
 * When a client disconnects the server broadcasts:
 *   { type: 'leave', id: '<id>' }
 */

import { WebSocketServer } from 'ws';

const PORT    = Number(process.env.PORT ?? 3000);
const TICK_MS = 100; // broadcast interval

const wss = new WebSocketServer({ port: PORT });

/** @type {Map<string, { ws: import('ws').WebSocket, x: number, y: number, angle: number }>} */
const players = new Map();

let _idCounter = 0;
function generateId() {
  _idCounter += 1;
  return `p${Date.now().toString(36)}${_idCounter}`;
}

// ---------------------------------------------------------------------------
// Connection handler
// ---------------------------------------------------------------------------

wss.on('connection', (ws) => {
  const id = generateId();
  players.set(id, { ws, x: 0, y: 0, angle: 0 });

  // Greet the new player with their id.
  ws.send(JSON.stringify({ type: 'welcome', id }));
  console.log(`[+] Player ${id} connected  (total: ${players.size})`);

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
    players.delete(id);
    console.log(`[-] Player ${id} disconnected (total: ${players.size})`);
    // Notify remaining clients immediately.
    broadcast(JSON.stringify({ type: 'leave', id }));
  });

  ws.on('error', (err) => {
    console.error(`[!] Error from ${id}:`, err.message);
  });
});

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

  broadcast(JSON.stringify({ type: 'state', players: snapshot }));
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
  console.log(`YourKingdom 伺服器已啟動，監聽埠口 ${PORT}`);
  console.log(`客戶端連線位址：ws://<你的IP>:${PORT}`);
});
