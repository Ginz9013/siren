import type {
  Diagnostic,
  GraphEdge,
  GraphModel,
  GraphModelResult,
  GraphNode,
  ResolvedTimelineEntry,
  SirenDocument,
  TimelineEntry,
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

  // Pass 1: drop unknown-id entries, and dedupe enter/exit (the numerically
  // earliest step wins, regardless of source declaration order — next()/
  // prev() always walk entries in step order, so "first" must mean "first
  // in time," not "first line in the file." Ties on the same step keep
  // whichever was declared first.)
  const winnerByDedupeKey = new Map<string, TimelineEntry>();
  for (const entry of document.timeline.entries) {
    if (entry.kind !== "enter" && entry.kind !== "exit") continue;
    if (!validTargetIds.has(entry.targetId)) continue;

    const dedupeKey = `${entry.kind}:${entry.targetId}`;
    const current = winnerByDedupeKey.get(dedupeKey);
    if (current === undefined || entry.step < current.step) {
      winnerByDedupeKey.set(dedupeKey, entry);
    }
  }

  const kept: TimelineEntry[] = [];

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

    if (entry.kind === "enter" || entry.kind === "exit") {
      const dedupeKey = `${entry.kind}:${entry.targetId}`;
      if (winnerByDedupeKey.get(dedupeKey) !== entry) {
        diagnostics.push({
          severity: "warning",
          message: `timeline: "${entry.targetId}" already has a "${entry.kind}" action; keeping the earliest-step occurrence.`,
          line: entry.line,
          column: entry.column,
        });
        continue;
      }
    }

    kept.push(entry);
  }

  // Pass 2: compute each target's "becomes visible at step" — its own kept
  // `enter` step, or 0 if it's never entered — and reject any
  // highlight/exit/unhighlight action whose step comes before that.
  const visibleAtStep = new Map<string, number>();
  for (const entry of kept) {
    if (entry.kind === "enter") {
      visibleAtStep.set(entry.targetId, entry.step);
    }
  }

  for (const entry of kept) {
    if (entry.kind === "highlight" || entry.kind === "exit" || entry.kind === "unhighlight") {
      const visibleStep = visibleAtStep.get(entry.targetId) ?? 0;
      if (entry.step < visibleStep) {
        diagnostics.push({
          severity: "error",
          message: `timeline: "${entry.kind}" on "${entry.targetId}" at step ${entry.step} comes before it becomes visible (step ${visibleStep})`,
          line: entry.line,
          column: entry.column,
        });
        continue;
      }
    }

    entries.push({
      kind: entry.kind,
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
