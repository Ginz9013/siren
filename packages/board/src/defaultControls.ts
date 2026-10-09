import type { Board, ControlsFactory } from "./createBoard";

const CONTROLS_CLASS = "siren-board-controls";
const BUTTON_CLASS = "siren-board-controls__button";
const SVG_NS = "http://www.w3.org/2000/svg";

/*
 * Icon paths below are copied from Lucide (https://lucide.dev) rather than
 * taken as a dependency, so board keeps depending on siren-core alone.
 *
 * ISC License
 *
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
 * part of Feather (MIT). All other copyright (c) for Lucide are held by
 * Lucide Contributors 2022.
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
 * IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
const ICONS = {
  /** Lucide `chevron-left` */
  prev: ["m15 18-6-6 6-6"],
  /** Lucide `chevron-right` */
  next: ["m9 18 6-6-6-6"],
  /** Lucide `rotate-ccw` */
  reset: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"],
  /** Lucide `workflow` — its two `<rect>`s (8×8, rx 2) redrawn as paths, since makeIcon draws only paths. */
  fullDiagram: [
    "M5 3h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
    "M7 11v4a2 2 0 0 0 2 2h4",
    "M15 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z",
  ],
  /** Lucide `scan` */
  resetView: [
    "M3 7V5a2 2 0 0 1 2-2h2",
    "M17 3h2a2 2 0 0 1 2 2v2",
    "M21 17v2a2 2 0 0 1-2 2h-2",
    "M7 21H5a2 2 0 0 1-2-2v-2",
  ],
} satisfies Record<string, string[]>;

/**
 * Board's built-in Prev/Next/Reset/Full diagram/Reset view control bar — the
 * default value of `BoardOptions.controls`. Its buttons are icon-only; each
 * carries its name as `aria-label` and `title` instead of visible text. Reads
 * `board.controller` at click time rather than capturing it once, so it keeps
 * working across `setSource` and `setFullDiagram` calls that replace the
 * underlying controller. Turn it off with `controls: false`, or replace it
 * with any other `ControlsFactory` (see ADR-0006).
 *
 * `syncFullDiagram` is board's own wiring, not part of `ControlsFactory`:
 * board calls it whenever `fullDiagram` changes, wherever the change came
 * from, so the bar never shows a stale pressed or disabled state.
 */
export function createDefaultControls(
  board: Board,
): ReturnType<ControlsFactory> & { syncFullDiagram(): void } {
  const bar = document.createElement("div");
  bar.className = CONTROLS_CLASS;

  const prev = makeButton("Prev", ICONS.prev, () => board.controller?.prev());
  const next = makeButton("Next", ICONS.next, () => board.controller?.next());
  const reset = makeButton("Reset", ICONS.reset, () => board.controller?.reset());
  const fullDiagram = makeButton("Full diagram", ICONS.fullDiagram, () => {
    board.setFullDiagram(!board.fullDiagram);
  });
  const resetView = makeButton("Reset view", ICONS.resetView, () => board.resetView());
  bar.append(prev, next, reset, fullDiagram, resetView);

  /**
   * Mirrors `board.fullDiagram` onto the bar. The full diagram has no steps,
   * so the step buttons are disabled rather than left clickable to do
   * nothing; Reset view stays, since pan/zoom works on any drawing. A step
   * button holding focus hands it to Full diagram first, so a switch made
   * from code never drops a keyboard reader's focus to the page.
   */
  function syncFullDiagram(): void {
    fullDiagram.setAttribute("aria-pressed", String(board.fullDiagram));
    if (board.fullDiagram && [prev, next, reset].some((b) => b === document.activeElement)) {
      fullDiagram.focus();
    }
    for (const stepButton of [prev, next, reset]) stepButton.disabled = board.fullDiagram;
  }
  syncFullDiagram();

  return { element: bar, syncFullDiagram };
}

function makeButton(label: string, iconPaths: string[], onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(makeIcon(iconPaths));
  button.addEventListener("click", onClick);
  return button;
}

/** A 24×24 stroke icon drawn in `currentColor`, so it follows the button's hover color. */
function makeIcon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: "18",
    height: "18",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  })) {
    svg.setAttribute(name, value);
  }
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
