import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvasTextMeasurer } from "./textMeasurer";

/**
 * jsdom has no canvas: each `getContext("2d")` hands back a context that
 * records the font it is given and measures every glyph 10px wide.
 */
let fonts: string[] = [];

beforeEach(() => {
  fonts = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => {
    const context = {
      set font(value: string) {
        fonts.push(value);
      },
      measureText: (text: string) => ({ width: Array.from(text).length * 10 }),
    };
    return context as unknown as CanvasRenderingContext2D;
  }) as unknown as HTMLCanvasElement["getContext"]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createCanvasTextMeasurer", () => {
  // Characterization: 0.8.0's measurer, which the default must stay.
  it("with no font measures in 14px system-ui, a line 32px tall and 24px wider than the text", () => {
    const measurer = createCanvasTextMeasurer();

    expect(fonts).toEqual(["14px system-ui, sans-serif"]);
    expect(measurer.measure("")).toEqual({ width: 24, height: 32 });
    expect(measurer.measure("abc")).toEqual({ width: 54, height: 32 });
  });

  it("measures in the font it is given, a line fontSize × 1.5 + 11 tall", () => {
    const measurer = createCanvasTextMeasurer({ fontFamily: "monospace", fontSize: 24 });

    expect(fonts).toEqual(["24px monospace"]);
    expect(measurer.measure("")).toEqual({ width: 24, height: 24 * 1.5 + 11 });
    expect(measurer.measure("abc")).toEqual({ width: 54, height: 47 });
  });
});
