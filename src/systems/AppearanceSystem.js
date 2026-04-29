/**
 * AppearanceSystem – modular, seed-deterministic appearance for national flags
 * and character/soldier sprites.
 *
 * Flag appearance   : { bgColor, stripeStyle, stripeColor, symbol, symbolShape }
 * Character appearance: { bodyColorIdx, bodyColor, bodyColorCSS,
 *                         headgearIdx, headgear,
 *                         armorColorIdx, armorColor, armorColorCSS,
 *                         markColorIdx,  markColor,  markColorCSS,
 *                         bodyShapeIdx,  bodyShape,
 *                         faceAccIdx,    faceAcc }
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

export const FLAG_STRIPE_STYLES = [
  'none', 'horizontal', 'vertical', 'diagonal', 'cross', 'chevron',
  'tricolor_h', 'tricolor_v', 'saltire', 'border',
];

/**
 * Legacy emoji symbols kept for NationSystem EMBLEM_TO_SHAPE mapping.
 * The rendered flag always draws the symbol via SVG/PixiJS; this array
 * is only a label/identifier store and is never drawn as text.
 */
export const FLAG_SYMBOLS = [
  '⚔️', '🛡️', '👑', '⭐', '🌙', '☀️', '⚡', '🔥', '🌊', '🦅', '🐉', '🌿',
  '🛡', '🔨', '⚓', '🗼',
];

/** Human-readable labels for FLAG_SYMBOLS / FLAG_SYMBOL_SHAPES (same index). */
export const FLAG_SYMBOL_LABELS = [
  '十字架', '菱形', '王冠', '星形', '圓形', '太陽',
  '閃電', '火焰', '海浪', '鷹鳥', '蛟龍', '葉片',
  '盾牌', '鐵鎚', '錨', '塔樓',
];

/** Pixi-drawable shape IDs aligned with FLAG_SYMBOLS index. */
const _SYMBOL_SHAPES = [
  'cross', 'diamond', 'crown', 'star', 'circle', 'sun',
  'bolt',  'flame',   'wave',  'bird', 'dragon', 'leaf',
  'shield', 'hammer', 'anchor', 'tower',
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

/** Body shape – affects proportions of the character sprite. */
export const CHAR_BODY_SHAPES       = ['standard', 'tall', 'stocky', 'slim'];
export const CHAR_BODY_SHAPE_LABELS = ['標準', '高挑', '壯碩', '纖細'];

/** Face accessory types. */
export const CHAR_FACE_ACCESSORIES       = ['none', 'glasses', 'eyepatch', 'beard', 'mask'];
export const CHAR_FACE_ACCESSORY_LABELS  = ['無', '眼鏡', '眼罩', '鬍鬚', '面罩'];

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
 * Build a flag appearance object from saved index values.
 * @param {{ bgIdx: number, stripeStyleIdx: number, stripeColorIdx: number, symbolIdx: number }} indices
 * @returns {{ bgColor: string, stripeStyle: string, stripeColor: string, symbol: string, symbolShape: string }}
 */
export function flagAppFromIndices({ bgIdx, stripeStyleIdx, stripeColorIdx, symbolIdx }) {
  const bi = Math.max(0, Math.min(bgIdx,         FLAG_BG_COLORS.length     - 1));
  const si = Math.max(0, Math.min(stripeStyleIdx, FLAG_STRIPE_STYLES.length - 1));
  const ci = Math.max(0, Math.min(stripeColorIdx, FLAG_STRIPE_COLORS.length - 1));
  const yi = Math.max(0, Math.min(symbolIdx,       FLAG_SYMBOLS.length       - 1));
  return {
    bgColor:     FLAG_BG_COLORS[bi],
    stripeStyle: FLAG_STRIPE_STYLES[si],
    stripeColor: FLAG_STRIPE_COLORS[ci],
    symbol:      FLAG_SYMBOLS[yi],
    symbolShape: _SYMBOL_SHAPES[yi],
  };
}

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
 * Render an inline SVG flag symbol for HTML use.
 * @param {string} shape  symbolShape identifier
 * @param {number} size   SVG canvas size (square)
 * @param {string} [fill='#FFFFFF']
 * @returns {string} complete <svg> element string
 */
function _svgFlagSymbol(shape, size, fill = '#FFFFFF') {
  const cx = size / 2, cy = size / 2, r = size * 0.32;
  let c = '';
  switch (shape) {
    case 'cross':
      c = `<rect x="${cx-r*0.18}" y="${cy-r}" width="${r*0.36}" height="${r*2}" fill="${fill}"/>` +
          `<rect x="${cx-r}" y="${cy-r*0.18}" width="${r*2}" height="${r*0.36}" fill="${fill}"/>`;
      break;
    case 'diamond':
      c = `<polygon points="${cx},${cy-r} ${cx+r},${cy} ${cx},${cy+r} ${cx-r},${cy}" fill="${fill}"/>`;
      break;
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        const rd = i % 2 === 0 ? r : r * 0.45;
        pts.push(`${cx + rd * Math.cos(a)},${cy + rd * Math.sin(a)}`);
      }
      c = `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
      break;
    }
    case 'crown':
      c = `<polygon points="${cx-r},${cy+r*0.3} ${cx-r},${cy-r*0.4} ${cx-r*0.4},${cy} ${cx},${cy-r} ${cx+r*0.4},${cy} ${cx+r},${cy-r*0.4} ${cx+r},${cy+r*0.3}" fill="${fill}"/>`;
      break;
    case 'sun': {
      c = `<circle cx="${cx}" cy="${cy}" r="${r*0.4}" fill="${fill}"/>`;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        c += `<line x1="${cx + r*0.52*Math.cos(a)}" y1="${cy + r*0.52*Math.sin(a)}" x2="${cx + r*Math.cos(a)}" y2="${cy + r*Math.sin(a)}" stroke="${fill}" stroke-width="${r*0.18}" stroke-linecap="round"/>`;
      }
      break;
    }
    case 'circle':
      c = `<circle cx="${cx}" cy="${cy}" r="${r*0.65}" fill="${fill}"/>`;
      break;
    case 'bolt':
      c = `<polygon points="${cx+r*0.2},${cy-r} ${cx-r*0.15},${cy-r*0.05} ${cx+r*0.28},${cy-r*0.05} ${cx-r*0.2},${cy+r} ${cx+r*0.15},${cy+r*0.05} ${cx-r*0.28},${cy+r*0.05}" fill="${fill}"/>`;
      break;
    case 'flame':
      c = `<path d="M${cx},${cy+r} C${cx-r*0.7},${cy+r*0.3} ${cx-r*0.6},${cy-r*0.3} ${cx-r*0.2},${cy-r*0.5} C${cx-r*0.3},${cy-r*0.7} ${cx},${cy-r} C${cx+r*0.1},${cy-r*0.7} ${cx+r*0.4},${cy-r*0.5} ${cx+r*0.6},${cy-r*0.3} C${cx+r*0.7},${cy+r*0.3} ${cx},${cy+r} Z" fill="${fill}"/>`;
      break;
    case 'wave': {
      const sw = r * 0.22;
      c = `<path d="M${cx-r},${cy-r*0.1} Q${cx-r*0.5},${cy-r*0.55} ${cx},${cy-r*0.1} Q${cx+r*0.5},${cy+r*0.35} ${cx+r},${cy-r*0.1}" stroke="${fill}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>` +
          `<path d="M${cx-r},${cy+r*0.35} Q${cx-r*0.5},${cy-r*0.1} ${cx},${cy+r*0.35} Q${cx+r*0.5},${cy+r*0.8} ${cx+r},${cy+r*0.35}" stroke="${fill}" stroke-width="${sw*0.85}" fill="none" stroke-linecap="round"/>`;
      break;
    }
    case 'bird':
      c = `<polygon points="${cx},${cy} ${cx-r},${cy-r*0.55} ${cx-r*0.3},${cy-r*0.25} ${cx},${cy-r*0.65} ${cx+r*0.3},${cy-r*0.25} ${cx+r},${cy-r*0.55}" fill="${fill}"/>` +
          `<ellipse cx="${cx}" cy="${cy+r*0.25}" rx="${r*0.18}" ry="${r*0.42}" fill="${fill}"/>`;
      break;
    case 'dragon':
      c = `<circle cx="${cx-r*0.8}" cy="${cy+r*0.25}" r="${r*0.22}" fill="${fill}"/>` +
          `<path d="M${cx-r*0.58},${cy+r*0.25} Q${cx-r*0.3},${cy-r*0.5} ${cx},${cy-r*0.15} Q${cx+r*0.3},${cy+r*0.45} ${cx+r*0.6},${cy-r*0.2} Q${cx+r*0.85},${cy-r*0.5} ${cx+r},${cy-r*0.25}" stroke="${fill}" stroke-width="${r*0.28}" fill="none" stroke-linecap="round"/>`;
      break;
    case 'leaf':
      c = `<path d="M${cx},${cy+r} C${cx-r*0.75},${cy+r*0.3} ${cx-r*0.75},${cy-r*0.3} ${cx},${cy-r} C${cx+r*0.75},${cy-r*0.3} ${cx+r*0.75},${cy+r*0.3} ${cx},${cy+r} Z" fill="${fill}"/>` +
          `<line x1="${cx}" y1="${cy+r}" x2="${cx}" y2="${cy-r}" stroke="rgba(0,0,0,0.3)" stroke-width="${r*0.1}"/>`;
      break;
    case 'shield':
      c = `<path d="M${cx-r},${cy-r*0.4} L${cx+r},${cy-r*0.4} L${cx+r},${cy+r*0.15} Q${cx+r},${cy+r} ${cx},${cy+r} Q${cx-r},${cy+r} ${cx-r},${cy+r*0.15} Z" fill="${fill}"/>`;
      break;
    case 'hammer':
      c = `<rect x="${cx-r*0.12}" y="${cy-r*0.25}" width="${r*0.24}" height="${r*1.25}" fill="${fill}" rx="${r*0.05}"/>` +
          `<rect x="${cx-r*0.58}" y="${cy-r}" width="${r*1.16}" height="${r*0.52}" fill="${fill}" rx="${r*0.08}"/>`;
      break;
    case 'anchor': {
      const sw2 = r * 0.17;
      c = `<circle cx="${cx}" cy="${cy-r*0.62}" r="${r*0.28}" fill="none" stroke="${fill}" stroke-width="${sw2}"/>` +
          `<line x1="${cx}" y1="${cy-r*0.34}" x2="${cx}" y2="${cy+r}" stroke="${fill}" stroke-width="${sw2}"/>` +
          `<line x1="${cx-r*0.62}" y1="${cy+r*0.5}" x2="${cx+r*0.62}" y2="${cy+r*0.5}" stroke="${fill}" stroke-width="${sw2*0.88}"/>` +
          `<path d="M${cx-r*0.62},${cy+r*0.5} Q${cx-r*0.75},${cy+r*0.9} ${cx-r*0.38},${cy+r}" stroke="${fill}" stroke-width="${sw2*0.88}" fill="none"/>` +
          `<path d="M${cx+r*0.62},${cy+r*0.5} Q${cx+r*0.75},${cy+r*0.9} ${cx+r*0.38},${cy+r}" stroke="${fill}" stroke-width="${sw2*0.88}" fill="none"/>`;
      break;
    }
    case 'tower':
      c = `<rect x="${cx-r*0.48}" y="${cy-r*0.28}" width="${r*0.96}" height="${r*1.28}" fill="${fill}" rx="${r*0.04}"/>` +
          `<rect x="${cx-r*0.65}" y="${cy-r}" width="${r*0.28}" height="${r*0.52}" fill="${fill}"/>` +
          `<rect x="${cx-r*0.14}" y="${cy-r}" width="${r*0.28}" height="${r*0.52}" fill="${fill}"/>` +
          `<rect x="${cx+r*0.37}" y="${cy-r}" width="${r*0.28}" height="${r*0.52}" fill="${fill}"/>`;
      break;
    default:
      c = `<circle cx="${cx}" cy="${cy}" r="${r*0.65}" fill="${fill}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="position:relative;z-index:1;flex-shrink:0">${c}</svg>`;
}

/**
 * Render a flag as an HTML string suitable for DOM insertion.
 * The symbol is drawn as an inline SVG (no emoji).
 * @param {{ bgColor: string, stripeStyle: string, stripeColor: string, symbolShape: string }} flagApp
 * @param {number} [size=32]   width in px (height = 70 % of width)
 * @returns {string}
 */
export function renderFlagHTML(flagApp, size = 32) {
  const { bgColor, stripeStyle, stripeColor, symbolShape } = flagApp;
  const h   = Math.round(size * 0.7);
  const stripe = _stripeHTML(stripeStyle, stripeColor, size, h);
  const symSize = Math.round(size * 0.52);
  const sym  = _svgFlagSymbol(symbolShape ?? 'circle', symSize);
  return `<div class="flag-badge" style="width:${size}px;height:${h}px;background:${bgColor};position:relative;display:inline-flex;align-items:center;justify-content:center;border-radius:2px;overflow:hidden;border:1px solid rgba(255,255,255,0.25);flex-shrink:0">${stripe}${sym}</div>`;
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
    case 'tricolor_h':
      return `<div style="${s}left:0;top:0;width:100%;height:${Math.round(h/3)}px"></div>` +
             `<div style="${s}left:0;bottom:0;width:100%;height:${Math.round(h/3)}px"></div>`;
    case 'tricolor_v':
      return `<div style="${s}top:0;left:0;width:${Math.round(w/3)}px;height:100%"></div>` +
             `<div style="${s}top:0;right:0;width:${Math.round(w/3)}px;height:100%"></div>`;
    case 'saltire': {
      const bw = Math.round(h * 0.18);
      return `<div style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;opacity:0.5">` +
             `<div style="position:absolute;background:${color};width:${Math.round(Math.hypot(w,h)*1.1)}px;height:${bw}px;top:50%;left:50%;transform:translate(-50%,-50%) rotate(${Math.round(Math.atan2(h,w)*180/Math.PI)}deg);transform-origin:center"></div>` +
             `<div style="position:absolute;background:${color};width:${Math.round(Math.hypot(w,h)*1.1)}px;height:${bw}px;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-${Math.round(Math.atan2(h,w)*180/Math.PI)}deg);transform-origin:center"></div>` +
             `</div>`;
    }
    case 'border': {
      const bw = Math.round(Math.min(w, h) * 0.14);
      return `<div style="position:absolute;top:0;left:0;right:0;bottom:0;border:${bw}px solid ${color};opacity:0.6;box-sizing:border-box;pointer-events:none"></div>`;
    }
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
 *             markColorIdx: number, markColor: number, markColorCSS: string,
 *             bodyShapeIdx: number, bodyShape: string,
 *             faceAccIdx: number, faceAcc: string }}
 */
export function generateCharAppearance(s1, s2) {
  const bi  = _idx(CHAR_BODY_COLORS,       _hash(s1, s2, 10));
  const hi  = _idx(CHAR_HEADGEAR_TYPES,    _hash(s1, s2, 11));
  const ai  = _idx(CHAR_ARMOR_COLORS,      _hash(s1, s2, 12));
  const mi  = _idx(CHAR_MARK_COLORS,       _hash(s1, s2, 13));
  const bsi = _idx(CHAR_BODY_SHAPES,       _hash(s1, s2, 14));
  const fai = _idx(CHAR_FACE_ACCESSORIES,  _hash(s1, s2, 15));
  return {
    bodyColorIdx:  bi,  bodyColor:  CHAR_BODY_COLORS[bi],  bodyColorCSS:  CHAR_BODY_COLORS_CSS[bi],
    headgearIdx:   hi,  headgear:   CHAR_HEADGEAR_TYPES[hi],
    armorColorIdx: ai,  armorColor: CHAR_ARMOR_COLORS[ai], armorColorCSS: CHAR_ARMOR_COLORS_CSS[ai],
    markColorIdx:  mi,  markColor:  CHAR_MARK_COLORS[mi],  markColorCSS:  CHAR_MARK_COLORS_CSS[mi],
    bodyShapeIdx:  bsi, bodyShape:  CHAR_BODY_SHAPES[bsi],
    faceAccIdx:    fai, faceAcc:    CHAR_FACE_ACCESSORIES[fai],
  };
}

/**
 * Build a character appearance object from saved index values.
 * @param {{ bodyColorIdx: number, headgearIdx: number, armorColorIdx: number, markColorIdx: number,
 *           bodyShapeIdx?: number, faceAccIdx?: number }} indices
 * @returns {ReturnType<typeof generateCharAppearance>}
 */
export function charAppearanceFromIndices({ bodyColorIdx, headgearIdx, armorColorIdx, markColorIdx, bodyShapeIdx = 0, faceAccIdx = 0 }) {
  const bi  = Math.max(0, Math.min(bodyColorIdx,  CHAR_BODY_COLORS.length      - 1));
  const hi  = Math.max(0, Math.min(headgearIdx,   CHAR_HEADGEAR_TYPES.length   - 1));
  const ai  = Math.max(0, Math.min(armorColorIdx, CHAR_ARMOR_COLORS.length     - 1));
  const mi  = Math.max(0, Math.min(markColorIdx,  CHAR_MARK_COLORS.length      - 1));
  const bsi = Math.max(0, Math.min(bodyShapeIdx ?? 0,  CHAR_BODY_SHAPES.length      - 1));
  const fai = Math.max(0, Math.min(faceAccIdx  ?? 0,  CHAR_FACE_ACCESSORIES.length - 1));
  return {
    bodyColorIdx:  bi,  bodyColor:  CHAR_BODY_COLORS[bi],  bodyColorCSS:  CHAR_BODY_COLORS_CSS[bi],
    headgearIdx:   hi,  headgear:   CHAR_HEADGEAR_TYPES[hi],
    armorColorIdx: ai,  armorColor: CHAR_ARMOR_COLORS[ai], armorColorCSS: CHAR_ARMOR_COLORS_CSS[ai],
    markColorIdx:  mi,  markColor:  CHAR_MARK_COLORS[mi],  markColorCSS:  CHAR_MARK_COLORS_CSS[mi],
    bodyShapeIdx:  bsi, bodyShape:  CHAR_BODY_SHAPES[bsi],
    faceAccIdx:    fai, faceAcc:    CHAR_FACE_ACCESSORIES[fai],
  };
}

/**
 * Render a character avatar as an HTML string for use in DOM panels.
 * @param {{ bodyColorCSS: string, headgear: string, armorColorCSS: string, markColorCSS: string,
 *           bodyShape?: string, faceAcc?: string }} charApp
 * @param {number} [size=36]
 * @returns {string}
 */
export function renderCharHTML(charApp, size = 36) {
  const {
    bodyColorCSS, headgear, armorColorCSS, markColorCSS,
    bodyShape = 'standard', faceAcc = 'none',
  } = charApp;

  // Body shape modifiers (relative width / height multipliers)
  const _bp = { standard: [1.0, 1.0], tall: [0.82, 1.3], stocky: [1.28, 0.88], slim: [0.68, 1.12] };
  const [bwMult, bhMult] = _bp[bodyShape] ?? _bp.standard;

  const headSize = Math.round(size * 0.55);
  const bodyW    = Math.round(size * bwMult);
  const bodyH    = Math.round(size * 0.55 * bhMult);
  const totalH   = headSize + bodyH - 4;
  const bodyLeft = Math.round((size - bodyW) / 2);

  const headgearH = _headgearHTML(headgear, headSize, armorColorCSS);
  const faceAccH  = _faceAccHTML(faceAcc, headSize, markColorCSS);

  return `<div class="char-avatar" style="width:${size}px;height:${totalH}px;position:relative;display:inline-block;flex-shrink:0">` +
    `<div style="position:absolute;bottom:0;left:${bodyLeft}px;width:${bodyW}px;height:${bodyH}px;background:${bodyColorCSS};border-radius:4px 4px 0 0;border:2px solid ${armorColorCSS}"></div>` +
    `<div style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:${headSize}px;height:${headSize}px;background:#FFCDD2;border-radius:50%;border:2px solid ${bodyColorCSS}">` +
      `<div style="position:absolute;top:38%;left:20%;width:${Math.max(2,Math.round(headSize*0.12))}px;height:${Math.max(2,Math.round(headSize*0.12))}px;background:#212121;border-radius:50%"></div>` +
      `<div style="position:absolute;top:38%;right:20%;width:${Math.max(2,Math.round(headSize*0.12))}px;height:${Math.max(2,Math.round(headSize*0.12))}px;background:#212121;border-radius:50%"></div>` +
      `<div style="position:absolute;bottom:14%;left:50%;transform:translateX(-50%);width:${Math.max(2,Math.round(headSize*0.25))}px;height:${Math.max(1,Math.round(headSize*0.08))}px;background:${markColorCSS};border-radius:1px;opacity:0.85"></div>` +
      faceAccH +
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

/**
 * Render a face accessory as an HTML string positioned over the head element.
 * @param {string} type  one of CHAR_FACE_ACCESSORIES
 * @param {number} headSize
 * @param {string} color  accent/mark colour
 * @returns {string}
 */
function _faceAccHTML(type, headSize, color) {
  switch (type) {
    case 'glasses': {
      const ew   = Math.round(headSize * 0.22);
      const top  = Math.round(headSize * 0.32);
      const lL   = Math.round(headSize * 0.08);
      const lR   = Math.round(headSize * 0.58);
      const bw   = Math.max(1, Math.round(headSize * 0.06));
      const brid = Math.max(1, Math.round(headSize * 0.04));
      return `<div style="position:absolute;top:${top}px;left:${lL}px;width:${ew}px;height:${ew}px;border-radius:50%;border:${bw}px solid ${color};z-index:3"></div>` +
             `<div style="position:absolute;top:${top}px;left:${lR}px;width:${ew}px;height:${ew}px;border-radius:50%;border:${bw}px solid ${color};z-index:3"></div>` +
             `<div style="position:absolute;top:${top + Math.round(ew/2) - brid}px;left:${lL+ew}px;width:${lR-lL-ew}px;height:${brid*2}px;background:${color};z-index:3"></div>`;
    }
    case 'eyepatch': {
      const ep   = Math.round(headSize * 0.24);
      const top  = Math.round(headSize * 0.3);
      const lL   = Math.round(headSize * 0.08);
      const str  = Math.max(1, Math.round(headSize * 0.05));
      return `<div style="position:absolute;top:${top}px;left:${lL}px;width:${ep}px;height:${ep}px;border-radius:50%;background:${color};opacity:0.92;z-index:3"></div>` +
             `<div style="position:absolute;top:${top + Math.round(ep/2) - Math.floor(str/2)}px;left:0;width:${lL + ep}px;height:${str}px;background:${color};opacity:0.75;z-index:3"></div>`;
    }
    case 'beard': {
      const bw = Math.round(headSize * 0.5);
      const bh = Math.round(headSize * 0.24);
      const bl = Math.round((headSize - bw) / 2);
      const bt = Math.round(headSize * 0.6);
      return `<div style="position:absolute;top:${bt}px;left:${bl}px;width:${bw}px;height:${bh}px;background:${color};border-radius:0 0 ${Math.round(bw/2)}px ${Math.round(bw/2)}px;opacity:0.82;z-index:3"></div>`;
    }
    case 'mask': {
      const mh = Math.round(headSize * 0.32);
      const mt = Math.round(headSize * 0.48);
      return `<div style="position:absolute;top:${mt}px;left:0;right:0;height:${mh}px;background:${color};opacity:0.7;border-radius:0 0 50% 50%;z-index:3"></div>`;
    }
    default:
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
  const bg = cssToNum(bgColor);
  const sc = cssToNum(stripeColor);

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
    case 'tricolor_h':
      g.rect(x, y,                         w, Math.round(h / 3)).fill({ color: sc, alpha: 0.55 });
      g.rect(x, y + Math.round(h * 2 / 3), w, Math.round(h / 3)).fill({ color: sc, alpha: 0.55 });
      break;
    case 'tricolor_v':
      g.rect(x,                         y, Math.round(w / 3), h).fill({ color: sc, alpha: 0.55 });
      g.rect(x + Math.round(w * 2 / 3), y, Math.round(w / 3), h).fill({ color: sc, alpha: 0.55 });
      break;
    case 'saltire': {
      const bw = Math.round(h * 0.18);
      const hw = bw / 2;
      g.poly([x, y, x + hw, y, x + w / 2, y + h / 2 - hw, x + w - hw, y, x + w, y,
              x + w, y + hw, x + w / 2 + hw, y + h / 2, x + w, y + h - hw,
              x + w, y + h, x + w - hw, y + h, x + w / 2, y + h / 2 + hw, x + hw, y + h,
              x, y + h, x, y + h - hw, x + w / 2 - hw, y + h / 2, x, y + hw])
        .fill({ color: sc, alpha: 0.45 });
      break;
    }
    case 'border': {
      const bw = Math.round(Math.min(w, h) * 0.14);
      g.rect(x,          y,          w,  bw).fill({ color: sc, alpha: 0.6 });
      g.rect(x,          y + h - bw, w,  bw).fill({ color: sc, alpha: 0.6 });
      g.rect(x,          y + bw,     bw, h - 2 * bw).fill({ color: sc, alpha: 0.6 });
      g.rect(x + w - bw, y + bw,     bw, h - 2 * bw).fill({ color: sc, alpha: 0.6 });
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
    case 'sun':
      g.circle(cx, cy, r * 0.4).fill(color);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        g.poly([
          cx + r * 0.5 * Math.cos(a) - r * 0.08 * Math.sin(a),
          cy + r * 0.5 * Math.sin(a) + r * 0.08 * Math.cos(a),
          cx + r * Math.cos(a),
          cy + r * Math.sin(a),
          cx + r * 0.5 * Math.cos(a) + r * 0.08 * Math.sin(a),
          cy + r * 0.5 * Math.sin(a) - r * 0.08 * Math.cos(a),
        ]).fill(color);
      }
      break;
    case 'bolt':
      g.poly([
        cx + r * 0.2,  cy - r,
        cx - r * 0.15, cy - r * 0.05,
        cx + r * 0.28, cy - r * 0.05,
        cx - r * 0.2,  cy + r,
        cx + r * 0.15, cy + r * 0.05,
        cx - r * 0.28, cy + r * 0.05,
      ]).fill(color);
      break;
    case 'flame':
      g.poly([
        cx,            cy + r,
        cx - r * 0.6,  cy + r * 0.3,
        cx - r * 0.5,  cy - r * 0.3,
        cx - r * 0.2,  cy - r * 0.5,
        cx,            cy - r,
        cx + r * 0.2,  cy - r * 0.6,
        cx + r * 0.5,  cy - r * 0.2,
        cx + r * 0.5,  cy + r * 0.3,
      ]).fill(color);
      break;
    case 'wave': {
      const steps = 16;
      for (let wave = 0; wave < 2; wave++) {
        const baseY = cy + (wave - 0.5) * r * 0.55;
        const pts = [];
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          pts.push(
            cx - r + t * 2 * r,
            baseY + Math.sin(t * Math.PI * 2 + wave * Math.PI) * r * 0.22,
          );
        }
        g.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
        g.stroke({ color, width: r * 0.2 });
      }
      break;
    }
    case 'bird':
      g.poly([
        cx,           cy,
        cx - r,       cy - r * 0.55,
        cx - r * 0.3, cy - r * 0.25,
        cx,           cy - r * 0.65,
        cx + r * 0.3, cy - r * 0.25,
        cx + r,       cy - r * 0.55,
      ]).fill(color);
      g.ellipse(cx, cy + r * 0.2, r * 0.18, r * 0.42).fill(color);
      break;
    case 'dragon': {
      g.circle(cx - r * 0.82, cy + r * 0.25, r * 0.22).fill(color);
      const dPts = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        dPts.push(cx - r * 0.6 + t * 1.6 * r, cy + r * 0.25 + Math.sin(t * Math.PI * 2) * r * 0.35);
      }
      g.moveTo(dPts[0], dPts[1]);
      for (let i = 2; i < dPts.length; i += 2) g.lineTo(dPts[i], dPts[i + 1]);
      g.stroke({ color, width: r * 0.25 });
      break;
    }
    case 'leaf':
      g.poly([cx, cy - r, cx + r * 0.68, cy, cx, cy + r, cx - r * 0.68, cy]).fill(color);
      break;
    case 'shield':
      g.poly([
        cx - r,       cy - r * 0.4,
        cx + r,       cy - r * 0.4,
        cx + r,       cy + r * 0.15,
        cx,           cy + r,
        cx - r,       cy + r * 0.15,
      ]).fill(color);
      break;
    case 'hammer':
      g.rect(cx - r * 0.12, cy - r * 0.25, r * 0.24, r * 1.25).fill(color);
      g.rect(cx - r * 0.58, cy - r,         r * 1.16, r * 0.52).fill(color);
      break;
    case 'anchor': {
      const aw = r * 0.18;
      g.circle(cx, cy - r * 0.62, r * 0.28).stroke({ color, width: aw });
      g.moveTo(cx, cy - r * 0.34).lineTo(cx, cy + r).stroke({ color, width: aw });
      g.moveTo(cx - r * 0.62, cy + r * 0.5).lineTo(cx + r * 0.62, cy + r * 0.5).stroke({ color, width: aw * 0.88 });
      const pts1 = [];
      const pts2 = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const a = Math.PI + t * Math.PI / 2;
        pts1.push(cx - r * 0.62 + Math.cos(a) * r * 0.2, cy + r * 0.7 + Math.sin(a) * r * 0.3);
        pts2.push(cx + r * 0.62 - Math.cos(a) * r * 0.2, cy + r * 0.7 + Math.sin(a) * r * 0.3);
      }
      g.moveTo(pts1[0], pts1[1]);
      for (let i = 2; i < pts1.length; i += 2) g.lineTo(pts1[i], pts1[i + 1]);
      g.stroke({ color, width: aw * 0.88 });
      g.moveTo(pts2[0], pts2[1]);
      for (let i = 2; i < pts2.length; i += 2) g.lineTo(pts2[i], pts2[i + 1]);
      g.stroke({ color, width: aw * 0.88 });
      break;
    }
    case 'tower':
      g.rect(cx - r * 0.48, cy - r * 0.28, r * 0.96, r * 1.28).fill(color);
      g.rect(cx - r * 0.65, cy - r,         r * 0.28,  r * 0.52).fill(color);
      g.rect(cx - r * 0.14, cy - r,         r * 0.28,  r * 0.52).fill(color);
      g.rect(cx + r * 0.37, cy - r,         r * 0.28,  r * 0.52).fill(color);
      break;
    default: // circle fallback
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
 * @param {{ bodyColor: number, headgear: string, armorColor: number, markColor: number,
 *           bodyShape?: string, faceAcc?: string }} charApp
 */
export function drawCharGraphics(g, radius, charApp) {
  const { bodyColor, headgear, armorColor, markColor, bodyShape = 'standard', faceAcc = 'none' } = charApp;
  const r = radius;

  // Body shape multipliers
  const _sc = { standard: [1.0, 1.0], tall: [0.82, 1.15], stocky: [1.28, 0.88], slim: [0.68, 1.12] };
  const [rxMul, ryMul] = _sc[bodyShape] ?? _sc.standard;
  const rx = r * rxMul;
  const ry = r * ryMul;

  // Drop shadow
  g.ellipse(0, ry * 0.42, rx + 3, 5).fill({ color: 0x000000, alpha: 0.25 });

  // Body (ellipse = outfit color)
  g.ellipse(0, 0, rx, ry).fill(bodyColor).stroke({ color: armorColor, width: 2 });

  // Face circle (positioned relative to body top)
  const faceY = -(ry * 0.2);
  g.circle(0, faceY, r * 0.5).fill(0xFFCDD2);

  // Eyes
  g.circle(-r * 0.22, faceY - r * 0.12, r * 0.12).fill(0x212121);
  g.circle( r * 0.22, faceY - r * 0.12, r * 0.12).fill(0x212121);

  // Face accessory (glasses / eyepatch / beard / mask)
  _drawFaceAcc(g, r, faceY, faceAcc, markColor);

  // Accent mark (small rectangle on face/chin area)
  g.rect(-r * 0.1, faceY + r * 0.08, r * 0.2, r * 0.08).fill({ color: markColor, alpha: 0.8 });

  // Headgear
  _drawHeadgear(g, r, ry, faceY, headgear, armorColor);

  // Direction indicator (small triangle at top of body)
  g.poly([0, -(ry + 2), -4, -(ry + 8), 4, -(ry + 8)]).fill(bodyColor);
}

function _drawFaceAcc(g, r, faceY, type, color) {
  switch (type) {
    case 'glasses': {
      const eyeY = faceY - r * 0.12;
      g.circle(-r * 0.22, eyeY, r * 0.15).stroke({ color, width: r * 0.06 });
      g.circle( r * 0.22, eyeY, r * 0.15).stroke({ color, width: r * 0.06 });
      g.moveTo(-r * 0.07, eyeY).lineTo(r * 0.07, eyeY).stroke({ color, width: r * 0.06 });
      break;
    }
    case 'eyepatch': {
      const eyeY = faceY - r * 0.12;
      g.circle(-r * 0.22, eyeY, r * 0.17).fill({ color, alpha: 0.92 });
      g.moveTo(-r * 0.5, eyeY).lineTo(-r * 0.05, eyeY).stroke({ color, width: r * 0.06 });
      break;
    }
    case 'beard':
      g.ellipse(0, faceY + r * 0.28, r * 0.32, r * 0.16).fill({ color, alpha: 0.82 });
      break;
    case 'mask':
      g.rect(-r * 0.38, faceY + r * 0.04, r * 0.76, r * 0.28).fill({ color, alpha: 0.7 });
      break;
    default:
      break;
  }
}

function _drawHeadgear(g, r, ry, faceY, type, color) {
  switch (type) {
    case 'helmet':
      g.arc(0, faceY, r * 0.55, Math.PI, 0).fill({ color, alpha: 0.9 });
      break;
    case 'hat':
      g.rect(-r * 0.3, faceY - r * 0.45, r * 0.6, r * 0.35).fill(color);
      g.rect(-r * 0.55, faceY - r * 0.5, r * 1.1, r * 0.1).fill(color);
      break;
    case 'hood':
      g.poly([
        -r * 0.55, faceY + r * 0.05,
         0,        faceY - r * 0.7,
         r * 0.55, faceY + r * 0.05,
      ]).fill({ color, alpha: 0.8 });
      break;
    case 'crown':
      g.poly([
        -r * 0.5, faceY - r * 0.28,
        -r * 0.5, faceY - r * 0.58,
        -r * 0.2, faceY - r * 0.42,
         0,       faceY - r * 0.7,
         r * 0.2, faceY - r * 0.42,
         r * 0.5, faceY - r * 0.58,
         r * 0.5, faceY - r * 0.28,
      ]).fill({ color, alpha: 0.95 });
      break;
    default: // bare – nothing extra
      break;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function cssToNum(css) {
  if (typeof css === 'string' && css.startsWith('#')) {
    const n = parseInt(css.slice(1), 16);
    if (!isNaN(n)) return n;
  }
  return 0xFFFFFF;
}
