---
status: accepted
---

# The default theme ships one palette, declared once, and a second theme is the consumer's

> Supersedes [ADR-0011](0011-core-ships-a-light-and-a-dark-palette.md).

`siren-core`'s `default.css` and `siren-board`'s injected chrome stylesheet each declare exactly
one set of token values, in exactly one `:root` block, and neither reads `prefers-color-scheme`
or any theme attribute. The values are the light column of siren-website's decision
`01M3BY1GPP` — unchanged from what a page with no theme pinned already saw. A consumer who wants
a second theme redeclares the tokens under a selector of their own choosing and owns when it
applies; `demos/theme-dark.css` is that done once, in full, and can be copied.

ADR-0011's mechanism was a seam with one adapter. "Light or dark" was the only variation it
admitted, and in exchange every color declaration was written three times (`:root,
[data-theme="light"]`, `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`, and
`:root[data-theme="dark"]`), a test existed solely to keep two of those copies byte-identical, and
two rules existed that nothing else needed: color tokens could not be declared alongside the
other tokens, and no color token could be aliased in `:root`. What consumers actually ask of the
tokens is wider than two palettes — brand colors, a high-contrast palette for a projector, a
single-ink palette for print — and every one of those is the same action: redeclare the tokens.
Removing the switch leaves that action untouched and takes the three copies, the consistency
test and the two rules with it.

## Considered Options

- **Keep both palettes** — rejected. The cost is paid by every maintainer reading the file and
  every test that has to know which selector a value lives under, to deliver one of the several
  variations a consumer might want. The one thing it bought that an override does not — dark
  working with no consumer CSS at all — is a default for a *page-level* decision (background,
  `color-scheme`, contrast) that core explicitly does not make.
- **Ship a second file, `siren-core/theme-dark.css`** — rejected, as ADR-0011 already rejected
  it: a consumer has to know to link it. It is also a second entry point, and the structural
  rules the animation system depends on would have to stay in sync across two files.
- **Keep only `[data-theme="light"]`, so a subtree can be pinned light** — rejected. That one
  selector is the reason `:not([data-theme="light"])` exists, so keeping it keeps the whole
  selector set. A consumer who wants one diagram to differ redeclares the tokens on its
  container, which is both simpler and not limited to "light".
- **A JS theme API** — still rejected, per ADR-0004.

## Consequences

- A reader on a dark system now sees the light palette unless the page says otherwise. That is
  the behavior change, and it is breaking for a consumer who relied on the switch; both
  packages' CHANGELOGs say so.
- siren-website pins `data-theme` and relied on Siren following it. It now carries its own dark
  override — the eleven tokens in `demos/theme-dark.css` — and that is a follow-up in that repo.
- ADR-0006's premise is restored: core ships no second palette, so there is nothing for a Theme
  button in board's control bar to switch between. The decision not to add one stands, now for
  its original reason.
- The rule that a color token is named at its point of use rather than aliased in `:root` stays,
  with a different justification: an alias in `:root` freezes the value there and defeats any
  override a consumer scopes lower, whether or not dark is involved.
- `default.css`'s one `:root` block is now the whole of its styling interface, which is what a
  consumer has to read to know what they may override.
