# Changelog

All notable changes to `siren-board` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is 0.x, a minor release may contain breaking changes.

## [Unreleased]

## [0.1.0] - Unreleased

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
