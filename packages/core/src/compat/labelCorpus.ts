/**
 * The compatibility corpus's **label vocabulary** rows: one per HTML tag
 * behavior ADR-0015 holds Siren to, merged into `COMPAT_CASES` by
 * `corpus.ts`.
 *
 * A file of its own because the vocabulary is one body of work spread over
 * many tickets, and every one of them adds rows: keeping those rows here
 * means a ticket teaching `readLabel` a tag never has to touch `corpus.ts`,
 * and a ticket wiring a diagram kind's label positions never has to touch
 * this. Rows about *where* a label is written (an edge label, a subgraph
 * title, a class label) stay in `corpus.ts` beside the rest of their kind;
 * rows about *what a tag draws* live here, and are written in a flowchart
 * node because that is the one position every tag reaches.
 *
 * The same rules as `corpus.ts`: valid Mermaid, its meaning in prose, and an
 * `assert` that reads the picture out of the rendered SVG rather than out of
 * the parse.
 */
import type { SirenRenderResult } from "../contracts";
import type { CompatCase } from "./corpus";

/**
 * One drawn label's rows, read off its `<tspan class="siren-label-row">`
 * structure — one string per row, each run's text followed by `(b)`, `(i)`
 * or `(bi)` when it carries `font-weight: bold` / `font-style: italic`, and
 * nothing appended for a plain run.
 *
 * A label drawn as bare `textContent` — one row of one plain run, which is
 * what `drawLabel` writes for nearly every label — reads as that one row, so
 * a row asserting `["Start"]` holds whichever of the two shapes was drawn,
 * and a row asserting two rows can only hold when two `<tspan>` rows really
 * were drawn: `textContent` concatenates them with nothing between, so a
 * label that lost its break would read `["ab"]`, not `["a", "b"]`.
 *
 * Exported because the node, edge and subgraph rows in `corpus.ts` read
 * labels the same way.
 */
export function labelRows(text: Element | null): string[] {
  if (text === null) {
    return [];
  }
  const rows = Array.from(text.querySelectorAll(":scope > tspan.siren-label-row"));
  if (rows.length === 0) {
    return [text.textContent ?? ""];
  }
  return rows.map((row) =>
    Array.from(row.querySelectorAll("tspan"))
      .map((run) => {
        const flags =
          (run.getAttribute("font-weight") === "bold" ? "b" : "") +
          (run.getAttribute("font-style") === "italic" ? "i" : "");
        return flags === "" ? (run.textContent ?? "") : `${run.textContent}(${flags})`;
      })
      .join(""),
  );
}

/**
 * One drawn label's runs, row after row, each as its text followed by
 * `[name=value]` for every one of `attributes` its `<tspan>` carries — the
 * reader for the rows below whose picture is a property `labelRows` does not
 * spell (an underline, a font size, a baseline shift).
 *
 * A label drawn as bare `textContent` reads as one run with no attributes,
 * which is exactly what a styling tag that stopped being read would draw.
 * A run drawn inside an `<a>` is read with `[href=…]` before the rest, so a
 * link that stopped being drawn shows in the failure.
 */
function labelRuns(text: Element | null, ...attributes: string[]): string[] {
  if (text === null) {
    return [];
  }
  // A linked run sits one level down, inside the `<a>` around it.
  const runs = Array.from(
    text.querySelectorAll(":scope > tspan.siren-label-row > tspan, :scope > tspan.siren-label-row > a > tspan"),
  );
  if (runs.length === 0) {
    return [text.textContent ?? ""];
  }
  return runs.map(
    (run) =>
      (run.textContent ?? "") +
      (run.parentElement?.tagName === "a" ? `[href=${run.parentElement.getAttribute("href")}]` : "") +
      attributes
        .filter((name) => run.hasAttribute(name))
        .map((name) => `[${name}=${run.getAttribute(name)}]`)
        .join(""),
  );
}

/** The `<text>` a flowchart node's label was drawn in, or `null`. */
function nodeText(result: SirenRenderResult, id: string): Element | null {
  if (result.svg === null) {
    throw new Error("render() produced no <svg>");
  }
  return result.svg.querySelector(`g.siren-node[data-siren-id="${id}"] text`);
}

/** Throws unless the two agree, naming both — `corpus.ts`'s `expectSame`, for this file's rows. */
function expectRows(what: string, actual: string[], expected: string[]): void {
  const got = JSON.stringify(actual);
  const wanted = JSON.stringify(expected);
  if (got !== wanted) {
    throw new Error(`${what}: expected ${wanted}, got ${got}`);
  }
}

/**
 * A row for one spelling of `<br>` in a node label: two rows, `a` over `b`.
 *
 * Four rows rather than one row with four nodes, so that a spelling that
 * stops breaking names itself in the failure list.
 */
function rowBreakCase(id: string, spelling: string): CompatCase {
  return {
    id,
    kind: "flowchart",
    source: `flowchart TB
      A[a${spelling}b]`,
    status: "supported",
    meaning:
      `\`${spelling}\` in a label is a line break. Mermaid matches \`/<br\\s*\\/?>/gi\`, ` +
      "so `<br>`, `<br/>`, `<br />` and `<BR>` are one row break in its default " +
      "HTML labels and in its SVG ones alike (ADR-0015, measured against 11.17.2). " +
      "Siren used to draw the tag's own characters, with no diagnostic.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["a", "b"]);
    },
  };
}

/** Every label-vocabulary row, in the order `corpus.ts` appends them. */
export const LABEL_CASES: readonly CompatCase[] = [
  rowBreakCase("label-br", "<br>"),
  rowBreakCase("label-br-self-closing", "<br/>"),
  rowBreakCase("label-br-spaced", "<br />"),
  rowBreakCase("label-br-uppercase", "<BR>"),
  {
    id: "label-br-attributes",
    kind: "flowchart",
    source: `flowchart TB
      A[a<br class="x">b]`,
    status: "supported",
    meaning:
      "A `<br>` carrying attributes is a line break too. Mermaid's own " +
      "`/<br\\s*\\/?>/gi` does not match it, so its SVG labels draw the tag's " +
      "characters, but its default HTML labels keep the element and the browser " +
      "breaks the line (ADR-0015, measured against 11.17.2) — and that is the " +
      "picture Siren draws. Siren used to draw the tag's own characters.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["a", "b"]);
    },
  },
  {
    id: "label-br-markdown",
    kind: "flowchart",
    source: `flowchart TB
      A["\`**md**<br/>x\`"]`,
    status: "supported",
    meaning:
      "`<br>` works inside a Markdown string alongside `**` and `*`: Mermaid " +
      "draws a bold `md` over a plain `x` (ADR-0015). The two notations are " +
      "read by one reader, so a Markdown string is not a place tags stop " +
      "meaning anything.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["md(b)", "x"]);
    },
  },
  {
    id: "label-bold",
    kind: "flowchart",
    source: `flowchart TB
      A[x <b>b</b> <strong>s</strong>]`,
    status: "supported",
    meaning:
      "`<b>` and `<strong>` draw their text bold: Mermaid's default HTML labels " +
      "show `font-weight: bold` (measured in headless Chrome against 11.17.2). " +
      "Siren used to draw the tags' own characters.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["x b(b) s(b)"]);
    },
  },
  {
    id: "label-italic",
    kind: "flowchart",
    source: `flowchart TB
      A[<i>i</i><em>e</em><cite>c</cite><dfn>d</dfn><var>v</var>]`,
    status: "supported",
    meaning:
      "`<i>`, `<em>`, `<cite>`, `<dfn>` and `<var>` all draw their text " +
      "italic — five names for one picture, `font-style: italic` (measured " +
      "against 11.17.2).",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["iecdv(i)"]);
    },
  },
  {
    id: "label-underline",
    kind: "flowchart",
    source: `flowchart TB
      A[x <u>u</u><ins>i</ins>]`,
    status: "supported",
    meaning:
      "`<u>` and `<ins>` draw their text underlined (measured against 11.17.2).",
    assert: (result) => {
      expectRows("label runs", labelRuns(nodeText(result, "A"), "text-decoration"), [
        "x ",
        "ui[text-decoration=underline]",
      ]);
    },
  },
  {
    id: "label-strikethrough",
    kind: "flowchart",
    source: `flowchart TB
      A[x <s>s</s><strike>k</strike><del>d</del>]`,
    status: "supported",
    meaning:
      "`<s>`, `<strike>` and `<del>` draw a line through their text " +
      "(measured against 11.17.2).",
    assert: (result) => {
      expectRows("label runs", labelRuns(nodeText(result, "A"), "text-decoration"), [
        "x ",
        "skd[text-decoration=line-through]",
      ]);
    },
  },
  {
    id: "label-monospace",
    kind: "flowchart",
    source: `flowchart TB
      A[x <code>c</code><kbd>k</kbd><samp>s</samp><tt>t</tt>]`,
    status: "supported",
    meaning:
      "`<code>`, `<kbd>`, `<samp>` and `<tt>` draw their text in `monospace` " +
      "(measured against 11.17.2). Siren measures such a run at its regular " +
      "font, as it measures a bold one at the regular weight.",
    assert: (result) => {
      expectRows("label runs", labelRuns(nodeText(result, "A"), "font-family"), [
        "x ",
        "ckst[font-family=monospace]",
      ]);
    },
  },
  {
    id: "label-font-size",
    kind: "flowchart",
    source: `flowchart TB
      A[x <small>s</small><big>b</big>]`,
    status: "supported",
    meaning:
      "`<small>` draws its text at × 0.833 of the size around it and `<big>` " +
      "at × 1.2 (measured against 11.17.2). Siren draws the scale relative to " +
      "its own font size, in `em`.",
    assert: (result) => {
      expectRows("label runs", labelRuns(nodeText(result, "A"), "font-size"), [
        "x ",
        "s[font-size=0.833em]",
        "b[font-size=1.2em]",
      ]);
    },
  },
  {
    id: "label-sub-sup",
    kind: "flowchart",
    source: `flowchart TB
      A[H<sub>2</sub>O x<sup>2</sup>]`,
    status: "supported",
    meaning:
      "`<sub>` and `<sup>` draw their text at × 0.833, below and above the " +
      "baseline (measured against 11.17.2; the shift, 0.314 and 0.475 of the " +
      "run's own size, measured in headless Chrome). Siren shifts the run with " +
      "`dy` and shifts the run after it back.",
    assert: (result) => {
      expectRows("label runs", labelRuns(nodeText(result, "A"), "font-size", "dy"), [
        "H",
        "2[font-size=0.833em][dy=0.314em]",
        "O x[dy=-0.2616em]",
        "2[font-size=0.833em][dy=-0.475em]",
      ]);
    },
  },
  {
    id: "label-quote",
    kind: "flowchart",
    source: `flowchart TB
      A[say <q>hi</q>]`,
    status: "supported",
    meaning:
      "`<q>` draws its text between `“` and `”` (measured against 11.17.2): " +
      "the browser generates the marks, so they are part of what the reader " +
      "sees and of the label's flattened text.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["say “hi”"]);
    },
  },
  {
    id: "label-nested",
    kind: "flowchart",
    source: `flowchart TB
      A[<b>a <i>b</i></b>]`,
    status: "supported",
    meaning:
      "Nested tags stack: `b` inside `<b>…<i>b</i>…</b>` is bold and italic, " +
      "as each tag is an independent property in Mermaid's picture.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["a (b)b(bi)"]);
    },
  },
  {
    id: "label-misnested",
    kind: "flowchart",
    source: `flowchart TB
      A[<b>a<i>b</b>c</i>d]`,
    status: "supported",
    meaning:
      "Misnested tags draw what the browser's HTML parser makes of them, " +
      "which is what Mermaid hands it: `<b>a<i>b</b>c</i>d` becomes " +
      "`<b>a<i>b</i></b><i>c</i>d` (measured in 11.17.2's HTML labels), so " +
      "`c` stays italic after the bold has ended. No diagnostic, as Mermaid " +
      "gives none.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["a(b)b(bi)c(i)d"]);
    },
  },
  {
    id: "label-markdown-nested",
    kind: "flowchart",
    source: `flowchart TB
      A["\`**a <i>b</i> *c***\`"]`,
    status: "supported",
    meaning:
      "A Markdown string's `**` and `*` stack with each other and with tags: " +
      "Mermaid turns the string into HTML (`**` into `<strong>`, `*` into " +
      "`<em>`) before the browser reads it — `<strong>a <i>b</i> <em>c</em></strong>`, " +
      "measured against 11.17.2 — so `b` and `c` are bold and italic.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["a (b)b(bi) (b)c(bi)"]);
    },
  },
  {
    id: "label-markdown-bold-across-br",
    kind: "flowchart",
    source: `flowchart TB
      A["\`**a<br>b**\`"]`,
    status: "supported",
    meaning:
      "A `**` pair in a Markdown string stays bold across a `<br>` between " +
      "its stars: Mermaid's HTML labels show `<strong>a<br>b</strong>` " +
      "(measured against 11.17.2, and its SVG labels agree), a bold `a` over " +
      "a bold `b`. Siren used to split the rows first and draw both halves' " +
      "stars as characters.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["a(b)", "b(b)"]);
    },
  },
  {
    id: "label-markdown-spaced-star",
    kind: "flowchart",
    source: `flowchart TB
      A["\`a * b * c\`"]`,
    status: "supported",
    meaning:
      "A `*` with a space after it opens nothing in a Markdown string: Mermaid's " +
      "HTML labels show `a * b * c` as written, stars and all (measured against " +
      "11.17.2), as CommonMark's flanking rule says. Siren used to pair the two " +
      "stars, drop them, and draw ` b ` in italics.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["a * b * c"]);
    },
  },
  {
    id: "label-markdown-underscore",
    kind: "flowchart",
    source: `flowchart TB
      A["\`_a_ __b__ c_d_e\`"]`,
    status: "supported",
    meaning:
      "A Markdown string's `_` and `__` are emphasis as its `*` and `**` are, " +
      "except inside a word: Mermaid's HTML labels show " +
      "`<em>a</em> <strong>b</strong> c_d_e` (measured against 11.17.2). Siren " +
      "used to draw every underscore as a character.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["a(i) b(b) c_d_e"]);
    },
  },
  {
    id: "label-markdown-punctuation",
    kind: "flowchart",
    source: `flowchart TB
      A["\`x**(a)**y **(b)**\`"]`,
    status: "supported",
    meaning:
      "Stars against punctuation pair only from the outside of a word: " +
      "Mermaid's HTML labels show `x**(a)**y <strong>(b)</strong>` (measured " +
      "against 11.17.2), as the punctuation half of CommonMark's flanking rule " +
      "says — a `**` between a letter and a `(` cannot open. Siren used to draw " +
      "both in bold.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["x**(a)**y (b)(b)"]);
    },
  },
  {
    id: "label-mark",
    kind: "flowchart",
    source: `flowchart TB
      A[x y <mark>m</mark>]`,
    status: "supported",
    meaning:
      "`<mark>` draws its text black on a yellow `#ff0` background (measured " +
      "against 11.17.2). Siren draws a rect behind the run, painted with " +
      "`--siren-label-mark-fill`, and the run's text with " +
      "`--siren-label-mark-text`. The rect is the run's own inline box, as " +
      "CSS paints an inline background (derived, not measured): one line of the " +
      "run's own size tall, not its row's, and moved with a `sub`/`sup` shift. " +
      "Approximations: its width is the measurer's, which can differ from the " +
      "glyphs the browser really draws by a few pixels; its height is the " +
      "measurer's line height, padding and all, not the font's content area; " +
      "and a `sub`/`sup` rect's shift is a fraction of that line rather than of " +
      "the font size, so it moves further than its glyphs do.",
    assert: (result) => {
      const text = nodeText(result, "A");
      expectRows("label runs", labelRuns(text, "class"), [
        "x y ",
        "m[class=siren-label-mark-text]",
      ]);
      const rects = Array.from(
        text?.parentElement?.querySelectorAll("rect.siren-label-mark") ?? [],
      );
      if (rects.length !== 1) {
        throw new Error(`expected one mark rect, got ${rects.length}`);
      }
      const rect = rects[0]!;
      // Behind the text: document order is paint order.
      if (rect.nextElementSibling !== text) {
        throw new Error("the mark rect is not drawn just before the label's <text>");
      }
      // Behind `m`, the last of five characters: wholly right of the centre.
      const centre = Number(text!.getAttribute("x"));
      if (!(Number(rect.getAttribute("x")) > centre && Number(rect.getAttribute("width")) > 0)) {
        throw new Error(
          `the mark rect (x=${rect.getAttribute("x")}, width=${rect.getAttribute("width")}) ` +
            `is not behind the marked run, right of the centre at ${centre}`,
        );
      }
    },
  },
{
    id: "label-font",
    kind: "flowchart",
    source: `flowchart TB
      A["x <font color='red' face='serif' size='5'>f</font>"]`,
    status: "supported",
    meaning:
      "`<font>` keeps `color`, `face` and `size` through Mermaid's sanitizer " +
      "(measured against 11.17.2 with `mermaid-probe.mjs --html`), and the " +
      "browser draws its text in that color and family, at the size the board " +
      "measured inside a Mermaid label: 1–7 are 12 / 13 / 16 / 18 / 20 / 32 / " +
      "48px where the text around them is 16px, so `size=\"5\"` is × 1.25. " +
      "Siren draws the color as the run's fill, the face as its family, and the " +
      "size as that scale of its own.",
    assert: (result) => {
      expectRows("label runs", labelRuns(nodeText(result, "A"), "style", "font-family", "font-size"), [
        "x ",
        "f[style=fill: red][font-family=serif][font-size=1.25em]",
      ]);
    },
  },
  {
    id: "label-span-style",
    kind: "flowchart",
    source: `flowchart TB
      A["x <span style='color:red;background-color:lime;font-size:28px;font-weight:bold;font-style:italic;font-family:serif;text-decoration:line-through;letter-spacing:2px;word-spacing:3px;opacity:0.5'>s</span>"]`,
    status: "supported",
    meaning:
      "`<span style>` keeps its declarations through Mermaid's sanitizer " +
      "(measured against 11.17.2), and the browser draws all of them. Siren " +
      "draws ten properties — these — and warns about any other, naming it " +
      "(a warning has no corpus status, so that half is asserted in " +
      "`label/renderLabel.test.ts`). The background is a rect behind the run, " +
      "as `<mark>`'s is; an absolute size is drawn as written and measured " +
      "against a 14px base; opacity fades the run's fill.",
    assert: (result) => {
      const text = nodeText(result, "A");
      expectRows(
        "label runs",
        labelRuns(
          text,
          "style",
          "font-size",
          "font-weight",
          "font-style",
          "font-family",
          "text-decoration",
          "letter-spacing",
          "word-spacing",
          "fill-opacity",
        ),
        [
          "x ",
          "s[style=fill: red][font-size=28px][font-weight=bold][font-style=italic][font-family=serif]" +
            "[text-decoration=line-through][letter-spacing=2px][word-spacing=3px][fill-opacity=0.5]",
        ],
      );
      const backgrounds = Array.from(text?.parentElement?.querySelectorAll("rect.siren-label-background") ?? []);
      expectRows(
        "background rects",
        backgrounds.map((rect) => `${rect.getAttribute("style")} ${rect.getAttribute("opacity")}`),
        ["fill: lime 0.5"],
      );
    },
  },
  {
    id: "label-link",
    kind: "flowchart",
    source: `flowchart TB
      A["x <a href='https://example.com' onclick='alert(1)'>l</a>"]`,
    status: "supported",
    meaning:
      "`<a href>` with a scheme Mermaid's sanitizer keeps is a link the reader " +
      "can follow, drawn blue `#0000ee` and underlined (measured against " +
      "11.17.2); the sanitizer drops `onclick`. Siren draws an SVG `<a href>` " +
      "around the run, painted with `--siren-label-link`, and ignores every " +
      "attribute but `href`.",
    assert: (result) => {
      const text = nodeText(result, "A");
      expectRows("label runs", labelRuns(text, "class", "text-decoration"), [
        "x ",
        "l[href=https://example.com][class=siren-label-link][text-decoration=underline]",
      ]);
      if (text?.querySelector("[onclick]")) {
        throw new Error("an onclick attribute reached the drawn label");
      }
    },
  },
  {
    id: "label-link-stripped-href",
    kind: "flowchart",
    source: `flowchart TB
      A["x <a href='javascript:alert(1)'>j</a>"]`,
    status: "supported",
    meaning:
      "A `javascript:` (or `data:`, or any scheme outside DOMPurify's list) " +
      "href is stripped by Mermaid's sanitizer, leaving an `<a>` with no href " +
      "(measured against 11.17.2), which the browser draws as plain text — " +
      "black, not underlined. Siren draws plain text, with no `<a>` at all.",
    assert: (result) => {
      const text = nodeText(result, "A");
      expectRows("label runs", labelRuns(text, "class", "text-decoration"), ["x j"]);
      if (text?.querySelector("a") !== null) {
        throw new Error("an <a> was drawn for a stripped href");
      }
    },
  },
  {
    id: "label-link-second-a",
    kind: "flowchart",
    source: `flowchart TB
      A["<a href='x'>1<b>2<a href='y'>3</a>4</b>5"]`,
    status: "supported",
    meaning:
      "An `<a>` start tag closes an `<a>` still open, and the browser's parser " +
      "reopens the formatting tags inside it: Mermaid's label holds " +
      "`<a href=\"x\">1<b>2</b></a><b><a href=\"y\">3</a>4</b>5` (measured " +
      "against 11.17.2). Siren reads it the same way: links do not nest.",
    assert: (result) => {
      expectRows("label runs", labelRuns(nodeText(result, "A"), "font-weight"), [
        "1[href=x]",
        "2[href=x][font-weight=bold]",
        "3[href=y][font-weight=bold]",
        "4[font-weight=bold]",
        "5",
      ]);
    },
  },
  {
    id: "label-mark-inside-link",
    kind: "flowchart",
    source: `flowchart TB
      A["<a href='https://e.x'><mark>m</mark></a>"]`,
    status: "supported",
    meaning:
      "A `<mark>` inside an `<a>`: the browser paints the text with the " +
      "innermost element's color, the mark's black, still underlined and still " +
      "a link, on the mark's yellow (the browser's default stylesheet, as " +
      "Mermaid 11.17.2's HTML labels draw it). Siren draws the run inside its " +
      "`<a href>` with the mark's text class and no color of its own, so " +
      "`--siren-label-mark-text` paints it.",
    assert: (result) => {
      expectRows("label runs", labelRuns(nodeText(result, "A"), "class", "style", "text-decoration"), [
        "m[href=https://e.x][class=siren-label-link siren-label-mark-text][text-decoration=underline]",
      ]);
    },
  },
  {
    id: "label-link-inside-mark",
    kind: "flowchart",
    source: `flowchart TB
      A["<mark><a href='https://e.x'>l</a></mark>"]`,
    status: "supported",
    meaning:
      "An `<a>` inside a `<mark>`: the innermost element is the link, so the " +
      "browser paints the text link blue `#0000ee`, underlined, on the mark's " +
      "yellow (Mermaid 11.17.2's HTML labels). Siren paints the run with an " +
      "inline `var(--siren-label-link)`, which outranks the mark's text class.",
    assert: (result) => {
      expectRows("label runs", labelRuns(nodeText(result, "A"), "class", "style", "text-decoration"), [
        "l[href=https://e.x][class=siren-label-link siren-label-mark-text]" +
          "[style=fill: var(--siren-label-link)][text-decoration=underline]",
      ]);
    },
  },
  {
    id: "label-link-in-clickable-node",
    kind: "flowchart",
    source: `flowchart TB
      A["x <a href='https://in.example'>l</a>"]
      click A href "https://out.example"`,
    status: "supported",
    meaning:
      "A label link in a node that has a `click` link of its own: Mermaid " +
      "wraps the node in an `<a>` and keeps the label's `<a>` inside it " +
      "(measured against 11.17.2), so the label's link works on its own text " +
      "and the node's everywhere else. Siren keeps both.",
    assert: (result) => {
      const outer = result.svg?.querySelector('a[href="https://out.example"]') ?? null;
      const node = outer?.querySelector('g.siren-node[data-siren-id="A"]') ?? null;
      if (node === null) {
        throw new Error("the node is not inside its click link's <a>");
      }
      expectRows("label runs", labelRuns(node.querySelector("text")), ["x ", "l[href=https://in.example]"]);
    },
  },
  {
    id: "label-drawless-tags",
    kind: "flowchart",
    source: `flowchart TB
      A["a<abbr title='t'>b</abbr><time>c</time><nobr>d</nobr><wbr>e<bdi><b>f</b></bdi>"]`,
    status: "supported",
    meaning:
      "The 20 tags with no rendering of their own (`abbr`, `acronym`, `bdi`, " +
      "`bdo`, `data`, `time`, `nobr`, `label`, `output`, `wbr`, `blink`, " +
      "`spacer`, `content`, `decorator`, `element`, `shadow`, `slot`, " +
      "`menuitem`, `map`, `picture`) draw their text and nothing else, and a " +
      "styling tag inside one still draws: DOMPurify keeps each element and " +
      "the browser has no style for it (ADR-0015, measured against 11.17.2). " +
      "Siren used to draw the tags' own characters.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["abcdef(b)"]);
    },
  },
  {
    id: "label-document-tags",
    kind: "flowchart",
    source: `flowchart TB
      A["a<html>b</html><head>c</head><body>d</body><style>s</style>e"]`,
    status: "supported",
    meaning:
      "`<html>`, `<head>` and `<body>` are dropped and their text kept, and " +
      "`<style>` is removed together with its content: inside a label the " +
      "parser ignores the first three, and DOMPurify removes the fourth " +
      "(measured against 11.17.2: `abcde`).",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["abcde"]);
    },
  },
  {
    id: "label-unknown-tags",
    kind: "flowchart",
    source: `flowchart TB
      A["e<foo>f</foo>g<my-el>h</my-el>i<object>j</object>k"]`,
    status: "supported",
    meaning:
      "A tag outside DOMPurify's allow-list is dropped and its text kept: " +
      "Mermaid 11.17.2 draws `efghijk` (measured). Siren used to draw the " +
      "tags' own characters.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["efghijk"]);
    },
  },
  {
    id: "label-removed-with-content",
    kind: "flowchart",
    source: `flowchart TB
      A["a<script>x</script>b<iframe>y</iframe>c<noscript>z</noscript>d<noembed>w</noembed>e<xmp>v</xmp>f"]
      B["g<plaintext>u</plaintext>h"]`,
    status: "supported",
    meaning:
      "`<script>`, `<iframe>`, `<noscript>`, `<noembed>` and `<xmp>` are " +
      "removed together with their content, and `<plaintext>` with everything " +
      "after it, its own end tag included: Mermaid 11.17.2 draws `abcdef` and " +
      "`g` (measured).",
    assert: (result) => {
      expectRows("A's rows", labelRows(nodeText(result, "A")), ["abcdef"]);
      expectRows("B's rows", labelRows(nodeText(result, "B")), ["g"]);
    },
  },
  {
    id: "label-hidden-tags",
    kind: "flowchart",
    source: `flowchart TB
      A["a<template>t</template>b<datalist>d</datalist>c<rp>r</rp>d<source>e<track>f<area>g"]
      B["h<dialog>x</dialog>i"]`,
    status: "supported",
    meaning:
      "Seven tags DOMPurify keeps draw nothing in the browser: `template` is " +
      "inert, a closed `dialog` is hidden, and `datalist`, `rp`, `source`, " +
      "`track` and `area` are `display: none`. Mermaid's picture of each is " +
      "blank, so each is removed with its content, as `title` is (ADR-0015; " +
      "measured against 11.17.2, `--html`: the tags reach the browser as " +
      "written, and a `dialog`, a block, puts `h` and `i` on rows of their own).",
    assert: (result) => {
      expectRows("A's rows", labelRows(nodeText(result, "A")), ["abcdefg"]);
      expectRows("B's rows", labelRows(nodeText(result, "B")), ["h", "i"]);
    },
  },
  {
    id: "label-entity-codes",
    kind: "flowchart",
    source: `flowchart TB
      A["a#quot;b#amp;c#lt;d#gt;e#35;f#9829;g"]
      B["#lt;b#gt;x#lt;/b#gt; #copy; #foo;"]`,
    status: "supported",
    meaning:
      "Mermaid's entity codes resolve to their characters: `#name;` is the " +
      "HTML character reference `&name;` and `#NN;` the code point NN, so A " +
      "draws `a\"b&c<d>e#f♥g`; a code is text, never a tag, and a name the " +
      "HTML standard does not define is drawn as the reference the browser " +
      "was handed, so B draws `<b>x</b> © &foo;` (measured against 11.17.2). " +
      "Siren used to draw the codes' own characters.",
    assert: (result) => {
      expectRows("A's rows", labelRows(nodeText(result, "A")), ['a"b&c<d>e#f\u2665g']);
      expectRows("B's rows", labelRows(nodeText(result, "B")), ["<b>x</b> © &foo;"]);
    },
  },
  {
    id: "label-style-hex-color",
    kind: "flowchart",
    source: `flowchart TB
      A["<span style='color:#0f0;'>x</span>"]`,
    status: "supported",
    meaning:
      "A hex color ending in `;` inside a label's `style` is a color, not the " +
      "entity code `#0f0;`: before it reads codes, Mermaid drops the last `;` " +
      "of a line holding `style`, a `:` and then a `#` (its " +
      "`/style.*:\\S*#.*;/`), and hands the browser `style=\"color:#0f0\"` " +
      "(measured against 11.17.2).",
    assert: (result) => {
      expectRows("label runs", labelRuns(nodeText(result, "A"), "style"), ["x[style=fill: #0f0]"]);
    },
  },
  {
    id: "label-invalid-color",
    kind: "flowchart",
    source: `flowchart TB
      A["x <span style='background-color: banana'>y</span><font color='banana'>z</font>"]`,
    status: "supported",
    meaning:
      "A `color` or `background-color` that is not CSS color syntax is a " +
      "declaration the browser drops, so Mermaid paints nothing for it. Siren " +
      "reads it as unwritten too: no background rect and no fill — where it " +
      "used to hand `banana` to SVG, which paints an unreadable color as " +
      "black and so hid the text behind a black rect.",
    assert: (result) => {
      const text = nodeText(result, "A");
      expectRows("label rows", labelRows(text), ["x yz"]);
      expectRows(
        "background rects",
        Array.from(text?.parentElement?.querySelectorAll("rect.siren-label-background") ?? [], (rect) =>
          String(rect.getAttribute("style")),
        ),
        [],
      );
    },
  },
  {
    id: "label-unterminated-tag",
    kind: "flowchart",
    source: `flowchart TB
      A["x <y"]
      B["a < b"]`,
    status: "supported",
    meaning:
      "A `<` followed by a letter opens a tag, and a tag the label ends inside " +
      "is dropped with everything after its `<`, as the HTML tokenizer drops " +
      "it: Mermaid 11.17.2 draws `x ` (measured `<p>x </p>`). A `<` before " +
      "anything else is a character, so `a < b` is drawn as written.",
    assert: (result) => {
      expectRows("A's rows", labelRows(nodeText(result, "A")), ["x "]);
      expectRows("B's rows", labelRows(nodeText(result, "B")), ["a < b"]);
    },
  },
  {
    id: "label-block",
    kind: "flowchart",
    source: `flowchart TB
      A["a<div>b</div><p>c</p><hr>d<marquee>m</marquee>"]`,
    status: "supported",
    meaning:
      "A block tag (`p`, `div`, `hr`, `marquee` and the rest of the 34) begins " +
      "and ends a row: Mermaid's label is `<p>a</p><div>b</div><p>c</p><hr>d" +
      "<marquee>m</marquee>` (measured against 11.17.2), five of the browser's " +
      "lines. Approximated (ADR-0015): Siren draws each block's lines as rows, " +
      "with no empty row where two block edges meet, but not its margins or " +
      "indent, not the rule `<hr>` draws, and `<marquee>` stands still; " +
      "`<center>`'s text is not centred, and where a formatting tag's end tag " +
      "misnests across a block the HTML parser's adoption agency is applied " +
      "only to the text after it (`<b>a<sub>s<div>b</b>…`'s `b` is still " +
      "`sub`, where the parser takes it off). Siren used to drop the tags and " +
      "draw `abcdm` on one row.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["a", "b", "c", "d", "m"]);
    },
  },
  {
    id: "label-heading",
    kind: "flowchart",
    source: `flowchart TB
      A["<h1>T</h1>x<pre>c</pre><address>a</address>"]`,
    status: "supported",
    meaning:
      "A block keeps its own font: `h1`…`h6` are bold at × 2 / 1.5 / 1.17 / 1 / " +
      "0.83 / 0.67 of the size around them, `pre` is monospace and keeps its " +
      "spaces, and `address` is italic (measured against 11.17.2). Siren draws " +
      "each on rows of its own; a heading's margins are not drawn.",
    assert: (result) => {
      expectRows(
        "label runs",
        labelRuns(nodeText(result, "A"), "font-weight", "font-size", "font-family", "font-style"),
        ["T[font-weight=bold][font-size=2em]", "x", "c[font-family=monospace]", "a[font-style=italic]"],
      );
    },
  },
  {
    id: "label-list",
    kind: "flowchart",
    source: `flowchart TB
      A["<ul><li>a</li><li>b</li></ul><ol><li>c</li><li>d</li></ol>"]`,
    status: "supported",
    meaning:
      "A list item begins with its marker: a bullet in a `ul` (and `menu`, " +
      "`dir`), its number in an `ol`, each `ol` counting from 1 unless it says " +
      "otherwise (measured against 11.17.2). Approximated (ADR-0015): Siren " +
      "writes the marker as text at the start of the item's row, `• ` or `1. `, " +
      "and draws neither the 40px indent nor a nested list's own indent. An " +
      "`li` outside any list is bulleted too. Not drawn: `type` on a `ul` or " +
      "`li` (Siren keeps the bullet its depth gives).",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["\u2022 a", "\u2022 b", "1. c", "2. d"]);
    },
  },
  {
    id: "label-list-numbering",
    kind: "flowchart",
    source: `flowchart TB
      A["<ol start='3'><li>a<li value='7'>b<li>c</ol>"]`,
    status: "supported",
    meaning:
      "DOMPurify keeps `<ol start>` and `<li value>` (measured against 11.17.2), " +
      "and the browser numbers from them, read as HTML integers: `start` is " +
      "the first item's number, `value` an item's own, and the items after it " +
      "count on from it, so this list is `3.`, `7.`, `8.`. Not drawn: " +
      "`reversed` (Siren still counts up) and `type` on an `ol` or `li` " +
      "(Siren still writes decimal numbers), both of which DOMPurify keeps.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["3. a", "7. b", "8. c"]);
    },
  },
  {
    id: "label-list-nested",
    kind: "flowchart",
    source: `flowchart TB
      A["<ul><li>a<ul><li>b<ul><li>c</ul></ul></ul>"]`,
    status: "supported",
    meaning:
      "A nested bulleted list takes the browser's default bullet for its " +
      "depth: `•` (disc), `◦` (circle) inside one list (a `ul` or an `ol`), " +
      "`▪` (square) inside two or more, as the browser's default stylesheet " +
      "says. Approximated (ADR-0015): neither list's indent is drawn.",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["\u2022 a", "\u25e6 b", "\u25aa c"]);
    },
  },
  // ADR-0015's refused layers, one row each for a table, ruby, `<img>` and a
  // form control. Each is HTML Mermaid draws and SVG text cannot, so Siren
  // reports an error at the tag rather than drawing its text without it.
  {
    id: "label-table-rejected",
    kind: "flowchart",
    source: `flowchart TB
      A["<table><tr><td>a</td><td>b</td></tr></table>"]`,
    status: "rejected",
    meaning:
      "DOMPurify keeps a table, and Mermaid draws its cells side by side " +
      "(measured against 11.17.2, `--html`: `<table><tbody><tr><td>a</td>…`). " +
      "SVG text has no table layout, so a table is refused at `<table>` (ADR-0015).",
  },
  {
    id: "label-stray-table-part",
    kind: "flowchart",
    source: `flowchart TB
      A["a<td>x</td>b<col>c"]`,
    status: "supported",
    meaning:
      "Outside a `table` the HTML parser ignores a table part's start and end " +
      "tags (`tr`, `td`, `th`, `thead`, `tbody`, `tfoot`, `caption`, `col`, " +
      "`colgroup`), so the tag is dropped and its text kept: Mermaid 11.17.2 " +
      "draws `a<td>x</td>b` as `axb` and `a<col>b` as `ab` (measured, " +
      "`--html`). Only `table` itself is refused (ADR-0015).",
    assert: (result) => {
      expectRows("label rows", labelRows(nodeText(result, "A")), ["axbc"]);
    },
  },
  {
    id: "label-ruby-rejected",
    kind: "flowchart",
    source: `flowchart TB
      A["<ruby>漢<rt>kan</rt></ruby>"]`,
    status: "rejected",
    meaning:
      "DOMPurify keeps `ruby` and `rt` (measured against 11.17.2, `--html`), " +
      "and Mermaid draws the annotation small above its base text. SVG text " +
      "cannot place one run over another, so ruby is refused (ADR-0015); `rp` " +
      "is hidden, and removed with its content.",
  },
  {
    id: "label-img-rejected",
    kind: "flowchart",
    source: `flowchart TB
      A["a <img src='https://example.com/x.png'> b"]`,
    status: "rejected",
    meaning:
      "DOMPurify keeps `<img>` with its `src` (measured against 11.17.2), and " +
      "Mermaid draws the image inside the label. Refused (ADR-0015), with a " +
      'diagnostic naming Mermaid\'s own image shape, `A@{ img: "…" }`, which ' +
      "draws an image as a node rather than inside its text.",
  },
  {
    id: "label-form-control-rejected",
    kind: "flowchart",
    source: `flowchart TB
      A["name <input> <button>go</button>"]`,
    status: "rejected",
    meaning:
      "DOMPurify keeps form controls (measured against 11.17.2, `--html`: " +
      "`<input>` and `<button>go</button>` reach the browser as written), and " +
      "Mermaid draws a text box and a button. SVG text draws neither, so the " +
      "form controls are refused with the rest of the embedded, form, media " +
      "and interactive layer (ADR-0015).",
  },
];
