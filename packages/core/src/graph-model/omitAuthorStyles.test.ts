import { describe, expect, it } from "vitest";
import type { AuthorStyle } from "../contracts";
import { omittedStyleNames, withoutOmitted, writeAuthorStyles } from "./omitAuthorStyles";

const painted = (): AuthorStyle => ({
  frame: [
    { property: "fill", value: "#f96" },
    { property: "stroke", value: "#333" },
    { property: "stroke-width", value: "4px" },
  ],
  text: [{ property: "fill", value: "#00f" }],
});

describe("omittedStyleNames", () => {
  it("is empty when the caller named nothing", () => {
    expect(omittedStyleNames(undefined).size).toBe(0);
  });

  it("holds each name lower-cased, as CSS matches property names", () => {
    expect([...omittedStyleNames(["FILL", "Stroke-Width"])]).toEqual(["fill", "stroke-width"]);
  });
});

describe("withoutOmitted", () => {
  it("matches a name case-insensitively on either side", () => {
    const style: AuthorStyle = { frame: [{ property: "Stroke", value: "#333" }], text: [] };

    expect(withoutOmitted(style, omittedStyleNames(["STROKE"]))).toEqual({ frame: [], text: [] });
  });

  it("strikes a frame `fill` for `fill` and leaves the label's colour, which is `color`", () => {
    expect(withoutOmitted(painted(), omittedStyleNames(["fill"]))).toEqual({
      frame: [
        { property: "stroke", value: "#333" },
        { property: "stroke-width", value: "4px" },
      ],
      text: [{ property: "fill", value: "#00f" }],
    });
  });

  it("strikes the label's `fill` for `color`, and the frame keeps its own", () => {
    expect(withoutOmitted(painted(), omittedStyleNames(["color"]))).toEqual({
      frame: [
        { property: "fill", value: "#f96" },
        { property: "stroke", value: "#333" },
        { property: "stroke-width", value: "4px" },
      ],
      text: [],
    });
  });

  it("returns a new style and leaves the one it was handed as written", () => {
    const style = painted();

    const struck = withoutOmitted(style, omittedStyleNames(["fill", "color"]));

    expect(struck).not.toBe(style);
    expect(style).toEqual(painted());
  });
});

describe("writeAuthorStyles", () => {
  it("writes the struck style onto the target the lookup returns", () => {
    const styled: { style?: AuthorStyle } = {};
    const unstyled: { style?: AuthorStyle } = {};
    const targets = new Map([
      ["a", styled],
      ["b", unstyled],
    ]);
    const style = painted();

    writeAuthorStyles([{ targetId: "a", style }], (id) => targets.get(id), omittedStyleNames(["stroke"]));

    expect(styled.style).toEqual({
      frame: [
        { property: "fill", value: "#f96" },
        { property: "stroke-width", value: "4px" },
      ],
      text: [{ property: "fill", value: "#00f" }],
    });
    expect(unstyled).not.toHaveProperty("style");
    expect(style).toEqual(painted());
  });

  it("throws by name when the lookup finds no target", () => {
    expect(() =>
      writeAuthorStyles([{ targetId: "ghost", style: painted() }], () => undefined, omittedStyleNames(undefined)),
    ).toThrow("writeAuthorStyles: no target for style ghost");
  });
});
