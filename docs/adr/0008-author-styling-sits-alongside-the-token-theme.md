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

## Amendment (recording the label-text gap)

The Consequences above note that a document hardcoding `fill:#fdd` keeps its pink box in a dark
theme. In practice the sharper consequence is not the box — it is the text on it, and it is worth
writing down explicitly because it is what an author actually hits.

Every piece of text a class draws takes its color from the token theme and only from it:
`.siren-class-name`, `.siren-member` and `.siren-class-annotation` all resolve to
`var(--siren-node-text)`. There is no `--siren-class-*` token family at all — the class diagram
reuses the node tokens wholesale. `applyAuthorStyle` writes to the frame rect and nothing else, by
the placement argument above. So an author directive can change what is *behind* the text but can
never change the text, and the two halves of one box end up governed by different systems. Set an
opaque light `fill` and a dark theme still paints light label text on it; set an opaque dark `fill`
and a light theme does the mirror image. Either way the box is unreadable, and the author has no
directive available to fix it — the failure is not that their style was ignored, it is that it was
applied *halfway*.

The repo's current answer is avoidance: `examples/class-full.srn` styles every class with an
alpha-carrying fill (`fill:#f59e0b33`) so the themed background shows through and the token text
color stays legible against it, with a `%%` comment saying why. That works, and it is the right
guidance for today, but it lives in one example's comment rather than anywhere an author would
look — and it is a workaround for a gap, not a design.

This amendment does not change the decision: styling the drawn shape remains correct, for the
precedence reason given above, and the frame stays the target for box properties. What it records
is the shape of the fix when this is taken up.

The leading option is to **route declarations by property** rather than to widen what one element
receives: box properties (`fill`, `stroke`, `stroke-width`, ...) keep going to
`.siren-class-frame`, and `color` — spelled exactly as Mermaid's `classDef` already spells it —
is emitted onto the class's `<text>` elements instead. That keeps every argument in this ADR
intact. It is still an inline `style` attribute, so it still outranks the theme's class rules
without `!important`; it still lands directly on the element the theme styles, so nothing is
resolved by inheritance; and the one validation gate in `buildClassModel` still sees every
declaration before it is emitted. It is also a compatibility gain rather than an invention:
`color:` is what a Mermaid author already writes to recolor a label, and today Siren accepts that
declaration and silently paints it onto a rect that has no text in it.

The alternative of translating an author's `fill` into a scoped `--siren-node-text` override is
the "map author declarations onto the tokens" option this ADR already rejected, and rejects again
for the same reason: it only works for the properties that happen to have a token, and it makes
the author's declaration mean something they did not write.

Until that lands, author styling stays documented as local emphasis with a known limit — a style
reaches a class's frame, never its label text — and translucent fills remain the recommended way
to stay theme-safe.
