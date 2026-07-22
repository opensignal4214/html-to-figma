import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const FALLBACK_CHROMIUM_PATHS = ['/opt/pw-browsers/chromium', process.env.CHROME_PATH].filter(Boolean);

export async function launchBrowser() {
  const args = ['--allow-file-access-from-files'];
  try {
    return await chromium.launch({ args });
  } catch (err) {
    for (const executablePath of FALLBACK_CHROMIUM_PATHS) {
      if (!fs.existsSync(executablePath)) continue;
      try {
        return await chromium.launch({ executablePath, args });
      } catch {
        /* try next */
      }
    }
    throw err;
  }
}

function toUrl(input) {
  if (/^https?:\/\//i.test(input) || /^file:\/\//i.test(input)) return input;
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) throw new Error(`Input file not found: ${abs}`);
  return pathToFileURL(abs).href;
}

/**
 * Runs inside the browser. Must be fully self-contained (Playwright serializes it).
 * Walks the rendered DOM and returns a JSON tree of frames / text / images / svg
 * with absolute page-coordinate rects and Figma-ready style values.
 */
const EXTRACTOR = async ({ selector }) => {
  const round = (v) => Math.round(v * 100) / 100;
  const rr = (rect) => ({
    x: round(rect.left + window.scrollX),
    y: round(rect.top + window.scrollY),
    width: round(rect.width),
    height: round(rect.height),
  });

  const parseColor = (str) => {
    if (!str) return null;
    const m = String(str).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((s) => parseFloat(s));
    const a = parts.length > 3 ? parts[3] : 1;
    if (!(a > 0)) return null;
    return { r: round(parts[0] / 255), g: round(parts[1] / 255), b: round(parts[2] / 255), a: round(a) };
  };

  // Split a CSS value list on top-level commas (commas inside rgba(...) don't count).
  const splitTop = (str) => {
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
  };

  const parseShadows = (str) => {
    if (!str || str === 'none') return null;
    const shadows = splitTop(str)
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
  };

  // Parse the first linear-gradient(...) in a computed background-image into
  // Figma gradient stops + a gradientTransform for the node's bounding box.
  const parseGradient = (bgImage) => {
    const start = bgImage.indexOf('linear-gradient(');
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
    const parts = splitTop(body);
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
    // Fill in missing positions evenly.
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
    stops.forEach((s) => {
      s.position = Math.min(1, Math.max(0, s.position));
    });

    // CSS angle: 0deg = to top, 90deg = to right. Compute gradient line endpoints
    // in normalized (0..1) box coords, then build Figma's inverse transform whose
    // first row maps (x, y, 1) -> t along the gradient.
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
  };

  const fetchAsset = async (src) => {
    try {
      const res = await fetch(src);
      if (!res.ok && res.status !== 0) return null;
      const mime = res.headers.get('content-type') || '';
      if (mime.includes('svg') || /\.svg(\?|#|$)/.test(src)) {
        return { svgText: await res.text() };
      }
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (!bytes.length) return null;
      let binary = '';
      const CHUNK = 0x8000;
      for (let o = 0; o < bytes.length; o += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(o, o + CHUNK));
      }
      return { base64: btoa(binary), mime };
    } catch {
      return null;
    }
  };

  const matchCssUrl = (bgImage) => {
    const m = bgImage.match(/url\((['"]?)([^'")]+)\1\)/);
    return m ? m[2] : null;
  };

  const nodeName = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
    return `${tag}${id}${cls}`;
  };

  const pxOrPercent = (str, base) => {
    if (!str) return 0;
    if (String(str).includes('%')) return ((parseFloat(str) || 0) / 100) * base;
    return parseFloat(str) || 0;
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

  const layoutOf = (cs) => {
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
  };

  const styleOf = (cs, rect) => {
    const st = {};
    const bg = parseColor(cs.backgroundColor);
    if (bg) st.background = bg;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      const grad = parseGradient(cs.backgroundImage);
      if (grad) st.gradient = grad;
      else {
        const url = matchCssUrl(cs.backgroundImage);
        if (url) st.bgUrl = url; // resolved to bytes later
      }
      if (st.bgUrl) {
        st.bgScaleMode = cs.backgroundSize === 'contain' ? 'FIT' : 'FILL';
      }
    }
    const widths = ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs[`border${s}Width`]) || 0);
    const maxW = Math.max(...widths);
    if (maxW > 0) {
      const color = parseColor(cs.borderTopColor) || parseColor(cs.borderLeftColor) || parseColor(cs.borderBottomColor);
      if (color) {
        st.border = { width: round(maxW), color, dashed: cs.borderTopStyle === 'dashed' };
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
    return st;
  };

  const TEXT_ALIGN = { left: 'LEFT', start: 'LEFT', center: 'CENTER', right: 'RIGHT', end: 'RIGHT', justify: 'JUSTIFIED' };
  const TEXT_CASE = { uppercase: 'UPPER', lowercase: 'LOWER', capitalize: 'TITLE' };

  const textStyleOf = (cs) => {
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
  };

  const textNodeToTree = (textNode, cs) => {
    const characters = textNode.textContent.replace(/\s+/g, ' ').trim();
    if (!characters) return null;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();
    if (rect.width < 0.5 || rect.height < 0.5) return null;
    return {
      type: 'TEXT',
      name: characters.slice(0, 40),
      rect: rr(rect),
      text: { characters, ...textStyleOf(cs) },
    };
  };

  const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'head', 'title', 'br', 'wbr', 'source', 'track', 'iframe']);

  const walk = async (el) => {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 0.5 && rect.height < 0.5) return null;

    const abs = ['absolute', 'fixed', 'sticky'].includes(cs.position);

    if (tag === 'svg') {
      return { type: 'SVG', name: nodeName(el), rect: rr(rect), svg: el.outerHTML, abs, style: styleOf(cs, rect) };
    }

    if (tag === 'img' || tag === 'video' || tag === 'canvas') {
      const node = { type: 'IMAGE', name: nodeName(el), rect: rr(rect), abs, style: styleOf(cs, rect) };
      let asset = null;
      if (tag === 'img' && el.currentSrc) asset = await fetchAsset(el.currentSrc);
      else if (tag === 'video' && el.poster) asset = await fetchAsset(el.poster);
      else if (tag === 'canvas') {
        try {
          asset = { base64: el.toDataURL('image/png').split(',')[1], mime: 'image/png' };
        } catch { /* tainted canvas */ }
      }
      if (asset && asset.svgText) return { type: 'SVG', name: nodeName(el), rect: rr(rect), svg: asset.svgText, abs, style: styleOf(cs, rect) };
      if (asset) {
        node.image = {
          base64: asset.base64,
          scaleMode: cs.objectFit === 'contain' ? 'FIT' : 'FILL',
        };
      }
      return node;
    }

    const node = {
      type: 'FRAME',
      tag,
      name: nodeName(el),
      rect: rr(rect),
      abs,
      layout: layoutOf(cs),
      style: styleOf(cs, rect),
      component: el.hasAttribute('data-figma-component')
        ? el.getAttribute('data-figma-component') || nodeName(el)
        : null,
      children: [],
    };

    if (node.style.bgUrl) {
      const asset = await fetchAsset(new URL(node.style.bgUrl, location.href).href);
      if (asset && asset.base64) {
        node.style.backgroundImage = { base64: asset.base64, scaleMode: node.style.bgScaleMode || 'FILL' };
      }
      delete node.style.bgUrl;
      delete node.style.bgScaleMode;
    }

    // Form controls: synthesize a text child from value/placeholder.
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const value = tag === 'select' ? (el.selectedOptions[0] ? el.selectedOptions[0].textContent : '') : el.value || el.placeholder || '';
      const characters = String(value).replace(/\s+/g, ' ').trim();
      if (characters) {
        const padL = parseFloat(cs.paddingLeft) || 0;
        const padT = parseFloat(cs.paddingTop) || 0;
        const inner = rr(rect);
        node.children.push({
          type: 'TEXT',
          name: characters.slice(0, 40),
          rect: {
            x: round(inner.x + padL),
            y: round(inner.y + padT),
            width: Math.max(1, round(inner.width - padL * 2)),
            height: Math.max(1, round(inner.height - padT * 2)),
          },
          text: { characters, ...textStyleOf(cs) },
        });
      }
      return node;
    }

    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const textTree = textNodeToTree(child, cs);
        if (textTree) node.children.push(textTree);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childTree = await walk(child);
        if (childTree) node.children.push(childTree);
      }
    }

    // Collapse plain text wrappers (p, h1, span...) into a single TEXT node.
    const st = node.style;
    if (
      node.children.length === 1 &&
      node.children[0].type === 'TEXT' &&
      !node.component &&
      !st.background && !st.gradient && !st.backgroundImage &&
      !st.border && !st.shadows && !st.radius
    ) {
      const only = node.children[0];
      only.name = `${node.name} "${only.text.characters.slice(0, 24)}"`;
      only.abs = node.abs;
      if (st.opacity !== undefined) only.style = { opacity: st.opacity };
      return only;
    }

    return node;
  };

  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* ignore */ }
  }

  const rootEl = selector ? document.querySelector(selector) : null;
  if (selector && !rootEl) throw new Error(`Selector matched nothing: ${selector}`);

  if (rootEl) {
    const tree = await walk(rootEl);
    if (!tree) throw new Error('Selected element is not renderable (display:none or zero size)');
    return tree;
  }

  const body = document.body;
  const bodyTree = await walk(body);
  const docEl = document.documentElement;
  const htmlCs = getComputedStyle(docEl);
  const pageBg = parseColor(getComputedStyle(body).backgroundColor) || parseColor(htmlCs.backgroundColor) || { r: 1, g: 1, b: 1, a: 1 };
  const width = Math.max(docEl.scrollWidth, docEl.clientWidth);
  const height = Math.max(docEl.scrollHeight, docEl.clientHeight);
  return {
    type: 'FRAME',
    tag: 'body',
    name: 'Page',
    rect: { x: 0, y: 0, width: round(width), height: round(height) },
    layout: bodyTree ? bodyTree.layout : { mode: 'NONE' },
    style: { ...(bodyTree ? bodyTree.style : {}), background: pageBg, clip: true },
    component: null,
    children: bodyTree ? bodyTree.children : [],
  };
};

/** Ensure at least one node is marked as a component. */
export function markComponents(tree) {
  const hasComponent = (node) => {
    if (node.component) return true;
    return (node.children || []).some(hasComponent);
  };
  if (hasComponent(tree)) return tree;
  const candidates = (tree.children || []).filter((c) => c.type === 'FRAME');
  if (candidates.length) {
    for (const child of candidates) child.component = child.name;
  } else if (tree.type === 'FRAME') {
    tree.component = tree.name;
  }
  return tree;
}

export async function extractTree(input, opts = {}) {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: { width: opts.width || 1440, height: opts.height || 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const url = toUrl(input);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(async () => {
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    });
    const tree = await page.evaluate(EXTRACTOR, { selector: opts.selector || null });
    return markComponents(tree);
  } finally {
    await browser.close();
  }
}
