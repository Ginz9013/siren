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

/**
 * The outline a frame element is drawn with, as polylines — one per
 * subpath, closed (its first point written again at the end) where the
 * element closes it. Read off the element's own geometry attributes, so a
 * check asking "is this point on the drawn figure?" reads the picture
 * rather than the layout's outline.
 *
 * A `<rect>` (its corners rounded by an `rx`/`ry` given as an attribute or
 * as a style declaration, as a stadium's are), a `<circle>`, a `<polygon>`,
 * a `<line>`, and a `<path>` spelled with `M`, `L`, `H`, `V`, `A` and `Z`,
 * absolute or relative. A curve is sampled finely enough to stay within a
 * few hundredths of a pixel of itself. Anything else throws, so a frame
 * drawn some new way fails the check that reads it instead of reading as no
 * outline.
 */
export function frameOutline(frame: Element): Point[][] {
  const number = (name: string) => Number(frame.getAttribute(name));
  switch (frame.tagName.toLowerCase()) {
    case "rect": {
      const { top, bottom, left, right } = rectBox(frame);
      const rx = Math.min(cornerRadius(frame, "rx") ?? cornerRadius(frame, "ry") ?? 0, (right - left) / 2);
      const ry = Math.min(cornerRadius(frame, "ry") ?? cornerRadius(frame, "rx") ?? 0, (bottom - top) / 2);
      if (rx <= 0 || ry <= 0) {
        return [[pt(left, top), pt(right, top), pt(right, bottom), pt(left, bottom), pt(left, top)]];
      }
      const corner = (x: number, y: number) => `A${rx},${ry} 0 0 1 ${x},${y}`;
      return pathOutline(
        `M${left + rx},${top} H${right - rx} ${corner(right, top + ry)} V${bottom - ry} ` +
          `${corner(right - rx, bottom)} H${left + rx} ${corner(left, bottom - ry)} ` +
          `V${top + ry} ${corner(left + rx, top)} Z`,
      );
    }
    case "circle": {
      const [cx, cy, r] = [number("cx"), number("cy"), number("r")];
      return pathOutline(`M${cx - r},${cy} A${r},${r} 0 1 1 ${cx + r},${cy} A${r},${r} 0 1 1 ${cx - r},${cy} Z`);
    }
    case "polygon": {
      const points = (frame.getAttribute("points") ?? "")
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number))
        .map(([x, y]) => pt(x, y));
      return [[...points, points[0]]];
    }
    case "line":
      return [[pt(number("x1"), number("y1")), pt(number("x2"), number("y2"))]];
    case "path":
      return pathOutline(frame.getAttribute("d") ?? "");
    default:
      throw new Error(`frameOutline cannot read a <${frame.tagName}> frame`);
  }
}

function pt(x: number, y: number): Point {
  return { x, y };
}

/**
 * A rect's `rx` or `ry`, from its inline style (where a shape writes it, so
 * an author's declaration can override it) or else its attribute, or `null`
 * when it has neither.
 */
function cornerRadius(rect: Element, name: "rx" | "ry"): number | null {
  const declared = (rect.getAttribute("style") ?? "").match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([\\d.]+)`));
  const value = declared?.[1] ?? rect.getAttribute(name);
  return value === null ? null : Number(value);
}

/** How long, at most, one sampled step along an arc is: its chord then strays under 0.04px. */
const ARC_STEP = 0.5;

/**
 * The points along the elliptical arc from `from` to `to`, `from` itself
 * left out — the SVG arc's endpoint parameters turned into its centre and
 * sweep (SVG 1.1, F.6.5), its radii grown first if they cannot span the two
 * ends (F.6.6).
 */
function arcPoints(
  from: Point,
  [radiusX, radiusY, rotation, largeArc, sweep]: number[],
  to: Point,
): Point[] {
  let rx = Math.abs(radiusX);
  let ry = Math.abs(radiusY);
  if (rx === 0 || ry === 0) return [to];
  const phi = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const hx = (from.x - to.x) / 2;
  const hy = (from.y - to.y) / 2;
  const x1 = cos * hx + sin * hy;
  const y1 = -sin * hx + cos * hy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const factor = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cx1 = (factor * rx * y1) / ry;
  const cy1 = (-factor * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2;
  const start = Math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx);
  let delta = Math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx) - start;
  if (sweep !== 0 && delta < 0) delta += 2 * Math.PI;
  if (sweep === 0 && delta > 0) delta -= 2 * Math.PI;
  const steps = Math.max(8, Math.ceil((Math.abs(delta) * Math.max(rx, ry)) / ARC_STEP));
  const points: Point[] = [];
  for (let i = 1; i < steps; i++) {
    const t = start + (delta * i) / steps;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    points.push(pt(cx + cos * ex - sin * ey, cy + sin * ex + cos * ey));
  }
  // The end exactly as written, not as the trigonometry rounds it.
  points.push(to);
  return points;
}

/** The subpaths of a path's `d`, as `frameOutline` reads them. */
function pathOutline(d: string): Point[][] {
  const subpaths: Point[][] = [];
  let current: Point[] = [];
  let at = pt(0, 0);
  for (const [, command, rest] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const args = (rest.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case "M":
      case "L":
        for (let i = 0; i + 1 < args.length; i += 2) {
          const point = pt((relative ? at.x : 0) + args[i], (relative ? at.y : 0) + args[i + 1]);
          // A moveto's further pairs are linetos, so only its first starts a subpath.
          if (command.toUpperCase() === "M" && i === 0) {
            if (current.length > 0) subpaths.push(current);
            current = [point];
          } else {
            current.push(point);
          }
          at = point;
        }
        break;
      case "H":
        for (const x of args) {
          at = pt((relative ? at.x : 0) + x, at.y);
          current.push(at);
        }
        break;
      case "V":
        for (const y of args) {
          at = pt(at.x, (relative ? at.y : 0) + y);
          current.push(at);
        }
        break;
      case "A":
        for (let i = 0; i + 6 < args.length; i += 7) {
          const end = pt((relative ? at.x : 0) + args[i + 5], (relative ? at.y : 0) + args[i + 6]);
          current.push(...arcPoints(at, args.slice(i, i + 5), end));
          at = end;
        }
        break;
      case "Z":
        if (current.length > 0) {
          current.push(current[0]);
          at = current[0];
          subpaths.push(current);
          current = [];
        }
        break;
      default:
        throw new Error(`frameOutline cannot read the path command "${command}" in "${d}"`);
    }
  }
  if (current.length > 0) subpaths.push(current);
  return subpaths;
}
