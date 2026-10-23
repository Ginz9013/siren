# siren-core

[![npm](https://img.shields.io/npm/v/siren-core.svg)](https://www.npmjs.com/package/siren-core)
[![license](https://img.shields.io/npm/l/siren-core.svg)](https://github.com/Ginz9013/siren/blob/main/LICENSE)

**Mermaid-syntax diagrams that animate step by step.**

Siren lets you write a diagram and its animation in the same plain-text document. The
diagram part uses Mermaid syntax. The optional `timeline:` block below it says, step by
step, what to reveal, highlight or remove. `siren-core` turns that document into an SVG
and gives you a controller that plays the steps.

```
flowchart TB
  A[Start]
  A --> B[Fetch data]
  B --> C[Transform]
  C --> D[Publish]

timeline:
  enter B fade, enter A-B fade
  enter C fade, enter B-C fade
  enter D fade, enter C-D fade
  highlight B outline
  highlight D glow, unhighlight B
```

Use it to walk an audience through an architecture in a talk, explain a flow in docs one
step at a time, or build any UI where a diagram should unfold instead of appearing all at
once.

> Want a ready-made player with Prev/Next buttons, pan and zoom? Use
> [`siren-board`](https://www.npmjs.com/package/siren-board), which is built on this package.

## Contents

- [Features](#features)
- [Concepts](#concepts)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Writing a timeline](#writing-a-timeline)
- [API](#api)
- [Theming](#theming)
- [Mermaid compatibility](#mermaid-compatibility)
- [Layout engine](#layout-engine)
- [Environment](#environment)
- [License](#license)

## Features

- **Five diagram types**: flowchart, sequence, class, state and ER diagrams, written in
  Mermaid syntax.
- **Declarative animation**: enter and exit transitions, and highlights, described in plain
  text next to the diagram instead of in code.
- **One self-contained document**: the diagram and its animation live in one `.srn` file
  that you can copy, paste and version like any text.
- **Its own renderer**: Siren parses, lays out and draws the SVG itself. It does not load
  or wrap Mermaid.
- **Errors, not guesses**: problems come back as diagnostics with line and column numbers.
  Siren doesn't throw on a bad document, and it doesn't draw a construct it can't draw
  correctly.
- **Themeable**: one stylesheet of CSS custom properties — one palette, declared once, and
  a second theme is a few lines of your own CSS.
- **TypeScript types included**.

## Concepts

**Siren document.** A plain-text document with a Mermaid diagram, optionally followed by
one unnamed `timeline:` block or several named `timeline <name>:` blocks. The conventional
file extension is `.srn`.

**Timeline.** One block of a document: everything from its `timeline:` or
`timeline <name>:` header to the next header or the end of the document. Each non-blank line
is one **step**. Steps are numbered by their position, starting from 1.

**Step 0.** The picture before the first step. Anything the timeline introduces with
`enter` is hidden at step 0. Everything the timeline never mentions is visible from the
start.

**Timeline action.** One `<verb> <id> [effect]` instruction inside a step, such as
`enter B fade`. A step can hold several actions, separated by commas, and they play
together.

**Timeline target.** The thing an action names by id: a node, an edge, a class, a
participant, a message and so on. See [Target ids](#target-ids).

**Controller.** The object `render()` returns for playing the timeline. Call `next()`,
`prev()` and `reset()` to move between steps.

**Diagnostic.** An error or warning about the document, returned from `render()` together
with the line and column it refers to.

## Installation

```sh
npm install siren-core
# or
pnpm add siren-core
# or
yarn add siren-core
```

`siren-core` is an ES module. It needs a DOM to render into, so it runs in the browser.
See [Environment](#environment) for other setups.

## Quick start

### With a bundler (Vite, webpack, Next.js, ...)

```html
<div id="diagram"></div>
<button id="prev">Prev</button>
<button id="next">Next</button>
<span id="status"></span>
```

```js
import { render } from "siren-core";
import "siren-core/theme.css"; // required, see "Theming"

const source = `flowchart LR
  A[Request] --> B[Validate] --> C[Save]

timeline:
  enter B fade, enter A-B fade
  enter C slide-right, enter B-C fade
  highlight C glow`;

const { svg, controller, diagnostics } = render(source, document.getElementById("diagram"));

if (svg === null) {
  // Rendering failed. The diagnostics say why.
  for (const d of diagnostics) console.error(`${d.line}:${d.column} ${d.message}`);
} else {
  const status = document.getElementById("status");
  const update = () => (status.textContent = `${controller.currentStep} / ${controller.totalSteps}`);

  document.getElementById("next").onclick = () => { controller.next(); update(); };
  document.getElementById("prev").onclick = () => { controller.prev(); update(); };
  update();
}
```

### Without a bundler

The package also ships `dist/siren-core.js`, a single ES module that includes every
dependency — including the [elkjs](https://github.com/kieler/elkjs) layout engine, which is
licensed EPL-2.0, not MIT, and the [js-yaml](https://github.com/nodeca/js-yaml) frontmatter
parser (MIT); their licences and notices ship beside the bundle as `dist/THIRD-PARTY-NOTICES.md`.
You can load it directly from a CDN:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/siren-core@0.8/dist/theme.css" />

<div id="diagram"></div>

<script type="module">
  import { render } from "https://cdn.jsdelivr.net/npm/siren-core@0.8/dist/siren-core.js";

  const { controller } = render(
    "flowchart LR\n  A --> B\n\ntimeline:\n  enter B fade",
    document.getElementById("diagram"),
  );
  document.addEventListener("keydown", (e) => e.key === "ArrowRight" && controller?.next());
</script>
```

### Loading a `.srn` file

```js
const source = await fetch("/diagrams/checkout.srn").then((r) => r.text());
render(source, container);
```

## Writing a timeline

This section covers the essentials. The files in
[`examples/`](https://github.com/Ginz9013/siren/tree/main/examples) show every diagram
type with a full timeline.

### Actions

| Action                          | Effect                                                    | What it does                                  |
| ------------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| `enter <id> <effect>`           | `fade`, `slide-left`, `slide-right`, `slide-top`, `slide-bottom` | Reveals the target. It is hidden until this step. |
| `exit <id> <effect>`            | `fade`, `slide-left`, `slide-right`, `slide-top`, `slide-bottom` | Removes the target from the picture.          |
| `highlight <id> <effect>`       | `outline`, `glow`                                         | Emphasizes the target until it is unhighlighted. |
| `unhighlight <id>`              | none                                                      | Removes a highlight.                          |

Several targets can be highlighted at the same time. Highlighting an already highlighted
target replaces its effect.

```
timeline:
  enter Cache fade, enter API-Cache fade
  highlight Cache outline
  highlight DB glow, unhighlight Cache
  exit Cache slide-left, exit API-Cache fade
```

Moving backwards with `prev()` undoes each step exactly, so every step can be revisited.

### Target ids

A node, class, state, participant or entity is named by the id you wrote for it. A
connection is named by the ids at its two ends.

| Diagram   | Target                             | Id                              |
| --------- | ---------------------------------- | ------------------------------- |
| Flowchart | Node                               | `A` in `A[Label]`               |
|           | Edge                               | `A-B` for `A --> B`             |
|           | Subgraph                           | `subgraph:1`, `subgraph:2`, ... in written order |
| Sequence  | Participant / actor                | `Client`                        |
|           | Message                            | `Client-Server`                 |
|           | `loop`, `alt`, `rect`, `box`, ...  | `loop:1`, `rect:1`, `box:1`, ...  |
|           | Note                               | `note:1`, `note:2`, ...         |
|           | Activation bar                     | `activation:1`, ... in the order bars open |
| Class     | Class                              | `Order`                         |
|           | Relationship                       | `Order-LineItem`                |
|           | Namespace / note                   | `namespace:1`, `note:1`, ...    |
| State     | State / composite state            | `Idle`, `Outer`                 |
|           | Transition                         | `Idle-Working`                  |
|           | `[*]` start / end                  | `start:1`, `end:1`              |
| ER        | Entity                             | `CUSTOMER`                      |
|           | Relationship                       | `CUSTOMER:ORDER`                |

When the same pair is connected more than once, the second connection is `A-B#2`, the
third `A-B#3`, and so on.

If an action names an id that doesn't exist, `render()` reports a diagnostic that points to
that line.

### Several timelines in one document

When one diagram has more than one story to tell, give each its own named block instead of
copying the diagram into a second file. A named block starts with `timeline <name>:` and
runs to the next timeline header or the end of the document. A name is letters, digits, `_`
and `-`, and is case-sensitive.

```
flowchart LR
  Cart --> Card --> Done
  Cart --> Wallet --> Done

timeline card:
  enter Card fade, enter Cart-Card fade
  enter Done fade, enter Card-Done fade

timeline wallet:
  enter Wallet fade, enter Cart-Wallet fade
  enter Done fade, enter Wallet-Done fade
```

Each block is a timeline of its own: its steps count from 1, and anything *that block* never
mentions is visible at its step 0. A diagnostic about a named block starts with
`timeline <name>:`. A document uses either one unnamed `timeline:` block or named blocks,
never both, and a name can be used only once. A header is exactly `timeline:` or
`timeline <name>:`, with nothing between the name and the colon. Any other line starting
with `timeline` is not a header and is read as ordinary syntax.

`render()` applies the first block unless you pass another name (see
[`RenderOptions`](#renderoptions)). Every block is checked on every render, whichever one is
shown. A viewer that never passes a name still works, but only ever shows the first block.

## API

### `render(source, container, options?)`

Parses `source`, draws it into `container`, and returns a `SirenRenderResult`.

```ts
function render(source: string, container: HTMLElement, options?: RenderOptions): SirenRenderResult;
```

When rendering succeeds, the new `<svg>` replaces the container's children. When it fails,
the container is left untouched, so a previously rendered diagram stays on screen. Call
`render()` again with the same container to re-render.

### `SirenRenderResult`

| Property      | Type                           | Description                                                                 |
| ------------- | ------------------------------ | --------------------------------------------------------------------------- |
| `svg`         | `SVGSVGElement \| null`        | The rendered diagram, or `null` if rendering failed.                        |
| `controller`  | `AnimationController \| null`  | Plays the timeline. It is `null` exactly when `svg` is `null`.               |
| `diagnostics` | `Diagnostic[]`                 | Every error and warning, from all stages. Can be non-empty on success.       |
| `timelines`   | `string[]`                     | The names of the named timeline blocks, in document order. `[]` when there are none, when the only block is the unnamed `timeline:`, or when rendering failed. |
| `styles`      | `StyleFact[]`                  | What the document's `style`, `classDef`, `class`/`:::` and `linkStyle` statements did, one fact per drawn target they reached with a declaration that was not refused. `[]` for a sequence diagram or when rendering failed. |
| `siren`       | `unknown`                      | The frontmatter's top-level `siren:` value, exactly as its YAML reads, for your own use. Siren does not interpret, validate or report on it, and Mermaid ignores it. Still returned when rendering failed; `undefined` when there is no `siren:` key, no frontmatter, or the frontmatter itself is rejected. |

A document without a `timeline:` block still gets a controller, with `totalSteps: 0`.

A `StyleFact` states what the author wrote. It is not changed by what the timeline does to the
drawing:

| Property    | Description |
| ----------- | ----------- |
| `id`        | The target's `data-siren-id`. A flowchart or ER subgraph's id is `subgraph:N`, not the handle the author styled it by. |
| `kind`      | `"node"`, `"edge"`, `"subgraph"`, `"class"`, `"state"` (a composite state included) or `"entity"`. |
| `classes`   | The `classDef` names applied to it, in the order they were applied. A flowchart node lists `default` first when the document defines one. A defined class is listed even when none of its declarations survived; a name no `classDef` defines is not. |
| `effective` | The declarations that won, as `{ frame, text }` lists of `{ property, value }`. The text half is spelled the way SVG paints text, so an author's `color` appears there as `fill`. |
| `sources`   | `{ frame, text }`, index for index with `effective`: the statement each declaration came from. Each is `{ via: "classDef", name }`, `{ via: "style" }`, `{ via: "linkStyle" }` or `{ via: "linkStyle default" }`. |

### `AnimationController`

| Member        | Description                                                  |
| ------------- | ------------------------------------------------------------ |
| `currentStep` | The step being shown. `0` is the initial picture.            |
| `totalSteps`  | The number of steps in the timeline.                         |
| `next()`      | Plays the next step. Does nothing on the last step.          |
| `prev()`      | Goes back one step. Does nothing at step 0.                  |
| `reset()`     | Returns to step 0.                                           |

### `Diagnostic`

```ts
interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  line?: number;   // 1-based
  column?: number; // 1-based
}
```

An `error` means that part of the document couldn't be used. A `warning` means it was
used, but something about it is suspicious. `render()` reports problems in the document
through diagnostics and does not throw for them.

### `RenderOptions`

| Option             | Type                                   | Description                                                                   |
| ------------------ | -------------------------------------- | ----------------------------------------------------------------------------- |
| `measureText`      | `TextMeasurer`                         | Measures label text to size boxes. See below.                                 |
| `onClick`          | `(target: InteractionTarget) => void`  | Called when a reader clicks an element made clickable with `call`.            |
| `timeline`         | `boolean \| string`                    | Which timeline to apply. A document may declare several, and by default only the first applies. See below. |
| `iconPacks`        | `IconifyJSON[]`                        | Icon packs a flowchart's icon nodes (`A@{ icon: "fa:user" }`) are drawn from. See below. |
| `omitAuthorStyles` | `string[]`                             | Author style properties not to draw, such as `["fill", "stroke", "color"]`. See below. |
| `typography`       | `Partial<Typography>`                  | The px font sizes your theme draws at, so boxes are sized for them. See [Measuring text](#measuring-text). |

#### Registering icon packs

An icon node names its icon as `prefix:name`. Pass each pack it draws from as
[Iconify JSON](https://iconify.design/docs/types/iconify-json.html); Siren loads and fetches
nothing, so an icon whose pack is not passed is an error diagnostic.

```ts
import fa from "@iconify-json/fa6-solid/icons.json";

render('flowchart TB\n  A@{ icon: "fa6-solid:user", form: circle, label: "User" }', container, {
  iconPacks: [fa],
});
```

An icon's SVG is drawn through an allowlist of shapes, groups, gradients, clips and masks, so
script, event handlers, links and references outside the icon in a pack are never drawn.

An image node (`A@{ img: "data:image/png;base64,…" }`) needs no option: Siren draws an image only
from a `data:` URL the document holds (PNG, GIF, JPEG, WebP or SVG, up to 4 MB), and refuses one at
any other URL, since it never fetches while drawing.

#### Choosing a timeline

`true`, or leaving the option out, applies the unnamed `timeline:` block, or else the first
named block. A string applies the named block of that name; `result.timelines` lists the
names a document declares, so a viewer can offer them as a choice.

```ts
const { timelines } = render(source, container);              // ["card", "wallet"]
const wallet = render(source, container, { timeline: "wallet" });
```

A name the document does not declare throws a `RangeError` that lists the names it does
declare. That is a mistake in the calling code, not in the document, so it is not a
diagnostic, and the container is left untouched. A document that fails to render returns
its diagnostics as usual instead, whatever name you passed. The diagnostics never depend on
which timeline is applied.

#### Drawing without the timeline

`timeline: false` draws the picture Mermaid draws for the same document: every element
visible, no enter, exit or highlight state, and a controller with `totalSteps: 0`. That is
not the timeline's last step, which still hides whatever exited. Every timeline block is
still parsed and checked, so `diagnostics`, and whether the render succeeds, are the same
as without the option.

#### Leaving out the author's colors

`omitAuthorStyles` lists author style properties, spelled as the author writes them, that are
not drawn. Each element they would have styled takes the theme's design tokens instead, which
lets a page that colors targets itself, by redeclaring tokens on a target's `data-siren-id`
element, keep the author's colors from covering its own:

```ts
render(source, container, { omitAuthorStyles: ["fill", "stroke", "color"] });
```

`color` leaves out the color an author style gives a label, and `fill` only the frame's.
Colors written in a label's own markup (`<span style="color:…">`, `<font color>`,
`background-color`) are not author styles: they are drawn as written, the option never removes
them, and they have no entry in `styles`. An edge whose `stroke` is left out gets the theme's
arrowhead. Properties not listed, such as `stroke-width`, are drawn as written.
The option only takes declarations away; it cannot add one. `diagnostics` and `styles` are the
same with or without it. A name no declaration uses is not an error, and `[]` is the same as
leaving the option out.

#### Measuring text

By default, labels are sized with a fixed-width estimate, because that works everywhere,
including in tests. In a browser, pass a measurer backed by a `<canvas>` so boxes fit
their labels exactly:

```js
const ctx = document.createElement("canvas").getContext("2d");
ctx.font = "14px system-ui, sans-serif"; // your --siren-font-size and --siren-font-family

render(source, container, {
  measureText: {
    // Return the size of the box a label needs, padding included.
    measure: (text) => ({ width: ctx.measureText(text).width + 24, height: 32 }),
  },
});
```

`siren-board` does this for you.

The measurer is only ever asked about a string, so layout has to be told what size it
measures at. That is `typography`: the px sizes your theme's text tokens draw at.

```ts
interface Typography {
  fontSize: number;      // --siren-font-size, default 14
  labelFontSize: number; // --siren-label-font-size, default 12
  titleFontSize: number; // --siren-title-font-size, default 18
}
```

**`measureText` must measure at `typography.fontSize`.** From that size, layout spaces a
label's rows 1.5 × the size apart (a sequence diagram keeps its own spacing, 19/16 of the size
for a message, a note or a block condition and one size for a participant), scales the measurer's
answer by `labelFontSize / fontSize` for a connector's label, wraps a label at a width in
proportion to its size, measures a subgraph's, namespace's, ER subgraph's or composite state's
title at `fontSize`, and makes a sequence diagram's title band 40px × `titleFontSize / 18`. An
author's `font-size:20px` in a label counts against `fontSize` too. A field left out takes
the default, exported as `DEFAULT_TYPOGRAPHY`; leaving `typography` out, passing `{}` and
passing `DEFAULT_TYPOGRAPHY` draw the same picture. The default estimate reads none of it.

If you change a size token, pass the same size here and measure in it:

```js
const fontSize = 16; // :root { --siren-font-size: 16px; }
ctx.font = `${fontSize}px system-ui, sans-serif`;

render(source, container, {
  typography: { fontSize },
  measureText: {
    measure: (text) => ({ width: ctx.measureText(text).width + 24, height: fontSize * 1.5 + 11 }),
  },
});
```

Siren cannot read the tokens itself, since it has to work in jsdom, which resolves no custom
property; `siren-board` reads them for you. A size that is not a finite number above 0 throws a
`RangeError` naming the field. That is a mistake in the calling code, so it is not a
diagnostic, and the container is left untouched.

Two labels are sized at `fontSize` though the theme draws them at `--siren-label-font-size`:
a sequence diagram's block condition (the `[...]` after `alt`, `loop` and the rest), and a class
diagram's lollipop interface name and `«annotation»`. Layout leaves them the room text at
`fontSize` takes, as it always has.

#### Click interactions

Mermaid's `click` syntax works in flowcharts and class diagrams:

```
flowchart LR
  A[Docs] --> B[API]
  click A href "https://example.com/docs" "Read the docs" _blank
  click B call showDetails("api")
```

An `href` becomes a normal link, with an optional tooltip and target; `href` itself may be
left out (`click A "https://..."`). A tooltip shows when the reader hovers the element. For `call`, Siren never looks up or runs the named
function. It passes the name to `onClick`, and your code decides what happens:

```js
render(source, container, {
  onClick: ({ id, action, argument }) => {
    // id: "B", action: "showDetails", argument: "api"
    if (action === "showDetails") openPanel(argument);
  },
});
```

This keeps an untrusted document from running arbitrary code on your page.

## Theming

Import `siren-core/theme.css` once. It is required, not just cosmetic: it contains the
rules that hide elements before their step and play the transitions.

```js
import "siren-core/theme.css";
```

### A second theme (dark, high-contrast, print)

The theme is one palette. Siren never picks one for you: nothing in `theme.css` reads
`prefers-color-scheme` or any attribute on the page, so a second theme is yours to declare
and yours to decide when it applies. Redeclare the color tokens under whatever selector
fits — a media query, a theme attribute your app already sets, a container class. That is
the five-color palette, plus `--siren-label-link`: its default is the browser's link blue,
which is unreadable on a dark node; and `--siren-edge-label-fill`, whose default is a
translucent white background behind every connector label, made for a white canvas:

```css
/* Follow the reader's system preference... */
@media (prefers-color-scheme: dark) {
  :root {
    --siren-node-fill: #2a2144;
    --siren-node-stroke: #b69cff;
    --siren-node-text: #ece8f8;
    --siren-edge-stroke: #8e88a3;
    --siren-highlight-color: #2dd4bf;
    --siren-label-link: #9cc7ff;
    --siren-edge-label-fill: rgb(20 17 29 / 0.8);
  }
}

/* ...or let your own theme switch decide, on any element you like. */
[data-theme="dark"] {
  --siren-node-fill: #2a2144;
  /* ...the same seven. */
}
```

Those are Siren's own dark values, and the repo's
[`demos/theme-dark.css`](https://github.com/Ginz9013/siren/blob/main/demos/theme-dark.css)
is this done in full — the seven above, the `<mark>` pair, and `siren-board`'s six chrome
tokens — ready to copy.

Scoping the override lower than `:root` works the same way, which is how one diagram on a
page differs from the rest — declare it on the container you pass to `render()`, and the
tokens are inherited by the SVG inside it:

```css
#intro-diagram { --siren-node-fill: #ffffff; }
```

### Custom colors, fonts and timing

Override any `--siren-*` custom property in your own CSS:

```css
:root {
  --siren-node-fill: #fef3c7;
  --siren-node-stroke: #d97706;
  --siren-highlight-color: #dc2626;
  --siren-font-family: "Inter", sans-serif;
  --siren-fade-duration: 400ms;
}
```

| Group     | Tokens                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| Colors    | `--siren-node-fill`, `--siren-node-stroke`, `--siren-node-text`, `--siren-edge-stroke`, `--siren-highlight-color`, `--siren-subgraph-fill` (`none`, the frame of a flowchart subgraph, an ER subgraph or a composite state) |
| Text      | `--siren-font-family`, `--siren-font-size`, `--siren-label-font-size`, `--siren-title-font-size`                  |
| Lines     | `--siren-stroke-width`, `--siren-edge-thick-stroke-width`, `--siren-edge-dash`, `--siren-lifeline-dash`, `--siren-note-link-dash`, `--siren-highlight-stroke-width` |
| Shapes    | `--siren-node-border-radius`, `--siren-box-fill-opacity`                                                           |
| Motion    | `--siren-fade-duration`, `--siren-slide-duration`, `--siren-slide-distance`, `--siren-highlight-duration`, `--siren-edge-march-dash` (`9 5`, the dash an animated edge marches), `--siren-edge-march-offset` (`900`, how far one march cycle moves the dash), `--siren-edge-march-fast-duration` (`20s`, one cycle of a fast animated edge), `--siren-edge-march-slow-duration` (`50s`, one cycle of a slow animated edge) |
| Label paint | `--siren-label-mark-fill` (`#ff0`, the rect behind `<mark>` text), `--siren-label-mark-text` (`#000`, `<mark>` text), `--siren-label-link` (`#0000ee`, `<a href>` link text), `--siren-edge-label-fill` (`rgb(255 255 255 / 0.8)`, the background behind every connector label) |

The first three label-paint tokens are what the browser's default stylesheet paints these tags
with in Mermaid's HTML labels; `--siren-edge-label-fill` is the translucent background Mermaid puts
behind an edge label, so a line passing under the label does not cross its text. They sit outside the five-color palette, so a marked or linked run
looks the same whichever palette is in use, unless you repaint them — and a dark palette
should repaint `--siren-label-link`, as in the example above.

The text tokens change what the browser draws, not how large layout makes the boxes. If you
change `--siren-font-size`, `--siren-label-font-size` or `--siren-title-font-size`, pass the
same sizes to `render()` as `typography` (see [Measuring text](#measuring-text));
`siren-board` reads them for you.

Per-element styling from the document itself (`classDef`, `class`, `style`, `linkStyle`,
`:::name`) works as it does in Mermaid and takes precedence over the theme.

To recolor one styleable target, redeclare the color tokens on the elements that carry its
`data-siren-id` (for example `[data-siren-id="A"] { --siren-node-fill: #fde68a; }`). The theme
takes every frame and text color of a node, edge, subgraph, class, state or entity from a token
named at that element, and none of these elements sits inside another. So the change reaches
that target and nothing drawn inside it. A flowchart edge's arrowhead is painted with its own
line's stroke (`context-stroke`), so it follows a token redeclared on the edge, and the edge's
highlight, with the line. Safari does not support `context-stroke` (MDN's browser compatibility
data; Chrome and Edge have it from 124, Firefox from 111): there the arrowhead keeps the edge color
set on the container, or the author's.

#### Gradients and patterns

A color token reaches SVG paint (`fill` and `stroke`), so it takes what SVG paint takes — a color,
or `url(#id)` pointing at a `<linearGradient>`, `<radialGradient>` or `<pattern>` on your page. Put
the paint server in a zero-size `<svg>` of your own and point the token at it:

```html
<svg width="0" height="0" aria-hidden="true">
  <defs>
    <linearGradient id="node-paint" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fef3c7" />
      <stop offset="1" stop-color="#fbcfe8" />
    </linearGradient>
    <linearGradient id="edge-paint" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="600" y2="0">
      <stop offset="0" stop-color="#d97706" />
      <stop offset="1" stop-color="#db2777" />
    </linearGradient>
  </defs>
</svg>
```

```css
:root {
  --siren-node-fill: url(#node-paint);
  --siren-edge-stroke: url(#edge-paint);
}
```

Every color token in the Colors and Label paint rows can hold one except
`--siren-highlight-color`, which must stay a color: the highlight glow wraps it in
`filter: drop-shadow()`, and a `url()` there drops the whole filter, so the glow silently
disappears. Redeclaring one target works as above
(`[data-siren-id="A"] { --siren-node-fill: url(#other); }`). Know the limits before you reach for
it:

- A CSS gradient is not SVG paint. `--siren-node-fill: linear-gradient(...)` paints black, and
  nothing reports it.
- A gradient's default `gradientUnits="objectBoundingBox"` does nothing on an element with zero
  width or height, so a straight horizontal or vertical edge vanishes with its arrowhead. Give
  anything painted on a line — `--siren-edge-stroke`, and `--siren-node-stroke` where it strokes
  a straight line — `gradientUnits="userSpaceOnUse"`. Its coordinates are the diagram's, not
  each edge's own direction. A node fill can keep the default, which stretches across each node.
- A flowchart arrowhead is painted with `context-stroke`, so it takes the edge's gradient.
  Safari has no `context-stroke`, and there the arrowhead keeps its usual fallback.
- The highlight cannot fade between a paint server and a color; its stroke changes in one step.
- The `<defs>` live on your page, not in the diagram's `<svg>`: an SVG copied or serialized on its
  own loses the gradient.
- Keeping the gradient's `id` unique on the page is yours. Siren's own ids carry a per-render
  suffix, so they will not collide with it.

The repo's
[`demos/gradient-tokens.html`](https://github.com/Ginz9013/siren/blob/main/demos/gradient-tokens.html)
is a node gradient and an edge gradient done this way, ready to copy.

## Mermaid compatibility

Siren follows one rule: **a document that renders in Mermaid must render here.**

Until a Mermaid construct is implemented, Siren rejects it with an error diagnostic that
points to the line, such as `Unrecognized flowchart line: "..."`. It doesn't draw the
parts it understands and silently drop the rest. If valid Mermaid is rejected, the
construct isn't supported yet. Please
[open an issue](https://github.com/Ginz9013/siren/issues) with the snippet.

Where Mermaid's output contradicts the document (for example, a note written `LEFT OF` a
state that Mermaid draws on the right), Siren draws what the document says.

## Layout engine

Flowcharts, class diagrams, state diagrams and ER diagrams are laid out by ELK's `layered`
algorithm, through [elkjs](https://github.com/kieler/elkjs) **0.9.3**. That version is pinned
exactly because it is the one Mermaid 12.2.0 bundles, and the engine is configured with the
options of Mermaid 12's default layout, so a diagram is arranged the way Mermaid 12 arranges it.
Edges are routed orthogonally and drawn with rounded corners. Sequence diagrams have their own
layout.

- **`render()` stays synchronous.** The engine runs inside the call. Because of this,
  siren-core can't run inside a Web Worker.
- **First-layout latency.** The first graph-shaped diagram laid out in a page (or a Node
  process) costs about 0.1s while the engine starts up. This happens once per process. After
  that, a 40-node flowchart takes about 20ms.
- **Bundle size.** elkjs is a dependency, and the npm entry (`dist/index.js`) leaves it external
  so your bundler can dedupe it. Its compiled engine is about 1.6 MB minified (about 465 KB
  gzipped). The standalone `dist/siren-core.js` includes it: about 2.3 MB minified, about 604 KB
  gzipped.
- **Licence of the standalone build.** elkjs 0.9.3 is licensed EPL-2.0, not MIT.
  `dist/siren-core.js` distributes it under the Eclipse Public License 2.0, so
  `dist/THIRD-PARTY-NOTICES.md` ships beside the bundle with elkjs's licence text, and with the
  MIT licence of js-yaml 4.3.0, which the bundle also includes; the bundle's first line points to
  that file. If you serve or redistribute `dist/siren-core.js`, keep the notice file with it. The
  npm entry bundles no third-party code; elkjs's and js-yaml's licences travel in their own
  packages.

## Environment

- **Browsers**: any modern browser with ES2022 support.
- **Frameworks**: `render()` takes a plain DOM element, so it works with React, Vue,
  Svelte and others. Call it after the container mounts, for example in `useEffect` or
  `onMounted`.
- **Node.js** (tests, server-side): provide a DOM such as [jsdom](https://github.com/jsdom/jsdom).
  The default text measurer works without real text metrics.
- **Module format**: ES modules only. From CommonJS, use `await import("siren-core")`.

## Related

- [`siren-board`](https://www.npmjs.com/package/siren-board): a drop-in player with
  controls, pan and zoom.
- [Source, examples and demos](https://github.com/Ginz9013/siren)

## License

[MIT](https://github.com/Ginz9013/siren/blob/main/LICENSE). siren-core depends on
[elkjs](https://github.com/kieler/elkjs) (EPL-2.0) and [js-yaml](https://github.com/nodeca/js-yaml)
(MIT); the standalone `dist/siren-core.js` bundles both, and `dist/THIRD-PARTY-NOTICES.md` carries
their licences (see [Layout engine](#layout-engine)).
