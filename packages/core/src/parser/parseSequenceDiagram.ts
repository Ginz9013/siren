import type {
  Diagnostic,
  Interaction,
  ParseResult,
  SequenceAltBranch,
  SequenceArrowHead,
  SequenceArrowLine,
  SequenceBox,
  SequenceCriticalBranch,
  SequenceDocument,
  SequenceNotePlacement,
  SequenceParBranch,
  SequenceParticipantDecl,
  SequenceParticipantKind,
  SequenceParticipantOrigin,
  SequenceParticipantStatement,
  SequenceStatement,
  SirenTimeline,
} from "../contracts";
import { isTimelineHeader, parseTimelineBody } from "./parseTimelineBlock";

const SEQUENCE_HEADER_RE = /^sequenceDiagram\s*$/;

/**
 * The pseudo-terminator that ends a statement body at a `timeline:` header.
 *
 * It is passed only to the top-level `parseBody` call, which is what makes
 * `timeline:` end the diagram body there and stay an unrecognized line
 * inside a `loop`/`alt`/`box` body: a block body's terminator set is its
 * own (`end`, `else`, `and`, `option`) and never includes this. Recognized
 * by `isTimelineHeader` rather than by `matchLeadingKeyword`, so the header
 * spelling stays owned by the shared timeline grammar.
 */
const TIMELINE_TERMINATOR = "timeline:";
const PARTICIPANT_RE = /^(participant|actor)\s+(\w+)(?:\s+as\s+(.+?))?\s*$/;
const TITLE_RE = /^title\s+(.+)$/;
/** `accTitle: text` — screen-reader-only, distinct from the visible `title` above. The colon is required. */
const ACC_TITLE_RE = /^accTitle:\s*(.+)$/;
/** `link A: Label @ url` — a navigable link on a participant, Mermaid's own spelling for this diagram kind. */
const LINK_RE = /^link\s+(\w+):\s*(.+?)\s*@\s*(\S+)$/;
/** The lone participant id argument of a `destroy` statement. */
const DESTROY_ID_RE = /^(\w+)$/;

/** The raw color argument to a `rect` block: `rgb(...)` or `rgba(...)`, unvalidated beyond shape. */
const RECT_COLOR_RE = /^(rgba?\([^()]*\))$/;

/**
 * Splits a `box` header's arguments into its leading token — an
 * `rgb()`/`rgba()` call, a `#hex` literal, or a bare word — and whatever
 * follows it.
 */
const BOX_HEADER_RE = /^(rgba?\([^()]*\)|#\w+|\w+)(?:\s+(.*))?$/;

/**
 * The CSS named colors, plus `transparent`. Used only to decide whether a
 * `box` header's first bare word is its color or the start of its label
 * (see `parseBoxHeader`); no color value is ever validated beyond this.
 */
const CSS_NAMED_COLORS: ReadonlySet<string> = new Set(
  `transparent aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond
   blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk
   crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
   darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray
   darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick
   floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey
   honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon
   lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink
   lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow
   lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple
   mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue
   mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
   palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
   powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen
   seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal
   thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(/\s+/),
);

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

/**
 * A message: sender, arrow, target, `: text`. Nothing may sit between the
 * arrow and the target — in particular not the activation shorthand's
 * `+`/`-`, which `ACTIVATION_MESSAGE_RE` below claims instead.
 */
const MESSAGE_RE = new RegExp(`^(\\w+)(${ARROW_ALTERNATION})(\\w+)\\s*:\\s*(.*)$`);

/**
 * The same message shape, but with the activation shorthand's `+`/`-`
 * between the arrow and the target (`A->>+B: x`, `B-->>-A: y`).
 *
 * Matched *after* `MESSAGE_RE`, though the two are disjoint: a target is
 * `\w+` and can never begin with `+` or `-`, so no arrow token ending in
 * `-x`, `--x`, `-)` or `--)` can be reread as a marker.
 *
 * Measured against real Mermaid: `+` opens an activation on the arrow's
 * *destination*; `-` closes one on its *source* — not the same lane, and
 * easy to mis-state because the common `A->>+B` / `B-->>-A` pairing puts
 * both markers on `B`. The statement handler below expands a match into
 * the message plus a synthetic `activate`/`deactivate` statement rather
 * than keeping the shorthand as its own shape, so every later stage reads
 * one representation regardless of which spelling the author used.
 */
const ACTIVATION_MESSAGE_RE = new RegExp(
  `^(\\w+)(${ARROW_ALTERNATION})([+-])(\\w+)\\s*:\\s*(.*)$`,
);
/** `activate X` / `deactivate X` — the long form of the same activation bar. */
const ACTIVATE_RE = /^activate\s+(\w+)$/;
const DEACTIVATE_RE = /^deactivate\s+(\w+)$/;
/**
 * `note over A,B: text` / `note over A: text` / `note right of A: text` /
 * `note left of A: text`. The participant-list group is `[\w,]+` rather
 * than two separate `\w+`s: `over` may name one or two ids, `right of`/
 * `left of` name exactly one, and splitting on `,` after the match reads
 * either shape without two regexes.
 */
const NOTE_RE = /^note\s+(over|right of|left of)\s+([\w,]+)\s*:\s*(.*)$/;

/** Mutable cursor + accumulators threaded through the recursive-descent body parser. */
interface ParserState {
  readonly lines: string[];
  index: number;
  readonly diagnostics: Diagnostic[];
  readonly participants: SequenceParticipantDecl[];
  readonly participantIds: Set<string>;
  readonly boxes: SequenceBox[];
  sawError: boolean;
  title: string | null;
  accTitle: string | null;
  readonly interactions: Interaction[];
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

/**
 * Splits a `box` header's arguments (everything after the `box` keyword)
 * into its optional color and optional label.
 *
 * Mermaid's grammar for this line is `box <color>? <label>?` with no fixed
 * field order enforced, so the rule this parser implements is:
 *
 * - the first token is the color when it is *color-shaped* — an
 *   `rgb()`/`rgba()` call, a `#hex` literal, `transparent`, or a CSS named
 *   color (matched case-insensitively, reported verbatim) — and everything
 *   after it is the label;
 * - otherwise there is no color and the whole argument text is the label
 *   (so `box My Service` labels the box "My Service" rather than reading
 *   "My" as a color);
 * - an empty argument text means no color and no label.
 *
 * A label is never reinterpreted as a color: only the first token is ever
 * a color candidate.
 */
function parseBoxHeader(rest: string): { color: string | null; label: string | null } {
  const headerMatch = BOX_HEADER_RE.exec(rest);
  if (headerMatch === null) {
    return { color: null, label: labelFrom(rest) };
  }

  const [, firstToken, remainder] = headerMatch;
  const isColor =
    firstToken.startsWith("#") ||
    firstToken.startsWith("rgb(") ||
    firstToken.startsWith("rgba(") ||
    CSS_NAMED_COLORS.has(firstToken.toLowerCase());

  if (!isColor) {
    return { color: null, label: labelFrom(rest) };
  }
  return { color: firstToken, label: labelFrom(remainder === undefined ? "" : remainder.trim()) };
}

/**
 * Records one `participant`/`actor` declaration — whether written in the
 * preamble (`origin: "declared"`) or mid-stream via `create`
 * (`origin: "created"`) — into the document's flat participants list, and
 * returns the statement that marks its position in the statement stream.
 *
 * `declMatch` must be a `PARTICIPANT_RE` match (for `create`, of the text
 * after the `create` keyword). The flat list keeps encounter order;
 * separating preamble lanes from `create`d ones for lane ordering is
 * `buildSequenceModel`'s job, not the parser's.
 */
function declareParticipant(
  state: ParserState,
  declMatch: RegExpExecArray,
  origin: SequenceParticipantOrigin,
  line: number,
  column: number,
): SequenceParticipantStatement {
  const [, kindWord, id, alias] = declMatch;
  const participantKind = kindWord as SequenceParticipantKind;
  const label = alias !== undefined ? alias.trim() : id;

  if (state.participantIds.has(id)) {
    state.diagnostics.push({
      severity: "warning",
      message: `Participant "${id}" redeclared; keeping the first declaration`,
      line,
      column,
    });
  } else {
    state.participantIds.add(id);
    state.participants.push({ id, label, participantKind, line, column });
  }

  return { kind: "participant", id, label, participantKind, origin, line, column };
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
      if (term === TIMELINE_TERMINATOR) {
        if (isTimelineHeader(line)) {
          matchedTerminator = term;
          break;
        }
        continue;
      }
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
      statements.push(declareParticipant(state, declMatch, "declared", lineNumber, column));
      state.index++;
      continue;
    }

    const createMatch = matchLeadingKeyword(line, "create");
    if (createMatch.matched) {
      const createdDeclMatch = PARTICIPANT_RE.exec(createMatch.rest);
      if (createdDeclMatch === null) {
        state.diagnostics.push({
          severity: "error",
          message: `Invalid "create", expected "create participant <id>" or "create actor <id>": "${line}"`,
          line: lineNumber,
          column,
        });
        state.sawError = true;
        state.index++;
        continue;
      }
      statements.push(declareParticipant(state, createdDeclMatch, "created", lineNumber, column));
      state.index++;
      continue;
    }

    const destroyMatch = matchLeadingKeyword(line, "destroy");
    if (destroyMatch.matched) {
      const idMatch = DESTROY_ID_RE.exec(destroyMatch.rest);
      if (idMatch === null) {
        state.diagnostics.push({
          severity: "error",
          message: `Invalid "destroy", expected "destroy <id>": "${line}"`,
          line: lineNumber,
          column,
        });
        state.sawError = true;
        state.index++;
        continue;
      }
      // No check that the id was declared — that's the explicit-reference
      // rule, enforced by `buildSequenceModel`, not here.
      statements.push({ kind: "destroy", id: idMatch[1], line: lineNumber, column });
      state.index++;
      continue;
    }

    const titleMatch = TITLE_RE.exec(line);
    if (titleMatch !== null) {
      state.title = titleMatch[1].trim();
      state.index++;
      continue;
    }

    const accTitleMatch = ACC_TITLE_RE.exec(line);
    if (accTitleMatch !== null) {
      state.accTitle = accTitleMatch[1].trim();
      state.index++;
      continue;
    }

    const linkMatch = LINK_RE.exec(line);
    if (linkMatch !== null) {
      const [, targetId, label, url] = linkMatch;
      state.interactions.push({
        interactionKind: "href",
        targetId,
        action: url,
        argument: null,
        tooltip: label,
        line: lineNumber,
        column,
      });
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

    const activationMatch = ACTIVATION_MESSAGE_RE.exec(line);
    if (activationMatch !== null) {
      const [, from, arrowToken, marker, to, text] = activationMatch;
      const arrowDef = ARROW_TOKENS.find((a) => a.token === arrowToken);
      statements.push({
        kind: "message",
        from,
        to,
        text: text.trim(),
        arrow: { line: arrowDef!.line, head: arrowDef!.head },
        line: lineNumber,
        column,
      });
      // `+` opens on the arrow's destination; `-` closes on its source —
      // see `ACTIVATION_MESSAGE_RE`'s own doc comment for why those are
      // different lanes.
      if (marker === "+") {
        statements.push({ kind: "activate", id: to, line: lineNumber, column });
      } else {
        statements.push({ kind: "deactivate", id: from, line: lineNumber, column });
      }
      state.index++;
      continue;
    }

    const activateMatch = ACTIVATE_RE.exec(line);
    if (activateMatch !== null) {
      statements.push({ kind: "activate", id: activateMatch[1], line: lineNumber, column });
      state.index++;
      continue;
    }

    const deactivateMatch = DEACTIVATE_RE.exec(line);
    if (deactivateMatch !== null) {
      statements.push({ kind: "deactivate", id: deactivateMatch[1], line: lineNumber, column });
      state.index++;
      continue;
    }

    const noteMatch = NOTE_RE.exec(line);
    if (noteMatch !== null) {
      const [, keyword, participantList, text] = noteMatch;
      const ids = participantList.split(",").map((id) => id.trim());
      const placement: SequenceNotePlacement =
        keyword === "over" ? "over" : keyword === "right of" ? "right" : "left";
      statements.push({
        kind: "note",
        placement,
        from: ids[0],
        // A single-participant `over`/`right of`/`left of` has nothing to
        // pair with, so `to` mirrors `from` rather than being left unset —
        // the same "from and to are the same id" shape a flowchart's own
        // self-edge already models.
        to: ids.length > 1 ? ids[1] : ids[0],
        text: text.trim(),
        line: lineNumber,
        column,
      });
      state.index++;
      continue;
    }

    const boxMatch = matchLeadingKeyword(line, "box");
    if (boxMatch.matched) {
      state.index++;
      const { color, label } = parseBoxHeader(boxMatch.rest);
      const body = parseBody(state, ["end"]);
      if (body.terminatorKeyword !== "end") {
        state.diagnostics.push(unterminatedBlockDiagnostic("box", lineNumber, column));
        state.sawError = true;
        continue;
      }

      const members = body.statements.filter((s) => s.kind === "participant");
      if (members.length !== body.statements.length) {
        state.diagnostics.push({
          severity: "error",
          message: `A "box" body may only contain participant/actor declarations`,
          line: lineNumber,
          column,
        });
        state.sawError = true;
      }

      state.boxes.push({
        color,
        label,
        participantIds: members.map((s) => s.id),
        line: lineNumber,
        column,
      });
      // A box groups lanes; it is not a statement of its own. Its member
      // declarations stay in the enclosing statement stream, at the
      // position the box was written, so statement order still tells
      // `buildSequenceModel` where every lifeline begins.
      statements.push(...body.statements);
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
 * `autonumber`/`autonumber off`, nested control-flow blocks,
 * `create participant`/`create actor` and `destroy` lifeline statements,
 * and `box ... end` participant groupings) into a `SequenceDocument`.
 * Never throws on malformed input —
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
    boxes: [],
    sawError: false,
    title: null,
    accTitle: null,
    interactions: [],
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

  const { statements, terminatorKeyword } = parseBody(state, [TIMELINE_TERMINATOR]);

  // Once `timeline:` has ended the body the block runs to the end of the
  // document — the same one-way switch `parseFlowchart` and
  // `parseClassDiagram` make, so a sequence statement written after it is a
  // timeline diagnostic rather than something that silently parses as
  // structure. Its lines go through the shared grammar, never a
  // sequence-specific copy of it.
  let timeline: SirenTimeline | null = null;
  if (terminatorKeyword === TIMELINE_TERMINATOR) {
    const { entries, diagnostics: bodyDiagnostics } = parseTimelineBody(
      lines,
      state.index,
    );
    diagnostics.push(...bodyDiagnostics);
    // Every diagnostic the shared body reports is error-severity, so a
    // non-empty list is exactly what used to be a per-line `sawError = true`.
    if (bodyDiagnostics.length > 0) {
      state.sawError = true;
    }
    timeline = { entries };
  }

  if (state.sawError) {
    return { document: null, diagnostics };
  }

  const hasBody =
    state.title !== null ||
    state.accTitle !== null ||
    state.participants.length > 0 ||
    state.interactions.length > 0 ||
    statements.length > 0;
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
    accTitle: state.accTitle,
    interactions: state.interactions,
    participants: state.participants,
    boxes: state.boxes,
    statements,
    timeline,
  };

  return { document, diagnostics };
}
