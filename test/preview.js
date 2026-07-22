// Visual preview without Figma: run a generated script against a recording
// mock of the Figma Plugin API, simulate Auto Layout positioning, render the
// resulting node tree to SVG, and emit a self-contained compare page with the
// real browser render side by side (plus an opacity overlay).
//
// Usage: node test/preview.js [script.js] [source.html] [out.html]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../src/extract.js';

const scriptPath = process.argv[2] || 'out/figma-script.js';
const htmlPath = process.argv[3] || 'examples/pricing-card.html';
const outPath = process.argv[4] || 'out/preview.html';

// ---------------------------------------------------------------- mock figma

const images = {}; // imageHash -> data URL
let hashCounter = 0;

function sniffMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  return 'image/png';
}

function makeNode(type) {
  const node = {
    type,
    name: '',
    x: 0, y: 0, width: 0, height: 0,
    opacity: 1,
    visible: true,
    fills: [], strokes: [], effects: [], dashPattern: [],
    strokeWeight: 1, strokeAlign: 'INSIDE',
    cornerRadius: 0,
    topLeftRadius: 0, topRightRadius: 0, bottomRightRadius: 0, bottomLeftRadius: 0,
    clipsContent: false,
    layoutMode: 'NONE', layoutWrap: 'NO_WRAP', layoutPositioning: 'AUTO',
    primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO',
    primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'MIN',
    itemSpacing: 0, counterAxisSpacing: 0,
    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    children: [],
    resize(w, h) {
      if (!(w > 0) || !(h > 0)) throw new Error(`invalid resize(${w}, ${h})`);
      node.width = w;
      node.height = h;
    },
    appendChild(child) {
      node.children.push(child);
      child.parent = node;
    },
  };
  if (type === 'TEXT') {
    Object.assign(node, {
      fontName: { family: 'Inter', style: 'Regular' },
      characters: '',
      fontSize: 12,
      lineHeight: { unit: 'AUTO' },
      letterSpacing: { value: 0, unit: 'PIXELS' },
      textAlignHorizontal: 'LEFT',
      textAlignVertical: 'TOP',
      textDecoration: 'NONE',
      textCase: 'ORIGINAL',
      textAutoResize: 'NONE',
    });
  }
  return node;
}

const page = makeNode('PAGE');
const figma = {
  currentPage: page,
  viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView() {} },
  createFrame: () => makeNode('FRAME'),
  createComponent: () => makeNode('COMPONENT'),
  createRectangle: () => makeNode('RECTANGLE'),
  createText: () => makeNode('TEXT'),
  createNodeFromSvg(svg) {
    const node = makeNode('SVG_FRAME');
    node.__svg = svg;
    return node;
  },
  createImage(bytes) {
    const hash = `h${hashCounter++}`;
    images[hash] = `data:${sniffMime(bytes)};base64,${Buffer.from(bytes).toString('base64')}`;
    return { hash };
  },
  async loadFontAsync() { /* accept everything so the preview shows the requested family */ },
  notify(msg) { console.log('[figma.notify]', msg); },
  closePlugin() {},
};
Object.defineProperty(page, 'selection', { set() {}, get() { return []; } });

// ------------------------------------------------- Auto Layout simulation

function simulateLayout(n) {
  const kids = n.children || [];
  if (n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL') {
    const horizontal = n.layoutMode === 'HORIZONTAL';
    const flow = kids.filter((k) => k.layoutPositioning !== 'ABSOLUTE');
    const mainSize = horizontal ? n.width : n.height;
    const crossSize = horizontal ? n.height : n.width;
    const padMainStart = horizontal ? n.paddingLeft : n.paddingTop;
    const padMainEnd = horizontal ? n.paddingRight : n.paddingBottom;
    const padCrossStart = horizontal ? n.paddingTop : n.paddingLeft;
    const padCrossEnd = horizontal ? n.paddingBottom : n.paddingRight;
    const inner = mainSize - padMainStart - padMainEnd;
    const sum = flow.reduce((a, k) => a + (horizontal ? k.width : k.height), 0);
    let gap = n.itemSpacing || 0;
    let cursor = padMainStart;
    if (n.primaryAxisAlignItems === 'SPACE_BETWEEN' && flow.length > 1) {
      gap = (inner - sum) / (flow.length - 1);
    } else {
      const total = sum + gap * Math.max(0, flow.length - 1);
      if (n.primaryAxisAlignItems === 'CENTER') cursor += (inner - total) / 2;
      else if (n.primaryAxisAlignItems === 'MAX') cursor += inner - total;
    }
    // Approximate first-line baseline distance from a child's top (real Figma
    // computes this exactly for BASELINE alignment; the preview estimates it).
    const baselineOf = (k) =>
      k.type === 'TEXT' ? Math.min(k.height, k.height - 0.22 * (k.fontSize || 16)) : k.height;
    const maxBaseline = n.counterAxisAlignItems === 'BASELINE' && horizontal
      ? Math.max(...flow.map(baselineOf), 0)
      : 0;
    for (const k of flow) {
      const kMain = horizontal ? k.width : k.height;
      const kCross = horizontal ? k.height : k.width;
      let cross = padCrossStart;
      if (n.counterAxisAlignItems === 'CENTER') cross = (crossSize - kCross) / 2;
      else if (n.counterAxisAlignItems === 'MAX') cross = crossSize - padCrossEnd - kCross;
      else if (n.counterAxisAlignItems === 'BASELINE' && horizontal) cross = padCrossStart + maxBaseline - baselineOf(k);
      if (horizontal) { k.x = cursor; k.y = cross; }
      else { k.y = cursor; k.x = cross; }
      cursor += kMain + gap;
    }
  }
  kids.forEach(simulateLayout);
}

// --------------------------------------------------------------- SVG render

let defs = [];
let defId = 0;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rgba = (c, opacity = 1) =>
  `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${((c.a ?? 1) * opacity).toFixed(3)})`;

function gradientDef(id, fill) {
  // First row of gradientTransform: t = m00*x + m01*y + m02 in normalized coords.
  const [m00, m01, m02] = fill.gradientTransform[0];
  const uu = m00 * m00 + m01 * m01 || 1;
  const x1 = (-m02 * m00) / uu;
  const y1 = (-m02 * m01) / uu;
  const x2 = ((1 - m02) * m00) / uu;
  const y2 = ((1 - m02) * m01) / uu;
  const stops = fill.gradientStops
    .map((s) => `<stop offset="${s.position}" stop-color="${rgba(s.color)}"/>`)
    .join('');
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`;
}

function shadowFilterCss(n) {
  const shadows = (n.effects || []).filter((e) => e.type === 'DROP_SHADOW' && e.visible !== false);
  if (!shadows.length) return '';
  const css = shadows
    .map((e) => `drop-shadow(${e.offset.x}px ${e.offset.y}px ${e.radius}px ${rgba(e.color)})`)
    .join(' ');
  return ` style="filter:${css}"`;
}

function renderBox(n) {
  const rx = n.topLeftRadius || n.cornerRadius || 0;
  let out = '';
  const shadow = shadowFilterCss(n);
  for (const f of n.fills || []) {
    if (f.visible === false) continue;
    if (f.type === 'SOLID') {
      out += `<rect width="${n.width}" height="${n.height}" rx="${rx}" fill="${rgba(f.color, f.opacity ?? 1)}"${out ? '' : shadow}/>`;
    } else if (f.type === 'GRADIENT_LINEAR') {
      const id = `g${defId++}`;
      defs.push(gradientDef(id, f));
      out += `<rect width="${n.width}" height="${n.height}" rx="${rx}" fill="url(#${id})"${out ? '' : shadow}/>`;
    } else if (f.type === 'IMAGE' && images[f.imageHash]) {
      let img = `<image width="${n.width}" height="${n.height}" href="${images[f.imageHash]}" preserveAspectRatio="${f.scaleMode === 'FIT' ? 'xMidYMid meet' : 'xMidYMid slice'}"/>`;
      if (rx > 0) {
        const id = `c${defId++}`;
        defs.push(`<clipPath id="${id}"><rect width="${n.width}" height="${n.height}" rx="${rx}"/></clipPath>`);
        img = `<g clip-path="url(#${id})">${img}</g>`;
      }
      out += img;
    }
  }
  if ((n.strokes || []).length && n.strokeWeight > 0) {
    const s = n.strokes[0];
    const w = n.strokeWeight;
    const dash = n.dashPattern && n.dashPattern.length ? ` stroke-dasharray="${n.dashPattern.join(' ')}"` : '';
    out += `<rect x="${w / 2}" y="${w / 2}" width="${Math.max(0, n.width - w)}" height="${Math.max(0, n.height - w)}" rx="${Math.max(0, rx - w / 2)}" fill="none" stroke="${rgba(s.color, s.opacity ?? 1)}" stroke-width="${w}"${dash}/>`;
  }
  return out;
}

const STYLE_WEIGHTS = {
  Thin: 100, 'Extra Light': 200, Light: 300, Regular: 400, Medium: 500,
  'Semi Bold': 600, Bold: 700, 'Extra Bold': 800, Black: 900,
};

function renderText(n) {
  const font = n.fontName || { family: 'Inter', style: 'Regular' };
  const styleBase = font.style.replace(' Italic', '').replace(/^Italic$/, 'Regular');
  const weight = STYLE_WEIGHTS[styleBase] || 400;
  const italic = font.style.includes('Italic');
  const fill = n.fills && n.fills[0] ? rgba(n.fills[0].color, n.fills[0].opacity ?? 1) : '#000';
  const lineHeight = n.lineHeight && n.lineHeight.unit === 'PIXELS' ? `${n.lineHeight.value}px` : 'normal';
  const letterSpacing = n.letterSpacing && n.letterSpacing.value ? `${n.letterSpacing.value}px` : 'normal';
  const decoration = n.textDecoration === 'UNDERLINE' ? 'underline' : n.textDecoration === 'STRIKETHROUGH' ? 'line-through' : 'none';
  const transform = { UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize' }[n.textCase] || 'none';
  const align = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' }[n.textAlignHorizontal] || 'left';
  const style =
    `font-family:'${font.family}',Inter,sans-serif;font-size:${n.fontSize}px;font-weight:${weight};` +
    (italic ? 'font-style:italic;' : '') +
    `color:${fill};line-height:${lineHeight};letter-spacing:${letterSpacing};` +
    `text-decoration:${decoration};text-transform:${transform};text-align:${align};margin:0;`;
  return (
    `<foreignObject x="${n.x}" y="${n.y}" width="${Math.ceil(n.width) + 2}" height="${Math.ceil(n.height) + 2}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${style}">${esc(n.characters)}</div></foreignObject>`
  );
}

function renderNode(n) {
  if (n.visible === false) return '';
  const opacity = n.opacity !== 1 ? ` opacity="${n.opacity}"` : '';
  if (n.type === 'TEXT') {
    return opacity ? `<g${opacity}>${renderText(n)}</g>` : renderText(n);
  }
  if (n.type === 'SVG_FRAME') {
    return `<g transform="translate(${n.x},${n.y})"${opacity}>${n.__svg || ''}</g>`;
  }
  let kids = (n.children || []).map(renderNode).join('');
  if (n.clipsContent && kids) {
    const rx = n.topLeftRadius || n.cornerRadius || 0;
    const id = `c${defId++}`;
    defs.push(`<clipPath id="${id}"><rect width="${n.width}" height="${n.height}" rx="${rx}"/></clipPath>`);
    kids = `<g clip-path="url(#${id})">${kids}</g>`;
  }
  return `<g transform="translate(${n.x},${n.y})"${opacity}>${renderBox(n)}${kids}</g>`;
}

// --------------------------------------------------------------------- main

async function screenshotOriginal(file, width) {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const pg = await context.newPage();
    const url = /^https?:\/\//i.test(file) ? file : pathToFileURL(path.resolve(file)).href;
    await pg.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    return await pg.screenshot({ fullPage: true });
  } finally {
    await browser.close();
  }
}

async function run() {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const context = vm.createContext({ figma, console, Uint8Array, Math, JSON, String, Array, Object, Promise });
  await new vm.Script(source, { filename: scriptPath }).runInContext(context);
  await new Promise((resolve) => setTimeout(resolve, 50)); // let the script's async main settle

  const root = page.children[0];
  if (!root) throw new Error('Script created no nodes');
  root.x = 0;
  root.y = 0;
  simulateLayout(root);

  defs = [];
  defId = 0;
  const body = renderNode(root);
  const w = Math.ceil(root.width);
  const h = Math.ceil(root.height);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs>${defs.join('')}</defs>${body}</svg>`;

  console.log(`Screenshotting ${htmlPath} at ${w}px wide...`);
  const png = await screenshotOriginal(htmlPath, w);
  const pngUrl = `data:image/png;base64,${png.toString('base64')}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>html-to-figma preview</title>
<style>
  body { font-family: Inter, system-ui, sans-serif; margin: 24px; background: #fafafa; color: #111; }
  h1 { font-size: 20px; } h2 { font-size: 15px; color: #555; font-weight: 600; }
  .cols { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
  .pane { border: 1px solid #ddd; background: #fff; border-radius: 8px; padding: 12px; }
  .pane > img, .pane > svg { display: block; max-width: 100%; height: auto; }
  .overlay { position: relative; width: ${w}px; max-width: 100%; }
  .overlay > img { display: block; width: 100%; }
  .overlay > .top { position: absolute; inset: 0; }
  .overlay > .top > svg { width: 100%; height: auto; }
  label { font-size: 13px; color: #555; }
</style></head><body>
<h1>html-to-figma preview — ${esc(path.basename(htmlPath))}</h1>
<p>Left: real browser render. Right: simulated Figma output (mock plugin API + simulated Auto Layout). If they match, the generated script is faithful.</p>
<div class="cols">
  <div class="pane"><h2>Browser render</h2><img src="${pngUrl}" width="${w}"></div>
  <div class="pane"><h2>Simulated Figma output</h2>${svg}</div>
</div>
<h2 style="margin-top:32px">Overlay (drag slider — differences show as ghosting)</h2>
<label>Figma layer opacity: <input type="range" min="0" max="100" value="50" oninput="document.getElementById('top').style.opacity=this.value/100"></label>
<div class="pane" style="margin-top:8px">
  <div class="overlay">
    <img src="${pngUrl}">
    <div class="top" id="top" style="opacity:.5">${svg}</div>
  </div>
</div>
</body></html>`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log(`Preview written to ${outPath} — open it in any browser.`);
}

run().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
