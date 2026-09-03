import { render } from "@siren/core";
import type { AnimationController, Diagnostic, TextMeasurer } from "@siren/core";
import { ensureStylesInjected } from "./styles";
import { createCanvasTextMeasurer } from "./textMeasurer";

const ERROR_BANNER_CLASS = "siren-board-error";

/** Options accepted by `createBoard`. */
export interface BoardOptions {
  /** Initial `.srn` source. Omit to mount an empty board and call `setSource` later. */
  source?: string;
  /** Overrides board's default real-browser canvas measurer (see textMeasurer.ts). */
  measureText?: TextMeasurer;
  /** Fired on every `setSource` call (construction included), fatal or warning-only. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

/**
 * A mounted, self-contained wrapper around one `@siren/core` `render()` call
 * — see ADR-0005 for why this owns calling `render()` itself rather than
 * wrapping an already-rendered result, and CONTEXT.md's "Board" entry.
 */
export interface Board {
  readonly controller: AnimationController | null;
  readonly diagnostics: Diagnostic[];
  setSource(source: string): void;
  destroy(): void;
}

export function createBoard(container: HTMLElement, options: BoardOptions = {}): Board {
  ensureStylesInjected();
  container.classList.add("siren-board");

  const measureText = options.measureText ?? createCanvasTextMeasurer();
  let controller: AnimationController | null = null;
  let diagnostics: Diagnostic[] = [];
  let destroyed = false;

  function showErrorBanner(): void {
    clearErrorBanner();
    const banner = document.createElement("div");
    banner.className = ERROR_BANNER_CLASS;
    banner.textContent = "Render failed — see diagnostics.";
    container.appendChild(banner);
  }

  function clearErrorBanner(): void {
    container.querySelector(`.${ERROR_BANNER_CLASS}`)?.remove();
  }

  function setSource(source: string): void {
    const result = render(source, container, { measureText });
    diagnostics = result.diagnostics;
    if (result.svg === null) {
      // render() leaves the container untouched on failure (see
      // packages/core/src/index.ts) — the previous diagram and controller
      // stay live; only overlay the error banner on top of them.
      showErrorBanner();
    } else {
      clearErrorBanner();
      controller = result.controller;
    }
    options.onDiagnostics?.(diagnostics);
  }

  if (options.source !== undefined) {
    setSource(options.source);
  }

  return {
    get controller() {
      return controller;
    },
    get diagnostics() {
      return diagnostics;
    },
    setSource,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      container.replaceChildren();
      container.classList.remove("siren-board");
    },
  };
}
