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

// Split a CSS filter list into { name, args } functions, respecting nested
// parens (drop-shadow contains rgba(...)).
function parseFilterFunctions(str) {
  const fns = [];
  let i = 0;
  while (i < str.length) {
    const m = str.slice(i).match(/^\s*([\w-]+)\(/);
    if (!m) {
      i++;
      continue;
    }
    const name = m[1];
    let j = i + m[0].length;
    let depth = 1;
    let args = '';
    while (j < str.length && depth > 0) {
      const ch = str[j];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth > 0) args += ch;
      j++;
    }
    fns.push({ name, args: args.trim() });
    i = j;
  }
  return fns;
}

/**
 * Map CSS `filter` + `backdrop-filter` to Figma effects. blur→LAYER_BLUR,
 * backdrop blur→BACKGROUND_BLUR, drop-shadow→DROP_SHADOW. Any other function
 * (grayscale, brightness, …) can't be expressed → `unsupported: true`, a signal
 * to rasterize the element instead.
 * @returns {{ effects: object[], unsupported: boolean }}
 */
export function parseFilters(filter, backdropFilter) {
  const effects = [];
  let unsupported = false;
  const mkShadow = (args) => {
    const color = parseColor(args);
    const nums = (args.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g) || []).map(parseFloat);
    return {
      type: 'DROP_SHADOW',
      color: color || { r: 0, g: 0, b: 0, a: 1 },
      offset: { x: nums[0] || 0, y: nums[1] || 0 },
      radius: nums[2] || 0,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL',
    };
  };
  if (filter && filter !== 'none') {
    for (const fn of parseFilterFunctions(filter)) {
      if (fn.name === 'blur') effects.push({ type: 'LAYER_BLUR', radius: parseFloat(fn.args) || 0, visible: true });
      else if (fn.name === 'drop-shadow') effects.push(mkShadow(fn.args));
      else unsupported = true; // grayscale/brightness/contrast/sepia/… — not expressible
    }
  }
  if (backdropFilter && backdropFilter !== 'none') {
    for (const fn of parseFilterFunctions(backdropFilter)) {
      if (fn.name === 'blur') effects.push({ type: 'BACKGROUND_BLUR', radius: parseFloat(fn.args) || 0, visible: true });
      else unsupported = true;
    }
  }
  return { effects, unsupported };
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

/**
 * Reorder sibling children into back-to-front paint order (first = bottom in
 * Figma). `items` are in DOM order; each is `{ position, zIndex, flexItem }`
 * with computed-style values (`position` like 'static'/'absolute', `zIndex`
 * 'auto' or a number string, `flexItem` true when the parent is flex — flex
 * items honor z-index even while `position: static`). Returns the original
 * indices reordered.
 *
 * Simplified CSS stacking model, back to front:
 *   0. participants with negative z-index (by z asc)
 *   1. normal-flow (non-participant) children, DOM order
 *   2. participants with z-index auto/0, DOM order
 *   3. participants with positive z-index (by z asc)
 * A child "participates" when it is positioned, or is a flex item with an
 * explicit z-index. Stable within a layer via the DOM index.
 */
export function paintOrder(items) {
  const decorated = items.map((it, i) => {
    const positioned = !!it.position && it.position !== 'static';
    const hasZ = it.zIndex !== undefined && it.zIndex !== null && it.zIndex !== 'auto' && it.zIndex !== '';
    const participates = positioned || (!!it.flexItem && hasZ);
    const zi = participates && hasZ ? parseInt(it.zIndex, 10) || 0 : 0;
    let layer;
    if (participates && zi < 0) layer = 0;
    else if (!participates) layer = 1;
    else if (zi === 0) layer = 2;
    else layer = 3;
    return { i, layer, zi, dom: i };
  });
  decorated.sort((a, b) => a.layer - b.layer || a.zi - b.zi || a.dom - b.dom);
  return decorated.map((d) => d.i);
}

/**
 * Resolve an image's Figma scale mode and (for off-center cover) crop rect.
 * `container`/`intrinsic` are {width,height}; `fit` is object-fit; posX/posY
 * are object-position as 0..1 fractions. Returns { scaleMode } or
 * { scaleMode: 'CROP', crop: {x,y,w,h} } where crop is the normalized visible
 * sub-rectangle of the image. Centered cover collapses to FILL so existing
 * output is unchanged; contain → FIT; fill/none/default → FILL.
 */
export function objectFitCrop(container, intrinsic, fit, posX, posY) {
  if (fit === 'contain' || fit === 'scale-down') return { scaleMode: 'FIT' };
  if (fit !== 'cover') return { scaleMode: 'FILL' };
  const cw = container.width;
  const ch = container.height;
  const iw = intrinsic.width;
  const ih = intrinsic.height;
  if (!iw || !ih || !cw || !ch) return { scaleMode: 'FILL' };
  if (Math.abs(posX - 0.5) < 1e-9 && Math.abs(posY - 0.5) < 1e-9) return { scaleMode: 'FILL' };
  const scale = Math.max(cw / iw, ch / ih);
  const dispW = iw * scale;
  const dispH = ih * scale;
  const overflowX = dispW - cw;
  const overflowY = dispH - ch;
  const crop = {
    x: round((overflowX > 0 ? (posX * overflowX) / dispW : 0) * 1000) / 1000,
    y: round((overflowY > 0 ? (posY * overflowY) / dispH : 0) * 1000) / 1000,
    w: round((cw / dispW) * 1000) / 1000,
    h: round((ch / dispH) * 1000) / 1000,
  };
  return { scaleMode: 'CROP', crop };
}

/**
 * Decompose a computed CSS `transform` (matrix()/matrix3d()/none) into its 2D
 * parts. Returns null for `none` or the identity (so untransformed elements are
 * unchanged), else `{ rotationDeg, scaleX, scaleY, skewXDeg, translateX,
 * translateY }`. rotationDeg is the CSS clockwise angle (screen space);
 * matrix3d uses only the 2D-relevant components (full 3D is not modeled).
 */
export function decomposeMatrix(transform) {
  if (!transform || transform === 'none') return null;
  const open = transform.indexOf('(');
  const inner = open >= 0 ? transform.slice(open + 1) : transform;
  const nums = (inner.match(/-?[\d.eE+]+/g) || []).map(Number);
  let a, b, c, d, e, f;
  if (transform.startsWith('matrix3d')) {
    if (nums.length < 16) return null;
    [a, b] = [nums[0], nums[1]];
    [c, d] = [nums[4], nums[5]];
    [e, f] = [nums[12], nums[13]];
  } else {
    if (nums.length < 6) return null;
    [a, b, c, d, e, f] = nums;
  }

  const isIdentity = a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0;
  if (isIdentity) return null;

  const deg = (rad) => round((rad * 180) / Math.PI);
  let scaleX = Math.sqrt(a * a + b * b);
  // Normalize the first column, extract shear, then the second column's scale.
  let na = scaleX ? a / scaleX : 0;
  let nb = scaleX ? b / scaleX : 0;
  let shear = na * c + nb * d;
  let c2 = c - na * shear;
  let d2 = d - nb * shear;
  let scaleY = Math.sqrt(c2 * c2 + d2 * d2);
  if (scaleY) shear /= scaleY;
  // Flip correction: negative determinant means one axis is mirrored.
  if (a * d - b * c < 0) {
    na = -na;
    nb = -nb;
    scaleX = -scaleX;
  }
  const rotationDeg = deg(Math.atan2(nb, na));
  const skewXDeg = deg(Math.atan(shear));
  return {
    rotationDeg,
    scaleX: round(scaleX),
    scaleY: round(scaleY),
    skewXDeg,
    translateX: round(e),
    translateY: round(f),
  };
}

/** Roman numeral for 1..3999, else the number as a string. */
export function romanNumeral(n) {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  const table = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  let v = n;
  for (const [value, sym] of table) {
    while (v >= value) {
      out += sym;
      v -= value;
    }
  }
  return out;
}

/** Bijective base-26 label: 1→A, 26→Z, 27→AA. */
export function alphaLabel(n) {
  if (!Number.isInteger(n) || n < 1) return String(n);
  let out = '';
  let v = n;
  while (v > 0) {
    const rem = (v - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    v = Math.floor((v - 1) / 26);
  }
  return out;
}

const BLEND_MODES = {
  multiply: 'MULTIPLY', screen: 'SCREEN', overlay: 'OVERLAY', darken: 'DARKEN',
  lighten: 'LIGHTEN', 'color-dodge': 'COLOR_DODGE', 'color-burn': 'COLOR_BURN',
  'hard-light': 'HARD_LIGHT', 'soft-light': 'SOFT_LIGHT', difference: 'DIFFERENCE',
  exclusion: 'EXCLUSION', hue: 'HUE', saturation: 'SATURATION', color: 'COLOR',
  luminosity: 'LUMINOSITY',
};

const BULLET_GLYPHS = { disc: '•', circle: '◦', square: '▪' };

/**
 * The rendered `::marker` string for a list item, given its `list-style-type`
 * and 1-based ordinal (ordinal is ignored for bullets). Unknown types fall
 * back to a disc bullet.
 */
export function markerString(type, ordinal) {
  if (type === 'none') return '';
  if (BULLET_GLYPHS[type]) return BULLET_GLYPHS[type];
  const n = ordinal;
  switch (type) {
    case 'decimal': return `${n}.`;
    case 'decimal-leading-zero': return `${n < 10 && n >= 0 ? '0' : ''}${n}.`;
    case 'lower-alpha':
    case 'lower-latin': return `${alphaLabel(n).toLowerCase()}.`;
    case 'upper-alpha':
    case 'upper-latin': return `${alphaLabel(n)}.`;
    case 'lower-roman': return `${romanNumeral(n).toLowerCase()}.`;
    case 'upper-roman': return `${romanNumeral(n)}.`;
    default: return '•';
  }
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
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const widths = sides.map((s) => parseFloat(cs[`border${s}Width`]) || 0);
  const maxW = Math.max(...widths);
  if (maxW > 0) {
    // Figma strokes are a single paint (no per-side colors), so take the color
    // of the widest side; per-side *widths* are expressible, per-side colors
    // are not (unequal colors are a rasterize-fallback case).
    const widestSide = sides[widths.indexOf(maxW)];
    const color =
      parseColor(cs[`border${widestSide}Color`]) ||
      parseColor(cs.borderTopColor) || parseColor(cs.borderRightColor) ||
      parseColor(cs.borderBottomColor) || parseColor(cs.borderLeftColor);
    if (color) {
      const dashed = cs.borderTopStyle === 'dashed';
      const uniform = widths.every((w) => w === widths[0]);
      st.border = uniform
        ? { width: round(maxW), color, dashed }
        : { top: round(widths[0]), right: round(widths[1]), bottom: round(widths[2]), left: round(widths[3]), color, dashed };
    }
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
  if (cs.mixBlendMode && BLEND_MODES[cs.mixBlendMode]) st.blendMode = BLEND_MODES[cs.mixBlendMode];
  const filters = parseFilters(cs.filter, cs.backdropFilter);
  if (!filters.unsupported && filters.effects.length) st.filterEffects = filters.effects;
  return st;
}

/**
 * Expand a single-line tight text rect (Range glyph bounds) to its CSS line
 * box, centered vertically. Multi-line rects and unknown/tighter line-heights
 * are returned unchanged — the tight bounds are already correct there, and
 * expanding multi-line accurately needs per-line boxes we don't model yet.
 */
export function lineBoxRect(tight, lineHeightPx, lineCount) {
  const out = { x: tight.x, y: tight.y, width: tight.width, height: tight.height };
  if (!lineHeightPx || lineCount !== 1) return out;
  const pad = (lineHeightPx - tight.height) / 2;
  if (pad <= 0) return out;
  out.y = round(tight.y - pad);
  out.height = lineHeightPx;
  return out;
}

/** Computed-style-like object → tree `text` style fields (sans characters). */
export function mapTextStyle(cs) {
  const decorationLine = cs.textDecorationLine || '';
  const style = {
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
  const shadows = parseShadows(cs.textShadow);
  if (shadows) style.shadows = shadows; // only when present, so untouched text stays lean
  if (cs.textOverflow === 'ellipsis') style.truncate = true;
  return style;
}
