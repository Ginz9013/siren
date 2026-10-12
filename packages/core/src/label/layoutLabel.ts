import type { TextMeasurer } from "../contracts";
import {
  BASE_FONT_SIZE_PX,
  CONNECTOR_LABEL_FONT_SIZE_PX,
  LINE_HEIGHT_RATIO,
  measuredScale,
  type Label,
  type LabelBox,
  type LabelBoxRow,
  type LabelRun,
} from "./label";

/**
 * Measures a label: the box it needs, and where each row and run sits in it.
 *
 * **One measurer call per run, plus one for the empty string.** Both real
 * measurers in this repo answer with the text's width *plus a fixed padding*
 * (`index.ts`'s default adds 16px, `siren-board`'s canvas measurer 24px),
 * which is right for the box a label is drawn in and wrong for a run
 * sitting beside another run: summing two runs' answers would pad the row
 * twice. So the padding is asked for directly — what the measurer answers
 * for `""` is, by definition, what it adds to every string — and counted
 * once per row, half on each side. That assumes a measurer whose padding
 * does not depend on the text it measures, which both measurers in this
 * repo satisfy (a constant added to the measured width); one that padded
 * some strings more than others would get run widths off by the
 * difference. A run's own width is its answer less
 * that padding. For the overwhelmingly common label, one row of one plain
 * run, the row's width therefore comes out *exactly* the measurer's answer
 * for the text, the number every label was sized with before rows existed.
 *
 * Measured after the label's own text rather than before, so that the first
 * string a consumer's measurer is asked about is one the author wrote: a
 * measurer that cannot measure at all is reported naming that string
 * (`render()`'s `UnmeasurableTextError`), not an empty one.
 *
 * **Heights.** A row is as tall as its tallest run, and a run is one line
 * times its font-size scale (`measuredScale`: an author's absolute px size
 * counts as a scale of the 14px base). A line is Mermaid's: the size the
 * label is drawn at times its line-height ratio (`LabelLine`; 14px × 1.5 =
 * 21px unless the caller says otherwise) — never the measurer's height,
 * which is a line *plus* its padding and cannot say which is which. The
 * rows are stacked with no gap, and the measurer's vertical padding — its
 * answer for `""` less one line — is added once, half above them and half
 * below, as Mermaid's shape padding sits outside its label `<div>`. So a
 * one-row label at scale 1 is exactly as tall as the measurer's answer, the
 * height every label had before its rows were spaced at Mermaid's line
 * height, and each row after it adds one line. A measurer whose line is
 * shorter than Mermaid's (a test's 20px) pads by a negative amount, which
 * keeps that one-row height all the same.
 *
 * **Spacing.** A run's `letter-spacing` is added once per character and
 * its `word-spacing` once per space, as CSS adds them, so the box — and a
 * mark or background rect, which takes the run's measured width — is as
 * wide as the text drawn with them. A `px` value counts as written; an `em`
 * value is a multiple of the run's own size, the 14px base times its
 * `measuredScale`; any other unit (`rem`, `ch`, `%`) or keyword (`normal`)
 * has no px to read here and is measured as no spacing, though it is still
 * drawn.
 *
 * Bold runs are measured at the regular weight, a simplification the
 * Markdown labels this replaces already made and the spec keeps: a
 * pixel-exact width would have to know every weight the measurer's font
 * draws, and nothing downstream needs the box to be that exact. A monospace
 * run (`<code>` and its kin) is measured in the regular font for the same
 * reason: `TextMeasurer` measures in one font, and asking it about a second
 * would widen an interface every consumer implements.
 *
 * Pure: no call leaves anything behind but the measurer's own.
 */
export function layoutLabel(label: Label, measureText: TextMeasurer, line: LabelLine = {}): LabelBox {
  const { fontSizePx = BASE_FONT_SIZE_PX, lineHeightRatio = LINE_HEIGHT_RATIO } = line;
  const measured = label.rows.map((row) =>
    row.map((run) => ({ size: measureText.measure(run.text), scale: measuredScale(run), spacing: spacingOf(run) })),
  );
  const padding = measurerPadding(measureText);
  const lineHeight = fontSizePx * lineHeightRatio;
  // What the measurer adds to one line's height, as `padding` is what it adds
  // to every width: its answer for `""` less the line itself. Added once,
  // half above the rows and half below, so a one-row label is exactly as
  // tall as the measurer's answer — the height every label had before rows
  // were spaced at Mermaid's line height.
  const verticalPadding = measureText.measure("").height - lineHeight;

  let top = verticalPadding / 2;
  const rows: LabelBoxRow[] = measured.map((runs) => {
    const height = Math.max(...runs.map(({ scale }) => lineHeight * scale));
    let x = padding / 2;
    const placed = runs.map(({ size, scale, spacing }) => {
      const run = { x, width: (size.width - padding) * scale + spacing };
      x += run.width;
      return run;
    });
    const row = { y: top + height / 2, height, width: x + padding / 2, runs: placed };
    top += height;
    return row;
  });

  return {
    width: Math.max(...rows.map((row) => row.width)),
    height: top + verticalPadding / 2,
    rows,
  };
}

/**
 * The size a label is drawn at, which its line height follows: `layoutLabel`
 * cannot read it off `TextMeasurer`, which answers for a string and nothing
 * else. `fontSizePx` is the px a run of scale 1 is drawn at — the 14px base
 * (`BASE_FONT_SIZE_PX`) unless the caller says otherwise, as a connector
 * label's 12px (`CONNECTOR_LABEL_FONT_SIZE_PX`) does. It has to be the size
 * `measureText` measures at, since the measurer's answer for one line is that
 * line plus its padding.
 */
export interface LabelLine {
  fontSizePx?: number;
  /** A line's height over its font size: `LINE_HEIGHT_RATIO` unless given. */
  lineHeightRatio?: number;
}

/**
 * A connector label's line: drawn at `CONNECTOR_LABEL_FONT_SIZE_PX`, and
 * measured with `atConnectorLabelSize`, so its rows are 12 × 1.5 = 18px.
 */
export const CONNECTOR_LINE: LabelLine = { fontSizePx: CONNECTOR_LABEL_FONT_SIZE_PX };

/**
 * A sequence diagram's line for a message, a note, and a block's or a
 * divider's condition. Mermaid draws sequence text as SVG `<text>`, and these
 * rows sit 19px apart at 16px (measured in headless Chrome, mermaid 11.17.2:
 * a two-row message, note, `alt` condition and `else` condition alike) — not
 * the 1.5 of its HTML labels — so at Siren's 14px a row is 16.625px.
 */
export const SEQUENCE_LINE: LabelLine = { lineHeightRatio: 19 / 16 };

/**
 * A sequence diagram's line for a participant and a box's caption, which
 * Mermaid spaces closer than its other sequence text: one font size apart,
 * each row's `dy` 8px either side of the centre at 16px (measured, mermaid
 * 11.17.2). At Siren's 14px a row is 14px.
 */
export const SEQUENCE_PARTICIPANT_LINE: LabelLine = { lineHeightRatio: 1 };

/**
 * The padding `measureText` adds to every string it measures: its answer
 * for `""`, which is by definition what it adds to every string (see
 * `layoutLabel`). A row is that much wider than its text — counted once per
 * row, half on each side — which is how `wrapLabel` tells a row's text from
 * its padding.
 */
export function measurerPadding(measureText: TextMeasurer): number {
  return measureText.measure("").width;
}

/**
 * The px a run's spacing adds to its width: its `letter-spacing` once per
 * character, and its `word-spacing` once per space.
 */
function spacingOf(run: LabelRun): number {
  const fontSize = BASE_FONT_SIZE_PX * measuredScale(run);
  const characters = Array.from(run.text);
  const spaces = characters.filter((character) => character === " ").length;
  return characters.length * spacingPx(run.letterSpacing, fontSize) + spaces * spacingPx(run.wordSpacing, fontSize);
}

/**
 * One spacing value in px: as written for `px`, times `fontSize` for `em`,
 * and 0 for any other unit or keyword, which has no px to read here.
 */
function spacingPx(value: string | null, fontSize: number): number {
  const match = value === null ? null : /^(-?\d*\.?\d+)(px|em)$/i.exec(value);
  if (match === null) {
    return 0;
  }
  return Number(match[1]) * (match[2]!.toLowerCase() === "em" ? fontSize : 1);
}
