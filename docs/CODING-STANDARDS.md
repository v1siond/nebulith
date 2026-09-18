# game-website / Nebulith — Coding Standards (TypeScript · React · ITCSS)

The senior bar for this codebase. Universal principles (SOLID, YAGNI, small units, test
behavior) live in the global engineering standards; **this doc is the stack-specific layer.**
Treat it as enforced. Where existing code violates it (e.g. `templates.tsx`), improve it as you
touch it — don't add new violations.

> Anti-examples in this repo are cited so the rules are concrete, not abstract.

---

## 0. Control flow (applies everywhere)

- **Guard clauses, not nesting.** Return early on the invalid/edge cases, then write the happy
  path flat: `if (bad) return; … return result`. The `else` is implied — no `if/else/else` chains.
- **No deep nesting.** Extract inner loop bodies and branches into small named functions.
- **Dispatch maps over `if/else if`/`switch`** for type/variant dispatch (Open/Closed — add a case
  without editing the dispatcher). Example: `ARCHETYPES[variant]?.(ctx)` in `stageGenerator.ts`.

## 1. TypeScript

- **Strict types, no `any`.** Use `unknown` + narrowing at boundaries. Model domains with precise
  types, discriminated unions, and `as const` for literals.
- **No non-null `!`** unless invariance is proven right there; prefer explicit guards.
- **Pure, exported, typed functions for logic.** If logic can be a pure function, it should be —
  it's testable and reusable (e.g. `src/engine/connectors.ts` → `findTriggeredConnector`).
- **`@/` path alias** for imports, not deep relative chains.
- Prefer `type` for unions/aliases, `interface` for object contracts that may be extended.

## 2. React

- **Function components + hooks only.** One responsibility per component.
- **No module-level mutable globals for state.** Single source of truth in React state (or a ref
  for imperative/loop state) — never both. *Anti-example: `templates.tsx` drives view mode through
  module-level `debugMode`/`topViewMode`/`flowViewMode` **and** React state, which desync. Collapse
  to one `viewMode` state machine.*
- **Derive, don't duplicate, state.** Compute from a single source instead of mirroring.
- **Extract reusable logic into custom hooks.** Keep components thin.
- **Effects:** correct dependency arrays; always clean up listeners/animation frames/timers.
- **Refs for the imperative layer** (canvas, game loop, latest-closure callbacks). A once-mounted
  loop must read the latest closure through a ref, not capture a stale one.
- **Memoize expensive render work**; don't allocate per frame in hot paths. *Anti-example: the
  render functions re-allocate and re-sort the draw list and recompute trig noise every frame.*

## 3. Separation of concerns / file size

- **Pure logic out of components** → testable modules (`src/engine/*`, `src/lib/*`).
- **Rendering/canvas separate from React state**; **data/API layer separate** (`src/lib/api.ts`).
- **Split large files.** A growing file is doing too much. *Anti-example: `templates.tsx` is ~5,300
  lines = editor + runtime + renderers + generators in one component. Decompose by concern
  (loop, renderers, editor panels, map generation) as you work in it.*
- Colocate by feature; keep barrels (`index.ts`) complete and intentional (don't omit modules).

## 4. Styling — ITCSS + Tailwind

Specificity flows **low → high**. ITCSS layer order:

```
1 Settings   — design tokens / CSS custom properties (no output)
2 Tools      — mixins/functions (no output)
3 Generic    — resets, normalize, box-sizing
4 Elements   — bare element defaults (h1, a, …)
5 Objects    — layout primitives, unstyled patterns (.o-container)
6 Components — themed UI pieces (.c-card, .df-panel)   ← most app CSS lives here
7 Utilities  — single-purpose overrides, highest specificity (Tailwind sits here)
```

- **Tailwind utilities first** for layout/spacing/color/state. Reach for them before writing CSS.
- **Extract a CSS component class (ITCSS Components layer) only when** a pattern repeats, needs
  pseudo-elements/complex selectors, or is theme-driven — not for one-offs.
- **No hardcoded inline `style={{}}`** except genuinely dynamic, computed values (canvas-driven
  positions, runtime sizes). Pass dynamic values via **CSS custom properties**, not literal style
  objects with magic numbers. *(Extends [[feedback-styling-tailwind]].)*
- **Design tokens, not magic numbers** — colors/spacing/typography from the Tailwind config or CSS
  vars (e.g. the `df` palette tokens already in `tailwind.config.ts`).
- **Accessibility is non-negotiable:** semantic HTML, visible focus states, WCAG contrast, and
  `prefers-reduced-motion` for all motion. (Ties into the project's animation rules.)

## 5. Game-loop / canvas specifics (Nebulith)

- Keep the trigger/coordinate/projection **rules pure and unit-tested**; the loop only orchestrates.
- Hoist allocations and lookups **out** of the per-frame path; reuse buffers; sort with stable,
  cheap keys.
- One coordinate convention per view, documented; conversions in one place (the grid model), not
  scattered across renderers.

## 6. Testing

- **TDD** for logic and bug fixes (write the failing test first — see the superpowers skill).
- Tests assert **behavior**, exercise real module methods, cover positive + negative paths. No
  placeholder/false-positive tests.
- Baseline is known-broken (see [[project-test-baseline]]) — gate on the **specific file** you
  touched, not the whole suite.

## 7. Tooling

- **Latest Node via nvm** before any npm/npx ([[feedback-use-nvm]]).
- Match the surrounding code's idioms; comment the *why*, not the *what*.
