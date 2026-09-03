import type { Board } from "./createBoard";

const CONTROLS_CLASS = "siren-board-controls";
const BUTTON_CLASS = "siren-board-controls__button";

/**
 * Board's built-in Prev/Next/Reset control bar — the default value of
 * `BoardOptions.controls`. Reads `board.controller` at click time rather
 * than capturing it once, so it keeps working across `setSource` calls that
 * replace the underlying controller. Turn it off with `controls: false`, or
 * replace it with any other `ControlsFactory` (see ADR-0006).
 */
export function createDefaultControls(board: Board): { element: HTMLElement; destroy?(): void } {
  const bar = document.createElement("div");
  bar.className = CONTROLS_CLASS;

  bar.append(
    makeButton("Prev", () => board.controller?.prev()),
    makeButton("Next", () => board.controller?.next()),
    makeButton("Reset", () => board.controller?.reset()),
  );

  return { element: bar };
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}
