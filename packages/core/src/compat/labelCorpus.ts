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
 */
function labelRuns(text: Element | null, ...attributes: string[]): string[] {
  if (text === null) {
    return [];
  }
  const runs = Array.from(text.querySelectorAll(":scope > tspan.siren-label-row > tspan"));
  if (runs.length === 0) {
    return [text.textContent ?? ""];
  }
  return runs.map(
    (run) =>
      (run.textContent ?? "") +
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
];
