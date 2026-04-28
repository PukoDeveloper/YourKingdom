/**
 * AppearanceSystem – modular, seed-deterministic appearance for national flags
 * and character/soldier sprites.
 *
 * Flag appearance   : { bgColor, stripeStyle, stripeColor, symbol, symbolShape }
 * Character appearance: { bodyColorIdx, bodyColor, bodyColorCSS,
 *                         headgearIdx, headgear,
 *                         armorColorIdx, armorColor, armorColorCSS,
 *                         markColorIdx,  markColor,  markColorCSS }
 */

// ---------------------------------------------------------------------------
// Data tables – flag
// ---------------------------------------------------------------------------

export const FLAG_BG_COLORS = [
  '#C62828', '#1565C0', '#2E7D32', '#E65100', '#F9A825',
  '#6A1B9A', '#00695C', '#546E7A', '#37474F', '#880E4F',
];

export const FLAG_STRIPE_COLORS = [
  '#FFFFFF', '#FFD700', '#000000', '#FF8F00', '#B71C1C',
  '#0D47A1', '#1B5E20', '#E0E0E0', '#FF6E40', '#CE93D8',
];

export const FLAG_STRIPE_STYLES = ['none', 'horizontal', 'vertical', 'diagonal', 'cross', 'chevron'];

export const FLAG_SYMBOLS = ['⚔️', '🛡️', '👑', '⭐', '🌙', '☀️', '⚡', '🔥', '🌊', '🦅', '🐉', '🌿'];

/** Pixi-drawable shape IDs aligned with FLAG_SYMBOLS index. */
const _SYMBOL_SHAPES = [
  'cross', 'diamond', 'crown', 'star', 'circle', 'sun',
  'bolt',  'flame',   'wave',  'bird', 'dragon', 'leaf',
];

// ---------------------------------------------------------------------------
// Data tables – character
// ---------------------------------------------------------------------------

/** Body/uniform color – stored as 0xRRGGBB for PixiJS */
export const CHAR_BODY_COLORS = [
  0xE53935, 0x1565C0, 0x2E7D32, 0x78909C, 0xF9A825,
  0x6A1B9A, 0x00695C, 0xBF360C, 0x37474F, 0x558B2F,
];

/** CSS equivalents (same order as CHAR_BODY_COLORS) */
export const CHAR_BODY_COLORS_CSS = [
  '#E53935', '#1565C0', '#2E7D32', '#78909C', '#F9A825',
  '#6A1B9A', '#00695C', '#BF360C', '#37474F', '#558B2F',
];

export const CHAR_HEADGEAR_TYPES  = ['helmet', 'hat', 'hood', 'crown', 'bare'];
export const CHAR_HEADGEAR_LABELS = ['頭盔',   '帽子', '兜帽', '王冠', '光頭'];

/** Armor/border color */
export const CHAR_ARMOR_COLORS = [0x607D8B, 0x795548, 0x455A64, 0x8D6E63, 0xBDBDBD];
export const CHAR_ARMOR_COLORS_CSS = ['#607D8B', '#795548', '#455A64', '#8D6E63', '#BDBDBD'];

/** Accent / face-mark color */
export const CHAR_MARK_COLORS = [0xFFEB3B, 0xFF5722, 0x9C27B0, 0x00BCD4, 0xFFFFFF];
export const CHAR_MARK_COLORS_CSS = ['#FFEB3B', '#FF5722', '#9C27B0', '#00BCD4', '#FFFFFF'];

// ---------------------------------------------------------------------------
// Hash helpers (seed-deterministic, same formula as NationSystem)
// ---------------------------------------------------------------------------

function _h(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return Math.abs(s) % 1.0;
}

function _hash(a, b, offset = 0) {
  return _h(a * 9973 + b * 3571 + offset * 1597);
}

function _idx(arr, seedVal) {
  return Math.floor(seedVal * arr.length);
}

// ---------------------------------------------------------------------------
// Flag appearance
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic flag appearance from two seed values.
 * @param {number} s1
 * @param {number} s2
 * @returns {{ bgColor: string, stripeStyle: string, stripeColor: string,
 *             symbol: string, symbolShape: string }}
 */
export function generateFlagAppearance(s1, s2) {
  const symIdx = _idx(FLAG_SYMBOLS, _hash(s1, s2, 3));
  return {
    bgColor:     FLAG_BG_COLORS    [_idx(FLAG_BG_COLORS,     _hash(s1, s2, 0))],
    stripeStyle: FLAG_STRIPE_STYLES[_idx(FLAG_STRIPE_STYLES, _hash(s1, s2, 1))],
    stripeColor: FLAG_STRIPE_COLORS[_idx(FLAG_STRIPE_COLORS, _hash(s1, s2, 2))],
    symbol:      FLAG_SYMBOLS[symIdx],
    symbolShape: _SYMBOL_SHAPES[symIdx],
  };
}

/**
 * Render a flag as an HTML string suitable for DOM insertion.
 * @param {{ bgColor: string, stripeStyle: string, stripeColor: string, symbol: string }} flagApp
 * @param {number} [size=32]   width in px (height = 70 % of width)
 * @returns {string}
 */
export function renderFlagHTML(flagApp, size = 32) {
  const { bgColor, stripeStyle, stripeColor, symbol } = flagApp;
  const h   = Math.round(size * 0.7);
  const stripe = _stripeHTML(stripeStyle, stripeColor, size, h);
  return `<div class="flag-badge" style="width:${size}px;height:${h}px;background:${bgColor};position:relative;display:inline-flex;align-items:center;justify-content:center;border-radius:2px;overflow:hidden;border:1px solid rgba(255,255,255,0.25);flex-shrink:0">${stripe}<span style="position:relative;z-index:1;font-size:${Math.round(size * 0.38)}px;line-height:1">${symbol}</span></div>`;
}

function _stripeHTML(style, color, w, h) {
  const s = `background:${color};opacity:0.55;position:absolute;`;
  switch (style) {
    case 'horizontal':
      return `<div style="${s}left:0;top:${Math.round(h * 0.35)}px;width:100%;height:${Math.round(h * 0.3)}px"></div>`;
    case 'vertical':
      return `<div style="${s}top:0;left:${Math.round(w * 0.35)}px;width:${Math.round(w * 0.3)}px;height:100%"></div>`;
    case 'diagonal':
      return `<div style="${s}top:-${h}px;left:${Math.round(w * 0.3)}px;width:${Math.round(w * 0.2)}px;height:${h * 3}px;transform:rotate(30deg);transform-origin:top center"></div>`;
    case 'cross':
      return `<div style="${s}left:0;top:${Math.round(h * 0.35)}px;width:100%;height:${Math.round(h * 0.3)}px"></div>` +
             `<div style="${s}top:0;left:${Math.round(w * 0.35)}px;width:${Math.round(w * 0.3)}px;height:100%"></div>`;
    case 'chevron':
      return `<div style="position:absolute;left:0;top:0;width:0;height:0;border-top:${Math.round(h * 0.5)}px solid transparent;border-bottom:${Math.round(h * 0.5)}px solid transparent;border-left:${Math.round(w * 0.4)}px solid ${color};opacity:0.65"></div>`;
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Character appearance
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic character appearance from two seed values.
 * @param {number} s1
 * @param {number} s2
 * @returns {{ bodyColorIdx: number, bodyColor: number, bodyColorCSS: string,
 *             headgearIdx: number, headgear: string,
 *             armorColorIdx: number, armorColor: number, armorColorCSS: string,
 *             markColorIdx: number, markColor: number, markColorCSS: string }}
 */
export function generateCharAppearance(s1, s2) {
  const bi = _idx(CHAR_BODY_COLORS,  _hash(s1, s2, 10));
  const hi = _idx(CHAR_HEADGEAR_TYPES, _hash(s1, s2, 11));
  const ai = _idx(CHAR_ARMOR_COLORS, _hash(s1, s2, 12));
  const mi = _idx(CHAR_MARK_COLORS,  _hash(s1, s2, 13));
  return {
    bodyColorIdx:  bi, bodyColor:  CHAR_BODY_COLORS[bi],  bodyColorCSS:  CHAR_BODY_COLORS_CSS[bi],
    headgearIdx:   hi, headgear:   CHAR_HEADGEAR_TYPES[hi],
    armorColorIdx: ai, armorColor: CHAR_ARMOR_COLORS[ai], armorColorCSS: CHAR_ARMOR_COLORS_CSS[ai],
    markColorIdx:  mi, markColor:  CHAR_MARK_COLORS[mi],  markColorCSS:  CHAR_MARK_COLORS_CSS[mi],
  };
}

/**
 * Build a character appearance object from saved index values.
 * @param {{ bodyColorIdx: number, headgearIdx: number, armorColorIdx: number, markColorIdx: number }} indices
 * @returns {ReturnType<typeof generateCharAppearance>}
 */
export function charAppearanceFromIndices({ bodyColorIdx, headgearIdx, armorColorIdx, markColorIdx }) {
  const bi = Math.max(0, Math.min(bodyColorIdx,  CHAR_BODY_COLORS.length  - 1));
  const hi = Math.max(0, Math.min(headgearIdx,   CHAR_HEADGEAR_TYPES.length - 1));
  const ai = Math.max(0, Math.min(armorColorIdx, CHAR_ARMOR_COLORS.length - 1));
  const mi = Math.max(0, Math.min(markColorIdx,  CHAR_MARK_COLORS.length  - 1));
  return {
    bodyColorIdx:  bi, bodyColor:  CHAR_BODY_COLORS[bi],  bodyColorCSS:  CHAR_BODY_COLORS_CSS[bi],
    headgearIdx:   hi, headgear:   CHAR_HEADGEAR_TYPES[hi],
    armorColorIdx: ai, armorColor: CHAR_ARMOR_COLORS[ai], armorColorCSS: CHAR_ARMOR_COLORS_CSS[ai],
    markColorIdx:  mi, markColor:  CHAR_MARK_COLORS[mi],  markColorCSS:  CHAR_MARK_COLORS_CSS[mi],
  };
}

/**
 * Render a character avatar as an HTML string for use in DOM panels.
 * @param {{ bodyColorCSS: string, headgear: string, armorColorCSS: string, markColorCSS: string }} charApp
 * @param {number} [size=36]
 * @returns {string}
 */
export function renderCharHTML(charApp, size = 36) {
  const { bodyColorCSS, headgear, armorColorCSS, markColorCSS } = charApp;
  const headSize  = Math.round(size * 0.55);
  const bodyH     = Math.round(size * 0.55);
  const totalH    = headSize + bodyH - 4;
  const headgearH = _headgearHTML(headgear, headSize, armorColorCSS);
  return `<div class="char-avatar" style="width:${size}px;height:${totalH}px;position:relative;display:inline-block;flex-shrink:0">` +
    `<div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:${size}px;height:${bodyH}px;background:${bodyColorCSS};border-radius:4px 4px 0 0;border:2px solid ${armorColorCSS}"></div>` +
    `<div style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:${headSize}px;height:${headSize}px;background:#FFCDD2;border-radius:50%;border:2px solid ${bodyColorCSS}">` +
      `<div style="position:absolute;top:38%;left:20%;width:${Math.max(2,Math.round(headSize*0.12))}px;height:${Math.max(2,Math.round(headSize*0.12))}px;background:#212121;border-radius:50%"></div>` +
      `<div style="position:absolute;top:38%;right:20%;width:${Math.max(2,Math.round(headSize*0.12))}px;height:${Math.max(2,Math.round(headSize*0.12))}px;background:#212121;border-radius:50%"></div>` +
      `<div style="position:absolute;bottom:14%;left:50%;transform:translateX(-50%);width:${Math.max(2,Math.round(headSize*0.25))}px;height:${Math.max(1,Math.round(headSize*0.08))}px;background:${markColorCSS};border-radius:1px;opacity:0.85"></div>` +
    `</div>` +
    headgearH +
  `</div>`;
}

function _headgearHTML(type, headSize, color) {
  const w = Math.round(headSize * 0.72);
  switch (type) {
    case 'helmet':
      return `<div style="position:absolute;top:-3px;left:50%;transform:translateX(-50%);width:${w}px;height:${Math.round(headSize*0.42)}px;background:${color};border-radius:${Math.round(headSize*0.36)}px ${Math.round(headSize*0.36)}px 0 0;border:2px solid rgba(0,0,0,0.25);z-index:2"></div>`;
    case 'hat':
      return `<div style="position:absolute;top:-5px;left:50%;transform:translateX(-50%);width:${Math.round(headSize*0.5)}px;height:${Math.round(headSize*0.36)}px;background:${color};border-radius:3px 3px 0 0;z-index:2"></div>` +
             `<div style="position:absolute;top:${Math.round(headSize*0.28)}px;left:50%;transform:translateX(-50%);width:${headSize}px;height:4px;background:${color};border-radius:2px;z-index:2"></div>`;
    case 'hood':
      return `<div style="position:absolute;top:-4px;left:50%;transform:translateX(-50%);width:${w}px;height:${Math.round(headSize*0.5)}px;background:${color};clip-path:polygon(10% 100%,50% 0%,90% 100%);opacity:0.8;z-index:2"></div>`;
    case 'crown':
      return `<div style="position:absolute;top:-7px;left:50%;transform:translateX(-50%);width:${w}px;height:${Math.round(headSize*0.32)}px;background:${color};clip-path:polygon(0% 100%,0% 40%,20% 0%,40% 40%,50% 0%,60% 40%,80% 0%,100% 40%,100% 100%);z-index:2"></div>`;
    default: // bare
      return '';
  }
}

// ---------------------------------------------------------------------------
// PixiJS – flag rendering in world space
// ---------------------------------------------------------------------------

/**
 * Draw a modular composite flag into a PixiJS Graphics object.
 *
 * @param {import('pixi.js').Graphics} g
 * @param {number} x  left pixel
 * @param {number} y  top pixel
 * @param {number} w  flag width in pixels
 * @param {number} h  flag height in pixels
 * @param {{ bgColor: string, stripeStyle: string, stripeColor: string, symbolShape: string }} flagApp
 */
export function drawFlagGraphics(g, x, y, w, h, flagApp) {
  const { bgColor, stripeStyle, stripeColor, symbolShape } = flagApp;
  const bg = _cssToNum(bgColor);
  const sc = _cssToNum(stripeColor);

  // Background
  g.rect(x, y, w, h).fill(bg);

  // Stripe overlay
  switch (stripeStyle) {
    case 'horizontal':
      g.rect(x, y + Math.round(h * 0.35), w, Math.round(h * 0.3)).fill({ color: sc, alpha: 0.55 });
      break;
    case 'vertical':
      g.rect(x + Math.round(w * 0.35), y, Math.round(w * 0.3), h).fill({ color: sc, alpha: 0.55 });
      break;
    case 'diagonal': {
      const dx = w * 0.18;
      g.poly([x - dx, y + h, x + w / 2, y, x + w + dx, y + h]).fill({ color: sc, alpha: 0.4 });
      break;
    }
    case 'cross':
      g.rect(x, y + Math.round(h * 0.38), w, Math.round(h * 0.24)).fill({ color: sc, alpha: 0.55 });
      g.rect(x + Math.round(w * 0.38), y, Math.round(w * 0.24), h).fill({ color: sc, alpha: 0.55 });
      break;
    case 'chevron': {
      const mid = Math.round(w * 0.42);
      g.poly([x, y, x + mid, y + h / 2, x, y + h]).fill({ color: sc, alpha: 0.5 });
      break;
    }
    default:
      break;
  }

  // Symbol shape (drawn in white so it's visible on any background)
  _drawSymbolShape(g, x + w / 2, y + h / 2, Math.min(w, h) * 0.26, symbolShape);
}

function _drawSymbolShape(g, cx, cy, r, shape) {
  const color = 0xFFFFFF;
  switch (shape) {
    case 'cross':
      g.rect(cx - r * 0.18, cy - r, r * 0.36, r * 2).fill(color);
      g.rect(cx - r, cy - r * 0.18, r * 2, r * 0.36).fill(color);
      break;
    case 'diamond':
      g.poly([cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy]).fill(color);
      break;
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const rad   = i % 2 === 0 ? r : r * 0.45;
        pts.push(cx + rad * Math.cos(angle), cy + rad * Math.sin(angle));
      }
      g.poly(pts).fill(color);
      break;
    }
    case 'crown':
      g.poly([
        cx - r,       cy + r * 0.3,
        cx - r,       cy - r * 0.4,
        cx - r * 0.4, cy,
        cx,           cy - r,
        cx + r * 0.4, cy,
        cx + r,       cy - r * 0.4,
        cx + r,       cy + r * 0.3,
      ]).fill(color);
      break;
    default: // circle (sun, bolt, flame, wave, bird, dragon, leaf fall back here)
      g.circle(cx, cy, r * 0.65).fill(color);
      break;
  }
}

// ---------------------------------------------------------------------------
// PixiJS – character sprite rendering
// ---------------------------------------------------------------------------

/**
 * Rebuild the inner Graphics of a character sprite container.
 * Caller is responsible for clearing + re-adding children.
 *
 * @param {import('pixi.js').Graphics} g  a fresh Graphics object
 * @param {number} radius  body radius in pixels
 * @param {{ bodyColor: number, headgear: string, armorColor: number, markColor: number }} charApp
 */
export function drawCharGraphics(g, radius, charApp) {
  const { bodyColor, headgear, armorColor, markColor } = charApp;
  const r = radius;

  // Drop shadow
  g.ellipse(0, r * 0.42, r + 3, 5).fill({ color: 0x000000, alpha: 0.25 });

  // Body (main circle = outfit color)
  g.circle(0, 0, r).fill(bodyColor).stroke({ color: armorColor, width: 2 });

  // Face
  g.circle(0, -r * 0.17, r * 0.5).fill(0xFFCDD2);

  // Eyes
  g.circle(-r * 0.22, -r * 0.3, r * 0.12).fill(0x212121);
  g.circle( r * 0.22, -r * 0.3, r * 0.12).fill(0x212121);

  // Accent mark (small rectangle on face/chin area)
  g.rect(-r * 0.1, -r * 0.05, r * 0.2, r * 0.08).fill({ color: markColor, alpha: 0.8 });

  // Headgear
  _drawHeadgear(g, r, headgear, armorColor);

  // Direction indicator (small triangle at top)
  g.poly([0, -(r + 2), -4, -(r + 8), 4, -(r + 8)]).fill(bodyColor);
}

function _drawHeadgear(g, r, type, color) {
  switch (type) {
    case 'helmet':
      // Rounded helmet cap
      g.arc(0, -r * 0.17, r * 0.55, Math.PI, 0).fill({ color, alpha: 0.9 });
      break;
    case 'hat':
      // Flat brim + tall crown
      g.rect(-r * 0.3, -r * 0.62, r * 0.6, r * 0.35).fill(color);
      g.rect(-r * 0.55, -r * 0.67, r * 1.1, r * 0.1).fill(color);
      break;
    case 'hood':
      g.poly([
        -r * 0.55, -r * 0.18,
         0,        -r * 0.85,
         r * 0.55, -r * 0.18,
      ]).fill({ color, alpha: 0.8 });
      break;
    case 'crown':
      g.poly([
        -r * 0.5, -r * 0.5,
        -r * 0.5, -r * 0.78,
        -r * 0.2, -r * 0.62,
         0,       -r * 0.9,
         r * 0.2, -r * 0.62,
         r * 0.5, -r * 0.78,
         r * 0.5, -r * 0.5,
      ]).fill({ color, alpha: 0.95 });
      break;
    default: // bare – nothing extra
      break;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function _cssToNum(css) {
  if (typeof css === 'string' && css.startsWith('#')) {
    const n = parseInt(css.slice(1), 16);
    if (!isNaN(n)) return n;
  }
  return 0xFFFFFF;
}
