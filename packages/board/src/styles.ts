const STYLE_ELEMENT_ID = "siren-board-styles";

/**
 * Board's chrome CSS: full-bleed responsive sizing (the container fills its
 * parent, the mounted SVG stretches to 100%/100% and scales via its own
 * `viewBox` — no ResizeObserver needed), the error-banner overlay shown on a
 * failed `setSource`, and the default control bar, positioned relative to
 * board's own container rather than the viewport (see ADR-0006 — a board
 * embedded anywhere, or several on one page, must not have its controls fly
 * to the window edge or collide with another instance's). Auto-injected
 * rather than a file consumers link themselves.
 *
 * DOM shape this targets: `.siren-board` (the consumer's container) holds
 * `.siren-board-canvas` as one child, and `.siren-board-controls` as a
 * sibling — kept out of the canvas layer specifically so a re-render never
 * wipes out the control bar. `.siren-board-canvas` in turn holds two of its
 * own children: `.siren-board-viewport` (everything `render()`
 * mounts/replaces on each `setSource`, receiving the pan/zoom transform —
 * see viewport.ts) and, conditionally, the error banner — a sibling of the
 * viewport so it is never panned or zoomed along with the diagram.
 */
const CSS = `
.siren-board {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.siren-board-canvas {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.siren-board-viewport {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
}

.siren-board-viewport > svg {
  display: block;
  width: 100%;
  height: 100%;
}

.siren-board-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  text-align: center;
  font: 14px system-ui, sans-serif;
  color: #b00020;
  background: rgba(255, 255, 255, 0.85);
}

.siren-board-controls {
  position: absolute;
  left: 50%;
  bottom: 1rem;
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid #ccc;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.siren-board-controls__button {
  font: inherit;
  padding: 0.5rem 1.25rem;
  border: 1px solid #333;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
}

.siren-board-controls__button:hover {
  background: #eee;
}
`;

/**
 * Appends board's chrome stylesheet to `document.head` exactly once per
 * page, regardless of how many boards get created — a second call is a
 * no-op.
 */
export function ensureStylesInjected(): void {
  if (document.getElementById(STYLE_ELEMENT_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
