import type { Diagnostic, ParseResult } from "../contracts";
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
const PARSE_KIND: Record<DiagramKind, (source: string) => ParseResult> = {
  flowchart: parseFlowchart,
  sequence: parseSequenceDiagram,
  class: parseClassDiagram,
  state: parseStateDiagram,
  er: parseErDiagram,
};

/**
 * Removes `%%` comments from `source`, keeping one output line per input
 * line so every diagnostic's line number still points at the line the
 * author wrote — in Mermaid's two steps, with its style-line rule
 * (`styleLines`) between them.
 *
 * Comment stripping lives here, in the dispatcher, rather than in each
 * kind's parser: it is one rule for the whole language, and putting it
 * here is what gives every kind the same behavior without five
 * implementations of it. The style-line rule is the same kind of rule, so
 * it lives here too.
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
 * A `%%{init: ...}%%` directive is therefore stripped as an ordinary
 * comment. Directives are not supported by any Siren parser, so this
 * makes them inert rather than a syntax error.
 */
function withoutComments(source: string): {
  lines: string[];
  asWritten: <T>(result: T) => T;
} {
  const wholeLinesBlanked = tagQuotesRewritten(source)
    .split(/\r\n|\r|\n/)
    .map((line) => (line.trimStart().startsWith("%%") ? "" : line));
  const read = styleLines(wholeLinesBlanked.join("\n"));
  const lines = read.source.split("\n").map((line) => {
    const commentStart = line.indexOf("%%");
    return commentStart === -1 ? line : line.slice(0, commentStart);
  });
  return { lines, asWritten: read.asWritten };
}

/**
 * Sniffs the first non-blank line of Siren source text and dispatches to
 * `parseFlowchart` (a `flowchart TB|BT|LR|RL` header, or the same header
 * written with Mermaid's original `graph` keyword) or `parseSequenceDiagram`
 * (`sequenceDiagram` header), after stripping `%%` comments from the whole
 * document and applying Mermaid's style-line rule (`withoutComments`).
 * Never throws on malformed input — an unrecognized header is reported as
 * a diagnostic instead.
 */
export function parseSiren(source: string): ParseResult {
  const { lines, asWritten } = withoutComments(source);
  return asWritten(dispatch(lines));
}

/**
 * `parseSiren`'s reading of `lines`, the document without its comments and
 * with Mermaid's style-line rule applied: every position it finds is in
 * those lines.
 */
function dispatch(lines: readonly string[]): ParseResult {
  const firstNonBlankIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstNonBlankIndex === -1) {
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

  const rawLine = lines[firstNonBlankIndex];
  const trimmed = rawLine.trim();
  // The comment-free source every per-kind parser sees. Line count and
  // line order are untouched, so their diagnostics' line numbers still
  // match the document the author wrote.
  const strippedSource = lines.join("\n");

  const kind = matchDiagramHeader(trimmed);
  if (kind !== null) {
    return PARSE_KIND[kind](strippedSource);
  }

  const column = rawLine.length - rawLine.trimStart().length + 1;
  const diagnostics: Diagnostic[] = [
    {
      severity: "error",
      message: `Expected ${HEADER_SPELLINGS}, found "${trimmed}"`,
      line: firstNonBlankIndex + 1,
      column,
    },
  ];
  return { document: null, diagnostics };
}
