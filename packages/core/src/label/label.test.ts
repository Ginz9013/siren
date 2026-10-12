import { describe, expect, it } from "vitest";
import {
  BASE_FONT_SIZE_PX,
  CONNECTOR_LABEL_FONT_SIZE_PX,
  MERMAID_ER_LABEL_FONT_SIZE_PX,
  wrapWidthAt,
} from "./label";

/**
 * `theme/default.css`'s own text, read off disk for the reasons
 * `theme/default.test.ts` gives: Vite's `?raw` import of a `.css` file is
 * emptied under this package's test config, and the package carries no
 * `@types/node`, so the builtin is reached through `process.getBuiltinModule`.
 */
const defaultThemeCss = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: "node:fs"): { readFileSync(path: string, encoding: "utf8"): string };
    };
  }
).process
  .getBuiltinModule("node:fs")
  .readFileSync(`${(import.meta as unknown as { dirname: string }).dirname}/../theme/default.css`, "utf8");

describe("the size a connector label is measured at", () => {
  // The layout measures a connector's label at a size it cannot read off the
  // stylesheet; that size is this token's default, and the two may not drift
  // apart — a changed token would otherwise leave every label laid out for a
  // size it is no longer drawn at.
  it("is the default theme's --siren-label-font-size", () => {
    const declared = /--siren-label-font-size:\s*(\d*\.?\d+)px;/.exec(defaultThemeCss);

    expect(declared?.[1]).toBeDefined();
    expect(Number(declared![1])).toBe(CONNECTOR_LABEL_FONT_SIZE_PX);
  });
});

describe("the width a label wraps at", () => {
  // The spec (decision 1): Mermaid wraps at 200px of 16px text, so a label
  // drawn at another size wraps at 200 × size / 16 — a node's 14px at 175,
  // a connector label's 12px at 150.
  it("is Mermaid's 200px scaled to the size the label is drawn at", () => {
    expect(wrapWidthAt(16)).toBe(200);
    expect(wrapWidthAt(BASE_FONT_SIZE_PX)).toBe(175);
    expect(wrapWidthAt(CONNECTOR_LABEL_FONT_SIZE_PX)).toBe(150);
  });

  // The label-wrap ADR as amended (`01M4R7HBG`, and the user's choice for
  // T4): the width is 200 × the size Siren draws the label at / the size
  // Mermaid draws it at. Mermaid draws an ER relationship's label at 14px
  // (measured, mermaid 11.17.2), so Siren's 12px one wraps at 200 × 12/14.
  it("scales against the size Mermaid draws the label at, when that is not 16px", () => {
    expect(MERMAID_ER_LABEL_FONT_SIZE_PX).toBe(14);
    expect(wrapWidthAt(CONNECTOR_LABEL_FONT_SIZE_PX, MERMAID_ER_LABEL_FONT_SIZE_PX)).toBeCloseTo(171.43, 2);
    expect(wrapWidthAt(14, 14)).toBe(200);
  });
});
