import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFilters } from '../../src/css-map.js';

test('parseFilters: none → no effects, nothing unsupported', () => {
  const r = parseFilters('none', 'none');
  assert.deepEqual(r.effects, []);
  assert.equal(r.unsupported, false);
});

test('parseFilters: blur → LAYER_BLUR effect', () => {
  const r = parseFilters('blur(4px)', 'none');
  assert.equal(r.unsupported, false);
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].type, 'LAYER_BLUR');
  assert.equal(r.effects[0].radius, 4);
  assert.equal(r.effects[0].visible, true);
});

test('parseFilters: backdrop-filter blur → BACKGROUND_BLUR', () => {
  const r = parseFilters('none', 'blur(10px)');
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].type, 'BACKGROUND_BLUR');
  assert.equal(r.effects[0].radius, 10);
});

test('parseFilters: drop-shadow → DROP_SHADOW effect', () => {
  const r = parseFilters('drop-shadow(2px 4px 6px rgba(0, 0, 0, 0.5))', 'none');
  assert.equal(r.unsupported, false);
  const e = r.effects[0];
  assert.equal(e.type, 'DROP_SHADOW');
  assert.deepEqual(e.offset, { x: 2, y: 4 });
  assert.equal(e.radius, 6);
  assert.deepEqual(e.color, { r: 0, g: 0, b: 0, a: 0.5 });
});

test('parseFilters: multiple mappable functions combine', () => {
  const r = parseFilters('blur(2px) drop-shadow(0px 1px 2px rgba(0,0,0,1))', 'none');
  assert.equal(r.unsupported, false);
  assert.deepEqual(r.effects.map((e) => e.type), ['LAYER_BLUR', 'DROP_SHADOW']);
});

test('parseFilters: unsupported function flags for rasterization', () => {
  assert.equal(parseFilters('grayscale(100%)', 'none').unsupported, true);
  assert.equal(parseFilters('blur(2px) sepia(0.5)', 'none').unsupported, true);
  assert.equal(parseFilters('brightness(1.2)', 'none').unsupported, true);
});
