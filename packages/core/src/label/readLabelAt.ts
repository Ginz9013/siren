import type { Diagnostic } from "../contracts";
import type { Label, LabelDialect } from "./label";
import { labelDiagnostics, readLabel } from "./readLabel";

/**
 * Reads the label capture group `group` of `match` holds, with its problems
 * already turned into diagnostics on `line`, and whether any is an error.
 *
 * For the parsers whose labels are each a capture of one of their own
 * patterns over a line, compiled with the `d` flag, in a statement that
 * never spans physical lines: where the label begins is the group's own
 * index, so nothing is re-derived by searching the line for its own text,
 * and a position in the label is a column once `column` — where the matched
 * text begins in the document's line — and the group's index are added. A
 * parser whose labels can span lines (a flowchart's Markdown string) does
 * that arithmetic itself and calls `labelDiagnostics`.
 *
 * The group must have matched; an optional group that did not is the
 * caller's to check first.
 *
 * A module of its own rather than a function beside `labelDiagnostics`, so
 * that it reaches `readLabel` through that module's export: the parser
 * tests stand in for `readLabel` there (`vi.mock`) to plant a problem no
 * real tag reports yet, and a call from inside `readLabel.ts` would bypass
 * the stand-in.
 */
export function readLabelAt(
  match: RegExpExecArray,
  group: number,
  at: { line: number; column: number },
  dialect: LabelDialect,
): { label: Label; diagnostics: Diagnostic[]; hasError: boolean } {
  const [start] = match.indices![group]!;
  const { label, problems } = readLabel(match[group]!, { dialect });
  const reported = labelDiagnostics(problems, (offset) => ({
    line: at.line,
    column: at.column + start + offset,
  }));
  return { label, ...reported };
}
