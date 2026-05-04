/**
 * YourKingdom – Multiplayer WebSocket Server
 *
 * Usage:
 *   node server.js              # listens on port 3000
 *   PORT=8080 node server.js    # listens on a custom port
 *
 * ──────────────────────────── Server → Client ─────────────────────────────
 *   { type: 'welcome',    id, seed, time, weather, name, gameState,
 *                         worldState: { settlements: object, version: number } }
 *   { type: 'name_taken',   name }          (then the server closes the connection)
 *   { type: 'name_required' }               (then the server closes the connection)
 *   { type: 'state',      players: {...}, ts, time, weather }
 *   { type: 'worldDelta', settlements: { [key]: {ownerName,controllingNationId,ownerColor}|null },
 *                         version: number }
 *   { type: 'correction', x, y, angle }
 *   { type: 'join',       id, name }
 *   { type: 'leave',      id, name }
 *   { type: 'action_ok',  kind, ...data }   (action accepted by server)
 *   { type: 'action_reject', kind, reason } (action rejected by server)
 *
 * ──────────────────────────── Client → Server ─────────────────────────────
 *   { type: 'move',      x, y, angle }
 *   { type: 'info',      appearance: object, kingdom: { name, color } }
 *   { type: 'territory', captured: string[], liberated: string[] }
 *   { type: 'save',      gameState: object|null }
 *   { type: 'action',    kind: string, ...payload }
 *       Supported kinds (validated server-side):
 *         'capture'  – { key: 'castle:N'|'village:N' }
 *         'liberate' – { key: 'castle:N'|'village:N' }
 *       Future kinds (accepted and queued; full validation added incrementally):
 *         'buy', 'sell', 'recruit', 'declare_war', 'peace', 'trade',
 *         'build_road', 'build_map_building', 'constr_building', …
 *
 * ────────────────── Server-Authoritative Architecture ─────────────────────
 *   Shared world state (sharedWorld):
 *     • settlement control map  – who owns each settlement (all players share one world)
 *     • version counter         – monotonically increasing; clients use it for change detection
 *     On connect   : server restores prior captures/liberations from gameState into sharedWorld.
 *     On territory : server validates proximity + conflict; updates sharedWorld; broadcasts worldDelta.
 *     On action    : server validates the action against authoritative state; applies; broadcasts.
 *
 *   Per-player state (namedSessions.gameState):
 *     Full snapshot including inventory, army, character, kingdom, diplomacy deltas.
 *     Persisted via the 'save' message.  Sent back on reconnect in the 'welcome' message.
 *
 * Identity:
 *   Player name is the sole unique identifier.  The client appends
 *   ?name=<playerName>; the server uses the lowercase name as the player's id.
 *   Duplicate names are rejected with { type: 'name_taken', name }.
 *   Anonymous connections receive { type: 'name_required' } and are closed.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { MapData }                   from './src/world/MapData.js';
import { TILE_SIZE }                 from './src/world/constants.js';

const PORT                = Number(process.env.PORT ?? 3000);
const TICK_MS             = 50;     // broadcast interval (20 Hz)
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
 * Active players keyed by their (canonical) player name.
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
 * Shared world state – the single authoritative source of truth for everything
 * that is visible to all connected players.
 *
 * sharedWorld.settlements is a Map keyed by settlement key ('castle:N' / 'village:N').
 * Only non-default entries are stored (NPC-controlled settlements in their original
 * nation are the default and therefore absent from the map):
 *   { ownerName: string, controllingNationId: -1, ownerColor: string }
 *     – settlement is owned by the named player
 *   { ownerName: null, controllingNationId: -2, ownerColor: null }
 *     – settlement was liberated (neutral)
 *
 * sharedWorld.version increments on every change; clients use it to detect
 * and apply deltas efficiently.
 */
const sharedWorld = {
  /** @type {Map<string, { ownerName: string|null, controllingNationId: number, ownerColor: string|null }>} */
  settlements: new Map(),
  version: 0,
};

/** Serialize sharedWorld.settlements to a plain object for JSON broadcast. */
function _worldSnapshot() {
  const out = {};
  for (const [k, v] of sharedWorld.settlements) out[k] = v;
  return out;
}

/**
 * Increment the world version and broadcast a settlement-control delta to all clients.
 * @param {string[]} changedKeys  Settlement keys whose control state changed.
 */
function broadcastWorldDelta(changedKeys) {
  if (changedKeys.length === 0) return;
  sharedWorld.version += 1;
  const delta = {};
  for (const k of changedKeys) {
    // null = returned to default NPC control (key removed from map)
    delta[k] = sharedWorld.settlements.has(k) ? sharedWorld.settlements.get(k) : null;
  }
  broadcast(JSON.stringify({ type: 'worldDelta', settlements: delta, version: sharedWorld.version }));
}

/** Validate settlement key format. */
const _isValidSettlementKey = k => typeof k === 'string' && /^(castle|village):\d+$/.test(k);

/**
 * Persistent name-based identity store.
 * Key: playerName (lowercase)  Value: { x, y, angle, gameState }
 * Entries are never deleted – they persist for the lifetime of the server process.
 * gameState holds the full serialised game snapshot uploaded by the client via a
 * 'save' message, or null when no save has been received yet.
 * @type {Map<string, { x: number, y: number, angle: number, gameState: object|null }>}
 */
const namedSessions = new Map();

/** Sanitise a player name: trim, limit length, strip control chars. */
function sanitiseName(raw) {
  return String(raw).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, MAX_NAME_LEN);
}

// ---------------------------------------------------------------------------
// Connection handler
// ---------------------------------------------------------------------------

wss.on('connection', (ws, req) => {
  const qs           = new URLSearchParams(req.url.split('?')[1] ?? '');
  const incomingName = qs.has('name') ? sanitiseName(qs.get('name')) : '';

  // --- Reject connections without a player name ---
  if (!incomingName) {
    ws.send(JSON.stringify({ type: 'name_required' }));
    ws.close();
    console.log(`[!] Anonymous connection rejected – name required`);
    return;
  }

  const nameKey = incomingName.toLowerCase();

  // --- Reject if this name is already held by an active (connected) player ---
  if (players.has(nameKey)) {
    ws.send(JSON.stringify({ type: 'name_taken', name: incomingName }));
    ws.close();
    console.log(`[!] Name "${incomingName}" is already taken – rejected new connection`);
    return;
  }

  // The player's lowercase name is their unique id.
  const id = nameKey;

  if (namedSessions.has(nameKey)) {
    // Restore existing named session (last-known position, and saved game state).
    const prev = namedSessions.get(nameKey);
    // hasPosition: true – we have the last-known position from namedSessions.
    players.set(id, { ws, x: prev.x, y: prev.y, angle: prev.angle, name: incomingName, hasPosition: true, lastMoveMs: Date.now(), appearance: null, kingdom: null, captured: [], liberated: [] });

    // ── Restore this player's territory into sharedWorld ──────────────────
    // Any settlement they previously owned or liberated is restored into the
    // canonical world state, provided no other player has since claimed it.
    const savedGs = prev.gameState;
    const restoredChanged = [];
    if (savedGs) {
      if (Array.isArray(savedGs.capturedSettlements)) {
        for (const k of savedGs.capturedSettlements) {
          if (!_isValidSettlementKey(k)) continue;
          const existing = sharedWorld.settlements.get(k);
          // Restore only if unclaimed or was previously ours.
          if (!existing || existing.ownerName === nameKey) {
            if (!existing) restoredChanged.push(k);
            const ownerColor = typeof savedGs.playerKingdom?.color === 'string' ? savedGs.playerKingdom.color : '#64b5f6';
            sharedWorld.settlements.set(k, { ownerName: nameKey, controllingNationId: -1, ownerColor });
          }
        }
      }
      if (Array.isArray(savedGs.liberatedSettlements)) {
        for (const k of savedGs.liberatedSettlements) {
          if (!_isValidSettlementKey(k)) continue;
          // Only mark neutral if no player currently owns it.
          if (!sharedWorld.settlements.has(k)) {
            sharedWorld.settlements.set(k, { ownerName: null, controllingNationId: -2, ownerColor: null });
            restoredChanged.push(k);
          }
        }
      }
    }
    if (restoredChanged.length) broadcastWorldDelta(restoredChanged);

    ws.send(JSON.stringify({ type: 'welcome', id, seed: WORLD_SEED, time: WORLD_TIME, weather: WORLD_WEATHER, name: incomingName, gameState: prev.gameState ?? null, worldState: { settlements: _worldSnapshot(), version: sharedWorld.version } }));
    broadcastExcept(id, JSON.stringify({ type: 'join', id, name: incomingName }));
    console.log(`[↩] Player "${incomingName}" restored named session (total: ${players.size})`);
  } else {
    // New named player – position unknown until client sends its first 'move'.
    players.set(id, { ws, x: 0, y: 0, angle: 0, name: incomingName, hasPosition: false, lastMoveMs: Date.now(), appearance: null, kingdom: null, captured: [], liberated: [] });
    namedSessions.set(nameKey, { x: 0, y: 0, angle: 0, gameState: null });
    ws.send(JSON.stringify({ type: 'welcome', id, seed: WORLD_SEED, time: WORLD_TIME, weather: WORLD_WEATHER, name: incomingName, gameState: null, worldState: { settlements: _worldSnapshot(), version: sharedWorld.version } }));
    broadcastExcept(id, JSON.stringify({ type: 'join', id, name: incomingName }));
    console.log(`[+] Player "${incomingName}" connected (total: ${players.size})`);
  }
  _attachHandlers(ws, id, incomingName);
});

/**
 * Attach message / close / error event handlers to a WebSocket for player `name`.
 * The player's lowercase name serves as their unique id in the `players` map.
 * @param {import('ws').WebSocket} ws
 * @param {string} id    Lowercase player name used as the map key.
 * @param {string} name  Canonical player name (display / broadcast).
 */
function _attachHandlers(ws, id, name) {
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
      const ns = namedSessions.get(name.toLowerCase());
      if (ns) { ns.x = player.x; ns.y = player.y; ns.angle = player.angle; }
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

      const isValidKey = _isValidSettlementKey;

      if (Array.isArray(msg.captured)) {
        const oldCapturedSet = new Set(player.captured ?? []);
        const newCaptures    = [];

        player.captured = msg.captured
          .filter(k => {
            if (!isValidKey(k)) return false;
            if (oldCapturedSet.has(k)) return true; // player already held this – keep without re-check

            // New capture: require proximity and that no other player owns it.
            if (!_isNearSettlement(player, k)) return false;
            const existing = sharedWorld.settlements.get(k);
            if (existing?.ownerName && existing.ownerName !== id) return false; // owned by someone else
            newCaptures.push(k);
            return true;
          })
          .slice(0, 200);

        if (newCaptures.length) {
          const ownerColor = typeof player.kingdom?.color === 'string' ? player.kingdom.color : '#64b5f6';
          for (const k of newCaptures) {
            sharedWorld.settlements.set(k, { ownerName: id, controllingNationId: -1, ownerColor });
          }
          broadcastWorldDelta(newCaptures);
        }
      }

      if (Array.isArray(msg.liberated)) {
        const oldLiberatedSet = new Set(player.liberated ?? []);
        const newlyLiberated  = [];

        player.liberated = msg.liberated
          .filter(isValidKey)
          .slice(0, 200);

        for (const k of player.liberated) {
          if (!oldLiberatedSet.has(k)) newlyLiberated.push(k);
        }

        // Remove liberated settlements from this player's captured list.
        const liberatedSet  = new Set(player.liberated);
        player.captured = (player.captured ?? []).filter(k => !liberatedSet.has(k));

        if (newlyLiberated.length) {
          for (const k of newlyLiberated) {
            sharedWorld.settlements.set(k, { ownerName: null, controllingNationId: -2, ownerColor: null });
          }
          broadcastWorldDelta(newlyLiberated);
        }
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
            // Clear this player's territory from sharedWorld when they reset.
            const removedKeys = [];
            for (const [k, v] of sharedWorld.settlements) {
              if (v.ownerName === id) {
                sharedWorld.settlements.delete(k);
                removedKeys.push(k);
              }
            }
            if (removedKeys.length) broadcastWorldDelta(removedKeys);
            console.log(`[🗑] Cleared game state for "${name}"`);
          }
        }
      }
    }

    // ─── Action protocol ────────────────────────────────────────────────────
    // Clients send { type: 'action', kind: string, ...payload } for any
    // game-modifying operation.  The server validates the action against
    // authoritative state, applies it, and broadcasts the result.
    //
    // Current server-validated kinds:
    //   'capture'  – claim a settlement (same validation as the 'territory' message)
    //   'liberate' – release a settlement to neutral
    //
    // All other kinds are accepted optimistically and are validated on an ongoing
    // basis as server-side game-logic is expanded.
    if (msg.type === 'action') {
      const player = players.get(id);
      if (!player) return;
      _handleAction(ws, id, name, player, msg);
    }
  });

  ws.on('close', () => {
    const player   = players.get(id);
    const snapshot = player
      ? { x: player.x, y: player.y, angle: player.angle }
      : { x: 0, y: 0, angle: 0 };
    players.delete(id);
    console.log(`[-] Player "${name}" disconnected (total: ${players.size})`);
    broadcast(JSON.stringify({ type: 'leave', id, name }));

    // Persist latest position in namedSessions so the player can rejoin by name.
    // Preserve the existing gameState so it survives the disconnect.
    const prevNs = namedSessions.get(name.toLowerCase());
    namedSessions.set(name.toLowerCase(), { ...snapshot, gameState: prevNs?.gameState ?? null });
  });

  ws.on('error', (err) => {
    console.error(`[!] Error from "${name}":`, err.message);
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

/**
 * Handle an 'action' message from a connected player.
 * Validates the action against authoritative state, applies it, and responds.
 *
 * The function is intentionally written to be extended: add new `kind` cases
 * here as server-side validation for additional game mechanics is implemented.
 *
 * @param {import('ws').WebSocket} ws     Sending client socket.
 * @param {string}                 id     Lowercase player id.
 * @param {string}                 name   Canonical player name.
 * @param {object}                 player Live player object from `players` map.
 * @param {object}                 msg    Parsed action message.
 */
function _handleAction(ws, id, name, player, msg) {
  const kind = typeof msg.kind === 'string' ? msg.kind : '';

  // ── capture ────────────────────────────────────────────────────────────────
  // Claim a settlement as player territory.
  // Validates: valid key, player proximity, not already owned by another player.
  if (kind === 'capture') {
    const key = msg.key;
    if (!_isValidSettlementKey(key)) {
      ws.send(JSON.stringify({ type: 'action_reject', kind, key, reason: 'invalid_key' }));
      return;
    }
    if (!_isNearSettlement(player, key)) {
      ws.send(JSON.stringify({ type: 'action_reject', kind, key, reason: 'not_near' }));
      return;
    }
    const existing = sharedWorld.settlements.get(key);
    if (existing?.ownerName && existing.ownerName !== id) {
      ws.send(JSON.stringify({ type: 'action_reject', kind, key, reason: 'already_owned', ownerName: existing.ownerName }));
      return;
    }
    const ownerColor = typeof player.kingdom?.color === 'string' ? player.kingdom.color : '#64b5f6';
    sharedWorld.settlements.set(key, { ownerName: id, controllingNationId: -1, ownerColor });
    // Add to the player's captured list if not already there.
    if (!Array.isArray(player.captured)) player.captured = [];
    if (!player.captured.includes(key)) player.captured.push(key);
    broadcastWorldDelta([key]);
    ws.send(JSON.stringify({ type: 'action_ok', kind, key }));
    return;
  }

  // ── liberate ───────────────────────────────────────────────────────────────
  // Release a settlement to neutral status.
  // Validates: valid key, player must currently own it.
  if (kind === 'liberate') {
    const key = msg.key;
    if (!_isValidSettlementKey(key)) {
      ws.send(JSON.stringify({ type: 'action_reject', kind, key, reason: 'invalid_key' }));
      return;
    }
    const existing = sharedWorld.settlements.get(key);
    if (existing?.ownerName !== id) {
      ws.send(JSON.stringify({ type: 'action_reject', kind, key, reason: 'not_owner' }));
      return;
    }
    sharedWorld.settlements.set(key, { ownerName: null, controllingNationId: -2, ownerColor: null });
    player.captured  = (player.captured  ?? []).filter(k => k !== key);
    if (!Array.isArray(player.liberated)) player.liberated = [];
    if (!player.liberated.includes(key)) player.liberated.push(key);
    broadcastWorldDelta([key]);
    ws.send(JSON.stringify({ type: 'action_ok', kind, key }));
    return;
  }

  // ── All other actions ──────────────────────────────────────────────────────
  // Accepted optimistically.  The server records the action for auditing and
  // future validation expansion (diplomacy, building, trade, recruitment, etc.).
  // No immediate state change here; the client applies the change locally and
  // the authoritative state is reconciled via the 'save' / 'worldDelta' flow.
  console.log(`[⚡] Action "${kind}" from "${name}" (pending server validation)`);
  ws.send(JSON.stringify({ type: 'action_ok', kind }));
}



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
