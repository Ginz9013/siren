import { describe, expect, it } from "vitest";
import type { FlowchartDocument, LinkStyleDecl, SirenDocument } from "../contracts";
import { buildGraphModel } from "./buildGraphModel";

/**
 * `A --> B`'s decomposition, spread into every fixture below that is about
 * something else — an id, a node's label, a `linkStyle`, a timeline
 * reference — so that the arrow those are not testing is written once. A
 * fixture that *is* about the arrow spells its own out in full.
 */
const PLAIN_ARROW = {
  line: "solid",
  fromEnd: "none",
  toEnd: "arrow",
  minLength: 1,
  label: null,
} as const;

describe("buildGraphModel", () => {
  it("assigns edge ids of the form fromId-toId for distinct pairs", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
        { id: "C", label: "C", shape: "rect", labelRuns: null },
      ],
      edges: [
        { from: "A", to: "B", ...PLAIN_ARROW },
        { from: "B", to: "C", ...PLAIN_ARROW },
      ],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(graph).not.toBeNull();
    expect(graph!.edges.map((e) => e.id)).toEqual(["A-B", "B-C"]);
  });

  it("suffixes the id of a second edge between the same pair with #2", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
      ],
      edges: [
        { from: "A", to: "B", ...PLAIN_ARROW },
        { from: "A", to: "B", ...PLAIN_ARROW },
      ],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(graph).not.toBeNull();
    expect(graph!.edges.map((e) => e.id)).toEqual(["A-B", "A-B#2"]);
  });

  it("resolves timeline entries against node/edge ids, grouping by step, and leaves elements never mentioned immediately visible", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
        { id: "C", label: "C", shape: "rect", labelRuns: null },
      ],
      edges: [
        { from: "A", to: "B", ...PLAIN_ARROW },
        { from: "B", to: "C", ...PLAIN_ARROW },
      ],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
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
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
      ],
      edges: [{ from: "A", to: "B", ...PLAIN_ARROW }],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
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

  it("carries each node's shape onto the GraphNode, keeping the first-seen one when an id is declared twice", () => {
    // The shape is the parser's answer, not this stage's: nothing here
    // re-reads a spelling, so a diamond stays a diamond and a node nobody
    // gave a bracket is the rect it has always been. The redeclaration rule
    // is the label's own, applied to the shape rather than invented for it.
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "Is it ready?", shape: "rhombus", labelRuns: null },
        { id: "B", label: "Done", shape: "rect", labelRuns: null },
        { id: "A", label: "Is it ready?", shape: "rect", labelRuns: null },
      ],
      edges: [],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(graph!.nodes).toEqual([
      { id: "A", label: "Is it ready?", shape: "rhombus", style: { frame: [], text: [] }, parentId: null, interaction: null, labelRuns: null },
      { id: "B", label: "Done", shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null, labelRuns: null },
    ]);
  });

  it("keeps the first-seen label and warns when a node id is declared twice with conflicting labels", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "Start", shape: "rect", labelRuns: null },
        { id: "A", label: "Begin", shape: "rect", labelRuns: null },
      ],
      edges: [],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(graph).not.toBeNull();
    expect(graph!.nodes).toEqual([
      { id: "A", label: "Start", shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null, labelRuns: null },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
  });

  it("sets totalSteps to 0 and leaves every element immediately visible when there is no timeline block", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
      ],
      edges: [{ from: "A", to: "B", ...PLAIN_ARROW }],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
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
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
      ],
      edges: [],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
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
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [{ id: "A", label: "A", shape: "rect", labelRuns: null }],
      edges: [],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
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
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
      ],
      edges: [],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
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
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [{ id: "A", label: "A", shape: "rect", labelRuns: null }],
      edges: [],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
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
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [{ id: "B", label: "B", shape: "rect", labelRuns: null }],
      edges: [],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
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
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
      ],
      edges: [{ from: "A", to: "B", ...PLAIN_ARROW }],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
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
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [{ id: "A", label: "A", shape: "rect", labelRuns: null }],
      edges: [],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
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
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
      ],
      edges: [{ from: "A", to: "B", ...PLAIN_ARROW }],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
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
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
      ],
      edges: [{ from: "A", to: "B", ...PLAIN_ARROW }],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
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
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
        { id: "C", label: "C", shape: "rect", labelRuns: null },
      ],
      edges: [
        { from: "A", to: "B", ...PLAIN_ARROW }, // A-B: edge exits at the same step as A
        { from: "B", to: "C", ...PLAIN_ARROW }, // B-C: neither B nor C ever exits
      ],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
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

  it("dispatches a kind: \"sequence\" document to buildSequenceModel, leaving graph null and populating model", () => {
    const document: SirenDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "B", participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: "B", participantKind: "participant", origin: "declared" },
        {
          kind: "message",
          from: "A",
          to: "B",
          text: "hello",
          arrow: { line: "solid", head: "filled" },
        },
      ],
      timeline: null,
    };

    const { graph, model, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(graph).toBeNull();
    expect(model).not.toBeNull();
    expect(model!.participants.map((p) => p.id)).toEqual(["A", "B"]);
    expect(model!.statements.filter((s) => s.kind === "message")).toHaveLength(1);
  });

  it("dispatches a kind: \"flowchart\" document to buildFlowchartModel, leaving model null and populating graph", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [{ id: "A", label: "A", shape: "rect", labelRuns: null }],
      edges: [],
      subgraphs: [],
      linkStyles: [],
      styles: [],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph, model, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(model).toBeNull();
    expect(graph).not.toBeNull();
    expect(graph!.nodes).toEqual([
      { id: "A", label: "A", shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null, labelRuns: null },
    ]);
  });

  it("dispatches a kind: \"class\" document to buildClassModel, leaving graph and model null and populating classModel", () => {
    const document: SirenDocument = {
      kind: "class",
      direction: "TB",
      classes: [
        { id: "Animal", generic: null, annotation: null, members: [] },
        { id: "Duck", generic: null, annotation: null, members: [] },
      ],
      relationships: [
        {
          from: "Animal",
          to: "Duck",
          line: "solid",
          fromEnd: "triangle",
          toEnd: "none",
          label: null,
          fromMultiplicity: null,
          toMultiplicity: null,
        },
      ],
      namespaces: [],
      notes: [],
      interactions: [],
      styles: [],
      timeline: null,
    };

    const { graph, model, classModel, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(graph).toBeNull();
    expect(model).toBeNull();
    expect(classModel).not.toBeNull();
    expect(classModel!.classes.map((c) => c.id)).toEqual(["Animal", "Duck"]);
    expect(classModel!.relationships.map((r) => r.id)).toEqual(["Animal-Duck"]);
  });

  it("resolves a flowchart's `style` statements onto the nodes they name, leaving an unstyled node with no declarations", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
      ],
      edges: [{ from: "A", to: "B", ...PLAIN_ARROW }],
      subgraphs: [],
      linkStyles: [],
      styles: [
        {
          styleKind: "style",
          authoredAs: "style",
          targetIds: ["A"],
          name: null,
          properties: [
            { property: "fill", value: "#fdd" },
            { property: "stroke", value: "#c00" },
          ],
          line: 3,
          column: 1,
        },
      ],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    const byId = Object.fromEntries(graph!.nodes.map((n) => [n.id, n]));
    expect(byId.A.style).toEqual({
      frame: [
        { property: "fill", value: "#fdd" },
        { property: "stroke", value: "#c00" },
      ],
      text: [],
    });
    // No declarations rather than an absent field: the renderer's "emit no
    // attribute" case is an empty list, not a missing one.
    expect(byId.B.style).toEqual({ frame: [], text: [] });
  });

  it("reports a flowchart `style` on an id no node declares, in the shared resolver's own words", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [{ id: "A", label: "A", shape: "rect", labelRuns: null }],
      edges: [],
      subgraphs: [],
      linkStyles: [],
      styles: [
        {
          styleKind: "style",
          authoredAs: "style",
          targetIds: ["Ghost"],
          name: null,
          properties: [{ property: "fill", value: "#fdd" }],
          line: 3,
          column: 1,
        },
      ],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'style "Ghost" references an id that does not exist; dropping the declaration.',
        line: 3,
        column: 1,
      },
    ]);
    expect(graph!.nodes[0].style).toEqual({ frame: [], text: [] });
  });

  it("puts a flowchart's style values through the one shared gate: a refused value is dropped and diagnosed, its sibling survives", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [{ id: "A", label: "A", shape: "rect", labelRuns: null }],
      edges: [],
      subgraphs: [],
      linkStyles: [],
      styles: [
        {
          styleKind: "style",
          authoredAs: "style",
          targetIds: ["A"],
          name: null,
          properties: [
            { property: "fill", value: "url(#evil)" },
            { property: "stroke", value: "#c00" },
          ],
          line: 3,
          column: 1,
        },
      ],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message:
          'Style value for "fill" uses "url(", which can fetch a remote resource; dropping the declaration.',
        line: 3,
        column: 1,
      },
    ]);
    expect(graph!.nodes[0].style).toEqual({ frame: [{ property: "stroke", value: "#c00" }], text: [] });
  });

  it("resolves a flowchart `linkStyle` index to the edge declared at that position, and carries its declarations on that edge's own id", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
        { id: "C", label: "C", shape: "rect", labelRuns: null },
        { id: "D", label: "D", shape: "rect", labelRuns: null },
      ],
      edges: [
        { from: "A", to: "B", ...PLAIN_ARROW },
        { from: "B", to: "C", ...PLAIN_ARROW },
        { from: "C", to: "D", ...PLAIN_ARROW },
      ],
      styles: [],
      subgraphs: [],
      linkStyles: [
        {
          targets: ["1"],
          properties: [{ property: "stroke", value: "#f00" }],
          line: 5,
          column: 1,
        },
      ],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    // Three edges, so an off-by-one in either direction lands on a
    // different id and fails here. And what comes out is keyed by the edge
    // id `timeline:` and `data-siren-id` already use — the index is spent
    // at this seam and travels no further.
    expect(graph!.edges.map((edge) => [edge.id, edge.style.frame])).toEqual([
      ["A-B", []],
      ["B-C", [{ property: "stroke", value: "#f00" }]],
      ["C-D", []],
    ]);
  });

  it("costs a malformed `linkStyle` address itself, leaving the addresses beside it in the same statement applied", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
        { id: "C", label: "C", shape: "rect", labelRuns: null },
      ],
      edges: [
        { from: "A", to: "B", ...PLAIN_ARROW },
        { from: "B", to: "C", ...PLAIN_ARROW },
      ],
      styles: [],
      subgraphs: [],
      linkStyles: [
        {
          targets: ["0", "x"],
          properties: [{ property: "stroke", value: "#f00" }],
          line: 4,
          column: 1,
        },
      ],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message:
          'linkStyle addresses "x", which is neither an edge index nor "default"; dropping the declaration.',
        line: 4,
        column: 1,
      },
    ]);
    // One bad address is not a reason to throw away the rest of the
    // statement, exactly as one unknown id is not in `resolveStyles`.
    expect(graph!.edges.map((edge) => [edge.id, edge.style.frame])).toEqual([
      ["A-B", [{ property: "stroke", value: "#f00" }]],
      ["B-C", []],
    ]);
  });

  it("names both the index and how many edges the document has when a `linkStyle` addresses an edge that is not there", () => {
    const documentWith = (edgeCount: number): SirenDocument => ({
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
        { id: "C", label: "C", shape: "rect", labelRuns: null },
      ],
      edges: [
        { from: "A", to: "B", ...PLAIN_ARROW },
        { from: "B", to: "C", ...PLAIN_ARROW },
      ].slice(0, edgeCount),
      styles: [],
      subgraphs: [],
      linkStyles: [
        {
          targets: ["9"],
          properties: [{ property: "stroke", value: "#f00" }],
          line: 4,
          column: 1,
        },
      ],
      accTitle: null,
      accDescr: null,
      timeline: null,
    });

    // The count is the actionable half: "9 is too high" is only useful next
    // to how high the author may go.
    const two = buildGraphModel(documentWith(2));
    expect(two.diagnostics).toEqual([
      {
        severity: "error",
        message:
          "linkStyle index 9 addresses no edge in a document with 2 edges; dropping the declaration.",
        line: 4,
        column: 1,
      },
    ]);
    expect(two.graph!.edges.every((edge) => edge.style.frame.length === 0)).toBe(true);

    const one = buildGraphModel(documentWith(1));
    expect(one.diagnostics[0].message).toBe(
      "linkStyle index 9 addresses no edge in a document with 1 edge; dropping the declaration.",
    );
  });

  it("spends a `linkStyle default` on every edge id in the document, so the renderer still sees only ids", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
      ],
      edges: [
        { from: "A", to: "B", ...PLAIN_ARROW },
        { from: "A", to: "B", ...PLAIN_ARROW },
      ],
      styles: [],
      subgraphs: [],
      linkStyles: [
        {
          targets: ["default"],
          properties: [{ property: "stroke", value: "#0f0" }],
          line: 4,
          column: 1,
        },
      ],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    // Including the `#2` repeat, which has no index of its own that an
    // author would guess.
    expect(graph!.edges.map((edge) => [edge.id, edge.style.frame])).toEqual([
      ["A-B", [{ property: "stroke", value: "#0f0" }]],
      ["A-B#2", [{ property: "stroke", value: "#0f0" }]],
    ]);
  });

  it("splits a `linkStyle`'s declarations into both halves, translating `color` even though an edge has nowhere to paint it", () => {
    // Ticket 06 split every resolved style into a frame half and a text half,
    // and the assertions above narrowed to `.frame` when they were reshaped.
    // This is what that narrowing gave up, stated once instead of six times:
    // an edge is one `<path>` with no `<text>`, so nothing an author writes
    // about a link could quietly go missing.
    //
    // The routing rule in `resolveStyles` is deliberately kind-neutral: it does
    // not know an edge from a class, so `color` is split off and translated to
    // `fill` here exactly as a node's would be. The edge simply has nowhere to
    // put it — one `<path>`, no `<text>` — so the renderer drops that half, and
    // `index.test.ts` pins that it never lands on the path, which is the bug
    // this ticket fixed one element over. Asserting the whole `AuthorStyle`
    // rather than `.frame` is what keeps both ends of that arrangement visible
    // from the model seam.
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [],
      edges: [{ from: "A", to: "B", ...PLAIN_ARROW, sourceLine: 2, sourceColumn: 3 }],
      styles: [],
      subgraphs: [],
      linkStyles: [
        {
          targets: ["default"],
          properties: [
            { property: "stroke", value: "#f00" },
            { property: "color", value: "#fff" },
          ],
          line: 3,
          column: 1,
        },
      ],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(graph!.edges.map((edge) => edge.style)).toEqual([
      {
        frame: [{ property: "stroke", value: "#f00" }],
        text: [{ property: "fill", value: "#fff" }],
      },
    ]);
  });

  it("lets a specific `linkStyle` beat `linkStyle default` for the edge it names, whichever order the two are written in", () => {
    // Mermaid reads `linkStyle default` as the fallback for the links
    // nothing else styles, so a specific `linkStyle N` wins even when the
    // author wrote it first. That is not a specificity model between author
    // directives, which ADR-0008 refuses: last-declaration-wins settles
    // repeated declarations *on one target*, and `default` is not a target,
    // it is a tier under all of them.
    const documentWith = (...linkStyles: LinkStyleDecl[]): SirenDocument => ({
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
        { id: "C", label: "C", shape: "rect", labelRuns: null },
      ],
      edges: [
        { from: "A", to: "B", ...PLAIN_ARROW },
        { from: "B", to: "C", ...PLAIN_ARROW },
      ],
      styles: [],
      subgraphs: [],
      linkStyles,
      accTitle: null,
      accDescr: null,
      timeline: null,
    });

    const fallback: LinkStyleDecl = {
      targets: ["default"],
      properties: [{ property: "stroke", value: "#0f0" }],
      line: 4,
      column: 1,
    };
    const specific: LinkStyleDecl = {
      targets: ["0"],
      properties: [{ property: "stroke", value: "#f00" }],
      line: 5,
      column: 1,
    };

    const styled = (document: SirenDocument) => {
      const { graph, diagnostics } = buildGraphModel(document);
      expect(diagnostics).toEqual([]);
      return graph!.edges.map((edge) => [edge.id, edge.style.frame]);
    };

    // The edge no specific `linkStyle` names keeps the fallback in both
    // orders — the specific statement takes edge 0 out of the tier, it does
    // not switch the tier off.
    expect(styled(documentWith(fallback, specific))).toEqual([
      ["A-B", [{ property: "stroke", value: "#f00" }]],
      ["B-C", [{ property: "stroke", value: "#0f0" }]],
    ]);

    expect(styled(documentWith(specific, fallback))).toEqual([
      ["A-B", [{ property: "stroke", value: "#f00" }]],
      ["B-C", [{ property: "stroke", value: "#0f0" }]],
    ]);
  });

  it("merges a specific `linkStyle` into `linkStyle default` property by property, rather than replacing what the fallback declared", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
        { id: "C", label: "C", shape: "rect", labelRuns: null },
      ],
      edges: [
        { from: "A", to: "B", ...PLAIN_ARROW },
        { from: "B", to: "C", ...PLAIN_ARROW },
      ],
      styles: [],
      subgraphs: [],
      linkStyles: [
        {
          targets: ["default"],
          properties: [
            { property: "stroke", value: "#0f0" },
            { property: "stroke-width", value: "4px" },
          ],
          line: 4,
          column: 1,
        },
        {
          targets: ["0"],
          properties: [{ property: "stroke", value: "#f00" }],
          line: 5,
          column: 1,
        },
      ],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    // The specific statement said one thing about edge 0, so it takes one
    // property away from the fallback and leaves the rest of it standing —
    // a tier is what the edge falls back *to*, not a set the specific
    // statement replaces. The width the author only ever wrote once is the
    // thing a wholesale replacement drops.
    expect(graph!.edges.map((edge) => [edge.id, edge.style.frame])).toEqual([
      [
        "A-B",
        [
          { property: "stroke", value: "#f00" },
          { property: "stroke-width", value: "4px" },
        ],
      ],
      [
        "B-C",
        [
          { property: "stroke", value: "#0f0" },
          { property: "stroke-width", value: "4px" },
        ],
      ],
    ]);
  });

  it("settles two `linkStyle default` statements between themselves by last-declaration-wins: the fallback is one tier, not one tier per statement", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
      ],
      edges: [{ from: "A", to: "B", ...PLAIN_ARROW }],
      styles: [],
      subgraphs: [],
      linkStyles: [
        {
          targets: ["default"],
          properties: [
            { property: "stroke", value: "#0f0" },
            { property: "stroke-width", value: "4px" },
          ],
          line: 3,
          column: 1,
        },
        {
          targets: ["default"],
          properties: [{ property: "stroke", value: "#00f" }],
          line: 4,
          column: 1,
        },
      ],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    // Neither statement is more specific than the other, so nothing here is
    // decided by the tier: ADR-0008 settles them exactly as it settles two
    // `style` statements on one node — the second takes the property it
    // repeats and leaves the one it does not mention alone.
    expect(graph!.edges[0].style).toEqual({
      frame: [
        { property: "stroke", value: "#00f" },
        { property: "stroke-width", value: "4px" },
      ],
      text: [],
    });
  });

  it("lets no `linkStyle` index out of the model: an edge leaves with an id, its endpoints and its declarations, and nothing else", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      interactions: [],
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect", labelRuns: null },
        { id: "B", label: "B", shape: "rect", labelRuns: null },
      ],
      edges: [
        { from: "A", to: "B", line: "solid", fromEnd: "none", toEnd: "arrow", minLength: 1, label: null },
      ],
      styles: [],
      subgraphs: [],
      linkStyles: [
        {
          targets: ["0", "default"],
          properties: [{ property: "stroke", value: "#f00" }],
          line: 3,
          column: 1,
        },
      ],
      accTitle: null,
      accDescr: null,
      timeline: null,
    };

    const { graph } = buildGraphModel(document);

    // The index and `default` are both authored spellings, spent here. If
    // either survived as a field, layout and the renderer would have a
    // second way to name an edge and would be free to disagree with the
    // first — which is exactly what `timeline:` and `data-siren-id` already
    // rely on not happening.
    expect(Object.keys(graph!.edges[0]).sort()).toEqual([
      "fromEnd",
      "from",
      "id",
      "label",
      "line",
      "minLength",
      "style",
      "toEnd",
      "to",
    ].sort());
    expect(Object.keys(graph!).sort()).toEqual([
      // The document's screen-reader-only title/description, carried
      // through unchanged — same reasoning as `subgraphs` below.
      "accDescr",
      "accTitle",
      "direction",
      "edges",
      "nodes",
      // The grouping a `subgraph` block declares, resolved. It joins the
      // model's field set for the same reason the fields above are pinned
      // here at all: what leaves this stage is the whole of what layout and
      // the renderer may read, and an addition should have to be written
      // down rather than merely appear.
      "subgraphs",
      "timeline",
    ]);
  });
});

/**
 * The model assigns an edge its id and its resolved styling, and it decides
 * nothing about the arrow: the token was read once, in the parser, and this
 * stage has no business re-deciding what `A -.-> B` meant — the same rule
 * `shape` already follows for a node.
 */
describe("an edge's arrow through the model", () => {
  const documentWith = (edges: FlowchartDocument["edges"]): SirenDocument => ({
    kind: "flowchart",
    interactions: [],
    direction: "TB",
    nodes: [
      { id: "A", label: "A", shape: "rect", labelRuns: null },
      { id: "B", label: "B", shape: "rect", labelRuns: null },
    ],
    edges,
    subgraphs: [],
    linkStyles: [],
    styles: [],
    accTitle: null,
    accDescr: null,
    timeline: null,
  });

  it("carries the line, both ends and the length onto the edge it gives an id", () => {
    const { graph, diagnostics } = buildGraphModel(
      documentWith([
        { from: "A", to: "B", line: "dotted", fromEnd: "arrow", toEnd: "circle", minLength: 3, label: null },
      ]),
    );

    expect(diagnostics).toEqual([]);
    expect(graph!.edges).toEqual([
      {
        id: "A-B",
        from: "A",
        to: "B",
        line: "dotted",
        fromEnd: "arrow",
        toEnd: "circle",
        minLength: 3,
        label: null,
        style: { frame: [], text: [] },
      },
    ]);
  });

  it("carries the label the author wrote onto the edge, and null when they wrote none", () => {
    // The label travels with the arrow, from the same read: it is the
    // parser that decided `A -->|yes| B` and `A -- yes --> B` say the same
    // thing, and this stage re-deciding it would be the second opinion the
    // rule above exists to prevent.
    const { graph } = buildGraphModel(
      documentWith([
        { from: "A", to: "B", line: "solid", fromEnd: "none", toEnd: "arrow", minLength: 1, label: "yes" },
        { from: "B", to: "A", line: "solid", fromEnd: "none", toEnd: "arrow", minLength: 1, label: null },
      ]),
    );

    expect(graph!.edges.map((edge) => [edge.id, edge.label])).toEqual([
      ["A-B", "yes"],
      ["B-A", null],
    ]);
  });

  it("keeps each edge's own arrow when two edges share a pair", () => {
    // The repeat-pair id (`A-B#2`) is assigned here, and it would be an easy
    // place to hand both edges one arrow — they are, after all, the same
    // pair. They are not the same edge.
    const { graph } = buildGraphModel(
      documentWith([
        { from: "A", to: "B", line: "solid", fromEnd: "none", toEnd: "arrow", minLength: 1, label: null },
        { from: "A", to: "B", line: "thick", fromEnd: "none", toEnd: "cross", minLength: 2, label: null },
      ]),
    );

    expect(graph!.edges.map((edge) => [edge.id, edge.line, edge.toEnd, edge.minLength])).toEqual([
      ["A-B", "solid", "arrow", 1],
      ["A-B#2", "thick", "cross", 2],
    ]);
  });
});

/**
 * A subgraph after resolution: what it is called downstream, and which nodes
 * belong to it.
 *
 * **Its id is generated, not the author's own word for it.** That is the
 * class diagram's answer for a namespace (`namespace:1`), and it is here for
 * exactly the reason ADR-0010 gives: every element a diagram can animate
 * shares one id space, and a subgraph may legitimately be named after a node
 * — mermaid 11.17.2 accepts `A[Alpha]` beside `subgraph A`, measured — so a
 * subgraph carrying its author-written name would give two unrelated
 * elements the same `data-siren-id`. `\w` does not match a colon, so a
 * generated id cannot be spelled by any node id or any `${from}-${to}` edge
 * id: the collision is unconstructible rather than merely unlikely.
 */
describe("a subgraph in the graph model", () => {
  const grouped = (subgraphs: FlowchartDocument["subgraphs"]): SirenDocument => ({
    kind: "flowchart",
    interactions: [],
    direction: "TB",
    nodes: [
      { id: "A", label: "A", shape: "rect", labelRuns: null },
      { id: "B", label: "B", shape: "rect", labelRuns: null },
      { id: "C", label: "C", shape: "rect", labelRuns: null },
    ],
    edges: [{ from: "A", to: "B", ...PLAIN_ARROW }],
    subgraphs,
    linkStyles: [],
    styles: [],
    accTitle: null,
    accDescr: null,
    timeline: null,
  });

  it("gives each one a generated id and puts its members' parentage on the nodes", () => {
    const { graph, diagnostics } = buildGraphModel(
      grouped([
        { name: "Ingest", label: "Ingest", nodeIds: ["A", "B"], subgraphs: [], direction: null },
      ]),
    );

    expect(diagnostics).toEqual([]);
    expect(graph!.subgraphs).toEqual([
      { id: "subgraph:1", label: "Ingest", parentId: null, direction: null },
    ]);
    expect(graph!.nodes.map((node) => [node.id, node.parentId])).toEqual([
      ["A", "subgraph:1"],
      ["B", "subgraph:1"],
      // Outside every block, and `null` rather than absent — the
      // empty-not-absent rule `style` and `shape` already follow.
      ["C", null],
    ]);
  });

  it("numbers a nested subgraph in source order and points it at the one enclosing it", () => {
    const { graph } = buildGraphModel(
      grouped([
        {
          name: "Outer",
          label: "Outer",
          nodeIds: ["C"],
          subgraphs: [
            {
              name: "Inner",
              label: "Inner",
              nodeIds: ["A", "B"],
              subgraphs: [],
              direction: null,
            },
          ],
          direction: null,
        },
      ]),
    );

    // Pre-order, which is the order the author wrote the `subgraph` keywords
    // in and therefore the order they would count them in.
    expect(graph!.subgraphs).toEqual([
      { id: "subgraph:1", label: "Outer", parentId: null, direction: null },
      { id: "subgraph:2", label: "Inner", parentId: "subgraph:1", direction: null },
    ]);
    expect(graph!.nodes.map((node) => [node.id, node.parentId])).toEqual([
      ["A", "subgraph:2"],
      ["B", "subgraph:2"],
      ["C", "subgraph:1"],
    ]);
  });

  it("does not collide with a node that has the author's own name for it", () => {
    // The trap the class diagram already paid for, one kind over: `A` is a
    // node *and* the word the author titled the block with. Two elements,
    // two ids, and the frame's cannot be spelled by any node.
    const { graph, diagnostics } = buildGraphModel(
      grouped([{ name: "A", label: "A", nodeIds: ["B"], subgraphs: [], direction: null }]),
    );

    expect(diagnostics).toEqual([]);
    expect(graph!.subgraphs.map((sub) => sub.id)).toEqual(["subgraph:1"]);
    expect(graph!.nodes.map((node) => node.id)).toContain("A");
    expect(graph!.nodes.find((node) => node.id === "A")!.parentId).toBeNull();
  });

  it("makes a subgraph a timeline target under its generated id", () => {
    // A frame nobody can name would be a decision by omission. Board 2's
    // rule is that a diagram kind gains animation by tagging drawn elements
    // with the ids the timeline uses, and a namespace already resolves this
    // way — so `step 1: enter subgraph:1 fade` has to resolve rather than be
    // dropped as an unknown target.
    const document = grouped([
      { name: "Ingest", label: "Ingest", nodeIds: ["A", "B"], subgraphs: [], direction: null },
    ]) as FlowchartDocument;
    const { graph, diagnostics } = buildGraphModel({
      ...document,
      timeline: {
        entries: [{ kind: "enter", step: 1, targetId: "subgraph:1", effect: "fade" }],
      },
    });

    expect(diagnostics).toEqual([]);
    expect(graph!.timeline.entries).toEqual([
      { kind: "enter", step: 1, targetId: "subgraph:1", effect: "fade" },
    ]);
  });
});

describe("buildGraphModel — a state document", () => {
  const stateDocument: SirenDocument = {
    kind: "state",
    states: [
      { id: "Idle", kind: "state", descriptions: [], parentId: null, direction: null, line: 2, column: 1 },
      {
        id: "Running",
        kind: "state",
        descriptions: [],
        parentId: null,
        direction: null,
        line: 2,
        column: 1,
      },
    ],
    transitions: [
      {
        from: "Idle",
        to: "Running",
        label: "start",
        parentId: null,
        sourceLine: 2,
        sourceColumn: 1,
      },
      {
        from: "Running",
        to: "Running",
        label: "retry",
        parentId: null,
        sourceLine: 3,
        sourceColumn: 1,
      },
    ],
  };

  it("resolves it through buildStateModel into `stateModel`, leaving the other three null", () => {
    // `GraphModelResult`'s fourth nullable field: at most one is non-null,
    // and which one says what kind of document was resolved. A caller must
    // branch on the field it expects being non-null, never on the others
    // being null.
    const { graph, model, classModel, stateModel, diagnostics } = buildGraphModel(stateDocument);

    expect(diagnostics).toEqual([]);
    expect(graph).toBeNull();
    expect(model).toBeNull();
    expect(classModel).toBeNull();
    expect(stateModel).not.toBeNull();
    expect(stateModel!.states.map((state) => state.id)).toEqual(["Idle", "Running"]);
    expect(stateModel!.transitions.map((transition) => transition.id)).toEqual([
      "Idle-Running",
      "Running-Running",
    ]);
  });
});
