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
