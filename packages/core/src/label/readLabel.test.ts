import { describe, expect, it } from "vitest";
import { readLabel } from "./readLabel";

/** Each row of a label as the text it draws, run texts concatenated. */
function rowTexts(source: string, markdown = false): string[] {
  const { label } = readLabel(source, { dialect: "html", markdown });
  return label.rows.map((row) => row.map((run) => run.text).join(""));
}

describe("readLabel's row breaks", () => {
  // Mermaid's own `/<br\s*\/?>/gi` — measured in ADR-0015, and the four
  // spellings an author actually writes.
  for (const spelling of ["<br>", "<br/>", "<br />", "<BR>"]) {
    it(`breaks the row at ${spelling}`, () => {
      expect(rowTexts(`a${spelling}b`)).toEqual(["a", "b"]);
    });
  }

  it("does not break at a <br> carrying an attribute, which Mermaid's pattern does not match", () => {
    expect(rowTexts('a<br class="x">b')).toEqual(['a<br class="x">b']);
  });

  it("keeps an empty row where a break ends the label", () => {
    expect(rowTexts("a<br>")).toEqual(["a", ""]);
  });

  it("flattens the rows into `text`, joined by a line break", () => {
    expect(readLabel("a<br/>b", { dialect: "html" }).label.text).toBe("a\nb");
  });

  it("reads a label with no tag in it as one plain run and no problems", () => {
    const { label, problems } = readLabel("Start", { dialect: "html" });

    expect(problems).toEqual([]);
    expect(label.rows).toHaveLength(1);
    expect(label.rows[0]).toEqual([
      {
        text: "Start",
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
      },
    ]);
  });
});

/** Each row as `text` plus `(b)`/`(i)`/`(bi)` on a bold/italic run — the corpus's own notation. */
function styledRows(source: string, markdown: boolean): string[] {
  const { label } = readLabel(source, { dialect: "html", markdown });
  return label.rows.map((row) =>
    row
      .map((run) => {
        const flags = (run.bold ? "b" : "") + (run.italic ? "i" : "");
        return flags === "" ? run.text : `${run.text}(${flags})`;
      })
      .join(""),
  );
}

describe("readLabel's Markdown string", () => {
  it("reads `**…**` as a bold run and `*…*` as an italic one, with the text around them plain", () => {
    expect(styledRows("plain **bold** and *it*", true)).toEqual(["plain bold(b) and it(i)"]);
  });

  it("breaks a row at a real line break inside the fence", () => {
    expect(styledRows("line1\nline2", true)).toEqual(["line1", "line2"]);
  });

  it("breaks a row at <br> alongside the Markdown runs", () => {
    expect(styledRows("**md**<br/>x", true)).toEqual(["md(b)", "x"]);
  });

  it("leaves `**` alone when the label is not a Markdown string", () => {
    expect(styledRows("**md**", false)).toEqual(["**md**"]);
  });
});
