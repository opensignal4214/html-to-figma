# html-to-figma

Turn HTML into **Figma components**. Give it an HTML file (or URL) and it outputs a
script that Figma can run to rebuild the design natively — real frames, Auto Layout,
editable text, fills, gradients, shadows, images, and vector SVG.

```
HTML ──▶ headless Chromium ──▶ layout + computed styles ──▶ Figma Plugin API script
                                                                    │
                                              run in Figma (Scripter or dev plugin)
                                                                    ▼
                                                          Figma components 🎉
```

Because the HTML is actually **rendered in a real browser**, the extracted geometry
and styles are exact — no fragile CSS re-implementation. Flexbox is mapped to Figma
Auto Layout so the result stays responsive and editable, not a static picture.

## Install

```bash
npm install
npx playwright install chromium   # once, if Chromium isn't already available
```

## Usage

```bash
node bin/html-to-figma.js examples/pricing-card.html -o out
```

This writes:

| File | What it's for |
|---|---|
| `out/figma-script.js` | Paste into the [Scripter](https://www.figma.com/community/plugin/757836922707087381/scripter) plugin in Figma and press Run |
| `out/figma-plugin/` | A ready dev plugin: **Figma → Plugins → Development → Import plugin from manifest** → pick `manifest.json` → run it |
| `out/tree.json` | The extracted intermediate tree, for debugging |

Both routes create the design on the current page, centered in your viewport, with
marked elements as **Figma components**.

### Options

```
-o, --out <dir>        Output directory (default: ./figma-out)
-w, --width <px>       Viewport width used for rendering (default: 1440)
-H, --height <px>      Viewport height (default: 900)
-s, --selector <css>   Capture only the first matching element, not the whole page
    --name <name>      Name of the generated Figma plugin
    --no-plugin        Skip the figma-plugin/ folder
    --no-tree          Skip tree.json
```

URLs work too:

```bash
node bin/html-to-figma.js https://example.com -o out -w 1280
```

### Marking components

Add `data-figma-component` to any element (the value becomes the component name):

```html
<div class="card" data-figma-component="Card / Pro">...</div>
```

If nothing is marked, each top-level section of the page automatically becomes a
component.

### Programmatic API

```js
import { htmlToFigma, extractTree, generateScript } from 'html-to-figma';

const { tree, script } = await htmlToFigma('page.html', { width: 1280 });
// `script` is Figma Plugin API code; `tree` is the intermediate JSON.
```

## What gets translated

| HTML/CSS | Figma |
|---|---|
| `display: flex` (direction, gap, padding, justify/align, wrap) | Auto Layout frame |
| Block/absolute layout | Fixed frames at exact rendered positions |
| `position: absolute/fixed` inside flex | Auto Layout absolute-positioned child |
| Text (family, weight, italic, size, line-height, letter-spacing, align, decoration, transform) | Editable `TextNode` with real font loading + Inter fallback |
| `background-color`, `linear-gradient` | Solid / linear-gradient fills |
| `background-image: url(...)`, `<img>`, `<canvas>`, `<video poster>` | Image fills (bytes embedded in the script) |
| Inline `<svg>` and `.svg` images | Native Figma vectors via `createNodeFromSvg` |
| `border`, `border-radius` (incl. `%`) | Strokes (inside-aligned), corner radii |
| `box-shadow` (multiple, inset) | Drop / inner shadow effects |
| `opacity`, `overflow: hidden` | Opacity, clip content |
| `<input>` / `<textarea>` / `<select>` | Frame + text from value/placeholder |
| `data-figma-component` | `ComponentNode` |

Architecture, the intermediate tree schema, and all CSS→Figma mapping decisions
are documented in [docs/DESIGN.md](docs/DESIGN.md) — read it before changing the
mapping, and follow its TDD workflow (failing unit test first).

## Testing without opening Figma

Three layers let you validate generated scripts entirely locally
(`npm test` runs the first two):

**0. Unit tests** — every pure CSS→Figma mapping (colors, shadows, gradients,
flex → Auto Layout, text styles) lives in `src/css-map.js` and is pinned by
`npm run test:unit` (`node --test`, no extra dependencies).

**1. Mock-API smoke test** — executes the generated script against a strict mock
of the Figma Plugin API (it enforces real API rules, e.g. fonts must load before
setting `characters`, `resize` rejects invalid sizes, font fallback chains are
exercised). Catches crashes and ordering bugs:

```bash
npm test
# or against any generated script:
node test/mock-figma-run.js path/to/figma-script.js
```

**2. Visual preview** — runs the script against a recording mock, simulates
Figma's Auto Layout positioning, renders the resulting node tree to SVG, and
writes a self-contained HTML page showing the real browser render and the
simulated Figma output side by side, plus an opacity overlay where any
mismatch shows up as ghosting:

```bash
npm run preview            # writes out/preview.html — open in any browser
# or for your own files:
node test/preview.js out/figma-script.js your-page.html out/preview.html
```

Also useful: `out/tree.json` is the exact intermediate tree (what was extracted
from the DOM), and `node --check out/figma-script.js` verifies syntax.

The preview's Auto Layout / baseline simulation is a close approximation of
Figma's engine, not the engine itself — treat pixel-perfect agreement there as
strong evidence, and do a final eyeball check in Figma before shipping a
component library.

## Current limitations

- CSS Grid is captured by absolute positions (accurate, but not Auto Layout).
- Radial/conic gradients and multiple background layers fall back to the first
  solid color / linear gradient found.
- Pseudo-elements (`::before`/`::after`) and CSS filters are not captured.
- Fonts must exist in Figma (Google Fonts work); otherwise text falls back to Inter
  with the closest weight.
- Cross-origin images without CORS headers can't be read and become gray placeholders.

## How it works

1. **Extract** (`src/extract.js`) — Playwright loads the page in headless Chromium and
   an in-page script walks the DOM, recording each visible element's bounding box,
   computed styles, text runs, inlined image bytes, and SVG markup into a JSON tree.
2. **Generate** (`src/generate.js` + `src/runtime/builder.js`) — the tree is embedded
   into a self-contained script alongside a small runtime that recreates the tree with
   `figma.createFrame/createComponent/createText/createImage/createNodeFromSvg`,
   loading fonts with graceful fallbacks.
3. **Run in Figma** — via Scripter or the generated dev plugin. All assets are inlined,
   so the script needs no network access.

## License

MIT
