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
});
