# Changelog

All notable changes to `siren-core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is 0.x, a minor release may contain breaking changes.

## [Unreleased]

**Every graph-shaped diagram is now laid out by ELK, as Mermaid 12 lays it out, and dagre is
gone.** Flowcharts, class diagrams, state diagrams and ER diagrams are laid out by ELK's `layered`
algorithm (elkjs 0.9.3, the version Mermaid 12.2.0 bundles), configured as Mermaid 12.2.0's default
layout, behind one shared layout core. Almost every diagram of those four kinds looks different:
routes are orthogonal with rounded corners and line hops, frames are the engine's, and boxes are
ordered as Mermaid orders them. `@dagrejs/dagre` is no longer a dependency. Against Mermaid 12.2.0
on the parity fixtures, Siren now draws the same crossings (flowchart 176 to its 176; class, state
and ER 0) with no edge through an unrelated box, and agrees on above/below and left/right for
99.6% / 97.8% of node pairs (flowchart), 97.3% / 100% (class), 100% / 98.5% (state) and 97.2% /
100% (ER). The cost: the standalone `dist/siren-core.js` is about 545 KB gzipped (was about 83 KB),
and the first layout in a page costs about 0.1s while the engine starts. Where Siren departs from
Mermaid 12 it measured the difference and wrote it down: a long arrow keeps its length (nook
`01M4VA6MS`), `linkStyle … interpolate` is still honoured (`01M4VANRC`, rule 6), straightening a
route's end never runs it through a box (`01M4VBHWY`), a frame fits its contents with its own
padding (`01M4VDB3X`), a frame's title moves clear of the routes crossing it (`01M4VFW4X`), class
multiplicities stay off lines and boxes (`01M4VHSY2`), a state's note stays in its block
(`01M4VKTJ2`), and an ER cardinality marker stays on its line (`01M4VP6AV`, with Mermaid's
half-buried almond, `01M4W687V`). The layout engine
decision is nook `01M4VA67H`; the amendment of ADR-0001 that puts ELK behind the shared core and
removes dagre is `01M4VPWF5`.

### Changed

- **Flowcharts are laid out by ELK, as Mermaid 12 lays them out.** The layout engine for
  flowcharts is now ELK's `layered` algorithm (elkjs 0.9.3, the version Mermaid 12.2.0 bundles),
  configured with the options of Mermaid 12.2.0's own default layout. Almost every flowchart looks
  different: edges are routed **orthogonally** and drawn with **rounded corners** (Mermaid's
  `rounded`, radius 5) unless a `linkStyle … interpolate` names a curve, which is still honoured
  and now applied to ELK's points (a name that is no curve draws `rounded`, as Mermaid 12 does);
  siblings keep the order they were written in (the street-fair diagram's options A, B, C
  now read left to right); groups are listed to the engine as Mermaid lists them; no edge is drawn
  through an unrelated box. Against Mermaid 12.2.0 on the parity fixtures: 176 crossings to its
  176, 0 edges through boxes (was 29), 99.6% / 97.8% agreement on above/below and left/right (was
  91.6% / 61.0%).
- **Edges that run back between subgraphs are laid out as Mermaid 12 lays them out.** Where the
  subgraphs form a cycle (`A --> B` from one subgraph into another, `B --> C` back), the edge that
  closes the cycle is laid out pointing the other way and still drawn from its source to its
  target, so the subgraphs stack in Mermaid's order rather than mirrored (the garden-network fixture's
  left/right agreement with Mermaid: 25.8% before, 92.6% after).
- **A subgraph's frame fits what it holds.** As in Mermaid 12, a frame is pulled in after layout to
  its members and the edges routed inside it, rather than also holding where edges leaving it cross
  on their way out. It stops one of the subgraph's own padding (12px) beyond them, where Mermaid
  stops 24px beyond: Mermaid's 24px measured worse against Mermaid's own pictures.
- **The short sidestep at an edge's end is taken out**, as Mermaid 12 does: a jog of at most 16px
  within 30px of a box is straightened when that adds no crossing and covers no more labels.
  Unlike Mermaid, Siren also keeps the jog when straightening it would run the edge through a box.
  The parity numbers above moved with the other two changes; keeping the jog off boxes left them
  unchanged.
- **A subgraph's frame is the engine's.** ELK sizes each frame around its members, its 12px
  padding and a band for its title, and routes edges that end on a subgraph (`one --> two`) and a
  subgraph's own loop (`one --> one`) to the frame itself. A title wider than its members widens
  the frame and centres them under it.
- **A subgraph's `direction` follows Mermaid 12's rule.** A declared direction is given up when an
  edge whose ends have different parents passes through the subgraph — including an edge between
  two of its own members at different nesting depths, which Mermaid 11 did not count. A subgraph
  with no `direction` inside one that keeps its own is laid out in the enclosing subgraph's
  direction (Mermaid 11 used the document's).
- **A subgraph's title moves aside for the edges crossing its band.** Mermaid 12 centres the title
  and draws an edge entering or leaving the subgraph from above straight through its words. Siren
  moves the title along the band to the place nearest the centre that clears every such edge by
  half a padding; it stays centred when nothing crosses, or when the frame has no room. Edges and
  frames are unchanged. On the flowchart parity fixtures: 15 edges through a title (was 25;
  Mermaid 22); crossings, agreement, reversals and detour unchanged.
- **`A ----> B` still spans three ranks.** Mermaid 12 on ELK silently draws it like `-->`; Siren
  keeps the length the document asks for.
- **Class diagrams are laid out by ELK too, as Mermaid 12 lays them out.** Relationships and note
  connectors are routed orthogonally and drawn `rounded`, with line hops where they cross. A
  namespace's frame is the engine's, sized around its members, its 12px padding and a band for its
  title, and the title moves aside for routes and multiplicities crossing the band. Namespaces come
  before the classes outside them, and an attached note sits a layer before its class, in Mermaid
  12's order. Multiplicities are placed by the engine beside their own end, the from end's on the
  right of the line and the to end's on its left; unlike Mermaid, Siren also moves one off any line
  or box it lands on, and keeps it at its own end of a relationship laid out turned round. Against
  Mermaid 12.2.0 on the three class parity fixtures: 0 crossings to its 0 (was 0), 0 edges through
  boxes (was 1), 97.3% / 100% agreement on above/below and left/right (was 67.6% / 83.8%).
- **State diagrams are laid out by ELK too, as Mermaid 12 lays them out.** Transitions and note
  connectors are routed orthogonally and drawn `rounded`, with line hops where they cross; a
  self-transition, on a state or on a composite's frame, is an orthogonal loop. A composite's frame
  is the engine's, sized around its members, its 12px padding and a band for its title, and the
  title moves aside for routes crossing the band. A composite or concurrent region that names no
  `direction` is laid out top to bottom whatever the document's direction, as Mermaid lays it out
  (it used to follow a document-level `LR`); one that names a direction gives it up when a
  transition crosses its boundary, by Mermaid 12's rule. A start or end sits on the line of its
  transition. Unlike Mermaid, a note stays inside the composite its state is written in, and
  writing it makes no composite give up its direction. Against Mermaid 12.2.0 on the four state
  parity fixtures: 0 crossings to its 0 (was 1), 0 edges through boxes (was 0), 100% / 98.5%
  agreement on above/below and left/right (was 87.7% / 66.2%).
- **ER diagrams are laid out by ELK too, as Mermaid 12 lays them out.** Relationships are routed
  orthogonally and drawn `rounded` (they were `basis` curves), with line hops where they cross, and
  a self-relationship is an orthogonal loop; each cardinality marker lies along its route's first
  or last run. A relationship's label sits centred on its route. A `subgraph` block's frame is the
  engine's, sized around its members, its 12px padding and a band for its title, and the title
  moves aside for routes crossing the band. Blocks are handed to the engine in Mermaid's order —
  sibling blocks last-written first, every block before the entities — so `subgraph SA`,
  `subgraph SB`, `X` reads SB, SA, X from left to right, as in Mermaid. A block that names no
  `direction` inside one that keeps its own is laid out in the enclosing block's direction (it used
  to take the document's), and one that names a direction gives it up when a relationship crosses
  its boundary, by Mermaid 12's rule. Against Mermaid 12.2.0 on the four ER parity fixtures: 0
  crossings to its 0 (was 0), 0 edges through boxes (was 0), 97.2% / 100% agreement on above/below
  and left/right (was 58.3% / 77.8%).
- **An ER cardinality marker stays on its line.** Each end of a relationship now runs straight out
  of its entity, past the rounded corner, for at least as far as its marker reaches (15px for
  exactly one, 27 for zero or one, 24 for one or more, 34 for zero or more), so a crow's foot no
  longer sticks out past the first bend — a self-relationship's loop reaches out that far too.
  Mermaid 12.2.0's markers do overrun the bend; Siren departs from it here. ER diagrams grow along
  their ranks to make the room (the ER subgraph parity fixture's boxes span 1422px instead of
  1271px; Mermaid's 1321px); the parity numbers are unchanged. The layout core's edges take a
  `straightEnds` length for it; no other diagram kind sets one.
- **An ER "many" marker is half buried in its entity, as Mermaid draws it.** The almond of a
  one-or-more or zero-or-more marker is now centred on the entity's edge, with the half inside the
  box hidden under it, and its bar or circle sits 24 or 28px out (was every glyph outside the box,
  the almond's tip on the edge and the outer glyph 42 or 48px out). Every glyph is where Mermaid
  12.2.0's ER markers put it. ER diagrams are shorter along their ranks for it (nook `01M4W687V`).
- The Mermaid the parity and probe scripts measure against is **12.2.0** (was 11.17.2).

### Added

- `elkjs` **0.9.3** is a dependency (pinned exactly; licensed EPL-2.0). It is
  external in the npm entry and bundled into the standalone `dist/siren-core.js`, which grows from
  about 83 KB to about 545 KB gzipped and now ships with `dist/THIRD-PARTY-NOTICES.md`. `render()`
  is still synchronous; the first diagram laid out in a page costs about 0.1s while the engine
  initialises, later ones about 20ms for 40 nodes. siren-core must not run inside a Web Worker.
- A graph the layout engine rejects is reported as an error diagnostic, like any other layout
  failure.
- **Line hops**, as Mermaid 12 draws them: where two flowchart edges cross, one of them jumps the
  other with a half circle of radius 6 — on the horizontal line of the two, bulging up (the later
  edge where neither is horizontal, bulging right on a vertical one), never inside a rounded
  corner, smaller near a corner or next to another hop, and left out where less than 3.6 would
  remain. Drawn on `rounded` (the default), `linear` and `step` edges; a `basis` edge draws none.
  Lines that only meet at an end do not hop. The routes are unchanged — `data-siren-points` holds
  no hop — and a hopped `step` edge's `d` is written as straight segments through the route, the
  same picture as before. The layout reports each edge's hops (`PositionedEdge.hops`); class and
  state connectors have them too (`PositionedStateTransition.hops`,
  `PositionedStateNote.connectorHops`) and so do ER relationships
  (`PositionedErRelationship.hops`).
- `PositionedStateLabel.x`: the centre of a composite's title where the layout moved it along its
  band.

### Removed

- `@dagrejs/dagre` is no longer a dependency, and the standalone build no longer bundles it or
  lists it in `dist/THIRD-PARTY-NOTICES.md`. No diagram kind was laid out by it any more.

## [0.5.0] - 2026-10-12

Flowcharts, class, state and ER diagrams now lay out much closer to Mermaid's own pictures:
connectors are curved, connector labels sit on their lines over a background, long labels wrap,
and a group with a connector crossing its boundary follows the surrounding direction. Almost every
diagram looks different. Breaking for a script or test that reads a connector's route off its
`<path>`'s `d` (read `data-siren-points` instead), and for a second theme that does not declare
`--siren-edge-label-fill` (see **Added**).

### Added

- **Connector labels are painted on a background**, as in Mermaid, so a line running under a
  label no longer strikes its text out. Every labelled edge, class relationship, state transition
  and ER relationship gets a `<rect class="siren-connector-label-background">` over the label's
  box, drawn above every line and under the label's text. It is part of the label: a timeline
  `enter`/`exit` on the connector moves it with the text, and a highlight leaves its fill alone. An
  author's `linkStyle … color:` still paints only the text.
- Token `--siren-edge-label-fill` (default `rgb(255 255 255 / 0.8)`, the white canvas at Mermaid's
  0.8 opacity) fills that background. It sits outside the five-color palette, but **a second theme
  must redeclare it**: on a dark canvas the default draws a white background behind every connector
  label. `demos/theme-dark.css` declares a dark value.
- Every connector `<path>` (flowchart edge, class relationship, state transition, ER
  relationship, note connector) carries **`data-siren-points`**: the points its route passes
  through, as `"x,y x,y …"` (the spelling of an SVG `points` attribute). A connector is now drawn
  as a curve whose `d` holds control points rather than the route (see **Changed**), so this
  attribute is where a script or test reads the route.
- **`linkStyle … interpolate`** picks the curve a flowchart edge is drawn with, as in Mermaid:
  `linkStyle default interpolate <curve>` or `linkStyle <n>[,<m>…] interpolate <curve>`, optionally
  followed by declarations (`linkStyle 0 interpolate step stroke:#f00`). The curves are `basis`,
  `linear`, `step`, `stepBefore`, `stepAfter` and `rounded`; a numbered statement's curve beats
  `default`'s in either order. These lines used to fail with `Unrecognized style declaration`. The
  seven curves Mermaid draws and Siren does not yet (`cardinal`, `bumpX`, `bumpY`, `catmullRom`,
  `monotoneX`, `monotoneY`, `natural`) are reported as an error and the edge keeps its fallback
  curve; a name Mermaid does not know either is drawn as `basis`, as Mermaid draws it, with a
  warning. `GraphEdge` (and so `PositionedEdge`) gains an optional `curve`.

### Changed

- **A flowchart node's label wraps** once its text is wider than 175px, as Mermaid wraps its labels
  at 200px of 16px text (scaled to the 14px a node is drawn at): Latin text at its spaces, CJK text
  between any two characters, never with closing punctuation such as `，` or `)` beginning a row.
  A `<br>` still breaks a row, and each row is then wrapped on its own; a word too long for 175px is
  left whole and widens the label. A wrapped label's text is 175px wide and its box that plus the
  measurer's padding (the padding is outside the wrap width, as Mermaid's shape padding is outside
  its label), so a long-labelled node is now narrower and taller, and the whole diagram's layout
  can change. A subgraph's title is not wrapped. The width is fixed: `flowchart.wrappingWidth` is
  not read. `PositionedNode.label` is the wrapped label (its rows are what is drawn); `wrapLabel`
  and `wrapWidthAt` are internal.
- **A flowchart edge's label wraps** too, once its text is wider than 150px: Mermaid's 200px
  scaled to the 12px an edge label is drawn at, by the same rules as a node's. A wrapped edge
  label's text is 150px wide and its box that plus the measurer's padding (scaled to 12px); its
  background covers the wrapped box, and dagre keeps that box clear, so a diagram with long edge
  labels is laid out differently. `PositionedEdge.label.label` is the wrapped label.
- **A state diagram's labels wrap** as Mermaid's do (measured, mermaid 11.17.2): a state's
  description (and a quoted name, `state "…" as S`) and a note once their text is wider than
  175px, a transition label once its text is wider than 150px, by the same rules as a flowchart's.
  A long-described state and a long note are drawn narrower and taller, and the diagram's layout
  can change. A composite state's title is not wrapped. `PositionedStateLabel.label`,
  `PositionedStateNote.label` and `PositionedStateTransition.label.label` are the wrapped labels.
- **A class or ER relationship's label wraps** as Mermaid's does (measured, mermaid 11.17.2), by
  the same rules as a flowchart edge's label: a class relationship's once its text is wider than
  150px, Mermaid's 200px scaled from its 16px to the 12px Siren draws it at; an ER relationship's
  once wider than 200 × 12/14 ≈ 171.43px, because Mermaid draws that label at 14px, so a row holds
  as much as Mermaid's (the wrap width is `200 × Siren px / Mermaid px`). The layout keeps the
  wrapped box clear, so a diagram with long relationship labels is laid out differently. A class
  name, a class member, a class diagram's note, an ER entity name and an attribute's comment are
  not wrapped, as Mermaid wraps none of them.
  `PositionedClassRelationship.label.label` and `PositionedErRelationship.label.label` are the
  wrapped labels.
- **A label's rows are closer together**: one line apart, a line being 1.5 times the size the
  label is drawn at, as Mermaid's HTML labels draw 16px text on 24px lines (measured). A node's,
  a class's, a state's or a subgraph title's rows are 21px apart (14px), a connector label's 18px
  (12px). The measurer's height for one line is now that line plus a padding added once around
  all the rows, not once per row, so a one-row label's box is exactly as tall as before and each
  row after it adds one line rather than the measurer's full height. Sequence text follows
  Mermaid's SVG text instead: a message's, a note's and a block condition's rows are 14 × 19/16 =
  16.625px apart, a participant's and a box caption's 14px. A run's mark or background rect is one
  such line tall. Multi-row labels' boxes, and the layouts around them, are shorter.
- A flowchart subgraph, a state diagram's composite state or an ER subgraph that declares a
  `direction` now uses it **only when no connector crosses its boundary**: a connector with
  exactly one end inside the group, at any depth. A group with such a connector is laid out in the
  direction of the nearest enclosing group that keeps its own, or else the diagram's, as Mermaid
  lays it out. A connector that names the group itself from outside (`one --> C`,
  `Before --> Outer`) does not cross it, and the group keeps its direction, as in Mermaid. The members and connectors of a group that loses its direction go back to the
  ordinary layout: connectors crossing it are routed instead of drawn as two-point straight lines
  through other boxes, and its frame no longer overlaps the frames beside it. A diagram whose
  grouped direction relied on a crossing connector draws differently.
- **Connector labels are drawn on the line**, centred on a point the connector passes through, in
  flowcharts, class diagrams, state diagrams and ER diagrams, as Mermaid draws them. They used to
  sit 10px to the right of the line. The room the layout keeps for a label is now the size it is
  drawn at (`--siren-label-font-size`, 12px) rather than the node text's 14px, so a diagram with
  labelled connectors comes out slightly more compact.
- Flowcharts, class diagrams, state diagrams and ER diagrams are laid out with an **8px margin
  around the drawing**, as Mermaid lays them out (`marginx`/`marginy: 8`). This is inside the
  canvas gutter the `<svg>` already had. A diagram without frames moves 8 right and 8 down and
  its `viewBox` grows by 16 on each axis. A diagram whose subgraph, composite state, namespace or
  ER subgraph frames reached past the top or left edge was already moved to keep them on the
  canvas; there the margin takes up part or all of that move instead, so it moves, and grows,
  by less.
- **Connectors are drawn as curves**, as Mermaid draws them. Every flowchart edge, class
  relationship, state transition, ER relationship and note connector is a `basis` spline (d3's
  `curveBasis`, Mermaid's default) through its routed points instead of a polyline with corners.
  The route itself is unchanged: the curve starts and ends where the polyline did and still
  arrives along the route's last segment, so arrowheads and other end markers point as before.
  A connector `<path>`'s `d` now holds the curve's control points rather than the route, so a
  script or test that read the route off `d` should read `data-siren-points` (see **Added**).
  Every diagram with a bent connector looks different.

## [0.4.0] - 2026-10-10

Breaking for a stylesheet or script that reaches a connector's label through the connector's
own group, and for a script that matches the old message for a second unnamed `timeline:`
(see **Changed**). `SirenRenderResult` gains a required `timelines` field, so TypeScript code
that builds one itself, such as a mock, must add it.

### Added

- `render(source, container, { timeline: false })` draws the **full diagram**: the picture the
  same document draws without its `timeline:` block, as Mermaid draws it. Every element is
  visible, nothing is highlighted, and the controller has `totalSteps: 0`. The block is still
  parsed and checked, so `diagnostics` are the same as the default render's, and the render
  fails only when the default one does. Works for all five diagram kinds.
- **Several timelines in one document.** A document can declare named blocks,
  `timeline <name>:`, instead of the one unnamed `timeline:`; each runs to the next timeline
  header or the end of the document and has its own steps and its own step 0. Mixing the
  unnamed block with named ones, two unnamed blocks, a repeated name and a malformed name are
  each an error. Every block is checked on every render, and a diagnostic about a named block
  starts with `timeline <name>:`. A document with one unnamed block renders as before.
  A header is exactly `timeline:` or `timeline <name>:`, with nothing between the name and
  the colon; any other line starting with `timeline` keeps its ordinary meaning, so a document
  that rendered before renders the same.
- `RenderOptions.timeline` also takes a string: `render(source, container, { timeline: "wallet" })`
  applies the block of that name. `true`, or leaving the option out, applies the first block.
  A name the document does not declare throws a `RangeError` listing the declared names, and
  leaves the container untouched; a document that fails to render still returns its
  diagnostics instead. The diagnostics are the same whichever block is applied.
- `SirenRenderResult.timelines` lists the named blocks in document order, so a viewer can offer
  them as a choice. It is `[]` for a document with only the unnamed block or none, and when
  rendering failed.

### Changed

- A second unnamed `timeline:` header is now reported as `A document declares at most one
  unnamed "timeline:" block; name each block ("timeline <name>:") to declare several`, instead
  of `Unrecognized timeline action: "timeline:"`. The document is still rejected.
- **Connectors paint under the boxes, in Mermaid's layer order** (ADR-0016). Flowchart, class,
  state and ER diagrams now draw frames, then every connector line, then every connector label,
  then the boxes. A line routed past a box it does not end at runs under it instead of across
  its text, and no line crosses a label. A state's composite frame stays among the states, and a
  class note's box is still drawn last.
- A class relationship, a state transition and an ER relationship are each drawn as two groups
  that wear the same `data-siren-id`: the line group (`g.siren-relationship`,
  `g.siren-transition`, `g.siren-er-relationship`, unchanged in count and in
  `data-siren-relationship`) and a new label group (`g.siren-relationship-labels`,
  `g.siren-transition-labels`, `g.siren-er-relationship-labels`) holding the label,
  multiplicities and interface labels. A connector with no text has no label group. A timeline
  step on the connector's id still reaches both. A selector such as
  `g.siren-transition text.siren-transition-label` no longer matches; select the label group,
  or the label by `data-siren-id`.
- A class note's connector (`path.siren-note-link`) is drawn outside `g.siren-note`, on the line
  layer, and wears the note's id itself. A flowchart edge keeps its structure; only the order
  changes.

### Fixed

- The README's dark-theme example, and `demos/theme-dark.css` it points to, now redeclare
  `--siren-label-link` (`#9cc7ff`). Copied as they were, they left a label link in the
  browser's light-page blue, 1.6:1 on the dark node fill and unreadable.

## [0.3.0] - 2026-10-05

Breaking for a stylesheet that targets `siren-node-label-row`, which is now `siren-label-row`,
and for a document whose labels write HTML Siren now refuses (see **Changed**). That is why this
is 0.3.0 rather than 0.2.1.

### Added

- **Labels draw the HTML Mermaid's labels draw.** Every label in every diagram kind now reads
  the tags Mermaid's default (`htmlLabels: true`) picture honours and draws them as SVG text,
  never as `<foreignObject>` (ADR-0015). `<br>` breaks a row; `b`/`strong`, `i`/`em`, `u`, `s`,
  `code`, `small`/`big`, `sub`/`sup`, `q`, `mark` and the rest of the text-styling tags style a
  run; `<font>`, `<span style>` (ten properties) and `<a href>` (an SVG link) are drawn; block
  tags (`p`, `div`, headings, lists, `pre`) become rows with their fonts and list markers;
  tags with no rendering of their own, unknown tags and the tags Mermaid's sanitizer removes
  behave as they do there; and `#name;`/`#NN;` entity codes resolve. Markdown strings read
  `**`, `*`, `__`, `_`, backslash escapes, hard breaks and blank lines as Mermaid's `marked`
  does. A sequence diagram honours `<br>` and entity codes only, and a class member stays
  literal, as in Mermaid.
- Three theme tokens paint what the browser's stylesheet paints in Mermaid's picture:
  `--siren-label-link` (`#0000ee`), `--siren-label-mark-fill` (`#ff0`) and
  `--siren-label-mark-text` (`#000`).
- `class X["…"]` and `namespace X["…"] {` give a class and a namespace their own label.

### Changed

- **A label that writes HTML Siren cannot draw as SVG text is refused** with an error that
  names it: a `table`, `ruby`, `img` (the message points at Mermaid's image shape), form
  controls, media and interactive content, `svg` and `math`. Tags the browser hides
  (`template`, a closed `dialog`, `datalist`, `rp`, `source`, `track`, `area`, `title`) are
  removed with their content instead.
- A flowchart node or class declared twice with different labels draws the last one, and a
  flowchart node the last shape, with no warning, as Mermaid does.
- Mermaid's whole-document preprocessing is followed: `="…"` inside a tag becomes `='…'`, and a
  style line's last `;` is dropped, before any diagram reads its text.
- An unquoted ER subgraph title outside the name alphabet is refused at the title.
- Row tspans are `siren-label-row` (was `siren-node-label-row`). A transition, relationship or
  message label is now centred on the space layout keeps for it rather than standing on its
  baseline there.

## [0.2.0] - 2026-10-02

### Changed

- **The theme ships one palette, and a second one is yours.** `theme.css` no longer follows
  `prefers-color-scheme` and no longer reads `data-theme`: it declares one set of token values,
  in one `:root` block. A reader on a dark system sees that one palette unless your page says
  otherwise. To get the previous dark colors back, redeclare the five color tokens under a
  selector of your own — the README has the values and a worked example, and `demos/theme-dark.css`
  in the repo is the whole thing, ready to copy. Pinning a subtree with `data-theme="light"` is
  gone too; scope your own override to that subtree instead, which works for any palette rather
  than only for light. See ADR-0014.

## [0.1.1] - 2026-09-29

### Added

- A flowchart click's tooltip is drawn: the node shows it on hover, as a class
  diagram's and a sequence diagram's already do. It was parsed but never drawn.

### Changed

- A sequence-diagram participant nothing declares is created where it is first named, as
  in Mermaid, instead of being an error that dropped the message. Lanes run in the order
  participants are first named, and a later `participant X as Label` sets the label
  without moving the lane. A `create participant X` after X was already named is still
  an error.

### Fixed

- A `timeline:` block can name a sequence diagram's notes (`note:1`, ...) and activation
  bars (`activation:1`, ...). They were drawn with these ids but rejected as unknown.
- `highlight ... outline` is visible on every sequence-diagram target: participants
  (both rows, the lifeline and the destroy mark), messages, blocks including `rect`,
  box groupings and activation bars. It used to change nothing. `glow` now also takes
  those targets' strokes to the highlight color, as it does in the other diagram types.
- Sequence-diagram keywords are read in any case, as in Mermaid: `Note LEFT OF A`,
  `Participant A AS Alice`, `Loop` ... `End`, `ACTIVATE`, `Autonumber` and the rest.
  Only lowercase was accepted, and any other spelling rejected the whole diagram.
- The flowchart shorthand `click X "url"` takes an optional tooltip and target, as the
  `click X href "url"` form does. With either, the line was rejected.

## [0.1.0] - 2026-09-29

First public release.

### Added

- `render(source, container, options?)`, which parses a Siren document, draws it into a
  container as SVG, and returns the `<svg>`, an `AnimationController` and every
  `Diagnostic`.
- Five diagram types, written in Mermaid syntax:
  - **Flowchart** (`flowchart` / `graph`): four directions, fourteen node shapes, every
    arrow form, edge labels, subgraphs (with their own direction), Markdown labels, and
    `accTitle` / `accDescr`.
  - **Sequence diagram**: participants and actors, every message arrow, `autonumber`,
    control-flow blocks (`loop`, `alt`, `opt`, `par`, `critical`, `break`, `rect`),
    create/destroy, `box` groupings, activations, notes and links.
  - **Class diagram**: members, generics, annotations, relationships with
    multiplicities, lollipop interfaces, namespaces, notes and direction.
  - **State diagram** (`stateDiagram-v2`): `[*]` start and end, descriptions, composite
    states, concurrent regions, choice, fork and join, notes and direction.
  - **ER diagram**: entities, relationships with cardinality markers, attribute tables,
    aliases and direction.
- The `timeline:` block. Each non-blank line is one step, with `enter` and `exit`
  (`fade`, `slide-left`, `slide-right`, `slide-top`, `slide-bottom`), `highlight`
  (`outline`, `glow`) and `unhighlight` actions that target any node, edge, class,
  participant, message, block, state or entity by id.
- `AnimationController` with `next()`, `prev()` and `reset()`. `prev()` restores each
  earlier step exactly.
- Author styling as in Mermaid: `classDef`, `class`, `:::name`, `style` and `linkStyle`.
- Click interactions: `click ... href` becomes a link, and `click ... call fn()` is
  passed to the `onClick` option without running any function named in the document.
- A `measureText` option for sizing labels with real text metrics.
- `siren-core/theme.css`, with light and dark palettes and `--siren-*` custom
  properties for colors, text, lines, shapes and motion.
- Diagnostics with severity, line and column, for every problem in a document.
  Constructs that aren't implemented yet are rejected with an error instead of being
  drawn incorrectly.
- ES module build with bundled TypeScript declarations, and a self-contained
  `dist/siren-core.js` for use without a bundler.
