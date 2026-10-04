/**
 * The **label** model: what an author wrote in one place a diagram draws
 * text, read as rows of runs. See ADR-0015 for the picture it is held to —
 * what Mermaid's default `htmlLabels: true` shows a reader — and for why it
 * is still drawn as SVG `<text>`/`<tspan>` rather than as HTML.
 *
 * The types live here rather than in `contracts.ts`, which re-exports them,
 * so that a ticket widening the tag vocabulary only ever touches this
 * directory: every field a tag can set is declared now, and a tag nobody has
 * taught `readLabel` yet simply leaves its run at the defaults below.
 */

/**
 * A label, read: one array of runs per drawn row, in source order.
 *
 * `text` is the *flattened* plain text — every run's text concatenated and
 * the rows joined by `\n` — for the readers that only ever needed a string:
 * a diagnostic quoting a label, the redeclaration warning comparing two.
 * It is derived, never authoritative: what is drawn is `rows`.
 *
 * Never zero rows, and never a row with zero runs. An empty row (`a<br>`
 * ends in one) carries one empty run, so every reader can take `rows[i][0]`
 * without asking first — the rule the Markdown runs it replaces already
 * followed.
 */
export interface Label {
  text: string;
  rows: LabelRun[][];
}

/**
 * One stretch of a row's text sharing one set of properties.
 *
 * **Independent axes, not a closed set of styles** — the rule the Markdown
 * runs this replaces set, because Mermaid's picture is built that way:
 * `<b><i>x</i></b>` is bold *and* italic, and `**bold**` sets only
 * `font-weight`. Every field has a neutral value (`false`, `null`,
 * `{ scale: 1 }`, `"normal"`), and a run carrying only neutral values is a
 * **plain run** — the one kind `drawLabel` may write as bare `textContent`.
 *
 * `fontSize` is a scale of Siren's own font size for everything a tag or a
 * relative size sets (`small` is × 0.833 in Mermaid's picture, measured),
 * and an absolute size only when the author wrote one (`font-size: 20px`),
 * which is drawn as written. `baseline` is the `sub`/`sup` shift. `mark` is
 * the `<mark>` tag's own paint, kept apart from `background` because the
 * theme paints the one and the author the other.
 */
export interface LabelRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  monospace: boolean;
  fontFamily: string | null;
  fontSize: { scale: number } | { absolute: string };
  baseline: "normal" | "sub" | "super";
  color: string | null;
  background: string | null;
  mark: boolean;
  letterSpacing: string | null;
  wordSpacing: string | null;
  opacity: string | null;
  href: string | null;
}

/**
 * Something `readLabel` has to tell the author about the label it read.
 *
 * `offset` is the problem's character position in the `source` that was
 * read — not a line and column, because only the parser knows where in the
 * document that source began, and it is the parser that turns this into a
 * `Diagnostic`. An `error` costs the whole document, exactly as an
 * unrecognized line does.
 */
export interface LabelProblem {
  severity: "error" | "warning";
  message: string;
  offset: number;
}

/**
 * Which vocabulary a place reads its label with.
 *
 * `html` is the whole of ADR-0015's vocabulary, which is what every place
 * Mermaid draws as HTML gets. `sequence` is `<br>` and entity codes only,
 * because Mermaid draws sequence text as SVG in both modes, so there the
 * literal characters of any other tag *are* the picture.
 */
export type LabelDialect = "html" | "sequence";

/**
 * A measured label: the box it needs, and where inside that box each row
 * and run sits.
 *
 * A row's `y` is its **centre**, measured from the top of the box, because
 * that is what `dominant-baseline: middle` reads a `y` as. `width` and
 * `height` on the box are what layout reserves for the label.
 *
 * A run's `x` is the left edge of its **text**, measured from the left edge
 * of its row, and a row's left edge is the left edge of the row's `width` —
 * which includes the measurer's padding, half on each side (see
 * `layoutLabel`). So a row's first run sits at `x = padding / 2`, not at 0,
 * and its `width` is the text's own, with no padding in it. A row is drawn
 * centred, so its left edge is at the box's centre less `row.width / 2`
 * (not the box's left edge, for any row narrower than the widest).
 */
export interface LabelBox {
  width: number;
  height: number;
  rows: LabelBoxRow[];
}

/** One measured row of a `LabelBox`. */
export interface LabelBoxRow {
  y: number;
  height: number;
  width: number;
  runs: { x: number; width: number }[];
}

/** A run of `text` carrying no property at all — the neutral value of every axis. */
export function plainRun(text: string): LabelRun {
  return {
    text,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    monospace: false,
    fontFamily: null,
    fontSize: { scale: 1 },
    baseline: "normal",
    color: null,
    background: null,
    mark: false,
    letterSpacing: null,
    wordSpacing: null,
    opacity: null,
    href: null,
  };
}

/**
 * Whether `run` is a **plain run**: every property but its text at the
 * neutral value `plainRun` states. Derived from `plainRun` rather than
 * listing the fields again, so a property added to `LabelRun` is neutral in
 * one place only.
 */
export function isPlain(run: LabelRun): boolean {
  return sameProperties(run, plainRun(run.text));
}

/**
 * Whether two runs carry the same value on every property but their text —
 * so that `<b>a</b><strong>b</strong>` reads as one bold run, and a tag that
 * sets nothing a run can show leaves a plain label plain.
 */
export function sameProperties(a: LabelRun, b: LabelRun): boolean {
  return (Object.keys(a) as (keyof LabelRun)[]).every(
    // `fontSize` is the one object-valued property; JSON compares it by value.
    (key) => key === "text" || JSON.stringify(a[key]) === JSON.stringify(b[key]),
  );
}

/**
 * The scale `run` is drawn at relative to the size around it, or `null`
 * when the author wrote an absolute size, which no scale describes.
 */
export function relativeScale(run: LabelRun): number | null {
  return "scale" in run.fontSize ? run.fontSize.scale : null;
}

/**
 * The base size an author's absolute px size is measured against: Siren's
 * default `--siren-font-size`. A consumer who changes that token gets boxes
 * sized for 14px around such a run (the board's accepted risk).
 */
const BASE_FONT_SIZE_PX = 14;

/**
 * The factor `run` is *measured* at relative to one measured line: its
 * scale, or, for an absolute size the author wrote in px, that size over
 * the 14px base. Any other absolute size (`large`, `1.2rem`) has no number
 * of px to read and is measured at the base size. `layoutLabel` sizes a run
 * with this and `drawLabel` places its background with it, so the two agree.
 */
export function measuredScale(run: LabelRun): number {
  if ("scale" in run.fontSize) {
    return run.fontSize.scale;
  }
  const px = /^(\d*\.?\d+)px$/i.exec(run.fontSize.absolute);
  return px === null ? 1 : Number(px[1]) / BASE_FONT_SIZE_PX;
}

/**
 * A label of one row holding one plain run — what a node written without a
 * label (`A`, `A:::name`) is labelled with: its own id, which has no tag in
 * it to read.
 */
export function plainLabel(text: string): Label {
  return { text, rows: [[plainRun(text)]] };
}
