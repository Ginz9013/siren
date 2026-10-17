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

  it.each([
    ['"/*" url(https://evil/x) "*/"', "url("],
    ['"/*" attr(x) "*/"', "attr("],
    ["'/*' image-set('a.png' 1x) '*/'", "image-set("],
  ])("refuses %s, whose quoted comment marks hide no call", (value, name) => {
    expect(unsafeStyleValue(value)).toMatchObject({ kind: "function", name });
  });

  it("keeps a quoted name holding comment marks, which are text inside a string", () => {
    expect(unsafeStyleValue('"/*", red')).toBeNull();
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

describe("unsafeStyleValue as an allowlist of the functions a style value may use", () => {
  it.each([
    "rgb(1, 2, 3)",
    "rgba(1, 2, 3, 0.5)",
    "hsl(120 50% 50%)",
    "hsla(120, 50%, 50%, .5)",
    "hwb(120 10% 10%)",
    "lab(50% 40 59.5)",
    "lch(52% 72 56)",
    "oklab(0.6 0.1 0.1)",
    "oklch(0.6 0.15 30)",
    "color(display-p3 1 0 0)",
    "color-mix(in srgb, red 40%, blue)",
    "calc((1px + 2px) * 2)",
    "min(1px, 2em)",
    "max(1px, 2em)",
    "clamp(1px, 2vw, 3px)",
    "var(--accent, #f00)",
    "linear-gradient(to right, red, blue)",
    "radial-gradient(circle at 50% 50%, red, blue)",
    "conic-gradient(from 90deg, red, blue)",
    "repeating-linear-gradient(45deg, red 0 10px, blue 10px 20px)",
    "repeating-radial-gradient(red, blue 10%)",
    "repeating-conic-gradient(red 0 25%, blue 0 50%)",
    "RGB(1, 2, 3)",
    "Linear-Gradient(red, blue)",
    "rgb(1 2 3 / 50%)",
    "color-mix(in oklch, rgb(1 2 3), var(--x))",
    "12px 'Courier New', \"Noto Sans\", monospace",
    "red !important",
  ])("keeps %s, which is built only from the allowed parts", (value) => {
    expect(unsafeStyleValue(value)).toBeNull();
  });

  it.each([
    ["attr(data-x)", "attr("],
    ["env(safe-area-inset-top)", "env("],
    ["paint(checker)", "paint("],
    ["foo(1)", "foo("],
    ["ATTR(data-x)", "ATTR("],
    ["-webkit-linear-gradient(red, blue)", "-webkit-linear-gradient("],
    ["color-mix(in srgb, attr(x), red)", "attr("],
    ["calc(1px + env(x))", "env("],
    ["linear-gradient(red, paint(x))", "paint("],
  ])("refuses %s, a function outside the allowlist", (value, name) => {
    expect(unsafeStyleValue(value)).toMatchObject({ kind: "function", name });
  });

  it.each([
    ["ur/**/l(http://e/a.png)", "url("],
    ["URL(http://e/a.png)", "url("],
    ["linear-gradient(red, url(http://e/a.png))", "url("],
    ["calc(1px + image-set('a.png' 1x))", "image-set("],
  ])("refuses %s, a fetching function however it is hidden", (value, name) => {
    expect(unsafeStyleValue(value)).toMatchObject({ kind: "function", name });
  });
});

describe("unsafeStyleValue as an allowlist of the characters a style value is written with", () => {
  it.each([
    ["a{b", "{"],
    ["a}b", "}"],
    ["a<b", "<"],
    ["a@b", "@"],
    ["a=b", "="],
    ["a[b]", "["],
    ["a$b", "$"],
    ["a|b", "|"],
    ["a~b", "~"],
    ["a^b", "^"],
    ["a?b", "?"],
    ["a`b", "`"],
    ["'Courier New", "'"],
    ['"Courier New', '"'],
    ["red !foo", "!"],
    ["rgb(1, 2, 3", "("],
    ["red)", ")"],
    ['"a\nb"', '"'],
    ["'a\rb'", "'"],
    ['"a\fb"', '"'],
  ])("refuses %s, which holds %s outside a quoted name", (value, character) => {
    expect(unsafeStyleValue(value)).toEqual({ kind: "character", character });
  });

  it.each(["'a{b}:c'", '"Font @ Home"', "微軟正黑體, sans-serif", "1.5em", "-2px", "+.5", "50%", "#ABCDEF80", "red !IMPORTANT", "calc(100% / 3 - 2 * 1px)", "#fddposition:fixed"])(
    "keeps %s",
    (value) => {
      expect(unsafeStyleValue(value)).toBeNull();
    },
  );
});
