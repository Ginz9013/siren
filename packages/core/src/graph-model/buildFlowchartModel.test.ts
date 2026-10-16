import { describe, expect, it } from "vitest";
import type { FlowchartDocument, SirenNode } from "../contracts";
import { buildFlowchartModel } from "./buildFlowchartModel";
import { plainLabel, plainRun } from "../label/label";

/**
 * A `FlowchartDocument` with everything empty, so each test states only the
 * declarations it is about. Hand-built rather than parsed: `buildFlowchartModel`
 * is a pure function over the document shape, and the parser is a separate
 * seam with its own tests.
 */
function flowchartDocument(overrides: Partial<FlowchartDocument> = {}): FlowchartDocument {
  return {
    kind: "flowchart",
    direction: "TB",
    nodes: [],
    edges: [],
    subgraphs: [],
    styles: [],
    linkStyles: [],
    interactions: [],
    accTitle: null,
    accDescr: null,
    timeline: null,
    ...overrides,
  };
}

/** A `SirenNode` with the fields a test does not care about defaulted. */
function sirenNode(overrides: Partial<SirenNode> & { id: string }): SirenNode {
  return { label: plainLabel(overrides.id), shape: "rect", ...overrides };
}

describe("buildFlowchartModel's interactions", () => {
  it("resolves an interaction onto the node it targets, leaving an uninvolved node's interaction null", () => {
    const { graph, diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" })],
        interactions: [
          {
            interactionKind: "href",
            targetId: "A",
            action: "https://example.com",
            argument: null,
            tooltip: "the docs",
            line: 3,
            column: 1,
          },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
    expect(byId.A.interaction).toEqual({
      targetId: "A",
      interactionKind: "href",
      action: "https://example.com",
      argument: null,
      tooltip: "the docs",
      linkTarget: null,
    });
    expect(byId.B.interaction).toBeNull();
  });

  it("resolves a call interaction, passing its argument through", () => {
    const { graph, diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" })],
        interactions: [
          {
            interactionKind: "call",
            targetId: "A",
            action: "showDetails",
            argument: "42",
            tooltip: null,
            line: 2,
            column: 1,
          },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(graph.nodes[0].interaction).toEqual({
      targetId: "A",
      interactionKind: "call",
      action: "showDetails",
      argument: "42",
      tooltip: null,
      linkTarget: null,
    });
  });

  it("drops an interaction naming a node that does not exist, with an error diagnostic, keeping the rest of the graph", () => {
    const { graph, diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" })],
        interactions: [
          {
            interactionKind: "href",
            targetId: "Ghost",
            action: "https://example.com",
            argument: null,
            tooltip: null,
            line: 5,
            column: 1,
          },
        ],
      }),
    );

    expect(graph.nodes[0].interaction).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'click "Ghost" references a target that does not exist; dropping the interaction.',
        line: 5,
        column: 1,
      },
    ]);
  });

  it("rejects a disallowed URL scheme through the same allowlist a class diagram uses, dropping the interaction", () => {
    const { graph, diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" })],
        interactions: [
          {
            interactionKind: "href",
            targetId: "A",
            action: "javascript:alert(1)",
            argument: null,
            tooltip: null,
            line: 1,
            column: 1,
          },
        ],
      }),
    );

    expect(graph.nodes[0].interaction).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/disallowed URL scheme/);
  });

  it("leaves a node with no click statement at all carrying a null interaction", () => {
    const { graph } = buildFlowchartModel(
      flowchartDocument({ nodes: [sirenNode({ id: "A" })] }),
    );

    expect(graph.nodes[0].interaction).toBeNull();
  });
});

describe("buildFlowchartModel's node label", () => {
  it("carries a node's label through unchanged, runs and all", () => {
    const label = { text: "bold", rows: [[{ ...plainRun("bold"), bold: true }]] };
    const { graph } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A", label })],
      }),
    );

    expect(graph.nodes[0].label).toEqual(label);
  });
});

describe("buildFlowchartModel's subgraph direction", () => {
  it("carries a subgraph's own direction through onto the resolved subgraph", () => {
    const { graph, diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" })],
        subgraphs: [
          { name: "one", label: plainLabel("one"), nodeIds: ["A"], subgraphs: [], direction: "LR" },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(graph.subgraphs).toEqual([
      { id: "subgraph:1", label: plainLabel("one"), parentId: null, direction: "LR" },
    ]);
  });

  it("leaves a resolved subgraph's direction null when the author wrote none", () => {
    const { graph } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" })],
        subgraphs: [
          { name: "one", label: plainLabel("one"), nodeIds: ["A"], subgraphs: [], direction: null },
        ],
      }),
    );

    expect(graph.subgraphs).toEqual([
      { id: "subgraph:1", label: plainLabel("one"), parentId: null, direction: null },
    ]);
  });
});

/**
 * An edge endpoint that names a `subgraph` block. The parser records the
 * author's own word for it; this is where it becomes the frame's generated
 * id, because that id does not exist until this stage mints it.
 */
describe("buildFlowchartModel's subgraph edge endpoints", () => {
  it("resolves an authored subgraph name at either end to that subgraph's generated id", () => {
    const { graph, diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" })],
        subgraphs: [
          { name: "one", label: plainLabel("one"), nodeIds: ["A"], subgraphs: [], direction: null },
          { name: "two", label: plainLabel("two"), nodeIds: ["B"], subgraphs: [], direction: null },
        ],
        edges: [
          {
            from: "one",
            to: "two",
            line: "solid",
            fromEnd: "none",
            toEnd: "arrow",
            minLength: 1,
            label: null,
          },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(graph.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["subgraph:1", "subgraph:2"],
    ]);
  });

  it("keeps the edge's id spelled in the author's own words, colon-free", () => {
    // ADR-0010 puts generated ids and connector ids in separate spaces, and
    // the promise that makes them separate is that no `${from}-${to}`
    // connector id contains a colon. Deriving this edge's id from the
    // resolved endpoints would have broken it — and taken the author's own
    // handle on the edge with it, since `subgraph:1` is by design a word
    // they cannot write.
    const { graph } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" })],
        subgraphs: [
          { name: "one", label: plainLabel("one"), nodeIds: ["A"], subgraphs: [], direction: null },
        ],
        edges: [
          {
            from: "A",
            to: "one",
            line: "solid",
            fromEnd: "none",
            toEnd: "arrow",
            minLength: 1,
            label: null,
          },
        ],
      }),
    );

    expect(graph.edges.map((edge) => edge.id)).toEqual(["A-one"]);
  });

  it("leaves an endpoint that names no subgraph as the node id it is", () => {
    const { graph, diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" })],
        subgraphs: [
          { name: "one", label: plainLabel("one"), nodeIds: ["A"], subgraphs: [], direction: null },
        ],
        edges: [
          {
            from: "A",
            to: "B",
            line: "solid",
            fromEnd: "none",
            toEnd: "arrow",
            minLength: 1,
            label: null,
          },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(graph.edges.map((edge) => [edge.id, edge.from, edge.to])).toEqual([
      ["A-B", "A", "B"],
    ]);
  });
});

describe("buildFlowchartModel's accTitle/accDescr", () => {
  it("carries accTitle and accDescr through unchanged", () => {
    const { graph } = buildFlowchartModel(
      flowchartDocument({ accTitle: "A short title", accDescr: "A longer description" }),
    );

    expect(graph.accTitle).toBe("A short title");
    expect(graph.accDescr).toBe("A longer description");
  });

  it("leaves accTitle and accDescr null when the document carries neither", () => {
    const { graph } = buildFlowchartModel(flowchartDocument());

    expect(graph.accTitle).toBeNull();
    expect(graph.accDescr).toBeNull();
  });
});

/**
 * The **Curve** each edge is drawn with, resolved from `linkStyle …
 * interpolate` on the two tiers a `linkStyle` already has: `default` is the
 * fallback, an index beats it whichever is written first.
 */
describe("buildFlowchartModel's edge curve", () => {
  /** A chain `A --> B --> C`, so the document has edges `0` and `1`. */
  function chain(linkStyles: FlowchartDocument["linkStyles"]): FlowchartDocument {
    const edge = (from: string, to: string) => ({
      from,
      to,
      line: "solid" as const,
      fromEnd: "none" as const,
      toEnd: "arrow" as const,
      minLength: 1,
      label: null,
    });
    return flowchartDocument({
      nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" }), sirenNode({ id: "C" })],
      edges: [edge("A", "B"), edge("B", "C")],
      linkStyles,
    });
  }

  /** A `linkStyle` statement on line `line`, with no declarations. */
  function interpolate(targets: string[], name: string, line = 4) {
    return { targets, interpolate: name, properties: [], line, column: 3 };
  }

  it("leaves an edge no statement chose a curve for without one, for the renderer to draw as `basis`", () => {
    const { graph, diagnostics } = buildFlowchartModel(chain([]));

    expect(diagnostics).toEqual([]);
    expect(graph.edges.map((edge) => "curve" in edge)).toEqual([false, false]);
  });

  it("draws every edge with the curve `linkStyle default interpolate` chose", () => {
    const { graph, diagnostics } = buildFlowchartModel(chain([interpolate(["default"], "step")]));

    expect(diagnostics).toEqual([]);
    expect(graph.edges.map((edge) => edge.curve)).toEqual(["step", "step"]);
  });

  it("lets an index's curve beat `default`'s for the edge it names, whichever is written first", () => {
    const defaultFirst = buildFlowchartModel(
      chain([interpolate(["default"], "step", 4), interpolate(["0"], "linear", 5)]),
    );
    const indexFirst = buildFlowchartModel(
      chain([interpolate(["0"], "linear", 4), interpolate(["default"], "step", 5)]),
    );

    expect(defaultFirst.graph.edges.map((edge) => edge.curve)).toEqual(["linear", "step"]);
    expect(indexFirst.graph.edges.map((edge) => edge.curve)).toEqual(["linear", "step"]);
  });

  it("settles two statements on the same tier by the last one written", () => {
    const { graph } = buildFlowchartModel(
      chain([
        interpolate(["default"], "step", 4),
        interpolate(["default"], "rounded", 5),
        interpolate(["1"], "stepBefore", 6),
        interpolate(["1"], "stepAfter", 7),
      ]),
    );

    expect(graph.edges.map((edge) => edge.curve)).toEqual(["rounded", "stepAfter"]);
  });

  it("reports a curve Mermaid draws and Siren does not as an error, and leaves the edge on its fallback", () => {
    // `default` chose `step`; edge 0's `cardinal` is not drawable, so edge 0
    // falls back to `default`'s curve. A `default` that names one falls back
    // to `basis`, the curve below every tier.
    const overIndex = buildFlowchartModel(
      chain([interpolate(["default"], "step", 4), interpolate(["0"], "cardinal", 5)]),
    );
    const overDefault = buildFlowchartModel(chain([interpolate(["default"], "monotoneX", 4)]));

    expect(overIndex.graph.edges.map((edge) => edge.curve)).toEqual(["step", "step"]);
    expect(overIndex.diagnostics).toEqual([
      {
        severity: "error",
        message:
          'linkStyle interpolate "cardinal" is a curve Siren does not draw yet; the edges it addresses keep their fallback curve. Curves: basis, linear, step, stepBefore, stepAfter, rounded.',
        line: 5,
        column: 3,
      },
    ]);
    // No curve: below `default` there is only the renderer's `rounded`.
    expect(overDefault.graph.edges.map((edge) => edge.curve)).toEqual([undefined, undefined]);
    expect(overDefault.diagnostics.map((d) => [d.severity, d.line])).toEqual([["error", 4]]);
  });

  it("draws a name no curve has as `rounded`, as Mermaid 12 does, overriding `default`, with a warning listing the six curves", () => {
    // Mermaid matches the name exactly, so `Step` is as unknown as `zigzag`:
    // it still takes edge 0 off `default`'s `step`, onto `rounded` — what
    // Mermaid 12.2.0 draws every ELK-routed edge with (measured).
    const { graph, diagnostics } = buildFlowchartModel(
      chain([interpolate(["default"], "step", 4), interpolate(["0"], "Step", 5)]),
    );

    expect(graph.edges.map((edge) => edge.curve)).toEqual(["rounded", "step"]);
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          'linkStyle interpolate "Step" names no curve; drawing rounded. Curves: basis, linear, step, stepBefore, stepAfter, rounded.',
        line: 5,
        column: 3,
      },
    ]);
  });
});

/**
 * An edge the author gave an id of its own, `A e1@--> B`
 * (01M51XADJKSGRYG5CM1GG0T91R). Measured on Mermaid 12.2.0: a pair's
 * repeats are numbered across every edge between it, named or not — `A
 * e1@--> B`, `A --> B`, `A e2@--> B`, `A --> B` are `e1`, `L_A_B_2`, `e2`,
 * `L_A_B_4`.
 */
describe("buildFlowchartModel's authored edge ids", () => {
  /** An edge `from --> to`, with the id the author gave it, if any. */
  function sirenEdge(from: string, to: string, id?: string): FlowchartDocument["edges"][number] {
    return {
      from,
      to,
      line: "solid",
      fromEnd: "none",
      toEnd: "arrow",
      minLength: 1,
      label: null,
      ...(id === undefined ? {} : { id, idLine: 2, idColumn: 5 }),
    };
  }

  it("names the edge by its own id instead of `from-to`, and counts a pair's repeats across every edge", () => {
    const { graph, diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" })],
        edges: [sirenEdge("A", "B", "e1"), sirenEdge("A", "B"), sirenEdge("A", "B", "e2"), sirenEdge("A", "B")],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["e1", "A-B#2", "e2", "A-B#4"]);
  });

  it("refuses an edge id that a node already holds, at the edge id", () => {
    // Measured on Mermaid 12.2.0: after `A e1@--> B`, a line `e1` or
    // `C --> e1` draws no node `e1` at all; before it, the node and the edge
    // both answer to `e1`.
    const { diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" }), sirenNode({ id: "e1" })],
        edges: [sirenEdge("A", "B", "e1")],
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'The edge id "e1" is already the id of the node "e1". Give the edge another id',
        line: 2,
        column: 5,
      },
    ]);
  });

  it.each([
    // Measured on Mermaid 12.2.0: the second `e1` is dropped, and C-D drawn
    // under an id of Mermaid's own.
    ["another edge's own id", [sirenEdge("A", "B", "e1"), sirenEdge("C", "D", "e1")], "e1", "C --> D", "A --> B"],
    ["the id an edge is given from its ends", [sirenEdge("A", "B", "C-D"), sirenEdge("C", "D")], "C-D", "A --> B", "C --> D"],
    [
      "the id a repeated pair is numbered with",
      [sirenEdge("C", "D"), sirenEdge("A", "B", "C-D#2"), sirenEdge("C", "D")],
      "C-D#2",
      "A --> B",
      "C --> D",
    ],
  ])("refuses an edge id that is %s, at the edge id", (_case, edges, id, named, holder) => {
    const { diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: ["A", "B", "C", "D"].map((nodeId) => sirenNode({ id: nodeId })),
        edges,
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: `The edge id "${id}" of ${named} is already the id of the edge ${holder}. Give the edge another id`,
        line: 2,
        column: 5,
      },
    ]);
  });

  it("refuses an edge id that names a subgraph, at the edge id", () => {
    // Measured on Mermaid 12.2.0: `subgraph S … end` then `A S@--> B` draws
    // both, so a later `C --> S` would have to mean one of them.
    const { diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" }), sirenNode({ id: "C" })],
        edges: [sirenEdge("A", "B", "S")],
        subgraphs: [{ name: "S", label: plainLabel("S"), nodeIds: ["C"], subgraphs: [], direction: null }],
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'The edge id "S" is already the name of the subgraph "S". Give the edge another id',
        line: 2,
        column: 5,
      },
    ]);
  });

  it("lets a timeline name the edge by its own id", () => {
    const { graph, diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" })],
        edges: [sirenEdge("A", "B", "e1")],
        timeline: { entries: [{ kind: "enter", step: 1, targetId: "e1", effect: "fade", line: 4, column: 3 }] },
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(graph.timeline.entries).toEqual([{ kind: "enter", step: 1, targetId: "e1", effect: "fade" }]);
  });
});

/**
 * A node and an edge stamped with one `data-siren-id`: the node `A-B` and
 * the edge `A --> B` (01M51XADJKSGRYG5CM1GG0T91R). Mermaid 12.2.0 draws the
 * document, and so does Siren; only a timeline naming `A-B` is refused.
 */
describe("buildFlowchartModel's timeline on an id a node and an edge share", () => {
  const document = (targetId: string) =>
    flowchartDocument({
      nodes: [sirenNode({ id: "A-B" }), sirenNode({ id: "A" }), sirenNode({ id: "B" })],
      edges: [{ from: "A", to: "B", line: "solid", fromEnd: "none", toEnd: "arrow", minLength: 1, label: null }],
      timeline: { entries: [{ kind: "enter", step: 1, targetId, effect: "fade", line: 5, column: 3 }] },
    });

  it("refuses an action naming the shared id", () => {
    const { graph, diagnostics } = buildFlowchartModel(document("A-B"));

    expect(graph.timeline.entries).toEqual([]);
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message:
          'timeline: "A-B" is the id of more than one thing in the diagram, so this action cannot tell which it means. ' +
          "Give one of them another id",
        line: 5,
        column: 3,
      },
    ]);
  });

  it("draws the document and plays an action naming any other id", () => {
    const { graph, diagnostics } = buildFlowchartModel(document("A"));

    expect(diagnostics).toEqual([]);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["A-B"]);
    expect(graph.timeline.entries).toEqual([{ kind: "enter", step: 1, targetId: "A", effect: "fade" }]);
  });
});

/**
 * A `click`, `style` or `class` statement naming an edge by the id the
 * author gave it (01M51XADJKSGRYG5CM1GG0T91R). Measured on Mermaid 12.2.0
 * after `A e1@--> B`: `click e1 …` and `style e1 stroke:#f00` change nothing
 * drawn, and `class e1 c` paints the edge with `c`'s declarations.
 */
describe("buildFlowchartModel's node statements naming an edge id", () => {
  const edge = {
    from: "A",
    to: "B",
    line: "solid" as const,
    fromEnd: "none" as const,
    toEnd: "arrow" as const,
    minLength: 1,
    label: null,
    id: "e1",
    idLine: 2,
    idColumn: 3,
  };

  it("refuses a click on it, saying a click reaches only a node", () => {
    const { graph, diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" })],
        edges: [edge],
        interactions: [
          {
            interactionKind: "href",
            targetId: "e1",
            action: "https://example.com",
            argument: null,
            tooltip: null,
            line: 3,
            column: 1,
          },
        ],
      }),
    );

    expect(graph.nodes.map((node) => node.interaction)).toEqual([null, null]);
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: '"e1" is an edge, and a click reaches only a node. Leave the click out, or name a node',
        line: 3,
        column: 1,
      },
    ]);
  });

  it.each([
    [
      "style",
      { styleKind: "style" as const, authoredAs: "style", targetIds: ["e1"], name: null, properties: [{ property: "stroke", value: "#f00" }], line: 3, column: 7 },
      '"e1" is an edge, and style reaches only a node. Style an edge with linkStyle and its number',
    ],
  ])("refuses `%s` on it", (_statement, declaration, message) => {
    const { graph, diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" })],
        edges: [edge],
        styles: [
          { styleKind: "classDef", authoredAs: "classDef", targetIds: [], name: "c", properties: [{ property: "stroke-width", value: "9px" }], line: 2, column: 1 },
          declaration,
        ],
      }),
    );

    expect(graph.edges.map((drawn) => drawn.id)).toEqual(["e1"]);
    expect(diagnostics).toEqual([{ severity: "error", message, line: 3, column: 7 }]);
  });

  /** `classDef c …` on line 2, and `class <targets> c` on `line`. */
  const classStatements = (properties: { property: string; value: string }[], line = 3, targetIds = ["e1"]) => [
    { styleKind: "classDef" as const, authoredAs: "classDef", targetIds: [], name: "c", properties, line: 2, column: 1 },
    { styleKind: "apply" as const, authoredAs: "class", targetIds, name: "c", properties: [], line, column: 7 },
  ];

  it("paints it with the class's declarations, the line's and the label's", () => {
    // Measured in headless Chrome on Mermaid 12.2.0: `class e1 c` writes
    // `c`'s declarations onto the edge's path, its `color` reaching the
    // label as a `linkStyle`'s does; `class A,e1 c` paints both.
    const { graph, diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" })],
        edges: [edge],
        styles: classStatements(
          [
            { property: "stroke-width", value: "9px" },
            { property: "color", value: "#00f" },
          ],
          3,
          ["A", "e1"],
        ),
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(graph.edges[0]!.style).toEqual({
      frame: [{ property: "stroke-width", value: "9px" }],
      // `color` is written as the label's `fill`, as a `linkStyle`'s is.
      text: [{ property: "fill", value: "#00f" }],
    });
    expect(graph.nodes[0]!.style.frame).toEqual([{ property: "stroke-width", value: "9px" }]);
  });

  it("lets a linkStyle win over the class, wherever it is written", () => {
    // Measured: `linkStyle 0 stroke:#0f0` above `class e1 c` (c being
    // `stroke:#f00,stroke-width:9px`) still draws the line green, 9px wide.
    const { graph, diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" })],
        edges: [edge],
        styles: classStatements([
          { property: "stroke", value: "#f00" },
          { property: "stroke-width", value: "9px" },
        ]),
        linkStyles: [{ targets: ["0"], properties: [{ property: "stroke", value: "#0f0" }], line: 1, column: 1 }],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(graph.edges[0]!.style.frame).toEqual([
      { property: "stroke", value: "#0f0" },
      { property: "stroke-width", value: "9px" },
    ]);
  });

  it("refuses a class written above the edge, which reaches nothing", () => {
    // Measured: `class e1 c` above `A e1@--> B` paints nothing.
    const { diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" })],
        edges: [edge],
        styles: classStatements([{ property: "stroke", value: "#f00" }], 1),
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'The class statement names the edge "e1" above the line it is written on, so it reaches nothing. Move it below the edge',
        line: 1,
        column: 7,
      },
    ]);
  });

  it("refuses an `animation` a class would give it, pointing at the edge's own data", () => {
    // Mermaid animates it with keyframes of its own, which Siren's
    // stylesheet does not carry under that name.
    const { diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" })],
        edges: [edge],
        styles: classStatements([{ property: "animation", value: "dash 25s linear infinite" }]),
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'A class cannot animate the edge "e1". Write e1@{ animate: true } below the edge instead',
        line: 3,
        column: 7,
      },
    ]);
  });

  it("refuses the animation at the class statement that applies it, not the edge's first class", () => {
    const { diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" })],
        edges: [edge],
        styles: [
          { styleKind: "classDef", authoredAs: "classDef", targetIds: [], name: "c", properties: [{ property: "stroke", value: "#f00" }], line: 2, column: 1 },
          { styleKind: "classDef", authoredAs: "classDef", targetIds: [], name: "moving", properties: [{ property: "animation", value: "dash 25s linear infinite" }], line: 3, column: 1 },
          { styleKind: "apply", authoredAs: "class", targetIds: ["e1"], name: "c", properties: [], line: 4, column: 1 },
          { styleKind: "apply", authoredAs: "class", targetIds: ["e1"], name: "moving", properties: [], line: 5, column: 1 },
        ],
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'A class cannot animate the edge "e1". Write e1@{ animate: true } below the edge instead',
        line: 5,
        column: 1,
      },
    ]);
  });

  it("reports an unsafe value in a class applied to a node and an edge once", () => {
    const { diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" })],
        edges: [edge],
        styles: classStatements([{ property: "fill", value: "red;position:fixed" }], 3, ["A", "e1"]),
      }),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Style value for "fill" contains ";", which would smuggle in a second declaration; dropping the declaration.',
    ]);
  });
});

describe("buildFlowchartModel's invisible edge", () => {
  it("carries an invisible edge through like any other, counted among the edges a linkStyle numbers", () => {
    const edge = (from: string, to: string, line: "solid" | "invisible") => ({
      from,
      to,
      line,
      fromEnd: "none" as const,
      toEnd: line === "solid" ? ("arrow" as const) : ("none" as const),
      minLength: 1,
      label: null,
    });
    const { graph, diagnostics } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" }), sirenNode({ id: "C" })],
        edges: [edge("A", "B", "invisible"), edge("B", "C", "solid")],
        linkStyles: [{ targets: ["0"], properties: [{ property: "stroke-width", value: "4px" }], line: 4, column: 3 }],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(graph.edges.map((drawn) => [drawn.id, drawn.line, drawn.toEnd])).toEqual([
      ["A-B", "invisible", "none"],
      ["B-C", "solid", "arrow"],
    ]);
    expect(graph.edges[0]!.style.frame).toEqual([{ property: "stroke-width", value: "4px" }]);
  });
});

/**
 * An edge's `e1@{ … }` data: its animation, and its curve beside
 * `linkStyle … interpolate`. Measured on Mermaid 12.2.0: `animate` tested
 * for truth draws `fast`, and `animation` names the speed whatever
 * `animate` says. A block's `curve` and a `linkStyle N interpolate` each set
 * the edge's one curve as they are read, so the one written later wins,
 * and either beats `linkStyle default` (`FlowDB`; on ELK Mermaid draws
 * every edge rounded whatever it says, and Siren draws the curve, as it
 * does for `interpolate`).
 */
describe("buildFlowchartModel's edge data", () => {
  function withData(
    data: Partial<NonNullable<FlowchartDocument["edges"][number]["data"]>>,
    linkStyles: FlowchartDocument["linkStyles"] = [],
  ): FlowchartDocument {
    return flowchartDocument({
      nodes: [sirenNode({ id: "A" }), sirenNode({ id: "B" })],
      edges: [
        {
          from: "A",
          to: "B",
          line: "solid",
          fromEnd: "none",
          toEnd: "arrow",
          minLength: 1,
          label: null,
          id: "e1",
          idLine: 2,
          idColumn: 5,
          data: { line: 3, column: 5, ...data },
        },
      ],
      linkStyles,
    });
  }

  it.each([
    [{ animate: true }, "fast"],
    [{ animation: "slow" as const }, "slow"],
    [{ animate: false }, undefined],
    [{ animate: false, animation: "slow" as const }, "slow"],
    [{ animate: true, animation: "slow" as const }, "slow"],
  ])("animates %j as %s", (data, animation) => {
    const { graph, diagnostics } = buildFlowchartModel(withData(data));

    expect(diagnostics).toEqual([]);
    expect(graph.edges[0]!.animation).toBe(animation);
  });

  it("leaves an animated edge no author dash, which the march beats in Mermaid, keeping the rest", () => {
    // Measured in headless Chrome: Mermaid's `stroke-dasharray: 9,5
    // !important` beats `linkStyle 0 stroke-dasharray:2 2`, while the
    // `stroke:#f00` beside it still paints the line.
    const { graph, diagnostics } = buildFlowchartModel(
      withData({ animate: true }, [
        {
          targets: ["0"],
          properties: [
            { property: "stroke-dasharray", value: "2 2" },
            { property: "stroke", value: "#f00" },
          ],
          line: 4,
          column: 1,
        },
      ]),
    );

    expect(diagnostics).toEqual([]);
    expect(graph.edges[0]!.style.frame).toEqual([{ property: "stroke", value: "#f00" }]);
  });

  it.each([
    ["the block alone", 3, [], "linear"],
    ["a linkStyle written before the block", 3, [{ targets: ["0"], interpolate: "step", properties: [], line: 2, column: 1 }], "linear"],
    ["a linkStyle written after the block", 3, [{ targets: ["0"], interpolate: "step", properties: [], line: 4, column: 1 }], "step"],
    ["a linkStyle default written after the block", 3, [{ targets: ["default"], interpolate: "step", properties: [], line: 4, column: 1 }], "linear"],
  ])("draws a `curve: linear` with %s", (_case, line, linkStyles, curve) => {
    const { graph, diagnostics } = buildFlowchartModel(withData({ curve: "linear", line }, linkStyles));

    expect(diagnostics).toEqual([]);
    expect(graph.edges[0]!.curve).toBe(curve);
  });

  it.each([
    ["cardinal", 'The curve "cardinal" is one Siren does not draw yet. Curves: basis, linear, step, stepBefore, stepAfter, rounded.'],
    ["bogus", 'There is no curve "bogus". Curves: basis, linear, step, stepBefore, stepAfter, rounded.'],
  ])("refuses `curve: %s` at the block", (name, message) => {
    const { diagnostics } = buildFlowchartModel(withData({ curve: name }));

    expect(diagnostics).toEqual([{ severity: "error", message, line: 3, column: 5 }]);
  });
});
