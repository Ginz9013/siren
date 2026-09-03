import { describe, expect, it } from "vitest";
import type { SirenDocument } from "../contracts";
import { buildGraphModel } from "./buildGraphModel";

describe("buildGraphModel", () => {
  it("assigns edge ids of the form fromId-toId for distinct pairs", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
        { id: "C", label: "C" },
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ],
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(graph).not.toBeNull();
    expect(graph!.edges.map((e) => e.id)).toEqual(["A-B", "B-C"]);
  });

  it("suffixes the id of a second edge between the same pair with #2", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "A", to: "B" },
      ],
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(graph).not.toBeNull();
    expect(graph!.edges.map((e) => e.id)).toEqual(["A-B", "A-B#2"]);
  });

  it("resolves timeline entries against node/edge ids, grouping by step, and leaves elements never mentioned immediately visible", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
        { id: "C", label: "C" },
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ],
      timeline: {
        entries: [
          { kind: "enter", step: 1, targetId: "B", effect: "fade" },
          { kind: "enter", step: 2, targetId: "C", effect: "fade" },
          { kind: "enter", step: 2, targetId: "A-B", effect: "fade" },
        ],
      },
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(graph).not.toBeNull();

    const byStep = new Map<number, string[]>();
    for (const entry of graph!.timeline.entries) {
      const targets = byStep.get(entry.step) ?? [];
      targets.push(entry.targetId);
      byStep.set(entry.step, targets);
    }
    expect(byStep.get(1)).toEqual(["B"]);
    expect(byStep.get(2)).toEqual(["C", "A-B"]);

    const mentionedIds = new Set(graph!.timeline.entries.map((e) => e.targetId));
    expect(mentionedIds.has("A")).toBe(false);
    expect(mentionedIds.has("B")).toBe(true);
    expect(mentionedIds.has("C")).toBe(true);
    expect(mentionedIds.has("A-B")).toBe(true);
    expect(mentionedIds.has("B-C")).toBe(false);
  });

  it("drops a timeline entry referencing an unknown id, reports an error diagnostic, and still builds the graph", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
      ],
      edges: [{ from: "A", to: "B" }],
      timeline: {
        entries: [
          { kind: "enter", step: 1, targetId: "B", effect: "fade" },
          { kind: "enter", step: 1, targetId: "does-not-exist", effect: "fade" },
        ],
      },
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(graph).not.toBeNull();
    expect(graph!.timeline.entries.map((e) => e.targetId)).toEqual(["B"]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
  });

  it("keeps the first-seen label and warns when a node id is declared twice with conflicting labels", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [
        { id: "A", label: "Start" },
        { id: "A", label: "Begin" },
      ],
      edges: [],
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(graph).not.toBeNull();
    expect(graph!.nodes).toEqual([{ id: "A", label: "Start" }]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
  });

  it("sets totalSteps to 0 and leaves every element immediately visible when there is no timeline block", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
      ],
      edges: [{ from: "A", to: "B" }],
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(graph).not.toBeNull();
    expect(graph!.timeline.totalSteps).toBe(0);
    expect(graph!.timeline.entries).toEqual([]);
  });

  it("keeps the first occurrence of a duplicate enter or exit action on the same target and warns", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
      ],
      edges: [],
      timeline: {
        entries: [
          { kind: "enter", step: 1, targetId: "A", effect: "fade" },
          { kind: "enter", step: 3, targetId: "A", effect: "slide-left" },
          { kind: "enter", step: 1, targetId: "B", effect: "fade" },
          { kind: "exit", step: 2, targetId: "B", effect: "fade" },
          { kind: "exit", step: 4, targetId: "B", effect: "slide-right" },
        ],
      },
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(graph).not.toBeNull();
    expect(graph!.timeline.entries).toEqual([
      { kind: "enter", step: 1, targetId: "A", effect: "fade" },
      { kind: "enter", step: 1, targetId: "B", effect: "fade" },
      { kind: "exit", step: 2, targetId: "B", effect: "fade" },
    ]);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every((d) => d.severity === "warning")).toBe(true);
  });

  it("picks the numerically earliest step as the duplicate-enter winner, even when it is declared later in the source", () => {
    // step 3 is written before step 1 in the array (as if the author typed
    // the timeline block out of chronological order) — "first occurrence"
    // must mean the earliest step, not the earliest line, or prev()/next()
    // (which always iterate in step order) would disagree with which enter
    // effect actually applies.
    const document: SirenDocument = {
      direction: "TD",
      nodes: [{ id: "A", label: "A" }],
      edges: [],
      timeline: {
        entries: [
          { kind: "enter", step: 3, targetId: "A", effect: "slide-left" },
          { kind: "enter", step: 1, targetId: "A", effect: "fade" },
        ],
      },
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(graph).not.toBeNull();
    expect(graph!.timeline.entries).toEqual([
      { kind: "enter", step: 1, targetId: "A", effect: "fade" },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("warning");
  });

  it("drops a highlight/exit/unhighlight action whose step precedes the target's visibility step, reporting an error, while the rest of the graph still builds", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
      ],
      edges: [],
      timeline: {
        entries: [
          // B's actual enter step is 2, but this highlight is (mis)placed at step 1,
          // before B becomes visible.
          { kind: "highlight", step: 1, targetId: "B", effect: "outline" },
          { kind: "enter", step: 2, targetId: "B", effect: "fade" },
        ],
      },
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(graph).not.toBeNull();
    expect(graph!.timeline.entries).toEqual([
      { kind: "enter", step: 2, targetId: "B", effect: "fade" },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
  });

  it("allows exit on an element that was never entered (visible from step 0) at any later step", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [{ id: "A", label: "A" }],
      edges: [],
      timeline: {
        entries: [{ kind: "exit", step: 3, targetId: "A", effect: "fade" }],
      },
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(graph).not.toBeNull();
    expect(graph!.timeline.entries).toEqual([
      { kind: "exit", step: 3, targetId: "A", effect: "fade" },
    ]);
  });

  it("allows a highlight at the exact step its target enters (not just strictly after)", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [{ id: "B", label: "B" }],
      edges: [],
      timeline: {
        entries: [
          { kind: "enter", step: 2, targetId: "B", effect: "fade" },
          { kind: "highlight", step: 2, targetId: "B", effect: "outline" },
        ],
      },
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(graph).not.toBeNull();
    expect(graph!.timeline.entries).toEqual([
      { kind: "enter", step: 2, targetId: "B", effect: "fade" },
      { kind: "highlight", step: 2, targetId: "B", effect: "outline" },
    ]);
  });

  it("drops exit/highlight/unhighlight actions referencing an unknown id, including edge ids, reporting an error each", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
      ],
      edges: [{ from: "A", to: "B" }],
      timeline: {
        entries: [
          { kind: "exit", step: 1, targetId: "does-not-exist", effect: "fade" },
          { kind: "highlight", step: 1, targetId: "also-missing", effect: "glow" },
          { kind: "unhighlight", step: 1, targetId: "still-missing" },
          { kind: "highlight", step: 1, targetId: "A-B", effect: "outline" },
        ],
      },
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(graph).not.toBeNull();
    expect(graph!.timeline.entries).toEqual([
      { kind: "highlight", step: 1, targetId: "A-B", effect: "outline" },
    ]);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.every((d) => d.severity === "error")).toBe(true);
  });

  it("resolves all four action kinds, grouped by step, with kind/targetId/effect intact per entry", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [{ id: "A", label: "A" }],
      edges: [],
      timeline: {
        entries: [
          { kind: "enter", step: 1, targetId: "A", effect: "slide-top" },
          { kind: "highlight", step: 2, targetId: "A", effect: "glow" },
          { kind: "unhighlight", step: 3, targetId: "A" },
          { kind: "exit", step: 4, targetId: "A", effect: "slide-bottom" },
        ],
      },
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(graph).not.toBeNull();

    const byStep = new Map(graph!.timeline.entries.map((e) => [e.step, e]));
    expect(byStep.get(1)).toEqual({ kind: "enter", step: 1, targetId: "A", effect: "slide-top" });
    expect(byStep.get(2)).toEqual({ kind: "highlight", step: 2, targetId: "A", effect: "glow" });
    expect(byStep.get(3)).toEqual({ kind: "unhighlight", step: 3, targetId: "A", effect: undefined });
    expect(byStep.get(4)).toEqual({
      kind: "exit",
      step: 4,
      targetId: "A",
      effect: "slide-bottom",
    });
    expect(graph!.timeline.totalSteps).toBe(4);
  });

  it("warns when a node exits while an edge connected to it never exits, since the edge would render with a missing endpoint", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
      ],
      edges: [{ from: "A", to: "B" }],
      timeline: {
        entries: [{ kind: "exit", step: 5, targetId: "A", effect: "fade" }],
      },
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(graph).not.toBeNull();
    // The warning does not drop the exit action itself — it's advisory,
    // not a structural error; the author's content still renders as
    // authored, just with a diagnostic pointing at the gap.
    expect(graph!.timeline.entries).toEqual([
      { kind: "exit", step: 5, targetId: "A", effect: "fade" },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(diagnostics[0]!.message).toContain("A-B");
    expect(diagnostics[0]!.message).toContain("A");
    expect(diagnostics[0]!.message).toContain("5");
  });

  it("warns when a node exits before an edge connected to it (which does eventually exit, but too late)", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
      ],
      edges: [{ from: "A", to: "B" }],
      timeline: {
        entries: [
          { kind: "exit", step: 5, targetId: "A", effect: "fade" },
          { kind: "exit", step: 8, targetId: "A-B", effect: "fade" },
        ],
      },
    };

    const { diagnostics } = buildGraphModel(document);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(diagnostics[0]!.message).toContain("A-B");
  });

  it("does not warn when the connected edge exits at or before the node, or when neither endpoint ever exits", () => {
    const document: SirenDocument = {
      direction: "TD",
      nodes: [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
        { id: "C", label: "C" },
      ],
      edges: [
        { from: "A", to: "B" }, // A-B: edge exits at the same step as A
        { from: "B", to: "C" }, // B-C: neither B nor C ever exits
      ],
      timeline: {
        entries: [
          { kind: "exit", step: 5, targetId: "A", effect: "fade" },
          { kind: "exit", step: 5, targetId: "A-B", effect: "fade" },
        ],
      },
    };

    const { diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
  });
});
