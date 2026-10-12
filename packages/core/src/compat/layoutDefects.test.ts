import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "../index";
import {
  edgesThroughNodes,
  overlappingFrames,
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

  it("reports how many lines pass through a node that is not their own — reported, not bounded", () => {
    const crossings = edgesThroughNodes(svg);
    console.info(
      `garden-network: ${crossings.length} edge/node crossings`,
      crossings.map(({ edge, node }) => `${edge} through ${node}`),
    );
  });
});
