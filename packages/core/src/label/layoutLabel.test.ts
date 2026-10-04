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

  it("makes a row holding a <big> run taller, and the run wider, by its scale", () => {
    const { label } = readLabel("a<br>x<big>bb</big>", { dialect: "html" });

    const box = layoutLabel(label, paddedMeasurer);

    // Row 2: `x` at 8px, then `bb` at 16px × 1.2; as tall as one line × 1.2.
    const [first, second] = box.rows;
    expect(first!.height).toBe(24);
    expect(second!.height).toBeCloseTo(28.8);
    expect(second!.runs[1]!.x).toBe(13);
    expect(second!.runs[1]!.width).toBeCloseTo(19.2);
    expect(second!.width).toBeCloseTo(10 + 8 + 19.2);
    expect(second!.y).toBeCloseTo(24 + 14.4);
    expect(box.height).toBeCloseTo(52.8);
  });
  // The spec: an absolute px size is measured as a scale of the default
  // 14px base, so 28px is twice as wide and tall as the measurer's answer; a
  // size no number of px describes (`large`) is measured at the base size.
  it("measures an absolute px size against a 14px base, and any other absolute size at the base", () => {
    const { label } = readLabel("<span style='font-size:28px'>ab</span><span style='font-size:large'>c</span>", {
      dialect: "html",
    });

    const box = layoutLabel(label, paddedMeasurer);

    expect(box.height).toBe(48);
    expect(box.rows[0]!.runs).toEqual([
      { x: 5, width: 32 },
      { x: 37, width: 8 },
    ]);
  });
});

// ADR-0015's spacing properties are drawn, so they are measured: a box
// narrower than its text lets the text overrun its node, and a mark or
// background rect stop short of the glyphs it is behind. CSS adds
// `letter-spacing` after every character and `word-spacing` to every space.
describe("layoutLabel's spacing", () => {
  it("widens a run by its px letter-spacing once per character", () => {
    const { label } = readLabel("a <span style='letter-spacing: 2px'>bcd</span>", { dialect: "html" });

    const box = layoutLabel(label, paddedMeasurer);

    // `bcd` is 24px of text plus 3 × 2px.
    expect(box.rows[0]!.runs).toEqual([
      { x: 5, width: 16 },
      { x: 21, width: 30 },
    ]);
    expect(box.width).toBe(10 + 16 + 30);
  });

  it("widens a run by its px word-spacing once per space", () => {
    const { label } = readLabel("<span style='word-spacing: 3px'>a b c</span>", { dialect: "html" });

    const box = layoutLabel(label, paddedMeasurer);

    // Five characters, two of them spaces: 40px of text plus 2 × 3px.
    expect(box.rows[0]!.runs).toEqual([{ x: 5, width: 46 }]);
  });

  // An `em` is the run's own font size: the 14px base times the run's
  // measured scale, as an absolute px size is measured. A unit with no px
  // to read here (`rem`, `ch`, a keyword) is measured as no spacing.
  it("scales an em spacing by the run's measured size, and measures any other unit as none", () => {
    const { label } = readLabel(
      "<span style='letter-spacing: 0.5em'>ab</span>" +
        "<span style='font-size: 28px; word-spacing: 0.25em'>c d</span>" +
        "<span style='letter-spacing: 1rem'>e</span>",
      { dialect: "html" },
    );

    const box = layoutLabel(label, paddedMeasurer);

    // `ab`: 16px + 2 × 7px. `c d` at 28px: 24px × 2 + one space × 7px. `e`: 8px.
    expect(box.rows[0]!.runs).toEqual([
      { x: 5, width: 30 },
      { x: 35, width: 55 },
      { x: 90, width: 8 },
    ]);
  });
});
