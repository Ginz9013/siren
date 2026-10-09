import type {
  Diagnostic,
  NamedTimeline,
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
  // The `:` here is a Map key separator and nothing more -- unrelated to the
  // `:` that separates a generated id's kind from its number (`loop:1`). It is
  // unambiguous because `TimelineActionKind` is four colon-free verbs.
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

/**
 * Warns when a connector remains visible after an endpoint it joins has
 * exited — a line left drawn from or into empty space.
 *
 * A connector is anything joining two ids: a flowchart edge, a class
 * relationship, a sequence message. `connectorNoun` is the word for the one
 * at hand (`"edge"`, `"relationship"`, `"message"`) and is the only thing
 * that differed between the three copies this replaces — the rule, the
 * tie-break and the wording were already identical, which is why they are
 * written here once.
 *
 * The premise is the same for all three kinds and is what makes the warning
 * necessary rather than merely tidy: every renderer gives a connector its
 * own group and its own `data-siren-id`, and `createAnimationController`
 * toggles each target independently (ADR-0009), so nothing anywhere hides a
 * connector because an endpoint it touches went away.
 *
 * Advisory only: nothing is dropped and the diagram still renders exactly as
 * authored. An author who wants the connector gone must give it its own
 * `exit` — and once they have, at or before the endpoint's step, the warning
 * goes quiet. One warning per affected connector, naming whichever endpoint
 * leaves first.
 */
export function warnOnConnectorsOutlivingTheirEndpoints(
  entries: readonly ResolvedTimelineEntry[],
  connectors: readonly { id: string; from: string; to: string }[],
  connectorNoun: string,
  diagnostics: Diagnostic[],
): void {
  // An `exit` names either a connector or something else; only a connector's
  // own exit can excuse it, and only a non-connector's exit can strand it, so
  // the two are kept apart. Everything that is not a connector counts as a
  // potential endpoint — a target that is neither is simply never looked up.
  const connectorIds = new Set(connectors.map((connector) => connector.id));
  const endpointExitStep = new Map<string, number>();
  const connectorExitStep = new Map<string, number>();

  for (const entry of entries) {
    if (entry.kind !== "exit") continue;
    (connectorIds.has(entry.targetId) ? connectorExitStep : endpointExitStep).set(
      entry.targetId,
      entry.step,
    );
  }

  for (const connector of connectors) {
    const fromExit = endpointExitStep.get(connector.from);
    const toExit = endpointExitStep.get(connector.to);
    if (fromExit === undefined && toExit === undefined) continue;

    // The step the connector has to be gone by is the earlier of its two
    // endpoints' exits, so that is the one the warning names. An exact tie
    // keeps `from`, arbitrarily but stably.
    const earliestEndpointExit = Math.min(
      ...[fromExit, toExit].filter((step): step is number => step !== undefined),
    );
    const endpointId = fromExit === earliestEndpointExit ? connector.from : connector.to;

    const connectorExit = connectorExitStep.get(connector.id);
    if (connectorExit !== undefined && connectorExit <= earliestEndpointExit) continue;

    diagnostics.push({
      severity: "warning",
      message:
        `timeline: ${connectorNoun} "${connector.id}" remains visible after its endpoint ` +
        `"${endpointId}" exits at step ${earliestEndpointExit} — add ` +
        `"exit ${connector.id} ..." at or before step ${earliestEndpointExit}`,
    });
  }
}

/** The connectors a kind draws, and the word its diagnostics call one by. */
export interface TimelineConnectors {
  connectors: readonly { id: string; from: string; to: string }[];
  noun: string;
}

/** Every block a model resolved, ready for `render()` to choose from. */
export interface ResolvedTimelineBlocks {
  /**
   * The block `render()` applies by default: the unnamed one, or else the
   * first named one, or else an empty timeline.
   */
  timeline: ResolvedTimeline;
  /**
   * Every named block, resolved, in document order — absent, not empty, when
   * there are none, so that a model spreading this in carries exactly the
   * fields it always did for a document without named blocks.
   */
  namedTimelines?: NamedTimeline<ResolvedTimeline>[];
}

/**
 * Resolves every timeline block a document declares, each on its own, and
 * warns about connectors outliving their endpoints within each.
 *
 * Each block is a timeline in its own right: its steps, its step 0, its
 * enter/exit dedupe and its connector warnings look only inside it, so a
 * named block resolves exactly as it would if it were the document's only
 * one. That is why this is a loop over `resolveTimeline` rather than a
 * second set of rules.
 *
 * Every block is resolved whichever one will be played, so choosing a
 * timeline never makes a problem appear or vanish. What a named block adds is
 * only its name in the messages it raises — `timeline card:` instead of
 * `timeline:` — since two blocks can now say the same thing about the same id
 * and the line number alone no longer says which path the author was
 * writing. An unnamed document's messages are untouched.
 */
export function resolveTimelineBlocks(
  blocks: {
    timeline: SirenTimeline | null;
    namedTimelines?: readonly NamedTimeline<SirenTimeline>[];
  },
  validTargetIds: ReadonlySet<string>,
  { connectors, noun }: TimelineConnectors,
  diagnostics: Diagnostic[],
): ResolvedTimelineBlocks {
  const resolveOne = (timeline: SirenTimeline | null, into: Diagnostic[]): ResolvedTimeline => {
    const resolved = resolveTimeline(timeline, validTargetIds, into);
    warnOnConnectorsOutlivingTheirEndpoints(resolved.entries, connectors, noun, into);
    return resolved;
  };

  const unnamed = resolveOne(blocks.timeline, diagnostics);

  const namedTimelines = (blocks.namedTimelines ?? []).map(({ name, timeline }) => {
    const blockDiagnostics: Diagnostic[] = [];
    const resolved = resolveOne(timeline, blockDiagnostics);
    for (const diagnostic of blockDiagnostics) {
      diagnostics.push({ ...diagnostic, message: namedMessage(diagnostic.message, name) });
    }
    return { name, timeline: resolved };
  });

  const timeline =
    blocks.timeline === null && namedTimelines.length > 0 ? namedTimelines[0].timeline : unnamed;

  return namedTimelines.length > 0 ? { timeline, namedTimelines } : { timeline };
}

/**
 * Rewrites the `timeline:` every resolution message opens with to name its
 * block. A prefix swap rather than a `name` parameter threaded through the two
 * resolvers, so the unnamed wording has one spelling and the named one is
 * derived from it rather than kept in step with it by hand.
 */
function namedMessage(message: string, name: string): string {
  return message.startsWith(UNNAMED_PREFIX)
    ? `timeline ${name}:${message.slice(UNNAMED_PREFIX.length)}`
    : message;
}

const UNNAMED_PREFIX = "timeline:";
