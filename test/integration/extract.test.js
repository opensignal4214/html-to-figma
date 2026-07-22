import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTree } from '../../src/extract.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = (name) => path.join(REPO, 'test', 'fixtures', name);

// These drive a real headless Chromium, so they're slower than the pure unit
// tests. They pin extraction behavior that can only be observed end to end.

const find = (node, pred) => (pred(node) ? node : (node.children || []).map((c) => find(c, pred)).find(Boolean));
const firstText = (node) => {
  if (node.type === 'TEXT') return node.text.characters;
  for (const c of node.children || []) {
    const t = firstText(c);
    if (t) return t;
  }
  return null;
};

test('z-index: children emitted in back-to-front paint order, not DOM order', async () => {
  const tree = await extractTree(fixture('z-index.html'), { width: 400, height: 300 });
  const stage = find(tree, (n) => n.component === 'Stage');
  assert.ok(stage, 'Stage component found');
  const order = stage.children.map(firstText);
  // DOM order is Back, Front, Behind; paint order must be Behind(z-1), Back(z1), Front(z5).
  assert.deepEqual(order, ['Behind', 'Back', 'Front']);
});

test('rasterize fallback: unmappable elements become flagged image captures', async () => {
  const tree = await extractTree(fixture('raster.html'), { width: 400, height: 200 });
  const rasters = [];
  const collect = (n) => {
    if (/^\[raster\]/.test(n.name || '')) rasters.push(n);
    for (const c of n.children || []) collect(c);
  };
  collect(tree);
  // checkbox, radio, progress, filtered div, skewed div — all five.
  assert.equal(rasters.length, 5, `expected 5 raster nodes, got ${rasters.length}`);
  for (const r of rasters) {
    assert.equal(r.type, 'IMAGE');
    assert.ok(r.image && r.image.base64 && r.image.base64.length > 50, `${r.name} has image bytes`);
    assert.equal(r.rasterId, undefined, 'rasterId cleaned up');
  }
  assert.ok(rasters.some((r) => r.name.includes('input[checkbox]')));
  assert.ok(rasters.some((r) => r.name.includes('filter')));
  assert.ok(rasters.some((r) => r.name.includes('transform')));
});

test('transforms: rotated leaf boxes captured at untransformed size + angle', async () => {
  const tree = await extractTree(fixture('rotate.html'), { width: 400, height: 300 });
  const card = find(tree, (n) => (n.name || '').includes('card'));
  const badge = find(tree, (n) => (n.name || '').includes('badge'));
  assert.ok(card && badge, 'card and badge found');
  // CSS rotate(-12deg) → Figma +12 (CCW positive); untransformed size 120x100
  // (not the larger rotated AABB).
  assert.ok(Math.abs(card.rotation - 12) < 0.5, `card rotation ${card.rotation} ≈ 12`);
  assert.ok(Math.abs(card.rect.width - 120) < 1 && Math.abs(card.rect.height - 100) < 1);
  // CSS rotate(20deg) → Figma -20
  assert.ok(Math.abs(badge.rotation - -20) < 0.5, `badge rotation ${badge.rotation} ≈ -20`);
  assert.ok(Math.abs(badge.rect.width - 60) < 1 && Math.abs(badge.rect.height - 24) < 1);
});

test('object-fit: off-center cover produces a CROP rect; centered stays FILL', async () => {
  const tree = await extractTree(fixture('object-fit.html'), { width: 300, height: 200 });
  const imgs = [];
  const collect = (n) => {
    if (n.type === 'IMAGE') imgs.push(n);
    for (const c of n.children || []) collect(c);
  };
  collect(tree);
  const byAlt = (needle) => imgs.find((i) => (i.name || '').includes(needle));
  const left = byAlt('left');
  const center = byAlt('center');
  const fit = byAlt('fit');
  assert.equal(left.image.scaleMode, 'CROP');
  assert.ok(Math.abs(left.image.crop.x - 0) < 0.02 && Math.abs(left.image.crop.w - 0.5) < 0.02);
  assert.equal(center.image.scaleMode, 'FILL');
  assert.equal(center.image.crop, undefined);
  assert.equal(fit.image.scaleMode, 'FIT');
});

test('list markers: ul bullets and ol numbers (with start) synthesized as text', async () => {
  const tree = await extractTree(fixture('list.html'), { width: 400, height: 300 });
  const markers = [];
  const collect = (n) => {
    if (n.type === 'TEXT' && /^marker/.test(n.name || '')) markers.push(n.text.characters);
    for (const c of n.children || []) collect(c);
  };
  collect(tree);
  // Two disc bullets, then ol numbers continuing from start="3".
  assert.deepEqual(markers, ['•', '•', '3.', '4.']);
  // Markers sit left of their list item's content (in the gutter).
  const bulletNode = find(tree, (n) => n.type === 'TEXT' && n.name.startsWith('marker') && n.text.characters === '•');
  const itemNode = find(tree, (n) => n.type === 'TEXT' && n.text.characters === 'Apples');
  assert.ok(bulletNode.rect.x < itemNode.rect.x, 'bullet is left of the item text');
});

test('line-box: single-line text captured at full line-height, no drift', async () => {
  const tree = await extractTree(fixture('line-box.html'), { width: 400, height: 300 });
  const first = find(tree, (n) => n.type === 'TEXT' && n.text.characters === 'First line');
  const second = find(tree, (n) => n.type === 'TEXT' && n.text.characters === 'Second line');
  assert.ok(first && second, 'both text nodes found');
  // Each row's line box is 40px tall; the text nodes must reflect that and sit
  // exactly one line box apart, matching the flow the browser rendered.
  assert.ok(Math.abs(first.rect.height - 40) < 1, `first height ${first.rect.height} ≈ 40`);
  assert.ok(Math.abs(second.rect.y - (first.rect.y + 40)) < 1, `rows 40px apart (got ${second.rect.y - first.rect.y})`);
});
