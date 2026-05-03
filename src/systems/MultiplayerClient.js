/**
 * MultiplayerClient – thin WebSocket wrapper that handles the connection
 * lifecycle and message routing for multiplayer mode.
 *
 * Protocol (JSON over WebSocket):
 *   Server → Client  welcome  { type: 'welcome', id: string, seed: number, sessionToken: string }
 *   Client → Server  move     { type: 'move', x: number, y: number, angle: number }
 *   Server → Client  state    { type: 'state', players: { [id]: { x, y, angle } }, ts: number }
 *   Server → Client  leave    { type: 'leave', id: string }
 *
 * Reconnection:
 *   On disconnect the client stores its sessionToken in localStorage under
 *   SESSION_KEY and automatically appends it as ?token=<sessionToken> on the
 *   next connection attempt so the server can restore the original player id.
 *   Up to MAX_RECONNECT_TRIES are made before onDisconnect is fired.
 */

/** localStorage key used to persist the session token across page reloads. */
const SESSION_KEY          = 'yk_mp_session';
/** Base delay for reconnection back-off (ms); doubles on each attempt, capped at 32 s. */
const RECONNECT_BASE_MS    = 2_000;
/** Maximum number of automatic reconnection attempts before giving up. */
const MAX_RECONNECT_TRIES  = 5;

export class MultiplayerClient {
  /**
   * @param {string} address  Raw address entered by the user.
   *   Accepted formats:
   *     192.168.1.1          → ws://192.168.1.1:3000
   *     192.168.1.1:8080     → ws://192.168.1.1:8080
   *     ws://…               → used as-is
   *     wss://…              → used as-is
   */
  constructor(address) {
    this._baseUrl = MultiplayerClient._normalise(address);

    /** Our own player id assigned by the server. @type {string|null} */
    this.id = null;

    /** World seed received from the server – all clients share the same value. @type {number|null} */
    this.seed = null;

    /** Called whenever remote player positions change.
     *  @type {((players: Record<string, {x:number,y:number,angle:number}>) => void)|null} */
    this.onStateUpdate = null;

    /** Called when a remote player disconnects.
     *  @type {((id: string) => void)|null} */
    this.onPlayerLeft = null;

    /** Called when all reconnection attempts have been exhausted.
     *  @type {(() => void)|null} */
    this.onDisconnect = null;

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
   * @returns {Promise<void>} Resolves on successful welcome, rejects on error.
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

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Build the WebSocket URL, appending the stored session token if one exists.
   * @returns {string}
   */
  _buildUrl() {
    try {
      const token = localStorage.getItem(SESSION_KEY);
      if (token) {
        const sep = this._baseUrl.includes('?') ? '&' : '?';
        return `${this._baseUrl}${sep}token=${encodeURIComponent(token)}`;
      }
    } catch { /* localStorage unavailable (e.g. private browsing restrictions) */ }
    return this._baseUrl;
  }

  /**
   * Open a new WebSocket, wiring all event handlers.
   * @param {(() => void)|null}       onWelcome  Called once on the first welcome message.
   * @param {((err: Error) => void)|null} onError    Called on connection error before welcome.
   */
  _openSocket(onWelcome, onError) {
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
      this._scheduleReconnect();
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'welcome' && !welcomed) {
        welcomed = true;
        this._reconnectTries = 0;
        this.id   = msg.id;
        this.seed = typeof msg.seed === 'number' ? msg.seed : null;
        if (msg.sessionToken) {
          try { localStorage.setItem(SESSION_KEY, msg.sessionToken); } catch { /* ignore */ }
        }
        onWelcome?.();
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
        break;
      case 'leave':
        this.onPlayerLeft?.(msg.id);
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
