import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapClipPath } from '../../src/css-map.js';

test('mapClipPath: none → null', () => {
  assert.equal(mapClipPath('none', { width: 40, height: 40 }), null);
  assert.equal(mapClipPath('', { width: 40, height: 40 }), null);
});

test('mapClipPath: circle on a square element → full corner radius', () => {
  const r = mapClipPath('circle(50% at 50% 50%)', { width: 40, height: 40 });
  assert.equal(r.kind, 'radius');
  assert.deepEqual(r.radius, { tl: 20, tr: 20, br: 20, bl: 20 });
});

test('mapClipPath: circle on a NON-square element → raster (radius would be wrong)', () => {
  const r = mapClipPath('circle(50%)', { width: 80, height: 40 });
  assert.equal(r.kind, 'raster');
});

test('mapClipPath: polygon / inset / ellipse / path → raster', () => {
  assert.equal(mapClipPath('polygon(0 0, 100% 0, 100% 80%, 0 100%)', { width: 100, height: 60 }).kind, 'raster');
  assert.equal(mapClipPath('inset(10px 20px)', { width: 100, height: 60 }).kind, 'raster');
  assert.equal(mapClipPath('ellipse(40px 20px at 50% 50%)', { width: 80, height: 40 }).kind, 'raster');
  assert.equal(mapClipPath('path("M0 0 L10 0 Z")', { width: 40, height: 40 }).kind, 'raster');
});
