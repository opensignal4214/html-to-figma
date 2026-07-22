import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColor,
  splitTopLevel,
  parseShadows,
  parseLinearGradient,
  parseRadialGradient,
  pxOrPercent,
  matchCssUrl,
  mapFlexLayout,
  mapBoxStyle,
  mapTextStyle,
} from '../../src/css-map.js';

// ------------------------------------------------------------- parseColor

test('parseColor: rgb() maps to 0..1 channels with alpha 1', () => {
  assert.deepEqual(parseColor('rgb(255, 0, 0)'), { r: 1, g: 0, b: 0, a: 1 });
});

test('parseColor: rgba() keeps alpha', () => {
  assert.deepEqual(parseColor('rgba(0, 0, 0, 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 });
});

test('parseColor: fully transparent returns null (no fill emitted)', () => {
  assert.equal(parseColor('rgba(0, 0, 0, 0)'), null);
  assert.equal(parseColor('transparent'), null);
});

test('parseColor: non-color strings return null', () => {
  assert.equal(parseColor('none'), null);
  assert.equal(parseColor(''), null);
  assert.equal(parseColor(undefined), null);
});

test('parseColor: channels round to 2 decimals', () => {
  const c = parseColor('rgb(128, 64, 32)');
  assert.deepEqual(c, { r: 0.5, g: 0.25, b: 0.13, a: 1 });
});

// ---------------------------------------------------------- splitTopLevel

test('splitTopLevel: splits on commas outside parens only', () => {
  assert.deepEqual(splitTopLevel('rgba(0, 0, 0, 0.1) 0px 4px, rgba(1, 2, 3, 0.5) 1px 2px'), [
    'rgba(0, 0, 0, 0.1) 0px 4px',
    'rgba(1, 2, 3, 0.5) 1px 2px',
  ]);
});

test('splitTopLevel: single segment passes through', () => {
  assert.deepEqual(splitTopLevel('10px 20px'), ['10px 20px']);
});

// ------------------------------------------------------------ parseShadows

test('parseShadows: Chrome computed format (color first)', () => {
  const s = parseShadows('rgba(17, 24, 39, 0.08) 0px 10px 25px 0px');
  assert.deepEqual(s, [
    { x: 0, y: 10, blur: 25, spread: 0, inset: false, color: { r: 0.07, g: 0.09, b: 0.15, a: 0.08 } },
  ]);
});

test('parseShadows: multiple shadows and inset', () => {
  const s = parseShadows('rgba(0, 0, 0, 0.2) 0px 1px 2px 0px, rgba(255, 255, 255, 0.5) 0px -1px 0px 0px inset');
  assert.equal(s.length, 2);
  assert.equal(s[0].inset, false);
  assert.equal(s[1].inset, true);
  assert.equal(s[1].y, -1);
});

test('parseShadows: color-last authoring format also parses', () => {
  const s = parseShadows('0px 4px 6px rgba(0, 0, 0, 0.5)');
  assert.deepEqual(s[0], { x: 0, y: 4, blur: 6, spread: 0, inset: false, color: { r: 0, g: 0, b: 0, a: 0.5 } });
});

test('parseShadows: none / transparent-only returns null', () => {
  assert.equal(parseShadows('none'), null);
  assert.equal(parseShadows('rgba(0, 0, 0, 0) 0px 1px 2px 0px'), null);
});

// ------------------------------------------------------ parseLinearGradient

test('parseLinearGradient: two stops with explicit positions', () => {
  const g = parseLinearGradient('linear-gradient(135deg, rgb(79, 70, 229) 0%, rgb(124, 58, 237) 100%)');
  assert.equal(g.stops.length, 2);
  assert.deepEqual(g.stops[0], { color: { r: 0.31, g: 0.27, b: 0.9, a: 1 }, position: 0 });
  assert.equal(g.stops[1].position, 1);
});

test('parseLinearGradient: missing positions distribute evenly', () => {
  const g = parseLinearGradient('linear-gradient(90deg, rgb(0, 0, 0), rgb(100, 100, 100), rgb(255, 255, 255))');
  assert.deepEqual(g.stops.map((s) => s.position), [0, 0.5, 1]);
});

test('parseLinearGradient: "to right" (90deg) → t follows x axis', () => {
  const g = parseLinearGradient('linear-gradient(to right, rgb(0, 0, 0), rgb(255, 255, 255))');
  const [[m00, m01, m02]] = g.transform;
  // t = m00*x + m01*y + m02 must be 0 at x=0 and 1 at x=1 for any y
  assert.equal(Math.round(m00 * 100) / 100, 1);
  assert.equal(m01, 0);
  assert.equal(Math.abs(m02), 0);
});

test('parseLinearGradient: default direction is "to bottom" → t follows y axis', () => {
  const g = parseLinearGradient('linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))');
  const [[m00, m01, m02]] = g.transform;
  assert.equal(Math.abs(m00), 0);
  assert.equal(Math.round(m01 * 100) / 100, 1);
  assert.equal(Math.abs(m02), 0);
});

test('parseLinearGradient: corner keyword "to bottom right" ≈ 135deg diagonal', () => {
  const g = parseLinearGradient('linear-gradient(to bottom right, rgb(0, 0, 0), rgb(255, 255, 255))');
  const [[m00, m01]] = g.transform;
  // both axes contribute equally and positively (down-right diagonal)
  assert.ok(m00 > 0 && m01 > 0);
  assert.ok(Math.abs(m00 - m01) < 0.01);
});

test('parseLinearGradient: fewer than 2 color stops → null', () => {
  assert.equal(parseLinearGradient('linear-gradient(90deg, rgb(0, 0, 0))'), null);
});

test('parseLinearGradient: not a linear gradient → null', () => {
  assert.equal(parseLinearGradient('radial-gradient(rgb(0, 0, 0), rgb(255, 255, 255))'), null);
  assert.equal(parseLinearGradient('none'), null);
});

test('parseRadialGradient: bare radial → RADIAL type with stops', () => {
  const g = parseRadialGradient('radial-gradient(rgb(255, 0, 0), rgb(0, 0, 255))');
  assert.equal(g.type, 'RADIAL');
  assert.equal(g.stops.length, 2);
  assert.deepEqual(g.stops[0].color, { r: 1, g: 0, b: 0, a: 1 });
  assert.deepEqual(g.stops.map((s) => s.position), [0, 1]);
  assert.ok(Array.isArray(g.transform));
});

test('parseRadialGradient: shape/position descriptor is skipped', () => {
  const g = parseRadialGradient('radial-gradient(circle at 30% 30%, rgb(0,0,0) 0%, rgb(255,255,255) 100%)');
  assert.equal(g.stops.length, 2); // descriptor not counted as a stop
  assert.deepEqual(g.stops.map((s) => s.position), [0, 1]);
});

test('parseRadialGradient: not radial → null', () => {
  assert.equal(parseRadialGradient('linear-gradient(rgb(0,0,0), rgb(255,255,255))'), null);
  assert.equal(parseRadialGradient('none'), null);
});

// ---------------------------------------------------------------- helpers

test('pxOrPercent: px values and % resolved against a base', () => {
  assert.equal(pxOrPercent('8px', 100), 8);
  assert.equal(pxOrPercent('50%', 200), 100);
  assert.equal(pxOrPercent('', 100), 0);
});

test('matchCssUrl: extracts url() with or without quotes', () => {
  assert.equal(matchCssUrl('url("https://x.test/a.png")'), 'https://x.test/a.png');
  assert.equal(matchCssUrl("url('a.png')"), 'a.png');
  assert.equal(matchCssUrl('url(a.png)'), 'a.png');
  assert.equal(matchCssUrl('none'), null);
});

// ------------------------------------------------------------ mapFlexLayout

const flexBase = {
  display: 'flex',
  flexDirection: 'row',
  justifyContent: 'normal',
  alignItems: 'normal',
  flexWrap: 'nowrap',
  columnGap: '0px',
  rowGap: '0px',
  paddingTop: '0px',
  paddingRight: '0px',
  paddingBottom: '0px',
  paddingLeft: '0px',
};

test('mapFlexLayout: non-flex display → mode NONE', () => {
  assert.deepEqual(mapFlexLayout({ ...flexBase, display: 'block' }), { mode: 'NONE' });
});

test('mapFlexLayout: row uses column-gap, column uses row-gap', () => {
  const row = mapFlexLayout({ ...flexBase, columnGap: '24px', rowGap: '8px' });
  assert.equal(row.mode, 'HORIZONTAL');
  assert.equal(row.gap, 24);
  const col = mapFlexLayout({ ...flexBase, flexDirection: 'column', columnGap: '24px', rowGap: '8px' });
  assert.equal(col.mode, 'VERTICAL');
  assert.equal(col.gap, 8);
});

test('mapFlexLayout: inline-flex and column-reverse still map', () => {
  const l = mapFlexLayout({ ...flexBase, display: 'inline-flex', flexDirection: 'column-reverse' });
  assert.equal(l.mode, 'VERTICAL');
});

test('mapFlexLayout: reverse flag set only for *-reverse directions', () => {
  assert.equal(mapFlexLayout(flexBase).reverse, undefined);
  assert.equal(mapFlexLayout({ ...flexBase, flexDirection: 'row-reverse' }).reverse, true);
  assert.equal(mapFlexLayout({ ...flexBase, flexDirection: 'column-reverse' }).reverse, true);
});

test('mapFlexLayout: justify/align keywords map to Figma axis alignment', () => {
  const l = mapFlexLayout({ ...flexBase, justifyContent: 'space-between', alignItems: 'center' });
  assert.equal(l.primaryAlign, 'SPACE_BETWEEN');
  assert.equal(l.counterAlign, 'CENTER');
});

test('mapFlexLayout: space-around/evenly approximate to SPACE_BETWEEN (documented)', () => {
  assert.equal(mapFlexLayout({ ...flexBase, justifyContent: 'space-around' }).primaryAlign, 'SPACE_BETWEEN');
  assert.equal(mapFlexLayout({ ...flexBase, justifyContent: 'space-evenly' }).primaryAlign, 'SPACE_BETWEEN');
});

test('mapFlexLayout: baseline only valid on horizontal axis', () => {
  assert.equal(mapFlexLayout({ ...flexBase, alignItems: 'baseline' }).counterAlign, 'BASELINE');
  assert.equal(
    mapFlexLayout({ ...flexBase, flexDirection: 'column', alignItems: 'baseline' }).counterAlign,
    'MIN',
  );
});

test('mapFlexLayout: wrap only on horizontal', () => {
  assert.equal(mapFlexLayout({ ...flexBase, flexWrap: 'wrap' }).wrap, true);
  assert.equal(mapFlexLayout({ ...flexBase, flexDirection: 'column', flexWrap: 'wrap' }).wrap, false);
});

test('mapFlexLayout: padding carried through', () => {
  const l = mapFlexLayout({ ...flexBase, paddingTop: '32px', paddingLeft: '28px' });
  assert.equal(l.paddingTop, 32);
  assert.equal(l.paddingLeft, 28);
});

// -------------------------------------------------------------- mapBoxStyle

const boxBase = {
  backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none',
  backgroundSize: 'auto',
  borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px',
  borderTopColor: 'rgb(0, 0, 0)', borderRightColor: 'rgb(0, 0, 0)', borderLeftColor: 'rgb(0, 0, 0)', borderBottomColor: 'rgb(0, 0, 0)',
  borderTopStyle: 'none',
  borderTopLeftRadius: '0px', borderTopRightRadius: '0px',
  borderBottomRightRadius: '0px', borderBottomLeftRadius: '0px',
  opacity: '1',
  boxShadow: 'none',
  overflow: 'visible',
};
const rect100 = { width: 100, height: 50 };

test('mapBoxStyle: transparent box produces no fills/strokes/effects', () => {
  const st = mapBoxStyle(boxBase, rect100);
  assert.equal(st.background, undefined);
  assert.equal(st.border, undefined);
  assert.equal(st.shadows, undefined);
  assert.equal(st.radius, undefined);
  assert.equal(st.clip, undefined);
});

test('mapBoxStyle: background color becomes fill', () => {
  const st = mapBoxStyle({ ...boxBase, backgroundColor: 'rgb(255, 255, 255)' }, rect100);
  assert.deepEqual(st.background, { r: 1, g: 1, b: 1, a: 1 });
});

test('mapBoxStyle: linear-gradient captured, url() left for async fetch', () => {
  const grad = mapBoxStyle(
    { ...boxBase, backgroundImage: 'linear-gradient(90deg, rgb(0, 0, 0), rgb(255, 255, 255))' },
    rect100,
  );
  assert.ok(grad.gradient);
  const img = mapBoxStyle({ ...boxBase, backgroundImage: 'url("a.png")', backgroundSize: 'cover' }, rect100);
  assert.equal(img.bgUrl, 'a.png');
  assert.equal(img.bgScaleMode, 'FILL');
  const contain = mapBoxStyle({ ...boxBase, backgroundImage: 'url(a.png)', backgroundSize: 'contain' }, rect100);
  assert.equal(contain.bgScaleMode, 'FIT');
});

test('mapBoxStyle: single background layer keeps the existing keys (baseline-safe)', () => {
  const grad = mapBoxStyle(
    { ...boxBase, backgroundImage: 'linear-gradient(90deg, rgb(0,0,0), rgb(255,255,255))' },
    rect100,
  );
  assert.ok(grad.gradient, 'single gradient uses st.gradient');
  assert.equal(grad.bgLayers, undefined, 'no bgLayers for a single layer');
});

test('mapBoxStyle: multiple background layers → ordered bgLayers (first = top)', () => {
  const st = mapBoxStyle(
    {
      ...boxBase,
      backgroundColor: 'rgb(255, 255, 255)',
      backgroundImage: 'linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url("hero.jpg")',
      backgroundSize: 'auto, cover',
      backgroundRepeat: 'repeat, no-repeat',
    },
    rect100,
  );
  assert.equal(st.gradient, undefined, 'multi-layer does not set the single gradient key');
  assert.equal(st.bgUrl, undefined);
  assert.equal(st.bgLayers.length, 2);
  // CSS order: layer 0 is the top gradient overlay, layer 1 is the image.
  assert.equal(st.bgLayers[0].kind, 'gradient');
  assert.ok(st.bgLayers[0].gradient.stops);
  assert.equal(st.bgLayers[1].kind, 'image');
  assert.equal(st.bgLayers[1].url, 'hero.jpg');
  assert.equal(st.bgLayers[1].scaleMode, 'FILL'); // cover, no-repeat
  assert.deepEqual(st.background, { r: 1, g: 1, b: 1, a: 1 }); // solid stays for the bottom
});

test('mapBoxStyle: repeating natural-size background image → TILE', () => {
  const tile = mapBoxStyle(
    { ...boxBase, backgroundImage: 'url("tex.png")', backgroundRepeat: 'repeat', backgroundSize: 'auto' },
    rect100,
  );
  assert.equal(tile.bgScaleMode, 'TILE');
  // no-repeat with same auto size is a single stretched fill, not a tile
  const single = mapBoxStyle(
    { ...boxBase, backgroundImage: 'url("tex.png")', backgroundRepeat: 'no-repeat', backgroundSize: 'auto' },
    rect100,
  );
  assert.equal(single.bgScaleMode, 'FILL');
});

test('mapBoxStyle: uniform border → single width form, flags dashed', () => {
  const st = mapBoxStyle(
    {
      ...boxBase,
      borderTopWidth: '2px', borderRightWidth: '2px', borderBottomWidth: '2px', borderLeftWidth: '2px',
      borderTopColor: 'rgb(229, 231, 235)',
      borderTopStyle: 'dashed',
    },
    rect100,
  );
  assert.equal(st.border.width, 2);
  assert.equal(st.border.dashed, true);
  assert.deepEqual(st.border.color, { r: 0.9, g: 0.91, b: 0.92, a: 1 });
  assert.equal(st.border.top, undefined); // uniform → no per-side keys
});

test('mapBoxStyle: unequal border widths → per-side weights, color from widest side', () => {
  const st = mapBoxStyle(
    {
      ...boxBase,
      borderLeftWidth: '4px', // accent border, others 0
      borderLeftColor: 'rgb(79, 70, 229)',
    },
    rect100,
  );
  assert.equal(st.border.width, undefined);
  assert.deepEqual({ t: st.border.top, r: st.border.right, b: st.border.bottom, l: st.border.left }, { t: 0, r: 0, b: 0, l: 4 });
  assert.deepEqual(st.border.color, { r: 0.31, g: 0.27, b: 0.9, a: 1 }); // the left (widest) side's color
});

test('mapBoxStyle: percentage radius resolves against min(width, height)', () => {
  const st = mapBoxStyle({ ...boxBase, borderTopLeftRadius: '50%' }, { width: 100, height: 50 });
  assert.equal(st.radius.tl, 25);
});

test('mapBoxStyle: mix-blend-mode maps to a Figma blend mode; normal omitted', () => {
  assert.equal(mapBoxStyle(boxBase, rect100).blendMode, undefined);
  assert.equal(mapBoxStyle({ ...boxBase, mixBlendMode: 'multiply' }, rect100).blendMode, 'MULTIPLY');
  assert.equal(mapBoxStyle({ ...boxBase, mixBlendMode: 'color-dodge' }, rect100).blendMode, 'COLOR_DODGE');
  assert.equal(mapBoxStyle({ ...boxBase, mixBlendMode: 'normal' }, rect100).blendMode, undefined);
});

test('mapBoxStyle: opacity only present when < 1; overflow hidden → clip', () => {
  assert.equal(mapBoxStyle(boxBase, rect100).opacity, undefined);
  assert.equal(mapBoxStyle({ ...boxBase, opacity: '0.5' }, rect100).opacity, 0.5);
  assert.equal(mapBoxStyle({ ...boxBase, overflow: 'hidden' }, rect100).clip, true);
});

// -------------------------------------------------------------- mapTextStyle

const textBase = {
  fontFamily: 'Inter, Arial, sans-serif',
  fontWeight: '400',
  fontStyle: 'normal',
  fontSize: '16px',
  lineHeight: 'normal',
  letterSpacing: 'normal',
  color: 'rgb(0, 0, 0)',
  textAlign: 'start',
  textDecorationLine: 'none',
  textTransform: 'none',
};

test('mapTextStyle: defaults', () => {
  const t = mapTextStyle(textBase);
  assert.equal(t.fontFamily, 'Inter, Arial, sans-serif');
  assert.equal(t.fontWeight, 400);
  assert.equal(t.italic, false);
  assert.equal(t.fontSize, 16);
  assert.equal(t.lineHeightPx, null);
  assert.equal(t.letterSpacing, 0);
  assert.equal(t.align, 'LEFT');
  assert.equal(t.decoration, null);
  assert.equal(t.case, null);
});

test('mapTextStyle: weight, italic, metrics, color', () => {
  const t = mapTextStyle({
    ...textBase,
    fontWeight: '800',
    fontStyle: 'italic',
    fontSize: '44px',
    lineHeight: '52px',
    letterSpacing: '1px',
    color: 'rgb(255, 255, 255)',
  });
  assert.equal(t.fontWeight, 800);
  assert.equal(t.italic, true);
  assert.equal(t.fontSize, 44);
  assert.equal(t.lineHeightPx, 52);
  assert.equal(t.letterSpacing, 1);
  assert.deepEqual(t.color, { r: 1, g: 1, b: 1, a: 1 });
});

test('mapTextStyle: text-overflow ellipsis → truncate flag; absent otherwise', () => {
  assert.equal(mapTextStyle(textBase).truncate, undefined);
  assert.equal(mapTextStyle({ ...textBase, textOverflow: 'ellipsis' }).truncate, true);
  assert.equal(mapTextStyle({ ...textBase, textOverflow: 'clip' }).truncate, undefined);
});

test('mapTextStyle: no text-shadow → no shadows key (keeps tree lean)', () => {
  assert.equal(mapTextStyle(textBase).shadows, undefined);
});

test('mapTextStyle: text-shadow parsed into shadow effects', () => {
  const t = mapTextStyle({ ...textBase, textShadow: 'rgba(0, 0, 0, 0.5) 1px 2px 3px' });
  assert.equal(t.shadows.length, 1);
  assert.deepEqual(t.shadows[0], { x: 1, y: 2, blur: 3, spread: 0, inset: false, color: { r: 0, g: 0, b: 0, a: 0.5 } });
});

test('mapTextStyle: logical alignment is direction-aware (RTL flips start/end)', () => {
  assert.equal(mapTextStyle({ ...textBase, textAlign: 'start' }).align, 'LEFT'); // ltr default
  assert.equal(mapTextStyle({ ...textBase, textAlign: 'start', direction: 'rtl' }).align, 'RIGHT');
  assert.equal(mapTextStyle({ ...textBase, textAlign: 'end', direction: 'rtl' }).align, 'LEFT');
  assert.equal(mapTextStyle({ ...textBase, textAlign: 'end' }).align, 'RIGHT'); // ltr
  // explicit sides ignore direction
  assert.equal(mapTextStyle({ ...textBase, textAlign: 'right', direction: 'rtl' }).align, 'RIGHT');
  assert.equal(mapTextStyle({ ...textBase, textAlign: 'left', direction: 'rtl' }).align, 'LEFT');
});

test('mapTextStyle: align, decoration, transform keywords', () => {
  const t = mapTextStyle({
    ...textBase,
    textAlign: 'justify',
    textDecorationLine: 'underline',
    textTransform: 'uppercase',
  });
  assert.equal(t.align, 'JUSTIFIED');
  assert.equal(t.decoration, 'UNDERLINE');
  assert.equal(t.case, 'UPPER');
  assert.equal(mapTextStyle({ ...textBase, textDecorationLine: 'line-through' }).decoration, 'STRIKETHROUGH');
});
