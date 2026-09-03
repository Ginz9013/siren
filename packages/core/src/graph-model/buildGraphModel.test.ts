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
          { step: 1, targetId: "B", effect: "fade" },
          { step: 2, targetId: "C", effect: "fade" },
          { step: 2, targetId: "A-B", effect: "fade" },
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
          { step: 1, targetId: "B", effect: "fade" },
          { step: 1, targetId: "does-not-exist", effect: "fade" },
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
});
