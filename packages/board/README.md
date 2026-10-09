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

- **Step controls included**: a floating bar with Prev, Play, Next, a step counter
  (`2 / 10`), Reset, a play interval select, Full diagram and Reset view. Replace it with
  your own, or turn it off.
- **Playback**: press Play and the timeline steps itself forward at the interval you pick,
  stopping on the last step. Any manual step takes over from playback.
- **Full diagram**: one click shows the whole diagram as Mermaid would draw it, with every
  element visible and no step applied. Clicking again returns to the step you were on.
- **Pan and zoom**: drag to move the diagram, and scroll to zoom toward the cursor.
- **Accurate layout**: labels are measured with the browser's real text metrics, so boxes
  fit their text.
- **Live updates**: call `setSource()` to re-render, for example as someone types in an
  editor.
- **Error display**: when a document fails to render, the board keeps the last good
  diagram on screen and shows an error banner over it.
- **Themeable chrome**: six CSS custom properties color the bar and the banner — one set,
  overridable like the diagram theme's.
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

### Showing the full diagram

```js
board.setFullDiagram(true); // every element, no step applied
board.setFullDiagram(false); // back to the step that was showing
```

The full diagram is the document drawn without its `timeline:` block. While it shows,
`board.controller` has no steps (`totalSteps` is 0), and the built-in bar disables Prev,
Play, Next, Reset and the play interval select, marks its Full diagram button as pressed,
and its step counter reads `0 / 0` until you switch back. The counter also reads `0 / 0`
on a document with no `timeline:` block, and before a first render succeeds. Switching
never changes pan and zoom, and `onFullDiagramChange` fires whether the switch came from
the bar or from code.
A custom control bar learns about switches through its own `update()` instead (see
[Custom controls](#custom-controls)).

### Playing the timeline

```js
board.setPlayInterval(1500); // ms between steps; the default is 2000
board.play(); // steps at once, then every 1.5s, and stops on the last step
board.pause();
```

The built-in bar's Play button does the same. It shows a play icon while stopped and a pause
icon while playing, and is pressed (`aria-pressed="true"`) while playback runs. The select
next to Reset picks the interval: 1s, 1.5s, 2s, 3s or 5s, with any other `playInterval` you
set added to the list. Both are disabled while the full diagram shows and when the document
has no steps. Any step change playback did not make stops it — Prev, Next or Reset, a new
document, or switching to the full diagram.

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
    // it is null until the first render, and setSource() and setFullDiagram() replace it.
    next.onclick = () => board.controller?.next();

    const full = document.createElement("button");
    full.textContent = "Full diagram";
    full.onclick = () => board.setFullDiagram(!board.fullDiagram);

    bar.append(next, full);
    return {
      element: bar,
      // Called after every render, step change and full diagram switch, from your bar or
      // from code — not at mount, so give the bar its starting state yourself. Read the
      // new state off the board; board.controller is still null before the first render.
      update: () => {
        const controller = board.controller;
        next.disabled = !controller || controller.currentStep === controller.totalSteps;
        full.setAttribute("aria-pressed", String(board.fullDiagram));
      },
      destroy: () => { /* remove listeners, if any */ },
    };
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
| `onFullDiagramChange` | `(fullDiagram: boolean) => void`         |         | Called whenever `fullDiagram` changes, from the built-in bar or `setFullDiagram()`. |
| `playInterval`  | `number`                                       | `2000`  | Milliseconds between playback steps. Must be finite and greater than 0, or `createBoard` throws a `RangeError`. |
| `onPlaybackChange` | `(playing: boolean) => void`                |         | Called whenever `playing` changes: playback starts, is paused, reaches the last step, or is stopped. |
| `measureText`   | `TextMeasurer`                                 | canvas  | Replaces the canvas-based text measurer, for example to match a custom font.        |

### `Board`

| Member            | Description                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `controller`      | The current `AnimationController` (`next()`, `prev()`, `reset()`, `currentStep`, `totalSteps`). `null` until a render succeeds. |
| `diagnostics`     | The diagnostics from the most recent render.                                             |
| `fullDiagram`     | Whether the full diagram is showing. Starts `false`.                                     |
| `setSource(src)`  | Renders a new document in place.                                                         |
| `setFullDiagram(on)` | Shows the full diagram, or returns to the step shown before. Keeps pan and zoom and `diagnostics`, and replaces `controller` once a document has rendered. Before that, it only records the choice for the first render. Setting the current value does nothing. |
| `playing`         | Whether playback is running. Starts `false`.                                             |
| `playInterval`    | Milliseconds between playback steps.                                                     |
| `play()`          | Starts playback: steps at once, then once per `playInterval`, and stops by itself on the last step. On the last step, it goes back to step 0 and takes step 1 one interval later. Does nothing while playing, while the full diagram shows, or when the document has no steps. |
| `pause()`         | Stops playback. Playback also stops on any step change it did not make (the built-in bar, `board.controller` in code), on every `setSource()`, and on `setFullDiagram(true)`. |
| `setPlayInterval(ms)` | Changes `playInterval`. Throws a `RangeError` unless `ms` is finite and greater than 0. While playing, the next step comes `ms` after the call. |
| `resetView()`     | Resets pan and zoom to fit the container.                                                |
| `destroy()`       | Removes everything the board added to the container and detaches its listeners.         |

### `ControlsFactory`

```ts
type ControlsFactory = (board: Board) => {
  element: HTMLElement;
  update?(): void;
  destroy?(): void;
};
```

`update` is called once after each change the bar may show: a `setSource()` that rendered,
a step change from any source (including `board.controller.next()` in code), a
`fullDiagram` switch, and a change to `playing` or `playInterval`. It is never called after
`destroy()`. The built-in bar is an ordinary
`ControlsFactory` kept in step through this same hook.

`destroy` is called when the board is destroyed.

`Diagnostic`, `AnimationController` and `TextMeasurer` come from `siren-core`. See the
[siren-core API](https://www.npmjs.com/package/siren-core#api).

## Styling

The diagram is styled by `siren-core/theme.css`. See
[Theming](https://www.npmjs.com/package/siren-core#theming) for its tokens, and for making a
second theme out of them.

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

Like the diagram theme, the chrome is one palette and picks none for you. For dark
chrome, redeclare the six under a selector of your own — a media query, your app's own
theme attribute, a container:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --siren-board-surface: #14111d;
    --siren-board-surface-hover: #1d1929;
    --siren-board-text: #ece8f8;
    --siren-board-border: #302a44;
    --siren-board-accent: #b69cff;
    --siren-board-danger: #ff8fa3;
  }
}
```

Those are the chrome's own dark values. The repo's
[`demos/theme-dark.css`](https://github.com/Ginz9013/siren/blob/main/demos/theme-dark.css)
declares them alongside `siren-core`'s color tokens, so the diagram and the chrome switch
together — copy it and you have a dark theme for both.

For deeper changes, target the classes `.siren-board-controls`,
`.siren-board-controls__button` and `.siren-board-controls__step` (the step counter), or
pass your own `controls`.

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
