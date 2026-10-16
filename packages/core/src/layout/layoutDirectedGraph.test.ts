import { describe, expect, it } from "vitest";
import { distanceToPolyline } from "../compat/svgGeometry";
import type { Direction, Point } from "../contracts";
import {
  LAYOUT_MARGIN,
  layoutDirectedGraph,
  type DirectedGraphInput,
  type DirectedGraphNodeBox,
} from "./layoutDirectedGraph";
import { LayoutEngineError } from "./elkSync";

/** The same three-box chain, laid out in whichever direction is asked for. */
function chain(direction: Direction): DirectedGraphInput {
  return {
    direction,
    nodes: [
      { id: "A", width: 60, height: 40 },
      { id: "B", width: 60, height: 40 },
      { id: "C", width: 60, height: 40 },
    ],
    edges: [
      { id: "A-B", from: "A", to: "B" },
      { id: "B-C", from: "B", to: "C" },
    ],
  };
}

const centre = (box: DirectedGraphNodeBox): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

function boxesOf(input: DirectedGraphInput): Record<string, DirectedGraphNodeBox> {
  return Object.fromEntries(layoutDirectedGraph(input).nodes.map((box) => [box.id, box]));
}

describe("layoutDirectedGraph places boxes", () => {
  it.each([
    ["TB", (a: Point, b: Point) => b.y > a.y],
    ["BT", (a: Point, b: Point) => b.y < a.y],
    ["LR", (a: Point, b: Point) => b.x > a.x],
    ["RL", (a: Point, b: Point) => b.x < a.x],
  ] as const)("along the direction: under %s each edge's target lies past its source", (direction, past) => {
    const boxes = boxesOf(chain(direction));
    expect(past(centre(boxes.A), centre(boxes.B))).toBe(true);
    expect(past(centre(boxes.B), centre(boxes.C))).toBe(true);
  });

  it("at the sizes it was given, in the input's order, inside the reported bounds", () => {
    const result = layoutDirectedGraph(chain("TB"));
    expect(result.nodes.map((box) => [box.id, box.width, box.height])).toEqual([
      ["A", 60, 40],
      ["B", 60, 40],
      ["C", 60, 40],
    ]);
    for (const box of result.nodes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(result.width);
      expect(box.y + box.height).toBeLessThanOrEqual(result.height);
    }
  });
});

/** Within half a pixel: ELK reports fractions, and nothing here is drawn finer than that. */
const EPSILON = 0.5;

/** Whether `point` lies on the outline of `box`. */
function onOutline(point: Point, box: DirectedGraphNodeBox): boolean {
  const withinX = point.x >= box.x - EPSILON && point.x <= box.x + box.width + EPSILON;
  const withinY = point.y >= box.y - EPSILON && point.y <= box.y + box.height + EPSILON;
  const onVertical = Math.abs(point.x - box.x) <= EPSILON || Math.abs(point.x - (box.x + box.width)) <= EPSILON;
  const onHorizontal = Math.abs(point.y - box.y) <= EPSILON || Math.abs(point.y - (box.y + box.height)) <= EPSILON;
  return (withinX && withinY) && (onVertical || onHorizontal);
}

/**
 * Whether some segment of `points` reaches more than `tolerance` inside `box`
 * (by its sides). At a tolerance of 1 this is the parity report's "through a
 * title".
 */
function routeReachesInto(
  points: readonly Point[],
  box: { left: number; right: number; top: number; bottom: number },
  tolerance = 0,
): boolean {
  return points.some(
    (p, i) =>
      i > 0 &&
      Math.min(p.x, points[i - 1].x) < box.right - tolerance &&
      Math.max(p.x, points[i - 1].x) > box.left + tolerance &&
      Math.min(p.y, points[i - 1].y) < box.bottom - tolerance &&
      Math.max(p.y, points[i - 1].y) > box.top + tolerance,
  );
}

/** Every segment of `points` is horizontal or vertical. */
function isOrthogonal(points: readonly Point[]): boolean {
  return points.every(
    (point, index) =>
      index === 0 ||
      Math.abs(point.x - points[index - 1].x) <= EPSILON ||
      Math.abs(point.y - points[index - 1].y) <= EPSILON,
  );
}

/** A diamond: one box fanning out to two and joining again, so some route has to bend. */
const diamond: DirectedGraphInput = {
  direction: "TB",
  nodes: [
    { id: "A", width: 60, height: 40 },
    { id: "B", width: 120, height: 40 },
    { id: "C", width: 60, height: 40 },
    { id: "D", width: 60, height: 40 },
  ],
  edges: [
    { id: "A-B", from: "A", to: "B" },
    { id: "A-C", from: "A", to: "C" },
    { id: "B-D", from: "B", to: "D" },
    { id: "C-D", from: "C", to: "D" },
  ],
};

describe("layoutDirectedGraph routes edges", () => {
  it("one route per edge, in the input's order, each starting on its source's outline and ending on its target's", () => {
    const result = layoutDirectedGraph(diamond);
    const box = Object.fromEntries(result.nodes.map((b) => [b.id, b]));
    expect(result.edges.map((route) => route.id)).toEqual(["A-B", "A-C", "B-D", "C-D"]);
    for (const [route, edge] of result.edges.map((r, i) => [r, diamond.edges[i]] as const)) {
      expect(route.points.length).toBeGreaterThanOrEqual(2);
      expect(onOutline(route.points[0], box[edge.from]), `${route.id} starts off ${edge.from}`).toBe(true);
      expect(onOutline(route.points.at(-1)!, box[edge.to]), `${route.id} ends off ${edge.to}`).toBe(true);
    }
  });

  it("with horizontal and vertical segments only — and some route here does bend", () => {
    const result = layoutDirectedGraph(diamond);
    for (const route of result.edges) {
      expect(isOrthogonal(route.points), `${route.id}: ${JSON.stringify(route.points)}`).toBe(true);
    }
    expect(result.edges.some((route) => route.points.length > 2)).toBe(true);
  });
});

/** A group `G` holding `A -> B` and a nested group `H` holding `D`, with `C` outside reaching in. */
const grouped: DirectedGraphInput = {
  direction: "TB",
  nodes: [
    { id: "C", width: 60, height: 40 },
    { id: "G", width: 0, height: 0, cluster: { padding: 12, title: { width: 50, height: 20 } } },
    { id: "A", width: 60, height: 40, parentId: "G" },
    { id: "B", width: 60, height: 40, parentId: "G" },
    { id: "H", width: 0, height: 0, parentId: "G", cluster: { padding: 12, title: { width: 30, height: 20 } } },
    { id: "D", width: 60, height: 40, parentId: "H" },
  ],
  edges: [
    { id: "C-A", from: "C", to: "A" },
    { id: "A-B", from: "A", to: "B" },
    { id: "A-D", from: "A", to: "D" },
  ],
};

describe("layoutDirectedGraph frames a group", () => {
  /** `inner` sits inside `outer`, clear of its sides and bottom by `padding` and of its top by `top`. */
  function expectHeld(outer: DirectedGraphNodeBox, inner: DirectedGraphNodeBox, padding: number, top: number) {
    expect(inner.x - outer.x, `${inner.id} left in ${outer.id}`).toBeGreaterThanOrEqual(padding - EPSILON);
    expect(outer.x + outer.width - (inner.x + inner.width), `${inner.id} right in ${outer.id}`).toBeGreaterThanOrEqual(padding - EPSILON);
    expect(outer.y + outer.height - (inner.y + inner.height), `${inner.id} bottom in ${outer.id}`).toBeGreaterThanOrEqual(padding - EPSILON);
    expect(inner.y - outer.y, `${inner.id} top in ${outer.id}`).toBeGreaterThanOrEqual(top - EPSILON);
  }

  it("around every member, by its padding, with a title band above them", () => {
    const boxes = boxesOf(grouped);
    // The title band: padding, the title, padding again — then the members.
    for (const id of ["A", "B", "H"]) expectHeld(boxes.G, boxes[id], 12, 12 + 20 + 12);
    expectHeld(boxes.H, boxes.D, 12, 12 + 20 + 12);
    // And not around what is outside it.
    const c = boxes.C;
    const g = boxes.G;
    const overlaps = c.x < g.x + g.width && g.x < c.x + c.width && c.y < g.y + g.height && g.y < c.y + c.height;
    expect(overlaps).toBe(false);
  });

  it("with the title's centre in the band, clear of every route crossing the band, inside the frame by half a padding", () => {
    const result = layoutDirectedGraph(grouped);
    const g = result.nodes.find((box) => box.id === "G")!;
    const a = result.nodes.find((box) => box.id === "A")!;
    expect(g.title).toBeDefined();
    // The title G's box: 50x20 about its centre. `C --> A` runs down through
    // the band, so the title is not where centring alone would put it.
    const [left, right, top, bottom] = [g.title!.x - 25, g.title!.x + 25, g.title!.y - 10, g.title!.y + 10];
    for (const route of result.edges) {
      const through = routeReachesInto(route.points, { left, right, top, bottom });
      expect(through, `${route.id} through G's title: ${JSON.stringify(route.points)}`).toBe(false);
    }
    expect(left).toBeGreaterThanOrEqual(g.x + 6 - EPSILON);
    expect(right).toBeLessThanOrEqual(g.x + g.width - 6 + EPSILON);
    // Below the frame's top by its padding and half the title; above every member.
    expect(g.title!.y).toBeCloseTo(g.y + 12 + 10, 0);
    expect(g.title!.y + 10).toBeLessThanOrEqual(a.y);
    expect(result.nodes.find((box) => box.id === "A")!.title).toBeUndefined();
  });

  it("at least as wide as its title and padding, however narrow its members", () => {
    const boxes = boxesOf({
      direction: "TB",
      nodes: [
        { id: "G", width: 0, height: 0, cluster: { padding: 12, title: { width: 200, height: 20 } } },
        { id: "A", width: 20, height: 20, parentId: "G" },
      ],
      edges: [],
    });
    expect(boxes.G.width).toBeGreaterThanOrEqual(200 + 2 * 12 - EPSILON);
    expectHeld(boxes.G, boxes.A, 12, 12 + 20 + 12);
  });
});

/** Whether `point` lies strictly inside `box`, by more than the tolerance. */
function strictlyInside(point: Point, box: DirectedGraphNodeBox): boolean {
  return (
    point.x > box.x + EPSILON &&
    point.x < box.x + box.width - EPSILON &&
    point.y > box.y + EPSILON &&
    point.y < box.y + box.height - EPSILON
  );
}

describe("layoutDirectedGraph routes edges whose end is a group, or loops", () => {
  const input: DirectedGraphInput = {
    direction: "TB",
    nodes: [
      { id: "C", width: 60, height: 40 },
      { id: "G", width: 0, height: 0, cluster: { padding: 12, title: { width: 50, height: 20 } } },
      { id: "A", width: 60, height: 40, parentId: "G" },
      { id: "K", width: 0, height: 0, cluster: { padding: 12, title: { width: 50, height: 20 } } },
      { id: "B", width: 60, height: 40, parentId: "K" },
    ],
    edges: [
      { id: "C-G", from: "C", to: "G" },
      { id: "G-K", from: "G", to: "K" },
      { id: "C-C", from: "C", to: "C" },
      { id: "K-K", from: "K", to: "K" },
    ],
  };

  it.each([
    ["C-G", "C", "G"],
    ["G-K", "G", "K"],
    ["C-C", "C", "C"],
    ["K-K", "K", "K"],
  ])("%s: orthogonal, from %s's outline to %s's, never through the inside of either", (id, from, to) => {
    const result = layoutDirectedGraph(input);
    const box = Object.fromEntries(result.nodes.map((b) => [b.id, b]));
    const route = result.edges.find((r) => r.id === id)!;
    expect(isOrthogonal(route.points), JSON.stringify(route.points)).toBe(true);
    expect(onOutline(route.points[0], box[from]), `starts at ${JSON.stringify(route.points[0])}`).toBe(true);
    expect(onOutline(route.points.at(-1)!, box[to]), `ends at ${JSON.stringify(route.points.at(-1))}`).toBe(true);
    for (const point of route.points) {
      expect(strictlyInside(point, box[from]) || strictlyInside(point, box[to]), JSON.stringify(point)).toBe(false);
    }
    // A loop leaves its box and comes back: some point lies off the outline.
    if (from === to) expect(route.points.some((point) => !onOutline(point, box[from]))).toBe(true);
  });
});

describe("layoutDirectedGraph keeps room for an edge's label", () => {
  it.each(["TB", "LR"] as const)("%s: centred on the route, clear of both ends' boxes", (direction) => {
    const label = { width: 80, height: 20 };
    const result = layoutDirectedGraph({
      direction,
      nodes: [
        { id: "A", width: 60, height: 40 },
        { id: "B", width: 60, height: 40 },
      ],
      edges: [{ id: "A-B", from: "A", to: "B", label }],
    });
    const route = result.edges[0];
    expect(route.labelAnchor).toBeDefined();
    const anchor = route.labelAnchor!;
    expect(distanceToPolyline(anchor, route.points)).toBeLessThanOrEqual(EPSILON);
    const labelBox = { id: "label", x: anchor.x - label.width / 2, y: anchor.y - label.height / 2, ...label };
    for (const box of result.nodes) {
      const overlaps =
        labelBox.x < box.x + box.width && box.x < labelBox.x + labelBox.width &&
        labelBox.y < box.y + box.height && box.y < labelBox.y + labelBox.height;
      expect(overlaps, `the label overlaps ${box.id}`).toBe(false);
    }
  });

  it("and reports no anchor for an edge that asked for none", () => {
    expect(layoutDirectedGraph(chain("TB")).edges.every((route) => route.labelAnchor === undefined)).toBe(true);
  });
});

describe("layoutDirectedGraph keeps a cluster's frame as wide as its title", () => {
  /** `inner` inside `outer`, clear of every side by `padding` and of the top by the title band. */
  function expectEnclosed(outer: DirectedGraphNodeBox, inner: DirectedGraphNodeBox, padding: number, band: number) {
    expect(inner.x - outer.x, `${inner.id} left in ${outer.id}`).toBeGreaterThanOrEqual(padding - EPSILON);
    expect(outer.x + outer.width - (inner.x + inner.width), `${inner.id} right in ${outer.id}`).toBeGreaterThanOrEqual(padding - EPSILON);
    expect(inner.y - outer.y, `${inner.id} top in ${outer.id}`).toBeGreaterThanOrEqual(band - EPSILON);
    expect(outer.y + outer.height - (inner.y + inner.height), `${inner.id} bottom in ${outer.id}`).toBeGreaterThanOrEqual(padding - EPSILON);
  }

  it("under an LR diagram, around a member far narrower than the title", () => {
    const boxes = boxesOf({
      direction: "LR",
      nodes: [
        { id: "G", width: 0, height: 0, cluster: { padding: 12, title: { width: 200, height: 20 } } },
        { id: "A", width: 20, height: 20, parentId: "G" },
      ],
      edges: [],
    });
    expect(boxes.G.width).toBeGreaterThanOrEqual(200 + 2 * 12 - EPSILON);
    // A title's width is not a height.
    expect(boxes.G.height).toBeLessThan(200);
    expectEnclosed(boxes.G, boxes.A, 12, 12 + 20 + 12);
  });

  it("inside a `direction TB` cluster of an LR diagram, a nested cluster with a narrow member and a wide title", () => {
    const boxes = boxesOf({
      direction: "LR",
      nodes: [
        { id: "O", width: 0, height: 0, cluster: { padding: 12, title: { width: 40, height: 20 }, direction: "TB" } },
        { id: "I", width: 0, height: 0, parentId: "O", cluster: { padding: 12, title: { width: 200, height: 20 } } },
        { id: "A", width: 20, height: 20, parentId: "I" },
        { id: "B", width: 20, height: 20, parentId: "O" },
      ],
      edges: [],
    });
    expect(boxes.I.width).toBeGreaterThanOrEqual(200 + 2 * 12 - EPSILON);
    expect(boxes.I.height).toBeLessThan(200);
    expectEnclosed(boxes.I, boxes.A, 12, 12 + 20 + 12);
    expectEnclosed(boxes.O, boxes.I, 12, 12 + 20 + 12);
    expectEnclosed(boxes.O, boxes.B, 12, 12 + 20 + 12);
  });
});

describe("layoutDirectedGraph lays a group out in its own direction", () => {
  // Every expectation here is Mermaid 12.2.0's picture of the same document
  // under its default (ELK) layout, measured in headless Chrome: "side by
  // side" is the two boxes at one y, "stacked" is one above the other.
  const group = (direction?: Direction) => ({
    id: "G",
    width: 0,
    height: 0,
    cluster: { padding: 12, title: { width: 30, height: 20 }, ...(direction === undefined ? {} : { direction }) },
  });
  const box = (id: string, parentId?: string) => ({ id, width: 60, height: 40, ...(parentId === undefined ? {} : { parentId }) });
  const sideBySide = (boxes: Record<string, DirectedGraphNodeBox>) =>
    Math.abs(centre(boxes.A).y - centre(boxes.B).y) < 1 && centre(boxes.B).x > centre(boxes.A).x;
  const stacked = (boxes: Record<string, DirectedGraphNodeBox>) =>
    Math.abs(centre(boxes.A).x - centre(boxes.B).x) < 1 && centre(boxes.B).y > centre(boxes.A).y;

  it("`direction LR` inside a TB diagram, with nothing crossing its frame: a row", () => {
    const boxes = boxesOf({
      direction: "TB",
      nodes: [group("LR"), box("A", "G"), box("B", "G")],
      edges: [{ id: "A-B", from: "A", to: "B" }],
    });
    expect(sideBySide(boxes)).toBe(true);
  });

  it("an edge from outside to a member voids it: the group takes the diagram's direction", () => {
    const boxes = boxesOf({
      direction: "TB",
      nodes: [group("LR"), box("A", "G"), box("B", "G"), box("C")],
      edges: [
        { id: "A-B", from: "A", to: "B" },
        { id: "C-A", from: "C", to: "A" },
      ],
    });
    expect(stacked(boxes)).toBe(true);
  });

  it("an edge from outside naming the group itself does not: still a row", () => {
    const boxes = boxesOf({
      direction: "TB",
      nodes: [group("LR"), box("A", "G"), box("B", "G"), box("C")],
      edges: [
        { id: "A-B", from: "A", to: "B" },
        { id: "C-G", from: "C", to: "G" },
      ],
    });
    expect(sideBySide(boxes)).toBe(true);
  });

  it("an edge from a member to its own group voids it", () => {
    const boxes = boxesOf({
      direction: "TB",
      nodes: [group("LR"), box("A", "G"), box("B", "G")],
      edges: [
        { id: "A-B", from: "A", to: "B" },
        { id: "B-G", from: "B", to: "G" },
      ],
    });
    expect(stacked(boxes)).toBe(true);
  });

  it("an edge inside it between two levels of nesting voids it too — unlike the dagre-era rule", () => {
    // `O` (LR) holds `I` (holding A) and B; `A --> B` never leaves `O`, and
    // Mermaid stacks them anyway.
    const boxes = boxesOf({
      direction: "TB",
      nodes: [
        { ...group("LR"), id: "O" },
        { ...group(), id: "I", parentId: "O" },
        box("A", "I"),
        box("B", "O"),
      ],
      edges: [{ id: "A-B", from: "A", to: "B" }],
    });
    expect(stacked(boxes)).toBe(true);
  });

  it.each(["TB", "LR"] as const)(
    "under %s, a row group and the groups inside it are still as wide as their titles",
    (direction) => {
      const boxes = boxesOf({
        direction,
        nodes: [
          { ...group("LR"), cluster: { padding: 12, title: { width: 300, height: 20 }, direction: "LR" } },
          { id: "H", width: 0, height: 0, parentId: "G", cluster: { padding: 12, title: { width: 200, height: 20 } } },
          box("A", "H"),
          { id: "K", width: 0, height: 0, cluster: { padding: 12, title: { width: 250, height: 20 } } },
          box("B", "K"),
        ],
        edges: [],
      });
      expect(boxes.G.width).toBeGreaterThanOrEqual(324 - EPSILON);
      expect(boxes.H.width).toBeGreaterThanOrEqual(224 - EPSILON);
      expect(boxes.K.width).toBeGreaterThanOrEqual(274 - EPSILON);
      // And not stretched the other way: a title's width is not a height.
      for (const id of ["G", "H", "K"]) expect(boxes[id].height).toBeLessThan(200);
    },
  );
});

describe("layoutDirectedGraph's line hops", () => {
  // Four boxes, each top one joined to both bottom ones: ELK routes two of
  // the four edges with a horizontal run, and they cross each other's
  // vertical runs. The rule itself, case by case, is `lineHops.test.ts`'s;
  // this is the core handing it its finished routes.
  const crossed = (cornerRadius: number): DirectedGraphInput => ({
    direction: "TB",
    nodes: ["A", "B", "C", "D"].map((id) => ({ id, width: 60, height: 40 })),
    edges: [
      ["A", "D"],
      ["B", "C"],
      ["A", "C"],
      ["B", "D"],
    ].map(([from, to]) => ({ id: `${from}-${to}`, from, to, cornerRadius })),
  });

  /** Whether `p` lies on the segment from `a` to `b`, within a hundredth of a pixel. */
  const onSegment = (p: Point, a: Point, b: Point) =>
    Math.min(a.x, b.x) - 0.01 <= p.x &&
    p.x <= Math.max(a.x, b.x) + 0.01 &&
    Math.min(a.y, b.y) - 0.01 <= p.y &&
    p.y <= Math.max(a.y, b.y) + 0.01 &&
    Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) < 0.01 * Math.hypot(b.x - a.x, b.y - a.y);

  it("puts a hop where two routes cross, on the horizontal one, on the vertical one's line", () => {
    const { edges } = layoutDirectedGraph(crossed(5));
    const hops = edges.flatMap((route) => route.hops.map((hop) => ({ route, hop })));
    expect(hops.length).toBeGreaterThan(0);
    for (const { route, hop } of hops) {
      const [a, b] = [route.points[hop.segment], route.points[hop.segment + 1]];
      expect(a.y).toBe(b.y);
      expect(onSegment(hop, a, b)).toBe(true);
      expect(hop.radius).toBeGreaterThanOrEqual(3.6);
      expect(hop.radius).toBeLessThanOrEqual(6);
      const jumped = edges.filter(
        (other) =>
          other !== route &&
          other.points.slice(1).some((q, i) => other.points[i].x === q.x && onSegment(hop, other.points[i], q)),
      );
      expect(jumped.length).toBeGreaterThan(0);
    }
  });
});

describe("layoutDirectedGraph keeps the model's order", () => {
  it("between siblings nothing else orders: the first declared is laid out first", () => {
    const fan = (order: string[]): DirectedGraphInput => ({
      direction: "TB",
      nodes: [{ id: "A", width: 60, height: 40 }, ...order.map((id) => ({ id, width: 60, height: 40 }))],
      edges: order.map((id) => ({ id: `A-${id}`, from: "A", to: id })),
    });
    const leftToRight = (order: string[]) =>
      layoutDirectedGraph(fan(order))
        .nodes.filter((box) => box.id !== "A")
        .sort((a, b) => a.x - b.x)
        .map((box) => box.id);
    expect(leftToRight(["B1", "B2", "B3"])).toEqual(["B1", "B2", "B3"]);
    expect(leftToRight(["B3", "B2", "B1"])).toEqual(["B3", "B2", "B1"]);
  });

  it("and is deterministic: the same input lays out the same way twice", () => {
    expect(layoutDirectedGraph(grouped)).toEqual(layoutDirectedGraph(grouped));
  });
});

describe("layoutDirectedGraph holds a long edge's ends that many layers apart", () => {
  // `A ----> B` is `minLength: 3`. Mermaid 12.2.0 on ELK ignores it (measured:
  // drawn exactly as `-->`); Siren keeps the rank distance the document asks
  // for — nook decision 01M4VA6MS4MCTFFJJWEZR453YS. A chain of three plain
  // edges beside it marks where layer 3 is.
  // Unlabelled: ELK gives a labelled edge a layer of its own for the label,
  // so a label would move B one layer further whatever its length.
  const input = (minLength: number, label?: { width: number; height: number }): DirectedGraphInput => ({
    direction: "TB",
    nodes: ["A", "B", "X", "Y", "Z"].map((id) => ({ id, width: 60, height: 40 })),
    edges: [
      { id: "A-B", from: "A", to: "B", minLength, ...(label === undefined ? {} : { label }) },
      { id: "A-X", from: "A", to: "X" },
      { id: "X-Y", from: "X", to: "Y" },
      { id: "Y-Z", from: "Y", to: "Z" },
    ],
  });

  it("`minLength: 3` puts the target in the third layer below its source, level with the chain's third box", () => {
    const boxes = boxesOf(input(3));
    expect(centre(boxes.B).y).toBeCloseTo(centre(boxes.Z).y, 0);
  });

  it("`minLength: 1` leaves it in the first, level with the chain's first box", () => {
    const boxes = boxesOf(input(1));
    expect(centre(boxes.B).y).toBeCloseTo(centre(boxes.X).y, 0);
  });

  it("and is still one edge: one orthogonal route from A's outline to B's, carrying its label, and no extra boxes", () => {
    const result = layoutDirectedGraph(input(3, { width: 40, height: 20 }));
    expect(result.nodes.map((box) => box.id)).toEqual(["A", "B", "X", "Y", "Z"]);
    expect(result.edges.map((route) => route.id)).toEqual(["A-B", "A-X", "X-Y", "Y-Z"]);
    const box = Object.fromEntries(result.nodes.map((b) => [b.id, b]));
    const route = result.edges[0];
    expect(isOrthogonal(route.points), JSON.stringify(route.points)).toBe(true);
    expect(onOutline(route.points[0], box.A)).toBe(true);
    expect(onOutline(route.points.at(-1)!, box.B)).toBe(true);
    expect(route.labelAnchor).toBeDefined();
    expect(distanceToPolyline(route.labelAnchor!, route.points)).toBeLessThanOrEqual(EPSILON);
  });
});

describe("layoutDirectedGraph rejects a node inside a cluster it was not given", () => {
  // A caller bug, not a document's: every adapter builds `parentId` from ids
  // it declared. Still Siren's own error, naming the id, rather than a
  // TypeError from deep inside the core.
  it.each([
    ["a box", { id: "A", width: 60, height: 40, parentId: "Missing" }],
    ["a cluster", { id: "G", width: 0, height: 0, parentId: "Missing", cluster: { padding: 12 } }],
  ])("%s naming an unknown parent: LayoutEngineError, naming the id", (_, node) => {
    const input: DirectedGraphInput = { direction: "TB", nodes: [node], edges: [] };
    expect(() => layoutDirectedGraph(input)).toThrow(LayoutEngineError);
    expect(() => layoutDirectedGraph(input)).toThrow(/"Missing"/);
  });
});

describe("layoutDirectedGraph orients an edge that runs back between clusters", () => {
  // `subgraph S1 { A, C }`, `subgraph S2 { B }`, `A --> B`, `B --> C`. The
  // boxes alone are a chain, but the frames are a cycle: S1 → S2 → S1.
  // Measured in headless Chrome against Mermaid 12.2.0's default layout:
  // S1 on top with A and C side by side, S2 below it, B under both — the
  // frame-level back edge `B --> C` laid out as if it ran C to B, and drawn
  // from B to C all the same.
  const input: DirectedGraphInput = {
    direction: "TB",
    nodes: [
      // In the order Mermaid hands them to ELK, last-declared subgraph first.
      { id: "S2", width: 0, height: 0, cluster: { padding: 12, title: { width: 20, height: 18 } } },
      { id: "S1", width: 0, height: 0, cluster: { padding: 12, title: { width: 20, height: 18 } } },
      { id: "A", width: 60, height: 40, parentId: "S1" },
      { id: "C", width: 60, height: 40, parentId: "S1" },
      { id: "B", width: 60, height: 40, parentId: "S2" },
    ],
    edges: [
      { id: "A-B", from: "A", to: "B" },
      { id: "B-C", from: "B", to: "C" },
    ],
  };

  it("the frame the cycle starts from above, its members side by side, the other frame's member below both", () => {
    const boxes = boxesOf(input);
    expect(boxes.S1.y + boxes.S1.height).toBeLessThanOrEqual(boxes.S2.y);
    expect(centre(boxes.A).y).toBeCloseTo(centre(boxes.C).y, 0);
    expect(centre(boxes.B).y).toBeGreaterThan(centre(boxes.C).y);
  });

  it("and still draws the edge from its source to its target", () => {
    const result = layoutDirectedGraph(input);
    const box = Object.fromEntries(result.nodes.map((b) => [b.id, b]));
    const route = result.edges.find((edge) => edge.id === "B-C")!;
    expect(isOrthogonal(route.points), JSON.stringify(route.points)).toBe(true);
    expect(onOutline(route.points[0], box.B)).toBe(true);
    expect(onOutline(route.points.at(-1)!, box.C)).toBe(true);
  });
});

describe("layoutDirectedGraph fits a frame to what it holds", () => {
  // `subgraph G { A, B }` with `A --> Y`, `B --> Z`, `A --> Z`, `B --> Y`:
  // the edges leaving G cross on their way out. ELK routes that crossing
  // inside G's frame and grows the frame to hold it. Mermaid 12.2.0 pulls
  // the frame back in to just below A and B, the crossing drawn outside it;
  // Siren does the same with the cluster's own padding, not Mermaid's 24px
  // (nook decision 01M4VDB3XG71N3R1EN5J94JMZ4), so its frame is not
  // Mermaid's height.
  const input: DirectedGraphInput = {
    direction: "TB",
    nodes: [
      { id: "G", width: 0, height: 0, cluster: { padding: 12, title: { width: 20, height: 18 } } },
      { id: "A", width: 60, height: 40, parentId: "G" },
      { id: "B", width: 60, height: 40, parentId: "G" },
      { id: "Y", width: 60, height: 40 },
      { id: "Z", width: 60, height: 40 },
    ],
    edges: [
      { id: "A-Y", from: "A", to: "Y" },
      { id: "B-Z", from: "B", to: "Z" },
      { id: "A-Z", from: "A", to: "Z" },
      { id: "B-Y", from: "B", to: "Y" },
    ],
  };

  it("its bottom one padding below its lowest member, however edges leaving it are routed", () => {
    const boxes = boxesOf(input);
    const lowest = Math.max(boxes.A.y + boxes.A.height, boxes.B.y + boxes.B.height);
    expect(boxes.G.y + boxes.G.height).toBeCloseTo(lowest + 12, 1);
  });
});

describe("layoutDirectedGraph keeps a fitted frame around what it holds", () => {
  // `subgraph O { subgraph I { A, B }, C }`, with edges out of I and O that
  // cross on their way to Y and Z. ELK routes the crossings inside the
  // frames, so fitting pulls them in: under TB, O's and I's bottoms; under
  // LR, I's right and bottom and O's right.
  const title = { width: 20, height: 18 };
  const padding = 12;
  const nested = (direction: Direction): DirectedGraphInput => ({
    direction,
    nodes: [
      { id: "O", width: 0, height: 0, cluster: { padding, title } },
      { id: "I", width: 0, height: 0, parentId: "O", cluster: { padding, title } },
      { id: "A", width: 60, height: 40, parentId: "I" },
      { id: "B", width: 60, height: 40, parentId: "I" },
      { id: "C", width: 60, height: 40, parentId: "O" },
      { id: "W", width: 60, height: 40 },
      { id: "Y", width: 60, height: 40 },
      { id: "Z", width: 60, height: 40 },
    ],
    edges: [
      { id: "W-C", from: "W", to: "C" },
      { id: "A-Y", from: "A", to: "Y" },
      { id: "B-Z", from: "B", to: "Z" },
      { id: "A-Z", from: "A", to: "Z" },
      { id: "B-Y", from: "B", to: "Y" },
      { id: "C-Y", from: "C", to: "Y" },
      { id: "W-Z", from: "W", to: "Z" },
      { id: "Y-W", from: "Y", to: "W" },
    ],
  });

  it.each(["TB", "LR"] as const)(
    "under %s every member and nested frame lies one padding inside each side, the title band above them",
    (direction) => {
      const input = nested(direction);
      const boxes = boxesOf(input);
      const tolerance = 1e-6;
      for (const member of input.nodes.filter((node) => node.parentId !== undefined)) {
        const frame = boxes[member.parentId!];
        const box = boxes[member.id];
        const at = `${member.id} in ${member.parentId}: ${JSON.stringify({ frame, box })}`;
        expect(box.x - frame.x, at).toBeGreaterThanOrEqual(padding - tolerance);
        expect(frame.x + frame.width - (box.x + box.width), at).toBeGreaterThanOrEqual(padding - tolerance);
        expect(frame.y + frame.height - (box.y + box.height), at).toBeGreaterThanOrEqual(padding - tolerance);
        expect(box.y - frame.y, at).toBeGreaterThanOrEqual(padding + title.height + padding - tolerance);
      }
    },
  );
});

/**
 * The jogs at either end of `points`: a first (or last) run of at most 30px,
 * then a sidestep of at most 16px, then on in the same direction — the
 * kink Mermaid 12.2.0's `straightenEdgeTerminals` takes out.
 */
function terminalJogs(points: readonly Point[]): number {
  const jogAt = (p: readonly Point[]) => {
    if (p.length < 5) return false;
    const [p0, p1, p2, p3] = p;
    const vertical = Math.abs(p0.x - p1.x) <= 0.01 && Math.abs(p2.x - p3.x) <= 0.01;
    const horizontal = Math.abs(p0.y - p1.y) <= 0.01 && Math.abs(p2.y - p3.y) <= 0.01;
    if (!vertical && !horizontal) return false;
    const run = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const side = vertical ? Math.abs(p2.x - p1.x) : Math.abs(p2.y - p1.y);
    const onward = vertical
      ? Math.sign(p1.y - p0.y) === Math.sign(p3.y - p2.y)
      : Math.sign(p1.x - p0.x) === Math.sign(p3.x - p2.x);
    return run <= 30 && side > 0.01 && side <= 16 && onward;
  };
  return Number(jogAt(points)) + Number(jogAt([...points].reverse()));
}

describe("layoutDirectedGraph straightens a route's ends", () => {
  // A small graph where ELK enters E, inside a frame, with a 3px sidestep
  // 30px short of it — the frame's port and E's are not in line.
  const input: DirectedGraphInput = {
    direction: "TB",
    nodes: [
      { id: "F", width: 0, height: 0, cluster: { padding: 12, title: { width: 20, height: 18 } } },
      { id: "A", width: 56, height: 40 },
      { id: "B", width: 40, height: 40 },
      { id: "C", width: 40, height: 40 },
      { id: "D", width: 40, height: 40 },
      { id: "E", width: 40, height: 40, parentId: "F" },
    ],
    edges: [
      { id: "A-E", from: "A", to: "E" },
      { id: "B-C", from: "B", to: "C" },
      { id: "C-E", from: "C", to: "E" },
    ],
  };

  it("no route arrives or leaves with a short sidestep, and each still runs from its source's outline to its target's", () => {
    const result = layoutDirectedGraph(input);
    const box = Object.fromEntries(result.nodes.map((b) => [b.id, b]));
    for (const route of result.edges) {
      const [from, to] = route.id.split("-");
      expect(terminalJogs(route.points), `${route.id} ${JSON.stringify(route.points)}`).toBe(0);
      expect(isOrthogonal(route.points)).toBe(true);
      expect(onOutline(route.points[0], box[from])).toBe(true);
      expect(onOutline(route.points.at(-1)!, box[to])).toBe(true);
    }
  });
});

describe("layoutDirectedGraph leaves no leftover of a straightened sidestep", () => {
  // Five boxes under LR where ELK routes N1 --> N3 with a short sidestep at
  // its end that lines up with the rest of the route: straightening it
  // moves the run onto the line the route already runs along.
  const input: DirectedGraphInput = {
    direction: "LR",
    nodes: [
      { id: "N0", width: 59, height: 40 },
      { id: "N1", width: 78, height: 40 },
      { id: "N2", width: 36, height: 40 },
      { id: "N3", width: 100, height: 40 },
      { id: "N4", width: 32, height: 40 },
    ],
    edges: [
      { id: "N1-N4", from: "N1", to: "N4" },
      { id: "N4-N1", from: "N4", to: "N1" },
      { id: "N1-N3", from: "N1", to: "N3" },
      { id: "N3-N2", from: "N3", to: "N2" },
      { id: "N3-N2'", from: "N3", to: "N2" },
      { id: "N4-N3", from: "N4", to: "N3" },
    ],
  };

  it("no route has a zero-length segment, or three points in a row on one line", () => {
    const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    for (const route of layoutDirectedGraph(input).edges) {
      const at = `${route.id} ${JSON.stringify(route.points)}`;
      route.points.forEach((point, index) => {
        if (index < 1) return;
        const before = route.points[index - 1];
        expect(same(before.x, point.x) && same(before.y, point.y), `zero-length segment: ${at}`).toBe(false);
        if (index < 2) return;
        const first = route.points[index - 2];
        const inLine =
          (same(first.x, before.x) && same(before.x, point.x)) || (same(first.y, before.y) && same(before.y, point.y));
        expect(inLine, `three points in a row: ${at}`).toBe(false);
      });
    }
  });
});

describe("layoutDirectedGraph straightens a route's end only where that crosses no box", () => {
  // `subgraph F { U, L }`, `U --> L`, `U --> I`, `L --> I`: ELK takes U --> I
  // out of U 14px to the left of where it runs down past L. Mermaid's
  // straightening would move that run back into line with U's port —
  // through L. Siren leaves the sidestep in.
  const input: DirectedGraphInput = {
    direction: "TB",
    nodes: [
      { id: "F", width: 0, height: 0, cluster: { padding: 12, title: { width: 20, height: 18 } } },
      { id: "U", width: 48, height: 40, parentId: "F" },
      { id: "L", width: 48, height: 40, parentId: "F" },
      { id: "I", width: 104, height: 40 },
    ],
    edges: [
      { id: "U-L", from: "U", to: "L" },
      { id: "U-I", from: "U", to: "I" },
      { id: "L-I", from: "L", to: "I" },
    ],
  };

  it("no route runs through a box that is not one of its ends", () => {
    const result = layoutDirectedGraph(input);
    for (const route of result.edges) {
      const ends = route.id.split("-");
      for (const box of result.nodes.filter((b) => b.id !== "F" && !ends.includes(b.id))) {
        const through = route.points.some(
          (p, i) =>
            i > 0 &&
            Math.min(p.x, route.points[i - 1].x) < box.x + box.width &&
            Math.max(p.x, route.points[i - 1].x) > box.x &&
            Math.min(p.y, route.points[i - 1].y) < box.y + box.height &&
            Math.max(p.y, route.points[i - 1].y) > box.y,
        );
        expect(through, `${route.id} through ${box.id}: ${JSON.stringify(route.points)}`).toBe(false);
      }
    }
  });
});

describe("layoutDirectedGraph places a cluster's title clear of the routes crossing its band", () => {
  const titled = (id: string, title: { width: number; height: number }) => ({
    id,
    width: 0,
    height: 0,
    cluster: { padding: 12, title },
  });
  const member = (id: string, parentId?: string) => ({ id, width: 60, height: 40, ...(parentId === undefined ? {} : { parentId }) });

  /** The title's box about the centre the core reports. */
  function titleBox(result: ReturnType<typeof layoutDirectedGraph>, id: string, size: { width: number; height: number }) {
    const frame = result.nodes.find((box) => box.id === id)!;
    return {
      frame,
      left: frame.title!.x - size.width / 2,
      right: frame.title!.x + size.width / 2,
      top: frame.title!.y - size.height / 2,
      bottom: frame.title!.y + size.height / 2,
    };
  }

  // Under TB the edge into C enters through the band; under BT the band is
  // still across the frame's top, so it is the edge out of C that crosses
  // it. Under LR and RL an edge meets a cluster at its sides, level with the
  // member it leads to, never through the band: no graph tried there (single
  // and nested clusters, own directions, edges to clusters, self-loops) drew
  // a route through a centred title, so those two are pinned below as
  // "stays centred" only.
  it.each([
    ["TB", { id: "X-C", from: "X", to: "C" }],
    ["BT", { id: "C-X", from: "C", to: "X" }],
  ] as const)("under %s, beside the route, in the band, when the frame has room for it there", (direction, crossing) => {
    // ELK puts C under the left of the centred title and runs the edge
    // between C and X straight through it; the frame is wide enough (A and
    // B beside C) for the title to sit right of the route.
    const size = { width: 120, height: 24 };
    const input: DirectedGraphInput = {
      direction,
      nodes: [member("X"), titled("S", size), member("A", "S"), member("B", "S"), member("C", "S")],
      edges: [{ ...crossing }, { id: "A-B", from: "A", to: "B" }],
    };
    const result = layoutDirectedGraph(input);
    const title = titleBox(result, "S", size);
    const frame = title.frame;
    // Moved: centred, the route would run through it.
    expect(frame.title!.x).not.toBeCloseTo(frame.x + frame.width / 2, 0);
    for (const route of result.edges) {
      expect(
        routeReachesInto(route.points, title, 1),
        `${route.id} through the title: ${JSON.stringify(route.points)} / ${JSON.stringify(title)}`,
      ).toBe(false);
    }
    // Still in the band, half a padding inside the frame's sides, at the band's height.
    expect(title.left).toBeGreaterThanOrEqual(frame.x + 6 - EPSILON);
    expect(title.right).toBeLessThanOrEqual(frame.x + frame.width - 6 + EPSILON);
    expect(frame.title!.y).toBeCloseTo(frame.y + 12 + 12, 5);
  });

  // The edge between C and X leaves or enters the cluster away from its band.
  it.each([
    ["TB", { id: "C-X", from: "C", to: "X" }],
    ["BT", { id: "X-C", from: "X", to: "C" }],
    ["LR", { id: "X-C", from: "X", to: "C" }],
    ["RL", { id: "X-C", from: "X", to: "C" }],
  ] as const)("under %s, centred across the frame when no route crosses its band", (direction, edge) => {
    const size = { width: 120, height: 24 };
    const result = layoutDirectedGraph({
      direction,
      nodes: [member("X"), titled("S", size), member("A", "S"), member("B", "S"), member("C", "S")],
      edges: [{ ...edge }, { id: "A-B", from: "A", to: "B" }],
    });
    const title = titleBox(result, "S", size);
    for (const route of result.edges) {
      expect(routeReachesInto(route.points, title, 1), `${route.id} through the title: ${JSON.stringify(route.points)}`).toBe(false);
    }
    expect(title.frame.title!.x).toBeCloseTo(title.frame.x + title.frame.width / 2, 5);
  });

  it("centred across the frame when no place in the band clears the route", () => {
    // The frame is no wider than the title and its padding: nowhere to go.
    const size = { width: 200, height: 24 };
    const result = layoutDirectedGraph({
      direction: "TB",
      nodes: [titled("S", size), member("X"), member("A", "S")],
      edges: [{ id: "X-A", from: "X", to: "A" }],
    });
    const frame = result.nodes.find((box) => box.id === "S")!;
    expect(frame.title!.x).toBeCloseTo(frame.x + frame.width / 2, 5);
  });
});

describe("layoutDirectedGraph centres a box narrower than the ports' clearance on its route", () => {
  it("moves a small box across the flow until the first route at it meets its middle", () => {
    // ELK keeps a port 12px off each end of a side (`portsSurrounding`), so
    // on a 14px disc the route leaves 3px off its centre. Mermaid 12.2.0's
    // `alignDegenerateNodeToAnchor` (`elk-V4PLJRSU.mjs`, line 100618) moves
    // such a box onto the route: measured in headless Chrome, `[*] --> Idle`
    // draws the start disc and Idle on one vertical line (both at x 104).
    for (const direction of ["TB", "LR"] as const) {
      const laid = layoutDirectedGraph({
        direction,
        nodes: [
          { id: "start", width: 14, height: 14 },
          { id: "Idle", width: 61, height: 48 },
          { id: "Busy", width: 90, height: 48 },
          { id: "end", width: 14, height: 14 },
        ],
        edges: [
          { id: "start-Idle", from: "start", to: "Idle" },
          { id: "Idle-Busy", from: "Idle", to: "Busy" },
          { id: "Busy-end", from: "Busy", to: "end" },
        ],
      });
      const box = (id: string) => laid.nodes.find((node) => node.id === id)!;
      const across = (point: Point) => (direction === "TB" ? point.x : point.y);
      const [leaving, arriving] = [laid.edges[0].points[0], laid.edges[2].points.at(-1)!];
      expect(across(centre(box("start"))), direction).toBeCloseTo(across(leaving), 6);
      expect(across(centre(box("end"))), direction).toBeCloseTo(across(arriving), 6);
      // A box as wide as the clearance is left where ELK put it.
      expect(across(centre(box("Idle"))), direction).toBeCloseTo(across(laid.edges[0].points.at(-1)!), 6);
    }
  });

  it("keeps every other route at a moved box ending on its outline, and orthogonal", () => {
    // Only the first route at a small box is the one it moves onto; ELK put
    // the others' ports to the side, and on a box this narrow some of them
    // past its corner (an 8px box with three routes in: ports 3px apart).
    // Measured in headless Chrome, Mermaid 12.2.0 keeps them on the moved
    // box: with `[*] --> A` and `[*] --> B` the second line leaves the start
    // disc 2px left of its centre and still touches it, its first run
    // stretched along its own axis to meet the outline.
    const onOutline = (point: Point, box: DirectedGraphNodeBox) => {
      const [left, right, top, bottom] = [box.x, box.x + box.width, box.y, box.y + box.height];
      const inside =
        point.x >= left - 0.5 && point.x <= right + 0.5 && point.y >= top - 0.5 && point.y <= bottom + 0.5;
      const toSide = Math.min(
        Math.abs(point.x - left),
        Math.abs(point.x - right),
        Math.abs(point.y - top),
        Math.abs(point.y - bottom),
      );
      return inside && toSide <= 0.5;
    };
    const orthogonal = (points: readonly Point[]) =>
      points.every(
        (point, index) =>
          index === 0 ||
          Math.abs(point.x - points[index - 1].x) < 1e-6 ||
          Math.abs(point.y - points[index - 1].y) < 1e-6,
      );
    for (const direction of ["TB", "LR", "BT", "RL"] as const) {
      const laid = layoutDirectedGraph({
        direction,
        nodes: [
          { id: "start", width: 8, height: 8 },
          { id: "A", width: 61, height: 48 },
          { id: "B", width: 90, height: 48 },
          { id: "C", width: 70, height: 48 },
          { id: "end", width: 8, height: 8 },
        ],
        edges: [
          { id: "start-A", from: "start", to: "A" },
          { id: "start-B", from: "start", to: "B" },
          { id: "start-C", from: "start", to: "C" },
          { id: "A-end", from: "A", to: "end" },
          { id: "B-end", from: "B", to: "end" },
          { id: "C-end", from: "C", to: "end" },
        ],
      });
      const box = (id: string) => laid.nodes.find((node) => node.id === id)!;
      laid.edges.forEach((route, index) => {
        const label = `${direction} ${route.id}`;
        expect(orthogonal(route.points), label).toBe(true);
        if (index < 3) expect(onOutline(route.points[0], box("start")), label).toBe(true);
        else expect(onOutline(route.points.at(-1)!, box("end")), label).toBe(true);
      });
    }
  });
});

describe("layoutDirectedGraph's terminal labels", () => {
  /** The rectangle a label of `size` covers centred on `centre`. */
  const boxAround = (centre: Point, size: { width: number; height: number }) => ({
    x: centre.x - size.width / 2,
    y: centre.y - size.height / 2,
    width: size.width,
    height: size.height,
  });
  const overlaps = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  /** Which side of the segment `from`→`to`'s line `p` lies on, as Mermaid's `putTerminalLabelsOnTheirSide` reads it: positive is the right hand of travel (y grows downward). */
  const hand = (p: Point, from: Point, to: Point) =>
    Math.sign(-(to.y - from.y) * (p.x - from.x) + (to.x - from.x) * (p.y - from.y));

  const LABEL = { width: 24, height: 16 };

  it.each(["TB", "BT", "LR", "RL"] as const)(
    "under %s, puts each beside its own end, on its own hand of the line, clear of the boxes and the route",
    (direction) => {
      const result = layoutDirectedGraph({
        direction,
        nodes: [
          { id: "A", width: 80, height: 40 },
          { id: "B", width: 80, height: 40 },
        ],
        edges: [
          {
            id: "A-B",
            from: "A",
            to: "B",
            terminalLabels: { startRight: { ...LABEL }, endLeft: { ...LABEL } },
          },
        ],
      });
      const [route] = result.edges;
      const points = route.points;
      const first = points[0];
      const last = points[points.length - 1];
      expect(route.terminalLabelCenters).toEqual({ startRight: expect.any(Object), endLeft: expect.any(Object) });
      const start = route.terminalLabelCenters!.startRight!;
      const end = route.terminalLabelCenters!.endLeft!;

      expect(Math.hypot(start.x - first.x, start.y - first.y)).toBeLessThan(
        Math.hypot(start.x - last.x, start.y - last.y),
      );
      expect(Math.hypot(end.x - last.x, end.y - last.y)).toBeLessThan(Math.hypot(end.x - first.x, end.y - first.y));
      // Right of the first segment's travel, left of the last's.
      expect(hand(start, points[0], points[1])).toBe(1);
      expect(hand(end, points[points.length - 2], last)).toBe(-1);
      for (const centre of [start, end]) {
        for (const box of result.nodes) expect(overlaps(boxAround(centre, LABEL), box)).toBe(false);
        expect(distanceToPolyline(centre, points)).toBeGreaterThanOrEqual(LABEL.height / 2 - 1e-6);
      }
    },
  );

  it("slides a label ELK put across a frame along its line, clear of the frame, and keeps it on its own hand", () => {
    // A leaves its cluster through the frame's bottom: ELK puts A's start
    // label just under A, across the frame's bottom side.
    const SIZE = { width: 30, height: 24 };
    const result = layoutDirectedGraph({
      direction: "TB",
      nodes: [
        { id: "G", width: 0, height: 0, cluster: { padding: 12, title: { width: 40, height: 24 } } },
        { id: "A", width: 80, height: 40, parentId: "G" },
        { id: "B", width: 80, height: 40 },
      ],
      edges: [{ id: "A-B", from: "A", to: "B", terminalLabels: { startRight: { ...SIZE, margin: 6 } } }],
    });
    const frame = result.nodes.find((box) => box.id === "G")!;
    const [route] = result.edges;
    const label = boxAround(route.terminalLabelCenters!.startRight!, SIZE);
    // Clear of every side of the frame by Mermaid's 2px: wholly inside or wholly outside.
    const inside =
      label.x >= frame.x + 2 &&
      label.y >= frame.y + 2 &&
      label.x + label.width <= frame.x + frame.width - 2 &&
      label.y + label.height <= frame.y + frame.height - 2;
    const outside =
      label.x + label.width <= frame.x - 2 ||
      label.x >= frame.x + frame.width + 2 ||
      label.y + label.height <= frame.y - 2 ||
      label.y >= frame.y + frame.height + 2;
    expect({ inside, outside }).not.toEqual({ inside: false, outside: false });
    expect(hand(route.terminalLabelCenters!.startRight!, route.points[0], route.points[1])).toBe(1);
  });

  it("keeps each label at its own end of an edge handed to ELK turned round", () => {
    // `S1 { A, C }`, `S2 { B }`, `A --> B`, `B --> C`: a cycle among the
    // frames, so one of the two edges between them goes to ELK turned round
    // (`subgraphFeedbackEdges`); its labels still belong to its own ends.
    const SIZE = { width: 24, height: 16 };
    const terminalLabels = { startRight: { ...SIZE }, endLeft: { ...SIZE } };
    const result = layoutDirectedGraph({
      direction: "TB",
      nodes: [
        { id: "S1", width: 0, height: 0, cluster: { padding: 12 } },
        { id: "S2", width: 0, height: 0, cluster: { padding: 12 } },
        { id: "A", width: 60, height: 40, parentId: "S1" },
        { id: "C", width: 60, height: 40, parentId: "S1" },
        { id: "B", width: 60, height: 40, parentId: "S2" },
      ],
      edges: [
        { id: "A-B", from: "A", to: "B", terminalLabels },
        { id: "B-C", from: "B", to: "C", terminalLabels },
      ],
    });
    const misplaced = result.edges.flatMap((route) => {
      const first = route.points[0];
      const last = route.points[route.points.length - 1];
      const near = (p: Point, end: Point, other: Point) =>
        Math.hypot(p.x - end.x, p.y - end.y) < Math.hypot(p.x - other.x, p.y - other.y);
      const { startRight, endLeft } = route.terminalLabelCenters ?? {};
      return [
        ...(startRight !== undefined && near(startRight, first, last) ? [] : [`${route.id} start`]),
        ...(endLeft !== undefined && near(endLeft, last, first) ? [] : [`${route.id} end`]),
      ];
    });
    expect(misplaced).toEqual([]);
  });

  it("keeps a cluster's title off the terminal labels in its band, where the band has room", () => {
    // Two members side by side under LR, joined with a label at each end:
    // ELK puts both labels above the line, up in the band, and the centred
    // title runs across them. The band has room beside them.
    const TITLE = { width: 120, height: 24 };
    const terminalLabels = { startRight: { width: 20, height: 27, margin: 6 }, endLeft: { width: 30, height: 27, margin: 6 } };
    const result = layoutDirectedGraph({
      direction: "LR",
      nodes: [
        { id: "G", width: 0, height: 0, cluster: { padding: 12, title: TITLE } },
        { id: "N0", width: 60, height: 40, parentId: "G" },
        { id: "N1", width: 140, height: 40, parentId: "G" },
      ],
      edges: [{ id: "N0-N1", from: "N0", to: "N1", terminalLabels }],
    });
    const frame = result.nodes.find((box) => box.id === "G")!;
    const title = boxAround(frame.title!, TITLE);
    const [route] = result.edges;
    const struck = Object.entries(route.terminalLabelCenters ?? {}).filter(([key, centre]) =>
      overlaps(boxAround(centre, terminalLabels[key as keyof typeof terminalLabels]), title),
    );
    expect(struck.map(([key]) => key)).toEqual([]);
    // Still in the band, inside the frame.
    expect(title.y).toBe(frame.y + 12);
    expect(title.x).toBeGreaterThanOrEqual(frame.x);
    expect(title.x + title.width).toBeLessThanOrEqual(frame.x + frame.width);
  });

  it.each([
    ["TB", "startRight"],
    ["BT", "startLeft"],
    ["LR", "startLeft"],
    ["RL", "startRight"],
  ] as const)(
    "under %s, reports an extent holding a %s label moved onto its own hand, past where ELK kept room, with the margin around it",
    (direction, key) => {
      // A label taller and wider than the boxes it joins: ELK keeps room for
      // it on the hand it chose, and the label's own hand is the other one —
      // past the top or left edge of what ELK laid out.
      const SIZE = { width: 50, height: 60 };
      const result = layoutDirectedGraph({
        direction,
        nodes: [
          { id: "A", width: 30, height: 20 },
          { id: "B", width: 30, height: 20 },
        ],
        edges: [{ id: "A-B", from: "A", to: "B", terminalLabels: { [key]: { ...SIZE } } }],
      });
      const [route] = result.edges;
      const label = boxAround(route.terminalLabelCenters![key]!, SIZE);
      const points = route.points;
      const [from, to] = key.startsWith("start") ? [points[0], points[1]] : [points[points.length - 2], points[points.length - 1]];
      expect(hand(route.terminalLabelCenters![key]!, from, to)).toBe(key.endsWith("Right") ? 1 : -1);
      const inside = (box: { x: number; y: number; width: number; height: number }, room: number) =>
        box.x >= room && box.y >= room && box.x + box.width <= result.width - room && box.y + box.height <= result.height - room;
      expect(inside(label, LAYOUT_MARGIN), JSON.stringify({ label, width: result.width, height: result.height })).toBe(true);
      for (const box of result.nodes) expect(inside(box, LAYOUT_MARGIN)).toBe(true);
      for (const point of points) expect(inside({ ...point, width: 0, height: 0 }, LAYOUT_MARGIN)).toBe(true);
    },
  );
});

describe("layoutDirectedGraph routes an edge between clusters nested inside a cluster that keeps its direction", () => {
  /**
   * A TB diagram: `A` declares LR and holds `B`, which holds `F` and the
   * cluster `C`, which holds `G`; the one edge runs `F --> G`. Measured in
   * headless Chrome against Mermaid 12.2.0: `F` and `C` (holding `G`) sit
   * side by side, `G` to the right of `F`, and the edge runs straight from
   * one to the other — `A` keeps its direction, since the edge's ends share
   * no parent but their common ancestor is `B`, below it.
   */
  const nested = (): DirectedGraphInput => ({
    direction: "TB",
    nodes: [
      { id: "A", width: 0, height: 0, cluster: { padding: 8, title: { width: 10, height: 20 }, direction: "LR" } },
      { id: "B", width: 0, height: 0, parentId: "A", cluster: { padding: 8, title: { width: 10, height: 20 } } },
      { id: "F", width: 60, height: 40, parentId: "B" },
      { id: "C", width: 0, height: 0, parentId: "B", cluster: { padding: 8, title: { width: 10, height: 20 } } },
      { id: "G", width: 60, height: 40, parentId: "C" },
    ],
    edges: [{ id: "F-G", from: "F", to: "G" }],
  });

  it("lays it out in the kept direction and routes the edge from one box to the other", () => {
    const result = layoutDirectedGraph(nested());
    const boxes = Object.fromEntries(result.nodes.map((box) => [box.id, box]));
    expect(centre(boxes.G!).x).toBeGreaterThan(centre(boxes.F!).x);
    const route = result.edges.find((edge) => edge.id === "F-G")!.points;
    expect(route.length).toBeGreaterThanOrEqual(2);
    expect(onOutline(route[0]!, boxes.F!)).toBe(true);
    expect(onOutline(route[route.length - 1]!, boxes.G!)).toBe(true);
  });
});

describe("layoutDirectedGraph over nested clusters, directions and edges across levels", () => {
  /** A small deterministic generator (mulberry32), so a failing case can be named by its seed. */
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const DIRECTIONS = ["TB", "BT", "LR", "RL"] as const;

  /**
   * Up to six clusters nested to any depth (each inside the diagram or an
   * earlier cluster), each with or without a direction of its own, one or
   * two boxes in each and a box or two outside them all, and up to five
   * edges between any two of those boxes and clusters.
   */
  const caseFor = (seed: number): DirectedGraphInput => {
    const next = random(seed);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
    const nodes: DirectedGraphInput["nodes"][number][] = [];
    const clusters: string[] = [];
    const clusterCount = 1 + Math.floor(next() * 6);
    for (let i = 0; i < clusterCount; i++) {
      const id = `K${i}`;
      const parentId = i === 0 || next() < 0.2 ? undefined : pick(clusters);
      const direction = next() < 0.5 ? pick(DIRECTIONS) : undefined;
      nodes.push({
        id,
        width: 0,
        height: 0,
        ...(parentId === undefined ? {} : { parentId }),
        cluster: { padding: 8, title: { width: 10, height: 20 }, ...(direction === undefined ? {} : { direction }) },
      });
      clusters.push(id);
    }
    let boxCount = 0;
    const box = (parentId?: string) =>
      nodes.push({ id: `N${boxCount++}`, width: 40, height: 30, ...(parentId === undefined ? {} : { parentId }) });
    for (const cluster of clusters) {
      box(cluster);
      if (next() < 0.4) box(cluster);
    }
    box();
    if (next() < 0.5) box();
    const ids = nodes.map((node) => node.id);
    const edgeCount = 1 + Math.floor(next() * 5);
    const edges: DirectedGraphInput["edges"][number][] = [];
    for (let i = 0; i < edgeCount; i++) {
      const from = pick(ids);
      const to = pick(ids.filter((id) => id !== from));
      edges.push({ id: `e${i}`, from, to });
    }
    return { direction: pick(DIRECTIONS), nodes, edges };
  };

  it("lays every case out, routing every edge, or refuses it as the engine's error — never another throw", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const input = caseFor(seed);
      try {
        const result = layoutDirectedGraph(input);
        for (const edge of result.edges) {
          if (edge.points.length < 2) failures.push(`seed ${seed}: edge ${edge.id} has ${edge.points.length} points`);
        }
      } catch (error) {
        // The engine's own refusal is the documented way out — `render`
        // reports it as an error diagnostic — and it is what Mermaid 12.2.0
        // does too with an edge from a cluster to its own member inside a
        // cluster that keeps a direction (measured, Chrome: the same ELK
        // "could not be found" error). Anything else thrown is a defect.
        if (error instanceof LayoutEngineError) continue;
        failures.push(`seed ${seed}: ${String(error)} ${JSON.stringify(input)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
