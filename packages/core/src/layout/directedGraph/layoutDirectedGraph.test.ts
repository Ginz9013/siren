import { describe, expect, it } from "vitest";
import { distanceToPolyline } from "../../compat/svgGeometry";
import type { Direction, Point } from "../../contracts";
import {
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

  it("with the title's centre in the band, centred across the frame", () => {
    const result = layoutDirectedGraph(grouped);
    const g = result.nodes.find((box) => box.id === "G")!;
    const a = result.nodes.find((box) => box.id === "A")!;
    expect(g.title).toBeDefined();
    expect(g.title!.x).toBeCloseTo(g.x + g.width / 2, 0);
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
  // Drawing a small arc where one edge crosses another is not implemented
  // yet (nook decision 01M4VANRC6B2C14NHVC2KRZ9Y8, rule 7); until it is,
  // every route carries the field, empty, so the renderer's contract does
  // not change shape when it fills.
  it("are an empty list on every route, even where two routes cross", () => {
    const result = layoutDirectedGraph({
      direction: "TB",
      nodes: ["A", "B", "C", "D"].map((id) => ({ id, width: 60, height: 40 })),
      edges: [
        { id: "A-D", from: "A", to: "D" },
        { id: "B-C", from: "B", to: "C" },
        { id: "A-C", from: "A", to: "C" },
        { id: "B-D", from: "B", to: "D" },
      ],
    });
    expect(result.edges.map((route) => route.hops)).toEqual([[], [], [], []]);
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
