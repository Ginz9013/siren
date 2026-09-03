import { describe, expect, it } from "vitest";
import { renderToSVG } from "./renderToSVG";
import type { PositionedGraph } from "../contracts";

/**
 * Hand-built fixture: A -> B -> C, B pending at step 1, C pending at step 2,
 * A never mentioned in the timeline (visible from the start).
 */
function buildFixture(): PositionedGraph {
  return {
    direction: "TD",
    nodes: [
      { id: "A", label: "Start", x: 0, y: 0, width: 80, height: 40 },
      { id: "B", label: "Process", x: 0, y: 100, width: 80, height: 40 },
      { id: "C", label: "End", x: 0, y: 200, width: 80, height: 40 },
    ],
    edges: [
      {
        id: "A-B",
        from: "A",
        to: "B",
        points: [
          { x: 40, y: 20 },
          { x: 40, y: 100 },
        ],
      },
      {
        id: "B-C",
        from: "B",
        to: "C",
        points: [
          { x: 40, y: 120 },
          { x: 40, y: 200 },
        ],
      },
    ],
    timeline: {
      totalSteps: 2,
      entries: [
        { kind: "enter", step: 1, targetId: "B", effect: "fade" },
        { kind: "enter", step: 2, targetId: "C", effect: "fade" },
      ],
    },
    width: 80,
    height: 240,
  };
}

/**
 * Hand-built fixture exercising the enter-only siren-pending rule: X has
 * only an `exit` action (no `enter`), Y has only a `highlight` action (no
 * `enter`), Z has an `enter` action.
 */
function buildNonEnterFixture(): PositionedGraph {
  return {
    direction: "TD",
    nodes: [
      { id: "X", label: "ExitOnly", x: 0, y: 0, width: 80, height: 40 },
      { id: "Y", label: "HighlightOnly", x: 0, y: 100, width: 80, height: 40 },
      { id: "Z", label: "EntersLater", x: 0, y: 200, width: 80, height: 40 },
    ],
    edges: [],
    timeline: {
      totalSteps: 2,
      entries: [
        { kind: "exit", step: 1, targetId: "X", effect: "fade" },
        { kind: "highlight", step: 2, targetId: "Y", effect: "outline" },
        { kind: "enter", step: 1, targetId: "Z", effect: "fade" },
      ],
    },
    width: 80,
    height: 240,
  };
}

describe("renderToSVG", () => {
  it("renders one siren-node group per node and one siren-edge path per edge, each carrying data-siren-id", () => {
    const svg = renderToSVG(buildFixture());

    const nodeGroups = svg.querySelectorAll("g.siren-node");
    const edgePaths = svg.querySelectorAll("path.siren-edge");

    expect(nodeGroups).toHaveLength(3);
    expect(edgePaths).toHaveLength(2);

    expect(Array.from(nodeGroups).map((g) => g.getAttribute("data-siren-id")).sort()).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(Array.from(edgePaths).map((p) => p.getAttribute("data-siren-id")).sort()).toEqual([
      "A-B",
      "B-C",
    ]);
  });

  it("marks elements with an enter action as siren-pending and leaves elements never mentioned unmarked", () => {
    const svg = renderToSVG(buildFixture());

    const nodeA = svg.querySelector('g.siren-node[data-siren-id="A"]')!;
    const nodeB = svg.querySelector('g.siren-node[data-siren-id="B"]')!;
    const nodeC = svg.querySelector('g.siren-node[data-siren-id="C"]')!;

    expect(nodeA.classList.contains("siren-pending")).toBe(false);
    expect(nodeB.classList.contains("siren-pending")).toBe(true);
    expect(nodeC.classList.contains("siren-pending")).toBe(true);
  });

  it("does not mark siren-pending for elements whose only timeline action is exit or highlight, but still marks elements with an enter action", () => {
    const svg = renderToSVG(buildNonEnterFixture());

    const nodeX = svg.querySelector('g.siren-node[data-siren-id="X"]')!;
    const nodeY = svg.querySelector('g.siren-node[data-siren-id="Y"]')!;
    const nodeZ = svg.querySelector('g.siren-node[data-siren-id="Z"]')!;

    expect(nodeX.classList.contains("siren-pending")).toBe(false);
    expect(nodeY.classList.contains("siren-pending")).toBe(false);
    expect(nodeZ.classList.contains("siren-pending")).toBe(true);
  });

  it("gives every node a rect sized to width/height and a text with the node's exact label", () => {
    const svg = renderToSVG(buildFixture());

    const nodeB = svg.querySelector('g.siren-node[data-siren-id="B"]')!;
    const rect = nodeB.querySelector("rect")!;
    const text = nodeB.querySelector("text")!;

    expect(rect).not.toBeNull();
    expect(rect.getAttribute("width")).toBe("80");
    expect(rect.getAttribute("height")).toBe("40");
    expect(text).not.toBeNull();
    expect(text.textContent).toBe("Process");
  });

  it("sizes the root svg to the graph's full width/height via width/height and viewBox", () => {
    const svg = renderToSVG(buildFixture());

    // Fixture: width: 80, height: 240.
    expect(svg.getAttribute("width")).toBe("80");
    expect(svg.getAttribute("height")).toBe("240");
    expect(svg.getAttribute("viewBox")).toBe("0 0 80 240");
  });

  it("centers each node's text within its rect instead of leaving it at the default (0,0)", () => {
    const svg = renderToSVG(buildFixture());

    const nodeB = svg.querySelector('g.siren-node[data-siren-id="B"]')!;
    const text = nodeB.querySelector("text")!;

    // Fixture B: x=0, y=100, width=80, height=40 -> center is (40, 120).
    expect(text.getAttribute("x")).toBe("40");
    expect(text.getAttribute("y")).toBe("120");
    expect(text.getAttribute("text-anchor")).toBe("middle");
    expect(text.getAttribute("dominant-baseline")).toBe("middle");
  });

  it("renders a label containing markup-looking text as literal textContent, never as parsed markup", () => {
    const graph = buildFixture();
    graph.nodes[0]!.label = "<script>alert(1)</script>";

    const svg = renderToSVG(graph);

    const nodeA = svg.querySelector('g.siren-node[data-siren-id="A"]')!;
    const text = nodeA.querySelector("text")!;

    expect(text.textContent).toBe("<script>alert(1)</script>");
    expect(svg.querySelectorAll("script")).toHaveLength(0);
  });

  it("marks every edge path with the siren-arrow marker and defines that marker in defs", () => {
    const svg = renderToSVG(buildFixture());

    const edgePaths = svg.querySelectorAll("path.siren-edge");
    for (const path of Array.from(edgePaths)) {
      expect(path.getAttribute("marker-end")).toBe("url(#siren-arrow)");
    }

    const marker = svg.querySelector("defs marker#siren-arrow");
    expect(marker).not.toBeNull();
  });

  it("sizes the arrow marker so its tip lands exactly on the path's endpoint, with no overshoot into the node, and stays a fixed absolute size regardless of stroke-width", () => {
    const svg = renderToSVG(buildFixture());

    const marker = svg.querySelector("defs marker#siren-arrow")!;

    // markerUnits must be userSpaceOnUse, not the SVG default (strokeWidth) —
    // otherwise the marker silently doubles in size whenever an edge's
    // stroke-width increases (e.g. on highlight), which is not what "the
    // arrow tip is too big" or "pierces into the node" should ever depend
    // on.
    expect(marker.getAttribute("markerUnits")).toBe("userSpaceOnUse");

    // The tip must sit exactly at refX (the point that gets placed on the
    // path's actual endpoint) — any smaller refX means the tip overshoots
    // past the endpoint and visually pierces into the node it points at.
    const markerWidth = Number(marker.getAttribute("markerWidth"));
    const refX = Number(marker.getAttribute("refX"));
    expect(refX).toBe(markerWidth);

    // Small absolute footprint (down from the original 10x10 pierce-prone
    // marker).
    expect(markerWidth).toBeLessThanOrEqual(8);
    expect(Number(marker.getAttribute("markerHeight"))).toBeLessThanOrEqual(6);
  });

  it("gives the arrow tip a themeable class instead of relying on the SVG fill default", () => {
    const svg = renderToSVG(buildFixture());

    // The marker's arrowhead <path> had no fill/class at all, which meant
    // it silently defaulted to SVG's initial fill (black) rather than
    // tracking the edge's own color — invisible against a dark theme's
    // near-black background (reported by the user testing the dark-theme
    // toggle demo). It must carry a class the shipped theme can target,
    // the same way every other themeable part of the SVG does.
    const arrowPath = svg.querySelector("defs marker#siren-arrow path")!;
    expect(arrowPath.getAttribute("class")).toBe("siren-arrow-fill");
    expect(arrowPath.getAttribute("fill")).toBeNull();
  });
});
