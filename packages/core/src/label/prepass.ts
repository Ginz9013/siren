/**
 * The pre-pass: what a label's source becomes before the tag reader reads
 * it — Mermaid's own rewrites of the text it hands the browser, each kept
 * with the offset in what the author wrote that every character came from.
 */
import { nextTag, tagsIn, type Tag } from "./tags";
import { inVocabulary } from "./vocabulary";

/**
 * What the tag reader reads for `source`: in a Markdown string, `source`
 * with its notation rewritten as the tags it stands for (`markdownAsTags`).
 *
 * The `;` Mermaid drops from a style line is not dropped here: that rule
 * reads the whole line a label is written on, so `parseSiren` applies it
 * to the whole document (`parser/styleLines`) before any parser reads a
 * label, and `source` arrives without it.
 */
export function prepass(source: string, options: { markdown: boolean }): Tagged {
  const written = untagged(source);
  return options.markdown ? markdownAsTags(written) : written;
}

/**
 * A label's source as the tag reader reads it, and, for each of its
 * characters and for its end, the offset in what the author wrote that it
 * came from — so that a problem found in a Markdown string's rewritten text
 * is placed where the author can find it. A tag the rewrite inserted takes
 * the offset of the notation it stands for.
 */
export interface Tagged {
  text: string;
  origins: readonly number[];
}

/** `source` read as written: every character is its own origin. */
function untagged(source: string): Tagged {
  return { text: source, origins: Array.from({ length: source.length + 1 }, (_, index) => index) };
}

/**
 * One change to a `Tagged`: its characters from `from` to `to` replaced by
 * the pieces of `insert`, each of which takes the origin of the character
 * at `at` — the notation it stands for.
 */
interface Edit {
  from: number;
  to: number;
  insert: readonly { text: string; at: number }[];
}

/**
 * `tagged` with `edits` made, in order and none overlapping another: the
 * one place a rewrite rebuilds the origins.
 */
function edited(tagged: Tagged, edits: Iterable<Edit>): Tagged {
  let text = "";
  const origins: number[] = [];
  let last = 0;
  for (const { from, to, insert } of edits) {
    text += tagged.text.slice(last, from);
    origins.push(...tagged.origins.slice(last, from));
    for (const piece of insert) {
      text += piece.text;
      origins.push(...Array.from({ length: piece.text.length }, () => tagged.origins[piece.at]!));
    }
    last = to;
  }
  text += tagged.text.slice(last);
  origins.push(...tagged.origins.slice(last));
  return { text, origins };
}

/** `tagged` with every match of `pattern`, a `/g` pattern, replaced by `replacement`. */
function rewritten(tagged: Tagged, pattern: RegExp, replacement: string): Tagged {
  return edited(
    tagged,
    Array.from(tagged.text.matchAll(pattern), (match) => ({
      from: match.index,
      to: match.index + match[0].length,
      insert: [{ text: replacement, at: match.index }],
    })),
  );
}

/**
 * A Markdown string's own notation, rewritten as the tags it stands for —
 * which is what Mermaid does with it: its HTML labels turn the string into
 * HTML (`**` into `<strong>`, `*` into `<em>`, a line break into `<br>`) and
 * the browser reads that HTML, tags the author wrote included. So the two
 * notations are one vocabulary, and everything the tags do the stars do:
 * they stack (`**a <i>b</i>**` and `**bold *and* still**` both draw a bold
 * italic run), and a pair spans a row break (`**a<br>b**` is bold on both
 * rows). Each of those measured in mermaid 11.17.2's HTML labels, as
 * `<strong>a <i>b</i></strong>`, `<strong>bold <em>and</em> still</strong>`
 * and `<strong>a<br>b</strong>`.
 *
 * **The stars and underscores pair as CommonMark pairs them**, because
 * Mermaid's Markdown reader (marked 16) does — every case below measured in
 * 11.17.2's HTML labels:
 *
 * - `_…_` is italic and `__…__` bold, as `*…*` and `**…**` are, and the
 *   two characters nest in each other (`**a _b_ c**` is bold with an
 *   italic `b`) but never pair with each other (`*a_` is drawn as written).
 * - A run of them opens only with no whitespace after it and closes only
 *   with none before it: `a * b * c`, `*a *`, `** a**` and `**a⏎**` are
 *   drawn as written, a line break counting as whitespace, and `*a * b*` is
 *   one italic `a * b`.
 * - Against punctuation, a run opens only from the outside of a word:
 *   `x**(a)**y`, `a**.b**` and `x_(a)_y` are drawn as written, while
 *   `*(a)*`, `**(a)**`, `(**a**)` and `a.**b**c` are emphasis.
 * - An underscore inside a word opens and closes nothing: `a_b_c`, `_a_b`,
 *   `a__b__c` and `x__a__y` are drawn as written, `__a_b__` is a bold
 *   `a_b`. Stars do pair inside a word: `a*b*c`, `x**a**y`.
 * - The rule of three: a run that could both open and close does not pair
 *   with one when their lengths sum to a multiple of three, so `*a**b*` is
 *   an italic `a**b` and `*foo**bar**baz*` a bold `bar` inside an italic
 *   word. Leftover delimiters stay characters: `*a**` is an italic `a`
 *   then `*`, and `***a***` bold italic.
 * - A tag the author wrote is read whole, so no `_` or `*` inside it pairs:
 *   `<a href='http://x/_a_/'>` keeps its href.
 *
 * **A backslash before ASCII punctuation escapes it**: the backslash is
 * dropped and the character is drawn as written, never a delimiter
 * (`a \*b\* c` is `<p>a *b* c</p>`, `\\` is `<p>\</p>`); before anything
 * else a backslash is a character (`a\b`, `\é`). See `unescaped`.
 *
 * **A real line break becomes `<br>`** after the pairing (measured: `**a⏎b**`
 * is `<strong>a<br>b</strong>`, `line1⏎line2` `<p>line1<br>line2</p>`),
 * except where Markdown reads it otherwise: after two spaces or a backslash
 * it is a hard break, which Mermaid hands the browser as the characters
 * written and the browser draws as one space (`hardBreaksJoined`); and a
 * blank line is a paragraph break, `</p><p>`, which no pair spans
 * (`BLANK_LINES_RE`). An ordinary label cannot carry a line break at all, so
 * rewriting it there would be a rule about nothing. Code spans and the rest
 * of Markdown's inline syntax are not read.
 *
 * Mermaid's *SVG* labels read a Markdown string differently — word by word,
 * and an italic run inside a bold one loses the bold — but that mode is the
 * DOM reference, not the picture (ADR-0015).
 */
function markdownAsTags(source: Tagged): Tagged {
  const { tagged, escaped } = unescaped(hardBreaksJoined(source));
  return rewritten(rewritten(emphasized(tagged, escaped), BLANK_LINES_RE, "<p>"), /\n/g, "<br>");
}

/**
 * A blank line, and any more after it, in a Markdown string: a paragraph
 * break, which Mermaid hands the browser as `</p><p>` (measured: `a⏎⏎b`,
 * `a⏎⏎⏎b` and `a⏎␣⏎b` are each `<p>a</p><p>b</p>`). A `<p>` start tag
 * closes the paragraph open before it, as that end tag would.
 */
const BLANK_LINES_RE = /\n[ \t]*\n\s*/g;

/**
 * `tagged` with each of Markdown's hard line breaks — a line break after two
 * or more spaces, or after a backslash no other backslash escapes — drawn
 * as the one space the browser draws it as. Mermaid hands the browser a hard
 * break as the characters written, not as a `<br>` (measured: `a␣␣⏎b` is
 * `<p>a  \nb</p>`, `a\⏎b` is `<p>a\\\nb</p>`), and the label's
 * `white-space: nowrap` collapses them into one space on the row: `a b`,
 * and `a\ b` with its backslash. Before a blank line neither is a hard
 * break (measured: `a␣␣⏎⏎b` is `<p>a  </p><p>b</p>`, `a\⏎⏎b` is
 * `<p>a\</p><p>b</p>`).
 */
function hardBreaksJoined(tagged: Tagged): Tagged {
  const notBlank = String.raw`(?![ \t]*(?:\n|$))`;
  const spaces = new RegExp(String.raw` {2,}\n` + notBlank, "g");
  const backslash = new RegExp(String.raw`(?<=(?:^|[^\\])(?:\\\\)*)\\\n` + notBlank, "g");
  return rewritten(rewritten(tagged, spaces, " "), backslash, "\\ ");
}

/**
 * `tagged` with Markdown's backslash escapes read: a backslash before an
 * ASCII punctuation character is dropped, and the character after it is
 * kept as written — `escaped` holds where each such character now is, so
 * that it is never a delimiter. A backslash before anything else is a
 * character, and so is one inside a tag the author wrote.
 *
 * Mermaid sanitizes the string before its Markdown reader sees it, so a tag
 * DOMPurify removes is gone by then, and the backslash before it escapes
 * whatever came after it (see `escapedBy`).
 */
function unescaped(tagged: Tagged): { tagged: Tagged; escaped: ReadonlySet<number> } {
  const { text } = tagged;
  const tags = tagsIn(text);
  const inTag = insideTags(tags);
  const opened = startTagEnds(tags);
  const backslashes: Edit[] = [];
  const escaped = new Set<number>();
  for (let index = 0; index < text.length; index++) {
    const target = text[index] === "\\" && !inTag(index) ? escapedBy(text, index, opened) : undefined;
    if (target !== undefined) {
      backslashes.push({ from: index, to: index + 1, insert: [] });
      // Where the escaped character is once every backslash up to it is dropped.
      escaped.add(target - backslashes.length);
      index = target;
    }
  }
  return { tagged: edited(tagged, backslashes), escaped };
}

/**
 * For each tag name, where the first start tag of that name in a label
 * ends, from `tags`, every tag in it: an end tag at or past that offset has
 * a start tag of its name before it.
 */
function startTagEnds(tags: readonly Tag[]): ReadonlyMap<string, number> {
  const ends = new Map<string, number>();
  for (const { closing, name, end } of tags) {
    if (!closing && name !== null && !ends.has(name)) {
      ends.set(name, end);
    }
  }
  return ends;
}

/**
 * Where the character the backslash at `backslash` escapes is, or
 * `undefined` when it is a backslash as written: the next character, when
 * it is ASCII punctuation — past any tags DOMPurify removes before Mermaid's
 * Markdown reader runs (measured: `x\<foo>*y*` is `<p>x*y*</p>`, and both
 * `x\<b\>y` and `x\</b>y` are `<p>x\y</p>`). Those are a tag outside the
 * vocabulary, and an end tag with no start tag of its name before it; a tag
 * left unterminated takes the rest of the label with it (`a\<b` is
 * `<p>a\</p>`). A tag the vocabulary keeps reaches Markdown, so its `<` is
 * the escaped character, and it is still a tag (`x\<b>y</b>` is
 * `<p>x<b>y</b></p>`). `opened` is where the first start tag of each name
 * in `text` ends (`startTagEnds`).
 */
function escapedBy(text: string, backslash: number, opened: ReadonlyMap<string, number>): number | undefined {
  let at = backslash + 1;
  for (let tag = nextTag(text, at); tag !== null && tag.start === at; tag = nextTag(text, at)) {
    if (tag.name === null) {
      return undefined;
    }
    const name = tag.name;
    // A backslash is never inside a tag (`insideTags`), so every tag that
    // starts before it ends at or before it.
    if (inVocabulary(name) && (!tag.closing || (opened.get(name) ?? Infinity) <= backslash)) {
      break;
    }
    at = tag.end;
  }
  return ASCII_PUNCTUATION_RE.test(text[at] ?? "") ? at : undefined;
}

/** One of the ASCII punctuation characters a Markdown backslash escapes. */
const ASCII_PUNCTUATION_RE = /^[!-/:-@[-`{-~]$/;

/** Whether an offset lies inside one of `tags`, those the author wrote, which Markdown reads whole. */
function insideTags(tags: readonly Tag[]): (index: number) => boolean {
  const named = tags.filter((tag) => tag.name !== null);
  return (index) => named.some(({ start, end }) => start < index && index < end);
}

/**
 * One run of `*` or `_` in a Markdown string, as `delimiterRuns` found it:
 * which character, where, how long, and whether it can open and close.
 */
interface DelimiterRun {
  character: string;
  start: number;
  length: number;
  canOpen: boolean;
  canClose: boolean;
}

/**
 * What pairing made of one `DelimiterRun`: as a closer it is used from its
 * left, as an opener from its right, and each pair it takes part in leaves
 * a tag where its delimiters were.
 */
interface Paired {
  /** The end tags it became as a closer, innermost first, each at the delimiter it stands for. */
  closes: { text: string; at: number }[];
  /** The start tags it became as an opener, innermost first. */
  opens: { text: string; at: number }[];
  /** How many of its delimiters, from its left, closers used. */
  closed: number;
  /** How many of its delimiters, from its right, openers used. */
  opened: number;
}

/**
 * `tagged` with its `*`/`_` emphasis paired into `<em>` and `<strong>`, by
 * CommonMark's delimiter-run procedure (see `markdownAsTags`): each run's
 * used delimiters replaced by the tags they became, its unused ones kept.
 */
function emphasized(tagged: Tagged, escaped: ReadonlySet<number>): Tagged {
  const runs = delimiterRuns(tagged.text, escaped);
  const pairing = paired(runs, Array.from(tagged.text.matchAll(BLANK_LINES_RE), (match) => match.index));
  return edited(
    tagged,
    runs.flatMap((run, position) => {
      const { closes, opens, closed, opened } = pairing[position]!;
      const end = run.start + run.length;
      return [
        { from: run.start, to: run.start + closed, insert: closes },
        { from: end - opened, to: end, insert: [...opens].reverse() },
      ];
    }),
  );
}

/**
 * What pairing makes of each of `runs`, by position: CommonMark's
 * delimiter-run procedure, where no pair spans one of `paragraphBreaks`.
 */
function paired(runs: readonly DelimiterRun[], paragraphBreaks: readonly number[]): Paired[] {
  const pairing = runs.map((): Paired => ({ closes: [], opens: [], closed: 0, opened: 0 }));
  /** How many of the delimiters of the run at `position` are still characters. */
  const unused = (position: number): number =>
    runs[position]!.length - pairing[position]!.closed - pairing[position]!.opened;
  const paragraphOf = (run: DelimiterRun): number => paragraphBreaks.filter((at) => at < run.start).length;
  /** Positions of the runs that may still open, innermost last. */
  let openers: number[] = [];
  for (const [position, run] of runs.entries()) {
    // No pair spans a paragraph break (measured: `**a⏎⏎b**` is `<p>**a</p><p>b**</p>`).
    if (position > 0 && paragraphOf(run) !== paragraphOf(runs[position - 1]!)) {
      openers = [];
    }
    const closer = pairing[position]!;
    while (run.canClose && unused(position) > 0) {
      let index = openers.length - 1;
      while (index >= 0 && !pairs(runs[openers[index]!]!, run)) {
        index--;
      }
      if (index < 0) {
        break;
      }
      const at = openers[index]!;
      const opener = pairing[at]!;
      const used = unused(at) >= 2 && unused(position) >= 2 ? 2 : 1;
      const [open, close] = used === 2 ? ["<strong>", "</strong>"] : ["<em>", "</em>"];
      opener.opened += used;
      opener.opens.push({ text: open, at: runs[at]!.start + runs[at]!.length - opener.opened });
      closer.closes.push({ text: close, at: run.start + closer.closed });
      closer.closed += used;
      // The delimiters between the two can no longer pair, and a spent opener goes too.
      openers.splice(unused(at) > 0 ? index + 1 : index);
    }
    if (run.canOpen && unused(position) > 0) {
      openers.push(position);
    }
  }
  return pairing;
}

/**
 * Whether `opener` can pair with `closer`: runs of one character, and —
 * CommonMark's rule of three — when either could both open and close, not
 * two whose lengths sum to a multiple of three unless both lengths are
 * multiples of three themselves.
 */
function pairs(opener: DelimiterRun, closer: DelimiterRun): boolean {
  if (opener.character !== closer.character) {
    return false;
  }
  const either = opener.canClose || closer.canOpen;
  const lengths = opener.length + closer.length;
  return !either || lengths % 3 !== 0 || (opener.length % 3 === 0 && closer.length % 3 === 0);
}

/**
 * Every run of `*` or of `_` in `text`, with whether it can open and close
 * emphasis: a run is left-flanking when no whitespace follows it and,
 * if punctuation does, whitespace or punctuation precedes it; right-flanking
 * is the mirror image. The label's ends count as whitespace. A `*` run
 * opens when left-flanking and closes when right-flanking; a `_` run inside
 * a word, both at once, does neither unless punctuation sits on the side it
 * would open or close from.
 *
 * A tag the author wrote is read whole, as Markdown reads inline HTML, so
 * no run inside one is a delimiter (`<a href='/_a_/'>` keeps its href).
 */
function delimiterRuns(text: string, escaped: ReadonlySet<number>): DelimiterRun[] {
  const inTag = insideTags(tagsIn(text));
  const spans = Array.from(text.matchAll(/\*+|_+/g)).flatMap((match) => unescapedSpans(match.index, match[0], escaped));
  return spans.map(({ start, written }) => {
    const before = text[start - 1] ?? " ";
    const after = text[start + written.length] ?? " ";
    const outside = (side: string): boolean => WHITESPACE_RE.test(side) || PUNCTUATION_RE.test(side);
    const leftFlanking = !WHITESPACE_RE.test(after) && (!PUNCTUATION_RE.test(after) || outside(before));
    const rightFlanking = !WHITESPACE_RE.test(before) && (!PUNCTUATION_RE.test(before) || outside(after));
    const star = written[0] === "*";
    return {
      character: written[0]!,
      start,
      length: written.length,
      canOpen: leftFlanking && (star || !rightFlanking || PUNCTUATION_RE.test(before)),
      canClose: rightFlanking && (star || !leftFlanking || PUNCTUATION_RE.test(after)),
    };
  }).filter((run) => !inTag(run.start));
}

/**
 * The parts of `run`, a run of one delimiter character at `start` in the
 * text, that no backslash escaped: an escaped character is a character, and
 * splits the run around it (`\**a**` is `*` then an italic `a` then `*`).
 */
function unescapedSpans(
  start: number,
  run: string,
  escaped: ReadonlySet<number>,
): { start: number; written: string }[] {
  const spans: { start: number; written: string }[] = [];
  let from = start;
  for (let index = start; index <= start + run.length; index++) {
    if (index === start + run.length || escaped.has(index)) {
      if (index > from) {
        spans.push({ start: from, written: run.slice(from - start, index - start) });
      }
      from = index + 1;
    }
  }
  return spans;
}

/** A Unicode whitespace character, as CommonMark's flanking rule counts one. */
const WHITESPACE_RE = /\s/u;

/** A Unicode punctuation or symbol character, as CommonMark's flanking rule counts one. */
const PUNCTUATION_RE = /[\p{P}\p{S}]/u;
