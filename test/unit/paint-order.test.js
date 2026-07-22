import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintOrder } from '../../src/css-map.js';

// paintOrder(items) takes children in DOM order — each { position, zIndex,
// flexItem } as computed-style-like values — and returns the original indices
// reordered back-to-front (first = painted first = bottom in Figma).

const S = (position = 'static', zIndex = 'auto', flexItem = false) => ({ position, zIndex, flexItem });

test('paintOrder: all static keeps DOM order', () => {
  assert.deepEqual(paintOrder([S(), S(), S()]), [0, 1, 2]);
});

test('paintOrder: positive z-index positioned child paints last (on top)', () => {
  // index 0 is an absolute badge with z-index:10; should end up last (top)
  assert.deepEqual(paintOrder([S('absolute', '10'), S(), S()]), [1, 2, 0]);
});

test('paintOrder: negative z-index positioned child paints first (behind)', () => {
  // index 2 is absolute z-index:-1; should end up first (bottom)
  assert.deepEqual(paintOrder([S(), S(), S('absolute', '-1')]), [2, 0, 1]);
});

test('paintOrder: positioned z-auto paints above all normal-flow siblings', () => {
  // A positioned (z:auto) element paints after non-positioned descendants,
  // even if it appears earlier in the DOM.
  assert.deepEqual(paintOrder([S('absolute'), S(), S()]), [1, 2, 0]);
});

test('paintOrder: multiple positive z sorted ascending, ties keep DOM order', () => {
  const items = [S('absolute', '5'), S('absolute', '2'), S('absolute', '5')];
  // 2 first, then the two 5s in DOM order (index 0 before 2)
  assert.deepEqual(paintOrder(items), [1, 0, 2]);
});

test('paintOrder: full layering — negative, flow, z-auto positioned, positive', () => {
  const items = [
    S('absolute', '3'), // 0: top-ish
    S(),                // 1: flow
    S('absolute', '-2'),// 2: behind everything
    S('relative'),      // 3: positioned z-auto, above flow
    S('absolute', '1'), // 4: positive but below index 0
  ];
  // back→front: [2] neg, [1] flow, [3] z-auto positioned, [4] z1, [0] z3
  assert.deepEqual(paintOrder(items), [2, 1, 3, 4, 0]);
});

test('paintOrder: flex item honors z-index even when position is static', () => {
  // In a flex container a static child with z-index participates in z-order.
  assert.deepEqual(paintOrder([S('static', '5', true), S('static', 'auto', true)]), [1, 0]);
});

test('paintOrder: non-flex static child ignores z-index (no stacking)', () => {
  // z-index has no effect on a static non-flex child; DOM order preserved.
  assert.deepEqual(paintOrder([S('static', '5', false), S('static', 'auto', false)]), [0, 1]);
});

test('paintOrder: sticky and fixed count as positioned', () => {
  assert.deepEqual(paintOrder([S('sticky', '2'), S()]), [1, 0]);
  assert.deepEqual(paintOrder([S('fixed', '-1'), S()]), [0, 1]);
});

test('paintOrder: empty and single-item inputs', () => {
  assert.deepEqual(paintOrder([]), []);
  assert.deepEqual(paintOrder([S('absolute', '9')]), [0]);
});
