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
