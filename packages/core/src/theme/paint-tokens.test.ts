import { describe, expect, it } from "vitest";
import { readBeside } from "./testing/stylesheet";

/**
 * A colour token may hold `url(#id)` — a page's own `<linearGradient>`, `<radialGradient>` or
 * `<pattern>` — because the theme only ever hands a token's value to `fill` or `stroke` whole
 * (decision 01M5D5ZQQM84YNK3FJ1NE1G2S8). One `color-mix()` or `calc()` around a token would turn
 * that paint server into black without a word, so this file scans `default.css` for any other use.
 */

/** A binding of `import.meta.url`, not the literal, for `readBeside` (see its doc). */
const TEST_FILE_URL = import.meta.url;

/** The colour tokens that promise to carry a paint server. */
const PAINT_TOKENS = [
  "--siren-node-fill",
  "--siren-node-stroke",
  "--siren-node-text",
  "--siren-edge-stroke",
  "--siren-subgraph-fill",
  "--siren-label-mark-fill",
  "--siren-label-mark-text",
  "--siren-label-link",
  "--siren-edge-label-fill",
];

/**
 * Colour tokens outside the promise: the highlight glow wraps this one in `drop-shadow()`, which
 * takes a colour, not a paint server, so it must stay a colour.
 */
const GLOW_TOKENS = ["--siren-highlight-color"];

/** Every `--siren-*` name in the README token table's Colors and Label paint rows. */
function readmeColourTokens(readme: string): string[] {
  const rows = readme
    .split("\n")
    .filter((line) => /^\|\s*(Colors|Label paint)\s*\|/.test(line));
  if (rows.length !== 2) throw new Error("README has no Colors and Label paint rows");
  return rows.flatMap((row) =>
    Array.from(row.split("|").slice(2).join("|").matchAll(/--siren-[\w-]+/g), (match) => match[0]),
  );
}

interface Violation {
  token: string;
  property: string;
  line: number;
}

/** The stylesheet with every comment blanked out, line breaks kept so line numbers still hold. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

/** The index just past the `)` that closes the `(` at `open`. */
function closeParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i + 1;
  }
  return text.length;
}

/**
 * Whether `value` is `use` whole: `use` itself, or `var(--other, <fallback>)` whose fallback is
 * `use` whole — either way the custom property resolves to the token's value untouched.
 */
function isWholeValue(value: string, use: string): boolean {
  if (value === use) return true;
  const fallback = /^var\(\s*--[\w-]+\s*,\s*/.exec(value);
  if (!fallback || closeParen(value, 3) !== value.length) return false;
  return isWholeValue(value.slice(fallback[0].length, -1).trim(), use);
}

/**
 * Whether the `var()` at `start` is the colour of the `drop-shadow()` immediately around it:
 * the function's other arguments are all lengths.
 */
function isDropShadowColour(text: string, start: number, length: number): boolean {
  const open = /drop-shadow\(([^()]*)$/.exec(text.slice(0, start));
  if (!open) return false;
  const close = text.indexOf(")", start + length);
  const rest = open[1] + text.slice(start + length, close);
  return /^(\s*-?[\d.]+(px|em|rem)?)+\s*$/.test(rest);
}

/**
 * Where a paint token is used as anything but the whole value of `fill`, `stroke`, or a
 * `--siren-*` / `--_siren-*` custom property that carries it on. A glow token is held to the same,
 * except that it may also be the colour of a `drop-shadow()`.
 */
function paintTokenViolations(
  css: string,
  tokens: readonly string[],
  glowTokens: readonly string[] = [],
): Violation[] {
  const text = stripComments(css);
  const violations: Violation[] = [];
  for (const match of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const token = match[1];
    const glow = glowTokens.includes(token);
    if (!glow && !tokens.includes(token)) continue;
    const start = match.index;
    const use = text.slice(start, closeParen(text, start + 3));
    const declStart = Math.max(...[";", "{", "}"].map((c) => text.lastIndexOf(c, start))) + 1;
    const ends = [";", "}"].map((c) => text.indexOf(c, start)).filter((i) => i !== -1);
    const declaration = text.slice(declStart, ends.length ? Math.min(...ends) : text.length);
    const colon = declaration.indexOf(":");
    const property = declaration.slice(0, colon).trim();
    const value = declaration
      .slice(colon + 1)
      .replace(/!important\s*$/, "")
      .trim();
    const paintOrTransfer =
      property === "fill" || property === "stroke" || /^--_?siren-/.test(property);
    const allowed =
      (paintOrTransfer && isWholeValue(value, use)) ||
      (glow && isDropShadowColour(text, start, use.length));
    if (!allowed) {
      violations.push({ token, property, line: text.slice(0, start).split("\n").length });
    }
  }
  return violations;
}

describe("paintTokenViolations", () => {
  it("reports a token mixed into another colour", () => {
    const css = [".x {", "  fill: color-mix(in srgb, var(--siren-node-fill), white);", "}"].join(
      "\n",
    );
    expect(paintTokenViolations(css, ["--siren-node-fill"])).toEqual([
      { token: "--siren-node-fill", property: "fill", line: 2 },
    ]);
  });

  it("allows a whole-value transfer into another Siren custom property, and nothing looser", () => {
    const css = [
      ".a {",
      "  --_siren-note-fill: var(--siren-node-fill);",
      "  --siren-node-fill: var(--_siren-note-fill, var(--siren-node-fill)) !important;",
      "  fill: var(--siren-x, var(--siren-node-fill));",
      "}",
      ".b { --_siren-tint: color-mix(in srgb, var(--siren-node-fill) 50%, white); }",
      ".c { --other-fill: var(--siren-node-fill); background: var(--siren-node-fill); }",
    ].join("\n");
    expect(paintTokenViolations(css, ["--siren-node-fill"])).toEqual([
      { token: "--siren-node-fill", property: "--_siren-tint", line: 6 },
      { token: "--siren-node-fill", property: "--other-fill", line: 7 },
      { token: "--siren-node-fill", property: "background", line: 7 },
    ]);
  });

  it("allows a glow token as the colour of a drop-shadow(), and a paint token not even there", () => {
    const css = [
      ".a {",
      "  filter: drop-shadow(0 0 4px var(--siren-highlight-color))",
      "    drop-shadow(0 0 8px var(--siren-highlight-color));",
      "  stroke: var(--siren-highlight-color);",
      "}",
      ".b { fill: color-mix(in srgb, var(--siren-highlight-color), white); }",
      ".c { filter: blur(var(--siren-highlight-color)); }",
      ".d { filter: drop-shadow(0 0 4px var(--siren-node-fill)); }",
    ].join("\n");
    expect(
      paintTokenViolations(css, ["--siren-node-fill"], ["--siren-highlight-color"]),
    ).toEqual([
      { token: "--siren-highlight-color", property: "fill", line: 6 },
      { token: "--siren-highlight-color", property: "filter", line: 7 },
      { token: "--siren-node-fill", property: "filter", line: 8 },
    ]);
  });
});

describe("the colour tokens in default.css", () => {
  it("reach SVG paint only whole, so each can hold url(#id)", () => {
    expect(paintTokenViolations(readBeside(TEST_FILE_URL, "./default.css"), PAINT_TOKENS, GLOW_TOKENS)).toEqual([]);
  });

  it("are exactly the README table's Colors and Label paint tokens", () => {
    expect([...PAINT_TOKENS, ...GLOW_TOKENS].sort()).toEqual(
      readmeColourTokens(readBeside(TEST_FILE_URL, "../../README.md")).sort(),
    );
  });
});
