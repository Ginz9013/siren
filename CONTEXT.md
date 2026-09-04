# Siren

Siren is a Mermaid-syntax-aligned diagram format and renderer that adds declarative animation —
step reveal, highlighting, enter/exit transitions — authored inside the same plain-text document
as the diagram. See `docs/adr/` for the architectural decisions behind it.

## Language

**Siren document**:
A plain-text file containing Mermaid-compatible diagram syntax (flowchart, etc.) plus an optional
timeline block describing how elements animate. The single self-contained artifact an author
writes and a renderer consumes — copy the whole document, paste it wherever `@siren/core` is
loaded, and it renders. Convention: `.srn` file extension.
_Avoid_: Siren file, Siren spec, animation file

**Core renderer** (`@siren/core`):
The parser, graph model, layout engine, SVG renderer, and animation runtime, published as one npm
package. Does not include the VS Code extension, the website, or the playground — those are
separate projects.
_Avoid_: the library, the engine (ambiguous — say which stage: parser, layout, renderer, ...)

**Board** (`@siren/board`):
A mounted, browser-only wrapper around one core-renderer `render()` call — owns a container's DOM,
its own chrome styling, and the `AnimationController` lifecycle across source changes. A consumer
of the core renderer (see [ADR-0005](docs/adr/0005-board-is-a-separate-package-that-owns-calling-render.md)),
not part of it; does not parse, layout, or render anything itself.
_Avoid_: canvas, viewer, widget

**View**:
A board's current pan offset and zoom scale, independent of which timeline step is showing (see
[ADR-0007](docs/adr/0007-board-pan-zoom-is-a-css-transform-on-a-new-viewport-layer.md)).
Resetting the view (`board.resetView()`) never changes the current step; resetting the step
(`controller.reset()`) never changes the view.
_Avoid_: viewport, camera, zoom level (say "view" for the combined pan+zoom state)

**Timeline block**:
The `timeline:` section of a Siren document. Lists step entries that assign animation actions to
nodes/edges by id. Deliberately separate from the diagram's structural definition — see
[ADR-0002](docs/adr/0002-animation-timeline-is-a-separate-block.md).
_Avoid_: animation block, timeline section

**Step**:
A positive integer named in a timeline block. Steps reveal in ascending order via
`controller.next()`. A node or edge never mentioned in the timeline block is visible from the
start (implicit "step 0").
_Avoid_: frame, stage

**Timeline action**:
One `step N: <verb> <id> [<effect>]` entry in a timeline block. Four verbs: `enter`/`exit`
(effect: `fade` or a directional `slide-{left,right,top,bottom}`), `highlight` (effect: `outline`
or `glow` — cumulative, multiple elements can be highlighted at once, a second `highlight` on the
same target replaces its effect rather than requiring `unhighlight` first), `unhighlight` (no
effect).
_Avoid_: animation, timeline entry, "effect" alone (say "enter effect" / "highlight effect" when
the verb matters)

**Design token**:
A `--siren-*` CSS custom property in `packages/core/src/theme/default.css` — the single source of
truth for the diagram's default colors, sizing, and motion timing. Consumers theme by
redeclaring these in their own CSS, not by passing a JS theme object — see
[ADR-0004](docs/adr/0004-default-theme-ships-as-plain-css-inside-core.md).
_Avoid_: CSS variable, theme variable

**Diagnostic**:
A non-fatal, structured message (`severity: 'error' | 'warning'`) describing a problem in a Siren
document — an unresolved timeline reference, a duplicate node id, etc. Returned from `render()`,
never thrown.
_Avoid_: error, warning (too broad alone — say "diagnostic" for the type, "error-severity
diagnostic" for the level)

**Diagram kind**:
Which diagram a Siren document declares in its header — `flowchart TD|LR`, `sequenceDiagram`, or
`classDiagram`. Carried as `SirenDocument.kind` and dispatched on by `parseSiren`,
`buildGraphModel`, and `render()`, each of which routes to that kind's own
parser/model/layout/renderer.
_Avoid_: diagram type, mode

**Graph-shaped diagram**:
A diagram kind whose layout is a directed graph of boxes and connectors — flowchart and class
diagrams today; state, ER, requirement and C4 when they land. Every one of them sizes its own
boxes and labels and then calls `layoutDirectedGraph`, the single place in the codebase that
imports dagre (see [ADR-0001](docs/adr/0001-build-the-rendering-pipeline-instead-of-wrapping-mermaid.md)
and its amendment). A sequence diagram is deliberately *not* one: it is lane-based and time-ordered,
and has its own `layoutSequence`.
_Avoid_: graph diagram (ambiguous with the flowchart kind specifically), dagre diagram

**Participant**:
One vertical lane in a sequence diagram, declared explicitly as `participant X` (drawn as a box)
or `actor X` (drawn as a stick figure). Lanes order left-to-right by first declaration. Never
created implicitly by being mentioned in a message — an undeclared reference is a diagnostic.
_Avoid_: actor (that is one of the two shapes a participant takes, not a synonym), lane, column,
node

**Lifeline**:
The dashed vertical line running down a participant's lane, spanning the extent between where the
participant comes into existence and where it stops. A `create participant X` statement starts it
partway down instead of at the top; a `destroy X` statement ends it early with an X mark instead
of at the bottom.
_Avoid_: timeline (that is the animation block — a lifeline is structural, not animated), axis

**Participant row**:
The horizontal band at the top of a sequence diagram holding every participant's box or icon, and
its mirror at the bottom. A preamble-declared, never-destroyed participant appears in both rows; a
`create`d or destroyed one appears once.
_Avoid_: header, top box (ambiguous with a box grouping)

**Message**:
One `A->>B: text` line in a sequence diagram — an arrow from one participant to another (or to
itself), carrying label text. Its arrow style is two independent axes: a line (`solid`/`dotted`)
and an arrowhead (`none`/`filled`/`bidirectionalFilled`/`cross`/`open`), which compose into
Mermaid's ten arrow forms.
_Avoid_: edge (that is flowchart vocabulary — messages are ordered in time, edges are not), call,
arrow (say "arrow" only for the drawn line/head, not the message itself)

**Control-flow block**:
A `loop`/`alt`/`opt`/`par`/`critical`/`break`/`rect` region wrapping a run of statements in a
sequence diagram, nestable to any depth. Drawn as a frame spanning every participant lane its body
touches, with one divider per extra branch (`else`/`and`/`option`). `rect` is the exception: a
filled background highlight with no frame.
_Avoid_: block (alone — too vague), group, section, box

**Box grouping**:
A `box <color> <label> ... end` region wrapping participant declarations, drawn as a colored
background band behind those lanes for the diagram's full height. Distinct from a control-flow
block (which wraps messages in time, not participants in space) and from a participant's own box
shape.
_Avoid_: box (alone — the word is overloaded three ways: this grouping, a participant's rect, and
a block's bounding rect; always qualify it)
