import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { generateScript } from '../../src/generate.js';
import { markComponents, pruneNestedComponents } from '../../src/extract.js';

const tinyTree = {
  type: 'FRAME',
  name: 'Page',
  rect: { x: 0, y: 0, width: 100, height: 100 },
  layout: { mode: 'NONE' },
  style: { background: { r: 1, g: 1, b: 1, a: 1 } },
  component: null,
  children: [
    {
      type: 'FRAME',
      name: 'div.card',
      rect: { x: 10, y: 10, width: 80, height: 40 },
      layout: { mode: 'NONE' },
      style: {},
      component: null,
      children: [],
    },
  ],
};

test('generateScript: output is syntactically valid JS', () => {
  const script = generateScript(tinyTree, { source: 'test.html' });
  assert.doesNotThrow(() => new vm.Script(script));
});

test('generateScript: embeds the tree and calls main', () => {
  const script = generateScript(tinyTree);
  assert.match(script, /const __TREE__ = \{/);
  assert.match(script, /"name":"div\.card"/);
  assert.match(script, /main\(__TREE__, \{ close: false \}\)/);
});

test('generateScript: closePlugin flag toggles plugin-mode teardown', () => {
  const plugin = generateScript(tinyTree, { closePlugin: true });
  assert.match(plugin, /main\(__TREE__, \{ close: true \}\)/);
  assert.match(plugin, /figma\.closePlugin\(\);/);
  const scripter = generateScript(tinyTree, { closePlugin: false });
  assert.match(scripter, /main\(__TREE__, \{ close: false \}\)/);
});

test('markComponents: auto-marks top-level frames when nothing is marked', () => {
  const tree = structuredClone(tinyTree);
  markComponents(tree);
  assert.equal(tree.component, null);
  assert.equal(tree.children[0].component, 'div.card');
});

test('markComponents: leaves explicit markings alone', () => {
  const tree = structuredClone(tinyTree);
  tree.children[0].component = 'My Card';
  const extra = structuredClone(tree.children[0]);
  extra.component = null;
  extra.name = 'div.other';
  tree.children.push(extra);
  markComponents(tree);
  assert.equal(tree.children[0].component, 'My Card');
  assert.equal(tree.children[1].component, null);
});

test('markComponents: falls back to the root when it has no frame children', () => {
  const tree = structuredClone(tinyTree);
  tree.children = [];
  markComponents(tree);
  assert.equal(tree.component, 'Page');
});

test('pruneNestedComponents: keeps the outermost mark, drops inner ones', () => {
  const tree = {
    type: 'FRAME', name: 'root', component: null,
    children: [
      {
        type: 'FRAME', name: 'card', component: 'Card',
        children: [
          { type: 'FRAME', name: 'btn', component: 'Button', children: [] }, // nested → dropped
        ],
      },
    ],
  };
  const dropped = pruneNestedComponents(tree);
  assert.deepEqual(dropped, ['Button']);
  assert.equal(tree.children[0].component, 'Card'); // outermost kept
  assert.equal(tree.children[0].children[0].component, null); // inner cleared
});

test('pruneNestedComponents: independent marks are all kept', () => {
  const tree = {
    type: 'FRAME', name: 'root', component: null,
    children: [
      { type: 'FRAME', name: 'a', component: 'A', children: [] },
      { type: 'FRAME', name: 'b', component: 'B', children: [] },
    ],
  };
  assert.deepEqual(pruneNestedComponents(tree), []);
  assert.equal(tree.children[0].component, 'A');
  assert.equal(tree.children[1].component, 'B');
});
