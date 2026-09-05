import type {
  Diagnostic,
  ResolvedTimeline,
  ResolvedTimelineEntry,
  SirenTimeline,
  TimelineEntry,
} from "../contracts";

/**
 * Resolves a `timeline:` block against the ids a model just assigned: drops
 * entries naming an id nothing holds (with an error diagnostic), keeps one
 * `enter`/`exit` per target, and rejects an action addressed to a target
 * that is not visible yet. Problems come back as diagnostics rather than
 * exceptions — a bad entry costs itself and not the rest of the timeline.
 *
 * Written once and shared by every diagram kind that animates, because its
 * inputs are kind-agnostic: a raw `SirenTimeline` and a set of valid ids.
 * Nothing here looks at a node, a class or a participant, so a flowchart, a
 * class diagram and a sequence diagram get the identical rules rather than
 * three copies that drift apart one tie-break at a time.
 *
 * `parseTimelineBlock` is the precedent and the reason this works: ADR-0002
 * puts the timeline in a block of its own, deliberately separate from the
 * diagram's structural definition, so the block names ids and verbs and
 * knows nothing about the statements above it. The grammar was shareable
 * for that reason, and so are the rules applied to what it parsed.
 *
 * Lifted verbatim from the near-identical copies in `buildFlowchartModel`
 * and `buildClassModel`, which now call it: no behavior change for either
 * kind. The two differed only in spelling the visible-before check
 * `kind === "highlight" || kind === "exit" || kind === "unhighlight"` versus
 * `kind !== "enter"` — the same test over a four-verb union.
 */
export function resolveTimeline(
  timeline: SirenTimeline | null,
  validTargetIds: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): ResolvedTimeline {
  const entries: ResolvedTimelineEntry[] = [];
  let totalSteps = 0;

  if (timeline === null) {
    return { totalSteps, entries };
  }

  // Which `enter`/`exit` survives for each target: the numerically earliest
  // step, regardless of the order the actions were written in — `next()` and
  // `prev()` walk the timeline in step order, so "first" has to mean first in
  // time. A tie keeps whichever was declared first.
  const winnerByDedupeKey = new Map<string, TimelineEntry>();
  for (const entry of timeline.entries) {
    if (entry.kind !== "enter" && entry.kind !== "exit") continue;
    if (!validTargetIds.has(entry.targetId)) continue;

    const dedupeKey = `${entry.kind}:${entry.targetId}`;
    const current = winnerByDedupeKey.get(dedupeKey);
    if (current === undefined || entry.step < current.step) {
      winnerByDedupeKey.set(dedupeKey, entry);
    }
  }

  const kept: TimelineEntry[] = [];

  for (const entry of timeline.entries) {
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

  // When each target becomes visible: its own kept `enter` step, or 0 for one
  // that is never entered and so is on screen from the start. An action
  // before that moment addresses something the reader cannot see.
  const visibleAtStep = new Map<string, number>();
  for (const entry of kept) {
    if (entry.kind === "enter") {
      visibleAtStep.set(entry.targetId, entry.step);
    }
  }

  for (const entry of kept) {
    if (entry.kind !== "enter") {
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

  return { totalSteps, entries };
}
