import type {
  Diagnostic,
  GraphEdge,
  GraphModel,
  GraphModelResult,
  GraphNode,
  ResolvedTimelineEntry,
  SirenDocument,
} from "../contracts";

/**
 * Resolves a parsed `SirenDocument` into a validated `GraphModel`: assigns
 * stable edge ids, dedupes nodes (first-label-wins), and resolves every
 * `timeline:` reference against real node/edge ids — dropping unresolved
 * entries (with an error diagnostic) rather than failing the whole graph.
 */
export function buildGraphModel(document: SirenDocument): GraphModelResult {
  const diagnostics: Diagnostic[] = [];

  const nodes = resolveNodes(document, diagnostics);
  const edges = assignEdgeIds(document);

  const validTargetIds = new Set<string>([
    ...nodes.map((n) => n.id),
    ...edges.map((e) => e.id),
  ]);

  const { entries, totalSteps } = resolveTimeline(document, validTargetIds, diagnostics);

  const graph: GraphModel = {
    direction: document.direction,
    nodes,
    edges,
    timeline: { totalSteps, entries },
  };

  return { graph, diagnostics };
}

function resolveTimeline(
  document: SirenDocument,
  validTargetIds: Set<string>,
  diagnostics: Diagnostic[],
): { entries: ResolvedTimelineEntry[]; totalSteps: number } {
  const entries: ResolvedTimelineEntry[] = [];
  let totalSteps = 0;

  if (document.timeline === null) {
    return { entries, totalSteps };
  }

  for (const entry of document.timeline.entries) {
    if (!validTargetIds.has(entry.targetId)) {
      diagnostics.push({
        severity: "error",
        message: `timeline: references unknown id "${entry.targetId}"`,
        line: entry.line,
        column: entry.column,
      });
      continue;
    }

    entries.push({
      step: entry.step,
      targetId: entry.targetId,
      effect: entry.effect,
    });

    if (entry.step > totalSteps) {
      totalSteps = entry.step;
    }
  }

  return { entries, totalSteps };
}

function resolveNodes(document: SirenDocument, diagnostics: Diagnostic[]): GraphNode[] {
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

function assignEdgeIds(document: SirenDocument): GraphEdge[] {
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
