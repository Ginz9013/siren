import { describe, expect, it } from "vitest";
import type { FlowchartDocument, SirenNode } from "../contracts";
import { buildFlowchartModel } from "./buildFlowchartModel";

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
  return { label: overrides.id, labelRuns: null, shape: "rect", ...overrides };
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
    expect(graph).not.toBeNull();
    const byId = Object.fromEntries(graph!.nodes.map((n) => [n.id, n]));
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
    expect(graph!.nodes[0].interaction).toEqual({
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

    expect(graph).not.toBeNull();
    expect(graph!.nodes[0].interaction).toBeNull();
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

    expect(graph!.nodes[0].interaction).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/disallowed URL scheme/);
  });

  it("leaves a node with no click statement at all carrying a null interaction", () => {
    const { graph } = buildFlowchartModel(
      flowchartDocument({ nodes: [sirenNode({ id: "A" })] }),
    );

    expect(graph!.nodes[0].interaction).toBeNull();
  });
});

describe("buildFlowchartModel's labelRuns", () => {
  it("carries a node's Markdown label runs through unchanged", () => {
    const labelRuns = [[{ text: "bold", bold: true, italic: false }]];
    const { graph } = buildFlowchartModel(
      flowchartDocument({
        nodes: [sirenNode({ id: "A", label: "bold", labelRuns })],
      }),
    );

    expect(graph!.nodes[0].labelRuns).toEqual(labelRuns);
  });

  it("leaves an ordinary node's labelRuns null", () => {
    const { graph } = buildFlowchartModel(
      flowchartDocument({ nodes: [sirenNode({ id: "A" })] }),
    );

    expect(graph!.nodes[0].labelRuns).toBeNull();
  });
});

describe("buildFlowchartModel's accTitle/accDescr", () => {
  it("carries accTitle and accDescr through unchanged", () => {
    const { graph } = buildFlowchartModel(
      flowchartDocument({ accTitle: "A short title", accDescr: "A longer description" }),
    );

    expect(graph!.accTitle).toBe("A short title");
    expect(graph!.accDescr).toBe("A longer description");
  });

  it("leaves accTitle and accDescr null when the document carries neither", () => {
    const { graph } = buildFlowchartModel(flowchartDocument());

    expect(graph!.accTitle).toBeNull();
    expect(graph!.accDescr).toBeNull();
  });
});
