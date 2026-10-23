import { afterEach, describe, expect, it, vi } from "vitest";
import { readTypography } from "./typography";
import * as sirenBoard from "./index";
import type { BoardTypography } from "./index";

/**
 * jsdom's `getComputedStyle` resolves no custom properties, so these tests
 * answer the four `--siren-*` tokens themselves and let every other property
 * read as jsdom would.
 */
function stubTokens(tokens: Record<string, string>): void {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = real(element, pseudo);
    const read = style.getPropertyValue.bind(style);
    style.getPropertyValue = (property: string) => tokens[property] ?? read(property);
    return style;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readTypography", () => {
  it("reads the four theme tokens off the element's computed style, sizes as px numbers", () => {
    stubTokens({
      "--siren-font-family": "Georgia, serif",
      "--siren-font-size": "24px",
      "--siren-label-font-size": "20px",
      "--siren-title-font-size": "30px",
    });

    expect(readTypography(document.createElement("div"))).toEqual({
      fontFamily: "Georgia, serif",
      fontSize: 24,
      labelFontSize: 20,
      titleFontSize: 30,
    });
  });

  it("falls back to the default theme's values when no token is set", () => {
    // jsdom as it is: no custom property resolves.
    expect(readTypography(document.createElement("div"))).toEqual({
      fontFamily: "system-ui, sans-serif",
      fontSize: 14,
      labelFontSize: 12,
      titleFontSize: 18,
    });
  });

  for (const value of ["", "1.5rem", "abc", "0px", "-4px", "12", "calc(10px + 2px)"]) {
    it(`falls back to that field's default for ${JSON.stringify(value)}, leaving the others read`, () => {
      stubTokens({
        "--siren-font-family": "Georgia, serif",
        "--siren-font-size": value,
        "--siren-label-font-size": "20px",
        "--siren-title-font-size": value,
      });

      expect(readTypography(document.createElement("div"))).toEqual({
        fontFamily: "Georgia, serif",
        fontSize: 14,
        labelFontSize: 20,
        titleFontSize: 18,
      });
    });
  }

  it("falls back to the default family for an empty or blank family token", () => {
    stubTokens({ "--siren-font-family": "   " });

    expect(readTypography(document.createElement("div")).fontFamily).toBe("system-ui, sans-serif");
  });

  it("tolerates whitespace around a token, as custom properties keep it", () => {
    stubTokens({
      "--siren-font-family": "  monospace ",
      "--siren-font-size": " 24px",
      "--siren-label-font-size": "16.5px  ",
      "--siren-title-font-size": "\t22px\n",
    });

    expect(readTypography(document.createElement("div"))).toEqual({
      fontFamily: "monospace",
      fontSize: 24,
      labelFontSize: 16.5,
      titleFontSize: 22,
    });
  });
});

describe("siren-board's entry point", () => {
  it("exports readTypography, createCanvasTextMeasurer and the BoardTypography they share", () => {
    expect(typeof sirenBoard.readTypography).toBe("function");
    expect(typeof sirenBoard.createCanvasTextMeasurer).toBe("function");
    // BoardTypography is a type: this only compiles if index.ts exports it.
    const typography: BoardTypography = sirenBoard.readTypography(document.createElement("div"));
    expect(typography.fontFamily).toBe("system-ui, sans-serif");
  });
});
