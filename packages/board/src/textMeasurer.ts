import { DEFAULT_TYPOGRAPHY } from "siren-core";
import type { TextMeasurer } from "siren-core";
import { DEFAULT_FONT_FAMILY } from "./typography";

const PADDING_X = 24;
/** Room above and below a line: 0.8.0's 32px line at 14px, less 14 × 1.5. */
const PADDING_Y = 11;
/** A line's height as a multiple of the font size — core's line spacing. */
const LINE_HEIGHT_RATIO = 1.5;

/**
 * Real, DOM-based text measurer for the browser — `siren-core`'s own
 * default measurer deliberately avoids `canvas` to stay usable under jsdom
 * (see `packages/core/src/index.ts`). This is board's default instead,
 * equivalent to the one both demo pages used to hand-roll.
 *
 * It measures in `font` — core lays out assuming its `measureText` measures
 * at `typography.fontSize` — answering the text's width plus 24px and a line
 * `fontSize × 1.5 + 11` tall. Left out, `font` is the default theme's 14px
 * system-ui, which answers exactly as 0.8.0's measurer did (a 32px line).
 * Real glyph widths are not exercised by this package's jsdom suite — jsdom
 * has no canvas text metrics — but by the demo pages' visual checks.
 */
export function createCanvasTextMeasurer(
  font: { fontFamily: string; fontSize: number } = {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: DEFAULT_TYPOGRAPHY.fontSize,
  },
): TextMeasurer {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${font.fontSize}px ${font.fontFamily}`;
  const height = font.fontSize * LINE_HEIGHT_RATIO + PADDING_Y;

  return {
    measure(text: string) {
      const { width } = ctx.measureText(text);
      return { width: width + PADDING_X, height };
    },
  };
}
