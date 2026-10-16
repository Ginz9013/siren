import { describe, expect, it } from "vitest";
import { unsafeStyleValue } from "./unsafeStyleValue";

describe("unsafeStyleValue", () => {
  it.each([
    ["url(http://e/a.png)", "url("],
    ["image-set('http://e/a.png' 1x)", "image-set("],
    ["-webkit-image-set('http://e/a.png' 1x)", "image-set("],
    ["IMAGE-SET ('http://e/a.png' 1x)", "image-set("],
    ["cross-fade(url(#a), red)", "url("],
    ["cross-fade('http://e/a.png', red)", "cross-fade("],
    ["-webkit-cross-fade('a.png', 'b.png', 50%)", "cross-fade("],
    ["image('http://e/a.png')", "image("],
    ["element(#a)", "element("],
    ["-moz-element(#a)", "element("],
    ["src('http://e/a.png')", "src("],
    ["image-set/**/('http://e/a.png' 1x)", "image-set("],
    ["/* x */ image-set('http://e/a.png' 1x)", "image-set("],
    ["expression(alert(1))", "expression("],
  ])("refuses %s, a function that fetches or runs", (value, name) => {
    expect(unsafeStyleValue(value)).toMatchObject({ kind: "function", name });
  });

  it("refuses a value whose comment is never closed, which could hide a function from the rule", () => {
    expect(unsafeStyleValue("red /* image-set(")).toMatchObject({ kind: "function" });
  });

  it.each(["red", "#f00", "rgb(1, 2, 3)", "hsl(0 50% 50%)", "color-mix(in srgb, red, blue)", "calc(1px + 2px)", "var(--x)", "2px dashed", "linear-gradient(red, blue)"])(
    "keeps %s, which fetches nothing",
    (value) => {
      expect(unsafeStyleValue(value)).toBeNull();
    },
  );
});
