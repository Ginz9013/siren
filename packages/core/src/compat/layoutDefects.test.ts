import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Curve } from "../curve/curve";
import { buildGraphModel } from "../graph-model/buildGraphModel";
import { render } from "../index";
import { SHAPES } from "../layout/shapes/shapeTable";
import { NODE_DATA_SHAPES } from "../parser/flowchartNodeData";
import { parseSiren } from "../parser/parseSiren";
import { connectorPathData } from "../renderer/connectorCurve";
import { labelRows } from "./labelCorpus";
import { measurerPadding } from "../label/layoutLabel";
import type { TextMeasurer } from "../contracts";
import {
  edgesThroughNodes,
  endsOffOutline,
  endsOffTheirFigures,
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

describe("endsOffOutline", () => {
  it("names an end that stops on a drawn shape's box but off the shape itself", () => {
    const svg = svgOf(
      box("A", 0, 0, 40, 20) +
        // A diamond in the box 100..140 by 0..40, drawn as a `<path>`.
        `<g class="siren-node" data-siren-id="D"><path class="siren-node-frame" ` +
        `d="M120,0 L140,20 L120,40 L100,20 Z"/></g>` +
        // Ends on the diamond's left corner: on the figure.
        edge("A-D", [[40, 10], [100, 20]]) +
        // Ends on the box's top side above the diamond's left slope: on the
        // box, nowhere near the figure.
        edge("over-D", [[20, 0], [20, -30], [105, -30], [105, 0]]) +
        // Ends on a rectangle's side: a rectangle's box is its figure.
        edge("into-A", [[20, -30], [20, 0]]),
    );

    expect(endsOffOutline(svg)).toEqual([{ edge: "over-D", node: "D" }]);
  });

  it("reads a node's figure as every frame it is drawn with, a circle's curve included", () => {
    const svg = svgOf(
      `<g class="siren-node" data-siren-id="C"><circle class="siren-node-frame" cx="50" cy="50" r="10"/></g>` +
        // Within a tenth of a pixel of the circle, at 45 degrees.
        edge("on-C", [[100, 100], [57.1, 57.1]]) +
        // The box's corner: on the box, 4px off the circle.
        edge("corner-C", [[100, 0], [60, 40]]),
    );

    expect(endsOffOutline(svg)).toEqual([{ edge: "corner-C", node: "C" }]);
  });

  it("checks a node drawn with a square rect and a part sticking out of it, whose box is more than the rect", () => {
    const svg = svgOf(
      // A square rect 0..40 by 0..20 and a point 40..60 off its right side:
      // the node's box is 0..60 by 0..20.
      `<g class="siren-node" data-siren-id="P"><rect class="siren-node-frame" x="0" y="0" width="40" height="20"/>` +
        `<polygon class="siren-node-frame" points="40,0 60,10 40,20"/></g>` +
        // A rect drawn with a bar inside it: its box is the rect's.
        `<g class="siren-node" data-siren-id="S"><rect class="siren-node-frame" x="100" y="0" width="40" height="20"/>` +
        `<line class="siren-node-frame" x1="105" y1="0" x2="105" y2="20"/></g>` +
        // On the rect's top side: on the figure.
        edge("onto-rect", [[20, -30], [20, 0]]) +
        // On the box's top side above the point's slope, 6.7px off it.
        edge("over-point", [[55, -30], [55, 0]]) +
        edge("onto-S", [[120, -30], [120, 0]]),
    );

    expect(endsOffOutline(svg)).toEqual([{ edge: "over-point", node: "P" }]);
  });
});

/** A state-diagram connector as the renderer draws one, by class: its route in `data-siren-points`. */
function connector(className: string, id: string | null, points: [number, number][]): string {
  return (
    `<path class="${className}"${id === null ? "" : ` data-siren-id="${id}"`} ` +
    `data-siren-points="${points.map(([x, y]) => `${x},${y}`).join(" ")}"/>`
  );
}

describe("endsOffOutline in a state diagram", () => {
  it("reads a choice's diamond, a start's disc and an end's ring, and the lines that meet them", () => {
    const svg = svgOf(
      // A start disc in the box 0..20 by 0..20, with a note hanging off it.
      `<g class="siren-state" data-siren-id="start:1">` +
        `<circle class="siren-state-start" cx="10" cy="10" r="10"/>` +
        connector("siren-note-link", null, [[0, 10], [-40, 10]]) +
        `<rect class="siren-note-frame" x="-80" y="0" width="40" height="20"/></g>` +
        // A choice's diamond in the box 100..140 by 0..40.
        `<g class="siren-state" data-siren-id="Pick"><polygon class="siren-state-frame" ` +
        `points="120,0 140,20 120,40 100,20"/></g>` +
        // An end's ring in the box 200..220 by 0..20.
        `<g class="siren-state" data-siren-id="end:1">` +
        `<circle class="siren-state-end" cx="210" cy="10" r="10"/>` +
        `<circle class="siren-state-end-inner" cx="210" cy="10" r="5"/></g>` +
        // A plain state, its box its figure.
        `<g class="siren-state" data-siren-id="Idle"><rect class="siren-state-frame" x="0" y="100" width="40" height="20"/></g>` +
        // From the disc's right into the diamond's box, some 6px above its
        // top-left slope: off the figure.
        connector("siren-transition-line", "start-Pick", [[20, 10], [107, 5]]) +
        // From the diamond's right corner to the ring's outer circle: on both.
        connector("siren-transition-line", "Pick-end", [[140, 20], [200, 10]]) +
        // From the plain state's top to the disc's bottom: on both.
        connector("siren-transition-line", "Idle-start", [[10, 100], [10, 20]]),
    );

    expect(endsOffOutline(svg)).toEqual([{ edge: "start-Pick", node: "Pick" }]);
  });

  it("names a note's connector that stops on a start's box but off its disc", () => {
    const svg = svgOf(
      `<g class="siren-state" data-siren-id="start:1">` +
        `<circle class="siren-state-start" cx="10" cy="10" r="10"/>` +
        connector("siren-note-link", null, [[0, 0], [-40, 0]]) +
        `<rect class="siren-note-frame" x="-80" y="-10" width="40" height="20"/></g>`,
    );

    expect(endsOffOutline(svg)).toEqual([{ edge: "note on start:1", node: "start:1" }]);
  });
});

/** A flowchart node of `shape` drawn with one `<path>` frame. */
function shaped(id: string, shape: string, d: string): string {
  return `<g class="siren-node" data-siren-id="${id}" data-siren-shape="${shape}"><path class="siren-node-frame" d="${d}"/></g>`;
}

describe("endsOffOutline, where a shape's end is off its figure on purpose", () => {
  it("passes an end on an hourglass's open left or right side, and no other end off it", () => {
    // Two triangles meeting at the pinch: drawn along the top and the bottom
    // and across both diagonals, with nothing down either side.
    const svg = svgOf(
      shaped("H", "hourglass", "M0,0 L30,0 L0,30 L30,30 Z") +
        edge("right", [[60, 15], [30, 15]]) +
        edge("left", [[-30, 15], [0, 15]]) +
        edge("inside", [[5, -30], [5, 15]]),
    );

    expect(endsOffOutline(svg)).toEqual([{ edge: "inside", node: "H" }]);
  });

  it("passes every end on a brace, which meets the box it stands in", () => {
    const brace = "M10,0 L5,5 L5,15 L0,20 L5,25 L5,35 L10,40";
    const svg = svgOf(
      shaped("L", "brace-left", brace) +
        shaped("R", "brace-right", brace.replace(/(\d+),/g, (_, x) => `${Number(x) + 100},`)) +
        shaped("B", "braces", brace.replace(/(\d+),/g, (_, x) => `${Number(x) + 200},`)) +
        // The same figure as some other shape: counted.
        shaped("O", "bolt", brace.replace(/(\d+),/g, (_, x) => `${Number(x) + 300},`)) +
        edge("to-L", [[-30, 5], [0, 5]]) +
        edge("to-R", [[70, 5], [100, 5]]) +
        edge("to-B", [[170, 5], [200, 5]]) +
        edge("to-O", [[270, 5], [300, 5]]),
    );

    expect(endsOffOutline(svg)).toEqual([{ edge: "to-O", node: "O" }]);
  });

  it("passes an end on a bang only where its drawn outline crosses itself", () => {
    const svg = svgOf(
      // A bow tie: its two diagonals cross, its top and bottom are not drawn.
      shaped("X", "bang", "M0,0 L20,20 L20,0 L0,20 Z") +
        // A triangle: no crossing.
        shaped("T", "bang", "M100,0 L120,10 L100,20 Z") +
        edge("to-X", [[10, -30], [10, 0]]) +
        edge("to-T", [[120, -30], [120, 0]]),
    );

    expect(endsOffOutline(svg)).toEqual([{ edge: "to-T", node: "T" }]);
  });

  it("passes an end on a brace only on the box it stands in, not inside it", () => {
    // Drawn over 0..10 by 0..40, its stem down x = 5 and its point at (0,20).
    const svg = svgOf(
      shaped("B", "braces", "M10,0 L5,5 L5,15 L0,20 L5,25 L5,35 L10,40") +
        // On the box's top, 5px from the curl: on the box.
        edge("onto-box", [[3, -30], [3, 0]]) +
        // 2px in from the box's right side, 5.8px from the stem's bend.
        edge("inside-box", [[60, 20], [8, 20]]),
    );

    expect(endsOffOutline(svg)).toEqual([{ edge: "inside-box", node: "B" }]);
  });

  it("passes an end on a self-crossing bang only on its box or no deeper than its scallops dip", () => {
    // A bow tie whose diagonals cross at (10,10), over 0..20 by 0..20, its
    // top drawn as a scallop dipping 3px to (10,3).
    const svg = svgOf(
      shaped("X", "bang", "M0,0 L10,3 L20,0 L0,20 L20,20 Z") +
        // On the box's top, 2.9px from the scallop.
        edge("onto-box", [[10, -30], [10, 0]]) +
        // 2.8px from the diagonals: no further from the outline than the scallop dips.
        edge("in-scallop", [[10, -30], [10, 6]]) +
        // 5.7px from either diagonal and 2px in from the box's left side.
        edge("deep", [[-30, 10], [2, 10]]),
    );

    expect(endsOffOutline(svg)).toEqual([{ edge: "deep", node: "X" }]);
  });
});

describe("endsOffTheirFigures", () => {
  it("names an end that stops short of the figure of the node it belongs to, a rectangle's included", () => {
    const svg = svgOf(
      `<g class="siren-node" data-siren-id="C"><circle class="siren-node-frame" cx="50" cy="50" r="10"/></g>` +
        `<g class="siren-node" data-siren-id="D"><path class="siren-node-frame" d="M120,0 L140,20 L120,40 L100,20 Z"/></g>` +
        box("R", 0, 100, 40, 20) +
        // Into the circle from below, stopping 3px short of its bottom.
        edge("R-C", [[20, 100], [20, 80], [50, 80], [50, 63]]) +
        // From the circle's right to 3px before the diamond's left tip.
        edge("C-D", [[60, 50], [97, 20]]) +
        // From the diamond's bottom tip onto the rectangle's right side.
        edge("D-R", [[120, 40], [40, 110]]) +
        // From the diamond's right tip to 3px above the rectangle.
        edge("D-R#2", [[140, 20], [140, 90], [10, 90], [10, 97]]),
    );
    const lines = [
      { id: "R-C", from: "R", to: "C" },
      { id: "C-D", from: "C", to: "D" },
      { id: "D-R", from: "D", to: "R" },
      { id: "D-R#2", from: "D", to: "R" },
    ];

    expect(endsOffTheirFigures(svg, lines)).toEqual([
      { edge: "R-C", node: "C" },
      { edge: "C-D", node: "D" },
      { edge: "D-R#2", node: "R" },
    ]);
  });
});

describe("endsOffTheirFigures in a state diagram, and at a group", () => {
  it("holds a transition to its states' figures and a note's connector to its state and its note", () => {
    const svg = svgOf(
      `<g class="siren-state" data-siren-id="start:1"><circle class="siren-state-start" cx="10" cy="10" r="10"/></g>` +
        // A state 0..40 by 100..120, its note 40px to its left.
        `<g class="siren-state" data-siren-id="Idle"><rect class="siren-state-frame" x="0" y="100" width="40" height="20"/>` +
        connector("siren-note-link", null, [[0, 110], [-40, 110]]) +
        `<rect class="siren-note-frame" x="-80" y="100" width="40" height="20"/></g>` +
        // A state 200..240 by 100..120, its connector stopping 3px short of its note.
        `<g class="siren-state" data-siren-id="Busy"><rect class="siren-state-frame" x="200" y="100" width="40" height="20"/>` +
        connector("siren-note-link", null, [[200, 110], [163, 110]]) +
        `<rect class="siren-note-frame" x="120" y="100" width="40" height="20"/></g>` +
        `<g class="siren-transition" data-siren-id="start:1-Idle">` +
        // From 3px below the disc to the state's top.
        connector("siren-transition-line", null, [[10, 23], [10, 100]]) +
        `</g>` +
        `<g class="siren-transition" data-siren-id="Idle-Busy">` +
        connector("siren-transition-line", null, [[40, 110], [200, 110]]) +
        `</g>`,
    );
    const transitions = [
      { id: "start:1-Idle", from: "start:1", to: "Idle" },
      { id: "Idle-Busy", from: "Idle", to: "Busy" },
    ];

    expect(endsOffTheirFigures(svg, transitions)).toEqual([
      { edge: "start:1-Idle", node: "start:1" },
      { edge: "note on Busy", node: "note on Busy" },
    ]);
  });

  it("holds a line that names a group to the group's frame", () => {
    const svg = svgOf(
      `<g class="siren-subgraph" data-siren-id="subgraph:1">` +
        `<rect class="siren-subgraph-frame" x="0" y="0" width="100" height="100"/>` +
        `<text class="siren-subgraph-label">one</text></g>` +
        box("X", 200, 40, 40, 20) +
        box("Y", 200, 140, 40, 20) +
        // Onto the frame's right side.
        edge("X-one", [[200, 50], [100, 50]]) +
        // 3px short of the frame's bottom.
        edge("Y-one", [[200, 150], [50, 150], [50, 103]]),
    );
    const edges = [
      { id: "X-one", from: "X", to: "subgraph:1" },
      { id: "Y-one", from: "Y", to: "subgraph:1" },
    ];

    expect(endsOffTheirFigures(svg, edges)).toEqual([{ edge: "Y-one", node: "subgraph:1" }]);
  });
});

describe("endsOffTheirFigures, where a shape's end is off its figure on purpose", () => {
  it("passes an end on a one-sided brace's box, which reaches past the side the brace is not drawn on", () => {
    // A left brace drawn over 0..10 by 0..40, its tips at x = 10: the box it
    // stands in shares its top and bottom and reaches right, past the tips,
    // over the label.
    const svg = svgOf(
      shaped("L", "brace-left", "M10,0 L5,5 L5,15 L0,20 L5,25 L5,35 L10,40") +
        box("A", 0, -80, 40, 20) +
        // Onto the box's top, right of the tips.
        edge("onto-top", [[25, -60], [25, 0]]) +
        // Onto the box's right side, which nothing drawn marks.
        edge("onto-side", [[30, -60], [30, -40], [80, -40], [80, 20], [40, 20]]) +
        // 3px above the box's top.
        edge("short-of-top", [[35, -60], [35, -3]]),
    );
    const edges = [
      { id: "onto-top", from: "A", to: "L" },
      { id: "onto-side", from: "A", to: "L" },
      { id: "short-of-top", from: "A", to: "L" },
    ];

    expect(endsOffTheirFigures(svg, edges)).toEqual([{ edge: "short-of-top", node: "L" }]);
  });

  it("passes an end on an hourglass's open side only between its top and its bottom", () => {
    const svg = svgOf(
      shaped("H", "hourglass", "M0,0 L30,0 L0,30 L30,30 Z") +
        box("A", 100, 0, 40, 20) +
        // Onto the open right side, level with the pinch.
        edge("onto-side", [[100, 15], [30, 15]]) +
        // Level with the right side but 10px below the hourglass.
        edge("below", [[100, 15], [30, 40]]),
    );
    const edges = [
      { id: "onto-side", from: "A", to: "H" },
      { id: "below", from: "A", to: "H" },
    ];

    expect(endsOffTheirFigures(svg, edges)).toEqual([{ edge: "below", node: "H" }]);
  });

  it("passes an end on an image's box, which reaches over its label, and no end short of the image itself", () => {
    // An image 0..40 by 0..20 with its label below it: its box reaches down
    // over the label, which no frame draws.
    const svg = svgOf(
      `<g class="siren-node" data-siren-id="I" data-siren-shape="image">` +
        `<rect class="siren-node-frame" x="0" y="0" width="40" height="20"/>` +
        `<image x="0" y="0" width="40" height="20"/><text x="20" y="35">Pic</text></g>` +
        box("A", 0, -80, 40, 20) +
        box("B", 0, 100, 40, 20) +
        // Onto the box's bottom, below the label.
        edge("I-B", [[20, 45], [20, 100]]) +
        // 3px above the image, on the side away from the label.
        edge("A-I", [[20, -60], [20, -3]]),
    );
    const edges = [
      { id: "I-B", from: "I", to: "B" },
      { id: "A-I", from: "A", to: "I" },
    ];

    expect(endsOffTheirFigures(svg, edges)).toEqual([{ edge: "A-I", node: "I" }]);
  });
});

/** Which two nodes each edge of a flowchart joins, as its model says. */
function flowchartEdges(source: string): { id: string; from: string; to: string }[] {
  const built = buildGraphModel(parseSiren(source).document!);
  if (built.kind !== "flowchart") throw new Error("not a flowchart");
  return built.model.edges;
}

describe("every flowchart shape's line ends, under the default measurer", () => {
  // One spelling of each shape. An icon and an image are left out: each
  // needs data of its own to be drawn at all, and both meet their box.
  const spellings = new Map<string, string>();
  for (const [name, shape] of NODE_DATA_SHAPES) {
    if (shape !== "icon" && shape !== "image" && !spellings.has(shape)) spellings.set(shape, name);
  }
  const cases = [...spellings].flatMap(([shape, name]) =>
    ["TB", "LR", "BT", "RL"].map((direction) => [shape, direction, name] as const),
  );

  it.each(cases)("%s, flowing %s, takes every line on its figure", (shape, direction, name) => {
    // A label short, long and tall, where the shape draws one.
    const labels =
      SHAPES[shape as keyof typeof SHAPES].drawsLabel === false
        ? [null]
        : ["x", "A rather long label", "tall<br>b<br>c<br>d"];
    for (const text of labels) {
      // Lines fanning in and out, a loop, and a line with no arrowhead.
      const source = [
        `flowchart ${direction}`,
        `S@{ shape: ${name}${text === null ? "" : `, label: "${text}"`} }`,
        "A --> S",
        "B --> S",
        "C --> S",
        "S --> D",
        "S --> E",
        "S --> F",
        "S --> S",
        "G --- S",
      ].join("\n");
      const { svg, diagnostics } = render(source, document.createElement("div"));
      expect(diagnostics).toEqual([]);

      expect(endsOffOutline(svg!)).toEqual([]);
      expect(endsOffTheirFigures(svg!, flowchartEdges(source))).toEqual([]);
    }
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
