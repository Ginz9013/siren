import type {
  Diagnostic,
  ResolvedSequenceBlock,
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
}

/**
 * Resolves a parsed `SequenceDocument` into a validated `SequenceModel`.
 * Built up slice by slice (see buildSequenceModel.test.ts) — this is a
 * placeholder shape being filled in.
 */
export function buildSequenceModel(document: SequenceDocument): SequenceModelResult {
  const diagnostics: Diagnostic[] = [];

  // No `create` statements exist at this ticket's parser support level, so
  // every declared participant resolves with the same origin and a
  // full-height lifeline extent. Tickets 07/12 extend this to compute the
  // truncated-extent cases once create/destroy parsing exists.
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
  };

  const { statements } = resolveStatements(document.statements, participantsById, state);

  const model: SequenceModel = {
    title: document.title,
    participants,
    boxes: [],
    statements,
  };

  return { model, diagnostics };
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
      resolved.push({ kind: "participant", participant: participant! });
      continue;
    }

    if (statement.kind === "destroy") {
      // Explicit-reference rule applies to `destroy` too. This ticket's
      // parser support level never produces `destroy` statements, but the
      // type surface already includes them (frozen for the whole board),
      // and ticket 12 extends this branch to actually truncate the
      // participant's lifeline extent.
      if (!state.declaredSoFar.has(statement.id)) {
        state.diagnostics.push({
          severity: "error",
          message: `destroy references undeclared participant "${statement.id}"`,
          line: statement.line,
          column: statement.column,
        });
        continue;
      }
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

      if (state.autonumbering) {
        state.autonumberCounter += 1;
      }

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
  // Block id: `${kind}-${n}`, a 1-based counter per block kind, in document
  // order — assigned here, before recursing into the block's body, so
  // nested blocks (which are walked immediately after, still ahead of this
  // block's later siblings) receive ids that reflect source order across
  // the whole flattened tree, not just within their own nesting level.
  const n = (state.blockCounters.get(statement.kind) ?? 0) + 1;
  state.blockCounters.set(statement.kind, n);
  const id = `${statement.kind}-${n}`;

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
