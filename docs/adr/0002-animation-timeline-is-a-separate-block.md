---
status: accepted
---

# Animation timeline lives in a separate `timeline:` block, not inline attributes or a mermaid directive

Authors need to describe cross-step timing relationships ("B enters after A, on step 2") inside
the same document as the diagram, using ids the diagram already declares. We put that syntax in
its own `timeline:` block at the end of the document rather than attaching it inline to each
node/edge declaration or overloading mermaid's existing directive syntax, so that ordering between
elements declared on different lines is expressible at all, and the diagram's structural
definition stays free of animation concerns.

## Considered Options

- **Inline attributes** on each node/edge declaration (e.g. `A[Start] :: step=1 enter=fade`) —
  rejected. Can't express relationships between elements declared on different lines ("which comes
  before which"), and clutters the diagram definition with a second, unrelated concern.
- **Reuse mermaid's `%%{...}%%` directive syntax** — rejected. Directives are semantically for
  whole-document configuration (themes, etc.); overloading them with a step-by-step timeline reads
  unnaturally and risks colliding with mermaid's own directive semantics as that syntax evolves
  upstream, since we don't control it.
- **Separate `timeline:` block** (chosen) — keeps the diagram's structural definition clean, groups
  all timing logic in one place, and elements are referenced by the ids they're already declared
  with.

v1 implements only `step N: enter <id> fade`. This is expected to change once `exit`, `highlight`,
and slide effects are designed — the syntax inside the block is provisional, the decision to keep
it in its own block is not.
