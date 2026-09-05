import type {
  Diagnostic,
  ResolvedSequenceBlock,
  ResolvedSequenceBox,
  ResolvedSequenceBranch,
  ResolvedSequenceMessage,
  ResolvedSequenceParticipant,
  ResolvedSequenceStatement,
  SequenceAltStatement,
  SequenceBreakStatement,
  SequenceCriticalStatement,
  SequenceDocument,
  SequenceLoopStatement,
  SequenceModel,
  SequenceModelResult,
  SequenceOptStatement,
  SequenceParStatement,
  SequenceRectStatement,
  SequenceStatement,
} from "../contracts";
import { resolveTimeline } from "./resolveTimeline";

/**
 * A block-kind `SequenceStatement` — everything left once `message`,
 * `participant`, `destroy`, `autonumberOn`, and `autonumberOff` are
 * excluded.
 */
type BlockStatement =
  | SequenceLoopStatement
  | SequenceAltStatement
  | SequenceOptStatement
  | SequenceParStatement
  | SequenceCriticalStatement
  | SequenceBreakStatement
  | SequenceRectStatement;

/**
 * What separates a generated id's kind from its number — `box:1`, `loop:1`,
 * `alt:2`.
 *
 * A colon rather than a `-`, because participants, messages, control-flow
 * blocks and box groupings share one `data-siren-id` space and `-` is
 * already spoken for: a message's id is `${from}-${to}`, so a participant
 * named `box` messaging a participant named `1` produces `box-1` — the same
 * string the first box grouping held. Both `timeline:` addressing and
 * `data-siren-id` were then ambiguous, with no diagnostic to say so.
 *
 * A participant id is `\w+` (the parser's rule), which cannot contain a
 * `:`, so no message id can ever spell one of these. The separator makes
 * the collision structurally impossible rather than merely unlikely, which
 * is why this is a constant with a reason attached and not an incidental
 * `-`. `buildClassModel`'s `ID_SEPARATOR` answers the same question for
 * `namespace:1` and `note:1`.
 *
 * The cost is that an author addressing a block in a `timeline:` block
 * writes `step 1: enter loop:1 fade`. The timeline action grammar takes
 * everything after the step's own colon and splits it on whitespace, so a
 * colon inside the id is read as part of the id.
 */
const ID_SEPARATOR = ":";

/**
 * Mutable resolution state threaded by reference through the whole
 * (recursive) statement tree, so that order-sensitive rules — the
 * explicit-reference rule, message-pair-repeat counting, autonumbering, and
 * block-id counters — operate on the flattened document order rather than
 * resetting at each block boundary. A `participant` statement declared
 * inside a block's body must become visible to later statements anywhere in
 * the document, exactly as a top-level `participant` statement already is.
 */
interface ResolutionState {
  diagnostics: Diagnostic[];
  declaredSoFar: Set<string>;
  seenPairCounts: Map<string, number>;
  blockCounters: Map<string, number>;
  autonumbering: boolean;
  autonumberCounter: number;
  /**
   * Position of the most recently resolved statement — the running counter
   * behind `ResolvedSequenceParticipant.createdAt`/`destroyedAt`.
   *
   * A position is the 1-based index of a statement in a pre-order walk of
   * the *resolved* statement tree (a block takes its position before its
   * body's statements do), so `layoutSequence` can recover the same numbers
   * by walking `model.statements` in order. Only statements that survive
   * into the tree consume one: a dropped message, or an `autonumber` toggle
   * that resolves to no node at all, does not advance the counter.
   *
   * Position 0 is therefore never a statement — it is the diagram's top,
   * where a preamble-declared participant's lifeline begins.
   */
  position: number;
}

/**
 * Resolves a parsed `SequenceDocument` into a validated `SequenceModel`.
 * Built up slice by slice (see buildSequenceModel.test.ts) — this is a
 * placeholder shape being filled in.
 */
export function buildSequenceModel(document: SequenceDocument): SequenceModelResult {
  const diagnostics: Diagnostic[] = [];

  // Every participant starts out with a full-height lifeline — from the
  // diagram's top (position 0) to its bottom (`destroyedAt: null`). The
  // statement walk below narrows that extent in place for the participants
  // that have a `create` or a `destroy` statement: these objects are the
  // same ones the resolved `participant` statements hold by reference, so
  // both views of a participant always agree.
  const participants: ResolvedSequenceParticipant[] = document.participants.map((p) => ({
    id: p.id,
    label: p.label,
    participantKind: p.participantKind,
    origin: "declared",
    createdAt: 0,
    destroyedAt: null,
  }));
  const participantsById = new Map(participants.map((p) => [p.id, p]));

  const state: ResolutionState = {
    diagnostics,
    declaredSoFar: new Set<string>(),
    seenPairCounts: new Map<string, number>(),
    blockCounters: new Map<string, number>(),
    autonumbering: false,
    autonumberCounter: 0,
    position: 0,
  };

  const boxes = resolveBoxes(document, diagnostics);

  const { statements } = resolveStatements(document.statements, participantsById, state);

  // A timeline target is a participant, and only a participant, for now:
  // messages, control-flow blocks and box groupings carry `data-siren-id`
  // too, and widening this set to them is a change of its own (ticket 04).
  // Until then naming one of those ids is the resolver's ordinary
  // unknown-id error, which is the honest answer — the timeline cannot
  // reach them yet.
  //
  // The rules themselves live in `resolveTimeline`, shared with the
  // flowchart and class models. Nothing about dropping an unknown id or
  // keeping the earliest `enter` is sequence-specific, so a third copy of
  // them here would only be a third place for them to drift.
  const timeline = resolveTimeline(
    document.timeline,
    new Set(participants.map((p) => p.id)),
    diagnostics,
  );

  const model: SequenceModel = {
    title: document.title,
    participants,
    boxes,
    statements,
    timeline,
  };

  return { model, diagnostics };
}

/**
 * Resolves the document's `box` groupings to `box:${n}` ids, 1-based in
 * declaration order.
 *
 * Boxes group *declarations*, not statements: they live in the preamble
 * alongside the participant list rather than at a position in the statement
 * tree, so the explicit-reference rule applies to them against the declared
 * participants as a whole, not against the order-sensitive `declaredSoFar`
 * set the statement walk maintains — there is no statement position at
 * which to say a box came "before" a declaration.
 *
 * An unresolvable member is dropped from the box and the box itself kept,
 * the same partial-failure tolerance an invalid message gets: the remaining
 * members still describe a grouping worth rendering.
 */
function resolveBoxes(document: SequenceDocument, diagnostics: Diagnostic[]): ResolvedSequenceBox[] {
  const declaredIds = new Set(document.participants.map((p) => p.id));

  return document.boxes.map((box, index) => {
    const id = `box${ID_SEPARATOR}${index + 1}`;
    const participantIds = box.participantIds.filter((participantId) => {
      if (declaredIds.has(participantId)) return true;
      diagnostics.push({
        severity: "error",
        message: `box "${id}" groups undeclared participant "${participantId}"`,
        line: box.line,
        column: box.column,
      });
      return false;
    });

    return { id, color: box.color, label: box.label, participantIds };
  });
}

function resolveStatements(
  statements: SequenceStatement[],
  participantsById: Map<string, ResolvedSequenceParticipant>,
  state: ResolutionState,
): { statements: ResolvedSequenceStatement[]; touchedParticipantIds: string[] } {
  const resolved: ResolvedSequenceStatement[] = [];
  const touched = new Set<string>();

  for (const statement of statements) {
    if (statement.kind === "autonumberOn") {
      state.autonumbering = true;
      continue;
    }

    if (statement.kind === "autonumberOff") {
      state.autonumbering = false;
      continue;
    }

    if (statement.kind === "participant") {
      // Explicit-reference rule (spec.md Domain decisions: "'earlier'
      // meaning earlier in the flattened statement order") — accumulated
      // incrementally, by mutating the shared `declaredSoFar` set, not
      // pre-seeded from the full document.participants list. This also
      // means a participant declared inside a block body becomes visible
      // to later sibling/parent statements the same way, since the set is
      // threaded by reference through the recursive block walk below.
      state.declaredSoFar.add(statement.id);
      const participant = participantsById.get(statement.id);
      // participantsById is built from the same document.participants list
      // every participant statement's id is drawn from, so this is always
      // found.
      const position = ++state.position;
      // `create participant X` starts the lifeline here rather than at the
      // diagram's top; a plain preamble `participant X` leaves the default
      // full-height extent alone.
      participant!.origin = statement.origin;
      if (statement.origin === "created") participant!.createdAt = position;
      resolved.push({ kind: "participant", participant: participant! });
      continue;
    }

    if (statement.kind === "destroy") {
      // Explicit-reference rule applies to `destroy` too — including to a
      // `create`d participant destroyed above its own `create` statement,
      // since `declaredSoFar` only gains the id at that statement.
      if (!state.declaredSoFar.has(statement.id)) {
        state.diagnostics.push({
          severity: "error",
          message: `destroy references undeclared participant "${statement.id}"`,
          line: statement.line,
          column: statement.column,
        });
        continue;
      }
      // A lifeline can only end once: a second `destroy` has no truncation
      // point left to name, so it is an error and is dropped, keeping the
      // first one's extent.
      const participant = participantsById.get(statement.id)!;
      if (participant.destroyedAt !== null) {
        state.diagnostics.push({
          severity: "error",
          message: `destroy references participant "${statement.id}", whose lifeline already ended`,
          line: statement.line,
          column: statement.column,
        });
        continue;
      }

      // The lifeline stops here instead of running to the diagram's bottom.
      participant.destroyedAt = ++state.position;
      resolved.push({ kind: "destroy", id: statement.id });
      continue;
    }

    if (statement.kind === "message") {
      // Explicit-reference rule: a message referencing a participant id
      // with no earlier `participant`/`create participant` statement is an
      // error diagnostic. That message alone is dropped — everything else
      // still resolves (partial-failure tolerance, matching flowchart's
      // "drop the bad entry, keep going" discipline). Applies the same way
      // whether the message sits at top level or inside a block's body.
      const referencedIds = [...new Set([statement.from, statement.to])];
      const missingIds = referencedIds.filter((id) => !state.declaredSoFar.has(id));
      if (missingIds.length > 0) {
        for (const id of missingIds) {
          state.diagnostics.push({
            severity: "error",
            message: `Message references undeclared participant "${id}"`,
            line: statement.line,
            column: statement.column,
          });
        }
        continue;
      }

      const pairKey = `${statement.from}->${statement.to}`;
      const occurrence = (state.seenPairCounts.get(pairKey) ?? 0) + 1;
      state.seenPairCounts.set(pairKey, occurrence);
      const baseId = `${statement.from}-${statement.to}`;
      const id = occurrence === 1 ? baseId : `${baseId}#${occurrence}`;

      // A message can still name a participant whose lifeline has already
      // been `destroy`ed — the id resolves, but the arrow would touch empty
      // space below the destroy mark. Advisory only, exactly like
      // flowchart's "edge outlives its endpoint" warning: the message is
      // kept, since nothing else can be inferred about what the author
      // meant. The walk is in document order, so any non-null `destroyedAt`
      // here belongs to an earlier statement.
      for (const referencedId of referencedIds) {
        const endsAt = participantsById.get(referencedId)!.destroyedAt;
        if (endsAt === null) continue;
        state.diagnostics.push({
          severity: "warning",
          message:
            `Message "${id}" references participant "${referencedId}", whose lifeline ` +
            `already ended — the arrow points past the destroy mark`,
          line: statement.line,
          column: statement.column,
        });
      }

      if (state.autonumbering) {
        state.autonumberCounter += 1;
      }

      ++state.position;

      const message: ResolvedSequenceMessage = {
        id,
        from: statement.from,
        to: statement.to,
        text: statement.text,
        arrow: statement.arrow,
        autonumber: state.autonumbering ? state.autonumberCounter : null,
      };
      resolved.push({ kind: "message", message });
      touched.add(statement.from);
      touched.add(statement.to);
      continue;
    }

    // Everything left is a block-kind statement (loop/alt/opt/par/critical/
    // break/rect).
    const block = resolveBlock(statement, participantsById, state);
    resolved.push({ kind: "block", block });
    for (const id of block.touchedParticipantIds) touched.add(id);
  }

  return { statements: resolved, touchedParticipantIds: [...touched] };
}

function resolveBlock(
  statement: BlockStatement,
  participantsById: Map<string, ResolvedSequenceParticipant>,
  state: ResolutionState,
): ResolvedSequenceBlock {
  // Block id: `${kind}:${n}` (the separator is `ID_SEPARATOR`, and
  // load-bearing), a 1-based counter per block kind, in document order —
  // assigned here, before recursing into the block's body, so nested blocks
  // (which are walked immediately after, still ahead of this block's later
  // siblings) receive ids that reflect source order across the whole
  // flattened tree, not just within their own nesting level.
  const n = (state.blockCounters.get(statement.kind) ?? 0) + 1;
  state.blockCounters.set(statement.kind, n);
  const id = `${statement.kind}${ID_SEPARATOR}${n}`;

  // Pre-order: the block occupies the position just before its body's
  // statements do.
  ++state.position;

  let branchInputs: Array<{ label: string | null; body: SequenceStatement[] }>;
  switch (statement.kind) {
    case "alt":
    case "par":
    case "critical":
      // alt/par/critical branch labels ("else"/"and"/"option" conditions)
      // pass through unchanged; each branch's body resolves independently
      // (its own nested block-id/participant-reference state is still the
      // shared `state`, since block ids and the explicit-reference rule are
      // both document-order-wide, not branch-scoped).
      branchInputs = statement.branches;
      break;
    case "rect":
      // `rect` isn't a labeled-branch construct like alt/par/critical — it's
      // a single colored-background region with no condition label of its
      // own. ResolvedSequenceBlock/PositionedBlock have no dedicated color
      // field (contracts.ts is frozen for this board), so the color string
      // rides through in this sole branch's `label` slot: layoutSequence
      // copies it straight to PositionedBlock.label, and
      // renderSequenceToSVG (ticket 09) reads it there for `rect`'s fill.
      // Passed through unvalidated, per this ticket's acceptance criteria —
      // validating the color string is rendering's concern.
      branchInputs = [{ label: statement.color, body: statement.body }];
      break;
    default:
      // loop / opt / break: single implicit branch.
      branchInputs = [{ label: statement.label, body: statement.body }];
      break;
  }

  const touched = new Set<string>();
  const branches: ResolvedSequenceBranch[] = branchInputs.map(({ label, body }) => {
    const { statements: resolvedBody, touchedParticipantIds } = resolveStatements(
      body,
      participantsById,
      state,
    );
    for (const participantId of touchedParticipantIds) touched.add(participantId);
    return { label, statements: resolvedBody };
  });

  return {
    id,
    kind: statement.kind,
    touchedParticipantIds: [...touched],
    branches,
  };
}
