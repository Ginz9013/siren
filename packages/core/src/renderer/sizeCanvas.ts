/**
 * Blank space kept around a diagram's laid-out extent, on every side.
 *
 * The layout's `width`/`height` is the extent of the frames it placed, and
 * nothing more — but the theme paints past a frame. `.siren-highlight-glow`
 * stacks an 8px drop-shadow that blurs out by about its own radius, and an
 * outline highlight thickens a frame's stroke to 3, half of it outside the
 * frame. A canvas cut exactly at the layout's extent clips both on any
 * element placed against the edge, which is where a layout puts the first
 * and last of everything.
 *
 * 16 rather than the 9.5 those two strictly need: a blur has no hard edge,
 * and the tail of the outer shadow is still visible past its radius.
 */
export const CANVAS_GUTTER = 16;

/**
 * Sizes a root `<svg>` to a laid-out extent plus `CANVAS_GUTTER` on every
 * side. The gutter goes into the viewBox's origin, not into any element's
 * coordinates: everything is still drawn where its layout placed it, and
 * only the window onto the drawing widens.
 *
 * One function, five callers — every diagram kind's renderer sizes its root
 * here, so no kind can end up with a gutter the others lack.
 */
export function sizeCanvas(svg: SVGSVGElement, width: number, height: number): void {
  const spanX = width + CANVAS_GUTTER * 2;
  const spanY = height + CANVAS_GUTTER * 2;
  svg.setAttribute("width", String(spanX));
  svg.setAttribute("height", String(spanY));
  svg.setAttribute("viewBox", `${-CANVAS_GUTTER} ${-CANVAS_GUTTER} ${spanX} ${spanY}`);
}
