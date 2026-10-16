import { describe, expect, it } from "vitest";
import type { Direction, GraphModel, NodeShape, PositionedGraph, TextMeasurer } from "../../contracts";
import { plainLabel } from "../../label/label";
import { layoutLabel } from "../../label/layoutLabel";
import { renderToSVG } from "../../renderer/renderToSVG";
import { layoutGraph } from "../layoutGraph";

/**
 * The shapes a node's `@{ shape: … }` block names that Mermaid 12.2.0 draws
 * at a fixed size and with no text, through the two seams that read the
 * shape table: `layoutGraph` (the box) and `renderToSVG` (the outline, and
 * no label).
 *
 * Every number is Mermaid's, measured in headless Chrome (classic look) and
 * read off its handler — not copied from a run of this code.
 */

/** 8px a character, 24px a line. */
const fakeMeasurer: TextMeasurer = {
  measure: (text: string) => ({ width: text.length * 8, height: 24 }),
};

/** The box `shape` lays out as, labelled with a long id, in `direction`. */
function boxOf(shape: NodeShape, direction: Direction = "TB") {
  const graph: GraphModel = {
    direction,
    nodes: [
      {
        id: "AVeryLongNodeId",
        label: plainLabel("AVeryLongNodeId"),
        shape,
        style: { frame: [], text: [] },
        parentId: null,
        interaction: null,
      },
    ],
    edges: [],
    subgraphs: [],
    accTitle: null,
    accDescr: null,
    timeline: { totalSteps: 0, entries: [] },
  };
  const node = layoutGraph(graph, { measureText: fakeMeasurer }).nodes[0]!;
  return [node.width, node.height];
}

/** What `shape` draws in the box `10,20 width x height`, labelled "x". */
function drawn(shape: NodeShape, width: number, height: number) {
  const label = plainLabel("x");
  const graph: PositionedGraph = {
    direction: "TB",
    nodes: [
      {
        id: "A",
        label,
        labelBox: layoutLabel(label, { measure: (t: string) => ({ width: t.length * 8, height: 20 }) }),
        shape,
        x: 10,
        y: 20,
        width,
        height,
        style: { frame: [{ property: "fill", value: "#fff" }], text: [] },
        parentId: null,
        interaction: null,
      },
    ],
    edges: [],
    subgraphs: [],
    accTitle: null,
    accDescr: null,
    width: width + 20,
    height: height + 40,
  };
  const group = renderToSVG(graph).querySelector('g.siren-node[data-siren-id="A"]')!;
  const frames = Array.from(group.querySelectorAll(".siren-node-frame"));
  return {
    frames,
    tags: frames.map((frame) => frame.tagName),
    d: frames.map((frame) => frame.getAttribute("d")),
    classes: frames.map((frame) => frame.getAttribute("class")),
    styles: frames.map((frame) => frame.getAttribute("style")),
    texts: group.querySelectorAll("text").length,
  };
}

describe("a fork (`fork`, `join`)", () => {
  it("is a 70 x 10 bar across the flow top to bottom, whatever its label", () => {
    // `forkJoin`: `width = max(70, …)`, `height = max(10, …)`.
    expect(boxOf("fork", "TB")).toEqual([70, 10]);
    expect(boxOf("fork", "BT")).toEqual([70, 10]);
  });

  it("stands upright, 10 x 70, when the flow runs left to right or right to left", () => {
    expect(boxOf("fork", "LR")).toEqual([10, 70]);
    expect(boxOf("fork", "RL")).toEqual([10, 70]);
  });

  it("draws its bar with square corners, and no text", () => {
    const node = drawn("fork", 70, 10);
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual(["M10,20 L80,20 L80,30 L10,30 Z"]);
    expect(node.texts).toBe(0);
  });
});

describe("an hourglass (`hourglass`, `collate`)", () => {
  it("is 30 x 30 whatever its label", () => {
    expect(boxOf("hourglass")).toEqual([30, 30]);
    expect(boxOf("hourglass", "LR")).toEqual([30, 30]);
  });

  it("draws two triangles meeting at its centre, top edge and bottom edge closed, and no text", () => {
    // `hourglass`: the points `0,0 w,0 0,h w,h` in that order.
    const node = drawn("hourglass", 30, 30);
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual(["M10,20 L40,20 L10,50 L40,50 Z"]);
    expect(node.texts).toBe(0);
  });
});

describe("a lightning bolt (`bolt`, `com-link`, `lightning-bolt`)", () => {
  it("is 35 wide and 70 tall whatever its label", () => {
    expect(boxOf("bolt")).toEqual([35, 70]);
  });

  it("zigzags from its top right corner to its bottom left one, 7px apart at the middle, and draws no text", () => {
    // `lightningBolt`: `width = height = 35`, `gap = 7`, the points
    // `w,0  0,h+gap/2  w-2gap,h+gap/2  0,2h  w,h-gap/2  2gap,h-gap/2`.
    const node = drawn("bolt", 35, 70);
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual(["M45,20 L10,58.5 L31,58.5 L10,90 L45,51.5 L24,51.5 Z"]);
    expect(node.texts).toBe(0);
  });
});

/** Each `<circle>` frame as `cx,cy r`. */
const circles = (frames: Element[]) =>
  frames.map((frame) => `${frame.getAttribute("cx")},${frame.getAttribute("cy")} ${frame.getAttribute("r")}`);

describe("a small circle (`sm-circ`, `start`) and a framed one (`fr-circ`, `stop`)", () => {
  it("are 14 x 14 whatever their label", () => {
    // `stateStart` and `stateEnd`: `width = height = 14`.
    expect(boxOf("small-circle")).toEqual([14, 14]);
    expect(boxOf("framed-circle")).toEqual([14, 14]);
  });

  it("draw a circle filling the box — the framed one with a second, 5px across, at its centre — and no text", () => {
    // `stateEnd`: an inner circle `width x 5/14` across, so 5 in a 14 box.
    const small = drawn("small-circle", 14, 14);
    expect(small.tags).toEqual(["circle"]);
    expect(circles(small.frames)).toEqual(["17,27 7"]);
    expect(small.texts).toBe(0);
    const framed = drawn("framed-circle", 14, 14);
    expect(framed.tags).toEqual(["circle", "circle"]);
    expect(circles(framed.frames)).toEqual(["17,27 7", "17,27 2.5"]);
    expect(framed.classes).toEqual(["siren-node-frame", "siren-node-frame"]);
    expect(framed.texts).toBe(0);
  });
});

describe("a filled circle (`f-circ`, `junction`) and an anchor (`anchor`, undocumented)", () => {
  it("are 14 x 14 and 2 x 2 whatever their label", () => {
    // `filledCircle`: `radius = 7`; `anchor`: `radius = 1`.
    expect(boxOf("filled-circle")).toEqual([14, 14]);
    expect(boxOf("anchor")).toEqual([2, 2]);
  });

  it("draw a circle filling the box in the colour the node's lines are drawn in, and no text", () => {
    const filled = drawn("filled-circle", 14, 14);
    expect(filled.tags).toEqual(["circle"]);
    expect(circles(filled.frames)).toEqual(["17,27 7"]);
    expect(filled.classes).toEqual(["siren-node-frame siren-node-ink"]);
    expect(filled.texts).toBe(0);
    const anchor = drawn("anchor", 2, 2);
    expect(circles(anchor.frames)).toEqual(["11,21 1"]);
    expect(anchor.classes).toEqual(["siren-node-frame siren-node-ink"]);
    expect(anchor.texts).toBe(0);
  });
});

describe("a crossed circle (`cross-circ`, `summary`)", () => {
  it("is 60 x 60 whatever its label", () => {
    // `crossedCircle`: `radius = 30`.
    expect(boxOf("crossed-circle")).toEqual([60, 60]);
  });

  it("draws a circle filling the box and a cross of its two diameters at 45 degrees, and no text", () => {
    const node = drawn("crossed-circle", 60, 60);
    expect(node.tags).toEqual(["circle", "path"]);
    expect(circles(node.frames.slice(0, 1))).toEqual(["40,50 30"]);
    // `createLine(r)`: from one point on the circle at 45 degrees to the
    // opposite one, twice — `r cos 45` off the centre on each axis.
    const a = 30 * Math.SQRT1_2;
    const numbers = node.d[1]!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const expected = [40 - a, 50 + a, 40 + a, 50 - a, 40 + a, 50 + a, 40 - a, 50 - a];
    expect(numbers).toHaveLength(8);
    numbers.forEach((n, i) => expect(n).toBeCloseTo(expected[i]!, 9));
    expect(node.d[1]!.replace(/-?\d+(?:\.\d+)?/g, "n")).toBe("Mn,n Ln,n Mn,n Ln,n");
    expect(node.texts).toBe(0);
  });
});

describe("a choice (`choice`, undocumented)", () => {
  it("is 28 x 28 whatever its label", () => {
    expect(boxOf("choice")).toEqual([28, 28]);
  });

  it("draws a diamond touching the middle of each side, and no text", () => {
    // `choice`: the points `0,s/2  s/2,0  0,-s/2  -s/2,0` about the centre.
    const node = drawn("choice", 28, 28);
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual(["M24,48 L38,34 L24,20 L10,34 Z"]);
    expect(node.texts).toBe(0);
  });
});

describe("a fork inside a subgraph with a direction of its own", () => {
  it("takes the direction of the nearest enclosing subgraph that names one, as Mermaid's `resolveNodeDir` does", () => {
    // Measured in Chrome: a fork in `subgraph … direction LR` of a
    // top-to-bottom flowchart stands upright.
    const graph: GraphModel = {
      direction: "TB",
      nodes: [
        { id: "F", label: plainLabel("F"), shape: "fork", style: { frame: [], text: [] }, parentId: "subgraph:2", interaction: null },
        { id: "G", label: plainLabel("G"), shape: "fork", style: { frame: [], text: [] }, parentId: null, interaction: null },
      ],
      edges: [],
      subgraphs: [
        { id: "subgraph:1", label: plainLabel("outer"), parentId: null, direction: "LR" },
        { id: "subgraph:2", label: plainLabel("inner"), parentId: "subgraph:1", direction: null },
      ],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
    };
    const byId = Object.fromEntries(
      layoutGraph(graph, { measureText: fakeMeasurer }).nodes.map((node) => [node.id, [node.width, node.height]]),
    );
    expect(byId).toEqual({ F: [10, 70], G: [70, 10] });
  });
});
