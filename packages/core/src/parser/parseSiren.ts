import type { DiagramParseResult, Diagnostic, ParseResult } from "../contracts";
import {
  type DirectivesRead,
  documentConfigOf,
  type FrontmatterRead,
  readDirectives,
  readFrontmatter,
} from "./documentConfig";
import { parseClassDiagram } from "./parseClassDiagram";
import { parseErDiagram } from "./parseErDiagram";
import { type DiagramKind, listAcceptedHeaders, matchDiagramHeader } from "./parseDirection";
import { parseFlowchart } from "./parseFlowchart";
import { parseSequenceDiagram } from "./parseSequenceDiagram";
import { parseStateDiagram } from "./parseStateDiagram";
import { isTimelineHeader } from "./parseTimelineBlock";
import { styleLines } from "./styleLines";
import { tagQuotesRewritten } from "./tagQuotes";

/**
 * Every spelling the language accepts, with no kind named here — so this
 * message gains a kind's headers on the day `parseDirection` does, rather
 * than on the day someone remembers that it, too, keeps a list.
 */
const HEADER_SPELLINGS = listAcceptedHeaders();

/**
 * Which parser each kind's header hands the document to. The header itself
 * is not matched here: `matchDiagramHeader` names the kind, and this record
 * only says who parses it, so the two facts cannot disagree about which
 * spellings exist.
 */
const PARSE_KIND: Record<DiagramKind, (source: string) => DiagramParseResult> = {
  flowchart: parseFlowchart,
  sequence: parseSequenceDiagram,
  class: parseClassDiagram,
  state: parseStateDiagram,
  er: parseErDiagram,
};

/**
 * The lines of `source` as Mermaid reads them before any diagram's grammar
 * sees them: its tag quotes rewritten (`tagQuotesRewritten`), its
 * frontmatter and directives read and blanked (`readFrontmatter`,
 * `readDirectives`), its `%%` comments removed in Mermaid's two steps, and its style-line rule
 * (`styleLines`) applied between those steps. It keeps one output line per
 * input line, so every diagnostic's line number still points at the line
 * the author wrote, and `asWritten` maps what the style-line rule changed
 * back to the source as written.
 *
 * These rules live here, in the dispatcher, rather than in each kind's
 * parser: each is one rule for the whole language, and putting them here
 * is what gives every kind the same behavior without five implementations
 * of them.
 *
 * The rule is Mermaid's (CONTEXT.md **Comment**): a comment is a whole
 * line whose first non-blank characters are `%%`, indented or not, and it
 * is removed here. A `%%` later on a line is not removed by Mermaid's
 * `cleanupComments` at all; what it means is each kind's grammar's — text
 * inside a label, a refusal after a complete statement, a comment only
 * where a kind's lexer reads one. So `lines` cuts each line at its first
 * `%%` only for the kinds still read that way (`CUTS_MID_LINE_COMMENTS`),
 * and `linesAsRead` keeps every line as Mermaid's grammar is handed it, for
 * the kinds that read their own `%%`.
 *
 * Except a line that is nothing but `%%` (`bareCommentLines`). Mermaid's
 * `cleanupComments` removes `^\s*%%(?!{)[^\n]+\n?`, so a whole-line
 * comment needs at least one character — a space will do — after its
 * `%%`; a bare `%%` is left to the diagram's grammar. What that grammar
 * makes of it differs by kind (`bareCommentMessage`), so the line is still
 * blanked here and the kind decides, once the header is known, whether the
 * document is refused for it (ADR-0017).
 *
 * Mermaid's order matters for one thing. Its `cleanupComments` removes only
 * whole-line comments, and then its `encodeEntities` drops a style line's
 * last `;` — so on a line with a mid-line `%%`, that `;` may be after it:
 * measured (11.17.2), a state diagram's
 * `state "<span style='color:#f00;'>r</span>" as A %% x;` keeps its color's
 * `;`, so its color is an entity code and `r` is drawn uncolored. Here,
 * too, whole-line comments go first, then `styleLines`, then — for a kind
 * that still cuts them — mid-line `%%`s.
 *
 * Before any of them comes Mermaid's first step, its `cleanupText`
 * (`tagQuotesRewritten`): it runs over the document as written, comments
 * included, so a tag-shaped stretch a comment opens can still be ended by a
 * `>` on a later line. It changes no length and no line break, so it needs
 * no `asWritten`.
 *
 * Then, where Mermaid's `preprocessDiagram` reads it — after `cleanupText`,
 * before directives or comments — the frontmatter (`readFrontmatter`). Its
 * lines are blanked rather than removed, so the line count is unchanged and
 * nothing it holds, a `%%` included, is read as diagram text. It is read on
 * the document with its line breaks made `\n`, as `cleanupText` makes them;
 * the lines are split on every spelling of a line break either way, so no
 * column moves.
 *
 * Then, still before any comment, the `%%{…}%%` directives
 * (`readDirectives`), where `preprocessDiagram` reads them: each is read and
 * blanked in place, line breaks kept, wherever it stands and however many
 * lines it spans. It has to come first: the comment rule below is
 * line-wise, so it would remove only the `%%{` line of an init spread over
 * several, and leave the rest to be read as diagram text — which no diagram
 * accepts (measured on 12.2.0: Mermaid reads such an init whole and draws
 * the diagram below it).
 */
function asMermaidReads(source: string): {
  lines: string[];
  linesAsRead: string[];
  asWritten: <T>(result: T) => T;
  frontmatter: FrontmatterRead;
  directives: DirectivesRead;
  bareCommentLines: BareCommentLine[];
} {
  const frontmatter = readFrontmatter(tagQuotesRewritten(source).split(/\r\n|\r|\n/).join("\n"));
  const directives = readDirectives(frontmatter.source);
  const linesAsWritten = directives.source.split("\n");
  const bareCommentLines = linesAsWritten.flatMap((line, index) =>
    line.trimStart() === "%%" ? [{ line: index + 1, column: line.length - 1 }] : [],
  );
  const wholeLinesBlanked = linesAsWritten.map((line) =>
    line.trimStart().startsWith("%%") ? "" : line,
  );
  const read = styleLines(wholeLinesBlanked.join("\n"));
  const linesAsRead = read.source.split("\n");
  const lines = linesAsRead.map(endOfLineCommentStripped);
  return { lines, linesAsRead, asWritten: read.asWritten, frontmatter, directives, bareCommentLines };
}

/** `line` without everything from its first `%%` on. */
function endOfLineCommentStripped(line: string): string {
  const commentStart = line.indexOf("%%");
  return commentStart === -1 ? line : line.slice(0, commentStart);
}

/**
 * Whether a kind's parser is handed its lines with everything from a
 * mid-line `%%` on already cut away — the rule every kind followed before
 * CONTEXT.md's **Comment** was measured.
 *
 * Mermaid 12.2.0 cuts nothing mid-line: its `cleanupComments` removes whole
 * lines only, and what a `%%` later on a line means is each grammar's own —
 * text where the line holds text, a refusal where the grammar has no room
 * for it, and a comment only where a kind's lexer reads one. So `false` is
 * where every kind is going: its parser sees the line as written and
 * decides. `true` is the old cut, kept for a kind until its own reading is
 * measured and written — one kind at a time, so each switch is one change.
 * A record rather than a switch, as `PARSE_KIND` is, so a new kind cannot
 * arrive without this decision.
 */
const CUTS_MID_LINE_COMMENTS: Record<DiagramKind, boolean> = {
  flowchart: false,
  sequence: true,
  class: true,
  state: true,
  er: true,
};

/** Where a line that is nothing but `%%` starts its `%%`, as the author wrote it. */
interface BareCommentLine {
  line: number;
  column: number;
}

const BARE_COMMENT_IS_NOT = 'A line that is nothing but "%%" is not a comment: a comment needs text after its "%%"';
const BARE_COMMENT_HINT = ' Write "%% text", or leave the line blank.';
const BARE_COMMENT_DRAWN = `${BARE_COMMENT_IS_NOT}, and Mermaid draws this line as a node named "%%".${BARE_COMMENT_HINT}`;
const BARE_COMMENT_REFUSED = `${BARE_COMMENT_IS_NOT}; Mermaid refuses the document too.${BARE_COMMENT_HINT}`;

/**
 * What Mermaid makes of a bare `%%` line in each kind, as the refusal to
 * give for it (measured on 12.2.0), given whether the line stands below the
 * kind's header. `null` where the kind's grammar reads the line as a
 * comment after all (sequence, class and state: their lexers have a `%%`
 * rule of their own), so it means here what it means there. A flowchart
 * draws the line as a node below its header and refuses the document above
 * it; an ER diagram refuses it anywhere. A record rather than a switch, as
 * `PARSE_KIND` is, so a new kind cannot arrive without this decision.
 */
const BARE_COMMENT_MESSAGE: Record<DiagramKind, (belowHeader: boolean) => string | null> = {
  flowchart: (belowHeader) => (belowHeader ? BARE_COMMENT_DRAWN : BARE_COMMENT_REFUSED),
  sequence: () => null,
  class: () => null,
  state: () => null,
  er: () => BARE_COMMENT_REFUSED,
};

/** `BARE_COMMENT_MESSAGE` for the line `at`, in a document of `header`'s kind. */
function bareCommentMessage(header: Header | null, at: BareCommentLine): string | null {
  return header?.kind ? BARE_COMMENT_MESSAGE[header.kind](at.line > header.index + 1) : null;
}

/**
 * Sniffs the first non-blank line of Siren source text and dispatches to
 * `parseFlowchart` (a `flowchart TB|BT|LR|RL` header, or the same header
 * written with Mermaid's original `graph` keyword) or `parseSequenceDiagram`
 * (`sequenceDiagram` header), after reading the whole document as Mermaid
 * does — tag quotes, frontmatter, directives, `%%` comments and the
 * style-line rule (`asMermaidReads`). A kind that reads its own mid-line
 * `%%` (`CUTS_MID_LINE_COMMENTS`) is handed its lines as Mermaid's grammar
 * is, up to its first timeline header; a timeline block's lines are always
 * cut at their first `%%`.
 * Never throws on malformed input — an unrecognized header is reported as
 * a diagnostic instead.
 *
 * The **document config** — the frontmatter's merged with the directives'
 * (`documentConfigOf`), each init's `config` moved under the key of the kind
 * the header names — is `config` on the result, added after `asWritten` has
 * moved the diagram's positions: it is the author's data as written, and a
 * config key spelled `line` or `column` is not a position to move. Its
 * diagnostics come first, as its lines do. A
 * frontmatter Mermaid refuses — one that is not YAML, or whose
 * `displayMode` has no mapping to go into — refuses the whole document
 * here too, as its one error, and the diagram below it is not read; so does
 * a wrap directive Mermaid cannot write into a bare-word init. So does a
 * line that is nothing but `%%` in a flowchart or an ER diagram, outside
 * its timeline blocks, one error at each such line's `%%` (ADR-0017):
 * Mermaid does not read it as a comment there.
 */
export function parseSiren(source: string): ParseResult {
  const { lines, linesAsRead, asWritten, frontmatter, directives, bareCommentLines } =
    asMermaidReads(source);
  for (const read of [frontmatter, directives]) {
    if (read.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return { document: null, diagnostics: read.diagnostics, config: {} };
    }
  }
  // One reading of the header serves both: `dispatch` hands the document to
  // the kind it names, and Mermaid's `detectInit` files an init's `config`
  // under that kind's diagram type.
  const header = headerOf(lines);
  // A timeline block is not Mermaid's to read (ADR-0017: the document
  // without its timeline blocks is the Mermaid one), so a bare `%%` inside
  // one stays a comment. The first timeline header after the diagram's
  // header ends the diagram body, as every kind's parser ends it.
  const timelineStart = header === null ? Infinity : firstTimelineHeader(lines, header.index);
  const bareCommentRefusals = bareCommentLines.flatMap((at): Diagnostic[] => {
    if (at.line - 1 >= timelineStart) return [];
    const message = bareCommentMessage(header, at);
    return message === null ? [] : [{ severity: "error", message, ...at }];
  });
  if (bareCommentRefusals.length > 0) {
    return { document: null, diagnostics: bareCommentRefusals, config: {} };
  }
  const documentConfig = documentConfigOf(frontmatter, directives, header?.kind ?? null);
  // The lines the kind's parser reads: every one as Mermaid hands it to the
  // grammar, unless the kind still cuts a mid-line `%%` away
  // (`CUTS_MID_LINE_COMMENTS`). A timeline block is Siren's own syntax, not
  // Mermaid's, so its lines keep that cut whatever the kind.
  const linesForKind =
    header?.kind && !CUTS_MID_LINE_COMMENTS[header.kind]
      ? linesAsRead.map((line, index) => (index < timelineStart ? line : lines[index]!))
      : lines;
  const { document, diagnostics } = asWritten(dispatch(linesForKind, header));
  return { document, diagnostics: [...documentConfig.diagnostics, ...diagnostics], config: documentConfig.config };
}

/**
 * The document's header: the first line of `lines` that is not blank, its
 * index, and the kind it names (`null` when it names none). `null` when
 * every line is blank.
 */
interface Header {
  index: number;
  kind: DiagramKind | null;
}

function headerOf(lines: readonly string[]): Header | null {
  const index = lines.findIndex((line) => line.trim().length > 0);
  return index === -1 ? null : { index, kind: matchDiagramHeader(lines[index]!.trim()) };
}

/**
 * The index of the first timeline header below the diagram's header at
 * `headerIndex` — where its body ends and its timeline blocks begin —
 * or `Infinity` when the document has none.
 */
function firstTimelineHeader(lines: readonly string[], headerIndex: number): number {
  const index = lines.findIndex((line, i) => i > headerIndex && isTimelineHeader(line.trim()));
  return index === -1 ? Infinity : index;
}

/**
 * `parseSiren`'s reading of `lines`, the document without its whole-line comments and
 * with Mermaid's style-line rule applied, whose `header` is `headerOf(lines)`:
 * every position it finds is in those lines.
 */
function dispatch(lines: readonly string[], header: Header | null): DiagramParseResult {
  if (header === null) {
    const diagnostics: Diagnostic[] = [
      {
        severity: "error",
        message: `Empty document: expected a ${HEADER_SPELLINGS} header`,
        line: 1,
        column: 1,
      },
    ];
    return { document: null, diagnostics };
  }

  if (header.kind !== null) {
    // The source every per-kind parser sees, whole-line comments removed. Line count and
    // line order are untouched, so their diagnostics' line numbers still
    // match the document the author wrote.
    return PARSE_KIND[header.kind](lines.join("\n"));
  }

  const rawLine = lines[header.index]!;
  const trimmed = rawLine.trim();
  const column = rawLine.length - rawLine.trimStart().length + 1;
  const diagnostics: Diagnostic[] = [
    {
      severity: "error",
      message: `Expected ${HEADER_SPELLINGS}, found "${trimmed}"`,
      line: header.index + 1,
      column,
    },
  ];
  return { document: null, diagnostics };
}
