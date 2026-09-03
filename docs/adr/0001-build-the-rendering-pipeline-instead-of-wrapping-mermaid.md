---
status: accepted
---

# Build parser, layout, and renderer from scratch instead of wrapping mermaid.js

Siren needs fine-grained, per-element control over animation timing (step reveal, enter/exit,
highlighting) authored declaratively inside the same document as the diagram. We build our own
parser, graph model, SVG renderer, and animation runtime rather than wrapping or forking
mermaid.js, because mermaid.js's rendering pipeline computes and paints the whole diagram in one
synchronous pass — it isn't designed for incremental, per-element timing control, and retrofitting
that means manipulating its already-rendered SVG from the outside after the fact.

## Considered Options

- **Wrap mermaid.js** (pre-process to strip our animation syntax, run mermaid's own renderer,
  post-process the resulting SVG to add animation hooks) — rejected. This is the same pattern a
  surveyed third-party tool (`mermaid-animate`) already takes, and by its own author's admission
  it "works-ish," not solid: the animation layer ends up bolted onto SVG structure we don't
  control, at the mercy of mermaid's internal DOM shape changing across versions.
- **Fork mermaid.js's source directly** — rejected. mermaid.js couples 13+ diagram types across
  multiple parser toolchains (chevrotain, langium, legacy jison); safely learning that codebase
  well enough to modify it is plausibly more expensive than owning a small, purpose-built engine
  we understand completely because we wrote it.
- **Build from scratch** (chosen) — but layout *math* specifically is not hand-rolled. It uses
  `@dagrejs/dagre` internally, hidden behind our own `layoutGraph()` interface. Sugiyama-style
  layered graph layout with edge-crossing minimization is a solved, well-studied problem orthogonal
  to animation — not worth re-deriving, and swappable later since it's an implementation detail
  behind our own seam, not a dependency the rest of the pipeline knows about.
