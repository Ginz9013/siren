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
 * The rule is Mermaid's: a comment runs from the first `%%` on a line to
 * the end of that line, whether the line is nothing but a comment, an
 * indented comment, or a comment trailing real syntax (`A --> B %% note`).
 * It is deliberately **line-wise and context-free** — a `%%` inside a
 * quoted string, a bracket label or message text also starts a comment,
 * and there is no escape for a literal `%%`. That matches what Mermaid
 * does (it strips comments before its grammar ever sees the line), so a
 * document that renders in Mermaid renders the same way here; a
 * quote-aware rule would be a silent divergence instead.
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
 * last `;` — so on a line with an end-of-line comment, that `;` may be the
 * comment's: measured (11.17.2), a state diagram's
 * `state "<span style='color:#f00;'>r</span>" as A %% x;` keeps its color's
 * `;`, so its color is an entity code and `r` is drawn uncolored. Here,
 * too, whole-line comments go first, then `styleLines`, then end-of-line
 * comments.
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
  const lines = read.source.split("\n").map((line) => {
    const commentStart = line.indexOf("%%");
    return commentStart === -1 ? line : line.slice(0, commentStart);
  });
  return { lines, asWritten: read.asWritten, frontmatter, directives, bareCommentLines };
}

/** Where a line that is nothing but `%%` starts its `%%`, as the author wrote it. */
interface BareCommentLine {
  line: number;
  column: number;
}

const BARE_COMMENT_DRAWN =
  'A line that is nothing but "%%" is not a comment: a comment needs text after its "%%", ' +
  'and Mermaid draws this line as a node named "%%". Write "%% text", or leave the line blank.';
const BARE_COMMENT_REFUSED =
  'A line that is nothing but "%%" is not a comment: a comment needs text after its "%%"; ' +
  'Mermaid refuses the document too. Write "%% text", or leave the line blank.';

/**
 * What Mermaid makes of a bare `%%` line `at` in a document of `header`'s
 * kind, as the refusal to give for it — `null` where the kind's grammar
 * reads the line as a comment after all (sequence, class and state: their
 * lexers have a `%%` rule of their own), so it means here what it means
 * there. A flowchart draws the line as a node below its header and refuses
 * the document above it; an ER diagram refuses it anywhere.
 */
function bareCommentMessage(header: Header | null, at: BareCommentLine): string | null {
  switch (header?.kind) {
    case "flowchart":
      return at.line > header.index + 1 ? BARE_COMMENT_DRAWN : BARE_COMMENT_REFUSED;
    case "er":
      return BARE_COMMENT_REFUSED;
    default:
      return null;
  }
}

/**
 * Sniffs the first non-blank line of Siren source text and dispatches to
 * `parseFlowchart` (a `flowchart TB|BT|LR|RL` header, or the same header
 * written with Mermaid's original `graph` keyword) or `parseSequenceDiagram`
 * (`sequenceDiagram` header), after reading the whole document as Mermaid
 * does — tag quotes, frontmatter, directives, `%%` comments and the
 * style-line rule (`asMermaidReads`).
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
 * line that is nothing but `%%` in a flowchart or an ER diagram, one error
 * at each such line's `%%` (ADR-0017): Mermaid does not read it as a
 * comment there.
 */
export function parseSiren(source: string): ParseResult {
  const { lines, asWritten, frontmatter, directives, bareCommentLines } = asMermaidReads(source);
  for (const read of [frontmatter, directives]) {
    if (read.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return { document: null, diagnostics: read.diagnostics, config: {} };
    }
  }
  // One reading of the header serves both: `dispatch` hands the document to
  // the kind it names, and Mermaid's `detectInit` files an init's `config`
  // under that kind's diagram type.
  const header = headerOf(lines);
  const bareCommentRefusals = bareCommentLines.flatMap((at): Diagnostic[] => {
    const message = bareCommentMessage(header, at);
    return message === null ? [] : [{ severity: "error", message, ...at }];
  });
  if (bareCommentRefusals.length > 0) {
    return { document: null, diagnostics: bareCommentRefusals, config: {} };
  }
  const documentConfig = documentConfigOf(frontmatter, directives, header?.kind ?? null);
  const { document, diagnostics } = asWritten(dispatch(lines, header));
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
 * `parseSiren`'s reading of `lines`, the document without its comments and
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
    // The comment-free source every per-kind parser sees. Line count and
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
