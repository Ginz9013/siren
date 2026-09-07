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
      { id: "A", label: "A", shape: "rect", style: { frame: [], text: [] } },
      { id: "B", label: "B", shape: "rect", style: { frame: [], text: [] } },
      { id: "C", label: "C", shape: "rect", style: { frame: [], text: [] } },
    ],
    edges: [
      { id: "A-B", from: "A", to: "B", style: { frame: [], text: [] } },
      { id: "B-C", from: "B", to: "C", style: { frame: [], text: [] } },
    ],
    timeline: { totalSteps: 0, entries: [] },
  };
}

describe("layoutGraph", () => {
  it("stacks ranks downward for a TB chain graph", () => {
    const graph = chainGraph("TB");

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

  it("honors all four rank directions, not just the two the header used to accept", () => {
    const byIdFor = (direction: GraphModel["direction"]) => {
      const positioned = layoutGraph(chainGraph(direction), { measureText: fakeMeasurer });
      return Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));
    };

    const bt = byIdFor("BT");
    expect(bt.B.y).toBeLessThan(bt.A.y);
    expect(bt.C.y).toBeLessThan(bt.B.y);

    const rl = byIdFor("RL");
    expect(rl.B.x).toBeLessThan(rl.A.x);
    expect(rl.C.x).toBeLessThan(rl.B.x);
  });

  it("produces non-overlapping bounding boxes for all nodes", () => {
    const graph = chainGraph("TB");

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
    const graph = chainGraph("TB");

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
    const graph = chainGraph("TB");

    const first = layoutGraph(graph, { measureText: fakeMeasurer });
    const second = layoutGraph(graph, { measureText: fakeMeasurer });

    expect(second).toEqual(first);
  });

  it("gives a rhombus enough box that its label fits inside the diamond, not merely inside its bounding box", () => {
    // The rule this ticket settles, and the one the other twelve shapes
    // inherit: a shape is drawn *inscribed* in the node's bounding box, so
    // layout asks the shape how much box its label needs rather than
    // handing every shape the label's own box the way a rectangle can take
    // it. A diamond circumscribing the text box the way a rectangle does
    // would cross its own label on all four diagonals.
    //
    // For a rhombus that box is exactly twice the label on each axis. A
    // diamond inscribed in `W x H` contains the centred `w x h` label
    // exactly when `w/W + h/H <= 1`, so `W = 2w, H = 2h` is the smallest
    // diamond of the label's own proportions that holds it — which is why
    // the numbers scale with the label instead of a constant pad being
    // added to it. The measured box is the glyphs *plus* the theme's
    // padding, so corners lying on the outline still leave the text inside
    // it.
    const graph: GraphModel = {
      direction: "TB",
      nodes: [
        { id: "A", label: "Is it ready?", shape: "rhombus", style: { frame: [], text: [] } },
        { id: "B", label: "?", shape: "rhombus", style: { frame: [], text: [] } },
        { id: "C", label: "Is it ready?", shape: "rect", style: { frame: [], text: [] } },
      ],
      edges: [],
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));

    // `fakeMeasurer`: 8px per character wide, 24px tall.
    expect([byId.A.width, byId.A.height]).toEqual([12 * 8 * 2, 24 * 2]);
    // A one-character label gets a small diamond rather than the same one:
    // the box is proportional to the label, not the label plus a constant.
    expect([byId.B.width, byId.B.height]).toEqual([1 * 8 * 2, 24 * 2]);
    // A rect still takes the measured box exactly — the shape it is
    // inscribed in is the box, so it needs nothing extra, and no existing
    // flowchart changes size because shapes arrived.
    expect([byId.C.width, byId.C.height]).toEqual([12 * 8, 24]);

    // The rule itself, stated as geometry rather than as the two numbers
    // above, because it is what a hexagon and a circle will be measured
    // against too.
    const fitsInsideDiamond = (node: (typeof positioned.nodes)[number]) => {
      const label = fakeMeasurer.measure(node.label);
      return label.width / node.width + label.height / node.height <= 1;
    };
    expect(fitsInsideDiamond(byId.A)).toBe(true);
    expect(fitsInsideDiamond(byId.B)).toBe(true);
  });

  it("gives each shape drawn with a slanted or notched outline exactly the box its label needs, and no more", () => {
    // The same rule ticket 01 settled for the rhombus, applied rather than
    // reinvented: **the smallest bounding box in which this shape,
    // inscribed, still contains the centred measured label.**
    //
    // For all six of this ticket's shapes that box works out to one
    // formula, because in every one of them the outline's horizontal
    // displacement at the *label's own edge* is `lean x H` per side, and
    // nothing forces the box taller than the label:
    //
    //   H = h,  W = w + 2 x lean x h
    //
    // Worked, per shape, with `lean` the outline's run per side as a
    // fraction of the box height:
    //
    // - hexagon (`lean = 1/4`): at `H = h` the label's top edge *is* the
    //   hexagon's top edge, which spans the box inset by `m = lean x H` at
    //   each end, so `w <= W - 2m`.
    // - parallelogram / -alt (`lean = 1/2`): the leaning side displaces
    //   `s = lean x H` across the full height, so at the label's top edge
    //   it has displaced `s(1 + h/H)/2`, which is `s` when `H = h`.
    // - trapezoid / -alt (`lean = 1/2`): the same arithmetic on both sides
    //   at once, at the narrow edge.
    // - asymmetric (`lean = 1/4`): the notch reaches its deepest, `d = lean
    //   x H`, exactly at mid-height, which is where the label is centred —
    //   so the box must grow by `d` on the notched side, and the label
    //   being centred makes that `2d` overall.
    //
    // Proportions are Siren's own (the board's decision 1), and these
    // happen to be Mermaid's: measured from mermaid 11.17.2's rendered
    // polygons, a `lean_right` displaces `h/2`, a `trapezoid` insets `h/2`
    // per side, a `hexagon` insets `h/4` per end and an `odd`'s notch is
    // `h/4` deep.
    const shapes = [
      "hexagon",
      "parallelogram",
      "parallelogram-alt",
      "trapezoid",
      "trapezoid-alt",
      "asymmetric",
    ] as const;
    const graph: GraphModel = {
      direction: "TB",
      nodes: shapes.flatMap((shape) => [
        { id: `${shape}-long`, label: "A rather long label", shape, style: { frame: [], text: [] } },
        { id: `${shape}-short`, label: "x", shape, style: { frame: [], text: [] } },
      ]),
      edges: [],
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });
    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));

    // `fakeMeasurer`: 8px per character wide, 24px tall. "A rather long
    // label" is 19 characters, so `w = 152, h = 24`.
    const lean: Record<(typeof shapes)[number], number> = {
      hexagon: 1 / 4,
      parallelogram: 1 / 2,
      "parallelogram-alt": 1 / 2,
      trapezoid: 1 / 2,
      "trapezoid-alt": 1 / 2,
      asymmetric: 1 / 4,
    };
    for (const shape of shapes) {
      const long = byId[`${shape}-long`];
      const short = byId[`${shape}-short`];
      expect([shape, long.width, long.height]).toEqual([
        shape,
        152 + 2 * lean[shape] * 24,
        24,
      ]);
      // Proportional to the label rather than the label plus a constant, so
      // a one-character node stays small — the property ticket 01 asserted
      // for the rhombus, which is what makes these formulas rather than
      // fudge factors.
      expect([shape, short.width, short.height]).toEqual([
        shape,
        8 + 2 * lean[shape] * 24,
        24,
      ]);
      // And the box is the *smallest* one: one pixel narrower and the label
      // would cross the outline.
      expect(long.width - 2 * lean[shape] * long.height).toBe(152);
    }
  });

  it("passes the resolved timeline through unchanged onto PositionedGraph.timeline", () => {
    const graph: GraphModel = {
      ...chainGraph("TB"),
      timeline: {
        totalSteps: 2,
        entries: [
          { kind: "enter", step: 1, targetId: "B", effect: "fade" },
          { kind: "enter", step: 2, targetId: "C", effect: "fade" },
        ],
      },
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    expect(positioned.timeline).toEqual(graph.timeline);
  });

  it("passes each node's resolved author styling through unchanged onto PositionedNode.style", () => {
    // Layout has no opinion about styling: the declarations, their order, the
    // half each one was sorted into and the empty halves of an unstyled node
    // all arrive at the renderer exactly as `buildFlowchartModel` resolved
    // them. What they *mean* was settled at `resolveStyles`, and this stage
    // may not re-decide any of it — which is why the text half is carried
    // here too rather than dropped as the half this stage has no use for.
    const base = chainGraph("TB");
    const graph: GraphModel = {
      ...base,
      nodes: [
        {
          ...base.nodes[0],
          style: {
            frame: [
              { property: "fill", value: "#fdd" },
              { property: "stroke", value: "#c00" },
            ],
            text: [{ property: "fill", value: "#fff" }],
          },
        },
        ...base.nodes.slice(1),
      ],
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));
    expect(byId.A.style).toEqual({
      frame: [
        { property: "fill", value: "#fdd" },
        { property: "stroke", value: "#c00" },
      ],
      text: [{ property: "fill", value: "#fff" }],
    });
    expect(byId.B.style).toEqual({ frame: [], text: [] });
  });

  it("passes each edge's resolved author styling through unchanged onto PositionedEdge.style", () => {
    // The same rule the node styling above follows, and the reason
    // `linkStyle`'s index has to die at the model: what arrives here is
    // already keyed by edge id, so layout reattaches declarations to routes
    // without ever asking which position an edge was declared at.
    const base = chainGraph("TB");
    const graph: GraphModel = {
      ...base,
      edges: [
        {
          ...base.edges[0],
          style: { frame: [{ property: "stroke", value: "#f00" }], text: [] },
        },
        ...base.edges.slice(1),
      ],
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.edges.map((e) => [e.id, e]));
    expect(byId["A-B"].style).toEqual({
      frame: [{ property: "stroke", value: "#f00" }],
      text: [],
    });
    expect(byId["B-C"].style).toEqual({ frame: [], text: [] });
  });
});
