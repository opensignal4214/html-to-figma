import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { mapFlexLayout, mapBoxStyle, mapTextStyle, objectFitCrop } from '../../src/css-map.js';

// Enum values that flow from tree data into the builder are `any` at the point
// of assignment, so `tsc --checkJs` can't see them. This test closes that gap:
// drive css-map's real functions across the CSS keyword space and assert every
// Figma enum it can emit is a member of the corresponding union in Figma's
// OFFICIAL typings (@figma/plugin-typings) — no Figma account needed.

const require = createRequire(import.meta.url);
const DTS = fs.readFileSync(require.resolve('@figma/plugin-typings/plugin-api.d.ts'), 'utf8');

/** String-literal members of a property's union type (e.g. `layoutMode:`). */
function propUnion(prop) {
  // Real interface members are indented exactly two spaces; deeper matches are
  // doc-comment code examples (e.g. `scaleMode: 'FILL'` inside a snippet).
  const start = DTS.search(new RegExp(`\\n  (?:readonly )?${prop}\\??:`));
  assert.ok(start >= 0, `property ${prop} not found in typings`);
  const rest = DTS.slice(start + 1);
  const end = rest.search(/\n\s+\/\*\*|\n\s+(?:readonly\s+)?\w+\??:|\n\}/); // next member or end of interface
  return new Set(rest.slice(0, end).match(/'[A-Z_]+'/g).map((s) => s.slice(1, -1)));
}

/** String-literal members of a type alias (e.g. `type BlendMode =`). */
function typeUnion(name) {
  const start = DTS.indexOf(`\ntype ${name} =`);
  assert.ok(start >= 0, `type ${name} not found in typings`);
  const rest = DTS.slice(start + 1);
  const end = rest.search(/\n(?:type |interface |\/\*\*|declare )/);
  return new Set(rest.slice(0, end).match(/'[A-Z_]+'/g).map((s) => s.slice(1, -1)));
}

const assertAllIn = (values, union, label) => {
  for (const v of values) if (v != null) assert.ok(union.has(v), `${label}: '${v}' is not a valid Figma value (${[...union].join(', ')})`);
};

const flexBase = {
  display: 'flex', flexDirection: 'row', justifyContent: 'normal', alignItems: 'normal', flexWrap: 'nowrap',
  columnGap: '0px', rowGap: '0px', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px',
};
const JUSTIFY = ['normal', 'flex-start', 'start', 'left', 'center', 'flex-end', 'end', 'right', 'space-between', 'space-around', 'space-evenly', 'stretch'];
const ALIGN = ['normal', 'flex-start', 'start', 'center', 'flex-end', 'end', 'baseline', 'stretch', 'self-start'];

test('typings extraction sanity: known unions parse correctly', () => {
  assert.ok(propUnion('layoutMode').has('HORIZONTAL'));
  assert.ok(typeUnion('BlendMode').has('LUMINOSITY'));
  assert.ok(propUnion('scaleMode').has('CROP'));
});

test('layout enums (layoutMode, primary/counter alignment) are valid Figma values', () => {
  const modes = []; const primary = []; const counter = [];
  for (const dir of ['row', 'row-reverse', 'column', 'column-reverse']) {
    for (const j of JUSTIFY) for (const a of ALIGN) {
      const l = mapFlexLayout({ ...flexBase, flexDirection: dir, justifyContent: j, alignItems: a });
      modes.push(l.mode); primary.push(l.primaryAlign); counter.push(l.counterAlign);
    }
  }
  modes.push(mapFlexLayout({ ...flexBase, display: 'block' }).mode);
  assertAllIn(modes, propUnion('layoutMode'), 'layoutMode');
  assertAllIn(primary, propUnion('primaryAxisAlignItems'), 'primaryAxisAlignItems');
  assertAllIn(counter, propUnion('counterAxisAlignItems'), 'counterAxisAlignItems');
});

test('CSS space-around / space-evenly map 1:1 to Figma (native since typings 1.x)', () => {
  assert.equal(mapFlexLayout({ ...flexBase, justifyContent: 'space-around' }).primaryAlign, 'SPACE_AROUND');
  assert.equal(mapFlexLayout({ ...flexBase, justifyContent: 'space-evenly' }).primaryAlign, 'SPACE_EVENLY');
});

const textBase = {
  fontFamily: 'Inter', fontWeight: '400', fontStyle: 'normal', fontSize: '16px', lineHeight: 'normal',
  letterSpacing: 'normal', color: 'rgb(0, 0, 0)', textAlign: 'start', textDecorationLine: 'none', textTransform: 'none',
};

test('text enums (align, case, decoration) are valid Figma values', () => {
  const aligns = []; const cases = []; const decos = [];
  for (const ta of ['start', 'end', 'left', 'right', 'center', 'justify', 'match-parent']) {
    for (const dir of ['ltr', 'rtl']) aligns.push(mapTextStyle({ ...textBase, textAlign: ta, direction: dir }).align);
  }
  for (const tt of ['none', 'uppercase', 'lowercase', 'capitalize', 'full-width']) cases.push(mapTextStyle({ ...textBase, textTransform: tt }).case);
  for (const td of ['none', 'underline', 'line-through', 'overline', 'underline line-through']) decos.push(mapTextStyle({ ...textBase, textDecorationLine: td }).decoration);
  assertAllIn(aligns, propUnion('textAlignHorizontal'), 'textAlignHorizontal');
  assertAllIn(cases, typeUnion('TextCase'), 'textCase');
  assertAllIn(decos, typeUnion('TextDecoration'), 'textDecoration');
});

const boxBase = {
  backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', backgroundSize: 'auto', backgroundRepeat: 'repeat',
  borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px',
  borderTopColor: 'rgb(0, 0, 0)', borderRightColor: 'rgb(0, 0, 0)', borderBottomColor: 'rgb(0, 0, 0)', borderLeftColor: 'rgb(0, 0, 0)',
  borderTopStyle: 'none', borderTopLeftRadius: '0px', borderTopRightRadius: '0px', borderBottomRightRadius: '0px',
  borderBottomLeftRadius: '0px', opacity: '1', boxShadow: 'none', overflow: 'visible',
};

test('blend modes: every CSS mix-blend-mode maps to a valid Figma BlendMode', () => {
  const css = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light',
    'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'plus-lighter'];
  const out = css.map((m) => mapBoxStyle({ ...boxBase, mixBlendMode: m }, { width: 10, height: 10 }).blendMode);
  assertAllIn(out, typeUnion('BlendMode'), 'blendMode');
});

test('image scale modes (object-fit + background) are valid Figma values', () => {
  const modes = [];
  for (const fit of ['fill', 'contain', 'cover', 'none', 'scale-down']) {
    for (const [px, py] of [[0.5, 0.5], [0, 0], [1, 1]]) {
      modes.push(objectFitCrop({ width: 60, height: 60 }, { width: 20, height: 10 }, fit, px, py).scaleMode);
    }
  }
  for (const size of ['auto', 'cover', 'contain', '10px 10px']) for (const rep of ['repeat', 'no-repeat']) {
    modes.push(mapBoxStyle({ ...boxBase, backgroundImage: 'url(a.png)', backgroundSize: size, backgroundRepeat: rep }, { width: 10, height: 10 }).bgScaleMode);
  }
  assertAllIn(modes, propUnion('scaleMode'), 'scaleMode');
});
