// Pure helpers for the visual preview harness (test/preview.js), split out so
// they can be unit-tested without executing the preview's top-level run().

/**
 * Force an embedded SVG's root to render at exactly w×h, mirroring what Figma
 * does (createNodeFromSvg + resize). Without this, an inline <svg> lacking
 * width/height fills the outer viewport in the simulated render. A viewBox is
 * synthesized from the original width/height when absent so content still
 * scales into the box.
 */
export function sizeSvg(markup, w, h) {
  const open = markup.match(/<svg\b([^>]*)>/i);
  if (!open) return markup;
  let attrs = open[1];
  const attr = (name) => {
    const r = attrs.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
    return r ? r[1] : null;
  };
  const origW = attr('width');
  const origH = attr('height');
  let viewBox = attr('viewBox');
  if (!viewBox && origW && origH) viewBox = `0 0 ${parseFloat(origW)} ${parseFloat(origH)}`;
  attrs = attrs.replace(/\s(width|height|viewBox)\s*=\s*["'][^"']*["']/gi, '');
  let inject = ` width="${w}" height="${h}"`;
  if (viewBox) inject += ` viewBox="${viewBox}"`;
  return markup.replace(open[0], `<svg${attrs}${inject}>`);
}

/**
 * Primary-axis placement for a simulated Auto Layout frame: where the first
 * in-flow child starts (relative to the padding edge) and the spacing between
 * children. Distributed modes follow CSS flexbox semantics, which Figma's
 * SPACE_BETWEEN / SPACE_AROUND / SPACE_EVENLY diagrams (plugin typings) match;
 * with fewer than two children SPACE_BETWEEN packs to the start and the other
 * two center, as in CSS.
 */
export function mainAxisPlan(align, inner, sizes, spacing) {
  const n = sizes.length;
  const sum = sizes.reduce((a, s) => a + s, 0);
  const free = inner - sum;
  if (align === 'SPACE_BETWEEN' && n > 1) return { start: 0, gap: free / (n - 1) };
  if (align === 'SPACE_AROUND' && n > 1) return { start: free / n / 2, gap: free / n };
  if (align === 'SPACE_EVENLY' && n > 1) return { start: free / (n + 1), gap: free / (n + 1) };
  const total = sum + spacing * Math.max(0, n - 1);
  if (align === 'CENTER' || ((align === 'SPACE_AROUND' || align === 'SPACE_EVENLY') && n === 1)) {
    return { start: (inner - total) / 2, gap: spacing };
  }
  if (align === 'MAX') return { start: inner - total, gap: spacing };
  return { start: 0, gap: spacing };
}

// ---- Spec-faithful rendering of Figma matrices (ROADMAP 2.5 C). These follow
// the official plugin-typings conventions and share no code with the builder.

const fmt = (v) => {
  const r = Math.round(v * 1e6) / 1e6;
  return String(r === 0 ? 0 : r);
};

/** Figma relativeTransform [[a, c, e], [b, d, f]] → SVG `matrix(a b c d e f)`. */
export function svgMatrix(rt) {
  return `matrix(${[rt[0][0], rt[1][0], rt[0][1], rt[1][1], rt[0][2], rt[1][2]].map(fmt).join(' ')})`;
}

/**
 * Figma samples a gradient/image paint at g = T·(x/w, y/h, 1) — linear t = gx,
 * radial centered at (½, ½) with radius ½, image occupying the unit square.
 * Returns the SVG matrix mapping paint space g → node pixels, i.e.
 * inv(T·diag(1/w, 1/h)), so paints can be drawn in their own space.
 */
export function paintSpaceToPixels(T, w, h) {
  const [[a, b, c], [d, e, f]] = T;
  const det = a * e - b * d;
  if (!det) return 'matrix(1 0 0 1 0 0)';
  // inv of [[a b c][d e f][0 0 1]]
  const ia = e / det;
  const ib = -b / det;
  const ic = (b * f - c * e) / det;
  const id = -d / det;
  const ie = a / det;
  const iff = (c * d - a * f) / det;
  // then scale normalized → pixels
  return svgMatrix([[ia * w, ib * w, ic * w], [id * h, ie * h, iff * h]]);
}

/** Axis-aligned bounds (in parent space) of a w×h box under relativeTransform. */
export function rotatedBounds(rt, w, h) {
  const pts = [[0, 0], [w, 0], [w, h], [0, h]].map(([u, v]) => [
    rt[0][0] * u + rt[0][1] * v + rt[0][2],
    rt[1][0] * u + rt[1][1] * v + rt[1][2],
  ]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** Counter-axis offset of a child: MIN/CENTER/MAX within the padded area. */
export function crossAxisOffset(align, crossSize, padStart, padEnd, childCross) {
  const inner = crossSize - padStart - padEnd;
  if (align === 'CENTER') return padStart + (inner - childCross) / 2;
  if (align === 'MAX') return padStart + inner - childCross;
  return padStart;
}
