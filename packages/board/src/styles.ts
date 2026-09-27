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
 *
 * Every chrome color goes through a `--siren-board-*` token, declared here
 * rather than in `@siren/core`'s theme (ADR-0006: board owns its chrome).
 * The values are siren-website's decision 01M3BY1GPP, light and dark, on the
 * same selectors core uses for its own palette (ADR-0011): dark follows the
 * system unless the page pins `<html data-theme="light|dark">`, and an
 * element carrying `data-theme="light"` stays light inside a dark page. The
 * dark set is written twice because a media query and an attribute selector
 * cannot share one rule; styles.test.ts keeps the two copies identical.
 */
const CSS = `
:root,
[data-theme="light"] {
  --siren-board-surface: #ffffff;
  --siren-board-surface-hover: #f8f6fc;
  --siren-board-text: #1d1730;
  --siren-board-border: #e7e2f1;
  --siren-board-accent: #6d3fd6;
  --siren-board-danger: #c0264b;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --siren-board-surface: #14111d;
    --siren-board-surface-hover: #1d1929;
    --siren-board-text: #ece8f8;
    --siren-board-border: #302a44;
    --siren-board-accent: #b69cff;
    --siren-board-danger: #ff8fa3;
  }
}

:root[data-theme="dark"] {
  --siren-board-surface: #14111d;
  --siren-board-surface-hover: #1d1929;
  --siren-board-text: #ece8f8;
  --siren-board-border: #302a44;
  --siren-board-accent: #b69cff;
  --siren-board-danger: #ff8fa3;
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
  font: inherit;
  padding: 0.5rem 1.25rem;
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
