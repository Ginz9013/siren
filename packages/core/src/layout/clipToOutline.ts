import type { LineHop, Point } from "../contracts";
import { type HopRoute, lineHops } from "./lineHops";

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
 * keeps its points, its bends and its labels. Its line hops do not keep: a
 * longer run can cross a line it stopped short of on the box, so they are
 * read again off the clipped routes (`clipRoutesAndHop`).
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
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < EPSILON) {
      continue;
    }
    // `from + t (to - from) = a + u (b - a)`.
    const t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / denominator;
    const u = ((a.x - from.x) * dy - (a.y - from.y) * dx) / denominator;
    if (u < -EPSILON || u > 1 + EPSILON || t <= EPSILON) {
      continue;
    }
    if (nearest !== null && t >= nearest) {
      continue;
    }
    const crossing = { x: from.x + t * dx, y: from.y + t * dy };
    if (u > EPSILON && u < 1 - EPSILON && crossesItselfAt(outline, i, crossing)) {
      continue;
    }
    nearest = t;
  }
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
 * meets its outline nowhere, keeps its point; so does an end whose run
 * starts inside the outline's box, where the first side ahead may be the
 * one the line leaves the shape by rather than the one it arrives at. Both ends are read off the
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
    clipped[0] = (from && !insideBoxOf(from, start) && outlineCrossing(from, first, start)) || first;
  }
  if (end !== null) {
    const from = firstDistinct(points, last, -1);
    clipped[clipped.length - 1] = (from && !insideBoxOf(from, end) && outlineCrossing(from, last, end)) || last;
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

/** Whether `point` lies strictly inside the box `outline` is inscribed in. */
function insideBoxOf(point: Point, outline: readonly Point[]): boolean {
  const xs = outline.map((corner) => corner.x);
  const ys = outline.map((corner) => corner.y);
  return (
    point.x > Math.min(...xs) + EPSILON &&
    point.x < Math.max(...xs) - EPSILON &&
    point.y > Math.min(...ys) + EPSILON &&
    point.y < Math.max(...ys) - EPSILON
  );
}

/** A route as `clipRoutesAndHop` reads it: its points, how it is drawn, and the outline at each end, if any. */
export interface OutlinedRoute extends HopRoute {
  start: readonly Point[] | null;
  end: readonly Point[] | null;
}

/**
 * Every route of one drawing with its ends on their outlines
 * (`clipRouteToOutlines`) and its line hops read off the clipped routes all
 * together (`lineHops`), in the routes' order. Every route is passed, an
 * unclipped one too: which of two crossing routes carries a hop, and how
 * large it is, depend on both.
 */
export function clipRoutesAndHop(routes: readonly OutlinedRoute[]): { points: Point[]; hops: LineHop[] }[] {
  const clipped = routes.map((route) => ({
    points: clipRouteToOutlines(route.points, route.start, route.end),
    cornerRadius: route.cornerRadius,
  }));
  const hops = lineHops(clipped);
  return clipped.map((route, index) => ({ points: route.points, hops: hops[index]! }));
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
