import { plainRun, type Label, type LabelDialect, type LabelProblem, type LabelRun } from "./label";

/**
 * A row break: Mermaid's own `/<br\s*\/?>/gi`, measured (ADR-0015). So
 * `<br>`, `<br/>`, `<br />` and `<BR>` all break a row, and `<br class="x">`
 * does not — the pattern has no room for an attribute, and what Mermaid
 * does not break on, neither does Siren.
 *
 * The same in both dialects: it is the one tag a sequence diagram honors.
 */
const ROW_BREAK_RE = /<br\s*\/?>/gi;

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
): { label: Label; problems: LabelProblem[] } {
  // A Markdown string's real line break is a row break exactly as `<br>`
  // is (measured: `node="A" text="line1\nline2"`, drawn as two rows); an
  // ordinary label cannot carry one at all, so splitting on it there would
  // be a rule about nothing.
  const lines = options.markdown === true ? source.split("\n") : [source];
  const rows: LabelRun[][] = lines.flatMap((line) =>
    line
      .split(ROW_BREAK_RE)
      .map((row) => (options.markdown === true ? markdownRuns(row) : [plainRun(row)])),
  );
  return { label: labelOf(rows), problems: [] };
}

/**
 * `**bold**` or `*italic*`, read left to right and non-nested: the bold
 * alternative is tried first at every position, so `**bold**` is one bold
 * run rather than two italic runs sharing a doubled star.
 *
 * **Deliberately not what mermaid 11.17.2 itself does**, and that gap is
 * measured rather than assumed: real Mermaid tokenizes a Markdown label by
 * *word*, so `plain **bold** plain` draws four `<tspan>`s (one per word) and
 * a bold run nested inside an italic one loses the bold the moment the
 * italic opens (`**bold *and* still**` draws "and" italic and not bold,
 * `scripts/mermaid-probe.mjs`). The corpus rows never mix or nest the two
 * within a line — `fc-text-markdown` is bold-only, `fc-text-italic` is
 * italic-only, `fc-text-multiline` carries neither — so a span-per-run
 * reading is indistinguishable from Mermaid's word-per-run one for
 * everything measured, and building the word-splitting, style-dropping
 * machinery to match an untested case would be building past what was
 * measured.
 */
const MARKDOWN_RUN_RE = /\*\*(.*?)\*\*|\*(.*?)\*/g;

/**
 * One row of a Markdown string, split into the runs `MARKDOWN_RUN_RE`
 * finds, with the plain text between and around them carried as runs of
 * their own.
 *
 * Always at least one run, even for an empty row — the rule `Label` states
 * for every row, and the reason a blank line in a Markdown string still
 * draws a row.
 */
function markdownRuns(row: string): LabelRun[] {
  const runs: LabelRun[] = [];
  let lastIndex = 0;
  MARKDOWN_RUN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKDOWN_RUN_RE.exec(row)) !== null) {
    if (match.index > lastIndex) {
      runs.push(plainRun(row.slice(lastIndex, match.index)));
    }
    if (match[1] !== undefined) {
      runs.push({ ...plainRun(match[1]), bold: true });
    } else {
      runs.push({ ...plainRun(match[2]!), italic: true });
    }
    lastIndex = MARKDOWN_RUN_RE.lastIndex;
  }
  if (lastIndex < row.length || runs.length === 0) {
    runs.push(plainRun(row.slice(lastIndex)));
  }
  return runs;
}

/** A label of these rows, with the flattened `text` every plain-string reader takes. */
function labelOf(rows: LabelRun[][]): Label {
  return {
    text: rows.map((row) => row.map((run) => run.text).join("")).join("\n"),
    rows,
  };
}
