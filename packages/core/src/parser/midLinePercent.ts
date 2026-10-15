import type { Diagnostic } from "../contracts";
import { type DiagramKind, matchDiagramHeader } from "./parseDirection";

/**
 * What a diagram says about a `%%` in the middle of a line where it cannot
 * be read as text or as a comment the kind's grammar reads. CONTEXT.md's
 * **Comment**: only a line whose first non-blank characters are `%%` is a
 * comment; Mermaid 12.2.0's `cleanupComments` removes nothing mid-line, and
 * what a later `%%` means is each grammar's. One wording for every kind, so
 * an author reads the same reason and the same fix whatever the diagram.
 */
export const MID_LINE_PERCENT_MESSAGE =
  'A "%%" in the middle of a line is not a comment: only a line that starts with "%%" is one. ' +
  "If it is a comment, move it to a line of its own.";

/** The error refusing a mid-line `%%` at `line`:`column` — where its `%%` stands. */
export function midLinePercentError(line: number, column: number): Diagnostic {
  return { severity: "error", message: MID_LINE_PERCENT_MESSAGE, line, column };
}

/**
 * The error refusing a `%%` on a diagram's header line, `rawLine` as
 * written on line `line`, or `null` when there is none to refuse: a `%%`
 * counts when what stands before it is `kind`'s header. `spacedIsComment`
 * leaves alone one written after a space, for a kind whose lexer reads that
 * as a comment (state); without it every such `%%` is refused (class).
 */
export function headerPercentError(
  rawLine: string,
  line: number,
  kind: DiagramKind,
  { spacedIsComment }: { spacedIsComment: boolean },
): Diagnostic | null {
  const at = rawLine.indexOf("%%");
  if (at === -1 || matchDiagramHeader(rawLine.slice(0, at).trim()) !== kind) return null;
  if (spacedIsComment && /\s/.test(rawLine[at - 1]!)) return null;
  return midLinePercentError(line, at + 1);
}
