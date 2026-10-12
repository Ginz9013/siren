import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CURVE } from "../curve/curve";
import { buildGraphModel } from "../graph-model/buildGraphModel";
import { CONNECTOR_LABEL_SCALE } from "../label/label";
import { render } from "../index";
import { parseSiren } from "../parser/parseSiren";
import { connectorPathData } from "../renderer/connectorCurve";
import {
  edgesThroughNodes,
  labelsOverNodes,
  overlappingFrames,
  overlappingLabels,
  straightBoundaryCrossingEdges,
} from "./layoutDefects";

const SVG_NS = "http://www.w3.org/2000/svg";

/** An `<svg>` holding exactly the markup given — a picture with known answers. */
function svgOf(markup: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.innerHTML = markup;
  return svg;
}

/** A subgraph frame as the flowchart renderer draws one. */
function frame(title: string, x: number, y: number, width: number, height: number): string {
  return (
    `<g class="siren-subgraph"><rect class="siren-subgraph-frame" x="${x}" y="${y}" ` +
    `width="${width}" height="${height}"/><text class="siren-subgraph-label">${title}</text></g>`
  );
}

/**
 * A flowchart edge as the renderer draws one: its route as the default
 * `basis` curve in `d`, and the route itself in `data-siren-points`.
 */
function edge(id: string, points: [number, number][]): string {
  const route = points.map(([x, y]) => ({ x, y }));
  return (
    `<path class="siren-edge" data-siren-id="${id}" d="${connectorPathData(route, DEFAULT_CURVE)}" ` +
    `data-siren-points="${points.map(([x, y]) => `${x},${y}`).join(" ")}"/>`
  );
}

/** A flowchart node drawn with a `<rect>` frame. */
function box(id: string, x: number, y: number, width: number, height: number): string {
  return (
    `<g class="siren-node" data-siren-id="${id}"><rect class="siren-node-frame" ` +
    `x="${x}" y="${y}" width="${width}" height="${height}"/></g>`
  );
}

describe("overlappingFrames", () => {
  it("names each pair of frames that overlap without one holding the other", () => {
    const svg = svgOf(
      frame("one", 0, 0, 100, 100) +
        // Overlaps `one` by 20 on each axis.
        frame("two", 80, 80, 100, 100) +
        // Touches `one` along an edge only — no shared interior.
        frame("three", 100, 0, 50, 50) +
        // Wholly inside `two`: nesting, not overlap.
        frame("inner", 120, 120, 20, 20),
    );

    expect(overlappingFrames(svg)).toEqual([["one", "two"]]);
  });
});

/**
 * Who belongs to which group, as the model says: `A` and `B` are members of
 * the subgraph titled "one", drawn at 0..100 by 0..100; `X` and `Y` are
 * outside it.
 */
const ONE = "subgraph:1";
function grouping(edges: { id: string; from: string; to: string }[]) {
  return {
    nodes: [
      { id: "A", parentId: ONE },
      { id: "B", parentId: ONE },
      { id: "X", parentId: null },
      { id: "Y", parentId: null },
    ],
    subgraphs: [{ id: ONE, parentId: null }],
    edges,
  };
}

describe("straightBoundaryCrossingEdges", () => {
  it("names the edges with exactly one end among a group's members drawn as two points", () => {
    const svg = svgOf(
      frame("one", 0, 0, 100, 100) +
        edge("A-X", [[50, 50], [150, 50]]) +
        edge("B-X", [[50, 50], [50, 120], [150, 120]]) +
        edge("A-B", [[10, 10], [90, 90]]) +
        edge("X-Y", [[200, 0], [300, 0]]),
    );
    const members = grouping([
      { id: "A-X", from: "A", to: "X" },
      { id: "B-X", from: "B", to: "X" },
      { id: "A-B", from: "A", to: "B" },
      { id: "X-Y", from: "X", to: "Y" },
    ]);

    expect(straightBoundaryCrossingEdges(svg, members)).toEqual(["A-X"]);
  });

  it("does not name a straight edge from outside that names the group itself", () => {
    // Neither end is among the group's members: the group keeps its
    // direction, and dagre routes such an edge as one between two frames.
    const svg = svgOf(
      frame("one", 0, 0, 100, 100) + edge(`X-${ONE}`, [[150, 50], [100, 50]]),
    );
    const members = grouping([{ id: `X-${ONE}`, from: "X", to: ONE }]);

    expect(straightBoundaryCrossingEdges(svg, members)).toEqual([]);
  });

  it("names a straight edge from a member to its own group", () => {
    // Exactly one end — the member — is among the group's members, though
    // the whole line lies within the frame.
    const svg = svgOf(
      frame("one", 0, 0, 100, 100) + edge(`A-${ONE}`, [[50, 50], [100, 50]]),
    );
    const members = grouping([{ id: `A-${ONE}`, from: "A", to: ONE }]);

    expect(straightBoundaryCrossingEdges(svg, members)).toEqual([`A-${ONE}`]);
  });
});

describe("edgesThroughNodes", () => {
  it("names each line drawn through a node that is not one of its own ends", () => {
    const svg = svgOf(
      box("A", 0, 0, 40, 20) +
        box("B", 0, 100, 40, 20) +
        // Between A and B, in the line's way.
        box("C", 0, 50, 40, 20) +
        // Beside the line, clear of it.
        box("D", 130, 50, 40, 20) +
        // A diamond, drawn as a `<path>`: its extent is 50..90 by 40..80.
        `<g class="siren-node" data-siren-id="P"><path class="siren-node-frame" ` +
        `d="M70,40 L90,60 L70,80 L50,60 Z"/></g>` +
        edge("A-B", [[20, 20], [20, 100]]) +
        edge("through-P", [[70, 0], [70, 200]]) +
        // Runs along D's left side: touching the outline is not passing through.
        edge("along-D", [[130, 0], [130, 200]]),
    );

    expect(edgesThroughNodes(svg)).toEqual([
      { edge: "A-B", node: "C" },
      { edge: "through-P", node: "P" },
    ]);
  });
});

describe("edgesThroughNodes under a curve", () => {
  it("follows the edge's route, not the coordinates written in its curved d", () => {
    // The route runs down x = 20 and then along y = 140. Its `basis` d,
    // `M20,20 L20,40 C20,60 20,100 40,120 C60,140 100,140 120,140 L140,140`,
    // read as `M`/`L` points would put a corner at (0,100)–(0,120), where
    // no line is drawn: through Y, beside the route.
    const svg = svgOf(
      box("A", 0, 0, 40, 20) +
        box("B", 140, 130, 40, 20) +
        // On the route's vertical run.
        box("X", 0, 70, 40, 20) +
        // On x = 0, 20 left of the route: clear of it.
        box("Y", -10, 105, 15, 10) +
        edge("bend", [[20, 20], [20, 140], [140, 140]]),
    );

    expect(edgesThroughNodes(svg)).toEqual([{ edge: "bend", node: "X" }]);
  });
});

/** A flowchart edge label as the renderer draws one: centred on its anchor. */
function label(id: string, x: number, y: number, ...rows: string[]): string {
  const body =
    rows.length === 1
      ? rows[0]
      : rows.map((row) => `<tspan class="siren-label-row">${row}</tspan>`).join("");
  return `<text class="siren-edge-label" data-siren-id="${id}" x="${x}" y="${y}">${body}</text>`;
}

/**
 * A row's size as a test measurer gives it: 10 per character, 20 tall — the
 * label's box is not in the SVG, so the caller says how big a row is drawn.
 */
const rowSize = (text: string) => ({ width: text.length * 10, height: 20 });

describe("labelsOverNodes", () => {
  it("names each label whose drawn box shares interior with a node", () => {
    const svg = svgOf(
      box("A", 0, 0, 40, 20) +
        box("B", 100, 0, 40, 20) +
        // 60 x 20 centred at (50, 10): 20..80 by 0..20 — over A's right end.
        label("over-A", 50, 10, "abcdef") +
        // 40 x 20 centred at (70, 50): 50..90 by 40..60 — clear of both.
        label("clear", 70, 50, "abcd") +
        // 20 x 20 centred at (90, 10): 80..100 — touches B's left side only.
        label("touching-B", 90, 10, "ab") +
        // Two rows, 40 x 40 centred at (120, 35): 100..140 by 15..55 —
        // reaches 5 into B's bottom.
        label("two-rows", 120, 35, "abcd", "ab"),
    );

    expect(labelsOverNodes(svg, rowSize)).toEqual([
      { label: "over-A", node: "A" },
      { label: "two-rows", node: "B" },
    ]);
  });
});

describe("overlappingLabels", () => {
  it("names each pair of labels whose drawn boxes share interior", () => {
    const svg = svgOf(
      // 0..40 by 0..20.
      label("one", 20, 10, "abcd") +
        // 30..70 by 10..30: overlaps `one`.
        label("two", 50, 20, "abcd") +
        // 70..110 by 0..20: touches `two` along x = 70 only.
        label("three", 90, 10, "abcd") +
        // Far away.
        label("four", 300, 300, "abcd"),
    );

    expect(overlappingLabels(svg, rowSize)).toEqual([["one", "two"]]);
  });
});

/**
 * Bound once rather than written inline: Vite rewrites the literal
 * `new URL("...", import.meta.url)` form into a dev-server URL that
 * `readFileSync` rejects (the same reason `index.test.ts` gives).
 */
const TEST_FILE_URL = import.meta.url;

/**
 * The garden-network architecture diagram, shared with the parity script — five
 * subgraphs each declaring `direction LR`, every one of them crossed by an
 * edge. Before the boundary-crossing rule it drew overlapping frames and 26
 * of its 27 edges as straight segments through other boxes.
 */
describe("the garden-network diagram, under the default measurer", () => {
  const source = readFileSync(
    new URL("../../scripts/parity-fixtures/garden-network.mmd", TEST_FILE_URL),
    "utf8",
  );
  const result = render(source, document.createElement("div"));
  const svg = result.svg!;
  // Who belongs to which subgraph — the model's, which the picture does not record.
  const parsed = parseSiren(source).document!;
  const built = buildGraphModel(parsed);
  if (built.kind !== "flowchart") throw new Error("garden-network.mmd is not a flowchart");
  const grouping = built.model;

  it("renders with no diagnostics", () => {
    expect(result.diagnostics).toEqual([]);
    expect(svg).not.toBeNull();
  });

  it("draws no two frames overlapping", () => {
    expect(overlappingFrames(svg)).toEqual([]);
  });

  it("draws no boundary-crossing edge as a two-point straight line", () => {
    expect(straightBoundaryCrossingEdges(svg, grouping)).toEqual([]);
  });

  /**
   * A row of an edge label as the default measurer sizes it, at the 12px it
   * is drawn at: `index.ts`'s fallback answers 8 per character plus 16 by
   * 24 plus 8, for 14px text, and an edge label is measured at 12/14 of
   * that (`atConnectorLabelSize`).
   */
  const drawnRow = (text: string) => ({
    width: (text.length * 8 + 16) * CONNECTOR_LABEL_SCALE,
    height: (24 + 8) * CONNECTOR_LABEL_SCALE,
  });

  it("draws no edge label over a node", () => {
    expect(labelsOverNodes(svg, drawnRow)).toEqual([]);
  });

  it("draws no two edge labels over each other", () => {
    expect(overlappingLabels(svg, drawnRow)).toEqual([]);
  });

  it("reports how many lines pass through a node that is not their own — reported, not bounded", () => {
    const crossings = edgesThroughNodes(svg);
    console.info(
      `garden-network: ${crossings.length} edge/node crossings`,
      crossings.map(({ edge, node }) => `${edge} through ${node}`),
    );
  });
});
