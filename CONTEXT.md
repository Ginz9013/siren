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
timeline targets by id. Deliberately separate from the diagram's structural definition — see
[ADR-0002](docs/adr/0002-animation-timeline-is-a-separate-block.md).
_Avoid_: animation block, timeline section

**Step**:
A positive integer named in a timeline block. Steps reveal in ascending order via
`controller.next()`. Anything the timeline block never mentions is visible from the
start (implicit "step 0").
_Avoid_: frame, stage

**Timeline action**:
One `step N: <verb> <id> [<effect>]` entry in a timeline block. Four verbs: `enter`/`exit`
(effect: `fade` or a directional `slide-{left,right,top,bottom}`), `highlight` (effect: `outline`
or `glow` — cumulative, multiple targets can be highlighted at once, a second `highlight` on the
same target replaces its effect rather than requiring `unhighlight` first), `unhighlight` (no
effect).
_Avoid_: animation, timeline entry, "effect" alone (say "enter effect" / "highlight effect" when
the verb matters)

**Timeline target**:
Anything a timeline action can name by id: a flowchart node or edge, or a class, relationship,
namespace or note in a class diagram. Every one of them carries `data-siren-id` in the rendered
SVG, which is how the animation controller finds it — so a diagram kind gains animation by tagging
its drawn elements with the ids the timeline uses, not by teaching the controller anything new.
A target is the *authored thing*, not one drawn element: an id may be worn by several elements
(a sequence participant is drawn in both participant rows, alongside its lifeline) and they all
animate together — see
[ADR-0009](docs/adr/0009-a-timeline-target-is-an-id-not-an-element.md).
_Avoid_: animated element, node/edge (flowchart-only vocabulary — this term is what replaced it),
timeline reference, animation target

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
Which diagram a Siren document declares in its header — `flowchart TB|BT|LR|RL`,
`sequenceDiagram`, or `classDiagram`. Carried as `SirenDocument.kind` and dispatched on by
`parseSiren`, `buildGraphModel`, and `render()`, each of which routes to that kind's own
parser/model/layout/renderer.
_Avoid_: diagram type, mode

**Direction**:
Which way a diagram's layout runs — `TB` top-to-bottom, `BT` bottom-to-top, `LR` left-to-right,
`RL` right-to-left — written in a flowchart's header (`flowchart TB`) or a class diagram's
`direction` statement. `TD` is Mermaid's alias for `TB`, not a fifth direction: both parsers
normalize it away through the same rule, so nothing downstream ever sees two spellings of one
direction — including `layoutDirectedGraph`, which takes these four values as dagre's `rankdir`
with nothing left to map.
_Avoid_: orientation, flow direction, rankdir (that is dagre's word for it, and it belongs inside
`layoutDirectedGraph`), TD (say `TB`)

**Graph-shaped diagram**:
A diagram kind whose layout is a directed graph of boxes and connectors — flowchart and class
diagrams today; state, ER, requirement and C4 when they land. Every one of them sizes its own
boxes and labels and then calls `layoutDirectedGraph`, the single place in the codebase that
imports dagre (see [ADR-0001](docs/adr/0001-build-the-rendering-pipeline-instead-of-wrapping-mermaid.md)
and its amendment). A sequence diagram is deliberately *not* one: it is lane-based and time-ordered,
and has its own `layoutSequence`.
_Avoid_: graph diagram (ambiguous with the flowchart kind specifically), dagre diagram

**Node**:
One box in a flowchart, declared `A[label]` or created implicitly by being named in an edge — the
flowchart counterpart of a class diagram's **class** and a sequence diagram's **participant**. A
node has exactly one shape today; Mermaid's other shapes are unimplemented rather than
deliberately excluded.
_Avoid_: box, vertex, block, state

**Edge**:
A directed connector between two flowchart nodes, written `A --> B`. Its id is `${from}-${to}`,
then `#2` for a repeat pair — the convention a class diagram's **relationship** copies verbatim.
`-->` is the only form today, and an edge carries no label.
_Avoid_: link, arrow, connector, relationship (class-diagram vocabulary), message (sequence
vocabulary)

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

**Class**:
One box in a class diagram — the class-diagram counterpart of a flowchart node. Created by a
`class` statement (bare, block, or the inline `Animal : +int age` member form) or implicitly by
being named in a relationship, exactly as `A --> B` creates two flowchart nodes. Its id is the
declared name, with a generic parameter *not* part of it: `class Registry~T~` has the id
`Registry` and draws as `Registry<T>`. A second declaration of the same name merges members
rather than erroring. May carry one **annotation** (`<<interface>>`, `<<abstract>>`, or any
author-chosen text), drawn in guillemets above the name — an annotation labels the class it
is written in, unlike a note, which is a box of its own.
_Avoid_: CSS class (the codebase is full of `siren-*` CSS classes and of these boxes — say
"class" only for the box, and "CSS class" for the other; the `classDef`/`cssClass` directives
name the CSS-ish sense, not this one), node, entity, box

**Member**:
One attribute or method line inside a class, carrying an optional visibility marker (`+` public,
`-` private, `#` protected, `~` package), an optional classifier (`*` abstract, `$` static), a
name, an optional type, and — for methods — a parameter list and an optional return type.
Rendered verbatim, as the author spelled it. Attributes and methods draw in two separate
compartments, in declaration order within each, with a divider above every populated one.
_Avoid_: field, property (that is a CSS declaration's property in an author style), attribute
(alone — that is one of the two kinds of member, and it is also an SVG attribute; say "attribute
member" when the kind matters)

**Relationship**:
A directed edge between two classes, carrying one of Mermaid's eight types, an optional `: label`
and optional multiplicity strings at each end. Its id follows the flowchart edge convention
exactly: `${fromId}-${toId}`, then `#2` for a repeat pair. The type is modeled as two axes — a
`line` (`solid` | `dashed`) and an endpoint marker at each end (`none` | `triangle` |
`diamondFilled` | `diamondHollow` | `arrow`) — whose named compositions are `inheritance`,
`composition`, `aggregation`, `association`, `link`, `dependency`, `realization` and `dashedLink`,
reported as `data-siren-relationship`.
_Avoid_: edge (that is flowchart vocabulary; each of the three kinds names its connector
differently — flowchart *edge*, sequence *message*, class *relationship* — and only the
flowchart edge is a `.siren-edge`), association (that is one of the eight types, not the
category), arrow, link (also one of the eight types)

**Namespace**:
A named group of classes drawn as an enclosing frame behind the boxes it holds, laid out as a
dagre compound-graph cluster. The third grouping construct in the codebase and the only spatial
one in a graph-shaped diagram — a sequence diagram's **box grouping** bands participant lanes, and
its **control-flow block** wraps statements in time. Addressable in a `timeline:` block under a
generated id (`namespace:1`, `namespace:2`, … in source order).
_Avoid_: package, module, cluster (that is the dagre-side word `layoutDirectedGraph` uses for the
mechanism, not the authored construct), group, box

**Note**:
A free-standing annotation box in a class diagram, either attached to one class
(`note for Shelf "..."`, drawn with a connector to that class's box) or standing alone
(`note "..."`). Laid out as an ordinary node in the graph, so the layout engine itself guarantees
it never overlaps a class box — at the cost of occupying a rank. Addressable in a `timeline:`
block under a generated id (`note:1`, `note:2`, … in source order, which a dropped note does not
renumber).
_Avoid_: annotation (that is the `<<interface>>` marker *inside* a class — a note is a box of its
own), comment (that is a `%%` line, which is stripped before parsing and draws nothing), label,
callout

**Author style**:
A `style`/`classDef`/`cssClass` declaration in a class-diagram document, emitted as an inline
`style` attribute on the drawn shape. A **local override within one document**, as opposed to a
**design token**, which is the global default for every diagram — the two do not compete, see
[ADR-0008](docs/adr/0008-author-styling-sits-alongside-the-token-theme.md). Property names must be
plain CSS identifiers and values may not contain `url(`, `expression(`, `;` or `\`; a rejected
declaration is dropped with an error diagnostic and its siblings still apply. Reaches a class's
frame only, never its label text — so a style hard-coding an opaque fill is theme-blind, and
examples in this repo use translucent fills for that reason.
_Avoid_: theme, custom style, CSS class (a `classDef` defines a named set of declarations, not a
CSS class — nothing it produces reaches a stylesheet), inline style (that is the mechanism, not
the authored thing)

**Interaction target**:
A class the author made clickable, with `click X href "url"` / `link X "url"` (rendered as an
`<a class="siren-link">` wrapper) or `click X call fn()` / `callback X "fn"` (rendered as a
`data-siren-click` hook that `render()` reports to `options.onClick`). Both forms are author input
reaching a live sink, so the URL is checked against an `http`/`https`/`mailto` allowlist — a
scheme-relative or otherwise disallowed URL is dropped with an error diagnostic — and a callback
is only ever a *name* handed to the host, never a function this package looks up and invokes.
_Avoid_: link (that is one of the two forms), handler, action (that is the callback-name field of
one, not the whole thing), hotspot
