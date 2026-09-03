import type { TextMeasurer } from "@siren/core";

const PADDING_X = 24;
const LINE_HEIGHT = 32;
const FONT = "14px system-ui, sans-serif";

/**
 * Real, DOM-based text measurer for the browser — `@siren/core`'s own
 * default measurer deliberately avoids `canvas` to stay usable under jsdom
 * (see `packages/core/src/index.ts`). This is board's default instead,
 * equivalent to the one both demo pages used to hand-roll. Not exercised by
 * this package's automated (jsdom) test suite — jsdom has no real canvas
 * text metrics without the `canvas` npm package — verified instead via the
 * demo pages' visual checks (see `.scratch/siren-board-slice/spec.md`).
 */
export function createCanvasTextMeasurer(): TextMeasurer {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = FONT;

  return {
    measure(text: string) {
      const { width } = ctx.measureText(text);
      return { width: width + PADDING_X, height: LINE_HEIGHT };
    },
  };
}
