import type {
  Diagnostic,
  ParseResult,
  SequenceArrowHead,
  SequenceArrowLine,
  SequenceDocument,
  SequenceParticipantDecl,
  SequenceParticipantKind,
  SequenceStatement,
} from "../contracts";

const SEQUENCE_HEADER_RE = /^sequenceDiagram\s*$/;
const PARTICIPANT_RE = /^(participant|actor)\s+(\w+)(?:\s+as\s+(.+?))?\s*$/;
const TITLE_RE = /^title\s+(.+)$/;

interface ArrowTokenDef {
  token: string;
  line: SequenceArrowLine;
  head: SequenceArrowHead;
}

/**
 * Mermaid's ten message arrow forms, modeled as two independent axes (line
 * style x arrowhead) per the spec's Domain decisions. Listed longest-token-
 * first (6, 5, 4, four of length 3, three of length 2) so the alternation
 * built below never matches a shorter token that is a prefix of a longer
 * one (e.g. "->" is a prefix of "->>"). Keep this order if the list ever
 * changes.
 */
const ARROW_TOKENS: readonly ArrowTokenDef[] = [
  { token: "<<-->>", line: "dotted", head: "bidirectionalFilled" },
  { token: "<<->>", line: "solid", head: "bidirectionalFilled" },
  { token: "-->>", line: "dotted", head: "filled" },
  { token: "->>", line: "solid", head: "filled" },
  { token: "-->", line: "dotted", head: "none" },
  { token: "--x", line: "dotted", head: "cross" },
  { token: "--)", line: "dotted", head: "open" },
  { token: "->", line: "solid", head: "none" },
  { token: "-x", line: "solid", head: "cross" },
  { token: "-)", line: "solid", head: "open" },
];

function escapeRegExp(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ARROW_ALTERNATION = ARROW_TOKENS.map((a) => escapeRegExp(a.token)).join("|");

// Activation-shorthand `+`/`-` (e.g. `A->>+B: ...`) is out of scope per the
// spec's non-goals (activation bars are deferred). Rather than reject any
// message using it, this parser treats an optional `+`/`-` immediately
// after the arrow as literal syntax noise and ignores it — the target id
// is still captured correctly and no activation state is recorded
// anywhere. This choice is documented here since the spec does not pin it
// down (see ticket 01).
const MESSAGE_RE = new RegExp(`^(\\w+)(${ARROW_ALTERNATION})[+-]?(\\w+)\\s*:\\s*(.*)$`);

/**
 * Parses Siren sequence-diagram source text (a `sequenceDiagram` header,
 * `participant`/`actor` declarations, message statements, `title`, and
 * `autonumber`/`autonumber off`) into a `SequenceDocument`. Never throws on
 * malformed input — syntax problems are reported as diagnostics instead.
 *
 * Only validates syntax shape: a message/destroy/block referencing a
 * participant id with no prior declaration is *not* rejected here — that's
 * `buildSequenceModel`'s job (ticket 02).
 */
export function parseSequenceDiagram(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const lines = source.split(/\r\n|\r|\n/);

  const participants: SequenceParticipantDecl[] = [];
  const participantIds = new Set<string>();
  const statements: SequenceStatement[] = [];
  let title: string | null = null;

  let mode: "before-header" | "body" = "before-header";
  let sawError = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNumber = i + 1;
    const line = rawLine.trim();
    const column = rawLine.length - rawLine.trimStart().length + 1;

    if (line.length === 0) {
      continue;
    }

    if (mode === "before-header") {
      if (!SEQUENCE_HEADER_RE.test(line)) {
        diagnostics.push({
          severity: "error",
          message: `Expected "sequenceDiagram", found "${line}"`,
          line: lineNumber,
          column,
        });
        return { document: null, diagnostics };
      }
      mode = "body";
      continue;
    }

    const declMatch = PARTICIPANT_RE.exec(line);
    if (declMatch !== null) {
      const [, kindWord, id, alias] = declMatch;
      const participantKind = kindWord as SequenceParticipantKind;
      const label = alias !== undefined ? alias.trim() : id;

      if (participantIds.has(id)) {
        diagnostics.push({
          severity: "warning",
          message: `Participant "${id}" redeclared; keeping the first declaration`,
          line: lineNumber,
          column,
        });
      } else {
        participantIds.add(id);
        participants.push({ id, label, participantKind, line: lineNumber, column });
      }

      statements.push({
        kind: "participant",
        id,
        label,
        participantKind,
        origin: "declared",
        line: lineNumber,
        column,
      });
      continue;
    }

    const titleMatch = TITLE_RE.exec(line);
    if (titleMatch !== null) {
      title = titleMatch[1].trim();
      continue;
    }

    if (line === "autonumber") {
      statements.push({ kind: "autonumberOn", line: lineNumber, column });
      continue;
    }

    if (line === "autonumber off") {
      statements.push({ kind: "autonumberOff", line: lineNumber, column });
      continue;
    }

    const messageMatch = MESSAGE_RE.exec(line);
    if (messageMatch !== null) {
      const [, from, arrowToken, to, text] = messageMatch;
      const arrowDef = ARROW_TOKENS.find((a) => a.token === arrowToken);
      // arrowDef is always found: arrowToken can only be one of ARROW_TOKENS'
      // own tokens, since it is exactly what the alternation matched.
      statements.push({
        kind: "message",
        from,
        to,
        text: text.trim(),
        arrow: { line: arrowDef!.line, head: arrowDef!.head },
        line: lineNumber,
        column,
      });
      continue;
    }

    diagnostics.push({
      severity: "error",
      message: `Unrecognized sequenceDiagram line: "${line}"`,
      line: lineNumber,
      column,
    });
    sawError = true;
  }

  if (mode === "before-header") {
    return { document: null, diagnostics };
  }

  if (sawError) {
    return { document: null, diagnostics };
  }

  const hasBody = title !== null || participants.length > 0 || statements.length > 0;
  if (!hasBody) {
    diagnostics.push({
      severity: "error",
      message: "sequenceDiagram has no body",
      line: lines.length,
      column: 1,
    });
    return { document: null, diagnostics };
  }

  const document: SequenceDocument = {
    kind: "sequence",
    title,
    participants,
    boxes: [],
    statements,
  };

  return { document, diagnostics };
}
