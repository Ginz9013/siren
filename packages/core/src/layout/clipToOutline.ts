import type { Point } from "../contracts";

/**
 * Moving a route's ends onto the outlines of the shapes they meet.
 *
 * The layout engine routes every edge to its node's **bounding box**: it is
 * handed sizes and never learns a shape exists. A diamond, a circle, a
 * triangle on its side is inscribed in that box, so an end left on the box
 * stops short of the shape and the arrow points at nothing. This pass runs
 * after layout and slides each end along the run that reaches it — the
 * route's first or last segment, extended or shortened — until it meets the
 * shape's outline (`ShapeSpec.outline`). Only the end point moves: the route
 * keeps its points, its bends and its labels.
 *
 * Mermaid 12.2.0 does the same on its ELK layout (measured in headless
 * Chrome, classic look): an edge into a diamond beside its top corner runs
 * straight down from its last bend onto the slanted side, rather than
 * turning toward the diamond's centre.
 */

/** How close two numbers have to be to count as equal here. */
const EPSILON = 1e-9;

/**
 * Where the line from `from` through `to`, carried on past `to`, first meets
 * `outline` — the crossing nearest `from`, so nearest the outside of the
 * shape the line is running into. `null` when it meets none ahead of `from`.
 *
 * A crossing is read edge by edge, never by asking which side of the outline
 * is inside: an outline may cross itself (an hourglass is two triangles
 * meeting at a pinch), and a winding rule would call one of its halves
 * outside. The point where an outline crosses itself is not a place a line
 * can end — a line through an hourglass's pinch touches the figure there
 * without entering it — so a crossing there is not counted.
 */
export function outlineCrossing(from: Point, to: Point, outline: readonly Point[]): Point | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) {
    return null;
  }
  let nearest: number | null = null;
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < EPSILON) {
      return;
    }
    // `from + t (to - from) = a + u (b - a)`.
    const t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / denominator;
    const u = ((a.x - from.x) * dy - (a.y - from.y) * dx) / denominator;
    if (u < -EPSILON || u > 1 + EPSILON || t <= EPSILON) {
      return;
    }
    if (nearest !== null && t >= nearest) {
      return;
    }
    const crossing = { x: from.x + t * dx, y: from.y + t * dy };
    if (u > EPSILON && u < 1 - EPSILON && crossesItselfAt(outline, i, crossing)) {
      return;
    }
    nearest = t;
  });
  return nearest === null ? null : { x: from.x + nearest * dx, y: from.y + nearest * dy };
}

/** Whether `point`, inside the outline's `edge`th side, is also inside another side it does not share a corner with. */
function crossesItselfAt(outline: readonly Point[], edge: number, point: Point): boolean {
  const count = outline.length;
  return outline.some((a, i) => {
    if (i === edge || (i + 1) % count === edge || (edge + 1) % count === i) {
      return false;
    }
    const b = outline[(i + 1) % count]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const length = Math.hypot(ex, ey);
    if (length < EPSILON) {
      return false;
    }
    const along = ((point.x - a.x) * ex + (point.y - a.y) * ey) / (length * length);
    const across = Math.abs((point.x - a.x) * ey - (point.y - a.y) * ex) / length;
    return along > EPSILON && along < 1 - EPSILON && across < 1e-6;
  });
}

/**
 * `points` with its first point moved onto `start` and its last onto `end`,
 * each along the segment that reaches it (`outlineCrossing`). An end with no
 * outline (a subgraph's frame, which the route already meets), or whose run
 * meets its outline nowhere, keeps its point. Both ends are read off the
 * route as laid out, so a two-point route's ends do not chase each other;
 * and if moving them would turn that route back on itself, it is left alone.
 */
export function clipRouteToOutlines(
  points: readonly Point[],
  start: readonly Point[] | null,
  end: readonly Point[] | null,
): Point[] {
  const clipped = [...points];
  if (points.length < 2) {
    return clipped;
  }
  const first = points[0]!;
  const last = points.at(-1)!;
  if (start !== null) {
    const from = firstDistinct(points, first, 1);
    clipped[0] = (from && outlineCrossing(from, first, start)) ?? first;
  }
  if (end !== null) {
    const from = firstDistinct(points, last, -1);
    clipped[clipped.length - 1] = (from && outlineCrossing(from, last, end)) ?? last;
  }
  if (points.length === 2) {
    const before = (last.x - first.x) * (last.x - first.x) + (last.y - first.y) * (last.y - first.y);
    const after = (clipped[1]!.x - clipped[0]!.x) * (last.x - first.x) + (clipped[1]!.y - clipped[0]!.y) * (last.y - first.y);
    if (before > 0 && after <= 0) {
      return [...points];
    }
  }
  return clipped;
}

/** The first point of `points`, from its start (`step` 1) or its end (-1), not at `end`. */
function firstDistinct(points: readonly Point[], end: Point, step: 1 | -1): Point | null {
  for (let i = step === 1 ? 1 : points.length - 2; i >= 0 && i < points.length; i += step) {
    const point = points[i]!;
    if (Math.abs(point.x - end.x) > EPSILON || Math.abs(point.y - end.y) > EPSILON) {
      return point;
    }
  }
  return null;
}
