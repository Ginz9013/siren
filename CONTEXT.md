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

**Timeline block**:
The `timeline:` section of a Siren document. Each non-blank line is one step, and lists the
timeline actions that fire on it, naming timeline targets by id. Deliberately separate from the diagram's structural definition — see
[ADR-0002](docs/adr/0002-animation-timeline-is-a-separate-block.md).
A document declares it at most once. `timeline:` opens the block and nothing closes it: every
remaining line of the document belongs to it. A second `timeline:` is therefore a line *inside*
the block, not a new one, and since it is not a timeline action all three diagram kinds report the
same error-severity diagnostic for it — `Unrecognized timeline action: "timeline:"` — which costs
the whole document, exactly as any other unrecognized line in the block does.
_Avoid_: animation block, timeline section

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
(a sequence participant is drawn in both participant rows, alongside its lifeline, and its
destroy mark carries that same id; a labelled flowchart **edge** is a `<path>` and a `<text>`
side by side, both wearing the edge's id) and they all animate together — see
[ADR-0009](docs/adr/0009-a-timeline-target-is-an-id-not-an-element.md). A destroy mark is
therefore not a fifth sequence target: it animates when its participant does, and there is no id
that names it alone.
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
_Avoid_: CSS variable, theme variable, dark mode, 主題切換 (there is no switch to name: one set of
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

**Diagram kind**:
Which diagram a Siren document declares in its header — `flowchart TB|BT|LR|RL`,
`sequenceDiagram`, `classDiagram`, or `stateDiagram` (`stateDiagram-v2` is the same kind under a
second spelling, measured: both report the diagram type `stateDiagram`, exactly as
`classDiagram-v2` does). Carried as `SirenDocument.kind` and dispatched on by
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
A diagram kind whose layout is a directed graph of boxes and connectors — flowchart, class, state
and ER diagrams today; requirement and C4 when they land. Every one of them sizes its own
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
that only want a string: a diagnostic quoting the label, the redeclaration warning comparing two.
What is drawn is the rows.

The **picture** a label is held to is what Mermaid's default `htmlLabels: true` shows a reader; the
**drawing** stays SVG `<text>`/`<tspan>` with author text through `textContent`, never `innerHTML`
(ADR-0015). Between them, every HTML tag Mermaid lets through is read into the label's rows and runs —
drawn, drawn approximately, or refused with a diagnostic — and none is drawn as its literal
characters. Which tags a place honors is its **dialect**: `html`, the whole vocabulary, for the places
Mermaid draws as HTML; `sequence`, only `<br>` and entity codes, for sequence text, which Mermaid
draws as SVG in both modes. A class **member** is not a label at all: Mermaid escapes it in both
modes, so it is kept as written. A **row break** is `<br>` in any case, with or without attributes
and a closing `/` — `<br>`, `<br/>`, `<br />`, `<BR>` and `<br class="x">` all break a row, the last
because Mermaid's HTML labels keep it as an element, though its own `/<br\s*\/?>/gi` does not match
it; in the `sequence` dialect that narrower pattern is the picture, so `<br class="x">` is drawn as
its characters there. The text-styling tags are read too — `b` `strong`, `i` `em` `cite` `dfn` `var`, `u` `ins`, `s`
`strike` `del`, `code` `kbd` `samp` `tt`, `small` `big`, `sub` `sup`, `q` and `mark` (black text on
a yellow rect behind the run, through the theme's `--siren-label-mark-text` and
`--siren-label-mark-fill`) — nested and misnested as the browser's HTML parser reads them; a **Markdown string** is read as the tags it stands for, so
its `**`/`*` stack with tags the author wrote. The tags whose attributes say what they draw are read
too: `font` (its `color`, its `size` 1–7 as the scale Mermaid's label measured, and its `face`);
`span style`, drawing ten properties — `color`, `background-color` (a rect behind the run, as
`mark`'s), `font-size`, `font-weight`, `font-style`, `font-family`, `text-decoration`,
`letter-spacing`, `word-spacing` and `opacity` — and **warning** about any other, naming it, the one
thing in a label Siren warns about rather than drawing or refusing; and `a href`, drawn as an SVG
`<a href>` around its run, underlined and painted with the `--siren-label-link` token, for exactly
the hrefs DOMPurify keeps (an `<a>` whose href it strips is plain text). An author's value that
could fetch, run script or smuggle a second declaration is dropped silently, under the same rule as
`style` statements. The 20 tags with no rendering of their own (`abbr`, `time`, `wbr` and the rest)
draw only their text; `html`, `head` and `body` are dropped and their text kept; and a tag outside
the vocabulary is dropped and its text kept, as DOMPurify drops it — except `script`, `style`,
`iframe`, `noscript`, `noembed`, `xmp` and `noframes`, removed together with their content, and
`plaintext`, removed with everything after it. **Entity codes** — Mermaid's `#name;` and `#NN;` —
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
draws it at the box's centre. A label of one row holding one plain run — nearly every label — is
drawn as the `<text>`'s own `textContent`, exactly as before labels had rows; anything else is one
`<tspan class="siren-label-row">` per row with one `<tspan>` per run inside it, which is the
structure Mermaid's own SVG labels use. What a run paints *behind* its text comes back separately,
and the renderer puts it before the `<text>`, since document order is paint order.
_Avoid_: text, caption, string (for the read label — say "flattened text" for the string); line (for
a drawn row — a Markdown string's *line* break is one way to start a row, `<br>` is another)

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
statements in time. Five things separate it from the namespace it most resembles, and none of them
is cosmetic:

- **It nests.** `ResolvedSubgraph` carries a `parentId`; `ResolvedClassNamespace` has no such
  field, so the class model has no way to say one group is inside another.
- **Membership lives on the node**, as `GraphNode.parentId`, in one place — so a node and the
  frame around it cannot disagree about which holds it. A namespace keeps a `classIds` list beside
  the classes and has to promise the two agree.
- **A node is claimed by the first block that names it**, measured, so naming it again from
  another block joins it rather than moving it. A class is a member of the namespace it was
  written in.
- **It lays out in a rank direction of its own.** `direction LR` written inside a block turns that
  group alone into a row while the document keeps the header's direction — dagre's
  `recursiveClusterLayout`, one `rankdir` per cluster. A namespace has no such statement.
- **An edge may name one at either end.** `one --> two` joins the two *frames*, not two boxes —
  so an endpoint that names a block declares no node of that name, while a node the author
  declared in their own right (`A[Alpha]` beside `subgraph A`) keeps its box. dagre cannot route
  that edge as written (it throws on an endpoint that *is* a cluster), so `layoutDirectedGraph`
  hands it a member of the frame instead and clips the returned route back to the frame's own
  boundary — Mermaid's own strategy for the same construct, arrived at independently. **One
  spelling of it is still drawn wrongly and is written down as such**: a block naming *itself* at
  both ends (`one --> one`) draws its loop around that stand-in member, inside the frame, rather
  than around the frame — the clip has nothing to bite on, since a self-loop never leaves the box
  it belongs to. That is the corpus's one `silently-wrong` row, `fc-subgraph-self-edge`, and its
  exit is drawing the loop around the frame rather than refusing the line.

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
One vertical lane in a sequence diagram, declared as `participant X` (drawn as a box) or
`actor X` (drawn as a stick figure), or created implicitly, as a box labelled with its id, by the
first message, note, `activate`, `deactivate` or `destroy` that names it. Lanes order left to
right by first mention, declaration or reference alike; a declaration after the first mention
gives the lane its label and kind without moving it (see
[ADR-0013](docs/adr/0013-sequence-participants-are-created-on-first-mention.md)).
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
`Registry` and draws as `Registry<T>`. It may carry a bracketed `["label"]` after the name and any
generic (`class Order["Order<br/>Line"]`, also on the block form), drawn in place of the name and
generic; the label is a **Label** in the `html` dialect, and the name stays the id. A second
declaration of the same name merges members rather than erroring (a second, different label is
ignored with a warning — the first one is kept). May carry one **annotation** (`<<interface>>`, `<<abstract>>`, or any
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
Rendered verbatim, as the author spelled it: a member is **not** a Label, because Mermaid escapes
its text in both label modes, so no tag in it is read — the one change made first, as Mermaid makes
it, is respelling `<br/>`, `<br />` and `<BR>` as `<br>`, which is then drawn as those four
characters. Attributes and methods draw in two separate
compartments, in declaration order within each, with a divider above every populated one.
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
starting with nesting, which this construct does not do. It may carry a bracketed `["label"]` after
its name (`namespace Zoo["Big Zoo"] {`), drawn as the frame's title in place of the name — a
**Label** in the `html` dialect. Addressable in a `timeline:` block under
a generated id (`namespace:1`, `namespace:2`, … in source order).
_Avoid_: package, module, cluster (that is the dagre-side word `layoutDirectedGraph` uses for the
mechanism, not the authored construct), group, box

**Note**:
A free-standing annotation box, in either of the two diagram kinds that have one — a class
diagram's, either attached to one class (`note for Shelf "..."`, drawn with a connector to that
class's box) or standing alone (`note "..."`), its quoted text a **Label** in the `html` dialect; a
sequence diagram's `note over A,B`/`note right of
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
out as a dagre cluster. The **fifth** grouping construct here and the third spatial one, after a
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
  (see **Pseudo-state**), and it may carry its own `direction LR` — one `rankdir` per cluster, the
  same per-level, non-cascading rule `SirenSubgraph.direction` follows.

Membership lives on the member, as `StateDecl.parentId`, in one place — the split the **subgraph**
entry already argues for, and here it is the only place it *could* live, because a pseudo-state has
no id for a membership list to name. **The first block to name a state keeps it** against every
later one, the rule a subgraph's members already follow. (Mermaid's own parse tree keeps a
same-named state per level and lets its renderer draw one node for them; Siren's ids are global, so
one rule decides which level that one node is drawn at.)
_Avoid_: subgraph (flowchart vocabulary), namespace (class-diagram vocabulary), cluster (the
dagre-side word), superstate, group, frame (that is the drawn `<rect>`, one of the two elements a
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
never wrote. It carries no descriptions and can carry none, since `[*]` is not an id and no
description statement can name one.
_Avoid_: initial/final state (they are not states — nothing can describe or style one), start node,
terminator, `[*]` (that is the spelling, not the thing)

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
