/**
 * MultiplayerClient – thin WebSocket wrapper that handles the connection
 * lifecycle and message routing for multiplayer mode.
 *
 * Protocol (JSON over WebSocket):
 *   Server → Client  welcome    { type: 'welcome', id: string, seed: number, time: number, weather: number, sessionToken: string, name: string, gameState: object|null }
 *   Server → Client  name_taken { type: 'name_taken', name: string }
 *   Client → Server  move       { type: 'move', x: number, y: number, angle: number }
 *   Client → Server  info       { type: 'info', appearance: object, kingdom: { name, color } }
 *   Client → Server  territory  { type: 'territory', captured: string[], liberated: string[] }
 *   Client → Server  save       { type: 'save', gameState: object }
 *   Server → Client  join       { type: 'join', id: string, name: string }
 *   Server → Client  state      { type: 'state', players: { [id]: { x, y, angle, name } }, ts: number, time: number, weather: number }
 *   Server → Client  leave      { type: 'leave', id: string, name: string }
 *
 * Reconnection:
 *   On disconnect the client stores its sessionToken in localStorage under
 *   SESSION_KEY and automatically appends it as ?token=<sessionToken> on the
 *   next connection attempt so the server can restore the original player id.
 *   Up to MAX_RECONNECT_TRIES are made before onDisconnect is fired.
 *
 *   Additionally, the player name is appended as ?name=<name> so the server
 *   can also restore the session by name even after the token has expired.
 */

/** localStorage key used to persist the session token across page reloads. */
const SESSION_KEY          = 'yk_mp_session';
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
   * Build the WebSocket URL, appending the stored session token and player name.
   * @returns {string}
   */
  _buildUrl() {
    const params = new URLSearchParams();
    // Prefer the fast-reconnect token when available.
    try {
      const token = localStorage.getItem(SESSION_KEY);
      if (token) params.set('token', token);
    } catch { /* localStorage unavailable */ }
    // Always send the player name so the server can do name-based identity lookup.
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
        this.playerName = msg.name || this.playerName;
        if (msg.sessionToken) {
          try { localStorage.setItem(SESSION_KEY, msg.sessionToken); } catch { /* ignore */ }
        }
        onWelcome?.();
      } else if (msg.type === 'name_taken' && !welcomed) {
        // Server rejected because the name is already in use.
        welcomed = true; // prevent reconnect loop
        this._destroyed = true;
        this.onNameTaken?.(msg.name);
        onError?.(new Error(`名稱「${msg.name}」已被其他玩家使用，請換一個名稱`));
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
    }
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
