const STYLE_ELEMENT_ID = "siren-board-styles";

/**
 * Board's chrome CSS: full-bleed responsive sizing (the container fills its
 * parent, the mounted SVG stretches to 100%/100% and scales via its own
 * `viewBox` — no ResizeObserver needed) plus the error-banner overlay shown
 * on a failed `setSource`. Auto-injected rather than a file consumers link
 * themselves — see ADR-0006.
 */
const CSS = `
.siren-board {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.siren-board > svg {
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
