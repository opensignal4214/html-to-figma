import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markerString, romanNumeral, alphaLabel } from '../../src/css-map.js';

test('markerString: unordered bullets by list-style-type', () => {
  assert.equal(markerString('disc', 1), '•');
  assert.equal(markerString('circle', 3), '◦');
  assert.equal(markerString('square', 2), '▪');
});

test('markerString: none yields empty string', () => {
  assert.equal(markerString('none', 4), '');
});

test('markerString: decimal and leading-zero', () => {
  assert.equal(markerString('decimal', 1), '1.');
  assert.equal(markerString('decimal', 42), '42.');
  assert.equal(markerString('decimal-leading-zero', 7), '07.');
  assert.equal(markerString('decimal-leading-zero', 12), '12.');
});

test('markerString: alphabetic (lower/upper, latin alias)', () => {
  assert.equal(markerString('lower-alpha', 1), 'a.');
  assert.equal(markerString('upper-alpha', 26), 'Z.');
  assert.equal(markerString('lower-latin', 27), 'aa.');
  assert.equal(markerString('upper-latin', 28), 'AB.');
});

test('markerString: roman (lower/upper)', () => {
  assert.equal(markerString('lower-roman', 4), 'iv.');
  assert.equal(markerString('upper-roman', 9), 'IX.');
  assert.equal(markerString('upper-roman', 2024), 'MMXXIV.');
});

test('markerString: unknown type falls back to a bullet', () => {
  assert.equal(markerString('hebrew', 3), '•');
});

test('romanNumeral: representative values', () => {
  assert.equal(romanNumeral(1), 'I');
  assert.equal(romanNumeral(4), 'IV');
  assert.equal(romanNumeral(40), 'XL');
  assert.equal(romanNumeral(90), 'XC');
  assert.equal(romanNumeral(2024), 'MMXXIV');
});

test('romanNumeral: out-of-range falls back to the number', () => {
  assert.equal(romanNumeral(0), '0');
  assert.equal(romanNumeral(-3), '-3');
});

test('alphaLabel: bijective base-26', () => {
  assert.equal(alphaLabel(1), 'A');
  assert.equal(alphaLabel(26), 'Z');
  assert.equal(alphaLabel(27), 'AA');
  assert.equal(alphaLabel(52), 'AZ');
  assert.equal(alphaLabel(53), 'BA');
});
