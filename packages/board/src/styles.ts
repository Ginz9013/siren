const STYLE_ELEMENT_ID = "siren-board-styles";

/**
 * Board's chrome CSS: full-bleed responsive sizing (the container fills its
 * parent, the mounted SVG stretches to 100%/100% and scales via its own
 * `viewBox` — no ResizeObserver needed), the error-banner overlay shown on a
 * failed `setSource`, and the default control bar, positioned relative to
 * board's own container rather than the viewport (see ADR-0006 — a board
 * embedded anywhere, or several on one page, must not have its controls fly
 * to the window edge or collide with another instance's). Auto-injected
 * rather than a file consumers link themselves. In the bar, a pressed button
 * (Full diagram while the full diagram shows, Play while playing) takes the
 * accent color, and a disabled one (a step button or Play while there is
 * nothing to step through) fades and ignores hover. The play interval dropdown's trigger wears the buttons' border,
 * surface and radius, and fades the same way when there is nothing to play;
 * its listbox opens directly above the trigger — always there, never flipped
 * below for want of room, and never scrolled, since it holds every option at
 * once — with the selected option in the accent color. The step
 * counter sets its digits in tabular figures, so the bar keeps its width as
 * the count changes.
 *
 * DOM shape this targets: `.siren-board` (the consumer's container) holds
 * `.siren-board-canvas` as one child, and `.siren-board-controls` as a
 * sibling — kept out of the canvas layer specifically so a re-render never
 * wipes out the control bar. `.siren-board-canvas` in turn holds two of its
 * own children: `.siren-board-viewport` (everything `render()`
 * mounts/replaces on each `setSource`, receiving the pan/zoom transform —
 * see viewport.ts) and, conditionally, the error banner — a sibling of the
 * viewport so it is never panned or zoomed along with the diagram.
 *
 * Every chrome color goes through a `--siren-board-*` token, declared here
 * rather than in `siren-core`'s theme (ADR-0006: board owns its chrome).
 * The values are siren-website's decision 01M3BY1GPP, and there is one set of
 * them, in one `:root` block — the same shape core's theme has (ADR-0014).
 * Board picks no palette on the page's behalf: nothing below reads the
 * reader's system color preference or any theme attribute, so a consumer who
 * wants dark chrome redeclares these six tokens under a selector of their own,
 * exactly as they would core's color tokens. demos/theme-dark.css does both
 * at once.
 */
const CSS = `
:root {
  --siren-board-surface: #ffffff;
  --siren-board-surface-hover: #f8f6fc;
  --siren-board-text: #1d1730;
  --siren-board-border: #e7e2f1;
  --siren-board-accent: #6d3fd6;
  --siren-board-danger: #c0264b;
}

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
  user-select: none;
  -webkit-user-drag: none;
}

.siren-board-viewport img,
.siren-board-viewport svg {
  -webkit-user-drag: none;
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
  color: var(--siren-board-danger);
  background: color-mix(in srgb, var(--siren-board-surface) 85%, transparent);
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
  background: color-mix(in srgb, var(--siren-board-surface) 90%, transparent);
  border: 1px solid var(--siren-board-border);
  border-radius: 12px;
  box-shadow: 0 4px 16px color-mix(in srgb, var(--siren-board-text) 12%, transparent);
}

.siren-board-controls__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  border: 1px solid var(--siren-board-border);
  border-radius: 8px;
  background: var(--siren-board-surface);
  color: var(--siren-board-text);
  cursor: pointer;
}

.siren-board-controls__button:hover {
  border-color: var(--siren-board-accent);
  background: var(--siren-board-surface-hover);
  color: var(--siren-board-accent);
}

.siren-board-controls__button[aria-pressed="true"] {
  border-color: var(--siren-board-accent);
  background: var(--siren-board-surface-hover);
  color: var(--siren-board-accent);
}

.siren-board-controls__button:disabled {
  border-color: var(--siren-board-border);
  background: var(--siren-board-surface);
  color: var(--siren-board-text);
  opacity: 0.4;
  cursor: not-allowed;
}

.siren-board-controls__interval {
  position: relative;
  display: flex;
}

.siren-board-controls__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.375rem 0 0.625rem;
  border: 1px solid var(--siren-board-border);
  border-radius: 8px;
  background: var(--siren-board-surface);
  color: var(--siren-board-text);
  font: 14px system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.siren-board-controls__trigger:hover,
.siren-board-controls__trigger[aria-expanded="true"] {
  border-color: var(--siren-board-accent);
  background: var(--siren-board-surface-hover);
}

.siren-board-controls__trigger:disabled {
  border-color: var(--siren-board-border);
  background: var(--siren-board-surface);
  opacity: 0.4;
  cursor: not-allowed;
}

.siren-board-controls__listbox {
  position: absolute;
  bottom: calc(100% + 0.5rem);
  left: 50%;
  transform: translateX(-50%);
  min-width: 100%;
  padding: 0.25rem;
  border: 1px solid var(--siren-board-border);
  border-radius: 8px;
  background: var(--siren-board-surface);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--siren-board-text) 12%, transparent);
}

.siren-board-controls__option {
  padding: 0.25rem 0.625rem;
  border-radius: 6px;
  color: var(--siren-board-text);
  font: 14px system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: pointer;
}

.siren-board-controls__option:hover {
  background: var(--siren-board-surface-hover);
}

.siren-board-controls__option[aria-selected="true"] {
  color: var(--siren-board-accent);
}

.siren-board-controls__step {
  display: inline-flex;
  align-items: center;
  padding: 0 0.25rem;
  color: var(--siren-board-text);
  font: 14px system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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
