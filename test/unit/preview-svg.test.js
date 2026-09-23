import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeSvg, mainAxisPlan, crossAxisOffset, svgMatrix, paintSpaceToPixels, rotatedBounds } from '../preview-util.js';

test('sizeSvg: injects width/height when missing, keeps existing viewBox', () => {
  const out = sizeSvg('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>', 16, 16);
  assert.match(out, /width="16"/);
  assert.match(out, /height="16"/);
  assert.match(out, /viewBox="0 0 24 24"/);
  assert.match(out, /<path d="M0 0"\/>/); // content preserved
});

test('sizeSvg: overrides an existing viewport-sized width/height', () => {
  const out = sizeSvg('<svg width="100%" height="100%" viewBox="0 0 10 10"></svg>', 32, 24);
  assert.match(out, /width="32"/);
  assert.match(out, /height="24"/);
  assert.doesNotMatch(out, /100%/);
});

test('sizeSvg: synthesizes viewBox from original width/height when absent', () => {
  const out = sizeSvg('<svg width="48" height="48"><circle/></svg>', 20, 20);
  assert.match(out, /viewBox="0 0 48 48"/);
  assert.match(out, /width="20"/);
});

test('sizeSvg: preserves other attributes like xmlns and fill', () => {
  const out = sizeSvg('<svg xmlns="http://www.w3.org/2000/svg" fill="none" width="24" height="24"></svg>', 30, 30);
  assert.match(out, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(out, /fill="none"/);
  assert.match(out, /width="30"/);
});

test('sizeSvg: non-svg input returned unchanged', () => {
  assert.equal(sizeSvg('<div>not svg</div>', 10, 10), '<div>not svg</div>');
});

// Figma Auto Layout primary-axis distribution (typings diagrams match CSS
// flexbox semantics for SPACE_BETWEEN / SPACE_AROUND / SPACE_EVENLY).
test('mainAxisPlan: packed and distributed alignments', () => {
  // inner 100, children 10 + 20 (sum 30), itemSpacing 4
  const plan = (align) => mainAxisPlan(align, 100, [10, 20], 4);
  assert.deepEqual(plan('MIN'), { start: 0, gap: 4 });
  assert.deepEqual(plan('CENTER'), { start: 33, gap: 4 });
  assert.deepEqual(plan('MAX'), { start: 66, gap: 4 });
  assert.deepEqual(plan('SPACE_BETWEEN'), { start: 0, gap: 70 });
  // around: free 70 / 2 items = 35 per item, half at each edge
  assert.deepEqual(plan('SPACE_AROUND'), { start: 17.5, gap: 35 });
  // evenly: free 70 / 3 slots
  const e = plan('SPACE_EVENLY');
  assert.ok(Math.abs(e.start - 70 / 3) < 1e-9 && Math.abs(e.gap - 70 / 3) < 1e-9);
  // single child: SPACE_BETWEEN packs to start, AROUND/EVENLY center it
  assert.deepEqual(mainAxisPlan('SPACE_BETWEEN', 100, [10], 4), { start: 0, gap: 4 });
  assert.deepEqual(mainAxisPlan('SPACE_AROUND', 100, [10], 4), { start: 45, gap: 4 });
  assert.deepEqual(mainAxisPlan('SPACE_EVENLY', 100, [10], 4), { start: 45, gap: 4 });
});

// ---- spec-faithful rendering (ROADMAP 2.5 C): Figma matrices → SVG

const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const nums = (str) => str.match(/matrix\(([^)]*)\)/)[1].trim().split(/[\s,]+/).map(Number);
const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps, `${msg}: ${a} vs ${b}`);

test('svgMatrix: relativeTransform [[a,c,e],[b,d,f]] → SVG matrix(a b c d e f)', () => {
  assert.equal(svgMatrix([[1, 0, 10], [0, 1, 20]]), 'matrix(1 0 0 1 10 20)');
  // Figma rotation 90 (CCW): local +x axis points up (0,-1) in parent space
  const m = nums(svgMatrix([[0, 1, 5], [-1, 0, 7]]));
  close(apply(m, [1, 0]), [5, 6], 'x-axis');
});

test('paintSpaceToPixels: identity gradientTransform spans the box left→right', () => {
  const m = nums(paintSpaceToPixels([[1, 0, 0], [0, 1, 0]], 200, 100));
  close(apply(m, [0, 0.5]), [0, 50], 'start handle');
  close(apply(m, [1, 0.5]), [200, 50], 'end handle');
});

test('paintSpaceToPixels: inverts T·diag(1/w, 1/h) (Figma samples t = gx of T·(x/w, y/h))', () => {
  const T = [[0.3, 0.8, -0.1], [-0.6, 0.4, 0.5]];
  const [w, h] = [320, 180];
  const m = nums(paintSpaceToPixels(T, w, h));
  for (const g of [[0, 0], [1, 0.5], [0.25, 0.9]]) {
    const [px, py] = apply(m, g);
    const back = [T[0][0] * (px / w) + T[0][1] * (py / h) + T[0][2], T[1][0] * (px / w) + T[1][1] * (py / h) + T[1][2]];
    close(back, g, `round-trip ${g}`, 1e-9);
  }
});

test('paintSpaceToPixels: crop imageTransform places the image rect (object-position 0 0)', () => {
  // visible sub-rect w=0.5 of the image from its left edge → image is 2× box width at x=0
  const m = nums(paintSpaceToPixels([[0.5, 0, 0], [0, 1, 0]], 300, 150));
  close(apply(m, [0, 0]), [0, 0], 'image top-left');
  close(apply(m, [1, 1]), [600, 150], 'image bottom-right');
});

test('rotatedBounds: AABB of a rotated w×h box (auto-layout sizes rotated children by it)', () => {
  const b = rotatedBounds([[0, 1, 0], [-1, 0, 0]], 80, 40); // 90° CCW
  close([b.minX, b.minY], [0, -80], 'min');
  close([b.width, b.height], [40, 80], 'size');
});

test('crossAxisOffset: alignment within the PADDED cross axis', () => {
  // cross size 100, padding 10 start / 30 end, child 20 → content box 10..70
  assert.equal(crossAxisOffset('MIN', 100, 10, 30, 20), 10);
  assert.equal(crossAxisOffset('CENTER', 100, 10, 30, 20), 30); // 10 + (60 - 20) / 2
  assert.equal(crossAxisOffset('MAX', 100, 10, 30, 20), 50);
});
