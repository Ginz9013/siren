/**
 * Test support for reading a theme's `--siren-*` tokens. Test support only —
 * never imported by `src/index.ts`, and kept out of the published
 * declarations by `tsconfig.build.json`'s exclude (as core's
 * `testing/` modules are).
 */
import { vi } from "vitest";

/**
 * jsdom's `getComputedStyle` resolves no custom properties, so a test answers
 * the `--siren-*` tokens itself (for every element, which includes the one
 * board reads them from) and lets every other property read as jsdom would.
 * `tokens` is read on each call, so a test may change it later. Restore with
 * `vi.restoreAllMocks()`.
 */
export function stubTokens(tokens: Record<string, string>): void {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = real(element, pseudo);
    const read = style.getPropertyValue.bind(style);
    style.getPropertyValue = (property: string) => tokens[property] ?? read(property);
    return style;
  });
}
