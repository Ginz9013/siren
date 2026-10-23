# Changelog

All notable changes to `siren-board` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is 0.x, a minor release may contain breaking changes.

## [Unreleased]

With the default theme's font tokens, every diagram is drawn as in 0.8.0. A theme that changes
`--siren-font-size`, `--siren-label-font-size` or `--siren-title-font-size` now gets boxes sized
for its text, and a `measureText` you pass has to measure at the theme's `--siren-font-size`
(see **Changed**).

### Added

- `board.relayout()` draws the last rendered document again in the theme's font tokens as they
  are now, for a theme changed after the board drew. It keeps the step, the timeline, the full
  diagram, the view, `diagnostics`, the error banner and playback, fires `onStyles` and no other
  callback, and replaces `controller`. Before a document has rendered, and after `destroy()`, it
  does nothing.
- `readTypography(element)` and the `BoardTypography` type: the four font tokens off an element's
  computed style, as the board reads them.
- `createCanvasTextMeasurer(font?)` is exported: the board's own measurer, in
  `${fontSize}px ${fontFamily}`, answering a string's width plus 24px and a height of
  `fontSize × 1.5 + 11`. Left out, `font` is `14px system-ui, sans-serif`, 32px tall, as before.
  With `readTypography`, it renders with `siren-core` as the board does.

### Changed

- Before every render (`setSource()`, `setTimeline()`, `setFullDiagram()`,
  `setOmitAuthorStyles()`, `relayout()`), the board reads `--siren-font-family`,
  `--siren-font-size`, `--siren-label-font-size` and `--siren-title-font-size` off the layer the
  SVG is mounted in, measures in that family and size, and passes the sizes to `render()` as
  `typography`. Its measurer used to be a fixed `14px system-ui, sans-serif`. Only px sizes are
  read: a size in another unit (`1rem`, `calc(…)`), or not above 0, is read as the default for
  that token alone, and an empty family as `system-ui, sans-serif`.
- A `measureText` passed in `BoardOptions` must measure at the theme's `--siren-font-size`, where
  it used to measure at 14px; the board still passes the token sizes to `render()`.

## [0.8.0] - 2026-10-21

Requires `siren-core` ^0.8.0. Breaking for a page that reaches the built-in control bar as the
board container's own child — `.siren-board > .siren-board-controls`, or
`container.lastElementChild` — which now sits inside `.siren-board-chrome` (see **Changed**).

### Added

- `board.fullscreen`, `board.setFullscreen(on)` and `BoardOptions.onFullscreenChange(on)`, shaped
  like `fullDiagram`, `setFullDiagram` and `onFullDiagramChange`. The board's container goes
  fullscreen through the Fullscreen API; where that is unavailable or refused (iPhone Safari, an
  iframe without `allowfullscreen`), it fills the browser window instead, and Escape leaves it.
  Both are `fullscreen === true`; which one is in use is not exposed. Switching keeps the view, the
  step, playback and the full diagram, and does not re-render. Both draw the board on
  `--siren-board-surface` (nook decision `01M5D3SBB`).
- The built-in bar has a Fullscreen button after Reset view, pressed while fullscreen is on.
- While `board.fullscreen` is `true`, screen or fill, a plain left click on the board's canvas
  steps forward one step through the controller, as Next does: `onStepChange` fires, and it stops
  playback like any manual step. A drag that pans, a click with a modifier key or another button,
  a click on the author's clickable elements, links or a sequence link menu, the last step and the
  full diagram all leave the step alone. Outside fullscreen nothing changes, and no public type
  changes (nook decision `01M5EKKNM`).
- A dot grid behind the diagram: `BoardOptions.dotGrid` (on when omitted), `board.dotGrid`,
  `board.setDotGrid(on)` and `BoardOptions.onDotGridChange(on)`, shaped like `fullDiagram`. The
  dots are drawn on the board's canvas (`.siren-board-canvas--dots`), 22px apart, and move and
  scale with pan and zoom like an infinite canvas; Reset view puts them back with the diagram.
  They are chrome, never part of the SVG `render()` mounts, so an export never carries them.
  Their color is `--siren-board-text` mixed toward transparent, with no token of its own, so dark
  chrome tokens give dark dots. `controls: false` keeps the grid; nothing remembers it across page
  loads.
- The default controls have a small panel in the board's bottom-right corner
  (`.siren-board-corner`) holding a Dot grid button, pressed while the grid shows. It goes with
  the bar under `controls: false`; a custom `controls` factory that wants the toggle calls
  `board.setDotGrid` itself.

### Changed

- The built-in bar's Reset view button draws Lucide `locate` in place of `scan`, whose four
  corners looked like the new Fullscreen button beside it.
- The default controls now mount as a `.siren-board-chrome` wrapper holding the
  `.siren-board-controls` bar and the new corner panel, where the bar used to be the mounted
  element itself. The wrapper is `display: contents`, so the bar is laid out as before, and a
  descendant selector such as `.siren-board .siren-board-controls` still matches it. A child
  selector such as `.siren-board > .siren-board-controls`, or code that takes the bar as
  `container.lastElementChild`, now has to go through `.siren-board-chrome`.

## [0.7.0] - 2026-10-20

Requires `siren-core` ^0.7.0. Diagrams look different, and documents siren-core now refuses are
refused on a board too: see the
[siren-core changelog](https://github.com/Ginz9013/siren/blob/main/packages/core/CHANGELOG.md#070---2026-10-20).

### Added

- `BoardOptions.onClick` delivers `click X call fn()` interactions, as `render()`'s `onClick` does.
  Board had no such option, so on a board every callback interaction did nothing when clicked, with
  no diagnostic (nook `01M2WWHF4`). `click X href` links were never affected.
- `BoardOptions.iconPacks`, passed through to `render()`'s `iconPacks`: Iconify JSON icon packs,
  handed over as data, that a flowchart node's `@{ icon: "prefix:name" }` is drawn from. Nothing is
  fetched at render time; an icon's body is read through an allowlist that keeps shapes, colours
  and local references only.
- `BoardOptions.omitAuthorStyles`, `board.setOmitAuthorStyles(list)` and `board.omitAuthorStyles`,
  passed through to `render()`'s `omitAuthorStyles`. Switching redraws the document in place: the
  step, the current timeline, the full diagram, pan and zoom and playback are kept. An equal list,
  its names compared case-insensitively as `render()` reads them, does nothing. The list
  `board.omitAuthorStyles` returns is frozen.
- `BoardOptions.onStyles(styles, siren)`, `board.styles` and `board.siren`: every render's
  `styles` and frontmatter `siren:` value from `render()`, handed over unchanged after each
  `setSource`, `setTimeline`, `setFullDiagram` and `setOmitAuthorStyles` that draws, as that render's
  last callback; `board.styles` and `board.siren` already hold them in every callback before it.
  Board draws no conclusion from them.
- `StyleFact` and `IconifyJSON`, the types `BoardOptions` uses for `onStyles` and `iconPacks`, are
  imported from `siren-core`; board does not re-export them.

### Changed

- With `siren-core`'s change: a document that opens with a frontmatter (`---` … `---`) or holds
  `%%{init: …}%%` directives is drawn on a board, where it used to be refused. Its config is read
  but not applied yet, and each setting is reported as a warning through `onDiagnostics`.
- The standalone `dist/siren-board.js` is about 610 KB gzipped (0.6.0: about 547 KB). It now also
  includes js-yaml, `siren-core`'s new dependency, and its `dist/THIRD-PARTY-NOTICES.md` carries
  js-yaml's MIT licence beside elkjs's.

### Fixed

- `setSource()` after `destroy()` does nothing. It used to render into the detached board and call
  `onDiagnostics` (and, when the timeline changed, `onTimelineChange`), though a destroyed board
  reports nothing more.
- A consumer's `:root { --siren-board-… }` override now wins, as the Theming section shows it.
  Board injects its stylesheet after the page's own CSS, and its token block was also `:root`, so
  board's defaults won on order and the override did nothing. The block is now `:where(:root)`,
  which has zero specificity; the chrome rules themselves are unchanged (nook `01M3VYFBX`).

## [0.6.0] - 2026-10-14

Requires `siren-core` ^0.6.0. Diagrams look different: see the
[siren-core changelog](https://github.com/Ginz9013/siren/blob/main/packages/core/CHANGELOG.md#060---2026-10-14).

### Added

- `dist/THIRD-PARTY-NOTICES.md` beside the standalone `dist/siren-board.js`. The bundle includes
  `siren-core` and, through it, the layout engine elkjs, which is licensed EPL-2.0, not MIT; the
  notice carries its licence text, and the bundle's first line points to it.

### Changed

- With `siren-core`'s change: flowcharts, class diagrams, state diagrams and ER diagrams are laid
  out by ELK, as Mermaid 12 lays them out. Connectors are orthogonal with rounded corners and jump
  each other where they cross, and almost every diagram of those kinds looks different.
- The standalone `dist/siren-board.js` is about 547 KB gzipped, most of it the layout engine, and
  the first diagram a page lays out costs about 0.1s while the engine starts. The npm entry
  (`dist/index.js`) still leaves `siren-core` external.

## [0.5.0] - 2026-10-12

Requires `siren-core` ^0.5.0. Diagrams look different: see the
[siren-core changelog](https://github.com/Ginz9013/siren/blob/main/packages/core/CHANGELOG.md#050---2026-10-12).

### Added

- With `siren-core`'s change: connector labels in flowchart, class, state and ER diagrams are
  painted on a translucent background, `--siren-edge-label-fill`, so a line under a label no
  longer crosses its text. A consumer that declares its own dark (or any non-white) theme should
  redeclare `--siren-edge-label-fill` with it, as `demos/theme-dark.css` does.
- With `siren-core`'s change: a flowchart can pick the curve its edges are drawn with,
  `linkStyle default interpolate <curve>` or `linkStyle <n> interpolate <curve>`, from `basis`,
  `linear`, `step`, `stepBefore`, `stepAfter` and `rounded`. Documents using such a line used to be
  refused.

### Changed

- With `siren-core`'s change: a flowchart node's label wraps once its text is wider than 175px, as
  Mermaid's does, so a node with a long label is drawn narrower and taller, and a diagram with
  such nodes is laid out differently. A subgraph's title does not wrap.
- With `siren-core`'s change: a flowchart edge's label wraps once its text is wider than 150px
  (Mermaid's 200px at the 12px an edge label is drawn at), and its background covers the wrapped
  rows.
- With `siren-core`'s change: in a state diagram, a state's description and a note wrap once
  their text is wider than 175px, and a transition label once its text is wider than 150px, as
  in Mermaid. A composite state's title does not wrap.
- With `siren-core`'s change: a class diagram's relationship label wraps once its text is wider
  than 150px, and an ER diagram's once wider than about 171px (Mermaid draws that label at 14px),
  so each row holds as much as Mermaid's. A class name, a member, a class diagram's note, an ER
  entity name and an attribute's comment do not wrap.
- With `siren-core`'s change: a label of several rows draws them closer together, 1.5 times the
  font size apart as in Mermaid (21px for a node's 14px text, 18px for a connector label's 12px),
  with the canvas measurer's padding around the rows once; a one-row label is the same height as
  before.
- With `siren-core`'s change: a subgraph, composite state or ER subgraph that declares a
  `direction` uses it only when no connector has exactly one end inside it, as in Mermaid;
  otherwise it follows the nearest enclosing group's direction, or else the diagram's. A
  connector naming the group itself from outside does not count. Connectors that used to be drawn
  as straight lines through other boxes are routed, and frames that used to overlap no longer do.
- With `siren-core`'s change: connector labels in all four connector diagrams (flowchart, class,
  state, ER) are drawn on the line rather than 10px beside it, and laid out at the 12px they are
  drawn at, as in Mermaid.
- With `siren-core`'s change: flowchart, class, state and ER diagrams have an 8px margin around
  the drawing, as in Mermaid, so a diagram's extent grows by up to 16 on each axis.
- With `siren-core`'s change: connectors in flowchart, class, state and ER diagrams are drawn
  as smooth `basis` curves through their routes, as in Mermaid, instead of polylines with
  corners. Every diagram with a bent connector looks different; arrowheads still point the same
  way.

## [0.4.0] - 2026-10-10

Requires `siren-core` ^0.4.0.

### Added

- `board.setFullDiagram(on)` and `board.fullDiagram` show the **full diagram**: the document
  drawn without its `timeline:` block, every element visible and no step applied. Switching
  off returns to the step that was showing; switching never changes pan and zoom.
  `onFullDiagramChange` fires on every switch, from the bar or from code.
- The built-in control bar gains a Full diagram button between Reset and Reset view. Its icon
  shows what a click switches to: Lucide `image` while the timeline shows, `clapperboard`
  while the full diagram shows. It is `aria-pressed` while the full diagram shows, and Prev,
  Next and Reset are disabled meanwhile.
- A `ControlsFactory` may return `update()`. The board calls it once after a `setSource()`
  that rendered, after every step change (including `board.controller.next()` called from
  code) and after every full diagram switch, and never after `destroy()`. A custom bar no
  longer has to keep its buttons outside the factory to follow the board. The built-in bar
  uses the same hook.
- **Playback**: `board.play()` advances the timeline one step at once, then one step every
  `board.playInterval` milliseconds, and stops by itself on the last step. Playing from the
  last step starts again from step 0. `board.pause()` stops it, and so does any step change
  playback did not make, every `setSource()` call, and `setFullDiagram(true)`. Set the
  interval with the `playInterval` option (default 2000) or `board.setPlayInterval(ms)`;
  an interval that is not a finite number above 0 throws a `RangeError`. `board.playing` and
  `onPlaybackChange` report whether playback is running, and a `ControlsFactory`'s `update()`
  is also called when `playing` or `playInterval` changes.
- The built-in control bar gains a Play button between Prev and Next, and a play interval
  dropdown between Reset and Full diagram. Play shows Lucide `play` while stopped and `pause`
  while playing, and is `aria-pressed` while playback runs. The dropdown offers 1s, 1.5s, 2s,
  3s and 5s, plus the current `playInterval` when it is none of those (2500 shows as 2.5s).
  It is board's own rather than a native `<select>`, whose list the OS places above or below
  at will: a button (`aria-haspopup="listbox"`) showing the current interval, and a
  `role="listbox"` that always opens directly above it and never scrolls. It works from the
  keyboard (arrow keys, Home, End, Enter, Space, Escape, Tab) as well as the pointer, closes
  on a press anywhere else, the diagram included, and stays open while playback steps.
  Style it through `.siren-board-controls__dropdown` (its root, which anchors the listbox),
  `__trigger`, `__listbox` and `__option`.
  Both are disabled while the full diagram shows and on a document with no steps. Either
  one, disabled while focused, hands focus to Full diagram.
- The built-in control bar gains a step counter between Next and Reset, reading
  `currentStep / totalSteps` (`0 / 10` at the start). It follows every step change, from the
  bar, from playback or from code, and every `setSource()`. It reads `0 / 0` while the full
  diagram shows, on a document with no steps, and before a first render succeeds. It is plain
  text, not a live region, so playback is not announced step by step. Style it through
  `.siren-board-controls__step`; its digits are tabular, so the bar keeps its width as the
  count changes.
- The built-in control bar disables its step buttons when they have nowhere to go: Prev and
  Reset on step 0, Next on the last step, all three while the full diagram shows and on a
  document with no steps. Play stays enabled on the last step, since it replays from step 0.
  This follows every step change, from the bar, from playback or from code, and every
  `setSource()`. A step button disabled while focused hands focus to the opposite one (Next
  to Prev, Prev or Reset to Next), or to Full diagram when that one is disabled too.
- **Named timelines**: `board.timelines` lists the document's `timeline <name>:` blocks in
  document order, and `board.timeline` names the one applied: the first by default, `null`
  when there are none. `board.setTimeline(name)` applies another from step 0 and stops
  playback, keeping pan and zoom and `diagnostics`; from the full diagram it also switches
  that off, and the current name then returns to the step that was showing. A name the
  document does not declare throws a `RangeError` and changes nothing. `setSource()` keeps
  the current timeline when the new document declares it, else applies its first, and
  switching the full diagram off applies the current one. `onTimelineChange` fires whenever
  `timeline` changes after the first render, and a `ControlsFactory`'s `update()` is called
  after every switch.
- The built-in control bar gains a timeline dropdown between Reset and the play interval
  dropdown, shown only while the document names two timelines or more, so it comes and goes
  as `setSource()` crosses that line. Its options are the names in `board.timelines`, with
  `board.timeline` selected; picking one calls `board.setTimeline(name)`, and the dropdown
  follows every switch made from code. Like the other step controls it is disabled while the
  full diagram shows (`board.setTimeline()` from code still leaves it). Taken out of the bar, or
  disabled, while focused, it hands focus to Full diagram. It is
  the same dropdown as the play interval's, keyboard included; style it through
  `.siren-board-controls__timeline`.

### Changed

- The built-in control bar grows from Prev, Next, Reset and Reset view to, in order, Prev,
  Play, Next, the step counter, Reset, Timeline (only while the document names two timelines
  or more), Play interval, Full diagram and Reset view. Its buttons gain `:disabled` and
  `[aria-pressed="true"]` styles. A dropdown's listbox opens directly above its trigger,
  inside the board, so give the board at least about 260px of height, or its top options are
  cut off.
- Built against `siren-core` 0.4.0, and `dist/siren-board.js`, which bundles it, carries that
  release's changes: connectors paint under the boxes, and a class relationship's, state
  transition's or ER relationship's label is drawn in a label group of its own, outside the
  connector's group. A stylesheet that reached a label through the connector's group must
  select the label group instead. See the
  [siren-core changelog](https://github.com/Ginz9013/siren/blob/main/packages/core/CHANGELOG.md#040---2026-10-10).

### Fixed

- Pressing the mouse on the diagram takes focus off whatever control held it, as a click
  elsewhere on the page would. Starting a pan used to cancel that too, so a control the
  reader had just used kept its focus ring after they went back to the diagram.

## [0.3.0] - 2026-10-05

Requires `siren-core` ^0.3.0.

### Changed

- Built against `siren-core` 0.3.0, and `dist/siren-board.js`, which bundles it, carries that
  release's labels: every label draws the HTML Mermaid's labels draw, as SVG text, and a label
  writing HTML Siren cannot draw is refused with a diagnostic. A stylesheet that targeted
  `siren-node-label-row` must target `siren-label-row` instead. See the
  [siren-core changelog](https://github.com/Ginz9013/siren/blob/main/packages/core/CHANGELOG.md#030---2026-10-05).

## [0.2.0] - 2026-10-02

Requires `siren-core` ^0.2.0.

### Changed

- **The chrome ships one palette.** The injected stylesheet no longer follows
  `prefers-color-scheme` and no longer reads `data-theme`: the six `--siren-board-*` tokens are
  declared once, in one `:root` block, with the values a page with nothing pinned already saw.
  For dark chrome, redeclare them under a selector of your own — the README has the values, and
  `demos/theme-dark.css` in the repo does it for the chrome and the diagram at once. This follows
  `siren-core`'s theme, which changed the same way; see ADR-0014.
- Built against `siren-core` 0.2.0, and `dist/siren-board.js`, which bundles it, carries that
  release's theme. A page that relied on either package following `prefers-color-scheme` has to
  declare both sets itself; see the
  [siren-core changelog](https://github.com/Ginz9013/siren/blob/main/packages/core/CHANGELOG.md#020---2026-10-02).

## [0.1.1] - 2026-09-29

Requires `siren-core` ^0.1.1.

### Changed

- Built against `siren-core` 0.1.1, and `dist/siren-board.js`, which bundles it, includes
  that release's fixes. See the
  [siren-core changelog](https://github.com/Ginz9013/siren/blob/main/packages/core/CHANGELOG.md#011---2026-09-29).
  The board's own API and behavior are unchanged.

## [0.1.0] - 2026-09-29

First public release. Requires `siren-core` ^0.1.0.

### Added

- `createBoard(container, options?)`, which mounts a player for a Siren document and
  returns a `Board` with `controller`, `diagnostics`, `setSource()`, `resetView()` and
  `destroy()`.
- A built-in control bar with Prev, Next, Reset and Reset view buttons. The buttons are
  icon-only and named by `aria-label` and `title`. Pass `controls: false` to hide it, or
  a `ControlsFactory` to replace it.
- Drag to pan, and wheel to zoom toward the cursor.
- Label sizing with the browser's canvas text metrics. The `measureText` option replaces
  it.
- `onStepChange` and `onDiagnostics` callbacks.
- An error banner when a render fails. The previous diagram stays on screen.
- Chrome styles injected automatically, with light and dark palettes and
  `--siren-board-*` custom properties.
- ES module build with bundled TypeScript declarations, and a self-contained
  `dist/siren-board.js` that includes `siren-core`, for use without a bundler.
