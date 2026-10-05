/**
 * One tag, as the HTML tokenizer reads one: `<`, an optional `/`, a name —
 * a letter, then anything up to whitespace, `/` or `>`, so `my-el` is a
 * name — then anything up to the first `>` that is not inside a quoted
 * attribute value. A value is quoted only when its quote follows the `=`
 * (`<y a'b>` ends at its `>`), and a `/` anywhere in the tag is part of it
 * (`<b/x>` and `<b/ >` are both `<b>`; measured).
 *
 * Or, its second alternative, the `<` and first letter of a tag that never
 * ends — one the label ends inside, a quoted value left open included
 * (no group 2). The tokenizer starts a tag at `<` followed by a letter, or
 * by `/` and a letter, and drops a tag that reaches the end of its input,
 * so in the `html` dialect everything from that `<` on is dropped
 * (measured: `x <y` is `<p>x </p>`, and `a <y z='1> b <i>c</i>` is
 * `<p>a </p>`). A `<` before anything else is a character: `a < b`, `a <1`
 * and `a</` are drawn as written (measured).
 *
 * It finds every tag-shaped stretch of a label in the `html` dialect, and
 * every one of them means something there, a name outside the vocabulary
 * included. The `sequence` dialect never uses it: Mermaid reads no tag in
 * sequence text, only its `<br>` pattern (`sequenceText.ts`'s `sequenceRows`).
 *
 * Never used directly: each search compiles its own instance (`nextTag`),
 * so that no search begins where another left off.
 */
const TAG_SOURCE = String.raw`<(\/?)([a-z][^\s\/>]*)(?:[^>=]|=\s*(?:"[^"]*"|'[^']*'|(?![\s"'])))*>|<\/?[a-z]`;

/** One tag-shaped stretch of a label, as `TAG_SOURCE` describes one. */
export interface Tag {
  /** Where its `<` is. */
  start: number;
  /** Where it ends: past its `>`, or past the first letter of a tag the label ends inside. */
  end: number;
  /** The tag as written. */
  written: string;
  /** Whether it is an end tag, `</…>`. */
  closing: boolean;
  /** Its name, lower-cased; `null` for a tag the label ends inside, which has none. */
  name: string | null;
}

/** The first tag in `text` that begins at or after `from`, or `null` when there is none. */
export function nextTag(text: string, from: number): Tag | null {
  const pattern = new RegExp(TAG_SOURCE, "gi");
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  if (match === null) {
    return null;
  }
  return {
    start: match.index,
    end: match.index + match[0].length,
    written: match[0],
    closing: match[1] === "/",
    name: match[2] === undefined ? null : match[2].toLowerCase(),
  };
}

/** Every tag in `text`, from its start. */
export function tagsIn(text: string): Tag[] {
  const tags: Tag[] = [];
  for (let tag = nextTag(text, 0); tag !== null; tag = nextTag(text, tag.end)) {
    tags.push(tag);
  }
  return tags;
}
