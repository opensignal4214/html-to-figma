---
name: figma-ready-html
description: Author or refactor HTML so the html-to-figma tool converts it into clean, editable Figma components. Use this whenever generating HTML or CSS that will be imported into Figma — any mention of html-to-figma, "figma-ready", turning HTML into Figma components, design-system or atomic-design HTML, a designer asking for HTML they will bring into Figma, or a request to check whether existing HTML will convert well. Even if the user just asks for "a section/card/navbar as HTML" in this repo, assume Figma conversion is the goal and use this skill.
---

# Figma-ready HTML

This repo's tool renders HTML in Chromium and generates a Figma Plugin API
script that rebuilds it as native Figma components. The conversion is only as
good as the markup: component *marking* decides what becomes a `ComponentNode`,
and the CSS you choose decides whether the result is editable Auto Layout or a
pixel-frozen approximation. Write the HTML *for the converter*, then verify by
actually running it.

## First: agree on the breakdown — never invent it

The component taxonomy is the **designer's decision**, not yours. A perfectly
valid marking with the wrong granularity is a wrong result: you can't know
whether they consider the avatar its own atom or just a layer inside the card.

Before writing HTML, propose a component inventory and get sign-off:

> Here's the breakdown I'd mark — edit anything:
> - `Card / Testimonial` — the whole card (avatar, quote, name inside as
>   plain layers)
> - not marked: the section wrapper, individual avatars
> Want the avatar or the star row as separate components instead?

Skip the question only when the user has already specified the breakdown
(named their components, provided a design-system list, or is iterating on
HTML whose marking they previously approved) — then follow their spec exactly,
including their names. If they answer "you decide", make the call and state
the inventory you chose in your summary so they can correct it cheaply.

## Component marking

- Put `data-figma-component="Group / Name"` on **every element in the
  agreed inventory** — and nothing else. The value becomes the component
  name in Figma; use the designer's names verbatim when given.
- Name like a design system: `"Card / Testimonial"`, `"Button / Primary"`,
  `"Nav / Item"`. Slashes group components in Figma's asset panel.
- **Do not nest marked elements inside other marked elements.** Instance
  generation isn't built yet (roadmap Phase 7), so a component-inside-component
  can't be created. The tool now guards this — it keeps the **outermost** mark,
  drops inner ones, and prints a warning — but that means your inner marks are
  silently discarded, so still mark at **one** granularity per file. If the
  user wants both a card *and* its inner button as components, generate the
  button as a separate sibling section or a second file.
- If nothing is marked, each top-level section of `<body>` becomes a component
  automatically — acceptable for quick captures, too coarse for real work.
  Prefer explicit marks.

## Layout: write for Auto Layout

Flexbox maps 1:1 to Figma Auto Layout; almost nothing else does.

- Use `display: flex` with `gap`, `padding`, `justify-content`, `align-items`
  for **every** container — including ones you'd normally leave as default
  block flow. A column of headings is `display: flex; flex-direction: column;
  gap: …`. This is what makes the Figma output restructurable.
- Avoid CSS Grid, floats, and table layout: they convert pixel-accurate but
  frozen (no Auto Layout), which defeats the purpose for components.
- Avoid `transform` (rotate/scale/skew) and overlapping siblings via
  `z-index` — neither is mapped yet; output order/geometry will be wrong.
  `position: absolute` inside a flex parent is fine (maps to an
  absolute-positioned Auto Layout child) — use it for badges pinned to
  corners.

## Visual styles

Safe (map 1:1): solid colors, `linear-gradient`, multiple/inset
`box-shadow`, `border` (uniform width), `border-radius` including `%`,
`opacity`, `overflow: hidden`.

Avoid (not mapped — will silently disappear or degrade):
radial/conic gradients, multiple background layers, `filter` /
`backdrop-filter`, `::before`/`::after` content, `background-repeat`
patterns, `mix-blend-mode`, per-side borders of different widths. When a
design needs a decorative shape, make it a real element or an inline SVG
instead of a pseudo-element.

## Text

- Real text in real elements — never text baked into images.
- Keep one text style per block where possible; an inline `<b>`/`<span>`
  becomes a *separate* Figma text node (correct position, but not one
  editable paragraph).
- Fonts: use families that exist in Figma — Inter, Roboto, Open Sans, Lato,
  Montserrat, or other Google Fonts — and always end the stack with
  `sans-serif`. Unavailable fonts fall back to Inter in Figma, changing
  metrics. When the user names no font, use Inter.
- Prefer explicit `px` values for `font-size`, `line-height`,
  `letter-spacing` — they carry over exactly.

## Assets

- Icons: inline `<svg>` — they become native, recolorable Figma vectors.
- Images: local files next to the HTML, or `data:` URIs. Remote URLs work
  only if the host sends CORS headers; when in doubt, inline a data URI or an
  SVG placeholder.
- Deliver a single self-contained file: CSS in one `<style>` block in
  `<head>`, no external stylesheets or scripts.

## Verify before delivering

Run the converter — its output is the ground truth, not the HTML:

```bash
node bin/html-to-figma.js page.html -o out        # prints detected components
node test/mock-figma-run.js out/figma-script.js   # script runs against mock Figma API
```

Check that the printed component list matches what the user asked for (names
and count) and the mock run reports OK. For layout-heavy work, also generate
the visual diff: `node test/preview.js out/figma-script.js page.html
out/preview.html` and confirm the overlay has no ghosting.

## Checklist before handing over

- Every reusable unit marked `data-figma-component="Group / Name"`; no marks
  nested inside marks.
- All containers are flexbox with `gap`/`padding`; no grid, transforms, or
  z-index overlaps.
- Only safe visual styles; decorative shapes are elements or inline SVG, not
  pseudo-elements.
- Figma-available font stack ending in `sans-serif`; px text metrics.
- Icons inline SVG; images local or data URIs; single self-contained file.
- Converter run: component list correct, mock run green.

## Example marking

```html
<section class="testimonials">
  <figure class="card" data-figma-component="Card / Testimonial">
    <img class="avatar" src="ava.png" alt="">
    <blockquote>“It just works.”</blockquote>
    <figcaption>
      <strong>Ada L.</strong> <span>Engineer</span>
    </figcaption>
  </figure>
  <!-- more cards: same mark, same name → repeated component captures -->
</section>
```

Wrong: marking `.testimonials` *and* `.card` (nested marks), building the
card grid with `display: grid` (frozen output), or drawing the quote glyph
with `::before` (disappears).
