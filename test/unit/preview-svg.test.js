import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeSvg, mainAxisPlan } from '../preview-util.js';

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
