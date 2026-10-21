import { describe, expect, it } from "vitest";
import { applyInlineStyle } from "./inlineStyle";

const SVG_NS = "http://www.w3.org/2000/svg";

function rect(): SVGRectElement {
  return document.createElementNS(SVG_NS, "rect");
}

describe("applyInlineStyle", () => {
  it("writes the declarations as one style attribute, joined with ';' in the order given", () => {
    const element = rect();

    applyInlineStyle(element, [
      { property: "fill", value: "#f96" },
      { property: "stroke", value: "#333" },
      { property: "fill", value: "#0f0" },
    ]);

    expect(element.getAttribute("style")).toBe("fill:#f96;stroke:#333;fill:#0f0");
  });

  it("writes each value verbatim, spaces and all", () => {
    const element = rect();

    applyInlineStyle(element, [
      { property: "stroke-dasharray", value: "5 5" },
      { property: "font-family", value: "'Fira Code', monospace" },
    ]);

    expect(element.getAttribute("style")).toBe("stroke-dasharray:5 5;font-family:'Fira Code', monospace");
  });

  it("leaves the element without a style attribute when the list is empty", () => {
    const element = rect();

    applyInlineStyle(element, []);

    expect(element.hasAttribute("style")).toBe(false);
  });
});
