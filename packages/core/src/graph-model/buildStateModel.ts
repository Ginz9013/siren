import type {
  Diagnostic,
  ResolvedState,
  ResolvedStateTransition,
  StateDocument,
  StateModel,
  StateModelResult,
} from "../contracts";
import { generatedId } from "./generatedId";
import { resolveTimeline } from "./resolveTimeline";

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

  const states = document.states.map<ResolvedState>((state) =>
    state.kind === "state"
      ? // Authored, so `StateDecl.id` is the name the author wrote —
        // non-null by that contract, where only a pseudo-state arrives
        // unnamed.
        { id: state.id!, kind: state.kind }
      : { id: PSEUDO_STATE_IDS[state.kind], kind: state.kind },
  );
  const transitions = assignTransitionIds(document, PSEUDO_STATE_IDS);

  // No `timeline:` block reaches this kind yet — `parseStateDiagram` refuses
  // one, and teaching it the block is the animation ticket's. The call is
  // made against `null` rather than a `{ totalSteps: 0, entries: [] }`
  // literal so that the seam is already the shared resolver's, and so that
  // what a state diagram's valid target ids *are* is written down here
  // rather than discovered later: states and transitions share one id space,
  // exactly as a flowchart's nodes and edges do.
  const timeline = resolveTimeline(
    null,
    new Set([...states.map((state) => state.id), ...transitions.map((t) => t.id)]),
    diagnostics,
  );

  const model: StateModel = { states, transitions, timeline };

  return { model, diagnostics };
}

/**
 * Which level the pseudo-states this stage names belong to.
 *
 * `[*]` is **one start and one end per level** — measured, mermaid 11.17.2:
 * two `[*] -->` lines at one level both came back from the same
 * `root_start`, so it is per level and not per occurrence. A document has
 * exactly one level until a composite state opens a second, and a
 * composite's own `[*]` belongs to *its* level; when that lands, these two
 * constants become a counter per level rather than a different mechanism,
 * which is what `generatedId`'s 1-based `n` is already shaped for.
 */
const ROOT_LEVEL = 1;

/**
 * The ids the root level's two pseudo-states are drawn and addressed under.
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
const PSEUDO_STATE_IDS: Record<"start" | "end", string> = {
  start: generatedId("start", ROOT_LEVEL),
  end: generatedId("end", ROOT_LEVEL),
};

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
 */
function assignTransitionIds(
  document: StateDocument,
  pseudo: Record<"start" | "end", string>,
): ResolvedStateTransition[] {
  const seenPairCounts = new Map<string, number>();

  return document.transitions.map((transition) => {
    // A `null` endpoint is `[*]`, and which pseudo-state it means is the
    // side it was written on: from-side start, to-side end. Measured —
    // they are two different pseudo-states, not one node used twice.
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
