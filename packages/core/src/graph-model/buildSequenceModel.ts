import type {
  Diagnostic,
  Label,
  ResolvedSequenceBlock,
  ResolvedSequenceBox,
  ResolvedSequenceBranch,
  ResolvedSequenceMessage,
  ResolvedSequenceNote,
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
import { plainLabel } from "../label/label";
import { generatedId } from "./generatedId";
import { resolveInteractions } from "./resolveInteractions";
import { resolveTimeline, warnOnConnectorsOutlivingTheirEndpoints } from "./resolveTimeline";

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
 * (recursive) statement tree, so that order-sensitive rules — lane order by
 * first mention, message-pair-repeat counting, autonumbering, and block-id
 * counters — operate on the flattened document order rather than resetting
 * at each block boundary. A participant first named inside a block's body
 * takes its lane there, exactly as a top-level first mention does.
 */
interface ResolutionState {
  diagnostics: Diagnostic[];
  /** Every participant id some statement has named so far (ADR-0013). */
  mentionedSoFar: Set<string>;
  /**
   * Every participant id in the order it was first named — by a declaration
   * or by any statement referring to it. This is the lane order: Mermaid
   * places a lane where its participant is first mentioned.
   */
  mentionOrder: string[];
  seenPairCounts: Map<string, number>;
  blockCounters: Map<string, number>;
  /** How many activations are currently open on each participant's lifeline — the validity check `deactivate` needs. */
  openActivationCounts: Map<string, number>;
  /** 1-based counter behind `generatedId("activation", n)`, one shared sequence across every participant. */
  activationCounter: number;
  /** 1-based counter behind `generatedId("note", n)`. */
  noteCounter: number;
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

  // A `link` targets a participant, not a message or a block — the same
  // narrower set `click`/`callback` resolve against on the other two kinds.
  const interactions = resolveInteractions(
    document.interactions,
    new Set(participants.map((p) => p.id)),
    diagnostics,
  );

  const state: ResolutionState = {
    diagnostics,
    mentionedSoFar: new Set<string>(),
    mentionOrder: [],
    seenPairCounts: new Map<string, number>(),
    blockCounters: new Map<string, number>(),
    openActivationCounts: new Map<string, number>(),
    activationCounter: 0,
    noteCounter: 0,
    autonumbering: false,
    autonumberCounter: 0,
    position: 0,
  };

  const boxes = resolveBoxes(document, diagnostics);

  const { statements } = resolveStatements(document.statements, participantsById, state);

  // Lanes in first-mention order. A declared participant no statement names
  // (only a hand-built document can have one) keeps its place after them.
  const mentioned = new Set(state.mentionOrder);
  const lanes = [
    ...state.mentionOrder.map((id) => participantsById.get(id)!),
    ...participants.filter((p) => !mentioned.has(p.id)),
  ];
  participants.splice(0, participants.length, ...lanes);

  // A timeline target is a participant, a message, a control-flow block, a
  // box grouping, a note or an activation bar — exactly the six things
  // `renderSequenceToSVG` stamps `data-siren-id` on, and so exactly the
  // things an author can see and might want to animate. A destroy mark is not
  // a seventh: it carries its participant's id, so it moves with the
  // participant (ADR-0009).
  //
  // The rules themselves live in `resolveTimeline`, shared with the
  // flowchart and class models. Nothing about dropping an unknown id or
  // keeping the earliest `enter` is sequence-specific, so a third copy of
  // them here would only be a third place for them to drift.
  const validTargetIds = new Set(participants.map((p) => p.id));
  for (const box of boxes) validTargetIds.add(box.id);
  collectStatementIds(statements, validTargetIds);

  const timeline = resolveTimeline(document.timeline, validTargetIds, diagnostics);

  // A message is the sequence diagram's connector and its endpoints are the
  // two participants it joins, so the rule flowchart applies to an edge and
  // class applies to a relationship applies here unchanged — one arrow left
  // pointing at a lane that has animated away.
  //
  // Not to be confused with the `destroy` warning the message walk above
  // raises. That one is about the diagram's own structure, is true of a still
  // frame, and fires whether or not anything animates; this one is about the
  // timeline, and an author reading both is being told about two different
  // defects in the same arrow.
  warnOnConnectorsOutlivingTheirEndpoints(
    timeline.entries,
    collectMessages(statements),
    "message",
    diagnostics,
  );

  const model: SequenceModel = {
    title: document.title,
    accTitle: document.accTitle,
    participants,
    boxes,
    statements,
    interactions,
    timeline,
  };

  return { model, diagnostics };
}

/**
 * Resolves the document's `box` groupings to `box:${n}` ids, 1-based in
 * declaration order.
 *
 * Boxes group *declarations*, not statements: a `box` body may only hold
 * `participant`/`actor` lines, so a participant created by a mention is never
 * in one (ADR-0013), and every member the parser hands over is declared. The
 * check below guards the model's own contract — a document built by hand
 * can still name an undeclared member — rather than anything an author can
 * write.
 *
 * An unresolvable member is dropped from the box and the box itself kept:
 * the remaining members still describe a grouping worth rendering.
 */
function resolveBoxes(document: SequenceDocument, diagnostics: Diagnostic[]): ResolvedSequenceBox[] {
  const declaredIds = new Set(document.participants.map((p) => p.id));

  return document.boxes.map((box, index) => {
    const id = generatedId("box", index + 1);
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

/**
 * Records that a statement named participant `id`, creating the participant
 * if nothing has declared it: Mermaid creates a lane on first mention, with
 * the id as its label.
 */
function mention(
  id: string,
  participantsById: Map<string, ResolvedSequenceParticipant>,
  state: ResolutionState,
): void {
  if (!participantsById.has(id)) {
    const participant: ResolvedSequenceParticipant = {
      id,
      label: plainLabel(id),
      participantKind: "participant",
      origin: "declared",
      createdAt: 0,
      destroyedAt: null,
    };
    participantsById.set(id, participant);
  }
  if (!state.mentionedSoFar.has(id)) {
    state.mentionedSoFar.add(id);
    state.mentionOrder.push(id);
  }
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
      // `create` starts a lifeline, so it has to come first: once a statement
      // has named X, X already has a lane from the top. Mermaid rejects this
      // document outright ("It is not possible to have actors with the same
      // id"); the `create` alone is dropped here, and X keeps the lane it has.
      if (statement.origin === "created" && state.mentionedSoFar.has(statement.id)) {
        state.diagnostics.push({
          severity: "error",
          message: `create participant "${statement.id}" comes after "${statement.id}" is already used; a created participant must be created before it is first named`,
          line: statement.line,
          column: statement.column,
        });
        continue;
      }
      mention(statement.id, participantsById, state);
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
      mention(statement.id, participantsById, state);
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
      const referencedIds = [...new Set([statement.from, statement.to])];
      for (const id of referencedIds) mention(id, participantsById, state);

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
        label: statement.label,
        arrow: statement.arrow,
        autonumber: state.autonumbering ? state.autonumberCounter : null,
      };
      resolved.push({ kind: "message", message });
      touched.add(statement.from);
      touched.add(statement.to);
      continue;
    }

    if (statement.kind === "activate") {
      mention(statement.id, participantsById, state);
      state.openActivationCounts.set(
        statement.id,
        (state.openActivationCounts.get(statement.id) ?? 0) + 1,
      );
      state.activationCounter += 1;
      const activationId = generatedId("activation", state.activationCounter);
      ++state.position;
      resolved.push({ kind: "activate", participantId: statement.id, activationId });
      touched.add(statement.id);
      continue;
    }

    if (statement.kind === "deactivate") {
      mention(statement.id, participantsById, state);
      // Matches Mermaid's own rejection ("Trying to inactivate an inactive
      // participant") — a `deactivate` with nothing open is dropped rather
      // than drawing a bar with no start, the same partial-failure
      // tolerance a bad `destroy`/message reference gets.
      const openCount = state.openActivationCounts.get(statement.id) ?? 0;
      if (openCount === 0) {
        state.diagnostics.push({
          severity: "error",
          message: `deactivate references participant "${statement.id}", which has no open activation`,
          line: statement.line,
          column: statement.column,
        });
        continue;
      }
      state.openActivationCounts.set(statement.id, openCount - 1);
      ++state.position;
      resolved.push({ kind: "deactivate", participantId: statement.id });
      touched.add(statement.id);
      continue;
    }

    if (statement.kind === "note") {
      for (const id of new Set([statement.from, statement.to])) mention(id, participantsById, state);

      state.noteCounter += 1;
      ++state.position;
      resolved.push({
        kind: "note",
        note: {
          id: generatedId("note", state.noteCounter),
          placement: statement.placement,
          from: statement.from,
          to: statement.to,
          label: statement.label,
        },
      });
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
  // Block id: `${kind}:${n}` (the separator is load-bearing — see
  // `generatedId`), a 1-based counter per block kind, in document order —
  // assigned here, before recursing into the block's body, so nested blocks
  // (which are walked immediately after, still ahead of this block's later
  // siblings) receive ids that reflect source order across the whole
  // flattened tree, not just within their own nesting level.
  const n = (state.blockCounters.get(statement.kind) ?? 0) + 1;
  state.blockCounters.set(statement.kind, n);
  const id = generatedId(statement.kind, n);

  // Pre-order: the block occupies the position just before its body's
  // statements do.
  ++state.position;

  let branchInputs: Array<{ label: Label | null; body: SequenceStatement[] }>;
  switch (statement.kind) {
    case "alt":
    case "par":
    case "critical":
      // alt/par/critical branch labels ("else"/"and"/"option" conditions)
      // pass through unchanged; each branch's body resolves independently
      // (its own nested block-id/participant-reference state is still the
      // shared `state`, since block ids and lane order by first mention are
      // both document-order-wide, not branch-scoped).
      branchInputs = statement.branches;
      break;
    case "rect":
      // `rect` isn't a labeled-branch construct like alt/par/critical — it's
      // a single colored-background region with no condition of its own. Its
      // color goes to the block's own `color`, passed through unvalidated
      // (validating it is rendering's concern); its one branch has no label.
      branchInputs = [{ label: null, body: statement.body }];
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
    color: statement.kind === "rect" ? statement.color : null,
    branches,
  };
}

/**
 * Walks the resolved statement tree rooted at `statements` in document order,
 * calling `visit` for each message, block, note and `activate` statement.
 *
 * Recursive, and that is the whole point: blocks nest to any depth and a
 * message is more often written inside one than at the top level, so anything
 * derived from "every message" or "every block" is spread across branch bodies
 * rather than sitting in a flat list. A walk of `statements` alone finds
 * `loop:1` but not the message inside it.
 *
 * Every branch of an `alt`/`par`/`critical` is walked. The branches are
 * alternatives at read time, but all of them are drawn, so all of them hold
 * ids an author can name and arrows that can be left pointing at a lane that
 * has gone.
 *
 * One walk with a visitor rather than one walk per caller: the two callers
 * below want different things out of the same traversal (a set of ids, a list
 * of messages), and the traversal is the part that would drift.
 */
function walkStatements(
  statements: readonly ResolvedSequenceStatement[],
  visit: {
    message?: (message: ResolvedSequenceMessage) => void;
    block?: (block: ResolvedSequenceBlock) => void;
    note?: (note: ResolvedSequenceNote) => void;
    activate?: (activationId: string) => void;
  },
): void {
  for (const statement of statements) {
    if (statement.kind === "message") {
      visit.message?.(statement.message);
      continue;
    }
    if (statement.kind === "note") {
      visit.note?.(statement.note);
      continue;
    }
    if (statement.kind === "activate") {
      visit.activate?.(statement.activationId);
      continue;
    }
    if (statement.kind === "block") {
      visit.block?.(statement.block);
      for (const branch of statement.block.branches) {
        walkStatements(branch.statements, visit);
      }
    }
  }
}

/**
 * Every id a `timeline:` block may name from the statement tree: each
 * message's, each control-flow block's, each note's and each activation
 * bar's. An activation bar's id is minted when its `activate` resolves, so
 * that statement is where the bar is found; its `deactivate` carries none.
 */
function collectStatementIds(
  statements: readonly ResolvedSequenceStatement[],
  into: Set<string>,
): void {
  walkStatements(statements, {
    message: (message) => into.add(message.id),
    block: (block) => into.add(block.id),
    note: (note) => into.add(note.id),
    activate: (activationId) => into.add(activationId),
  });
}

/** Every message in the statement tree, in document order. */
function collectMessages(
  statements: readonly ResolvedSequenceStatement[],
): ResolvedSequenceMessage[] {
  const messages: ResolvedSequenceMessage[] = [];
  walkStatements(statements, { message: (message) => messages.push(message) });
  return messages;
}
