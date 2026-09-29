# siren-board

[![npm](https://img.shields.io/npm/v/siren-board.svg)](https://www.npmjs.com/package/siren-board)
[![license](https://img.shields.io/npm/l/siren-board.svg)](https://github.com/Ginz9013/siren/blob/main/LICENSE)

**A drop-in player for animated Siren diagrams.**

[Siren](https://www.npmjs.com/package/siren-core) diagrams are written in Mermaid syntax,
plus a `timeline:` block that reveals, highlights and removes elements step by step.
`siren-board` gives such a diagram a complete player in one function call: give it an
element and a document, and you get a diagram your reader can step through, drag and zoom.

```js
import { createBoard } from "siren-board";
import "siren-core/theme.css";

createBoard(document.getElementById("board"), { source });
```

## Contents

- [Features](#features)
- [siren-board or siren-core?](#siren-board-or-siren-core)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Usage](#usage)
- [API](#api)
- [Styling](#styling)
- [Environment](#environment)
- [License](#license)

## Features

- **Step controls included**: a floating bar with Prev, Next, Reset and Reset view buttons.
  Replace it with your own, or turn it off.
- **Pan and zoom**: drag to move the diagram, and scroll to zoom toward the cursor.
- **Accurate layout**: labels are measured with the browser's real text metrics, so boxes
  fit their text.
- **Live updates**: call `setSource()` to re-render, for example as someone types in an
  editor.
- **Error display**: when a document fails to render, the board keeps the last good
  diagram on screen and shows an error banner over it.
- **Light and dark**: the chrome follows `prefers-color-scheme`, like the diagram theme.
- **TypeScript types included**.

## siren-board or siren-core?

|                                  | `siren-core` | `siren-board` |
| -------------------------------- | :----------: | :-----------: |
| Parse and render a Siren document to SVG | ✓   | ✓ (uses core) |
| Step-by-step animation controller | ✓           | ✓             |
| Built-in control bar             |              | ✓             |
| Pan and zoom                     |              | ✓             |
| Browser text measurement         | bring your own | ✓           |
| Runs outside a browser (jsdom)   | ✓            |               |

Use `siren-board` when you want a working player right away. Use `siren-core` directly
when you are building your own UI around the SVG, or rendering outside a browser.

## Installation

```sh
npm install siren-board siren-core
# or
pnpm add siren-board siren-core
# or
yarn add siren-board siren-core
```

`siren-board` already depends on `siren-core`. Installing core explicitly lets you import
its stylesheet, which the diagram needs.

## Quick start

### With a bundler (Vite, webpack, Next.js, ...)

```html
<div id="board" style="width: 100%; height: 480px"></div>
```

```js
import { createBoard } from "siren-board";
import "siren-core/theme.css";

const source = `flowchart LR
  A[Browser] --> B[API] --> C[(Database)]

timeline:
  enter B fade, enter A-B fade
  enter C slide-right, enter B-C fade
  highlight C glow`;

createBoard(document.getElementById("board"), { source });
```

**Give the container a size.** The board fills its container, so a container with no
height shows nothing.

### Without a bundler

`dist/siren-board.js` is a single ES module that already includes `siren-core`:

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/siren-core@0.1/dist/theme.css" />
    <style>
      #board { width: 100vw; height: 100vh; }
      body { margin: 0; }
    </style>
  </head>
  <body>
    <div id="board"></div>
    <script type="module">
      import { createBoard } from "https://cdn.jsdelivr.net/npm/siren-board@0.1/dist/siren-board.js";

      const source = await fetch("./architecture.srn").then((r) => r.text());
      createBoard(document.getElementById("board"), { source });
    </script>
  </body>
</html>
```

## Usage

### Showing the current step

```js
const status = document.getElementById("status");

const board = createBoard(container, {
  source,
  onStepChange: (current, total) => {
    status.textContent = `Step ${current} of ${total}`;
  },
});
```

`onStepChange` fires for every step change: from the built-in bar, from your own
controls, or from calling `board.controller.next()` in code.

### Keyboard navigation

```js
document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight") board.controller?.next();
  if (event.key === "ArrowLeft") board.controller?.prev();
  if (event.key === "Home") board.controller?.reset();
});
```

### Handling errors

```js
const board = createBoard(container, {
  source,
  onDiagnostics: (diagnostics) => {
    for (const d of diagnostics) {
      console[d.severity === "error" ? "error" : "warn"](`line ${d.line}: ${d.message}`);
    }
  },
});

if (board.controller === null) {
  // The first render failed. The board shows an error banner.
}
```

`onDiagnostics` fires after every render, including when there is nothing to report,
so you can use it to clear an error list.

### Live preview

`setSource()` re-renders the same board. A successful render replaces the diagram,
starts at step 0 and resets pan and zoom. A failed render keeps the previous diagram and
shows the error banner, so a half-typed document doesn't blank the preview.

```js
const board = createBoard(preview, { onDiagnostics: showProblems });

editor.addEventListener("input", () => board.setSource(editor.value));
```

### Custom controls

Pass a function as `controls` to build your own. It receives the board and returns the
element to mount inside it:

```js
createBoard(container, {
  source,
  controls: (board) => {
    const bar = document.createElement("div");
    bar.className = "my-controls";

    const next = document.createElement("button");
    next.textContent = "Next";
    // Read board.controller when the button is clicked, not when the bar is built:
    // it is null until the first render, and setSource() replaces it.
    next.onclick = () => board.controller?.next();

    bar.append(next);
    return { element: bar, destroy: () => { /* remove listeners, if any */ } };
  },
});
```

Pass `controls: false` to show no controls. You can drive the board entirely from your
own UI through `board.controller`.

### React

```jsx
import { useEffect, useRef } from "react";
import { createBoard } from "siren-board";
import "siren-core/theme.css";

export function SirenBoard({ source }) {
  const containerRef = useRef(null);
  const boardRef = useRef(null);

  useEffect(() => {
    boardRef.current = createBoard(containerRef.current);
    return () => boardRef.current.destroy();
  }, []);

  useEffect(() => {
    boardRef.current.setSource(source);
  }, [source]);

  return <div ref={containerRef} style={{ width: "100%", height: 480 }} />;
}
```

The same pattern works in any framework: create the board after the container mounts,
call `setSource()` when the document changes, and `destroy()` on unmount.

## API

### `createBoard(container, options?)`

```ts
function createBoard(container: HTMLElement, options?: BoardOptions): Board;
```

Mounts a board into `container` and renders `options.source`, if given.

### `BoardOptions`

| Option          | Type                                           | Default | Description                                                                         |
| --------------- | ---------------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `source`        | `string`                                       |         | The document to render first. Leave it out to mount an empty board.                 |
| `controls`      | `boolean \| ControlsFactory`                   | `true`  | `true` shows the built-in bar, `false` shows none, and a function builds your own.   |
| `onStepChange`  | `(current: number, total: number) => void`     |         | Called whenever the current step changes.                                           |
| `onDiagnostics` | `(diagnostics: Diagnostic[]) => void`          |         | Called after every render, with every error and warning.                            |
| `measureText`   | `TextMeasurer`                                 | canvas  | Replaces the canvas-based text measurer, for example to match a custom font.        |

### `Board`

| Member            | Description                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `controller`      | The current `AnimationController` (`next()`, `prev()`, `reset()`, `currentStep`, `totalSteps`). `null` until a render succeeds. |
| `diagnostics`     | The diagnostics from the most recent render.                                             |
| `setSource(src)`  | Renders a new document in place.                                                         |
| `resetView()`     | Resets pan and zoom to fit the container.                                                |
| `destroy()`       | Removes everything the board added to the container and detaches its listeners.         |

### `ControlsFactory`

```ts
type ControlsFactory = (board: Board) => { element: HTMLElement; destroy?(): void };
```

`destroy` is called when the board is destroyed.

`Diagnostic`, `AnimationController` and `TextMeasurer` come from `siren-core`. See the
[siren-core API](https://www.npmjs.com/package/siren-core#api).

## Styling

The diagram is styled by `siren-core/theme.css`. See
[Theming](https://www.npmjs.com/package/siren-core#theming) for its tokens and dark mode.

The board's own chrome (control bar and error banner) is injected automatically, so it
needs no extra stylesheet. Restyle it with these custom properties:

| Token                         | Used for                              |
| ----------------------------- | ------------------------------------- |
| `--siren-board-surface`       | Control bar and button background     |
| `--siren-board-surface-hover` | Button background on hover            |
| `--siren-board-text`          | Button icon color                     |
| `--siren-board-border`        | Bar and button borders                |
| `--siren-board-accent`        | Button color on hover                 |
| `--siren-board-danger`        | Error banner text                     |

```css
:root {
  --siren-board-accent: #0ea5e9;
}
```

Like the diagram theme, the chrome follows `prefers-color-scheme`, and
`<html data-theme="light">` or `<html data-theme="dark">` pins one palette.

For deeper changes, target the classes `.siren-board-controls` and
`.siren-board-controls__button`, or pass your own `controls`.

The built-in buttons are icon-only. Each has an `aria-label` and a `title`, so screen
readers announce it and a tooltip names it.

## Environment

- **Browsers only.** The board relies on canvas text measurement and mouse events. To render
  without a browser, use [`siren-core`](https://www.npmjs.com/package/siren-core) with jsdom.
- **Module format**: ES modules only.

## Related

- [`siren-core`](https://www.npmjs.com/package/siren-core): the renderer, the timeline
  syntax and the theme.
- [Source, examples and demos](https://github.com/Ginz9013/siren)

## License

[MIT](https://github.com/Ginz9013/siren/blob/main/LICENSE)
