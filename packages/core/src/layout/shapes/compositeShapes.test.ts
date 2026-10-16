import { describe, expect, it } from "vitest";
import type { Direction, GraphModel, NodeShape, PositionedGraph, TextMeasurer } from "../../contracts";
import { plainLabel } from "../../label/label";
import { layoutLabel } from "../../label/layoutLabel";
import { readLabel } from "../../label/readLabel";
import { renderToSVG } from "../../renderer/renderToSVG";
import { layoutGraph } from "../layoutGraph";
import { SHAPES } from "./shapeTable";
import { render } from "../../index";

/**
 * The shapes a node's `@{ shape: … }` block names that Mermaid 12.2.0 draws
 * as a figure plus decorations, through the two seams that read the shape
 * table: `layoutGraph` (the box, and where the label goes in it) and
 * `renderToSVG` (the elements the outline is drawn with).
 *
 * Every number below is Mermaid 12.2.0's formula for that shape (classic
 * look, its handler in `rendering-elements/shapes`), measured in headless
 * Chrome, and applied to the box a rectangle would draw — the padded label,
 * which stands for Mermaid's label plus its padding on each side — rather
 * than copied from a run of this code.
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
function drawn(shape: NodeShape, labelOffset?: { x: number; y: number }, height = 60, width = 200) {
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

describe("a bucket (`bucket`)", () => {
  it("is as wide as a rectangle but at least 80px, and taller by its two rims", () => {
    // `bucket`: `w = max(bbox.width + 2 x padding, 80)`, a rim
    // `ry = clamp(0.08 x w, 5, 12)`, and a body `bbox.height + 2 x padding`
    // tall between the rim's centre and the bottom arc's ends; the top rim
    // bulges `ry` above and the bottom arc `ry` below, so the box Mermaid
    // lays out is the body plus `2 x ry` (measured: 150 x 75 around a
    // 120 x 21 label at 15px padding).
    expect([laidOut("bucket", LONG).width, laidOut("bucket", LONG).height]).toEqual([152, 51]);
    const short = laidOut("bucket", "x");
    expect(short.width).toBe(80);
    expect(short.height).toBeCloseTo(27 + 2 * 6.4, 9);
  });

  it("keeps its label centred: on the body between the rim and the bottom arc", () => {
    expect(laidOut("bucket", LONG).labelOffset).toBeUndefined();
  });

  it("draws a body tapering to 72% of its width, and an open rim over it", () => {
    // At 200px wide the rim is its 12px maximum, centred 12px below the top;
    // the bottom is 144px wide and its arc's ends 12px above the bottom.
    const node = drawn("bucket");
    expect(node.tags).toEqual(["path", "path"]);
    expect(node.d).toEqual([
      "M10,32 L38,68 A72,12 0 0 0 182,68 L210,32 A100,12 0 0 0 10,32 Z",
      "M210,32 A100,12 0 0 0 10,32 A100,12 0 0 0 210,32 Z",
    ]);
    expect(node.classes).toEqual(["siren-node-frame", "siren-node-frame siren-node-hollow"]);
    expect(node.text).toEqual([110, 50]);
  });
});

/** `names` of `frame`, as numbers. */
function numbers(frame: Element, names: readonly string[]): number[] {
  return names.map((name) => Number(frame.getAttribute(name)));
}

describe("a person (`person`)", () => {
  it("is a body as tall as a rectangle under a head, at least 100px wide", () => {
    // `person`: `w = max(bbox.width + 2 x padding, 100)`, a head of radius
    // `clamp(0.23 x w, 16, 56)` overlapping the body by 27% of that radius,
    // over a body `bbox.height + 2 x padding` tall (measured: 150 x 110.68
    // around a 120 x 21 label — a 51px body and a 34.5px head).
    const long = laidOut("person", LONG);
    expect(long.width).toBe(152);
    expect(long.height).toBeCloseTo(27 + 2 * 34.96 - 0.27 * 34.96, 9);
    const short = laidOut("person", "x");
    expect(short.width).toBe(100);
    expect(short.height).toBeCloseTo(27 + 2 * 23 - 0.27 * 23, 9);
  });

  it("centres its label on the body, below the head", () => {
    // Mermaid: `bodyCenterY = bodyTop + bodyHeight / 2`, which is half the
    // head's visible height below the box's centre.
    const offset = laidOut("person", LONG).labelOffset;
    expect(offset?.x).toBe(0);
    expect(offset?.y).toBeCloseTo((2 * 34.96 - 0.27 * 34.96) / 2, 9);
  });

  it("draws a rounded body and a round head over its top", () => {
    // At 200px wide the head's radius is 46 and it overlaps the body by
    // 12.42px, so the body starts 79.58px down a 139.58px box and is 60px
    // tall; its corners are `min(0.177 x 200, 0.45 x 60) = 27`.
    const node = drawn("person", { x: 0, y: 39.79 }, 139.58);
    expect(node.tags).toEqual(["rect", "circle"]);
    const [body, head] = node.frames;
    const [x, y, width, height] = numbers(body!, ["x", "y", "width", "height"]);
    expect([x, width]).toEqual([10, 200]);
    expect(y).toBeCloseTo(99.58, 9);
    expect(height).toBeCloseTo(60, 9);
    expect(node.styles[0]).toMatch(/^rx:[\d.]+px$/);
    expect(parseFloat(node.styles[0]!.slice(3))).toBeCloseTo(27, 9);
    expect(node.styles[1]).toBeNull();
    expect(numbers(head!, ["cx", "cy", "r"])).toEqual([110, 66, 46]);
    expect(node.text[0]).toBe(110);
    expect(node.text[1]).toBeCloseTo(129.58, 9);
  });
});

describe("a console (`console`, Mermaid's `consoleWindow`)", () => {
  it("is a rectangle at least 90px wide with a 20px band for its prompt", () => {
    // `consoleWindow`: `w = max(bbox.width + 2 x padding, 90)`,
    // `h = bbox.height + 2 x padding + 20` (measured: 150 x 71 around a
    // 120 x 21 label).
    expect([laidOut("console", LONG).width, laidOut("console", LONG).height]).toEqual([152, 47]);
    expect([laidOut("console", "x").width, laidOut("console", "x").height]).toEqual([90, 47]);
  });

  it("centres its label on what lies below the band", () => {
    // Mermaid: `bodyCenterY = top + 20 + (h - 20) / 2`, 10px below the centre.
    expect(laidOut("console", LONG).labelOffset).toEqual({ x: 0, y: 10 });
  });

  it("draws a window with 12px corners and a `>_` prompt in its top left, in the line colour", () => {
    // Mermaid writes the prompt as `>_` in 14px bold monospace, its
    // baseline 16px below the top and 12px in from the left (measured:
    // the text's box is 16.86 x 16, 3px below the top). Siren draws the
    // two glyphs as strokes in that box, so the prompt does not depend on
    // which monospace face the viewer has.
    const node = drawn("console", { x: 0, y: 10 });
    expect(node.tags).toEqual(["rect", "path"]);
    expect(numbers(node.frames[0]!, ["x", "y", "width", "height"])).toEqual([10, 20, 200, 60]);
    expect(node.styles[0]).toBe("rx:12px");
    expect(node.d[1]).toBe("M23,26 L29,30.5 L23,35 M31,36 L38,36");
    expect(node.classes[1]).toBe("siren-node-frame siren-node-hollow");
    expect(node.styles[1]).toBe("stroke-width:2px;stroke-linecap:round;stroke-linejoin:round");
    expect(node.text).toEqual([110, 60]);
  });
});

describe("a browser (`browser`)", () => {
  it("is a rectangle at least 90px wide with an 18px bar across its top", () => {
    // `browser`: `w = max(bbox.width + 2 x padding, 90)`,
    // `h = bbox.height + 2 x padding + 18` (measured: 150 x 69 around a
    // 120 x 21 label).
    expect([laidOut("browser", LONG).width, laidOut("browser", LONG).height]).toEqual([152, 45]);
    expect([laidOut("browser", "x").width, laidOut("browser", "x").height]).toEqual([90, 45]);
  });

  it("centres its label on what lies below the bar", () => {
    // Mermaid: `bodyCenterY = top + 18 + (h - 18) / 2`, 9px below the centre.
    expect(laidOut("browser", LONG).labelOffset).toEqual({ x: 0, y: 9 });
  });

  it("draws a window with 12px corners, a line under its bar, three dots and an address bar", () => {
    // Measured: the line 18px below the top; dots of radius 2.5 at 12, 21
    // and 30px in, centred in the bar, filled in the border colour and not
    // stroked; an address bar 44px in and 4px down, `max(w - 56, 10)` by
    // 10 with 3px corners, unfilled and stroked at 60% opacity.
    const node = drawn("browser", { x: 0, y: 9 });
    expect(node.tags).toEqual(["rect", "line", "circle", "circle", "circle", "rect"]);
    const [window, line, ...rest] = node.frames;
    const bar = rest.pop()!;
    expect(numbers(window!, ["x", "y", "width", "height"])).toEqual([10, 20, 200, 60]);
    expect(numbers(line!, ["x1", "y1", "x2", "y2"])).toEqual([10, 38, 210, 38]);
    expect(rest.map((dot) => numbers(dot, ["cx", "cy", "r"]))).toEqual([
      [22, 29, 2.5],
      [31, 29, 2.5],
      [40, 29, 2.5],
    ]);
    expect(numbers(bar, ["x", "y", "width", "height"])).toEqual([54, 24, 144, 10]);
    expect(node.classes).toEqual([
      "siren-node-frame",
      "siren-node-frame",
      "siren-node-frame siren-node-ink",
      "siren-node-frame siren-node-ink",
      "siren-node-frame siren-node-ink",
      "siren-node-frame siren-node-hollow",
    ]);
    expect(node.styles).toEqual(["rx:12px", null, "stroke:none", "stroke:none", "stroke:none", "rx:3px;opacity:0.6"]);
    expect(node.text).toEqual([110, 59]);
  });

  it("keeps a narrow browser's address bar 10px wide", () => {
    const node = drawn("browser", { x: 0, y: 9 }, 60, 60);
    expect(numbers(node.frames.at(-1)!, ["width"])).toEqual([10]);
  });
});

describe("a bang (`bang`)", () => {
  it("is a quarter bigger each way than its scalloped outline's corners", () => {
    // `bang`: `w = bbox.width + 10 x halfPadding`, `h = bbox.height + 8 x
    // halfPadding`, and the outline reaches `0.1 x w` left of and
    // `0.15 x w` right of that, `0.1 x h` above and `0.15 x h` below —
    // `1.25 x w` by `1.25 x h` (measured: 243.75 x 101.25 around a 120 x 21
    // label, 195 x 81 at 7.5px half padding). The fake label has no height
    // beyond its padding, so its `bbox.height` is 0.
    const long = laidOut("bang", LONG);
    expect([long.width, long.height]).toEqual([1.25 * (122 + 75), 1.25 * 60]);
  });

  it("puts its label where the outline's corners centre it, a fortieth up and left of the box's centre", () => {
    // Mermaid centres the label on the `w x h` the outline's corners span,
    // which sits `0.025 x w` left of and `0.025 x h` above the centre of
    // the box (measured: the box's centre is 4.875, 2.025 from the label's).
    const offset = laidOut("bang", LONG).labelOffset;
    expect(offset?.x).toBeCloseTo(-0.025 * 197, 9);
    expect(offset?.y).toBeCloseTo(-0.025 * 60, 9);
  });

  it("draws Mermaid's scalloped outline, inscribed in the box", () => {
    // A 250 x 100 box is a 200 x 80 bang: arcs of radius 0.15 x 200 = 30
    // (24 for the two at the ends), from a corner 0.1 x w and 0.1 x h in.
    const node = drawn("bang", { x: -5, y: -2 }, 100, 250);
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual([
      "M30,28 a30,30 1 0,0 50,-8 a30,30 1 0,0 50,0 a30,30 1 0,0 50,0 a30,30 1 0,0 50,8 " +
        "a30,30 1 0,0 30,26.4 a24,24 1 0,0 0,27.2 a30,30 1 0,0 -30,26.4 " +
        "a30,30 1 0,0 -50,12 a30,30 1 0,0 -50,0 a30,30 1 0,0 -50,0 a30,30 1 0,0 -50,-12 " +
        "a30,30 1 0,0 -20,-26.4 a24,24 1 0,0 0,-27.2 a30,30 1 0,0 20,-26.4 H30 V28 Z",
    ]);
    expect(node.text).toEqual([130, 68]);
  });
});

/**
 * Mermaid's cloud around a 120px label one, two and four rows tall (21, 42
 * and 84px) — padded to 150 x 51, 150 x 72 and 150 x 114 — as Chrome
 * measured it: the box (`getBBox` of the outline), where the label's centre
 * is from the box's, and the outline it drew, as numbers in the order its
 * `d` writes them, from its `M`.
 *
 * Read off the table rather than through `layoutGraph`, whose fake
 * measurer cannot write a 150px label: these are Chrome's numbers, and the
 * table is the seam they are compared at. Compared to within 0.05px:
 * Chrome bounds an arc it had to scale up from an approximation of it, and
 * its `getBBox` of the tallest cloud is 0.02px narrower than the points
 * its own `getPointAtLength` reaches.
 */
const MEASURED_CLOUDS = [
  {
    padded: { width: 150, height: 51 },
    box: { width: 168.75, height: 100.8882064819336 },
    offset: { x: -3.3749923706, y: -1.9877898693 },
    // `M0 0` 13.5 right of and 30.456 below the box's corner.
    d: "M13.5,30.45631 a20.25,20.25 0 0,1 33.75,-13.5 a47.25,47.25 1 0,1 54,-13.5 a33.75,33.75 1 0,1 47.25,27 a20.25,20.25 1 0,1 20.25,12.6 a27,27 1 0,1 -20.25,23.4 a33.75,20.25 1 0,1 -33.75,20.25 a47.25,47.25 1 0,1 -67.5,0 a20.25,20.25 1 0,1 -33.75,-20.25 a20.25,20.25 1 0,1 -13.5,-12.6 a27,27 1 0,1 13.5,-23.4 H13.5 V30.45631 Z",
  },
  {
    padded: { width: 150, height: 72 },
    box: { width: 173.7738037109375, height: 121.8882064819336 },
    offset: { x: -2.9684066772, y: -1.9877898693 },
    d: "M16.41849,30.45631 a20.25,20.25 0 0,1 33.75,-13.5 a47.25,47.25 1 0,1 54,-13.5 a33.75,33.75 1 0,1 47.25,27 a20.25,20.25 1 0,1 20.25,19.95 a27,27 1 0,1 -20.25,37.05 a33.75,20.25 1 0,1 -33.75,20.25 a47.25,47.25 1 0,1 -67.5,0 a20.25,20.25 1 0,1 -33.75,-20.25 a20.25,20.25 1 0,1 -13.5,-19.95 a27,27 1 0,1 13.5,-37.05 H16.41849 V30.45631 Z",
  },
  {
    padded: { width: 150, height: 114 },
    box: { width: 218.45869445800778, height: 163.8882141113281 },
    offset: { x: -2.1261367798, y: -1.9877929688 },
    d: "M39.60321,30.45631 a20.25,20.25 0 0,1 33.75,-13.5 a47.25,47.25 1 0,1 54,-13.5 a33.75,33.75 1 0,1 47.25,27 a20.25,20.25 1 0,1 20.25,34.65 a27,27 1 0,1 -20.25,64.35 a33.75,20.25 1 0,1 -33.75,20.25 a47.25,47.25 1 0,1 -67.5,0 a20.25,20.25 1 0,1 -33.75,-20.25 a20.25,20.25 1 0,1 -13.5,-34.65 a27,27 1 0,1 13.5,-64.35 H39.60321 V30.45631 Z",
  },
];

/** Every number in a path's `d`, in order. */
function numbersOf(d: string): number[] {
  return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** `d` with every number moved by its command's offset: `x`, `y` to the `M` and the `H`/`V`. */
function movedBy(d: string, x: number, y: number): number[] {
  const values = numbersOf(d);
  values[0]! += x;
  values[1]! += y;
  values[values.length - 2]! += x;
  values[values.length - 1]! += y;
  return values;
}

describe("a cloud (`cloud`)", () => {
  it.each(MEASURED_CLOUDS.map((cloud) => [cloud.padded.height, cloud] as const))(
    "is as big as Mermaid's outline reaches, around a label padded to 150 x %s",
    (_, { padded, box }) => {
      // `cloud`: `w = bbox.width + 2 x halfPadding`, `h = bbox.height + 2 x
      // halfPadding`, and arcs of radii `0.15`, `0.2`, `0.25` and `0.35 x w`
      // bulging out past the `w x h` they join the corners of — further at
      // the sides the taller the label is.
      const size = SHAPES.cloud.box(padded, "TB");
      expect(size.width).toBeCloseTo(box.width, 1);
      expect(size.height).toBeCloseTo(box.height, 1);
    },
  );

  it.each(MEASURED_CLOUDS.map((cloud) => [cloud.padded.height, cloud] as const))(
    "centres its label where Mermaid does, around a label padded to 150 x %s",
    (_, { padded, box, offset }) => {
      // Mermaid centres the label on the `w x h` the arcs join, which the
      // bulges leave left of and above the box's centre.
      const placed = SHAPES.cloud.labelRect?.({ x: 0, y: 0, ...box }, padded);
      expect(placed).toBeDefined();
      if (placed === undefined) return;
      expect(placed.x + placed.width / 2 - box.width / 2).toBeCloseTo(offset.x, 1);
      expect(placed.y + placed.height / 2 - box.height / 2).toBeCloseTo(offset.y, 1);
    },
  );

  it("tells the renderer its label is off the centre", () => {
    const offset = laidOut("cloud", "a<br>b").labelOffset;
    expect(offset?.x).toBeLessThan(0);
    expect(offset?.y).toBeLessThan(0);
  });

  it.each(MEASURED_CLOUDS.map((cloud) => [cloud.padded.height, cloud] as const))(
    "draws Mermaid's outline inscribed in the box it measured around a label padded to 150 x %s",
    (_, { box, d }) => {
      const node = drawn("cloud", { x: 0, y: 0 }, box.height, box.width);
      expect(node.tags).toEqual(["path"]);
      const drawnNumbers = numbersOf(node.d[0]!);
      const expected = movedBy(d, 10, 20);
      expect(drawnNumbers).toHaveLength(expected.length);
      drawnNumbers.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 1));
    },
  );
});

/**
 * What an author's `style` reaches on a shape drawn as a figure plus
 * decorations. Measured in Chrome (Mermaid 12.2.0, classic look, `style D
 * fill:#f00,stroke:#0f0`): a browser's window takes it and its bar's line,
 * dots and address bar keep the border colour; a console's prompt keeps it
 * too. So those decorations stay out of the author's paint, and a red fill
 * cannot hide red dots on a red window.
 */
describe("an author's style on a shape's decorations", () => {
  /** Each frame `D` draws, as its tag and the inline style it carries. */
  const styledFrames = (shape: string) => {
    const container = document.createElement("div");
    const { diagnostics } = render(`flowchart TB\n  D@{ shape: ${shape}, label: "x" }\n  style D fill:#f00,stroke:#0f0`, container);
    expect(diagnostics).toEqual([]);
    return Array.from(container.querySelectorAll('g.siren-node[data-siren-id="D"] .siren-node-frame')).map(
      (frame) => [frame.tagName, (frame.getAttribute("style") ?? "").includes("fill:#f00")] as const,
    );
  };

  it("reaches a browser's window and none of its bar's line, dots or address bar", () => {
    expect(styledFrames("browser")).toEqual([
      ["rect", true],
      ["line", false],
      ["circle", false],
      ["circle", false],
      ["circle", false],
      ["rect", false],
    ]);
  });

  it("reaches a console's window and not its prompt", () => {
    expect(styledFrames("console")).toEqual([
      ["rect", true],
      ["path", false],
    ]);
  });

  it("reaches both of a bucket's frames, which Mermaid draws as one path", () => {
    expect(styledFrames("bucket")).toEqual([
      ["path", true],
      ["path", true],
    ]);
  });
});

describe("a cloud around a label far taller than it is wide", () => {
  it.each([
    [40, 400],
    [60, 600],
    [48, 300],
    [30, 900],
  ])("draws its outline from the corners the box was measured from, for a %s x %s label", (width, height) => {
    // `cloud`: the arcs join the corners of a `w x h` that is the text plus
    // `2 x halfPadding` — the padded label less 15px each way — starting at
    // its top left, and the label is centred on it. The outline drawn back
    // from the box alone has to find that same `w x h`.
    const padded = { width, height };
    const size = SHAPES.cloud.box(padded, "TB");
    const placed = SHAPES.cloud.labelRect!({ x: 10, y: 20, ...size }, padded);
    const node = drawn("cloud", { x: 0, y: 0 }, size.height, size.width);
    const [cornerX, cornerY] = numbersOf(node.d[0]!);
    expect(placed.x + placed.width / 2 - cornerX!).toBeCloseTo((width - 15) / 2, 2);
    expect(placed.y + placed.height / 2 - cornerY!).toBeCloseTo((height - 15) / 2, 2);
  });
});
