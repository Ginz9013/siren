---
status: accepted
---

# `@siren/board`'s pan/zoom is a CSS transform on a new board-owned viewport layer, not SVG `viewBox` manipulation or a zoom library

The original `@siren/board` spec (`.scratch/siren-board-slice/spec.md`) explicitly named "Pan/zoom
or any SVG-level interaction beyond step reveal" a v1 non-goal. This reverses that: board now
supports mouse drag-to-pan and cursor-anchored wheel-to-zoom. The pan/zoom transform is applied via
plain CSS (`translate` + `scale`) to a new `.siren-board-viewport` element that board owns and
mounts the rendered SVG into — not by manipulating the SVG's own `viewBox` attribute, and not via a
third-party pan/zoom library. Board's chrome CSS already scales the SVG to fit its container via
the SVG's own `viewBox` at scale 1.0 (no `ResizeObserver`); the new zoom scale is defined relative
to that existing fit-to-container look, so `viewBox` stays untouched and owned entirely by
`@siren/core`'s renderer, consistent with ADR-0005's "board is a thin browser shell around core, it
does not touch render internals" boundary. The error banner, which today lives alongside the
rendered SVG, is kept a sibling of the new viewport layer rather than inside it, so it is never
panned or zoomed along with the diagram.

## Considered Options

- **Manipulate the SVG's own `viewBox` attribute directly** — rejected. `viewBox` is set by
  `@siren/core`'s `renderToSVG` and represents the diagram's natural coordinate space; board reading
  or rewriting it on every pan/zoom step would reach into a value board doesn't own and has no
  seam for observing safely (core has no contract promising `viewBox`'s shape). It would also
  entangle pan/zoom math with core's layout coordinate system instead of board's own container
  pixel space.
- **A third-party pan/zoom library** (e.g. `d3-zoom`, `panzoom`) — rejected for this slice. Board
  currently has zero runtime dependencies beyond `@siren/core`; the actual behavior needed (drag
  pan, cursor-anchored wheel zoom, axis clamping, no rubber-band) is small enough to own directly,
  and doing so avoids taking on a library's own API surface, bundle weight, and gesture-set
  (typically including touch/pinch, which is out of scope here — see the slice's non-goals) for
  behavior board doesn't use.
- **CSS transform on a new board-owned `.siren-board-viewport` layer** (chosen) — keeps the same
  core/board boundary ADR-0005 already established: core still owns everything about the SVG it
  produces, board only ever positions and scales it as an opaque element via its own DOM/CSS. Zoom
  scale is naturally relative to the fit-to-container size board already computes via `viewBox` at
  scale 1.0, so no new coordinate system is introduced.
