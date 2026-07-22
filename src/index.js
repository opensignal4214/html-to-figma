export { extractTree, markComponents } from './extract.js';
export { generateScript, writeOutputs } from './generate.js';

import { extractTree } from './extract.js';
import { generateScript } from './generate.js';

/**
 * One-shot: HTML file/URL in, Figma script text out.
 * @param {string} input - path to an HTML file, or an http(s) URL
 * @param {object} [opts] - { width, height, selector, closePlugin, textFidelity }
 *   textFidelity: 'editable' (default) | 'exact' (one text node per rendered line)
 * @returns {Promise<{ tree: object, script: string }>}
 */
export async function htmlToFigma(input, opts = {}) {
  const tree = await extractTree(input, opts);
  const script = generateScript(tree, { source: input, closePlugin: !!opts.closePlugin });
  return { tree, script };
}
