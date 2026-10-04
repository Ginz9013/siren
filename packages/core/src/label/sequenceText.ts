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
 * A tag-shaped stretch, as Mermaid's `cleanupText` finds one in the whole
 * document before any diagram reads it: `<`, a name of word characters, and
 * anything up to the next `>`.
 */
const TAG_SHAPED_RE = /<(\w+)([^>]*)>/g;

/**
 * `source` with Mermaid's quote rewrite made: inside each tag-shaped stretch
 * (`TAG_SHAPED_RE`), every `="…"` becomes `='…'`, so
 * `A->>B: a<b c="d">e` is drawn `a<b c='d'>e`, and `<br class="x">` is
 * stored `<br class='x'>` (measured, mermaid 11.17.2). A `"` anywhere else is
 * drawn as written: outside a tag (`say "hi"`), after `= ` with a space, in
 * an end tag, or in a value the stretch's first `>` cuts short.
 *
 * Mermaid applies it to the document, not to one label, so a stretch it
 * finds across lines — a `<b c="d"` that a later line's `>` ends — is not
 * one this reader of a single label can see.
 */
function quotesRewritten(source: string): string {
  return source.replace(
    TAG_SHAPED_RE,
    (_, name: string, attributes: string) => `<${name}${attributes.replace(/="([^"]*)"/g, "='$1'")}>`,
  );
}

/**
 * Reads `source` into rows as Mermaid draws sequence text: in SVG mode
 * only, split into rows by its `/<br\s*\/?>/gi` and by nothing else. Every
 * other character is drawn as written, a `<` included — no tag is read, so
 * a `<` that would begin one in HTML cannot hide a row break behind it
 * (measured: `A->>B: x <y <br> z` draws `x <y` and `z`) — and only
 * Mermaid's entity codes resolve, because Mermaid escapes the rest of
 * sequence text, a character reference the author wrote included. A
 * `"` in a tag-shaped stretch is drawn as Mermaid rewrites it
 * (`quotesRewritten`).
 */
export function sequenceRows(source: string): LabelRun[][] {
  return quotesRewritten(source).split(SVG_ROW_BREAK_RE).map((row) => [plainRun(resolveEntityCodes(row))]);
}
