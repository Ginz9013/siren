import { describe, expect, it } from "vitest";
import type { Direction } from "../contracts";
import {
  layoutDirectedGraph,
  UnplacedNodesError,
  type DirectedGraphLayoutInput,
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

  it("routes a cluster's self-edge as the loop dagre drew around the member standing in for it", () => {
    // `one --> one` is the one construct where the clip has nothing to do:
    // dagre's self-loop never leaves the frame, so there is no point outside
    // the box to clip to and the loop is returned as drawn — inside the
    // frame, beside the member it was routed around, rather than around the
    // frame as Mermaid draws it. A simplification of the same connection,
    // confined to a construct that did not lay out at all before this, and
    // it is *not* an unrouted edge left at the origin.
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
    for (const point of route.points) {
      expect(point.x).toBeGreaterThanOrEqual(byId.one.x);
      expect(point.x).toBeLessThanOrEqual(byId.one.x + byId.one.width);
      expect(point.y).toBeGreaterThanOrEqual(byId.one.y);
      expect(point.y).toBeLessThanOrEqual(byId.one.y + byId.one.height);
    }
  });
});

/**
 * The coordinate invariant, driven through the *measured* matrix in
 * `01M2WQV0` rather than through one repro document.
 *
 * Three levels of cluster — `L0 > L1 > L2 > {X, Y}`, with `Z` beside `L1`
 * under `L0` — and the `rankdir` moved between them. The engine expands a
 * cluster carrying a direction of its own exactly one level: its direct
 * children are laid out, and any of them that is itself a cluster is kept at
 * the size it was handed, with everything below that child never positioned
 * at all. So *which* nodes come back without coordinates depends on where
 * the direction was written, and both answers below are read off that table,
 * not off this code.
 *
 * What these pin beyond the repro is that the guard is a check on the
 * engine's *answer*, not a check for one document shape: it reports whatever
 * came back unplaced, at whatever depth, and it reports all of it.
 */
describe("layoutDirectedGraph's coordinate invariant", () => {
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

  /** The `UnplacedNodesError` `run` threw, or a failure naming what it did instead. */
  function refusalOf(run: () => unknown): UnplacedNodesError {
    try {
      run();
    } catch (error) {
      if (error instanceof UnplacedNodesError) return error;
      throw error;
    }
    throw new Error("expected layoutDirectedGraph to refuse this graph, and it returned");
  }

  it("names every node left unplaced under the outermost cluster's own direction", () => {
    // `L1` is the direct child kept unexpanded, so it has a box; `L2` and the
    // two leaves under it are never positioned.
    expect(refusalOf(() => layoutDirectedGraph(threeLevels("L0"))).nodeIds).toEqual([
      "L2",
      "X",
      "Y",
    ]);
  });

  it("names a different set when the direction is written one level in", () => {
    // Same document, direction moved: now `L2` is the unexpanded direct child
    // and only the leaves below it are lost. A guard keyed on "nested cluster
    // plus direction" could not tell these two apart.
    const refusal = refusalOf(() => layoutDirectedGraph(threeLevels("L1")));
    expect(refusal.nodeIds).toEqual(["X", "Y"]);
    expect(refusal.message).toContain('"X", "Y"');
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
