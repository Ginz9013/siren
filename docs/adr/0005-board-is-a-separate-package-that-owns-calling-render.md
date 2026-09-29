---
status: accepted
---

# `siren-board` is a new package that owns calling `render()`, not a `siren-core` export

Displaying a Siren diagram in a browser today means hand-rolling the same boilerplate around
`siren-core`'s `render()` in every consumer: a canvas-based text measurer, a container that
scales the SVG on resize, and diagnostics handling — `demos/step-reveal.html` and
`demos/complex-showcase.html` currently duplicate this near-verbatim (see
`.scratch/siren-board-slice/spec.md`). We're extracting this into `siren-board`, a new package
that depends on `siren-core` rather than a new export inside it, and that owns calling `render()`
itself (`createBoard(container, { source })`, `board.setSource()`) rather than just wrapping an
already-rendered `{svg, controller}` handed to it. `siren-core`'s existing default `TextMeasurer`
deliberately avoids `canvas` to stay usable under jsdom (see the code comments in
`packages/core/src/index.ts`) — a real browser measurer needs `document.createElement('canvas')`,
which only exists in a DOM. Moving that measurer, and the DOM mounting/resize/diagnostics logic it
enables, into `siren-core` itself would tie core's test environment to a real browser; keeping it
in a separate package preserves core's existing environment-agnostic contract.

## Considered Options

- **Add board as a new export inside `siren-core`** (e.g. `siren-core/board`, mirroring the
  existing `siren-core/theme.css` export) — rejected. Board's canvas-based text measurer and
  DOM/resize handling are inherently browser-only; core's test suite runs under jsdom specifically
  so its pipeline (parser → layout → render → animation) stays verifiable without a real browser.
  A board export inside the same package would make that guarantee easy to accidentally break.
- **Board only wraps an already-rendered result** (`wrapBoard(svg, controller, container)`, caller
  still calls `render()` themselves) — rejected. This keeps board's own interface narrower, but
  pushes re-render-on-source-change, diagnostics handling, and error-banner timing back onto every
  consumer — exactly the duplication this package exists to remove. Owning the `render()` call
  lets board present a single `setSource()` method a consumer calls synchronously and forgets
  about; init and error handling just work.
- **`siren-board` as a new package, owning `render()` internally** (chosen) — core stays a pure,
  environment-agnostic library; board is a thin, browser-only consumer of it, the same
  relationship any future consumer (docs site, playground) would have.
