import type {
  Diagnostic,
  ResolvedState,
  ResolvedStateTransition,
  StateDocument,
  StateModel,
  StateModelResult,
} from "../contracts";
import { generatedId } from "./generatedId";
import {
  resolveTimeline,
  warnOnConnectorsOutlivingTheirEndpoints,
} from "./resolveTimeline";

/**
 * Resolves a parsed `StateDocument` into a validated `StateModel`: every
 * transition given the id the renderer addresses it by, and the states
 * carried through as the parser declared them.
 *
 * The division of labour with the parser is the same one the class diagram
 * draws, minus the part a state has no need of. The parser *declares* — a
 * state named only by a transition is declared by that mention, and repeat
 * mentions are already folded there, because a state is a name and a
 * position with no payload for this stage to merge. So what is left here is
 * *identification*: giving each transition an id, and giving the two
 * pseudo-states `[*]` spells the generated ids the author never wrote —
 * which is this stage's rather than the parser's for the reason a
 * subgraph's `subgraph:1` is `buildFlowchartModel`'s (ADR-0010).
 *
 * Problems come back as diagnostics rather than exceptions, the same
 * partial-failure tolerance every other `build*Model` applies.
 */
export function buildStateModel(document: StateDocument): StateModelResult {
  const diagnostics: Diagnostic[] = [];

  const pseudoIdsByLevel = pseudoStateIds(document);

  const states = document.states.map<ResolvedState>((state) =>
    state.id !== null
      ? // Authored — a state or a composite — so `StateDecl.id` is the name
        // the author wrote, non-null by that contract, where only a
        // pseudo-state arrives unnamed. Descriptions, membership and a
        // composite's own direction pass through as written: they are
        // authored, and there is nothing here to resolve about them.
        {
          id: state.id,
          kind: state.kind,
          descriptions: state.descriptions,
          parentId: state.parentId,
          direction: state.direction,
        }
      : // A pseudo-state carries no descriptions and can carry none — `[*]`
        // is not an id, so no description statement can name one — and no
        // direction, because only a composite has a block to write one in.
        // What it does carry is its level, which is what chooses its id.
        {
          id: pseudoIdsByLevel.get(state.parentId)![state.kind as "start" | "end"],
          kind: state.kind,
          descriptions: [],
          parentId: state.parentId,
          direction: null,
        },
  );
  const transitions = assignTransitionIds(document, pseudoIdsByLevel);

  // States and transitions share one id space, exactly as a flowchart's
  // nodes and edges do, so an author animates any element of the diagram the
  // same way and the shared resolver never has to learn which kind of element
  // an id belongs to. Three of the kind's four addressable things need no
  // entry of their own here: a **composite** is a state (it is in
  // `states`, wearing the author's own name — unlike a flowchart subgraph,
  // whose id has to be minted), and so is a **pseudo-state**, which arrives
  // here already carrying the generated id assigned above.
  const timeline = resolveTimeline(
    document.timeline,
    new Set([...states.map((state) => state.id), ...transitions.map((t) => t.id)]),
    diagnostics,
  );

  // A transition is a connector — two ids joined by a drawn line — so the
  // rule that already covers a flowchart edge, a class relationship and a
  // sequence message covers it, called rather than copied. Advisory only:
  // nothing is dropped, and an author who gives the transition its own
  // `exit` silences it.
  warnOnConnectorsOutlivingTheirEndpoints(
    timeline.entries,
    transitions,
    "transition",
    diagnostics,
  );

  const model: StateModel = { states, transitions, timeline };

  return { model, diagnostics };
}

/**
 * The level number the document's own level is given — the first, so that
 * `[*]` written at the top of a diagram with no composite in it is
 * `start:1` / `end:1`, exactly as before composites existed.
 */
const ROOT_LEVEL = 1;

/**
 * The ids each level's two pseudo-states are drawn and addressed under, by
 * the composite that opens the level — `null` for the document's own.
 *
 * `[*]` is **one start and one end per level** — measured, mermaid 11.17.2:
 * two `[*] -->` lines at one level both came back from the same
 * `root_start`, so it is per level and not per occurrence, and a composite
 * state opens a level of its own (`state Outer { [*] --> Inner }` reports
 * `Outer_start`, not `root_start`).
 *
 * Levels are numbered in the order they are *declared* — the document's
 * first, then each composite in the order `StateDocument.states` names it,
 * which is the order an author reading down the page meets them. A level
 * with no `[*]` in it still takes its number; the numbers are handles, and a
 * gap in them costs nothing, while renumbering to close one would mean a
 * composite's `[*]` changing its id because an unrelated block lost its own.
 *
 * `n` is `generatedId`'s 1-based counter, which is what this was always
 * shaped for.
 *
 * **This is a deliberate divergence from Mermaid, and it removes a bug of
 * Mermaid's.** Mermaid names these `root_start` and `root_end` — ordinary
 * `\w+` names an author can also write, and it does not guard the
 * collision. Measured, 11.17.2:
 *
 *     stateDiagram-v2
 *       [*] --> root_start
 *       root_start --> B
 *
 * means "start → a state called `root_start` → B", three nodes and two
 * edges. Mermaid produces two nodes and the relations
 * `root_start → root_start` and `root_start → B`: the start pseudo-state is
 * swallowed by the author's own state, and its edge is redirected into a
 * self-loop nobody wrote — with no diagnostic. (A self-loop is a perfectly
 * good construct; the bug is the pseudo-state disappearing into one.)
 *
 * `generatedId` (ADR-0010) spells these `start:1` / `end:1`, and every
 * authored id is `\w+`, which cannot contain a colon. So the collision is
 * not guarded against here — it is unconstructible, exactly as it is for a
 * flowchart subgraph's id, and for the same reason.
 */
function pseudoStateIds(
  document: StateDocument,
): Map<string | null, Record<"start" | "end", string>> {
  const byLevel = new Map<string | null, Record<"start" | "end", string>>();

  const openLevel = (parentId: string | null): void => {
    if (byLevel.has(parentId)) {
      return;
    }
    const n = byLevel.size + ROOT_LEVEL;
    byLevel.set(parentId, { start: generatedId("start", n), end: generatedId("end", n) });
  };

  // The document's own level first, so a diagram with no composite in it
  // keeps the `start:1` / `end:1` it has always had.
  openLevel(null);
  for (const state of document.states) {
    if (state.kind === "composite") {
      openLevel(state.id);
    }
  }

  return byLevel;
}

/**
 * Gives every transition the id the renderer addresses it by:
 * `${from}-${to}`, then `#2`, `#3`, ... for repeats of the same ordered
 * pair. The third use of the convention flowchart edges and class
 * relationships already share, copied rather than reinvented so that one
 * timeline vocabulary keeps addressing every diagram kind.
 *
 * A self-transition (`A --> A`) needs no special case: it is an ordinary
 * ordered pair whose two halves happen to be the same state, so it is
 * `A-A`, and a second one is `A-A#2`.
 *
 * Nor does a pseudo-state endpoint: `[*]` arrives as a `null` side, is
 * resolved to that level's generated id first, and is then an ordered pair
 * like any other — `start:1-Idle`, `Idle-end:1`, `start:1-end:1`. The
 * colon inside those ids is what keeps them out of the connector space
 * (ADR-0010), so no such id can also be `${from}-${to}` for two states the
 * author named.
 *
 * *Which* level's is decided by `StateTransition.parentId` — the block the
 * line was written in — and by nothing else, because that is the only thing
 * that tells one level's `[*]` from another's.
 */
function assignTransitionIds(
  document: StateDocument,
  pseudoIdsByLevel: ReadonlyMap<string | null, Record<"start" | "end", string>>,
): ResolvedStateTransition[] {
  const seenPairCounts = new Map<string, number>();

  return document.transitions.map((transition) => {
    // A `null` endpoint is `[*]`, and which pseudo-state it means is the
    // side it was written on: from-side start, to-side end. Measured —
    // they are two different pseudo-states, not one node used twice.
    const pseudo = pseudoIdsByLevel.get(transition.parentId)!;
    const from = transition.from ?? pseudo.start;
    const to = transition.to ?? pseudo.end;

    const pairKey = `${from}->${to}`;
    const occurrence = (seenPairCounts.get(pairKey) ?? 0) + 1;
    seenPairCounts.set(pairKey, occurrence);
    const baseId = `${from}-${to}`;

    return {
      id: occurrence === 1 ? baseId : `${baseId}#${occurrence}`,
      from,
      to,
      label: transition.label,
    };
  });
}
