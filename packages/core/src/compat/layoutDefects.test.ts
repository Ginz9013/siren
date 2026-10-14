import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Curve } from "../curve/curve";
import { buildGraphModel } from "../graph-model/buildGraphModel";
import { render } from "../index";
import { parseSiren } from "../parser/parseSiren";
import { connectorPathData } from "../renderer/connectorCurve";
import { labelRows } from "./labelCorpus";
import { measurerPadding } from "../label/layoutLabel";
import type { TextMeasurer } from "../contracts";
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
 * The curve these hand-built fixtures draw their routes with: `basis`, the
 * flowchart's default when the fixtures were written. Only the `d` it
 * produces depends on it; every check here reads `data-siren-points`.
 */
const FIXTURE_CURVE: Curve = "basis";

/**
 * A flowchart edge as the renderer draws one: its route as the fixtures'
 * `basis` curve in `d`, and the route itself in `data-siren-points`.
 */
function edge(id: string, points: [number, number][]): string {
  const route = points.map(([x, y]) => ({ x, y }));
  return (
    `<path class="siren-edge" data-siren-id="${id}" d="${connectorPathData(route, FIXTURE_CURVE)}" ` +
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
 *
 * Spelled the way a real model spells them (ADR-0010): the subgraph's id is
 * generated, `subgraph:1`, while an edge naming it is id'd by the author's
 * handle for it, `one` — so no edge id holds a colon.
 */
const ONE = "subgraph:1";
function membershipOf(edges: { id: string; from: string; to: string }[]) {
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
    const members = membershipOf([
      { id: "A-X", from: "A", to: "X" },
      { id: "B-X", from: "B", to: "X" },
      { id: "A-B", from: "A", to: "B" },
      { id: "X-Y", from: "X", to: "Y" },
    ]);

    expect(straightBoundaryCrossingEdges(svg, members)).toEqual(["A-X"]);
  });

  it("does not name a straight edge from outside that names the group itself", () => {
    // Neither end is among the group's members: the group keeps its
    // direction, and the layout routes such an edge as one between two frames.
    const svg = svgOf(
      frame("one", 0, 0, 100, 100) + edge("X-one", [[150, 50], [100, 50]]),
    );
    const members = membershipOf([{ id: "X-one", from: "X", to: ONE }]);

    expect(straightBoundaryCrossingEdges(svg, members)).toEqual([]);
  });

  it("names a straight edge from a member to its own group", () => {
    // Exactly one end — the member — is among the group's members, though
    // the whole line lies within the frame.
    const svg = svgOf(
      frame("one", 0, 0, 100, 100) + edge("A-one", [[50, 50], [100, 50]]),
    );
    const members = membershipOf([{ id: "A-one", from: "A", to: ONE }]);

    expect(straightBoundaryCrossingEdges(svg, members)).toEqual(["A-one"]);
  });

  it("counts a nested group as its enclosing group's descendant, not its own", () => {
    // `inner` (subgraph:2, 20..80) is nested in `outer` (subgraph:1,
    // 0..100); `M` is a member of `inner`, `X` is outside both.
    const OUTER = "subgraph:1";
    const INNER = "subgraph:2";
    const svg = svgOf(
      frame("outer", 0, 0, 100, 100) +
        frame("inner", 20, 20, 60, 60) +
        // One end, `inner`, is among `outer`'s descendants; for `inner`
        // itself it has neither end. A boundary-crossing edge of `outer`.
        edge("X-inner", [[150, 50], [100, 50]]) +
        // One end, `M`, is among `inner`'s descendants; for `outer` both
        // ends are. A boundary-crossing edge of `inner` only.
        edge("M-inner", [[50, 50], [80, 50]]),
    );
    const members = {
      nodes: [
        { id: "M", parentId: INNER },
        { id: "X", parentId: null },
      ],
      subgraphs: [
        { id: OUTER, parentId: null },
        { id: INNER, parentId: OUTER },
      ],
      edges: [
        { id: "X-inner", from: "X", to: INNER },
        { id: "M-inner", from: "M", to: INNER },
      ],
    };

    expect(straightBoundaryCrossingEdges(svg, members)).toEqual(["X-inner", "M-inner"]);
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

/**
 * A flowchart edge label as the renderer draws one: its background over the
 * box `width` x `height` centred on its anchor, then its rows' text there.
 */
function drawnLabel(id: string, x: number, y: number, width: number, height: number, rows: string[]): string {
  const body =
    rows.length === 1
      ? rows[0]
      : rows.map((row) => `<tspan class="siren-label-row">${row}</tspan>`).join("");
  return (
    `<rect class="siren-connector-label-background" data-siren-id="${id}" ` +
    `x="${x - width / 2}" y="${y - height / 2}" width="${width}" height="${height}"/>` +
    `<text class="siren-edge-label" data-siren-id="${id}" x="${x}" y="${y}">${body}</text>`
  );
}

/**
 * A label whose box is just its rows, as an unwrapped label's is: `rowSize`'s
 * widest row by its rows stacked.
 */
function label(id: string, x: number, y: number, ...rows: string[]): string {
  const sizes = rows.map(rowSize);
  const width = Math.max(...sizes.map((size) => size.width));
  const height = sizes.reduce((sum, size) => sum + size.height, 0);
  return drawnLabel(id, x, y, width, height, rows);
}

/** A row's size as a test measurer gives it: 10 per character, 20 tall. */
function rowSize(text: string) {
  return { width: text.length * 10, height: 20 };
}

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

    expect(labelsOverNodes(svg)).toEqual([
      { label: "over-A", node: "A" },
      { label: "two-rows", node: "B" },
    ]);
  });
});

describe("a wrapped label's box", () => {
  // A wrapped label's box is the wrap width and its padding, wider than its
  // widest row (the label-wrap ADR): what the label covers is the background
  // the renderer paints over that box, not its rows' text.
  it("is read off the label's background, wider than any of its rows", () => {
    const svg = svgOf(
      box("A", 0, 0, 40, 20) +
        // Rows `ab` / `cd`, 20 wide, centred at (80, 10): 70..90, clear of
        // A. The box is 100 by 40 around the same centre, 30..130 by
        // -10..30 — 10 into A's right end.
        drawnLabel("wrapped", 80, 10, 100, 40, ["ab", "cd"]),
    );

    expect(labelsOverNodes(svg)).toEqual([{ label: "wrapped", node: "A" }]);
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

    expect(overlappingLabels(svg)).toEqual([["one", "two"]]);
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
  const membership = built.model;

  it("renders with no diagnostics", () => {
    expect(result.diagnostics).toEqual([]);
    expect(svg).not.toBeNull();
  });

  it("draws no two frames overlapping", () => {
    expect(overlappingFrames(svg)).toEqual([]);
  });

  it("draws no boundary-crossing edge as a two-point straight line", () => {
    expect(straightBoundaryCrossingEdges(svg, membership)).toEqual([]);
  });

  it("draws no edge label over a node", () => {
    expect(labelsOverNodes(svg)).toEqual([]);
  });

  it("draws no two edge labels over each other", () => {
    expect(overlappingLabels(svg)).toEqual([]);
  });

  // T2: an edge label wraps at 150px of its 12px text, and the two checks
  // above read each label's whole box, its background, so they hold for the
  // wrapped label too. Under the default measurer (8 × 12/14 px a character)
  // 21 characters fit and 22 do not: `volunteer / plot-signup`, 23, is
  // garden-network's one edge label that wraps, broken at its spaces.
  it("wraps its one edge label wider than 150px of 12px text", () => {
    const wrapped = Array.from(svg.querySelectorAll("text.siren-edge-label"))
      .map((text) => labelRows(text))
      .filter((rows) => rows.length > 1);

    expect(wrapped).toEqual([["volunteer /", "plot-signup"]]);
  });

  // The label-wrap ADR: a node's label wraps at 175px of text, so no drawn
  // row of one holds more — except a single piece too long to break, which
  // overflows; garden-network has no such piece, so the exceptions are none. The
  // measurer's padding is outside the wrap width, and a node drawn as a
  // rectangle takes its label box unchanged, so its frame is no wider than
  // 175 and the padding.
  //
  // Read with a measurer of its own rather than the default's 8px a
  // character, so the bound is checked by measuring each drawn row the way
  // layout measured it: CJK twice as wide as Latin, as in a real font, and
  // the board's 24px of padding. Its padding is asked of the measurer, as
  // layout asks it.
  it("wraps every node's label to rows of no more than 175px of text, and no rectangle wider than that and its padding", () => {
    const proportional: TextMeasurer = {
      measure(text: string) {
        const wide = (character: string) => /[\u3000-\u9fff\uff00-\uffef]/.test(character);
        const width = Array.from(text).reduce((sum, character) => sum + (wide(character) ? 14 : 7), 0);
        return { width: width + 24, height: 32 };
      },
    };
    const padding = measurerPadding(proportional);
    const drawn = render(source, document.createElement("div"), { measureText: proportional }).svg!;
    const LONG_WORD_EXCEPTIONS: string[] = [];

    const tooWide = Array.from(drawn.querySelectorAll("g.siren-node")).flatMap((node) => {
      const id = node.getAttribute("data-siren-id")!;
      return labelRows(node.querySelector("text"))
        .filter((row) => proportional.measure(row).width - padding > 175 && !LONG_WORD_EXCEPTIONS.includes(id))
        .map((row) => `${id}: ${row}`);
    });
    expect(tooWide).toEqual([]);

    const wideRectangles = Array.from(drawn.querySelectorAll("g.siren-node rect.siren-node-frame"))
      .filter((rect) => Number(rect.getAttribute("width")) > 175 + padding * 2)
      .map((rect) => rect.closest("g.siren-node")!.getAttribute("data-siren-id"));
    expect(wideRectangles).toEqual([]);
    // And the labels did wrap: Tasks alone is far wider than 175px of text.
    expect(labelRows(drawn.querySelector('g.siren-node[data-siren-id="Tasks"] text')).length).toBeGreaterThan(1);
  });

  it("reports how many lines pass through a node that is not their own — reported, not bounded", () => {
    const crossings = edgesThroughNodes(svg);
    console.info(
      `garden-network: ${crossings.length} edge/node crossings`,
      crossings.map(({ edge, node }) => `${edge} through ${node}`),
    );
  });
});
