// Spec-faithful emulator of the Figma Plugin API node model, written from the
// OFFICIAL @figma/plugin-typings docs — not from the builder's assumptions.
//
// Transform semantics (plugin-api.d.ts, DimensionAndPositionMixin/LayoutMixin):
//   - `relativeTransform` [[m00, m01, m02], [m10, m11, m12]] is the source of
//     truth; local point (u, v) maps to parent (m00·u + m01·v + m02,
//     m10·u + m11·v + m12). Axes are always unit length (no scale).
//   - `x` ≡ m02, `y` ≡ m12.
//   - `rotation` ≡ atan2(-m10, m00) in degrees; setting it rewrites only
//     m00, m01, m10, m11 — i.e. it pivots about the node's TOP-LEFT.
//   - Children of auto-layout frames: translation is computed by the layout
//     engine (the emulator's layout pass overwrites m02/m12 for them).
//
// Independence rule: this file must not import builder or css-map transform
// code, so a wrong convention in either cannot hide itself.

const round = (v) => Math.round(v * 1e9) / 1e9;

export function rotation2x2(deg) {
  const t = (deg * Math.PI) / 180;
  const c = round(Math.cos(t));
  const s = round(Math.sin(t));
  // atan2(-m10, m00) must return deg → m10 = -sin, m00 = cos; unit, orthonormal.
  return [[c, s], [-s, c]];
}

export function multiply(a, b) {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1], a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1], a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2]],
  ];
}

export function applyToPoint(m, [u, v]) {
  return [m[0][0] * u + m[0][1] * v + m[0][2], m[1][0] * u + m[1][1] * v + m[1][2]];
}

/** Absolute (page-space) transform: product of relativeTransforms up the tree. */
export function absoluteTransform(node) {
  let m = node.relativeTransform;
  for (let p = node.parent; p && p.type !== 'PAGE'; p = p.parent) m = multiply(p.relativeTransform, m);
  return m;
}

/** Page-space corners of a node's box, clockwise from the local top-left. */
export function absoluteCorners(node) {
  const m = absoluteTransform(node);
  return [[0, 0], [node.width, 0], [node.width, node.height], [0, node.height]].map((p) => applyToPoint(m, p));
}

export function createFigmaEmu() {
  const images = {}; // imageHash -> Uint8Array
  let hashCounter = 0;
  const created = [];

  function makeNode(type) {
    let rt = [[1, 0, 0], [0, 1, 0]];
    const node = {
      type,
      name: '',
      width: 0, height: 0,
      opacity: 1,
      visible: true,
      blendMode: 'NORMAL',
      fills: [], strokes: [], effects: [], dashPattern: [],
      strokeWeight: 1, strokeAlign: 'INSIDE',
      strokeTopWeight: 0, strokeRightWeight: 0, strokeBottomWeight: 0, strokeLeftWeight: 0,
      cornerRadius: 0,
      topLeftRadius: 0, topRightRadius: 0, bottomRightRadius: 0, bottomLeftRadius: 0,
      clipsContent: false,
      layoutMode: 'NONE', layoutWrap: 'NO_WRAP', layoutPositioning: 'AUTO',
      primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO',
      primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'MIN',
      itemSpacing: 0, counterAxisSpacing: 0,
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      children: [],
      parent: null,
      resize(w, h) {
        if (!(w > 0) || !(h > 0)) throw new Error(`invalid resize(${w}, ${h})`);
        node.width = w;
        node.height = h;
      },
      appendChild(child) {
        if (child.parent) child.parent.children = child.parent.children.filter((k) => k !== child);
        node.children.push(child);
        child.parent = node;
      },
    };
    Object.defineProperties(node, {
      relativeTransform: {
        enumerable: true,
        get: () => [rt[0].slice(), rt[1].slice()],
        set(m) {
          if (!Array.isArray(m) || m.length !== 2 || m.some((r) => r.length !== 3 || r.some((v) => !Number.isFinite(v)))) {
            throw new Error('relativeTransform must be a 2x3 finite matrix');
          }
          const ax = Math.hypot(m[0][0], m[1][0]);
          const ay = Math.hypot(m[0][1], m[1][1]);
          if (Math.abs(ax - 1) > 1e-6 || Math.abs(ay - 1) > 1e-6) throw new Error('relativeTransform axes must be unit length');
          rt = [m[0].slice(), m[1].slice()];
        },
      },
      x: { enumerable: true, get: () => rt[0][2], set(v) { rt[0][2] = v; } },
      y: { enumerable: true, get: () => rt[1][2], set(v) { rt[1][2] = v; } },
      rotation: {
        enumerable: true,
        get: () => (Math.atan2(-rt[1][0], rt[0][0]) * 180) / Math.PI,
        set(deg) {
          const r = rotation2x2(deg);
          rt = [[r[0][0], r[0][1], rt[0][2]], [r[1][0], r[1][1], rt[1][2]]];
        },
      },
    });
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
        textTruncation: 'DISABLED',
      });
    }
    created.push(node);
    return node;
  }

  const page = makeNode('PAGE');
  let selection = [];
  Object.defineProperty(page, 'selection', { set(v) { selection = v; }, get: () => selection });
  const figma = {
    currentPage: page,
    viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView() {} },
    createFrame: () => makeNode('FRAME'),
    createComponent: () => makeNode('COMPONENT'),
    createRectangle: () => makeNode('RECTANGLE'),
    createText: () => makeNode('TEXT'),
    createNodeFromSvg(svg) {
      const node = makeNode('FRAME');
      node.__svg = svg;
      return node;
    },
    createImage(bytes) {
      const hash = `h${hashCounter++}`;
      images[hash] = bytes;
      return { hash };
    },
    async loadFontAsync() {},
    notify() {},
    closePlugin() {},
  };
  return { figma, page, images, created };
}
