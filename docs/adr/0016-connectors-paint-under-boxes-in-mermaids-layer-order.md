---
status: accepted
---

# Connectors paint under boxes, in Mermaid's layer order

SVG has no z-index: what is drawn later covers what was drawn earlier. Every graph renderer in
Siren drew its boxes first and its connectors after them — flowchart nodes then edges, classes then
relationships, states then transitions, entities then relationships. A connector routed past a box
it does not end at therefore ran straight across that box's text. `commerce-domain.srn` shows it
plainly: relationship lines cross the member compartments of the classes between their ends.

The order was never measured against Mermaid. It was chosen locally, and the comments that justify
it ("a line drawn under an opaque box would disappear where the two meet") describe a problem that
only exists at the line's own ends, where the layout already stops it on the box's edge.

## What Mermaid does

Measured against Mermaid 11.17.2: its shared renderer creates four sibling layers in this order:

```
clusters → edgePaths → edgeLabels → nodes
```

(`mermaid/dist/chunks/mermaid.esm/chunk-ZAI7H55H.mjs`, the `clusters` / `edgePaths` /
`edgeLabels` / `nodes` inserts). Every connector sits under every box. Every connector label sits
above every connector, so no other line crosses a label, and under every box.

## Decision

Flowchart, class, state and ER diagrams paint in Mermaid's layer order:

```
defs → frames → every connector line → every connector label → boxes → class notes
```

Frames (subgraph, namespace, composite, ER subgraph) are all `fill: none`, so whether they sit
above or below a line changes only which stroke wins where the two cross. They stay first, as
Mermaid's `clusters` are.

A connector whose lines and labels used to share one `<g>` is now split into **two groups that wear
the same `data-siren-id`**:

| Kind | Line layer | Label layer |
| --- | --- | --- |
| class | `g.siren-relationship` (keeps `data-siren-relationship`) | `g.siren-relationship-labels` |
| state | `g.siren-transition` | `g.siren-transition-labels` |
| ER | `g.siren-er-relationship` | `g.siren-er-relationship-labels` |

A connector with no text draws no label group. The flowchart needs no split: its edge was already a
`path` and a `text` side by side, each carrying the edge's id, so only their order changes.

A class note's connector moves to the line layer as `path.siren-note-link`, carrying the note's id.
The note's box is still drawn last, because a note annotates the figure rather than being part of
it.

## Why two groups, not one moved group

Moving each connector's whole `<g>` under the boxes would be the smallest change, but it puts each
label under every connector drawn after it, so another relationship's line can still cross it. The
split is what gives labels Mermaid's guarantee. It costs nothing in animation: ADR-0009 already
makes a timeline target an id, not an element, so `exit Order-Shipment fade` reaches both groups
without the controller learning anything.

The line group keeps the existing class name, so `g.siren-relationship` still counts relationships
and still carries `data-siren-relationship`. The label group gets a name of its own. That name is
added to the theme's font rule, so the labels inherit the same face and size they did inside the
old group.

## Out of scope

- **Sequence diagrams.** Messages are meant to cross lifelines and activation bars. There is no box
  for them to sit under.
- **A state note's connector.** It is drawn inside its state's own `<g>`, because a state note has
  no id and animates with its state. Moving it out would need an id it does not have.

## Consequences

- Selectors that reach a label through its connector's group (`g.siren-transition[...]
  text.siren-transition-label`) no longer match. They select the label by id instead.
- A consumer who counted connector groups sees no change. A consumer who styled a label through
  its connector's group class has to name the new label group instead.
