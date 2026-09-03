import { describe, expect, it } from "vitest";
import type { GraphModel, TextMeasurer } from "../contracts";
import { layoutGraph } from "./layoutGraph";

/** Deterministic fake measurer per the ticket: width = text.length * 8, height = 24. */
const fakeMeasurer: TextMeasurer = {
  measure(text: string) {
    return { width: text.length * 8, height: 24 };
  },
};

function chainGraph(direction: GraphModel["direction"]): GraphModel {
  return {
    direction,
    nodes: [
      { id: "A", label: "A" },
      { id: "B", label: "B" },
      { id: "C", label: "C" },
    ],
    edges: [
      { id: "A-B", from: "A", to: "B" },
      { id: "B-C", from: "B", to: "C" },
    ],
    timeline: { totalSteps: 0, entries: [] },
  };
}

describe("layoutGraph", () => {
  it("stacks ranks downward for a TD chain graph", () => {
    const graph = chainGraph("TD");

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));
    expect(byId.B.y).toBeGreaterThan(byId.A.y);
    expect(byId.C.y).toBeGreaterThan(byId.B.y);
  });

  it("stacks ranks rightward for an LR chain graph", () => {
    const graph = chainGraph("LR");

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));
    expect(byId.B.x).toBeGreaterThan(byId.A.x);
    expect(byId.C.x).toBeGreaterThan(byId.B.x);
  });

  it("produces non-overlapping bounding boxes for all nodes", () => {
    const graph = chainGraph("TD");

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    function overlaps(
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number },
    ): boolean {
      return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      );
    }

    for (let i = 0; i < positioned.nodes.length; i++) {
      for (let j = i + 1; j < positioned.nodes.length; j++) {
        expect(overlaps(positioned.nodes[i], positioned.nodes[j])).toBe(
          false,
        );
      }
    }
  });

  it("routes each edge's path from the source node's boundary to the target node's boundary, not their centers", () => {
    const graph = chainGraph("TD");

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));

    function centerOf(node: { x: number; y: number; width: number; height: number }) {
      return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    }

    for (const edge of positioned.edges) {
      const source = byId[edge.from];
      const target = byId[edge.to];
      const first = edge.points[0];
      const last = edge.points[edge.points.length - 1];

      expect(first).not.toEqual(centerOf(source));
      expect(last).not.toEqual(centerOf(target));
    }
  });

  it("produces identical output for two calls with the same graph and measurer (deterministic)", () => {
    const graph = chainGraph("TD");

    const first = layoutGraph(graph, { measureText: fakeMeasurer });
    const second = layoutGraph(graph, { measureText: fakeMeasurer });

    expect(second).toEqual(first);
  });

  it("passes the resolved timeline through unchanged onto PositionedGraph.timeline", () => {
    const graph: GraphModel = {
      ...chainGraph("TD"),
      timeline: {
        totalSteps: 2,
        entries: [
          { step: 1, targetId: "B", effect: "fade" },
          { step: 2, targetId: "C", effect: "fade" },
        ],
      },
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    expect(positioned.timeline).toEqual(graph.timeline);
  });
});
