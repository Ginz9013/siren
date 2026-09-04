import type {
  Diagnostic,
  ResolvedSequenceMessage,
  ResolvedSequenceParticipant,
  ResolvedSequenceStatement,
  SequenceDocument,
  SequenceModel,
  SequenceModelResult,
  SequenceStatement,
} from "../contracts";

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
  const declaredIds = new Set(document.participants.map((p) => p.id));

  const statements = resolveStatements(document.statements, declaredIds, participantsById, diagnostics);

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
  declaredIds: Set<string>,
  participantsById: Map<string, ResolvedSequenceParticipant>,
  diagnostics: Diagnostic[],
): ResolvedSequenceStatement[] {
  const resolved: ResolvedSequenceStatement[] = [];
  const seenPairCounts = new Map<string, number>();

  // Autonumbering is a fold over statement order, not a per-statement
  // concept: `autonumberOn`/`autonumberOff` toggle a running flag (and,
  // once on, a monotonic counter that keeps counting across an off/on
  // toggle rather than restarting — the spec only pins down the bare
  // on/off toggle, not restart semantics, so "keep counting" is the least
  // surprising choice). Neither toggle statement has a corresponding
  // `ResolvedSequenceStatement` kind in contracts.ts — their effect is
  // folded entirely into each following message's `autonumber` field
  // ("pass through unchanged, no validation needed") instead of being
  // retained as its own resolved statement.
  let autonumbering = false;
  let autonumberCounter = 0;

  for (const statement of statements) {
    if (statement.kind === "autonumberOn") {
      autonumbering = true;
      continue;
    }

    if (statement.kind === "autonumberOff") {
      autonumbering = false;
      continue;
    }

    if (statement.kind === "participant") {
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
      if (!declaredIds.has(statement.id)) {
        diagnostics.push({
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

    if (statement.kind !== "message") continue;

    // Explicit-reference rule: a message referencing a participant id with
    // no earlier `participant`/`create participant` statement is an error
    // diagnostic. That message alone is dropped — everything else still
    // resolves (partial-failure tolerance, matching flowchart's "drop the
    // bad entry, keep going" discipline).
    const referencedIds = [...new Set([statement.from, statement.to])];
    const missingIds = referencedIds.filter((id) => !declaredIds.has(id));
    if (missingIds.length > 0) {
      for (const id of missingIds) {
        diagnostics.push({
          severity: "error",
          message: `Message references undeclared participant "${id}"`,
          line: statement.line,
          column: statement.column,
        });
      }
      continue;
    }

    const pairKey = `${statement.from}->${statement.to}`;
    const occurrence = (seenPairCounts.get(pairKey) ?? 0) + 1;
    seenPairCounts.set(pairKey, occurrence);
    const baseId = `${statement.from}-${statement.to}`;
    const id = occurrence === 1 ? baseId : `${baseId}#${occurrence}`;

    if (autonumbering) {
      autonumberCounter += 1;
    }

    const message: ResolvedSequenceMessage = {
      id,
      from: statement.from,
      to: statement.to,
      text: statement.text,
      arrow: statement.arrow,
      autonumber: autonumbering ? autonumberCounter : null,
    };
    resolved.push({ kind: "message", message });
  }

  return resolved;
}
