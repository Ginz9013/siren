import type { Diagnostic, ParseResult } from "../contracts";
import { parseFlowchart } from "./parseFlowchart";
import { parseSequenceDiagram } from "./parseSequenceDiagram";

const FLOWCHART_HEADER_RE = /^flowchart\s+(TD|LR)\s*$/;
const SEQUENCE_HEADER_RE = /^sequenceDiagram\s*$/;

/**
 * Sniffs the first non-blank line of Siren source text and dispatches to
 * `parseFlowchart` (`flowchart TD|LR` header) or `parseSequenceDiagram`
 * (`sequenceDiagram` header). Never throws on malformed input — an
 * unrecognized header is reported as a diagnostic instead.
 */
export function parseSiren(source: string): ParseResult {
  const lines = source.split(/\r\n|\r|\n/);
  const firstNonBlankIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstNonBlankIndex === -1) {
    const diagnostics: Diagnostic[] = [
      {
        severity: "error",
        message:
          'Empty document: expected a "flowchart TD", "flowchart LR", or "sequenceDiagram" header',
        line: 1,
        column: 1,
      },
    ];
    return { document: null, diagnostics };
  }

  const rawLine = lines[firstNonBlankIndex];
  const trimmed = rawLine.trim();

  if (SEQUENCE_HEADER_RE.test(trimmed)) {
    return parseSequenceDiagram(source);
  }

  if (FLOWCHART_HEADER_RE.test(trimmed)) {
    return parseFlowchart(source);
  }

  const column = rawLine.length - rawLine.trimStart().length + 1;
  const diagnostics: Diagnostic[] = [
    {
      severity: "error",
      message: `Expected "flowchart TD", "flowchart LR", or "sequenceDiagram", found "${trimmed}"`,
      line: firstNonBlankIndex + 1,
      column,
    },
  ];
  return { document: null, diagnostics };
}
