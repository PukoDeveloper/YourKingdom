import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from './world/constants.js';

/** Pre-computed constant: total map width in world pixels. */
const MAP_PIXEL_W = MAP_WIDTH  * TILE_SIZE;
/** Pre-computed constant: total map height in world pixels. */
const MAP_PIXEL_H = MAP_HEIGHT * TILE_SIZE;

/**
 * Tracks the camera position in world space and applies the resulting
 * transform to the world container each frame.
 *
 * Camera coordinates refer to the world-space point shown at the
 * centre of the screen.
 */
export class Camera {
  /**
   * @param {number} screenW   viewport width  in CSS pixels
   * @param {number} screenH   viewport height in CSS pixels
   */
  constructor(screenW, screenH) {
    this.screenW = screenW;
    this.screenH = screenH;

    /** Current camera world position (starts at 0,0 – updated before first frame). */
    this.x = 0;
    this.y = 0;

    /** Smooth-follow target. */
    this._targetX = 0;
    this._targetY = 0;

    /**
     * Exponential smoothing factor.
     * Higher → snappier follow. ~8 gives a half-life of ~87 ms.
     */
    this._smooth = 8;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Tell the camera to follow a point in world space. */
  follow(worldX, worldY) {
    this._targetX = worldX;
    this._targetY = worldY;
  }

  /** Advance the smooth-follow interpolation. Call once per frame. */
  update(dt) {
    const alpha = 1 - Math.exp(-this._smooth * dt);
    this.x += (this._targetX - this.x) * alpha;
    this.y += (this._targetY - this.y) * alpha;
  }

  /**
   * Apply the camera transform to `worldContainer`.
   * Also clamps so the map always fills the screen (no black borders).
   *
   * @param {import('pixi.js').Container} worldContainer
   */
  apply(worldContainer) {
    const halfW = this.screenW / 2;
    const halfH = this.screenH / 2;

    // Clamp camera so we never show outside the map
    let cx = this.x;
    let cy = this.y;

    if (MAP_PIXEL_W > this.screenW) {
      cx = Math.max(halfW, Math.min(MAP_PIXEL_W - halfW, cx));
    } else {
      cx = MAP_PIXEL_W / 2;
    }

    if (MAP_PIXEL_H > this.screenH) {
      cy = Math.max(halfH, Math.min(MAP_PIXEL_H - halfH, cy));
    } else {
      cy = MAP_PIXEL_H / 2;
    }

    // Round to integer pixels to avoid sub-pixel rendering gaps between chunk sprites.
    worldContainer.x = Math.round(halfW - cx);
    worldContainer.y = Math.round(halfH - cy);
  }

  /** Call when the browser window is resized. */
  resize(screenW, screenH) {
    this.screenW = screenW;
    this.screenH = screenH;
  }
}
