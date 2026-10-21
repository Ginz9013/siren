import { describe, expect, it, vi } from "vitest";
import { readBeside, readStylesheet } from "./stylesheet";

/** This file's own URL, bound first: Vite rewrites a literal `new URL("…", import.meta.url)`. */
const TEST_FILE_URL = import.meta.url;

describe("readBeside", () => {
  it("reads a file resolved against the caller's URL", () => {
    const css = readBeside(TEST_FILE_URL, "../default.css");

    // default.css opens its token block early; an empty read (what `?raw`
    // yields under vitest) would fail here rather than pass vacuously.
    expect(css).toContain(":root {");
    expect(css).toContain("--siren-node-fill:");
  });
});

/**
 * A small sheet with one of each thing the reader must get right: a class
 * named only in a comment, a token block written with a comma, a second
 * token block, a class whose name prefixes another's, `!important`, a rule
 * mixing `:root` with a class, a rule inside `@media`, and `@keyframes`.
 */
const FIXTURE = `
/* .siren-ghost is only discussed here, { braces } and all: --t-ghost: #123; */
:root, :root {
  --t-fill: #fff;
  --t-stroke: rgb(1, 2, 3);
}
:root {
  --t-gap: 4px;
}
.siren-box-background {
  fill: var(--t-fill);
  --t-hook: var(--t-gap);
}
.siren-edge, :root {
  stroke: var(--t-stroke, #000) !important;
}
@media (prefers-reduced-motion: reduce) {
  .siren-edge {
    animation: var(--t-march, none);
  }
}
@keyframes siren-march {
  to {
    stroke-dashoffset: 0;
  }
}
.siren-edge-fast {
  animation: var(--t-march-fast);
  --t-march: siren-march var(--t-march-fast) linear;
}
`;

const readFixture = (css: string) => readStylesheet(css, { tokenPrefix: "--t-", rootSelector: ":root" });

describe("readStylesheet", () => {
  it("lists every style rule in sheet order, walking @media and skipping comments and @keyframes", () => {
    const sheet = readFixture(FIXTURE);

    expect(sheet.text).toBe(FIXTURE);
    expect(sheet.rules.map((rule) => [rule.selector, rule.nested])).toEqual([
      [":root, :root", false],
      [":root", false],
      [".siren-box-background", false],
      [".siren-edge, :root", false],
      [".siren-edge", true],
      [".siren-edge-fast", false],
    ]);
    expect(sheet.rules[3].declarations).toEqual([
      { property: "stroke", value: "var(--t-stroke, #000)", important: true },
    ]);
    expect(sheet.rules[2].declarations).toEqual([
      { property: "fill", value: "var(--t-fill)", important: false },
      { property: "--t-hook", value: "var(--t-gap)", important: false },
    ]);
    expect(sheet.rules[3].cssText).toMatch(/^stroke: var\(--t-stroke, #000\) !important;$/);
    expect(sheet.rules[2].cssText).toMatch(/fill: var\(--t-fill\);/);
  });

  it("finds the one rule whose selector is exactly the one asked for", () => {
    const sheet = readFixture(FIXTURE);

    expect(sheet.rule(".siren-edge-fast")?.cssText).toMatch(/animation: var\(--t-march-fast\);/);
    // Exactly: `.siren-edge, :root` is a rule of its own, not a `:root` or a
    // `.siren-edge`, so each of those names its single exact rule.
    expect(sheet.rule(":root")?.declarations.map((d) => d.property)).toEqual(["--t-gap"]);
    expect(sheet.rule(".siren-edge")?.nested).toBe(true);
    expect(sheet.rule(".siren-box")).toBeUndefined();
  });

  it("throws when the injected <style> yields no sheet", () => {
    // jsdom parses an attached `<style>`; one kept out of the document has a
    // null `sheet`, which is the only way to reach the guard.
    const append = vi.spyOn(document.head, "appendChild").mockImplementation((node) => node);
    try {
      expect(() => readFixture("a { color: red; }")).toThrow(/has no sheet/);
    } finally {
      append.mockRestore();
    }
  });

  it("throws, naming the selector, when more than one rule is exactly it", () => {
    const sheet = readFixture(".siren-a { color: red; }\n@media print { .siren-a { color: blue; } }");

    expect(() => sheet.rule(".siren-a")).toThrow(/2 rules select exactly "\.siren-a"/);
  });

  it("names every rule declaring a property, @media ones included", () => {
    const sheet = readFixture(FIXTURE);

    expect(sheet.rulesDeclaring("animation")).toEqual([".siren-edge", ".siren-edge-fast"]);
    expect(sheet.rulesDeclaring("--t-march")).toEqual([".siren-edge-fast"]);
    // The comment's `--t-ghost: #123;` declares nothing; nor does `@keyframes`.
    expect(sheet.rulesDeclaring("--t-ghost")).toEqual([]);
    expect(sheet.rulesDeclaring("stroke-dashoffset")).toEqual([]);
  });

  it("says a class is selected only when a selector names it as a whole token", () => {
    const sheet = readFixture(FIXTURE);

    expect(sheet.selectsClass("siren-box-background")).toBe(true);
    expect(sheet.selectsClass("siren-edge-fast")).toBe(true);
    // Only inside @media in its bare form, and part of a list at top level.
    expect(sheet.selectsClass("siren-edge")).toBe(true);
    // A prefix of a selected class is not selected.
    expect(sheet.selectsClass("siren-box")).toBe(false);
    // Named in a comment only.
    expect(sheet.selectsClass("siren-ghost")).toBe(false);
  });

  it("sees a class selected only inside @media, since at-rules are walked", () => {
    const sheet = readFixture(".siren-a { color: red; }\n@media print { .siren-only-print { color: blue; } }");

    expect(sheet.selectsClass("siren-only-print")).toBe(true);
  });

  it("sees a class named inside :is( and :not(", () => {
    const sheet = readFixture(":is(.siren-a, .siren-b) .x:not(.siren-c) { color: red; }");

    expect(sheet.selectsClass("siren-a")).toBe(true);
    expect(sheet.selectsClass("siren-b")).toBe(true);
    expect(sheet.selectsClass("siren-c")).toBe(true);
  });

  it("marks rules inside @supports, and @media within it, as nested", () => {
    const sheet = readFixture("@supports (display: grid) { @media print { .siren-s { color: red; } } .siren-t { color: blue; } }");

    expect(sheet.rules.map((rule) => [rule.selector, rule.nested])).toEqual([
      [".siren-s", true],
      [".siren-t", true],
    ]);
  });

  it("takes as token blocks the rules whose every selector part is the root selector", () => {
    expect(readFixture(FIXTURE).tokenBlocks().map((rule) => rule.selector)).toEqual([":root, :root", ":root"]);

    // Board's root selector: `:root` alone is then not a token block.
    const board = readStylesheet(":where(:root) { --b-a: 1px; }\n:root { --b-b: 2px; }", {
      tokenPrefix: "--b-",
      rootSelector: ":where(:root)",
    });
    expect(board.tokenBlocks().map((rule) => rule.selector)).toEqual([":where(:root)"]);
  });

  it("never takes a rule with a comma inside :is(…) for a token block", () => {
    const sheet = readFixture(":is(:root, :root) { --t-a: 1px; }\n:root, :is(:root, .siren-x) { --t-b: 2px; }");

    expect(sheet.rules.map((rule) => rule.selector)).toEqual([":is(:root, :root)", ":root, :is(:root, .siren-x)"]);
    expect(sheet.tokenBlocks()).toEqual([]);
  });

  it("tells tokens declared anywhere from tokens declared in a token block", () => {
    const sheet = readFixture(FIXTURE);

    // Not the comment's `--t-ghost`, and only names under the prefix.
    expect([...sheet.rootTokens()].sort()).toEqual(["--t-fill", "--t-gap", "--t-stroke"]);
    expect([...sheet.declaredTokens()].sort()).toEqual(["--t-fill", "--t-gap", "--t-hook", "--t-march", "--t-stroke"]);
    expect([...readFixture("a { --u-x: 1px; --t-y: 2px; }").declaredTokens()]).toEqual(["--t-y"]);
  });

  it("collects every prefixed name read through var(), fallbacks and @media included", () => {
    expect([...readFixture(FIXTURE).referencedTokens()].sort()).toEqual([
      "--t-fill",
      "--t-gap",
      "--t-march",
      "--t-march-fast",
      "--t-stroke",
    ]);
    expect([...readFixture("a { color: var(--u-x, var( --t-y)); }").referencedTokens()]).toEqual(["--t-y"]);
  });

  it("lists each read of exactly one name, as the CSSOM serialises it, and not reads of a longer name", () => {
    expect(readFixture(FIXTURE).readsOf("--t-march")).toEqual(["var(--t-march, none)"]);
    expect(readFixture(FIXTURE).readsOf("--t-march-fast")).toEqual(["var(--t-march-fast)", "var(--t-march-fast)"]);
    // A fallback that itself reads a var is part of the read.
    expect(readFixture("a { color: var(--t-a, var(--t-b)); }").readsOf("--t-a")).toEqual(["var(--t-a, var(--t-b))"]);
  });

  it("keeps the whitespace inside a read, for a custom property and a standard one alike", () => {
    const sheet = readFixture("a { color: var( --t-x ); --t-y: var( --t-x , red ); }");

    expect(sheet.readsOf("--t-x")).toEqual(["var( --t-x )", "var( --t-x , red )"]);
  });

  it("finds color literals in declaration values outside the token blocks", () => {
    // The token blocks' `#fff` and `rgb(` are where literals belong; the
    // fallback in the `.siren-edge, :root` list is not one.
    expect(readFixture(FIXTURE).literalsOutsideTokenBlocks()).toEqual(["#000"]);
    // Values only: an id selector that looks like hex is no literal.
    expect(readFixture("#cafe { fill: hsla(0, 0%, 0%, 0.5); stroke: rgba(0, 0, 0, 0); }").literalsOutsideTokenBlocks()).toEqual([
      "hsla(",
      "rgba(",
    ]);
  });

  it("finds uppercase and 8-digit hex literals as written", () => {
    expect(readFixture("a { fill: #ABCDEF; stroke: #11223344; color: #FfF; }").literalsOutsideTokenBlocks()).toEqual([
      "#ABCDEF",
      "#11223344",
      "#FfF",
    ]);
  });
});

describe("readStylesheet on the real default.css", () => {
  // The spike's measurements, taken with a bare `<style>` + `sheet.cssRules`
  // walk before this module existed (and the root count agreeing with the
  // regex reader `readme-tokens.test.ts` used): the evidence this reader sees
  // the sheet the old readers did.
  const theme = readStylesheet(readBeside(TEST_FILE_URL, "../default.css"), {
    tokenPrefix: "--siren-",
    rootSelector: ":root",
  });

  it("sees the 30 tokens of its one :root block", () => {
    expect(theme.tokenBlocks().map((rule) => rule.selector)).toEqual([":root"]);
    expect(theme.rootTokens().size).toBe(30);
    expect(theme.rule(":root")?.declarations.find((d) => d.property === "--siren-node-fill")?.value).toBe("#f3efff");
  });

  it("sees its 124 style rules, one of them inside @media", () => {
    expect(theme.rules).toHaveLength(124);
    expect(theme.rules.filter((rule) => rule.nested)).toHaveLength(1);
  });

  it("finds no color literal outside its token block", () => {
    expect(theme.literalsOutsideTokenBlocks()).toEqual([]);
  });
});
