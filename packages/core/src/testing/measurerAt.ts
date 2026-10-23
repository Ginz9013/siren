/**
 * Test support for `LayoutOptions.typography`: a measurer that answers as a
 * font of `fontSize` px would — glyphs 0.6 × the size wide, a line 1.5 × the
 * size tall, and a constant padding of 16px across and 11px down — the
 * contract `typography.fontSize` puts on a caller's `measureText` (spec
 * `01M5KT49PV`). Test support only — never imported by `src/index.ts`, and
 * kept out of the published declarations by `tsconfig.build.json`'s exclude.
 */
import type { TextMeasurer } from "../contracts";

export function measurerAt(fontSize: number): TextMeasurer {
  return {
    measure: (text) => ({ width: Array.from(text).length * fontSize * 0.6 + 16, height: fontSize * 1.5 + 11 }),
  };
}
