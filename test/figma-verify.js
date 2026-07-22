// True-Figma verification (ROADMAP 2.3). Exports a node from a real Figma file
// via the read-only REST API and pixel-diffs it against the browser render of
// the same source HTML — confirming the best-effort matrices (rotation pivot,
// crop/gradient transforms) against the actual Figma renderer.
//
// One unavoidable manual step first: paste the generated figma-script.js into
// the Scripter plugin and Run it, so the nodes exist in the file. Then:
//
//   FIGMA_TOKEN=... node test/figma-verify.js \
//     --file <fileKey> --source examples/pricing-card.html --name "Card / Pro"
//
// The token must be a read-only ("Read files" / file_content:read) PAT, passed
// via the FIGMA_TOKEN env var — never on the command line or in the repo.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../src/extract.js';
import { pixelDiff } from './pixel-diff.js';

const API = 'https://api.figma.com/v1';

/** Build the REST image-export URL for a node (PNG). Pure/testable. */
export function figmaImageUrl(fileKey, nodeId, { format = 'png', scale = 2 } = {}) {
  const params = new URLSearchParams({ ids: nodeId, format, scale: String(scale) });
  return `${API}/images/${encodeURIComponent(fileKey)}?${params}`;
}

/** Depth-first search of a Figma document node for the first node named `name`. */
export function findNodeByName(node, name) {
  if (!node) return null;
  if (node.name === name) return node;
  for (const child of node.children || []) {
    const hit = findNodeByName(child, name);
    if (hit) return hit;
  }
  return null;
}

/** First top-level canvas child (fallback when no name is given). */
export function firstTopLevelFrame(document) {
  for (const page of document.children || []) {
    for (const child of page.children || []) {
      if (child.type === 'FRAME' || child.type === 'COMPONENT' || child.type === 'INSTANCE') return child;
    }
  }
  return null;
}

async function figmaGet(url, token) {
  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) throw new Error(`Figma API ${res.status}: ${await res.text()}`);
  return res.json();
}

function parseArgs(argv) {
  const opts = { scale: 2, width: 1440 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') opts.file = argv[++i];
    else if (a === '--source') opts.source = argv[++i];
    else if (a === '--name') opts.name = argv[++i];
    else if (a === '--node') opts.node = argv[++i];
    else if (a === '--width') opts.width = parseInt(argv[++i], 10);
    else if (a === '--assert-fidelity') opts.assert = parseFloat(argv[++i]);
  }
  return opts;
}

async function screenshotSource(source, width) {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const url = /^https?:\/\//i.test(source) ? source : pathToFileURL(path.resolve(source)).href;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    return await page.screenshot({ fullPage: true });
  } finally {
    await browser.close();
  }
}

// Diff two PNG buffers by rasterizing both to a shared canvas in-browser (same
// approach the preview harness uses), reusing the pixelDiff tolerance semantics.
async function diffPngs(aBuf, bBuf) {
  const browser = await launchBrowser();
  try {
    const page = await (await browser.newContext()).newPage();
    const toUrl = (b) => `data:image/png;base64,${b.toString('base64')}`;
    const [wa, wb] = await page.evaluate(async ({ a, b }) => {
      const load = (src) => new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = src;
      });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.min(ia.naturalWidth, ib.naturalWidth);
      const h = Math.min(ia.naturalHeight, ib.naturalHeight);
      const grab = (img) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const cx = c.getContext('2d');
        cx.fillStyle = '#fff';
        cx.fillRect(0, 0, w, h);
        cx.drawImage(img, 0, 0, w, h);
        return Array.from(cx.getImageData(0, 0, w, h).data);
      };
      return [grab(ia), grab(ib)];
    }, { a: toUrl(aBuf), b: toUrl(bBuf) });
    return pixelDiff(Uint8ClampedArray.from(wa), Uint8ClampedArray.from(wb));
  } finally {
    await browser.close();
  }
}

async function run() {
  const token = process.env.FIGMA_TOKEN;
  const opts = parseArgs(process.argv.slice(2));
  if (!token) throw new Error('FIGMA_TOKEN env var is required (read-only "Read files" PAT).');
  if (!opts.file || !opts.source) throw new Error('Usage: --file <key> --source <html> [--name <component> | --node <id>] [--width]');

  let nodeId = opts.node;
  if (!nodeId) {
    console.log(`Reading Figma file ${opts.file}...`);
    const fileJson = await figmaGet(`${API}/files/${encodeURIComponent(opts.file)}`, token);
    const target = opts.name ? findNodeByName(fileJson.document, opts.name) : firstTopLevelFrame(fileJson.document);
    if (!target) throw new Error(`Node ${opts.name ? `named "${opts.name}"` : '(first top-level frame)'} not found in the file.`);
    nodeId = target.id;
    console.log(`Found node "${target.name}" (${nodeId}).`);
  }

  console.log('Exporting node PNG from Figma...');
  const images = await figmaGet(figmaImageUrl(opts.file, nodeId, { scale: opts.scale }), token);
  const imgUrl = images.images && images.images[nodeId];
  if (!imgUrl) throw new Error('Figma returned no image URL for the node.');
  const figmaPng = Buffer.from(await (await fetch(imgUrl)).arrayBuffer());

  console.log(`Screenshotting ${opts.source}...`);
  const browserPng = await screenshotSource(opts.source, opts.width);

  const { fidelity } = await diffPngs(browserPng, figmaPng);
  const pct = (fidelity * 100).toFixed(1);
  console.log(`\nReal-Figma fidelity (browser vs exported Figma node): ${pct}%`);
  console.log('Use this to confirm/refute the flagged matrices (rotation pivot, crop/gradient transforms).');

  if (opts.assert !== undefined && fidelity * 100 < opts.assert) {
    console.error(`Fidelity ${pct}% below required ${opts.assert}%`);
    process.exit(1);
  }
}

// Only run when invoked directly (keep pure exports importable by tests).
if (process.argv[1] && process.argv[1].endsWith('figma-verify.js')) {
  run().catch((err) => {
    console.error('figma-verify:', err.message);
    process.exit(1);
  });
}
