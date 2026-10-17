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

### When Mermaid itself is the one drawing it wrongly

The absolute condition says a document that renders in Mermaid must render here. It does not say
it must render *identically wrongly*. So there is a third rule, and it is deliberately narrow:

> **Where Mermaid's own output contradicts what the document says, Siren draws what the document
> says, and the divergence is written down by name — at the site, and in that construct's corpus
> row.**

The bound is the word *contradicts*. This is not a licence to improve on Mermaid's layout, its
spacing or its taste; those are Mermaid's to decide and Siren follows them. It applies only where
the document is unambiguous and Mermaid's picture disagrees with it — which makes the divergence
a measurement, not a preference. Two instances, both measured against 11.17.2:

- **A pseudo-state swallowed by an authored id.** `[*] --> root_start` names three things;
  Mermaid produces two, redirecting the start pseudo-state's edge into a self-loop nobody wrote,
  with no diagnostic. Siren mints `start:1` / `end:1` instead, which an authored `\w+` id cannot
  collide with (ADR-0010). Written up at `pseudoStateIds` in `graph-model/buildStateModel.ts`.
- **A note's side ignored because of its spelling.** `note LEFT OF Idle : x` is accepted by
  Mermaid, which records `position: "LEFT OF"` and then decides the side with an exact
  `=== "left of"` test — so it draws the note on the *right*, the opposite of what the line
  says, with no diagnostic. Siren reads the position case-insensitively and draws the side the
  author named.

Note what the second one shows: Mermaid's own *record* of the document was right and only its
drawing was wrong. `CompatCase.meaning` is "what Mermaid means by it" — so a corpus row for a
construct like this stays `supported`, asserts Siren's picture, and carries the difference from
Mermaid's drawing in its `meaning`. The row is still measuring meaning against a picture; it is
Mermaid that failed to match itself.

Every divergence under this rule is a claim that needs evidence, so a new one arrives with the
measurement of both pictures in the row, never with an assertion that ours looks better.

**One standing exception to "Mermaid's layout is Mermaid's to decide", for graph layout only.**
Since the ELK migration (decision `01M4VA67HYZZ1PZG49XA30454N`), Mermaid 12's default layout is the
baseline the flowchart's, the class diagram's, the state diagram's and the ER diagram's pictures are measured against — the engine, the orthogonal routing, where
edges leave a box, the order siblings come in. Siren may depart from it where the departure
**measurably** reduces crossings, detours, overshoots or edges drawn through a group's title, or
where Mermaid's picture contradicts the document. Each such departure is measured with the
**layout parity report** and recorded in a nook decision, never asserted as taste. The first one is
the long arrow (`---->`, under **Edge**; decision `01M4VA6MS4MCTFFJJWEZR453YS`); the second keeps
the sidestep at an edge's end where Mermaid's straightening would run the edge through a box
(decision `01M4VBHWYKNH91NXFD4ZF9MQDD`); the third fits a subgraph's frame to its own padding rather
than Mermaid's 24px, which lowered vertical agreement (decision `01M4VDB3XG71N3R1EN5J94JMZ4`); the
fourth moves a subgraph's title along its band, off centre, where a route would otherwise run
through it and the frame has room (decision `01M4VFW4XGRGSMTMQ12HME145W`); the fifth, sixth and
seventh are a class diagram's multiplicities — moved off any line or box they land on, not only off
a frame, and to the other side of the line when their own has no room; kept at their own end of a
relationship ELK was handed turned round; and kept clear of a namespace's title, which moves off
them as it moves off routes (decision `01M4VHSY2W1Q9E5QCA51F1TCJM`); the eighth keeps a state
diagram's **note** inside the composite its state is written in, where Mermaid draws it outside the
block and makes the block give up its `direction` (decision `01M4VKTJ2A1DGXAMYVF16BK2W3`). The
ER diagram's move added none: its handover order, block directions, relationship labels and
cardinality ends were measured to follow Mermaid 12.2.0 (decision `01M4VNEEYAHMFDVRAB4XSAHKCB`).

## Language

**Siren document**:
A plain-text file containing Mermaid-compatible diagram syntax (flowchart, etc.) plus an optional
timeline block describing how elements animate. The single self-contained artifact an author
writes and a renderer consumes — copy the whole document, paste it wherever `siren-core` is
loaded, and it renders. Convention: `.srn` file extension.
_Avoid_: Siren file, Siren spec, animation file

**Core renderer** (`siren-core`):
The parser, graph model, layout engine, SVG renderer, and animation runtime, published as one npm
package. Does not include the VS Code extension, the website, or the playground — those are
separate projects.
_Avoid_: the library, the engine (ambiguous — say which stage: parser, layout, renderer, ...)

**Board** (`siren-board`):
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

**Full diagram**:
What a board shows while `board.fullDiagram` is on: the document drawn without applying its
**Timeline block** at all — the diagram Mermaid would draw. Every element is visible, none
carries an enter, exit, or highlight state, and there are no steps (`totalSteps: 0`). The board
produces it by re-rendering with siren-core's `render(…, { timeline: false })`, and switching it
off applies the **Current timeline** again and returns to the step that was showing. It is
independent of the **View**: switching the full diagram never changes the view, and resetting
the view never switches the full diagram.
_Avoid_: overview, plain mode, "the last step" (the timeline's last step still hides exited
elements and keeps highlights, so it is not the full diagram)

**Playback**:
A board advancing its timeline one step per play interval on its own, until the last step.
Starting playback on the last step replays from step 0. Any step change playback did not make
itself — a step stepped by hand, a new document, switching to the full diagram — stops it.
There is nothing to play in the full diagram or in a document without steps.
_Avoid_: autoplay (reads as "starts playing on page load"), slideshow

**Timeline block**:
The `timeline:` section of a Siren document. Each non-blank line is one step, and lists the
timeline actions that fire on it, naming timeline targets by id. Deliberately separate from the diagram's structural definition — see
[ADR-0002](docs/adr/0002-animation-timeline-is-a-separate-block.md).
A document declares either one unnamed `timeline:` block or one or more named
`timeline <name>:` blocks, never both. A name is letters, digits, `_` and `-`, and is
case-sensitive. A block runs from its header to the next timeline header or the end of the
document; nothing else closes it. Each block is a timeline in its own right: its steps count from
1, and step 0 is its own, so anything *that block* never mentions is visible from its start (see
decision `01M4GQ70CJ177A029JQV917H2Z`). Every block is validated whichever one is shown.
_Avoid_: animation block, timeline section, path, track, scenario

**Current timeline**:
The timeline block a render or a board is applying right now. When nothing names one, it is the
first block in the document.
_Avoid_: active path, selected track

**Step**:
One non-blank line of a timeline block. Its number is never written: it is the line's place among
the block's non-blank lines, counting from 1 (see
[ADR-0012](docs/adr/0012-a-timeline-line-is-a-step-and-its-number-is-implicit.md)). A line counts
whether or not its actions parse, so fixing a typo never renumbers the lines after it. Steps
reveal in written order via `controller.next()`. Anything the timeline block never mentions is
visible from the start (implicit "step 0").
_Avoid_: frame, stage

**Timeline action**:
One `<verb> <id> [<effect>]` entry on a step's line; a line holds one or more, separated by
commas. Four verbs: `enter`/`exit`
(effect: `fade` or a directional `slide-{left,right,top,bottom}`), `highlight` (effect: `outline`
or `glow` — cumulative, multiple targets can be highlighted at once, a second `highlight` on the
same target replaces its effect rather than requiring `unhighlight` first), `unhighlight` (no
effect).
_Avoid_: animation, timeline entry, "effect" alone (say "enter effect" / "highlight effect" when
the verb matters)

**Timeline target**:
Anything a timeline action can name by id: a flowchart node, edge or subgraph; a class,
relationship, namespace or note in a class diagram; a participant, message, control-flow block,
box grouping, activation bar or note in a sequence diagram; a **state**, **transition** or
**composite state** in a state diagram. Every one of them carries `data-siren-id` in the rendered SVG,
which is how the animation controller finds it — so a diagram kind gains animation by tagging its
drawn elements with the ids the timeline uses, not by teaching the controller anything new.
A target is the *authored thing*, not one drawn element: an id may be worn by several elements
(a sequence participant is drawn at both ends of its lifeline — in both participant rows, or for a
destroyed one in the top row and as its closing box — alongside the lifeline itself; a labelled
flowchart **edge** is a `<path>` and a `<text>` side by side, both wearing the edge's id) and they
all animate together — see
[ADR-0009](docs/adr/0009-a-timeline-target-is-an-id-not-an-element.md). A destroyed participant's
closing box is therefore not a target of its own: it is the participant's box drawn again, it
animates when its participant does, and there is no id that names it alone.
A state diagram's three are worth stating against the two kinds they most resemble, because the id
a timeline names comes from a different place in each. A **state**'s is the author's own name, as a
class's and a participant's are. A **transition**'s is `${from}-${to}` with `#2` for a repeat pair,
the connector convention shared with an **edge** and a **relationship**. And a **composite state**'s
is *also the author's own name* — which is what separates it from the **subgraph** it draws the same
figure as, whose id has to be minted (`subgraph:1`) because Mermaid lets an author title one with
text that gives no handle at all. A composite is named by `state Outer {`, so there is nothing to
mint and `highlight Outer outline` names the frame the author wrote. A **pseudo-state** is not a
fourth kind: `[*]` reaches the timeline under the generated id it already carries (`start:1`), which
it needs for the renderer regardless, so it is addressable for free rather than by decision.
_Avoid_: animated element, "nodes and edges" as a collective name for what a timeline can name
(that is flowchart-only vocabulary, and this term is what replaced it — **node** and **edge**
remain the right words for those two things themselves), timeline reference, animation target

**Design token**:
A `--siren-*` CSS custom property in `packages/core/src/theme/default.css` — the single source of
truth for the diagram's default colors, sizing, and motion timing. Consumers theme by
redeclaring these in their own CSS, not by passing a JS theme object — see
[ADR-0004](docs/adr/0004-default-theme-ships-as-plain-css-inside-core.md). **There is one set of
values, declared once, in one `:root` block** — colors, type, sizing and motion together — and
that block is the whole of the theme's styling interface. Siren never picks a palette on the
page's behalf: nothing in the file reads the reader's system color preference or any theme
attribute, so **a second theme is the consumer's**, made by redeclaring tokens under a selector
they choose and apply when they decide — see
[ADR-0014](docs/adr/0014-the-default-theme-ships-one-palette.md), which supersedes
[ADR-0011](docs/adr/0011-core-ships-a-light-and-a-dark-palette.md)'s light/dark switch, and
`demos/theme-dark.css` for that done in full. `siren-board`'s `--siren-board-*` properties are
**chrome tokens**, not design tokens: they color board's control bar and error banner, live in
board's injected stylesheet, and have the same shape — one set, one `:root` block (ADR-0006 keeps
board's chrome out of core's theme).
One consequence is worth stating because it is the reason a rule below exists: a color token is
always named at its point of use, never aliased into a new `--siren-*` in `:root`. A custom
property substitutes against the element its declaration sits on, so an alias in `:root` freezes
the value there and inherits it down past any override a consumer scoped lower — on a container,
on one diagram, on a section of the page.
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
_Avoid_: CSS variable, theme variable (`themeVariables` is the **document config** key Mermaid
spells a token's value under — the thing itself is still a design token), dark mode (say a
**theme preset**'s dark variant), 主題切換 (there is no switch to name: one set of
values, and a second theme is a consumer's own CSS)

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

**Layout parity report**:
What the parity script prints after drawing the same Mermaid document with real Mermaid and with
Siren, in one browser: how far Siren's picture is from Mermaid's. It is a measurement for a
developer, not a test. Nothing fails on its numbers, because they move with fonts and browsers.
Where the **compatibility corpus** asks whether Siren means what Mermaid means, this asks how close
the two pictures are.
_Avoid_: visual diff, snapshot (this repo has no snapshot tests), screenshot comparison (it compares
geometry, not pixels)

**Diagram kind**:
Which diagram a Siren document declares in its header — `flowchart TB|BT|LR|RL`,
`sequenceDiagram`, `classDiagram`, `stateDiagram`, or `erDiagram` (`stateDiagram-v2` is the same
kind under a second spelling, measured: both report the diagram type `stateDiagram`, exactly as
`classDiagram-v2` does; `erDiagram` has no such second spelling). Carried as `SirenDocument.kind` and dispatched on by
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
direction — including `layoutDirectedGraph`, which takes these four values as they are (the ELK
core maps them to ELK's `DOWN`/`UP`/`RIGHT`/`LEFT` in one table, Mermaid's `dir2ElkDirection`).
_Avoid_: orientation, flow direction, rankdir (that was dagre's word for it, from before the
layout moved onto ELK), TD (say `TB`)

**Graph-shaped diagram**:
A diagram kind whose layout is a directed graph of boxes and connectors — flowchart, class, state
and ER diagrams today; requirement and C4 when they land. Every one of them sizes its own
boxes and labels and then calls the shared layout core, `layoutDirectedGraph` — the one place a
layout engine is reached (see [ADR-0001](docs/adr/0001-build-the-rendering-pipeline-instead-of-wrapping-mermaid.md),
whose engine part — that file still names dagre — is amended by nook decision
`01M4VPWF5A5MGP624AFGT02AV4`: ELK, hidden behind the shared layout core, with elkjs imported only
by `layout/elkSync.ts`). All four are laid out by ELK's `layered` algorithm
(`layout/layoutDirectedGraph.ts`, beside `layout/elkSync.ts`, the only module importing elkjs,
pinned to 0.9.3 as Mermaid 12.2.0 bundles it). A sequence diagram is deliberately *not* one: it is lane-based and time-ordered,
and has its own `layoutSequence`.
_Avoid_: graph diagram (ambiguous with the flowchart kind specifically), dagre diagram, ELK diagram

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

Mermaid's `A@{ shape: cyl }` **node data** names the same fourteen shapes by 45 names (each shape's
short name and its aliases, `NODE_DATA_SHAPES` in `flowchartNodeData.ts`): the brackets and the
block are two spellings of one shape, and a block on a node written before changes its shape and
keeps its text. Its other names are refused as not drawn yet, never drawn as one of the fourteen —
except the shapes the **shape table** draws.

The **shape table** (`layout/shapes/`, nook `01M51XAC4N`) is where every shape
lives: one record per member of `NodeShape`, saying how much box a padded label needs (`box`),
where the label goes in it (`labelRect`) and which elements draw the outline (`frames`). `layoutGraph`
sizes a node and reports its label's offset (`PositionedNode.labelOffset`) from it, and
`renderToSVG` draws the frames from it; neither names a shape. The fourteen bracket shapes are its
first records. The rest are the shapes Mermaid names only in a `@{ … }` block — `notch-rect`,
`notch-pent`, `sl-rect`, `tri`, `flip-tri`, `folder`, `lin-rect`, `div-rect`, `win-pane`,
`st-rect`, `tag-rect`, `text`, `datastore`, and the undocumented `note`, `composite` and `state` —
each sized by Mermaid's formula for it (ADR-0004: its kind is the contract, not its exact path). A
shape is added by a record in its group's file and its names in `flowchartNodeData.ts`. A record may say it
**draws no label** (`drawsLabel: false`, the fork, the small circles, `choice`, `anchor`): its box
is a constant, the renderer leaves the text out, and a label the author writes for it is refused
where it was written, since Mermaid drops it without a word. Which shapes draw no label, and which
take no style by name (`sm-circ`, `anchor`: Mermaid draws them in their own paint whatever `style`,
`class` or `:::` says, so the parser refuses one), is kept in `nodeShapeTraits.ts`, which the parser
and the shape table both read, so that neither reads the other; tests keep the two sets and the
records in step. Its box is sized for the direction of
the nearest enclosing subgraph that names one, or the graph's — a fork stands upright in a
left-to-right flow. A frame
may wear a **paint** beside `siren-node-frame` — hollow, ink (the stroke colour), bare (no paint)
or note — a class rather than an inline declaration, so a highlight still outlines it and an
author's `style` still wins.
The shapes with a **curved outline** (`curvedShapes.ts`, nook `01M51XACHP`) are
records too — `delay`, `curv-trap`, `h-cyl`, `lin-cyl`, `bow-rect`, `doc`, `lin-doc`, `tag-doc`,
`docs`, `flag`, `brace`, `brace-r` and `braces`. A round end, a cylinder's end and a brace's curl
are SVG arcs; a **wavy edge** is Mermaid's sine wave, sampled at its 51 points. A brace is an open
path painted hollow. Each handler pads its text by its own multiple of the node padding (a cylinder
on its side by half of it, a flag and a brace once, a document stack three times in height), so a
record recovers the text — the padded label less the node padding `layoutGraph` measured, Siren's
own — and pads it by that rule: the shape then stands to a rectangle as Mermaid's does in the
**classic look**, the one the table follows (the parity report compares with it under
`--look classic`; Mermaid's default `neo` look pads every shape differently).

The **figures** (`compositeShapes.ts`, nook `01M51XACRX`) — `bucket`, `person`,
`console`, `browser`, `cloud`, `bang` — are drawn in more than one element: a body plus its
decorations (a rim, a head, a prompt, a bar's dots and address bar), each a frame, so a highlight
reaches all of them. An author's `style` reaches those Mermaid paints with it (a body, a head, a
rim) and not those it keeps in the border colour (a browser's bar line, dots and address bar, a
console's prompt), which say `authorStyle: false` and wear a paint (hollow or ink) rather than a
colour of their own. A cloud and a bang pad their text with the node padding as their handlers do. A cloud's and a bang's box is the extent of
Mermaid's arcs rather than the `w x h` they join, and their label is centred on that `w x h`.

**A node's label is a Label** (below), like every flowchart label: an edge's and a subgraph
title's too. `SirenNode`/`GraphNode`/`PositionedNode` carry it as `label`, and `PositionedNode` adds
the `labelBox` layout measured it into, which the node's shape was sized to hold. The fenced
`` A["`**bold**`"] `` Markdown string is one spelling of a label rather than a second field: a quoted
label whose content is itself fenced in backticks is read by the same reader, its `**`/`*` pairs and
real line breaks read as the tags they stand for (`<strong>`, `<em>`, `<br>`), which is what Mermaid
does with it. A line break inside the fence is real Mermaid too: its lexer reads a quoted
label across physical source lines when the closing quote has not been reached yet, so the
flowchart parser joins such lines back together (`joinMarkdownFences` in `parseFlowchart.ts`)
before anything else reads them — the one place this grammar is not read one physical line at a
time. A node written without a label (`A`, `A:::name`) is labelled with its own id.
_Avoid_: box, vertex, block, state, "the shape" for one drawn element (a node's frame may be
several elements — say "frame" for what is drawn and "shape" for which of the fourteen it is)

**Label**:
What an author wrote in one place a diagram draws text, read as **rows of runs**: each row is one
drawn line, and each **run** is a stretch of a row's text sharing one set of properties — bold,
italic, underline, a font size, a color, a link, and the rest of `LabelRun`'s fields, each an
independent axis with a neutral value. A run with every axis neutral is a **plain run**. A label's
`text` is its **flattened text** — the runs concatenated, the rows joined by `\n` — for the readers
that only want a string, such as a diagnostic quoting the label.
What is drawn is the rows.

A label's rows are one **line** apart, and a line is 1.5 times the size the label is drawn at,
Mermaid's 24px for 16px text: **21px** at a node's 14px, **18px** at a connector label's 12px. The
measurer's height for one string is one line plus its vertical padding, and that padding is added
once around all the rows, never per row — so a one-row label is exactly as tall as the measurer's
answer. Sequence text follows Mermaid's SVG text instead: a message's, note's and block condition's
rows are 19/16 of the font size apart, a participant's and a box caption's one font size.

The **picture** a label is held to is what Mermaid's default `htmlLabels: true` shows a reader; the
**drawing** stays SVG `<text>`/`<tspan>` with author text through `textContent`, never `innerHTML`
(ADR-0015). Between them, in the `html` dialect, every HTML tag Mermaid lets through is read into
the label's rows and runs — drawn, drawn approximately, or refused with a diagnostic — and none is
drawn as its literal characters; in the `sequence` dialect every tag but a row break *is* drawn as
its characters, because that is Mermaid's picture there, and a class member draws all of them so.
A tag is read as the HTML tokenizer reads one: `<` then a letter (or `/` and a letter) starts it, its
first `>` outside a quoted value ends it, and one the label ends inside is dropped with everything
after its `<` (`x <y` draws `x `), while a `<` before anything else is a character (`a < b`). Which
tags a place honors is its **dialect**: `html`, the whole vocabulary, for the places
Mermaid draws as HTML; `sequence`, only `<br>` and entity codes, for sequence text, which Mermaid
draws as SVG in both modes. A class **member** is not a label at all: Mermaid escapes its `<` and `>` in
both modes, so no tag in it is read, but not its `&`, so it is drawn with its entity codes and
character references decoded, as a label's text is (`+#lt; x` and `+&lt x` draw `+< x`). A **row break** is `<br>` in any case, with or without attributes
and a closing `/` — `<br>`, `<br/>`, `<br />`, `<BR>` and `<br class="x">` all break a row, the last
because Mermaid's HTML labels keep it as an element, though its own `/<br\s*\/?>/gi` does not match
it; in the `sequence` dialect that narrower pattern is the picture, so `<br class="x">` is drawn as
its characters there. The text-styling tags are read too — `b` `strong`, `i` `em` `cite` `dfn` `var`, `u` `ins`, `s`
`strike` `del`, `code` `kbd` `samp` `tt`, `small` `big`, `sub` `sup`, `q` and `mark` (black text on
a yellow rect behind the run, through the theme's `--siren-label-mark-text` and
`--siren-label-mark-fill`) — nested and misnested as the browser's HTML parser reads them; a **Markdown string** is read as the tags it stands for, so
its `**`/`*` and `__`/`_` stack with tags the author wrote, paired by CommonMark's emphasis rules as
Mermaid's Markdown reader pairs them (`x**(a)**y` and `a_b_c` are drawn as written); a backslash
before punctuation escapes it (`\*a\*` is drawn `*a*`), a line break after two spaces or a backslash
is drawn as a space, and a blank line is a paragraph break. The tags whose attributes say what they draw are read
too: `font` (its `color`, its `size` 1–7 as the scale Mermaid's label measured, and its `face`);
`span style`, drawing ten properties — `color`, `background-color` (a rect behind the run, as
`mark`'s), `font-size`, `font-weight`, `font-style`, `font-family`, `text-decoration`,
`letter-spacing`, `word-spacing` and `opacity`, a `color` or `background-color` only when it is
written in CSS color syntax (a named color, a hex color, a color function or a `var(--…)`; anything
else, such as `banana`, is dropped as the browser drops it) — and **warning** about any other, naming it, the one
thing in a label Siren warns about rather than drawing or refusing; and `a href`, drawn as an SVG
`<a href>` around its run, underlined and painted with the `--siren-label-link` token, for exactly
the hrefs DOMPurify keeps (an `<a>` whose href it strips is plain text). An author's value that
could fetch, run script or smuggle a second declaration is dropped silently, under the same rule as
`style` statements. The 20 tags with no rendering of their own (`abbr`, `time`, `wbr` and the rest)
draw only their text; `html`, `head` and `body`, and a table's nine parts (`tr`, `td`, `col` and the
rest) outside a table, are ignored by the parser and their text kept; and a tag outside the
vocabulary is dropped and its text kept, as DOMPurify drops it — except `script`, `style`,
`iframe`, `noscript`, `noembed`, `xmp` and `noframes`, and the eight DOMPurify keeps and the
browser does not show (`title`, `template`, a closed `dialog`, `datalist`, `rp`, and the void
`source`, `track` and `area`), removed together with their content, and `plaintext`, removed with
everything after it. The 21 **refused** tags — `table`, `ruby` and `rt`, the 16 embedded, form,
media and interactive ones, and `svg` and `math`, which DOMPurify's SVG and MathML profiles keep —
and an open `dialog` are an error-severity diagnostic at the label's first one, saying what kind of
HTML SVG text does not draw; `<img>`'s asks for the image to be described in the label's text.
One per label, because the first already refuses the document. The 34 **block** tags (`p`, `div`,
`h1`–`h6`, `pre`, `ul`, `ol`, `li`, `hr`, `marquee` and the rest) are the one approximation: each
begins and ends a row, block edges that meet end it once (no empty row between blocks or at either
end of the label), a block keeps its font (a heading bold and sized, `pre` monospace with its spaces
kept, `address` italic), and a list item's row begins with its **marker** — `• `, `◦ ` or `▪ ` by
how many lists its bulleted list is nested in, or its number in an `ol`, counted from the list's
`start` and an item's `value` — while margins, indents, `hr`'s rule and `marquee`'s motion are not
drawn. They nest and close as the HTML parser closes them, inside the `<p>` Mermaid wraps every
label in. **Entity codes** — Mermaid's `#name;` and `#NN;` —
resolve in both dialects as the HTML character references `&name;` and `&#NN;` Mermaid turns them
into: every name the HTML standard defines (`#copy;` is `©`), an unknown one drawn as the reference
(`#foo;` draws `&foo;`); the `html` dialect also resolves references the author wrote as HTML
(`&lt;`). Each tag has its row in the compatibility corpus (`src/compat/labelCorpus.ts`).

One module owns all of it, `packages/core/src/label/`: `readLabel` reads the source into a `Label`
and reports **problems** at character offsets, which the parser turns into diagnostics at the
author's own line and column (an error refuses the document, as an unrecognized line does);
`layoutLabel` measures it into a `LabelBox` — a row as tall as its tallest run, the label its rows
stacked, an author's px size measured against the 14px base, a run's letter- and word-spacing
counted into its width, a bold run at the regular weight and a monospace run in the regular font (a
deliberate simplification, not a gap); `drawLabel`
draws it at the box's centre. A label layout has measured and placed is a **placed label**
(`PlacedLabel`): the label, its `labelBox`, and the `anchor` `drawLabel` centres it on, which exist
together or not at all — an edge's, a message's, a block condition's and a frame title's `label` is
one, and a `null` one means nothing is drawn there.
A label of one row holding one plain run — nearly every label — is
drawn as the `<text>`'s own `textContent`, exactly as before labels had rows; anything else is one
`<tspan class="siren-label-row">` per row with one `<tspan>` per run inside it, which is the
structure Mermaid's own SVG labels use. What a run paints *behind* its text comes back separately,
and the renderer puts it before the `<text>`, since document order is paint order.
_Avoid_: text, caption, string (for the read label — say "flattened text" for the string); line (for
a drawn row — a Markdown string's plain *line* break is one way to start a row, `<br>` is another)

**Wrap**:
Breaking a **label**'s rows into more rows so that none is wider than the label's **wrap width**,
as Mermaid wraps its HTML labels (nook decisions `01M4R4WDZ` and `01M4R7HBG`). The wrap width is
Mermaid's 200px scaled by the size Siren draws the label at over the size Mermaid draws it at,
`200 × Siren px / Mermaid px`: **175** for a flowchart node's 14px text, **150** for a connector
label's 12px (Mermaid's 16px), and **200 × 12/14 ≈ 171.43** for an ER relationship's 12px label,
which Mermaid draws at 14px. Not configurable — Mermaid's `flowchart.wrappingWidth` is not
read. A row that fits is left as written; each row the author wrote (a `<br>` still ends one) is
wrapped on its own. A row breaks after a space, which is not drawn, and between two characters
either of which is CJK, but never before closing punctuation (`，。、；：？！」』）】》,.;:?!)]}`); a piece
that cannot be broken and is wider than the wrap width stands on its own row and overflows it. The
wrap width bounds the **text** alone, as Mermaid's fixed-width `<div>` does: the measurer's padding
is outside it, so once a label wraps its box is the wrap width plus that padding — or as wide as an
overflowing row — and its runs keep their properties across the breaks. `wrapLabel` in
`packages/core/src/label/` does it; `wrapNodeLabel` beside it wraps a 14px label at 175, and
`wrapConnectorLabel` a connector label at 150 with the 12px measurer and line spacing, and
`wrapErRelationshipLabel` an ER relationship's label the same way at 171.43; the caller decides
which labels wrap. Wrapped: a flowchart node's label and a flowchart edge's label; a
state's description, a state diagram's note (at 175) and a transition label (at 150); a class
**relationship**'s label (at 150) and an ER **relationship**'s label (at 171.43). Never wrapped: a subgraph's
title, a composite state's title, a class name, a class member, a class diagram's note, an ER
entity name, an ER attribute's comment, anything in a sequence diagram, including its notes (Mermaid wraps none of them).
_Avoid_: word wrap, line wrap, auto-wrap (say "wrap"); line (for a wrapped row — it is a row)

**Edge**:
A directed connector between two flowchart nodes, written `A --> B`. Its id is `${from}-${to}`,
then `#2` for a repeat pair — the convention a class diagram's **relationship** copies verbatim.

**An edge may carry an id of its own**, written before its arrow — `A e1@--> B` — and then that is
its id, in place of `${from}-${to}`: it is what `data-siren-id` wears and what a `timeline:` names.
A pair's repeats are still counted across every edge between it, named or not, so `A e1@--> B`
then `A --> B` is `e1` and `A-B#2`: naming one edge never renumbers another (Mermaid 12.2.0 counts
the same way, measured). An edge id is spelled in a node id's alphabet and names exactly one thing,
so one that a node or another edge already holds, one on an arrow joining a group, and one outside
that alphabet are refused. `e1@{ … }` written below the edge is the edge's data, not a node's:
`animate`/`animation` march its dashes (a drawing of its own, independent of the timeline, stopped
under `prefers-reduced-motion`), and `curve` picks its **Curve** on the terms `linkStyle … interpolate`
does, the later of the two winning. `class e1 c` paints the edge with a `classDef`, beneath any
`linkStyle`. Two class statements stay refused, each a picture Siren cannot draw the way Mermaid
does: a class that would animate the edge (Mermaid runs keyframes of its own stylesheet, which
Siren's does not carry — write `e1@{ animate: true }`), and a `class e1 c` written above its
edge (Mermaid applies it to nothing, while Siren styles a whole document at once). A timeline's
enter and exit effects on an animated edge run beside its march, never in place of it.
Two ids the author did not write can still meet — the node `A-B` and the edge `A --> B` — and a
document like that is drawn; only a `timeline:` action naming such a shared id is refused, since it
cannot say which of the two it means (nook `01M51XADJK`).

**The token joining the two endpoints decomposes into three axes rather than naming one of
seventeen arrows** — the third time this codebase has made that call, after a sequence
**message**'s `{ line, head }` and a **relationship**'s `fromEnd`/`toEnd`. A **line**
(`solid` `--`, `thick` `==`, `dotted` `-.-`, whose opening dash is decoration so `.-` is the same
body, and `invisible` `~~~`), an **end** on each side (`none`, `arrow` `>`, `circle` `o`, `cross` `x`), and a **length**.
So `A <-.-> B` is not an eighteenth arrow: it is a dotted line with an arrow at each end. A single
end marker always lands on the *to*-end, measured; only the doubled spellings `<-->`, `o--o` and
`x--x` decorate the from-end. All four fields are required on `GraphEdge`, so a plain arrow is one
state rather than the absence of one — the rule `GraphNode.shape` already follows.

**An invisible edge, `A ~~~ B`, is drawn with the fourth line**, `invisible`: it is laid out and
drawn as a path like any edge, but themed with no width and given no end marker, so only its label
shows. It is still an edge in every other sense — it has an id, a timeline can name it, and
`linkStyle` counts it and can paint it visible. A `highlight … outline` leaves it invisible: an
author shows one with `linkStyle`, never with a timeline step.

**The length is the axis that is not about drawing.** `A ----> B` counts its dashes and reaches
layout as `minLength`, so its target sits three ranks away instead of one and the drawn diagram
differs. Drawing every length alike would be a silent mis-render by the **compatibility corpus**'s
own definition, and refusing long arrows would break the absolute condition, so honoring it is the
only option those two policies leave. **It is also a measured divergence from Mermaid 12**:
mermaid 12.2.0 still computes the length but hands it to ELK, which reads no such option, so it
draws `A ----> B` exactly as `A --> B`, with no diagnostic (measured in headless Chrome: identical
coordinates). Siren's ELK core holds the ends apart with a chain of invisible points, one per extra
rank (`chainOf`; decision `01M4VA6MS4MCTFFJJWEZR453YS`).

**An edge carries a label**, in two spellings that parse to *identical* documents — `A -->|yes| B`
and `A -- yes --> B`, plus the dotted stroke's `A -. yes .-> B` — with nothing downstream
recording which was written, exactly as nothing records `graph` versus `flowchart`. It is `null`
and never `""` when there is none: mermaid 11.17.2 rejects `A -->|| B`, so "labelled with nothing"
is not a state an author can reach. Layout reserves space for it, which makes the label the
one part of an edge that changes *where the line goes* as well as what is drawn on it. The space
is reserved **on the line**, centred on a point the route passes through — for a flowchart, ELK's
inline `CENTER` edge label, as Mermaid 12.2.0 hands it over (measured: "yes" centred on the line,
the gap between the boxes grown from 40 to 101); measured at the 12px the label is drawn at, not the node's 14px; class
relationships, state transitions and ER relationships place theirs the same way (an ER
relationship's measured too: Mermaid 12.2.0 centres each on its route, a self-relationship's
beside its loop, and Siren's land at the same fractions along the same routes). In the markup the
label is a `<text class="siren-edge-label">` drawn as a sibling of the path rather than inside a
wrapping group, wearing the same `data-siren-id`, so one timeline target moves two elements
([ADR-0009](docs/adr/0009-a-timeline-target-is-an-id-not-an-element.md)).
`linkStyle`'s two halves therefore land on two elements: `stroke` paints the line and the
arrowhead minted for that colour, and `color` paints the label. The second half was **measured,
not chosen** — Mermaid writes `fill` onto the label's own `<text>` — so dropping it, which is what
happened while an edge had no text, was a silent mis-render.

The line style is emitted as a **CSS class** (`siren-edge-dotted`, `siren-edge-thick`,
`siren-edge-invisible`) and never
as an inline declaration, on the single `<path>` an edge is drawn as. Inline, it would have
outranked the theme, an author's `linkStyle` and a `timeline:` block's `highlight X outline`
alike — on the one element all three already land on.
_Avoid_: link, arrow (say "arrow" for the drawn line and its ends, or "arrow token" for the
spelling that wrote them — never for the edge itself, the same split **message** makes),
connector, relationship (class-diagram vocabulary), message (sequence vocabulary)

**Curve**:
How a connector's routed points are joined into the line that is drawn: `basis` (a smooth spline),
`linear`, `step`, `stepBefore`, `stepAfter` or `rounded` (corners cut back and rounded with a
radius of 5). It changes how a route looks, never where the route goes. **A flowchart edge is drawn
`rounded` by default**, as Mermaid 12 draws every edge its default ELK layout routed (mermaid
12.2.0's `applyElkEdgeLayout` sets it, and `generateRoundedPath(points, 5)` draws it); so is a
class diagram's **relationship** and the connector from its note to its class, and a state
diagram's **transition** and the connector from a state to its note, and an **ER relationship**,
which have no `interpolate` to choose another. A flowchart author picks another
with `linkStyle default interpolate <curve>` or `linkStyle <n> interpolate <curve>` (declarations
may follow on the same line); a numbered statement's curve beats `default`'s whichever is written
first. **The curve written is applied to ELK's orthogonal points**, which is looser than Mermaid
12 — it ignores `interpolate` under ELK — and is rule 6 of nook decision `01M4VANRC6B2C14NHVC2KRZ9Y8`: `linear` draws
sharp corners, `basis` soft ones, and the `step` curves lie on top of a route that is already a
staircase (they differ from `linear` in the turn points their `d` carries, not in the picture).
The seven other curves Mermaid draws (`cardinal`, `bumpX`, `bumpY`, `catmullRom`, `monotoneX`,
`monotoneY`, `natural`) are rejected as not implemented, and the edge keeps its fallback curve
(`default`'s, or `rounded`); a name Mermaid does not know either is drawn `rounded`, as Mermaid 12
draws it (measured), with a warning. Every curve starts on the route's first point and ends on its
last, arriving along the route's last segment, so an arrowhead points the same way under any of
them. The curves are d3's (`curveBasis`, `curveLinear`, `curveStep`, `curveStepBefore`,
`curveStepAfter`) and Mermaid's own `rounded`. The `step` curves draw a staircase even between two
points; the rest draw two points as one straight segment. Because a curve's `d` holds control
points rather than the route, a connector's `<path>` also carries the route itself as
`data-siren-points`.
_Avoid_: interpolation (`interpolate` survives only as the authored keyword), line (that is the
**edge**'s solid/thick/dotted axis), routing (that decides where the points are, which a curve does
not)

**Line hop**:
The small half circle a flowchart edge's, a class relationship's, a state transition's or an ER
relationship's line draws
where another line crosses it, so a
crossing reads differently from two lines meeting at a bend — Mermaid 12's line jumps, drawn by
default under its ELK layout and here by the same rule (nook decision `01M4VANRC6B2C14NHVC2KRZ9Y8`,
rule 7). The hop sits on the horizontal one of the two segments (on the later edge, in edge order,
where neither is horizontal), radius 6, centred on the crossing. Its sweep follows the way the
line runs (`A6,6 0 0 1` travelling right or down, `0 0 0` travelling left or up), so on a
horizontal line it bulges up whichever way the line runs, and on a vertical one to the right. Lines
that only meet — one ending on another, two sharing an end — do not hop. No hop sits inside a rounded corner of either
line; near a corner (or a route's end) the radius shrinks to 2 short of it and a hop under 3.6 is
not drawn; two hops that would overlap shrink to half the gap between them. The layout reports the
hops with each route (`hops`), because which line hops depends on both; the **curve** decides
whether they are drawn: `linear`, `rounded` and the `step` curves draw them, `basis` does not. A
hop is drawing, not route: `data-siren-points` never holds its points. Note connectors in a class
or state diagram hop too.
_Avoid_: line jump (Mermaid's code name), bridge, crossover

**Subgraph**:
A `subgraph Title ... end` block in a flowchart, drawn as a titled frame around the nodes declared
inside it and laid out as an ELK compound node: the engine sizes the frame around its members, its
24px padding and a band across its top for the title, and nothing after the engine moves it.
Flowchart nodes likewise double only their original positive text padding, retaining the original
label geometry and wrap width; other diagram kinds keep their existing padding. The **fourth** grouping construct here,
and the second spatial one in a graph-shaped diagram after a class diagram's **namespace** — a
sequence diagram's **box grouping** bands participant lanes and its **control-flow block** wraps
statements in time. Both nest — `ResolvedSubgraph` and `ResolvedClassNamespace` each carry a
`parentId`, handed to the engine as nested clusters — and both number their generated ids outer
first: a subgraph where its block opens, a namespace where it first opens, since the blocks of a
namespace opened again under the same qualified name merge into one. Four things separate it from
the namespace it most resembles, and none of them is cosmetic:

- **Membership lives on the node**, as `GraphNode.parentId`, in one place — so a node and the
  frame around it cannot disagree about which holds it. A namespace keeps a `classIds` list beside
  the classes and has to promise the two agree.
- **A node is claimed by the first block that names it**, measured, so naming it again from
  another block joins it rather than moving it. A class is a member of the namespace it was
  written in.
- **It lays out in a rank direction of its own — only while no boundary-crossing edge voids it.**
  `direction LR` written inside a block turns that block alone into a row while the document keeps
  the header's direction — the block is laid out in an ELK pass of its own, in its own direction.
  A **Boundary-crossing edge** voids it, and the block is laid out in its parent's pass and
  direction — Mermaid 12's rule. A block that declares no direction inside one that keeps its own
  is laid out in that enclosing block's direction (measured, Mermaid 12.2.0: `Outer` `LR` holding
  `Inner` with none draws `Inner`'s `A --> B` as a row; Mermaid 11 used the document's). A
  namespace has no such statement.
- **An edge may name one at either end.** `one --> two` joins the two *frames*, not two boxes —
  so an endpoint that names a block declares no node of that name, while a node the author
  declared in their own right (`A[Alpha]` beside `subgraph A`) keeps its box. ELK routes such an
  edge to the frame itself, as it does for Mermaid 12.2.0 (measured: `one --> two` runs from one
  frame's bottom edge to the other's top edge), and a block naming *itself* at both ends
  (`one --> one`) is a loop off the frame's own side, which `fc-subgraph-self-edge` asserts. (On
  dagre this took a stand-in member, a clip back to the frame, and a synthesised loop.)

**Its order, as the engine sees it, is Mermaid's.** ELK keeps the order it is handed
(`considerModelOrder`), so the order is part of the picture: subgraphs go first, in the reverse of
the order their `end`s closed them, then nodes — mermaid 12.2.0's `FlowDB.getData`, measured: a
document writing `subgraph SA … end`, `subgraph SB … end` and a node `X`, in either order, draws
SB, SA, X from left to right (`mermaidGroupOrder` in `layoutGraph.ts`).

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
cluster (that is the engine-side word the layout cores use for the mechanism, the same way
**namespace**'s entry reserves it — the ELK core's input field is `cluster`, and what it hands back
for one is its frame), namespace (that is the class-diagram construct), group, box
(overloaded three ways already — see **Box grouping**), container, frame (that is the drawn
`<rect>`, one of the two elements a subgraph is drawn with)

**Boundary-crossing edge**:
A connector that makes a group give up the **direction** it declared. Which connectors count
depends on the layout engine Mermaid uses for that kind, and Siren follows each:

- **A flowchart subgraph (ELK, Mermaid 12).** A connector whose two ends have *different parents*
  voids every group on the way up from each end to the two ends' nearest common group — the end
  itself when it is a group, and that common group too — so each falls back into its parent's
  layout pass and direction. Mermaid 12.2.0's `configureCrossHierarchyEdges`, ported as
  `voidedDirections` and measured in headless Chrome on a TB document with `subgraph one` declaring
  `direction LR` around `A --> B`: `C --> A` from outside voids it; `C --> one` from beside it does
  not (both ends share a parent); `B --> one`, a member to its own group, voids it. **And one case
  the rule below does not have:** `O` with `direction LR` holding a group `I` (holding `A`) and `B`,
  with `A --> B` — nothing leaves `O`, yet `A` and `B` have different parents and their common
  group is `O`, so `O` gives up `LR` and Mermaid stacks them.
- **A composite state (ELK, Mermaid 12).** The flowchart's rule, unchanged: a transition whose
  ends have different parents voids every composite (or concurrent region) on the way up to their
  nearest common one. Measured in headless Chrome against Mermaid 12.2.0: `X --> A` into a member of
  `state C { direction LR  A --> B }` stacks A above B; `X --> C` and `C --> C` keep the row. A
  **note**'s connector never voids one — Siren lays the note out beside its state, at its state's
  level, where Mermaid lays it out at the diagram's top level and so voids the block around the
  state, or the composite the note is written on (decision `01M4VKTJ2A1DGXAMYVF16BK2W3`).
- **An ER subgraph block (ELK, Mermaid 12).** The flowchart's rule, unchanged, through the same ELK
  adapter: a relationship whose ends have different parents voids every block on the way up to
  their nearest common one. Measured in headless Chrome against Mermaid 12.2.0: `subgraph sales {
  direction LR  CUSTOMER ||--o{ ORDER }` keeps the row with `WAREHOUSE` beside it, and adding
  `ORDER ||--|{ LINE-ITEM` from outside stacks CUSTOMER above ORDER. No relationship can name a
  block itself (see **ER subgraph**).
_Avoid_: external connection (Mermaid's internal field name), cross edge, outgoing edge (direction
does not matter: an edge into the group counts the same as one out of it)

**Participant**:
One vertical lane in a sequence diagram, declared as `participant X` (drawn as a box) or
`actor X` (drawn as a stick figure), or created implicitly, as a box labelled with its id, by the
first message, note, `activate`, `deactivate` or `link` that names it. A `destroy` is not a
mention: it creates nothing, so a participant only a `destroy` names has no lane. Lanes order left to right by
first mention, declaration or reference alike; a declaration after the first mention gives the
lane its label and kind without moving it (see
[ADR-0013](docs/adr/0013-sequence-participants-are-created-on-first-mention.md)).
_Avoid_: actor (that is one of the two shapes a participant takes, not a synonym), lane, column,
node

**Lifeline**:
The dashed vertical line running down a participant's lane, spanning the extent between where the
participant comes into existence and where it stops. A `create participant X` statement starts it
partway down instead of at the top, at its **creating message**; a `destroy X` statement ends it
early instead of at the bottom, at its **destroying message**, with X's box drawn a second time
there as its closing box — no X mark, as in Mermaid. The lifeline runs under the box at either
end, so it shows from the top box's bottom to the closing box's top. A `create` or
`destroy` with no message after it in the document has nothing to pair with and draws nothing, as
in Mermaid: the participant is drawn from the top, or to the bottom, as if it were never written,
and Siren warns about the declaration.

**Creating message**:
The message right after a `create participant X` statement; it must be sent *to* X. X's box is
drawn where that message's arrow arrives, which is where X comes into existence. A `create` whose
next message is not sent to X is refused, as Mermaid refuses it. Nothing may stand between the
two: a note, an activation, an `autonumber`, a block boundary, or another `create` or `destroy` in
between is refused too, because Mermaid then draws X as if it were never created. If nothing
destroys X, X also gets a box in the bottom row, as a declared participant does; and when anything
is drawn before its `create`, X's lane sits half its width further right than a declared one's.
With no message after the `create` at all, X is drawn as any declared participant is — box in the
top row and the bottom row — and the `create` is warned about.
_Avoid_: create message, first message (any participant has one), constructor

**Destroying message**:
The message right after a `destroy X` statement; X must send or receive it. X's lifeline ends on
that message's row, where X's closing box — its box or actor figure drawn a second time — is centred
on the arrow, whichever end X is; the arrow stops at the box's near edge, as a creating message's
does, and every row after it moves down by half the box, as after a creating message. The message
reaches X before X stops, so it is not "past" the end. X gets no box in the bottom row. A
`destroy` whose next message does not touch X is refused, as Mermaid refuses it, and so is
one with anything else in between (as for a **Creating message**), because Mermaid then draws X as
if it were never destroyed. With no message after the `destroy` at all, the `destroy` is warned
about and draws nothing: if another statement names X, X is drawn as never destroyed — lifeline to
the bottom row, no closing box — and if nothing else does, X has no lane. A later message naming X does
point past the end, and is warned about.
_Avoid_: destroy message, kill message, last message
_Avoid_: timeline (that is the animation block — a lifeline is structural; it does animate, but
under its participant's id rather than one of its own), axis

**Participant row**:
The horizontal band at the top of a sequence diagram holding every participant's box or icon, and
its mirror at the bottom. A preamble-declared, never-destroyed participant appears in both rows; a
`create`d one appears once, in the bottom row; a destroyed one appears once, in the top row, and
again as its closing box at its destroying message (one both `create`d and destroyed, in neither).
_Avoid_: header, top box (ambiguous with a box grouping)

**Message**:
One `A->>B: text` line in a sequence diagram — an arrow from one participant to another (or to
itself), carrying its text as a **Label** in the `sequence` dialect, its rows stacked upward from the
arrow, which moves down a row for each row the label adds. Its arrow style is two independent axes: a line (`solid`/`dotted`)
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
beside the bracket-wrapped condition (`loop every day` draws the word `loop` and `[every
day]`; measured against real Mermaid, which brackets a block's condition the same way whether it
sits on the header or on a divider). A condition is a **Label** in the `sequence` dialect: the
brackets open its first row and close its last (`loop every<br/>day` draws `[every` over `day]`),
and the header or divider band grows a row for each row it adds, the first row staying where a
one-row condition sits. `rect` is the exception: a filled background highlight with no frame and no
keyword; what follows `rect` is its color, carried in the block's own `color` field (its one
branch has no condition) and drawn as the fill, never as text. Addressable in a `timeline:` block under a generated id — its kind,
then a 1-based counter per kind in source order: `loop:1`, `alt:2`, `rect:1`. The colon is
load-bearing: a participant id is `\w+`, so no message id (`${from}-${to}`) can ever spell one of
these.
_Avoid_: block (alone — too vague), group, section, box

**Box grouping**:
A `box <color> <label> ... end` region wrapping participant declarations, drawn as a colored
background band behind those lanes for the diagram's full height, its label a **Label** in the
`sequence` dialect drawn across the band's top, above the participant row, which starts lower by
the tallest box label's every row. Distinct from a control-flow
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
`Registry` and draws as `Registry<T>`. It may carry a bracketed `["label"]` after the name and any
generic (`class Order["Order<br/>Line"]`, also on the block form), drawn in place of the name and
generic; the label is a **Label** in the `html` dialect, and the name stays the id. A second
declaration of the same name merges members rather than erroring (a later, different label
replaces the earlier one silently, as Mermaid draws it). May carry one **annotation** (`<<interface>>`, `<<abstract>>`, or any
author-chosen text), drawn in guillemets above the name — an annotation labels the class it
is written in, unlike a note, which is a box of its own. A class keeps the generic its first naming
gave it (none, if that naming wrote none) and the first annotation written; a different one written
later is refused, as Mermaid drops it without a word. A `<br>` in the generic draws a line break.
_Avoid_: CSS class (the codebase is full of `siren-*` CSS classes and of these boxes — say
"class" only for the box, and "CSS class" for the other; the `classDef`/`cssClass` directives
name the CSS-ish sense, not this one, and so does a flowchart's apply-directive, which Mermaid
spells `class A,B name` — that statement is about styling a **node** and never about one of these
boxes, so say "the apply-directive" for it), node, entity, box

**Member**:
One attribute or method line inside a class, carrying an optional visibility marker (`+` public,
`-` private, `#` protected, `~` package), an optional classifier (`*` abstract, `$` static), a
name, an optional type, and — for methods — a parameter list and an optional return type.
The classifier is drawn as a style on the whole line — `*` italic, `$` underlined — never as a
character of it; an attribute's is its last character, a method's stands right after its `)` or
last.
Drawn as the author spelled it, its entity codes and character references decoded (`+#lt; x` draws
`+< x`, `+&lt x` too): a member is **not** a Label, because Mermaid escapes its `<` and `>` in both
label modes, so no tag in it is read — the one change made first, as Mermaid makes it, is
respelling `<br/>`, `<br />` and `<BR>` as `<br>`, which is then drawn as those four characters. A
method's return type is drawn after ` : ` (`+swim() bool` draws `+swim() : bool`), as Mermaid
draws it. A `#` opening an entity code is the code's, not the protected marker (`#lt; x` has no
visibility). Attributes and methods draw in two separate
compartments, in declaration order within each, with a divider above every populated one; a
member written twice, in one declaration or across several, is drawn twice. A space written
after the visibility marker is drawn as one (`+ x`), and a line that draws no text (`$`) takes no
height; a compartment of nothing but such lines is no compartment, so a class whose only members
are `$` or `*` is drawn like one with none, no divider at all — a known departure: Mermaid draws
every class with both dividers, and that one 12px shorter than an empty class.
_Avoid_: field, property (that is a CSS declaration's property in an author style), attribute
(alone — that is one of the two kinds of member, and it is also an SVG attribute; say "attribute
member" when the kind matters)

**Relationship**:
A directed edge between two classes, carrying one of Mermaid's nine types, an optional `: label`
— a **Label** in the `html` dialect — and optional multiplicity strings at each end. Its id follows the flowchart edge convention
exactly: `${fromId}-${toId}`, then `#2` for a repeat pair. The type is modeled as two axes — a
`line` (`solid` | `dashed`) and an endpoint marker at each end (`none` | `triangle` |
`diamondFilled` | `diamondHollow` | `arrow` | `circle`) — whose named compositions are
`inheritance`, `composition`, `aggregation`, `association`, `link`, `dependency`, `realization`,
`dashedLink` and `lollipop`, reported as `data-siren-relationship`.

A multiplicity is placed by the layout engine, as Mermaid 12 places it: handed to ELK as a label at
its own end (the from end's on the right hand of the line as it travels, the to end's on the left),
with 6px more room where that end draws a marker, then moved off any frame, line or box it lands on
and onto its own hand of the line where that is clear (decision `01M4VHSY2W1Q9E5QCA51F1TCJM`).

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
A named group of classes drawn as an enclosing frame behind the boxes it holds, laid out as an ELK
compound node, as a **subgraph** is: the engine sizes the frame around its members, its 12px padding
and a band across its top for the title, and nothing after the engine moves it but the title, along
its band, off any route or multiplicity that would run through it. Namespaces are handed to the
engine before every class, so they come first in the picture — mermaid 12.2.0's
`ClassDB.getData`, measured: `class X` written before `namespace N1 { P }` and `namespace N2 { Q }`
draws N1, N2, X from left to right. The third grouping construct in the codebase and the first spatial
one in a graph-shaped diagram — a sequence diagram's **box grouping** bands participant lanes, and
its **control-flow block** wraps statements in time. A flowchart's **subgraph** is the fourth and
draws the same figure deliberately, so a theme or an author who has learned to read one need not
learn a second vocabulary; that entry lists the four things that are nevertheless not the same.
It nests, as a subgraph does: a namespace written inside another is framed inside it, and the
outer frame is drawn even when it holds no class of its own (`ResolvedClassNamespace.parentId`). A
namespace is known by its **qualified name** — the enclosing namespace's qualified name, a `.`,
then its own — so the `M` written inside `N` is `N.M`, a different namespace from a top-level `M`
(nook decision `01M51B4M3C`); its frame is still titled `M`. A namespace opened again under the same
qualified name is the same namespace: its blocks merge into one frame holding all their classes. A
dotted name is the same nesting on one line: `namespace N.M {` is the `M` inside `N`, creating an
`N` titled `N` if no block opens one and merging with one that does. A note written in a namespace
is that namespace's (`ResolvedClassNamespace.noteIds`) and drawn inside its frame, so a namespace
holding only a note is framed too. A namespace body holds class declarations, notes, nested
namespaces and comments, and nothing else: a relationship, a `style`, an inline member or any other
statement written there is refused, to be moved outside the namespace. A namespace may carry a
bracketed `["label"]` after its name (`namespace Zoo["Big Zoo"] {`), drawn as the frame's title in
place of the name — a **Label** in the `html` dialect; of a reopened namespace's labels, the last
one written wins, and a dotted name's label titles its last part only. Addressable in a
`timeline:` block under a generated id (`namespace:1`, `namespace:2`, … in the order the
namespaces first open, outer before inner).
_Avoid_: package, module, cluster (that is the word the layout core uses for the mechanism, not
the authored construct), group, box

**Note**:
A free-standing annotation box, in either of the two diagram kinds that have one — a class
diagram's, either attached to one class (`note for Shelf "..."`, drawn with a connector to that
class's box) or standing alone (`note "..."`) — a `note for` naming no class of the diagram stands
alone too, with a warning, since naming a class there does not declare it — its quoted text a
**Label** in the `html` dialect; a sequence diagram's `note over A,B`/`note right of A`/
`note left of A`, its text a **Label** in the `sequence` dialect and the note as tall as all its
rows, modeled as one statement with a `left`/`right`/`over` placement axis (the same two/one-axis
pattern as `SequenceArrow`/`ClassRelationshipEnd`) rather than three statement kinds, and drawn
with the class diagram's own `siren-note`/`siren-note-frame`/`siren-note-text` classes —
deliberately reused rather than duplicated, since it is the same idea (a boxed annotation) in both
kinds. The two differ in layout: a class diagram's note is laid out as an
ordinary graph node, so the layout engine itself guarantees it never overlaps a class box, at the
cost of occupying a rank — joined from the note to its class, as Mermaid 12 joins it, so an attached
note sits a layer before the class it is about, and one written inside a **namespace** is laid out
inside that namespace's frame, the innermost one around it, a `note for` a class outside the frame
included; a sequence diagram's note occupies its own rank on the timeline the same way a message
does (measured against real Mermaid: it never overlaps the message before or after it) and draws no
connector at all, unlike the class diagram's attached form. Addressable in a `timeline:` block under
a generated id in both kinds (`note:1`, `note:2`, … in source order, which a dropped note does not
renumber). A state diagram's note (`note right of S : ...`) is laid out the class diagram's way, a
box joined to its state by a connector, after its state along the diagram's direction for `right of`
and before it for `left of` — at its state's own level, so inside the composite its state is written
in, where Mermaid 12 lays it out outside (decision `01M4VKTJ2A1DGXAMYVF16BK2W3`); it has no id of
its own and is drawn in its state's group.
_Avoid_: annotation (that is the `<<interface>>` marker *inside* a class — a note is a box of its
own), comment (that is a `%%` line, which is stripped before parsing and draws nothing; a line of
nothing but `%%` is not a comment in a flowchart or ER diagram and is refused, ADR-0017), label,
callout

**State**:
One box in a state diagram — the state-diagram counterpart of a flowchart **node**, a class
diagram's **class** and a sequence diagram's **participant**. Written bare (`Idle`), with Mermaid's
optional keyword (`state Idle`), or created implicitly by being named in a **transition**, exactly
as `A --> B` creates two flowchart nodes.

**Repeat mentions fold in the parser, not in the model** — the opposite of a **class**, whose second
declaration merges members there. A state carries no repeatable payload for a later stage to
reconcile: it is a name and a position, so naming it five times is one declaration, positioned where
it was first written, and the model is left with *identification* alone.

What it does carry is **descriptions**, and that is an array rather than a string because they
**accumulate**: measured (mermaid 11.17.2), `s : first` followed by `s : second` reports
`descriptions=["first","second"]`, so a second description is drawn beneath the first and is not a
correction of it. Each description is a **Label** (below), so one description may hold several rows
of its own. The two spellings — `Idle : waiting` and `state "waiting" as Idle` — are
**one construct written two ways**, and `as` is not the rename it looks like: measured, both land in
the same `descriptions` array and neither touches the id, so `Idle` is still what a transition
names. Which spelling was written is therefore recorded nowhere, the same call `graph` versus
`flowchart` gets. A described state draws its descriptions *in place of* its id, with a
`.siren-state-divider` under every row of the first description — the **title label** — once there
are two or more descriptions: the compartment line a class box already draws, and the one Mermaid
draws as `line.divider`. Descriptions, notes, transition labels and a composite's quoted title are
all Labels read in the `html` dialect, because Mermaid draws every one of them as HTML (measured).
_Avoid_: node (flowchart vocabulary), status, step (that is the timeline's word for a reveal
position), box (say "frame" for the drawn `<rect>`)

**Transition**:
A directed connector between two states, written `A --> B` with an optional `: label`. Its id is
`${from}-${to}`, then `#2` for a repeat pair — the flowchart **edge** convention used a third time
rather than invented a third time, which is what lets one timeline vocabulary address every diagram
kind. `label` is `null` and never `""`: Mermaid reports an unlabelled relation's `relationTitle` as
the empty string (measured), and Siren spells the absence the way `Edge.label` already does.
A self-transition (`A --> A`) needs no case of its own anywhere in the pipeline — it is an ordinary
ordered pair whose halves coincide, so its id is `A-A` and the loop lives in the points layout
returned. It is also a **connector** in the sense `warnOnConnectorsOutlivingTheirEndpoints` means:
animate a state out and leave the transition in, and the warning that already covers an edge, a
relationship and a message covers this too.
_Avoid_: edge (flowchart vocabulary), relationship (class-diagram vocabulary), message (sequence
vocabulary), arrow (say "arrow" for the drawn line and its head, never for the transition itself)

**Composite state**:
A `state Outer { ... }` block, drawn as a titled frame around the states written inside it and laid
out as an ELK compound node: the engine sizes the frame around its members, its 12px padding and a
band across its top for the title (moved along the band off a route crossing it), routes a
transition naming the composite to the frame itself and a self-transition (`Outer --> Outer`) as a
loop off the frame's side, and nothing after the engine moves it. The **fifth** grouping construct here and the third spatial one, after a
class diagram's **namespace** and a flowchart's **subgraph** — and it draws deliberately the same
figure as those two, so a theme or a reader who has learned one need not learn a third. Three things
are nevertheless not the same, and each is measured rather than chosen:

- **Its id is the author's own name, not a generated one.** This is the single sharpest difference
  from the **subgraph** it otherwise resembles: `subgraph:1` has to be minted because Mermaid
  accepts `subgraph "Two Words"`, a title that gives no handle at all, while `state Outer {` names
  the frame in the same `\w+` alphabet a transition names a state in. So a **transition may name a
  composite at either end** and reach the frame rather than declaring a second state beside it, and
  a `timeline:` block highlights it under the name the author wrote.
- **It is a state.** `StateKind` is one closed type covering `state`, `composite`, `start` and
  `end`, and a composite is drawn inside the same `<g class="siren-state">` wearing the same id —
  only the inner figure differs (`.siren-composite-frame`, unfilled, because a frame encloses the
  boxes drawn over it). So a state first named by a transition and *then* opened as a block has its
  kind upgraded rather than a second declaration made.
- **It opens a level of its own**, which is what makes its `[*]` its own rather than the document's
  (see **Pseudo-state**), and it lays its members out in a direction of its own — the `direction`
  its block writes, or `TB` when it writes none, whatever the document's direction or an enclosing
  block's (Mermaid 12.2.0's `DEFAULT_NESTED_DOC_DIR`, measured: `direction LR` above
  `state C { A --> B }` stacks A above B). That is where it parts from a **subgraph**, whose
  undirected block takes its enclosing block's direction. A concurrent region does the same. The
  direction holds only while the composite has no **Boundary-crossing edge**; one such transition
  and it is laid out in its parent's pass and direction. A **note** on a state inside it stays
  inside it.

Membership lives on the member, as `StateDecl.parentId`, in one place — the split the **subgraph**
entry already argues for, and here it is the only place it *could* live, because a pseudo-state has
no id for a membership list to name. **The first block to name a state keeps it** against every
later one, the rule a subgraph's members already follow. (Mermaid's own parse tree keeps a
same-named state per level and lets its renderer draw one node for them; Siren's ids are global, so
one rule decides which level that one node is drawn at.)
_Avoid_: subgraph (flowchart vocabulary), namespace (class-diagram vocabulary), cluster (the
engine-side word), superstate, group, frame (that is the drawn `<rect>`, one of the two elements a
composite is drawn with)

**Pseudo-state**:
What `[*]` spells — a **start**, drawn as a filled disc, or an **end**, drawn as a ring around one.
Which of the two it means is decided by the side of the arrow it sits on and by nothing else, so
`[*] --> Idle --> [*]` is two different marks and not one used twice.

**One pair per level, not one per occurrence** — measured, mermaid 11.17.2: two `[*] -->` lines at
one level both came back from a single `root_start`. And a **composite state** is a level of its
own: `state Outer { [*] --> Inner }` reports `Outer_start in="root/Outer"`, with the document's own
`root_start` nowhere in it.

**Its id is generated, and that generation removes a bug of Mermaid's.** `generatedId`
([ADR-0010](docs/adr/0010-generated-ids-and-connector-ids-live-in-separate-spaces.md)) spells these
`start:1` / `end:1`, numbered by the level that opened them in declaration order with the document's
own level first; a level with no `[*]` in it still takes its number, because the numbers are handles
and a gap costs nothing while renumbering would change one composite's ids because an unrelated
block lost its own. Mermaid instead names them `root_start` and `root_end` — ordinary `\w+` names an
author may also write, and it does not guard the collision. Measured: `[*] --> root_start` followed
by `root_start --> B` means three nodes and two edges, and Mermaid produces two nodes with the
relations `root_start → root_start` and `root_start → B`, the start pseudo-state swallowed by the
author's own state and its edge redirected into a self-loop nobody wrote, with no diagnostic. Every
authored id here is `\w+`, which cannot contain a colon, so the collision is not guarded against —
it is unconstructible, exactly as a **subgraph**'s generated id is.
A pseudo-state draws no label, deliberately: the only text there could be is a string the author
never wrote. Its 14px box sits on the line of the first transition at it, as Mermaid 12 moves a box
too small for ELK's port clearance onto its route (`alignDegenerateNodeToAnchor`); every other
transition at it is run back onto the moved box along its own last run, as Mermaid keeps it
touching the disc. It carries no descriptions and can carry none, since `[*]` is not an id and no
description statement can name one.
_Avoid_: initial/final state (they are not states — nothing can describe or style one), start node,
terminator, `[*]` (that is the spelling, not the thing)

**Entity**:
One box in an ER diagram — the ER counterpart of a flowchart **node**, a class diagram's **class**
and a state diagram's **state**. Declared by naming it, bare (`CUSTOMER`) or at either end of an
**ER relationship**, and a line is a stream of statements rather than one, so `CUSTOMER ORDER` is
two entities. Its name is its id and is spelled one of two ways: **bare**, in Mermaid's ER name
alphabet — letters, digits, `_`, `-`, `.`, `*` and any non-ASCII character, so `LINE-ITEM` and
`中文實體` are each one name, while `end`, `subgraph`, `class`, `style` and `classDef` are refused —
or **quoted**, `"Customer Account"`, which takes any character but a quote and keeps its spaces.
Quoting changes the id itself and is not an alias. Named again, it is still one entity, kept where it
was first named, and the attributes of every block it opens join in order.

It may carry an **alias**, `CUSTOMER["Customer Account"]` or bracketless `CUSTOMER[Account]`,
drawn in place of the name while the name stays the id — so `data-siren-id` and a `timeline:`
entry still say `CUSTOMER`. The alias is a **Label** in the `html` dialect; the bracketless
spelling holds exactly one name, so it can carry no tag. The first alias written wins, and a later
mention without one does not clear it. An entity with no alias draws its name as written, never
read for tags. Unlike a state's `state "text" as s`, an alias replaces the drawn name rather than
adding a description under it.
_Avoid_: table, node (flowchart vocabulary), class (class-diagram vocabulary), box (say "frame" for
the drawn `<rect>`), entity code (that is a label's `#name;` character reference — see **Label** —
and never one of these boxes), label (for the alias)

**Entity attribute**:
One row in an entity's `{ ... }` block — `type name`, then optional keys, then an optional comment,
in that order (`string code PK,FK "the code"`). One line may hold several, and the braces belong to
the line's stream rather than standing on lines of their own: `E { string a }` is the same entity
as the three-line spelling. The **type** and the **name** are literal: never Labels, drawn exactly
as written, in a third alphabet of their own — a word that may not begin with a digit, carries
`()`, `[]` and `,` (`string(99)`, `int[]`), keeps a `~generic~` with its tildes (a class diagram's
generic is redrawn in angle brackets; this one is not), and may be backticked
(`` `odd name` ``) to hold any character, the backticks not drawn. The **keys** are `PK`, `FK` and
`UK`, any case, comma-separated and kept as written, repeats included. The **comment** is the
quoted string last on the row, and a **Label** in the `html` dialect. An entity's table draws the
type and name columns always, and its keys and comment columns only when some row of it wrote
one. An entity attribute has no id: it is not addressable in a `timeline:` block, and animates with
the entity that owns it.
_Avoid_: attribute (alone — it is also an SVG attribute and one of a class **member**'s two kinds),
member (class-diagram vocabulary), field, column (that is the drawn table's), property (that is a
CSS declaration's)

**ER relationship**:
A connector between two entities, written `CUSTOMER ||--o{ ORDER : places` — a cardinality at each
end, a line between them, and a label. Both endpoints are declared by being named, and both join
the ER subgraph it is written in.

- **Cardinality** — how many of the entity at that end take part, one of four, chosen at each end
  independently: `onlyOne` (`||`), `zeroOrOne` (`|o`/`o|`), `oneOrMore` (`}|`/`|{`) and
  `zeroOrMore` (`}o`/`o{`), each also spelled in words or digits (`one`, `zero or one`, `one or more`,
  `zero or many`, `1+`, …) that mix freely with the punctuation. Drawn as a crow's-foot marker
  against the entity it is written next to: the glyph touching the box says one or many, the one
  beyond it mandatory or optional. The marker lies along the route's first or last run, turned
  with it — the line is drawn `rounded` (**Curve**), which leaves every route's ends straight — as
  Mermaid 12.2.0's do (measured in headless Chrome: on the ER parity fixtures each end leaves its
  box along the same axis on both sides, a self-relationship's sideways). Each glyph sits where
  Mermaid 12.2.0's marker puts it: a bar or circle outside the box, and the "many" almond centred
  on the box's edge, its inner half hidden under the entity, which is painted after every line
  (nook decision `01M4W687VYADT35JXWTPSCBQ9G`). Layout keeps each end of the route straight, past
  its rounded corner, for as far as its marker reaches (15px for `onlyOne`, 27 `zeroOrOne`, 24
  `oneOrMore`, 34 `zeroOrMore`), so a marker never runs past the bend — where Mermaid's do, its
  runs being as short as 6px of straight line against markers reaching 34px (nook decision
  `01M4VP6AVMYHJ9HDE0KST32ATA`). Mermaid's fifth, `u`, is
  refused by name — Mermaid draws no figure for it either.
- **Identifying** or **non-identifying** — the line: `--` or `to` draws it solid, `..`, `.-`, `-.`
  or `optionally to` dashed.
- **Label** — required: there is no unlabelled ER relationship. One word or one quoted string —
  `: two words` labels it `two` and declares a third entity, `words`. A **Label** in the `html`
  dialect.

Its id is `${from}:${to}`, then `#2` for a repeat pair — a colon where every other kind's connector
uses a hyphen, because an ER name may itself contain one. A quoted name can still spell any id, so
two drawn elements sharing one are warned about rather than ruled out. Addressable in a `timeline:`
block; no author style can reach it.
_Avoid_: relationship (alone — that is the class diagram's connector, see **Relationship**), edge
(flowchart vocabulary), transition, association, multiplicity (that is a class relationship's
end string — say "cardinality"), dashed/solid as the axis's name (say "identifying" — they are how
it is drawn)

**ER subgraph**:
A `subgraph sales ... end` block in an ER diagram, drawn as a titled frame around the entities named
inside it — relationship endpoints included — and laid out as an ELK compound node, as a flowchart
**subgraph** is (the engine sizes the frame around its members, its 12px padding and a band for
its title, which it moves along the band off a route that crosses it; nothing after the engine
moves it): the **sixth**
grouping construct here, drawing deliberately the same figure as a flowchart's **subgraph**, a
**namespace** and a **composite state**. Its **name** is mandatory and is an entity name in either
spelling (`subgraph "My Cluster"`; `subgraph My Cluster` unquoted is refused). The header owns its
line, while `end` is an ordinary statement — `A end` declares `A` and then closes the block.

Its **title** is optional and bracketed: `sales["Sales Team"]` or `sales[Sales Team]`, drawn on the
frame in place of the name, every run of spaces drawn as one. **Quoted, the title is a Label in the
`html` dialect. Unquoted, it is words in the entity-name alphabet and nothing else**, so it can carry
no tag: a title with any other character — `subgraph s1[My<br/>Title]` — is refused at the title, as
Mermaid refuses it, and quoting it is the way to write a label. A block with no title draws its name
as written, never read for tags.

It nests and may carry its own `direction`, both as a flowchart's subgraph does, and the
**Boundary-crossing edge** rule and the handover order are the flowchart's too — Mermaid 12.2.0's
`ErDB.getData` lists every block before any entity, the blocks in the reverse of the order their
`end`s closed them (measured: `subgraph SA { A }`, `subgraph SB { B }`, `X` draws SB, SA, X from
left to right; `subgraph O { subgraph I1 { A }, subgraph I2 { B }, C }` draws C, I2, I1 inside O),
then the entities in the order they were first named. A block that declares no direction inside
one that keeps its own is laid out in that enclosing block's (`er-subgraph-nested`). Three things
are not the same as a flowchart's subgraph, each measured:

- **A name claimed by two blocks belongs to the innermost one**, because Mermaid settles membership
  as each block closes — not to the first that named it.
- **Its name is not unique**, since two blocks may share one, so its id is generated
  (`subgraph:1`, `subgraph:2`, … in the order the keywords open) and that is what a `timeline:`
  entry addresses.
- **Nothing may share its name.** An entity named like a block — bare, or as a relationship's
  endpoint — is refused by name, since Mermaid draws no box for it, and so no relationship can end
  on the frame. A `style` or `class` naming a block already closed is refused too: Mermaid paints
  the frame, and painting one is unimplemented.
_Avoid_: subgraph (alone — that is the flowchart's, see **Subgraph**), cluster (the layout core's
word for the mechanism), namespace (class-diagram vocabulary), composite state (state-diagram vocabulary), group,
frame (that is the drawn `<rect>`)

**Author style**:
A styling declaration written in the document, emitted as an inline `style` attribute on the
element it is about. A **local override within one document**, as opposed to a **design token**,
which is the global default for every diagram — the two do not compete, see
[ADR-0008](docs/adr/0008-author-styling-sits-alongside-the-token-theme.md). A flowchart accepts
four directives: `style A fill:#fdd` straight onto one node, `classDef name ...` defining a named
set that applies to nothing on its own, the apply-directive that applies one such set to a list of
targets, and `linkStyle` — the only one that reaches an **edge**. A class diagram accepts the
first three. An ER diagram accepts the first three too, and they reach an **entity** and nothing
else: an **ER relationship** cannot be styled at all, as in Mermaid, and an **ER subgraph** named
after its block has closed is refused, since Mermaid paints that frame and Siren does not yet. Nor
does an ER `classDef default` stand: in Mermaid every ER entity wears that class implicitly, and
here none does, so it is refused rather than applied to nothing. A sequence diagram accepts none,
deliberately: Mermaid has no `style` there, so adding one would be Siren invention rather than
compatibility.
The apply-directive has two authored spellings and is **one directive**: Mermaid writes
`class A,B name` in a flowchart and an ER diagram and `cssClass "A,B" name` in a class diagram,
plus the shorthand `A:::name` — in a flowchart standalone or on either endpoint of an edge line,
in an ER diagram on an entity's own declaration, after any alias and before any `{`. All three
normalize at the parser to one `apply` kind, so nothing downstream branches on which was written — the same
rule that turns `TD` into `TB`. The authored spelling survives only as `authoredAs`, so that a
diagnostic can quote the keyword the author actually typed and nothing else can act on it.
**`linkStyle` addresses an edge by declaration index; everything downstream uses the edge id.**
`linkStyle 0`, `linkStyle 0,2` and `linkStyle default` are what an author writes, and the model
resolves each index to the edge id `A-B` that `timeline:` and `data-siren-id` already use, so an
index never reaches a renderer. `default` is a **fallback tier**, not another declaration: it
covers every edge no specific `linkStyle` named, a specific one wins for the edge it names
whichever order the two were written in, and the two merge property by property rather than one
replacing the other.
`color` reaches label text, in every kind that styles — in an ER diagram, an entity's name and
every cell of its attribute table — the author's spelling, translated once in the
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

**Comment**:
A whole line whose first non-blank characters are `%%` followed by at least one more character;
it is removed before any diagram is read and draws nothing. A `%%` anywhere else on a line is not a
comment by itself: where the line holds text (a label, a message, a description, a member, a
participant's name) it is part of that text; where the grammar has no room for it the line is
refused; and only where a diagram kind's own grammar reads one (a state transition, a class
relationship on the document's last line) is the rest of the line a comment. A line of nothing
but `%%` is refused in a flowchart or ER diagram ([ADR-0017](docs/adr/0017-a-siren-document-without-its-timeline-is-mermaid.md)).
_Avoid_: end-of-line comment, trailing comment (Mermaid has no such general construct), remark

**Document config**:
The settings a Mermaid document carries about itself: its frontmatter (`config`, plus `title` and
`displayMode`) and its `%%{init}%%` directives, merged as Mermaid merges them, with `init` winning
a key both set. Read by Siren because Mermaid documents carry it; a key Siren reads but does not
act on is reported rather than silently dropped. Frontmatter keys Mermaid does not know are
dropped unread by Mermaid, which is the one place Siren-only meaning may live in a document
outside a **timeline block** — see
[ADR-0017](docs/adr/0017-a-siren-document-without-its-timeline-is-mermaid.md).
_Avoid_: directive (alone — `init` is one of two spellings of this, and not every directive is
config), front matter config, settings

**Theme preset**:
A named, complete set of **design token** values a consumer or user applies to diagrams, each
with a light and a dark variant. Mermaid's built-in themes (`default`, `neutral`, `dark`, `forest`,
`base`) are theme presets under their Mermaid names, so a document's `theme:` names one.
_Avoid_: skin, template, theme (alone — ambiguous between the token mechanism and one set of values)

**Apply mode**:
How far a **theme preset** takes over the colors an author wrote. *Respect author* keeps every
**author style**, as Mermaid does. *Semantic* gives **role classes** and **category classes** the
preset's colors and keeps **decorative colors**. *Force* gives everything the preset's colors,
keeping only which elements share a role, a category or a color.
_Avoid_: override mode, strict mode

**Role class**:
A `classDef` whose name is in Siren's semantic vocabulary (a warning, an error, a success…): its
meaning is the same under every **theme preset**, and a preset owns how it looks. The `classDef`'s
own declarations are what Mermaid, and the *respect author* **apply mode**, draw.
_Avoid_: semantic color, status class, token class

**Category class**:
A `classDef` whose name is not in the semantic vocabulary. It marks elements as one group; under
a preset that takes it over, the group keeps a distinct color but the preset chooses it.
_Avoid_: group color, custom class

**Decorative color**:
An author color carried by nothing named: `style X`, `classDef default`, a label's own
`<span style>`, a `linkStyle`. It says how one element looks and not what it means.
_Avoid_: hardcoded color, literal style (the values of a role or category class are literal too)

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
convention `click`/`link` already use on a class. An ER diagram has no interaction target at all:
Mermaid's ER grammar has no `click`, `link` or `callback`, so `click A href "url"` there is not a
directive but a stream of entity names — `click`, `A`, `href` and the quoted `url` — and Siren
reads it the same way rather than inventing the construct.

A flowchart's `click X href "url"` additionally accepts an optional fourth argument, one of
Mermaid's four `LINK_TARGET` values (`_blank`/`_self`/`_top`/`_parent`, a fixed lexer token —
anything else is a parse error, measured), carried as `Interaction.linkTarget`. **Mermaid's own
rendered SVG carries no `target` attribute for any of the four, measured** — the effect apparently
lives in a JS bind-time layer this package's `render()` has no equivalent of. Siren's `<a
class="siren-link">` is a real, self-contained anchor with no such layer, so it sets `target`
itself when `linkTarget` is present, plus `rel="noopener noreferrer"` against reverse tabnabbing —
a deliberate divergence from Mermaid's own static markup, recorded here rather than treated as a
mis-render, because it reaches the same author intent (opening the link in a new tab) through the
mechanism this renderer actually has. `linkTarget` is optional rather than required-nullable on
`Interaction`/`ResolvedInteraction`, unlike its sibling fields: only a flowchart's `click ... href`
can ever set it, so a class diagram's and a sequence diagram's own `href`-kind spellings never
carry the key at all rather than carrying it as `null`.
_Avoid_: link (one of several spellings, not a fourth kind of interaction), handler, action
(that is the callback-name field of one, not the whole thing), hotspot, target (alone, for
`linkTarget` — this entry's own `targetId` already uses "target" for the authored thing an
interaction is attached to, a different concept)

**Icon pack**:
A set of icons a caller hands `render()` through its `iconPacks` option, as Iconify JSON — a
`prefix` and its `icons`, each an SVG body. A flowchart **icon node**
(`A@{ icon: "prefix:name", form, pos, h }`, and `shape: icon`) draws an icon from one. Packs are
data, never loaded or fetched, so an icon no registered pack holds is an error rather than the
`?` Mermaid draws. An icon's body is read through an allowlist into figure data and drawn
element by element: no markup from a pack reaches a parser in the page.
_Avoid_: icon set, icon library, icon font

**Image node**:
A flowchart node drawn as an image (`A@{ img: "data:image/…", w, h, constraint, pos }`). Its image
is a `data:` URL the document holds — never one Siren fetches, since it draws without touching the
network — of a PNG, GIF, JPEG, WebP or SVG, whose natural size is read off the data's own header.
Only the header is read, never the image decoded, so an image whose data is missing or broken
past a whole header is drawn and shows broken, where Mermaid refuses the whole diagram: Node has
no decoder, and a check of the data's structure would not agree with the browser's decoder.
An image node draws no icon: Mermaid draws a node given both an `img:` and an `icon:` as the image
and drops the icon without a word, so Siren refuses the pair, saying the icon would be dropped.
_Avoid_: picture node, image shape (there is no `shape:` name for it)
