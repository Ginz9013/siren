import { describe, expect, it } from "vitest";
import type { GraphModel, NodeImage, PositionedGraph, StyleProperty, TextMeasurer } from "../../contracts";
import { plainLabel } from "../../label/label";
import { renderToSVG } from "../../renderer/renderToSVG";
import { layoutGraph } from "../layoutGraph";

/**
 * An image node (`A@{ img: "data:…", w, h, constraint, pos }`) through the
 * two seams that read the shape table: `layoutGraph` (its box and where its
 * label goes) and `renderToSVG` (what is drawn).
 *
 * Every number is Mermaid 12.2.0's, read off its `imageSquare` handler and
 * measured in headless Chrome with a 40 x 20 PNG: the image is its natural
 * size, or `w` wide and `h` tall; with `constraint: on` it keeps its
 * proportions, `h` deciding the width when given, else `w`; a labelled
 * image is at least 120 wide (the flowchart's `wrappingWidth`); the label
 * sits 8px from it, below or, with `pos: t`, above; the node is as wide as
 * the wider of the two. The image is stretched to that size
 * (`preserveAspectRatio="none"`) over a rectangle in the node's paint.
 */

/** 8px a character, 24px a line. */
const fakeMeasurer: TextMeasurer = {
  measure: (text: string) => ({ width: text.length * 8, height: 24 }),
};

const SRC = "data:image/png;base64,iVBORw0KGgo=";

const image = (fields: Partial<NodeImage> = {}): NodeImage => ({
  src: SRC,
  naturalWidth: 40,
  naturalHeight: 20,
  w: null,
  h: null,
  constraint: false,
  pos: "b",
  ...fields,
});

/** Node `A` laid out with `label`, as an image node (or, without `nodeImage`, a rectangle). */
function laidOut(label: string, nodeImage?: NodeImage) {
  const graph: GraphModel = {
    direction: "TB",
    nodes: [
      {
        id: "A",
        label: plainLabel(label),
        shape: nodeImage === undefined ? "rect" : "image",
        ...(nodeImage === undefined ? {} : { image: nodeImage }),
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
  const node = laidOut(label);
  return { width: node.width, height: node.height };
}

const sizeOf = (label: string, nodeImage: NodeImage) => {
  const node = laidOut(label, nodeImage);
  return [node.width, node.height];
};

describe("an image node's box", () => {
  it("is the image's natural size when it has no label", () => {
    expect(sizeOf("", image())).toEqual([40, 20]);
  });

  it("is `w` wide and `h` tall, each in place of the natural one", () => {
    expect(sizeOf("", image({ w: 100 }))).toEqual([100, 20]);
    expect(sizeOf("", image({ h: 50 }))).toEqual([40, 50]);
    expect(sizeOf("", image({ w: 100, h: 50 }))).toEqual([100, 50]);
  });

  it("keeps the image's proportions with `constraint: on`, from `h` when given, else from `w`", () => {
    expect(sizeOf("", image({ h: 50, constraint: true }))).toEqual([100, 50]);
    expect(sizeOf("", image({ w: 100, constraint: true }))).toEqual([100, 50]);
    expect(sizeOf("", image({ w: 100, h: 10, constraint: true }))).toEqual([20, 10]);
  });

  it("is at least 120 wide with a label, which sits 8px below the image", () => {
    const label = labelBoxOf("Hi");
    expect(sizeOf("Hi", image())).toEqual([120, 20 + 8 + label.height]);
  });

  it("is as wide as a label wider than the image", () => {
    const long = "A label much wider than the image";
    const label = labelBoxOf(long);
    expect(sizeOf(long, image())).toEqual([label.width, 20 + 8 + label.height]);
  });

  it("puts the label at the bottom of the box, or with `pos: t` at the top", () => {
    const label = labelBoxOf("Hi");
    const below = laidOut("Hi", image());
    const above = laidOut("Hi", image({ pos: "t" }));

    expect(below.labelOffset).toEqual({ x: 0, y: below.height / 2 - label.height / 2 });
    expect(above.labelOffset).toEqual({ x: 0, y: -(above.height / 2 - label.height / 2) });
  });
});

/** What node `A` draws at `10,20`, `width` x `height`, as the image `nodeImage`. */
function drawn(nodeImage: NodeImage, width: number, height: number, frame: StyleProperty[] = []) {
  const graph: PositionedGraph = {
    direction: "TB",
    nodes: [
      {
        id: "A",
        label: plainLabel("Hi"),
        labelBox: { width: 16, height: 24, rows: [] },
        shape: "image",
        image: nodeImage,
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
  const attributes = (element: Element | null, names: string[]) => names.map((name) => element?.getAttribute(name) ?? null);
  return {
    frames: Array.from(group.querySelectorAll(".siren-node-frame")).map((frame) => [
      frame.tagName,
      ...attributes(frame, ["x", "y", "width", "height", "style"]),
    ]),
    image: attributes(group.querySelector("image"), ["href", "x", "y", "width", "height", "preserveAspectRatio", "class", "style"]),
  };
}

describe("what an image node draws", () => {
  it("draws the image stretched to its size over a rectangle in the node's paint, the label below", () => {
    // 120 x 52 at 10,20 for a 40 x 20 image with a 24px label: the image is
    // 120 x 20 across the top.
    const { frames, image: drawnImage } = drawn(image(), 120, 52, [{ property: "fill", value: "#f00" }]);

    expect(frames).toEqual([["rect", "10", "20", "120", "20", "fill:#f00"]]);
    expect(drawnImage).toEqual([SRC, "10", "20", "120", "20", "none", null, null]);
  });

  it("draws the image at the bottom of the box with `pos: t`", () => {
    const { frames, image: drawnImage } = drawn(image({ pos: "t" }), 120, 52);

    expect(frames).toEqual([["rect", "10", "52", "120", "20", null]]);
    expect(drawnImage.slice(1, 5)).toEqual(["10", "52", "120", "20"]);
  });

  it("draws an image narrower than its label centred across the box", () => {
    // `w: 100, h: 50`, labelled: at least 120 wide, centred in a 160-wide box.
    const { image: drawnImage } = drawn(image({ w: 100, h: 50 }), 160, 82);

    expect(drawnImage.slice(1, 5)).toEqual(["30", "20", "120", "50"]);
  });
});
