import { plainRun, type Label, type LabelDialect, type LabelProblem, type LabelRun } from "./label";

/**
 * One tag: `<`, an optional `/`, a name, then optionally whitespace and
 * attributes, an optional `/`, and `>`. An attribute value in quotes may hold
 * a `>` without ending the tag.
 *
 * It finds every tag-shaped stretch of a label, and which of them mean
 * something is `readLabel`'s question, not this pattern's: a name outside the
 * vocabulary is left in the text as the characters the author wrote.
 *
 * **A row break** is the name `br`, in any case, opened: `<br>`, `<br/>`,
 * `<br />`, `<BR>` and `<br class="x">` all break a row, and `<brx>` is
 * another name. Wider than Mermaid's own `/<br\s*\/?>/gi`, deliberately
 * (ADR-0015): that pattern is its SVG-mode rule and has no room for an
 * attribute, but in its default HTML labels DOMPurify keeps
 * `<BR class="x">` as an element and the browser breaks the line
 * (measured), and that picture is the one Siren draws.
 *
 * A row break reads the same in both dialects: it is the one tag a sequence
 * diagram honors. Mermaid draws sequence text in SVG mode only, where its
 * narrower pattern is the picture, so the ticket wiring the `sequence`
 * dialect has to decide whether an attribute-carrying `<br>` breaks there
 * too.
 */
const TAG_RE = /<(\/?)([a-z][a-z0-9]*)(?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?\/?>/gi;

/** What one styling tag does to a run it is open around. */
type RunStyle = (run: LabelRun) => void;

const bold: RunStyle = (run) => {
  run.bold = true;
};
const italic: RunStyle = (run) => {
  run.italic = true;
};
const underline: RunStyle = (run) => {
  run.underline = true;
};
const strikethrough: RunStyle = (run) => {
  run.strikethrough = true;
};
const monospace: RunStyle = (run) => {
  run.monospace = true;
};

/**
 * A tag drawing its text at `factor` times the size around it. Nested, the
 * factors multiply (`<big><big>` is × 1.44), which is what a relative
 * `font-size` does; the measurement behind each factor is of one level only.
 * An absolute size around it is not one a scale can multiply, and is left
 * as written.
 */
function scaled(factor: number): RunStyle {
  return (run) => {
    if ("scale" in run.fontSize) {
      run.fontSize = { scale: run.fontSize.scale * factor };
    }
  };
}

/**
 * `sub`/`sup`: smaller, as `small` is, and shifted off the baseline. The
 * innermost of the two decides the shift; how far a shift goes is
 * `drawLabel`'s.
 */
function shifted(baseline: "sub" | "super"): RunStyle {
  const smaller = scaled(0.833);
  return (run) => {
    smaller(run);
    run.baseline = baseline;
  };
}

/**
 * What each text-styling tag sets on the runs inside it, by lower-case tag
 * name — the `html` dialect's styling vocabulary.
 *
 * Every entry is a measurement: Mermaid 11.17.2 at its default settings, in
 * headless Chrome (the board's "measured picture" table), draws `b` and
 * `strong` with `font-weight: bold`, and `i` `em` `cite` `dfn` `var` with
 * `font-style: italic` — five names for one picture, because the browser's
 * default stylesheet gives all five the same rule — `u` and `ins` with an
 * underline, `s` `strike` `del` with a line through, `code` `kbd` `samp`
 * `tt` in `monospace`, `small` at × 0.833 of the size around it and `big` at
 * × 1.2, `sub`/`sup` at × 0.833, below / above the baseline, and `q` as its
 * text between `“` and `”` (see `QUOTE_MARKS`).
 */
const STYLE_TAGS: Readonly<Record<string, RunStyle>> = {
  b: bold,
  strong: bold,
  i: italic,
  em: italic,
  cite: italic,
  dfn: italic,
  var: italic,
  u: underline,
  ins: underline,
  s: strikethrough,
  strike: strikethrough,
  del: strikethrough,
  code: monospace,
  kbd: monospace,
  samp: monospace,
  tt: monospace,
  small: scaled(0.833),
  big: scaled(1.2),
  sub: shifted("sub"),
  sup: shifted("super"),
  q: () => {},
};

/**
 * `q` sets nothing on a run; what it draws is a quote mark on each side of
 * its text, `“` and `”` (measured), which the browser's default stylesheet
 * generates as the element's `::before`/`::after` content. Generated content
 * takes the element's own style, so each mark is read as text inside the
 * `q` — `<b><q>yo</q></b>` is one bold run `“yo”` — and is part of the
 * label's flattened text, because the reader sees it.
 */
const QUOTE_MARKS = { open: "\u201c", close: "\u201d" } as const;

/**
 * What reading one label gave: the label, and what the author has to be
 * told about it, each problem at an offset in the source that was read.
 */
export interface ReadLabelResult {
  label: Label;
  problems: LabelProblem[];
}

/**
 * Reads what an author wrote in one label position into a `Label`, and
 * reports anything about it the author has to be told.
 *
 * `source` is the label as the parser found it, with its own syntax — the
 * quote fence, a Markdown string's backticks — already taken off;
 * `markdown` says the backticks were there, so `**`/`*` and a real line
 * break mean something. Never throws: any input reads as *some* label, and
 * when `problems` holds an error the caller must not draw it.
 *
 * Pure: the same source and options always read the same label.
 */
export function readLabel(
  source: string,
  options: { dialect: LabelDialect; markdown?: boolean },
): ReadLabelResult {
  const tagged = options.markdown === true ? markdownAsTags(source) : source;
  return { label: labelOf(taggedRows(tagged, options.dialect)), problems: [] };
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
 * A real line break becomes `<br>` first (measured: `**a⏎b**` is
 * `<strong>a<br>b</strong>`); an ordinary label cannot carry one at all, so
 * rewriting it there would be a rule about nothing. Then every `**…**`
 * pair, then every `*…*` pair, each the shortest that closes: the bold pass
 * goes first so that `**bold**` is one bold run rather than two italic runs
 * sharing a doubled star, and the italic pass goes over its output so that
 * a `*` pair inside a bold one is still read.
 *
 * Mermaid's *SVG* labels read a Markdown string differently — word by word,
 * and an italic run inside a bold one loses the bold — but that mode is the
 * DOM reference, not the picture (ADR-0015).
 */
function markdownAsTags(source: string): string {
  return source
    .replace(/\n/g, "<br>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>");
}

/**
 * The tags among `STYLE_TAGS` that the HTML parser calls **formatting**
 * elements — the ones it reopens after a misnested end tag closed them early
 * (the "active formatting elements" of the HTML standard's tree
 * construction). The other styling tags (`cite` `dfn` `var` `ins` `del`
 * `kbd` `samp` `sub` `sup` `q`) are ordinary elements, which a misnested end
 * tag closes for good.
 */
const FORMATTING_TAGS: ReadonlySet<string> = new Set([
  "b",
  "big",
  "code",
  "em",
  "i",
  "s",
  "small",
  "strike",
  "strong",
  "tt",
  "u",
]);

/**
 * Reads the tags in `source` into rows of runs.
 *
 * The open styling tags are a stack, and a run's properties are what every
 * tag on it sets, so nesting stacks (`<b>a <i>b</i></b>`: `b` is bold and
 * italic). A tag left open runs to the end of the label, across row breaks,
 * as an element does in HTML.
 *
 * **A misnested or stray end tag never throws, and reads as the browser
 * reads it**, because DOMPurify hands Mermaid's label to the browser's HTML
 * parser and the picture is that parser's answer — measured in mermaid
 * 11.17.2's HTML labels with `scripts/mermaid-probe.mjs`:
 *
 * - An end tag with nothing of its name open is dropped
 *   (`a</b>b<i>c` → `ab<i>c</i>`).
 * - An end tag closes the innermost open tag of its name and every tag
 *   opened inside it; the **formatting** ones among those are reopened at
 *   once, and the rest stay closed. So `<b>a<i>b</b>c</i>d` keeps `c`
 *   italic (`<b>a<i>b</i></b><i>c</i>d`), while `<b>a<sub>b</b>c</sub>d`
 *   leaves `c` plain (`<b>a<sub>b</sub></b>cd`). That is the outcome of the
 *   standard's "adoption agency" steps whenever no block element is open
 *   inside the misnested one, which no tag this reader honors is.
 * - A `q` draws its closing mark where it really closes, early or at the
 *   end of the label, and in its own style rather than the style of a tag
 *   that was open inside it (`<q>a<b>b</q>c</b>d` →
 *   `<q>a<b>b</b></q><b>c</b>d`).
 *
 * A tag whose name the dialect does not know stays in the text, as written.
 */
function taggedRows(source: string, dialect: LabelDialect): LabelRun[][] {
  const vocabulary: Readonly<Record<string, RunStyle>> = dialect === "html" ? STYLE_TAGS : {};
  const rows: LabelRun[][] = [];
  let row: LabelRun[] = [];
  let open: string[] = [];

  /** Appends `text` to the current row, styled by the tags in `stack`. */
  const emit = (text: string, stack: readonly string[] = open): void => {
    if (text === "") {
      return;
    }
    const run = plainRun(text);
    for (const name of stack) {
      vocabulary[name]!(run);
    }
    const last = row[row.length - 1];
    if (last !== undefined && sameProperties(last, run)) {
      last.text += text;
    } else {
      row.push(run);
    }
  };

  /**
   * Closes `open[index]` and every tag opened inside it, innermost first,
   * then reopens the formatting ones among those.
   */
  const close = (index: number): void => {
    for (let depth = open.length - 1; depth >= index; depth--) {
      if (open[depth] === "q") {
        emit(QUOTE_MARKS.close, open.slice(0, depth + 1));
      }
    }
    const inside = open.slice(index + 1);
    open = [...open.slice(0, index), ...inside.filter((name) => FORMATTING_TAGS.has(name))];
  };

  let lastIndex = 0;
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(source)) !== null) {
    const closing = match[1] === "/";
    const name = match[2]!.toLowerCase();
    const isBreak = name === "br" && !closing;
    if (!isBreak && !(name in vocabulary)) {
      continue;
    }
    emit(source.slice(lastIndex, match.index));
    lastIndex = TAG_RE.lastIndex;
    if (isBreak) {
      rows.push(row.length === 0 ? [plainRun("")] : row);
      row = [];
    } else if (!closing) {
      open.push(name);
      if (name === "q") {
        emit(QUOTE_MARKS.open);
      }
    } else if (open.lastIndexOf(name) !== -1) {
      close(open.lastIndexOf(name));
    }
  }
  emit(source.slice(lastIndex));
  if (open.length > 0) {
    close(0);
  }
  rows.push(row.length === 0 ? [plainRun("")] : row);
  return rows;
}

/**
 * Whether two runs carry the same value on every property but their text —
 * so that `<b>a</b><strong>b</strong>` is one bold run, and a tag that sets
 * nothing a run can show leaves a plain label plain.
 */
function sameProperties(a: LabelRun, b: LabelRun): boolean {
  return (Object.keys(a) as (keyof LabelRun)[]).every(
    // `fontSize` is the one object-valued property; JSON compares it by value.
    (key) => key === "text" || JSON.stringify(a[key]) === JSON.stringify(b[key]),
  );
}

/** A label of these rows, with the flattened `text` every plain-string reader takes. */
function labelOf(rows: LabelRun[][]): Label {
  return {
    text: rows.map((row) => row.map((run) => run.text).join("")).join("\n"),
    rows,
  };
}
