import { afterEach, describe, expect, it, vi } from "vitest";
import { mintIdScope } from "./mintIdScope";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mintIdScope", () => {
  it("mints a `__` prefix followed by exactly eight base-36 characters", () => {
    // Both halves of the shape are load-bearing rather than cosmetic. The
    // `__` is what makes `siren-arrow__k3f9a1x2` unambiguously a base name
    // plus a scope — no `siren-*` class name contains an underscore — and the
    // fixed width is what lets a test normalize "the same drawing" by
    // collapsing `__` plus eight characters and nothing else.
    for (let attempt = 0; attempt < 500; attempt += 1) {
      expect(mintIdScope()).toMatch(/^__[0-9a-z]{8}$/);
    }
  });

  it("mints a fresh token per call, with no state shared between calls", () => {
    // The whole point of a random token over a counter: nothing is
    // remembered between calls, so nothing can be out of step with another
    // copy of this module on the same page.
    const minted = Array.from({ length: 1000 }, () => mintIdScope());
    expect(new Set(minted).size).toBe(minted.length);
  });

  it("keeps the token eight characters wide even when the random draw's base-36 expansion is short", () => {
    // `Math.random()` is free to return a value whose base-36 expansion has
    // fewer than eight fractional digits — 0.5 is "0.i", one digit, and 0 has
    // none at all. Without padding, those renders would mint a *shorter*
    // scope, which would slip past a normalizer looking for exactly eight
    // characters and quietly widen the collision space.
    for (const draw of [0.5, 0]) {
      vi.spyOn(Math, "random").mockReturnValue(draw);
      expect([draw, mintIdScope()]).toEqual([draw, expect.stringMatching(/^__[0-9a-z]{8}$/)]);
    }
  });
});
