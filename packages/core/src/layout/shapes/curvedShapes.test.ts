import { describe, expect, it } from "vitest";
import type { NodeShape, PositionedGraph } from "../../contracts";
import { plainLabel } from "../../label/label";
import { layoutLabel } from "../../label/layoutLabel";
import { renderToSVG } from "../../renderer/renderToSVG";
import { SHAPES } from "./shapeTable";
import { layoutGraph } from "../layoutGraph";

/**
 * The shapes a node's `@{ shape: … }` block names whose outline is curved,
 * through the two seams that read the shape table: `layoutGraph` (the box,
 * and where the label goes in it) and `renderToSVG` (the outline).
 *
 * Every number below is Mermaid 12.2.0's formula for that shape (classic
 * look, its handler in `rendering-elements/shapes`), measured in headless
 * Chrome and applied to the box a rectangle would draw — the padded label —
 * rather than copied from a run of this code. Each handler pads the text
 * its own way, so a record starts from the text: the padded label less
 * Mermaid's 15px node padding on each side. `MEASURED` holds Mermaid's own
 * boxes around a one-row and a three-row text.
 */

/**
 * The node `shape` draws in the box `10,20 200x60` (or `width x height`),
 * labelled "x", its label moved off the centre by `labelOffset` as layout
 * reported it.
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
    width: width + 20,
    height: height + 40,
  };
  const group = renderToSVG(graph).querySelector('g.siren-node[data-siren-id="A"]')!;
  const frames = Array.from(group.querySelectorAll(".siren-node-frame"));
  const text = group.querySelector("text")!;
  return {
    frames,
    tags: frames.map((frame) => frame.tagName),
    d: frames.map((frame) => frame.getAttribute("d")),
    classes: frames.map((frame) => frame.getAttribute("class")),
    text: [Number(text.getAttribute("x")), Number(text.getAttribute("y"))],
  };
}

describe("a half-rounded rectangle (`delay`)", () => {
  it.each(measured("delay"))("is as big as Mermaid draws it around a %s", (_, { padded, box, offset }) => {
    expectSized("half-rounded-rectangle", padded, box, offset);
  });

  it("clears the round end by the cap's depth at the text's own corners, which a short label keeps shallow", () => {
    // `halfRoundedRectangle`: `h = max(10, text) + 2p`, `r = h/2`, `w =
    // max(15, text) + 2 x capClearance + 2p`, `capClearance = r - sqrt(r^2
    // - (text/2)^2)` — the text being the padded label less 15px a side.
    // A 30 x 21 text: `r = 25.5`, a clearance of 2.26 each side.
    const size = SHAPES["half-rounded-rectangle"].box({ width: 60, height: 51 }, "TB");
    expect(size.height).toBe(51);
    expect(size.width).toBeCloseTo(30 + 2 * (25.5 - Math.sqrt(25.5 ** 2 - 10.5 ** 2)) + 30, 9);
  });

  it("draws a square left end and a semicircular right one, and centres its label", () => {
    const node = drawn("half-rounded-rectangle");
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual(["M10,20 L180,20 A30,30 0 0 1 180,80 L10,80 Z"]);
    expect(node.classes).toEqual(["siren-node-frame"]);
    expect(node.text).toEqual([110, 50]);
  });
});

describe("a curved trapezoid (`curv-trap`, a display)", () => {
  it.each(measured("curv-trap"))("is as big as Mermaid draws it around a %s", (_, { padded, box, offset }) => {
    expectSized("curved-trapezoid", padded, box, offset);
  });

  it("widens a short label by its point and round end, at least a quarter", () => {
    // `curvedTrapezoid`: `h = text + 2p`, `side = max(h/4, capClearance)`,
    // `w = max(text + 2p + 2 x side, 1.25 x (text + 2p))`. A 30 x 21 text:
    // `side = 12.75`, so `w = 60 + 25.5`.
    const size = SHAPES["curved-trapezoid"].box({ width: 60, height: 51 }, "TB");
    expect([size.width, size.height]).toEqual([85.5, 51]);
  });

  it("points its left end a quarter of its height deep and rounds its right end", () => {
    // Mermaid's points: `(w - r, 0)`, `(h/4, 0)`, `(0, h/2)`, `(h/4, h)`,
    // `(w - r, h)`, then a half circle of radius `r = h/2` back to the top.
    const node = drawn("curved-trapezoid");
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual(["M180,20 L25,20 L10,50 L25,80 L180,80 A30,30 0 0 0 180,20 Z"]);
    expect(node.text).toEqual([110, 50]);
  });
});

describe("a horizontal cylinder (`h-cyl`, direct access storage)", () => {
  it.each(measured("h-cyl"))("is as big as Mermaid draws it around a %s, its label where Mermaid puts it", (_, { padded, box, offset }) => {
    // `tiltedCylinder`: `h = text + p/2`, `ry = h/2`, `rx = ry / (2.5 + h/50)`,
    // `w = text + p/2 + rx` between the ends' centres and an end `rx` either
    // side; the label moves `rx` left, off the lid at the right end.
    expectSized("horizontal-cylinder", padded, box, offset);
  });

  it("draws a tube bulging at both ends and, over it, the whole lid at its right end", () => {
    // 75px tall: `ry = 37.5`, `rx = 37.5 / (2.5 + 1.5) = 9.375`.
    const node = drawn("horizontal-cylinder", { x: -9.375, y: 0 }, 75);
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual([
      "M19.375,95 A9.375,37.5 0 0 1 19.375,20 L200.625,20 A9.375,37.5 0 0 1 200.625,95 Z " +
        "M200.625,20 A9.375,37.5 0 0 1 200.625,95 A9.375,37.5 0 0 1 200.625,20 Z",
    ]);
    expect(node.text).toEqual([100.625, 57.5]);
  });
});

describe("a lined cylinder (`lin-cyl`, disk storage)", () => {
  it.each(measured("lin-cyl"))("is as big as Mermaid draws it around a %s, its label where Mermaid puts it", (_, { padded, box, offset }) => {
    // `linedCylinder`: `w = text + 2p`, `rx = w/2`, `ry = rx / (2.5 + w/50)`,
    // a body `text + 2p + ry` tall and a lid and a base of `ry` above and
    // below it; the label moves `ry` down, off the lid.
    expectSized("lined-cylinder", padded, box, offset);
  });

  it("draws a cylinder with its lid and a line a tenth of the body down from it", () => {
    // 125px wide: `rx = 62.5`, `ry = 62.5 / (2.5 + 2.5) = 12.5`; 100px tall,
    // so the body is 75px and the line `0.1 x 75` below the lid's middle.
    const node = drawn("lined-cylinder", { x: 0, y: 12.5 }, 100, 125);
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual([
      "M10,32.5 A62.5,12.5 0 0 1 135,32.5 L135,107.5 A62.5,12.5 0 0 1 10,107.5 Z " +
        "M10,32.5 A62.5,12.5 0 0 1 135,32.5 A62.5,12.5 0 0 1 10,32.5 Z " +
        "M10,40 A62.5,12.5 0 0 0 135,40",
    ]);
    expect(node.text).toEqual([72.5, 82.5]);
  });
});

describe("a bow-tie rectangle (`bow-rect`, stored data)", () => {
  it.each(measured("bow-rect"))("is as big as Mermaid draws it around a %s, its label where Mermaid puts it", (_, { padded, box, offset }) => {
    // `bowTieRect`: `h = text + p`, `ry = h/2`, `rx = ry / (2.5 + h/50)`,
    // `w = text + 2p + rx` — the arcs' sagitta, which for a half ellipse is
    // `rx`. The label is centred.
    expectSized("bow-tie-rectangle", padded, box, offset);
  });

  it("bulges its left end out and curves its right end in, by half an ellipse each", () => {
    // 75px tall: `ry = 37.5`, `rx = 9.375`.
    const node = drawn("bow-tie-rectangle", undefined, 75);
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual(["M210,20 L19.375,20 A9.375,37.5 0 0 0 19.375,95 L210,95 A9.375,37.5 0 0 1 210,20 Z"]);
    expect(node.text).toEqual([110, 57.5]);
  });
});

describe("a document (`doc`)", () => {
  it.each(measured("doc"))("is as big as Mermaid draws it around a %s, its label where Mermaid puts it", (_, { padded, box, offset }) => {
    // `waveEdgedRectangle`: `w = text + 2p`, `h = text + 2p`, a wave of
    // amplitude `h/8` below a body `h` tall, so the box is `1.25 x h`; the
    // label moves `h/8` up.
    expectSized("document", padded, box, offset);
  });

  it("draws its bottom as Mermaid's sine wave, 0.8 of a cycle in 51 points, under a straight top", () => {
    // 80px tall: `h = 64`, the amplitude 8, the wave's middle `h + h/8`
    // below the top. The points are Mermaid's `generateFullSineWavePoints`,
    // rounded to hundredths.
    const node = drawn("document", { x: 0, y: -8 }, 80);
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual([
      "M10,92 L14,92.8 L18,93.6 L22,94.38 L26,95.13 L30,95.85 L34,96.54 L38,97.18 L42,97.76 L46,98.29 L50,98.75 L54,99.15 L58,99.47 L62,99.72 L66,99.89 L70,99.98 L74,99.99 L78,99.92 L82,99.77 L86,99.54 L90,99.24 L94,98.86 L98,98.41 L102,97.9 L106,97.33 L110,96.7 L114,96.03 L118,95.32 L122,94.57 L126,93.79 L130,93 L134,92.2 L138,91.4 L142,90.6 L146,89.82 L150,89.06 L154,88.32 L158,87.63 L162,86.98 L166,86.38 L170,85.84 L174,85.36 L178,84.94 L182,84.6 L186,84.33 L190,84.14 L194,84.03 L198,84 L202,84.05 L206,84.18 L210,84.39 L210,20 L10,20 Z",
    ]);
    expect(node.text).toEqual([110, 52]);
  });
});

describe("a lined document (`lin-doc`)", () => {
  it.each(measured("lin-doc"))("is as big as Mermaid draws it around a %s, its label where Mermaid puts it", (_, { padded, box, offset }) => {
    // `linedWaveEdgedRect`: a document `1.1 x w` wide, the label moved as a
    // document's is and `0.025 x w` right, clear of the line.
    expectSized("lined-document", padded, box, offset);
  });

  it("draws a document's outline with a line down from its top to its wave", () => {
    // 220px wide: `w = 200`, the line 10px in. Mermaid runs the line to
    // `1.1 x` the body's half height, past the wave; Siren stops it on
    // the wave.
    const node = drawn("lined-document", { x: 5, y: -8 }, 80, 220);
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual([
      "M10,92 L14.4,92.8 L18.8,93.6 L23.2,94.38 L27.6,95.13 L32,95.85 L36.4,96.54 L40.8,97.18 L45.2,97.76 L49.6,98.29 L54,98.75 L58.4,99.15 L62.8,99.47 L67.2,99.72 L71.6,99.89 L76,99.98 L80.4,99.99 L84.8,99.92 L89.2,99.77 L93.6,99.54 L98,99.24 L102.4,98.86 L106.8,98.41 L111.2,97.9 L115.6,97.33 L120,96.7 L124.4,96.03 L128.8,95.32 L133.2,94.57 L137.6,93.79 L142,93 L146.4,92.2 L150.8,91.4 L155.2,90.6 L159.6,89.82 L164,89.06 L168.4,88.32 L172.8,87.63 L177.2,86.98 L181.6,86.38 L186,85.84 L190.4,85.36 L194.8,84.94 L199.2,84.6 L203.6,84.33 L208,84.14 L212.4,84.03 L216.8,84 L221.2,84.05 L225.6,84.18 L230,84.39 L230,20 L10,20 Z M20,20 L20,93.81",
    ]);
    expect(node.text).toEqual([125, 52]);
  });
});

describe("a tagged document (`tag-doc`)", () => {
  it.each(measured("tag-doc"))("is as big as Mermaid draws it around a %s, its label where Mermaid puts it", (_, { padded, box, offset }) => {
    // `taggedWaveEdgedRectangle`: a document `1.1 x w` wide, the label
    // moved `h/16` up.
    expectSized("tagged-document", padded, box, offset);
  });

  it("draws a document's outline and, over its bottom right, a filled tag with a wavy edge", () => {
    // 220 x 80: `w = 200`, `h = 64`. The tag is Mermaid's polygon, its
    // points written about the node's centre — `(0.35w, 0.46475h)`,
    // `(0.55w, 0.1575h)`, `(0.55w, 0.32175h)` and a half-cycle wave of
    // amplitude `-0.02h` back — moved `h/16` up with the outline.
    const node = drawn("tagged-document", { x: 0, y: -4 }, 80, 220);
    expect(node.tags).toEqual(["path", "path"]);
    expect(node.d).toEqual([
      "M10,92 L14.4,92.8 L18.8,93.6 L23.2,94.38 L27.6,95.13 L32,95.85 L36.4,96.54 L40.8,97.18 L45.2,97.76 L49.6,98.29 L54,98.75 L58.4,99.15 L62.8,99.47 L67.2,99.72 L71.6,99.89 L76,99.98 L80.4,99.99 L84.8,99.92 L89.2,99.77 L93.6,99.54 L98,99.24 L102.4,98.86 L106.8,98.41 L111.2,97.9 L115.6,97.33 L120,96.7 L124.4,96.03 L128.8,95.32 L133.2,94.57 L137.6,93.79 L142,93 L146.4,92.2 L150.8,91.4 L155.2,90.6 L159.6,89.82 L164,89.06 L168.4,88.32 L172.8,87.63 L177.2,86.98 L181.6,86.38 L186,85.84 L190.4,85.36 L194.8,84.94 L199.2,84.6 L203.6,84.33 L208,84.14 L212.4,84.03 L216.8,84 L221.2,84.05 L225.6,84.18 L230,84.39 L230,20 L10,20 Z",
      "M190,85.74 L230,66.08 L230,76.59 L230,85.17 L229.2,85.09 L228.4,85.01 L227.6,84.93 L226.8,84.85 L226,84.78 L225.2,84.7 L224.4,84.63 L223.6,84.56 L222.8,84.49 L222,84.42 L221.2,84.36 L220.4,84.3 L219.6,84.24 L218.8,84.19 L218,84.14 L217.2,84.09 L216.4,84.05 L215.6,84.01 L214.8,83.98 L214,83.95 L213.2,83.93 L212.4,83.91 L211.6,83.9 L210.8,83.89 L210,83.89 L209.2,83.89 L208.4,83.9 L207.6,83.91 L206.8,83.93 L206,83.95 L205.2,83.98 L204.4,84.01 L203.6,84.05 L202.8,84.09 L202,84.14 L201.2,84.19 L200.4,84.24 L199.6,84.3 L198.8,84.36 L198,84.42 L197.2,84.49 L196.4,84.56 L195.6,84.63 L194.8,84.7 L194,84.78 L193.2,84.85 L192.4,84.93 L191.6,85.01 L190.8,85.09 L190,85.17 Z",
    ]);
    expect(node.classes).toEqual(["siren-node-frame", "siren-node-frame"]);
    expect(node.text).toEqual([120, 56]);
  });
});

describe("a stacked document (`docs`, documents)", () => {
  it.each(measured("docs"))("is as big as Mermaid draws it around a %s, its label where Mermaid puts it", (_, { padded, box, offset }) => {
    // `multiWaveEdgedRectangle`: `w = text + 2p`, `h = text + 3p`, a body
    // `h + h/16` over a wave of amplitude `h/8`, three sheets 10px apart; the
    // label moves 10px left and `10 - h/8` down, onto the front sheet.
    expectSized("stacked-document", padded, box, offset);
  });

  it("draws the stack's silhouette with a wavy bottom and, over it, the middle sheet's edges, both filled", () => {
    // 220 x 96: `w = 200`, `h = 64`, the amplitude 8, the front sheet's
    // wave 108 down; Mermaid's two polygons, the wave its 51 points.
    const node = drawn("stacked-document", { x: -10, y: 2 }, 96, 220);
    expect(node.tags).toEqual(["path", "path"]);
    expect(node.d).toEqual([
      "M10,40 L10,108 L14,108.8 L18,109.6 L22,110.38 L26,111.13 L30,111.85 L34,112.54 L38,113.18 L42,113.76 L46,114.29 L50,114.75 L54,115.15 L58,115.47 L62,115.72 L66,115.89 L70,115.98 L74,115.99 L78,115.92 L82,115.77 L86,115.54 L90,115.24 L94,114.86 L98,114.41 L102,113.9 L106,113.33 L110,112.7 L114,112.03 L118,111.32 L122,110.57 L126,109.79 L130,109 L134,108.2 L138,107.4 L142,106.6 L146,105.82 L150,105.06 L154,104.32 L158,103.63 L162,102.98 L166,102.38 L170,101.84 L174,101.36 L178,100.94 L182,100.6 L186,100.33 L190,100.14 L194,100.03 L198,100 L202,100.05 L206,100.18 L210,100.39 L210,90.39 L220,90.39 L220,80.39 L230,80.39 L230,20 L30,20 L30,30 L20,30 L20,40 Z",
      "M20,40 L210,40 L210,90.39 L220,90.39 L220,30 L20,30 Z",
    ]);
    expect(node.classes).toEqual(["siren-node-frame", "siren-node-frame"]);
    expect(node.text).toEqual([110, 70]);
  });
});

describe("a flag (`flag`, a paper tape)", () => {
  it.each(measured("flag"))("is as big as Mermaid draws it around a %s, its label where Mermaid puts it", (_, { padded, box, offset }) => {
    // `waveRectangle`: `w = text + 2p`, `h = text + p`, waves of amplitude
    // `h/8` top and bottom, so the box is `1.5 x h`; the label is centred.
    expectSized("flag", padded, box, offset);
  });

  it("draws a wave along its bottom and the same wave back along its top, in Mermaid's 51 points each", () => {
    // 96px tall: `h = 64`, the amplitude 8, the waves' middles 40px either
    // side of the centre.
    const node = drawn("flag", undefined, 96);
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual([
      "M10,108 L14,109 L18,109.99 L22,110.94 L26,111.85 L30,112.7 L34,113.48 L38,114.16 L42,114.75 L46,115.24 L50,115.61 L54,115.86 L58,115.98 L62,115.98 L66,115.86 L70,115.61 L74,115.24 L78,114.75 L82,114.16 L86,113.48 L90,112.7 L94,111.85 L98,110.94 L102,109.99 L106,109 L110,108 L114,107 L118,106.01 L122,105.06 L126,104.15 L130,103.3 L134,102.52 L138,101.84 L142,101.25 L146,100.76 L150,100.39 L154,100.14 L158,100.02 L162,100.02 L166,100.14 L170,100.39 L174,100.76 L178,101.25 L182,101.84 L186,102.52 L190,103.3 L194,104.15 L198,105.06 L202,106.01 L206,107 L210,108 L210,28 L206,27 L202,26.01 L198,25.06 L194,24.15 L190,23.3 L186,22.52 L182,21.84 L178,21.25 L174,20.76 L170,20.39 L166,20.14 L162,20.02 L158,20.02 L154,20.14 L150,20.39 L146,20.76 L142,21.25 L138,21.84 L134,22.52 L130,23.3 L126,24.15 L122,25.06 L118,26.01 L114,27 L110,28 L106,29 L102,29.99 L98,30.94 L94,31.85 L90,32.7 L86,33.48 L82,34.16 L78,34.75 L74,35.24 L70,35.61 L66,35.86 L62,35.98 L58,35.98 L54,35.86 L50,35.61 L46,35.24 L42,34.75 L38,34.16 L34,33.48 L30,32.7 L26,31.85 L22,30.94 L18,29.99 L14,29 L10,28 Z",
    ]);
    expect(node.text).toEqual([110, 68]);
  });
});

describe("a left curly brace (`brace`, a comment)", () => {
  it.each(measured("brace"))("is as big as Mermaid draws it around a %s, its label where Mermaid puts it", (_, { padded, box, offset }) => {
    // `curlyBraceLeft`: `w = text + p`, `h = text + p`, `r = max(5, 0.1h)`,
    // the box `max(1.1w, w + 2r)` by `h + 2r`, the text starting `(box - w)`
    // from its left.
    expectSized("brace-left", padded, box, offset);
  });

  it("draws an open, unfilled brace of quarter-circle curls left of its label", () => {
    // 220 x 60: `r = 5`, `w = 200`, the tips 200px from the right.
    const node = drawn("brace-left", { x: 10, y: 0 }, 60, 220);
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual([
      "M30,80 A5,5 0 0 1 25,75 L25,55 A5,5 0 0 0 20,50 A5,5 0 0 0 25,45 L25,25 A5,5 0 0 1 30,20",
    ]);
    expect(node.classes).toEqual(["siren-node-frame siren-node-hollow"]);
    expect(node.text).toEqual([130, 50]);
  });
});

describe("a right curly brace (`brace-r`)", () => {
  it.each(measured("brace-r"))("is as big as Mermaid draws it around a %s, its label where Mermaid puts it", (_, { padded, box, offset }) => {
    // `curlyBraceRight`: `w = text + p`, `h = text + p`, the box `w + 2r`
    // by `h + 2r`, the label centred.
    expectSized("brace-right", padded, box, offset);
  });

  it("draws an open, unfilled brace along its right edge", () => {
    const node = drawn("brace-right");
    expect(node.tags).toEqual(["path"]);
    expect(node.d).toEqual([
      "M200,20 A5,5 0 0 1 205,25 L205,45 A5,5 0 0 0 210,50 A5,5 0 0 0 205,55 L205,75 A5,5 0 0 1 200,80",
    ]);
    expect(node.classes).toEqual(["siren-node-frame siren-node-hollow"]);
    expect(node.text).toEqual([110, 50]);
  });
});

describe("curly braces (`braces`)", () => {
  it.each(measured("braces"))("is as big as Mermaid draws it around a %s, its label where Mermaid puts it", (_, { padded, box, offset }) => {
    // `curlyBraces`: `w = text + p`, `h = text + p`, the box `w + 2.5r` by
    // `h + 2r`, the label centred.
    expectSized("braces", padded, box, offset);
  });

  it("draws an open, unfilled brace along each side", () => {
    const node = drawn("braces");
    expect(node.tags).toEqual(["path", "path"]);
    expect(node.d).toEqual([
      "M20,80 A5,5 0 0 1 15,75 L15,55 A5,5 0 0 0 10,50 A5,5 0 0 0 15,45 L15,25 A5,5 0 0 1 20,20",
      "M200,20 A5,5 0 0 1 205,25 L205,45 A5,5 0 0 0 210,50 A5,5 0 0 0 205,55 L205,75 A5,5 0 0 1 200,80",
    ]);
    expect(node.classes).toEqual(["siren-node-frame siren-node-hollow", "siren-node-frame siren-node-hollow"]);
    expect(node.text).toEqual([110, 50]);
  });

  it("grows its curls with a tall label, to a tenth of its height", () => {
    // `r = max(5, 0.1 x h)`: a 120px box is a 100px label and 10px curls.
    const node = drawn("braces", undefined, 120);
    expect(node.d).toEqual([
      "M30,140 A10,10 0 0 1 20,130 L20,90 A10,10 0 0 0 10,80 A10,10 0 0 0 20,70 L20,30 A10,10 0 0 1 30,20",
      "M190,20 A10,10 0 0 1 200,30 L200,70 A10,10 0 0 0 210,80 A10,10 0 0 0 200,90 L200,130 A10,10 0 0 1 190,140",
    ]);
  });
});

/**
 * Mermaid 12.2.0's box around a label of each curved shape, measured in
 * headless Chrome (classic look) around a 120px text one row (21px) and
 * three rows (63px) tall, with its 15px node padding — so the padded label
 * Siren hands a shape is that text plus 15px a side: 150 x 51 and 150 x 93.
 * `offset` is how far the text's centre stands from the box's.
 *
 * Classic, the look the shape table follows: the parity report's own run
 * with `--look classic` reads the same boxes back. The three curly braces
 * are all 46px tall at one row because in the classic look all three pad
 * the text by `p` and curl by `max(5, h/10)`; Mermaid's default `neo` look
 * pads `brace-r` and `braces` twice as much (55px) and `brace` with its own
 * 12px (43px).
 */
const MEASURED: Record<string, ReadonlyArray<{ rows: number; box: [number, number]; offset: [number, number] }>> = {
  delay: [
    { rows: 1, box: [154.51, 51], offset: [0, 0] },
    { rows: 3, box: [174.57, 93], offset: [0, 0] },
  ],
  "curv-trap": [
    { rows: 1, box: [187.49, 51], offset: [0, 0] },
    { rows: 3, box: [196.48, 93], offset: [0, 0] },
  ],
  "h-cyl": [
    { rows: 1, box: [141.43, 28.5], offset: [-4.65, 0] },
    { rows: 3, box: [154.54, 70.5], offset: [-9.02, 0] },
  ],
  "bow-rect": [
    { rows: 1, box: [155.57, 36], offset: [0, 0] },
    { rows: 3, box: [159.57, 78], offset: [-0.02, 0] },
  ],
  "lin-cyl": [
    { rows: 1, box: [150, 91.91], offset: [0, 13.64] },
    { rows: 3, box: [150, 133.91], offset: [0, 13.64] },
  ],
  doc: [
    { rows: 1, box: [150, 63.75], offset: [0, -6.38] },
    { rows: 3, box: [150, 116.24], offset: [0, -11.62] },
  ],
  "lin-doc": [
    { rows: 1, box: [165, 63.75], offset: [3.75, -6.38] },
    { rows: 3, box: [165, 116.24], offset: [3.75, -11.62] },
  ],
  "tag-doc": [
    { rows: 1, box: [165, 63.75], offset: [0, -3.19] },
    { rows: 3, box: [165, 116.24], offset: [0, -5.81] },
  ],
  docs: [
    { rows: 1, box: [170, 98.37], offset: [-10, 1.75] },
    { rows: 3, box: [170, 148.24], offset: [-10, -3.5] },
  ],
  flag: [
    { rows: 1, box: [150, 53.98], offset: [0, 0] },
    { rows: 3, box: [150, 116.96], offset: [0, 0] },
  ],
  brace: [
    { rows: 1, box: [148.5, 46], offset: [-0.75, 0] },
    { rows: 3, box: [150.6, 93.6], offset: [0.3, 0] },
  ],
  "brace-r": [
    { rows: 1, box: [145, 46], offset: [0, 0] },
    { rows: 3, box: [150.6, 93.6], offset: [0, 0] },
  ],
  braces: [
    { rows: 1, box: [147.5, 46], offset: [0, 0] },
    { rows: 3, box: [154.5, 93.6], offset: [0, 0] },
  ],
};

/** The measured cases for `name`, as `it.each` rows: a description, and the padded label, box and offset. */
function measured(name: string) {
  return MEASURED[name]!.map(({ rows, box, offset }) => [
    `${rows}-row label`,
    { padded: { width: 150, height: rows === 1 ? 51 : 93 }, box, offset },
  ] as const);
}

/** `shape`'s box around `padded` is Mermaid's measured `box`, and its label's centre stands `offset` from the box's. */
function expectSized(
  shape: NodeShape,
  padded: { width: number; height: number },
  box: readonly [number, number],
  offset: readonly [number, number],
) {
  const size = SHAPES[shape].box(padded, "TB");
  expect(size.width).toBeCloseTo(box[0], 1);
  expect(size.height).toBeCloseTo(box[1], 1);
  const placed = SHAPES[shape].labelRect?.({ x: 0, y: 0, ...size }, padded) ?? {
    x: (size.width - padded.width) / 2,
    y: (size.height - padded.height) / 2,
    ...padded,
  };
  expect(placed.x + placed.width / 2 - size.width / 2).toBeCloseTo(offset[0], 1);
  expect(placed.y + placed.height / 2 - size.height / 2).toBeCloseTo(offset[1], 1);
}

/**
 * Laid out by `layoutGraph`, a curved shape pads the text with Siren's own
 * node padding — what the padded label adds to the text on each side, the
 * measurer's padding — wherever its handler pads with Mermaid's, so that it
 * stands to a rectangle as Mermaid's stands to Mermaid's.
 */
describe("a curved shape padded with Siren's own node padding", () => {
  /** 8px a character plus 24px of padding, 32px a line: a text pads 24px a side across and 11px up and down. */
  const paddedMeasurer = { measure: (text: string) => ({ width: text.length * 8 + 24, height: 32 }) };
  const laidOut = (shape: NodeShape) =>
    layoutGraph(
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

  it("is the rectangle's own size for a rectangle: the 80 x 21 text plus 24 and 11 a side", () => {
    const rect = laidOut("rect");
    expect([rect.width, rect.height]).toEqual([128, 43]);
  });

  it("pads a horizontal cylinder by half the vertical padding: `h = text + p/2`, `w = text + p/2 + 3rx`", () => {
    const node = laidOut("horizontal-cylinder");
    const height = 21 + 11 / 2;
    const rx = height / 2 / (2.5 + height / 50);
    expect(node.height).toBeCloseTo(height, 9);
    expect(node.width).toBeCloseTo(80 + 24 / 2 + 3 * rx, 9);
  });

  it("pads a flag once in height, `1.5 x (text + p)`, and a curly brace once each way", () => {
    expect(laidOut("flag").height).toBeCloseTo(1.5 * (21 + 11), 9);
    const brace = laidOut("brace-right");
    expect([brace.width, brace.height]).toEqual([80 + 24 + 10, 21 + 11 + 10]);
  });
});
