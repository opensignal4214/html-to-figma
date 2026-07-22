# html-to-figma — Design

## Goal

Given arbitrary HTML (file or URL), produce a script that Figma can execute to
rebuild the design as **native, editable Figma nodes** — with marked elements as
`ComponentNode`s — not as a flattened image.

**Supported input**: HTML the user drops in — a file or fragment they authored,
plus its local assets. URL input works as a convenience, but live-site concerns
(SPA hydration, auth, cookie banners, lazy loading, cross-origin iframes) are
out of scope by design.

Non-goals (for now): two-way sync, variants/interactive states, CSS Grid → Auto
Layout, pseudo-elements, filters. See [ROADMAP.md](ROADMAP.md) for what gets
closed when.

## Architecture

```
            ┌──────────────────────────── Node.js ────────────────────────────┐
            │                                                                  │
 input ──▶  │  extract.js ──▶ intermediate tree (JSON) ──▶ generate.js  ──▶   │ ──▶ run in Figma
 (html/url) │  (Playwright +     the contract of the       (embeds tree +     │     (Scripter or
            │   in-page walker)  whole system              runtime/builder.js)│      dev plugin)
            └──────────────────────────────────────────────────────────────────┘
```

Three stages, two hard boundaries:

1. **Extract** (`src/extract.js` + `src/css-map.js`)
   Playwright loads the page in headless Chromium. An in-page script walks the
   DOM and records, per visible element: bounding box (absolute page px),
   Figma-ready style values, text runs, image bytes (base64), and raw SVG
   markup. All *pure* CSS-value → Figma-value mapping lives in
   `src/css-map.js`, which runs **both** in Node (unit-testable) and in the
   browser (injected via `page.addScriptTag`, exposed as `window.__cssMap`).
2. **Generate** (`src/generate.js` + `src/runtime/builder.js`)
   Serializes the tree into a self-contained script: `const __TREE__ = {...}` +
   the builder runtime + a `main()` call. No network access needed inside Figma;
   every asset is inlined.
3. **Build** (`src/runtime/builder.js`, executes inside Figma)
   Walks the tree, creating `FrameNode`/`ComponentNode`/`TextNode`/
   `RectangleNode`/SVG nodes, loading fonts with fallbacks, and letting Figma's
   Auto Layout engine position flex children.

### Why render in a real browser?

Re-implementing CSS (cascade, inheritance, flexbox, line breaking) is a losing
battle. Chromium already computes the truth; we read it back via
`getComputedStyle` + `getBoundingClientRect`. The extracted geometry is exact by
construction, and the style mapping becomes a small, testable value-translation
layer instead of a CSS engine.

### Why a generated script instead of the Figma REST API?

The Figma REST API is read-only for document content — it cannot create nodes.
The Plugin API is the only write path, and it only runs inside Figma. So the
tool's output *is* a plugin script (runnable via Scripter or an importable dev
plugin), with all data embedded.

### Why an intermediate JSON tree?

- It decouples extraction from generation: either side can be developed and
  tested alone (`tree.json` is written next to the outputs for debugging).
- It is the natural seam for tests: unit tests pin CSS→tree mapping; the mock
  harness pins tree→Figma-API behavior.
- Future backends (e.g. a paste-into-plugin UI, variants support) reuse it.

## Intermediate tree schema

All coordinates are absolute page pixels; the builder converts to
parent-relative at creation time. All colors are `{ r, g, b, a }` in 0..1.

### Common fields (every node)

| Field | Type | Meaning |
|---|---|---|
| `type` | `'FRAME' \| 'TEXT' \| 'IMAGE' \| 'SVG'` | node kind |
| `name` | string | layer name (`tag#id.class` or text snippet) |
| `rect` | `{x, y, width, height}` | absolute rendered bounding box |
| `abs` | boolean | CSS `position: absolute/fixed/sticky` — becomes `layoutPositioning: 'ABSOLUTE'` inside Auto Layout parents |
| `style` | object | box styling, see below |

### `style`

| Field | Type | Source → target |
|---|---|---|
| `background` | color | `background-color` → SOLID fill |
| `gradient` | `{ stops: [{color, position}], transform: [[m00,m01,m02],[m10,m11,m12]] }` | first `linear-gradient()` → GRADIENT_LINEAR fill (transform maps normalized box coords to gradient `t`) |
| `backgroundImage` | `{ base64, scaleMode }` | `background-image: url()` → IMAGE fill |
| `border` | `{ width, color, dashed }` | uniform stroke, INSIDE-aligned (CSS borders are inside the border-box) |
| `radius` | `{ tl, tr, br, bl }` px | corner radii; `%` resolved against `min(width, height)` |
| `opacity` | number | only present when `< 1` |
| `shadows` | `[{ x, y, blur, spread, inset, color }]` | `box-shadow` list → DROP_SHADOW / INNER_SHADOW effects |
| `clip` | boolean | `overflow != visible` → `clipsContent` |

During extraction only, `bgUrl`/`bgScaleMode` appear transiently before the URL
is fetched and replaced by `backgroundImage`.

### `FRAME` extras

| Field | Type | Meaning |
|---|---|---|
| `tag` | string | source HTML tag |
| `layout` | see below | Auto Layout mapping |
| `component` | string \| null | component name; truthy → `figma.createComponent()` |
| `children` | node[] | back-to-front paint order (first is bottom in Figma), computed from z-index/position by `paintOrder()` — not raw DOM order |

`layout`: `{ mode: 'NONE'|'HORIZONTAL'|'VERTICAL', gap, rowGap, wrap,
primaryAlign, counterAlign, paddingTop/Right/Bottom/Left }`.

### `TEXT` extras

`text`: `{ characters, fontFamily (raw CSS stack), fontWeight, italic,
fontSize, lineHeightPx (null = normal), letterSpacing, color, align,
decoration, case }`.

### `IMAGE` / `SVG` extras

`IMAGE.image`: `{ base64, scaleMode: 'FILL'|'FIT' }` (missing → gray
placeholder). `SVG.svg`: raw markup, rebuilt with `figma.createNodeFromSvg`.

## CSS → Figma mapping decisions

| Decision | Rationale |
|---|---|
| Flexbox → Auto Layout; everything else → fixed frames at extracted rects | Only flexbox has a faithful Auto Layout equivalent. Fixed rects are *always* correct visually; Auto Layout is layered on top for editability. Children keep their extracted sizes (`FIXED` sizing) so the result matches the browser even if our alignment mapping is imperfect. |
| `space-around`/`space-evenly` → `SPACE_BETWEEN` | Figma has no equivalent; positions still match because child sizes are fixed. Documented approximation. |
| `align-items: baseline` → `BASELINE` (horizontal only) | Figma supports baseline only on horizontal Auto Layout; vertical falls back to `MIN`. |
| Text wrappers collapse into single TEXT nodes | An `<h1>` with plain text becomes one TextNode, not frame+text, unless it carries visual box styling (background/border/shadow/radius) — keeps layer trees shallow like a designer would build them. |
| Fonts resolved through the whole CSS stack, then Inter | Each family in `font-family` is tried against Figma's fonts with the weight-derived style name (`700 italic` → "Bold Italic"), generic families map to Inter/Georgia/Roboto Mono. Guarantees text always renders. |
| Images inlined as base64 | Figma plugin sandbox has restricted networking; embedding makes scripts self-contained and reproducible. |
| Uniform border from max side width | Figma's per-side stroke weights exist but interact poorly with radii; a uniform inside stroke matches the common case. Mixed-width borders are a known approximation. |
| One shared plugin `id` in the generated manifest | Output is a dev plugin, not a marketplace artifact; users import it locally. |

## Testing strategy

Three layers, cheapest first — none require the Figma app:

1. **Unit** (`test/unit/*.test.js`, `node --test`): pin the pure functions in
   `src/css-map.js` (color/shadow/gradient parsing, flex→Auto-Layout mapping,
   text style mapping) and `generateScript`/`markComponents`. This is where
   regressions are caught precisely.
2. **Mock-API integration** (`test/mock-figma-run.js`): executes a generated
   script against a strict mock of the Figma Plugin API that enforces real
   rules (font must load before `characters`; `resize` rejects invalid sizes;
   limited font set exercises fallback chains) and asserts components/text were
   created.
3. **Visual preview** (`test/preview.js`): recording mock + simulated Auto
   Layout → SVG render → side-by-side + overlay compare page against the real
   browser render. Approximates Figma's engine; final verification of a
   component library still deserves one run in Figma (Scripter is fastest).

### Workflow: TDD

For any behavior change or new mapping (e.g. CSS Grid support):

1. Write the failing unit test against `css-map.js` / the tree schema first.
2. Implement until green.
3. Run `npm test` (unit + integration) and, for layout-affecting changes,
   `npm run preview` and eyeball the overlay.
4. Update the schema/mapping tables in this document in the same commit.
5. If the change alters supported CSS or marking semantics, update
   `.claude/skills/figma-ready-html/SKILL.md` in the same commit too — the
   skill's "avoid" lists mirror the mapping tables, and a stale skill actively
   generates wrong HTML (ROADMAP 10.3).

The extraction walker itself (DOM traversal) is covered by the integration
layers; keep new logic out of the walker and inside `css-map.js` where it is
unit-testable.

## Known limitations / future work

- CSS Grid, `::before`/`::after`, CSS filters, radial/conic gradients,
  multiple background layers, `border` with mixed side widths.
- Auto Layout `stretch`/`layoutGrow` are not emitted (children are FIXED-size);
  resizing a generated component won't reflow like the original CSS yet.
- Text is one style run per node; nested inline styling becomes sibling nodes.
- Cross-origin images without CORS headers become placeholders.

The phased plan for closing these gaps — with implementation sketches, effort
estimates, and exit criteria per item — lives in [ROADMAP.md](ROADMAP.md).
