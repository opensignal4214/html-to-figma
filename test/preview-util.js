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
