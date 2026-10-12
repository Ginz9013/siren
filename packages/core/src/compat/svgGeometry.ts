/**
 * Geometry for the compat tests, in one copy: what is read off a rendered
 * `<svg>` (a frame's box, a connector's route) and the plain geometry asked
 * of what was read (containment, overlap, a point's distance from a line).
 * Shared by `corpus.ts`'s asserts, `layoutDefects.ts`'s defect counts, and
 * the layout and render tests that ask how far a point lies from a route —
 * some of which never had an `<svg>`, only the layout's own points.
 *
 * One copy of each, so two readers never disagree about where a box is,
 * which points a line passes through, or when a point counts as in. For
 * tests only: nothing in the renderer reads its own picture back.
 */

import type { Point } from "../contracts";

export type { Point };

/** An axis-aligned box as its four sides. */
export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
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

/** Where one kind of group frame is drawn: its group, the frame in it, the title in it. */
export interface FrameSelectors {
  group: string;
  frame: string;
  title: string;
}

/** A flowchart `subgraph`, as `renderToSVG` draws one. */
export const FLOWCHART_SUBGRAPH: FrameSelectors = {
  group: "g.siren-subgraph",
  frame: "rect.siren-subgraph-frame",
  title: "text.siren-subgraph-label",
};

/** An ER diagram's subgraph block, as `renderErDiagramToSVG` draws one. */
export const ER_SUBGRAPH: FrameSelectors = {
  group: "g.siren-er-subgraph",
  frame: "rect.siren-er-subgraph-frame",
  title: "text.siren-er-subgraph-label",
};

/**
 * Every group of one kind drawn — a flowchart subgraph unless `kind` says
 * otherwise — in draw order, with the title drawn on it and its frame's box,
 * or `null` for a group drawn with no frame `<rect>`. Kept rather than
 * skipped, so a reader asking after one title can tell "drawn without a
 * frame" from "not drawn".
 */
export function subgraphFrames(
  svg: Element,
  kind: FrameSelectors = FLOWCHART_SUBGRAPH,
): { title: string; box: Box | null }[] {
  return Array.from(svg.querySelectorAll(kind.group)).map((group) => {
    const rect = group.querySelector(kind.frame);
    return {
      title: group.querySelector(kind.title)?.textContent ?? "",
      box: rect === null ? null : rectBox(rect),
    };
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

/**
 * Whether `point` lies in `box`, its outline included, to within `tolerance`
 * on every side. Explicit, because the callers differ on purpose: an exact
 * reading (`0`) where a pixel of slack is already added to the box, a
 * rounding allowance (`1e-6`) where a point computed onto an outline is
 * asked about.
 */
export function holds(box: Box, point: Point, tolerance: number): boolean {
  return (
    point.x >= box.left - tolerance &&
    point.x <= box.right + tolerance &&
    point.y >= box.top - tolerance &&
    point.y <= box.bottom + tolerance
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
