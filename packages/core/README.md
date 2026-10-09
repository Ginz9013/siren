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
dependency. You can load it directly from a CDN:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/siren-core@0.4/dist/theme.css" />

<div id="diagram"></div>

<script type="module">
  import { render } from "https://cdn.jsdelivr.net/npm/siren-core@0.4/dist/siren-core.js";

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

A document without a `timeline:` block still gets a controller, with `totalSteps: 0`.

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

| Option        | Type                                   | Description                                                                   |
| ------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| `measureText` | `TextMeasurer`                         | Measures label text to size boxes. See below.                                  |
| `onClick`     | `(target: InteractionTarget) => void`  | Called when a reader clicks an element made clickable with `call`.             |
| `timeline`    | `boolean \| string`                    | Which timeline to apply. A document may declare several, and by default only the first applies. See below. |

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

#### Measuring text

By default, labels are sized with a fixed-width estimate, because that works everywhere,
including in tests. In a browser, pass a measurer backed by a `<canvas>` so boxes fit
their labels exactly:

```js
const ctx = document.createElement("canvas").getContext("2d");
ctx.font = "14px system-ui, sans-serif"; // match your --siren-font-* tokens

render(source, container, {
  measureText: {
    // Return the size of the box a label needs, padding included.
    measure: (text) => ({ width: ctx.measureText(text).width + 24, height: 32 }),
  },
});
```

`siren-board` does this for you.

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
which is unreadable on a dark node:

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
  }
}

/* ...or let your own theme switch decide, on any element you like. */
[data-theme="dark"] {
  --siren-node-fill: #2a2144;
  /* ...the same six. */
}
```

Those are Siren's own dark values, and the repo's
[`demos/theme-dark.css`](https://github.com/Ginz9013/siren/blob/main/demos/theme-dark.css)
is this done in full — the six above, the `<mark>` pair, and `siren-board`'s six chrome
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
| Colors    | `--siren-node-fill`, `--siren-node-stroke`, `--siren-node-text`, `--siren-edge-stroke`, `--siren-highlight-color` |
| Text      | `--siren-font-family`, `--siren-font-size`, `--siren-label-font-size`, `--siren-title-font-size`                  |
| Lines     | `--siren-stroke-width`, `--siren-edge-thick-stroke-width`, `--siren-edge-dash`, `--siren-lifeline-dash`, `--siren-note-link-dash`, `--siren-highlight-stroke-width` |
| Shapes    | `--siren-node-border-radius`, `--siren-box-fill-opacity`                                                           |
| Motion    | `--siren-fade-duration`, `--siren-slide-duration`, `--siren-slide-distance`, `--siren-highlight-duration`          |
| Label paint | `--siren-label-mark-fill` (`#ff0`, the rect behind `<mark>` text), `--siren-label-mark-text` (`#000`, `<mark>` text), `--siren-label-link` (`#0000ee`, `<a href>` link text) |

The label-paint tokens are what the browser's default stylesheet paints these tags with in
Mermaid's HTML labels. They sit outside the five-color palette, so a marked or linked run
looks the same whichever palette is in use, unless you repaint them — and a dark palette
should repaint `--siren-label-link`, as in the example above.

Per-element styling from the document itself (`classDef`, `class`, `style`, `linkStyle`,
`:::name`) works as it does in Mermaid and takes precedence over the theme.

## Mermaid compatibility

Siren follows one rule: **a document that renders in Mermaid must render here.**

Until a Mermaid construct is implemented, Siren rejects it with an error diagnostic that
points to the line, such as `Unrecognized flowchart line: "..."`. It doesn't draw the
parts it understands and silently drop the rest. If valid Mermaid is rejected, the
construct isn't supported yet. Please
[open an issue](https://github.com/Ginz9013/siren/issues) with the snippet.

Where Mermaid's output contradicts the document (for example, a note written `LEFT OF` a
state that Mermaid draws on the right), Siren draws what the document says.

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

[MIT](https://github.com/Ginz9013/siren/blob/main/LICENSE)
