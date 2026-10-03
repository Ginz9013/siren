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
];
