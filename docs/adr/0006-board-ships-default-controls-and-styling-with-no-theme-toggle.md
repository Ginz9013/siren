---
status: accepted
---

# `siren-board`'s default control bar and chrome styling are built in, JS-delivered, and replaceable — no theme toggle in v1

> ADR-0011 briefly removed this ADR's premise by shipping a dark palette;
> [ADR-0014](0014-the-default-theme-ships-one-palette.md) restored it. Core ships one palette,
> so there is again nothing for a Theme button to switch between, and the no-toggle decision
> stands for the reason given below. Board's chrome tokens follow core's shape: one set,
> declared once.

`siren-board`'s `createBoard()` ships a default Prev/Next/Reset control bar and its own chrome
CSS out of the box, so a consumer gets a fully working, styled diagram with one function call — no
separate `<link>` tag to remember, unlike `siren-core`'s theme, which ADR-0004 deliberately ships
as a CSS file consumers must link themselves. Board's styles are instead injected via JS on first
use (deduplicated across instances), and the default control bar can be turned off
(`controls: false`) or fully replaced (`controls: (board) => ({ element, destroy? })`) so the
built-in default doesn't lock a consumer in. The control bar does not include a Theme/dark-mode
toggle: `siren-core` doesn't ship an official dark theme (ADR-0004 defines exactly one token set;
`demos/theme-dark-override.css` (since removed, see ADR-0011) explicitly documents itself as demonstration scaffolding, not a
second real theme) — a Theme button on a component with no theme to switch to would be misleading,
so theming stays entirely the consumer's own concern in v1.

## Considered Options

- **CSS file consumers must `<link>` themselves, matching `siren-core`'s theme.css convention** —
  rejected for board specifically. Consistency with core's existing pattern was tempting, but
  board's whole reason to exist is removing setup steps from "display a diagram" — requiring a
  second manual `<link>` for every consumer defeats that. Core's own `theme.css` convention is
  unaffected by this; it's a deliberate divergence for board's use case, not a reversal of
  ADR-0004.
- **Controls shipped as a separate, optional companion module** (`attachDefaultControls(board)`,
  board itself has zero UI) — considered, not chosen. Keeps board's own interface narrower and its
  styling opinions out of the core mechanics, but the stated preference was "built in by default,
  but friendly to replace" rather than "nothing by default" — `controls: false | ControlsFactory`
  delivers the same replaceability without a second import most consumers would end up making
  anyway.
- **Include a Theme toggle in the default control bar now** — rejected. There is no shipped dark
  theme for it to toggle to; adding the button ahead of the theme it would control invites
  confusion (clicking it and seeing nothing change) rather than solving a real need. Revisit once
  `siren-core` ships an official second theme.
