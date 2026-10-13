/**
 * How a connector's routed points become the `d` of the line drawn — the
 * **Curve** in `CONTEXT.md`. One module for all four directed-graph kinds
 * (flowchart, class, state, ER), so a connector looks the same whichever
 * renderer drew it.
 *
 * A curve changes how a route looks, never where it goes: the points come
 * from layout and are only joined here. Each curve is a port of the
 * definition mermaid 11.17.2 draws with, not an approximation of it:
 *
 * - `basis`, `linear`, `step`, `stepBefore`, `stepAfter` — d3-shape 3.2.0's
 *   `curveBasis`, `curveLinear`, `curveStep`, `curveStepBefore` and
 *   `curveStepAfter` (`src/curve/basis.js`, `linear.js`, `step.js`), the
 *   curves mermaid's `insertEdge` hands to `line().curve(...)`. Ported
 *   rather than depended on: each is a few lines, and d3 would be a runtime
 *   dependency for them alone.
 * - `rounded` — mermaid's own `generateRoundedPath(points, 5)`.
 *
 * Over any of them but `basis`, the **line hops** the layout reported are
 * drawn as Mermaid 12.2.0 draws them (`lineJump.ts`): a half circle across
 * each crossing. Where the hops go is layout's (`lineHops`); whether they
 * are drawn, and how, is the curve's, here.
 *
 * Commands are written space-separated (`M0,0 L10,0 C40,0 40,0 50,10`), the
 * same spelling the polyline used before curves existed.
 */

import type { LineHop, Point } from "../contracts";
import type { Curve } from "../curve/curve";
import { cornerCut, ROUNDED_CORNER_RADIUS } from "../layout/directedGraph/lineHops";

/** One coordinate pair as a path command's argument: `x,y`. */
const formatPoint = (x: number, y: number) => `${x},${y}`;

/**
 * d3's `curveBasis`: a uniform cubic B-spline that starts on the first point
 * and ends on the last, pulled toward every point between without passing
 * through it. Its last piece is a straight `L` along the final segment, so an
 * arrowhead at the end still points the way the route's last segment runs.
 */
function basis(points: readonly Point[]): string {
  const commands: string[] = [];
  // d3's `_x0/_x1`: the two points before the one being added.
  let p0: Point = points[0];
  let p1: Point = points[0];
  const cubicTo = (from: Point, via: Point, to: Point) => {
    commands.push(
      `C${formatPoint((2 * from.x + via.x) / 3, (2 * from.y + via.y) / 3)} ` +
        `${formatPoint((from.x + 2 * via.x) / 3, (from.y + 2 * via.y) / 3)} ` +
        `${formatPoint((from.x + 4 * via.x + to.x) / 6, (from.y + 4 * via.y + to.y) / 6)}`,
    );
  };
  points.forEach((point, index) => {
    if (index === 0) {
      commands.push(`M${formatPoint(point.x, point.y)}`);
    } else if (index >= 2) {
      if (index === 2) {
        commands.push(`L${formatPoint((5 * p0.x + p1.x) / 6, (5 * p0.y + p1.y) / 6)}`);
      }
      cubicTo(p0, p1, point);
    }
    p0 = p1;
    p1 = point;
  });
  if (points.length >= 3) {
    cubicTo(p0, p1, p1);
  }
  if (points.length >= 2) {
    commands.push(`L${formatPoint(p1.x, p1.y)}`);
  }
  return commands.join(" ");
}

/** d3's `curveLinear`: the route's points joined by straight segments. */
function linear(points: readonly Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${formatPoint(point.x, point.y)}`)
    .join(" ");
}

/**
 * d3's `Step(context, t)`: every point after the first is reached by a
 * horizontal segment and then a vertical one, turning at
 * `prev.x · (1 − t) + x · t`. `turnAt` is that `t` — 0.5 for `step`, 1 for
 * `stepAfter`, 0 for `stepBefore`, which turns at the previous point and so
 * goes vertical first. Zero-length segments at aligned points are written
 * as d3 writes them.
 */
function step(points: readonly Point[], turnAt: number): string {
  const commands: string[] = [];
  points.forEach((point, index) => {
    if (index === 0) {
      commands.push(`M${formatPoint(point.x, point.y)}`);
      return;
    }
    const previous = points[index - 1];
    if (turnAt <= 0) {
      commands.push(`L${formatPoint(previous.x, point.y)}`, `L${formatPoint(point.x, point.y)}`);
    } else {
      const turn = previous.x * (1 - turnAt) + point.x * turnAt;
      commands.push(`L${formatPoint(turn, previous.y)}`, `L${formatPoint(turn, point.y)}`);
    }
  });
  const last = points[points.length - 1];
  if (0 < turnAt && turnAt < 1 && points.length >= 2) {
    commands.push(`L${formatPoint(last.x, last.y)}`);
  }
  return commands.join(" ");
}

/**
 * The route's points joined by straight segments, with a half circle across
 * each hop, and — given a `cornerRadius` — each corner rounded.
 *
 * A hop is a line to `radius` before the crossing, then
 * `A radius,radius 0 0 sweep` to `radius` past it: Mermaid 12.2.0's
 * `emitJump` (`lineJump.ts`).
 *
 * A rounded corner is mermaid's `generateRoundedPath(points, cornerRadius)`:
 * each interior vertex that turns is cut back by `cornerCut` along both of
 * its segments and the two cut points joined by a quadratic through the
 * vertex. A vertex that does not turn (θ = 0) or doubles back (θ = π), or
 * that sits on a zero-length segment, stays a plain corner. Mermaid's
 * `rewriteEdgePath` draws a rounded route with hops the same way, the hops
 * of each segment before the corner that ends it.
 */
function polyline(points: readonly Point[], hops: readonly LineHop[], cornerRadius?: number): string {
  if (points.length === 0) return "";
  const commands = [`M${formatPoint(points[0].x, points[0].y)}`];
  for (let index = 0; index + 1 < points.length; index++) {
    const a = points[index];
    const b = points[index + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = length === 0 ? 0 : (b.x - a.x) / length;
    const uy = length === 0 ? 0 : (b.y - a.y) / length;
    // Mermaid's `getArcSweepFlag`: clockwise (1) travelling +x, so the half
    // circle bulges up; counter-clockwise (0) travelling −x, up again. A run
    // that is more vertical than horizontal goes by the sign of its dy.
    const travel = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? b.x - a.x : b.y - a.y;
    const sweep = travel >= 0 ? 1 : 0;
    for (const hop of hops.filter((candidate) => candidate.segment === index)) {
      const r = hop.radius;
      commands.push(
        `L${formatPoint(hop.x - ux * r, hop.y - uy * r)}`,
        `A${r},${r} 0 0 ${sweep} ${formatPoint(hop.x + ux * r, hop.y + uy * r)}`,
      );
    }
    const next = points[index + 2];
    const cut = cornerRadius === undefined || next === undefined ? null : cornerCut(a, b, next, cornerRadius);
    if (cut === null) {
      commands.push(`L${formatPoint(b.x, b.y)}`);
      continue;
    }
    const after = Math.hypot(next.x - b.x, next.y - b.y);
    commands.push(
      `L${formatPoint(b.x - ux * cut, b.y - uy * cut)}`,
      `Q${formatPoint(b.x, b.y)} ${formatPoint(b.x + ((next.x - b.x) / after) * cut, b.y + ((next.y - b.y) / after) * cut)}`,
    );
  }
  return commands.join(" ");
}

/**
 * The `d` of a connector drawn through `points` with `curve`, jumping the
 * routes that cross it at `hops` — the **line hops** the layout reported.
 *
 * Which curves draw hops is Mermaid 12.2.0's `curveSupportsLineHops`:
 * `linear`, `rounded` and the three `step` curves. `basis` ignores them: a
 * soft curve has no straight run at the crossing to jump from. A `step`
 * curve with hops is drawn as Mermaid's `rewriteEdgePath` redraws one —
 * straight through the route's points — which on the orthogonal routes the
 * layout gives is the line the step curve draws; without hops it is d3's
 * own commands, unchanged.
 */
export function connectorPathData(points: readonly Point[], curve: Curve, hops: readonly LineHop[] = []): string {
  if (hops.length > 0 && (curve === "linear" || curve === "step" || curve === "stepBefore" || curve === "stepAfter")) {
    return polyline(points, hops);
  }
  switch (curve) {
    case "basis":
      return basis(points);
    case "linear":
      return linear(points);
    case "step":
      return step(points, 0.5);
    case "stepBefore":
      return step(points, 0);
    case "stepAfter":
      return step(points, 1);
    case "rounded":
      return polyline(points, hops, ROUNDED_CORNER_RADIUS);
  }
}

/**
 * Draws a connector's route onto its `<path>`: the curve's `d`, with its
 * line hops where the curve draws them, and the routed points themselves as
 * `data-siren-points` (`"x,y x,y …"`, an SVG `points` attribute's spelling)
 * — never a hop's points, which are drawing, not route.
 *
 * Every directed-graph renderer draws through here, so a kind that moves
 * onto the ELK core gets its hops by handing over the `hops` its layout
 * reported.
 *
 * The second attribute exists because a curve's `d` no longer lists the
 * route — `basis` writes control points the line never passes through — and
 * where a route goes is still a fact worth reading off the picture: the
 * compat corpus and `layoutDefects` ask whether a label sits on its route,
 * whether a loop is drawn outside a frame, whether a route crosses a box.
 * Those read the route here; a reader that wants only the two ends may keep
 * reading `d`, whose first and last points are the route's under every curve.
 */
export function drawConnectorRoute(
  path: Element,
  points: readonly Point[],
  curve: Curve,
  hops: readonly LineHop[] = [],
): void {
  path.setAttribute("d", connectorPathData(points, curve, hops));
  path.setAttribute("data-siren-points", points.map((point) => formatPoint(point.x, point.y)).join(" "));
}
