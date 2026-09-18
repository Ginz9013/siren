import { describe, expect, it } from "vitest";
import type { Direction } from "../contracts";
import {
  layoutDirectedGraph,
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
});
