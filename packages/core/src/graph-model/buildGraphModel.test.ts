import { describe, expect, it } from "vitest";
import type { LinkStyleDecl, SirenDocument } from "../contracts";
import { buildGraphModel } from "./buildGraphModel";

describe("buildGraphModel", () => {
  it("assigns edge ids of the form fromId-toId for distinct pairs", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
        { id: "C", label: "C", shape: "rect" },
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "A", to: "B" },
      ],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
        { id: "C", label: "C", shape: "rect" },
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
      ],
      edges: [{ from: "A", to: "B" }],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "Is it ready?", shape: "rhombus" },
        { id: "B", label: "Done", shape: "rect" },
        { id: "A", label: "Is it ready?", shape: "rect" },
      ],
      edges: [],
      linkStyles: [],
      styles: [],
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(graph!.nodes).toEqual([
      { id: "A", label: "Is it ready?", shape: "rhombus", style: { frame: [], text: [] } },
      { id: "B", label: "Done", shape: "rect", style: { frame: [], text: [] } },
    ]);
  });

  it("keeps the first-seen label and warns when a node id is declared twice with conflicting labels", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      direction: "TB",
      nodes: [
        { id: "A", label: "Start", shape: "rect" },
        { id: "A", label: "Begin", shape: "rect" },
      ],
      edges: [],
      linkStyles: [],
      styles: [],
      timeline: null,
    };

    const { graph, diagnostics } = buildGraphModel(document);

    expect(graph).not.toBeNull();
    expect(graph!.nodes).toEqual([
      { id: "A", label: "Start", shape: "rect", style: { frame: [], text: [] } },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
  });

  it("sets totalSteps to 0 and leaves every element immediately visible when there is no timeline block", () => {
    const document: SirenDocument = {
      kind: "flowchart",
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
      ],
      edges: [{ from: "A", to: "B" }],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
      ],
      edges: [],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [{ id: "A", label: "A", shape: "rect" }],
      edges: [],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
      ],
      edges: [],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [{ id: "A", label: "A", shape: "rect" }],
      edges: [],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [{ id: "B", label: "B", shape: "rect" }],
      edges: [],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
      ],
      edges: [{ from: "A", to: "B" }],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [{ id: "A", label: "A", shape: "rect" }],
      edges: [],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
      ],
      edges: [{ from: "A", to: "B" }],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
      ],
      edges: [{ from: "A", to: "B" }],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
        { id: "C", label: "C", shape: "rect" },
      ],
      edges: [
        { from: "A", to: "B" }, // A-B: edge exits at the same step as A
        { from: "B", to: "C" }, // B-C: neither B nor C ever exits
      ],
      linkStyles: [],
      styles: [],
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
      direction: "TB",
      nodes: [{ id: "A", label: "A", shape: "rect" }],
      edges: [],
      linkStyles: [],
      styles: [],
      timeline: null,
    };

    const { graph, model, diagnostics } = buildGraphModel(document);

    expect(diagnostics).toEqual([]);
    expect(model).toBeNull();
    expect(graph).not.toBeNull();
    expect(graph!.nodes).toEqual([
      { id: "A", label: "A", shape: "rect", style: { frame: [], text: [] } },
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
      ],
      edges: [{ from: "A", to: "B" }],
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
      direction: "TB",
      nodes: [{ id: "A", label: "A", shape: "rect" }],
      edges: [],
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
      direction: "TB",
      nodes: [{ id: "A", label: "A", shape: "rect" }],
      edges: [],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
        { id: "C", label: "C", shape: "rect" },
        { id: "D", label: "D", shape: "rect" },
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
        { from: "C", to: "D" },
      ],
      styles: [],
      linkStyles: [
        {
          targets: ["1"],
          properties: [{ property: "stroke", value: "#f00" }],
          line: 5,
          column: 1,
        },
      ],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
        { id: "C", label: "C", shape: "rect" },
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ],
      styles: [],
      linkStyles: [
        {
          targets: ["0", "x"],
          properties: [{ property: "stroke", value: "#f00" }],
          line: 4,
          column: 1,
        },
      ],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
        { id: "C", label: "C", shape: "rect" },
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ].slice(0, edgeCount),
      styles: [],
      linkStyles: [
        {
          targets: ["9"],
          properties: [{ property: "stroke", value: "#f00" }],
          line: 4,
          column: 1,
        },
      ],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "A", to: "B" },
      ],
      styles: [],
      linkStyles: [
        {
          targets: ["default"],
          properties: [{ property: "stroke", value: "#0f0" }],
          line: 4,
          column: 1,
        },
      ],
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
      direction: "TB",
      nodes: [],
      edges: [{ from: "A", to: "B", line: 2, column: 3 }],
      styles: [],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
        { id: "C", label: "C", shape: "rect" },
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ],
      styles: [],
      linkStyles,
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
        { id: "C", label: "C", shape: "rect" },
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ],
      styles: [],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
      ],
      edges: [{ from: "A", to: "B" }],
      styles: [],
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
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rect" },
        { id: "B", label: "B", shape: "rect" },
      ],
      edges: [{ from: "A", to: "B" }],
      styles: [],
      linkStyles: [
        {
          targets: ["0", "default"],
          properties: [{ property: "stroke", value: "#f00" }],
          line: 3,
          column: 1,
        },
      ],
      timeline: null,
    };

    const { graph } = buildGraphModel(document);

    // The index and `default` are both authored spellings, spent here. If
    // either survived as a field, layout and the renderer would have a
    // second way to name an edge and would be free to disagree with the
    // first — which is exactly what `timeline:` and `data-siren-id` already
    // rely on not happening.
    expect(Object.keys(graph!.edges[0]).sort()).toEqual(["from", "id", "style", "to"]);
    expect(Object.keys(graph!).sort()).toEqual(["direction", "edges", "nodes", "timeline"]);
  });
});
