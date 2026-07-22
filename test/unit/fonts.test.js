import { test } from 'node:test';
import assert from 'node:assert/strict';
import { primaryFamily, collectFonts, fontReport } from '../../src/fonts.js';

test('primaryFamily: first family, unquoted', () => {
  assert.equal(primaryFamily('Inter, Arial, sans-serif'), 'Inter');
  assert.equal(primaryFamily('"Brand Font", sans-serif'), 'Brand Font');
  assert.equal(primaryFamily("'My Font'"), 'My Font');
  assert.equal(primaryFamily(''), '');
});

const tree = {
  type: 'FRAME',
  children: [
    { type: 'TEXT', text: { fontFamily: 'Inter, sans-serif', fontWeight: 400, italic: false } },
    { type: 'TEXT', text: { fontFamily: 'Inter, sans-serif', fontWeight: 700, italic: false } },
    { type: 'TEXT', text: { fontFamily: '"Brand Sans", sans-serif', fontWeight: 500, italic: true } },
    { type: 'FRAME', children: [{ type: 'TEXT', text: { fontFamily: 'Georgia, serif', fontWeight: 400, italic: false } }] },
  ],
};

test('collectFonts: groups weights per primary family, recursively', () => {
  const map = collectFonts(tree);
  assert.deepEqual([...map.get('Inter')].sort(), ['400', '700']);
  assert.deepEqual([...map.get('Brand Sans')], ['500 italic']);
  assert.ok(map.has('Georgia'));
});

test('fontReport: known fonts and generics are OK; unknown falls back', () => {
  const { ok, fallback } = fontReport(collectFonts(tree));
  const names = (arr) => arr.map((e) => e.family);
  assert.ok(names(ok).includes('Inter'));
  assert.ok(names(ok).includes('Georgia'));
  assert.deepEqual(names(fallback), ['Brand Sans']);
  assert.deepEqual(fallback[0].weights, ['500 italic']);
});

test('fontReport: respects a supplied available set', () => {
  const map = new Map([['Custom', new Set(['400'])]]);
  assert.equal(fontReport(map, new Set(['custom'])).fallback.length, 0);
  assert.equal(fontReport(map, new Set()).fallback.length, 1);
});
