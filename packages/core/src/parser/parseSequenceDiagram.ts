import type {
  DiagramParseResult,
  Diagnostic,
  Interaction,
  Label,
  SequenceAltBranch,
  SequenceArrowHead,
  SequenceArrowLine,
  SequenceBox,
  SequenceCriticalBranch,
  SequenceDocument,
  SequenceLinkMention,
  SequenceNotePlacement,
  SequenceParBranch,
  SequenceParticipantDecl,
  SequenceParticipantKind,
  SequenceParticipantOrigin,
  SequenceParticipantStatement,
  SequenceStatement,
  NamedTimeline,
  SirenTimeline,
} from "../contracts";
import { CSS_NAMED_COLORS } from "../label/cssColor";
import { plainLabel, type SourcePosition } from "../label/label";
import { readLabelAt, readTextAt } from "../label/readLabelAt";
import { listAcceptedHeaders, matchDiagramHeader } from "./parseDirection";
import { readAccDescrBlock } from "./readAccDescrBlock";
import { isTimelineHeader, namedTimelinesField, parseTimelineBlocks } from "./parseTimelineBlock";
import { midLinePercentError } from "./midLinePercent";

/**
 * The header this parser accepts, asked for by kind rather than written out
 * — the same list `parseSiren` dispatches on, so this message cannot name a
 * spelling the dispatcher rejects or miss one it sends here.
 */
const SEQUENCE_HEADER_SPELLINGS = listAcceptedHeaders(["sequence"]);

/**
 * The pseudo-terminator that ends a statement body at a timeline header of
 * either form — `timeline:` or `timeline <name>:`.
 *
 * It is not a keyword and is never spelled in a document: its value is only
 * the tag `parseBody` hands back, and the line it stands for is recognized by
 * `isTimelineHeader` rather than by `matchLeadingKeyword`, so what counts as
 * a header stays owned by the shared timeline grammar. It is passed only to
 * the top-level `parseBody` call, which is what makes a header end the
 * diagram body there and stay an unrecognized line inside a
 * `loop`/`alt`/`box` body: a block body's terminator set is its own (`end`,
 * `else`, `and`, `option`) and never includes this.
 */
const TIMELINE_HEADER_TERMINATOR = "<timeline header>";

/**
 * A `%%` after the header, through the line's end: a comment. CONTEXT.md's
 * **Comment** is a whole line, and Mermaid 12.2.0 cuts nothing mid-line
 * before the grammar sees it; but the sequence lexer has `%%` rules of its
 * own (`%(?!\{)[^\n]*`), which read one as a comment wherever a token ends
 * and no rule that reads text has started — after `sequenceDiagram` and a
 * space, measured (`sequenceDiagram %% zz` is accepted, and
 * `sequenceDiagram%%zz` is refused).
 */
const COMMENT_AFTER_HEADER = /\s+%%.*$/;

/**
 * A `%%` after a statement that holds nothing but keywords — `end`,
 * `autonumber`, `autonumber off` — through the line's end: a comment, by
 * the same lexer rules as `COMMENT_AFTER_HEADER`, here with or without a
 * space before it (`end %% x` and `end%%x` are both accepted, measured).
 */
const COMMENT_AFTER_KEYWORDS = /\s*%%.*$/;

/**
 * `line` without a `%%` that follows a `;`, through the line's end. Every
 * rule of the sequence lexer that reads text — a message's or note's text, a
 * label, a name, a title — stops at a `;`, so a `%%` after one stands where a
 * token ends and is read as a comment by the lexer's own `%%` rules
 * (`A->>B: hi; %% x` and `A->>B: hi;%% x` both record "hi", measured — so
 * any spaces between, `\s*`). The `accTitle:` and
 * `accDescr:` lines are the exception: their rule reads to the line's end,
 * `;` and `%%` included.
 */
function withoutCommentAfterSemicolon(line: string): string {
  return ACC_LINE_RE.test(line) ? line : line.replace(/(?<=;)\s*%%.*$/, "");
}

/** The start of an `accTitle:` or `accDescr:` line, whose text runs to the line's end. */
const ACC_LINE_RE = /^acc(?:Title|Descr)\s*:/i;
/**
 * `participant <id>`, `actor <id>`, either with an `as <alias>`. The id is a
 * word, or a word and a `%%` with everything after it, with or without a
 * space before the `%%` (`\s*`): once `participant` has started a name,
 * Mermaid 12.2.0's lexer reads it to the line's end, `%%` included, so
 * `participant A %% x` declares "A %% x", `participant A%%x` declares
 * "A%%x", and `participant A %% x as Al` declares "A %% x as Al" (measured).
 * Only a plain word takes an alias.
 */
const PARTICIPANT_RE = /^(participant|actor)\s+(\w+(?=\s+as\s)|\w+(?:\s*%%.*)?)(?:\s+as\s+(.+?))?\s*$/di;
/**
 * `title text` or `title: text`. The colon spelling needs whitespace after the
 * colon (Mermaid 12.2.0 rejects `title:Hello`); `title : text` is the plain
 * spelling, and Mermaid keeps that colon in the title too.
 */
const TITLE_RE = /^title(?::\s+|\s+)(.+)$/i;
/**
 * `accTitle: text` — screen-reader-only, distinct from the visible `title`
 * above. The colon is required; whitespace may stand before it (Mermaid
 * 12.2.0 reads `accTitle : hi` as "hi").
 */
const ACC_TITLE_RE = /^accTitle\s*:\s*(.+)$/i;
/** `accDescr: text` — the screen-reader-only description, read exactly as `accTitle` is. */
const ACC_DESCR_RE = /^accDescr\s*:\s*(.+)$/i;
/**
 * The opening of the braced `accDescr { ... }`, in any case. The block runs
 * to the first `}`, on this line or a later one (`readAccDescrBlock`).
 */
const ACC_DESCR_BLOCK_RE = /^accDescr\s*\{/i;
/**
 * `link A: Label @ url` — a navigable link on a participant, Mermaid's own
 * spelling for this diagram kind. A `%%` after the url is part of it, after
 * a space (`\s+`) or run into it (`\S+` holds it): Mermaid 12.2.0 records
 * `link A: D @ https://x.org %% x` as the url "https://x.org %% x" and
 * `link A: D @ https://x.org%%x` as "https://x.org%%x" (measured).
 */
const LINK_RE = /^link\s+(\w+)\s*:\s*(.+?)\s*@\s*(\S+(?:\s+%%.*)?)$/i;
/**
 * `links A: {"Label": "url", ...}` — several links on a participant at once,
 * as one JSON object. Mermaid 12.2.0 parses the text after the colon with
 * `JSON.parse`; `readLinksInto` does the same.
 */
const LINKS_RE = /^links\s+(\w+)\s*:\s*(.*)$/i;
/**
 * The lone participant id argument of a `destroy` statement: a word, or a
 * word and a `%%` with everything after it, with or without a space before
 * the `%%` (`\s*`) — `destroy B %% x` destroys "B %% x" and `destroy BC%%x`
 * destroys "BC%%x" (measured on Mermaid 12.2.0). `destroy B%%x`, a
 * one-character word run into its `%%`, is a comment to Mermaid's lexer and
 * is refused (`lexerCommentIn`).
 */
const DESTROY_ID_RE = /^(\w+(?:\s*%%.*)?)$/;

/**
 * The raw color argument to a `rect` block: `rgb(...)` or `rgba(...)`,
 * unvalidated beyond shape. A `%%` after it, with or without a space
 * (`\s*`), is captured to be refused: Mermaid 12.2.0 keeps it in the color
 * (`rect rgb(0,0,0) %% x` fills the block with "rgb(0,0,0) %% x", which is
 * not a color — measured), so the block is not drawn in the color written.
 */
const RECT_COLOR_RE = /^(rgba?\([^()]*\))(\s*%%.*)?$/d;

/**
 * Splits a `box` header's arguments into its leading token — an
 * `rgb()`/`rgba()` call, a `#hex` literal, or a bare word — and whatever
 * follows it.
 */
const BOX_HEADER_RE = /^(rgba?\([^()]*\)|#\w+|\w+)(?:\s+(.*))?$/d;

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
 * A participant's name where a message or a note names one: a word, and —
 * when a `%%` follows it — the `%%` and what follows it, up to a character in
 * `stops`. Mermaid 12.2.0's lexer reads a name there as a run of characters
 * that are not punctuation, `%` and spaces among them, so `A->>B %% x: m`
 * sends to "B %% x" and `note over A %% x: n` stands over "A %% x"
 * (measured). The `%%` may follow the word with or without a space (`\s*`):
 * `A->>BC%%x: m` sends to "BC%%x" — except after a one-character word,
 * where the lexer reads a comment instead, which the statement refuses
 * (`lexerCommentIn`). A name without a `%%` is still a word, as it always was
 * here. The match may end in spaces; the statement trims them.
 */
function nameUpTo(stops: string): string {
  return String.raw`\w+(?:\s*%%[^${stops}]*?)?`;
}

/** A message's sender or receiver: a name that runs up to the colon (the arrow ends a sender first). */
const MESSAGE_NAME = nameUpTo(":");

/**
 * A message: sender, arrow, target, `: text`. Nothing may sit between the
 * arrow and the target — in particular not the activation shorthand's
 * `+`/`-`, which `ACTIVATION_MESSAGE_RE` below claims instead.
 */
const MESSAGE_RE = new RegExp(`^(${MESSAGE_NAME})(${ARROW_ALTERNATION})(${MESSAGE_NAME})\\s*:\\s*(.*)$`, "d");

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
  `^(${MESSAGE_NAME})(${ARROW_ALTERNATION})([+-])(${MESSAGE_NAME})\\s*:\\s*(.*)$`,
  "d",
);
/**
 * `activate X` / `deactivate X` — the long form of the same activation bar.
 * Mermaid 12.2.0 reads the id to the line's end, `%%` included, with or
 * without a space before it (`\s*`): `activate B %% x` and `activate B%%x`
 * both activate a participant named so (measured). That is a participant
 * only if one by that name is already known (`ParserState.knownNames`);
 * otherwise the `%%` is refused (`refuseMidLinePercent`), since Mermaid
 * refuses `deactivate B %% x` ("Trying to inactivate an inactive
 * participant") and fails to draw `activate B %% x` (measured).
 */
const ACTIVATE_RE = /^activate\s+(\w+(?:\s*%%.*)?)$/di;
const DEACTIVATE_RE = /^deactivate\s+(\w+(?:\s*%%.*)?)$/di;
/**
 * `note over A,B: text` / `note over A: text` / `note right of A: text` /
 * `note left of A: text`. The participant-list group is `[\w,]+` rather
 * than two separate `\w+`s: `over` may name one or two ids, `right of`/
 * `left of` name exactly one, and splitting on `,` after the match reads
 * either shape without two regexes.
 */
const NOTE_NAME = nameUpTo(",:");
const NOTE_RE = new RegExp(
  `^note\\s+(over|right of|left of)\\s+(${NOTE_NAME}(?:,${NOTE_NAME})*)\\s*:\\s*(.*)$`,
  "di",
);

/**
 * Refuses the first `%%` in `match`'s group `group`, at that `%%`. `column`
 * is where the matched line begins.
 */
function refuseMidLinePercent(
  state: ParserState,
  match: RegExpExecArray,
  group: number,
  line: number,
  column: number,
): void {
  refuseMidLinePercentAt(state, line, column + match.indices![group]![0] + match[group]!.indexOf("%%"));
}

/** Refuses a mid-line `%%` at `line`:`column`; the document is not drawn. */
function refuseMidLinePercentAt(state: ParserState, line: number, column: number): void {
  state.diagnostics.push(midLinePercentError(line, column));
  state.sawError = true;
}

/**
 * Where a name read in the sequence lexer's main state starts a comment
 * instead: the offset of the `%%` in `name` when `name` is one character
 * followed at once by `%%`, else `null`. Mermaid 12.2.0's `[^\}]%%[^\n]*`
 * rule is tried before its name rule wherever a token starts, so `B%%x`
 * there is a comment from the `B` on, while `BC%%x` and `B %%x` are names
 * (measured: `A->>B%%x: m`, `note over A%%x: n` and `destroy B%%x` are
 * refused, `A%%x->>B: m` draws nothing for its line, and `A->>BC%%x: m`
 * sends to "BC%%x"). Siren refuses each such `%%` (ADR-0017, and ADR-0001
 * for the line Mermaid drops in silence). It holds for a message's sender
 * and receiver, a note's participants and `destroy` — not for `participant`,
 * `actor`, `activate` or `deactivate`, whose names the lexer reads in
 * another state, `%%` and all.
 */
function lexerCommentIn(name: string): number | null {
  return /^\w%%/.test(name) ? 1 : null;
}

/**
 * Refuses the first of `match`'s name groups `groups` that starts a comment
 * (`lexerCommentIn`), and steps past the line; whether one did. `column` is
 * where the matched line begins.
 */
function refusedNameComment(
  state: ParserState,
  match: RegExpExecArray,
  groups: readonly number[],
  line: number,
  column: number,
): boolean {
  for (const group of groups) {
    const at = lexerCommentIn(match[group]!);
    if (at !== null) {
      refuseMidLinePercentAt(state, line, column + match.indices![group]![0] + at);
      state.index++;
      return true;
    }
  }
  return false;
}

/**
 * Reads a braced `accDescr { ... }` opened on the current line, through the
 * shared `readAccDescrBlock` every kind with the statement uses, and leaves
 * `state.index` on the next line to read: the one after the `}`, or the `}`
 * line itself when a statement follows the brace there (`accDescr { one }
 * A->>B: x` draws the message, measured), blanked up to it. A block that
 * never closes is refused — see `readAccDescrBlock`.
 */
function readAccDescrBlockAt(state: ParserState, line: number, column: number): void {
  const block = readAccDescrBlock(state.lines, state.index, state.lines[state.index].indexOf("{"));
  if (!block.closed) {
    state.diagnostics.push({
      severity: "error",
      message: "Unclosed `accDescr { ... }` block: no `}` ends the description it opens",
      line,
      column,
    });
    state.sawError = true;
    state.index = state.lines.length;
    return;
  }
  state.accDescr = block.description;
  if (block.rest === null) {
    state.index = block.closeIndex + 1;
  } else {
    state.lines[block.closeIndex] = block.rest;
    state.index = block.closeIndex;
  }
}

/** Mutable cursor + accumulators threaded through the recursive-descent body parser. */
interface ParserState {
  readonly lines: string[];
  index: number;
  readonly diagnostics: Diagnostic[];
  readonly participants: SequenceParticipantDecl[];
  readonly participantIds: Set<string>;
  /**
   * Every name Mermaid has a participant for so far: declared, created, or
   * named by a message's end or a note. `activate`/`deactivate` of a name
   * holding a `%%` is read only for one of these (`ACTIVATE_RE`).
   */
  readonly knownNames: Set<string>;
  readonly boxes: SequenceBox[];
  sawError: boolean;
  title: string | null;
  accTitle: string | null;
  accDescr: string | null;
  readonly interactions: Interaction[];
  /** See `SequenceDocument.linkMentions`. */
  readonly linkMentions: SequenceLinkMention[];
}

/** Result of matching a line against a single leading keyword (e.g. `loop`, `end`). */
interface KeywordMatch {
  matched: boolean;
  /** Trimmed text after the keyword, or `""` when the line was just the bare keyword. */
  rest: string;
  /**
   * Where `rest` begins in the line, so a label read out of it reports a
   * problem at the column the author wrote it — `rest` is trimmed, so its
   * start is not simply the keyword's length plus one.
   */
  restIndex: number;
}

/**
 * Matches `line` against a leading keyword, requiring a word boundary (the
 * keyword alone, or the keyword followed by whitespace) so e.g. `"opt"`
 * never matches `"option"` and `"and"` never matches `"actor"`.
 *
 * The keyword is matched in any case, as Mermaid matches it (`Loop`, `END`);
 * the rest of the line keeps the author's own case, since it is a label.
 */
function matchLeadingKeyword(line: string, keyword: string): KeywordMatch {
  const lowered = line.toLowerCase();
  if (lowered === keyword) {
    return { matched: true, rest: "", restIndex: line.length };
  }
  if (lowered.startsWith(`${keyword} `)) {
    const after = line.slice(keyword.length + 1);
    const restIndex = keyword.length + 1 + (after.length - after.trimStart().length);
    return { matched: true, rest: after.trim(), restIndex };
  }
  return { matched: false, rest: "", restIndex: 0 };
}

/**
 * Reads the label capture group `group` of `match` holds in the `sequence`
 * dialect (ADR-0015: Mermaid draws sequence text as SVG in both modes, so
 * `<br>` breaks a row and every other tag is drawn as written), reporting
 * its problems onto the document's diagnostics. `at` is where the matched
 * text begins in the document, and the pattern must carry the `d` flag
 * (`readLabelAt`). An error costs the whole document, exactly as an
 * unrecognized line does.
 */
function readLabelInto(
  state: ParserState,
  match: RegExpExecArray,
  group: number,
  at: SourcePosition,
): Label {
  return recorded(state, readLabelAt(match, group, at, "sequence"));
}

/**
 * Reads `text` — the whole of it — as a label, or answers `null` for an
 * empty one: a block's or branch's condition, and a box's label, are each
 * optional, and none of them is a capture of a pattern of their own. `at` is
 * where `text` begins in the document.
 */
function readTextLabel(state: ParserState, text: string, at: SourcePosition): Label | null {
  return text === "" ? null : recorded(state, readTextAt(text, at, "sequence"));
}

/** `read`'s label, its diagnostics recorded onto the document's; an error costs the document. */
function recorded(state: ParserState, read: ReturnType<typeof readTextAt>): Label {
  state.diagnostics.push(...read.diagnostics);
  if (read.hasError) {
    state.sawError = true;
  }
  return read.label;
}

/**
 * Reads the text after a leading keyword (`loop every day`, `else ok`) as
 * its label, or `null` when the keyword stood alone. `at` is where the
 * keyword's line begins in the document.
 */
function readKeywordLabel(
  state: ParserState,
  keywordMatch: KeywordMatch,
  at: SourcePosition,
): Label | null {
  return readTextLabel(state, keywordMatch.rest, {
    line: at.line,
    column: at.column + keywordMatch.restIndex,
  });
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
function parseBoxHeader(
  state: ParserState,
  rest: string,
  at: SourcePosition,
): { color: string | null; label: Label | null } {
  const headerMatch = BOX_HEADER_RE.exec(rest);
  if (headerMatch === null) {
    return { color: null, label: readTextLabel(state, rest, at) };
  }

  const [, firstToken, remainder] = headerMatch;
  const isColor =
    firstToken.startsWith("#") ||
    firstToken.startsWith("rgb(") ||
    firstToken.startsWith("rgba(") ||
    CSS_NAMED_COLORS.has(firstToken.toLowerCase());

  if (!isColor) {
    return { color: null, label: readTextLabel(state, rest, at) };
  }
  // `rest` is trimmed and `\s+` takes the whitespace before the remainder,
  // so the remainder is the label exactly as written, and where it begins
  // is its group's own index.
  const label =
    remainder === undefined
      ? null
      : readTextLabel(state, remainder, {
          line: at.line,
          column: at.column + headerMatch.indices![2]![0],
        });
  return { color: firstToken, label };
}

/**
 * Records one `participant`/`actor` declaration — whether written in the
 * preamble (`origin: "declared"`) or mid-stream via `create`
 * (`origin: "created"`) — into the document's flat participants list, and
 * returns the statement that marks its position in the statement stream.
 *
 * `declMatch` must be a `PARTICIPANT_RE` match (for `create`, of the text
 * after the `create` keyword), and `matchedAt` where that text begins in
 * the document — the statement's own position for a declaration, but
 * past the keyword for `create`. The flat list keeps encounter order;
 * separating preamble lanes from `create`d ones for lane ordering is
 * `buildSequenceModel`'s job, not the parser's.
 */
function declareParticipant(
  state: ParserState,
  declMatch: RegExpExecArray,
  origin: SequenceParticipantOrigin,
  line: number,
  column: number,
  matchedAt: SourcePosition,
): SequenceParticipantStatement {
  const [, kindWord, id, alias] = declMatch;
  // `Participant` and `ACTOR` are Mermaid's spellings too: the keyword is
  // read in any case, and only the id and label keep the author's.
  const participantKind = kindWord.toLowerCase() as SequenceParticipantKind;
  const label =
    alias !== undefined ? readLabelInto(state, declMatch, 3, matchedAt) : plainLabel(id);

  state.knownNames.add(id);
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
  terminatorLabel: Label | null;
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
    const line = withoutCommentAfterSemicolon(rawLine.trim());
    const column = rawLine.length - rawLine.trimStart().length + 1;

    if (line.length === 0) {
      state.index++;
      continue;
    }

    let matchedTerminator: string | null = null;
    let terminatorLabel: Label | null = null;
    for (const term of terminators) {
      if (term === TIMELINE_HEADER_TERMINATOR) {
        if (isTimelineHeader(line)) {
          matchedTerminator = term;
          break;
        }
        continue;
      }
      // `end` holds no label, so a `%%` after it is a comment; the label of
      // `else`, `and` or `option` keeps one as text.
      const m = matchLeadingKeyword(term === "end" ? line.replace(COMMENT_AFTER_KEYWORDS, "") : line, term);
      if (m.matched) {
        matchedTerminator = term;
        terminatorLabel = readKeywordLabel(state, m, { line: lineNumber, column });
        break;
      }
    }
    if (matchedTerminator !== null) {
      state.index++;
      return { statements, terminatorKeyword: matchedTerminator, terminatorLabel };
    }

    const declMatch = PARTICIPANT_RE.exec(line);
    if (declMatch !== null) {
      statements.push(
        declareParticipant(state, declMatch, "declared", lineNumber, column, {
          line: lineNumber,
          column,
        }),
      );
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
      statements.push(
        declareParticipant(state, createdDeclMatch, "created", lineNumber, column, {
          line: lineNumber,
          column: column + createMatch.restIndex,
        }),
      );
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
      const commentAt = lexerCommentIn(idMatch[1]);
      if (commentAt !== null) {
        refuseMidLinePercentAt(state, lineNumber, column + destroyMatch.restIndex + commentAt);
        state.index++;
        continue;
      }
      // No check that the id was declared: an undeclared id is a participant
      // created by this mention, which `buildSequenceModel` resolves (ADR-0013).
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

    const accDescrMatch = ACC_DESCR_RE.exec(line);
    if (accDescrMatch !== null) {
      state.accDescr = accDescrMatch[1].trim();
      state.index++;
      continue;
    }

    const accDescrBlockMatch = ACC_DESCR_BLOCK_RE.exec(line);
    if (accDescrBlockMatch !== null) {
      readAccDescrBlockAt(state, lineNumber, column);
      continue;
    }

    const linksMatch = LINKS_RE.exec(line);
    if (linksMatch !== null) {
      readLinksInto(state, linksMatch[1], linksMatch[2], lineNumber, column);
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

    // Compared lowercased: Mermaid reads `Autonumber` and `AUTONUMBER OFF` too.
    const keywords = line.replace(COMMENT_AFTER_KEYWORDS, "").toLowerCase();
    if (keywords === "autonumber") {
      statements.push({ kind: "autonumberOn", line: lineNumber, column });
      state.index++;
      continue;
    }

    if (keywords === "autonumber off") {
      statements.push({ kind: "autonumberOff", line: lineNumber, column });
      state.index++;
      continue;
    }

    const messageMatch = MESSAGE_RE.exec(line);
    if (messageMatch !== null) {
      const [, sender, arrowToken, receiver] = messageMatch;
      if (refusedNameComment(state, messageMatch, [1, 3], lineNumber, column)) continue;
      const [from, to] = [sender.trimEnd(), receiver.trimEnd()];
      state.knownNames.add(from).add(to);
      const arrowDef = ARROW_TOKENS.find((a) => a.token === arrowToken);
      // arrowDef is always found: arrowToken can only be one of ARROW_TOKENS'
      // own tokens, since it is exactly what the alternation matched.
      statements.push({
        kind: "message",
        from,
        to,
        label: readLabelInto(state, messageMatch, 4, { line: lineNumber, column }),
        arrow: { line: arrowDef!.line, head: arrowDef!.head },
        line: lineNumber,
        column,
      });
      state.index++;
      continue;
    }

    const activationMatch = ACTIVATION_MESSAGE_RE.exec(line);
    if (activationMatch !== null) {
      const [, sender, arrowToken, marker, receiver] = activationMatch;
      if (refusedNameComment(state, activationMatch, [1, 4], lineNumber, column)) continue;
      const [from, to] = [sender.trimEnd(), receiver.trimEnd()];
      state.knownNames.add(from).add(to);
      const arrowDef = ARROW_TOKENS.find((a) => a.token === arrowToken);
      statements.push({
        kind: "message",
        from,
        to,
        label: readLabelInto(state, activationMatch, 5, { line: lineNumber, column }),
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
      if (activateMatch[1].includes("%%") && !state.knownNames.has(activateMatch[1])) {
        refuseMidLinePercent(state, activateMatch, 1, lineNumber, column);
      } else {
        statements.push({ kind: "activate", id: activateMatch[1], line: lineNumber, column });
      }
      state.index++;
      continue;
    }

    const deactivateMatch = DEACTIVATE_RE.exec(line);
    if (deactivateMatch !== null) {
      if (deactivateMatch[1].includes("%%") && !state.knownNames.has(deactivateMatch[1])) {
        refuseMidLinePercent(state, deactivateMatch, 1, lineNumber, column);
      } else {
        statements.push({ kind: "deactivate", id: deactivateMatch[1], line: lineNumber, column });
      }
      state.index++;
      continue;
    }

    const noteMatch = NOTE_RE.exec(line);
    if (noteMatch !== null) {
      const [, keyword, participantList] = noteMatch;
      let offset = noteMatch.indices![2]![0];
      let commentAt: number | null = null;
      for (const name of participantList.split(",")) {
        const at = lexerCommentIn(name);
        if (at !== null) {
          commentAt = offset + at;
          break;
        }
        offset += name.length + 1;
      }
      if (commentAt !== null) {
        refuseMidLinePercentAt(state, lineNumber, column + commentAt);
        state.index++;
        continue;
      }
      const ids = participantList.split(",").map((id) => id.trim());
      for (const id of ids) state.knownNames.add(id);
      // Mermaid reads the keyword and its position words in any case
      // (`Note LEFT OF A` draws on the left), so the position is lowercased
      // before it is read.
      const position = keyword.toLowerCase();
      const placement: SequenceNotePlacement =
        position === "over" ? "over" : position === "right of" ? "right" : "left";
      statements.push({
        kind: "note",
        placement,
        from: ids[0],
        // A single-participant `over`/`right of`/`left of` has nothing to
        // pair with, so `to` mirrors `from` rather than being left unset —
        // the same "from and to are the same id" shape a flowchart's own
        // self-edge already models.
        to: ids.length > 1 ? ids[1] : ids[0],
        label: readLabelInto(state, noteMatch, 3, { line: lineNumber, column }),
        line: lineNumber,
        column,
      });
      state.index++;
      continue;
    }

    const boxMatch = matchLeadingKeyword(line, "box");
    if (boxMatch.matched) {
      state.index++;
      const { color, label } = parseBoxHeader(state, boxMatch.rest, {
        line: lineNumber,
        column: column + boxMatch.restIndex,
      });
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
      const label = readKeywordLabel(state, loopMatch, { line: lineNumber, column });
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
      const label = readKeywordLabel(state, optMatch, { line: lineNumber, column });
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
      const label = readKeywordLabel(state, breakMatch, { line: lineNumber, column });
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
      if (colorMatch !== null && colorMatch[2] !== undefined) {
        refuseMidLinePercent(state, colorMatch, 2, lineNumber, column + rectMatch.restIndex);
        parseBody(state, ["end"]);
        continue;
      }
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
        readKeywordLabel(state, altMatch, { line: lineNumber, column }),
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
        readKeywordLabel(state, parMatch, { line: lineNumber, column }),
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
        readKeywordLabel(state, criticalMatch, { line: lineNumber, column }),
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
function parseBranches<TBranch extends { label: Label | null; body: SequenceStatement[] }>(
  state: ParserState,
  branchKeyword: string,
  firstLabel: Label | null,
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
 * Records one href interaction per entry of a `links` statement's JSON
 * object, in the object's own order, each entry's key as the label (carried
 * as `tooltip`, exactly as `link A: Label @ url` carries its label).
 */
function readLinksInto(
  state: ParserState,
  targetId: string,
  json: string,
  line: number,
  column: number,
): void {
  const added = readLinkEntries(state, targetId, json, line, column);
  if (added === 0) state.linkMentions.push({ targetId, line, column });
}

/** Pushes the links a `links` statement's JSON names; returns how many it added. */
function readLinkEntries(
  state: ParserState,
  targetId: string,
  json: string,
  line: number,
  column: number,
): number {
  const warn = (why: string): void => {
    state.diagnostics.push({
      severity: "warning",
      message: `links ${targetId}: ${why}; no link is added`,
      line,
      column,
    });
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    warn("the text after the colon is not JSON");
    return 0;
  }
  // Mermaid 12.2.0 iterates whatever `JSON.parse` returned with `for...in`
  // (measured), so an array or a string draws links labelled "0", "1", ...
  // and a number, `true` or `null` draws none. `Object.entries` walks the
  // same keys in the same order.
  const entries =
    typeof parsed === "string" || (typeof parsed === "object" && parsed !== null)
      ? Object.entries(parsed)
      : [];
  if (entries.length === 0) {
    warn("the JSON names no links");
    return 0;
  }

  let added = 0;
  for (const [label, value] of entries) {
    // Mermaid 12.2.0 records a non-string value as written ({"H": 5}) and
    // then fails to render the diagram, or for null/false/0 draws an entry
    // linking to about:blank. Siren draws the entry its db records, with
    // the value's text as the href, and says so.
    const url = typeof value === "string" ? value : String(value);
    if (typeof value !== "string") {
      state.diagnostics.push({
        severity: "warning",
        message: `links ${targetId}: the link "${label}" has a value that is not a string; it links to "${url}"`,
        line,
        column,
      });
    }
    state.interactions.push({
      interactionKind: "href",
      targetId,
      action: url,
      argument: null,
      tooltip: label,
      line,
      column,
    });
    added++;
  }
  return added;
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
export function parseSequenceDiagram(source: string): DiagramParseResult {
  const lines = source.split(/\r\n|\r|\n/);
  const diagnostics: Diagnostic[] = [];

  const state: ParserState = {
    lines,
    index: 0,
    diagnostics,
    participants: [],
    participantIds: new Set<string>(),
    knownNames: new Set<string>(),
    boxes: [],
    sawError: false,
    title: null,
    accTitle: null,
    accDescr: null,
    interactions: [],
    linkMentions: [],
  };

  while (state.index < lines.length && lines[state.index].trim().length === 0) {
    state.index++;
  }

  if (state.index >= lines.length) {
    return { document: null, diagnostics };
  }

  const headerRawLine = lines[state.index];
  const headerLine = headerRawLine.replace(COMMENT_AFTER_HEADER, "").trim();
  const headerColumn = headerRawLine.length - headerRawLine.trimStart().length + 1;
  if (matchDiagramHeader(headerLine) !== "sequence") {
    diagnostics.push({
      severity: "error",
      message: `Expected ${SEQUENCE_HEADER_SPELLINGS}, found "${headerLine}"`,
      line: state.index + 1,
      column: headerColumn,
    });
    return { document: null, diagnostics };
  }
  state.index++;

  const { statements, terminatorKeyword } = parseBody(state, [TIMELINE_HEADER_TERMINATOR]);

  // Once a timeline header has ended the body, every line after it belongs
  // to some timeline block — the same one-way switch `parseFlowchart` and
  // `parseClassDiagram` make, so a sequence statement written after it is a
  // timeline diagnostic rather than something that silently parses as
  // structure. Its lines go through the shared grammar, never a
  // sequence-specific copy of it.
  let timeline: SirenTimeline | null = null;
  let namedTimelines: NamedTimeline<SirenTimeline>[] = [];
  if (terminatorKeyword === TIMELINE_HEADER_TERMINATOR) {
    // `parseBody` steps past whichever terminator it stopped at before
    // returning, so the header that ended the body is the line just behind
    // `state.index` — and `parseTimelineBlocks` wants the header itself, to
    // read whether it is named.
    const blocks = parseTimelineBlocks(lines, state.index - 1);
    diagnostics.push(...blocks.diagnostics);
    // Every diagnostic the shared grammar reports is error-severity, so a
    // non-empty list is exactly what used to be a per-line `sawError = true`.
    if (blocks.diagnostics.length > 0) {
      state.sawError = true;
    }
    timeline = blocks.timeline;
    namedTimelines = blocks.namedTimelines;
  }

  if (state.sawError) {
    return { document: null, diagnostics };
  }

  const hasBody =
    state.title !== null ||
    state.accTitle !== null ||
    state.accDescr !== null ||
    state.participants.length > 0 ||
    state.interactions.length > 0 ||
    state.linkMentions.length > 0 ||
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
    accDescr: state.accDescr,
    interactions: state.interactions,
    ...(state.linkMentions.length > 0 ? { linkMentions: state.linkMentions } : {}),
    participants: state.participants,
    boxes: state.boxes,
    statements,
    timeline,
    ...namedTimelinesField(namedTimelines),
  };

  return { document, diagnostics };
}
