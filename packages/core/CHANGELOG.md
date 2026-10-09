# Changelog

All notable changes to `siren-core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is 0.x, a minor release may contain breaking changes.

## [Unreleased]

Breaking for a stylesheet or script that reaches a connector's label through the connector's
own group (see **Changed**).

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
- `RenderOptions.timeline` also takes a string: `render(source, container, { timeline: "wallet" })`
  applies the block of that name. `true`, or leaving the option out, applies the first block.
  A name the document does not declare throws a `RangeError` listing the declared names, and
  leaves the container untouched; a document that fails to render still returns its
  diagnostics instead. The diagnostics are the same whichever block is applied.
- `SirenRenderResult.timelines` lists the named blocks in document order, so a viewer can offer
  them as a choice. It is `[]` for a document with only the unnamed block or none, and when
  rendering failed.

### Changed

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
