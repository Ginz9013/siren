import type { TextMeasurer } from "../contracts";
import { BASE_FONT_SIZE_PX, measuredScale, type Label, type LabelBox, type LabelBoxRow, type LabelRun } from "./label";

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
 * **Heights.** A row is as tall as its tallest run, and a run is one
 * measured line height times its font-size scale (`measuredScale`: an
 * author's absolute px size counts as a scale of the 14px base); the label is its rows
 * stacked with no gap. Both real measurers answer a height that depends on
 * the font and not on the text, so "one line" is never a guess about which
 * string is representative.
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
 * Markdown labels this replaces already made and the board keeps: a
 * pixel-exact width would have to know every weight the measurer's font
 * draws, and nothing downstream needs the box to be that exact. A monospace
 * run (`<code>` and its kin) is measured in the regular font for the same
 * reason: `TextMeasurer` measures in one font, and asking it about a second
 * would widen an interface every consumer implements.
 *
 * Pure: no call leaves anything behind but the measurer's own.
 */
export function layoutLabel(label: Label, measureText: TextMeasurer): LabelBox {
  const measured = label.rows.map((row) =>
    row.map((run) => ({ size: measureText.measure(run.text), scale: measuredScale(run), spacing: spacingOf(run) })),
  );
  const padding = measureText.measure("").width;

  let top = 0;
  const rows: LabelBoxRow[] = measured.map((runs) => {
    const height = Math.max(...runs.map(({ size, scale }) => size.height * scale));
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
    height: top,
    rows,
  };
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
