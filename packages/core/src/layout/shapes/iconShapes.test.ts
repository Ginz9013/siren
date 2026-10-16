import { describe, expect, it } from "vitest";
import type { GraphModel, NodeIcon, NodeShape, PositionedGraph, PositionedNode, StyleProperty, TextMeasurer } from "../../contracts";
import { plainLabel } from "../../label/label";
import { renderToSVG } from "../../renderer/renderToSVG";
import { layoutGraph } from "../layoutGraph";

/**
 * An icon node (`A@{ icon: "fa:user", form, pos, h }`, and `shape: icon`)
 * through the two seams that read the shape table: `layoutGraph` (its box
 * and where its label goes) and `renderToSVG` (what is drawn).
 *
 * Every number is Mermaid 12.2.0's, read off its `icon`, `iconSquare`,
 * `iconRounded` and `iconCircle` handlers and measured in headless Chrome
 * with a registered 24px test pack: the icon is `h` (48) square; a square
 * or rounded form is 15px wider and taller than the icon (the flowchart's
 * padding); a circle's diameter is the icon's side times √2 plus 40; the
 * label sits 8px from the figure, below it or, with `pos: t`, above it,
 * and the node is as wide as the wider of the two.
 */

/** 8px a character, 24px a line. */
const fakeMeasurer: TextMeasurer = {
  measure: (text: string) => ({ width: text.length * 8, height: 24 }),
};

const icon = (fields: Partial<NodeIcon> = {}): NodeIcon => ({ name: "t:sq", form: null, pos: "b", size: 48, ...fields });

/** `id`'s node, laid out with `label` as `shape` (and `icon`, when given). */
function laidOut(label: string, shape: NodeShape, nodeIcon?: NodeIcon): PositionedNode {
  const graph: GraphModel = {
    direction: "TB",
    nodes: [
      {
        id: "A",
        label: plainLabel(label),
        shape,
        ...(nodeIcon === undefined ? {} : { icon: nodeIcon }),
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
  return layoutGraph(graph, { measureText: fakeMeasurer }).nodes[0]!;
}

/** The box a rectangle draws around `label`: the padded label every shape sizes itself from. */
function labelBoxOf(label: string) {
  const node = laidOut(label, "rect");
  return { width: node.width, height: node.height };
}

describe("an icon node's box", () => {
  it("is the icon, with its label 8px below it, as wide as the wider of the two", () => {
    const label = labelBoxOf("Hi");
    const node = laidOut("Hi", "icon", icon());
    expect([node.width, node.height]).toEqual([48, 48 + 8 + label.height]);

    const long = labelBoxOf("A much longer label");
    const wide = laidOut("A much longer label", "icon", icon());
    expect([wide.width, wide.height]).toEqual([long.width, 48 + 8 + long.height]);
  });

  it("is the icon alone when the node has no label", () => {
    const node = laidOut("", "icon", icon());
    expect([node.width, node.height]).toEqual([48, 48]);
  });

  it("takes its size from `h`", () => {
    const node = laidOut("", "icon", icon({ size: 80 }));
    expect([node.width, node.height]).toEqual([80, 80]);
  });

  it("is 15px wider and taller than the icon in a square or rounded form", () => {
    const label = labelBoxOf("Hi");
    for (const form of ["square", "rounded"] as const) {
      const node = laidOut("Hi", "icon", icon({ form }));
      expect([node.width, node.height]).toEqual([63, 63 + 8 + label.height]);
    }
  });

  it("is the icon's side times √2 plus 40 across in a circle", () => {
    const node = laidOut("", "icon", icon({ form: "circle" }));
    expect(node.width).toBeCloseTo(107.88, 2);
    expect(node.height).toBeCloseTo(107.88, 2);
  });

  it("puts the label at the bottom of the box, or with `pos: t` at the top", () => {
    const label = labelBoxOf("Hi");
    const below = laidOut("Hi", "icon", icon());
    const above = laidOut("Hi", "icon", icon({ pos: "t" }));

    expect(below.labelOffset).toEqual({ x: 0, y: below.height / 2 - label.height / 2 });
    expect(above.labelOffset).toEqual({ x: 0, y: -(above.height / 2 - label.height / 2) });
  });
});

/** A 24px glyph: one path filling its box. */
const GLYPH = {
  viewBox: { left: 0, top: 0, width: 24, height: 24 },
  elements: [{ element: "path" as const, attributes: [["d", "M0 0h24v24H0z"] as const], children: [] }],
};

/** What node `A` draws at `10,20`, `width` x `height`, as the icon `nodeIcon`, with the author's `frame` style. */
function drawn(nodeIcon: NodeIcon, width: number, height: number, frame: StyleProperty[] = []) {
  const label = plainLabel("Hi");
  const graph: PositionedGraph = {
    direction: "TB",
    nodes: [
      {
        id: "A",
        label,
        labelBox: { width: 16, height: 24, rows: [] },
        shape: "icon",
        icon: nodeIcon,
        x: 10,
        y: 20,
        width,
        height,
        style: { frame, text: [] },
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
  return {
    frames: Array.from(group.querySelectorAll(".siren-node-frame")),
    glyph: group.querySelector(":scope > g"),
  };
}

describe("what an icon node draws", () => {
  it("draws its glyph scaled to the icon's size, centred over the label, in the node's line colour", () => {
    // 48 x 80 at 10,20, label 24 tall: the icon's centre is 24 below the top.
    const { glyph } = drawn(icon({ glyph: GLYPH }), 48, 80);

    expect(glyph?.getAttribute("transform")).toBe("translate(10,20) scale(2)");
    expect(glyph?.getAttribute("class")).toBeNull();
    expect(glyph?.getAttribute("style")).toBe("color:var(--siren-node-stroke);fill:currentColor;stroke:none");
    expect(Array.from(glyph!.children).map((child) => `${child.tagName} ${child.getAttribute("d")}`)).toEqual([
      "path M0 0h24v24H0z",
    ]);
  });

  it("centres a glyph that is not square in the icon's square", () => {
    const wide = { ...GLYPH, viewBox: { left: 0, top: 0, width: 48, height: 24 } };
    const { glyph } = drawn(icon({ glyph: wide }), 48, 48);

    expect(glyph?.getAttribute("transform")).toBe("translate(10,32) scale(1)");
  });

  it("draws the glyph in the author's `stroke`, as Mermaid colours it", () => {
    const { glyph } = drawn(icon({ glyph: GLYPH }), 48, 48, [{ property: "stroke", value: "#00f" }]);

    expect(glyph?.getAttribute("style")).toBe("color:#00f;fill:currentColor;stroke:none");
  });

  it("puts the glyph under the label with `pos: t`", () => {
    // Label 24 tall and 8px above the icon: the icon starts 32 below the top.
    const { glyph } = drawn(icon({ glyph: GLYPH, pos: "t" }), 48, 80);

    expect(glyph?.getAttribute("transform")).toBe("translate(10,52) scale(2)");
  });

  it("draws no figure behind the icon with no form: a frame over the whole box, neither filled nor stroked", () => {
    const { frames } = drawn(icon(), 48, 80);

    expect(frames.map((frame) => frame.getAttribute("class"))).toEqual(["siren-node-frame siren-node-bare"]);
    expect(frames.map((frame) => ["x", "y", "width", "height"].map((name) => frame.getAttribute(name)))).toEqual([
      ["10", "20", "48", "80"],
    ]);
  });

  it("draws a square form behind the icon in the node's fill, with no outline", () => {
    const { frames } = drawn(icon({ form: "square" }), 63, 95);

    expect(frames.map((frame) => frame.tagName)).toEqual(["path"]);
    expect(frames[0]!.getAttribute("d")).toBe("M10,20 L73,20 L73,83 L10,83 Z");
    expect(frames[0]!.getAttribute("style")).toBe("--siren-stroke-width:0");
  });

  it("rounds a rounded form's corners 5px", () => {
    const { frames } = drawn(icon({ form: "rounded" }), 63, 63);

    expect(frames.map((frame) => frame.tagName)).toEqual(["rect"]);
    expect(["x", "y", "width", "height"].map((name) => frames[0]!.getAttribute(name))).toEqual(["10", "20", "63", "63"]);
    expect(frames[0]!.getAttribute("style")).toBe("--siren-stroke-width:0;rx:5px;ry:5px");
  });

  it("outlines neither a form nor the frame of an icon with no form, even in the author's stroke, and leaves the highlight its own width", () => {
    // Mermaid strokes a form in its fill colour and an icon with no form not
    // at all, whatever the author's `stroke` (measured): that colours the
    // glyph. The frame is drawn 0 wide through the theme's width token, which
    // a highlight's own `stroke-width` rule does not read, so a highlight
    // still outlines it.
    for (const form of [null, "square", "circle"] as const) {
      const { frames } = drawn(icon({ form }), 63, 63, [{ property: "stroke", value: "#00f" }]);
      expect(frames[0]!.getAttribute("style")).toBe("--siren-stroke-width:0;stroke:#00f");
    }
  });

  it("draws a circle form behind the icon", () => {
    const side = 48 * Math.SQRT2 + 40;
    const { frames } = drawn(icon({ form: "circle" }), side, side);

    expect(frames.map((frame) => frame.tagName)).toEqual(["circle"]);
    expect(Number(frames[0]!.getAttribute("r"))).toBeCloseTo(side / 2, 6);
    expect(Number(frames[0]!.getAttribute("cx"))).toBeCloseTo(10 + side / 2, 6);
  });
});
