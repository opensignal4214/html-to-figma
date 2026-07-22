# Roadmap — step-by-step to full support

Ordered by user value: each phase ships independently, keeps `npm test` green,
and follows the TDD workflow in [DESIGN.md](DESIGN.md) (failing unit test →
implement → integration + preview check → update the schema/mapping tables in
the same commit).

Effort: **S** ≈ hours, **M** ≈ a day, **L** ≈ multiple days.
Status: `[ ]` planned · `[~]` in progress · `[x]` shipped.

## Current baseline (v0.1 — shipped)

Flexbox → Auto Layout (fixed-size children), exact-position fallback for all
other layouts, editable text (one style per node), solid/linear-gradient/image
fills, borders, radii, shadows, opacity, clipping, inline SVG → vectors,
`data-figma-component` → ComponentNodes, Scripter script + dev-plugin outputs,
three-layer local test harness (unit / mock-API / visual preview).

---

## Phase 1 — Resizable components (Auto Layout fidelity)

> Goal: resizing a generated component reflows like the browser would.
> Today children are FIXED-size, so results look right but don't stretch.

- [ ] **1.1 `flex-grow` / `align-self: stretch` mapping** (M)
  `flex-grow > 0` → `layoutGrow = 1`; `align-items/align-self: stretch` (when
  the child has no fixed cross size) → `layoutAlign: 'STRETCH'`. Extractor
  records `grow`/`selfAlign` per child in the tree schema; builder applies them.
  Tests: unit (new `mapFlexChild()` in `css-map.js`), preview scenario with a
  stretching sidebar layout.
- [ ] **1.2 Hug-contents sizing** (M)
  When an element's size is content-driven (no explicit width/height, not
  stretched), emit `primaryAxisSizingMode/counterAxisSizingMode: 'AUTO'` so
  text edits in Figma resize the frame like the browser would. Heuristic:
  compare used size against content box; fall back to FIXED when unsure.
- [ ] **1.3 `min-width`/`max-width`/`min-height`/`max-height`** (S)
  Map directly to Figma's `minWidth`/`maxWidth`/`minHeight`/`maxHeight`.
- [ ] **1.4 `row-reverse` / `column-reverse`** (S)
  Reverse child order in the tree at extraction time (visual order already
  matches; this fixes Auto Layout insertion order + `itemReverseZIndex`).
- [ ] **1.5 Percentage-width children** (S)
  `width: 100%` inside Auto Layout → `layoutAlign: 'STRETCH'` /
  `layoutGrow` rather than a fixed px copy.

**Exit criteria:** the pricing-card example can be resized ±30% in Figma and
match a browser render at the same width; preview harness gains a
"resize simulation" mode asserting reflow.

## Phase 2 — CSS Grid → Auto Layout

> Goal: common grids become editable Auto Layout instead of pixel-frozen frames.

- [ ] **2.1 Single-axis grids** (M)
  `grid-template-columns: 1fr` (one column) or single-row grids → VERTICAL /
  HORIZONTAL Auto Layout with `gap`/padding, reusing the flex mapping.
- [ ] **2.2 Uniform multi-column grids → wrapped Auto Layout** (M)
  Equal-width columns (`repeat(n, 1fr)`, uniform `minmax`) → HORIZONTAL +
  `layoutWrap: 'WRAP'` + `counterAxisSpacing = row-gap`, children sized to the
  track width. Detection via computed `grid-template-columns` px list.
- [ ] **2.3 Complex grids stay exact-position — loudly** (S)
  Spans, named areas, auto-placement irregularities → keep today's absolute
  fallback but log a CLI warning listing the elements, so users know which
  parts won't reflow.

**Exit criteria:** a 3-column card grid example round-trips as wrapped Auto
Layout; unit tests pin the `grid-template-columns` classifier.

## Phase 3 — Rich text (single TextNode with style runs)

> Goal: `<p>Save <b>20%</b> today</p>` becomes ONE editable TextNode.

- [ ] **3.1 Inline-run flattening in the extractor** (L)
  When an element's children are only text and inline-level elements with no
  box styling, emit one TEXT node with `runs: [{start, end, style}]` instead of
  sibling nodes. Schema addition documented in DESIGN.md.
- [ ] **3.2 Range styling in the builder** (M)
  Apply runs via `setRangeFontName` / `setRangeFontSize` / `setRangeFills` /
  `setRangeTextDecoration` (loading every run's font first).
- [ ] **3.3 Hyperlinks** (S)
  `<a href>` runs → `setRangeHyperlink({ type: 'URL', value })`.
- [ ] **3.4 Line breaks** (S)
  `<br>` → `\n` within the run model (today `<br>` splits into stacked nodes).

**Exit criteria:** mixed-style paragraph renders as one TextNode; mock harness
extended with range-API rules (font-per-range loading order).

## Phase 4 — Component variants, instances, and breakpoints

> Goal: output a component *library*, not just components.

- [ ] **4.1 Repeated-subtree detection → component + instances** (L)
  Hash normalized subtrees (structure + styles, ignoring text/images); repeats
  become one ComponentNode plus `createInstance()` copies with text/image
  overrides. Opt-in flag (`--dedupe`) first, default later.
- [ ] **4.2 `data-figma-variant` → component sets** (M)
  `data-figma-component="Button" data-figma-variant="State=Hover"` on sibling
  elements → `figma.combineAsVariants()` into one component set.
- [ ] **4.3 Responsive breakpoints as variants** (M)
  `--widths 1440,768,375` renders the page once per width and emits each
  marked component's variants into a set (`Breakpoint=Desktop/Tablet/Mobile`).

**Exit criteria:** pricing example emits one Card component with two instances
and a Breakpoint variant set; dedupe classifier fully unit-tested.

## Phase 5 — Visual completeness

- [ ] **5.1 Multiple background layers** (S) — Figma fills are already an
  array; emit every parsed layer (bottom-up) instead of the first.
- [ ] **5.2 Radial gradients** (M) — `radial-gradient()` → GRADIENT_RADIAL
  with transform from shape/size/position; conic → GRADIENT_ANGULAR.
- [ ] **5.3 Pseudo-elements** (M) — `getComputedStyle(el, '::before'/'::after')`
  with non-`none` content → synthesized child nodes (position from layout
  delta; text content or box visuals).
- [ ] **5.4 Per-side borders** (M) — unequal widths → individual
  `strokeTopWeight`/`strokeRightWeight`/… instead of collapsing to the max.
- [ ] **5.5 Filters** (S) — `filter: blur()` → LAYER_BLUR,
  `backdrop-filter: blur()` → BACKGROUND_BLUR, `drop-shadow()` → DROP_SHADOW.
- [ ] **5.6 `text-shadow`** (S) — → DROP_SHADOW effect on TextNodes.
- [ ] **5.7 `background-repeat` tiling** (S) — → IMAGE fill `scaleMode: 'TILE'`
  with `scalingFactor` from `background-size`.
- [ ] **5.8 Blend modes** (S) — `mix-blend-mode` → node `blendMode`.

**Exit criteria:** each item lands with unit tests on its parser/mapper and an
addition to the example page exercising it in the preview overlay.

## Phase 6 — Assets & robustness

- [ ] **6.1 CORS-proof image capture** (M)
  Capture image bytes via Playwright network interception (responses recorded
  in Node) instead of in-page `fetch`, eliminating gray placeholders for
  cross-origin images without CORS headers.
- [ ] **6.2 Lazy-content settling** (S)
  Auto-scroll the page and wait for `IntersectionObserver`-loaded images
  before extraction; `--wait <ms|selector>` escape hatch.
- [ ] **6.3 Same-origin `<iframe>` inlining** (M)
  Walk same-origin iframe documents into the tree at the iframe's offset.
- [ ] **6.4 Font report** (S)
  CLI prints which font families/styles the document uses and which will fall
  back to Inter (queryable in Figma via the plugin at run time; statically via
  a bundled Google Fonts list).
- [ ] **6.5 Oversized-image handling** (S)
  Downscale images beyond Figma's 4096px limit in the browser via canvas
  before inlining (today `createImage` may reject them).

## Phase 7 — Distribution & DX

- [ ] **7.1 CI** (S) — GitHub Actions: `npm test` on push/PR (Playwright +
  Chromium available via the official container image).
- [ ] **7.2 npm publish** (S) — publish as a scoped package with `npx` usage;
  `playwright` as a peer/optional story documented.
- [ ] **7.3 Reusable companion plugin** (M)
  A single installable plugin with a paste-box UI: paste `tree.json` (or the
  script's tree payload) instead of re-importing a new dev plugin per page.
  Removes the per-run manifest import entirely.
- [ ] **7.4 Watch mode** (S) — `--watch` re-extracts on file change so
  design/code iteration is one save + one plugin re-run.
- [ ] **7.5 Config file** (S) — `htmltofigma.config.json` for widths,
  selectors, component naming rules, font mappings.

---

## Explicit non-goals

- **Two-way sync** (Figma → HTML): different product, different constraints.
- **Pixel-perfect font metrics for fonts Figma doesn't have**: we guarantee
  the fallback is deterministic (Inter, nearest weight), not metric-identical.
- **JavaScript interactivity/animation capture**: we snapshot rendered states;
  states can become variants (4.3) but behavior is out of scope.
- **`space-around`/`space-evenly` exact semantics**: Figma has no equivalent;
  the `SPACE_BETWEEN` approximation stays (positions remain exact because
  extraction is geometry-based).
