/**
 * The rows an `html`-dialect label is read into, as they are assembled:
 * which rows there are, where a `<br>` or a block edge ends one, and the
 * spaces a block edge drops. What styles a run is handed in with it, as the
 * styles to apply; which tags are open is `readLabel`'s, and this module
 * knows nothing of them.
 */
import { plainRun, sameProperties, type LabelRun } from "./label";
import type { RunStyle } from "./vocabulary";

/** Assembles a label's rows, one appended run at a time. */
export class RowBuilder {
  private readonly rows: LabelRun[][] = [];
  private row: LabelRun[] = [];
  /**
   * Whether the current row is drawn even with nothing on it: one a `<br>`
   * began, or the label's first, is drawn; one a block edge began is drawn
   * only once something is on it.
   */
  private held = true;
  /**
   * Whether the current row began at a block edge, where the browser drops
   * the spaces at either end of its line (CSS's white-space processing). Rows
   * no block touches keep theirs, as they always have.
   */
  private edge = false;

  /**
   * What of `written` the current row draws — every space and tab kept as a
   * no-break space when `preservesSpaces` (inside a `pre`), and the spaces
   * that begin a row at a block edge dropped — or `""` when nothing of it is
   * drawn. It appends nothing, so the caller can put what goes ahead of it
   * on the row first, and nothing at all when this is `""`.
   */
  drawnText(written: string, { preservesSpaces }: { preservesSpaces: boolean }): string {
    const kept = preservesSpaces ? written.replace(/[ \t]/g, "\u00a0") : written;
    return this.edge && this.row.length === 0 ? kept.replace(/^[ \t\n]+/, "") : kept;
  }

  /** Appends `text` to the current row as it stands, styled by each of `styles` in turn. */
  put(text: string, styles: readonly RunStyle[]): void {
    const run = plainRun(text);
    for (const style of styles) {
      style(run);
    }
    const last = this.row[this.row.length - 1];
    if (last !== undefined && sameProperties(last, run)) {
      last.text += text;
    } else {
      this.row.push(run);
    }
  }

  /** Ends the row at a `<br>`, which draws the row it ends, empty or not. */
  lineBreak(): void {
    this.rows.push(this.row.length === 0 ? [plainRun("")] : this.row);
    this.row = [];
    this.held = true;
    this.edge = false;
  }

  /** Ends the row at the edge of a block, if anything is on it. */
  boundary(): void {
    trimEnd(this.row);
    if (this.row.length > 0) {
      this.rows.push(this.row);
      this.row = [];
    }
    this.held = false;
    this.edge = true;
  }

  /** The rows, the current one ended as the label's end ends it. */
  finish(): LabelRun[][] {
    if (this.edge) {
      trimEnd(this.row);
    }
    if (this.row.length > 0 || this.held || this.rows.length === 0) {
      this.rows.push(this.row.length === 0 ? [plainRun("")] : this.row);
    }
    return this.rows;
  }
}

/** Drops the spaces that end `row`, and any run they were all of. */
function trimEnd(row: LabelRun[]): void {
  while (row.length > 0) {
    const last = row[row.length - 1]!;
    last.text = last.text.replace(/[ \t\n]+$/, "");
    if (last.text !== "") {
      return;
    }
    row.pop();
  }
}
