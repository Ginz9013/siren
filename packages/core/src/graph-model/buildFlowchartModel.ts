import type {
  Diagnostic,
  FlowchartDocument,
  GraphEdge,
  GraphModel,
  GraphNode,
  ResolvedTimelineEntry,
} from "../contracts";
import { resolveTimeline } from "./resolveTimeline";

/**
 * Resolves a parsed `FlowchartDocument` into a validated `GraphModel`:
 * assigns stable edge ids, dedupes nodes (first-label-wins), and resolves
 * every `timeline:` reference against real node/edge ids — dropping
 * unresolved entries (with an error diagnostic) rather than failing the
 * whole graph.
 *
 * Extracted verbatim from the pre-`kind`-union `buildGraphModel` — zero
 * behavior change, only the parameter type narrowed from `SirenDocument` to
 * `FlowchartDocument` now that `buildGraphModel` dispatches on `kind`. Its
 * own return shape stays flowchart-only (no `model` field) — this module
 * has no reason to know sequence-diagram types exist; the dispatcher
 * (`buildGraphModel`) is what assembles the wider `GraphModelResult`.
 */
export function buildFlowchartModel(
  document: FlowchartDocument,
): { graph: GraphModel; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  const nodes = resolveNodes(document, diagnostics);
  const edges = assignEdgeIds(document);

  const validTargetIds = new Set<string>([
    ...nodes.map((n) => n.id),
    ...edges.map((e) => e.id),
  ]);

  const { entries, totalSteps } = resolveTimeline(document.timeline, validTargetIds, diagnostics);

  warnOnEdgesOutlivingTheirEndpoints(entries, edges, diagnostics);

  const graph: GraphModel = {
    direction: document.direction,
    nodes,
    edges,
    timeline: { totalSteps, entries },
  };

  return { graph, diagnostics };
}

/**
 * Warns when an edge remains visible after a node it connects to has
 * exited — the edge would render pointing at (or from) an invisible
 * endpoint, an arrow with no visible source or target. Advisory only:
 * does not drop the exit action or change what renders, since edge
 * visibility isn't coupled to its endpoints' visibility in renderToSVG.ts
 * — an author who wants the edge gone too must give it its own `exit`.
 * One warning per affected edge, naming whichever endpoint exits first.
 */
function warnOnEdgesOutlivingTheirEndpoints(
  entries: ResolvedTimelineEntry[],
  edges: GraphEdge[],
  diagnostics: Diagnostic[],
): void {
  const edgeIds = new Set(edges.map((e) => e.id));
  const nodeExitStep = new Map<string, number>();
  const edgeExitStep = new Map<string, number>();

  for (const entry of entries) {
    if (entry.kind !== "exit") continue;
    (edgeIds.has(entry.targetId) ? edgeExitStep : nodeExitStep).set(entry.targetId, entry.step);
  }

  for (const edge of edges) {
    const fromExit = nodeExitStep.get(edge.from);
    const toExit = nodeExitStep.get(edge.to);
    if (fromExit === undefined && toExit === undefined) continue;

    const earliestNodeExit = Math.min(
      ...[fromExit, toExit].filter((step): step is number => step !== undefined),
    );
    const endpointId = fromExit === earliestNodeExit ? edge.from : edge.to;

    const edgeExit = edgeExitStep.get(edge.id);
    if (edgeExit !== undefined && edgeExit <= earliestNodeExit) continue;

    diagnostics.push({
      severity: "warning",
      message:
        `timeline: edge "${edge.id}" remains visible after its endpoint "${endpointId}" ` +
        `exits at step ${earliestNodeExit} — add "exit ${edge.id} ..." at or before step ${earliestNodeExit}`,
    });
  }
}

function resolveNodes(document: FlowchartDocument, diagnostics: Diagnostic[]): GraphNode[] {
  const nodesById = new Map<string, GraphNode>();

  for (const node of document.nodes) {
    const existing = nodesById.get(node.id);
    if (existing === undefined) {
      nodesById.set(node.id, { id: node.id, label: node.label });
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
