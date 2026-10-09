import type { Board, ControlsFactory } from "./createBoard";
import { createDropdown } from "./dropdown";

const CONTROLS_CLASS = "siren-board-controls";
const BUTTON_CLASS = "siren-board-controls__button";
const INTERVAL_CLASS = "siren-board-controls__interval";
const TIMELINE_CLASS = "siren-board-controls__timeline";
const STEP_CLASS = "siren-board-controls__step";
const SVG_NS = "http://www.w3.org/2000/svg";
/** The play intervals the bar's interval dropdown offers, in ms. */
const PLAY_INTERVALS = [1000, 1500, 2000, 3000, 5000];
const INTERVAL_LABEL = "Play interval";
const TIMELINE_LABEL = "Timeline";

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
  /** Lucide `chevron-up` — every dropdown trigger's: its listbox opens upward. */
  chevronUp: ["m18 15-6-6-6 6"],
  /** Lucide `scan` */
  resetView: [
    "M3 7V5a2 2 0 0 1 2-2h2",
    "M17 3h2a2 2 0 0 1 2 2v2",
    "M21 17v2a2 2 0 0 1-2 2h-2",
    "M7 21H5a2 2 0 0 1-2-2v-2",
  ],
} satisfies Record<string, string[]>;

/**
 * Board's built-in Prev/Play/Next/step counter/Reset/Timeline/Play
 * interval/Full diagram/Reset view control bar — the default value of
 * `BoardOptions.controls`. Its buttons are icon-only; each carries its name as
 * `aria-label` and `title` instead of visible text. The two dropdowns'
 * triggers carry their names as `aria-label` too, but show the current value
 * as text, and open a listbox directly above themselves rather than leaving a
 * native select's list to the OS, which places it above or below at will. The
 * timeline dropdown is there only while the document names two timelines or
 * more. The step counter is plain text, not a live region:
 * playback changes it on every step, and announcing each one would talk over
 * the reader. Reads `board.controller` at click time rather than capturing
 * it once, so it keeps working across `setSource` and `setFullDiagram` calls
 * that replace the underlying controller. Turn it off with `controls: false`, or replace it
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
  const intervalDropdown = createDropdown<number>({
    label: INTERVAL_LABEL,
    className: INTERVAL_CLASS,
    icon: makeIcon(ICONS.chevronUp),
    onPick: (ms) => board.setPlayInterval(ms),
  });
  const intervalTrigger = intervalDropdown.trigger;
  /** In the bar only while the document names two timelines or more; see syncTimelineDropdown. */
  const timelineDropdown = createDropdown<string>({
    label: TIMELINE_LABEL,
    className: TIMELINE_CLASS,
    icon: makeIcon(ICONS.chevronUp),
    onPick: (name) => board.setTimeline(name),
  });
  const stepCounter = document.createElement("span");
  stepCounter.className = STEP_CLASS;
  bar.append(prev, play, next, stepCounter, reset, intervalDropdown.element, fullDiagram, resetView);
  /**
   * Where a step button disabled while focused hands focus: the opposite way,
   * which is the way left to go. Every other control, and these when the
   * opposite one is disabled too, hands it to Full diagram.
   */
  const handoff = new Map<HTMLButtonElement, HTMLButtonElement>([
    [next, prev],
    [prev, next],
    [reset, next],
  ]);

  /**
   * Mirrors `board.playing`, `board.timelines` and `board.timeline`,
   * `board.playInterval`, `board.fullDiagram` and the controller's
   * `currentStep / totalSteps` onto the bar. A step button that would do
   * nothing is disabled rather than left clickable: Prev and
   * Reset on step 0, Next on the last step, and all three in the full diagram
   * or with no steps. Play and the interval trigger are disabled whenever there
   * is nothing to play (the full diagram, or no steps), but Play stays on the
   * last step, where it replays from step 0. The timeline trigger is disabled
   * in the full diagram, leaving Full diagram the one way back to a timeline
   * (code may still call `board.setTimeline` there). Reset view stays, since
   * pan/zoom works on any drawing. A control holding focus as it is disabled hands it
   * on first (see `handoff`), so a change made from code never drops a
   * keyboard reader's focus to the page.
   */
  function update(): void {
    play.setAttribute("aria-pressed", String(board.playing));
    // Like Full diagram's below, the icon names what a click does: play while
    // stopped, pause while playing.
    play.replaceChildren(makeIcon(board.playing ? ICONS.pause : ICONS.play));
    syncTimelineDropdown();
    syncIntervalOptions();
    fullDiagram.setAttribute("aria-pressed", String(board.fullDiagram));
    // Here too the icon names what a click switches to; the pressed state,
    // not the icon, says which drawing is showing now.
    fullDiagram.replaceChildren(makeIcon(board.fullDiagram ? ICONS.timeline : ICONS.fullDiagram));
    // The full diagram's controller has no steps, and before the first
    // render there is no controller: both read 0 / 0.
    const currentStep = board.controller?.currentStep ?? 0;
    const totalSteps = board.controller?.totalSteps ?? 0;
    stepCounter.textContent = `${currentStep} / ${totalSteps}`;
    const nothingToPlay = board.fullDiagram || totalSteps === 0;
    const atStart = board.fullDiagram || currentStep === 0;
    const atEnd = board.fullDiagram || currentStep >= totalSteps;
    const disabled = new Map<HTMLButtonElement, boolean>([
      [prev, atStart],
      [play, nothingToPlay],
      [next, atEnd],
      [reset, atStart],
      [intervalTrigger, nothingToPlay],
      // Like every other step control, the timeline dropdown has nothing to
      // do in the full diagram; the Full diagram button is the way back.
      [timelineDropdown.trigger, board.fullDiagram],
    ]);
    // Enable first, so a handoff can land on a control this change enables;
    // move focus next, while the control losing it can still hold it; and
    // only then disable.
    for (const [control, off] of disabled) if (!off) control.disabled = false;
    // Focus on one of an open listbox's options counts as focus on its trigger.
    const focused =
      [intervalDropdown, timelineDropdown].find((dropdown) => dropdown.element.contains(document.activeElement))
        ?.trigger ?? document.activeElement;
    const losing = [...disabled].find(([control, off]) => off && control === focused)?.[0];
    if (losing !== undefined) {
      const opposite = handoff.get(losing);
      (opposite !== undefined && !disabled.get(opposite) ? opposite : fullDiagram).focus();
    }
    // A disabled dropdown has nothing to pick from, so its open listbox
    // closes; the timeline's also closes as it leaves the bar, in
    // syncTimelineDropdown.
    if (nothingToPlay) intervalDropdown.close();
    if (board.fullDiagram) timelineDropdown.close();
    for (const [control, off] of disabled) if (off) control.disabled = true;
  }
  update();

  /**
   * Offers `PLAY_INTERVALS` plus `board.playInterval` when it is not one of
   * them (2500 from the option or from code shows as "2.5s", in order), and
   * marks the current one selected.
   */
  function syncIntervalOptions(): void {
    const intervals = [...new Set([...PLAY_INTERVALS, board.playInterval])].sort((a, b) => a - b);
    intervalDropdown.sync(
      intervals.map((ms) => ({ value: ms, label: intervalText(ms) })),
      board.playInterval,
    );
  }

  /**
   * Shows the timeline dropdown just before the interval dropdown while
   * `board.timelines` offers a choice — two names or more — with each name as
   * its own label and `board.timeline` selected, and takes it out of the bar
   * otherwise; `update()` disables it in the full diagram. Taken out while it
   * holds focus — on its trigger or an open listbox's option — it closes and hands focus to Full diagram, as a
   * control disabled under focus does, rather than dropping it to the page.
   */
  function syncTimelineDropdown(): void {
    if (board.timelines.length < 2) {
      if (timelineDropdown.element.contains(document.activeElement)) fullDiagram.focus();
      timelineDropdown.close();
      timelineDropdown.element.remove();
      return;
    }
    if (!bar.contains(timelineDropdown.element)) intervalDropdown.element.before(timelineDropdown.element);
    timelineDropdown.sync(
      board.timelines.map((name) => ({ value: name, label: name })),
      board.timeline!,
    );
  }

  /** Closes either dropdown's open listbox, which takes its document listener with it. */
  function destroy(): void {
    timelineDropdown.destroy();
    intervalDropdown.destroy();
  }

  return { element: bar, update, destroy };
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

/** `ms` as the dropdown shows it, in seconds: 1500 reads "1.5s". */
function intervalText(ms: number): string {
  return `${ms / 1000}s`;
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
