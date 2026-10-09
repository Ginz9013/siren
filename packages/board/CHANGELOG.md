# Changelog

All notable changes to `siren-board` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is 0.x, a minor release may contain breaking changes.

## [Unreleased]

Requires the `siren-core` `render()` option `timeline: false`, which is not released yet.

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
  select between Reset and Full diagram. Play shows Lucide `play` while stopped and `pause`
  while playing, and is `aria-pressed` while playback runs. The select offers 1s, 1.5s, 2s,
  3s and 5s, plus the current `playInterval` when it is none of those (2500 shows as 2.5s).
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
