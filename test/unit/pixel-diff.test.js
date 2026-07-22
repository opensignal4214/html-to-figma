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
