import { describe, expect, it } from "vitest";
import { readStylesheet, type Stylesheet } from "../../core/src/theme/testing/stylesheet";
import { createBoard } from "./createBoard";

const FAKE_MEASURER = { measure: () => ({ width: 80, height: 32 }) };

/*
 * The palette checks here have a twin in siren-core's
 * src/theme/default.test.ts, which asks the same questions of the diagram's
 * palette: one palette, one `:root` block, no light/dark switch (ADR-0014).
 * Both read their stylesheet through siren-core's
 * src/theme/testing/stylesheet.ts, so how a token block is read lives in that
 * one place; only the token prefix and the root selector differ.
 */

/** Creates a board, which injects board's chrome stylesheet, and returns that stylesheet's text. */
function injectedChromeCss(): string {
  createBoard(document.createElement("div"), { source: "flowchart TD\nA --> B\n", measureText: FAKE_MEASURER });
  return document.getElementById("siren-board-styles")?.textContent ?? "";
}

/** board's chrome stylesheet, injected by a board and parsed once through the CSSOM. */
function chromeStylesheet(): Stylesheet {
  return readStylesheet(injectedChromeCss(), { tokenPrefix: "--siren-board-", rootSelector: ":where(:root)" });
}

/**
 * The six chrome tokens as the root itself resolves them. The root, and not
 * some element inside the board, because jsdom resolves a custom property
 * only on the element that declares it and does not inherit one to a child —
 * and since ADR-0014 the one token block selects the root and nothing else.
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
    // in it. So these two read the raw text; the parsed rules keep no comments.
    const sheet = chromeStylesheet();
    expect(sheet.text).not.toMatch(/data-theme/);
    expect(sheet.text).not.toMatch(/prefers-color-scheme/);

    expect(sheet.tokenBlocks().map((block) => block.selector)).toEqual([":where(:root)"]);
    // Every token is declared in that block and nowhere else.
    expect(sheet.declaredTokens()).toEqual(sheet.rootTokens());
    for (const token of Object.keys(CHROME)) {
      expect(sheet.rootTokens()).toContain(token);
    }
  });

  it("declares its tokens with zero specificity, so a consumer's :root block wins in any order", () => {
    // A board injects this stylesheet at the end of <head> on first use, after
    // a consumer's linked CSS. When both token blocks were `:root` (0,1,0),
    // the later one — board's — won, and the README's own theming example
    // did nothing (01M3VYFBX). jsdom's cascade looks at order and not at
    // specificity, so this reads the selector; the cascade is a browser's.
    // And not `@layer`: jsdom fails to parse it and drops the whole sheet —
    // so that one reads the raw text, since a dropped at-rule leaves no trace
    // in the parsed rules.
    const sheet = chromeStylesheet();
    expect(sheet.rulesDeclaring("--siren-board-accent")[0]).toBe(":where(:root)");
    expect(sheet.text).not.toMatch(/@layer/);
  });

  it("colors the control bar and error banner only through its tokens", () => {
    // ADR-0014 left the root as the only element a token block selects (as
    // `:where(:root)` since 01M3VYFBX); the module's rootSelector says so.
    const sheet = chromeStylesheet();

    // Not vacuous: the chrome rules themselves are among the rules checked.
    expect(sheet.rules.map((rule) => rule.selector)).toContain(".siren-board-controls__button:hover");
    expect(sheet.selectsClass("siren-board-controls__trigger")).toBe(true);
    expect(sheet.selectsClass("siren-board-controls__listbox")).toBe(true);
    expect(sheet.selectsClass("siren-board-controls__option")).toBe(true);
    expect(sheet.selectsClass("siren-board-error")).toBe(true);
    // A literal in a chrome rule is a color no page theme can reach.
    expect(sheet.literalsOutsideTokenBlocks()).toEqual([]);

    // Tokens are declared only in the token block, so declared and root agree.
    const declared = sheet.declaredTokens();
    expect(declared).toEqual(sheet.rootTokens());
    const referenced = [...sheet.referencedTokens()];
    expect(referenced.filter((token) => !declared.has(token))).toEqual([]);
    // Every declared token is used by some chrome rule.
    expect([...declared].filter((token) => !referenced.includes(token))).toEqual([]);
  });
});

describe("board chrome's control bar states", () => {
  /**
   * The declarations of the one rule whose selector is exactly `selector`, as
   * the CSSOM's `prop: value; prop: value !important;` text.
   */
  function ruleBody(sheet: Stylesheet, selector: string): string | undefined {
    return sheet.rule(selector)?.cssText;
  }

  it("styles a disabled button as unavailable, and a pressed button in the accent color", () => {
    // The Full diagram button is pressed while the full diagram shows, and
    // Prev/Next/Reset are disabled then: both states must read at a glance.
    const sheet = chromeStylesheet();

    const disabled = ruleBody(sheet, ".siren-board-controls__button:disabled");
    expect(disabled).toBeDefined();
    expect(disabled).toMatch(/cursor:\s*not-allowed/);

    const pressed = ruleBody(sheet, '.siren-board-controls__button[aria-pressed="true"]');
    expect(pressed).toBeDefined();
    expect(pressed).toContain("var(--siren-board-accent)");
  });

  it("styles the interval trigger like the bar's buttons, unavailable when disabled", () => {
    // Play and the interval dropdown are disabled together, with nothing to
    // play: the trigger must fade and refuse the pointer just as Play does.
    const sheet = chromeStylesheet();

    const trigger = ruleBody(sheet, ".siren-board-controls__trigger");
    expect(trigger).toBeDefined();
    expect(trigger).toContain("var(--siren-board-border)");
    expect(trigger).toContain("var(--siren-board-surface)");
    expect(trigger).toContain("var(--siren-board-text)");

    const disabled = ruleBody(sheet, ".siren-board-controls__trigger:disabled");
    expect(disabled).toBeDefined();
    expect(disabled).toMatch(/cursor:\s*not-allowed/);
  });

  it("opens every dropdown's listbox directly above its trigger, whatever the room, and never scrolls it", () => {
    // A native select's list is placed by the OS and drifts up or down; this
    // one is pinned above the trigger and shows every option at once. The
    // anchor is the root class every dropdown carries, not one dropdown's own
    // className, so the timeline listbox opens where the interval one does.
    const sheet = chromeStylesheet();

    const root = ruleBody(sheet, ".siren-board-controls__dropdown");
    expect(root).toMatch(/position:\s*relative/);
    expect(ruleBody(sheet, ".siren-board-controls__interval")).toBeUndefined();

    const listbox = ruleBody(sheet, ".siren-board-controls__listbox");
    expect(listbox).toBeDefined();
    expect(listbox).toMatch(/position:\s*absolute/);
    expect(listbox).toMatch(/bottom:\s*calc\(100% \+ [^)]+\)/);
    expect(listbox).not.toMatch(/(?:^|[\s;])top:/);
    expect(listbox).not.toMatch(/overflow(?:-y)?:\s*(?:auto|scroll)/);
    expect(listbox).not.toMatch(/max-height/);
    expect(listbox).toContain("var(--siren-board-surface)");
    expect(listbox).toContain("var(--siren-board-border)");

    // The selected option reads in the accent color, as a pressed button does.
    const selected = ruleBody(sheet, '.siren-board-controls__option[aria-selected="true"]');
    expect(selected).toContain("var(--siren-board-accent)");
  });

  it("sets the step counter in tabular figures, colored through the chrome tokens", () => {
    // The counter changes on every step: tabular figures keep "9 / 10" and
    // "10 / 10" the same width, so the buttons beside it never shift.
    const sheet = chromeStylesheet();

    const step = ruleBody(sheet, ".siren-board-controls__step");
    expect(step).toBeDefined();
    expect(step).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(step).toContain("var(--siren-board-text)");
  });

  it("gives the board its own surface on the screen and in the window fill, and lifts the fill over the page", () => {
    // Without a background a fullscreen element shows the browser's black
    // backdrop through the diagram's gaps. Read as text: a computed style
    // cannot put jsdom into the :fullscreen state.
    const sheet = chromeStylesheet();

    const screen = ruleBody(sheet, ".siren-board:fullscreen");
    expect(screen).toBeDefined();
    expect(screen).toMatch(/background:\s*var\(--siren-board-surface\)/);

    const fill = ruleBody(sheet, ".siren-board--fill");
    expect(fill).toBeDefined();
    expect(fill).toMatch(/background:\s*var\(--siren-board-surface\)/);
    expect(fill).toMatch(/position:\s*fixed/);
    expect(fill).toMatch(/inset:\s*0/);
    expect(fill).toMatch(/z-index:\s*2147483647/);
  });

  it("makes the window fill beat a consumer's inline size, id rule or max-size and margin", () => {
    // The README's own embed sets `style="width: 100%; height: 480px"`; inline
    // styles and id rules outrank a class, so only !important keeps the fill whole.
    const fill = ruleBody(chromeStylesheet(), ".siren-board--fill")!;

    for (const declaration of [
      /position:\s*fixed\s*!important/,
      /inset:\s*0\s*!important/,
      /width:\s*auto\s*!important/,
      /height:\s*auto\s*!important/,
      /max-width:\s*none\s*!important/,
      /max-height:\s*none\s*!important/,
      /margin:\s*0\s*!important/,
    ]) {
      expect(fill).toMatch(declaration);
    }
  });
});
