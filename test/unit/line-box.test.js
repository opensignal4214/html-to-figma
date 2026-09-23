import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineBoxRect } from '../../src/css-map.js';

// Range.getBoundingClientRect gives *tight* glyph bounds — shorter than the CSS
// line box when line-height is generous. Text sits vertically centered in its
// line box, so using tight bounds makes stacked text drift up a few px.
// lineBoxRect expands a single-line tight rect to its line box, centered.

const tight = { x: 10, y: 100, width: 80, height: 19 };

test('lineBoxRect: single line expands to line-height, centered', () => {
  // line-height 32, glyph height 19 → pad (32-19)/2 = 6.5 above and below
  const box = lineBoxRect(tight, 32, 1);
  assert.equal(box.y, 100 - 6.5);
  assert.equal(box.height, 32);
  assert.equal(box.x, 10);
  assert.equal(box.width, 80);
});

test('lineBoxRect: no line-height known (AUTO) keeps tight rect', () => {
  assert.deepEqual(lineBoxRect(tight, null, 1), tight);
});

test('lineBoxRect: tighter line-height than glyphs does not shrink the box', () => {
  // line-height 16 < glyph 19 → don't clip the text
  assert.deepEqual(lineBoxRect(tight, 16, 1), tight);
});

test('lineBoxRect: multi-line expands to n line boxes (Figma starts line 1 at the node top)', () => {
  // wrap.html: 4 lines at 22px; tight glyph bounds y=2, h=83 → per-line glyph
  // height 83 - 3·22 = 17, half-leading (22 - 17) / 2 = 2.5
  const box = lineBoxRect({ x: 0, y: 2, width: 117.39, height: 83 }, 22, 4);
  assert.equal(box.y, -0.5);
  assert.equal(box.height, 88);
  assert.equal(box.width, 117.39);
});

test('lineBoxRect: multi-line whose spacing is not line-height (mixed inline content) stays tight', () => {
  const t = { x: 0, y: 0, width: 200, height: 60 };
  assert.deepEqual(lineBoxRect(t, 25, 3), t); // implied glyph height 10 < half the line → not a plain run
});

test('lineBoxRect: exact fit is a no-op', () => {
  assert.deepEqual(lineBoxRect({ x: 0, y: 0, width: 50, height: 20 }, 20, 1), { x: 0, y: 0, width: 50, height: 20 });
});
