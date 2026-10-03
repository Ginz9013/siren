import { describe, expect, it } from "vitest";
import type { LabelRun } from "./label";
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

  // Mermaid's SVG-mode pattern does not match these, but its default HTML
  // labels keep `<BR class="x">` as an element and the browser breaks the
  // line — the picture ADR-0015 holds Siren to.
  for (const spelling of ['<br class="x">', "<BR CLASS='x' />", "<br\tdata-a=1/>"]) {
    it(`breaks the row at a <br> carrying attributes, ${spelling}`, () => {
      expect(rowTexts(`a${spelling}b`)).toEqual(["a", "b"]);
    });
  }

  it("does not break at a tag that only begins with br", () => {
    expect(rowTexts("a<brx>b")).toEqual(["a<brx>b"]);
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

/** The runs of a one-row `html` label, each as its text and the properties `pick` names. */
function runsOf<K extends keyof LabelRun>(
  source: string,
  ...pick: K[]
): Pick<LabelRun, "text" | K>[] {
  const { label, problems } = readLabel(source, { dialect: "html" });
  expect(problems).toEqual([]);
  expect(label.rows).toHaveLength(1);
  return label.rows[0]!.map((run) => {
    const picked = { text: run.text } as Pick<LabelRun, "text" | K>;
    for (const key of pick) {
      picked[key] = run[key] as Pick<LabelRun, "text" | K>[K];
    }
    return picked;
  });
}

describe("readLabel's text-styling tags", () => {
  // Mermaid 11.17.2 draws `b` and `strong` with `font-weight: bold`
  // (measured in headless Chrome, the board's table).
  for (const tag of ["b", "strong", "B"]) {
    it(`reads <${tag}> as a bold run`, () => {
      expect(runsOf(`x <${tag}>y</${tag}> z`, "bold")).toEqual([
        { text: "x ", bold: false },
        { text: "y", bold: true },
        { text: " z", bold: false },
      ]);
    });
  }

  // `i` `em` `cite` `dfn` `var` all draw `font-style: italic` (measured).
  for (const tag of ["i", "em", "cite", "dfn", "var"]) {
    it(`reads <${tag}> as an italic run`, () => {
      expect(runsOf(`x <${tag}>y</${tag}>`, "italic")).toEqual([
        { text: "x ", italic: false },
        { text: "y", italic: true },
      ]);
    });
  }

  // `u` and `ins` draw an underline (measured).
  for (const tag of ["u", "ins"]) {
    it(`reads <${tag}> as an underlined run`, () => {
      expect(runsOf(`x <${tag}>y</${tag}>`, "underline")).toEqual([
        { text: "x ", underline: false },
        { text: "y", underline: true },
      ]);
    });
  }

  // `s` `strike` `del` draw a line through the text (measured).
  for (const tag of ["s", "strike", "del"]) {
    it(`reads <${tag}> as a struck-through run`, () => {
      expect(runsOf(`x <${tag}>y</${tag}>`, "strikethrough")).toEqual([
        { text: "x ", strikethrough: false },
        { text: "y", strikethrough: true },
      ]);
    });
  }

  // `code` `kbd` `samp` `tt` draw in `monospace` (measured).
  for (const tag of ["code", "kbd", "samp", "tt"]) {
    it(`reads <${tag}> as a monospace run`, () => {
      expect(runsOf(`x <${tag}>y</${tag}>`, "monospace")).toEqual([
        { text: "x ", monospace: false },
        { text: "y", monospace: true },
      ]);
    });
  }

  // `small` draws at × 0.833 of the surrounding size and `big` at × 1.2
  // (measured, the board's table).
  it("reads <small> and <big> as a scale of the font size", () => {
    expect(runsOf("x <small>s</small> <big>b</big>", "fontSize")).toEqual([
      { text: "x ", fontSize: { scale: 1 } },
      { text: "s", fontSize: { scale: 0.833 } },
      { text: " ", fontSize: { scale: 1 } },
      { text: "b", fontSize: { scale: 1.2 } },
    ]);
  });

  // `sub` and `sup` draw at × 0.833, below and above the baseline (measured).
  it("reads <sub> and <sup> as a smaller run shifted off the baseline", () => {
    expect(runsOf("H<sub>2</sub>O x<sup>2</sup>", "fontSize", "baseline")).toEqual([
      { text: "H", fontSize: { scale: 1 }, baseline: "normal" },
      { text: "2", fontSize: { scale: 0.833 }, baseline: "sub" },
      { text: "O x", fontSize: { scale: 1 }, baseline: "normal" },
      { text: "2", fontSize: { scale: 0.833 }, baseline: "super" },
    ]);
  });

  // `q` draws `“` before its text and `”` after it (measured), in the
  // style its text has.
  it("reads <q> as its text between curly quotes", () => {
    expect(runsOf("say <q>hi</q> <b><q>yo</q></b>", "bold")).toEqual([
      { text: "say “hi” ", bold: false },
      { text: "“yo”", bold: true },
    ]);
  });
});

/** Each row as its text, a bold, italic or `sub` run suffixed `(b)`, `(bi)`, `(bsub)`… */
function flagged(source: string, markdown = false): string[] {
  const { label } = readLabel(source, { dialect: "html", markdown });
  return label.rows.map((row) =>
    row
      .map((run) => {
        const flags = [
          run.bold ? "b" : "",
          run.italic ? "i" : "",
          run.baseline === "sub" ? "sub" : "",
        ].join("");
        return flags === "" ? run.text : `${run.text}(${flags})`;
      })
      .join(""),
  );
}

describe("readLabel's nested and misnested tags", () => {
  it("stacks nested tags: the inner run carries both", () => {
    expect(flagged("<b>a <i>b</i></b>")).toEqual(["a (b)b(bi)"]);
  });

  // Each expectation below is what DOMPurify and the browser's HTML parser
  // made of the source in Mermaid 11.17.2, read off the label's own markup
  // (`scripts/mermaid-probe.mjs`, HTML labels): `<b>a<i>b</i></b><i>c</i>d`,
  // `<sub>a<b>b</b></sub><b>c</b>d`, `<b>a<sub>b</sub></b>cd`,
  // `<q>a<b>b</b></q><b>c</b>d`, `ab<i>c</i>`.
  it("keeps a formatting tag open past the end of one it was misnested with", () => {
    expect(flagged("<b>a<i>b</b>c</i>d")).toEqual(["a(b)b(bi)c(i)d"]);
    expect(flagged("<sub>a<b>b</sub>c</b>d")).toEqual(["a(sub)b(bsub)c(b)d"]);
  });

  it("closes a tag that is not a formatting one together with the tag it was misnested in", () => {
    expect(flagged("<b>a<sub>b</b>c</sub>d")).toEqual(["a(b)b(bsub)cd"]);
  });

  it("draws a q's closing mark where the q really ends, outside the tags inside it", () => {
    expect(flagged("<q>a<b>b</q>c</b>d")).toEqual(["“ab(b)”c(b)d"]);
  });

  it("closes a q left open at the end of the label", () => {
    expect(flagged("a<q>b")).toEqual(["a“b”"]);
  });

  it("drops a closing tag with nothing open of its name, without throwing", () => {
    expect(flagged("a</b>b<i>c")).toEqual(["abc(i)"]);
  });

  // Mermaid turns a Markdown string into HTML first (`**` into `<strong>`,
  // `*` into `<em>`, a line break into `<br>`) and the tags are read with
  // it, so the two notations stack and a `**` pair spans a row break:
  // `<strong>a <i>b</i></strong> c`, `x <strong>a<br>b</strong> y` and
  // `<strong>a<br>b</strong>` (from a real line break), measured.
  it("stacks a Markdown string's `**` with a tag inside it", () => {
    expect(flagged("**a <i>b</i>** c", true)).toEqual(["a (b)b(bi) c"]);
    // …and with a `*` pair inside it: `<strong>bold <em>and</em> still</strong>`.
    expect(flagged("**bold *and* still**", true)).toEqual(["bold (b)and(bi) still(b)"]);
  });

  it("keeps a `**` pair bold across a <br> or a line break between its stars", () => {
    expect(flagged("**a<br>b**", true)).toEqual(["a(b)", "b(b)"]);
    expect(flagged("x **a<br>b** y", true)).toEqual(["x a(b)", "b(b) y"]);
    expect(flagged("**a\nb**", true)).toEqual(["a(b)", "b(b)"]);
  });
});
