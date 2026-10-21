import { render } from "siren-core";
import type {
  AnimationController,
  Diagnostic,
  IconifyJSON,
  InteractionTarget,
  SirenRenderResult,
  StyleFact,
  TextMeasurer,
} from "siren-core";
import { ensureStylesInjected } from "./styles";
import { createCanvasTextMeasurer } from "./textMeasurer";
import { createDefaultControls } from "./defaultControls";
import { createViewport } from "./viewport";

const ERROR_BANNER_CLASS = "siren-board-error";
const CANVAS_CLASS = "siren-board-canvas";
/**
 * On the canvas while the dot grid shows; the chrome stylesheet draws the
 * dots from it (see styles.ts). A modifier of the canvas rather than an
 * element of its own, so nothing new sits between the viewport and the
 * pointer, and the dots are never part of what `render()` mounts or exports.
 */
const DOTS_CLASS = "siren-board-canvas--dots";
/** On the container while the board fills the window in place of the screen; internal, not a public hook. */
const FILL_CLASS = "siren-board--fill";
const DEFAULT_PLAY_INTERVAL = 2000;

/**
 * A caller-supplied replacement for board's default control bar. Board calls
 * `update` once after anything a bar shows may have changed — a `setSource`
 * that rendered, a step change from any source, a `fullDiagram`, `timeline`
 * or `omitAuthorStyles` switch, a `playing` or `playInterval` change, a turn
 * of `fullscreen` or `dotGrid` — and never after `destroy()`; read the new
 * state off `board` there.
 */
export type ControlsFactory = (board: Board) => { element: HTMLElement; update?(): void; destroy?(): void };

/** Options accepted by `createBoard`. */
export interface BoardOptions {
  /** Initial `.srn` source. Omit to mount an empty board and call `setSource` later. */
  source?: string;
  /** Overrides board's default real-browser canvas measurer (see textMeasurer.ts). */
  measureText?: TextMeasurer;
  /** Fired on every `setSource` call (construction included), fatal or warning-only. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  /** Fired whenever the current step changes, from the built-in bar or a direct `controller` call. */
  onStepChange?: (current: number, total: number) => void;
  /** `true`/omitted = built-in Prev/Next/Reset bar; `false` = none; function = custom. */
  controls?: boolean | ControlsFactory;
  /**
   * Fired whenever `timeline` changes after the first render that succeeds:
   * from `setTimeline`, or from a `setSource` that changes it (`null` to a
   * name and back included). The first render's timeline is the initial
   * state and fires nothing.
   */
  onTimelineChange?: (name: string | null) => void;
  /** Fired whenever `fullDiagram` changes, from the built-in bar or a direct `setFullDiagram` call. */
  onFullDiagramChange?: (fullDiagram: boolean) => void;
  /**
   * Fired whenever `fullscreen` actually changes: from `setFullscreen`, the
   * browser's own way out (Esc, another element taking the screen), or Esc
   * while the board fills the window. Never during or after `destroy()`.
   */
  onFullscreenChange?: (fullscreen: boolean) => void;
  /** Milliseconds between playback steps; must be finite and > 0 (see `Board.setPlayInterval`). */
  playInterval?: number;
  /** Fired whenever `playing` changes: `play()`, `pause()`, the last step, or anything else that stops playback. */
  onPlaybackChange?: (playing: boolean) => void;
  /**
   * Called when a reader clicks an element the author made clickable with
   * `click X call fn()`; passed unchanged to core's `render()` on every
   * render (see `RenderOptions.onClick`). Omit it and those clicks do
   * nothing. `click X href` needs no handler: it is drawn as a link.
   */
  onClick?: (target: InteractionTarget) => void;
  /**
   * The icon packs a flowchart's icon nodes are drawn from; passed
   * unchanged to core's `render()` on every render (see
   * `RenderOptions.iconPacks`). Iconify JSON, handed over as data: nothing
   * is fetched.
   */
  iconPacks?: readonly IconifyJSON[];
  /**
   * The author's style properties not to draw, passed unchanged to core's
   * `render()` on every render (see `RenderOptions.omitAuthorStyles`).
   * Board reads nothing into the list; change it with `setOmitAuthorStyles`.
   */
  omitAuthorStyles?: readonly string[];
  /**
   * Fired after every render that draws — a `setSource` (construction
   * included), `setTimeline`, `setFullDiagram` or `setOmitAuthorStyles` —
   * with that render's `styles` and `siren`, handed over unchanged (see
   * `SirenRenderResult`). Board draws no conclusion from either. A
   * `setSource` that fails draws nothing, so fires nothing. It is that
   * render's last notification: `board.styles` and `board.siren` already
   * hold the new facts in every callback before it.
   */
  onStyles?: (styles: readonly StyleFact[], siren: unknown) => void;
  /**
   * Whether the canvas starts with the dot grid behind the diagram; on when
   * omitted. Change it later with `setDotGrid`. Nothing remembers it across
   * page loads: a consumer who wants that keeps it from `onDotGridChange`.
   */
  dotGrid?: boolean;
  /** Fired whenever `dotGrid` actually changes, from the built-in bar or a direct `setDotGrid` call. */
  onDotGridChange?: (dotGrid: boolean) => void;
}

/**
 * A mounted, self-contained wrapper around one `siren-core` `render()` call
 * — see ADR-0005 for why this owns calling `render()` itself rather than
 * wrapping an already-rendered result, and CONTEXT.md's "Board" entry.
 */
export interface Board {
  readonly controller: AnimationController | null;
  readonly diagnostics: Diagnostic[];
  /** Whether the board shows the full diagram rather than the timeline (see CONTEXT.md's "Full diagram"). */
  readonly fullDiagram: boolean;
  /** The list every render is given as `omitAuthorStyles`; empty when none was. Frozen: change it with `setOmitAuthorStyles`. */
  readonly omitAuthorStyles: readonly string[];
  /**
   * The `styles` of the last render that drew, as core returned them; empty
   * before one has. Unchanged by a `setSource` that fails, like `timelines`.
   */
  readonly styles: readonly StyleFact[];
  /** The `siren` of the last render that drew, as core returned it; on the terms of `styles`. */
  readonly siren: unknown;
  /** Renders another document in place; after `destroy()`, does nothing. */
  setSource(source: string): void;
  /**
   * The named timeline blocks of the last source that rendered, in document
   * order; empty when it has only the unnamed `timeline:` or none at all.
   * Unchanged by a `setSource` that fails.
   */
  readonly timelines: readonly string[];
  /**
   * The current timeline's name (see CONTEXT.md's "Current timeline"); `null`
   * when `timelines` is empty. Kept while the full diagram is on, so
   * switching it off applies this timeline.
   */
  readonly timeline: string | null;
  /**
   * Applies the timeline block `name` by re-rendering the last rendered
   * source, from step 0, and stops playback. Never changes the view or
   * `diagnostics`, and fires `onTimelineChange` but neither `onStepChange`
   * nor `onDiagnostics`. The current name is a no-op, except in the full
   * diagram: any name switches it off, the current one back to the step
   * shown before (as `setFullDiagram(false)`). Throws a `RangeError`, and
   * changes nothing, for a name not in `timelines`. Like `setSource`, it
   * replaces `controller`: read it again rather than keeping the old one.
   */
  setTimeline(name: string): void;
  /**
   * Switches the full diagram on or off by re-rendering the last rendered
   * source; switching off applies `timeline` and returns to the step shown
   * before. Never changes the view or `diagnostics`, and fires neither
   * `onStepChange` nor `onDiagnostics`. Setting the current value is a
   * no-op. Like `setSource`, it replaces `controller`: read it again rather
   * than keeping the old one.
   */
  setFullDiagram(on: boolean): void;
  /**
   * Whether the board takes the whole screen (see CONTEXT.md's
   * "Fullscreen"): its container is `document.fullscreenElement`, or, where
   * the screen is refused, it fills the browser window. The two read the same.
   */
  readonly fullscreen: boolean;
  /**
   * Takes the board to or out of the whole screen. Where the Fullscreen API
   * is enabled it asks the browser, and `fullscreen` turns only once the
   * browser's `fullscreenchange` says so; where it is missing or disabled, or
   * the request is refused, the board fills the window instead, at once —
   * Esc then leaves it. While the request is pending nothing more is asked
   * and the last call wins: after a final `false` the board leaves the screen
   * as soon as it is entered (`onFullscreenChange` fires `true`, then
   * `false`), or, if refused, does not fill the window. Never changes the
   * view, the step, `playing`, `fullDiagram` or `controller`, and draws
   * nothing. Setting the current value is a no-op; after `destroy()`, so is
   * everything.
   */
  setFullscreen(on: boolean): void;
  /**
   * Changes `omitAuthorStyles` and re-renders the last rendered source with
   * it, at the step shown, on the current timeline or in the full diagram
   * as before. Playback keeps going from there: only the full diagram,
   * which has no steps, stops it. Never changes the view or `diagnostics`,
   * and fires neither `onStepChange` nor `onDiagnostics`. An equal list (the
   * same names in the same order, compared case-insensitively as core reads
   * them, so `["FILL"]` equals `["fill"]`) is a no-op. Like `setSource`, it
   * replaces `controller`: read it again rather than keeping the old one.
   */
  setOmitAuthorStyles(list: readonly string[]): void;
  /** Whether playback is running (see CONTEXT.md's "Playback"). */
  readonly playing: boolean;
  /** Milliseconds between playback steps. */
  readonly playInterval: number;
  /**
   * Starts playback: steps at once, then once per `playInterval`, stopping
   * by itself on the last step. On the last step it resets to step 0 and
   * waits one interval first. A no-op while playing, in the full diagram, or
   * with no steps to play.
   */
  play(): void;
  /** Stops playback; a no-op when not playing. */
  pause(): void;
  /**
   * Changes `playInterval`; `ms` must be finite and > 0, or this throws a
   * `RangeError`. While playing, the next step comes `ms` after this call.
   */
  setPlayInterval(ms: number): void;
  /**
   * Whether the canvas shows the dot grid behind the diagram (see
   * CONTEXT.md's "Dot grid"). Chrome only: it is drawn on board's canvas,
   * never in the SVG `render()` mounts, so it is never exported.
   */
  readonly dotGrid: boolean;
  /**
   * Shows or hides the dot grid. Draws nothing and never changes the view,
   * the step, `playing` or `controller`: the grid is the canvas's
   * background, not part of the diagram. Setting the current value is a
   * no-op; after `destroy()`, so is everything.
   */
  setDotGrid(on: boolean): void;
  /** Resets pan/zoom to the initial fit-to-container state (scale 1.0, no offset). */
  resetView(): void;
  destroy(): void;
}

/** Throws unless `ms` can time a playback step: finite and > 0. */
function checkPlayInterval(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new RangeError(`playInterval must be a finite number of milliseconds > 0, got ${ms}`);
  }
  return ms;
}

export function createBoard(container: HTMLElement, options: BoardOptions = {}): Board {
  // Checked before anything is mounted, so a bad option leaves the container untouched.
  let playInterval = checkPlayInterval(options.playInterval ?? DEFAULT_PLAY_INTERVAL);
  ensureStylesInjected();
  container.classList.add("siren-board");

  const canvas = document.createElement("div");
  canvas.className = CANVAS_CLASS;
  container.appendChild(canvas);
  /**
   * On unless the caller says otherwise, and set on the canvas here, before
   * any bar is mounted: the grid belongs to the canvas, so `controls: false`
   * keeps it, and the initial value is state, not a change, so nothing fires.
   */
  let dotGrid = options.dotGrid ?? true;
  canvas.classList.toggle(DOTS_CLASS, dotGrid);

  const viewport = createViewport(canvas);

  const measureText = options.measureText ?? createCanvasTextMeasurer();
  let wrappedController: AnimationController | null = null;
  let diagnostics: Diagnostic[] = [];
  let destroyed = false;
  let fullDiagram = false;
  /**
   * Copied, so a caller changing its array later changes nothing here, and
   * frozen, so changing the one `board.omitAuthorStyles` returns cannot either.
   */
  let omitAuthorStyles: readonly string[] = Object.freeze([...(options.omitAuthorStyles ?? [])]);
  /** `timelines` of the last render that succeeded. */
  let timelines: readonly string[] = [];
  let currentTimeline: string | null = null;
  /** `styles` and `siren` of the last render that drew. */
  let styles: readonly StyleFact[] = [];
  let siren: unknown = undefined;
  /**
   * The source of the last `setSource` call that rendered. Toggling the full
   * diagram re-renders this rather than the latest source, so a failed
   * `setSource` (error banner showing) never turns into a blank board.
   */
  let renderedSource: string | null = null;
  /** The timeline step to return to when the full diagram is switched off. */
  let stepBeforeFullDiagram = 0;
  let playing = false;
  /** The pending playback step while playing, else `null`. */
  let playTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while playback itself is stepping, so that step does not stop playback. */
  let playbackStepping = false;

  function wrapController(real: AnimationController): AnimationController {
    function afterCall(previousStep: number): void {
      if (real.currentStep !== previousStep) {
        // Any step playback did not take itself — the built-in bar, a
        // custom bar, code — means the reader took over (CONTEXT.md's "Playback").
        if (!playbackStepping) pause();
        updateControls();
        options.onStepChange?.(real.currentStep, real.totalSteps);
      }
    }
    return {
      get totalSteps() {
        return real.totalSteps;
      },
      get currentStep() {
        return real.currentStep;
      },
      next() {
        const before = real.currentStep;
        real.next();
        afterCall(before);
      },
      prev() {
        const before = real.currentStep;
        real.prev();
        afterCall(before);
      },
      reset() {
        const before = real.currentStep;
        real.reset();
        afterCall(before);
      },
    };
  }

  function showErrorBanner(): void {
    clearErrorBanner();
    const banner = document.createElement("div");
    banner.className = ERROR_BANNER_CLASS;
    banner.textContent = "Render failed — see diagnostics.";
    canvas.appendChild(banner);
  }

  function clearErrorBanner(): void {
    canvas.querySelector(`.${ERROR_BANNER_CLASS}`)?.remove();
  }

  /**
   * The one place board calls core's `render()`: `full` draws the full
   * diagram, otherwise `name` picks the timeline block (`null` = core's
   * default, the first block).
   */
  function renderDocument(source: string, full: boolean, name: string | null = null) {
    return render(source, viewport.content, {
      measureText,
      onClick: options.onClick,
      ...(options.iconPacks === undefined ? {} : { iconPacks: options.iconPacks }),
      timeline: full ? false : (name ?? true),
      omitAuthorStyles,
    });
  }

  /**
   * Renders a new document keeping the current timeline if it declares that
   * name, else on its first (or none), and says which one that is — the one
   * place that choice is made. In the full diagram no timeline is applied,
   * so the name is only remembered for switching it off.
   */
  function renderKeepingTimeline(source: string): { result: SirenRenderResult; timeline: string | null } {
    if (!fullDiagram && currentTimeline !== null) {
      // Board cannot learn the new document's names without rendering it
      // (ADR-0005: board never parses), so it asks core for the name and
      // falls back on the RangeError core throws for one the document does
      // not declare — core's only RangeError, thrown before anything is
      // mounted, so the fallback is the only render the reader sees.
      try {
        return { result: renderDocument(source, false, currentTimeline), timeline: currentTimeline };
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
      }
    }
    const result = renderDocument(source, fullDiagram);
    const kept = currentTimeline !== null && result.timelines.includes(currentTimeline);
    return { result, timeline: kept ? currentTimeline : (result.timelines[0] ?? null) };
  }

  /**
   * Takes a drawn render's `styles` and `siren` as the board's — with the rest
   * of its new state, before any callback, so every callback reads them.
   */
  function adoptStyles(result: SirenRenderResult): void {
    styles = result.styles;
    siren = result.siren;
  }

  /**
   * The last notification of a render that drew. It hands over the board's
   * facts rather than that render's: a callback may have rendered another
   * document since, and the caller must be left with the drawing shown.
   */
  function reportStyles(): void {
    options.onStyles?.(styles, siren);
  }

  function setSource(source: string): void {
    // A destroyed board draws nothing and reports nothing more.
    if (destroyed) return;
    // Rendered or not, the reader asked for another document: stop either way.
    pause();
    const { result, timeline } = renderKeepingTimeline(source);
    diagnostics = result.diagnostics;
    if (result.svg === null) {
      // render() leaves the viewport's content layer untouched on failure
      // (see packages/core/src/index.ts) — the previous diagram and
      // controller stay live, and so does the current pan/zoom view; only
      // overlay the error banner on top of them.
      showErrorBanner();
    } else {
      clearErrorBanner();
      // The first render's timeline is the board's initial state, not a
      // change — as onStepChange and onFullDiagramChange stay quiet then too.
      const isFirstRender = renderedSource === null;
      renderedSource = source;
      const previousTimeline = currentTimeline;
      timelines = result.timelines;
      currentTimeline = timeline;
      // A new document starts its timeline at step 0, full diagram or not.
      stepBeforeFullDiagram = 0;
      wrappedController = wrapController(result.controller!);
      adoptStyles(result);
      viewport.resetView();
      updateControls();
      if (!isFirstRender && currentTimeline !== previousTimeline) options.onTimelineChange?.(currentTimeline);
      reportStyles();
    }
    options.onDiagnostics?.(diagnostics);
  }

  /**
   * Re-renders the last rendered source with or without its timeline (the
   * full diagram is core's `render(…, { timeline: false })`, ADR-0005: board
   * never parses). Deliberately leaves `diagnostics`, the view, and the
   * error banner alone, and fires neither `onDiagnostics` nor
   * `onStepChange` — the document did not change, only how it is drawn.
   */
  function setFullDiagram(on: boolean): void {
    if (destroyed || on === fullDiagram) return;
    // The full diagram has no steps to play.
    if (on) pause();
    let drawn = false;
    if (renderedSource !== null) {
      // Switching off applies the current timeline, not the document's first.
      const result = renderDocument(renderedSource, on, currentTimeline);
      // This source rendered before, and core resolves the timeline before
      // dropping it, so it renders again; should it not, render() has left
      // the previous drawing mounted, and nothing here switches either.
      if (result.svg === null) return;
      const real = result.controller!;
      if (on) {
        stepBeforeFullDiagram = wrappedController?.currentStep ?? 0;
      } else {
        // Stepping the unwrapped controller, in this same synchronous task,
        // means the reader never sees step 0 flash by and `onStepChange`
        // stays quiet: the reader is back where they were, not moving.
        for (let i = 0; i < stepBeforeFullDiagram && real.currentStep < real.totalSteps; i++) real.next();
      }
      wrappedController = wrapController(real);
      adoptStyles(result);
      drawn = true;
    }
    commitFullDiagram(on);
    if (drawn) reportStyles();
  }

  /**
   * Re-renders the last rendered source with another `omitAuthorStyles`
   * (core strikes the properties out, ADR-0005: board never parses).
   * Like `setFullDiagram`, it leaves `diagnostics`, the view, and the error
   * banner alone, and fires neither `onDiagnostics` nor `onStepChange`: the
   * document did not change, only how it is drawn. Nor does it pause: the
   * steps are the same, so a pending playback step lands on the new drawing.
   */
  function setOmitAuthorStyles(list: readonly string[]): void {
    if (destroyed) return;
    // An equal list — same names, same order — draws the same: a no-op.
    // Names are compared case-insensitively, as render() reads them.
    if (
      list.length === omitAuthorStyles.length &&
      list.every((name, i) => name.toLowerCase() === omitAuthorStyles[i]!.toLowerCase())
    ) {
      return;
    }
    omitAuthorStyles = Object.freeze([...list]);
    let drawn = false;
    if (renderedSource !== null) {
      const step = wrappedController?.currentStep ?? 0;
      const result = renderDocument(renderedSource, fullDiagram, currentTimeline);
      // This source rendered before, so it renders again; should it not,
      // render() has left the previous drawing mounted.
      if (result.svg === null) return;
      const real = result.controller!;
      // As switching the full diagram off: stepped unwrapped, in this same
      // task, so the reader never sees step 0 and `onStepChange` stays quiet.
      for (let i = 0; i < step && real.currentStep < real.totalSteps; i++) real.next();
      wrappedController = wrapController(real);
      adoptStyles(result);
      drawn = true;
    }
    updateControls();
    if (drawn) reportStyles();
  }

  /** The last step of every full diagram switch: record it, then tell the bar and the caller. */
  function commitFullDiagram(on: boolean): void {
    fullDiagram = on;
    updateControls();
    options.onFullDiagramChange?.(fullDiagram);
  }

  /**
   * Re-renders the last rendered source with another timeline block (core
   * picks the block, ADR-0005: board never parses). Like `setFullDiagram`,
   * it leaves `diagnostics`, the view, and the error banner alone, and fires
   * neither `onDiagnostics` nor `onStepChange`: the document did not change,
   * only which of its timelines is played.
   */
  function setTimeline(name: string): void {
    if (destroyed) return;
    if (name === currentTimeline) {
      // Asking for the timeline the full diagram is hiding means "show it
      // again": exactly switching the full diagram off.
      if (fullDiagram) setFullDiagram(false);
      return;
    }
    // With nothing rendered there is no source to ask core about, and no
    // name is declared: the same mistake core reports for one, so the same
    // error.
    if (renderedSource === null) {
      throw new RangeError(`No timeline named ${JSON.stringify(name)}; no document has rendered yet`);
    }
    // Core throws a RangeError for an undeclared name before mounting
    // anything, so it propagates from here with the board, playback
    // included, exactly as it was.
    const result = renderDocument(renderedSource, false, name);
    // This source rendered before, and the name was found in it, so it
    // renders again; should it not, render() has left the previous drawing
    // mounted, and nothing here switches either.
    if (result.svg === null) return;
    wrappedController = wrapController(result.controller!);
    adoptStyles(result);
    currentTimeline = name;
    // Another timeline is another story: playback of this one ends here
    // (the full diagram never plays, so this and leaving it never meet).
    pause();
    // Choosing a timeline from the full diagram also leaves it — another
    // name starts that timeline at step 0, so nothing is restored.
    if (fullDiagram) commitFullDiagram(false);
    else updateControls();
    options.onTimelineChange?.(currentTimeline);
    reportStyles();
  }

  function setPlaying(on: boolean): void {
    playing = on;
    updateControls();
    options.onPlaybackChange?.(playing);
  }

  /** Steps `controller` as playback, which `wrapController` tells apart from any other step. */
  function stepByPlayback(step: () => void): void {
    playbackStepping = true;
    try {
      step();
    } finally {
      playbackStepping = false;
    }
  }

  function schedulePlayStep(): void {
    playTimer = setTimeout(playStep, playInterval);
  }

  function clearPlayTimer(): void {
    if (playTimer !== null) clearTimeout(playTimer);
    playTimer = null;
  }

  /**
   * One playback step; the last step ends playback rather than queuing
   * another. The step's own callbacks may stop playback — `pause()`,
   * `setSource`, `destroy()` from `onStepChange` — so it re-checks
   * `playing` before queuing the next one.
   */
  function playStep(): void {
    playTimer = null;
    const controller = wrappedController!;
    stepByPlayback(() => controller.next());
    if (!playing) return;
    if (controller.currentStep === controller.totalSteps) {
      setPlaying(false);
    } else {
      schedulePlayStep();
    }
  }

  function play(): void {
    const controller = wrappedController;
    // The full diagram's controller has no steps, so it is caught here too.
    if (destroyed || playing || controller === null || controller.totalSteps === 0) return;
    if (controller.currentStep === controller.totalSteps) {
      // Replay: step 0 shows for a whole interval, like every other step.
      stepByPlayback(() => controller.reset());
      setPlaying(true);
      // onPlaybackChange or update() may have paused already.
      if (playing) schedulePlayStep();
    } else {
      setPlaying(true);
      if (playing) playStep();
    }
  }

  /** Stops playback, if running: no further step is taken. */
  function pause(): void {
    if (!playing) return;
    clearPlayTimer();
    setPlaying(false);
  }

  function setPlayInterval(ms: number): void {
    const previous = playInterval;
    playInterval = checkPlayInterval(ms);
    const changed = playInterval !== previous;
    // Restarted even for the same value: the call itself is "from now".
    if (playTimer !== null) {
      clearPlayTimer();
      schedulePlayStep();
    }
    if (changed) updateControls();
  }

  /**
   * Turns the dot grid by toggling the canvas's class; the chrome stylesheet
   * does the drawing, and the viewport's published view moves it with
   * pan/zoom (viewport.ts). No render: the diagram is untouched.
   */
  function setDotGrid(on: boolean): void {
    if (destroyed || on === dotGrid) return;
    dotGrid = on;
    canvas.classList.toggle(DOTS_CLASS, dotGrid);
    updateControls();
    options.onDotGridChange?.(dotGrid);
  }

  /** Whether the board fills the browser window: its fullscreen where the screen is not to be had. */
  let fill = false;
  /** The `fullscreen` last reported, so a callback fires only when it actually turns. */
  let fullscreen = false;
  /** True while a `requestFullscreen` has not yet been answered. */
  let screenPending = false;
  /** Whether the last `setFullscreen` while the request is pending said false: leave the screen once it is entered. */
  let leaveWhenEntered = false;

  /** Recomputes `fullscreen`; if it turned, tells the bar and the caller. */
  function syncFullscreen(): void {
    const now = fill || document.fullscreenElement === container;
    if (now === fullscreen) return;
    fullscreen = now;
    updateControls();
    options.onFullscreenChange?.(fullscreen);
  }

  function setFill(on: boolean): void {
    fill = on;
    container.classList.toggle(FILL_CLASS, on);
    // The browser's Esc leaves only its own fullscreen; the fill's is ours,
    // heard only while it is on.
    if (on) document.addEventListener("keydown", onFillKeydown);
    else document.removeEventListener("keydown", onFillKeydown);
    syncFullscreen();
  }

  /**
   * Esc leaves the fill. One already handled — a dropdown closing on it
   * stops it before it gets here, anything else calls `preventDefault()` —
   * is left alone.
   */
  function onFillKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !event.defaultPrevented) setFill(false);
  }

  /**
   * Whether the browser will take the container to the screen. jsdom, iPhone
   * Safari and an iframe without `allowfullscreen` will not: the first two
   * lack `requestFullscreen`, the last says `fullscreenEnabled === false`.
   */
  function screenAvailable(): boolean {
    return document.fullscreenEnabled === true && typeof container.requestFullscreen === "function";
  }

  function setFullscreen(on: boolean): void {
    if (destroyed) return;
    if (screenPending) {
      // The answer is not in yet: the last word is kept for it, and asking
      // again would only ask twice.
      leaveWhenEntered = !on;
      return;
    }
    if (on === fullscreen) return;
    if (on && screenAvailable()) {
      screenPending = true;
      leaveWhenEntered = false;
      // Turned by fullscreenchange, once the browser has given the screen;
      // refused, the window is the next best thing — unless the reader has
      // asked to leave in the meantime. Wrapped in Promise.resolve, so the
      // answer is handled the same whatever it returns.
      Promise.resolve(container.requestFullscreen()).then(
        () => {
          screenPending = false;
          if (leaveWhenEntered) leaveScreen();
        },
        () => {
          screenPending = false;
          if (!leaveWhenEntered) setFill(true);
        },
      );
      return;
    }
    if (!on && !fill) {
      // On the screen: turned by fullscreenchange, once the browser lets go.
      leaveScreen();
      return;
    }
    setFill(on);
  }

  /** Asks the browser to give the screen back, if the container holds it; a refusal leaves things as they are. */
  function leaveScreen(): void {
    if (document.fullscreenElement === container) Promise.resolve(document.exitFullscreen()).catch(() => {});
  }

  // Covers every way the screen turns: our request, Esc, another element taking it.
  document.addEventListener("fullscreenchange", syncFullscreen);

  /** The mounted control bar, built-in or custom; unset with `controls: false`. */
  let controls: ReturnType<ControlsFactory> | undefined;

  /** Tells the mounted bar the board changed; a destroyed board has no bar left to tell. */
  function updateControls(): void {
    if (!destroyed) controls?.update?.();
  }

  const board: Board = {
    get controller() {
      return wrappedController;
    },
    get diagnostics() {
      return diagnostics;
    },
    get fullDiagram() {
      return fullDiagram;
    },
    get fullscreen() {
      return fullscreen;
    },
    get omitAuthorStyles() {
      return omitAuthorStyles;
    },
    get styles() {
      return styles;
    },
    get siren() {
      return siren;
    },
    get timelines() {
      return timelines;
    },
    get timeline() {
      return currentTimeline;
    },
    get playing() {
      return playing;
    },
    get playInterval() {
      return playInterval;
    },
    get dotGrid() {
      return dotGrid;
    },
    setSource,
    setFullDiagram,
    setFullscreen,
    setDotGrid,
    setOmitAuthorStyles,
    setTimeline,
    play,
    pause,
    setPlayInterval,
    resetView() {
      viewport.resetView();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // Stopped silently: a destroyed board reports nothing more.
      clearPlayTimer();
      playing = false;
      viewport.destroy();
      // Out of the fill or the screen, silently: the listeners go first, so
      // the fullscreenchange that follows reaches nothing.
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("keydown", onFillKeydown);
      container.classList.remove(FILL_CLASS);
      fill = false;
      fullscreen = false;
      // A request still pending leaves the screen as soon as it is entered.
      leaveWhenEntered = true;
      leaveScreen();
      controls?.destroy?.();
      container.replaceChildren();
      container.classList.remove("siren-board");
    },
  };

  if (options.controls !== false) {
    // The built-in bar is an ordinary ControlsFactory (ADR-0006).
    const factory = typeof options.controls === "function" ? options.controls : createDefaultControls;
    controls = factory(board);
    container.appendChild(controls.element);
  }

  if (options.source !== undefined) {
    setSource(options.source);
  }

  return board;
}
