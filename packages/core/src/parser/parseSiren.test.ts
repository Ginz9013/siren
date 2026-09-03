import { describe, expect, it } from "vitest";
import { parseSiren } from "./parseSiren";

describe("parseSiren", () => {
  it("parses a minimal flowchart with inline edge node declarations and a timeline block", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[Process]
  B --> C[End]

timeline:
  step 1: enter B fade
  step 2: enter C fade
`;

    const { document, diagnostics } = parseSiren(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document!.direction).toBe("TD");
    expect(document!.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C"]);
    expect(document!.edges).toHaveLength(2);
    expect(document!.edges.map((e) => ({ from: e.from, to: e.to }))).toEqual([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ]);
    expect(document!.timeline).not.toBeNull();
    expect(document!.timeline!.entries.map((e) => e.step)).toEqual([1, 2]);
  });

  it("accepts flowchart LR and sets direction to LR", () => {
    const source = `flowchart LR
  A[Start]
  A --> B[End]
`;

    const { document, diagnostics } = parseSiren(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document!.direction).toBe("LR");
  });

  it("reports an error diagnostic and returns a null document for a malformed edge line, without throwing", () => {
    const source = `flowchart TD
  A[Start]
  A -->
`;

    expect(() => parseSiren(source)).not.toThrow();

    const { document, diagnostics } = parseSiren(source);

    expect(document).toBeNull();
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("keeps the first label and emits a warning when a node id is redeclared with different bracket text", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[End]
  A[Begin]
`;

    const { document, diagnostics } = parseSiren(source);

    expect(document).not.toBeNull();
    const nodeA = document!.nodes.find((n) => n.id === "A");
    expect(nodeA?.label).toBe("Start");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
  });

  it("parses all four timeline verbs with the correct kind/targetId/step, and effect only where expected", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[Process]

timeline:
  step 1: enter B fade
  step 2: exit A slide-left
  step 3: highlight A-B outline
  step 4: unhighlight A-B
`;

    const { document, diagnostics } = parseSiren(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document!.timeline!.entries).toEqual([
      { kind: "enter", step: 1, targetId: "B", effect: "fade", line: 6, column: 3 },
      { kind: "exit", step: 2, targetId: "A", effect: "slide-left", line: 7, column: 3 },
      { kind: "highlight", step: 3, targetId: "A-B", effect: "outline", line: 8, column: 3 },
      { kind: "unhighlight", step: 4, targetId: "A-B", line: 9, column: 3 },
    ]);
  });

  it("parses all four slide directions for both enter and exit", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[Process]

timeline:
  step 1: enter B slide-left
  step 2: enter B slide-right
  step 3: enter B slide-top
  step 4: enter B slide-bottom
  step 5: exit B slide-left
  step 6: exit B slide-right
  step 7: exit B slide-top
  step 8: exit B slide-bottom
`;

    const { document, diagnostics } = parseSiren(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document!.timeline!.entries.map((e) => `${e.kind}:${e.effect}`)).toEqual([
      "enter:slide-left",
      "enter:slide-right",
      "enter:slide-top",
      "enter:slide-bottom",
      "exit:slide-left",
      "exit:slide-right",
      "exit:slide-top",
      "exit:slide-bottom",
    ]);
  });

  it("parses highlight with both outline and glow effects", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[Process]

timeline:
  step 1: highlight A-B outline
  step 2: highlight A-B glow
`;

    const { document, diagnostics } = parseSiren(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document!.timeline!.entries.map((e) => e.effect)).toEqual([
      "outline",
      "glow",
    ]);
  });

  it("reports an error diagnostic, not a throw, for an effect name not valid for the given verb", () => {
    const source1 = `flowchart TD
  A[Start]

timeline:
  step 1: enter A outline
`;
    expect(() => parseSiren(source1)).not.toThrow();
    const result1 = parseSiren(source1);
    expect(result1.document).toBeNull();
    expect(result1.diagnostics.some((d) => d.severity === "error")).toBe(true);

    const source2 = `flowchart TD
  A[Start]
  A --> B[Process]

timeline:
  step 1: highlight A-B slide-left
`;
    expect(() => parseSiren(source2)).not.toThrow();
    const result2 = parseSiren(source2);
    expect(result2.document).toBeNull();
    expect(result2.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("reports an error diagnostic, not a throw, for a trailing effect token on unhighlight", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[Process]

timeline:
  step 1: unhighlight A-B outline
`;
    expect(() => parseSiren(source)).not.toThrow();
    const { document, diagnostics } = parseSiren(source);
    expect(document).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});
