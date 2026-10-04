import { describe, expect, it } from "vitest";
import type { LabelRun } from "./label";
import { readLabel } from "./readLabel";
import { readLabelAt, readTextAt } from "./readLabelAt";

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

  // `<brx>` is another name, and one outside the vocabulary, so it is
  // dropped as DOMPurify drops it: `a<brx>b` is `ab` (measured).
  it("does not break at a tag that only begins with br", () => {
    expect(rowTexts("a<brx>b")).toEqual(["ab"]);
  });

  // Measured (the T5 sequence wiring): Mermaid draws sequence text in SVG
  // mode only, where its `/<br\s*\/?>/gi` is the rule, so
  // `A->>B: x<br class="x">y` is one row.
  it("leaves a <br> carrying attributes as characters in the sequence dialect", () => {
    const { label } = readLabel('x<br class="x">y<BR/>z', { dialect: "sequence" });
    expect(label.rows.map((row) => row.map((run) => run.text).join(""))).toEqual(['x<br class="x">y', "z"]);
  });

  // The HTML parser reads a stray `</br>` as `<br>`: `a</br>b` is
  // `a<br>b` (measured). Before unknown tags were dropped it was drawn as its
  // characters; dropping it would join the rows.
  it("breaks the row at </br> in the html dialect", () => {
    expect(rowTexts("a</br>b")).toEqual(["a", "b"]);
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

  // Measured in 11.17.2's HTML labels: `a␣␣⏎b` is `<p>a  \nb</p>` and
  // `a\⏎b` is `<p>a\\\nb</p>` — Markdown's hard line breaks, which Mermaid
  // hands the browser as the raw characters, no `<br>` — and the label's
  // `white-space: nowrap` collapses that whitespace into one space. So does
  // `**a**␣␣⏎b` (`<p><strong>a</strong>  \nb</p>`) and `*a␣␣⏎b*`
  // (`<p><em>a  \nb</em></p>`). A tab is not one: `a\t⏎b` is `<p>a\t<br>b</p>`.
  it("draws a line break after two spaces or a backslash on the same row, as one space", () => {
    expect(styledRows("a  \nb", true)).toEqual(["a b"]);
    expect(styledRows("a\\\nb", true)).toEqual(["a\\ b"]);
    expect(styledRows("**a**  \nb", true)).toEqual(["a(b) b"]);
    expect(styledRows("*a  \nb*", true)).toEqual(["a b(i)"]);
    expect(styledRows("a\t\nb", true)).toEqual(["a\t", "b"]);
    // Nor is a backslash another escapes: `a\\⏎b` is `<p>a\<br>b</p>`.
    expect(styledRows("a\\\\\nb", true)).toEqual(["a\\", "b"]);
  });

  // Measured: `a⏎⏎b`, `a⏎⏎⏎b` and `a⏎␣⏎b` are each `<p>a</p><p>b</p>` — a
  // blank line ends a paragraph, and no empty row is drawn between the two —
  // and `**a⏎⏎b**` is `<p>**a</p><p>b**</p>`: no pair spans paragraphs.
  it("draws a blank line as a paragraph break, which no pair spans", () => {
    expect(styledRows("a\n\nb", true)).toEqual(["a", "b"]);
    expect(styledRows("a\n\n\nb", true)).toEqual(["a", "b"]);
    expect(styledRows("a\n \nb", true)).toEqual(["a", "b"]);
    expect(styledRows("**a\n\nb**", true)).toEqual(["**a", "b**"]);
  });

  // Measured: `a␣␣⏎⏎b` is `<p>a  </p><p>b</p>` and `a\⏎⏎b` is
  // `<p>a\</p><p>b</p>` — before a blank line neither is a hard break.
  it("breaks the paragraph at a blank line after two spaces or a backslash", () => {
    expect(styledRows("a  \n\nb", true)).toEqual(["a", "b"]);
    expect(styledRows("a\\\n\nb", true)).toEqual(["a\\", "b"]);
  });

  it("breaks a row at <br> alongside the Markdown runs", () => {
    expect(styledRows("**md**<br/>x", true)).toEqual(["md(b)", "x"]);
  });

  // Mermaid's HTML labels, measured in 11.17.2 (`scripts/mermaid-probe.mjs`,
  // the label's own markup): `a * b * c` is `<p>a * b * c</p>`, no `<em>`.
  it("leaves a `*` with a space after it as a character, not an italic run", () => {
    expect(styledRows("a * b * c", true)).toEqual(["a * b * c"]);
  });

  // Measured the same way: `<p>*a *</p>`, `<p>**a **</p>`, and
  // `<p><em>a * b</em></p>` — the spaced star inside is a character, and the
  // pair closes at the next star with no space before it.
  it("closes a pair only at a star with no space before it", () => {
    expect(styledRows("*a *", true)).toEqual(["*a *"]);
    expect(styledRows("**a **", true)).toEqual(["**a **"]);
    expect(styledRows("*a * b*", true)).toEqual(["a * b(i)"]);
  });

  // `<p>** a**</p>`, measured: a `**` with a space after it opens neither a
  // bold pair nor, through its second star, an italic one.
  it("opens nothing at a `**` with a space after it", () => {
    expect(styledRows("** a**", true)).toEqual(["** a**"]);
  });

  // Measured in 11.17.2's HTML labels: `<p><em>a</em></p>`,
  // `<p><strong>a</strong></p>`, `<p>a_b_c</p>`, `<p>_a_b</p>`,
  // `<p>a__b__c</p>` and `<p><strong>a_b</strong></p>`.
  it("reads `_…_` as italic and `__…__` as bold, but not inside a word", () => {
    expect(styledRows("_a_ __b__", true)).toEqual(["a(i) b(b)"]);
    expect(styledRows("a_b_c", true)).toEqual(["a_b_c"]);
    expect(styledRows("_a_b", true)).toEqual(["_a_b"]);
    expect(styledRows("a__b__c", true)).toEqual(["a__b__c"]);
    expect(styledRows("__a_b__", true)).toEqual(["a_b(b)"]);
  });

  // Measured: `<p>x**(a)**y</p>`, `<p>a**.b**</p>`, `<p>x_(a)_y</p>`, and
  // `<p><em>(a)</em></p>`, `<p><strong>(a)</strong></p>`,
  // `<p>(<strong>a</strong>)</p>`, `<p><em>(a)</em></p>` for `_(a)_`.
  it("opens a pair at punctuation only after whitespace or punctuation, and closes one so too", () => {
    expect(styledRows("x**(a)**y", true)).toEqual(["x**(a)**y"]);
    expect(styledRows("a**.b**", true)).toEqual(["a**.b**"]);
    expect(styledRows("x_(a)_y", true)).toEqual(["x_(a)_y"]);
    expect(styledRows("*(a)* **(a)** (**a**) _(a)_", true)).toEqual(["(a)(i) (a)(b) (a(b)) (a)(i)"]);
  });

  // Measured: `<p><em>a**b</em></p>`, `<p><strong>a*b</strong></p>`,
  // `<p><em>foo<strong>bar</strong>baz</em></p>` and `<p><em>a</em>*</p>`.
  it("does not pair a run that could both open and close with one whose sum of lengths is a multiple of three", () => {
    expect(styledRows("*a**b*", true)).toEqual(["a**b(i)"]);
    expect(styledRows("**a*b**", true)).toEqual(["a*b(b)"]);
    expect(styledRows("*foo**bar**baz*", true)).toEqual(["foo(i)bar(bi)baz(i)"]);
    expect(styledRows("*a**", true)).toEqual(["a(i)*"]);
  });

  // Measured: `**a⏎**` is `<p>**a<br>**</p>` — the line break is whitespace
  // to the stars after it, not the `>` of the `<br>` it becomes.
  it("does not close a pair at stars that begin a line", () => {
    expect(styledRows("**a\n**", true)).toEqual(["**a", "**"]);
  });

  // Measured: `<a href='http://x/_a_/'>l</a>` keeps its href as written,
  // `<p><a href="http://x/_a_/">l</a></p>` — Markdown reads a tag whole.
  it("pairs no `_` or `*` inside a tag the author wrote", () => {
    const { label } = readLabel("<a href='http://x/_a_/'>l</a> *b*", { dialect: "html", markdown: true });
    expect(label.rows[0]!.map((run) => [run.text, run.href, run.italic])).toEqual([
      ["l", "http://x/_a_/", false],
      [" ", null, false],
      ["b", null, true],
    ]);
  });

  // Measured in 11.17.2's HTML labels: `a \*b\* c` is `<p>a *b* c</p>`,
  // `a \_b\_` is `<p>a _b_</p>`, `\*\*b\*\*` is `<p>**b**</p>`, and
  // `\**a**` is `<p>*<em>a</em>*</p>`.
  it("draws a backslash-escaped `*` or `_` as the character alone, never a delimiter", () => {
    expect(styledRows("a \\*b\\* c", true)).toEqual(["a *b* c"]);
    expect(styledRows("a \\_b\\_", true)).toEqual(["a _b_"]);
    expect(styledRows("\\*\\*b\\*\\*", true)).toEqual(["**b**"]);
    expect(styledRows("\\**a**", true)).toEqual(["*a(i)*"]);
  });

  // Measured: `x\<b>y</b>` is `<p>x<b>y</b></p>` and `a \< b` is
  // `<p>a &lt; b</p>`, the backslash dropped; but `x\<foo>*y*` is
  // `<p>x*y*</p>`, `x\<b\>y` and `x\</b>y` are `<p>x\y</p>`, `a\<b` is
  // `<p>a\</p>` — Mermaid removes those tags before its Markdown reader runs,
  // so the backslash meets what came after them. `<b>x\</b>y` is
  // `<p><b>x</b>y</p>`.
  it("escapes a `<` only where the tag it begins reaches Markdown, and otherwise what follows that tag", () => {
    expect(styledRows("x\\<b>y</b>", true)).toEqual(["xy(b)"]);
    expect(styledRows("a \\< b", true)).toEqual(["a < b"]);
    expect(styledRows("x\\<foo>*y*", true)).toEqual(["x*y*"]);
    expect(styledRows("x\\<b\\>y", true)).toEqual(["x\\y"]);
    expect(styledRows("x\\</b>y", true)).toEqual(["x\\y"]);
    expect(styledRows("a\\<b", true)).toEqual(["a\\"]);
    expect(styledRows("<b>x\\</b>y", true)).toEqual(["x(b)y"]);
  });

  // Measured: `\\` is `<p>\</p>`, `a\\*b*` is `<p>a\<em>b</em></p>`, `\#`
  // `<p>#</p>`, `\~x` `<p>~x</p>`, `a \&amp; b` `<p>a &amp; b</p>`; and a
  // backslash before anything but ASCII punctuation is kept: `a\b`, `\a`,
  // `\é` and `\ a` are drawn as written.
  it("drops a backslash before any ASCII punctuation, itself included, and keeps every other", () => {
    expect(styledRows("\\\\", true)).toEqual(["\\"]);
    expect(styledRows("a\\\\*b*", true)).toEqual(["a\\b(i)"]);
    expect(styledRows("\\# \\~x a \\&amp; b", true)).toEqual(["# ~x a & b"]);
    expect(styledRows("a\\b \\a \\é \\ a", true)).toEqual(["a\\b \\a \\é \\ a"]);
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

  // `mark` draws its text black on a yellow `#ff0` background (measured):
  // paint the theme gives it, so the run says only that it is marked.
  it("reads <mark> as a marked run", () => {
    expect(runsOf("x <mark>m</mark> y", "mark")).toEqual([
      { text: "x ", mark: false },
      { text: "m", mark: true },
      { text: " y", mark: false },
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

describe("readLabelAt", () => {
  it("reads the label a match group holds, in the dialect it is given", () => {
    const match = /^note: (.*)$/d.exec("note: a<br><b>b</b>")!;

    const read = readLabelAt(match, 1, { line: 3, column: 5 }, "html");

    expect(read.label.text).toBe("a\nb");
    expect(read.label.rows[1]![0]!.bold).toBe(true);
    expect(read.diagnostics).toEqual([]);
    expect(read.hasError).toBe(false);
  });

  it("leaves tags other than a break as characters in the sequence dialect", () => {
    const match = /^(.*)$/d.exec("<b>b</b>")!;

    expect(readLabelAt(match, 1, { line: 1, column: 1 }, "sequence").label.text).toBe("<b>b</b>");
  });
});

describe("readTextAt", () => {
  it("reads a whole text as a label, each problem placed from where the text begins", () => {
    const read = readTextAt("x <span style='border:0'>y</span>", { line: 2, column: 10 }, "html");

    expect(read.label.text).toBe("x y");
    expect(read.diagnostics.map(({ severity, line, column }) => ({ severity, line, column }))).toEqual([
      { severity: "warning", line: 2, column: 12 },
    ]);
    expect(read.hasError).toBe(false);
  });
});

describe("readLabel's attribute tags", () => {
  // `<font color face>` keep their attributes through DOMPurify (measured
  // with `mermaid-probe.mjs --html` against 11.17.2), and the browser draws
  // the text in that color and family.
  it("reads <font color> as the run's color", () => {
    expect(runsOf("x <font color='red'>y</font>", "color")).toEqual([
      { text: "x ", color: null },
      { text: "y", color: "red" },
    ]);
  });

  // An inner family replaces the one around it, whichever tag set it:
  // `<code><font face>` draws in the face, `<font face><code>` in monospace.
  it("reads <font face> as the run's family, the innermost family winning", () => {
    expect(
      runsOf("<font face='serif'>a<code>b</code></font><code>c<font face='serif'>d</font></code>", "fontFamily", "monospace"),
    ).toEqual([
      { text: "a", fontFamily: "serif", monospace: false },
      { text: "bc", fontFamily: null, monospace: true },
      { text: "d", fontFamily: "serif", monospace: false },
    ]);
  });

  // The board's measured table: sizes 1–7 are 12 / 13 / 16 / 18 / 20 / 32 /
  // 48px where the text around them is 16px. A size is the HTML standard's
  // legacy one: `+n`/`-n` count from 3, and the result is held to 1–7.
  it("reads <font size> 1–7 as the board's scale of the font size", () => {
    const sizes = ["1", "2", "3", "4", "5", "6", "7"].map(
      (size) => runsOf(`<font size="${size}">x</font>`, "fontSize")[0]!.fontSize,
    );
    expect(sizes).toEqual([0.75, 0.8125, 1, 1.125, 1.25, 2, 3].map((scale) => ({ scale })));
  });

  it("reads a relative <font size> from 3, held to 1–7, and an unreadable one as unwritten", () => {
    const size = (value: string) => runsOf(`<font size="${value}">x</font>`, "fontSize")[0]!.fontSize;
    expect(size("+1")).toEqual({ scale: 1.125 });
    expect(size("-1")).toEqual({ scale: 0.8125 });
    expect(size("+9")).toEqual({ scale: 3 });
    expect(size(" 0")).toEqual({ scale: 0.75 });
    expect(size("big")).toEqual({ scale: 1 });
  });

  // A size keyword is not relative to the size around it.
  it("draws a <font size> inside <small> at its own size", () => {
    expect(runsOf("<small><font size='6'>x</font></small>", "fontSize")).toEqual([
      { text: "x", fontSize: { scale: 2 } },
    ]);
  });

  // The value check `resolveStyles` holds an author's style values to: a
  // value that could fetch (`url(`), run script (`expression(`), smuggle a
  // second declaration (`;`) or spell either in an escape (`\\`) is not
  // drawn, and the run is drawn as though it had not been written.
  it("reads a <font> value resolveStyles would refuse as unwritten", () => {
    expect(
      runsOf("<font color='url(#x)' face='a\\62 c'>x</font><font color='expression(1)'>y</font>", "color", "fontFamily"),
    ).toEqual([{ text: "xy", color: null, fontFamily: null }]);
  });

  // A color the browser cannot parse is a declaration it drops, so nothing
  // is painted — not SVG's default black, which hid the text behind a
  // `background-color: banana`.
  it("reads a color or background that is not a CSS color as unwritten", () => {
    expect(
      runsOf(
        "<span style='color: banana; background-color: banana'>a</span>" +
          "<font color='banana'>b</font>" +
          "<span style='background-color: 12px'>c</span>" +
          "<font color='#ff000'>d</font>" +
          "<span style='color: #abcd5'>e</span>",
        "color",
        "background",
      ),
    ).toEqual([{ text: "abcde", color: null, background: null }]);
  });

  it.each([
    "red",
    "RebeccaPurple",
    "transparent",
    "currentColor",
    "#abc",
    "#abcd",
    "#aabbcc",
    "#aabbccdd",
    "rgb(1 2 3)",
    "RGBA(1, 2, 3, 0.5)",
    "hsl(120deg 50% 50%)",
    "hsla(120, 50%, 50%, 0.5)",
    "hwb(120 0% 0%)",
    "lab(50% 40 59)",
    "lch(50% 40 59)",
    "oklab(0.5 0.1 0.1)",
    "oklch(0.5 0.1 120)",
    "color(display-p3 1 0 0)",
    "color-mix(in srgb, red 50%, blue)",
    "var(--brand)",
  ])("reads the CSS color %s as written, as a color and as a background", (value) => {
    // One declaration a span, so that no hex color is followed by a `;`,
    // which would make it an entity code (see "readLabel's entity codes").
    expect(
      runsOf(`<span style='color: ${value}'>a</span><span style='background-color: ${value}'>b</span>`, "color", "background"),
    ).toEqual([
      { text: "a", color: value, background: null },
      { text: "b", color: null, background: value },
    ]);
    expect(runsOf(`<font color='${value}'>a</font>`, "color")).toEqual([{ text: "a", color: value }]);
  });

  // `<span style>` keeps its declarations through DOMPurify (measured with
  // `mermaid-probe.mjs --html`), and the board names the ten properties
  // Siren draws. These six are carried as written. (The hex color is last,
  // with no `;` after it: `#ff0;` is an entity code — see "readLabel's
  // entity codes".)
  it("reads <span style>'s color, background, family and spacing as written", () => {
    expect(
      runsOf(
        "x <span style='color: red; font-family:serif;letter-spacing:2px;word-spacing:1em;opacity:0.5;Background-Color:#ff0'>y</span>",
        "color",
        "background",
        "fontFamily",
        "letterSpacing",
        "wordSpacing",
        "opacity",
      ),
    ).toEqual([
      { text: "x ", color: null, background: null, fontFamily: null, letterSpacing: null, wordSpacing: null, opacity: null },
      { text: "y", color: "red", background: "#ff0", fontFamily: "serif", letterSpacing: "2px", wordSpacing: "1em", opacity: "0.5" },
    ]);
  });

  // CSS's own readings: `bold`, `bolder` and a weight of 600 or more are
  // bold, `normal`, `lighter` and less are not, so an inner span can unbold;
  // `italic` and `oblique` slant and `normal` does not.
  it("reads <span style>'s font-weight and font-style, an inner one undoing an outer tag", () => {
    expect(
      runsOf(
        "<span style='font-weight:700'>a</span><b>b<span style='font-weight: normal'>c</span></b>" +
          "<span style='font-weight:bolder;font-style:oblique 10deg'>d</span>" +
          "<i><span style='font-style:normal;font-weight:500'>e</span></i><span style='font-weight:heavy'>f</span>",
        "bold",
        "italic",
      ),
    ).toEqual([
      { text: "ab", bold: true, italic: false },
      { text: "c", bold: false, italic: false },
      { text: "d", bold: true, italic: true },
      { text: "ef", bold: false, italic: false },
    ]);
  });

  // A decoration is drawn by the box that declares it across everything
  // inside it, so an inner `text-decoration: none` takes away nothing an
  // outer tag drew: the property only ever adds a line.
  it("reads <span style>'s text-decoration as lines it adds", () => {
    expect(
      runsOf(
        "<span style='text-decoration: underline line-through'>a</span><u><span style='text-decoration:none'>b</span></u>",
        "underline",
        "strikethrough",
      ),
    ).toEqual([
      { text: "a", underline: true, strikethrough: true },
      { text: "b", underline: true, strikethrough: false },
    ]);
  });

  // The board: a relative size is a scale of Siren's own, and an absolute
  // one is drawn as written.
  it("reads <span style>'s font-size in em or % as a scale, and any other as written", () => {
    expect(
      runsOf(
        "<span style='font-size:1.5em'>a<span style='font-size:50%'>b</span></span>" +
          "<span style='font-size:20px'>c<small>d</small></span><span style='font-size: large'>e</span>",
        "fontSize",
      ),
    ).toEqual([
      { text: "a", fontSize: { scale: 1.5 } },
      { text: "b", fontSize: { scale: 0.75 } },
      { text: "cd", fontSize: { absolute: "20px" } },
      { text: "e", fontSize: { absolute: "large" } },
    ]);
  });

  // The board: every other property is not drawn, and the author is told
  // which, once per `style` attribute, at the tag that wrote it.
  it("warns once at a <span> whose style has properties Siren does not draw, naming each", () => {
    const { label, problems } = readLabel(
      "ab <span style='border: 1px solid; color: red; Padding:2px'>c</span>",
      { dialect: "html" },
    );

    expect(label.rows[0]!.map((run) => [run.text, run.color])).toEqual([
      ["ab ", null],
      ["c", "red"],
    ]);
    expect(problems).toEqual([
      {
        severity: "warning",
        message:
          '<span style> ignores "border", "padding": Siren draws only color, ' +
          "background-color, font-size, font-weight, font-style, font-family, " +
          "text-decoration, letter-spacing, word-spacing and opacity.",
        offset: 3,
      },
    ]);
  });

  // A Markdown string is read as the tags its stars and line breaks stand
  // for, but a problem is the author's to find in what they wrote.
  it("places a warning in a Markdown string at the tag as the author wrote it", () => {
    const source = "**a** *b*\n<span style='border:0'>x</span>";

    const { problems } = readLabel(source, { dialect: "html", markdown: true });

    expect(problems.map((problem) => problem.offset)).toEqual([source.indexOf("<span")]);
  });

  it("places it at the tag past paired, unpaired and nested `_` and `*` runs", () => {
    const source = "__a__ _b *c*_ x**(d)**y *e**\n<span style='border:0'>x</span>";

    const { problems } = readLabel(source, { dialect: "html", markdown: true });

    expect(problems.map((problem) => problem.offset)).toEqual([source.indexOf("<span")]);
  });

  it("places it at the tag past escapes, hard breaks and blank lines", () => {
    const source = "\\*a\\* \\\\ x\\<foo>*y* c  \nd\\\ne\n\n<span style='border:0'>x</span>";

    const { problems } = readLabel(source, { dialect: "html", markdown: true });

    expect(problems.map((problem) => problem.offset)).toEqual([source.indexOf("<span")]);
  });
});

describe("readLabel's text paint, innermost first", () => {
  // As the browser cascades it: `<mark>`'s own black text replaces a color
  // inherited from around it, and a color set inside a `<mark>` replaces the
  // mark's. So a marked run carries an author color only when the color is
  // the inner of the two.
  it("lets a <mark> inside a colored tag take the color away, and a color inside a <mark> keep it", () => {
    expect(
      runsOf("<font color='red'><mark>a</mark></font><mark><font color='red'>b</font></mark>", "mark", "color"),
    ).toEqual([
      { text: "a", mark: true, color: null },
      { text: "b", mark: true, color: "red" },
    ]);
  });
  // CSS opacity fades a box and everything in it, so an opacity inside
  // another multiplies; a number or a percentage, held to 0–1, and anything
  // else is a declaration the browser drops.
  it("multiplies a <span style> opacity inside another, and reads an unreadable one as unwritten", () => {
    expect(
      runsOf(
        "<span style='opacity:0.5'>a<span style='opacity: 50%'>b</span></span><span style='opacity:half'>c</span><span style='opacity:3'>d</span>",
        "opacity",
      ),
    ).toEqual([
      { text: "a", opacity: "0.5" },
      { text: "b", opacity: "0.25" },
      { text: "c", opacity: null },
      { text: "d", opacity: "1" },
    ]);
  });
  // Two backgrounds on one run paint the same inline box, so only the inner
  // one shows: a `<mark>` inside a background covers it, and a background
  // inside a `<mark>` covers the mark's yellow.
  it("keeps a background only when it is inside the <mark>, which then draws it on top", () => {
    expect(
      runsOf(
        "<span style='background-color:red'><mark>a</mark></span><mark><span style='background-color:red'>b</span></mark>",
        "mark",
        "background",
      ),
    ).toEqual([
      { text: "a", mark: true, background: null },
      { text: "b", mark: true, background: "red" },
    ]);
  });
});

describe("readLabel's links", () => {
  /** The href, underline and color `source`'s one `<a>` gives its text `x`. */
  const linkOf = (href: string) => {
    const [run] = runsOf(`<a href='${href}' onclick='alert(1)'>x</a>`, "href", "underline", "color");
    return run;
  };

  // Measured with `mermaid-probe.mjs --html` against 11.17.2 (DOMPurify's
  // URI rule): these keep their href — the value trimmed of the whitespace
  // around it — and the browser draws a link, blue and underlined: the
  // run's color is the theme's link token.
  it("keeps an href the sanitizer keeps, trimmed, and underlines the run", () => {
    const kept = [
      "https://x.y",
      "HTTP://x",
      "  https://s",
      "mailto:a@b",
      "ftp://x",
      "ftps://x",
      "tel:1",
      "callto:1",
      "sms:1",
      "cid:1",
      "xmpp:1",
      "matrix:1",
      "#f",
      "rel/p?q",
      "//h/p",
      "",
    ];
    expect(kept.map(linkOf)).toEqual(
      ["https://x.y", "HTTP://x", "https://s", "mailto:a@b", "ftp://x", "ftps://x", "tel:1", "callto:1", "sms:1", "cid:1", "xmpp:1", "matrix:1", "#f", "rel/p?q", "//h/p", ""].map(
        (href) => ({ text: "x", href, underline: true, color: "var(--siren-label-link)" }),
      ),
    );
  });

  // Measured the same way: these lose their href, and an `<a>` with no href
  // is not a link in the browser — black, no underline — so it is plain text.
  it("draws an <a> whose href the sanitizer strips, or that has none, as plain text", () => {
    const stripped = ["javascript:alert(1)", "data:text/html,x", "foo:bar", "a.b:c", " JaVaScript:x"];
    expect(stripped.map(linkOf)).toEqual(
      stripped.map(() => ({ text: "x", href: null, underline: false, color: null })),
    );
    expect(runsOf("<a name='n'>x</a>", "href", "underline")).toEqual([{ text: "x", href: null, underline: false }]);
  });
  // Measured (the board's example): the parser closes an open `<a>` at the
  // next `<a>` start tag and reopens the formatting tags inside it, so
  // `<a href='x'>1<b>2<a href='y'>3</a>4</b>5` is
  // `<a href="x">1<b>2</b></a><b><a href="y">3</a>4</b>5`.
  it("closes an open <a> at the next <a>, reopening the formatting tags inside it", () => {
    expect(runsOf("<a href='x'>1<b>2<a href='y'>3</a>4</b>5", "href", "bold")).toEqual([
      { text: "1", href: "x", bold: false },
      { text: "2", href: "x", bold: true },
      { text: "3", href: "y", bold: true },
      { text: "4", href: null, bold: true },
      { text: "5", href: null, bold: false },
    ]);
  });
});

describe("readLabel's tags outside the vocabulary", () => {
  // Measured with `mermaid-probe.mjs --html` against 11.17.2: DOMPurify
  // drops a tag it does not allow and keeps its text, so
  // `e<foo>f</foo>g<my-el>h</my-el>i<object>j</object>k` is `efghijk`.
  it("drops an unknown tag and keeps its text", () => {
    expect(rowTexts("e<foo>f</foo>g<my-el>h</my-el>i<object>j</object>k")).toEqual(["efghijk"]);
  });

  // The browser's parser builds the element before DOMPurify drops it, so
  // its end tag closes what was opened inside it: `<foo>a<sub>b</foo>c</sub>d`
  // is `a<sub>b</sub>cd` (measured).
  it("closes the tags opened inside an unknown tag at its end tag", () => {
    expect(flagged("<foo>a<sub>b</foo>c</sub>d")).toEqual(["ab(sub)cd"]);
  });
});

describe("readLabel's unterminated tag", () => {
  // The HTML tokenizer: `<` followed by a letter, or by `/` and a letter,
  // opens a tag, and a tag the label ends inside is dropped with everything
  // after its `<`. Measured with `mermaid-probe.mjs --html` against 11.17.2:
  // `x <y` is `<p>x </p>`, `a </y b` and `a <y z='1` are `<p>a </p>`,
  // `a <y z='1> b <i>c</i>` is `<p>a </p>` (the quoted value runs to the
  // end), and `a <b>c<br` is `<p>a <b>c</b></p>`.
  it.each([
    ["x <y", "x "],
    ["a </y b", "a "],
    ["a <y z='1", "a "],
    ['a <y z="1', "a "],
    ["a <y z='1> b <i>c</i>", "a "],
    ["a <br", "a "],
  ])("drops the tag %j runs to the end of", (source, drawn) => {
    expect(rowTexts(source)).toEqual([drawn]);
  });

  it("closes what is open where the unterminated tag begins", () => {
    expect(flagged("a <b>c<br")).toEqual(["a c(b)"]);
  });

  // Not a tag: `a < b` is `<p>a &lt; b</p>`, `a <1` is `<p>a &lt;1</p>`,
  // `a</` is `<p>a&lt;/</p>` and `a<` is `<p>a&lt;</p>` (measured).
  it.each(["a < b", "a <1", "a</", "a<"])("draws %j as written", (source) => {
    expect(rowTexts(source)).toEqual([source]);
  });

  // The tokenizer ends a tag at its first `>` outside a quoted value, a `/`
  // anywhere in it included: `a<b/ >c</b>d` is `<p>a<b>c</b>d</p>`,
  // `a<b/x>c</b>d` is `<p>a<b x="">c</b>d</p>`, and a quote that does not
  // follow `=` opens no value — `a<y a'b>c` is `<p>ac</p>` (measured).
  it("ends a tag at its first > outside a quoted value", () => {
    expect(flagged("a<b/ >c</b>d")).toEqual(["ac(b)d"]);
    expect(flagged("a<b/x>c</b>d")).toEqual(["ac(b)d"]);
    expect(rowTexts("a<y a'b>c")).toEqual(["ac"]);
  });

  // Mermaid draws sequence text in SVG mode, where a `<` is a character.
  it("leaves an unterminated tag as written in the sequence dialect", () => {
    expect(readLabel("x <y", { dialect: "sequence" }).label.text).toBe("x <y");
  });
});

describe("readLabel's tags with no rendering of their own", () => {
  // ADR-0015's layer of 20: DOMPurify keeps each one and the browser draws
  // nothing for it but its text.
  const drawless = [
    "abbr", "acronym", "bdi", "bdo", "data", "time", "nobr", "label", "output", "blink",
    "spacer", "content", "decorator", "element", "shadow", "slot", "menuitem", "map", "picture",
  ];
  for (const tag of drawless) {
    it(`draws <${tag}>'s text and nothing else`, () => {
      expect(flagged(`x<${tag} title='t'>y<b>z</b></${tag}>w`)).toEqual(["xyz(b)w"]);
    });
  }

  // `wbr` is a void element: nothing opens, so its end tag closes nothing —
  // `<wbr><sub>a</wbr>b</sub>c` is `<wbr><sub>ab</sub>c` (measured).
  it("draws nothing for <wbr>, which closes nothing", () => {
    expect(flagged("<wbr><sub>a</wbr>b</sub>c<wbr/>d")).toEqual(["ab(sub)cd"]);
  });
});

describe("readLabel's tags Mermaid removes", () => {
  // Inside a label the parser ignores `html`, `head` and `body` start and
  // end tags alike, so nothing closes at them: `<body>a<sub>b</body>c</sub>d`
  // and `<html lang=x>a<sub>b</html>c</sub>d` are `a<sub>bc</sub>d`
  // (measured), and `<head>h</head>` is `h`.
  it("ignores <html>, <head> and <body>, keeping their text", () => {
    expect(flagged("<body>a<sub>b</body>c</sub>d")).toEqual(["abc(sub)d"]);
    expect(flagged("<html lang=x>a<sub>b</html>c</sub>d<head>h</head>")).toEqual(["abc(sub)dh"]);
  });
});

describe("readLabel's tags removed with their content", () => {
  // Measured: DOMPurify removes each of these with everything in it, and
  // the parser reads their content as raw text up to an end tag of the
  // same name (any case, then whitespace, `/` or `>`), so a tag inside
  // them is text too.
  it("removes <script>, <style>, <iframe>, <noembed>, <xmp> and <noframes> with their content", () => {
    expect(
      flagged(
        "a<script>b<b>c</b></script >d<style>s</style>e<iframe>f</iframe>g" +
          "<noembed>h</noembed>i<xmp>j</XMP>k<noframes>l</noframes>m",
      ),
    ).toEqual(["adegikm"]);
  });

  // `a<script>b` is `a`, and `a<script>b</scriptx>c</script>d` is `ad`
  // (measured): only its own end tag ends the content.
  it("removes to the end of the label when the content is never closed", () => {
    expect(flagged("a<script>b")).toEqual(["a"]);
    expect(flagged("a<script>b</scriptx>c</script>d")).toEqual(["ad"]);
  });

  // `<b>a<script>x</script>b</b>c` is `<b>ab</b>c` (measured).
  it("leaves the tags around the removed content open", () => {
    expect(flagged("<b>a<script>x</script>b</b>c")).toEqual(["ab(b)c"]);
  });
});

describe("readLabel's <plaintext>", () => {
  // Nothing ends a `plaintext`'s content, not even its own end tag, and
  // DOMPurify removes it with that content: `<plaintext>x</plaintext>y` is
  // empty, and `<b>a</b>b<plaintext>x</plaintext>y<br><b>z</b>` is
  // `<b>a</b>b`, the row break after it gone too (measured).
  it("removes everything after <plaintext>", () => {
    expect(flagged("<b>a</b>b<plaintext>x</plaintext>y<br><b>z</b>")).toEqual(["a(b)b"]);
  });
});

describe("readLabel's <noscript>", () => {
  // DOMPurify parses with scripting off, so a `noscript`'s content is read
  // as elements — it nests, and a formatting tag misnested with it is
  // reopened after it — and then removed with it:
  // `a<noscript>b<noscript>c</noscript>d</noscript>e` is `ae`, and
  // `a<noscript>b<b>c</noscript>d</b>e` is `a<b>d</b>e` (measured).
  it("removes <noscript> with its content, read as elements", () => {
    expect(flagged("a<noscript>b<noscript>c</noscript>d</noscript>e")).toEqual(["ae"]);
    expect(flagged("a<noscript>b<b>c</noscript>d</b>e")).toEqual(["ad(b)e"]);
  });

  // `a<noscript>b<br>c</noscript>d` is `ad` (measured): the break went with it.
  it("removes a row break inside <noscript> too", () => {
    expect(flagged("a<noscript>b<br>c</noscript>d")).toEqual(["ad"]);
  });
});

describe("readLabel's entity codes", () => {
  // Mermaid's own `#name;` / `#NN;` codes, measured in 11.17.2's HTML labels:
  // `a#quot;b#amp;c#lt;d#gt;e#35;f` draws `a"b&c<d>e#f`, and a code is
  // text, never a tag: `#lt;b#gt;x#lt;/b#gt;` draws `<b>x</b>`.
  it("resolves #quot; #amp; #lt; #gt; and a decimal code to their characters", () => {
    expect(flagged("a#quot;b#amp;c#lt;d#gt;e#35;f")).toEqual(['a"b&c<d>e#f']);
    expect(flagged("#lt;b#gt;x#lt;/b#gt;")).toEqual(["<b>x</b>"]);
  });

  // A code is an HTML character reference by another spelling — Mermaid
  // turns `#name;` into `&name;` and the browser reads it — so every name
  // the HTML standard defines resolves, and one it does not is drawn as the
  // reference the browser was handed: `a#copy;b#foo;c#x41;d#Amp;e` draws
  // `a©b&foo;c&x41;d&Amp;e` (measured).
  it("resolves every HTML name, and draws an unknown one with an ampersand", () => {
    expect(flagged("a#copy;b#foo;c#x41;d#Amp;e#AMP;f#NotEqualTilde;")).toEqual(["a©b&foo;c&x41;d&Amp;e&f\u2242\u0338"]);
  });

  // A legacy name — one the standard also reads without its `;` — resolves
  // as the longest prefix of a longer word: `a #ampx; b #notit; c #amp d`
  // draws `a &x; b ¬it; c #amp d` (measured), the last no code at all.
  it("resolves a legacy name at the start of a longer code, as the browser does", () => {
    expect(flagged("a #ampx; b #notit; c #amp d #notin;")).toEqual(["a &x; b ¬it; c #amp d ∉"]);
  });

  // An attribute value is resolved too, under the parser's attribute rule:
  // a legacy name with no `;` that runs on into a letter, a digit or `=` is
  // left as written. `<a href='?a=1#amp;b=2#35;f'>` keeps `?a=1&b=2#f`, and
  // `<a href='?a&ampx=1&amp=2'>` keeps `?a&ampx=1&amp=2` (measured).
  it("resolves codes in an attribute value, under the parser's attribute rule", () => {
    expect(runsOf("<a href='?a=1#amp;b=2#35;f'>x</a><a href='?a&ampx=1&amp=2&lt'>y</a>", "href")).toEqual([
      { text: "x", href: "?a=1&b=2#f" },
      { text: "y", href: "?a&ampx=1&amp=2<" },
    ]);
  });

  // Before it rewrites codes, Mermaid drops the last `;` of a line where
  // `style`, a `:` and then a `#` come before it (its `/style.*:\S*#.*;/`),
  // so a lone hex color ending in `;` is a color, not a code — and any other
  // `#hex;` before it is a code, which the browser cannot read as a color
  // and drops. Measured: `<span style='color:#0f0;'>` is
  // `style="color:#0f0"`, and `<span style='color:#f00;background-color:#ff0;'>`
  // is `style="color:&amp;f00;background-color:#ff0"`.
  it("keeps a lone hex color in a style, and drops one Mermaid turned into a code", () => {
    expect(runsOf("<span style='color:#0f0;'>a</span>", "color")).toEqual([{ text: "a", color: "#0f0" }]);
    expect(runsOf("<span style='color:#f00;background-color:#ff0;'>b</span>", "color", "background")).toEqual([
      { text: "b", color: null, background: "#ff0" },
    ]);
  });

  // The browser resolves the references an author wrote as HTML too, by its
  // own rules — with or without a `;`, a number in hex as well — while
  // Mermaid's rewrite still reaches the `#…;` inside one. Measured:
  // `a &lt; b &copy; &#35; &foo; &amp` draws `a < b © &# &foo; &`, and
  // `&#x41;&#65&lt&ltx&notin;&notit;` draws `&&x41;A<<x∉¬it;`.
  it("resolves character references an author wrote, in the html dialect", () => {
    expect(flagged("a &lt; b &copy; &#35; &foo; &amp")).toEqual(["a < b © &# &foo; &"]);
    expect(flagged("&#x41;&#65&lt&ltx&notin;&notit;")).toEqual(["&&x41;A<<x∉¬it;"]);
    expect(flagged("&#x41 &#65 &#x &#128 &#;")).toEqual(["A A &#x € &#;"]);
  });

  // Mermaid draws sequence text as SVG, setting the text with its codes
  // still in its own placeholders, and rewrites those into references in
  // the SVG markup it returns (its `cleanUpSvgCode`), which the browser then
  // parses. So a code resolves exactly as in a label, while a reference the
  // author wrote was escaped with the rest of the text and stays as written,
  // as every tag but `<br>` does. (Read from Mermaid 11.17.2's source: the
  // probe prints no sequence text.)
  it("resolves entity codes in the sequence dialect, and nothing else", () => {
    const { label } = readLabel("a#quot;b#35;c#copy;d#foo;e#ampx;f&lt;g<b>h</b>#lt;i#gt;", { dialect: "sequence" });
    expect(label.text).toBe('a"b#c©d&foo;e&x;f&lt;g<b>h</b><i>');
  });

  // As the parser reads a number: `#0;#55296;#1114112;#128;#150;#9;` draws
  // `\uFFFD\uFFFD\uFFFD€–` and a tab (measured) — no character, a
  // surrogate and one past Unicode are the replacement character, and 128–159
  // are the windows-1252 characters at those bytes.
  it("resolves a decimal code as the HTML parser does, out-of-range numbers included", () => {
    expect(flagged("#0;#55296;#1114112;#128;#150;#9;#99999999999999999999;#035;")).toEqual([
      "\uFFFD\uFFFD\uFFFD€–\t\uFFFD#",
    ]);
  });
});

describe("readLabel's block tags", () => {
  // The board's block layer, less `li` (which begins with a marker) and
  // `hr` (which has no content). Each is a block in the browser, so its
  // start and its end each end the line before it: `a<div>b</div>c` is
  // `<p>a</p><div>b</div>c<p></p>` (measured with `mermaid-probe.mjs --html`
  // against 11.17.2) — three lines.
  const blocks = [
    "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "ul", "ol", "dl", "dt",
    "dd", "section", "article", "address", "aside", "center", "dir", "figcaption", "figure",
    "footer", "header", "hgroup", "main", "marquee", "menu", "nav", "search", "summary",
  ];
  for (const tag of blocks) {
    it(`begins and ends a row at <${tag}>`, () => {
      expect(rowTexts(`a<${tag}>b</${tag}>c`)).toEqual(["a", "b", "c"]);
    });
  }

  // Two block edges with nothing between them end one line, not two: the
  // browser draws no empty line where a block begins or ends next to
  // another, nor at the start or end of the label — `<div><p>a</p></div><div>b</div>`
  // is two lines. A `<br>` ending a block's last line adds none either
  // (`<p>a<br></p>b` is two lines), while one before a block begins a line
  // of its own (`<br><div>a</div>` is an empty line over `a`).
  it("merges block edges that meet, with no empty row at either end of the label", () => {
    expect(rowTexts("<div><p>a</p></div><div>b</div>")).toEqual(["a", "b"]);
    expect(rowTexts("<p>a<br></p>b")).toEqual(["a", "b"]);
    expect(rowTexts("<br><div>a</div>")).toEqual(["", "a"]);
  });

  it("reads a label of nothing but empty blocks as one empty row", () => {
    expect(rowTexts("<div></div><p></p>")).toEqual([""]);
  });

  // CSS, not a measurement: the browser drops the spaces at either end of a
  // line, and a line holding only spaces is not drawn, so spaces written
  // between blocks (`<div>a</div> <div>b</div>`) draw nothing.
  it("drops the spaces at a block edge, and a row of nothing but spaces between blocks", () => {
    expect(rowTexts("x <div> a </div> <div>b</div> ")).toEqual(["x", "a", "b"]);
  });

  // Mermaid hands the browser every label inside a `<p>`, and a block start
  // tag closes an open `<p>` and everything opened inside it, reopening only
  // the formatting tags: `<sub>a<div>b</div>c</sub>d` is
  // `<p><sub>a</sub></p><div>b</div>cd`, `<b>a<div>b</div>c</b>d` is
  // `<p><b>a</b></p><div><b>b</b></div><b>c</b>d`, and a stray `</p>` ends
  // that `<p>`: `a</p>b` is `<p>a</p><p></p>b` (measured).
  it("closes the paragraph Mermaid wraps a label in at the first block", () => {
    expect(flagged("<sub>a<div>b</div>c</sub>d")).toEqual(["a(sub)", "b", "cd"]);
    expect(flagged("<b>a<div>b</div>c</b>d")).toEqual(["a(b)", "b(b)", "c(b)d"]);
    expect(rowTexts("a</p>b")).toEqual(["a", "b"]);
  });

  // An end tag does not close a block opened inside its element. Any other
  // end tag is dropped there — `<div>x</div><sub>a<div>b</sub>c</div>d` is
  // `…<sub>a<div>bc</div>d</sub>` — and a formatting tag's ends at once,
  // its style leaving the rest of the block, along with the ordinary tags
  // between it and the block, while formatting tags between stay open:
  // `<b>a<div>b</b>c</div>d` is `<b>a</b><div><b>b</b>c</div>d`,
  // `<b>a<sub>s<div></b>c</div>d` is `<b>a<sub>s</sub></b><div><b></b>c</div>d`,
  // and `<b>a<i>i<div>b</b>c</div>d` is
  // `<b>a<i>i</i></b><i><div><b>b</b>c</div>d</i>` (each after a
  // `<div>x</div>` that closed Mermaid's paragraph; measured).
  it("leaves a block open at an end tag of an element it is inside", () => {
    expect(flagged("<div>x</div><sub>a<div>b</sub>c</div>d")).toEqual(["x", "a(sub)", "bc(sub)", "d(sub)"]);
    expect(flagged("<div>x</div><b>a<div>b</b>c</div>d")).toEqual(["x", "a(b)", "b(b)c", "d"]);
    expect(flagged("<div>x</div><b>a<sub>s<div></b>c</div>d")).toEqual(["x", "a(b)s(bsub)", "c", "d"]);
    expect(flagged("<div>x</div><b>a<i>i<div>b</b>c</div>d")).toEqual(["x", "a(b)i(bi)", "b(bi)c(i)", "d(i)"]);
  });

});

/** Each row's runs, as text, then `bold`, then the font-size scale — the heading picture. */
function headingRuns(source: string): string[][] {
  const { label } = readLabel(source, { dialect: "html" });
  return label.rows.map((row) =>
    row.map((run) => `${run.text} ${run.bold ? "bold" : "regular"} ${"scale" in run.fontSize ? run.fontSize.scale : run.fontSize.absolute}`),
  );
}

describe("readLabel's headings", () => {
  // The board's measured picture: `h1`…`h6` at × 2 / 1.5 / 1.17 / 1 /
  // 0.83 / 0.67 of the size around them, all bold.
  it("reads <h1>…<h6> as bold rows at the board's scales", () => {
    expect(headingRuns("<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>")).toEqual([
      ["a bold 2"],
      ["b bold 1.5"],
      ["c bold 1.17"],
      ["d bold 1"],
      ["e bold 0.83"],
      ["f bold 0.67"],
    ]);
  });

  // A heading's start tag closes a heading that is the current element, and
  // any heading's end tag closes whichever heading is open:
  // `<h1>a<h2>b</h2>c</h1>d` is `<h1>a</h1><h2>b</h2>cd` (measured).
  it("closes an open heading at the next heading, and at any heading's end tag", () => {
    expect(headingRuns("<h1>a<h2>b</h2>c</h1>d")).toEqual([["a bold 2"], ["b bold 1.5"], ["cd regular 1"]]);
    expect(headingRuns("<h3>a</h5>b")).toEqual([["a bold 1.17"], ["b regular 1"]]);
  });
});

describe("readLabel's blocks with a font of their own", () => {
  // The board's measured picture: `pre` draws its text in `monospace`, and
  // `address` in italics.
  it("reads <pre> as monospace rows and <address> as italic ones", () => {
    const { label } = readLabel("x<pre>a</pre><address>b</address>", { dialect: "html" });
    expect(label.rows.map((row) => row.map(({ text, monospace, italic }) => ({ text, monospace, italic })))).toEqual([
      [{ text: "x", monospace: false, italic: false }],
      [{ text: "a", monospace: true, italic: false }],
      [{ text: "b", monospace: false, italic: true }],
    ]);
  });

  // `<pre>  a   b  </pre>` reaches the browser as written (measured), and
  // `pre` keeps every space, where SVG text — like any other HTML — draws a
  // run of spaces as one and none at the ends of a line. Siren keeps them
  // as no-break spaces, which SVG does not collapse.
  it("keeps every space in <pre>, as a no-break space", () => {
    expect(rowTexts("x<pre>  a   b  </pre>y")).toEqual([
      "x",
      "\u00a0\u00a0a\u00a0\u00a0\u00a0b\u00a0\u00a0",
      "y",
    ]);
  });
});

describe("readLabel's lists", () => {
  // The board's measured picture: a list item begins with its marker. An
  // `li` start tag closes an open `li`, so `x<li>a<li>b` is
  // `<p>x</p><li>a</li><li>b</li>` (measured); outside an `ol` the marker is
  // a bullet.
  it("begins each <li> with a bullet, closing the item before it", () => {
    expect(rowTexts("<ul><li>a</li><li>b</li></ul>")).toEqual(["\u2022 a", "\u2022 b"]);
    expect(rowTexts("x<li>a<li>b")).toEqual(["x", "\u2022 a", "\u2022 b"]);
    expect(rowTexts("<ul> <li> a</li> <li>b</li> </ul>")).toEqual(["\u2022 a", "\u2022 b"]);
  });

  // The marker is the item's own, drawn in the item's style rather than in
  // that of a tag inside it, as the browser's `::marker` is.
  it("draws the bullet in the item's style", () => {
    expect(flagged("<ul><li><b>a</b></li></ul><b><li>c</li></b>")).toEqual(["\u2022 a(b)", "\u2022 c(b)"]);
  });

  // In an `ol` the marker is the item's number, each `ol` counting from 1,
  // an item belonging to the innermost list it is in: `<ol><li>a<ol><li>b<li>c</ol><li>d</ol>`
  // is `<ol><li>a<ol><li>b</li><li>c</li></ol></li><li>d</li></ol>`
  // (measured). Nested lists are not indented.
  it("numbers the items of each <ol> from 1, and bullets those of a list inside one", () => {
    expect(rowTexts("<ol><li>a<li>b</ol><ol><li>c</ol>")).toEqual(["1. a", "2. b", "1. c"]);
    expect(rowTexts("<ol><li>a<ol><li>b<li>c</ol><li>d</ol>")).toEqual(["1. a", "1. b", "2. c", "2. d"]);
    expect(rowTexts("<ol><li>a<ul><li>b</ul></ol>")).toEqual(["1. a", "\u25e6 b"]);
  });

  // `<ul><li><p>a</p></li><li></li></ul>` reaches the browser as written
  // (measured), which puts the first item's marker beside `a`, on the first
  // line inside it, and still draws the second's on a line of its own.
  // An `</li>` does not reach past a list opened inside the item:
  // `<li>a<ul>x</li>y</ul>z` is `<li>a<ul>xy</ul>z</li>` (measured).
  it("leaves a list open at an </li> inside it", () => {
    expect(rowTexts("<li>a<ul>x</li>y</ul>z")).toEqual(["\u2022 a", "xy", "z"]);
  });

  it("draws a marker on its item's first line, and an empty item's on its own", () => {
    expect(rowTexts("<ul><li><p>a</p></li><li></li></ul>")).toEqual(["\u2022 a", "\u2022"]);
  });

  // DOMPurify keeps `start` (measured: `<ol start="3">`, `start="0"`,
  // `start="-2"` and `start="x"` all reach the browser), and the browser
  // reads it by the HTML standard's rules for parsing integers: leading
  // spaces, a sign, then digits, anything after them ignored; a value with
  // no digits is no start at all, and the list counts from 1.
  it("counts an <ol>'s items from its start", () => {
    expect(rowTexts('<ol start="3"><li>a<li>b</ol>')).toEqual(["3. a", "4. b"]);
    expect(rowTexts('<ol start="0"><li>a<li>b</ol>')).toEqual(["0. a", "1. b"]);
    expect(rowTexts('<ol start="-2"><li>a</ol>')).toEqual(["-2. a"]);
    expect(rowTexts("<ol start=+4x><li>a</ol>")).toEqual(["4. a"]);
    expect(rowTexts('<ol start="x"><li>a</ol>')).toEqual(["1. a"]);
  });

  // DOMPurify keeps `value` too (measured: `<li value="7">`, `value="q"`,
  // `value="2.9"`), read by the same rules; the items after one count on
  // from it. In a `ul` it numbers nothing the browser draws.
  it("numbers an <li> from its value, and the items after it from there", () => {
    expect(rowTexts('<ol start="3"><li>a<li value="7">b<li>c</ol>')).toEqual(["3. a", "7. b", "8. c"]);
    expect(rowTexts('<ol><li value="q">a<li value="2.9">b<li>c</ol>')).toEqual(["1. a", "2. b", "3. c"]);
    expect(rowTexts('<ul><li value="5">a</ul>')).toEqual(["• a"]);
  });

  // The browser's default stylesheet: a `ul` inside a `ul` is `circle`, one
  // inside two is `square`, and deeper ones stay `square`; `menu` and `dir`
  // are drawn as `ul` is.
  it("bullets a nested list's items by its depth: disc, circle, then square", () => {
    expect(rowTexts("<ul><li>a<ul><li>b<ul><li>c<ul><li>d</ul></ul></ul><li>e</ul>")).toEqual([
      "• a",
      "◦ b",
      "▪ c",
      "▪ d",
      "• e",
    ]);
    expect(rowTexts("<menu><li>a<dir><li>b</dir></menu>")).toEqual(["• a", "◦ b"]);
  });
});

describe("readLabel's definition lists", () => {
  // A `dt` or `dd` start tag closes an open `dt` or `dd`, so the stray
  // `</dt>` after it closes nothing: `<dt>a<dd>b</dt>c` is
  // `<dt>a</dt><dd>bc</dd>` (measured).
  it("closes an open <dt> or <dd> at the next of either", () => {
    expect(rowTexts("<dt>a<dd>b</dt>c")).toEqual(["a", "bc"]);
    expect(rowTexts("<dl><dd>a<dt>b</dd>c</dl>")).toEqual(["a", "bc"]);
  });
});

describe("readLabel's <hr>", () => {
  // `a<hr>b<hr/>c` is `<p>a</p><hr>b<hr>c` (measured): a void block, which
  // the board draws as a row edge and nothing else — the rule is not drawn.
  it("ends the row at <hr>, drawing no rule", () => {
    expect(rowTexts("a<hr>b<hr/>c</hr>d")).toEqual(["a", "b", "cd"]);
  });
});

describe("readLabel's <marquee>", () => {
  // The board draws `marquee` as static text, a block of its own rows. The
  // HTML parser makes it a scope boundary: a block inside it does not close
  // Mermaid's paragraph around it, an end tag inside it closes nothing
  // outside it, and a formatting tag opened inside it is not reopened after
  // it. Measured: `<sub>s<marquee>a<div>b</div>c</marquee>d</sub>e` reaches
  // the browser as written, `<b>x<marquee>a</b>c</marquee>d` is
  // `<b>x<marquee>ac</marquee>d</b>`, and `<marquee><b>a</marquee>c` is
  // `<marquee><b>a</b></marquee>c`.
  it("draws <marquee> as still rows, which tags around it do not reach into", () => {
    expect(flagged("<sub>s<marquee>a<div>b</div>c</marquee>d</sub>e")).toEqual([
      "s(sub)",
      "a(sub)",
      "b(sub)",
      "c(sub)",
      "d(sub)e",
    ]);
    expect(flagged("<b>x<marquee>a</b>c</marquee>d")).toEqual(["x(b)", "ac(b)", "d(b)"]);
    expect(flagged("<marquee><b>a</marquee>c")).toEqual(["a(b)", "c"]);
  });
});

describe("readLabel's block tags in the sequence dialect", () => {
  // Mermaid draws sequence text in SVG mode, where a block tag is its characters.
  it("leaves block tags as characters", () => {
    const { label } = readLabel("<div>a</div><li>b", { dialect: "sequence" });
    expect(label.rows.map((row) => row.map((run) => run.text).join(""))).toEqual(["<div>a</div><li>b"]);
  });
});

describe("readLabel's refused tags", () => {
  /** The problems reading `source` in the `html` dialect reports, as `[severity, offset]`. */
  function refusals(source: string): [string, number][] {
    return readLabel(source, { dialect: "html" }).problems.map((problem) => [problem.severity, problem.offset]);
  }

  /** The error-severity diagnostic's message for a refused `<name>`, saying what kind of HTML it is. */
  function refusal(name: string, kinds: string): string {
    return `<${name}> cannot be drawn: Siren draws labels as SVG text, not HTML, and does not draw ${kinds}.`;
  }

  // ADR-0015's refused layers, by what each kind of HTML draws in the
  // browser that SVG text cannot. `svg` and `math` are outside DOMPurify's
  // HTML allow-list, but its SVG and MathML profiles keep them (measured:
  // `a<svg>s</svg>b` and `a<math>m</math>c` reach the browser as written),
  // so they are not unknown tags whose text is kept.
  const REFUSED: readonly (readonly [kinds: string, names: readonly string[]])[] = [
    ["tables", ["table"]],
    ["ruby annotations", ["ruby", "rt"]],
    ["images", ["img"]],
    ["embedded content", ["canvas", "svg", "math"]],
    [
      "form controls",
      [
        "input", "button", "select", "textarea", "form", "fieldset", "legend", "option", "optgroup", "meter",
        "progress",
      ],
    ],
    ["media", ["video", "audio"]],
    ["interactive content", ["details"]],
  ];
  for (const [kinds, names] of REFUSED) {
    for (const name of names) {
      it(`refuses <${name}> with an error-severity diagnostic at the tag, naming ${kinds}`, () => {
        const { problems } = readLabel(`ab <${name}>c</${name}>`, { dialect: "html" });
        expect(problems.map(({ severity, offset }) => [severity, offset])).toEqual([["error", 3]]);
        expect(problems[0]!.message.startsWith(refusal(name, kinds))).toBe(true);
      });
    }
  }

  // ADR-0015: `<img>`'s diagnostic names Mermaid's own image shape.
  it("points <img> at Mermaid's image shape", () => {
    expect(readLabel("<img src='x.png'>", { dialect: "html" }).problems[0]!.message).toBe(
      `${refusal("img", "images")} Draw an image with Mermaid's image shape, A@{ img: "…" }, instead.`,
    );
  });

  // One error-severity diagnostic per label, at its first refused tag: it
  // already costs the document and the label has to be rewritten, and one
  // for every refused tag would bury every other diagnostic.
  it("reports one error-severity diagnostic per label, at the first refused start tag", () => {
    expect(refusals("a<table><tr><td>b</td><td>c</td></tr></table><img>")).toEqual([["error", 1]]);
  });

  // Content DOMPurify removes never reaches the browser: `a<noscript><table>t</table></noscript>b`
  // is `<p>ab</p>` (measured), which Siren draws.
  it("does not refuse a tag inside content that is removed", () => {
    expect(refusals("a<noscript><table>t</table></noscript>b<script><img></script>")).toEqual([]);
    expect(rowTexts("a<noscript><table>t</table></noscript>b")).toEqual(["ab"]);
  });

  // Mermaid draws sequence text in SVG mode, where every one of these is
  // its characters: drawn as written, and nothing to refuse.
  it("leaves refused tags as characters in the sequence dialect, with no diagnostic", () => {
    const { label, problems } = readLabel("a<table>b<img>c<svg>", { dialect: "sequence" });
    expect(label.text).toBe("a<table>b<img>c<svg>");
    expect(problems).toEqual([]);
  });

  it("places the error-severity diagnostic in a Markdown string at the tag as the author wrote it", () => {
    const source = "**a** *b*\nc <ruby>x</ruby>";

    const { problems } = readLabel(source, { dialect: "html", markdown: true });

    expect(problems.map((problem) => [problem.severity, problem.offset])).toEqual([
      ["error", source.indexOf("<ruby")],
    ]);
  });
});

describe("readLabel's <title>", () => {
  // DOMPurify's SVG profile keeps `<title>`, the parser reads its content as
  // text up to `</title>` (measured: `c<title>ti<b>x</b></title>d` reaches the
  // browser as `c<title>ti&lt;b&gt;x&lt;/b&gt;</title>d`, and `a<title>tb` as
  // `a<title>tb</title>`), and the browser hides it.
  it("removes <title> together with its content, tags in it included", () => {
    expect(rowTexts("c<title>ti<b>x</b></title>d")).toEqual(["cd"]);
    expect(rowTexts("a<title>tb")).toEqual(["a"]);
    expect(readLabel("c<title>t</title>d", { dialect: "html" }).problems).toEqual([]);
  });
});

describe("readLabel's table parts outside a table", () => {
  // Outside a `table` the HTML parser ignores the start and end tags of a
  // table's nine parts, so nothing opens or closes at them and their text
  // is kept (measured, 11.17.2 `--html`: `a<td>x</td>b` and `a<tr>x</tr>b`
  // are `axb`, `a<col>b` is `ab`, and `<td>a<sub>b</td>c</sub>d` is
  // `a<sub>bc</sub>d`).
  it("drops a stray table part and keeps its text, with no diagnostic", () => {
    const source =
      "a<tr>1</tr><td>2</td><th>3</th><thead>4</thead><tbody>5</tbody>" +
      "<tfoot>6</tfoot><caption>7</caption><col>8<colgroup>9</colgroup>b";
    expect(readLabel(source, { dialect: "html" }).problems).toEqual([]);
    expect(rowTexts(source)).toEqual(["a123456789b"]);
  });

  it("closes nothing at a stray table part's end tag", () => {
    expect(flagged("<td>a<sub>b</td>c</sub>d")).toEqual(["abc(sub)d"]);
  });
});

describe("readLabel's tags the browser does not show", () => {
  // DOMPurify keeps each, and its content is read as elements, but the
  // browser draws none of it: `template` is inert, and `datalist` and `rp`
  // are `display: none` (ADR-0015). Measured, 11.17.2 `--html`:
  // `a<template>t<b>x</b></template>b`, `a<datalist>t<b>x</b></datalist>b`
  // and `a<rp>t<b>x</b></rp>b` reach the browser as written, and
  // `a<template>t` is `a<template>t</template>`.
  it("removes <template>, <datalist> and <rp> with their content, with no diagnostic", () => {
    const source = "a<template>t<b>x</b></template>b<datalist>t<b>x</b></datalist>c<rp>t<b>x</b></rp>d";
    expect(readLabel(source, { dialect: "html" }).problems).toEqual([]);
    expect(rowTexts(source)).toEqual(["abcd"]);
    expect(rowTexts("a<template>t")).toEqual(["a"]);
  });

  // An end tag inside a `template` closes nothing opened outside it:
  // `<b>a<template>c</b>d</template>e` is `<b>a<template>cd</template>e</b>`.
  // `datalist` and `rp` close at a formatting end tag around them:
  // `<b>a<datalist>c</b>d</datalist>e` is `<b>a<datalist>c</datalist></b>de`,
  // and `rp` the same (measured).
  it("bounds each one's content as the parser does", () => {
    expect(flagged("<b>a<template>c</b>d</template>e")).toEqual(["ae(b)"]);
    expect(flagged("<b>a<datalist>c</b>d</datalist>e")).toEqual(["a(b)de"]);
    expect(flagged("<b>a<rp>c</b>d</rp>e")).toEqual(["a(b)de"]);
  });

  // Void, so there is no content to remove, and `display: none`: `a<source>b</source>c`
  // is `a<source>bc`, `track` and `area` the same, and `<sub>a<source>b</sub>c`
  // is `<sub>a<source>b</sub>c` (measured).
  it("drops <source>, <track> and <area>, which have no content, with no diagnostic", () => {
    const source = "a<source>b</source>c<track>d</track>e<area>f</area>g";
    expect(readLabel(source, { dialect: "html" }).problems).toEqual([]);
    expect(rowTexts(source)).toEqual(["abcdefg"]);
    expect(flagged("<sub>a<source>b</sub>c")).toEqual(["ab(sub)c"]);
  });

  // A closed `dialog` is hidden, and it is a block: its start tag closes the
  // paragraph around it, so `a<dialog>t<b>x</b></dialog>b` is
  // `<p>a</p><dialog>t<b>x</b></dialog>b<p></p>` and
  // `a<dialog>x<div>y</div>z</dialog>b` the same, `a` and `b` on rows of
  // their own (measured).
  it("removes a closed <dialog> with its content, as a block, with no diagnostic", () => {
    const source = "a<dialog>t<b>x</b><div>y</div>z</dialog>b";
    expect(readLabel(source, { dialect: "html" }).problems).toEqual([]);
    expect(rowTexts(source)).toEqual(["a", "b"]);
    expect(rowTexts("a<dialog>t")).toEqual(["a"]);
  });

  // DOMPurify keeps `open` (measured: `a<dialog open>x</dialog>b` reaches the
  // browser as `<p>a</p><dialog open="">x</dialog>b<p></p>`), and an open
  // dialog is drawn, a box SVG text cannot draw: still refused.
  it("refuses an open <dialog> as interactive content", () => {
    const { problems } = readLabel("a<dialog open>x</dialog>b", { dialect: "html" });
    expect(problems.map(({ severity, offset }) => [severity, offset])).toEqual([["error", 1]]);
    expect(problems[0]!.message).toContain("does not draw interactive content.");
  });
});
