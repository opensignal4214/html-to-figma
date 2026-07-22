# Working agreement

Two rules govern all non-trivial work in this repo:

1. **Plan doc first.** Before implementing any roadmap item or non-trivial
   change, write `docs/plans/<item>.md` (problem, design, schema/interface
   changes, test plan, risks). Once the plan exists you may **proceed to
   implement on your own** — you do not need to wait for sign-off unless the
   user explicitly says to wait.
   The only exception to needing a plan at all is a genuinely low-complexity
   quick fix (typo, one-line correction, doc tweak) — those go straight to a
   TDD change. When unsure whether something is "quick fix" or "needs a plan",
   write the plan.

2. **TDD, always.** Every behavior change follows: failing test first →
   implement until green → run the full suite. No implementation lands without
   a test that would have failed before it. See `docs/DESIGN.md` →
   "Workflow: TDD" for the full loop.

## Fast orientation

- **What/why/how**: `docs/DESIGN.md` (architecture, tree schema, mapping
  decisions, testing strategy, the TDD workflow).
- **What's next / done**: `docs/ROADMAP.md` (phased plan; `[x]` shipped,
  `[~]` partial, `[ ]` planned).
- **Plans**: `docs/plans/` (one file per item, signed off before build).
- **Pure mapping logic** lives in `src/css-map.js` (runs in Node for unit tests
  AND injected into the browser) — keep new logic here, out of the DOM walker,
  so it stays unit-testable.

## Guardrails observed all session

- **Baseline stays byte-identical.** `examples/pricing-card.html` → `tree.json`
  must not change unless the change is intentional and explained. Diff against a
  saved baseline after every change; prefer additive schema (a new key only in
  the new case) over reshaping existing output.
- **Can't verify against live Figma?** For any Figma matrix/convention you
  can't confirm without running the plugin (rotation pivot, image/gradient
  transforms), ship a best-effort value, flag it in code + ROADMAP, and defer
  confirmation to the Phase 2.3 export loop. Don't pile up unverified output.
- **Skill mirrors the mappings.** Changing supported CSS or marking semantics
  means updating `.claude/skills/figma-ready-html/SKILL.md` in the same commit.

## Commands

- `npm test` — unit + integration (mock-Figma run + fidelity gate) + e2e.
- `npm run test:unit` / `test:e2e` — the fast pure suite / browser-driven suite.
- `npm run preview` — visual browser-vs-simulated-Figma overlay + fidelity %.
- `node test/skill-eval/grade.js page.html` — objective figma-readiness check.
