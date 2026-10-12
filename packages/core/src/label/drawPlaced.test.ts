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
    // Two 20px rows make a 40px box centred on y=70: centres at 60 and 80.
    const rows = Array.from(text.querySelectorAll(":scope > tspan.siren-label-row"));
    expect(rows.map((row) => [row.textContent, row.getAttribute("y")])).toEqual([
      ["a", "60"],
      ["b", "80"],
    ]);
    expect(backgrounds).toEqual([]);
    expect(drawPlaced(placed).text.hasAttribute("class")).toBe(false);
  });

  it("draws a connector's label with its background, named, over the label's box and first among what is painted behind the text", () => {
    // "a<br>b" is two 20px rows, the wider 8px wide: an 8 by 40 box centred
    // on (30, 70).
    const { label } = readLabel("a<br>b", { dialect: "html" });
    const placed = { label, labelBox: layoutLabel(label, fakeMeasurer), anchor: { x: 30, y: 70 } };

    const drawn = drawConnectorLabel(placed, "siren-edge-label");

    expect(drawn.text.getAttribute("class")).toBe("siren-edge-label");
    expect(drawn.background).toBeDefined();
    expect(
      ["class", "x", "y", "width", "height"].map((name) => drawn.background.getAttribute(name)),
    ).toEqual(["siren-connector-label-background", "26", "50", "8", "40"]);
    expect(drawn.backgrounds[0]).toBe(drawn.background);
  });
});
