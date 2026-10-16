import { describe, expect, it } from "vitest";
import type { Direction, GraphModel, NodeShape, PositionedGraph, TextMeasurer } from "../../contracts";
import { plainLabel } from "../../label/label";
import { layoutLabel } from "../../label/layoutLabel";
import { readLabel } from "../../label/readLabel";
import { renderToSVG } from "../../renderer/renderToSVG";
import { layoutGraph } from "../layoutGraph";
import { SHAPES } from "./shapeTable";

/**
 * The shapes a node's `@{ shape: … }` block names whose outline is straight
 * lines, through the two seams that read the shape table: `layoutGraph`
 * (the box, and where the label goes in it) and `renderToSVG` (the outline).
 *
 * Every number below is Mermaid 12.2.0's formula for that shape (classic
 * look, its handler in `rendering-elements/shapes`), measured in headless
 * Chrome and applied to the box a rectangle would draw — the padded label —
 * rather than copied from a run of this code.
 */

/** 8px a character, 24px a line, no padding of its own: "x" pads to 8 x 27. */
const fakeMeasurer: TextMeasurer = {
  measure: (text: string) => ({ width: text.length * 8, height: 24 }),
};

/** The one node `shape` lays out as, labelled `text` (a `<br>` breaks a row). */
function laidOut(shape: NodeShape, text: string, direction: Direction = "TB") {
  const graph: GraphModel = {
    direction,
    nodes: [{ id: "A", label: readLabel(text, { dialect: "html" }).label, shape, style: { frame: [], text: [] }, parentId: null, interaction: null }],
    edges: [],
    subgraphs: [],
    accTitle: null,
    accDescr: null,
    timeline: { totalSteps: 0, entries: [] },
  };
  return layoutGraph(graph, { measureText: fakeMeasurer }).nodes[0]!;
}

/** "A rather long label" pads to 152 x 27, the box a rectangle would be. */
const LONG = "A rather long label";

/**
 * The node `shape` draws in the box `10,20 200x60` — one box for every
 * shape, so the outlines below are comparable by eye — labelled "x", its
 * label moved off the centre by `labelOffset` as layout reported it.
 */
function drawn(shape: NodeShape, labelOffset?: { x: number; y: number }, height = 60) {
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
        width: 200,
        height,
        style: { frame: [], text: [] },
        parentId: null,
        interaction: null,
        ...(labelOffset === undefined ? {} : { labelOffset }),
      },
    ],
    edges: [],
    subgraphs: [],
    accTitle: null,
    accDescr: null,
    width: 220,
    height: 100,
  };
  const group = renderToSVG(graph).querySelector('g.siren-node[data-siren-id="A"]')!;
  const frames = Array.from(group.querySelectorAll(".siren-node-frame"));
  const text = group.querySelector("text")!;
  return {
    frames,
    tags: frames.map((frame) => frame.tagName),
    d: frames.map((frame) => frame.getAttribute("d")),
    classes: frames.map((frame) => frame.getAttribute("class")),
    styles: frames.map((frame) => frame.getAttribute("style")),
    text: [Number(text.getAttribute("x")), Number(text.getAttribute("y"))],
  };
}

describe("a notched rectangle (`notch-rect`, Mermaid's `card`)", () => {
  it("is 12px wider than a rectangle, for the notch, and as tall", () => {
    // `card`: `w = bbox.width + padding + NOTCH_SIZE`, `NOTCH_SIZE = 12`.
    expect([laidOut("notched-rectangle", LONG).width, laidOut("notched-rectangle", LONG).height]).toEqual([164, 27]);
    expect([laidOut("notched-rectangle", "x").width, laidOut("notched-rectangle", "x").height]).toEqual([20, 27]);
  });

  it("cuts a 12px corner off its top left, and keeps its label centred", () => {
    const node = drawn("notched-rectangle");
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual(["M22,20 L210,20 L210,80 L10,80 L10,32 Z"]);
    expect(node.text).toEqual([110, 50]);
  });
});

describe("a folder (`folder`)", () => {
  it("adds a tab band above a body as tall as a rectangle, and is at least 90px wide", () => {
    // `folder`: `w = max(bbox.width + 2 x padding, 90)`, a tab
    // `clamp(0.16 x contentHeight, 8, 14)` tall over a body of the content
    // height. At a 27px body the tab is its 8px minimum.
    const long = laidOut("folder", LONG);
    expect([long.width, long.height]).toEqual([152, 35]);
    const short = laidOut("folder", "x");
    expect([short.width, short.height]).toEqual([90, 35]);
  });

  it("grows its tab with the body, up to 14px", () => {
    // The body is the box a rectangle draws around the same label.
    const three = "a<br>b<br>c";
    const threeBody = laidOut("rect", three).height;
    expect(threeBody).toBe(69);
    expect(laidOut("folder", three).height).toBeCloseTo(69 + 0.16 * 69, 9);
    const seven = "a<br>b<br>c<br>d<br>e<br>f<br>g";
    const sevenBody = laidOut("rect", seven).height;
    expect(sevenBody).toBeGreaterThan(14 / 0.16);
    expect(laidOut("folder", seven).height).toBe(sevenBody + 14);
  });

  it("centres its label on the body, below the tab, and says so to the renderer", () => {
    // Mermaid: `bodyCenterY = top + tabHeight + bodyHeight / 2` — half the
    // tab below the box's centre.
    expect(laidOut("folder", LONG).labelOffset).toEqual({ x: 0, y: 4 });
    expect(laidOut("rect", LONG).labelOffset).toBeUndefined();
  });

  it("draws a tab 38% of its width along the top left, and its label where layout put it", () => {
    // At 50px tall the tab is 8px (the box's 42px body is under 50px), and
    // `tabWidth = max(0.38 x 200, 28) = 76`.
    const node = drawn("folder", { x: 0, y: 4 }, 50);
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual(["M10,20 L86,20 L86,28 L210,28 L210,70 L10,70 Z"]);
    expect(node.text).toEqual([110, 49]);
  });
});

describe("a notched pentagon (`notch-pent`, Mermaid's `trapezoidalPentagon`)", () => {
  it("is as big as a rectangle", () => {
    expect([laidOut("notched-pentagon", LONG).width, laidOut("notched-pentagon", LONG).height]).toEqual([152, 27]);
    expect(laidOut("notched-pentagon", LONG).labelOffset).toBeUndefined();
  });

  it("cuts both top corners, a tenth of its width in and a fifth of its height down", () => {
    // Mermaid's points: the top edge spans `±0.8 x w/2`, and each side
    // starts `0.6 x h/2` above the centre.
    const node = drawn("notched-pentagon");
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual(["M30,20 L190,20 L210,32 L210,80 L10,80 L10,32 Z"]);
    expect(node.text).toEqual([110, 50]);
  });
});

describe("a sloped rectangle (`sl-rect`, a manual input)", () => {
  it("is half again as tall as a rectangle, for the slope", () => {
    // `slopedRect`: `totalHeight = (bbox.height + 2 x padding) x 1.5`.
    const node = laidOut("sloped-rectangle", LONG);
    expect([node.width, node.height]).toEqual([152, 40.5]);
  });

  it("puts its label in the rectangle under the slope: a sixth of its height below centre", () => {
    // Mermaid moves the label `h/4` down, `h` being the rectangle's own
    // height — a sixth of the whole box, 40.5 / 6.
    expect(laidOut("sloped-rectangle", LONG).labelOffset).toEqual({ x: 0, y: 6.75 });
  });

  it("slopes its top up from a third of the way down its left side to its top right corner", () => {
    const node = drawn("sloped-rectangle", { x: 0, y: 10 });
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual(["M10,40 L10,80 L210,80 L210,20 Z"]);
    expect(node.text).toEqual([110, 60]);
  });
});

describe("a triangle (`tri`, an extract) and a flipped one (`flip-tri`, a manual file)", () => {
  it("is a square box whose side is the label's width plus its height", () => {
    // `triangle`: `w = bbox.width + padding`, `h = w + bbox.height`, and
    // the triangle is `h` wide: the side is the width plus the height. On
    // the padded label that puts the label's top corners on the two
    // slopes when it stands on the base — 152 + 27.
    for (const shape of ["triangle", "flipped-triangle"] as const) {
      const long = laidOut(shape, LONG);
      expect([shape, long.width, long.height]).toEqual([shape, 179, 179]);
      const short = laidOut(shape, "x");
      expect([shape, short.width, short.height]).toEqual([shape, 35, 35]);
    }
  });

  it("stands its label on the wide side: the base of a triangle, the top of a flipped one", () => {
    // From the centre of a 179px box to the centre of a 27px label
    // touching one side: 179/2 - 27/2.
    expect(laidOut("triangle", LONG).labelOffset).toEqual({ x: 0, y: 76 });
    expect(laidOut("flipped-triangle", LONG).labelOffset).toEqual({ x: 0, y: -76 });
  });

  it("points a triangle up from its base and a flipped one down from its top", () => {
    const up = drawn("triangle", { x: 0, y: 76 }, 200);
    expect(up.tags).toEqual(["path"]);
    expect(up.d).toEqual(["M10,220 L210,220 L110,20 Z"]);
    expect(up.text).toEqual([110, 196]);
    const down = drawn("flipped-triangle", { x: 0, y: -76 }, 200);
    expect(down.d).toEqual(["M10,20 L210,20 L110,220 Z"]);
    expect(down.text).toEqual([110, 44]);
  });
});

describe("a lined rectangle (`lin-rect`, a shaded process)", () => {
  it("is 16px wider than a rectangle, and its label sits 4px right of centre, clear of the line", () => {
    // `shadedProcess`: `FRAME_WIDTH = 8`, the box `2 x FRAME_WIDTH` wider,
    // the line `FRAME_WIDTH` in from the left edge and the label moved
    // `FRAME_WIDTH / 2` right — centred on what is right of the line.
    const node = laidOut("lined-rectangle", LONG);
    expect([node.width, node.height]).toEqual([168, 27]);
    expect(node.labelOffset).toEqual({ x: 4, y: 0 });
  });

  it("draws a rectangle with a line down it 8px in from the left", () => {
    const node = drawn("lined-rectangle", { x: 4, y: 0 });
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual(["M10,20 L210,20 L210,80 L10,80 Z M18,20 L18,80"]);
    expect(node.text).toEqual([114, 50]);
  });
});

describe("a divided rectangle (`div-rect`, a divided process)", () => {
  it("adds a band a fifth of a rectangle's height across its top, and centres its label below it", () => {
    // `dividedRectangle`: `rectOffset = 0.2 x h`, the box `h + rectOffset`
    // tall, the label centred on the part below the band — half the band
    // below the box's centre.
    const node = laidOut("divided-rectangle", LONG);
    expect([node.width, node.height]).toEqual([152, 27 * 1.2]);
    expect(node.labelOffset?.x).toBe(0);
    expect(node.labelOffset?.y).toBeCloseTo(2.7, 9);
  });

  it("draws a rectangle divided by a line a sixth of the way down", () => {
    // 60px tall: a 50px rectangle under a 10px band.
    const node = drawn("divided-rectangle", { x: 0, y: 5 });
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual(["M10,20 L210,20 L210,80 L10,80 Z M10,30 L210,30"]);
    expect(node.text).toEqual([110, 55]);
  });
});

describe("a window pane (`win-pane`, internal storage)", () => {
  it("is 10px bigger than a rectangle each way, its label 5px right and down, clear of the panes", () => {
    // `windowPane`: `rectOffset = 10` added to both sides, one line
    // `rectOffset` below the top and one `rectOffset` right of the left
    // edge, and the label moved `rectOffset / 2` on each axis.
    const node = laidOut("window-pane", LONG);
    expect([node.width, node.height]).toEqual([162, 37]);
    expect(node.labelOffset).toEqual({ x: 5, y: 5 });
  });

  it("draws a rectangle with a line 10px below its top and one 10px right of its left edge", () => {
    const node = drawn("window-pane", { x: 5, y: 5 });
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual(["M10,20 L210,20 L210,80 L10,80 Z M10,30 L210,30 M20,20 L20,80"]);
    expect(node.text).toEqual([115, 55]);
  });
});

describe("a stacked rectangle (`st-rect`, processes)", () => {
  it("is 10px bigger than a rectangle each way, its label centred on the front sheet", () => {
    // `multiRect`: three sheets `rectOffset = 5` apart, the front one at
    // the bottom left, and the label moved `-rectOffset, +rectOffset`.
    const node = laidOut("stacked-rectangle", LONG);
    expect([node.width, node.height]).toEqual([162, 37]);
    expect(node.labelOffset).toEqual({ x: -5, y: 5 });
  });

  it("draws the stack's silhouette and, over it, the middle sheet's edges, both filled", () => {
    const node = drawn("stacked-rectangle", { x: -5, y: 5 });
    expect(node.tags).toEqual(["path", "path"]);
    expect(node.d).toEqual([
      "M10,30 L10,80 L200,80 L200,75 L205,75 L205,70 L210,70 L210,20 L20,20 L20,25 L15,25 L15,30 Z",
      "M15,30 L200,30 L200,75 L205,75 L205,25 L15,25 Z",
    ]);
    expect(node.classes).toEqual(["siren-node-frame", "siren-node-frame"]);
    expect(node.text).toEqual([105, 55]);
  });
});

describe("a tagged rectangle (`tag-rect`, a tagged process)", () => {
  it("is wider than a rectangle by a fifth of its height, for the tag, and centres its label", () => {
    // `taggedRect`: `TAG_RATIO = 0.2`, the tag `0.2 x h` on a side, the box
    // that much wider.
    const node = laidOut("tagged-rectangle", LONG);
    expect(node.width).toBeCloseTo(152 + 0.2 * 27, 9);
    expect(node.height).toBe(27);
    expect(node.labelOffset).toBeUndefined();
  });

  it("draws the rectangle and, in its bottom right corner, a filled tag a fifth of its height on a side", () => {
    const node = drawn("tagged-rectangle");
    expect(node.tags).toEqual(["path", "path"]);
    expect(node.d).toEqual(["M10,20 L210,20 L210,80 L10,80 Z", "M198,80 L210,80 L210,68 Z"]);
    expect(node.classes).toEqual(["siren-node-frame", "siren-node-frame"]);
    expect(node.text).toEqual([110, 50]);
  });
});

describe("a text block (`text`)", () => {
  it("is as big as a rectangle and centres its label", () => {
    const node = laidOut("text", LONG);
    expect([node.width, node.height]).toEqual([152, 27]);
    expect(node.labelOffset).toBeUndefined();
  });

  it("draws a rectangle that wears the class the theme leaves unpainted", () => {
    // Mermaid draws a `<rect class="text">` with no fill and no stroke: the
    // label alone shows, and an author's `style` on it can still paint it.
    const node = drawn("text");
    expect(node.tags).toEqual(["rect"]);
    expect(node.classes).toEqual(["siren-node-frame siren-node-bare"]);
    expect(node.frames[0]!.getAttribute("width")).toBe("200");
    expect(node.text).toEqual([110, 50]);
  });
});

describe("a composite (`composite`, undocumented)", () => {
  it("is as big as a rectangle and centres its label", () => {
    const node = laidOut("composite", LONG);
    expect([node.width, node.height]).toEqual([152, 27]);
    expect(node.labelOffset).toBeUndefined();
  });

  it("draws a rectangle that wears the hollow paint a group's frame has", () => {
    // Mermaid draws `<rect class="basic cluster composite">`: a group's
    // frame, standing alone as a node.
    const node = drawn("composite");
    expect(node.tags).toEqual(["rect"]);
    expect(node.classes).toEqual(["siren-node-frame siren-node-hollow"]);
  });
});

describe("a note (`note`, undocumented)", () => {
  it("is as big as a rectangle and centres its label", () => {
    const node = laidOut("note", LONG);
    expect([node.width, node.height]).toEqual([152, 27]);
    expect(node.labelOffset).toBeUndefined();
  });

  it("draws a rectangle that wears a note's paint", () => {
    const node = drawn("note");
    expect(node.tags).toEqual(["rect"]);
    expect(node.classes).toEqual(["siren-node-frame siren-node-note"]);
  });
});

describe("a data store (`datastore`)", () => {
  it("is wider than a rectangle by twice Mermaid's 15px node padding, and centres its label", () => {
    // `datastore` hands `drawRect` `labelPaddingX: padding x 2`: each side
    // gets the node padding (15px) once more than the padded label has.
    const size = SHAPES["data-store"].box({ width: 152, height: 27 }, "TB");
    expect([size.width, size.height]).toEqual([152 + 30, 27]);
    expect(SHAPES["data-store"].labelRect).toBeUndefined();
  });

  it("strokes only its top and bottom edges, dashing its square rectangle by its own width and height", () => {
    // Mermaid's `datastore` is a square-cornered rectangle with
    // `stroke-dasharray: <width> <height>`: the stroke runs along the top,
    // skips the right side, runs along the bottom and skips the left.
    const node = drawn("data-store");
    expect(node.tags).toEqual(["rect"]);
    expect(node.classes).toEqual(["siren-node-frame"]);
    expect(node.styles).toEqual(["rx:0px;stroke-dasharray:200 60"]);
  });
});

describe("a state (`state`, undocumented)", () => {
  it("is as big as a rectangle and centres its label", () => {
    const node = laidOut("state", LONG);
    expect([node.width, node.height]).toEqual([152, 27]);
    expect(node.labelOffset).toBeUndefined();
  });

  it("draws a rectangle with the 5px corners of Mermaid's `state` handler, which the shape owns", () => {
    // Mermaid's handler asks for `drawRect` with `rx: 5` and no label
    // padding, and so draws a `<rect>` sized `NaN` (measured in Chrome):
    // the label alone shows. Siren draws the rectangle the handler asks for.
    const node = drawn("state");
    expect(node.tags).toEqual(["rect"]);
    expect(node.classes).toEqual(["siren-node-frame"]);
    expect(node.styles).toEqual(["rx:5px"]);
  });
});

describe("a data store padded with Siren's own node padding", () => {
  it("is wider than a rectangle by twice the node padding across, as Mermaid's `labelPaddingX: 2p` makes it", () => {
    const paddedMeasurer = { measure: (text: string) => ({ width: text.length * 8 + 24, height: 32 }) };
    const sizeOf = (shape: NodeShape) => {
      const node = layoutGraph(
        {
          direction: "TB",
          nodes: [{ id: "A", label: plainLabel("Label text"), shape, style: { frame: [], text: [] }, parentId: null, interaction: null }],
          edges: [],
          subgraphs: [],
          accTitle: null,
          accDescr: null,
          timeline: { totalSteps: 0, entries: [] },
        },
        { measureText: paddedMeasurer },
      ).nodes[0]!;
      return [node.width, node.height];
    };
    expect(sizeOf("rect")).toEqual([80 + 2 * 24, 21 + 2 * 11]);
    expect(sizeOf("data-store")).toEqual([80 + 4 * 24, 21 + 2 * 11]);
  });
});
