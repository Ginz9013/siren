import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "../index";
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

/** A flowchart edge as the renderer draws one: `M` then `L` per point. */
function edge(id: string, points: [number, number][]): string {
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  return `<path class="siren-edge" data-siren-id="${id}" d="${d}"/>`;
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

describe("straightBoundaryCrossingEdges", () => {
  it("names the edges with exactly one end in a frame that are drawn as two points", () => {
    const svg = svgOf(
      frame("one", 0, 0, 100, 100) +
        edge("out-straight", [[50, 50], [150, 50]]) +
        edge("out-bent", [[50, 50], [50, 120], [150, 120]]) +
        // An edge leaving the frame itself starts on its outline.
        edge("frame-straight", [[100, 50], [150, 50]]) +
        edge("inside", [[10, 10], [90, 90]]) +
        edge("outside", [[200, 0], [300, 0]]),
    );

    expect(straightBoundaryCrossingEdges(svg)).toEqual(["out-straight", "frame-straight"]);
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

  it("renders with no diagnostics", () => {
    expect(result.diagnostics).toEqual([]);
    expect(svg).not.toBeNull();
  });

  it("draws no two frames overlapping", () => {
    expect(overlappingFrames(svg)).toEqual([]);
  });

  it("draws no boundary-crossing edge as a two-point straight line", () => {
    expect(straightBoundaryCrossingEdges(svg)).toEqual([]);
  });

  /**
   * A row of an edge label as the default measurer sizes it, at the 12px it
   * is drawn at: `index.ts`'s fallback answers 8 per character plus 16 by
   * 24 plus 8, for 14px text, and an edge label is measured at 12/14 of
   * that (`atEdgeLabelSize`).
   */
  const drawnRow = (text: string) => ({
    width: ((text.length * 8 + 16) * 12) / 14,
    height: ((24 + 8) * 12) / 14,
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
