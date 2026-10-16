/**
 * A line that is nothing but `%%`, and the words an error about one uses —
 * shared by `parseSiren`, which decides per kind what the line means, and
 * `parseClassDiagram`, which is handed the line to decide by where it
 * stands.
 *
 * Mermaid's comment cleanup removes a whole line whose first non-blank
 * characters are `%%` only when at least one character follows them — a
 * space will do — so a bare `%%` is left to the diagram's grammar.
 */

/** Whether `line` is nothing but `%%`, indented or not. */
export function isBareCommentLine(line: string): boolean {
  return line.trimStart() === "%%";
}

/**
 * The error for a bare `%%` line, `where` it stands when that is the cause
 * (`in a namespace`), and `drawnAs` when the diagram would draw it as
 * something (`so this line is a node named "%%"`). The cause and the fix,
 * and nothing about another tool.
 */
export function bareCommentError(options: { where?: string; drawnAs?: string } = {}): string {
  const where = options.where === undefined ? "" : ` ${options.where}`;
  const drawn = options.drawnAs === undefined ? "" : `, ${options.drawnAs}`;
  return (
    `A line that is nothing but "%%" is not a comment${where}: a comment needs text after its "%%"${drawn}. ` +
    'Write "%% text", or leave the line blank.'
  );
}
