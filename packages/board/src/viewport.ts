const VIEWPORT_CLASS = "siren-board-viewport";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const ZOOM_SENSITIVITY = 0.0025;
/**
 * Extra blank space, as a fraction of the surface's own width/height, the
 * user can drag the content past its true edge before the pan clamp locks —
 * so the boundary doesn't feel like it's snapping tight against the diagram
 * itself.
 */
const PAN_MARGIN_RATIO = 0.5;

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
 * naturally reports zero size in that case and the clamp math below then
 * has nothing to compute a margin from.
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
   * Clamps the current offset around its "rest" range against `surface`'s
   * current size, plus `PAN_MARGIN_RATIO` of the surface's size as a
   * blank-space buffer on each side — on every axis, regardless of whether
   * the scaled content currently overflows the surface or not, so dragging
   * always does *something*: an axis where content is smaller than the
   * surface still lets it be dragged PAN_MARGIN_RATIO past dead center
   * before locking, rather than being pinned there outright.
   */
  function clampOffset(): void {
    const rect = surface.getBoundingClientRect();
    const scaledWidth = rect.width * scale;
    const scaledHeight = rect.height * scale;
    const marginX = rect.width * PAN_MARGIN_RATIO;
    const marginY = rect.height * PAN_MARGIN_RATIO;
    const restMinX = Math.min(0, rect.width - scaledWidth);
    const restMaxX = Math.max(0, rect.width - scaledWidth);
    const restMinY = Math.min(0, rect.height - scaledHeight);
    const restMaxY = Math.max(0, rect.height - scaledHeight);
    offsetX = Math.min(restMaxX + marginX, Math.max(restMinX - marginX, offsetX));
    offsetY = Math.min(restMaxY + marginY, Math.max(restMinY - marginY, offsetY));
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
    // preventDefault() also cancels the browser moving focus off whatever
    // held it, so a control the reader just used (the play interval select)
    // would stay focused; give back that part of the default.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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
