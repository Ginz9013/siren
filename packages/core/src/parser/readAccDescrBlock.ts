/**
 * The braced `accDescr { ... }` statement, read the one way every diagram
 * kind that has it reads it.
 *
 * Measured on mermaid 12.2.0, identically in flowchart, sequence and ER
 * diagrams (01M3NNNE1, 01M4WS1P6):
 *
 * - The block runs from its `{` to the first `}`, on the same line or a
 *   later one: `accDescr{one}` and `accDescr { one }` are "one".
 * - Each line loses its leading whitespace and blank lines go —
 *   `accDescr {` / `    line one` / `` / `      line two` / `}` is
 *   "line one\nline two".
 * - An empty block writes no `<desc>`, so it is `null` here.
 * - Whatever follows the `}` on its line is the next statement:
 *   `accDescr { one } A` declares `A`.
 *
 * A block that never closes is reported as such and the caller refuses the
 * document: Mermaid reads every later line into the description (a
 * flowchart and a sequence diagram then draw an empty picture; an ER
 * diagram fails to parse), and either way the document does not say what
 * Mermaid draws.
 *
 * Which spellings *open* a block is the caller's business, because that
 * differs by kind: an ER and a sequence diagram read the keyword in any
 * case, a flowchart only in lower case.
 */
export type AccDescrBlock =
  | {
      closed: true;
      description: string | null;
      /** Index of the line holding the closing `}`. */
      closeIndex: number;
      /** That line with everything up to and including the `}` blanked, or `null` when nothing follows it. */
      rest: string | null;
    }
  | { closed: false };

/**
 * Reads the block whose `{` is on `lines[openIndex]` at offset `braceAt`.
 */
export function readAccDescrBlock(lines: readonly string[], openIndex: number, braceAt: number): AccDescrBlock {
  const parts: string[] = [];
  for (let index = openIndex; index < lines.length; index++) {
    const from = index === openIndex ? braceAt + 1 : 0;
    const close = lines[index].indexOf("}", from);
    if (close === -1) {
      parts.push(lines[index].slice(from));
      continue;
    }
    parts.push(lines[index].slice(from, close));
    const description = parts.join("\n").trim().replace(/\n\s+/g, "\n");
    const after = lines[index].slice(close + 1);
    return {
      closed: true,
      description: description === "" ? null : description,
      closeIndex: index,
      // Blanked rather than cut, so a diagnostic on the next statement
      // still names the column the author wrote it at.
      rest: after.trim() === "" ? null : " ".repeat(close + 1) + after,
    };
  }
  return { closed: false };
}
