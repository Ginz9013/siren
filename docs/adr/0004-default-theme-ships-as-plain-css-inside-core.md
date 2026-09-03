---
status: accepted
---

# The default theme is plain CSS custom properties, shipped as part of `@siren/core`

Diagram styling (colors, stroke widths, font, motion timing) was scattered as hardcoded values
across a demo-only stylesheet, with no way for any consumer besides this repo's own demos to get
consistent default styling or override it predictably. `packages/core/src/theme/default.css` is
now the single design-token source of truth — CSS custom properties (`--siren-node-fill`,
`--siren-highlight-color`, `--siren-slide-duration`, etc.) that any consumer overrides by
redeclaring them in their own CSS, exposed via `@siren/core`'s `package.json` `exports` map
(`@siren/core/theme.css`) so it travels with the package rather than living only in this repo's
demos.

## Considered Options

- **A JS theming API** (`render(source, container, { theme: {...} })`, generating or injecting
  styles programmatically) — rejected for this pass. Every animation-driving mechanism in this
  codebase is deliberately CSS-driven (ADR-0001, ADR-0002's "class toggle, not JS-driven timing"
  precedent) — a JS theme API would be a second, parallel styling mechanism competing with plain
  CSS overrides, adding surface area this slice doesn't need. Plain CSS custom properties keep
  theming inside the same mechanism the animation system already uses.
- **Multiple built-in theme variants (light/dark, etc.) now** — deferred, not rejected. This pass
  is scoped to establishing the token structure itself; additional theme files are a mechanical
  addition once the tokens they'd override already exist.
- **A separate `@siren/theme` package** — rejected for now as premature: there is exactly one
  theme, and splitting package boundaries before there's a second consumer of that boundary is
  pure overhead. Revisit if theme variants grow enough to warrant independent versioning.

## Consequences

Structural rules the animation system depends on to function (`.siren-pending` starting hidden,
every effect class carrying *some* transition/animation) live in the same file as purely cosmetic
rules (colors, stroke widths). This is deliberate — a theme override often needs to touch both at
once — but it means `default.css` is not purely "safe to delete and replace wholesale": a
consumer replacing it entirely must preserve the structural rules or step-reveal breaks. The
file's own header comment calls out which rules are which.
