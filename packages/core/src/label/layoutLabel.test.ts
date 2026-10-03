import { describe, expect, it } from "vitest";
import type { TextMeasurer } from "../contracts";
import { layoutLabel } from "./layoutLabel";
import { readLabel } from "./readLabel";

/**
 * 8px a character, 24px a line, and 10px of the measurer's own padding on
 * every answer — the shape both real measurers in this repo have
 * (`index.ts`'s default and `siren-board`'s canvas one each add a fixed
 * horizontal padding), so a layout that counted the padding once per run
 * instead of once per row is visible here.
 */
const paddedMeasurer: TextMeasurer = {
  measure(text: string) {
    return { width: text.length * 8 + 10, height: 24 };
  },
};

describe("layoutLabel", () => {
  it("sizes a one-row plain label exactly as the measurer sizes its text", () => {
    const { label } = readLabel("Start", { dialect: "html" });

    const box = layoutLabel(label, paddedMeasurer);

    expect(box).toEqual({
      width: 50,
      height: 24,
      rows: [{ y: 12, height: 24, width: 50, runs: [{ x: 5, width: 40 }] }],
    });
  });

  it("stacks rows one line-height apart, as wide as the widest row", () => {
    const { label } = readLabel("a<br>bb", { dialect: "html" });

    const box = layoutLabel(label, paddedMeasurer);

    expect(box.width).toBe(26);
    expect(box.height).toBe(48);
    expect(box.rows.map((row) => [row.y, row.height, row.width])).toEqual([
      [12, 24, 18],
      [36, 24, 26],
    ]);
  });

  it("places a row's runs side by side, counting the measurer's padding once per row", () => {
    const { label } = readLabel("plain **bold**", { dialect: "html", markdown: true });

    const box = layoutLabel(label, paddedMeasurer);

    expect(box.rows[0]!.width).toBe(10 + 48 + 32);
    expect(box.rows[0]!.runs).toEqual([
      { x: 5, width: 48 },
      { x: 53, width: 32 },
    ]);
  });
});
