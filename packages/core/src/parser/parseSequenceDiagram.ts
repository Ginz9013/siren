import type {
  Diagnostic,
  ParseResult,
  SequenceAltBranch,
  SequenceArrowHead,
  SequenceArrowLine,
  SequenceCriticalBranch,
  SequenceDocument,
  SequenceParBranch,
  SequenceParticipantDecl,
  SequenceParticipantKind,
  SequenceStatement,
} from "../contracts";

const SEQUENCE_HEADER_RE = /^sequenceDiagram\s*$/;
const PARTICIPANT_RE = /^(participant|actor)\s+(\w+)(?:\s+as\s+(.+?))?\s*$/;
const TITLE_RE = /^title\s+(.+)$/;

/** The raw color argument to a `rect` block: `rgb(...)` or `rgba(...)`, unvalidated beyond shape. */
const RECT_COLOR_RE = /^(rgba?\([^()]*\))$/;

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

/** Mutable cursor + accumulators threaded through the recursive-descent body parser. */
interface ParserState {
  readonly lines: string[];
  index: number;
  readonly diagnostics: Diagnostic[];
  readonly participants: SequenceParticipantDecl[];
  readonly participantIds: Set<string>;
  sawError: boolean;
  title: string | null;
}

/** Result of matching a line against a single leading keyword (e.g. `loop`, `end`). */
interface KeywordMatch {
  matched: boolean;
  /** Trimmed text after the keyword, or `""` when the line was just the bare keyword. */
  rest: string;
}

/**
 * Matches `line` against a leading keyword, requiring a word boundary (the
 * keyword alone, or the keyword followed by whitespace) so e.g. `"opt"`
 * never matches `"option"` and `"and"` never matches `"actor"`.
 */
function matchLeadingKeyword(line: string, keyword: string): KeywordMatch {
  if (line === keyword) {
    return { matched: true, rest: "" };
  }
  if (line.startsWith(`${keyword} `)) {
    return { matched: true, rest: line.slice(keyword.length + 1).trim() };
  }
  return { matched: false, rest: "" };
}

function labelFrom(rest: string): string | null {
  return rest.length > 0 ? rest : null;
}

function unterminatedBlockDiagnostic(kind: string, line: number, column: number): Diagnostic {
  return {
    severity: "error",
    message: `Unterminated "${kind}" block: missing matching "end"`,
    line,
    column,
  };
}

/** Outcome of parsing a statement list up to (and consuming) one of `terminators`, or EOF. */
interface ParseBodyResult {
  statements: SequenceStatement[];
  /** The terminator keyword that stopped this body, or `null` if EOF was reached instead. */
  terminatorKeyword: string | null;
  /** The label carried by the terminator line (only meaningful for `else`/`and`/`option`). */
  terminatorLabel: string | null;
}

/**
 * Parses a flat run of statements — messages, participant declarations,
 * title, autonumber toggles, and nested `loop` blocks (recursively) —
 * starting at `state.index`, until a line matches one of `terminators`
 * (which is consumed) or the input runs out.
 */
function parseBody(state: ParserState, terminators: readonly string[]): ParseBodyResult {
  const statements: SequenceStatement[] = [];

  while (state.index < state.lines.length) {
    const rawLine = state.lines[state.index];
    const lineNumber = state.index + 1;
    const line = rawLine.trim();
    const column = rawLine.length - rawLine.trimStart().length + 1;

    if (line.length === 0) {
      state.index++;
      continue;
    }

    let matchedTerminator: string | null = null;
    let terminatorLabel: string | null = null;
    for (const term of terminators) {
      const m = matchLeadingKeyword(line, term);
      if (m.matched) {
        matchedTerminator = term;
        terminatorLabel = labelFrom(m.rest);
        break;
      }
    }
    if (matchedTerminator !== null) {
      state.index++;
      return { statements, terminatorKeyword: matchedTerminator, terminatorLabel };
    }

    const declMatch = PARTICIPANT_RE.exec(line);
    if (declMatch !== null) {
      const [, kindWord, id, alias] = declMatch;
      const participantKind = kindWord as SequenceParticipantKind;
      const label = alias !== undefined ? alias.trim() : id;

      if (state.participantIds.has(id)) {
        state.diagnostics.push({
          severity: "warning",
          message: `Participant "${id}" redeclared; keeping the first declaration`,
          line: lineNumber,
          column,
        });
      } else {
        state.participantIds.add(id);
        state.participants.push({ id, label, participantKind, line: lineNumber, column });
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
      state.index++;
      continue;
    }

    const titleMatch = TITLE_RE.exec(line);
    if (titleMatch !== null) {
      state.title = titleMatch[1].trim();
      state.index++;
      continue;
    }

    if (line === "autonumber") {
      statements.push({ kind: "autonumberOn", line: lineNumber, column });
      state.index++;
      continue;
    }

    if (line === "autonumber off") {
      statements.push({ kind: "autonumberOff", line: lineNumber, column });
      state.index++;
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
      state.index++;
      continue;
    }

    const loopMatch = matchLeadingKeyword(line, "loop");
    if (loopMatch.matched) {
      state.index++;
      const label = labelFrom(loopMatch.rest);
      const body = parseBody(state, ["end"]);
      if (body.terminatorKeyword !== "end") {
        state.diagnostics.push(unterminatedBlockDiagnostic("loop", lineNumber, column));
        state.sawError = true;
      } else {
        statements.push({
          kind: "loop",
          label,
          body: body.statements,
          line: lineNumber,
          column,
        });
      }
      continue;
    }

    const optMatch = matchLeadingKeyword(line, "opt");
    if (optMatch.matched) {
      state.index++;
      const label = labelFrom(optMatch.rest);
      const body = parseBody(state, ["end"]);
      if (body.terminatorKeyword !== "end") {
        state.diagnostics.push(unterminatedBlockDiagnostic("opt", lineNumber, column));
        state.sawError = true;
      } else {
        statements.push({
          kind: "opt",
          label,
          body: body.statements,
          line: lineNumber,
          column,
        });
      }
      continue;
    }

    const breakMatch = matchLeadingKeyword(line, "break");
    if (breakMatch.matched) {
      state.index++;
      const label = labelFrom(breakMatch.rest);
      const body = parseBody(state, ["end"]);
      if (body.terminatorKeyword !== "end") {
        state.diagnostics.push(unterminatedBlockDiagnostic("break", lineNumber, column));
        state.sawError = true;
      } else {
        statements.push({
          kind: "break",
          label,
          body: body.statements,
          line: lineNumber,
          column,
        });
      }
      continue;
    }

    const rectMatch = matchLeadingKeyword(line, "rect");
    if (rectMatch.matched) {
      state.index++;
      const colorMatch = RECT_COLOR_RE.exec(rectMatch.rest);
      if (colorMatch === null) {
        state.diagnostics.push({
          severity: "error",
          message: `Invalid "rect" color, expected rgb(...) or rgba(...): "${rectMatch.rest}"`,
          line: lineNumber,
          column,
        });
        state.sawError = true;
        // Consume the body anyway so parsing can keep making progress past
        // this malformed block instead of misreading its contents as
        // top-level statements.
        parseBody(state, ["end"]);
        continue;
      }
      const color = colorMatch[1];
      const body = parseBody(state, ["end"]);
      if (body.terminatorKeyword !== "end") {
        state.diagnostics.push(unterminatedBlockDiagnostic("rect", lineNumber, column));
        state.sawError = true;
      } else {
        statements.push({
          kind: "rect",
          color,
          body: body.statements,
          line: lineNumber,
          column,
        });
      }
      continue;
    }

    const altMatch = matchLeadingKeyword(line, "alt");
    if (altMatch.matched) {
      state.index++;
      const { branches, ok } = parseBranches<SequenceAltBranch>(
        state,
        "else",
        labelFrom(altMatch.rest),
      );
      if (!ok) {
        state.diagnostics.push(unterminatedBlockDiagnostic("alt", lineNumber, column));
        state.sawError = true;
      } else {
        statements.push({ kind: "alt", branches, line: lineNumber, column });
      }
      continue;
    }

    const parMatch = matchLeadingKeyword(line, "par");
    if (parMatch.matched) {
      state.index++;
      const { branches, ok } = parseBranches<SequenceParBranch>(
        state,
        "and",
        labelFrom(parMatch.rest),
      );
      if (!ok) {
        state.diagnostics.push(unterminatedBlockDiagnostic("par", lineNumber, column));
        state.sawError = true;
      } else {
        statements.push({ kind: "par", branches, line: lineNumber, column });
      }
      continue;
    }

    const criticalMatch = matchLeadingKeyword(line, "critical");
    if (criticalMatch.matched) {
      state.index++;
      const { branches, ok } = parseBranches<SequenceCriticalBranch>(
        state,
        "option",
        labelFrom(criticalMatch.rest),
      );
      if (!ok) {
        state.diagnostics.push(unterminatedBlockDiagnostic("critical", lineNumber, column));
        state.sawError = true;
      } else {
        statements.push({ kind: "critical", branches, line: lineNumber, column });
      }
      continue;
    }

    state.diagnostics.push({
      severity: "error",
      message: `Unrecognized sequenceDiagram line: "${line}"`,
      line: lineNumber,
      column,
    });
    state.sawError = true;
    state.index++;
  }

  return { statements, terminatorKeyword: null, terminatorLabel: null };
}

/**
 * Parses the branches of an `alt`/`par`/`critical` block: the first branch
 * (already opened by the caller, carrying `firstLabel`), then zero or more
 * additional branches each opened by `branchKeyword` (`else`/`and`/
 * `option`), until `end`. Returns `ok: false` (no `end` found) on EOF.
 */
function parseBranches<TBranch extends { label: string | null; body: SequenceStatement[] }>(
  state: ParserState,
  branchKeyword: string,
  firstLabel: string | null,
): { branches: TBranch[]; ok: boolean } {
  const branches: TBranch[] = [];
  let label = firstLabel;

  for (;;) {
    const { statements, terminatorKeyword, terminatorLabel } = parseBody(state, [
      branchKeyword,
      "end",
    ]);
    branches.push({ label, body: statements } as TBranch);

    if (terminatorKeyword === "end") {
      return { branches, ok: true };
    }
    if (terminatorKeyword === branchKeyword) {
      label = terminatorLabel;
      continue;
    }
    return { branches, ok: false };
  }
}

/**
 * Parses Siren sequence-diagram source text (a `sequenceDiagram` header,
 * `participant`/`actor` declarations, message statements, `title`,
 * `autonumber`/`autonumber off`, and nested `loop ... end` control-flow
 * blocks) into a `SequenceDocument`. Never throws on malformed input —
 * syntax problems are reported as diagnostics instead.
 *
 * Only validates syntax shape: a message/destroy/block referencing a
 * participant id with no prior declaration is *not* rejected here — that's
 * `buildSequenceModel`'s job (ticket 02).
 */
export function parseSequenceDiagram(source: string): ParseResult {
  const lines = source.split(/\r\n|\r|\n/);
  const diagnostics: Diagnostic[] = [];

  const state: ParserState = {
    lines,
    index: 0,
    diagnostics,
    participants: [],
    participantIds: new Set<string>(),
    sawError: false,
    title: null,
  };

  while (state.index < lines.length && lines[state.index].trim().length === 0) {
    state.index++;
  }

  if (state.index >= lines.length) {
    return { document: null, diagnostics };
  }

  const headerRawLine = lines[state.index];
  const headerLine = headerRawLine.trim();
  const headerColumn = headerRawLine.length - headerRawLine.trimStart().length + 1;
  if (!SEQUENCE_HEADER_RE.test(headerLine)) {
    diagnostics.push({
      severity: "error",
      message: `Expected "sequenceDiagram", found "${headerLine}"`,
      line: state.index + 1,
      column: headerColumn,
    });
    return { document: null, diagnostics };
  }
  state.index++;

  const { statements } = parseBody(state, []);

  if (state.sawError) {
    return { document: null, diagnostics };
  }

  const hasBody = state.title !== null || state.participants.length > 0 || statements.length > 0;
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
    title: state.title,
    participants: state.participants,
    boxes: [],
    statements,
  };

  return { document, diagnostics };
}
