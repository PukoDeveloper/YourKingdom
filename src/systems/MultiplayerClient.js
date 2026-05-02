/**
 * MultiplayerClient – thin WebSocket wrapper that handles the connection
 * lifecycle and message routing for multiplayer mode.
 *
 * Protocol (JSON over WebSocket):
 *   Server → Client  welcome  { type: 'welcome', id: string }
 *   Client → Server  move     { type: 'move', x: number, y: number, angle: number }
 *   Server → Client  state    { type: 'state', players: { [id]: { x, y, angle } } }
 *   Server → Client  leave    { type: 'leave', id: string }
 */
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
    this._url = MultiplayerClient._normalise(address);

    /** Our own player id assigned by the server. @type {string|null} */
    this.id = null;

    /** Called whenever remote player positions change.
     *  @type {((players: Record<string, {x:number,y:number,angle:number}>) => void)|null} */
    this.onStateUpdate = null;

    /** Called when a remote player disconnects.
     *  @type {((id: string) => void)|null} */
    this.onPlayerLeft = null;

    /** Called when the connection closes unexpectedly.
     *  @type {(() => void)|null} */
    this.onDisconnect = null;

    this._ws = null;
    /** Minimum milliseconds between outgoing move messages. */
    this._sendIntervalMs = 100;
    this._lastSendTime   = 0;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Open the WebSocket connection.
   * @returns {Promise<void>} Resolves on successful connection, rejects on error.
   */
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this._url);
      this._ws = ws;

      ws.addEventListener('open', () => resolve());

      ws.addEventListener('error', () => {
        reject(new Error(`無法連線至 ${this._url}`));
      });

      ws.addEventListener('close', () => {
        this.onDisconnect?.();
      });

      ws.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        this._handleMessage(msg);
      });
    });
  }

  /** Close the connection gracefully. */
  disconnect() {
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

  _handleMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        this.id = msg.id;
        break;
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
