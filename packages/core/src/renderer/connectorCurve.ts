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
 * Commands are written space-separated (`M0,0 L10,0 C40,0 40,0 50,10`), the
 * same spelling the polyline used before curves existed.
 */

/** A point on a connector's route, as layout returns it. */
export interface RoutePoint {
  x: number;
  y: number;
}

/** How a connector's routed points are joined into the drawn line. */
export type Curve = "basis" | "linear" | "step" | "stepBefore" | "stepAfter" | "rounded";

/**
 * The curve every connector is drawn with unless told otherwise — Mermaid's
 * default, `basis`, for all four directed-graph kinds.
 */
export const DEFAULT_CURVE: Curve = "basis";

/** The corner radius `rounded` draws with — mermaid's, passed as `5`. */
const ROUNDED_ARCHIV = 5;

const pair = (x: number, y: number) => `${x},${y}`;

/**
 * d3's `curveBasis`: a uniform cubic B-spline that starts on the first point
 * and ends on the last, pulled toward every point between without passing
 * through it. Its last piece is a straight `L` along the final segment, so an
 * arrowhead at the end still points the way the route's last segment runs.
 */
function basis(points: readonly RoutePoint[]): string {
  const commands: string[] = [];
  // d3's `_x0/_x1`: the two points before the one being added.
  let p0: RoutePoint = points[0];
  let p1: RoutePoint = points[0];
  const cubicTo = (from: RoutePoint, via: RoutePoint, to: RoutePoint) => {
    commands.push(
      `C${pair((2 * from.x + via.x) / 3, (2 * from.y + via.y) / 3)} ` +
        `${pair((from.x + 2 * via.x) / 3, (from.y + 2 * via.y) / 3)} ` +
        `${pair((from.x + 4 * via.x + to.x) / 6, (from.y + 4 * via.y + to.y) / 6)}`,
    );
  };
  points.forEach((point, index) => {
    if (index === 0) {
      commands.push(`M${pair(point.x, point.y)}`);
    } else if (index >= 2) {
      if (index === 2) {
        commands.push(`L${pair((5 * p0.x + p1.x) / 6, (5 * p0.y + p1.y) / 6)}`);
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
    commands.push(`L${pair(p1.x, p1.y)}`);
  }
  return commands.join(" ");
}

/** d3's `curveLinear`: the route's points joined by straight segments. */
function linear(points: readonly RoutePoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${pair(point.x, point.y)}`)
    .join(" ");
}

/**
 * d3's `Step` with its `t`: every point after the first is reached by a
 * horizontal segment and then a vertical one, turning at
 * `prev.x · (1 − t) + x · t` — `stepBefore` (t = 0) turns at the previous
 * point, so it goes vertical first. Zero-length segments at aligned points
 * are written as d3 writes them.
 */
function step(points: readonly RoutePoint[], t: number): string {
  const commands: string[] = [];
  points.forEach((point, index) => {
    if (index === 0) {
      commands.push(`M${pair(point.x, point.y)}`);
      return;
    }
    const previous = points[index - 1];
    if (t <= 0) {
      commands.push(`L${pair(previous.x, point.y)}`, `L${pair(point.x, point.y)}`);
    } else {
      const turn = previous.x * (1 - t) + point.x * t;
      commands.push(`L${pair(turn, previous.y)}`, `L${pair(turn, point.y)}`);
    }
  });
  const last = points[points.length - 1];
  if (0 < t && t < 1 && points.length >= 2) {
    commands.push(`L${pair(last.x, last.y)}`);
  }
  return commands.join(" ");
}

/**
 * mermaid's `generateRoundedPath(points, 5)`: the polyline, with each
 * interior vertex that turns cut back by
 * `min(5 / sin(θ/2), before / 2, after / 2)` along both of its segments and
 * the two cut points joined by a quadratic through the vertex. A vertex that
 * does not turn (θ = 0) or doubles back (θ = π), or that sits on a
 * zero-length segment, stays a plain corner.
 */
function rounded(points: readonly RoutePoint[]): string {
  const epsilon = 1e-5;
  const commands = points.map((point, index) => {
    if (index === 0) return `M${pair(point.x, point.y)}`;
    if (index === points.length - 1) return `L${pair(point.x, point.y)}`;
    const previous = points[index - 1];
    const next = points[index + 1];
    const before = Math.hypot(point.x - previous.x, point.y - previous.y);
    const after = Math.hypot(next.x - point.x, next.y - point.y);
    if (before < epsilon || after < epsilon) return `L${pair(point.x, point.y)}`;
    const inX = (point.x - previous.x) / before;
    const inY = (point.y - previous.y) / before;
    const outX = (next.x - point.x) / after;
    const outY = (next.y - point.y) / after;
    const turn = Math.acos(Math.max(-1, Math.min(1, inX * outX + inY * outY)));
    if (turn < epsilon || Math.abs(Math.PI - turn) < epsilon) {
      return `L${pair(point.x, point.y)}`;
    }
    const cut = Math.min(ROUNDED_ARCHIV / Math.sin(turn / 2), before / 2, after / 2);
    return (
      `L${pair(point.x - inX * cut, point.y - inY * cut)} ` +
      `Q${pair(point.x, point.y)} ${pair(point.x + outX * cut, point.y + outY * cut)}`
    );
  });
  return commands.join(" ");
}

/** The `d` of a connector drawn through `points` with `curve`. */
export function connectorPathData(points: readonly RoutePoint[], curve: Curve): string {
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
      return rounded(points);
  }
}

/**
 * Draws a connector's route onto its `<path>`: the curve's `d`, and the
 * routed points themselves as `data-siren-points` (`"x,y x,y …"`, an SVG
 * `points` attribute's spelling).
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
  points: readonly RoutePoint[],
  curve: Curve,
): void {
  path.setAttribute("d", connectorPathData(points, curve));
  path.setAttribute("data-siren-points", points.map((point) => pair(point.x, point.y)).join(" "));
}
