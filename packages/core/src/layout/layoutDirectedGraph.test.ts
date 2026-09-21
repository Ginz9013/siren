import { describe, expect, it } from "vitest";
import type { Direction, Point } from "../contracts";
import {
  layoutDirectedGraph,
  UnplacedNodesError,
  type DirectedGraphLayoutInput,
  type DirectedGraphLayoutNodeBox,
} from "./layoutDirectedGraph";

/** The same three-node chain, laid out in whichever rank direction is asked for. */
function chain(rankdir: Direction): DirectedGraphLayoutInput {
  return {
    rankdir,
    nodes: [
      { id: "A", width: 40, height: 20 },
      { id: "B", width: 40, height: 20 },
      { id: "C", width: 40, height: 20 },
    ],
    edges: [
      { id: "A-B", from: "A", to: "B" },
      { id: "B-C", from: "B", to: "C" },
    ],
  };
}

function boxesOf(input: DirectedGraphLayoutInput) {
  return Object.fromEntries(
    layoutDirectedGraph(input).nodes.map((n) => [n.id, n]),
  );
}

describe("layoutDirectedGraph", () => {
  it("positions a two-node, one-edge graph as top-left boxes inside the reported graph bounds", () => {
    const result = layoutDirectedGraph({
      rankdir: "TB",
      nodes: [
        { id: "A", width: 100, height: 40 },
        { id: "B", width: 60, height: 20 },
      ],
      edges: [{ id: "A-B", from: "A", to: "B" }],
    });

    const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));

    // Sizes are passed through: the core positions boxes, it never resizes them.
    expect(byId.A.width).toBe(100);
    expect(byId.A.height).toBe(40);
    expect(byId.B.width).toBe(60);
    expect(byId.B.height).toBe(20);

    // TB ranks the edge's target below its source.
    expect(byId.B.y).toBeGreaterThan(byId.A.y);

    // x/y are the box's top-left, so every box lies within [0,width] x [0,height],
    // flush against the origin on both axes.
    const xs = result.nodes.map((n) => n.x);
    const ys = result.nodes.map((n) => n.y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...result.nodes.map((n) => n.x + n.width))).toBe(
      result.width,
    );
    expect(Math.max(...result.nodes.map((n) => n.y + n.height))).toBe(
      result.height,
    );

    // The edge is routed as a path from the source's boundary to the target's.
    expect(result.edges).toHaveLength(1);
    const edge = result.edges[0];
    expect(edge.id).toBe("A-B");
    expect(edge.points.length).toBeGreaterThanOrEqual(2);
    expect(edge.points[0].y).toBeGreaterThanOrEqual(byId.A.y + byId.A.height);
    expect(edge.points[edge.points.length - 1].y).toBeLessThanOrEqual(byId.B.y);
  });

  it("ranks successors downward for TB and upward for BT", () => {
    const tb = boxesOf(chain("TB"));
    expect(tb.B.y).toBeGreaterThan(tb.A.y);
    expect(tb.C.y).toBeGreaterThan(tb.B.y);

    const bt = boxesOf(chain("BT"));
    expect(bt.B.y).toBeLessThan(bt.A.y);
    expect(bt.C.y).toBeLessThan(bt.B.y);
  });

  it("ranks successors rightward for LR and leftward for RL", () => {
    const lr = boxesOf(chain("LR"));
    expect(lr.B.x).toBeGreaterThan(lr.A.x);
    expect(lr.C.x).toBeGreaterThan(lr.B.x);

    const rl = boxesOf(chain("RL"));
    expect(rl.B.x).toBeLessThan(rl.A.x);
    expect(rl.C.x).toBeLessThan(rl.B.x);
  });

  it("lays the ranks out along the vertical axis for TB/BT and the horizontal axis for LR/RL", () => {
    const tb = boxesOf(chain("TB"));
    expect(tb.A.x).toBe(tb.C.x);
    const bt = boxesOf(chain("BT"));
    expect(bt.A.x).toBe(bt.C.x);

    const lr = boxesOf(chain("LR"));
    expect(lr.A.y).toBe(lr.C.y);
    const rl = boxesOf(chain("RL"));
    expect(rl.A.y).toBe(rl.C.y);
  });

  it("holds an edge's endpoints `minlen` ranks apart, and leaves an edge that asks for none where it was", () => {
    // The shared core is read by two diagram kinds and only one of them has
    // a notion of edge length, so the absent case is as much of a contract
    // as the given one: a class diagram passes no `minlen` and must lay out
    // exactly as it did before flowchart edges gained a length.
    const nodes = [
      { id: "A", width: 40, height: 20 },
      { id: "B", width: 40, height: 20 },
    ];
    const rankGap = (edge: { id: string; from: string; to: string; minlen?: number }) => {
      const result = layoutDirectedGraph({ rankdir: "TB", nodes, edges: [edge] });
      const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
      return byId.B.y - (byId.A.y + byId.A.height);
    };

    const silent = rankGap({ id: "A-B", from: "A", to: "B" });

    expect(rankGap({ id: "A-B", from: "A", to: "B", minlen: 1 })).toBe(silent);
    expect(rankGap({ id: "A-B", from: "A", to: "B", minlen: 3 })).toBeGreaterThan(silent);
  });

  it("reserves room between the ranks for a labelled edge and returns the label's anchor", () => {
    const nodes = [
      { id: "A", width: 40, height: 20 },
      { id: "B", width: 40, height: 20 },
    ];
    const unlabelled = layoutDirectedGraph({
      rankdir: "TB",
      nodes,
      edges: [{ id: "A-B", from: "A", to: "B" }],
    });
    const labelled = layoutDirectedGraph({
      rankdir: "TB",
      nodes,
      edges: [
        { id: "A-B", from: "A", to: "B", label: { width: 90, height: 40 } },
      ],
    });

    function rankGap(result: typeof unlabelled): number {
      const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
      return byId.B.y - (byId.A.y + byId.A.height);
    }

    // The label takes up space: the ranks are pushed further apart than
    // they are for the same graph with no label.
    expect(rankGap(labelled)).toBeGreaterThan(rankGap(unlabelled));

    // An anchor is returned only for edges that asked for label space.
    expect(unlabelled.edges[0].labelAnchor).toBeUndefined();
    const anchor = labelled.edges[0].labelAnchor;
    expect(anchor).toBeDefined();

    // It sits in the gap the label reserved, between the two ranks.
    const byId = Object.fromEntries(labelled.nodes.map((n) => [n.id, n]));
    expect(anchor!.y).toBeGreaterThan(byId.A.y + byId.A.height);
    expect(anchor!.y).toBeLessThan(byId.B.y);
  });

  it("returns a bounding box for a cluster node that encloses every child assigned to it", () => {
    const result = layoutDirectedGraph({
      rankdir: "TB",
      nodes: [
        { id: "group", width: 0, height: 0, isCluster: true },
        { id: "A", width: 40, height: 20, parentId: "group" },
        { id: "B", width: 40, height: 20, parentId: "group" },
        { id: "C", width: 40, height: 20 },
      ],
      edges: [
        { id: "A-B", from: "A", to: "B" },
        { id: "B-C", from: "B", to: "C" },
      ],
    });

    const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
    const group = byId.group;
    expect(group).toBeDefined();

    function encloses(
      outer: typeof group,
      inner: typeof group,
    ): boolean {
      return (
        outer.x <= inner.x &&
        outer.y <= inner.y &&
        outer.x + outer.width >= inner.x + inner.width &&
        outer.y + outer.height >= inner.y + inner.height
      );
    }

    expect(encloses(group, byId.A)).toBe(true);
    expect(encloses(group, byId.B)).toBe(true);
    // A node with no parent is left outside the frame.
    expect(encloses(group, byId.C)).toBe(false);

    // The frame is part of the graph, so the reported bounds cover it too.
    expect(group.x).toBeGreaterThanOrEqual(0);
    expect(group.y).toBeGreaterThanOrEqual(0);
    expect(group.x + group.width).toBeLessThanOrEqual(result.width);
    expect(group.y + group.height).toBeLessThanOrEqual(result.height);
  });

  it("lays a cluster's own children out in a rankdir of its own, independent of the outer graph's", () => {
    const result = layoutDirectedGraph({
      rankdir: "TB",
      nodes: [
        { id: "group", width: 0, height: 0, isCluster: true, rankdir: "LR" },
        { id: "A", width: 40, height: 20, parentId: "group" },
        { id: "B", width: 40, height: 20, parentId: "group" },
      ],
      edges: [{ id: "A-B", from: "A", to: "B" }],
    });

    const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));

    // LR ranks B to the right of A, on the same row — the opposite of what
    // the outer TB graph would have done to an ungrouped pair.
    expect(byId.B.x).toBeGreaterThan(byId.A.x);
    expect(byId.B.y).toBe(byId.A.y);
  });

  it("routes an edge whose endpoints are clusters from one frame's boundary to the other's", () => {
    const result = layoutDirectedGraph({
      rankdir: "TB",
      nodes: [
        { id: "one", width: 0, height: 0, isCluster: true },
        { id: "two", width: 0, height: 0, isCluster: true },
        { id: "A", width: 40, height: 20, parentId: "one" },
        { id: "B", width: 40, height: 20, parentId: "two" },
      ],
      edges: [{ id: "one-two", from: "one", to: "two" }],
    });

    const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
    const route = result.edges[0];
    expect(route.id).toBe("one-two");

    const start = route.points[0];
    const end = route.points[route.points.length - 1];

    // TB, so the edge leaves `one` through its bottom edge and arrives at
    // `two` through its top edge — the two frames' own boundaries.
    expect(start.y).toBe(byId.one.y + byId.one.height);
    expect(end.y).toBe(byId.two.y);
    expect(start.x).toBeGreaterThanOrEqual(byId.one.x);
    expect(start.x).toBeLessThanOrEqual(byId.one.x + byId.one.width);
    expect(end.x).toBeGreaterThanOrEqual(byId.two.x);
    expect(end.x).toBeLessThanOrEqual(byId.two.x + byId.two.width);

    // And not on the member it was routed through: the whole point of the
    // proxy is that it is not what the picture shows.
    expect(start.y).toBeGreaterThan(byId.A.y + byId.A.height);
    expect(end.y).toBeLessThan(byId.B.y);
  });

  it("routes an edge to a cluster with no members as the ordinary box dagre lays it out as", () => {
    // A cluster is a cluster to dagre only because something named it as a
    // parent, so a childless one is an ordinary node and needs no proxy —
    // and the route dagre returns already ends on its box.
    const result = layoutDirectedGraph({
      rankdir: "TB",
      nodes: [
        { id: "empty", width: 60, height: 30, isCluster: true },
        { id: "A", width: 40, height: 20 },
      ],
      edges: [{ id: "A-empty", from: "A", to: "empty" }],
    });

    const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
    const end = result.edges[0].points[result.edges[0].points.length - 1];

    expect(byId.empty.width).toBe(60);
    expect(byId.empty.height).toBe(30);
    expect(end.y).toBeLessThanOrEqual(byId.empty.y);
    expect(end.y).toBeGreaterThan(byId.A.y);
  });

  it("draws a cluster's self-edge around the outside of the cluster's own box", () => {
    // `one --> one` is the one construct the clip has nothing to do for: a
    // self-loop never leaves its box, so there is no point outside to aim at
    // (`clipRouteEndToBox` says the same in its own words). It used to be
    // returned as dagre drew it — around the *member* standing in for the
    // frame, so the loop landed inside the frame beside `A`. It is
    // synthesised around the frame's own box instead, which is the figure
    // mermaid 11.17.2 draws (`L_one_one_0` alongside the `one` cluster,
    // measured) and the only one that reads as "this frame loops on itself".
    const result = layoutDirectedGraph({
      rankdir: "TB",
      nodes: [
        { id: "one", width: 0, height: 0, isCluster: true },
        { id: "A", width: 40, height: 20, parentId: "one" },
      ],
      edges: [{ id: "one-one", from: "one", to: "one" }],
    });

    const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
    const route = result.edges[0];

    expect(route.id).toBe("one-one");
    expect(route.points.length).toBeGreaterThan(1);

    // Outside, and joined on: the two halves are one claim. A loop that only
    // touched the frame could still be drawn across its inside, and a loop
    // that only stayed outside it could float anywhere on the page.
    for (const point of route.points) {
      expect(
        inside(byId.one, point),
        `${JSON.stringify(point)} is inside frame ${JSON.stringify(byId.one)}`,
      ).toBe(false);
    }
    expect(onBoundary(byId.one, route.points[0])).toBe(true);
    expect(onBoundary(byId.one, route.points[route.points.length - 1])).toBe(true);

    // And nowhere near the member it used to be drawn around.
    for (const point of route.points) {
      expect(inside(byId.A, point)).toBe(false);
    }
  });
});

/**
 * Depth, driven through the *measured* matrix in `01M2WQV0` rather than
 * through one repro document.
 *
 * Three levels of cluster — `L0 > L1 > L2 > {X, Y}`, with `Z` beside `L1`
 * under `L0` — and the `rankdir` moved between them. The engine expands a
 * cluster carrying a direction of its own exactly one level: a direct child
 * that is itself a cluster is kept at the size it was handed, with everything
 * below it never positioned at all. Which nodes that costs depends on where
 * the direction was written, so a compensation that reaches only the
 * direction's *own* children moves the damage one level down instead of
 * removing it — these place the direction at each depth in turn to say that
 * it does not.
 */
describe("layoutDirectedGraph through three levels of cluster", () => {
  /** `L0 > L1 > L2 > {X, Y}`, `Z` under `L0`, with `rankdir` on whichever cluster is named. */
  function threeLevels(rankdirOn: string): DirectedGraphLayoutInput {
    const cluster = (id: string, parentId?: string) => ({
      id,
      width: 60,
      height: 40,
      isCluster: true,
      ...(parentId === undefined ? {} : { parentId }),
      ...(id === rankdirOn ? { rankdir: "LR" as const } : {}),
    });
    return {
      rankdir: "TB",
      nodes: [
        cluster("L0"),
        cluster("L1", "L0"),
        cluster("L2", "L1"),
        { id: "X", width: 40, height: 20, parentId: "L2" },
        { id: "Y", width: 40, height: 20, parentId: "L2" },
        { id: "Z", width: 40, height: 20, parentId: "L0" },
      ],
      edges: [
        { id: "X-Y", from: "X", to: "Y" },
        { id: "X-Z", from: "X", to: "Z" },
      ],
    };
  }

  /** Every box by id, having checked that all four of its numbers are real. */
  function placed(input: DirectedGraphLayoutInput): Record<string, DirectedGraphLayoutNodeBox> {
    const result = layoutDirectedGraph(input);
    for (const box of result.nodes) {
      for (const value of [box.x, box.y, box.width, box.height]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
    return Object.fromEntries(result.nodes.map((box) => [box.id, box]));
  }

  it("places the two levels below the outermost cluster's own direction", () => {
    // `L0` says `LR`; neither `L1` nor `L2` says anything. Both are expanded,
    // so `X` and `Y` have coordinates two levels down — and both take the
    // *graph's* `TB`, which is what puts them in one column rather than side
    // by side the way `L0`'s `LR` would.
    const boxes = placed(threeLevels("L0"));

    expect(Object.keys(boxes)).toEqual(["L0", "L1", "L2", "X", "Y", "Z"]);
    expect(boxes.X.x).toBe(boxes.Y.x);
    expect(boxes.Y.y).toBeGreaterThan(boxes.X.y);

    // `L0`'s own `LR` still governs its own rank: `Z` sits to the right of the
    // members of the frame beside it, not below them. Read off the members
    // rather than off `L1`'s box, because a cluster carrying a direction comes
    // back from the engine at the size it was handed — the frames the picture
    // shows are the ones `layoutGraph` recomputes from what they enclose.
    expect(boxes.Z.x).toBeGreaterThan(boxes.X.x);
  });

  it("places the level below a direction written one level in", () => {
    // The same document with the direction moved to `L1`: `L2` is the cluster
    // that would have been left unexpanded, and the leaves below it are the
    // ones that would have been lost.
    const boxes = placed(threeLevels("L1"));

    expect(Object.keys(boxes)).toEqual(["L0", "L1", "L2", "X", "Y", "Z"]);
    expect(Object.keys(boxes)).toEqual(["L0", "L1", "L2", "X", "Y", "Z"]);
    expect(boxes.X.x).toBe(boxes.Y.x);
    expect(boxes.Y.y).toBeGreaterThan(boxes.X.y);
  });

  it("places every node, and refuses nothing, when the direction is on the innermost cluster", () => {
    // The measured-correct row of the same table: `L2`'s children are all
    // leaves, so one level of expansion is all this document needs.
    const result = layoutDirectedGraph(threeLevels("L2"));

    for (const box of result.nodes) {
      for (const value of [box.x, box.y, box.width, box.height]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
    expect(result.nodes.map((n) => n.id)).toEqual(["L0", "L1", "L2", "X", "Y", "Z"]);
  });
});

/**
 * What a cluster's returned box actually is, pinned against
 * `@dagrejs/dagre@3.1.1` (`01M2YKWQP`).
 *
 * `isCluster` used to promise outright that the box handed back was "the
 * frame enclosing those children", computed from them with the `width`/
 * `height` given ignored. Measured here, that holds for a cluster nothing
 * nests — with or without a direction of its own — and fails in *both* halves
 * for a cluster nested inside one that carries a direction: the box comes
 * back at exactly the size that was passed in, never having been sized, with
 * its members at negative coordinates outside it.
 *
 * These are characterization tests. They pin what the engine does today, not
 * what we would like it to do, and they were green the moment they were
 * written — there was no defect to fix, because no picture is wrong: all
 * three adapters already grow their own frame from the members. What was
 * wrong was the sentence on the seam, and a corrected sentence with no test
 * under it is just another comment.
 *
 * **If a future `@dagrejs/dagre` upgrade makes a nested cluster's box
 * genuinely enclose its children, the two "does not enclose" tests below go
 * red.** That red is the news, not a regression: it says the contract on
 * `isCluster` can be tightened back toward the promise it used to make, and
 * that the three adapters' union with their members could be re-examined.
 * Read it as "re-read `isCluster`'s doc comment", never as "restore the old
 * numbers".
 */
describe("the box layoutDirectedGraph returns for a cluster", () => {
  const BOX = { width: 60, height: 40 };

  /**
   * The fixture the measurement was taken on: `O > I > {A, B}` with `C`
   * beside `I` under `O`, every box 60x40, in a `TB` graph. The two edges are
   * what give both frames something to be ranked by; without them `A` and `B`
   * share a rank and the numbers below are a different table.
   */
  function nestedFrames(directions: {
    outer?: Direction;
    inner?: Direction;
  }): DirectedGraphLayoutInput {
    return {
      rankdir: "TB",
      nodes: [
        {
          id: "O",
          ...BOX,
          isCluster: true,
          ...(directions.outer === undefined ? {} : { rankdir: directions.outer }),
        },
        {
          id: "I",
          ...BOX,
          isCluster: true,
          parentId: "O",
          ...(directions.inner === undefined ? {} : { rankdir: directions.inner }),
        },
        { id: "A", ...BOX, parentId: "I" },
        { id: "B", ...BOX, parentId: "I" },
        { id: "C", ...BOX, parentId: "O" },
      ],
      edges: [
        { id: "A-B", from: "A", to: "B" },
        { id: "A-C", from: "A", to: "C" },
      ],
    };
  }

  function encloses(
    outer: DirectedGraphLayoutNodeBox,
    inner: DirectedGraphLayoutNodeBox,
  ): boolean {
    return (
      outer.x <= inner.x &&
      outer.y <= inner.y &&
      outer.x + outer.width >= inner.x + inner.width &&
      outer.y + outer.height >= inner.y + inner.height
    );
  }

  it("is grown from its members, and encloses them, when no cluster above it carries a direction", () => {
    const boxes = boxesOf(nestedFrames({}));

    expect(boxes.I).toEqual({ id: "I", x: 130, y: 25, width: 140, height: 180 });
    expect(boxes.A).toEqual({ id: "A", x: 165, y: 50, width: 60, height: 40 });
    expect(boxes.B).toEqual({ id: "B", x: 175, y: 140, width: 60, height: 40 });

    // 140x180 is nothing like the 60x40 handed in, which is the visible half
    // of the engine having sized this frame itself.
    expect(encloses(boxes.I, boxes.A)).toBe(true);
    expect(encloses(boxes.I, boxes.B)).toBe(true);
  });

  it("is grown from its members even carrying a direction of its own, as long as nothing nests it", () => {
    // So a direction is not what breaks the promise — nesting under one is.
    // Both of these are the same two members as above, in a cluster at the
    // document's own level, and both come back sized and enclosing.
    const alone = (rankdir: Direction) =>
      boxesOf({
        rankdir: "TB",
        nodes: [
          { id: "S", ...BOX, isCluster: true, rankdir },
          { id: "A", ...BOX, parentId: "S" },
          { id: "B", ...BOX, parentId: "S" },
        ],
        edges: [{ id: "A-B", from: "A", to: "B" }],
      });

    const lr = alone("LR");
    expect(lr.S).toEqual({ id: "S", x: 0, y: 0, width: 170, height: 40 });
    expect(encloses(lr.S, lr.A)).toBe(true);
    expect(encloses(lr.S, lr.B)).toBe(true);

    const tb = alone("TB");
    expect(tb.S).toEqual({ id: "S", x: 0, y: 0, width: 60, height: 130 });
    expect(encloses(tb.S, tb.A)).toBe(true);
    expect(encloses(tb.S, tb.B)).toBe(true);
  });

  for (const inner of [undefined, "TB"] as const) {
    const carrying =
      inner === undefined ? "carrying no direction itself" : "carrying one of its own";

    it(`comes back at exactly the size it was handed, and does not enclose its members, nested under a cluster with a direction while ${carrying}`, () => {
      const boxes = boxesOf(nestedFrames({ outer: "LR", inner }));

      // The 60x40 that comes back *is* the 60x40 that went in. Compared
      // against `BOX` rather than against a literal, because that identity is
      // the claim — the engine stopped one level of expansion short and left
      // this frame at the size the caller supplied.
      expect(boxes.I.width).toBe(BOX.width);
      expect(boxes.I.height).toBe(BOX.height);
      expect(boxes.I).toEqual({ id: "I", x: 0, y: 0, width: 60, height: 40 });

      // Its members are placed — `01M2XJWM4`'s fix is what gives them
      // coordinates at all — but above the frame rather than inside it.
      expect(boxes.A).toEqual({ id: "A", x: 0, y: -45, width: 60, height: 40 });
      expect(boxes.B).toEqual({ id: "B", x: 0, y: 45, width: 60, height: 40 });

      expect(encloses(boxes.I, boxes.A)).toBe(false);
      expect(encloses(boxes.I, boxes.B)).toBe(false);
    });
  }
});

/**
 * Whether `point` sits on `box`'s own outline — within its extent on both
 * axes and level with one of its four sides.
 *
 * The tolerance is the corpus's own (`transitionTouches` in `corpus.ts`,
 * `layoutStateDiagram.test.ts`'s frame reader): 1e-6, because a boundary
 * point is arithmetic on the box's own coordinates rather than a measured
 * quantity, and anything looser would accept a loop that misses its node by
 * a visible hair.
 */
function onBoundary(box: DirectedGraphLayoutNodeBox, point: Point): boolean {
  const tolerance = 1e-6;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const within =
    point.x >= box.x - tolerance &&
    point.x <= right + tolerance &&
    point.y >= box.y - tolerance &&
    point.y <= bottom + tolerance;
  const level =
    Math.abs(point.x - box.x) < tolerance ||
    Math.abs(point.x - right) < tolerance ||
    Math.abs(point.y - box.y) < tolerance ||
    Math.abs(point.y - bottom) < tolerance;
  return within && level;
}

/** Whether `point` is strictly within `box` — on the outline is not inside. */
function inside(box: DirectedGraphLayoutNodeBox, point: Point): boolean {
  const tolerance = 1e-6;
  return (
    point.x > box.x + tolerance &&
    point.x < box.x + box.width - tolerance &&
    point.y > box.y + tolerance &&
    point.y < box.y + box.height - tolerance
  );
}

/**
 * The coordinate guard (`01M2XJVPX`) stays, and this is what is left of its
 * coverage once the construct that used to reach it lays out.
 *
 * Every document that produced an unplaced node was a cluster with a direction
 * holding a cluster without one, and there is now no such thing: the
 * propagation above gives that inner cluster a direction before dagre sees it.
 * The guard is not thereby redundant — it is a check on the *shape of the
 * engine's answer*, not on that construct, so it is what stands between any
 * future missing coordinate and the `NaN` the pipeline used to mint from it.
 * What it reports is public (`render()` turns it into the author's
 * diagnostic), so the contract is pinned here rather than left to a path no
 * input currently walks.
 */
/**
 * Characterization, written before self-loop synthesis existed and green on
 * arrival: **the coordinates of every edge that is not a self-loop**, exact,
 * in the four shapes a self-loop lives among.
 *
 * Synthesising a self-loop means ignoring what dagre routed for that one
 * edge — and the danger in that is not the loop, it is everything beside it.
 * Dagre positions a self-edge before it routes one: it reserves a lane in
 * the order axis (measured: the same three-node chain reports a graph width
 * of 40 with no self-edge on `Y` and 90 with one), and every other node and
 * route in the document is placed around that lane. A synthesis that quietly
 * stopped handing the self-edge to dagre would keep the picture of the loop
 * and move everything else, which is exactly the kind of change no assertion
 * about a loop can see.
 *
 * So these numbers are dagre's own, copied from a run of this module before
 * the change, and they are asserted whole rather than as inequalities: what
 * is being pinned is "not one of these moved", and an inequality that held
 * either side of a shift would not pin it.
 */
describe("the coordinates an edge that is not a self-loop is drawn at", () => {
  it("are what they were, for a chain with a self-loop in the middle of it", () => {
    const result = layoutDirectedGraph({
      rankdir: "TB",
      nodes: [
        { id: "X", width: 40, height: 20 },
        { id: "Y", width: 40, height: 20 },
        { id: "Z", width: 40, height: 20 },
      ],
      edges: [
        { id: "X-Y", from: "X", to: "Y" },
        { id: "Y-Y", from: "Y", to: "Y" },
        { id: "Y-Z", from: "Y", to: "Z" },
      ],
    });

    const byId = Object.fromEntries(result.edges.map((e) => [e.id, e.points]));
    expect(byId["X-Y"]).toEqual([
      { x: 20, y: 20 },
      { x: 20, y: 45 },
      { x: 20, y: 70 },
    ]);
    expect(byId["Y-Z"]).toEqual([
      { x: 20, y: 90 },
      { x: 20, y: 115 },
      { x: 20, y: 140 },
    ]);
    // The boxes those routes run between, and the reserved lane the graph
    // width is the evidence of: 90 wide for three 40-wide boxes in one
    // column.
    expect(result.nodes).toEqual([
      { id: "X", x: 0, y: 0, width: 40, height: 20 },
      { id: "Y", x: 0, y: 70, width: 40, height: 20 },
      { id: "Z", x: 0, y: 140, width: 40, height: 20 },
    ]);
    expect([result.width, result.height]).toEqual([90, 160]);
  });

  it("are what they were, for the same chain laid out LR", () => {
    const result = layoutDirectedGraph({
      rankdir: "LR",
      nodes: [
        { id: "X", width: 40, height: 20 },
        { id: "Y", width: 40, height: 20 },
        { id: "Z", width: 40, height: 20 },
      ],
      edges: [
        { id: "X-Y", from: "X", to: "Y" },
        { id: "Y-Y", from: "Y", to: "Y" },
        { id: "Y-Z", from: "Y", to: "Z" },
      ],
    });

    const byId = Object.fromEntries(result.edges.map((e) => [e.id, e.points]));
    expect(byId["X-Y"]).toEqual([
      { x: 40, y: 10 },
      { x: 65, y: 10 },
      { x: 90, y: 10 },
    ]);
    expect(byId["Y-Z"]).toEqual([
      { x: 130, y: 10 },
      { x: 155, y: 10 },
      { x: 180, y: 10 },
    ]);
    // The lane is reserved on the other axis under `LR` — 60 tall for one
    // row of 20-tall boxes — which is why the two directions are pinned
    // separately.
    expect(result.nodes).toEqual([
      { id: "X", x: 0, y: 0, width: 40, height: 20 },
      { id: "Y", x: 90, y: 0, width: 40, height: 20 },
      { id: "Z", x: 180, y: 0, width: 40, height: 20 },
    ]);
    expect([result.width, result.height]).toEqual([220, 60]);
  });

  it("are what they were, for an edge between two frames", () => {
    const result = layoutDirectedGraph({
      rankdir: "TB",
      nodes: [
        { id: "one", width: 0, height: 0, isCluster: true },
        { id: "A", width: 40, height: 20, parentId: "one" },
        { id: "two", width: 0, height: 0, isCluster: true },
        { id: "B", width: 40, height: 20, parentId: "two" },
      ],
      edges: [{ id: "one-two", from: "one", to: "two" }],
    });

    // The proxy-and-clip route, whose ends sit on the two cluster boxes.
    expect(result.edges[0].points).toEqual([
      { x: 55, y: 70 },
      { x: 55, y: 95 },
      { x: 55, y: 120 },
    ]);
    expect(result.nodes).toEqual([
      { id: "one", x: 0, y: 0, width: 110, height: 70 },
      { id: "A", x: 35, y: 25, width: 40, height: 20 },
      { id: "two", x: 0, y: 120, width: 110, height: 70 },
      { id: "B", x: 35, y: 145, width: 40, height: 20 },
    ]);
  });

  it("are what they were, label anchor included, beside a labelled self-loop", () => {
    const result = layoutDirectedGraph({
      rankdir: "TB",
      nodes: [
        { id: "X", width: 40, height: 20 },
        { id: "Y", width: 40, height: 20 },
      ],
      edges: [
        { id: "X-Y", from: "X", to: "Y", label: { width: 30, height: 10 } },
        { id: "Y-Y", from: "Y", to: "Y", label: { width: 30, height: 10 } },
      ],
    });

    const route = result.edges.find((e) => e.id === "X-Y")!;
    expect(route.points).toEqual([
      { x: 20, y: 20 },
      { x: 20, y: 50 },
      { x: 20, y: 80 },
    ]);
    expect(route.labelAnchor).toEqual({ x: 45, y: 50 });
  });
});

/**
 * The loop an edge onto its own endpoint is drawn as.
 *
 * Not dagre's: measured directly against `@dagrejs/dagre@3.1.1`, one node
 * 24x32 at box x 0..24 / y 0..32 with `A --> A` on it comes back with edge
 * points at x 52..76 — a loop entirely clear of the node it belongs to, and
 * a graph width (74) smaller than its own largest x (76). Identical with
 * `compound` on and off. So the question these ask is the first thing a
 * self-loop has to answer and the one dagre gets wrong: does it touch the
 * box it loops on.
 */
describe("the loop an edge onto its own endpoint is drawn as", () => {
  for (const rankdir of ["TB", "LR"] as const) {
    it(`joins the node it loops on, at both ends, laid out ${rankdir}`, () => {
      const result = layoutDirectedGraph({
        rankdir,
        nodes: [
          { id: "X", width: 40, height: 20 },
          { id: "Y", width: 40, height: 20 },
        ],
        edges: [
          { id: "X-Y", from: "X", to: "Y" },
          { id: "Y-Y", from: "Y", to: "Y" },
        ],
      });

      const box = result.nodes.find((node) => node.id === "Y")!;
      const loop = result.edges.find((edge) => edge.id === "Y-Y")!.points;

      // A loop and not a point: a route collapsed onto one coordinate still
      // leaves something to read here and draws nothing at all.
      expect(loop.length).toBeGreaterThan(1);
      expect(
        onBoundary(box, loop[0]),
        `starts at ${JSON.stringify(loop[0])} for box ${JSON.stringify(box)}`,
      ).toBe(true);
      expect(
        onBoundary(box, loop[loop.length - 1]),
        `ends at ${JSON.stringify(loop[loop.length - 1])} for box ${JSON.stringify(box)}`,
      ).toBe(true);
    });
  }
});

/**
 * A loop is a figure beside the box, not a second outline of it.
 *
 * The case that makes the difference visible is a frame: `examples/
 * state-core.srn`'s `Running` is 361 wide and **542 tall**, so a loop that
 * took the whole of the side it hangs from would be drawn as a 542-long
 * crescent bulging 30 — a line down the frame's edge, read as a border
 * rather than as an arrow returning to where it started. What a loop is
 * does not depend on how big the thing it loops on is.
 */
describe("how far along its box a self-loop runs", () => {
  /** The same one-frame document, with the frame's member however tall is asked for. */
  const frameHolding = (memberHeight: number) =>
    layoutDirectedGraph({
      rankdir: "TB",
      nodes: [
        { id: "one", width: 0, height: 0, isCluster: true },
        { id: "A", width: 40, height: memberHeight, parentId: "one" },
      ],
      edges: [{ id: "one-one", from: "one", to: "one" }],
    });

  const loopSpan = (result: ReturnType<typeof frameHolding>) => {
    const ys = result.edges[0].points.map((point) => point.y);
    return Math.max(...ys) - Math.min(...ys);
  };

  it("does not stretch with the box: a frame ten times as tall loops the same", () => {
    const short = frameHolding(20);
    const tall = frameHolding(400);

    // The premise — the two frames really are different sizes, so the
    // equality below is a fact about the loop and not about the document.
    const heightOf = (result: ReturnType<typeof frameHolding>) =>
      result.nodes.find((node) => node.id === "one")!.height;
    expect(heightOf(tall)).toBeGreaterThan(heightOf(short) * 5);

    expect(loopSpan(tall)).toBe(loopSpan(short));
  });

  it("still runs the whole side of a box small enough to loop around", () => {
    // Nothing is clamped that did not need clamping: an ordinary node is
    // shorter than the loop, so the loop takes its whole side — dagre's own
    // figure, which is level with the node's top and bottom.
    const result = layoutDirectedGraph({
      rankdir: "TB",
      nodes: [{ id: "A", width: 40, height: 20 }],
      edges: [{ id: "A-A", from: "A", to: "A" }],
    });

    const box = result.nodes[0];
    const ys = result.edges[0].points.map((point) => point.y);
    expect(Math.min(...ys)).toBe(box.y);
    expect(Math.max(...ys)).toBe(box.y + box.height);
  });
});

/**
 * The bounds a synthesised loop has to fit inside, which are the difference
 * between a loop drawn and a loop seen: everything downstream turns this
 * module's `width`/`height` into the `<svg>`'s own `viewBox`, and an SVG
 * clips to its viewport. A loop outside it is not a wrong picture, it is no
 * picture — the same silence this ticket exists to end.
 */
describe("the bounds a self-loop is reported inside", () => {
  it("hold the loop on a plain node, where the engine reserved a lane for it", () => {
    const result = layoutDirectedGraph({
      rankdir: "TB",
      nodes: [
        { id: "X", width: 40, height: 20 },
        { id: "Y", width: 40, height: 20 },
      ],
      edges: [
        { id: "X-Y", from: "X", to: "Y" },
        { id: "Y-Y", from: "Y", to: "Y" },
      ],
    });

    for (const point of result.edges.find((edge) => edge.id === "Y-Y")!.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(result.width);
      expect(point.y).toBeLessThanOrEqual(result.height);
    }
  });

  it("hold the loop on a frame, where it reserved none", () => {
    // The lane is reserved beside the *proxy member*, inside the cluster, so
    // a frame's loop is the case the engine's own bounds say nothing about.
    const result = layoutDirectedGraph({
      rankdir: "TB",
      nodes: [
        { id: "one", width: 0, height: 0, isCluster: true },
        { id: "A", width: 40, height: 20, parentId: "one" },
      ],
      edges: [{ id: "one-one", from: "one", to: "one" }],
    });

    for (const point of result.edges[0].points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(result.width);
      expect(point.y).toBeLessThanOrEqual(result.height);
    }
  });
});

describe("UnplacedNodesError", () => {
  it("names every node it lost, in the order it was given them", () => {
    const error = new UnplacedNodesError(["L2", "X", "Y"]);

    expect(error.nodeIds).toEqual(["L2", "X", "Y"]);
    expect(error.name).toBe("UnplacedNodesError");
    expect(error.message).toContain('"L2", "X", "Y"');
  });
});
