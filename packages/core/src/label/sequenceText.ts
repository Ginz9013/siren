/**
 * The `sequence` dialect's reader: text as Mermaid draws a sequence
 * diagram's — in SVG mode only, where no tag is read and only its `<br>`
 * pattern breaks a row. The `html` dialect's reader is `readLabel`'s
 * `taggedRows`.
 */
import { resolveEntityCodes } from "./characterReferences";
import { plainRun, type LabelRun } from "./label";

/**
 * A row break in the `sequence` dialect: Mermaid's own `/<br\s*\/?>/gi`,
 * because Mermaid draws sequence text in SVG mode only, where that pattern
 * is the picture: `<br>`, `<br/>`, `<br />` and `<BR>` break a row, and
 * `<br class="x">` is drawn as its characters (measured:
 * `A->>B: x<br class="x">y` is one `<text>`).
 */
const SVG_ROW_BREAK_RE = /<br\s*\/?>/gi;

/**
 * Reads `source` into rows as Mermaid draws sequence text: in SVG mode
 * only, split into rows by its `/<br\s*\/?>/gi` and by nothing else. Every
 * other character is drawn as written, a `<` included — no tag is read, so
 * a `<` that would begin one in HTML cannot hide a row break behind it
 * (measured: `A->>B: x <y <br> z` draws `x <y` and `z`) — and only
 * Mermaid's entity codes resolve, because Mermaid escapes the rest of
 * sequence text, a character reference the author wrote included. A
 * `"` is drawn as it is handed over: Mermaid's rewrite of a tag's quotes
 * is made to the whole document before any label is read (the parser's
 * `tagQuotesRewritten`).
 */
export function sequenceRows(source: string): LabelRun[][] {
  return source.split(SVG_ROW_BREAK_RE).map((row) => [plainRun(resolveEntityCodes(row))]);
}
