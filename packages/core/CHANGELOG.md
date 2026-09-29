# Changelog

All notable changes to `siren-core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is 0.x, a minor release may contain breaking changes.

## [Unreleased]

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

## [0.1.0] - Unreleased

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
