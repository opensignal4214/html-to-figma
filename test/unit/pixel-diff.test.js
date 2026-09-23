import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pixelDiff } from '../pixel-diff.js';

// Build an RGBA buffer of n identical pixels.
const fill = (n, [r, g, b, a]) => {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) out.set([r, g, b, a], i * 4);
  return out;
};

test('pixelDiff: identical buffers → perfect fidelity', () => {
  const a = fill(100, [10, 20, 30, 255]);
  const r = pixelDiff(a, a.slice());
  assert.equal(r.diff, 0);
  assert.equal(r.fidelity, 1);
});

test('pixelDiff: fully different → zero fidelity', () => {
  const a = fill(50, [0, 0, 0, 255]);
  const b = fill(50, [255, 255, 255, 255]);
  const r = pixelDiff(a, b);
  assert.equal(r.diff, 50);
  assert.equal(r.fidelity, 0);
});

test('pixelDiff: half the pixels differ → 0.5', () => {
  const a = new Uint8ClampedArray(4 * 4);
  const b = new Uint8ClampedArray(4 * 4);
  for (let i = 0; i < 4; i++) {
    a.set([0, 0, 0, 255], i * 4);
    b.set(i < 2 ? [0, 0, 0, 255] : [255, 0, 0, 255], i * 4);
  }
  const r = pixelDiff(a, b);
  assert.equal(r.fraction, 0.5);
});

test('pixelDiff: small differences within tolerance are ignored', () => {
  const a = fill(10, [100, 100, 100, 255]);
  const b = fill(10, [110, 108, 92, 255]); // ≤16 per channel
  const r = pixelDiff(a, b, 16);
  assert.equal(r.diff, 0);
});

test('pixelDiff: transparent vs opaque of same color counts as different', () => {
  const a = fill(10, [200, 50, 50, 255]);
  const b = fill(10, [200, 50, 50, 0]); // same rgb, alpha 0 → composited differs
  const r = pixelDiff(a, b);
  assert.equal(r.diff, 10);
});

test('pixelDiff: length mismatch throws', () => {
  assert.throws(() => pixelDiff(fill(2, [0, 0, 0, 0]), fill(3, [0, 0, 0, 0])), /length mismatch/);
});

// ---- contentFidelity (ROADMAP 2.5 D): honest metric

import { contentFidelity } from '../pixel-diff.js';

const canvas = (w, h, bg = [255, 255, 255, 255]) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(bg, i * 4);
  return d;
};
const rect = (d, w, x0, y0, rw, rh, col) => {
  for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) d.set(col, (y * w + x) * 4);
};

test('contentFidelity: identical renders → 1', () => {
  const a = canvas(40, 40);
  rect(a, 40, 4, 4, 10, 10, [255, 0, 0, 255]);
  assert.equal(contentFidelity(a, a.slice(), 40, 40).fidelity, 1);
});

test('contentFidelity: empty background cannot dilute a wrong element (legacy metric would say 98%)', () => {
  const [w, h] = [100, 100];
  const a = canvas(w, h);
  const b = canvas(w, h);
  rect(a, w, 10, 10, 10, 10, [255, 0, 0, 255]);
  rect(b, w, 60, 60, 10, 10, [255, 0, 0, 255]); // same element, completely misplaced
  assert.equal(pixelDiff(a, b).fidelity, 0.98);
  assert.equal(contentFidelity(a, b, w, h).fidelity, 0);
});

test('contentFidelity: a 1px anti-aliasing shift is tolerated', () => {
  const [w, h] = [40, 40];
  const a = canvas(w, h);
  const b = canvas(w, h);
  rect(a, w, 10, 0, 1, h, [0, 0, 0, 255]); // hairline at x=10
  rect(b, w, 11, 0, 1, h, [0, 0, 0, 255]); // …rendered 1px over at x=11
  assert.equal(pixelDiff(a, b).fidelity < 1, true);
  assert.equal(contentFidelity(a, b, w, h).fidelity, 1);
});

test('contentFidelity: real color errors still count', () => {
  const [w, h] = [20, 40];
  const a = canvas(w, h);
  const b = canvas(w, h);
  rect(a, w, 0, 0, 20, 10, [255, 0, 0, 255]);
  rect(b, w, 0, 0, 20, 10, [0, 0, 255, 255]);
  const r = contentFidelity(a, b, w, h);
  assert.equal(r.fidelity, 0);
  assert.equal(r.content, 50); // 20×10 px at half resolution
});

test('contentFidelity: scores a region only; background = dominant page color', () => {
  const [w, h] = [40, 20];
  const a = canvas(w, h, [240, 240, 240, 255]);
  const b = canvas(w, h, [240, 240, 240, 255]);
  rect(a, w, 0, 0, 20, 20, [255, 255, 255, 255]); // component A: white card
  rect(b, w, 0, 0, 20, 20, [255, 255, 255, 255]);
  rect(a, w, 30, 0, 4, 4, [0, 0, 0, 255]); // component B differs
  assert.equal(contentFidelity(a, b, w, h, { region: [0, 0, 20, 20] }).fidelity, 1);
  assert.equal(contentFidelity(a, b, w, h, { region: [20, 0, 20, 20] }).fidelity, 0);
});

test('contentFidelity: nothing but background → 1 with zero content', () => {
  const a = canvas(10, 10);
  const r = contentFidelity(a, a.slice(), 10, 10);
  assert.deepEqual([r.fidelity, r.content], [1, 0]);
});

test('contentFidelity: sub-pixel text placement (half-pixel AA smear) is tolerated', () => {
  const [w, h] = [40, 40];
  const a = canvas(w, h);
  const b = canvas(w, h);
  rect(a, w, 10, 5, 1, 30, [0, 0, 0, 255]); // crisp stroke
  rect(b, w, 10, 5, 1, 30, [128, 128, 128, 255]); // same stroke at x+0.5 → two half-grey columns
  rect(b, w, 11, 5, 1, 30, [128, 128, 128, 255]);
  assert.equal(contentFidelity(a, b, w, h).fidelity, 1);
});

test('contentFidelity: a 3px misplacement is NOT tolerated', () => {
  const [w, h] = [60, 60];
  const a = canvas(w, h);
  const b = canvas(w, h);
  rect(a, w, 10, 10, 2, 30, [0, 0, 0, 255]);
  rect(b, w, 13, 10, 2, 30, [0, 0, 0, 255]);
  assert.ok(contentFidelity(a, b, w, h).fidelity < 0.5);
});
