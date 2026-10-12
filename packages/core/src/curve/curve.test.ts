import { describe, expect, it } from "vitest";
import { CURVES, MERMAID_ONLY_CURVES } from "./curve";

describe("the curve name lists", () => {
  it("never name one curve as both drawn by Siren and Mermaid-only", () => {
    const drawn = new Set<string>(CURVES);
    expect(MERMAID_ONLY_CURVES.filter((name) => drawn.has(name))).toEqual([]);
  });
});
