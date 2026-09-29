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
}

/**
 * A mounted, self-contained wrapper around one `siren-core` `render()` call
 * — see ADR-0005 for why this owns calling `render()` itself rather than
 * wrapping an already-rendered result, and CONTEXT.md's "Board" entry.
 */
export interface Board {
  readonly controller: AnimationController | null;
  readonly diagnostics: Diagnostic[];
  setSource(source: string): void;
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

  function setSource(source: string): void {
    const result = render(source, viewport.content, { measureText });
    diagnostics = result.diagnostics;
    if (result.svg === null) {
      // render() leaves the viewport's content layer untouched on failure
      // (see packages/core/src/index.ts) — the previous diagram and
      // controller stay live, and so does the current pan/zoom view; only
      // overlay the error banner on top of them.
      showErrorBanner();
    } else {
      clearErrorBanner();
      wrappedController = wrapController(result.controller!);
      viewport.resetView();
    }
    options.onDiagnostics?.(diagnostics);
  }

  let controlsDestroy: (() => void) | undefined;

  const board: Board = {
    get controller() {
      return wrappedController;
    },
    get diagnostics() {
      return diagnostics;
    },
    setSource,
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
    const factory = typeof options.controls === "function" ? options.controls : createDefaultControls;
    const controls = factory(board);
    container.appendChild(controls.element);
    controlsDestroy = controls.destroy;
  }

  if (options.source !== undefined) {
    setSource(options.source);
  }

  return board;
}
