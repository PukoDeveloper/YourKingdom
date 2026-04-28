import { Container, Graphics } from 'pixi.js';

const OUTER_RADIUS = 54;
const INNER_RADIUS = 24;
const MARGIN       = 90; // distance from screen edges

/**
 * An on-screen analogue joystick rendered with Pixi.js.
 * Reports a normalised [-1..1] direction vector via the `onChange` callback.
 */
export class VirtualJoystick {
  /**
   * @param {import('pixi.js').Application} app
   * @param {number} screenW
   * @param {number} screenH
   * @param {(x: number, y: number) => void} onChange
   */
  constructor(app, screenW, screenH, onChange) {
    this._app      = app;
    this._onChange = onChange;
    this._active   = false;
    this._touchId  = null;

    this._centerX  = MARGIN;
    this._centerY  = screenH - MARGIN;

    this.container = new Container();
    this._buildGraphics();
    this._updatePosition(screenW, screenH);
    this._attachEvents();
  }

  // ---------------------------------------------------------------------------
  // Graphics
  // ---------------------------------------------------------------------------

  _buildGraphics() {
    // Outer ring
    this._outer = new Graphics();
    this._outer
      .circle(0, 0, OUTER_RADIUS)
      .fill({ color: 0x000000, alpha: 0.25 })
      .circle(0, 0, OUTER_RADIUS)
      .stroke({ color: 0xFFFFFF, width: 3, alpha: 0.7 });

    // Inner knob
    this._knob = new Graphics();
    this._knob
      .circle(0, 0, INNER_RADIUS)
      .fill({ color: 0xFFFFFF, alpha: 0.85 });

    this.container.addChild(this._outer);
    this.container.addChild(this._knob);
    this.container.alpha = 0.0; // hidden until first touch
  }

  _updatePosition(screenW, screenH) {
    this._centerX      = MARGIN;
    this._centerY      = screenH - MARGIN;
    this.container.x   = this._centerX;
    this.container.y   = this._centerY;
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  _attachEvents() {
    const canvas = this._app.canvas;
    canvas.addEventListener('pointerdown',   this._onDown.bind(this));
    window.addEventListener('pointermove',   this._onMove.bind(this));
    window.addEventListener('pointerup',     this._onUp.bind(this));
    window.addEventListener('pointercancel', this._onUp.bind(this));
  }

  _onDown(e) {
    if (this._active) return;

    const rect = this._app.canvas.getBoundingClientRect();
    const px   = e.clientX - rect.left;
    const py   = e.clientY - rect.top;

    const dx = px - this._centerX;
    const dy = py - this._centerY;

    // Only activate when touch is within 1.6× the outer ring radius
    if (Math.sqrt(dx * dx + dy * dy) < OUTER_RADIUS * 1.6) {
      this._active    = true;
      this._touchId   = e.pointerId;
      this.container.alpha = 0.75;
      this._moveKnob(px, py);
    }
  }

  _onMove(e) {
    if (!this._active || e.pointerId !== this._touchId) return;
    const rect = this._app.canvas.getBoundingClientRect();
    this._moveKnob(e.clientX - rect.left, e.clientY - rect.top);
  }

  _onUp(e) {
    if (!this._active || e.pointerId !== this._touchId) return;
    this._active  = false;
    this._touchId = null;
    this._knob.x  = 0;
    this._knob.y  = 0;
    this.container.alpha = 0.0;
    this._onChange(0, 0);
  }

  _moveKnob(screenX, screenY) {
    const dx   = screenX - this._centerX;
    const dy   = screenY - this._centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clampedDist = Math.min(dist, OUTER_RADIUS);
    const angle       = Math.atan2(dy, dx);

    this._knob.x = Math.cos(angle) * clampedDist;
    this._knob.y = Math.sin(angle) * clampedDist;

    // Normalise output to [-1..1]
    const normFactor = dist > 0 ? clampedDist / OUTER_RADIUS : 0;
    this._onChange(
      Math.cos(angle) * normFactor,
      Math.sin(angle) * normFactor,
    );
  }

  // ---------------------------------------------------------------------------

  resize(screenW, screenH) {
    this._updatePosition(screenW, screenH);
  }
}
