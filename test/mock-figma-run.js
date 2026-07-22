// Smoke test: execute a generated script against a minimal mock of the
// Figma Plugin API. Catches runtime errors (bad property sets, ordering bugs)
// without needing Figma. Usage: node test/mock-figma-run.js <script.js>
import fs from 'node:fs';
import vm from 'node:vm';

const scriptPath = process.argv[2] || 'out/figma-script.js';
const source = fs.readFileSync(scriptPath, 'utf8');

let created = 0;
const counts = { FRAME: 0, COMPONENT: 0, TEXT: 0, RECTANGLE: 0, SVG_FRAME: 0 };

function makeNode(type) {
  created++;
  counts[type] = (counts[type] || 0) + 1;
  const node = {
    type,
    name: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    opacity: 1,
    blendMode: 'NORMAL',
    fills: [],
    strokes: [],
    effects: [],
    dashPattern: [],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    cornerRadius: 0,
    topLeftRadius: 0,
    topRightRadius: 0,
    bottomRightRadius: 0,
    bottomLeftRadius: 0,
    clipsContent: false,
    layoutMode: 'NONE',
    layoutWrap: 'NO_WRAP',
    layoutPositioning: 'AUTO',
    primaryAxisSizingMode: 'AUTO',
    counterAxisSizingMode: 'AUTO',
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: 'MIN',
    itemSpacing: 0,
    counterAxisSpacing: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
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
  return node;
}

function makeText() {
  const node = makeNode('TEXT');
  let fontLoaded = false;
  node._setFont = () => { fontLoaded = true; };
  let chars = '';
  Object.defineProperty(node, 'fontName', {
    set() { fontLoaded = true; },
    get() { return { family: 'Inter', style: 'Regular' }; },
  });
  Object.defineProperty(node, 'characters', {
    set(v) {
      if (!fontLoaded) throw new Error('Cannot set characters before loading font');
      chars = v;
    },
    get() { return chars; },
  });
  node.fontSize = 12;
  node.lineHeight = { unit: 'AUTO' };
  node.letterSpacing = { value: 0, unit: 'PIXELS' };
  node.textAlignHorizontal = 'LEFT';
  node.textAlignVertical = 'TOP';
  node.textDecoration = 'NONE';
  node.textCase = 'ORIGINAL';
  node.textAutoResize = 'NONE';
  node.textTruncation = 'DISABLED';
  return node;
}

const AVAILABLE_FONTS = new Set(['Inter|Regular', 'Inter|Bold', 'Inter|Italic', 'Inter|Medium', 'Inter|Semi Bold', 'Inter|Extra Bold', 'Roboto Mono|Regular', 'Georgia|Regular']);

const page = makeNode('PAGE');
const figma = {
  currentPage: page,
  viewport: {
    center: { x: 0, y: 0 },
    scrollAndZoomIntoView(nodes) {
      if (!Array.isArray(nodes) || !nodes.length) throw new Error('scrollAndZoomIntoView needs nodes');
    },
  },
  createFrame: () => makeNode('FRAME'),
  createComponent: () => makeNode('COMPONENT'),
  createRectangle: () => makeNode('RECTANGLE'),
  createText: () => makeText(),
  createNodeFromSvg(svg) {
    if (typeof svg !== 'string' || !svg.includes('<svg')) throw new Error('invalid svg');
    return makeNode('SVG_FRAME');
  },
  createImage(bytes) {
    if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('createImage needs bytes');
    return { hash: 'mock-hash-' + bytes.length };
  },
  async loadFontAsync(font) {
    if (!AVAILABLE_FONTS.has(`${font.family}|${font.style}`)) {
      throw new Error(`font unavailable: ${font.family} ${font.style}`);
    }
  },
  notify(msg) { console.log('[figma.notify]', msg); },
  closePlugin() { console.log('[figma.closePlugin]'); },
};

Object.defineProperty(page, 'selection', {
  set(nodes) {
    if (!Array.isArray(nodes)) throw new Error('selection must be an array');
  },
  get() { return []; },
});

const context = vm.createContext({ figma, console, Uint8Array, Math, JSON, String, Array, Object, Promise });
const result = new vm.Script(source, { filename: scriptPath }).runInContext(context);

Promise.resolve(result).then(
  () =>
    setTimeout(() => {
      console.log(`OK: ${created} nodes created`, counts);
      if (!counts.COMPONENT) {
        console.error('FAIL: no components created');
        process.exit(1);
      }
      if (!counts.TEXT) {
        console.error('FAIL: no text nodes created');
        process.exit(1);
      }
    }, 100),
  (err) => {
    console.error('FAIL:', err);
    process.exit(1);
  },
);
