/**
 * Geometry read off a rendered `<svg>`, shared by the compat tests' readers —
 * `corpus.ts`'s asserts, `layoutDefects.ts`'s defect counts, and the layout
 * and render tests that ask how far a point lies from a drawn line.
 *
 * One copy of each reading, so two readers never disagree about where a box
 * is or which points a line passes through. For tests only: nothing in the
 * renderer reads its own picture back.
 */

/** An axis-aligned box as its four sides. */
export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** A point drawn in the picture. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The four sides of a `<rect>`, read off its `x`, `y`, `width` and `height`.
 * What every frame drawn as a rectangle — a node, a subgraph, a state, an ER
 * entity — is read with.
 */
export function rectBox(rect: Element): Box {
  const number = (name: string) => Number(rect.getAttribute(name));
  return {
    top: number("y"),
    bottom: number("y") + number("height"),
    left: number("x"),
    right: number("x") + number("width"),
  };
}

/**
 * Every flowchart subgraph frame drawn, in draw order, with the title drawn
 * on it: each `g.siren-subgraph`'s `rect.siren-subgraph-frame`, keyed by its
 * `text.siren-subgraph-label`.
 */
export function subgraphFrames(svg: Element): { title: string; box: Box }[] {
  return Array.from(svg.querySelectorAll("g.siren-subgraph")).flatMap((group) => {
    const rect = group.querySelector("rect.siren-subgraph-frame");
    if (rect === null) return [];
    return [
      {
        title: group.querySelector("text.siren-subgraph-label")?.textContent ?? "",
        box: rectBox(rect),
      },
    ];
  });
}

/** Whether `outer` wholly contains `inner` — how "it groups them" is read off a picture. */
export function encloses(outer: Box, inner: Box): boolean {
  return (
    outer.left <= inner.left &&
    outer.top <= inner.top &&
    outer.right >= inner.right &&
    outer.bottom >= inner.bottom
  );
}

/** Whether two boxes share interior — touching along an edge is not sharing. */
export function interiorsMeet(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * The route a connector `<path>` was drawn through: the points in the
 * `data-siren-points` its renderer writes beside `d`.
 *
 * Not off `d`: a connector is drawn as a curve (`basis` by default, as in
 * Mermaid), and a curve's `d` lists control points the line never passes
 * through. A path without the attribute throws rather than reading as an
 * empty route, so a renderer that stopped writing it fails every reader that
 * asks.
 */
export function routeOf(path: Element): Point[] {
  const route = path.getAttribute("data-siren-points");
  if (route === null) {
    throw new Error(`the connector "${path.getAttribute("class")}" carries no data-siren-points`);
  }
  return route
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(","))
    .map(([x, y]) => ({ x: Number(x), y: Number(y) }));
}

/**
 * The shortest distance from `point` to the polyline through `points`, over
 * every one of its segments — `Infinity` for fewer than two points, which
 * draw no segment to be near.
 */
export function distanceToPolyline(point: Point, points: readonly Point[]): number {
  return Math.min(
    ...points.slice(1).map((end, i) => {
      const start = points[i];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = dx * dx + dy * dy;
      // How far along `start`→`end` the nearest point lies, clamped to the segment.
      const t =
        length === 0
          ? 0
          : Math.max(
              0,
              Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length),
            );
      return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
    }),
  );
}
