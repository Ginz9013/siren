/**
 * **Line hops**: where two routes cross, one of them jumps the other with a
 * small half circle, so a crossing reads differently from two lines meeting
 * at a bend. This module decides where the hops go; the renderer
 * (`renderer/connectorCurve.ts`) draws them.
 *
 * The rule is Mermaid 12.2.0's, which draws hops by default under its ELK
 * layout (`lineJump.ts`, `JUMP_RADIUS = 6`), restated in nook decision
 * `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 7:
 *
 * - A crossing is two segments meeting strictly inside both: a route that
 *   ends on another, or two that share an end, do not cross.
 * - Of a horizontal and a vertical segment, the horizontal one carries the
 *   hop; otherwise the later route in edge order does.
 * - No hop where either route is curving through a rounded corner at the
 *   crossing; the radius, 6, shrinks to 2 short of the nearer corner's
 *   rounding (or the route's end), and a hop left under 3.6 is not drawn.
 * - Two hops on one segment that would overlap each shrink to half the gap
 *   between them.
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
 * The corner radius the `rounded` curve draws with: Mermaid's
 * `generateRoundedPath(points, 5)`. Here rather than beside the curve
 * because the hop rule needs the same number — the layout adapter hands it
 * to the core for every edge drawn `rounded` — and the renderer reads it
 * from here, so the corner kept clear and the corner drawn stay one.
 */
export const ROUNDED_CORNER_RADIUS = 5;

/** Below this, a length or an angle is taken as none: Mermaid's `CORNER_EPSILON`. */
const CORNER_EPSILON = 1e-5;

/**
 * How far back along both of its segments a corner at `at` is cut when it is
 * drawn rounded with `radius`: `min(radius / sin(θ/2), before / 2, after / 2)`
 * for a turn of θ — 7.071 for a right angle at Mermaid's radius 5. `null`
 * where nothing is cut: a segment of no length, or a vertex that does not
 * turn (θ = 0) or turns straight back (θ = π).
 *
 * Mermaid 12.2.0's `generateRoundedPath` (what the `rounded` curve draws) and
 * `lineJump.ts`'s `computeRoundedCorner` (what its hops keep clear of) both
 * cut by this; here it is the one definition for both, so the hop rule and
 * the drawn corner cannot drift apart.
 */
export function cornerCut(previous: Point, at: Point, next: Point, radius: number): number | null {
  const before = Math.hypot(at.x - previous.x, at.y - previous.y);
  const after = Math.hypot(next.x - at.x, next.y - at.y);
  if (before < CORNER_EPSILON || after < CORNER_EPSILON) return null;
  const dot =
    ((at.x - previous.x) / before) * ((next.x - at.x) / after) + ((at.y - previous.y) / before) * ((next.y - at.y) / after);
  const turn = Math.acos(Math.max(-1, Math.min(1, dot)));
  if (turn < CORNER_EPSILON || Math.abs(Math.PI - turn) < CORNER_EPSILON) return null;
  return Math.min(radius / Math.sin(turn / 2), before / 2, after / 2);
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

/** Mermaid 12.2.0's `JUMP_RADIUS`. */
const HOP_RADIUS = 6;
/** How close a hop may come to a corner's rounding or a route's end: Mermaid's `CORNER_JUMP_CLEARANCE`. */
const CORNER_CLEARANCE = 2;
/** The smallest hop drawn, 6 × Mermaid's `MIN_USEFUL_RADIUS_RATIO` (0.6): one smaller reads as a kink, not a jump. */
const MIN_HOP_RADIUS = HOP_RADIUS * 0.6;
/** Mermaid's `ENDPOINT_EPSILON`: how near a segment's end a crossing counts as on it. */
const END_EPSILON = 1e-6;

/** Where two segments cross: the point, and how far along each it lies (0 at its start, 1 at its end). */
function crossing(a1: Point, a2: Point, b1: Point, b2: Point): { point: Point; tA: number; tB: number } | null {
  const dxA = a2.x - a1.x;
  const dyA = a2.y - a1.y;
  const dxB = b2.x - b1.x;
  const dyB = b2.y - b1.y;
  const denominator = dxA * dyB - dyA * dxB;
  if (denominator === 0) return null;
  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;
  const tA = (dx * dyB - dy * dxB) / denominator;
  const tB = (dx * dyA - dy * dxA) / denominator;
  // A crossing at either segment's own end is a meeting, not a crossing:
  // a route that ends on another (a T), two that share an end, or a route's
  // own bend lying on the other line.
  if (tA <= END_EPSILON || tA >= 1 - END_EPSILON || tB <= END_EPSILON || tB >= 1 - END_EPSILON) return null;
  return { point: { x: a1.x + tA * dxA, y: a1.y + tA * dyA }, tA, tB };
}

const isHorizontal = (a: Point, b: Point) => Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);

/** Where each route jumps the others, in the routes' order. */
export function lineHops(routes: readonly HopRoute[]): LineHop[][] {
  // Every crossing, on the route that carries it: which segment, and how
  // far along it (0–1).
  const crossings: { segment: number; t: number; point: Point }[][] = routes.map(() => []);
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
 * `rewriteEdgePath`, less the drawing.
 */
function sizedHops(route: HopRoute, crossings: readonly { segment: number; t: number; point: Point }[]): LineHop[] {
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
