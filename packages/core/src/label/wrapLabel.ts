import type { TextMeasurer } from "../contracts";
import {
  atConnectorLabelSize,
  CONNECTOR_LABEL_FONT_SIZE_PX,
  wrapWidthAt,
  type Label,
  type LabelBox,
  type LabelRun,
} from "./label";
import { layoutLabel, measurerPadding, type LineSpacing } from "./layoutLabel";

/**
 * Wraps a label at `wrapWidth` and measures what is drawn: the **Wrap** of
 * `CONTEXT.md`, by the rules of the label-wrap ADR, nook `01M4R4WDZ`.
 *
 * Mermaid lays a label out unwrapped and, once it reaches its wrapping
 * width, fixes the label's `<div>` at that width and lets the browser
 * break it (mermaid 11.17.2, measured). This is that rule for a
 * label Siren draws as SVG rows:
 *
 * - **Nothing to wrap.** With no `wrapWidth` (`undefined` or `Infinity`),
 *   or one every row fits in, the answer is `layoutLabel`'s, and `label` is
 *   handed back as it is.
 * - **Each written row on its own.** A `<br>` still ends its row, and each
 *   row the author wrote is broken on its own; a row that fits is left
 *   whole. So `short<br>…long…` keeps `short` alone on its row.
 * - **Where a row may break**: after a run of spaces, which are dropped at
 *   the break and kept anywhere else; and between two characters either of
 *   which is CJK (Han, kana, Hangul, CJK punctuation, full-width forms) —
 *   measured, Chrome breaks `…OP中` / `文` / `ABC…`. Never before one of
 *   `，。、；：？！」』）】》,.;:?!)]}`, which may not begin a row. Not
 *   UAX #14: these are the rules the spec chose (the label-wrap ADR, nook
 *   `01M4R4WDZ`).
 * - **The wrap width bounds the text.** Mermaid's fixed-width `<div>`
 *   holds text only, its shape's padding outside it; here the measurer's
 *   padding, which `layoutLabel` counts once per row, is outside `wrapWidth`
 *   the same way. A row fits when its text is at most `wrapWidth`.
 * - **Spaces ending a row draw nothing**, so they count toward no row's
 *   width: they neither make a row too wide to fit nor widen the box.
 * - **Greedy**: each row takes as many pieces as fit.
 * - **A piece too long for any row** is not cut: it stands on a row of its
 *   own and overflows it, as Mermaid's HTML label does.
 * - **The box.** Once any row wraps, the box is `wrapWidth` plus the
 *   measurer's padding wide — Mermaid's fixed-width `<div>`, padded as every
 *   label box is — or as wide as the widest overflowing row, if one is
 *   wider. Rows and heights are `layoutLabel`'s for the wrapped label.
 *
 * A run broken across rows is the same run in every piece: only its text
 * differs, and its pieces read in order are its text less the spaces
 * dropped at the breaks. The wrapped label's `text` is its rows joined by
 * `\n`, as `Label.text` is defined. Pure: nothing is written to `label`.
 *
 * Which labels wrap, and at what width, is the caller's: `wrapWidthAt`
 * gives the width for the size a label is drawn at. `spacing` is
 * `layoutLabel`'s, and has to match the size `measureText` measures at; a
 * connector's label is wrapped with both by `wrapConnectorLabel`.
 */
export function wrapLabel(
  label: Label,
  measureText: TextMeasurer,
  wrapWidth: number | undefined,
  spacing: LineSpacing = {},
): { label: Label; labelBox: LabelBox } {
  const box = layoutLabel(label, measureText, spacing);
  if (wrapWidth === undefined) {
    return { label, labelBox: box };
  }
  // A row is measured as its text plus the measurer's padding once
  // (`layoutLabel`), and the wrap width bounds the text alone: a row fits
  // when it is no wider than the two together.
  const paddedWrapWidth = wrapWidth + measurerPadding(measureText);
  if (label.rows.every((row) => drawnWidth(row, measureText) <= paddedWrapWidth)) {
    return { label, labelBox: box };
  }
  const rows = label.rows.flatMap((row) => wrapRow(row, measureText, paddedWrapWidth));
  const wrapped: Label = {
    text: rows.map((row) => row.map((run) => run.text).join("")).join("\n"),
    rows,
  };
  const widest = Math.max(...rows.map((row) => drawnWidth(row, measureText)));
  return {
    label: wrapped,
    labelBox: { ...layoutLabel(wrapped, measureText, spacing), width: Math.max(paddedWrapWidth, widest) },
  };
}

/** One character of a row, and the run it was written in. */
interface Character {
  text: string;
  run: LabelRun;
}

/**
 * One written row, broken into the rows it is drawn as. A row that fits in
 * `paddedWrapWidth` (the wrap width plus the measurer's padding, which is
 * how wide a row whose text is exactly the wrap width measures) comes back
 * whole. Otherwise its pieces are laid into rows greedily, each row ending
 * at the last piece that fits, without the spaces at the break; a piece
 * wider than `paddedWrapWidth` on its own is a row of its own, wider than
 * the rest.
 */
function wrapRow(written: LabelRun[], measureText: TextMeasurer, paddedWrapWidth: number): LabelRun[][] {
  if (drawnWidth(written, measureText) <= paddedWrapWidth) {
    return [written];
  }
  const characters = written.flatMap((run) => Array.from(run.text, (text) => ({ text, run })));
  const rows: Character[][] = [];
  let row: Character[] = [];
  for (const piece of pieces(characters)) {
    const candidate = [...row, ...piece];
    if (row.length > 0 && widthOf(runsOf(trimEnd(candidate)), measureText) > paddedWrapWidth) {
      rows.push(trimEnd(row));
      row = piece;
    } else {
      row = candidate;
    }
  }
  rows.push(row);
  return rows.map(runsOf);
}

/**
 * A row cut at every place it may break: each piece is what must stay on
 * one row, followed by the spaces after it. Spaces a row begins with are
 * not a piece of their own — they belong to the first piece — so no row is
 * ever only spaces, and none is empty once its spaces are dropped.
 */
function pieces(characters: Character[]): Character[][] {
  const result: Character[][] = [];
  let piece: Character[] = [];
  characters.forEach((character, index) => {
    if (index > 0 && breaksBefore(characters, index) && !piece.every((each) => isSpace(each.text))) {
      result.push(piece);
      piece = [];
    }
    piece.push(character);
  });
  result.push(piece);
  return result;
}

/** Whether a row may begin at `characters[index]`. */
function breaksBefore(characters: Character[], index: number): boolean {
  const before = characters[index - 1]!.text;
  const after = characters[index]!.text;
  if (isSpace(after) || NO_ROW_START.has(after)) {
    return false;
  }
  return isSpace(before) || isCjk(before) || isCjk(after);
}

/** What may not begin a row: closing and trailing punctuation, CJK and ASCII. */
const NO_ROW_START = new Set(Array.from("，。、；：？！」』）】》,.;:?!)]}"));

/**
 * A CJK character: one any row may be broken before or after. Han, kana and
 * Hangul by script; CJK punctuation (U+3000–303F) and the full-width forms
 * (U+FF00–FFEF) by block.
 */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;

function isCjk(text: string): boolean {
  return CJK.test(text);
}

function isSpace(text: string): boolean {
  return text === " " || text === "\t";
}

/** `row` less the spaces that end it — what a row broken there draws. */
function trimEnd(row: Character[]): Character[] {
  let end = row.length;
  while (end > 0 && isSpace(row[end - 1]!.text)) {
    end--;
  }
  return row.slice(0, end);
}

/**
 * A row's characters as runs again: one per stretch from the same written
 * run, its properties untouched.
 */
function runsOf(row: Character[]): LabelRun[] {
  const runs: LabelRun[] = [];
  let source: LabelRun | null = null;
  for (const character of row) {
    if (character.run === source) {
      runs[runs.length - 1]!.text += character.text;
    } else {
      runs.push({ ...character.run, text: character.text });
      source = character.run;
    }
  }
  return runs;
}

/**
 * How wide `row` is drawn: its width without the spaces that end it, which
 * draw nothing. A row that is nothing but spaces is as wide as an empty one.
 */
function drawnWidth(row: LabelRun[], measureText: TextMeasurer): number {
  const drawn = runsOf(trimEnd(row.flatMap((run) => Array.from(run.text, (text) => ({ text, run })))));
  return widthOf(drawn.length > 0 ? drawn : [{ ...row[0]!, text: "" }], measureText);
}

/** `layoutLabel`'s width for a label of the one row `row`. */
function widthOf(row: LabelRun[], measureText: TextMeasurer): number {
  return layoutLabel({ text: "", rows: [row] }, measureText).width;
}

/** A connector's label wraps at Mermaid's 200px scaled to the 12px it is drawn at: 150px of text. */
const CONNECTOR_LABEL_WRAP_WIDTH = wrapWidthAt(CONNECTOR_LABEL_FONT_SIZE_PX);

/**
 * Wraps a connector's label — a flowchart edge's, and by the label-wrap ADR
 * a state transition's and a class or ER relationship's — at the 12px it is
 * drawn at: `layoutConnectorLabel`'s measurer and line spacing, and the wrap
 * width for that size (150px of text), all three together, so no caller can
 * pair a width, a measurer and a line height meant for different sizes.
 * Here rather than beside `layoutConnectorLabel` because `layoutLabel.ts`
 * is what this module is built on.
 */
export function wrapConnectorLabel(label: Label, measureText: TextMeasurer): { label: Label; labelBox: LabelBox } {
  return wrapLabel(label, atConnectorLabelSize(measureText), CONNECTOR_LABEL_WRAP_WIDTH, {
    fontSizePx: CONNECTOR_LABEL_FONT_SIZE_PX,
  });
}
