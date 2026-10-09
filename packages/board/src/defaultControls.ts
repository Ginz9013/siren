import type { Board, ControlsFactory } from "./createBoard";

const CONTROLS_CLASS = "siren-board-controls";
const BUTTON_CLASS = "siren-board-controls__button";
const SELECT_CLASS = "siren-board-controls__select";
const SVG_NS = "http://www.w3.org/2000/svg";
/** The play intervals the bar's select offers, in ms. */
const PLAY_INTERVALS = [1000, 1500, 2000, 3000, 5000];

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
  /** Lucide `play` — the Play button's icon while stopped: what a click starts. */
  play: ["M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"],
  /**
   * Lucide `pause` — its two `<rect>`s redrawn as paths, like `image` below.
   * The Play button's icon while playing: what a click does then.
   */
  pause: [
    "M15 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
    "M6 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
  ],
  /** Lucide `chevron-right` */
  next: ["m9 18 6-6-6-6"],
  /** Lucide `rotate-ccw` */
  reset: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"],
  /**
   * Lucide `image` — its `<rect>` and `<circle>` redrawn as paths, since
   * makeIcon draws only paths. The Full diagram button's icon while the
   * timeline shows: a still picture, which is what a click switches to.
   */
  fullDiagram: [
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
    "M7 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
  ],
  /** Lucide `clapperboard` — the same button's icon while the full diagram shows: back to the animation. */
  timeline: [
    "m12.296 3.464 3.02 3.956",
    "M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z",
    "M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    "m6.18 5.276 3.1 3.899",
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
 * Board's built-in Prev/Play/Next/Reset/Play interval/Full diagram/Reset view
 * control bar — the default value of `BoardOptions.controls`. Its buttons are
 * icon-only; each carries its name as `aria-label` and `title` instead of
 * visible text, and the interval select its name as `aria-label`. Reads
 * `board.controller` at click time rather than capturing it once, so it keeps
 * working across `setSource` and `setFullDiagram` calls that replace the
 * underlying controller. Turn it off with `controls: false`, or replace it
 * with any other `ControlsFactory` (see ADR-0006) — this one is itself an
 * ordinary `ControlsFactory`, kept in step through the public `update()`
 * hook like any other, so it never shows a stale pressed or disabled state.
 */
export function createDefaultControls(board: Board): ReturnType<ControlsFactory> {
  const bar = document.createElement("div");
  bar.className = CONTROLS_CLASS;

  const prev = makeButton("Prev", ICONS.prev, () => board.controller?.prev());
  const play = makeButton("Play", ICONS.play, () => {
    if (board.playing) board.pause();
    else board.play();
  });
  const next = makeButton("Next", ICONS.next, () => board.controller?.next());
  const reset = makeButton("Reset", ICONS.reset, () => board.controller?.reset());
  const fullDiagram = makeButton("Full diagram", ICONS.fullDiagram, () => {
    board.setFullDiagram(!board.fullDiagram);
  });
  const resetView = makeButton("Reset view", ICONS.resetView, () => board.resetView());
  const interval = document.createElement("select");
  interval.className = SELECT_CLASS;
  interval.setAttribute("aria-label", "Play interval");
  interval.addEventListener("change", () => board.setPlayInterval(Number(interval.value)));
  bar.append(prev, play, next, reset, interval, fullDiagram, resetView);

  /**
   * Mirrors `board.playing`, `board.playInterval` and `board.fullDiagram`
   * onto the bar. The full diagram has no steps, so the step buttons are
   * disabled rather than left clickable to do nothing, and Play and the
   * interval select are disabled whenever there is nothing to play (the full
   * diagram, or no steps); Reset view stays, since pan/zoom works on any
   * drawing. A control holding focus as it is disabled hands it to Full
   * diagram first, so a change made from code never drops a keyboard
   * reader's focus to the page.
   */
  function update(): void {
    play.setAttribute("aria-pressed", String(board.playing));
    // Like Full diagram's below, the icon names what a click does: play while
    // stopped, pause while playing.
    play.replaceChildren(makeIcon(board.playing ? ICONS.pause : ICONS.play));
    syncIntervalOptions();
    fullDiagram.setAttribute("aria-pressed", String(board.fullDiagram));
    // The icon names what a click switches to, as a play button does; the
    // pressed state, not the icon, says which drawing is showing now.
    fullDiagram.replaceChildren(makeIcon(board.fullDiagram ? ICONS.timeline : ICONS.fullDiagram));
    const nothingToPlay = board.fullDiagram || (board.controller?.totalSteps ?? 0) === 0;
    const disabled = new Map<HTMLButtonElement | HTMLSelectElement, boolean>([
      [prev, board.fullDiagram],
      [play, nothingToPlay],
      [next, board.fullDiagram],
      [reset, board.fullDiagram],
      [interval, nothingToPlay],
    ]);
    if ([...disabled].some(([control, off]) => off && control === document.activeElement)) {
      fullDiagram.focus();
    }
    for (const [control, off] of disabled) control.disabled = off;
  }
  update();

  /**
   * Offers `PLAY_INTERVALS` plus `board.playInterval` when it is not one of
   * them (2500 from the option or from code shows as "2.5s", in order), and
   * selects the current one. The options are rebuilt only when that list
   * changes: update() runs on every playback step, and rebuilding an open
   * select would close it under the reader's pointer.
   */
  function syncIntervalOptions(): void {
    const wanted = [...new Set([...PLAY_INTERVALS, board.playInterval])].sort((a, b) => a - b);
    const shown = Array.from(interval.options, (option) => Number(option.value));
    if (wanted.join() !== shown.join()) interval.replaceChildren(...wanted.map(makeIntervalOption));
    interval.value = String(board.playInterval);
  }

  return { element: bar, update };
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

/** The select's option for `ms`, labelled in seconds: 1500 reads "1.5s". */
function makeIntervalOption(ms: number): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = String(ms);
  option.textContent = `${ms / 1000}s`;
  return option;
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
