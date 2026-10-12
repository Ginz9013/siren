/**
 * Siren's own layout defects, counted off the `<svg>` that `render()` drew.
 *
 * A test helper, not a measurement against Mermaid (that is the parity
 * script's job): these are pictures that are wrong whatever Mermaid draws —
 * frames overlapping each other, an edge leaving a frame as a two-point
 * straight segment, a line drawn through a box it does not belong to, an
 * edge label drawn over a box or over another label.
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
  encloses,
  holds,
  interiorsMeet,
  type Point,
  rectBox,
  routeOf,
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
 * How big one row of a label is drawn, given its text.
 *
 * Asked of the caller because the label's box is not in the SVG: a label is a
 * `<text>` centred on its anchor, and how wide its glyphs come out is the
 * measurer's and the font's, neither of which the picture records. The caller
 * that rendered the picture knows the measurer it rendered with.
 */
export type RowSize = (text: string) => { width: number; height: number };

/**
 * Every flowchart edge label drawn, by its edge's id, with the box it covers:
 * centred on the `<text>`'s `x`/`y`, as wide as its widest row and as tall as
 * its rows stacked. A label of one plain run is the `<text>`'s own content;
 * any other is one `tspan.siren-label-row` per row.
 */
function labelBoxes(svg: SVGSVGElement, rowSize: RowSize): { id: string; box: Box }[] {
  return Array.from(svg.querySelectorAll("text.siren-edge-label")).map((text) => {
    const rowElements = Array.from(text.querySelectorAll("tspan.siren-label-row"));
    const rows = (rowElements.length === 0 ? [text] : rowElements).map((row) =>
      rowSize(row.textContent ?? ""),
    );
    const width = Math.max(...rows.map((row) => row.width));
    const height = rows.reduce((sum, row) => sum + row.height, 0);
    const x = Number(text.getAttribute("x"));
    const y = Number(text.getAttribute("y"));
    return {
      id: text.getAttribute("data-siren-id") ?? "<no id>",
      box: { top: y - height / 2, bottom: y + height / 2, left: x - width / 2, right: x + width / 2 },
    };
  });
}

/**
 * Every (label, node) pair where an edge label's drawn box shares interior
 * with a node's frame, in draw order. Touching along an outline is not
 * sharing.
 */
export function labelsOverNodes(
  svg: SVGSVGElement,
  rowSize: RowSize,
): { label: string; node: string }[] {
  const nodes = nodeBoxes(svg);
  return labelBoxes(svg, rowSize).flatMap((label) =>
    nodes
      .filter((node) => interiorsMeet(label.box, node.box))
      .map((node) => ({ label: label.id, node: node.id })),
  );
}

/**
 * Every pair of edge labels whose drawn boxes share interior, by edge id in
 * draw order. Touching along an outline is not sharing.
 */
export function overlappingLabels(svg: SVGSVGElement, rowSize: RowSize): [string, string][] {
  const labels = labelBoxes(svg, rowSize);
  const pairs: [string, string][] = [];
  labels.forEach((a, i) => {
    for (const b of labels.slice(i + 1)) {
      if (interiorsMeet(a.box, b.box)) pairs.push([a.id, b.id]);
    }
  });
  return pairs;
}
