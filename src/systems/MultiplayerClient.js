/**
 * MultiplayerClient – thin WebSocket wrapper that handles the connection
 * lifecycle and message routing for multiplayer mode.
 *
 * ──────────────────────────── Protocol ────────────────────────────────────
 * Server → Client
 *   welcome       { type, id, seed, time, weather, name, gameState,
 *                   worldState: { settlements: object, version: number },
 *                   serverConfig: { pvpEnabled, teamsEnabled, maxTeamNameLen } }
 *   name_taken    { type: 'name_taken', name }
 *   name_required { type: 'name_required' }
 *   state         { type: 'state', players: { [id]: { x,y,angle,name,
 *                   appearance,kingdom,captured,liberated,team } },
 *                   ts, time, weather }
 *   worldDelta    { type: 'worldDelta',
 *                   settlements: { [key]: { ownerName, controllingNationId,
 *                                           ownerColor }|null },
 *                   version: number }
 *   join          { type: 'join', id, name }
 *   leave         { type: 'leave', id, name }
 *   correction    { type: 'correction', x, y, angle }
 *   action_ok     { type: 'action_ok', kind, ...data }
 *   action_reject { type: 'action_reject', kind, reason, ...data }
 *
 * Client → Server
 *   move      { type: 'move', x, y, angle }
 *   info      { type: 'info', appearance: object, kingdom: { name, color } }
 *   territory    { type: 'territory', captured: string[], liberated: string[] }
 *   mapBuildings { type: 'mapBuildings', buildings: { type: string, tx: number, ty: number }[] }
 *   save         { type: 'save', gameState: object|null }
 *   team      { type: 'team', team: string }    (declare team; '' = no team)
 *   action    { type: 'action', kind: string, ...payload }
 *               Validated kinds: 'capture', 'liberate'
 *               Accepted kinds (future): 'buy', 'sell', 'recruit',
 *                 'declare_war', 'peace', 'trade', 'build_road',
 *                 'build_map_building', 'constr_building', …
 *
 * ──────────────────────────── Reconnection ────────────────────────────────
 * On disconnect the client automatically retries with exponential back-off
 * up to MAX_RECONNECT_TRIES times before onDisconnect is fired.
 * The player name is sent as ?name=<name> on every attempt so the server can
 * restore the session (last-known position and saved game state).
 *
 * ──────────────────────────── Identity ───────────────────────────────────
 * The player's name (lowercased) is their sole unique identifier.
 */

/** Base delay for reconnection back-off (ms); doubles on each attempt, capped at 32 s. */
const RECONNECT_BASE_MS    = 2_000;
/** Maximum number of automatic reconnection attempts before giving up. */
const MAX_RECONNECT_TRIES  = 5;

export class MultiplayerClient {
  /**
   * @param {string} address     Raw address entered by the user.
   *   Accepted formats:
   *     192.168.1.1          → ws://192.168.1.1:3000
   *     192.168.1.1:8080     → ws://192.168.1.1:8080
   *     ws://…               → used as-is
   *     wss://…              → used as-is
   * @param {string} [playerName]  Display / identity name entered by the player.
   */
  constructor(address, playerName = '') {
    this._baseUrl = MultiplayerClient._normalise(address);

    /** Our own player id assigned by the server. @type {string|null} */
    this.id = null;

    /** World seed received from the server – all clients share the same value. @type {number|null} */
    this.seed = null;

    /** In-game time fraction received from the server. @type {number|null} */
    this.dayTime = null;

    /** Weather state index received from the server. @type {number|null} */
    this.weather = null;

    /**
     * Full game-state snapshot for this named account, as sent by the server in the
     * 'welcome' message.  null when the account has no prior save or the player is
     * anonymous.  Used by Game.init() to restore the player's kingdom on reconnect.
     * @type {object|null}
     */
    this.gameState = null;

    /**
     * Full world-state snapshot received from the server in the 'welcome'
     * message.  Contains the canonical settlement-control state for all
     * settlements that have been captured or liberated by any player.
     * @type {{ settlements: Record<string, { ownerName: string|null, controllingNationId: number, ownerColor: string|null }>, version: number }|null}
     */
    this.worldState = null;

    /**
     * Server configuration flags received in the 'welcome' message.
     * Reflects the server operator's settings (PvP enabled, team system, …).
     * @type {{ pvpEnabled: boolean, teamsEnabled: boolean, maxTeamNameLen: number }|null}
     */
    this.serverConfig = null;

    /**
     * Authoritative gold balance sent by the server in the 'welcome' message.
     * Game.js passes this to `GameUI.syncGold()` after init so the client's
     * inventory reflects the server's tracked value rather than any locally
     * cached (potentially manipulated) save-blob value.
     * @type {number|null}
     */
    this.serverGold = null;

    /** Called whenever the server sends a `gold_sync` balance correction.
     *  Argument: the authoritative gold balance (non-negative integer).
     *  @type {((balance: number) => void)|null} */
    this.onGoldSync = null;

    /** Player name confirmed by the server. @type {string} */
    this.playerName = playerName.trim().slice(0, 20) || '玩家';

    /** Called whenever remote player positions change.
     *  @type {((players: Record<string, {x:number,y:number,angle:number,name:string}>) => void)|null} */
    this.onStateUpdate = null;

    /** Called when a remote player disconnects.
     *  @type {((id: string) => void)|null} */
    this.onPlayerLeft = null;

    /** Called when all reconnection attempts have been exhausted.
     *  @type {(() => void)|null} */
    this.onDisconnect = null;

    /** Called with the authoritative world time and weather on each server state broadcast.
     *  @type {((time: number, weather: number) => void)|null} */
    this.onWorldSync = null;

    /**
     * Called once after connect, with the full canonical world state sent
     * in the server's 'welcome' message.  Use this to initialise settlement
     * control from the server's authoritative snapshot.
     * @type {((worldState: { settlements: Record<string, object>, version: number }) => void)|null}
     */
    this.onWorldState = null;

    /**
     * Called whenever the server broadcasts a settlement-control change
     * ('worldDelta' message).  The delta contains only the keys that changed.
     * null values mean the settlement returned to its default NPC control.
     * @type {((delta: { settlements: Record<string, object|null>, version: number }) => void)|null}
     */
    this.onWorldDelta = null;

    /** Called when the chosen name is already taken by an active player.
     *  @type {((name: string) => void)|null} */
    this.onNameTaken = null;

    /** Called when another player joins the server.
     *  @type {((id: string, name: string) => void)|null} */
    this.onPlayerJoined = null;

    /**
     * Called when the server corrects the local player's position after a
     * speed violation.  The client should snap the player sprite to the
     * server-authoritative coordinates immediately.
     * @type {((x: number, y: number, angle: number) => void)|null}
     */
    this.onPositionCorrection = null;

    this._ws               = null;
    /** Minimum milliseconds between outgoing move messages. */
    this._sendIntervalMs   = 50;
    this._lastSendTime     = 0;
    this._reconnectTries   = 0;
    this._destroyed        = false;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Open the WebSocket connection.
   * Resolves only after the server's 'welcome' message is received so that
   * this.seed and this.id are guaranteed to be set before Game.init() runs.
   * Rejects with an Error when the connection fails or the name is taken.
   * @returns {Promise<void>}
   */
  connect() {
    return new Promise((resolve, reject) => {
      this._openSocket(resolve, reject);
    });
  }

  /** Close the connection gracefully and disable automatic reconnection. */
  disconnect() {
    this._destroyed = true;
    this._ws?.close();
    this._ws = null;
  }

  /**
   * Send the local player's current position (rate-limited).
   * @param {number} x
   * @param {number} y
   * @param {number} angle
   */
  sendMove(x, y, angle) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (now - this._lastSendTime < this._sendIntervalMs) return;
    this._lastSendTime = now;
    this._ws.send(JSON.stringify({ type: 'move', x, y, angle }));
  }

  /**
   * Send the local player's appearance indices and kingdom info to the server.
   * Other connected clients will receive this in the next 'state' broadcast.
   * Called once on initial connect and again whenever the player edits their
   * character appearance or kingdom flag/name.
   * @param {{ bodyColorIdx: number, headgearIdx: number, armorColorIdx: number,
   *            markColorIdx: number, bodyShapeIdx: number, faceAccIdx: number }} appearance
   * @param {{ name: string, color: string }} kingdom
   */
  sendInfo(appearance, kingdom) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    this._ws.send(JSON.stringify({ type: 'info', appearance, kingdom }));
  }

  /**
   * Send the player's captured / liberated settlement key lists.
   * Other connected clients will receive these in the next 'state' broadcast
   * and can display a visual territory overlay on the map.
   * @param {string[]} captured   e.g. ['castle:0', 'village:3']
   * @param {string[]} liberated  e.g. ['village:5']
   */
  sendTerritory(captured, liberated) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    this._ws.send(JSON.stringify({ type: 'territory', captured, liberated }));
  }

  /**
   * Send the player's current list of placed map buildings (lumber camps, mines,
   * bridges) to the server.  The server re-broadcasts the list in the periodic
   * 'state' message so other clients can render the buildings and walk on bridges.
   *
   * Only the tile position and building type are sent; internal state (phaseTick,
   * worker assignments, etc.) stays client-local.
   *
   * @param {{ type: string, tx: number, ty: number }[]} buildings
   */
  sendMapBuildings(buildings) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    this._ws.send(JSON.stringify({ type: 'mapBuildings', buildings }));
  }

  /**
   * Send the full game-state snapshot to the server for persistence under this
   * player's named account.  Pass `null` to clear the server-side save (e.g. on reset).
   * Silently ignored if not currently connected.
   * @param {object|null} gameState  Serialisable game snapshot, or null to clear.
   */
  sendSave(gameState) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    this._ws.send(JSON.stringify({ type: 'save', gameState: gameState ?? null }));
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Build the WebSocket URL, appending the player name.
   * @returns {string}
   */
  _buildUrl() {
    const params = new URLSearchParams();
    if (this.playerName) params.set('name', this.playerName);
    const qs = params.toString();
    return qs ? `${this._baseUrl}?${qs}` : this._baseUrl;
  }

  /**
   * Open a new WebSocket, wiring all event handlers.
   * Any previously open socket is closed before the new one is created.
   * @param {(() => void)|null}           onWelcome  Called once on the first welcome message.
   * @param {((err: Error) => void)|null} onError    Called on connection error before welcome.
   */
  _openSocket(onWelcome, onError) {
    // Close any existing socket to avoid stale event handlers or duplicate connections.
    if (this._ws && this._ws.readyState !== WebSocket.CLOSED) {
      this._ws.onclose = null; // prevent the old close handler from scheduling a reconnect
      this._ws.close();
    }

    const ws = new WebSocket(this._buildUrl());
    this._ws = ws;
    let welcomed = false;

    ws.addEventListener('error', () => {
      if (!welcomed) {
        onError?.(new Error(`無法連線至 ${this._baseUrl}`));
      }
    });

    ws.addEventListener('close', () => {
      if (this._destroyed) return;
      // Only schedule a reconnect if the connection was ever successfully established
      // (welcomed). This prevents a failed initial connect from silently retrying,
      // and also prevents the close event (which always follows an error event) from
      // scheduling a duplicate reconnect on top of the one already queued by onError.
      if (!welcomed) return;
      this._scheduleReconnect();
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'welcome' && !welcomed) {
        welcomed = true;
        this._reconnectTries = 0;
        this.id         = msg.id;
        this.seed       = typeof msg.seed    === 'number' ? msg.seed    : null;
        this.dayTime    = typeof msg.time    === 'number' ? msg.time    : null;
        this.weather    = typeof msg.weather === 'number' ? msg.weather : null;
        this.gameState  = msg.gameState ?? null;
        this.worldState = msg.worldState ?? null;
        this.serverConfig = msg.serverConfig ?? null;
        this.serverGold = typeof msg.serverGold === 'number' ? msg.serverGold : null;
        this.playerName = msg.name || this.playerName;
        onWelcome?.();
      } else if ((msg.type === 'name_taken' || msg.type === 'name_required') && !welcomed) {
        // Server rejected the connection.
        welcomed = true; // prevent reconnect loop
        this._destroyed = true;
        if (msg.type === 'name_taken') {
          this.onNameTaken?.(msg.name);
          onError?.(new Error(`名稱「${msg.name}」已被其他玩家使用，請換一個名稱`));
        } else {
          onError?.(new Error('連線需要玩家名稱'));
        }
      } else {
        this._handleMessage(msg);
      }
    });
  }

  /** Schedule a reconnection attempt with exponential back-off. */
  _scheduleReconnect() {
    if (this._destroyed) return;
    if (this._reconnectTries >= MAX_RECONNECT_TRIES) {
      this.onDisconnect?.();
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * (2 ** this._reconnectTries), 32_000);
    this._reconnectTries += 1;
    setTimeout(() => {
      if (this._destroyed) return;
      this._openSocket(
        () => { /* reconnected silently */ },
        () => this._scheduleReconnect(),
      );
    }, delay);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'state':
        this.onStateUpdate?.(msg.players);
        if (typeof msg.time === 'number' && typeof msg.weather === 'number') {
          this.onWorldSync?.(msg.time, msg.weather);
        }
        break;
      case 'join':
        this.onPlayerJoined?.(msg.id, msg.name ?? '');
        break;
      case 'leave':
        this.onPlayerLeft?.(msg.id, msg.name ?? '');
        break;
      case 'correction':
        if (typeof msg.x === 'number' && typeof msg.y === 'number' && typeof msg.angle === 'number') {
          this.onPositionCorrection?.(msg.x, msg.y, msg.angle);
        }
        break;
      case 'worldDelta':
        // Incremental settlement-control update broadcast by the server whenever
        // any player captures or liberates a settlement.
        if (msg.settlements && typeof msg.settlements === 'object') {
          this.onWorldDelta?.({ settlements: msg.settlements, version: msg.version ?? 0 });
        }
        break;
      case 'gold_sync':
        // Server-authoritative gold balance.  Fired after every gold_earn /
        // gold_spend action and on reconnect (via serverGold in 'welcome').
        if (typeof msg.balance === 'number') {
          this.onGoldSync?.(msg.balance);
        }
        break;
      // action_ok / action_reject are handled by per-action callbacks (sendAction).
    }
  }

  /**
   * Send a game-action request to the server.
   * The server validates the action and responds with 'action_ok' or 'action_reject'.
   *
   * @param {string} kind    Action kind, e.g. 'capture', 'liberate', 'buy', 'declare_war'.
   * @param {object} [payload]  Additional action parameters.
   */
  sendAction(kind, payload = {}) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    this._ws.send(JSON.stringify({ type: 'action', kind, ...payload }));
  }

  /**
   * Declare this player's team on the server.
   * Only meaningful when `serverConfig.teamsEnabled` is true.
   * Pass an empty string to leave the team (free agent).
   *
   * The server sanitises and truncates the name; the confirmed team name
   * is reflected back via the next 'state' broadcast.
   *
   * @param {string} team  Team name (empty = no team).
   */
  sendTeam(team) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    this._ws.send(JSON.stringify({ type: 'team', team: team ?? '' }));
  }

  /**
   * Normalise a raw address string into a full WebSocket URL.
   * @param {string} raw
   * @returns {string}
   */
  static _normalise(raw) {
    if (raw.startsWith('ws://') || raw.startsWith('wss://')) return raw;
    // Strip any leading protocol the user may have typed.
    const stripped = raw.replace(/^https?:\/\//, '');
    return `ws://${stripped.includes(':') ? stripped : `${stripped}:3000`}`;
  }
}
