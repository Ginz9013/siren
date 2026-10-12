import { describe, expect, it } from "vitest";
import type { TextMeasurer } from "../contracts";
import { drawConnectorLabel, drawPlaced } from "./drawPlaced";
import { layoutLabel } from "./layoutLabel";
import { readLabel } from "./readLabel";

const fakeMeasurer: TextMeasurer = {
  measure(text: string) {
    return { width: text.length * 8, height: 20 };
  },
};

describe("drawPlaced", () => {
  it("draws a placed label at its own anchor, in rows from its own box, with the class it is given", () => {
    const { label } = readLabel("a<br>b", { dialect: "html" });
    const placed = { label, labelBox: layoutLabel(label, fakeMeasurer), anchor: { x: 30, y: 70 } };

    const { text, backgrounds } = drawPlaced(placed, "siren-edge-label");

    expect(text.getAttribute("x")).toBe("30");
    expect(text.getAttribute("y")).toBe("70");
    expect(text.getAttribute("class")).toBe("siren-edge-label");
    // Two 21px rows (14px × 1.5), padded once by the measurer's 20 − 21 =
    // −1px, make a 41px box centred on y=70: centres at 59.5 and 80.5.
    const rows = Array.from(text.querySelectorAll(":scope > tspan.siren-label-row"));
    expect(rows.map((row) => [row.textContent, row.getAttribute("y")])).toEqual([
      ["a", "59.5"],
      ["b", "80.5"],
    ]);
    expect(backgrounds).toEqual([]);
    expect(drawPlaced(placed).text.hasAttribute("class")).toBe(false);
  });

  it("draws a connector's label with its background, named, over the label's box and first among what is painted behind the text", () => {
    // "a<br>b" is two 21px rows less the measurer's −1px of padding, the
    // wider 8px wide: an 8 by 41 box centred on (30, 70).
    const { label } = readLabel("a<br>b", { dialect: "html" });
    const placed = { label, labelBox: layoutLabel(label, fakeMeasurer), anchor: { x: 30, y: 70 } };

    const drawn = drawConnectorLabel(placed, "siren-edge-label");

    expect(drawn.text.getAttribute("class")).toBe("siren-edge-label");
    expect(drawn.background).toBeDefined();
    expect(
      ["class", "x", "y", "width", "height"].map((name) => drawn.background.getAttribute(name)),
    ).toEqual(["siren-connector-label-background", "26", "49.5", "8", "41"]);
    expect(drawn.backgrounds[0]).toBe(drawn.background);
  });
});
