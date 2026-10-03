---
status: accepted
---

# Labels draw what Mermaid's HTML labels show, and draw it in SVG text

A label's **picture** is held to what Mermaid shows a reader under its own default,
`htmlLabels: true`, where a label is HTML inside a `<foreignObject>` passed through DOMPurify. A
label's **drawing** stays SVG `<text>` and `<tspan>`, and author text still reaches the DOM through
`textContent`, never `innerHTML`. Between the two sits a closed vocabulary of HTML tags that the
parser reads into the label's own model: every tag Mermaid lets through is either drawn, drawn
approximately, or refused with a diagnostic. None is ever drawn as its literal characters.

Until now the comparison baseline was `htmlLabels: false`, chosen because that is the mode that
also draws SVG text. Measured against Mermaid 11.17.2, that mode honors exactly one tag (`<br>`)
and draws every other one literally, so `A["<b>bold</b>"]` reads as `<b> bold </b>` there and as
**bold** on mermaid.live, in GitHub and in every host that keeps Mermaid's defaults. Matching the
non-default mode satisfied the letter of "a document that renders in Mermaid must render here"
while showing authors a picture they never see anywhere else.

## The vocabulary

DOMPurify 3.4.14's default allow-list, which Mermaid applies at its default `securityLevel:
"strict"`, holds 119 HTML tags. Each was put through Mermaid and sorted by what a reader sees:

| Layer | Count | Tags | Siren |
| --- | --- | --- | --- |
| Line break and text styling | 23 | `br`, `b` `strong`, `i` `em` `cite` `dfn` `var`, `u` `ins`, `s` `strike` `del`, `code` `kbd` `samp` `tt`, `small` `big`, `sub` `sup`, `q`, `mark` | Drawn: a row break, or a property of the run |
| Tags carrying attributes | 3 | `a` (`href`), `span` (`style`), `font` (`color` `size` `face`) | Drawn: `a` as an SVG `<a>`, the rest as run properties |
| Tags with no rendering of their own | 20 | `abbr` `acronym` `bdi` `bdo` `data` `time` `nobr` `label` `output` `wbr` `blink` `spacer` `content` `decorator` `element` `shadow` `slot` `menuitem` `map` `picture` | Drawn: the tag is dropped, the text is kept |
| Removed by Mermaid | 4 | `html` `head` `body` (tag dropped, text kept), `style` (removed with its content) | Removed as Mermaid removes them |
| Block | 34 | `p` `div` `h1`–`h6` `pre` `blockquote` `ul` `ol` `li` `dl` `dt` `dd` `hr` `section` `article` and the rest | **Approximated**: each block begins a new row, keeps its font (headings bold and sized, `pre` monospace, `address` italic), and a list item begins with `• ` or its number. Margins and indents are not drawn, and `marquee` does not move |
| Table | 10 | `table` `tr` `td` `th` `thead` `tbody` `tfoot` `caption` `col` `colgroup` | Refused |
| Ruby | 3 | `ruby` `rt` `rp` | Refused |
| Embedded, form, media, interactive | 22 | `img` `input` `button` `select` `textarea` `form` `video` `audio` `canvas` `details` `dialog` `template` and the rest | Refused. `<img>`'s diagnostic names Mermaid's own image shape, `A@{ img: "…" }` |

The first four layers, 50 tags, are drawn as Mermaid draws them. The block layer is the one
deliberate approximation, and each such case is a compatibility-corpus row saying so. The last
three layers are the "not implemented yet is rejected with a clear error" clause, not a
divergence: in public `.mmd`/`.mermaid` files the 35 tags together appear in 16 files out of
about 3,000, 15 of them `<img>`, against roughly 2,500 for `<br>`.

What Mermaid does around the tags is followed too, and each item was measured:

- `<br>`, `<br/>`, `<br />` and `<BR>` are one row break, and so is a `<br>` carrying
  attributes, such as `<br class="x">`. Mermaid's own `/<br\s*\/?>/gi` does not match that
  last spelling, but it is the SVG mode's rule: in HTML mode DOMPurify keeps the element and
  the browser breaks the line, so that is the picture.
- A tag outside the allow-list is dropped and its text kept. `script`, `iframe`, `noscript`,
  `noembed`, `xmp` and `plaintext` are removed together with their content.
- An attribute DOMPurify removes (`onclick`, a `javascript:` URL) is dropped, and the tag it was
  on is still drawn.
- Tags work in a quoted or unquoted label, in a Markdown string alongside `**` and `*`, and in
  edge labels, subgraph titles, class labels, state descriptions, ER aliases and ER attribute
  comments.
- Entity codes resolve: `#quot;`, `#35;`, `#amp;` become `"`, `#`, `&`, in sequence diagrams
  too.
- `<span style>` takes any CSS in Mermaid. Siren draws the ten properties SVG text can carry
  (`color`, `background-color`, `font-size`, `font-weight`, `font-style`, `font-family`,
  `text-decoration`, `letter-spacing`, `word-spacing`, `opacity`) and raises a warning naming
  any other property it did not draw.
- A label link inside a node that is itself a `click` link is kept, as Mermaid keeps it: the
  inner link takes clicks on its own text and the node's link takes the rest.
- What the browser's default stylesheet paints in Mermaid's picture (link blue `#0000ee`, the
  yellow `<mark>` background and its black text) becomes three theme tokens with those
  defaults, so a consumer's theme can repaint them as it repaints everything else.
- Relative sizes (`small`, `big`, `sub`, `sup`, headings, `<font size>`) scale from Siren's
  own font size by the browser's ratios. An absolute size an author wrote, such as
  `font-size: 20px`, is drawn as written.
- **A sequence diagram honors `<br>` and nothing else.** Mermaid draws sequence text as SVG in
  both modes, so there the literal characters of every other tag *are* the picture, and Siren
  keeps them.
- **A class member honors nothing.** Mermaid escapes a member's text in both modes, so
  `+id<br/>int` and `+<b>id</b> int` are drawn literally, with `<br/>` spelled `<br>`. Siren
  keeps a member as written.

## Considered Options

- **Draw labels in a `<foreignObject>`, as Mermaid's default does** — rejected. It would make
  author text markup, which needs a sanitizer in `siren-core` and gives up the
  `textContent`-never-`innerHTML` rule every renderer states. `TextMeasurer.measure(text)` could
  not size an HTML box, so layout would need a live DOM, which the test environment does not
  lay out. Author `color`, which `resolveStyles` turns into `fill`, would have to work in two
  paint models, because sequence text stays SVG either way. A `<foreignObject>` is also the part
  of an SVG most likely to vanish when the file is used as an `<img>`, rasterized, or opened in a
  vector editor. All of that would buy the three refused layers, which almost no document uses.
- **Keep `htmlLabels: false` as the baseline** — rejected for the reason above: it is the
  mode readers do not see.
- **Draw every allowed tag** — not possible in SVG text. Tables, ruby and form controls need a
  layout engine that SVG text does not have.
- **Define Siren's own tags or label syntax** — out of scope. Every behavior here is a
  measurement of Mermaid. A label construct Mermaid does not have needs its own ADR first.

## Consequences

- `scripts/mermaid-probe.mjs` currently names `htmlLabels: false` as "the form Siren draws".
  After this change it is the source of the DOM structure (rows as `<tspan>`), while the
  `htmlLabels: true` reading is the picture Siren is held to.
- A label is no longer a plain string with optional Markdown runs. It is rows of runs whose
  properties are wider than bold and italic, in every diagram kind, so layout measures a label
  row by row everywhere, not only for a flowchart node.
- Mermaid's HTML mode also wraps long labels at a fixed width, which its SVG mode handles
  differently. That is a separate measurement and a separate board.
- Mermaid's image shape, icon shape and `fa:` icons are Mermaid syntax and belong to the
  compatibility work, but they are not labels. They are a separate board.
