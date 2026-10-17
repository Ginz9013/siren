/**
 * Siren's own layout defects, counted off the `<svg>` that `render()` drew.
 *
 * A test helper, not a measurement against Mermaid (that is the parity
 * script's job): these are pictures that are wrong whatever Mermaid draws —
 * frames overlapping each other, an edge leaving a frame as a two-point
 * straight segment, a line drawn through a box it does not belong to, an
 * edge label drawn over a box or over another label, a line (in a flowchart
 * or a state diagram) stopping on a shape's box but off the figure drawn
 * there.
 *
 * Read from the finished SVG with the readers `corpus.ts` reads it with
 * (`svgGeometry.ts`) — frames by their `rect.siren-subgraph-frame` keyed by
 * the title drawn on them, edges by the route in `path.siren-edge`'s
 * `data-siren-points` — so what is counted is the picture, not the layout's
 * intermediate numbers. Only which group a node belongs to, which the picture
 * does not record, is asked of the caller (`GroupMembership`).
 */

import {
  type Box,
  distanceToPolyline,
  encloses,
  frameOutline,
  holds,
  interiorsMeet,
  type Point,
  rectBox,
  routeOf,
  squareCornered,
  subgraphFrames,
} from "./svgGeometry";

/**
 * Every pair of subgraph frames that overlap without one holding the other,
 * by title, in draw order. A frame nested inside another is grouping, not a
 * defect, so containment either way is not counted.
 */
export function overlappingFrames(svg: SVGSVGElement): [string, string][] {
  const drawn = subgraphFrames(svg).flatMap(({ title, box }) =>
    box === null ? [] : [{ title, box }],
  );
  const pairs: [string, string][] = [];
  drawn.forEach((a, i) => {
    for (const b of drawn.slice(i + 1)) {
      if (
        interiorsMeet(a.box, b.box) &&
        !encloses(a.box, b.box) &&
        !encloses(b.box, a.box)
      ) {
        pairs.push([a.title, b.title]);
      }
    }
  });
  return pairs;
}

/**
 * Every flowchart edge drawn, with the points its route passes through —
 * `routeOf`, the reader `corpus.ts`'s `pathPoints` reads it with.
 */
function edgeLines(svg: SVGSVGElement): { id: string; points: Point[] }[] {
  return Array.from(svg.querySelectorAll("path.siren-edge")).map((path) => ({
    id: path.getAttribute("data-siren-id") ?? "<no id>",
    points: routeOf(path),
  }));
}

/**
 * Who belongs to which group, and which two things each edge joins — a slice
 * of a flowchart's `GraphModel` (its `nodes`, `subgraphs` and `edges`, each
 * narrowed to the fields read here), so a `GraphModel` is one as it stands.
 * Handed in by the caller because the picture does not record it.
 *
 * Asked for rather than read off the frames: an edge from outside that names
 * a group ends on that group's outline, which a frame's geometry cannot tell
 * from an end among its members.
 */
export interface GroupMembership {
  /** Every node, by id, with the group it was declared inside, or `null`. */
  nodes: readonly { id: string; parentId: string | null }[];
  /** Every group, by id, with the group it is nested in, or `null`. */
  subgraphs: readonly { id: string; parentId: string | null }[];
  /** Every edge, by the id it is drawn with, with the ids at its two ends. */
  edges: readonly { id: string; from: string; to: string }[];
}

/**
 * The edges that are a **Boundary-crossing edge** of some group — exactly
 * one end among the group's descendants, members or nested groups at any
 * depth — and are drawn as a two-point straight segment, by id in draw
 * order. An edge from outside that names the group itself has neither end
 * among its descendants and is not one; an edge from a member to its own
 * group is.
 *
 * That straight segment is the fallback `layoutDirectedGraph` draws when the
 * engine returned no route (a cluster laid out in a direction of its own);
 * an edge the engine routed comes back with at least one bend point.
 */
export function straightBoundaryCrossingEdges(
  svg: SVGSVGElement,
  membership: GroupMembership,
): string[] {
  const parentOf = new Map(
    [...membership.nodes, ...membership.subgraphs].map(({ id, parentId }) => [id, parentId]),
  );
  // Deliberately independent of layoutDirectedGraph's own walk: this is its oracle.
  /** Whether `id` lies strictly below `group` — a group is not its own descendant. */
  const isDescendantOf = (id: string, group: string): boolean => {
    for (
      let parent = parentOf.get(id) ?? null;
      parent !== null;
      parent = parentOf.get(parent) ?? null
    ) {
      if (parent === group) return true;
    }
    return false;
  };
  const edgeById = new Map(membership.edges.map((edge) => [edge.id, edge]));
  return edgeLines(svg)
    .filter(({ id, points }) => {
      if (points.length !== 2) return false;
      const edge = edgeById.get(id);
      if (edge === undefined) {
        throw new Error(`edge "${id}" was drawn but the membership does not name it`);
      }
      return membership.subgraphs.some(
        ({ id: group }) => isDescendantOf(edge.from, group) !== isDescendantOf(edge.to, group),
      );
    })
    .map(({ id }) => id);
}

/**
 * The extent of a `<path>` outline: every `M`/`L` point, and the end point of
 * every `A` arc. A cylinder's lid and base bulge past their arcs' end points
 * by the arc's own height, so its extent here is a little short of the drawn
 * one — which can only under-count a line through it, never invent one.
 */
function pathExtent(d: string): Box {
  const points: [number, number][] = [];
  for (const [, command, rest] of d.matchAll(/([MLAZ])([^MLAZ]*)/g)) {
    if (command === "Z") continue;
    const pairs = rest.trim().split(/\s+/).filter((token) => token.includes(","));
    const pair = command === "A" ? pairs[pairs.length - 1] : pairs[0];
    if (pair === undefined) continue;
    const [x, y] = pair.split(",").map(Number);
    points.push([x, y]);
  }
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    top: Math.min(...ys),
    bottom: Math.max(...ys),
    left: Math.min(...xs),
    right: Math.max(...xs),
  };
}

/**
 * Every flowchart node drawn, with the extent of its frame: a `<rect>` read
 * with `rectBox`, as `corpus.ts`'s `nodeBox` reads it, any other frame element by the
 * extent of its outline. A subroutine draws one box and two bars, all frames;
 * the extent is taken over all of them.
 */
function nodeBoxes(svg: SVGSVGElement): { id: string; box: Box }[] {
  return Array.from(svg.querySelectorAll("g.siren-node")).flatMap((group) => {
    const parts = Array.from(group.querySelectorAll(".siren-node-frame")).map((frame) => {
      if (frame.tagName.toLowerCase() === "rect") return rectBox(frame);
      return pathExtent(frame.getAttribute("d") ?? "");
    });
    if (parts.length === 0) return [];
    return [
      {
        id: group.getAttribute("data-siren-id") ?? "<no id>",
        box: {
          top: Math.min(...parts.map((part) => part.top)),
          bottom: Math.max(...parts.map((part) => part.bottom)),
          left: Math.min(...parts.map((part) => part.left)),
          right: Math.max(...parts.map((part) => part.right)),
        },
      },
    ];
  });
}

/** `box` grown (or, given a negative amount, shrunk) by `by` on every side. */
function grown(box: Box, by: number): Box {
  return {
    top: box.top - by,
    bottom: box.bottom + by,
    left: box.left - by,
    right: box.right + by,
  };
}

/** Whether the segment from `a` to `b` enters `box`'s interior (Liang–Barsky). */
function segmentEnters(a: Point, b: Point, box: Box): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let low = 0;
  let high = 1;
  for (const [p, q] of [
    [-dx, a.x - box.left],
    [dx, box.right - a.x],
    [-dy, a.y - box.top],
    [dy, box.bottom - a.y],
  ]) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low >= high) return false;
  }
  return true;
}

/**
 * How far a line has to reach into a box to count as passing through it, and
 * how close an end has to be to a box to count as that box's own — one pixel
 * either way, so a line touching an outline or a route clipped onto it is not
 * read as a defect.
 */
const TOLERANCE = 1;

/**
 * Every (edge, node) pair where the edge's drawn line passes through the
 * interior of a node that is not one of its own ends, in draw order. An end
 * is a node whose box the line starts or stops on.
 */
export function edgesThroughNodes(svg: SVGSVGElement): { edge: string; node: string }[] {
  const nodes = nodeBoxes(svg);
  return edgeLines(svg).flatMap(({ id, points }) => {
    const ends = [points[0], points[points.length - 1]];
    return nodes
      .filter(({ box }) => !ends.some((end) => holds(grown(box, TOLERANCE), end, 0)))
      .filter(({ box }) =>
        points.slice(1).some((point, i) => segmentEnters(points[i], point, grown(box, -TOLERANCE))),
      )
      .map((node) => ({ edge: id, node: node.id }));
  });
}

/**
 * Every flowchart edge label drawn, by its edge's id, with the box it covers:
 * its background, `rect.siren-connector-label-background`, which the renderer
 * paints over exactly the box layout measured the label in and kept clear. A
 * wrapped label's box is wider than its widest row (the wrap width and its
 * padding, the label-wrap ADR), so the rows' own text would under-read it.
 * A label drawn without its background is a broken picture, and says so.
 */
function labelBoxes(svg: SVGSVGElement): { id: string; box: Box }[] {
  const backgrounds = Array.from(svg.querySelectorAll("rect.siren-connector-label-background"));
  return Array.from(svg.querySelectorAll("text.siren-edge-label")).map((text) => {
    const id = text.getAttribute("data-siren-id") ?? "<no id>";
    const background = backgrounds.find((rect) => rect.getAttribute("data-siren-id") === id);
    if (background === undefined) {
      throw new Error(`edge label ${id} is drawn with no rect.siren-connector-label-background`);
    }
    return { id, box: rectBox(background) };
  });
}

/**
 * Every (label, node) pair where an edge label's drawn box shares interior
 * with a node's frame, in draw order. Touching along an outline is not
 * sharing.
 */
export function labelsOverNodes(svg: SVGSVGElement): { label: string; node: string }[] {
  const nodes = nodeBoxes(svg);
  return labelBoxes(svg).flatMap((label) =>
    nodes
      .filter((node) => interiorsMeet(label.box, node.box))
      .map((node) => ({ label: label.id, node: node.id })),
  );
}

/**
 * Every pair of edge labels whose drawn boxes share interior, by edge id in
 * draw order. Touching along an outline is not sharing.
 */
export function overlappingLabels(svg: SVGSVGElement): [string, string][] {
  const labels = labelBoxes(svg);
  const pairs: [string, string][] = [];
  labels.forEach((a, i) => {
    for (const b of labels.slice(i + 1)) {
      if (interiorsMeet(a.box, b.box)) pairs.push([a.id, b.id]);
    }
  });
  return pairs;
}

/**
 * The classes a node's or a state's figure is drawn with: a flowchart
 * node's frames, a state's box or choice diamond, a fork's bar, a start's
 * disc, an end's outer ring (its inner disc lies inside it), a composite's
 * or a region's frame.
 */
const FIGURE_CLASSES = [
  "siren-node-frame",
  "siren-state-frame",
  "siren-state-bar",
  "siren-state-start",
  "siren-state-end",
  "siren-composite-frame",
  "siren-state-region",
];

/**
 * Every line whose ends are clipped to a figure: a flowchart edge, a state
 * transition, and the connector from a state's note to its state — named
 * `note on <state>`, since a note's connector carries no id of its own.
 */
function connectorLines(svg: SVGSVGElement): { id: string; points: Point[] }[] {
  const notes = Array.from(svg.querySelectorAll("path.siren-note-link")).map((path) => ({
    id: `note on ${path.closest("g.siren-state")?.getAttribute("data-siren-id") ?? "<no id>"}`,
    points: routeOf(path),
  }));
  const transitions = Array.from(svg.querySelectorAll("path.siren-transition-line")).map((path) => ({
    id: path.getAttribute("data-siren-id") ?? path.closest("g.siren-transition")?.getAttribute("data-siren-id") ?? "<no id>",
    points: routeOf(path),
  }));
  return [...edgeLines(svg), ...transitions, ...notes];
}

/** A drawn node or state, as `endsOffOutline` reads it. */
interface Figure {
  id: string;
  /** A flowchart node's `data-siren-shape`; `null` for a state. */
  shape: string | null;
  box: Box;
  outline: Point[][];
}

/**
 * Every drawn node or state whose figure is not simply its box, with its box (the
 * extent of everything it is drawn with, curves' bulges included) and the
 * outline it is drawn with, read off each frame with `frameOutline`. A node
 * one of whose frames is a square-cornered `<rect>` as big as the whole box
 * is left out: its box is its figure, so an end on the box is an end on the
 * figure. A square rect with something sticking out of it is not.
 */
function drawnFigures(svg: SVGSVGElement): Figure[] {
  return Array.from(svg.querySelectorAll("g.siren-node, g.siren-state")).flatMap((group) => {
    // The group's own children only: a composite state's group holds its
    // members' groups, and a state's holds its note, neither its figure.
    const frames = Array.from(group.children).filter((child) =>
      FIGURE_CLASSES.some((name) => child.classList.contains(name)),
    );
    const outline = frames.flatMap(frameOutline);
    const points = outline.flat();
    if (points.length === 0) return [];
    const box = {
      top: Math.min(...points.map(({ y }) => y)),
      bottom: Math.max(...points.map(({ y }) => y)),
      left: Math.min(...points.map(({ x }) => x)),
      right: Math.max(...points.map(({ x }) => x)),
    };
    const square = frames.some(
      (frame) =>
        frame.tagName.toLowerCase() === "rect" && squareCornered(frame) && sameBox(rectBox(frame), box),
    );
    if (square) return [];
    return [
      {
        id: group.getAttribute("data-siren-id") ?? "<no id>",
        shape: group.getAttribute("data-siren-shape"),
        box,
        outline,
      },
    ];
  });
}

/** Whether two boxes are the same to within `TOLERANCE` on every side. */
function sameBox(a: Box, b: Box): boolean {
  return (
    Math.abs(a.top - b.top) <= TOLERANCE &&
    Math.abs(a.bottom - b.bottom) <= TOLERANCE &&
    Math.abs(a.left - b.left) <= TOLERANCE &&
    Math.abs(a.right - b.right) <= TOLERANCE
  );
}

/**
 * Every (line, node) pair — a flowchart edge, a state transition or a
 * note's connector, and a node or a state — where an end of the line stops
 * on the box of one drawn as something other than its box — within
 * `TOLERANCE` of it — but more than `TOLERANCE` from the figure actually
 * drawn there, in draw order: an arrow that stops short of a diamond, or in
 * the air beside a circle. A connector is clipped to its shape's outline,
 * so its end belongs on the figure, not on the box around it — except
 * where it is left off on purpose (`offOnPurpose`).
 */
export function endsOffOutline(svg: SVGSVGElement): { edge: string; node: string }[] {
  const figures = drawnFigures(svg);
  return connectorLines(svg).flatMap(({ id, points }) => {
    const ends = [points[0], points[points.length - 1]];
    return figures
      .filter((figure) =>
        ends.some(
          (end) =>
            holds(grown(figure.box, TOLERANCE), end, 0) &&
            distanceToOutline(end, figure.outline) > TOLERANCE &&
            !offOnPurpose(figure, end),
        ),
      )
      .map((figure) => ({ edge: id, node: figure.id }));
  });
}

/**
 * Whether `end`, off `figure`'s drawn outline, is off it on purpose — the
 * shapes whose connectors are deliberately not clipped onto what is drawn:
 *
 * - **A brace** (`brace-left`, `brace-right`, `braces`) meets the box it
 *   stands in, an invisible hit rectangle, as Mermaid's handler for it
 *   does: the brace is drawn down one side or two, and a
 *   line from anywhere else stops on the box — on it, not inside it.
 * - **An hourglass**, on its left or right side: its outline is two
 *   triangles meeting at the pinch, drawn along the top, the bottom and
 *   both diagonals. A line meeting it from the side would cross the outline
 *   only at the pinch, in the middle of the figure, so the clip keeps the
 *   end on the box's open side instead.
 * - **A bang whose drawn outline crosses itself** — one so narrow for its
 *   height that the scallops down its two sides dip past each other. The
 *   clip skips crossings of an outline with itself, so an end there can
 *   stop where no arc is drawn: on the box, or among the scallops — no
 *   further from what is drawn than the deepest scallop dips in from the
 *   box.
 */
function offOnPurpose(figure: Figure, end: Point): boolean {
  switch (figure.shape) {
    case "brace-left":
    case "brace-right":
    case "braces":
      return onBoxSide(figure.box, end);
    case "hourglass":
      return (
        Math.abs(end.x - figure.box.left) <= TOLERANCE || Math.abs(end.x - figure.box.right) <= TOLERANCE
      );
    case "bang":
      return (
        crossesItself(figure.outline) &&
        (onBoxSide(figure.box, end) || distanceToOutline(end, figure.outline) <= scallopDepth(figure))
      );
    default:
      return false;
  }
}

/** The closed polyline round `box`'s four sides. */
function sidesOf({ top, bottom, left, right }: Box): Point[] {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
    { x: left, y: top },
  ];
}

/** Whether `end` stands within `TOLERANCE` of one of `box`'s sides. */
function onBoxSide(box: Box, end: Point): boolean {
  return distanceToPolyline(end, sidesOf(box)) <= TOLERANCE;
}

/** How far `point` stands from the nearest of `outline`'s polylines. */
function distanceToOutline(point: Point, outline: Point[][]): number {
  return Math.min(...outline.map((line) => distanceToPolyline(point, line)));
}

/** How far in from its box the deepest point of `figure`'s outline dips. */
function scallopDepth(figure: Figure): number {
  const sides = sidesOf(figure.box);
  return Math.max(...figure.outline.flat().map((point) => distanceToPolyline(point, sides)));
}

/**
 * Whether any two segments of `outline`'s polylines that are not neighbours
 * cross at a point inside both — touching at an end does not count.
 */
function crossesItself(outline: Point[][]): boolean {
  const segments = outline.flatMap((line) => line.slice(1).map((b, i) => [line[i], b] as const));
  const turn = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const EPSILON = 1e-9;
  const opposite = (p: number, q: number) => (p > EPSILON && q < -EPSILON) || (p < -EPSILON && q > EPSILON);
  return segments.some(([a, b], i) =>
    segments
      .slice(i + 2)
      .some(([c, d]) => opposite(turn(c, d, a), turn(c, d, b)) && opposite(turn(a, b, c), turn(a, b, d))),
  );
}
