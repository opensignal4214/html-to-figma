// Font-usage reporting: which families/weights the extracted tree uses, and
// which will likely fall back to Inter in Figma. Pure and DOM-free.
import { FIGMA_FONTS } from './figma-fonts.js';

// Generic families resolve to a bundled Figma font (Inter/Georgia/Roboto Mono)
// in the builder, so they never "fall back" in the sense we warn about.
export const GENERIC_FAMILIES = new Set([
  'sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif',
  'ui-monospace', '-apple-system', 'blinkmacsystemfont', 'cursive', 'fantasy',
]);

/** First family in a CSS font stack, unquoted. */
export function primaryFamily(stack) {
  return String(stack || '')
    .split(',')[0]
    .trim()
    .replace(/^["']|["']$/g, '');
}

/** Walk a tree → Map(primaryFamily → Set of "weight[/italic]" labels). */
export function collectFonts(tree) {
  const map = new Map();
  const visit = (n) => {
    if (n.type === 'TEXT' && n.text) {
      const fam = primaryFamily(n.text.fontFamily) || '(default)';
      const label = `${n.text.fontWeight || 400}${n.text.italic ? ' italic' : ''}`;
      if (!map.has(fam)) map.set(fam, new Set());
      map.get(fam).add(label);
    }
    for (const c of n.children || []) visit(c);
  };
  visit(tree);
  return map;
}

/**
 * Split used fonts into those Figma likely has vs those that will fall back.
 * @param {Map<string,Set<string>>} fontMap from collectFonts
 * @param {Set<string>} [available] lowercased available family names
 */
export function fontReport(fontMap, available = FIGMA_FONTS) {
  const ok = [];
  const fallback = [];
  for (const [family, labels] of fontMap) {
    const key = family.toLowerCase();
    const present = GENERIC_FAMILIES.has(key) || available.has(key);
    const entry = { family, weights: [...labels].sort() };
    (present ? ok : fallback).push(entry);
  }
  const byName = (a, b) => a.family.localeCompare(b.family);
  return { ok: ok.sort(byName), fallback: fallback.sort(byName) };
}
