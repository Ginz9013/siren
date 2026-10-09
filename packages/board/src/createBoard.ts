import { render } from "siren-core";
import type { AnimationController, Diagnostic, TextMeasurer } from "siren-core";
import { ensureStylesInjected } from "./styles";
import { createCanvasTextMeasurer } from "./textMeasurer";
import { createDefaultControls } from "./defaultControls";
import { createViewport } from "./viewport";

const ERROR_BANNER_CLASS = "siren-board-error";
const CANVAS_CLASS = "siren-board-canvas";

/** A caller-supplied replacement for board's default control bar. */
export type ControlsFactory = (board: Board) => { element: HTMLElement; destroy?(): void };

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
  /** Fired whenever `fullDiagram` changes, from the built-in bar or a direct `setFullDiagram` call. */
  onFullDiagramChange?: (fullDiagram: boolean) => void;
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
   * Switches the full diagram on or off by re-rendering the last rendered
   * source; switching off returns to the step shown before. Never changes
   * the view or `diagnostics`, and fires neither `onStepChange` nor
   * `onDiagnostics`. Setting the current value is a no-op. Like
   * `setSource`, it replaces `controller`: read it again rather than keeping
   * the old one.
   */
  setFullDiagram(on: boolean): void;
  /** Resets pan/zoom to the initial fit-to-container state (scale 1.0, no offset). */
  resetView(): void;
  destroy(): void;
}

export function createBoard(container: HTMLElement, options: BoardOptions = {}): Board {
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
  /**
   * The source of the last `setSource` call that rendered. Toggling the full
   * diagram re-renders this rather than the latest source, so a failed
   * `setSource` (error banner showing) never turns into a blank board.
   */
  let renderedSource: string | null = null;
  /** The timeline step to return to when the full diagram is switched off. */
  let stepBeforeFullDiagram = 0;

  function wrapController(real: AnimationController): AnimationController {
    function afterCall(previousStep: number): void {
      if (real.currentStep !== previousStep) {
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

  /** The one place board calls core's `render()`: `full` draws the full diagram. */
  function renderDocument(source: string, full: boolean) {
    return render(source, viewport.content, { measureText, timeline: !full });
  }

  function setSource(source: string): void {
    const result = renderDocument(source, fullDiagram);
    diagnostics = result.diagnostics;
    if (result.svg === null) {
      // render() leaves the viewport's content layer untouched on failure
      // (see packages/core/src/index.ts) — the previous diagram and
      // controller stay live, and so does the current pan/zoom view; only
      // overlay the error banner on top of them.
      showErrorBanner();
    } else {
      clearErrorBanner();
      renderedSource = source;
      // A new document starts its timeline at step 0, full diagram or not.
      stepBeforeFullDiagram = 0;
      wrappedController = wrapController(result.controller!);
      viewport.resetView();
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
    if (renderedSource !== null) {
      const result = renderDocument(renderedSource, on);
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
    syncFullDiagram?.();
    options.onFullDiagramChange?.(fullDiagram);
  }

  let controlsDestroy: (() => void) | undefined;
  /**
   * Set only when the built-in bar is mounted. A custom `ControlsFactory`
   * reads `board.fullDiagram` and listens through `onFullDiagramChange`
   * instead; there is deliberately no public hook for this.
   */
  let syncFullDiagram: (() => void) | undefined;

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
    setSource,
    setFullDiagram,
    resetView() {
      viewport.resetView();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      viewport.destroy();
      controlsDestroy?.();
      container.replaceChildren();
      container.classList.remove("siren-board");
    },
  };

  if (options.controls !== false) {
    let controls: ReturnType<ControlsFactory>;
    if (typeof options.controls === "function") {
      controls = options.controls(board);
    } else {
      const builtIn = createDefaultControls(board);
      syncFullDiagram = builtIn.syncFullDiagram;
      controls = builtIn;
    }
    container.appendChild(controls.element);
    controlsDestroy = controls.destroy;
  }

  if (options.source !== undefined) {
    setSource(options.source);
  }

  return board;
}
