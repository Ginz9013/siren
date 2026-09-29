---
status: accepted
---

# `siren-core`'s default theme ships a light and a dark palette, and the page picks between them

The default theme's colors are now the violet palette of siren-website's decision `01M3BY1GPP`,
chosen so a Siren diagram is never mistaken for a Mermaid one, and `default.css` declares it
twice: a light set, and a dark set that follows the system's `prefers-color-scheme` unless the
page pins a theme with `<html data-theme="light|dark">`. The light set is also declared on any
element carrying `data-theme="light"`, so one subtree can stay light inside a dark page. Only the
five color tokens change between the two; sizing, type and motion tokens stay single-valued at
`:root`. The dark set is written twice — once under the media query, once under
`:root[data-theme="dark"]` — because a media query and an attribute selector cannot share one
rule, and a test keeps the two copies identical.

This carries out the light/dark variants ADR-0004 deferred, and removes the premise of ADR-0006's
decision not to put a Theme button on the board: core now ships a second palette. The decision
itself stands. Switching is still the page's job — it sets one attribute on `<html>`, which every
board on the page and the page's own chrome react to together — so a per-board button would be a
second, narrower switch that could disagree with the page's.

## Considered Options

- **Dark stays the consumer's override** — rejected. Every consumer that wanted dark (the
  website, this repo's demos) wrote the same override, each with its own values; the website's
  had already drifted from the demos'. Shipping one makes the brand's dark colors Siren's, not
  each consumer's.
- **A separate `theme-dark.css`** — rejected. A consumer would have to know to link it, and the
  structural rules in `default.css` would still need the dark values to exist before they
  resolve anything.
- **A Siren-specific attribute (`data-siren-theme`)** — rejected. The pin is meant to be the
  page's own theme switch; asking a page to set two attributes that must agree invites exactly
  the disagreement a single switch avoids. `data-theme` is what siren-website already sets.

## Consequences

- A page that sets `data-theme` for its own reasons now also switches the diagram's palette.
  That is intended; a page that wants the diagram fixed pins a subtree with `data-theme="light"`
  or redeclares the tokens.
- `siren-board` follows the same selectors for its own chrome tokens, per ADR-0006's split: core
  does not know board's chrome exists.
- Core still declares no page background and no `color-scheme`; those remain the page's.
