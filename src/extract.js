import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_MAP_PATH = path.join(__dirname, 'css-map.js');

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
 * src/css-map.js is a plain ESM module of `export function` declarations; for
 * the browser we strip the `export ` keywords and expose every function on
 * window.__cssMap. Unit tests import the very same module in Node.
 */
function cssMapBrowserSource() {
  const src = fs.readFileSync(CSS_MAP_PATH, 'utf8');
  const names = [...src.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
  return `${src.replace(/^export /gm, '')}\nwindow.__cssMap = { ${names.join(', ')} };\n`;
}

/**
 * Runs inside the browser (Playwright serializes it; window.__cssMap must be
 * injected first). Walks the rendered DOM and returns the intermediate tree —
 * see docs/DESIGN.md for the schema.
 */
const EXTRACTOR = async ({ selector }) => {
  const M = window.__cssMap;
  const round = (v) => Math.round(v * 100) / 100;
  const rr = (rect) => ({
    x: round(rect.left + window.scrollX),
    y: round(rect.top + window.scrollY),
    width: round(rect.width),
    height: round(rect.height),
  });

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

  const nodeName = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
    return `${tag}${id}${cls}`;
  };

  const textNodeToTree = (textNode, cs) => {
    const characters = textNode.textContent.replace(/\s+/g, ' ').trim();
    if (!characters) return null;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();
    if (rect.width < 0.5 || rect.height < 0.5) return null;
    const style = M.mapTextStyle(cs);
    // Count rendered lines (unique fragment tops) so single-line text can be
    // expanded to its full line box, fixing vertical drift with tall line-height.
    const lineTops = new Set();
    for (const r of range.getClientRects()) lineTops.add(Math.round(r.top));
    const box = M.lineBoxRect(rr(rect), style.lineHeightPx, lineTops.size || 1);
    return {
      type: 'TEXT',
      name: characters.slice(0, 40),
      rect: box,
      text: { characters, ...style },
    };
  };

  const measureTextWidth = (str, cs) => {
    const ctx = (window.__mctx = window.__mctx || document.createElement('canvas').getContext('2d'));
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return ctx.measureText(str).width;
  };

  // 1-based ordinal of a list item, honoring <ol start> and per-<li value>.
  const listItemOrdinal = (el) => {
    const parent = el.parentElement;
    if (!parent) return 1;
    let cur = parent.tagName === 'OL' ? parseInt(parent.getAttribute('start'), 10) || 1 : 1;
    for (const sib of parent.children) {
      if (sib.tagName !== 'LI') continue;
      if (sib.hasAttribute('value')) cur = parseInt(sib.getAttribute('value'), 10) || cur;
      if (sib === el) return cur;
      cur++;
    }
    return cur;
  };

  // Synthesize a TEXT node for a list item's ::marker (bullet or number), which
  // the DOM walk can't otherwise see. Positioned in the list's left gutter for
  // `outside` markers, at the content edge for `inside`.
  const markerNode = (el, cs) => {
    if (cs.display !== 'list-item' || cs.listStyleType === 'none') return null;
    if (cs.listStyleImage && cs.listStyleImage !== 'none') return null; // image markers unsupported
    const characters = M.markerString(cs.listStyleType, listItemOrdinal(el));
    if (!characters) return null;
    const style = M.mapTextStyle(cs);
    const liRect = el.getBoundingClientRect();
    const fontPx = parseFloat(cs.fontSize) || 16;
    const w = Math.ceil(measureTextWidth(characters, cs)) + 1;
    const inside = cs.listStylePosition === 'inside';
    const x = inside
      ? liRect.left + (parseFloat(cs.paddingLeft) || 0)
      : liRect.left - fontPx * 0.5 - w;
    const height = style.lineHeightPx || Math.round(fontPx * 1.3);
    return {
      type: 'TEXT',
      name: `marker "${characters}"`,
      rect: {
        x: round(x + window.scrollX),
        y: round(liRect.top + (parseFloat(cs.paddingTop) || 0) + window.scrollY),
        width: w,
        height,
      },
      text: { characters, ...style },
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
      return { type: 'SVG', name: nodeName(el), rect: rr(rect), svg: el.outerHTML, abs, style: M.mapBoxStyle(cs, rect) };
    }

    if (tag === 'img' || tag === 'video' || tag === 'canvas') {
      const node = { type: 'IMAGE', name: nodeName(el), rect: rr(rect), abs, style: M.mapBoxStyle(cs, rect) };
      let asset = null;
      if (tag === 'img' && el.currentSrc) asset = await fetchAsset(el.currentSrc);
      else if (tag === 'video' && el.poster) asset = await fetchAsset(el.poster);
      else if (tag === 'canvas') {
        try {
          asset = { base64: el.toDataURL('image/png').split(',')[1], mime: 'image/png' };
        } catch { /* tainted canvas */ }
      }
      if (asset && asset.svgText) return { type: 'SVG', name: nodeName(el), rect: rr(rect), svg: asset.svgText, abs, style: M.mapBoxStyle(cs, rect) };
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
      layout: M.mapFlexLayout(cs),
      style: M.mapBoxStyle(cs, rect),
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
          text: { characters, ...M.mapTextStyle(cs) },
        });
      }
      return node;
    }

    const parentIsFlex = node.layout.mode !== 'NONE';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const textTree = textNodeToTree(child, cs);
        if (textTree) {
          textTree._po = { position: 'static', zIndex: 'auto', flexItem: parentIsFlex };
          node.children.push(textTree);
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childTree = await walk(child);
        if (childTree) {
          const childCs = getComputedStyle(child);
          childTree._po = { position: childCs.position, zIndex: childCs.zIndex, flexItem: parentIsFlex };
          node.children.push(childTree);
        }
      }
    }

    // Synthesize the list-item marker (bullet/number) the DOM walk can't see.
    const marker = markerNode(el, cs);
    if (marker) {
      marker._po = { position: 'static', zIndex: 'auto', flexItem: parentIsFlex };
      node.children.unshift(marker);
    }

    // Reorder children into Figma back-to-front z-order (DOM order ≠ paint order).
    if (node.children.length > 1) {
      const order = M.paintOrder(node.children.map((c) => c._po || { position: 'static', zIndex: 'auto' }));
      node.children = order.map((i) => node.children[i]);
    }
    for (const c of node.children) delete c._po;

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
  const pageBg = M.parseColor(getComputedStyle(body).backgroundColor) || M.parseColor(htmlCs.backgroundColor) || { r: 1, g: 1, b: 1, a: 1 };
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
      bypassCSP: true, // strict-CSP sites must not block the css-map injection
    });
    const page = await context.newPage();
    const url = toUrl(input);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(async () => {
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    });
    await page.addScriptTag({ content: cssMapBrowserSource() });
    const tree = await page.evaluate(EXTRACTOR, { selector: opts.selector || null });
    return markComponents(tree);
  } finally {
    await browser.close();
  }
}
