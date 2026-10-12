import { describe, expect, it } from "vitest";
import { CONNECTOR_LABEL_FONT_SIZE_PX } from "./label";

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
