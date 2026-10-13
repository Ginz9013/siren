/**
 * **Line hops**: where two routes cross, one of them jumps the other with a
 * small half circle, so a crossing reads differently from two lines meeting
 * at a bend. This module decides where the hops go; the renderer
 * (`renderer/connectorCurve.ts`) draws them.
 *
 * The rule is Mermaid 12.2.0's, which draws hops by default under its ELK
 * layout (its `lineJump.ts`, bundled in `chunk-UETRLHRR.mjs`; `JUMP_RADIUS =
 * 6` in `elk-V4PLJRSU.mjs`, line 98772, run as the ELK layout's `afterPaint`,
 * line 99547), restated in nook decision `01M4VANRC6B2C14NHVC2KRZ9Y8`,
 * rule 7:
 *
 * - A crossing is two segments meeting strictly inside both: a route that
 *   ends on another, or two that share an end, do not cross
 *   (`segmentIntersection`, `chunk-UETRLHRR.mjs`, line 22 — Siren measures
 *   "strictly inside" in pixels; see `END_TOLERANCE`).
 * - Of a horizontal and a vertical segment, the horizontal one carries the
 *   hop; otherwise the later route in edge order does
 *   (`findEdgeIntersections`, line 69).
 * - No hop where either route is curving through a rounded corner at the
 *   crossing (`crossingSitsInRoundedCorner`, line 49); the radius, 6,
 *   shrinks to 2 short of the nearer corner's rounding (or the route's end),
 *   and a hop left under 3.6 is not drawn.
 * - Two hops on one segment that would overlap each shrink to half the gap
 *   between them (`rewriteEdgePath`, line 203).
 *
 * "The route's end" differs from Mermaid's by the arrowhead. Mermaid's
 * `rewriteEdgePath` first pulls a route's marked ends back by the marker's
 * offset `o` (`applyMarkerOffsets`, `chunk-UETRLHRR.mjs`, line 132; `o` is
 * 4 for the flowchart's `arrow_point` and 0 without a marker, per
 * `markerOffsets`, `chunk-RLXJHMIZ.mjs`, line 59) and sizes each hop along
 * those shortened segments: a crossing found at `t` on the route as routed
 * sits at `t × (L − o)` on a first or last segment of length `L`, so its room
 * shrinks by `(1 − t) × o` toward the marked end and by `t × o` toward the
 * other. Siren sizes every hop against the route as routed, so on a segment
 * that ends at an arrowhead a hop can be up to `o` larger than Mermaid's, or
 * drawn where Mermaid drops it. On every other segment the two agree.
 *
 * It lives in the layout core, not the renderer, because which route of a
 * crossing carries the hop and how large it may be depend on both routes —
 * the crossed route's corners included — and only the core holds every
 * route at once. What it needs from the drawing is one number per route:
 * how much its corners are cut (`cornerRadius`, `cornerCut`). Whether a
 * curve draws hops at all stays the renderer's: a `basis` line draws none,
 * and the hop a crossing assigned to it is simply not drawn — Mermaid's
 * behaviour too.
 */
import type { LineHop, Point } from "../../contracts";
import { cornerCut } from "../../curve/roundedCorner";

/** A route as the hop rule reads it. */
export interface HopRoute {
  points: readonly Point[];
  /**
   * The radius the drawing rounds the route's corners with — see
   * `cornerCut` — or absent when it draws them sharp. No hop is placed
   * inside a corner's rounding, on this route or on one it crosses.
   */
  cornerRadius?: number;
}

/**
 * How much of segment `index` (`points[index]` to `points[index + 1]`) the
 * rounding of its two corners takes, from its start and from its end: 0 at a
 * route's own ends, at a corner that cuts nothing, and on a route drawn with
 * sharp corners.
 */
function roundedEnds(route: HopRoute, index: number): { start: number; end: number } {
  const { points, cornerRadius } = route;
  if (cornerRadius === undefined) return { start: 0, end: 0 };
  const start = index > 0 ? cornerCut(points[index - 1], points[index], points[index + 1], cornerRadius) : null;
  const end =
    index + 2 < points.length ? cornerCut(points[index], points[index + 1], points[index + 2], cornerRadius) : null;
  return { start: start ?? 0, end: end ?? 0 };
}

/** Whether `t` along segment `index` of `route` falls inside the rounding of either of its corners. */
function inRoundedCorner(route: HopRoute, index: number, t: number): boolean {
  const a = route.points[index];
  const b = route.points[index + 1];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const { start, end } = roundedEnds(route, index);
  return t * length < start || length - t * length < end;
}

/** Mermaid 12.2.0's `JUMP_RADIUS` (`elk-V4PLJRSU.mjs`, line 98772). */
const HOP_RADIUS = 6;
/**
 * How close a hop may come to a corner's rounding or a route's end: Mermaid's
 * `CORNER_JUMP_CLEARANCE` (`chunk-UETRLHRR.mjs`, line 11).
 */
const CORNER_CLEARANCE = 2;
/**
 * The smallest hop drawn, 6 × Mermaid's `MIN_USEFUL_RADIUS_RATIO` (0.6,
 * `chunk-UETRLHRR.mjs`, line 12): one smaller reads as a kink, not a jump.
 */
const MIN_HOP_RADIUS = HOP_RADIUS * 0.6;
/**
 * How near a segment's end, in pixels, a crossing counts as on that end: a
 * meeting, not a crossing. Mermaid's `ENDPOINT_EPSILON` (1e-6,
 * `chunk-UETRLHRR.mjs`, line 13) is the same test as a fraction of the
 * segment — 0.0002px on a 200px segment — so a route that ends on another's
 * line but has drifted a hundredth of a pixel past it in floating point
 * would hop. Half a pixel is far above any such drift and under what a
 * stroke shows: a line that runs that little past another reads as meeting
 * it. Nothing real is lost on the carrying route either, where a hop that
 * near its own end could never be drawn (2 clear of the end, 3.6 at least).
 */
const END_TOLERANCE = 0.5;

/** How far `point` lies from the line through `from` and `to`, which are apart. */
function distanceFromLine(from: Point, to: Point, point: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.abs(dx * (point.y - from.y) - dy * (point.x - from.x)) / Math.hypot(dx, dy);
}

/** Whether both ends of segment `c1`–`c2` lie within `END_TOLERANCE` of the line through `l1` and `l2`. */
const alongLine = (l1: Point, l2: Point, c1: Point, c2: Point) =>
  distanceFromLine(l1, l2, c1) <= END_TOLERANCE && distanceFromLine(l1, l2, c2) <= END_TOLERANCE;

/** Where two segments cross: the point, and how far along each it lies (0 at its start, 1 at its end). */
function crossing(a1: Point, a2: Point, b1: Point, b2: Point): { point: Point; tA: number; tB: number } | null {
  const dxA = a2.x - a1.x;
  const dyA = a2.y - a1.y;
  const dxB = b2.x - b1.x;
  const dyB = b2.y - b1.y;
  const denominator = dxA * dyB - dyA * dxB;
  if (denominator === 0) return null;
  // Two segments one of which lies along the other's line to within the
  // same half pixel run together, not across: float drift tilting one of
  // them would otherwise put a hop where the two lines overlap.
  if (alongLine(a1, a2, b1, b2) || alongLine(b1, b2, a1, a2)) return null;
  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;
  const tA = (dx * dyB - dy * dxB) / denominator;
  const tB = (dx * dyA - dy * dxA) / denominator;
  // A crossing at either segment's own end is a meeting, not a crossing:
  // a route that ends on another (a T), two that share an end, or a route's
  // own bend lying on the other line.
  const nearEnd = (t: number, length: number) => t * length <= END_TOLERANCE || (1 - t) * length <= END_TOLERANCE;
  if (nearEnd(tA, Math.hypot(dxA, dyA)) || nearEnd(tB, Math.hypot(dxB, dyB))) return null;
  return { point: { x: a1.x + tA * dxA, y: a1.y + tA * dyA }, tA, tB };
}

/** A crossing, on the route that carries its hop: which segment, how far along it (0–1), and where. */
interface Crossing {
  segment: number;
  t: number;
  point: Point;
}

const isHorizontal = (a: Point, b: Point) => Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);

/** Where each route jumps the others, in the routes' order. */
export function lineHops(routes: readonly HopRoute[]): LineHop[][] {
  // Every crossing, on the route that carries it: which segment, and how
  // far along it (0–1).
  const crossings: Crossing[][] = routes.map(() => []);
  for (let i = 0; i < routes.length; i++) {
    const a = routes[i].points;
    for (let j = i + 1; j < routes.length; j++) {
      const b = routes[j].points;
      for (let si = 0; si < a.length - 1; si++) {
        for (let sj = 0; sj < b.length - 1; sj++) {
          const hit = crossing(a[si], a[si + 1], b[sj], b[sj + 1]);
          if (hit === null) continue;
          // Where either line is already curving through a corner, there is
          // no straight run for a hop to sit on, nor one to jump.
          if (inRoundedCorner(routes[i], si, hit.tA) || inRoundedCorner(routes[j], sj, hit.tB)) continue;
          const aHorizontal = isHorizontal(a[si], a[si + 1]);
          const onA = aHorizontal !== isHorizontal(b[sj], b[sj + 1]) && aHorizontal;
          if (onA) crossings[i].push({ segment: si, t: hit.tA, point: hit.point });
          else crossings[j].push({ segment: sj, t: hit.tB, point: hit.point });
        }
      }
    }
  }
  return routes.map((route, index) => sizedHops(route, crossings[index]));
}

/**
 * A route's crossings as hops, segment by segment in the order they are met,
 * each as large as the room around it allows — Mermaid 12.2.0's
 * `rewriteEdgePath` (`chunk-UETRLHRR.mjs`, line 203), less the drawing and
 * the arrowhead offset (see the module doc).
 */
function sizedHops(route: HopRoute, crossings: readonly Crossing[]): LineHop[] {
  const hops: LineHop[] = [];
  for (let index = 0; index < route.points.length - 1; index++) {
    const a = route.points[index];
    const b = route.points[index + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const { start, end } = roundedEnds(route, index);
    const onSegment = crossings
      .filter((crossing) => crossing.segment === index)
      .sort((p, q) => p.t - q.t)
      .map((crossing) => {
        const along = crossing.t * length;
        // The straight run between the corners' rounding (or the route's
        // ends), less the clearance, on the nearer side.
        const room = Math.min(along - start, length - end - along) - CORNER_CLEARANCE;
        return { along, hop: { ...crossing.point, radius: Math.min(HOP_RADIUS, room), segment: index } };
      })
      .filter(({ hop }) => hop.radius >= MIN_HOP_RADIUS);
    // Two neighbours that would overlap each shrink to half the gap between
    // them, pair by pair along the segment.
    for (let k = 0; k + 1 < onSegment.length; k++) {
      const [here, next] = [onSegment[k], onSegment[k + 1]];
      const gap = next.along - here.along;
      if (here.hop.radius + next.hop.radius > gap) {
        here.hop.radius = Math.min(here.hop.radius, gap / 2);
        next.hop.radius = Math.min(next.hop.radius, gap / 2);
      }
    }
    hops.push(...onSegment.map(({ hop }) => hop).filter((hop) => hop.radius >= MIN_HOP_RADIUS));
  }
  return hops;
}
