import { describe, expect, it } from "vitest";
import { parseStyleProperties } from "./parseDeclarationList";

// Characterization. These rules are not new — they were written twice, once
// in `parseFlowchart` and once in `parseClassDiagram`, and this ticket merged
// two byte-identical copies into one module. Every expectation below is taken
// from the behavior `parseClassDiagram.test.ts` already asserts through its
// source strings, restated at the module that now owns it so a third caller
// (`classDef`/`class` in a flowchart) has a direct net rather than borrowing
// one kind's suite. They were green the moment the module existed.
describe("parseStyleProperties", () => {
  it("splits a declaration list into property/value pairs in author order", () => {
    expect(parseStyleProperties("fill:#fdd,stroke:#c00,stroke-width:2px")).toEqual({
      properties: [
        { property: "fill", value: "#fdd" },
        { property: "stroke", value: "#c00" },
        { property: "stroke-width", value: "2px" },
      ],
      malformed: [],
    });
  });

  it("trims the whitespace around a property and its value", () => {
    expect(parseStyleProperties("  fill : #fdd , stroke:#c00 ")).toEqual({
      properties: [
        { property: "fill", value: "#fdd" },
        { property: "stroke", value: "#c00" },
      ],
      malformed: [],
    });
  });

  it("separates property from value at the first colon only, so a value keeps its own", () => {
    expect(parseStyleProperties("background:url(a:b)")).toEqual({
      properties: [{ property: "background", value: "url(a:b)" }],
      malformed: [],
    });
  });

  it("keeps a comma inside parentheses out of the split", () => {
    expect(parseStyleProperties("fill:rgb(255, 0, 0)")).toEqual({
      properties: [{ property: "fill", value: "rgb(255, 0, 0)" }],
      malformed: [],
    });
  });

  it("still splits the separating commas around and inside a nested paren value", () => {
    expect(
      parseStyleProperties("fill:color-mix(in srgb, rgb(1,2,3), #fff),stroke:#c00"),
    ).toEqual({
      properties: [
        { property: "fill", value: "color-mix(in srgb, rgb(1,2,3), #fff)" },
        { property: "stroke", value: "#c00" },
      ],
      malformed: [],
    });
  });

  it("reads an unclosed ( as running to the end of the list rather than dropping the text", () => {
    expect(parseStyleProperties("fill:rgb(1, 2,stroke:#c00")).toEqual({
      properties: [{ property: "fill", value: "rgb(1, 2,stroke:#c00" }],
      malformed: [],
    });
  });

  it("ignores a stray ), so the declarations after it still separate", () => {
    expect(parseStyleProperties("fill:a),stroke:#c00")).toEqual({
      properties: [
        { property: "fill", value: "a)" },
        { property: "stroke", value: "#c00" },
      ],
      malformed: [],
    });
  });

  it("returns a segment with no colon as malformed, beside the pairs that did read", () => {
    expect(parseStyleProperties("fill:rgb(1,2,3),wibble")).toEqual({
      properties: [{ property: "fill", value: "rgb(1,2,3)" }],
      malformed: ["wibble"],
    });
  });

  it("skips an empty segment instead of calling it malformed", () => {
    expect(parseStyleProperties("fill:#fdd,,  ,stroke:#c00")).toEqual({
      properties: [
        { property: "fill", value: "#fdd" },
        { property: "stroke", value: "#c00" },
      ],
      malformed: [],
    });
  });

  // The boundary this pins: the splitter reports shape, never safety. `url(`
  // and `expression(` are rejected by `resolveStyles`, which ADR-0008 names
  // as the one styling gate. A second opinion here is how one boundary
  // becomes two that disagree.
  it("returns a url( value intact — judging it belongs to resolveStyles", () => {
    expect(parseStyleProperties("fill:url(#evil)")).toEqual({
      properties: [{ property: "fill", value: "url(#evil)" }],
      malformed: [],
    });
  });
});
