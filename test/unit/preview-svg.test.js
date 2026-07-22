import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeSvg } from '../preview-util.js';

test('sizeSvg: injects width/height when missing, keeps existing viewBox', () => {
  const out = sizeSvg('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>', 16, 16);
  assert.match(out, /width="16"/);
  assert.match(out, /height="16"/);
  assert.match(out, /viewBox="0 0 24 24"/);
  assert.match(out, /<path d="M0 0"\/>/); // content preserved
});

test('sizeSvg: overrides an existing viewport-sized width/height', () => {
  const out = sizeSvg('<svg width="100%" height="100%" viewBox="0 0 10 10"></svg>', 32, 24);
  assert.match(out, /width="32"/);
  assert.match(out, /height="24"/);
  assert.doesNotMatch(out, /100%/);
});

test('sizeSvg: synthesizes viewBox from original width/height when absent', () => {
  const out = sizeSvg('<svg width="48" height="48"><circle/></svg>', 20, 20);
  assert.match(out, /viewBox="0 0 48 48"/);
  assert.match(out, /width="20"/);
});

test('sizeSvg: preserves other attributes like xmlns and fill', () => {
  const out = sizeSvg('<svg xmlns="http://www.w3.org/2000/svg" fill="none" width="24" height="24"></svg>', 30, 30);
  assert.match(out, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(out, /fill="none"/);
  assert.match(out, /width="30"/);
});

test('sizeSvg: non-svg input returned unchanged', () => {
  assert.equal(sizeSvg('<div>not svg</div>', 10, 10), '<div>not svg</div>');
});
