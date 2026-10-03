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
});
