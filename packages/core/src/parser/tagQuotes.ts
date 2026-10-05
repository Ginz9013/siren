/**
 * Mermaid's tag-quote rule: a rewrite Mermaid makes to the whole document
 * before any diagram's parser sees it, and so, like comment stripping and
 * the style-line rule (`styleLines`), one `parseSiren` applies to the whole
 * document before it hands it to a kind's parser.
 */

/**
 * A tag-shaped stretch, Mermaid's own pattern: `<`, a name of word
 * characters, and anything up to the next `>` — a line break included, so a
 * stretch a line opens may be ended by a `>` on any line below it.
 */
const TAG_SHAPED_RE = /<(\w+)([^>]*)>/g;

/**
 * `source` as Mermaid's `cleanupText` leaves it (mermaid 11.17.2,
 * `preprocessDiagram`'s first step, before frontmatter, directives and
 * comments are removed):
 *
 *     code.replace(/<(\w+)([^>]*)>/g, (match, tag, attributes) =>
 *       "<" + tag + attributes.replace(/="([^"]*)"/g, "='$1'") + ">")
 *
 * Inside each tag-shaped stretch every `="…"` becomes `='…'`; a `"` anywhere
 * else is kept — outside a tag, after `= ` with a space, in an end tag, or in
 * a value the stretch's first `>` cuts short. Measured: `A->>B: a<b c="d"`
 * followed by `B->>A: e` stores the first message as `a<b c='d'`, and
 * `A["<span style="color:red">t</span>"]` draws a red `t`, its inner quotes no
 * longer ending the label's fence.
 *
 * Each `"` becomes one `'`, so the result has the length and the line breaks
 * of `source`: every position in it is the position the author wrote, and
 * nothing needs moving back.
 */
export function tagQuotesRewritten(source: string): string {
  return source.replace(
    TAG_SHAPED_RE,
    (_, name: string, attributes: string) => `<${name}${attributes.replace(/="([^"]*)"/g, "='$1'")}>`,
  );
}
