import type { Diagnostic, ParseResult } from "../contracts";
import { parseClassDiagram } from "./parseClassDiagram";
import { parseFlowchart } from "./parseFlowchart";
import { parseSequenceDiagram } from "./parseSequenceDiagram";

const FLOWCHART_HEADER_RE = /^flowchart\s+(TD|TB|BT|LR|RL)\s*$/;
// Spelled out rather than derived from the regex: a diagnostic is read by an
// author, and `TD` is deliberately absent — it parses, but `TB` is the
// spelling to teach.
const HEADER_SPELLINGS =
  `"flowchart TB", "flowchart BT", "flowchart LR", "flowchart RL", "sequenceDiagram", or "classDiagram"`;
const SEQUENCE_HEADER_RE = /^sequenceDiagram\s*$/;
const CLASS_HEADER_RE = /^classDiagram(?:-v2)?\s*$/;

/**
 * Removes `%%` comments from every line of `source`, keeping one output
 * line per input line so every diagnostic's line number still points at
 * the line the author wrote.
 *
 * Comment stripping lives here, in the dispatcher, rather than in each
 * kind's parser: it is one rule for the whole language, and putting it
 * here is what gives flowchart, sequence and class documents the same
 * behavior without three implementations of it.
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
 * A `%%{init: ...}%%` directive is therefore stripped as an ordinary
 * comment. Directives are not supported by any Siren parser, so this
 * makes them inert rather than a syntax error.
 */
function stripComments(lines: readonly string[]): string[] {
  return lines.map((line) => {
    const commentStart = line.indexOf("%%");
    return commentStart === -1 ? line : line.slice(0, commentStart);
  });
}

/**
 * Sniffs the first non-blank line of Siren source text and dispatches to
 * `parseFlowchart` (`flowchart TB|BT|LR|RL` header) or `parseSequenceDiagram`
 * (`sequenceDiagram` header), after stripping `%%` comments from the whole
 * document. Never throws on malformed input — an unrecognized header is
 * reported as a diagnostic instead.
 */
export function parseSiren(source: string): ParseResult {
  const lines = stripComments(source.split(/\r\n|\r|\n/));
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

  if (SEQUENCE_HEADER_RE.test(trimmed)) {
    return parseSequenceDiagram(strippedSource);
  }

  if (FLOWCHART_HEADER_RE.test(trimmed)) {
    return parseFlowchart(strippedSource);
  }

  if (CLASS_HEADER_RE.test(trimmed)) {
    return parseClassDiagram(strippedSource);
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
