/**
 * Unified keyboard input manager.
 * Handles WASD + arrow keys and exposes the combined direction vector.
 */
export class InputManager {
  constructor() {
    /** @type {Record<string, boolean>} */
    this._keys = {};

    /** Direction injected by the virtual joystick. */
    this._joystickX = 0;
    this._joystickY = 0;

    this._onKeyDown = (e) => {
      // Don't intercept keys typed into an input or textarea element
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this._keys[e.code] = true;
      // Prevent arrow keys from scrolling the page
      if (e.code.startsWith('Arrow')) e.preventDefault();
    };
    this._onKeyUp = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this._keys[e.code] = false;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup',   this._onKeyUp);
  }

  /** Called by VirtualJoystick with a normalised [-1..1] direction vector. */
  setJoystickDirection(x, y) {
    this._joystickX = x;
    this._joystickY = y;
  }

  /**
   * Returns the combined movement direction.
   * Components are NOT normalised individually – callers normalise the result.
   * @returns {{ x: number, y: number }}
   */
  getDirection() {
    let dx = this._joystickX;
    let dy = this._joystickY;

    if (this._keys['ArrowLeft']  || this._keys['KeyA']) dx -= 1;
    if (this._keys['ArrowRight'] || this._keys['KeyD']) dx += 1;
    if (this._keys['ArrowUp']    || this._keys['KeyW']) dy -= 1;
    if (this._keys['ArrowDown']  || this._keys['KeyS']) dy += 1;

    return { x: dx, y: dy };
  }

  /** Clean up event listeners. */
  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup',   this._onKeyUp);
  }
}
