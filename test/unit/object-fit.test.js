import { test } from 'node:test';
import assert from 'node:assert/strict';
import { objectFitCrop } from '../../src/css-map.js';

// objectFitCrop(container, intrinsic, fit, posX, posY) → { scaleMode, crop? }
// posX/posY are 0..1 fractions (object-position). crop is the normalized
// visible sub-rectangle of the image {x,y,w,h}, only for off-center cover.

const box = { width: 100, height: 100 };

test('contain → FIT, no crop', () => {
  assert.deepEqual(objectFitCrop(box, { width: 200, height: 100 }, 'contain', 0.5, 0.5), { scaleMode: 'FIT' });
});

test('fill / default → FILL (aspect-preserving center, unchanged behavior)', () => {
  assert.deepEqual(objectFitCrop(box, { width: 200, height: 100 }, 'fill', 0.5, 0.5), { scaleMode: 'FILL' });
});

test('cover, centered → FILL (identical to previous output)', () => {
  assert.deepEqual(objectFitCrop(box, { width: 200, height: 100 }, 'cover', 0.5, 0.5), { scaleMode: 'FILL' });
});

test('cover, wide image positioned left → CROP showing the left half', () => {
  // 200x100 image into 100x100: scale = max(100/200,100/100)=1 → displayed 200x100.
  // overflowX=100. posX=0 (left) → show left 100px = normalized x 0, width 0.5.
  const out = objectFitCrop(box, { width: 200, height: 100 }, 'cover', 0, 0.5);
  assert.equal(out.scaleMode, 'CROP');
  assert.ok(Math.abs(out.crop.x - 0) < 1e-9);
  assert.ok(Math.abs(out.crop.w - 0.5) < 1e-9);
  assert.ok(Math.abs(out.crop.h - 1) < 1e-9);
});

test('cover, wide image positioned right → CROP showing the right half', () => {
  const out = objectFitCrop(box, { width: 200, height: 100 }, 'cover', 1, 0.5);
  assert.equal(out.scaleMode, 'CROP');
  assert.ok(Math.abs(out.crop.x - 0.5) < 1e-9, `x=${out.crop.x}`);
  assert.ok(Math.abs(out.crop.w - 0.5) < 1e-9);
});

test('cover, tall image positioned top → CROP showing the top portion', () => {
  // 100x200 into 100x100: displayed 100x200, overflowY=100, posY=0 → top.
  const out = objectFitCrop(box, { width: 100, height: 200 }, 'cover', 0.5, 0);
  assert.equal(out.scaleMode, 'CROP');
  assert.ok(Math.abs(out.crop.y - 0) < 1e-9);
  assert.ok(Math.abs(out.crop.h - 0.5) < 1e-9);
  assert.ok(Math.abs(out.crop.w - 1) < 1e-9);
});

test('unknown intrinsic size falls back to FILL', () => {
  assert.deepEqual(objectFitCrop(box, { width: 0, height: 0 }, 'cover', 0, 0), { scaleMode: 'FILL' });
});
