import type { TextMeasurer } from "../contracts";
import type { Label, LabelBox, LabelRun } from "./label";
import { layoutLabel } from "./layoutLabel";

/**
 * Wraps a label at `wrapWidth` and measures what is drawn: the **Wrap** of
 * `CONTEXT.md`, by the rules of the label-wrap ADR, nook `01M4R4WDZ`.
 *
 * Mermaid lays a label out on one line and, once that line reaches its
 * wrapping width, fixes the label's `<div>` at that width and lets the
 * browser break it (mermaid 11.17.2, measured). This is that rule for a
 * label Siren draws as SVG rows:
 *
 * - **Nothing to wrap.** With no `wrapWidth` (`undefined` or `Infinity`), or
 *   one every row fits in, the answer is `layoutLabel`'s, and `label` is
 *   handed back as it is.
 * - **Each written row on its own.** A `<br>` still ends its row, and each
 *   row the author wrote is broken on its own; a row that fits is left
 *   whole. So `short<br>…long…` keeps `short` alone on its line.
 * - **Where a row may break**: after a run of spaces, which are dropped at
 *   the break and kept anywhere else; and between two characters either of
 *   which is CJK (Han, kana, Hangul, CJK punctuation, full-width forms) —
 *   measured, Chrome breaks `…OP中` / `文` / `ABC…`. Never before one of
 *   `，。、；：？！」』）】》,.;:?!)]}`, which may not begin a line. Not
 *   UAX #14: these are the rules the spec chose (the label-wrap ADR, nook `01M4R4WDZ`).
 * - **The wrap width bounds the text.** Mermaid's fixed-width `<div>` holds
 *   text only, its shape's padding outside it; here the measurer's padding,
 *   which `layoutLabel` counts once per row, is outside `wrapWidth` the same
 *   way. A row fits when its text is at most `wrapWidth`.
 * - **Greedy**: each line takes as many pieces as fit.
 * - **A piece too long for any line** is not cut: it stands on a line of its
 *   own and overflows it, as Mermaid's HTML label does.
 * - **The box.** Once any row wraps, the box is `wrapWidth` plus the
 *   measurer's padding wide — Mermaid's fixed-width `<div>`, padded as every
 *   label box is — or as wide as the widest overflowing line, if one is
 *   wider. Rows and heights are `layoutLabel`'s for the wrapped label.
 *
 * A run broken across lines is the same run in every piece: only its text
 * differs, and its pieces read in order are its text less the spaces dropped
 * at the breaks. The wrapped label's `text` is its rows joined by `\n`, as
 * `Label.text` is defined. Pure: nothing is written to `label`.
 *
 * Which labels wrap, and at what width, is the caller's: `wrapWidthAt` gives
 * the width for the size a label is drawn at.
 */
export function wrapLabel(
  label: Label,
  measureText: TextMeasurer,
  wrapWidth: number | undefined,
): { label: Label; labelBox: LabelBox } {
  const box = layoutLabel(label, measureText);
  if (wrapWidth === undefined) {
    return { label, labelBox: box };
  }
  // A row's measured width is its text plus the measurer's padding once
  // (`layoutLabel`); the wrap width bounds the text alone, so a row may be
  // that padding wider.
  const rowLimit = wrapWidth + measureText.measure("").width;
  if (box.rows.every((row) => row.width <= rowLimit)) {
    return { label, labelBox: box };
  }
  const rows = label.rows.flatMap((row) => wrapRow(row, measureText, rowLimit));
  const wrapped: Label = {
    text: rows.map((row) => row.map((run) => run.text).join("")).join("\n"),
    rows,
  };
  const wrappedBox = layoutLabel(wrapped, measureText);
  return { label: wrapped, labelBox: { ...wrappedBox, width: Math.max(rowLimit, wrappedBox.width) } };
}

/** One character of a row, and the run it was written in. */
interface Character {
  text: string;
  run: LabelRun;
}

/** One written row, as the lines it is drawn on — none wider than `rowLimit`, padding included, but an overflowing piece: itself, when it fits. */
function wrapRow(row: LabelRun[], measureText: TextMeasurer, rowLimit: number): LabelRun[][] {
  if (widthOf(row, measureText) <= rowLimit) {
    return [row];
  }
  const characters = row.flatMap((run) => Array.from(run.text, (text) => ({ text, run })));
  const lines: Character[][] = [];
  let line: Character[] = [];
  for (const piece of pieces(characters)) {
    const candidate = [...line, ...piece];
    if (line.length > 0 && widthOf(runsOf(trimEnd(candidate)), measureText) > rowLimit) {
      lines.push(trimEnd(line));
      line = piece;
    } else {
      line = candidate;
    }
  }
  lines.push(line);
  return lines.map(runsOf);
}

/**
 * A row cut at every place it may break: each piece is what must stay on
 * one line, followed by the spaces after it. Spaces a row begins with are
 * not a piece of their own — they belong to the first piece — so no line is
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

/** Whether a line may begin at `characters[index]`. */
function breaksBefore(characters: Character[], index: number): boolean {
  const before = characters[index - 1]!.text;
  const after = characters[index]!.text;
  if (isSpace(after) || NO_LINE_START.has(after)) {
    return false;
  }
  return isSpace(before) || isCjk(before) || isCjk(after);
}

/** What may not begin a line: closing and trailing punctuation, CJK and ASCII. */
const NO_LINE_START = new Set(Array.from("，。、；：？！」』）】》,.;:?!)]}"));

/**
 * A CJK character: one any line may be broken before or after. Han, kana and
 * Hangul by script; CJK punctuation (U+3000–303F) and the full-width forms
 * (U+FF00–FFEF) by block.
 */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u;

function isCjk(text: string): boolean {
  return CJK.test(text);
}

function isSpace(text: string): boolean {
  return text === " " || text === "\t";
}

/** `line` less the spaces that end it — what a line broken there draws. */
function trimEnd(line: Character[]): Character[] {
  let end = line.length;
  while (end > 0 && isSpace(line[end - 1]!.text)) {
    end--;
  }
  return line.slice(0, end);
}

/** A line's characters as runs again: one per stretch from the same written run, its properties untouched. */
function runsOf(line: Character[]): LabelRun[] {
  const runs: LabelRun[] = [];
  let source: LabelRun | null = null;
  for (const character of line) {
    if (character.run === source) {
      runs[runs.length - 1]!.text += character.text;
    } else {
      runs.push({ ...character.run, text: character.text });
      source = character.run;
    }
  }
  return runs;
}

/** How wide `row` is drawn: `layoutLabel`'s width for a label of that one row. */
function widthOf(row: LabelRun[], measureText: TextMeasurer): number {
  return layoutLabel({ text: "", rows: [row] }, measureText).width;
}
