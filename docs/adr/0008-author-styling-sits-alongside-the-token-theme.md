---
status: accepted
---

# Author styling is emitted as inline `style` attributes alongside the token theme, not as a generated `<style>` block

The class diagram is the first diagram kind to accept author-level styling directives — `style X
fill:#fdd,stroke:#c00`, `classDef name ...` plus `cssClass "A,B" name`. That introduces a second
styling mechanism into a codebase that already has one: ADR-0004's `--siren-*` design tokens in
`packages/core/src/theme/default.css`, which a consumer themes by redeclaring the custom
properties in their own CSS.

The two are given different jobs rather than made to compete. The token theme remains the
**global default for every diagram kind** — ADR-0004 is unchanged and unnarrowed by this. An
author directive is a **local override, scoped to the one document that declares it**, resolved by
`buildClassModel` into a `ResolvedClassStyle` per styled class and emitted by
`renderClassDiagramToSVG` as an inline `style` attribute on that class's drawn shape (the
`<rect class="siren-class-frame">`, not its enclosing `<g class="siren-class">`).

The deciding property is CSS precedence, and it is the whole reason inline won. An inline `style`
attribute outranks any class-selector rule in the cascade without needing `!important`. That is
exactly the precedence an author expects from "style *this one* class": they wrote
`style Animal fill:#fdd` about one box in one diagram, and they expect it to win over the
stylesheet's blanket default for every box everywhere. Getting that outcome any other way means
either escalating specificity or reaching for `!important` — and `!important` is a door that only
opens once, because a consumer who then wants to override *back* has nothing stronger left to say.

The same precedence argument dictates *which element* carries the attribute. The theme styles
`.siren-class-frame` directly, and in CSS a directly-applied declaration always beats an inherited
one, regardless of specificity. A `fill` parked on the enclosing `<g>` would therefore be
inherited by the frame and lose to the theme's own rule — the box would simply not change color —
while also leaking down into the class's `<text>` elements, which the author did not ask to
recolor. Styling the drawn shape is the only placement where the author's declaration actually
lands.

## Considered Options

- **Generate an in-SVG `<style>` block with generated class names** — the main rejected
  alternative. The renderer would collect the document's styles, mint a class name per distinct
  declaration set (`siren-author-1`, ...), emit a `<style>` element into the SVG, and put the
  generated name on each target. Rejected on three counts. *Precedence*: a generated class rule
  competes with the theme's class rules on specificity, so whether `style Animal fill:#fdd` beats
  `.siren-class-frame { fill: var(--siren-class-fill) }` comes down to selector shape and source
  order — a rule the author cannot see and we would have to keep hand-tuning as the theme grows.
  Inline sidesteps the contest entirely. *Scope*: a `<style>` element inside an inline SVG is not
  scoped to that SVG; it applies to the whole document. Two Siren diagrams on one page would have
  to coordinate their generated names to avoid restyling each other, which is a global namespace
  problem we would be inventing for ourselves. *Surface area*: a `<style>` block is a far larger
  sink for author input than a `style` attribute. An attribute value can only ever be declarations
  applying to the element it sits on; a stylesheet's contents are selectors too, so an escape past
  the value's validation could restyle anything on the host page. The validation in
  `buildClassModel` is the same either way, but the blast radius of a hole in it is not.
- **A JS styling API** (`render(source, container, { styles: {...} })`) — out of scope and against
  ADR-0004, which already rejected a JS theming API for the global case. Author styling is written
  *in the document*, next to the diagram it decorates, exactly like the timeline block (ADR-0002).
  Routing it through a JS option would split one authoring concern across two files.
- **Map author declarations onto the `--siren-*` tokens** (translate `fill:#fdd` into a scoped
  `--siren-class-fill: #fdd`) — rejected as a lossy translation layer. It only works for the
  properties that happen to have a token, so `stroke-width` or `opacity` would need a token
  invented for each, and the author's declaration would silently do nothing until one was. The
  tokens exist to let a *consumer* retheme every diagram at once; an author styling one box is a
  different question and does not need to go through them.

## Consequences

An inline style is the strongest thing in the cascade short of `!important`, so a consumer's own
stylesheet can no longer restyle a class the document's author explicitly styled — they would need
`!important` to take it back. That is the intended trade (the author was specific, the consumer was
blanket), but it does mean an author directive is not a suggestion: a document that hardcodes
`fill:#fdd` will keep that pink box in a dark theme, where the token theme would have adapted. The
tokens remain the right tool for anything meant to follow the theme, and author styling is
documented as local emphasis rather than as a theming mechanism.

Because the declarations are emitted verbatim, the validation gate stays load-bearing and stays in
exactly one place: `buildClassModel` rejects a value containing `url(`, `expression(`, `;` or a
backslash, and the renderer re-checks nothing. Anything that widens the styling syntax later must
widen that gate deliberately, not incidentally — the renderer will faithfully emit whatever reaches
it.

There is no specificity model between author directives, consistent with the board's non-goal:
`style`, `classDef` and `cssClass` all flatten into one ordered property list per class, last
declaration of the same property winning by ordinary CSS rules within the attribute. Nothing
cascades between classes, so there is no inheritance behavior to specify or to surprise anyone.
