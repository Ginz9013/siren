import type {
  Diagnostic,
  ResolvedStateTransition,
  StateDocument,
  StateModel,
  StateModelResult,
} from "../contracts";
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
 * *identification*: giving each transition an id.
 *
 * Problems come back as diagnostics rather than exceptions, the same
 * partial-failure tolerance every other `build*Model` applies.
 */
export function buildStateModel(document: StateDocument): StateModelResult {
  const diagnostics: Diagnostic[] = [];

  const transitions = assignTransitionIds(document);

  // No `timeline:` block reaches this kind yet — `parseStateDiagram` refuses
  // one, and teaching it the block is the animation ticket's. The call is
  // made against `null` rather than a `{ totalSteps: 0, entries: [] }`
  // literal so that the seam is already the shared resolver's, and so that
  // what a state diagram's valid target ids *are* is written down here
  // rather than discovered later: states and transitions share one id space,
  // exactly as a flowchart's nodes and edges do.
  const timeline = resolveTimeline(
    null,
    new Set([...document.states.map((state) => state.id), ...transitions.map((t) => t.id)]),
    diagnostics,
  );

  const model: StateModel = {
    states: document.states.map((state) => ({ id: state.id })),
    transitions,
    timeline,
  };

  return { model, diagnostics };
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
 */
function assignTransitionIds(document: StateDocument): ResolvedStateTransition[] {
  const seenPairCounts = new Map<string, number>();

  return document.transitions.map((transition) => {
    const pairKey = `${transition.from}->${transition.to}`;
    const occurrence = (seenPairCounts.get(pairKey) ?? 0) + 1;
    seenPairCounts.set(pairKey, occurrence);
    const baseId = `${transition.from}-${transition.to}`;

    return {
      id: occurrence === 1 ? baseId : `${baseId}#${occurrence}`,
      from: transition.from,
      to: transition.to,
      label: transition.label,
    };
  });
}
