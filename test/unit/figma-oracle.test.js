import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { generateScript } from '../../src/generate.js';
import { parseLinearGradient, parseRadialGradient, objectFitCrop } from '../../src/css-map.js';
import { createFigmaEmu, applyToPoint } from '../figma-emu.js';

// Oracle tests (ROADMAP 2.5 B). Every matrix the builder emits is decoded with
// Figma's OFFICIAL semantics (typings) or the independent @figma-plugin/helpers
// decoders, and compared against CSS-spec pixel geometry computed here from
// first principles. No builder/css-map transform code is reused on the
// expected side.

const require = createRequire(import.meta.url);
const {
  extractLinearGradientParamsFromTransform,
  extractRadialOrDiamondGradientParams,
  extractImageCropParams,
} = require('@figma-plugin/helpers');

const EPS = 0.05; // px
const near = (a, b, eps = EPS) => Math.abs(a - b) <= eps;
const nearPt = (a, b, msg, eps = EPS) =>
  assert.ok(near(a[0], b[0], eps) && near(a[1], b[1], eps), `${msg}: got (${a.map((v) => v.toFixed(3))}) want (${b.map((v) => v.toFixed(3))})`);

async function runTree(tree) {
  const emu = createFigmaEmu();
  const script = generateScript(tree);
  const quiet = { log() {}, warn() {}, error: (...a) => { throw new Error(a.join(' ')); } };
  const ctx = vm.createContext({ figma: emu.figma, console: quiet, Uint8Array, Math, JSON, String, Array, Object, Promise });
  await new vm.Script(script).runInContext(ctx);
  await new Promise((r) => setTimeout(r, 10));
  return emu;
}

const find = (node, name) => {
  if (node.name === name) return node;
  for (const k of node.children || []) {
    const f = find(k, name);
    if (f) return f;
  }
  return null;
};

// ------------------------------------------------------------------ rotation

/** CSS: untransformed box rotated by cssDeg (clockwise, y-down) about its center. */
function cssRotatedCorners(rect, cssDeg) {
  const t = (cssDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]]
    .map(([x, y]) => [cx + c * (x - cx) - s * (y - cy), cy + s * (x - cx) + c * (y - cy)]);
}

const rotTree = (rect, figmaRotation, parentLayout = { mode: 'NONE' }) => ({
  type: 'FRAME', name: 'Root', rect: { x: 0, y: 0, width: 300, height: 300 }, layout: parentLayout, style: {}, component: null,
  children: [{
    type: 'FRAME', name: 'Rot', rect, rotation: figmaRotation, layout: { mode: 'NONE' },
    style: { background: { r: 1, g: 0, b: 0, a: 1 } }, component: null, children: [],
  }],
});

for (const cssDeg of [30, -45, 90, 135, 180]) {
  test(`rotation: Figma node matches CSS rotate(${cssDeg}deg) about the center (official relativeTransform semantics)`, async () => {
    const rect = { x: 50, y: 70, width: 80, height: 40 };
    // extract.js convention: Figma rotation = -CSS degrees (CCW-positive).
    const emu = await runTree(rotTree(rect, -cssDeg));
    const node = find(emu.page, 'Rot');
    // Root is placed at the viewport center; measure in the root's own space.
    const m = node.relativeTransform;
    const got = [[0, 0], [node.width, 0], [node.width, node.height], [0, node.height]].map((p) => applyToPoint(m, p));
    const want = cssRotatedCorners(rect, cssDeg);
    got.forEach((p, i) => nearPt(p, want[i], `corner ${i}`));
    assert.ok(near(((node.rotation + cssDeg + 540) % 360) - 180, 0, 1e-6), `rotation=${node.rotation}`);
  });
}

test('rotation: in an auto-layout flow the builder keeps the 2x2 only (translation is layout-owned)', async () => {
  const emu = await runTree(rotTree({ x: 50, y: 70, width: 80, height: 40 }, -30,
    { mode: 'HORIZONTAL', primaryAlign: 'MIN', counterAlign: 'MIN', gap: 0, padding: [0, 0, 0, 0] }));
  const node = find(emu.page, 'Rot');
  assert.ok(near(node.rotation, -30, 1e-6), `rotation=${node.rotation}`);
});

// ------------------------------------------------------------ linear gradient

/** CSS Images 3 §3.1.1: gradient line for `angle` on a w×h box. */
function cssLinearEndpoints(deg, w, h) {
  const t = (deg * Math.PI) / 180;
  const dx = Math.sin(t);
  const dy = -Math.cos(t);
  const len = Math.abs(w * Math.sin(t)) + Math.abs(h * Math.cos(t));
  return {
    start: [w / 2 - (dx * len) / 2, h / 2 - (dy * len) / 2],
    end: [w / 2 + (dx * len) / 2, h / 2 + (dy * len) / 2],
  };
}

/**
 * CSS corner keywords: the gradient line is perpendicular to the diagonal
 * joining the two NEIGHBOURING corners. For `to top right` that diagonal is
 * TL→BR = (w, h), so the direction is (h, -w)/n = (sin θ, -cos θ) → θ = atan2(h, w).
 */
function cssCornerAngle(vert, horiz, w, h) {
  const a = (Math.atan2(h, w) * 180) / Math.PI;
  const deg = { 'top right': a, 'bottom right': 180 - a, 'bottom left': 180 + a, 'top left': 360 - a }[`${vert} ${horiz}`];
  return deg;
}

const LINEAR_CASES = [];
for (const [w, h] of [[100, 100], [320, 180], [80, 240]]) {
  for (const deg of [0, 30, 45, 90, 135, 200, 315]) LINEAR_CASES.push({ css: `${deg}deg`, deg, w, h });
  for (const [v, hz] of [['bottom', 'right'], ['top', 'left']]) {
    LINEAR_CASES.push({ css: `to ${v} ${hz}`, deg: cssCornerAngle(v, hz, w, h), w, h });
  }
  // Chrome's computed serialization puts the horizontal keyword first.
  LINEAR_CASES.push({ css: 'to right top', deg: cssCornerAngle('top', 'right', w, h), w, h });
  LINEAR_CASES.push({ css: 'to left bottom', deg: cssCornerAngle('bottom', 'left', w, h), w, h });
}

for (const c of LINEAR_CASES) {
  test(`linear: ${c.css} on ${c.w}×${c.h} decodes (oracle) to the CSS gradient line`, () => {
    const g = parseLinearGradient(`linear-gradient(${c.css}, rgb(0, 0, 0), rgb(255, 255, 255))`, c.w, c.h);
    const { start, end } = extractLinearGradientParamsFromTransform(c.w, c.h, g.transform);
    const want = cssLinearEndpoints(c.deg, c.w, c.h);
    nearPt(start, want.start, 'start', 0.5);
    nearPt(end, want.end, 'end', 0.5);
  });
}

test('linear: row 0 is exactly the CSS t functional at every pixel (Figma samples t = gx)', () => {
  const [w, h] = [320, 180];
  const g = parseLinearGradient('linear-gradient(135deg, rgb(0, 0, 0), rgb(255, 255, 255))', w, h);
  const { start, end } = cssLinearEndpoints(135, w, h);
  const d = [end[0] - start[0], end[1] - start[1]];
  const L2 = d[0] ** 2 + d[1] ** 2;
  for (const [px, py] of [[0, 0], [w, h], [w, 0], [0, h], [100, 37]]) {
    const cssT = ((px - start[0]) * d[0] + (py - start[1]) * d[1]) / L2;
    const [m00, m01, m02] = g.transform[0];
    const figT = m00 * (px / w) + m01 * (py / h) + m02;
    assert.ok(near(figT, cssT, 1e-3), `(${px},${py}) figma t=${figT} css t=${cssT}`);
  }
});

// ------------------------------------------------------------ radial gradient

/** CSS Images 3 §3.2: ending-shape center and radii on a w×h box. */
function cssRadial({ shape, size, at }, w, h) {
  const cx = at[0] * w;
  const cy = at[1] * h;
  const sides = [cx, w - cx, cy, h - cy];
  const dxs = [cx, w - cx];
  const dys = [cy, h - cy];
  const corners = dxs.flatMap((dx) => dys.map((dy) => [dx, dy]));
  let rx;
  let ry;
  if (shape === 'circle') {
    const r = {
      'closest-side': Math.min(...sides),
      'farthest-side': Math.max(...sides),
      'closest-corner': Math.min(...corners.map(([a, b]) => Math.hypot(a, b))),
      'farthest-corner': Math.max(...corners.map(([a, b]) => Math.hypot(a, b))),
    }[size];
    rx = ry = r;
  } else {
    if (size === 'closest-side' || size === 'farthest-side') {
      const pick = size === 'closest-side' ? Math.min : Math.max;
      rx = pick(...dxs);
      ry = pick(...dys);
    } else {
      // corner sizes keep the closest/farthest-side aspect ratio, scaled by √2
      const pick = size === 'closest-corner' ? Math.min : Math.max;
      rx = pick(...dxs) * Math.SQRT2;
      ry = pick(...dys) * Math.SQRT2;
    }
  }
  return { center: [cx, cy], radius: [rx, ry] };
}

const RADIAL_CASES = [];
for (const [w, h] of [[200, 200], [320, 180]]) {
  for (const shape of ['circle', 'ellipse']) {
    for (const size of ['closest-side', 'farthest-side', 'closest-corner', 'farthest-corner']) {
      for (const [atCss, at] of [['center', [0.5, 0.5]], ['30% 70%', [0.3, 0.7]]]) {
        RADIAL_CASES.push({ css: `${shape} ${size} at ${atCss}`, spec: { shape, size, at }, w, h });
      }
    }
  }
  RADIAL_CASES.push({ css: null, spec: { shape: 'ellipse', size: 'farthest-corner', at: [0.5, 0.5] }, w, h }); // CSS default
  RADIAL_CASES.push({ css: 'circle', spec: { shape: 'circle', size: 'farthest-corner', at: [0.5, 0.5] }, w, h });
  RADIAL_CASES.push({ css: 'at left top', spec: { shape: 'ellipse', size: 'farthest-corner', at: [0, 0] }, w, h });
}

for (const c of RADIAL_CASES) {
  test(`radial: ${c.css ?? '(default)'} on ${c.w}×${c.h} decodes (oracle) to the CSS ending shape`, () => {
    const body = c.css ? `${c.css}, rgb(0, 0, 0), rgb(255, 255, 255)` : 'rgb(0, 0, 0), rgb(255, 255, 255)';
    const g = parseRadialGradient(`radial-gradient(${body})`, c.w, c.h);
    const got = extractRadialOrDiamondGradientParams(c.w, c.h, g.transform);
    const want = cssRadial(c.spec, c.w, c.h);
    nearPt(got.center, want.center, 'center', 0.5);
    nearPt(got.radius, want.radius, 'radius', 0.5);
  });
}

// Explicit sizes and position forms (center/radii written out from the spec).
for (const [css, center, radius] of [
  ['circle 40px at center', [160, 90], [40, 40]],
  ['at center top', [160, 0], [320 * Math.SQRT2 / 2, 180 * Math.SQRT2]], // Chrome's form of `at top`
  ['ellipse 50% 25% at center', [160, 90], [160, 45]],
  ['60px 30px at 10px 20px', [10, 20], [60, 30]],
  ['closest-side at top', [160, 0], [160, 0]], // ellipse: min(160,160) × min(0,180) = 0, guarded
  ['circle farthest-side at right 10px bottom 20px', [310, 160], [310, 310]],
]) {
  test(`radial: ${css} on 320×180 decodes (oracle) to the CSS ending shape`, () => {
    const [w, h] = [320, 180];
    const g = parseRadialGradient(`radial-gradient(${css}, rgb(0, 0, 0), rgb(255, 255, 255))`, w, h);
    const got = extractRadialOrDiamondGradientParams(w, h, g.transform);
    nearPt(got.center, center, 'center', 0.5);
    if (css.startsWith('closest-side at top')) {
      // degenerate ry = 0 (center on the edge): must stay invertible, rx exact
      assert.ok(near(got.radius[0], radius[0], 0.5) && got.radius[1] < 1, `radius=${got.radius}`);
    } else {
      nearPt(got.radius, radius, 'radius', 0.5);
    }
  });
}

// ---------------------------------------------------------------- image crop

/** Figma FILL (cover + center) expressed as a crop transform, for decoding. */
function fillTransform(box, nat) {
  const s = Math.max(box.width / nat.width, box.height / nat.height);
  const w = box.width / (nat.width * s);
  const h = box.height / (nat.height * s);
  return [[w, 0, (1 - w) / 2], [0, h, (1 - h) / 2]];
}

for (const [fit, pos] of [['cover', [0.5, 0.5]], ['cover', [0, 0]], ['cover', [1, 0.25]]]) {
  test(`crop: object-fit:${fit} object-position:${pos} decodes (oracle) to the CSS image rect (regression lock)`, () => {
    const box = { width: 300, height: 150 };
    const nat = { width: 200, height: 200 };
    const r = objectFitCrop(box, nat, fit, pos[0], pos[1]);
    // Figma FILL is "cover, centered" by definition, so centered cover emits
    // FILL; model it as the identity image transform for decoding.
    const c = r.scaleMode === 'FILL' ? null : r.crop;
    if (!c) assert.deepEqual(pos, [0.5, 0.5], 'FILL is only equivalent at centered position');
    const t = c ? [[c.w, 0, c.x], [0, c.h, c.y]] : fillTransform(box, nat);
    const got = extractImageCropParams(box.width, box.height, t);
    // CSS: cover scale = max(box/nat); image drawn at (box - drawn)·pos
    const s = Math.max(box.width / nat.width, box.height / nat.height);
    const dw = nat.width * s;
    const dh = nat.height * s;
    const dx = (box.width - dw) * pos[0];
    const dy = (box.height - dh) * pos[1];
    nearPt(got.size, [dw, dh], 'size', 0.5);
    nearPt(got.position, [-dx, -dy], 'position', 0.5);
  });
}
