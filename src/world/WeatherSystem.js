/**
 * WeatherSystem
 *
 * Manages a set of weather states with random timed transitions and renders
 * the appropriate visual effects (rain particles, overlay tint, lightning) as
 * a screen-space PixiJS Graphics that lives in the UI layer.
 */

import { Graphics } from 'pixi.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const WEATHER = Object.freeze({
  CLEAR:  0,
  CLOUDY: 1,
  RAIN:   2,
  STORM:  3,
});

export const WEATHER_NAMES = {
  [WEATHER.CLEAR]:  '☀ 晴天',
  [WEATHER.CLOUDY]: '☁ 多雲',
  [WEATHER.RAIN]:   '🌧 降雨',
  [WEATHER.STORM]:  '⛈ 暴風雨',
};

/**
 * Possible next states for each current state (weighted by repetition).
 * CLEAR  → mostly stays clear, sometimes goes cloudy
 * CLOUDY → may clear, stay, or progress to rain
 * RAIN   → may ease to cloudy, stay, or escalate to storm
 * STORM  → may ease to rain, stay, or break to cloudy
 */
const TRANSITIONS = [
  /* CLEAR  */ [WEATHER.CLEAR, WEATHER.CLEAR, WEATHER.CLEAR, WEATHER.CLOUDY],
  /* CLOUDY */ [WEATHER.CLEAR, WEATHER.CLOUDY, WEATHER.CLOUDY, WEATHER.RAIN],
  /* RAIN   */ [WEATHER.CLOUDY, WEATHER.RAIN,  WEATHER.RAIN,   WEATHER.STORM],
  /* STORM  */ [WEATHER.RAIN,   WEATHER.STORM, WEATHER.STORM,  WEATHER.CLOUDY],
];

const MIN_DURATION = 30;   // seconds before state may change
const MAX_DURATION = 100;  // seconds maximum state duration

/** Flash visual duration in seconds. */
const FLASH_DURATION = 0.15;

/** Number of rain drops rendered on screen. */
const DROP_COUNT = 200;

// ---------------------------------------------------------------------------
// WeatherSystem
// ---------------------------------------------------------------------------

export class WeatherSystem {
  /**
   * @param {number} screenW  Initial screen width  in CSS pixels.
   * @param {number} screenH  Initial screen height in CSS pixels.
   */
  constructor(screenW, screenH) {
    this._sw = screenW;
    this._sh = screenH;

    this._state   = WEATHER.CLEAR;
    this._timer   = this._randomDuration();

    /** Countdown until next lightning flash (seconds). */
    this._lightningTimer = this._randomLightning();
    /** Remaining flash duration (seconds). */
    this._flashDuration  = 0;

    this._drops = Array.from({ length: DROP_COUNT }, () => this._newDrop(true));

    /** Public container – add to the UI layer. */
    this.container = new Graphics();
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /** @param {number} dt  Delta time in seconds. */
  update(dt) {
    const prevState       = this._state;
    const prevFlashActive = this._flashDuration > 0;

    // Weather state transitions
    this._timer -= dt;
    if (this._timer <= 0) {
      const opts  = TRANSITIONS[this._state];
      this._state = opts[Math.floor(Math.random() * opts.length)];
      this._timer = this._randomDuration();
      // Reinitialise drops when entering a rain state so they aren't pre-placed.
      // Reuse the existing objects (always DROP_COUNT items from the constructor)
      // to avoid allocating a fresh array on every weather transition.
      if (this._state === WEATHER.RAIN || this._state === WEATHER.STORM) {
        for (const d of this._drops) Object.assign(d, this._newDrop(false));
      }
    }

    // Lightning (storm only)
    if (this._state === WEATHER.STORM) {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._flashDuration  = FLASH_DURATION;
        this._lightningTimer = this._randomLightning();
      }
      this._flashDuration = Math.max(0, this._flashDuration - dt);
    } else {
      this._flashDuration  = 0;
      this._lightningTimer = this._randomLightning();
    }

    // Move rain drops
    if (this._state === WEATHER.RAIN || this._state === WEATHER.STORM) {
      const isStorm = this._state === WEATHER.STORM;
      for (const d of this._drops) {
        d.y += d.speed * dt;
        d.x += d.slant * d.speed * dt;
        if (d.y > this._sh + 20 || d.x > this._sw + 20) {
          Object.assign(d, this._newDrop(false));
        }
      }
    }

    // Only redraw when something has visually changed:
    //   - Weather state changed (need to update overlay or clear it)
    //   - Rain/storm is active (drops moved this frame)
    //   - Lightning flash started, is ongoing, or just ended
    const isRaining   = this._state === WEATHER.RAIN || this._state === WEATHER.STORM;
    const flashActive = this._flashDuration > 0;
    const stateChanged = this._state !== prevState;
    if (isRaining || stateChanged || flashActive || prevFlashActive) {
      this._redraw();
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  _redraw() {
    const g  = this.container;
    const sw = this._sw;
    const sh = this._sh;

    g.clear();

    // --- Overlay tint ---
    switch (this._state) {
      case WEATHER.CLOUDY:
        g.rect(0, 0, sw, sh).fill({ color: 0x445566, alpha: 0.18 });
        break;
      case WEATHER.RAIN:
        g.rect(0, 0, sw, sh).fill({ color: 0x223344, alpha: 0.30 });
        break;
      case WEATHER.STORM:
        g.rect(0, 0, sw, sh).fill({ color: 0x111122, alpha: 0.48 });
        break;
      default:
        break;
    }

    // --- Lightning flash ---
    if (this._flashDuration > 0) {
      const alpha = 0.45 * (this._flashDuration / FLASH_DURATION);
      g.rect(0, 0, sw, sh).fill({ color: 0xFFFFEE, alpha });
    }

    // --- Rain drops (drawn as thin filled rects for PixiJS v8 compatibility) ---
    if (this._state === WEATHER.RAIN || this._state === WEATHER.STORM) {
      const isStorm  = this._state === WEATHER.STORM;
      const color    = isStorm ? 0x99AACC : 0xBBCCDD;
      const alpha    = isStorm ? 0.75 : 0.50;
      const dropW    = isStorm ? 1.5  : 1.0;

      for (const d of this._drops) {
        // Draw drop as a short rotated rect approximated by a thin slanted fill.
        // Using two points to compute the rect transform would require matrix ops;
        // instead we draw a simple vertical line segment as a 1×len rect and
        // offset x slightly per frame based on slant (already applied in update).
        g.rect(d.x, d.y, dropW, d.len).fill({ color, alpha });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _newDrop(scattered = false) {
    const isStorm = this._state === WEATHER.STORM;
    return {
      x:     Math.random() * this._sw,
      y:     scattered ? Math.random() * this._sh : -10 - Math.random() * 40,
      speed: 350 + Math.random() * 250 + (isStorm ? 350 : 0),
      len:   6 + Math.random() * 10,
      slant: isStorm ? 0.25 + Math.random() * 0.15 : 0.05 + Math.random() * 0.05,
    };
  }

  _randomDuration() {
    return MIN_DURATION + Math.random() * (MAX_DURATION - MIN_DURATION);
  }

  _randomLightning() {
    return 2 + Math.random() * 8; // next flash in 2–10 s
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Call when the viewport is resized. */
  resize(screenW, screenH) {
    this._sw = screenW;
    this._sh = screenH;
  }

  /** Chinese name for the current weather state. */
  getName() {
    return WEATHER_NAMES[this._state];
  }
}
