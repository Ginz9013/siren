import { describe, expect, it } from "vitest";
import { render } from "../index";
import { CANVAS_GUTTER, sizeCanvas } from "./sizeCanvas";

const SVG_NS = "http://www.w3.org/2000/svg";

describe("sizeCanvas", () => {
  it("grows the canvas by the gutter on every side without moving the drawing", () => {
    // The origin shifts to `-gutter` rather than every element shifting to
    // `+gutter`: a node laid out at (0, 0) still has x="0", and only the
    // window onto it widens.
    const svg = document.createElementNS(SVG_NS, "svg");
    sizeCanvas(svg, 200, 100);

    const span = (length: number) => String(length + CANVAS_GUTTER * 2);
    expect({
      width: svg.getAttribute("width"),
      height: svg.getAttribute("height"),
      viewBox: svg.getAttribute("viewBox"),
    }).toEqual({
      width: span(200),
      height: span(100),
      viewBox: `${-CANVAS_GUTTER} ${-CANVAS_GUTTER} ${span(200)} ${span(100)}`,
    });
  });

  it("leaves room for the widest highlight the default theme paints outside a frame", () => {
    // `.siren-highlight-glow` stacks an 8px drop-shadow, which blurs past
    // the frame by about its own radius, and an outline highlight sits half
    // of a 3-wide stroke outside it. A gutter under either one clips a
    // highlighted element that the layout placed against the edge.
    expect(CANVAS_GUTTER).toBeGreaterThanOrEqual(8 + 3 / 2);
  });

  it("is what every diagram kind's root svg is sized by", () => {
    const documents = [
      "flowchart LR\n  A --> B",
      "sequenceDiagram\n  Alice->>Bob: hi",
      "classDiagram\n  class Animal",
      "stateDiagram-v2\n  [*] --> Idle",
      "erDiagram\n  CUSTOMER ||--o{ ORDER : places",
    ];
    for (const source of documents) {
      const { svg } = render(source, document.createElement("div"));
      expect([source, svg?.getAttribute("viewBox")?.split(" ").slice(0, 2)]).toEqual([
        source,
        [String(-CANVAS_GUTTER), String(-CANVAS_GUTTER)],
      ]);
    }
  });
});
