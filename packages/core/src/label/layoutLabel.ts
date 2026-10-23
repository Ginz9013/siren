import type { TextMeasurer } from "../contracts";
import {
  atConnectorLabelSize,
  BASE_FONT_SIZE_PX,
  DEFAULT_TYPOGRAPHY,
  measuredScale,
  type Label,
  type LabelSizes,
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
 * counts as a scale of `LineSpacing.baseFontSizePx`, `Typography.fontSize`).
 * A line is Mermaid's: the size the label is drawn at times its line-height
 * ratio (`LineSpacing`; 14px × 1.5 = 21px unless the caller says otherwise) — never the measurer's height,
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
 * value is a multiple of the run's own size, the base
 * (`LineSpacing.baseFontSizePx`) times its `measuredScale`; any other unit (`rem`, `ch`, `%`) or keyword (`normal`)
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
export function layoutLabel(label: Label, measureText: TextMeasurer, spacing: LineSpacing = {}): LabelBox {
  const {
    fontSizePx = BASE_FONT_SIZE_PX,
    lineHeightRatio = LINE_HEIGHT_RATIO,
    baseFontSizePx = BASE_FONT_SIZE_PX,
  } = spacing;
  const measured = label.rows.map((row) =>
    row.map((run) => ({
      size: measureText.measure(run.text),
      scale: measuredScale(run, baseFontSizePx),
      spacing: spacingOf(run, baseFontSizePx),
    })),
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
    // Recorded for `drawLabel` only when it is not the default, which it
    // assumes when the field is absent.
    ...(baseFontSizePx === BASE_FONT_SIZE_PX ? {} : { baseFontSizePx }),
  };
}

/**
 * A label line's height over its font size: Mermaid's HTML labels are 16px
 * text on 24px lines (measured in headless Chrome, mermaid 11.17.2 — a
 * flowchart node of two `<br>` rows is a 48px `<div>`, of five wrapped rows
 * 120px; state, class and ER labels the same ratio at their own sizes). So
 * a row of Siren's 14px text is 21px tall.
 */
export const LINE_HEIGHT_RATIO = 24 / 16;

/**
 * How far apart a label's rows are: `layoutLabel` cannot read it off
 * `TextMeasurer`, which answers for a string and nothing else.
 * `fontSizePx` is the px a run of scale 1 is drawn at — the 14px base
 * (`BASE_FONT_SIZE_PX`) unless the caller says otherwise, and
 * `Typography.fontSize` for a label drawn at the base size — and has to be
 * the size `measureText` answers for, since the measurer's answer for one
 * line is that line plus its padding (a connector label's measurer is
 * scaled to its size, `atConnectorLabelSize`). `lineHeightRatio` is a line's height
 * over that size, `LINE_HEIGHT_RATIO` unless the caller says otherwise.
 */
export interface LineSpacing {
  fontSizePx?: number;
  lineHeightRatio?: number;
  /**
   * The px an author's absolute px run and an `em` spacing are counted
   * against (`measuredScale`): `Typography.fontSize`, the size the
   * measurer measures at — which for a connector label is not
   * `fontSizePx`, the size that label is drawn at. `BASE_FONT_SIZE_PX`
   * unless the caller says otherwise; recorded on the box
   * (`LabelBox.baseFontSizePx`) when it is anything else, for `drawLabel`.
   */
  baseFontSizePx?: number;
}

/**
 * Measures a connector's label — a flowchart edge's, a class or ER
 * relationship's, a state transition's — at the `labelFontSize` it is drawn
 * at (12px by default): the measurer scaled to that size
 * (`atConnectorLabelSize`) and rows a line of that size apart (12 × 1.5 =
 * 18px by default), the two always together, since a line height for one
 * size with a measurer for another would pad the label by the difference.
 * `sizes` defaults to `DEFAULT_TYPOGRAPHY`. A connector label that wraps is
 * laid out by `wrapConnectorLabel` (`wrapLabel.ts`), which pairs the same
 * two.
 */
export function layoutConnectorLabel(
  label: Label,
  measureText: TextMeasurer,
  sizes: LabelSizes = DEFAULT_TYPOGRAPHY,
): LabelBox {
  return layoutLabel(label, atConnectorLabelSize(measureText, sizes), {
    fontSizePx: sizes.labelFontSize,
    baseFontSizePx: sizes.fontSize,
  });
}

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
 * character, and its `word-spacing` once per space, an `em` counted against
 * the run's own size — `baseFontSizePx` times its `measuredScale`.
 */
function spacingOf(run: LabelRun, baseFontSizePx: number): number {
  const fontSize = baseFontSizePx * measuredScale(run, baseFontSizePx);
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
