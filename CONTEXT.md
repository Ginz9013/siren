# Siren

Siren is a Mermaid-syntax-aligned diagram format and renderer that adds declarative animation —
step reveal, highlighting, enter/exit transitions — authored inside the same plain-text document
as the diagram. See `docs/adr/` for the architectural decisions behind it.

Compatibility with Mermaid is an absolute condition, not an aspiration: **a document that renders
in Mermaid must render here.** The rule that keeps it honest while the gap is still being closed,
and the one an author or a maintainer can act on today:

> **While a construct is unimplemented, Siren rejects it rather than rendering it wrongly.**

An author gets an error-severity diagnostic naming what is missing, and knows to route around it.
The alternative — reading as much of the line as we understand and drawing the rest away — hands
them a wrong picture with nothing in it to notice, and disguises *not implemented* as *supported*.
What Siren stands on, construct by construct, is measured by the **compatibility corpus** below.

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
A document declares it at most once. `timeline:` opens the block and nothing closes it: every
remaining line of the document belongs to it. A second `timeline:` is therefore a line *inside*
the block, not a new one, and since it is not a step entry all three diagram kinds report the same
error-severity diagnostic for it — `Unrecognized timeline line: "timeline:"` — which costs the
whole document, exactly as any other unrecognized line in the block does.
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
Anything a timeline action can name by id: a flowchart node, edge or subgraph; a class,
relationship, namespace or note in a class diagram; a participant, message, control-flow block,
box grouping, activation bar or note in a sequence diagram. Every one of them carries `data-siren-id` in the rendered SVG,
which is how the animation controller finds it — so a diagram kind gains animation by tagging its
drawn elements with the ids the timeline uses, not by teaching the controller anything new.
A target is the *authored thing*, not one drawn element: an id may be worn by several elements
(a sequence participant is drawn in both participant rows, alongside its lifeline, and its
destroy mark carries that same id; a labelled flowchart **edge** is a `<path>` and a `<text>`
side by side, both wearing the edge's id) and they all animate together — see
[ADR-0009](docs/adr/0009-a-timeline-target-is-an-id-not-an-element.md). A destroy mark is
therefore not a fifth sequence target: it animates when its participant does, and there is no id
that names it alone.
_Avoid_: animated element, "nodes and edges" as a collective name for what a timeline can name
(that is flowchart-only vocabulary, and this term is what replaced it — **node** and **edge**
remain the right words for those two things themselves), timeline reference, animation target

**Design token**:
A `--siren-*` CSS custom property in `packages/core/src/theme/default.css` — the single source of
truth for the diagram's default colors, sizing, and motion timing. Consumers theme by
redeclaring these in their own CSS, not by passing a JS theme object — see
[ADR-0004](docs/adr/0004-default-theme-ships-as-plain-css-inside-core.md).
**One token's reach narrowed when a flowchart node stopped being only a rectangle, and it narrowed
for two different reasons.** `--siren-node-border-radius` is declared once, as `rx` on
`.siren-node-frame`, and it now reaches exactly two of the fourteen node **shapes**: the
**rectangle** and the **subroutine**. Ten of the remaining twelve are drawn with a `<path>` or a
`<circle>`, neither of which has an `rx` property at all, so nothing the theme declares can land on
them — a *consequence* of the element each shape is drawn with, and the right behavior, because a
diamond has no corners to round. It is load-bearing rather than merely harmless for the cylinder,
which is drawn with a `<path>` instead of the obvious `<ellipse>` precisely so that it holds: on an
ellipse `rx` is a geometry property, and this token would have flattened the lid, which is the
figure rather than a decoration of it. The other two, `round` and `stadium`, *are* `<rect>`s that
the token could reach, and it is kept off them by *decision*: the renderer writes each one an
inline `rx` computed from the node's own height, and an inline declaration outranks every author
stylesheet by cascade origin. A stadium whose ends stopped being semicircles because someone
retuned a token would not be a stadium, and a round node flattened to `0` alongside every rectangle
would have lost the one thing that distinguishes it. The price is that the token has no say in
*how* round `A(Round)` is; that is a proportion, and it is the renderer's. So a consumer
redeclaring this token changes rectangles and subroutines and nothing else — which is a documented
token silently narrowing its reach, and the reason it is written down here.
_Avoid_: CSS variable, theme variable

**Id scope**:
The `__` plus exactly eight characters that every id *inside* one rendered SVG is suffixed with —
`siren-arrow__k3f9a1x2` — minted once per `render()` call by `renderer/mintIdScope.ts` and used by
all three renderers. It exists because an SVG `url(#id)` reference resolves against the whole
**page**, never against the SVG it is written in, so two diagrams sharing a fixed marker id would
both draw the first one's arrowheads.
The consumer-visible consequence, and the reason this is in the glossary rather than only in that
module: **Siren's markup is not byte-reproducible.** Two renders of one document differ in exactly
these tokens and in nothing else. Anyone diffing or snapshotting output has to normalize them
(`__` plus eight characters, and no `siren-*` name contains an underscore, so the boundary is
unambiguous), nothing may cache or hardcode a marker id, and a test that needs one reads it out of
the DOM.
_Avoid_: namespace (that is the class-diagram construct), prefix, hash (it is a random token, and
deliberately not a content hash — see the module for why), salt

**Diagnostic**:
A non-fatal, structured message (`severity: 'error' | 'warning'`) describing a problem in a Siren
document — an unresolved timeline reference, a duplicate node id, etc. Returned from `render()`,
never thrown.
_Avoid_: error, warning (too broad alone — say "diagnostic" for the type, "error-severity
diagnostic" for the level)

**Accessible title / description**:
`accTitle: text` and `accDescr: text`, document-level statements carried on the
parsed/resolved/positioned document under `accTitle`/`accDescr` in both the flowchart and the
sequence diagram (a class diagram has neither — never measured, no tracked corpus rows).
`accTitle` is kept deliberately apart from `title` (a different statement, `title text` with no
colon, and one a flowchart does not have at all): `title` draws on the canvas as visible heading
text and reaches no accessibility tree entry of its own; `accTitle` draws nothing visible and
reaches only the rendered SVG's own `<title>` element. `accDescr` is the same shape one level
down — draws nothing visible, reaches only the SVG's own `<desc>` element — and is independent of
`accTitle`: a document may carry either, both, or neither of the two, and they never merge into
one element.

Measured against real Mermaid: `accTitle` puts `<title>` first among the root `<svg>`'s children
and wires `aria-labelledby` to it; `accDescr` puts `<desc>` right after `<title>` when both are
present and wires `aria-describedby` to it — each attribute conditional on its own field only,
independently of the other. **Mermaid does not add `role="img"` for either, on a flowchart** — its
role there is unconditionally `role="graphics-document document"`, unrelated to accTitle/accDescr,
and Siren does not draw that attribute at all (a gap wider than this pair, left alone). The
flowchart renderer follows that measurement and sets no `role`. The sequence renderer sets
`role="img"` when `accTitle` is present — written before this entry covered `accDescr` and not
re-measured since, so read it as an unverified claim rather than a second data point.
_Avoid_: title (alone, for `accTitle` — the unqualified word means the visible one), aria-label,
alt text, accessible description (say `accDescr`, the way this entry says `accTitle` rather than
"accessible title" for the other half)

**Compatibility corpus**:
`packages/core/src/compat/corpus.ts` — one row per Mermaid construct, stating what Siren does with
that construct today, plus the runner and the two ratchets in `corpus.test.ts` that make the
statement fail when it stops being true. It is the instrument behind the absolute condition above:
nothing in this repo failed when a valid Mermaid document stopped rendering, which is how the
flowchart gap reached 34/39 unnoticed. A row is valid Mermaid, its meaning in prose, and one of
three states:
- **`supported`** — and it must carry an `assert` that reads the rendered SVG for *meaning*. "It
  parsed with no diagnostics" is exactly what a silent mis-render looks like, so a row claiming
  support without an assert is a defect **in the corpus**, and the runner fails it as one. This
  rule is the difference between measuring 10/39 and measuring the true 5/39.
- **`rejected`** — the author is honestly told the construct is not implemented. This is the
  **backlog**, and its count may only ever **shrink**.
- **`silently-wrong`** — no diagnostic, and the wrong picture. This is a **policy**, not a backlog:
  its count's destination is **zero**. A case may only remain here when its exit is *implementing*
  the construct rather than refusing it (refusing something Mermaid draws correctly would break the
  condition rather than serve it), and every such case is named in the ratchet's own comment. A
  board that leaves one unnamed has failed the policy; one that names it has not.
Both counts are asserted against a literal, so moving a case forces someone to look at the number
and say, in the commit, whether it moved because code changed or because a measurement was
corrected — no mechanical check can tell those apart.
The condition has exactly one exception: **Mermaid's own silent mis-renders.** "Renders in Mermaid"
means what Mermaid renders *correctly*; where Mermaid itself draws a wrong picture with no
diagnostic, Siren refuses and says why rather than reproducing the bug (the precedent is `;` inside
a style declaration list, which Mermaid ends the statement at, inventing a phantom node out of the
tail — see `DECLARATION_LIST_RE`). Two obligations keep that an exception rather than a licence:
the divergence is recorded **beside the code** that diverges, and **Mermaid's behavior is measured,
not remembered** — `packages/core/scripts/mermaid-probe.mjs` runs a document through real Mermaid
and prints what its parser recorded, and a divergence claimed from recollection is a guess.
_Avoid_: test corpus, fixtures, compatibility matrix, "supported" as loose praise (it is one of
three states with a rule attached), "silently wrong" as a description of any old bug (it names the
state a corpus row declares)

**Diagram kind**:
Which diagram a Siren document declares in its header — `flowchart TB|BT|LR|RL`,
`sequenceDiagram`, or `classDiagram`. Carried as `SirenDocument.kind` and dispatched on by
`parseSiren`, `buildGraphModel`, and `render()`, each of which routes to that kind's own
parser/model/layout/renderer. `graph` is Mermaid's original spelling of `flowchart` and opens the
same kind: like `TD`, it is normalized away in `parseDirection`, so no document, model or renderer
downstream ever learns which of the two words the author wrote.
_Avoid_: diagram type, mode

**Direction**:
Which way a diagram's layout runs — `TB` top-to-bottom, `BT` bottom-to-top, `LR` left-to-right,
`RL` right-to-left — written in a flowchart's header (`flowchart TB`) or a class diagram's
`direction` statement. `TD` is Mermaid's alias for `TB`, not a fifth direction: both parsers
normalize it away through the same rule, so nothing downstream ever sees two spellings of one
direction — including `layoutDirectedGraph`, which takes these four values as dagre's `rankdir`
with nothing left to map.
_Avoid_: orientation, flow direction, rankdir (that is dagre's word for it — it survives as
`layoutDirectedGraph`'s input field name, and nowhere else), TD (say `TB`)

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
flowchart counterpart of a class diagram's **class** and a sequence diagram's **participant**.

A node is drawn as one of **fourteen shapes**, named by the brackets it is declared with, which is
the whole of Mermaid's bracket layer: `rect` (`A[x]`, and every node nobody spelled otherwise),
`round` (`A(x)`), `stadium` (`A([x])`), `subroutine` (`A[[x]]`), `cylinder` (`A[(x)]`), `circle`
(`A((x))`), `double-circle` (`A(((x)))`), `asymmetric` (`A>x]`), `rhombus` (`A{x}`), `hexagon`
(`A{{x}}`), `parallelogram` (`A[/x/]`), `parallelogram-alt` (`A[\x\]`), `trapezoid` (`A[/x\]`),
`trapezoid-alt` (`A[\x/]`). The brackets are syntax and are not drawn. `NodeShape` is a closed
type and `GraphNode.shape` is required rather than optional, so "no shape" is not a second state
for anything downstream to fold into `rect` for itself.

Three things follow, and each is a decision rather than an accident. A shape's **kind** is the
compatibility contract and its **proportions** are the theme's — `A{X}` must be a diamond, how wide
that diamond is belongs here rather than to Mermaid, which is ADR-0004's line applied to geometry.
A label fits **inside** the shape rather than inside the box the shape is inscribed in, so each
shape tells `layoutGraph` how much bounding box its text needs; a diamond given a rectangle's box
would clip its own label on every diagonal. And whatever element draws the frame — one `<rect>` or
one `<path>`, two `<circle>`s for a double circle, a `<rect>` and two `<line>`s for a subroutine —
every one of them carries the class `siren-node-frame`, so an author's `style`, the theme and a
`timeline:` block reach all fourteen exactly as they reached a rectangle. One documented token is
the exception, and it is stated under **Design token**.

Mermaid's v11 `A@{ shape: cyl }` spelling is a second, larger vocabulary of about thirty names and
is unimplemented: a line spelling one is refused as an unrecognized flowchart line rather than
drawn as something else. Its own board, and it reuses all of this.
_Avoid_: box, vertex, block, state, "the shape" for one drawn element (a node's frame may be
several elements — say "frame" for what is drawn and "shape" for which of the fourteen it is)

**Edge**:
A directed connector between two flowchart nodes, written `A --> B`. Its id is `${from}-${to}`,
then `#2` for a repeat pair — the convention a class diagram's **relationship** copies verbatim.

**The token joining the two endpoints decomposes into three axes rather than naming one of
seventeen arrows** — the third time this codebase has made that call, after a sequence
**message**'s `{ line, head }` and a **relationship**'s `fromEnd`/`toEnd`. A **line**
(`solid` `--`, `thick` `==`, `dotted` `-.-`, whose opening dash is decoration so `.-` is the same
body), an **end** on each side (`none`, `arrow` `>`, `circle` `o`, `cross` `x`), and a **length**.
So `A <-.-> B` is not an eighteenth arrow: it is a dotted line with an arrow at each end. A single
end marker always lands on the *to*-end, measured; only the doubled spellings `<-->`, `o--o` and
`x--x` decorate the from-end. All four fields are required on `GraphEdge`, so a plain arrow is one
state rather than the absence of one — the rule `GraphNode.shape` already follows.

**The length is the axis that is not about drawing.** `A ----> B` counts its dashes and reaches
dagre as `minlen`, so its target sits three ranks away instead of one and the drawn diagram
differs. Drawing every length alike would be a silent mis-render by the **compatibility corpus**'s
own definition, and refusing long arrows would break the absolute condition, so honoring it is the
only option those two policies leave.

**An edge carries a label**, in two spellings that parse to *identical* documents — `A -->|yes| B`
and `A -- yes --> B`, plus the dotted stroke's `A -. yes .-> B` — with nothing downstream
recording which was written, exactly as nothing records `graph` versus `flowchart`. It is `null`
and never `""` when there is none: mermaid 11.17.2 rejects `A -->|| B`, so "labelled with nothing"
is not a state an author can reach. Layout reserves dagre space for it, which makes the label the
one part of an edge that changes *where the line goes* as well as what is drawn on it; the
renderer draws it as a `<text class="siren-edge-label">` **beside** the path rather than inside a
wrapping group, wearing the same `data-siren-id`, so one timeline target moves two elements
([ADR-0009](docs/adr/0009-a-timeline-target-is-an-id-not-an-element.md)).
`linkStyle`'s two halves therefore land on two elements: `stroke` paints the line and the
arrowhead minted for that colour, and `color` paints the label. The second half was **measured,
not chosen** — Mermaid writes `fill` onto the label's own `<text>` — so dropping it, which is what
happened while an edge had no text, was a silent mis-render.

The line style is emitted as a **CSS class** (`siren-edge-dotted`, `siren-edge-thick`) and never
as an inline declaration, on the single `<path>` an edge is drawn as. Inline, it would have
outranked the theme, an author's `linkStyle` and a `timeline:` block's `highlight X outline`
alike — on the one element all three already land on.
_Avoid_: link, arrow (say "arrow" for the drawn line and its ends, or "arrow token" for the
spelling that wrote them — never for the edge itself, the same split **message** makes),
connector, relationship (class-diagram vocabulary), message (sequence vocabulary)

**Subgraph**:
A `subgraph Title ... end` block in a flowchart, drawn as a titled frame around the nodes declared
inside it and laid out as a dagre compound-graph cluster. The **fourth** grouping construct here,
and the second spatial one in a graph-shaped diagram after a class diagram's **namespace** — a
sequence diagram's **box grouping** bands participant lanes and its **control-flow block** wraps
statements in time. Four things separate it from the namespace it most resembles, and none of them
is cosmetic:

- **It nests.** `ResolvedSubgraph` carries a `parentId`; `ResolvedClassNamespace` has no such
  field, so the class model has no way to say one group is inside another.
- **Membership lives on the node**, as `GraphNode.parentId`, in one place — so a node and the
  frame around it cannot disagree about which holds it. A namespace keeps a `classIds` list beside
  the classes and has to promise the two agree.
- **A node is claimed by the first block that names it**, measured, so naming it again from
  another block joins it rather than moving it. A class is a member of the namespace it was
  written in.
- **Two things written *about* one are refused by name rather than ignored**: `direction LR`
  inside a block (Mermaid lays that group out in its own rank direction; drawing it the document's
  way would be the wrong picture with nothing in it to notice) and an edge naming a block at
  either end (`one --> two` joins two frames in Mermaid). Both are `rejected` corpus rows, not
  silence.

**Its id is generated, not authored** — `subgraph:1`, `subgraph:2`, … in the order the keywords
open ([ADR-0010](docs/adr/0010-generated-ids-and-connector-ids-live-in-separate-spaces.md)) —
because a subgraph may legitimately be named after a node, and Mermaid itself accepts `A[Alpha]`
beside `subgraph A`. The author's title is drawn and is otherwise inert; Mermaid agrees far enough
to mint `subGraph0` of its own for `subgraph "Two Words"`, a spelling that gives the author no
handle at all. That generated id is why a subgraph is addressable in a `timeline:` block and
**not** by an author style: a `timeline:` entry names an id, which this has, while `style`,
`classDef` and the apply-directive name a target the *author* spelled, which this has not. Not an
omission — there is nothing for a directive to say.
_Avoid_: subgraph diagram (Mermaid has no such kind — this is a statement inside a flowchart),
cluster (that is the dagre-side word `layoutDirectedGraph` uses for the mechanism, the same way
**namespace**'s entry reserves it), namespace (that is the class-diagram construct), group, box
(overloaded three ways already — see **Box grouping**), container, frame (that is the drawn
`<rect>`, one of the two elements a subgraph is drawn with)

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
_Avoid_: timeline (that is the animation block — a lifeline is structural; it does animate, but
under its participant's id rather than one of its own), axis

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

**Activation bar**:
The rectangle Mermaid draws beside a participant's lifeline while it is "active" — opened by
`activate X` or the `+` shorthand on an arrow, closed by `deactivate X` or the `-` shorthand.
Measured against real Mermaid: `+` opens the lifeline the arrow *points at* (its destination) and
`-` closes the lifeline the arrow is *sent from* (its source) — not the same lane in general, and
easy to mis-state because the common `A->>+B` / `B-->>-A` pairing happens to put both markers on
`B`. Bars stack rather than merge when a lifeline is activated more than once before its first
close — offset outward from the lifeline the later a bar closes. Addressable in a `timeline:`
block under a generated id (`activation:1`, `activation:2`, … one shared counter across every
participant, assigned when the bar opens). `deactivate`ing a lifeline with nothing open is an
error, matching Mermaid's own rejection, not a silent no-op.
_Avoid_: activation (alone — say "activation bar" for the drawn rectangle, "activate"/"deactivate"
for the statements that open/close it)

**Control-flow block**:
A `loop`/`alt`/`opt`/`par`/`critical`/`break`/`rect` region wrapping a run of statements in a
sequence diagram, nestable to any depth. Drawn as a frame spanning every participant lane its body
touches, with one divider per extra branch (`else`/`and`/`option`). Its own keyword (`loop`, `alt`,
…) draws once, on the block's own header — never on a divider, however many branches there are —
beside the bracket-wrapped condition text (`loop every day` draws the word `loop` and `[every
day]`; measured against real Mermaid, which brackets a block's condition the same way whether it
sits on the header or on a divider). `rect` is the exception: a filled background highlight with no
frame, no keyword and no label. Addressable in a `timeline:` block under a generated id — its kind,
then a 1-based counter per kind in source order: `loop:1`, `alt:2`, `rect:1`. The colon is
load-bearing: a participant id is `\w+`, so no message id (`${from}-${to}`) can ever spell one of
these.
_Avoid_: block (alone — too vague), group, section, box

**Box grouping**:
A `box <color> <label> ... end` region wrapping participant declarations, drawn as a colored
background band behind those lanes for the diagram's full height. Distinct from a control-flow
block (which wraps messages in time, not participants in space) and from a participant's own box
shape. Addressable in a `timeline:` block under a generated id (`box:1`, `box:2`, … in declaration
order); animating it moves the band and its label, never the participants it groups, which are
drawn beside the band rather than inside it.
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
name the CSS-ish sense, not this one, and so does a flowchart's apply-directive, which Mermaid
spells `class A,B name` — that statement is about styling a **node** and never about one of these
boxes, so say "the apply-directive" for it), node, entity, box

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
A directed edge between two classes, carrying one of Mermaid's nine types, an optional `: label`
and optional multiplicity strings at each end. Its id follows the flowchart edge convention
exactly: `${fromId}-${toId}`, then `#2` for a repeat pair. The type is modeled as two axes — a
`line` (`solid` | `dashed`) and an endpoint marker at each end (`none` | `triangle` |
`diamondFilled` | `diamondHollow` | `arrow` | `circle`) — whose named compositions are
`inheritance`, `composition`, `aggregation`, `association`, `link`, `dependency`, `realization`,
`dashedLink` and `lollipop`, reported as `data-siren-relationship`.

A `circle` end (Mermaid's `()`, a lollipop — `Duck ()-- Quacks`) does not name a class: measured
against real Mermaid (`mermaid-probe.mjs`), the identifier written there is drawn as a
free-standing label instead — laid out like any other node, so it never overlaps a sibling, but
framed by nothing. Its node id is generated (`generatedId("interface", n)`, ADR-0010) rather than
the authored text, so two relationships that happen to write the same interface name still get
two independently positioned labels rather than one merged node. Unlike **Note**/**Namespace**
this label is not itself addressable in a `timeline:` block — only the relationship carrying it
is — so it carries no generated-id paragraph of its own the way they do.
_Avoid_: edge (that is flowchart vocabulary; each of the three kinds names its connector
differently — flowchart *edge*, sequence *message*, class *relationship* — and only the
flowchart edge is a `.siren-edge`), association (that is one of the nine types, not the
category), arrow, link (also one of the nine types), interface (Mermaid's own name for the
`circle`-end label; avoided here because this codebase already uses "interface" for the
`<<interface>>` annotation on a class block — say "lollipop label" or "interface label" only
with the class/relationship distinction clear from context)

**Namespace**:
A named group of classes drawn as an enclosing frame behind the boxes it holds, laid out as a
dagre compound-graph cluster. The third grouping construct in the codebase and the first spatial
one in a graph-shaped diagram — a sequence diagram's **box grouping** bands participant lanes, and
its **control-flow block** wraps statements in time. A flowchart's **subgraph** is the fourth and
draws the same figure deliberately, so a theme or an author who has learned to read one need not
learn a second vocabulary; that entry lists the four things that are nevertheless not the same,
starting with nesting, which this construct does not do. Addressable in a `timeline:` block under
a generated id (`namespace:1`, `namespace:2`, … in source order).
_Avoid_: package, module, cluster (that is the dagre-side word `layoutDirectedGraph` uses for the
mechanism, not the authored construct), group, box

**Note**:
A free-standing annotation box, in either of the two diagram kinds that have one — a class
diagram's, either attached to one class (`note for Shelf "..."`, drawn with a connector to that
class's box) or standing alone (`note "..."`); a sequence diagram's `note over A,B`/`note right of
A`/`note left of A`, modeled as one statement with a `left`/`right`/`over` placement axis (the
same two/one-axis pattern as `SequenceArrow`/`ClassRelationshipEnd`) rather than three statement
kinds, and drawn with the class diagram's own `siren-note`/`siren-note-frame`/`siren-note-text`
classes — deliberately reused rather than duplicated, since it is the same idea (a boxed
annotation) in both kinds. The two differ in layout: a class diagram's note is laid out as an
ordinary graph node, so the layout engine itself guarantees it never overlaps a class box, at the
cost of occupying a rank; a sequence diagram's note occupies its own rank on the timeline the same
way a message does (measured against real Mermaid: it never overlaps the message before or after
it) and draws no connector at all, unlike the class diagram's attached form. Addressable in a
`timeline:` block under a generated id in both kinds (`note:1`, `note:2`, … in source order, which
a dropped note does not renumber).
_Avoid_: annotation (that is the `<<interface>>` marker *inside* a class — a note is a box of its
own), comment (that is a `%%` line, which is stripped before parsing and draws nothing), label,
callout

**Author style**:
A styling declaration written in the document, emitted as an inline `style` attribute on the
element it is about. A **local override within one document**, as opposed to a **design token**,
which is the global default for every diagram — the two do not compete, see
[ADR-0008](docs/adr/0008-author-styling-sits-alongside-the-token-theme.md). A flowchart accepts
four directives: `style A fill:#fdd` straight onto one node, `classDef name ...` defining a named
set that applies to nothing on its own, the apply-directive that applies one such set to a list of
targets, and `linkStyle` — the only one that reaches an **edge**. A class diagram accepts the
first three. A sequence diagram accepts none, deliberately: Mermaid has no `style` there, so
adding one would be Siren invention rather than compatibility.
The apply-directive has two authored spellings and is **one directive**: Mermaid writes
`class A,B name` in a flowchart and `cssClass "A,B" name` in a class diagram, plus the flowchart
shorthand `A:::name` (standalone, or on either endpoint of an edge line). All three normalize at
the parser to one `apply` kind, so nothing downstream branches on which was written — the same
rule that turns `TD` into `TB`. The authored spelling survives only as `authoredAs`, so that a
diagnostic can quote the keyword the author actually typed and nothing else can act on it.
**`linkStyle` addresses an edge by declaration index; everything downstream uses the edge id.**
`linkStyle 0`, `linkStyle 0,2` and `linkStyle default` are what an author writes, and the model
resolves each index to the edge id `A-B` that `timeline:` and `data-siren-id` already use, so an
index never reaches a renderer. `default` is a **fallback tier**, not another declaration: it
covers every edge no specific `linkStyle` named, a specific one wins for the edge it names
whichever order the two were written in, and the two merge property by property rather than one
replacing the other.
`color` reaches label text, in both diagram kinds — the author's spelling, translated once in the
model to the `fill` that actually paints SVG text. That now includes a flowchart **edge**'s own
label, which is a `<text>` the same translation lands on; the connection was made once the edge
had somewhere to put it, and only after measuring that Mermaid makes it too. Every other property
goes to the frame, and a styled edge's arrowhead takes the edge's own `stroke` via a marker minted
per distinct (end shape, color) pair — per color alone until an edge's ends had shapes, and minted
only for the pairs a diagram actually draws, so one color and one head shape is still one marker.
Property names must be plain CSS identifiers and values may not contain `url(`, `expression(`, `;`
or `\`; a rejected declaration is dropped with an error diagnostic and its siblings still apply.
That gate is `graph-model/resolveStyles.ts` and only there — no renderer re-checks anything.
_Avoid_: theme, custom style, inline style (that is the mechanism, not the authored thing), CSS
class (a `classDef` defines a named set of declarations, not a CSS class — nothing it produces
reaches a stylesheet; and note that a flowchart's apply-directive is *spelled* `class`, which is
the third sense of that word in this codebase after the class-diagram box and the `siren-*` CSS
classes — say "the apply-directive" for the statement, and see **Class**), link style (two words —
`linkStyle` is a directive spelled one way)

**Interaction target**:
A class, a flowchart node, or a sequence diagram participant the author made clickable, with
`click X href "url"` (rendered as an `<a class="siren-link">` wrapper) or `click X call fn()`
(rendered as a `data-siren-click` hook that `render()` reports to `options.onClick`). Both forms
are author input reaching a live sink, so the URL is checked against an `http`/`https`/`mailto`
allowlist — a scheme-relative or otherwise disallowed URL is dropped with an error diagnostic —
and a callback is only ever a *name* handed to the host, never a function this package looks up
and invokes. A class diagram additionally accepts `link X "url"` and `callback X "fn"` as older,
standalone spellings of the same two directives; a flowchart does not — `link`/`callback` are not
valid flowchart Mermaid syntax at all (measured against mermaid 11.17.2), so a flowchart only ever
reaches this concept through `click`. A sequence diagram reaches it through a third spelling,
`link A: Label @ url` — parsed straight into an `href`-kind interaction (no third `InteractionKind`
was added for it: Mermaid's own popup-menu semantics for this directive are not reproducible in a
static SVG anyway, measured as a `display:none` panel toggled by JS), with `Label` carried as the
interaction's `tooltip` and drawn as a `<title>` — the same "first child of the group" tooltip
convention `click`/`link` already use on a class.
_Avoid_: link (one of several spellings, not a fourth kind of interaction), handler, action
(that is the callback-name field of one, not the whole thing), hotspot
