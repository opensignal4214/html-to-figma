#!/usr/bin/env node
import path from 'node:path';
import { extractTree } from '../src/extract.js';
import { writeOutputs } from '../src/generate.js';
import { collectFonts, fontReport } from '../src/fonts.js';

const USAGE = `
html-to-figma — turn HTML into a script that rebuilds it in Figma as components

Usage:
  html-to-figma <input.html | url> [options]

Options:
  -o, --out <dir>        Output directory (default: ./figma-out)
  -w, --width <px>       Viewport width used for rendering (default: 1440)
  -H, --height <px>      Viewport height (default: 900)
  -s, --selector <css>   Capture only the first element matching this CSS
                         selector instead of the whole page
      --name <name>      Name for the generated Figma plugin
      --no-plugin        Skip generating the figma-plugin/ folder
      --no-tree          Skip writing the debug tree.json
  -h, --help             Show this help

Marking components:
  Add data-figma-component (optionally with a name) to any element:
    <div class="card" data-figma-component="Pricing Card">...</div>
  If no element is marked, every top-level section of the page becomes
  a component automatically.

Outputs:
  figma-script.js        Paste into the Scripter plugin in Figma and run
  figma-plugin/          Figma → Plugins → Development → Import plugin from
                         manifest → pick manifest.json → run the plugin
  tree.json              Extracted intermediate tree (for debugging)
`;

function parseArgs(argv) {
  const opts = { out: 'figma-out', width: 1440, height: 900, plugin: true, tree: true };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': console.log(USAGE); process.exit(0); break;
      case '-o': case '--out': opts.out = argv[++i]; break;
      case '-w': case '--width': opts.width = parseInt(argv[++i], 10); break;
      case '-H': case '--height': opts.height = parseInt(argv[++i], 10); break;
      case '-s': case '--selector': opts.selector = argv[++i]; break;
      case '--name': opts.name = argv[++i]; break;
      case '--no-plugin': opts.plugin = false; break;
      case '--no-tree': opts.tree = false; break;
      default:
        if (a.startsWith('-')) {
          console.error(`Unknown option: ${a}\n${USAGE}`);
          process.exit(1);
        }
        positional.push(a);
    }
  }
  if (positional.length !== 1) {
    console.error(`Expected exactly one input file or URL.\n${USAGE}`);
    process.exit(1);
  }
  opts.input = positional[0];
  if (!Number.isFinite(opts.width) || opts.width <= 0) opts.width = 1440;
  if (!Number.isFinite(opts.height) || opts.height <= 0) opts.height = 900;
  return opts;
}

function countNodes(node) {
  return 1 + (node.children || []).reduce((sum, c) => sum + countNodes(c), 0);
}

function listComponents(node, out = []) {
  if (node.component) out.push(typeof node.component === 'string' ? node.component : node.name);
  for (const c of node.children || []) listComponents(c, out);
  return out;
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`Rendering ${opts.input} (${opts.width}x${opts.height})...`);
  const tree = await extractTree(opts.input, opts);

  const components = listComponents(tree);
  console.log(`Extracted ${countNodes(tree)} nodes, ${components.length} component(s):`);
  for (const name of components) console.log(`  - ${name}`);

  const { ok, fallback } = fontReport(collectFonts(tree));
  if (ok.length || fallback.length) {
    console.log('\nFonts used:');
    for (const f of ok) console.log(`  ✓ ${f.family} (${f.weights.join(', ')})`);
    for (const f of fallback) console.log(`  ⚠ ${f.family} (${f.weights.join(', ')}) — likely not in Figma; will fall back to Inter`);
    if (fallback.length) {
      console.log('  (font list is a heuristic — install the real fonts in Figma before running the plugin to be sure)');
    }
  }

  const written = writeOutputs(tree, opts.out, {
    source: opts.input,
    plugin: opts.plugin,
    debugTree: opts.tree,
    pluginName: opts.name,
  });
  console.log('\nWrote:');
  for (const file of written) console.log(`  ${path.relative(process.cwd(), file)}`);
  console.log(`
Next steps (either one):
  A) Scripter: in Figma, run the "Scripter" plugin, paste the contents of
     ${path.join(opts.out, 'figma-script.js')} and press Run.
  B) Plugin: in Figma → Plugins → Development → Import plugin from manifest,
     choose ${path.join(opts.out, 'figma-plugin', 'manifest.json')}, then run it.`);
}

run().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
