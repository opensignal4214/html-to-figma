# Plan — no-Figma batch 1 (5.4, 10.2, 8.1)

Status: **approved (auto-proceed)** · Effort: 3× S–M

Three independent items that are fully verifiable without live Figma (tree /
mock / preview), each shipped as its own commit under this plan.

---

## 5.4 — `row-reverse` / `column-reverse`

**Problem.** `flex-direction: row-reverse`/`column-reverse` currently map to
HORIZONTAL/VERTICAL with children in DOM order. For an Auto Layout frame the
builder lays children out in tree order, so reversed directions render in the
wrong visual order (the rect fallback isn't used for in-flow auto-layout
children).

**Design.** `mapFlexLayout` exposes `reverse: true` when
`flex-direction` ends with `-reverse`. The walker reverses the *flow* children
of a reverse-direction parent at extraction time, so tree order = visual order.
`reverse` is only present when true (baseline-safe).

**Tests.** Unit: `mapFlexLayout` sets `reverse` for `row-reverse`, absent for
`row`. e2e: a `row-reverse` fixture → children appear in reversed visual order
(assert first tree child is the last DOM item). Preview overlay confirms.

## 10.2 — Nested component-mark guard

**Problem.** `data-figma-component` nested inside another marked element creates
a component-inside-component, which Figma rejects (instances aren't built yet,
Phase 7). This is the single most common authoring mistake seen in skill evals.

**Design.** In the extractor, track whether we're already inside a marked
subtree; if a descendant is also marked, drop the inner mark (keep the
outermost) and record a warning. The CLI prints the dropped marks. Pure
decision helper `outermostComponentOnly(tree)` in a testable place, or handle
in `markComponents`. Keep the outermost so the user's top-level intent wins.

**Tests.** Unit: a tree with a marked node inside a marked node →
inner `component` cleared, warnings list populated. Baseline unaffected
(pricing-card has no nested marks). CLI prints the warning.

## 8.1 — Asset deduplication (generation-level)

**Problem.** Repeated identical images inline their base64 once **per node**, so
an image used N times bloats the generated script N×. (Figma's `createImage`
already dedupes by content hash at runtime, so this is purely script *payload*.)

**Design.** Dedupe at script generation only — **the tree is unchanged**, so the
baseline `tree.json` stays byte-identical. `generateScript` collects every
`base64` blob in the tree into a `__ASSETS__` array (unique by value), replaces
inline blobs with an index reference, and the runtime resolves
`base64 = __ASSETS__[idx]`. Covers `image.base64`, `style.backgroundImage.base64`,
and `style.bgLayers[].base64`.

**Tests.** Unit: `dedupeAssets(tree)` maps duplicate blobs to the same index and
emits each blob once. Integration: a page reusing one image → generated script
contains the blob once; mock run still creates the images. Tree/baseline
unchanged.

---

## Risks / rollback

All three are additive or generation-only; single-layer/unmarked/single-asset
paths are unchanged and baseline-guarded. Each is one revertible commit.

## Explicitly NOT in this batch (want Figma verification)

Phase 5 grow/stretch/hug (resize behavior unverifiable without Figma, risks
baseline), and anything depending on the 2.3 live-Figma loop.
