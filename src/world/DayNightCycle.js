/**
 * DayNightCycle
 *
 * Tracks in-game time and computes the screen-space sky overlay needed to
 * simulate a full day/night cycle.
 *
 * Time is represented as a fraction [0, 1):
 *   0.00 = midnight
 *   0.25 = 06:00 (dawn)
 *   0.50 = noon
 *   0.75 = 18:00 (dusk)
 */

/** Real-world seconds for one full in-game day. */
export const DEFAULT_DAY_DURATION = 120;

// Phase boundaries (fraction of day)
const NIGHT_END    = 0.21;
const DAWN_END     = 0.29;
const DAY_END      = 0.71;
const DUSK_END     = 0.79;

/** Smooth-step easing within [edge0, edge1]. */
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Linear interpolation between two numbers. */
function lerp(a, b, t) { return a + (b - a) * t; }

/** Linear interpolation of two hex colours (channel-wise). */
function lerpColor(c0, c1, t) {
  const r = Math.round(lerp((c0 >> 16) & 0xFF, (c1 >> 16) & 0xFF, t));
  const g = Math.round(lerp((c0 >>  8) & 0xFF, (c1 >>  8) & 0xFF, t));
  const b = Math.round(lerp( c0        & 0xFF,  c1        & 0xFF, t));
  return (r << 16) | (g << 8) | b;
}

const NIGHT_COLOR = 0x000033;  // deep indigo
const DAWN_COLOR  = 0xFF7722;  // warm orange
const DUSK_COLOR  = 0xFF4400;  // red-orange

export class DayNightCycle {
  /**
   * @param {number} dayDuration  Seconds for one full in-game day.
   * @param {number} startTime    Starting time fraction [0, 1). Default: 0.27 (just after dawn).
   */
  constructor(dayDuration = DEFAULT_DAY_DURATION, startTime = 0.27) {
    this._dayDuration = dayDuration;
    this._time = startTime;
  }

  /** Current time fraction [0, 1). */
  get time() { return this._time; }

  /** Advance in-game time. @param {number} dt  Delta time in real seconds. */
  update(dt) {
    this._time = (this._time + dt / this._dayDuration) % 1;
  }

  /**
   * Returns the sky overlay parameters to apply as a full-screen tinted rect.
   * @returns {{ color: number, alpha: number }}
   */
  getOverlay() {
    const t = this._time;

    if (t < NIGHT_END) {
      // Full night
      return { color: NIGHT_COLOR, alpha: 0.62 };
    }

    if (t < DAWN_END) {
      // Night → Dawn → Day
      const p = smoothstep(NIGHT_END, DAWN_END, t);
      if (p < 0.5) {
        // Night fading to warm dawn glow
        const pp = p / 0.5;
        return {
          color: lerpColor(NIGHT_COLOR, DAWN_COLOR, pp),
          alpha: lerp(0.62, 0.35, pp),
        };
      } else {
        // Dawn glow fading away to day
        const pp = (p - 0.5) / 0.5;
        return {
          color: DAWN_COLOR,
          alpha: lerp(0.35, 0, pp),
        };
      }
    }

    if (t < DAY_END) {
      // Full day – no overlay
      return { color: 0x000000, alpha: 0 };
    }

    if (t < DUSK_END) {
      // Day → Dusk → Night
      const p = smoothstep(DAY_END, DUSK_END, t);
      if (p < 0.5) {
        // Day fading to warm dusk glow
        const pp = p / 0.5;
        return {
          color: DUSK_COLOR,
          alpha: lerp(0, 0.35, pp),
        };
      } else {
        // Dusk glow darkening to night
        const pp = (p - 0.5) / 0.5;
        return {
          color: lerpColor(DUSK_COLOR, NIGHT_COLOR, pp),
          alpha: lerp(0.35, 0.62, pp),
        };
      }
    }

    // Back to full night
    return { color: NIGHT_COLOR, alpha: 0.62 };
  }

  /** Chinese name of the current phase. */
  getPhaseName() {
    const t = this._time;
    if (t < NIGHT_END || t >= DUSK_END) return '夜晚';
    if (t < DAWN_END) return '清晨';
    if (t < DAY_END)  return '白天';
    return '黃昏';
  }

  /**
   * In-game clock as "HH:MM".
   * 0.0 → "00:00", 0.5 → "12:00", 0.25 → "06:00"
   */
  getTimeString() {
    const totalMinutes = Math.floor(this._time * 24 * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
