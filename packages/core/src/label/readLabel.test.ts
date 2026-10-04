import { describe, expect, it } from "vitest";
import type { LabelRun } from "./label";
import { readLabel } from "./readLabel";
import { readLabelAt } from "./readLabelAt";

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

  // `<span style>` keeps its declarations through DOMPurify (measured with
  // `mermaid-probe.mjs --html`), and the board names the ten properties
  // Siren draws. These six are carried as written.
  it("reads <span style>'s color, background, family and spacing as written", () => {
    expect(
      runsOf(
        "x <span style='color: red; Background-Color:#ff0;font-family:serif;letter-spacing:2px;word-spacing:1em;opacity:0.5'>y</span>",
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
  // around it — and the browser draws a link, blue and underlined.
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
        (href) => ({ text: "x", href, underline: true, color: null }),
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
