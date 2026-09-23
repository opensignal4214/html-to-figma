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
// Gradient matrices are in normalized space and amplified by the box size, so
// they need finer precision than pixel values (2 dp ≈ 1px error on 300px).
const round4 = (v) => {
  const r = Math.round(v * 10000) / 10000;
  return r === 0 ? 0 : r;
};

const ALIGN_PRIMARY = {
  'flex-start': 'MIN', start: 'MIN', left: 'MIN', normal: 'MIN',
  center: 'CENTER',
  'flex-end': 'MAX', end: 'MAX', right: 'MAX',
  'space-between': 'SPACE_BETWEEN', 'space-around': 'SPACE_AROUND', 'space-evenly': 'SPACE_EVENLY',
};

const ALIGN_COUNTER = {
  'flex-start': 'MIN', start: 'MIN', normal: 'MIN', stretch: 'MIN',
  center: 'CENTER',
  'flex-end': 'MAX', end: 'MAX',
  baseline: 'BASELINE',
};

const TEXT_ALIGN = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFIED' };
const TEXT_CASE = { uppercase: 'UPPER', lowercase: 'LOWER', capitalize: 'TITLE' };

// Resolve text-align to a physical Figma alignment. The logical keywords
// start/end depend on writing direction: in RTL, start = right, end = left.
function alignFor(textAlign, direction) {
  const rtl = direction === 'rtl';
  if (textAlign === 'start') return rtl ? 'RIGHT' : 'LEFT';
  if (textAlign === 'end') return rtl ? 'LEFT' : 'RIGHT';
  return TEXT_ALIGN[textAlign] || 'LEFT';
}

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

// Parse a list of "color [pos%]" segments into ordered {color, position}
// stops, filling missing positions evenly. Non-color segments (gradient shape
// descriptors) are skipped. Returns null if fewer than 2 real stops.
function parseColorStops(parts) {
  const stops = [];
  for (const part of parts) {
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
  return stops;
}

// Extract the balanced-paren body of the first `name(` in a value.
function gradientBody(value, name) {
  const start = String(value).indexOf(`${name}(`);
  if (start === -1) return null;
  let i = start + name.length + 1;
  let depth = 1;
  let body = '';
  while (i < value.length && depth > 0) {
    const ch = value[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth > 0) body += ch;
    i++;
  }
  return body;
}

// One `<length-percentage>` against a reference size; null if not a length.
// Handles calc() sums of % and px terms, which Chromium emits when serializing
// edge-offset positions (`right 10px` → `calc(100% - 10px)`).
function lengthPct(tok, ref) {
  if (/^-?[\d.]+%$/.test(tok)) return (parseFloat(tok) / 100) * ref;
  if (/^-?[\d.]+(px)?$/.test(tok)) return parseFloat(tok);
  const calc = /^calc\((.*)\)$/.exec(tok);
  if (!calc) return null;
  const terms = calc[1].replace(/\s+/g, '').match(/[+-]?[\d.]+(%|px)?/g);
  if (!terms || terms.join('') !== calc[1].replace(/\s+/g, '')) return null;
  return terms.reduce((sum, t) => sum + (t.endsWith('%') ? (parseFloat(t) / 100) * ref : parseFloat(t)), 0);
}

// Split on whitespace outside parentheses (keeps `calc(100% - 10px)` whole).
function splitSpaces(str) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of str.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// CSS <position> (1, 2, or 4 values) → center in px on a w×h box.
function parsePosition(tokens, w, h) {
  const KW_X = { left: 0, center: 0.5, right: 1 };
  const KW_Y = { top: 0, center: 0.5, bottom: 1 };
  let x = 0.5 * w;
  let y = 0.5 * h;
  if (tokens.length === 4) {
    // e.g. `right 10px bottom 20%` — edge keyword + offset from that edge
    for (let k = 0; k < 4; k += 2) {
      const kw = tokens[k];
      if (kw === 'left' || kw === 'right') {
        const off = lengthPct(tokens[k + 1], w) ?? 0;
        x = kw === 'left' ? off : w - off;
      } else {
        const off = lengthPct(tokens[k + 1], h) ?? 0;
        y = kw === 'top' ? off : h - off;
      }
    }
    return [x, y];
  }
  let [a, b] = tokens;
  // A lone vertical keyword or a swapped keyword pair (`top left`) → reorder.
  if (a in KW_Y && !(a in KW_X)) [a, b] = [b ?? 'center', a];
  else if (b in KW_X && !(b in KW_Y)) [a, b] = [b, a];
  if (a !== undefined) x = a in KW_X ? KW_X[a] * w : lengthPct(a, w) ?? x;
  if (b !== undefined) y = b in KW_Y ? KW_Y[b] * h : lengthPct(b, h) ?? y;
  return [x, y];
}

/**
 * First radial-gradient() → Figma { type: 'RADIAL', stops, transform } or null,
 * for a w×h box (defaults to the unit square).
 *
 * The descriptor (`[shape] [size] [at position]`) is resolved per CSS Images 3
 * to a pixel center (cx, cy) and radii (rx, ry): default ellipse
 * farthest-corner at center. Figma's radial runs from gradient-space center
 * (½, ½) to (1, ½) / (½, 1), so T maps box-normalized (u, v) to
 * (½ + (u·w − cx)/(2·rx), ½ + (v·h − cy)/(2·ry)). Verified by the independent
 * oracle in test/unit/figma-oracle.test.js.
 */
export function parseRadialGradient(bgImage, w = 1, h = 1) {
  const body = gradientBody(bgImage, 'radial-gradient');
  if (body === null) return null;
  const parts = splitTopLevel(body);
  const stops = parseColorStops(parts);
  if (!stops) return null;

  let shape = null;
  let size = 'farthest-corner';
  let explicit = [];
  let center = [w / 2, h / 2];
  if (parts.length && !parseColor(parts[0])) {
    const toks = splitSpaces(parts[0]);
    const at = toks.indexOf('at');
    const pre = at >= 0 ? toks.slice(0, at) : toks;
    if (at >= 0) center = parsePosition(toks.slice(at + 1), w, h);
    for (const t of pre) {
      if (t === 'circle' || t === 'ellipse') shape = t;
      else if (/^(closest|farthest)-(side|corner)$/.test(t)) size = t;
      else explicit.push(t);
    }
  }
  const [cx, cy] = center;
  const dxs = [cx, w - cx].map(Math.abs);
  const dys = [cy, h - cy].map(Math.abs);
  if (!shape) shape = explicit.length === 1 ? 'circle' : 'ellipse';

  let rx;
  let ry;
  if (explicit.length) {
    rx = lengthPct(explicit[0], w) ?? w / 2;
    ry = shape === 'circle' ? rx : lengthPct(explicit[1] ?? explicit[0], h) ?? h / 2;
  } else if (shape === 'circle') {
    const corner = dxs.flatMap((a) => dys.map((b) => Math.hypot(a, b)));
    rx = ry = {
      'closest-side': Math.min(...dxs, ...dys),
      'farthest-side': Math.max(...dxs, ...dys),
      'closest-corner': Math.min(...corner),
      'farthest-corner': Math.max(...corner),
    }[size];
  } else {
    const pick = size.startsWith('closest') ? Math.min : Math.max;
    // Corner sizes keep the side-based aspect ratio, scaled to pass through it.
    const k = size.endsWith('corner') ? Math.SQRT2 : 1;
    rx = pick(...dxs) * k;
    ry = pick(...dys) * k;
  }
  rx = Math.max(rx, 1e-3 * w);
  ry = Math.max(ry, 1e-3 * h);
  const transform = [
    [round4(w / (2 * rx)), 0, round4(0.5 - cx / (2 * rx))],
    [0, round4(h / (2 * ry)), round4(0.5 - cy / (2 * ry))],
  ];
  return { type: 'RADIAL', stops, transform };
}

/**
 * First linear-gradient() in a background-image value → Figma gradient
 * { stops: [{color, position}], transform } or null, for a w×h box (defaults
 * to the unit square).
 *
 * Figma samples a gradient at t = gx of T·(u, v, 1), where (u, v) are
 * normalized box coords, and places the handles at inv(T)·(0, ½) / (1, ½).
 * So the matrix is built in PIXEL space from the CSS gradient line (CSS Images
 * 3: length |w·sinθ| + |h·cosθ| through the box center): row 0 is exactly the
 * CSS t functional, row 1 puts the gradient centerline at gy = ½. Verified by
 * the independent oracle in test/unit/figma-oracle.test.js.
 */
export function parseLinearGradient(bgImage, w = 1, h = 1) {
  const body = gradientBody(bgImage, 'linear-gradient');
  if (body === null) return null;
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
    const words = first.slice(3).trim().split(/\s+/);
    const vert = words.find((d) => d === 'top' || d === 'bottom');
    const horiz = words.find((d) => d === 'left' || d === 'right');
    if (vert && horiz) {
      // Corner: the line is perpendicular to the diagonal joining the two
      // neighbouring corners, so the angle depends on the box's aspect ratio.
      const a = (Math.atan2(h, w) * 180) / Math.PI; // `to top right`
      angleDeg = { 'top right': a, 'bottom right': 180 - a, 'bottom left': 180 + a, 'top left': 360 - a }[`${vert} ${horiz}`];
    } else {
      angleDeg = { top: 0, right: 90, bottom: 180, left: 270 }[vert || horiz] ?? 180;
    }
    stopParts = parts.slice(1);
  }

  const stops = parseColorStops(stopParts);
  if (!stops) return null;

  // CSS angle: 0deg = to top, 90deg = to right (screen y goes down).
  const theta = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(theta);
  const dy = -Math.cos(theta);
  const len = Math.abs(w * dx) + Math.abs(h * dy) || 1;
  const cx = w / 2;
  const cy = h / 2;
  const sx = cx - (dx * len) / 2;
  const sy = cy - (dy * len) / 2;
  // Perpendicular (centerline offset) axis, same pixel scale as the line.
  const nx = -dy;
  const ny = dx;
  const transform = [
    [round4((dx * w) / len), round4((dy * h) / len), round4(-(sx * dx + sy * dy) / len)],
    [round4((nx * w) / len), round4((ny * h) / len), round4(0.5 - (cx * nx + cy * ny) / len)],
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

/**
 * Map a computed `clip-path` to a Figma-expressible result:
 *   - `null` for `none`
 *   - `{ kind: 'radius', radius }` for `circle(...)` on a (near-)square element
 *     (equivalent to border-radius 50%)
 *   - `{ kind: 'raster' }` for everything else (polygon/inset/ellipse/path/url,
 *     or a circle on a non-square box) — the caller rasterizes for a
 *     pixel-perfect result rather than building a vector mask.
 */
export function mapClipPath(clipPath, rect) {
  if (!clipPath || clipPath === 'none') return null;
  if (clipPath.startsWith('circle(')) {
    const square = Math.abs(rect.width - rect.height) <= 1;
    if (square) {
      const r = round(Math.min(rect.width, rect.height) / 2);
      return { kind: 'radius', radius: { tl: r, tr: r, br: r, bl: r } };
    }
  }
  return { kind: 'raster' };
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
  const layout = {
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
  // Reverse directions lay children out back-to-front; the walker reverses the
  // flow children so Auto Layout order matches the visual order.
  if (cs.flexDirection.endsWith('-reverse')) {
    layout.reverse = true;
    // main-start is now the far edge: flex-start/normal pack right (bottom),
    // flex-end packs left (top). start/end follow the writing mode → unchanged.
    const j = cs.justifyContent;
    if (j === 'normal' || j === 'flex-start' || !(j in ALIGN_PRIMARY)) layout.primaryAlign = 'MAX';
    else if (j === 'flex-end') layout.primaryAlign = 'MIN';
  }
  return layout;
}

// Figma image scale mode for a background layer from its size/repeat values.
// A repeating natural-size image tiles; contain → FIT; otherwise FILL.
function layerScaleMode(sizeStr, repeatStr) {
  const repeats = repeatStr && repeatStr !== 'no-repeat';
  const autoSize = !sizeStr || sizeStr === 'auto' || sizeStr === 'auto auto';
  return repeats && autoSize ? 'TILE' : sizeStr === 'contain' ? 'FIT' : 'FILL';
}

/** Computed-style-like object + rect → tree `style` (box visuals). */
export function mapBoxStyle(cs, rect) {
  const st = {};
  // Gradient geometry depends on the box's aspect ratio (unit square if unknown).
  const bw = (rect && rect.width) || 1;
  const bh = (rect && rect.height) || 1;
  const bg = parseColor(cs.backgroundColor);
  if (bg) st.background = bg;
  if (cs.backgroundImage && cs.backgroundImage !== 'none') {
    const layers = splitTopLevel(cs.backgroundImage).filter((s) => s && s !== 'none');
    if (layers.length > 1) {
      // Multiple background-image layers (CSS order: first = topmost). Leave the
      // single-layer keys unset so single-layer output stays baseline-identical.
      const sizes = splitTopLevel(cs.backgroundSize || 'auto');
      const repeats = splitTopLevel(cs.backgroundRepeat || 'repeat');
      const parsed = [];
      for (let i = 0; i < layers.length; i++) {
        const grad = parseLinearGradient(layers[i], bw, bh) || parseRadialGradient(layers[i], bw, bh);
        if (grad) {
          parsed.push({ kind: 'gradient', gradient: grad });
          continue;
        }
        const url = matchCssUrl(layers[i]);
        if (url) {
          parsed.push({ kind: 'image', url, scaleMode: layerScaleMode(sizes[i % sizes.length], repeats[i % repeats.length]) });
        }
      }
      if (parsed.length) st.bgLayers = parsed;
    } else {
      const grad = parseLinearGradient(cs.backgroundImage, bw, bh) || parseRadialGradient(cs.backgroundImage, bw, bh);
      if (grad) st.gradient = grad;
      else {
        const url = matchCssUrl(cs.backgroundImage);
        // resolved to bytes by the extractor
        if (url) {
          st.bgUrl = url;
          st.bgScaleMode = layerScaleMode(cs.backgroundSize, cs.backgroundRepeat);
        }
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
  // circle() clip on a square element → corner radius (border-radius 50%).
  const clip = mapClipPath(cs.clipPath, rect);
  if (clip && clip.kind === 'radius') {
    st.radius = clip.radius;
    st.clip = true;
  }
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
 * Expand a tight text rect (Range glyph bounds) to its CSS line boxes. Figma
 * lays text out in line boxes starting at the node top, so tight bounds make
 * text drift by the half-leading. For n lines spaced exactly `lineHeightPx`
 * apart, each line's glyph height is c = h − (n−1)·lh and the half-leading is
 * (lh − c)/2. Unknown/tighter line-heights, and multi-line runs whose implied
 * glyph height is implausible (< lh/2: mixed inline content, not a plain
 * run), are returned unchanged.
 */
export function lineBoxRect(tight, lineHeightPx, lineCount) {
  const out = { x: tight.x, y: tight.y, width: tight.width, height: tight.height };
  const n = lineCount || 1;
  if (!lineHeightPx) return out;
  const glyph = tight.height - (n - 1) * lineHeightPx;
  if (n > 1 && glyph < lineHeightPx / 2) return out;
  const pad = (lineHeightPx - glyph) / 2;
  if (pad <= 0) return out;
  out.y = round(tight.y - pad);
  out.height = round(n * lineHeightPx);
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
    align: alignFor(cs.textAlign, cs.direction),
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
