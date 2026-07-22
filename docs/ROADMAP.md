# Roadmap — step-by-step to 1:1 HTML → Figma components

**Scope**: the user drops HTML (a file or fragment they authored, plus its
local assets) and we recreate it 1:1 as Figma components. Live-URL capture
still works as a convenience, but SPAs, auth walls, cookie banners,
lazy-loading and cross-origin iframes are explicitly **not** design targets —
see non-goals.

Ordered by contribution to 1:1 fidelity: each phase ships independently, keeps
`npm test` green, and follows the TDD workflow in [DESIGN.md](DESIGN.md)
(failing unit test → implement → integration + preview check → update the
schema/mapping tables in the same commit).

Effort: **S** ≈ hours, **M** ≈ a day, **L** ≈ multiple days.
Status: `[ ]` planned · `[~]` in progress · `[x]` shipped.

## Current baseline (v0.1 — shipped)

Flexbox → Auto Layout (fixed-size children), exact-position fallback for all
other layouts, editable text (one style per node), solid/linear-gradient/image
fills, borders, radii, shadows, opacity, clipping, inline SVG → vectors,
`data-figma-component` → ComponentNodes, Scripter script + dev-plugin outputs,
three-layer local test harness (unit / mock-API / visual preview).

---

## Phase 1 — Paint & geometry correctness

> Silent wrongness on ordinary CSS. These make output *incorrect*, not just
> less editable — they come first.

- [ ] **1.1 z-index / stacking-context paint order** (M)
  Children are currently emitted in DOM order; browsers paint by stacking
  rules. A `z-index: 50` badge earlier in the DOM ends up *behind* its
  siblings in Figma. Compute effective paint order per stacking context in the
  extractor and sort children before emitting. Unit-test the sorter on
  cs-like fixtures.
- [ ] **1.2 CSS transforms** (M)
  `rotate()` / `scale()` / `translate()` currently capture only the axis-
  aligned bounding box → rotated cards come out unrotated and wrongly sized.
  Decompose the computed transform matrix; emit untransformed size + rotation
  (Figma `rotation`/`relativeTransform`). Skew falls back to rasterize (2.2).
- [ ] **1.3 List markers** (S)
  Native `<ul>`/`<ol>` bullets and numbers are `::marker` pseudo-elements and
  vanish today. Read `getComputedStyle(el, '::marker')` + synthesize a TEXT
  child per item.
- [ ] **1.4 `clip-path` and CSS masks** (M)
  Angled section dividers, non-rect image crops → Figma vector masks for
  polygon/inset/circle/ellipse clip paths; anything else → rasterize (2.2).
- [ ] **1.5 Image crop precision** (S)
  `object-position` / `background-position` offsets → CROP-mode image fill
  with exact `imageTransform`, instead of today's center-crop FILL.
- [ ] **1.6 Text line-box capture** (S)
  Range-based text rects are *tight* bounds — smaller than the CSS line box
  when line-height is generous — so stacked text drifts a few px (found by a
  skill-eval agent: ~8px on a testimonial card). Capture line-box-height
  rects (pad tight bounds to the computed line height) instead.

**Exit criteria:** an example page with overlapping z-indexed elements, a
rotated card, native list bullets, and an off-center `cover` image round-trips
visually identical in the preview overlay.

## Phase 2 — The 1:1 guarantee: measure it, then never miss

> "1:1" must be a number, not a claim — and there must be a safety net for
> anything the mapper can't express.

- [ ] **2.1 Fidelity score in the preview harness** (M)
  Pixel-diff the browser screenshot against the simulated-Figma render
  (rasterized via the already-present Chromium), report % mismatch per
  component, and add `--assert-fidelity <pct>` so CI fails on regressions.
- [ ] **2.2 Rasterize fallback for unmappable nodes** (M)
  Any element using a feature the mapper can't express (skew, exotic filters,
  native form widgets — checkboxes, selects, sliders) gets an element
  screenshot via Playwright embedded as an image fill, flagged in the layer
  name (`[raster]`). This is the universal net: *every* HTML construct then
  has a 1:1 representation, editable or not.
- [ ] **2.3 True-Figma verification loop (optional, needs a token)** (M)
  After running the plugin in Figma, export the created node as PNG via the
  REST API (read-only export is supported) and pixel-diff against the browser
  screenshot — closes the loop against the real Figma renderer instead of our
  simulation.

- [ ] **2.4 Preview: size raw SVG embeds** (S)
  The simulated render embeds SVG markup verbatim; an SVG without explicit
  `width`/`height` attributes renders at viewport size (found by a skill-eval
  agent). Scale embedded SVGs to the node's rect in the preview renderer.

**Exit criteria:** `npm run preview` prints a fidelity % for the example and
CI enforces it; a form-controls example ships at ~100% via rasterize fallback.

## Phase 3 — Typography parity

> The hardest 1:1 frontier: Figma's text engine and font library are not
> Chromium's.

- [ ] **3.1 Font availability report** (S)
  Detect every family/weight the document uses (including `@font-face`) and
  state which will fall back to Inter, at extraction time.
- [ ] **3.2 Per-line text mode (`--text-fidelity exact`)** (M)
  Chromium already knows the rendered line boxes; optionally emit one TEXT
  node per line so line breaks can never differ. Default stays editable
  (wrapping) text; flag trades editability for pixel parity.
- [ ] **3.3 Text-to-vector outlining (`--text-fidelity outline`)** (L)
  For brand fonts Figma can't load: render each text run to SVG paths in the
  browser and emit vectors — pixel-perfect, non-editable, per-node opt-in via
  the rasterize-fallback flagging from 2.2.
- [ ] **3.4 `text-overflow: ellipsis` → `textTruncation`** (S)
- [ ] **3.5 `text-shadow` → DROP_SHADOW on TextNodes** (S)
- [ ] **3.6 RTL / `direction` support** (M)
  Mirror alignment mapping and Auto Layout ordering under `direction: rtl`.

**Exit criteria:** a page using a Google font + a fake brand font reaches
≥99% fidelity score in `exact` mode and reports the fallback clearly.

## Phase 4 — Visual completeness

- [ ] **4.1 Multiple background layers** (S) — Figma fills are already an
  array; emit every parsed layer (bottom-up) instead of the first.
- [ ] **4.2 Radial / conic gradients** (M) — → GRADIENT_RADIAL /
  GRADIENT_ANGULAR with transforms from shape/size/position.
- [ ] **4.3 Pseudo-elements `::before`/`::after`** (M) —
  `getComputedStyle(el, '::before')` with non-`none` content → synthesized
  child nodes (decorative shapes, icons, quotes are everywhere).
- [ ] **4.4 Per-side borders** (M) — unequal widths → individual
  `strokeTopWeight`/… instead of collapsing to the max side.
- [ ] **4.5 Filters** (S) — `filter: blur()` → LAYER_BLUR,
  `backdrop-filter: blur()` → BACKGROUND_BLUR, `drop-shadow()` → DROP_SHADOW;
  other filter functions → rasterize fallback.
- [ ] **4.6 `background-repeat` tiling** (S) — → IMAGE fill
  `scaleMode: 'TILE'` with `scalingFactor` from `background-size`.
- [ ] **4.7 Blend modes** (S) — `mix-blend-mode` → node `blendMode`.
- [ ] **4.8 Overflow-scrolled containers** (S) — capture an inner scroller's
  full `scrollHeight` content, clipped by the frame (`clipsContent` already
  set), so nothing below the inner fold is lost.

## Phase 5 — Editability: resizable components

> Not needed for 1:1 at capture size — needed for components that stay
> correct when designers resize them.

- [ ] **5.1 `flex-grow` / `align-self: stretch`** (M) → `layoutGrow = 1` /
  `layoutAlign: 'STRETCH'` via a new `mapFlexChild()` in `css-map.js`.
- [ ] **5.2 Hug-contents sizing** (M) — content-driven sizes →
  `primaryAxisSizingMode/counterAxisSizingMode: 'AUTO'` where safe.
- [ ] **5.3 min/max width/height** (S) → Figma min/max constraints.
- [ ] **5.4 `row-reverse` / `column-reverse`** (S) — reverse child order at
  extraction time.
- [ ] **5.5 Percentage-width children** (S) — `width: 100%` → STRETCH rather
  than a fixed px copy.
- [ ] **5.6 CSS Grid → Auto Layout** (L) — single-axis grids map directly;
  uniform `repeat(n, 1fr)` grids → wrapped Auto Layout; complex grids (spans,
  areas) stay exact-position with a CLI warning listing the elements.

**Exit criteria:** the pricing example resized ±30% in Figma matches a browser
render at that width.

## Phase 6 — Rich text (single TextNode with style runs)

- [ ] **6.1 Inline-run flattening** (L) — `<p>Save <b>20%</b></p>` → one TEXT
  node with `runs: [{start, end, style}]` in the tree schema.
- [ ] **6.2 Range styling in the builder** (M) — `setRangeFontName` /
  `setRangeFills` / `setRangeTextDecoration`, loading every run's font first
  (extend the mock harness with range-API ordering rules).
- [ ] **6.3 Hyperlinks** (S) — `<a href>` runs → `setRangeHyperlink`.
- [ ] **6.4 `<br>` → `\n`** (S) — within the run model.

## Phase 7 — Atomic design & component library

> Goal: `--atomic` turns marked-up HTML into a design system, not a page —
> atoms/molecules/organisms as a sticker-sheet library where higher levels
> contain **instances** of lower ones, plus an optional page composed of
> organism instances.

- [ ] **7.1 Level marking attributes** (S)
  `data-figma-atom` / `data-figma-molecule` / `data-figma-organism` (value =
  component name) recorded as `level` in the tree schema.
  `data-figma-component` keeps meaning organism-level.
- [ ] **7.2 Bottom-up build with instance substitution** (L)
  Build atoms first; while building higher levels, a node marked as an
  already-built component emits `component.createInstance()` instead of new
  frames. Repeated marks automatically become 1 component + N instances.
- [ ] **7.3 Instance overrides** (M)
  Different text on an instance → set on its text sublayers (path-matched
  between source subtree and instance layers, fonts loaded first); size
  differences → resize. Extend the mock harness with instance-API rules.
- [ ] **7.4 Sticker-sheet library layout** (M)
  Output page organized as labeled Auto Layout sections — Atoms / Molecules /
  Organisms / Page — components in wrapped grids with name labels;
  `--with-page` appends the full-page recreation built from instances.
- [ ] **7.5 Structural divergence handling** (M)
  Two same-named marks with different structure can't be instance+overrides:
  with `data-figma-variant` → variant in a component set
  (`figma.combineAsVariants()`); otherwise warn and emit a suffixed component
  instead of a silently-wrong instance.
- [ ] **7.6 Repeated-subtree detection (unmarked dedupe)** (L)
  Hash normalized subtrees (structure + styles, ignoring text/images); repeats
  become component + instances even without markup. Opt-in `--dedupe`.
- [ ] **7.7 Responsive breakpoints as variants** (M)
  `--widths 1440,768,375` renders once per width; each marked component's
  captures combine into a `Breakpoint=Desktop/Tablet/Mobile` set.
- [ ] **7.8 Component manifest validation** (M)
  The designer's agreed breakdown captured as a spec (`figma.components.json`:
  names, levels, expected counts) that the CLI validates extraction against —
  missing declared components, unexpected nesting, or unmarked repeats fail
  loudly with a diff. Turns "did the HTML follow the designer's taxonomy"
  into a machine check instead of trust in the generator.
- [ ] **7.9 Auto-atomic heuristics** (M, opt-in)
  Infer atoms (buttons, inputs, badges, icons) without markup. Ships last:
  taxonomy is a human decision; explicit attributes stay the primary path.

**Exit criteria:** the pricing example with level attributes emits a
sticker sheet where Pricing Card contains Badge/Button/Price *instances*, the
two card buttons are one component with text overrides, and resizing the
sheet's components doesn't break the page recreation.

## Phase 8 — Scale, payload, and input ergonomics

- [ ] **8.1 Asset deduplication** (S) — hash inlined assets once, reference by
  key (today a repeated badge image is embedded N times).
- [ ] **8.2 HTML fragment / stdin input** (S) — accept snippets without a full
  `<html>` document (auto-wrap) and `--stdin`, matching the "drop HTML" flow.
- [ ] **8.3 Companion plugin with paste-box UI** (M) — one installable plugin
  that accepts the tree payload, replacing per-page dev-plugin imports and
  sidestepping script-size limits for image-heavy pages.
- [ ] **8.4 Builder batching** (S) — yield periodically while creating
  thousands of nodes so Figma stays responsive; size warnings from the CLI.
- [ ] **8.5 Oversized-image downscaling** (S) — canvas-downscale beyond
  Figma's 4096px `createImage` limit before inlining.

## Phase 9 — Distribution & DX

- [ ] **9.1 CI** (S) — GitHub Actions running `npm test` (+ fidelity assert
  from 2.1) on push/PR.
- [ ] **9.2 npm publish** (S) — scoped package, `npx` usage.
- [ ] **9.3 Watch mode** (S) — `--watch` re-extracts on file change.
- [ ] **9.4 Config file** (S) — widths, selectors, naming rules, font
  mappings in `htmltofigma.config.json`.

## Phase 10 — Guidance & guardrails for HTML authors

> The `figma-ready-html` skill (`.claude/skills/`) teaches Claude to author
> convertible HTML; skill evals showed baselines nest component marks 3 times
> out of 4 even after reading the docs. These items turn that guidance into
> tool-enforced guardrails — including for authors not using Claude at all.

- [x] **10.1a Standalone figma-readiness checker** (S) — shipped as
  `test/skill-eval/grade.js`: runs the converter + mock harness on an HTML
  file and reports the objective checks (marking present/named/non-nested,
  flexbox-not-grid, no transforms/pseudo-content, safe fonts, script executes).
  Exit code = failed checks.
- [ ] **10.1b `html-to-figma lint` command** (S)
  Promote the checker to a first-class CLI subcommand with per-element
  locations in warnings and a `--strict` mode for CI.
- [ ] **10.2 Nested-mark handling at extraction** (S)
  Until instances ship (Phase 7), nested `data-figma-component` marks emit an
  extraction warning and keep only the outermost mark, instead of generating
  component-inside-component output Figma may reject. The single most common
  authoring mistake observed in evals.
- [ ] **10.3 Skill/docs sync rule** (process)
  Any phase that changes supported CSS or marking semantics must update
  `.claude/skills/figma-ready-html/SKILL.md` (its "avoid" lists and marking
  rules) in the same commit, alongside the DESIGN.md tables — e.g. Phase 5.6
  removes "avoid CSS Grid", Phase 7 removes "don't nest marks". A stale skill
  actively generates wrong HTML.
- [ ] **10.4 Skill distribution** (S)
  Package the skill as a `.skill` file / document installation for designers
  using Claude outside this repo, so the generation guidance travels with the
  tool.
- [ ] **10.5 Skill eval automation** (M)
  `npm run eval:skill` re-runs the eval prompts through headless agents and
  grades them with 10.1a, so skill regressions are caught like code
  regressions.

---

## Explicit non-goals

- **Live-site capture as a product goal.** URL input remains a convenience,
  but SPA hydration, auth walls, cookie banners, A/B variants, scroll-reveal
  animation settling, and cross-origin iframes are out of scope — the
  supported input is HTML the user drops in.
- **Two-way sync** (Figma → HTML).
- **JavaScript interactivity/animation capture** — states can be expressed as
  variants (7.2/7.3), behavior cannot.
- **Metric-identical text for fonts Figma can't load** *in editable form* —
  the deterministic Inter fallback stays the editable default; `outline` mode
  (3.3) is the pixel-perfect escape hatch.
- **`space-around`/`space-evenly` exact Auto Layout semantics** — Figma has no
  equivalent; positions remain exact because extraction is geometry-based.
