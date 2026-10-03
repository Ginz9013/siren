import type { TextMeasurer } from "../contracts";
import type { Label, LabelBox, LabelBoxRow, LabelRun } from "./label";

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
 * measured line height times its font-size scale; the label is its rows
 * stacked with no gap. Both real measurers answer a height that depends on
 * the font and not on the text, so "one line" is never a guess about which
 * string is representative.
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
    row.map((run) => ({ size: measureText.measure(run.text), scale: scaleOf(run) })),
  );
  const padding = measureText.measure("").width;

  let top = 0;
  const rows: LabelBoxRow[] = measured.map((runs) => {
    const height = Math.max(...runs.map(({ size, scale }) => size.height * scale));
    let x = padding / 2;
    const placed = runs.map(({ size, scale }) => {
      const run = { x, width: (size.width - padding) * scale };
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
 * The factor a run's size is drawn at relative to Siren's own font size.
 *
 * An absolute size an author wrote is drawn as written, which no measurer
 * here can size yet — it measures at one font — so until a tag can set one
 * it is measured at the base size.
 */
function scaleOf(run: LabelRun): number {
  return "scale" in run.fontSize ? run.fontSize.scale : 1;
}
