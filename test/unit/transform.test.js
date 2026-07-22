import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeMatrix } from '../../src/css-map.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

test('decomposeMatrix: none / identity → null (no transform to apply)', () => {
  assert.equal(decomposeMatrix('none'), null);
  assert.equal(decomposeMatrix('matrix(1, 0, 0, 1, 0, 0)'), null);
});

test('decomposeMatrix: rotate(45deg) → 45° clockwise, unit scale', () => {
  // rotate(45deg) computes to matrix(0.7071, 0.7071, -0.7071, 0.7071, 0, 0)
  const d = decomposeMatrix('matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)');
  assert.ok(near(d.rotationDeg, 45), `rotationDeg=${d.rotationDeg}`);
  assert.ok(near(d.scaleX, 1) && near(d.scaleY, 1));
  assert.ok(near(d.skewXDeg, 0));
});

test('decomposeMatrix: negative rotation', () => {
  const d = decomposeMatrix('matrix(0.866025, -0.5, 0.5, 0.866025, 0, 0)'); // -30deg
  assert.ok(near(d.rotationDeg, -30), `rotationDeg=${d.rotationDeg}`);
});

test('decomposeMatrix: scale(2, 3) → scales, no rotation', () => {
  const d = decomposeMatrix('matrix(2, 0, 0, 3, 0, 0)');
  assert.ok(near(d.scaleX, 2) && near(d.scaleY, 3));
  assert.ok(near(d.rotationDeg, 0));
});

test('decomposeMatrix: translation captured separately, not treated as identity', () => {
  const d = decomposeMatrix('matrix(1, 0, 0, 1, 10, 20)');
  assert.ok(d, 'translation is a real transform');
  assert.ok(near(d.translateX, 10) && near(d.translateY, 20));
  assert.ok(near(d.rotationDeg, 0) && near(d.scaleX, 1));
});

test('decomposeMatrix: rotate + scale combined', () => {
  // rotate(90deg) scale(2): matrix(0, 2, -2, 0, 0, 0)
  const d = decomposeMatrix('matrix(0, 2, -2, 0, 0, 0)');
  assert.ok(near(d.rotationDeg, 90), `rotationDeg=${d.rotationDeg}`);
  assert.ok(near(d.scaleX, 2) && near(d.scaleY, 2));
});

test('decomposeMatrix: skewX produces a non-zero skew angle', () => {
  // skewX(20deg): matrix(1, 0, 0.36397, 1, 0, 0)
  const d = decomposeMatrix('matrix(1, 0, 0.36397, 1, 0, 0)');
  assert.ok(near(d.skewXDeg, 20, 0.5), `skewXDeg=${d.skewXDeg}`);
});

test('decomposeMatrix: matrix3d uses the 2D-relevant components', () => {
  // matrix3d for rotate(45deg): columns; 2D a=m11,b=m12,c=m21,d=m22,e=m41,f=m42
  const d = decomposeMatrix('matrix3d(0.707107, 0.707107, 0, 0, -0.707107, 0.707107, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)');
  assert.ok(near(d.rotationDeg, 45), `rotationDeg=${d.rotationDeg}`);
});
