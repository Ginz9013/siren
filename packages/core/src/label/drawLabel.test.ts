import { describe, expect, it } from "vitest";
import type { TextMeasurer } from "../contracts";
import { drawLabel } from "./drawLabel";
import { layoutLabel } from "./layoutLabel";
import { readLabel } from "./readLabel";

const fakeMeasurer: TextMeasurer = {
  measure(text: string) {
    return { width: text.length * 8, height: 20 };
  },
};

/** Reads, measures and draws `source` centred on (100, 50). */
function drawn(source: string, markdown = false) {
  const { label } = readLabel(source, { dialect: "html", markdown });
  return drawLabel(label, layoutLabel(label, fakeMeasurer), { x: 100, y: 50 });
}

describe("drawLabel", () => {
  it("draws a one-row plain label as the text element's own textContent, with no tspan", () => {
    const { text, backgrounds } = drawn("Start");

    expect(text.tagName).toBe("text");
    expect(text.textContent).toBe("Start");
    expect(text.querySelectorAll("tspan")).toHaveLength(0);
    expect(text.getAttribute("x")).toBe("100");
    expect(text.getAttribute("y")).toBe("50");
    expect(text.getAttribute("text-anchor")).toBe("middle");
    expect(text.getAttribute("dominant-baseline")).toBe("middle");
    expect(backgrounds).toEqual([]);
  });

  it("draws one tspan.siren-label-row per row, centred as a block on the anchor", () => {
    const { text } = drawn("a<br/>b");

    const rows = Array.from(text.querySelectorAll(":scope > tspan.siren-label-row"));
    expect(rows.map((row) => row.textContent)).toEqual(["a", "b"]);
    // Two 20px rows make a 40px box centred on y=50: centres at 40 and 60.
    expect(rows.map((row) => row.getAttribute("y"))).toEqual(["40", "60"]);
    expect(rows.map((row) => row.getAttribute("x"))).toEqual(["100", "100"]);
  });

  it("draws a styled run in a row of its own even when it is the only one, bold and italic set only when true", () => {
    const { text } = drawn("**md**<br/>*it* x", true);

    const rows = Array.from(text.querySelectorAll(":scope > tspan.siren-label-row"));
    const runs = rows.map((row) =>
      Array.from(row.querySelectorAll("tspan")).map((run) => [
        run.textContent,
        run.getAttribute("font-weight"),
        run.getAttribute("font-style"),
      ]),
    );
    expect(runs).toEqual([
      [["md", "bold", null]],
      [
        ["it", null, "italic"],
        [" x", null, null],
      ],
    ]);
  });

  it("puts the class it is given on the <text>, plain or in rows, and none when given none", () => {
    const fakeBox = (source: string) => {
      const { label } = readLabel(source, { dialect: "html" });
      return { label, box: layoutLabel(label, fakeMeasurer) };
    };
    const plain = fakeBox("Start");
    const rows = fakeBox("a<br>b");

    expect(drawLabel(plain.label, plain.box, { x: 0, y: 0 }, "siren-note-text").text.getAttribute("class")).toBe(
      "siren-note-text",
    );
    expect(drawLabel(rows.label, rows.box, { x: 0, y: 0 }, "siren-note-text").text.getAttribute("class")).toBe(
      "siren-note-text",
    );
    expect(drawLabel(plain.label, plain.box, { x: 0, y: 0 }).text.hasAttribute("class")).toBe(false);
  });

  it("builds elements without attaching them anywhere", () => {
    const { text } = drawn("a<br>b");

    expect(text.parentNode).toBeNull();
  });

  it("draws an underlined or struck-through run with text-decoration, both when both", () => {
    const { text } = drawn("<u>u</u><s>s</s><u><del>b</del></u>");

    const runs = Array.from(text.querySelectorAll("tspan.siren-label-row > tspan"));
    expect(runs.map((run) => [run.textContent, run.getAttribute("text-decoration")])).toEqual([
      ["u", "underline"],
      ["s", "line-through"],
      ["b", "underline line-through"],
    ]);
  });

  it("draws a monospace run in the monospace family", () => {
    const { text } = drawn("x <code>c</code>");

    const runs = Array.from(text.querySelectorAll("tspan.siren-label-row > tspan"));
    expect(runs.map((run) => [run.textContent, run.getAttribute("font-family")])).toEqual([
      ["x ", null],
      ["c", "monospace"],
    ]);
  });

  it("draws a scaled run's font size in em, relative to the text's own", () => {
    const { text } = drawn("x <small>s</small><big>b</big>");

    const runs = Array.from(text.querySelectorAll("tspan.siren-label-row > tspan"));
    expect(runs.map((run) => [run.textContent, run.getAttribute("font-size")])).toEqual([
      ["x ", null],
      ["s", "0.833em"],
      ["b", "1.2em"],
    ]);
  });

  // Headless Chrome, 16px text: a 13.33px `sub` sits 4.19px below the
  // baseline and a `sup` 6.33px above it — 0.314 and 0.475 of the run's own
  // size. A `dy` in `em` is read in the run's own size, and the run after it
  // shifts back by the same distance in *its* own size.
  it("shifts a sub or sup run off the baseline with dy, and the next run back", () => {
    const { text } = drawn("H<sub>2</sub>O x<sup>2</sup><br>y");

    const rows = Array.from(text.querySelectorAll(":scope > tspan.siren-label-row"));
    const runs = rows.map((row) =>
      Array.from(row.querySelectorAll("tspan")).map((run) => [
        run.textContent,
        run.getAttribute("dy"),
      ]),
    );
    expect(runs).toEqual([
      [
        ["H", null],
        ["2", "0.314em"],
        ["O x", "-0.2616em"],
        ["2", "-0.475em"],
      ],
      // A row is placed at an absolute y, so the shift ends with the row.
      [["y", null]],
    ]);
  });

  // Mermaid draws a `<mark>` on a yellow background (measured). SVG text
  // has no background, so it is a rect behind the text, wherever the box
  // measured the run.
  it("puts one rect behind a marked run, at the run's place in its row, and none behind any other", () => {
    // 8px a character plus 16px of the measurer's own padding, 20px a line:
    // the second row, `x mm`, is 8 + 16 + 16 + 8 = 48 wide, centred on
    // x=100, so it starts at 76 and `mm` at 76 + 8 + 16 = 100. Two 20px rows
    // centred on y=50 put the second one between 50 and 70.
    const padded: TextMeasurer = {
      measure(text: string) {
        return { width: text.length * 8 + 16, height: 20 };
      },
    };
    const { label } = readLabel("a<br>x <mark>mm</mark>", { dialect: "html" });

    const { backgrounds } = drawLabel(label, layoutLabel(label, padded), { x: 100, y: 50 });

    expect(
      backgrounds.map((rect) => [
        rect.tagName,
        rect.getAttribute("class"),
        rect.getAttribute("x"),
        rect.getAttribute("y"),
        rect.getAttribute("width"),
        rect.getAttribute("height"),
      ]),
    ).toEqual([["rect", "siren-label-mark", "100", "50", "16", "20"]]);
  });

  // Not measured: derived from CSS, where an inline element's background
  // covers its own inline box — one line of its own font size — and not the
  // line box of the row around it. A `<big>` beside the mark makes the row
  // 1.2 lines tall; the mark's rect stays one line (20px), centred on the
  // row's centre.
  it("makes a marked run's rect one line of its own size tall, however tall its row is", () => {
    const { label } = readLabel("<big>B</big><mark>m</mark>", { dialect: "html" });

    const { backgrounds } = drawLabel(label, layoutLabel(label, fakeMeasurer), { x: 100, y: 50 });

    // The row is 24px tall, centred on y=50; the rect is 20px, 40 to 60.
    expect(backgrounds.map((rect) => [rect.getAttribute("y"), rect.getAttribute("height")])).toEqual([
      ["40", "20"],
    ]);
  });

  // Not measured either: a `sub`/`sup` element's inline box moves with its
  // text, so its background does. The rect is shifted by the same fraction
  // `dy` shifts the text by (0.314 down, 0.475 up), taken of the run's own
  // line rather than its font size, which `drawLabel` does not know.
  it("moves a marked sub or sup run's rect with the run's shift", () => {
    const rectOf = (source: string) => {
      const { label } = readLabel(source, { dialect: "html" });
      const [rect] = drawLabel(label, layoutLabel(label, fakeMeasurer), { x: 100, y: 50 }).backgrounds;
      return [Number(rect!.getAttribute("y")), Number(rect!.getAttribute("height"))];
    };

    // A 0.833 run's line is 16.66px; centred on the row's y=50 it would
    // start at 41.67. A sub moves it down 0.314 × 16.66 = 5.231, a sup up
    // 0.475 × 16.66 = 7.914.
    const [subY, subHeight] = rectOf("H<sub><mark>2</mark></sub>");
    expect(subHeight).toBeCloseTo(16.66, 3);
    expect(subY).toBeCloseTo(46.901, 3);
    const [supY] = rectOf("x<sup><mark>2</mark></sup>");
    expect(supY).toBeCloseTo(33.757, 3);
  });

  // Mermaid's marked text is black on the yellow, whatever color the label
  // around it is (measured): the theme's `--siren-label-mark-text`, reached
  // through a class on the run itself so it outranks the color the `<text>`
  // inherits.
  it("draws a marked run's text with a class of its own, and no other run with it", () => {
    const { text } = drawn("x <mark>m</mark>");

    const runs = Array.from(text.querySelectorAll("tspan.siren-label-row > tspan"));
    expect(runs.map((run) => [run.textContent, run.getAttribute("class")])).toEqual([
      ["x ", null],
      ["m", "siren-label-mark-text"],
    ]);
  });
});
