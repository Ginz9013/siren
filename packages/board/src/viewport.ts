const VIEWPORT_CLASS = "siren-board-viewport";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const ZOOM_SENSITIVITY = 0.001;

/**
 * Owns board's pan/zoom DOM layer (`.siren-board-viewport`) and its mouse
 * drag / wheel event handling — see spec.md's "View" domain decision.
 * Doesn't call `render()` or touch the mounted SVG's internals, doesn't know
 * about `AnimationController`/diagnostics/steps, and isn't responsible for
 * the error banner (a sibling layer owned by `createBoard`).
 */
export interface Viewport {
  /** Mount target: `render()`'s container goes here, not the outer surface. */
  readonly content: HTMLElement;
  /** Resets scale to 1.0 and offset to (0, 0), unconditionally. */
  resetView(): void;
  /** Removes `content` and every listener `createViewport` attached. Idempotent. */
  destroy(): void;
}

/**
 * `surface` is the existing positioning layer (board's `.siren-board-canvas`)
 * that the new `.siren-board-viewport` element is appended into — mirrors
 * `createDefaultControls(board)`'s pattern of accepting a mount point rather
 * than creating its own. A detached or zero-size `surface` degrades to inert
 * (no pan/zoom range) rather than throwing, since `getBoundingClientRect()`
 * naturally reports zero size in that case and the clamp math below locks
 * offsets to 0 whenever scaled content isn't larger than the surface.
 */
export function createViewport(surface: HTMLElement): Viewport {
  const content = document.createElement("div");
  content.className = VIEWPORT_CLASS;
  surface.appendChild(content);

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let dragStartOffsetX = 0;
  let dragStartOffsetY = 0;
  let destroyed = false;

  function applyTransform(): void {
    content.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }

  /**
   * Clamps the current offset against `surface`'s current size: an axis
   * where scaled content is larger than the surface can't be dragged to
   * reveal empty space past its own edge; an axis where scaled content is
   * smaller than (or equal to) the surface is locked centered.
   */
  function clampOffset(): void {
    const rect = surface.getBoundingClientRect();
    const scaledWidth = rect.width * scale;
    const scaledHeight = rect.height * scale;
    offsetX =
      scaledWidth > rect.width
        ? Math.min(0, Math.max(rect.width - scaledWidth, offsetX))
        : (rect.width - scaledWidth) / 2;
    offsetY =
      scaledHeight > rect.height
        ? Math.min(0, Math.max(rect.height - scaledHeight, offsetY))
        : (rect.height - scaledHeight) / 2;
  }

  function onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    // Without this, a real click-drag starting on the SVG can be hijacked by
    // the browser's native image/element drag-and-drop or text-selection
    // gesture, which swallows the mousemove sequence below entirely — a real
    // human drag can trigger this even though synthetic/automated mousedown
    // events typically don't, so it doesn't show up under jsdom or CDP-driven
    // testing.
    event.preventDefault();
    dragging = true;
    dragStartClientX = event.clientX;
    dragStartClientY = event.clientY;
    dragStartOffsetX = offsetX;
    dragStartOffsetY = offsetY;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function onMouseMove(event: MouseEvent): void {
    if (!dragging) return;
    offsetX = dragStartOffsetX + (event.clientX - dragStartClientX);
    offsetY = dragStartOffsetY + (event.clientY - dragStartClientY);
    clampOffset();
    applyTransform();
  }

  function onMouseUp(): void {
    dragging = false;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  }

  /** Cursor-anchored zoom: the content point under the cursor before the
   * wheel event stays under the cursor after it. */
  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = surface.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const localX = (cursorX - offsetX) / scale;
    const localY = (cursorY - offsetY) / scale;
    const factor = Math.exp(-event.deltaY * ZOOM_SENSITIVITY);
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    offsetX = cursorX - localX * nextScale;
    offsetY = cursorY - localY * nextScale;
    scale = nextScale;
    clampOffset();
    applyTransform();
  }

  surface.addEventListener("mousedown", onMouseDown);
  surface.addEventListener("wheel", onWheel, { passive: false });

  applyTransform();

  return {
    content,
    resetView() {
      scale = 1;
      offsetX = 0;
      offsetY = 0;
      applyTransform();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      surface.removeEventListener("mousedown", onMouseDown);
      surface.removeEventListener("wheel", onWheel);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      content.remove();
    },
  };
}
