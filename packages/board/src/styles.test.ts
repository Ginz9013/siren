import { describe, expect, it } from "vitest";
import { createBoard } from "./createBoard";

const FAKE_MEASURER = { measure: () => ({ width: 80, height: 32 }) };

/*
 * The palette checks here have a twin in @siren/core's
 * src/theme/default.test.ts, which asks the same questions of the diagram's
 * palette. The two packages share no test utilities, so a change to how one
 * reads a token block belongs in the other too.
 */

/** Creates a board, which injects board's chrome stylesheet, and returns that stylesheet's text. */
function injectedChromeCss(): string {
  createBoard(document.createElement("div"), { source: "flowchart TD\nA --> B\n", measureText: FAKE_MEASURER });
  return document.getElementById("siren-board-styles")?.textContent ?? "";
}

/**
 * The six chrome tokens as `element` itself resolves them. jsdom resolves a
 * custom property only on the element that declares it — it neither inherits
 * one to a child nor evaluates `@media` — so `element` has to be the one a
 * token block selects: the root, or an element carrying `data-theme`.
 */
function chromeTokensOn(element: Element): Record<string, string> {
  const style = getComputedStyle(element);
  return Object.fromEntries(
    Object.keys(LIGHT_CHROME).map((token) => [token, style.getPropertyValue(token).trim().toLowerCase()]),
  );
}

/** siren-website's neutrals and accent, from its decision 01M3BY1GPP. */
const LIGHT_CHROME = {
  "--siren-board-surface": "#ffffff",
  "--siren-board-surface-hover": "#f8f6fc",
  "--siren-board-text": "#1d1730",
  "--siren-board-border": "#e7e2f1",
  "--siren-board-accent": "#6d3fd6",
  "--siren-board-danger": "#c0264b",
};

/** The same decision's dark column. */
const DARK_CHROME = {
  "--siren-board-surface": "#14111d",
  "--siren-board-surface-hover": "#1d1929",
  "--siren-board-text": "#ece8f8",
  "--siren-board-border": "#302a44",
  "--siren-board-accent": "#b69cff",
  "--siren-board-danger": "#ff8fa3",
};

describe("board chrome's color tokens", () => {
  it("resolves the light chrome palette on the root", () => {
    injectedChromeCss();
    expect(chromeTokensOn(document.documentElement)).toEqual(LIGHT_CHROME);
  });

  it("resolves the dark chrome palette on a root pinned dark, and keeps a subtree pinned light inside it light", () => {
    injectedChromeCss();
    document.documentElement.dataset.theme = "dark";
    const pinned = document.createElement("div");
    pinned.dataset.theme = "light";
    document.body.appendChild(pinned);
    try {
      expect(chromeTokensOn(document.documentElement)).toEqual(DARK_CHROME);
      expect(chromeTokensOn(pinned)).toEqual(LIGHT_CHROME);
    } finally {
      pinned.remove();
      delete document.documentElement.dataset.theme;
    }
  });

  it("follows a dark system preference with the same dark palette, unless the page pins itself light", () => {
    // jsdom evaluates no `@media`, so this reads the stylesheet: exactly one
    // rule inside `prefers-color-scheme: dark`, selecting the root when it is
    // not pinned light, declaring what the data-theme="dark" rule declares.
    const css = injectedChromeCss();
    const declarations = (body: string) =>
      body
        .split(";")
        .map((declaration) => declaration.trim().replace(/\s+/g, " "))
        .filter((declaration) => declaration !== "")
        .sort();
    const media = /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{([\s\S]*?\})\s*\}/.exec(css);
    expect(media).not.toBeNull();
    const inner = [...media![1].matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    expect(inner.map(([, selector]) => selector.trim())).toEqual([':root:not([data-theme="light"])']);

    const pinnedDark = /:root\[data-theme="dark"\]\s*\{([^{}]*)\}/.exec(css);
    expect(pinnedDark).not.toBeNull();
    expect(declarations(inner[0][2])).toEqual(declarations(pinnedDark![1]));
    expect(declarations(pinnedDark![1])).toHaveLength(Object.keys(DARK_CHROME).length);
  });

  it("colors the control bar and error banner only through its tokens", () => {
    const css = injectedChromeCss().replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([whole, selector, body]) => ({
      whole,
      selector: selector.trim(),
      body,
    }));
    const isTokenSelector = (part: string) =>
      part !== "" &&
      /^(?::root)?(?:\[data-theme="(?:light|dark)"\]|:not\(\[data-theme="light"\]\))?$/.test(part);
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
