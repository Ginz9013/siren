import { render } from "siren-core";
import type { AnimationController, Diagnostic, TextMeasurer } from "siren-core";
import { ensureStylesInjected } from "./styles";
import { createCanvasTextMeasurer } from "./textMeasurer";
import { createDefaultControls } from "./defaultControls";
import { createViewport } from "./viewport";

const ERROR_BANNER_CLASS = "siren-board-error";
const CANVAS_CLASS = "siren-board-canvas";
const DEFAULT_PLAY_INTERVAL = 2000;

/**
 * A caller-supplied replacement for board's default control bar. Board calls
 * `update` once after anything a bar shows may have changed — a `setSource`
 * that rendered, a step change from any source, a `fullDiagram` or `timeline`
 * switch, a `playing` or `playInterval` change — and never after `destroy()`; read the
 * new state off `board` there.
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
   * Fired whenever `timeline` changes: from `setTimeline`, or from a
   * `setSource` whose document does not declare the current name. Not fired
   * for the initial timeline, set by the first render that succeeds.
   */
  onTimelineChange?: (name: string | null) => void;
  /** Fired whenever `fullDiagram` changes, from the built-in bar or a direct `setFullDiagram` call. */
  onFullDiagramChange?: (fullDiagram: boolean) => void;
  /** Milliseconds between playback steps; must be finite and > 0 (see `Board.setPlayInterval`). */
  playInterval?: number;
  /** Fired whenever `playing` changes: `play()`, `pause()`, the last step, or anything else that stops playback. */
  onPlaybackChange?: (playing: boolean) => void;
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
   * before. Never changes
   * the view or `diagnostics`, and fires neither `onStepChange` nor
   * `onDiagnostics`. Setting the current value is a no-op. Like
   * `setSource`, it replaces `controller`: read it again rather than keeping
   * the old one.
   */
  setFullDiagram(on: boolean): void;
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

  const viewport = createViewport(canvas);

  const measureText = options.measureText ?? createCanvasTextMeasurer();
  let wrappedController: AnimationController | null = null;
  let diagnostics: Diagnostic[] = [];
  let destroyed = false;
  let fullDiagram = false;
  /** `timelines` of the last render that succeeded. */
  let timelines: readonly string[] = [];
  let currentTimeline: string | null = null;
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
    return render(source, viewport.content, { measureText, timeline: full ? false : (name ?? true) });
  }

  /**
   * Renders a new document on the current timeline if it declares that
   * name, else on its first. Board cannot ask the document for its names
   * without rendering it (ADR-0005: board never parses), so it asks core for
   * the name and falls back on the `RangeError` an undeclared one throws —
   * core throws before mounting anything, so the fallback is the only render
   * the reader sees.
   */
  function renderKeepingTimeline(source: string) {
    if (fullDiagram || currentTimeline === null) return renderDocument(source, fullDiagram);
    try {
      return renderDocument(source, false, currentTimeline);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return renderDocument(source, false);
    }
  }

  function setSource(source: string): void {
    // Rendered or not, the reader asked for another document: stop either way.
    pause();
    const result = renderKeepingTimeline(source);
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
      // The same choice renderKeepingTimeline made: the name if declared, else the first.
      currentTimeline =
        currentTimeline !== null && timelines.includes(currentTimeline) ? currentTimeline : (timelines[0] ?? null);
      // A new document starts its timeline at step 0, full diagram or not.
      stepBeforeFullDiagram = 0;
      wrappedController = wrapController(result.controller!);
      viewport.resetView();
      updateControls();
      if (!isFirstRender && currentTimeline !== previousTimeline) options.onTimelineChange?.(currentTimeline);
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
    }
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
    // Checked before anything is touched, so a bad name leaves the board,
    // playback included, exactly as it was — the same RangeError core's
    // render() throws, but core would only throw after playback had stopped.
    if (!timelines.includes(name)) {
      const declared =
        timelines.length > 0
          ? `this document declares: ${timelines.join(", ")}`
          : "this document declares no named timelines";
      throw new RangeError(`No timeline named ${JSON.stringify(name)}; ${declared}`);
    }
    if (name === currentTimeline) {
      // Asking for the timeline the full diagram is hiding means "show it
      // again": exactly switching the full diagram off.
      if (fullDiagram) setFullDiagram(false);
      return;
    }
    if (renderedSource === null) return;
    // Another timeline is another story: playback of this one ends here.
    pause();
    const result = renderDocument(renderedSource, false, name);
    if (result.svg === null) return;
    wrappedController = wrapController(result.controller!);
    currentTimeline = name;
    // Choosing a timeline from the full diagram also leaves it — another
    // name starts that timeline at step 0, so nothing is restored.
    const leftFullDiagram = fullDiagram;
    fullDiagram = false;
    updateControls();
    if (leftFullDiagram) options.onFullDiagramChange?.(false);
    options.onTimelineChange?.(currentTimeline);
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
    setSource,
    setFullDiagram,
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
