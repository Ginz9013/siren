import { describe, expect, it } from "vitest";
import type { TextMeasurer } from "../contracts";
import { layoutLabel } from "./layoutLabel";
import { readLabel } from "./readLabel";
import { wrapLabel } from "./wrapLabel";

/**
 * 10px a character, 20px a line, and 10px of the measurer's own padding on
 * every answer — the shape of both real measurers (a fixed padding added to
 * the text's width), with round numbers so every width below is worked out
 * by hand: a row of `n` characters is `10n + 10` wide.
 */
const measurer: TextMeasurer = {
  measure(text: string) {
    return { width: Array.from(text).length * 10 + 10, height: 20 };
  },
};

/** A label's drawn rows, each as its runs' text joined. */
function rowTexts(label: { rows: { text: string }[][] }): string[] {
  return label.rows.map((row) => row.map((run) => run.text).join(""));
}

describe("wrapLabel when nothing needs wrapping", () => {
  // The spec: with no wrap width, or one every row fits in, the result is
  // exactly what `layoutLabel` measures, and the label is handed back as is.
  it.each([
    ["no wrap width", undefined],
    ["an infinite wrap width", Infinity],
    ["a wrap width every row fits in", 50],
  ])("is layoutLabel's box and the same label, with %s", (_, wrapWidth) => {
    const { label } = readLabel("ab **cd**<br>e", { dialect: "html", markdown: true });

    const wrapped = wrapLabel(label, measurer, wrapWidth);

    expect(wrapped.label).toBe(label);
    expect(wrapped.labelBox).toEqual(layoutLabel(label, measurer));
    // Widest row is `ab cd`: 5 characters, 50px of text — exactly the
    // widest wrap width it fits in — and 60px with the padding.
    expect(wrapped.labelBox.width).toBe(60);
  });
});

describe("wrapLabel on Latin text", () => {
  // The spec: Latin text breaks only at a space, the space at the break is
  // not drawn, and once a label wraps its text is exactly the wrap width.
  it("breaks at spaces, greedily, and fixes the box at the wrap width", () => {
    const { label } = readLabel("alpha beta gamma delta", { dialect: "html" });

    const wrapped = wrapLabel(label, measurer, 100);

    // `alpha beta` is 10 characters, 100px of text: it fits exactly; `gamma`
    // would make it 160. `gamma delta` is 11 characters, 110px: it does not.
    // The box is the wrap width plus the measurer's 10px padding.
    expect(rowTexts(wrapped.label)).toEqual(["alpha beta", "gamma", "delta"]);
    expect(wrapped.label.text).toBe("alpha beta\ngamma\ndelta");
    expect(wrapped.labelBox.width).toBe(110);
    expect(wrapped.labelBox.height).toBe(60);
    expect(wrapped.labelBox.rows.map((row) => [row.y, row.width])).toEqual([
      [10, 110],
      [30, 60],
      [50, 60],
    ]);
  });

  it("never breaks inside a word that fits on a line of its own", () => {
    const { label } = readLabel("abc defghij", { dialect: "html" });

    const wrapped = wrapLabel(label, measurer, 90);

    expect(rowTexts(wrapped.label)).toEqual(["abc", "defghij"]);
    expect(wrapped.labelBox.width).toBe(100);
  });
});

describe("wrapLabel's wrap width", () => {
  // Round 2 of the spec (decision 2): the wrap width bounds the *text*, as
  // Mermaid's 200px `<div>` holds text only; the measurer's padding goes
  // outside it. So a wrapped box is the wrap width plus that padding.
  it("bounds the text, with the measurer's padding outside it", () => {
    const { label } = readLabel("alpha beta gamma delta", { dialect: "html" });

    const wrapped = wrapLabel(label, measurer, 100);

    // 100px of text is 10 characters: `alpha beta` exactly; the box is
    // those 100px plus the 10px padding.
    expect(rowTexts(wrapped.label)).toEqual(["alpha beta", "gamma", "delta"]);
    expect(wrapped.labelBox.width).toBe(110);
    expect(wrapped.labelBox.rows.map((row) => row.width)).toEqual([110, 60, 60]);
  });
});

describe("wrapLabel on CJK text", () => {
  // The spec: any two CJK characters may be broken between. Measured in
  // mermaid 11.17.2 (headless Chrome): a CJK character beside a Latin one
  // may be broken from it on either side — `…OP中` / `文` / `ABC…`.
  it("breaks between any two CJK characters", () => {
    const { label } = readLabel("中文字元測試", { dialect: "html" });

    const wrapped = wrapLabel(label, measurer, 40);

    // Four characters, 40px of text, to a line.
    expect(rowTexts(wrapped.label)).toEqual(["中文字元", "測試"]);
    expect(wrapped.labelBox.width).toBe(50);
  });

  it("breaks between a CJK character and the Latin text either side of it", () => {
    const { label } = readLabel("abcd中efgh", { dialect: "html" });

    const wrapped = wrapLabel(label, measurer, 40);

    // `abcd` fills a line, so `中` begins the next; `efgh` cannot join it
    // (five characters, 60px) and is broken from it onto a line of its own.
    expect(rowTexts(wrapped.label)).toEqual(["abcd", "中", "efgh"]);
  });
});

describe("wrapLabel's line-start rule", () => {
  // The spec: none of `，。、；：？！」』）】》,.;:?!)]}` may begin a line, so
  // the character before it goes down with it.
  it.each(["，", "。", "、", "；", "：", "？", "！", "」", "』", "）", "】", "》", ",", ".", ";", ":", "?", "!", ")", "]", "}"])(
    "carries the character before %s onto the next line rather than begin one with it",
    (mark) => {
      const { label } = readLabel(`中文字元${mark}測試`, { dialect: "html" });

      const wrapped = wrapLabel(label, measurer, 40);

      // Four characters fill a line; `元${mark}` cannot be split, and does
      // not fit after `中文字`.
      expect(rowTexts(wrapped.label)).toEqual(["中文字", `元${mark}測試`]);
    },
  );
});

describe("wrapLabel on a word longer than the wrap width", () => {
  // The spec (Mermaid's HTML labels): a piece that cannot be broken and does
  // not fit is not cut; its line overflows, and the box is the widest line.
  it("leaves the word whole on a line of its own and widens the box to it", () => {
    const { label } = readLabel("ab abcdefghijkl cd", { dialect: "html" });

    const wrapped = wrapLabel(label, measurer, 50);

    // `abcdefghijkl` is 12 characters, 120px of text, 130px with the padding.
    expect(rowTexts(wrapped.label)).toEqual(["ab", "abcdefghijkl", "cd"]);
    expect(wrapped.labelBox.width).toBe(130);
    expect(wrapped.labelBox.rows.map((row) => row.width)).toEqual([30, 130, 30]);
  });
});

describe("wrapLabel on a label with forced breaks", () => {
  // The spec: a `<br>` still ends its row, and each row the author wrote is
  // then wrapped on its own; a row that fits is left as written.
  it("wraps each written row on its own", () => {
    const { label } = readLabel("short<br>alpha beta gamma<br><br>end", { dialect: "html" });

    const wrapped = wrapLabel(label, measurer, 100);

    expect(rowTexts(wrapped.label)).toEqual(["short", "alpha beta", "gamma", "", "end"]);
    expect(wrapped.labelBox.width).toBe(110);
    expect(wrapped.labelBox.height).toBe(100);
  });
});

describe("wrapLabel on a styled label", () => {
  // The spec: a run broken across lines keeps its styles in every piece,
  // nothing about a run but its text changes, and the pieces read in order
  // are the text written, less the spaces at the breaks.
  it("keeps each run's styles on every line it is broken across", () => {
    const { label } = readLabel("plain **bold words here** end", { dialect: "html", markdown: true });
    const before = structuredClone(label);

    const wrapped = wrapLabel(label, measurer, 100);

    expect(wrapped.label.rows.map((row) => row.map((run) => [run.text, run.bold]))).toEqual([
      [
        ["plain ", false],
        ["bold", true],
      ],
      [["words here", true]],
      [["end", false]],
    ]);
    const { text: _plain, ...plainStyles } = label.rows[0]![0]!;
    const { text: _bold, ...boldStyles } = label.rows[0]![1]!;
    expect(wrapped.label.rows[2]![0]).toEqual({ ...plainStyles, text: "end" });
    expect(wrapped.label.rows[1]![0]).toEqual({ ...boldStyles, text: "words here" });
    expect(label).toEqual(before);
  });
});

describe("wrapLabel on mixed CJK and Latin text", () => {
  // garden-network's `Watering 灌溉控制器 (Rain / Pump / Wells)` at the node wrap
  // width: 175px of text holds 17 of this measurer's characters. The CJK run
  // may break anywhere, the Latin only at its spaces.
  it("breaks the garden-network watering label at its spaces", () => {
    const { label } = readLabel("Watering 灌溉控制器 (Rain / Pump / Wells)", { dialect: "html" });

    const wrapped = wrapLabel(label, measurer, 175);

    // `Watering 灌溉控制器` is 14 characters, and ` (Rain` would make 20;
    // `(Rain / Pump /` is 14, and ` Wells)` would make 21.
    expect(rowTexts(wrapped.label)).toEqual(["Watering 灌溉控制器", "(Rain / Pump /", "Wells)"]);
    // The wrap width plus the measurer's 10px padding.
    expect(wrapped.labelBox.width).toBe(185);
  });
});

describe("wrapLabel's rows", () => {
  // The spec: wrapping never makes an empty row. Spaces that begin a row
  // are not a piece of their own to break after.
  it("keeps the spaces a row begins with on its first line", () => {
    const { label } = readLabel("  abcdefgh ij", { dialect: "html" });

    const wrapped = wrapLabel(label, measurer, 50);

    expect(rowTexts(wrapped.label)).toEqual(["  abcdefgh", "ij"]);
  });
});
