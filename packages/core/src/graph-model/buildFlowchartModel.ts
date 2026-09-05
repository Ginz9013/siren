import type {
  Diagnostic,
  FlowchartDocument,
  GraphEdge,
  GraphModel,
  GraphNode,
} from "../contracts";
import { resolveStyles } from "./resolveStyles";
import { resolveTimeline, warnOnConnectorsOutlivingTheirEndpoints } from "./resolveTimeline";

/**
 * Resolves a parsed `FlowchartDocument` into a validated `GraphModel`:
 * assigns stable edge ids, dedupes nodes (first-label-wins), and resolves
 * every `timeline:` reference against real node/edge ids — dropping
 * unresolved entries (with an error diagnostic) rather than failing the
 * whole graph.
 *
 * Author styling is resolved by the shared `resolveStyles`, not here: the
 * rules for what a declaration means, and the gate ADR-0008 calls the
 * board's security boundary for styling, are written once and read by every
 * diagram kind. What is flowchart-specific is only *which ids exist* — its
 * nodes — and that is the argument this function passes.
 *
 * Its own return shape stays flowchart-only (no `model` field) — this module
 * has no reason to know sequence-diagram types exist; the dispatcher
 * (`buildGraphModel`) is what assembles the wider `GraphModelResult`.
 */
export function buildFlowchartModel(
  document: FlowchartDocument,
): { graph: GraphModel; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  const nodes = resolveNodes(document, diagnostics);
  const edges = assignEdgeIds(document);

  // Every styling statement a flowchart can write — `style`, `classDef`, and
  // the apply-directive in both its `class` and its `:::` spelling — names a
  // node. An edge is addressed by `linkStyle`, by declaration index, which
  // this document cannot yet write — so an edge id here is an id no styling
  // statement accepts, and the shared resolver says so in the same words it
  // says it to a class diagram.
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const { targetId, properties } of resolveStyles(
    document.styles,
    new Set(nodeById.keys()),
    diagnostics,
  )) {
    // Every id `resolveStyles` returns is one it was handed, so this cannot
    // miss; a node nothing styled keeps the empty list it was built with.
    nodeById.get(targetId)!.style = properties;
  }

  const validTargetIds = new Set<string>([
    ...nodes.map((n) => n.id),
    ...edges.map((e) => e.id),
  ]);

  const { entries, totalSteps } = resolveTimeline(document.timeline, validTargetIds, diagnostics);

  warnOnConnectorsOutlivingTheirEndpoints(entries, edges, "edge", diagnostics);

  const graph: GraphModel = {
    direction: document.direction,
    nodes,
    edges,
    timeline: { totalSteps, entries },
  };

  return { graph, diagnostics };
}

function resolveNodes(document: FlowchartDocument, diagnostics: Diagnostic[]): GraphNode[] {
  const nodesById = new Map<string, GraphNode>();

  for (const node of document.nodes) {
    const existing = nodesById.get(node.id);
    if (existing === undefined) {
      nodesById.set(node.id, { id: node.id, label: node.label, style: [] });
      continue;
    }
    if (existing.label !== node.label) {
      diagnostics.push({
        severity: "warning",
        message: `Node "${node.id}" is declared with conflicting labels ("${existing.label}" vs. "${node.label}"); keeping the first-seen label.`,
        line: node.line,
        column: node.column,
      });
    }
  }

  return [...nodesById.values()];
}

function assignEdgeIds(document: FlowchartDocument): GraphEdge[] {
  const seenPairCounts = new Map<string, number>();

  return document.edges.map((edge) => {
    const pairKey = `${edge.from}->${edge.to}`;
    const occurrence = (seenPairCounts.get(pairKey) ?? 0) + 1;
    seenPairCounts.set(pairKey, occurrence);

    const baseId = `${edge.from}-${edge.to}`;
    const id = occurrence === 1 ? baseId : `${baseId}#${occurrence}`;

    return { id, from: edge.from, to: edge.to };
  });
}
