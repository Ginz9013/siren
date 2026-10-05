/**
 * Mermaid's style-line rule: a rewrite Mermaid makes to whole lines of the
 * document before any diagram's parser sees it, and so, like comment
 * stripping, one `parseSiren` applies to the whole document before it hands
 * it to a kind's parser.
 */

/**
 * Mermaid's own two patterns, run in this order over the whole document by
 * its `encodeEntities` before any diagram's parser sees it (mermaid 11.17.2,
 * `Diagram.fromText`):
 *
 *     txt = txt.replace(/style.*:\S*#.*;/g, (s) => s.substring(0, s.length - 1));
 *     txt = txt.replace(/classDef.*:\S*#.*;/g, (s) => s.substring(0, s.length - 1));
 *
 * Meant for a `style` statement's `fill:#f00;`, so that its `#f00;` is not
 * read as the entity code its next step rewrites `#…;` into. `.` never
 * crosses a line break, and `.*;` is greedy, so each pattern drops at most
 * the **last** `;` of a line — whichever statement or label it belongs to.
 */
const STYLE_LINE_RES: readonly RegExp[] = [/style.*:\S*#.*;/g, /classDef.*:\S*#.*;/g];

/**
 * One line as Mermaid parses it: `line` without the `;` its style-line rule
 * drops, and where in `line` as written each dropped one was, in order.
 */
export function styleLine(line: string): { text: string; dropped: number[] } {
  let text = line;
  let origins = Array.from({ length: line.length }, (_, index) => index);
  const dropped: number[] = [];
  for (const pattern of STYLE_LINE_RES) {
    for (const match of Array.from(text.matchAll(pattern)).reverse()) {
      const semicolon = match.index + match[0].length - 1;
      dropped.push(origins[semicolon]!);
      text = text.slice(0, semicolon) + text.slice(semicolon + 1);
      origins = [...origins.slice(0, semicolon), ...origins.slice(semicolon + 1)];
    }
  }
  return { text, dropped: dropped.sort((a, b) => a - b) };
}

/**
 * A document as Mermaid parses it — each of its lines read by `styleLine` —
 * for a parser to read in place of `source`; and `asWritten`, which moves
 * every source position in what the parser made of it back to where the
 * author wrote it.
 *
 * A dropped `;` shifts every later column on its line one to the left, so
 * a position the parser found past it would point one character early.
 * `asWritten` puts it back: it reaches each `line`/`column` pair and each
 * `sourceLine`/`sourceColumn` pair (the spelling an edge or a relationship
 * takes, whose `line` names something else) anywhere in the result, and
 * when the line had a `;` dropped, moves the column past it. A document no
 * line of which is a style line comes back as the very result it was given.
 */
export function styleLines(source: string): {
  source: string;
  asWritten: <T>(result: T) => T;
} {
  const lines = source.split(/\r\n|\r|\n/).map(styleLine);
  /** By 1-based line number, where each `;` dropped from it was, in order. */
  const droppedOn = new Map<number, readonly number[]>();
  lines.forEach(({ dropped }, index) => {
    if (dropped.length > 0) {
      droppedOn.set(index + 1, dropped);
    }
  });
  return {
    source: lines.map(({ text }) => text).join("\n"),
    asWritten: (result) => (droppedOn.size === 0 ? result : positionsAsWritten(result, droppedOn)),
  };
}

/** The pairs of keys a source position is written as in a parse result. */
const POSITION_KEYS: readonly (readonly [string, string])[] = [
  ["line", "column"],
  ["sourceLine", "sourceColumn"],
];

/**
 * `result` with every position on a line in `droppedOn` moved past the
 * `;` dropped before it — in place, each object once, however many places
 * in the result share it.
 */
function positionsAsWritten<T>(result: T, droppedOn: ReadonlyMap<number, readonly number[]>): T {
  const visited = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null || visited.has(value)) {
      return;
    }
    visited.add(value);
    const record = value as Record<string, unknown>;
    for (const [lineKey, columnKey] of POSITION_KEYS) {
      const line = record[lineKey];
      const column = record[columnKey];
      const dropped = typeof line === "number" ? droppedOn.get(line) : undefined;
      if (dropped !== undefined && typeof column === "number") {
        record[columnKey] = columnAsWritten(column, dropped);
      }
    }
    for (const child of Object.values(record)) {
      visit(child);
    }
  };
  visit(result);
  return result;
}

/**
 * The 1-based column, in a line as written, of the character at `column` in
 * that line as read — each `;` dropped at or before it adding one.
 */
function columnAsWritten(column: number, dropped: readonly number[]): number {
  let offset = column - 1;
  for (const at of dropped) {
    if (at <= offset) {
      offset++;
    }
  }
  return offset + 1;
}
