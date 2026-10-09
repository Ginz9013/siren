import { describe, expect, it } from "vitest";
import { createBoard } from "./createBoard";

const FAKE_MEASURER = { measure: () => ({ width: 80, height: 32 }) };

/*
 * The palette checks here have a twin in siren-core's
 * src/theme/default.test.ts, which asks the same questions of the diagram's
 * palette: one palette, one `:root` block, no light/dark switch (ADR-0014).
 * The two packages share no test utilities, so a change to how one reads a
 * token block belongs in the other too.
 */

/** Creates a board, which injects board's chrome stylesheet, and returns that stylesheet's text. */
function injectedChromeCss(): string {
  createBoard(document.createElement("div"), { source: "flowchart TD\nA --> B\n", measureText: FAKE_MEASURER });
  return document.getElementById("siren-board-styles")?.textContent ?? "";
}

/**
 * The six chrome tokens as the root itself resolves them. The root, and not
 * some element inside the board, because jsdom resolves a custom property
 * only on the element that declares it and does not inherit one to a child —
 * and since ADR-0014 the one token block selects `:root` and nothing else.
 */
function chromeTokensOnRoot(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    Object.keys(CHROME).map((token) => [token, style.getPropertyValue(token).trim().toLowerCase()]),
  );
}

/** siren-website's neutrals and accent, from its decision 01M3BY1GPP. */
const CHROME = {
  "--siren-board-surface": "#ffffff",
  "--siren-board-surface-hover": "#f8f6fc",
  "--siren-board-text": "#1d1730",
  "--siren-board-border": "#e7e2f1",
  "--siren-board-accent": "#6d3fd6",
  "--siren-board-danger": "#c0264b",
};

describe("board chrome's color tokens", () => {
  it("resolves the chrome palette on the root", () => {
    injectedChromeCss();
    expect(chromeTokensOnRoot()).toEqual(CHROME);
  });

  it("declares one chrome palette in one :root block, with no light/dark switch", () => {
    // ADR-0014: board's chrome follows core's shape. One set of values, one
    // entry point, and no selector that picks a palette on the page's behalf —
    // a consumer who wants dark chrome redeclares these six themselves, under
    // a selector of their own. Asserted on the whole stylesheet, comments
    // included: the words naming a switch that no longer exists belong nowhere
    // in it.
    const css = injectedChromeCss();
    expect(css).not.toMatch(/data-theme/);
    expect(css).not.toMatch(/prefers-color-scheme/);

    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const tokenBlocks = rules.filter(([, , body]) => /--siren-board-[\w-]+\s*:/.test(body));
    expect(tokenBlocks.map(([, selector]) => selector.trim())).toEqual([":root"]);
    for (const token of Object.keys(CHROME)) {
      expect(tokenBlocks[0][2]).toContain(`${token}:`);
    }
  });

  it("colors the control bar and error banner only through its tokens", () => {
    const css = injectedChromeCss().replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([whole, selector, body]) => ({
      whole,
      selector: selector.trim(),
      body,
    }));
    // ADR-0014 left `:root` as the only selector a token block can have.
    const isTokenSelector = (part: string) => part === ":root";
    const tokenBlocks = rules.filter((rule) =>
      rule.selector.split(",").every((part) => isTokenSelector(part.trim())),
    );
    const outside = tokenBlocks.reduce((rest, block) => rest.replace(block.whole, ""), css);

    // Not vacuous: the chrome rules themselves are in what is left.
    expect(outside).toContain(".siren-board-controls__button:hover");
    expect(outside).toContain(".siren-board-error");
    // A literal in a chrome rule is a color no page theme can reach.
    expect(outside.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g) ?? []).toEqual([]);

    const declared = new Set(
      tokenBlocks.flatMap((block) => block.body.match(/--siren-board-[\w-]+(?=\s*:)/g) ?? []),
    );
    const referenced = [...new Set(outside.match(/--siren-board-[\w-]+/g) ?? [])];
    expect(referenced.filter((token) => !declared.has(token))).toEqual([]);
    // Every declared token is used by some chrome rule.
    expect([...declared].filter((token) => !referenced.includes(token))).toEqual([]);
  });
});

describe("board chrome's control bar states", () => {
  /** The declarations of the one rule whose selector is exactly `selector`, comments stripped. */
  function ruleBody(css: string, selector: string): string | undefined {
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    return rules.find(([, sel]) => sel.trim() === selector)?.[2];
  }

  it("styles a disabled button as unavailable, and a pressed button in the accent color", () => {
    // The Full diagram button is pressed while the full diagram shows, and
    // Prev/Next/Reset are disabled then: both states must read at a glance.
    const css = injectedChromeCss();

    const disabled = ruleBody(css, ".siren-board-controls__button:disabled");
    expect(disabled).toBeDefined();
    expect(disabled).toMatch(/cursor:\s*not-allowed/);

    const pressed = ruleBody(css, '.siren-board-controls__button[aria-pressed="true"]');
    expect(pressed).toBeDefined();
    expect(pressed).toContain("var(--siren-board-accent)");
  });
});
