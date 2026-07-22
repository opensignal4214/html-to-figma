/*
 * Pure CSS-value → Figma-value mapping. No DOM, no Node APIs.
 *
 * This module runs in two places:
 *  - Node, imported normally (unit tests, future backends)
 *  - the browser page, injected by src/extract.js with the `export ` keywords
 *    stripped and every exported function exposed on window.__cssMap
 *
 * Keep it dependency-free and use only `export function` declarations at the
 * top level so the injection transform stays trivial.
 */

const round = (v) => {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r; // normalize -0
};

const ALIGN_PRIMARY = {
  'flex-start': 'MIN', start: 'MIN', left: 'MIN', normal: 'MIN',
  center: 'CENTER',
  'flex-end': 'MAX', end: 'MAX', right: 'MAX',
  'space-between': 'SPACE_BETWEEN', 'space-around': 'SPACE_BETWEEN', 'space-evenly': 'SPACE_BETWEEN',
};

const ALIGN_COUNTER = {
  'flex-start': 'MIN', start: 'MIN', normal: 'MIN', stretch: 'MIN',
  center: 'CENTER',
  'flex-end': 'MAX', end: 'MAX',
  baseline: 'BASELINE',
};

const TEXT_ALIGN = { left: 'LEFT', start: 'LEFT', center: 'CENTER', right: 'RIGHT', end: 'RIGHT', justify: 'JUSTIFIED' };
const TEXT_CASE = { uppercase: 'UPPER', lowercase: 'LOWER', capitalize: 'TITLE' };

/** 'rgb(a)' string → {r,g,b,a} in 0..1, or null for transparent/invalid. */
export function parseColor(str) {
  if (!str) return null;
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s));
  const a = parts.length > 3 ? parts[3] : 1;
  if (!(a > 0)) return null;
  return { r: round(parts[0] / 255), g: round(parts[1] / 255), b: round(parts[2] / 255), a: round(a) };
}

/** Split a CSS value list on top-level commas (commas inside rgba() don't count). */
export function splitTopLevel(str) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((s) => s.trim());
}

/** box-shadow value → [{x, y, blur, spread, inset, color}] or null. */
export function parseShadows(str) {
  if (!str || str === 'none') return null;
  const shadows = splitTopLevel(str)
    .map((s) => {
      const color = parseColor(s);
      if (!color) return null;
      const nums = (s.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g) || []).map(parseFloat);
      return {
        x: nums[0] || 0,
        y: nums[1] || 0,
        blur: nums[2] || 0,
        spread: nums[3] || 0,
        inset: s.includes('inset'),
        color,
      };
    })
    .filter(Boolean);
  return shadows.length ? shadows : null;
}

/**
 * First linear-gradient() in a background-image value → Figma gradient
 * { stops: [{color, position}], transform } or null. The transform's first row
 * maps normalized box coords (x, y, 1) to the gradient position t.
 */
export function parseLinearGradient(bgImage) {
  const start = String(bgImage).indexOf('linear-gradient(');
  if (start === -1) return null;
  let i = start + 'linear-gradient('.length;
  let depth = 1;
  let body = '';
  while (i < bgImage.length && depth > 0) {
    const ch = bgImage[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth > 0) body += ch;
    i++;
  }
  const parts = splitTopLevel(body);
  if (!parts.length) return null;

  let angleDeg = 180; // CSS default: to bottom
  let stopParts = parts;
  const first = parts[0];
  if (/deg|grad|rad|turn/.test(first) && !/rgb/.test(first)) {
    const v = parseFloat(first);
    if (first.includes('turn')) angleDeg = v * 360;
    else if (first.includes('grad')) angleDeg = v * 0.9;
    else if (first.includes('rad')) angleDeg = (v * 180) / Math.PI;
    else angleDeg = v;
    stopParts = parts.slice(1);
  } else if (first.startsWith('to ')) {
    const dirs = { top: 0, right: 90, bottom: 180, left: 270 };
    const words = first.slice(3).trim().split(/\s+/);
    if (words.length === 1) angleDeg = dirs[words[0]] ?? 180;
    else {
      // corner: average of the two side angles (approximation)
      const a1 = dirs[words[0]] ?? 0;
      const a2 = dirs[words[1]] ?? 0;
      const diff = ((a2 - a1 + 540) % 360) - 180;
      angleDeg = (a1 + diff / 2 + 360) % 360;
    }
    stopParts = parts.slice(1);
  }

  const stops = [];
  for (const part of stopParts) {
    const color = parseColor(part);
    if (!color) continue;
    const posMatch = part.replace(/rgba?\([^)]*\)/, '').match(/(-?[\d.]+)%/);
    stops.push({ color, position: posMatch ? parseFloat(posMatch[1]) / 100 : null });
  }
  if (stops.length < 2) return null;
  if (stops[0].position === null) stops[0].position = 0;
  if (stops[stops.length - 1].position === null) stops[stops.length - 1].position = 1;
  for (let s = 1; s < stops.length - 1; s++) {
    if (stops[s].position === null) {
      let next = s;
      while (stops[next].position === null) next++;
      const prev = stops[s - 1].position;
      stops[s].position = prev + (stops[next].position - prev) / (next - s + 1);
    }
  }
  for (const s of stops) s.position = Math.min(1, Math.max(0, s.position));

  // CSS angle: 0deg = to top, 90deg = to right. Compute the gradient line on
  // the unit box, then build the inverse transform whose first row is t(x, y).
  const theta = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(theta);
  const dy = -Math.cos(theta); // screen y goes down
  const len = Math.abs(dx) + Math.abs(dy) || 1; // CSS gradient-line length on unit box
  const ax = 0.5 - (dx * len) / 2;
  const ay = 0.5 - (dy * len) / 2;
  const ux = dx / len;
  const uy = dy / len;
  const transform = [
    [round(ux), round(uy), round(-(ax * ux + ay * uy))],
    [round(-uy), round(ux), round(-(ax * -uy + ay * ux))],
  ];
  return { stops, transform };
}

/** '8px' → 8; '50%' → percentage of base; falsy → 0. */
export function pxOrPercent(str, base) {
  if (!str) return 0;
  if (String(str).includes('%')) return ((parseFloat(str) || 0) / 100) * base;
  return parseFloat(str) || 0;
}

/** url(...) inside a background-image value, or null. */
export function matchCssUrl(bgImage) {
  const m = String(bgImage).match(/url\((['"]?)([^'")]+)\1\)/);
  return m ? m[2] : null;
}

/** Computed-style-like object → tree `layout` (Auto Layout mapping). */
export function mapFlexLayout(cs) {
  if (!cs.display.includes('flex')) return { mode: 'NONE' };
  const mode = cs.flexDirection.startsWith('column') ? 'VERTICAL' : 'HORIZONTAL';
  const colGap = parseFloat(cs.columnGap) || 0;
  const rowGap = parseFloat(cs.rowGap) || 0;
  let counterAlign = ALIGN_COUNTER[cs.alignItems] || 'MIN';
  if (mode === 'VERTICAL' && counterAlign === 'BASELINE') counterAlign = 'MIN';
  return {
    mode,
    gap: mode === 'HORIZONTAL' ? colGap : rowGap,
    rowGap,
    wrap: cs.flexWrap === 'wrap' && mode === 'HORIZONTAL',
    primaryAlign: ALIGN_PRIMARY[cs.justifyContent] || 'MIN',
    counterAlign,
    paddingTop: parseFloat(cs.paddingTop) || 0,
    paddingRight: parseFloat(cs.paddingRight) || 0,
    paddingBottom: parseFloat(cs.paddingBottom) || 0,
    paddingLeft: parseFloat(cs.paddingLeft) || 0,
  };
}

/** Computed-style-like object + rect → tree `style` (box visuals). */
export function mapBoxStyle(cs, rect) {
  const st = {};
  const bg = parseColor(cs.backgroundColor);
  if (bg) st.background = bg;
  if (cs.backgroundImage && cs.backgroundImage !== 'none') {
    const grad = parseLinearGradient(cs.backgroundImage);
    if (grad) st.gradient = grad;
    else {
      const url = matchCssUrl(cs.backgroundImage);
      if (url) {
        st.bgUrl = url; // resolved to bytes by the extractor
        st.bgScaleMode = cs.backgroundSize === 'contain' ? 'FIT' : 'FILL';
      }
    }
  }
  const widths = ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs[`border${s}Width`]) || 0);
  const maxW = Math.max(...widths);
  if (maxW > 0) {
    const color = parseColor(cs.borderTopColor) || parseColor(cs.borderLeftColor) || parseColor(cs.borderBottomColor);
    if (color) st.border = { width: round(maxW), color, dashed: cs.borderTopStyle === 'dashed' };
  }
  const base = Math.min(rect.width, rect.height);
  const radius = {
    tl: round(pxOrPercent(cs.borderTopLeftRadius, base)),
    tr: round(pxOrPercent(cs.borderTopRightRadius, base)),
    br: round(pxOrPercent(cs.borderBottomRightRadius, base)),
    bl: round(pxOrPercent(cs.borderBottomLeftRadius, base)),
  };
  if (radius.tl || radius.tr || radius.br || radius.bl) st.radius = radius;
  const opacity = parseFloat(cs.opacity);
  if (opacity < 1) st.opacity = round(opacity);
  const shadows = parseShadows(cs.boxShadow);
  if (shadows) st.shadows = shadows;
  if (cs.overflow !== 'visible') st.clip = true;
  return st;
}

/** Computed-style-like object → tree `text` style fields (sans characters). */
export function mapTextStyle(cs) {
  const decorationLine = cs.textDecorationLine || '';
  return {
    fontFamily: cs.fontFamily,
    fontWeight: parseFloat(cs.fontWeight) || 400,
    italic: cs.fontStyle.includes('italic'),
    fontSize: parseFloat(cs.fontSize) || 16,
    lineHeightPx: cs.lineHeight === 'normal' ? null : round(parseFloat(cs.lineHeight) || 0) || null,
    letterSpacing: cs.letterSpacing === 'normal' ? 0 : round(parseFloat(cs.letterSpacing) || 0),
    color: parseColor(cs.color) || { r: 0, g: 0, b: 0, a: 1 },
    align: TEXT_ALIGN[cs.textAlign] || 'LEFT',
    decoration: decorationLine.includes('underline')
      ? 'UNDERLINE'
      : decorationLine.includes('line-through')
        ? 'STRIKETHROUGH'
        : null,
    case: TEXT_CASE[cs.textTransform] || null,
  };
}
