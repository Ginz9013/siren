import { describe, expect, it, vi } from "vitest";
import { parseFlowchart } from "./parseFlowchart";
import { parseSiren } from "./parseSiren";
import type { Diagnostic, DiagramParseResult, FlowchartDocument, NodeShape, SirenNode } from "../contracts";
import { plainLabel, plainRun } from "../label/label";

/**
 * Asserts a `parseFlowchart` call (or `parse`'s, when given) produced a
 * document and narrows it to `FlowchartDocument`, so tests can read
 * flowchart fields without repeating the null check.
 */
function parseOk(
  source: string,
  parse: (source: string) => DiagramParseResult = parseFlowchart,
): { document: FlowchartDocument; diagnostics: Diagnostic[] } {
  const { document, diagnostics } = parse(source);
  if (document === null || document.kind !== "flowchart") {
    throw new Error(
      `expected a flowchart document, got ${document === null ? "null" : document.kind}` +
        ` (diagnostics: ${JSON.stringify(diagnostics)})`,
    );
  }
  return { document, diagnostics };
}

/**
 * The ticket's test-only input for the one thing no real tag can exercise
 * yet: how a problem `readLabel` reports becomes a diagnostic. `readLabel`
 * is the real one, delegated to unchanged, except that a `⚠` in a label's
 * source is reported as an error at that character and a `⚑` as a warning —
 * so where the diagnostic lands can be checked against where the author
 * wrote the character, in every position a flowchart label can be written.
 * No real label contains either, so every other test in this file reads
 * labels exactly as production does.
 */
vi.mock("../label/readLabel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../label/readLabel")>();
  return {
    ...actual,
    readLabel: (...args: Parameters<typeof actual.readLabel>) => {
      const read = actual.readLabel(...args);
      const [source] = args;
      const problems = [...read.problems];
      for (const [mark, severity] of [["⚠", "error"], ["⚑", "warning"]] as const) {
        for (let at = source.indexOf(mark); at !== -1; at = source.indexOf(mark, at + 1)) {
          problems.push({ severity, message: `test problem ${mark}`, offset: at });
        }
      }
      return { ...read, problems };
    },
  };
});

/** Each diagnostic as `severity line:column`, for the position tests below. */
function positions(source: string, parse: (source: string) => DiagramParseResult = parseFlowchart): string[] {
  return parse(source).diagnostics.map((d) => `${d.severity} ${d.line}:${d.column}`);
}

describe("a problem in a label, reported where the author wrote it", () => {
  it("points into a node's label, counting the bracket and the quote fence", () => {
    // `  A[ab⚠c]` — the ⚠ is the 7th character of line 2.
    expect(positions("flowchart TB\n  A[ab⚠c]")).toEqual(["error 2:7"]);
    // `  A[" ab⚠"]` — past the quote fence and the padding it trims.
    expect(positions('flowchart TB\n  A[" ab⚠"]')).toEqual(["error 2:9"]);
  });

  it("points at the right endpoint when several on one line carry a label", () => {
    // `  A[⚠] --> B[x⚠] & C(⚠)`
    expect(positions("flowchart TB\n  A[⚠] --> B[x⚠] & C(⚠)")).toEqual([
      "error 2:5",
      "error 2:15",
      "error 2:22",
    ]);
  });

  it("points into the second statement of a line, not the first", () => {
    // `  A[a]; B[⚠]`
    expect(positions("flowchart TB\n  A[a]; B[⚠]")).toEqual(["error 2:11"]);
  });

  it("points into an edge label, in both spellings", () => {
    // `  A -->|"x⚠"| B` and `  A -- y⚠ --> B`
    expect(positions('flowchart TB\n  A -->|"x⚠"| B')).toEqual(["error 2:11"]);
    expect(positions("flowchart TB\n  A -- y⚠ --> B")).toEqual(["error 2:9"]);
  });

  it("points into a subgraph title, in each spelling that can carry a tag", () => {
    // `  subgraph S["a⚠"]` and `  subgraph "b⚠"`
    expect(positions('flowchart TB\n  subgraph S["a⚠"]\n    A\n  end')).toEqual(["error 2:16"]);
    expect(positions('flowchart TB\n  subgraph "b⚠"\n    A\n  end')).toEqual(["error 2:14"]);
  });

  it("points at the physical line a Markdown string's fence carried the problem onto", () => {
    // The fence opens on line 2 and closes on line 3; `li⚠ne2` is line 3.
    expect(positions('flowchart TB\n  A["`line1\nli⚠ne2`"]')).toEqual(["error 3:3"]);
  });

  it("refuses the document for an error and draws it for a warning", () => {
    expect(parseFlowchart("flowchart TB\n  A[a⚠]").document).toBeNull();

    const warned = parseFlowchart("flowchart TB\n  A[a⚑]");
    expect(warned.document).not.toBeNull();
    expect(warned.diagnostics).toEqual([
      { severity: "warning", message: "test problem ⚑", line: 2, column: 6 },
    ]);
  });
});

describe("a flowchart node's label", () => {
  it("trims the padding around a label, whether or not it is quoted", () => {
    const source = `flowchart TB
  A[  padded  ] --> B["  padded  "]`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.label.text)).toEqual(["padded", "padded"]);
  });
});

/**
 * A bracket character inside an unquoted node label. Measured on Mermaid
 * 12.2.0: every one of `( ) [ ] { }` written unquoted inside any shape's
 * label is a parse error (`A[a]b]`, `A(a)b)`, `A{a]b}`, `A[a}b]`,
 * `A[[a]b]]`, `A>a{b]` …), and the quoted label (`A("a)b")`) is drawn.
 */
describe("a bracket character inside an unquoted node label", () => {
  it.each([
    ["A(a)b)", ")", 6, 'A("a)b")'],
    ["A[a]b]", "]", 6, 'A["a]b"]'],
    ["A{a}b}", "}", 6, 'A{"a}b"}'],
    ["A((a(b))", "(", 7, 'A(("a(b"))'],
    // Measured: "got 'DIAMOND_START'" — an `@{` inside a label is a brace
    // there, not the `@{ … }` node syntax.
    ["A{a@{b}}", "{", 7, 'A{"a@{b}"}'],
  ])("refuses %s at the bracket, saying to quote the label", (written, char, column, fixed) => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB\n  ${written}`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: `A node label without quotes cannot hold "${char}". Put the whole label in quotes: ${fixed}`,
        line: 2,
        column,
      },
    ]);
  });

  it.each([
    ["A[a}b]", "}", 6, 'A["a}b"]'],
    ["A[a{b]", "{", 6, 'A["a{b"]'],
    ["A[a[b]", "[", 6, 'A["a[b"]'],
    ["A{a]b}", "]", 6, 'A{"a]b"}'],
    ["A{a[b}", "[", 6, 'A{"a[b"}'],
    ["A>a{b]", "{", 6, 'A>"a{b"]'],
    ["A[[a}b]]", "}", 7, 'A[["a}b"]]'],
    ["A{{a]b}}", "]", 7, 'A{{"a]b"}}'],
  ])("refuses %s, a square bracket or brace that is not the shape's own, which used to be drawn", (written, char, column, fixed) => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB\n  ${written}`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: `A node label without quotes cannot hold "${char}". Put the whole label in quotes: ${fixed}`,
        line: 2,
        column,
      },
    ]);
  });
  /**
   * Parentheses are the one exception, and only when they pair up: an
   * unquoted `(` or `)` is refused by Mermaid too, but Siren keeps drawing a
   * balanced pair in a label (nook 01M4R3RVV), so only one with no partner
   * is refused here.
   */
  it.each([
    ["A[a)b]", ")", 6, 'A["a)b"]'],
    ["A[a(b]", "(", 6, 'A["a(b"]'],
    ["A{a)b}", ")", 6, 'A{"a)b"}'],
    ["A>a)b]", ")", 6, 'A>"a)b"]'],
    ["A[a (b) (c]", "(", 11, 'A["a (b) (c"]'],
    ["A[(a)b)]", ")", 7, 'A[("a)b")]'],
  ])("refuses %s, a parenthesis with no partner, which used to be drawn", (written, char, column, fixed) => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB\n  ${written}`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: `A node label without quotes cannot hold "${char}". Put the whole label in quotes: ${fixed}`,
        line: 2,
        column,
      },
    ]);
  });

  it.each([
    ["A[f(x)]", "rect"],
    ["A>f(x)]", "asymmetric"],
    ["A[[f(x)]]", "subroutine"],
    ["A([f(x)])", "stadium"],
    ["A[/f(x)/]", "parallelogram"],
    ["A{f(x)}", "rhombus"],
    ["A{{f(x)}}", "hexagon"],
    // A cylinder is a `[`-family spelling too; this used to be drawn as the
    // rect `(f(x))`, a shape nobody wrote.
    ["A[(f(x))]", "cylinder"],
  ])("still draws %s, whose parentheses pair up", (written, shape) => {
    const { document, diagnostics } = parseOk(`flowchart TB\n  ${written}`);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.label.text, node.shape])).toEqual([["f(x)", shape]]);
  });

  it.each([
    ["A[a}b] --> B", "}", 6, 'A["a}b"]'],
    ["A --> B{a)b}", ")", 12, 'B{"a)b"}'],
    ["A & B[a]b] --> C", "]", 10, 'B["a]b"]'],
  ])("refuses %s at an edge endpoint the same way", (written, char, column, fixed) => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB\n  ${written}`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: `A node label without quotes cannot hold "${char}". Put the whole label in quotes: ${fixed}`,
        line: 2,
        column,
      },
    ]);
  });

  it.each([["A[x] B[y]"], ["A{x} B{y}"], ["A[x] B[y] --> C"]])(
    "offers no quoting fix for %s, which would merge two nodes into one label",
    (written) => {
      // Measured: Mermaid 12.2.0 refuses `A[x] B[y]` ("got 'NODE_STRING'"):
      // the first `]` ends `A`'s label, so `B[y]` is a second node written
      // where none may stand, not text of the first.
      const { document, diagnostics } = parseFlowchart(`flowchart TB\n  ${written}`);

      expect(document).toBeNull();
      expect(diagnostics).toEqual([
        { severity: "error", message: `Unrecognized flowchart line: "${written}"`, line: 2, column: 3 },
      ]);
    },
  );
});

/**
 * The `@{ … }` node data block. Measured on Mermaid 12.2.0 (`pnpm --filter
 * siren-core probe`): each of these 45 names is accepted as `shape:` and
 * drawn with the handler that its bracket spelling draws (Mermaid's own
 * `shapesDefs` table), so each is one of Siren's fourteen shapes.
 */
const NODE_DATA_SHAPES: ReadonlyArray<[string, NodeShape]> = [
  ...(["rect", "proc", "process", "rectangle"] as const).map((name) => [name, "rect"] as [string, NodeShape]),
  ...(["rounded", "event"] as const).map((name) => [name, "round"] as [string, NodeShape]),
  ...(["stadium", "terminal", "pill"] as const).map((name) => [name, "stadium"] as [string, NodeShape]),
  ...(["fr-rect", "subprocess", "subproc", "framed-rectangle", "subroutine"] as const).map(
    (name) => [name, "subroutine"] as [string, NodeShape],
  ),
  ...(["cyl", "db", "database", "cylinder"] as const).map((name) => [name, "cylinder"] as [string, NodeShape]),
  ...(["circle", "circ"] as const).map((name) => [name, "circle"] as [string, NodeShape]),
  ...(["diam", "decision", "diamond", "question"] as const).map((name) => [name, "rhombus"] as [string, NodeShape]),
  ...(["hex", "hexagon", "prepare"] as const).map((name) => [name, "hexagon"] as [string, NodeShape]),
  ...(["lean-r", "lean-right", "in-out"] as const).map((name) => [name, "parallelogram"] as [string, NodeShape]),
  ...(["lean-l", "lean-left", "out-in"] as const).map((name) => [name, "parallelogram-alt"] as [string, NodeShape]),
  ...(["trap-b", "priority", "trapezoid-bottom", "trapezoid"] as const).map(
    (name) => [name, "trapezoid"] as [string, NodeShape],
  ),
  ...(["trap-t", "manual", "trapezoid-top", "inv-trapezoid"] as const).map(
    (name) => [name, "trapezoid-alt"] as [string, NodeShape],
  ),
  ...(["dbl-circ", "double-circle", "doublecircle"] as const).map((name) => [name, "double-circle"] as [string, NodeShape]),
  ["odd", "asymmetric"],
];

describe("a node written with `@{ … }`", () => {
  it("knows all 45 shape names", () => {
    expect(NODE_DATA_SHAPES).toHaveLength(45);
  });

  it.each(NODE_DATA_SHAPES)("draws `shape: %s` as the %s shape, labelled with its id", (name, shape) => {
    const { document, diagnostics } = parseOk(`flowchart TB\n  A@{ shape: ${name} }`);

    expect(diagnostics).toEqual([]);
    expect(document.nodes).toEqual([{ id: "A", label: plainLabel("A"), shape, line: 2, column: 3 }]);
  });
});

/**
 * The `label:` of an `@{ … }` block. Measured on Mermaid 12.2.0: the label
 * is a Markdown label unless `labelType` is `text` or `string` (`**b**` is
 * bold in `A@{ label: "**b**" }` and literal in `A["**b**"]`), and its
 * value is a YAML string, so `\"` is a quote.
 */
describe("the label of a node written with `@{ … }`", () => {
  it("draws `label:` as the node's text, beside the shape", () => {
    const { document, diagnostics } = parseOk('flowchart TB\n  A@{ shape: circle, label: "Start here" }');

    expect(diagnostics).toEqual([]);
    expect(document.nodes).toEqual([
      { id: "A", label: plainLabel("Start here"), shape: "circle", line: 2, column: 3 },
    ]);
  });

  it("reads the label as Markdown, as a backtick-fenced bracket label is", () => {
    const { document, diagnostics } = parseOk('flowchart TB\n  A@{ label: "**b** x" }');

    expect(diagnostics).toEqual([]);
    expect(markdownRows(document.nodes[0])).toEqual([
      [
        { text: "b", bold: true, italic: false },
        { text: " x", bold: false, italic: false },
      ],
    ]);
  });

  it.each(["text", "string"])("reads it as written in brackets when `labelType` is %s", (labelType) => {
    const { document, diagnostics } = parseOk(`flowchart TB\n  A@{ label: "**b**", labelType: ${labelType} }`);

    expect(diagnostics).toEqual([]);
    expect(document.nodes[0]?.label).toEqual(plainLabel("**b**"));
  });

  it("breaks the label at a `<br>`, and reads a YAML-escaped quote as a quote", () => {
    const { document, diagnostics } = parseOk(
      'flowchart TB\n  A@{ label: "a<br>b" }\n  B@{ label: "say \\"hi\\"" }',
    );

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.label.text)).toEqual(["a\nb", 'say "hi"']);
  });

  it("reports a problem in the label at the node's `@`", () => {
    expect(positions('flowchart TB\n  Ab@{ label: "x⚠" }')).toEqual(["error 2:5"]);
  });
});

/**
 * Where an `@{ … }` block may be written, measured on Mermaid 12.2.0: at
 * either end of an edge and in an `&` group, its text cut as a whole (an
 * unquoted `(` or an arrow inside it is YAML, not a line's punctuation);
 * after a bracket and after `:::name`; and on a node written before, whose
 * text it keeps unless it gives a label of its own.
 */
describe("where a node's `@{ … }` block may be written", () => {
  it("reads a block at either end of an edge and in a group, its text cut whole", () => {
    const { document, diagnostics } = parseOk(
      "flowchart TB\n  A@{ shape: circle, label: f(x } --> B@{ shape: hex, label: a --> b } & C",
    );

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label.text, node.shape])).toEqual([
      ["A", "f(x", "circle"],
      ["B", "a --> b", "hexagon"],
      ["C", "C", "rect"],
    ]);
    expect(document.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["A", "B"],
      ["A", "C"],
    ]);
  });

  it("changes the shape of a node written before and keeps its text", () => {
    const { document, diagnostics } = parseOk(
      "flowchart TB\n  A[hello] --> B\n  A@{ shape: circle }\n  B@{ shape: diam }\n  B@{ label: two }",
    );

    expect(diagnostics).toEqual([]);
    expect(document.nodes).toEqual([
      { id: "A", label: plainLabel("hello"), shape: "circle", line: 2, column: 3 },
      { id: "B", label: plainLabel("two"), shape: "rhombus", line: 2, column: 3 },
    ]);
  });

  it("reads a block after a bracket and after `:::name`", () => {
    const { document, diagnostics } = parseOk(
      "flowchart TB\n  A[t]@{ shape: circle }\n  B[t]:::hot@{ shape: hex } --> C:::hot@{ label: u }",
    );

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label.text, node.shape])).toEqual([
      ["A", "t", "circle"],
      ["B", "t", "hexagon"],
      ["C", "u", "rect"],
    ]);
    expect(document.styles.map((style) => [style.targetIds, style.name])).toEqual([
      [["B"], "hot"],
      [["C"], "hot"],
    ]);
  });
});

/**
 * An `@{ … }` block written across lines. Measured on Mermaid 12.2.0: a
 * block holding a line break is read as block YAML, and a line break
 * inside a quoted string, with the indentation after it, is a `<br/>`.
 */
describe("a node's `@{ … }` block written across lines", () => {
  it("reads a block of YAML lines, and the statements after it at their own lines", () => {
    const { document, diagnostics } = parseOk(
      'flowchart TB\n  A@{\n    shape: circle\n    label: "multi"\n  }\n  B --> C',
    );

    expect(diagnostics).toEqual([]);
    expect(document.nodes).toEqual([
      { id: "A", label: plainLabel("multi"), shape: "circle", line: 2, column: 3 },
      { id: "B", label: plainLabel("B"), shape: "rect", line: 6, column: 3 },
      { id: "C", label: plainLabel("C"), shape: "rect", line: 6, column: 3 },
    ]);
  });

  it("breaks a quoted label written across lines into rows", () => {
    const { document, diagnostics } = parseOk('flowchart TB\n  A@{ shape: hex, label: "a\n      b" } --> B');

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label.text, node.shape])).toEqual([
      ["A", "a\nb", "hexagon"],
      ["B", "B", "rect"],
    ]);
  });

  it("reports a problem in a block's label at its `@`, on the line the block opens", () => {
    expect(positions('flowchart TB\n  A --> Bc@{\n    label: "x⚠"\n  }')).toEqual(["error 2:11"]);
  });
});

/** The fourteen short names a refused `shape:` is told to choose from, in that order. */
const SHAPE_CHOICES = "rect, rounded, stadium, fr-rect, cyl, circle, diam, hex, lean-r, lean-l, trap-b, trap-t, dbl-circ, odd";

/**
 * A `shape:` Siren does not draw. Measured on Mermaid 12.2.0: it draws
 * `cloud`, `datastore` and the rest of its 39 documented shapes Siren has
 * no geometry for, and the undocumented `state`, `choice`, `note`,
 * `composite`, `icon` and `anchor`; it refuses `foo` ("No such shape"),
 * and any name with an upper-case letter or a `_` ("Shape names should be
 * lowercase"); `shape: 1` throws.
 */
describe("a `shape:` Siren does not draw", () => {
  it.each(["cloud", "datastore", "data-store", "doc", "lin-cyl", "state", "choice", "note", "composite", "icon", "anchor"])(
    "refuses `shape: %s` at the `@`, as a shape not drawn yet",
    (name) => {
      const { document, diagnostics } = parseFlowchart(`flowchart TB\n  A --> Bc@{ shape: ${name} }`);

      expect(document).toBeNull();
      expect(diagnostics).toEqual([
        {
          severity: "error",
          message: `Siren does not draw the shape "${name}" yet. Use one of: ${SHAPE_CHOICES}`,
          line: 2,
          column: 11,
        },
      ]);
    },
  );

  it.each([
    ["foo", `There is no shape "foo". Use one of: ${SHAPE_CHOICES}`],
    ["Rect", 'There is no shape "Rect". Shape names are lower-case, with "-" between words: rect'],
    ["lean_right", 'There is no shape "lean_right". Shape names are lower-case, with "-" between words: lean-right'],
    [
      "squareRect",
      `There is no shape "squareRect". Shape names are lower-case, with "-" between words. Use one of: ${SHAPE_CHOICES}`,
    ],
    ["1", 'A shape is a name, such as "shape: circle"'],
  ])("refuses `shape: %s` as no shape", (name, message) => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB\n  A@{ shape: ${name} }`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([{ severity: "error", message, line: 2, column: 4 }]);
  });
});

/**
 * The keys of an `@{ … }` block other than `shape`, `label` and
 * `labelType`. Measured on Mermaid 12.2.0: `icon`, `img`, `form`, `pos`,
 * `w`, `h` and `constraint` change what a node draws (an icon or image
 * node, its size); any other key is read and ignored (`A@{ foo: 1 }` is a
 * plain node). What is not YAML is refused ("missed comma between flow
 * collection entries").
 */
describe("the other keys of a node's `@{ … }` block", () => {
  it.each(["icon", "img", "form", "pos", "w", "h", "constraint"])("refuses `%s` at the `@`, as not supported yet", (key) => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB\n  A@{ shape: circle, ${key}: x }`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: `Siren does not support "${key}" in a node's "@{ … }" block yet. Leave it out`,
        line: 2,
        column: 4,
      },
    ]);
  });

  it("ignores a key it does not know, with a warning at the `@`", () => {
    const { document, diagnostics } = parseOk("flowchart TB\n  A@{ foo: 1, shape: hex }");

    expect(document.nodes.map((node) => [node.id, node.shape])).toEqual([["A", "hexagon"]]);
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message: `"foo" is not a key of a node's "@{ … }" block, and is ignored. Remove it`,
        line: 2,
        column: 4,
      },
    ]);
  });

  it.each([
    ["A@{ shape: circle label: x }", "missed comma between flow collection entries"],
    ["A@{ shape: [circle }", "missed comma between flow collection entries"],
  ])("refuses %s, which is not YAML, at the `@`", (written, reason) => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB\n  ${written}`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      { severity: "error", message: `The "@{ … }" block is not valid YAML (${reason})`, line: 2, column: 4 },
    ]);
  });

  it.each([
    ["A@{\n    - circle\n  }", 'Write the "@{ … }" block as "key: value" pairs, such as "shape: circle"'],
    ["A@{ label: [a, b] }", 'A label is text, such as "label: Start"'],
  ])("refuses %j, at the `@`", (written, message) => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB\n  ${written}`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([{ severity: "error", message, line: 2, column: 4 }]);
  });
});

describe("a node written with `@{ … }`, in a whole document", () => {
  it("is a node a timeline can name, its block read through the document's comments and tags", () => {
    const { document, diagnostics } = parseOk(
      'flowchart TB\n  %% a comment\n  A@{\n    shape: db\n    label: "<b>Store</b>"\n  } --> B@{ shape: circle }\ntimeline:\n  enter A fade\n  enter B fade',
      parseSiren,
    );

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label.text, node.shape])).toEqual([
      ["A", "Store", "cylinder"],
      ["B", "B", "circle"],
    ]);
    expect(document.timeline?.entries.map((entry) => [entry.step, entry.targetId])).toEqual([
      [1, "A"],
      [2, "B"],
    ]);
  });
});

/**
 * An `@{ … }` block written where it cannot stand. Measured on Mermaid
 * 12.2.0: `A[x] @{ … }` (a space before the `@`), `A@{ … }:::c`,
 * `A@{ … } x` and `A@{ … }@{ … }` (two blocks, read as one: "missed comma")
 * are refused; a block never closed reads to the end of the document; and
 * a subgraph's id given a block draws nothing of it (`subgraph S@{ … }` is
 * a parse error, and `S@{ … }` beside `subgraph S` is the frame's data).
 */
describe("an `@{ … }` block written where it cannot stand", () => {
  it.each([
    ["A[x] @{ shape: circle }", 'Write "@{" right after the node, with no space: A[x]@{ shape: circle }', 8],
    ["A@{ shape: circle }:::c --> B", 'Write ":::c" before the "@{ … }" block: A:::c@{ shape: circle }', 22],
    [
      "A@{ shape: circle }@{ label: x }",
      'A node takes one "@{ … }" block. Write all its keys in the first, separated by ","',
      22,
    ],
    ["A@{ shape: circle } x", 'Nothing may follow a node\'s "@{ … }" block: "x"', 23],
    ["B --> A@{ shape: circle }x", 'Nothing may follow a node\'s "@{ … }" block: "x"', 28],
  ])("refuses %s", (written, message, column) => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB\n  ${written}`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([{ severity: "error", message, line: 2, column }]);
  });

  it("reads a block never closed in time linear in the lines after it", () => {
    // A guard against joining line by line and rescanning the joined text
    // each time: quadratic, 30,000 lines take seconds; linear, milliseconds.
    const source = `flowchart TB\n  A@{ shape: circle\n${"  B --> C\n".repeat(30_000)}`;

    const started = performance.now();
    const { diagnostics } = parseFlowchart(source);
    const elapsed = performance.now() - started;

    expect(diagnostics.map((d) => d.message)).toEqual(['The "@{" is never closed. End the block with "}"']);
    expect(elapsed).toBeLessThan(1000);
  });

  it("leaves a group with no arrow (`A@{ … } & B`) to the error a bare `A & B` gets", () => {
    // Mermaid 12.2.0 draws both nodes; a group with no arrow is its own
    // ticket, and until then the line is not told to lose its `& B`.
    const { document, diagnostics } = parseFlowchart("flowchart TB\n  A@{ shape: circle } & B");

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      { severity: "error", message: 'Unrecognized flowchart line: "A@{ shape: circle } & B"', line: 2, column: 3 },
    ]);
  });

  it("refuses a block never closed at its `@`, and reads nothing after it", () => {
    const { document, diagnostics } = parseFlowchart("flowchart TB\n  A@{ shape: circle\n  B --> C");

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      { severity: "error", message: 'The "@{" is never closed. End the block with "}"', line: 2, column: 4 },
    ]);
  });

  it.each([
    ["after the block", "flowchart TB\n  subgraph S\n    A\n  end\n  B --> S@{ shape: circle }", 5, 10],
    ["before the block", "flowchart TB\n  S@{ shape: circle }\n  subgraph S\n    A\n  end", 2, 4],
  ])("refuses a block on a subgraph's id written %s", (_, source, line, column) => {
    const { document, diagnostics } = parseFlowchart(source);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: '"S" is a subgraph, and a subgraph takes no "@{ … }" block. Leave the block out',
        line,
        column,
      },
    ]);
  });

  it("refuses a block on the line that opens a subgraph", () => {
    const { document, diagnostics } = parseFlowchart("flowchart TB\n  subgraph S@{ shape: circle }\n    A\n  end");

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'A subgraph takes no "@{ … }" block. Leave the block out: subgraph S',
        line: 2,
        column: 13,
      },
    ]);
  });
});

/**
 * An `@{` that stands where no node is written is text, and opens no block
 * that could run on into the lines below. Measured on Mermaid 12.2.0:
 * `A -- x@{y --> B` ⏎ `C` draws A, B and C, the edge labelled `x@{y`.
 */
describe("an `@{` written where no node is", () => {
  it("is text in an arrow's own label, and the lines after it are read on their own", () => {
    const { document, diagnostics } = parseOk("flowchart TB\n  A -- x@{y --> B\n  C --> D\n  E");

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.line])).toEqual([
      ["A", 2],
      ["B", 2],
      ["C", 3],
      ["D", 3],
      ["E", 4],
    ]);
    expect(document.edges.map((edge) => [edge.from, edge.to, edge.label?.text ?? null])).toEqual([
      ["A", "B", "x@{y"],
      ["C", "D", null],
    ]);
  });

  it("opens no block inside a `|label|`, so the line after it is read on its own", () => {
    // Mermaid 12.2.0 refuses a brace in a `|label|` ("got 'DIAMOND_START'"),
    // which Siren draws as text, `@{` or not; what this pins is only that
    // the next line is not swallowed.
    const { document, diagnostics } = parseOk("flowchart TB\n  A -->|mail@{x| B\n  C");

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.line])).toEqual([
      ["A", 2],
      ["B", 2],
      ["C", 3],
    ]);
  });
});

/**
 * An `@{` in a statement that writes no node. Measured on Mermaid 12.2.0:
 * `accTitle: a@{b`, `accDescr { a@{b }`, a `%%` comment, a quoted label
 * and a `click` string hold it as text; `subgraph t a@{b`, `classDef c
 * fill:#f@{` and `style C fill:#f00@{` are parse errors on their own line.
 * None of them runs on into the line after it.
 */
describe("an `@{` in a statement that writes no node", () => {
  it("is part of an accessible title, and the next line is a node", () => {
    const { document, diagnostics } = parseOk("flowchart TB\n  accTitle: a@{b\n  C");

    expect(diagnostics).toEqual([]);
    expect(document.accTitle).toBe("a@{b");
    expect(document.nodes.map((node) => [node.id, node.line])).toEqual([["C", 3]]);
  });

  it("is refused in a subgraph title on its own line, and the block's lines are read", () => {
    const { diagnostics } = parseFlowchart("flowchart TB\n  subgraph t a@{b\n    C\n  end");

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'A subgraph takes no "@{ … }" block. Leave the block out: subgraph t a',
        line: 2,
        column: 15,
      },
    ]);
  });

  it.each(["classDef c fill:#f@{", "style C fill:#f00@{"])("is no block in `%s`, which reaches no further line", (written) => {
    const { diagnostics } = parseFlowchart(`flowchart TB\n  ${written}\n  C --> D`);

    expect(diagnostics.filter((d) => d.line !== 2)).toEqual([]);
    expect(diagnostics.map((d) => d.message)).not.toContain('The "@{" is never closed. End the block with "}"');
  });

  it.each([
    ["a comment", "%% a@{b"],
    ["a braced accessible description", "accDescr { a@{b }"],
    ["a quoted label", 'A["a@{b"]'],
    ["a click's string", 'click C "https://x.org/a@{b"'],
  ])("is text in %s, and the next line is a node", (_, written) => {
    const { document, diagnostics } = parseOk(`flowchart TB\n  C\n  ${written}\n  D`, parseSiren);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.id)).toContain("D");
  });
});

/**
 * An edge id, `A e1@--> B`, which Siren does not support yet (the same board
 * as `@{ … }`). Measured on Mermaid 12.2.0: accepted before every arrow
 * spelling (`e1@==>`, `e1@-- yes -->`, `e1@-->|yes|`), on one link of a
 * chain each, and after an `&` group, where it names the last link.
 */
describe("an edge written with an id", () => {
  it.each([
    ["A e1@--> B", "e1", 5, "A --> B"],
    ["A e1@-->|yes| B", "e1", 5, "A -->|yes| B"],
    ["A e1@--> B e2@--> C", "e1", 5, "A --> B --> C"],
    ["A & C e1@==> B", "e1", 9, "A & C ==> B"],
    // Measured: both labels are valid Mermaid, `p q@-->r` and `x y@-z`; a
    // label's text is no edge id, and the fix leaves it as written.
    ['A["p q@-->r"] e1@--> B', "e1", 17, 'A["p q@-->r"] --> B'],
    ["A[x y@-z] e1@--> B", "e1", 13, "A[x y@-z] --> B"],
  ])("refuses %s at the id, saying to leave it out", (written, id, column, fixed) => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB\n  ${written}`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: `Siren does not support edge ids ("${id}@") yet. Leave the id out: ${fixed}`,
        line: 2,
        column,
      },
    ]);
  });

  it("takes no edge id from a label's text, so a later `@{ … }` on that word is a node's", () => {
    const { diagnostics } = parseFlowchart("flowchart TB\n  A[x y@-z] e1@--> B\n  y@{ shape: rect }");

    expect(diagnostics.map((d) => d.message)).toEqual([
      'Siren does not support edge ids ("e1@") yet. Leave the id out: A[x y@-z] --> B',
    ]);
  });

  it("refuses an `@{ … }` block on that id as edge data, saying to leave the line out", () => {
    // Measured: after `A e1@--> B`, `e1@{ animate: true }` is the edge's
    // data; with no edge named `e1`, the same line is a node `e1`.
    const { document, diagnostics } = parseFlowchart("flowchart TB\n  A e1@--> B\n  e1@{ animate: true }");

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'Siren does not support edge ids ("e1@") yet. Leave the id out: A --> B',
        line: 2,
        column: 5,
      },
      {
        severity: "error",
        message: 'Siren does not support "@{ … }" data on the edge "e1" yet. Leave this line out',
        line: 3,
        column: 5,
      },
    ]);
  });
});

/**
 * A node written with a bracket more than once. Mermaid 11.17.2, measured:
 * the last bracket is the one drawn — its label *and* its shape (`A[x]` then
 * `A{x}` is a diamond) — with no diagnostic, while a bare mention changes
 * neither.
 */
describe("a flowchart node declared twice", () => {
  it("takes the shape of the last bracket, even when the label is the same", () => {
    const source = `flowchart TB
  A[x]
  A{x}`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label.text, node.shape])).toEqual([
      ["A", "x", "rhombus"],
    ]);
  });
});

/** A node's label rows, each run cut down to the two axes a Markdown string sets. */
function markdownRows(node: SirenNode | undefined) {
  return node?.label.rows.map((row) => row.map(({ text, bold, italic }) => ({ text, bold, italic })));
}

describe("a flowchart node's Markdown label", () => {
  it("reads an ordinary label as one row of one plain run", () => {
    const source = `flowchart TB
  A[Start]`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes[0]?.label.rows).toEqual([[plainRun("Start")]]);
  });

  it("reads a `**bold**` Markdown string label into one bold run", () => {
    const source = "flowchart TB\n  A[\"`**bold**`\"]";

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes[0]?.label.text).toBe("bold");
    expect(markdownRows(document.nodes[0])).toEqual([
      [{ text: "bold", bold: true, italic: false }],
    ]);
  });

  it("reads a `*italic*` Markdown string label into one italic run", () => {
    const source = "flowchart TB\n  A[\"`*italic*`\"]";

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes[0]?.label.text).toBe("italic");
    expect(markdownRows(document.nodes[0])).toEqual([
      [{ text: "italic", bold: false, italic: true }],
    ]);
  });

  it("breaks a Markdown string label's embedded line break into one run array per line", () => {
    const source = 'flowchart TB\n  A["`line1\nline2`"]';

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes[0]?.label.text).toBe("line1\nline2");
    expect(markdownRows(document.nodes[0])).toEqual([
      [{ text: "line1", bold: false, italic: false }],
      [{ text: "line2", bold: false, italic: false }],
    ]);
  });

  it("still parses the statement after a merged multi-line Markdown label at the right line number", () => {
    const source = 'flowchart TB\n  A["`line1\nline2`"]\n  A --> B';

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.edges).toEqual([
      expect.objectContaining({ from: "A", to: "B", sourceLine: 4 }),
    ]);
  });
});

describe("a flowchart node id's alphabet", () => {
  it("accepts a `.` in a bare edge endpoint", () => {
    const source = `flowchart TB
  a.b --> c`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.id)).toEqual(["a.b", "c"]);
    expect(document.edges).toEqual([expect.objectContaining({ from: "a.b", to: "c" })]);
  });

  it("declares a bare id whose `.-` looks like a dotted-arrow opener, rather than refusing the document", () => {
    // The sharper case the ticket names: `C.-D` on a line of its own
    // declares nothing but a vertex in mermaid 11.17.2 (measured), because
    // the id's own `.-` is never cut as an arrow. Before this ticket Siren
    // could not spell that id at all, so this line alone sank the whole
    // document — a picture Mermaid draws becoming no picture.
    const source = `flowchart TB
  A --> B
  C.-D`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.id)).toEqual(["A", "B", "C.-D"]);
    expect(document.edges).toEqual([expect.objectContaining({ from: "A", to: "B" })]);
  });

  it("accepts a `.` in a bracketed node declaration, on a line of its own and at an edge endpoint", () => {
    const source = `flowchart TB
  a.b[Label]
  c.d[Other] --> e.f`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.id)).toEqual(["a.b", "c.d", "e.f"]);
    expect(document.nodes.find((node) => node.id === "a.b")?.label.text).toBe("Label");
    expect(document.edges).toEqual([expect.objectContaining({ from: "c.d", to: "e.f" })]);
  });

  it("accepts a `.` in the `:::` apply-directive shorthand, on a declaration and at an edge endpoint", () => {
    const source = `flowchart TB
  a.b:::hot
  a.b --> c.d:::cold`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.styles).toEqual([
      expect.objectContaining({ styleKind: "apply", targetIds: ["a.b"], name: "hot" }),
      expect.objectContaining({ styleKind: "apply", targetIds: ["c.d"], name: "cold" }),
    ]);
  });

  it("accepts a `.` in a `style` and a `class` apply-directive's target list", () => {
    const source = `flowchart TB
  a.b --> c.d
  style a.b fill:#fdd
  class a.b,c.d hot`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.styles).toEqual([
      expect.objectContaining({ styleKind: "style", targetIds: ["a.b"] }),
      expect.objectContaining({ styleKind: "apply", targetIds: ["a.b", "c.d"], name: "hot" }),
    ]);
  });

  it("accepts a `.` in a subgraph's bare-word handle and in a click statement's target", () => {
    const source = `flowchart TB
  subgraph a.b
    c.d
  end
  click c.d href "https://example.com"`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.subgraphs).toEqual([expect.objectContaining({ name: "a.b", nodeIds: ["c.d"] })]);
    expect(document.interactions).toEqual([
      expect.objectContaining({ interactionKind: "href", targetId: "c.d" }),
    ]);
  });

  it("accepts a `%` anywhere in an id, on a declaration and at an edge endpoint", () => {
    // Measured on Mermaid 12.2.0: `%` is a node-string character, so
    // `A%B --> C`, `%A`, `A%`, `A-->B%C`, `A%B[lbl]`, `%-A` and `A.%B` each
    // record the id as written — and `%` alone is a node.
    const { document, diagnostics } = parseOk(`flowchart TB
  A%B --> C
  %A
  A%
  A-->B%C
  D%E[lbl]
  %-F
  G.%H
  %`);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.id)).toEqual([
      "A%B",
      "C",
      "%A",
      "A%",
      "A",
      "B%C",
      "D%E",
      "%-F",
      "G.%H",
      "%",
    ]);
    expect(document.nodes.find((node) => node.id === "D%E")?.label.text).toBe("lbl");
    expect(document.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["A%B", "C"],
      ["A", "B%C"],
    ]);
  });

  it("reads an `o` or `x` right after a `%` as the id's, not as an arrow's marker", () => {
    // Measured on Mermaid 12.2.0: `A%x--xB` is the nodes `A%x` and `B` with
    // a cross-headed edge, and `A%o-->B` and `A%x-->B` plain arrows from
    // `A%o` and `A%x`.
    const { document, diagnostics } = parseOk("flowchart TB\n  A%x--xB\n  C%o-->D\n  E%x-->F");

    expect(diagnostics).toEqual([]);
    expect(document.edges.map((edge) => [edge.from, edge.fromEnd, edge.toEnd, edge.to])).toEqual([
      ["A%x", "none", "cross", "B"],
      ["C%o", "none", "arrow", "D"],
      ["E%x", "none", "arrow", "F"],
    ]);
  });

  it("reads a `.-` right after a `%` as the id's, not as a dotted arrow", () => {
    // Measured on Mermaid 12.2.0: `A%.-B` and `A%x.-xB` are each one node
    // with that id, and `A%.->B` is a parse error, no edge at all.
    const { document, diagnostics } = parseOk("flowchart TB\n  A%.-B\n  C%x.-xD");

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.id)).toEqual(["A%.-B", "C%x.-xD"]);
    expect(document.edges).toEqual([]);
    expect(parseFlowchart("flowchart TB\n  A%.->B").document).toBeNull();
  });

  it("opens an asymmetric label at a `>` right after a `%`, so no separator inside it cuts the line", () => {
    // Measured on Mermaid 12.2.0: `A%>a;b] --> B` and `C%>c-->d] --> D` are
    // asymmetric nodes `A%` and `C%` labelled "a;b" and "c-->d", each with
    // one edge.
    const { document, diagnostics } = parseOk("flowchart TB\n  A%>a;b] --> B\n  C%>c-->d] --> D");

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label.text, node.shape])).toEqual([
      ["A%", "a;b", "asymmetric"],
      ["B", "B", "rect"],
      ["C%", "c-->d", "asymmetric"],
      ["D", "D", "rect"],
    ]);
    expect(document.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["A%", "B"],
      ["C%", "D"],
    ]);
  });

  it.each([
    // Measured on Mermaid 12.2.0: an `&` glued to an id is a character of
    // it — `A%&B-->C`, `A&B-->C` and `A & B&C --> D` record the single ids
    // `A%&B`, `A&B` and `B&C`, a picture of no group — and one with a space
    // on one side only, or after a bracket, is a parse error (`A &B-->C`,
    // `B& C`, `A[x]&B-->C`, `A --> B[x]&C`).
    ["A%&B-->C", 5, "A% & B-->C"],
    ["A&B-->C", 4, "A & B-->C"],
    ["A & B&C --> D", 8, "A & B & C --> D"],
    ["A &B-->C", 5, "A & B-->C"],
    ["A& B-->C", 4, "A & B-->C"],
    ["A[x]&B-->C", 7, "A[x] & B-->C"],
    ["A --> B[x]&C", 13, "A --> B[x] & C"],
  ])("refuses %s at the `&`, which joins nodes only with a space on each side", (written, column, fixed) => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB\n  ${written}`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: `An "&" joins nodes only with a space on each side. Write: ${fixed}`,
        line: 2,
        column,
      },
    ]);
  });

  it("accepts a `-` in a `class` statement's targets, as every other statement naming an id does", () => {
    // Measured on Mermaid 12.2.0: `class a-b,c hot` and `class d.-e hot`
    // give `a-b`, `c` and `d.-e` the class `hot`.
    const { document, diagnostics } = parseOk("flowchart TB\n  a-b\n  c\n  d.-e\n  class a-b,c hot\n  class d.-e hot");

    expect(diagnostics).toEqual([]);
    expect(document.styles).toEqual([
      expect.objectContaining({ styleKind: "apply", targetIds: ["a-b", "c"], name: "hot" }),
      expect.objectContaining({ styleKind: "apply", targetIds: ["d.-e"], name: "hot" }),
    ]);
  });

  it("accepts a `%` in every statement that names an id: `class`, `style`, `click`, `:::` and a subgraph's handle", () => {
    // Measured on Mermaid 12.2.0: `class A%B foo`, `style A%B fill:#f00`,
    // `click A%B "http://x"` and `A%B:::c` reach the node `A%B`, and
    // `subgraph S%1 [T]` and `subgraph S%%1` record the subgraph ids `S%1`
    // and `S%%1` — the same with `%%` (`style A%%B …`, `class A%%B foo`).
    const { document, diagnostics } = parseOk(`flowchart TB
  subgraph S%1 [T]
    A%B
  end
  subgraph S%%1
    C%%D
  end
  classDef foo fill:#f00
  class A%B,C%%D foo
  style A%B fill:#0f0
  style C%%D fill:#00f
  A%B:::foo
  click A%B "https://example.com"
  click C%%D "https://example.com"`);

    expect(diagnostics).toEqual([]);
    expect(document.subgraphs.map((subgraph) => [subgraph.name, subgraph.nodeIds])).toEqual([
      ["S%1", ["A%B"]],
      ["S%%1", ["C%%D"]],
    ]);
    expect(document.styles).toEqual([
      expect.objectContaining({ styleKind: "classDef", name: "foo" }),
      expect.objectContaining({ styleKind: "apply", targetIds: ["A%B", "C%%D"], name: "foo" }),
      expect.objectContaining({ styleKind: "style", targetIds: ["A%B"] }),
      expect.objectContaining({ styleKind: "style", targetIds: ["C%%D"] }),
      expect.objectContaining({ styleKind: "apply", targetIds: ["A%B"], name: "foo" }),
    ]);
    expect(document.interactions.map((interaction) => interaction.targetId)).toEqual(["A%B", "C%%D"]);
  });

  it("still names an edge id after an endpoint holding a `%`, and one holding a `%` itself", () => {
    // Measured on Mermaid 12.2.0: `A%B e1@--> C` records the edge id `e1`
    // from `A%B`, and `A e%1@--> B` the edge id `e%1`.
    expect(parseFlowchart("flowchart TB\n  A%B e1@--> C").diagnostics).toEqual([
      {
        severity: "error",
        message: 'Siren does not support edge ids ("e1@") yet. Leave the id out: A%B --> C',
        line: 2,
        column: 7,
      },
    ]);
    expect(parseFlowchart("flowchart TB\n  A%%B e%1@--> C").diagnostics).toEqual([
      {
        severity: "error",
        message: 'Siren does not support edge ids ("e%1@") yet. Leave the id out: A%%B --> C',
        line: 2,
        column: 8,
      },
    ]);
  });

  it("lets a timeline name a node whose id holds a `%`, and the edge from it", () => {
    // ADR-0009: a target is an id, and a timeline action is split on
    // whitespace only, so `A%B` and the edge id `A%B-C` are spelled as is.
    const { document, diagnostics } = parseOk(
      "flowchart TB\n  A%B --> C\ntimeline:\n  enter A%B fade\n  enter A%B-C fade",
      parseSiren,
    );

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.id)).toEqual(["A%B", "C"]);
    expect(document.timeline?.entries.map((entry) => [entry.step, entry.targetId])).toEqual([
      [1, "A%B"],
      [2, "A%B-C"],
    ]);
  });
});

/**
 * A subgraph title written as more than one word, read the way Mermaid
 * 12.2.0 reads it (measured with `scripts/mermaid-probe.mjs`): the whole
 * run after `subgraph` is the title, and the block gets no handle of its
 * own — Mermaid records it under a generated `subGraph0`.
 */
describe("a subgraph title written as more than one word", () => {
  it("joins a quoted title and the words after it into one title, with no handle", () => {
    const source = `flowchart TB
  subgraph "t" zz
    A
  end`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.subgraphs).toEqual([
      expect.objectContaining({ name: null, label: plainLabel("t zz"), nodeIds: ["A"] }),
    ]);
  });

  it.each(["S a & b", "S a b c", "S a. b! c?", "S 日本 語"])(
    "reads `subgraph %s` as one title, the whole run, with no handle",
    (title) => {
      const source = `flowchart TB
  subgraph ${title}
    A
  end`;

      const { document, diagnostics } = parseOk(source);

      expect(diagnostics).toEqual([]);
      expect(document.subgraphs).toEqual([
        expect.objectContaining({ name: null, label: plainLabel(title), nodeIds: ["A"] }),
      ]);
    },
  );

  it("refuses words after a bracketed title, at the words, saying to move them inside the brackets", () => {
    // Measured: `subgraph s1 ["t"] zz` is "Expecting 'SEMI', 'NEWLINE', 'EOF', got 'SPACE'".
    const { document, diagnostics } = parseFlowchart('flowchart TB\n  subgraph s1 ["t"] zz\n    A\n  end');

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message:
          'Text after a subgraph\'s bracketed title: "zz". A title in brackets ends the line; ' +
          'move the text inside the brackets: subgraph s1["t zz"]',
        line: 2,
        column: 21,
      },
    ]);
  });

  // Measured: each is a parse error — `got 'COMMA'`, `'COMMA'`, `'LINK'`.
  it.each([
    ["S a, b. c!", ",", 15],
    ['"t" a,b', ",", 17],
    ["S a --> b", "--", 16],
  ])("refuses `subgraph %s` at its %j, saying to quote the title", (tail, character, column) => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB\n  subgraph ${tail}\n    A\n  end`);

    const title = tail.replaceAll('"', "");
    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message:
          `A subgraph title without quotes cannot hold "${character}". ` +
          `Put the whole title in quotes: subgraph "${title}"`,
        line: 2,
        column,
      },
    ]);
  });

  // Measured: Mermaid reads a last word `end` as the block's own end and
  // swallows the next line into the title — `subgraph S a end` records the
  // title "S a end\nA" and leaves `A` outside the frame, with no error.
  it.each([
    ["S a end", 16],
    ['"t" end', 16],
  ])("refuses `subgraph %s` at its last word `end`, saying to quote the title", (tail, column) => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB\n  subgraph ${tail}\n    A\n  end`);

    const title = tail.replaceAll('"', "");
    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message:
          'A subgraph title cannot end with the word "end", which closes the block. ' +
          `Put the whole title in quotes: subgraph "${title}"`,
        line: 2,
        column,
      },
    ]);
  });
});

/**
 * The rest of a quoted subgraph header, read as Mermaid 12.2.0 reads it
 * (measured with `scripts/mermaid-probe.mjs`): the quoted text and any word
 * glued to it are one run, and that run is the block's id unless it holds
 * whitespace — `subgraph "t"` is id `t`, `subgraph "a b"` is `subGraph0`.
 */
describe("a quoted subgraph header", () => {
  it("makes a quoted title of one word the block's handle as well, as a bare word is", () => {
    const { document, diagnostics } = parseOk(`flowchart TB
  subgraph "t"
    A
  end
  t --> B`);

    expect(diagnostics).toEqual([]);
    expect(document.subgraphs).toEqual([
      expect.objectContaining({ name: "t", label: plainLabel("t"), nodeIds: ["A"] }),
    ]);
    // The edge names the frame, so `t` is no node — as with `subgraph t`
    // (measured: Mermaid joins the edge to the cluster `t`).
    expect(document.nodes.map((node) => node.id)).toEqual(["A", "B"]);
  });

  it.each([
    ['"t"zz', "tzz", "tzz"],
    ['"t"-z', "t-z", "t-z"],
    ['"t"zz yy', null, "tzz yy"],
    ['"a b"zz', null, "a bzz"],
  ])("reads `subgraph %s` as the quoted text and the word glued to it, one run", (tail, name, title) => {
    const { document, diagnostics } = parseOk(`flowchart TB\n  subgraph ${tail}\n    A\n  end`);

    expect(diagnostics).toEqual([]);
    expect(document.subgraphs).toEqual([
      expect.objectContaining({ name, label: plainLabel(title), nodeIds: ["A"] }),
    ]);
  });

  it.each([
    ['"t" [x]', "t", "x"],
    ['"t"[x]', "t", "x"],
    ['"t" ["x y"]', "t", "x y"],
    ['"t"zz [x]', "tzz", "x"],
    ['"a b" [x]', null, "x"],
    ['"t" zz [x]', null, "x"],
  ])("reads `subgraph %s` as a handle and a bracketed title", (tail, name, title) => {
    const { document, diagnostics } = parseOk(`flowchart TB\n  subgraph ${tail}\n    A\n  end`);

    expect(diagnostics).toEqual([]);
    expect(document.subgraphs).toEqual([
      expect.objectContaining({ name, label: plainLabel(title), nodeIds: ["A"] }),
    ]);
  });
});

/**
 * `direction LR` outside any `subgraph` block. Measured: Mermaid 12.2.0
 * accepts it on any line and ignores it — the recorded direction stays the
 * header's (`TB`), whether the line comes first or last.
 */
describe("a direction written outside any subgraph", () => {
  it("is ignored with the text after it, with the one warning that the line does nothing", () => {
    // Measured: `direction LR zz` at the top level is accepted and ignored.
    const { document, diagnostics } = parseOk("flowchart TB\n  direction LR zz\n  A --> B");

    expect(document.direction).toBe("TB");
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          '"direction LR zz" outside a subgraph has no effect. ' +
          "Set the diagram's direction on its first line instead: flowchart LR",
        line: 2,
        column: 3,
      },
    ]);
  });

  it.each([
    ["first", "flowchart TB\n  direction LR\n  A --> B", 2],
    ["last", "flowchart TB\n  A --> B\n  direction LR", 3],
  ])("is drawn in the header's direction when it is the %s line, with a warning that it does nothing", (_, source, line) => {
    const { document, diagnostics } = parseOk(source);

    expect(document.direction).toBe("TB");
    expect(document.edges).toHaveLength(1);
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          '"direction LR" outside a subgraph has no effect. ' +
          "Set the diagram's direction on its first line instead: flowchart LR",
        line,
        column: 3,
      },
    ]);
  });

  it("suggests the header keyword the author wrote, so a `graph` document is told to write `graph LR`", () => {
    const { document, diagnostics } = parseOk("graph TD\n  direction LR\n  A --> B");

    expect(document.direction).toBe("TB");
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          '"direction LR" outside a subgraph has no effect. ' +
          "Set the diagram's direction on its first line instead: graph LR",
        line: 2,
        column: 3,
      },
    ]);
  });
});

describe("a direction written inside a subgraph", () => {
  it("is read onto that subgraph alone, leaving the document's own direction where the header put it", () => {
    const source = `flowchart TB
  subgraph one
    direction LR
    A --> B
  end`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.direction).toBe("TB");
    expect(document.subgraphs).toEqual([
      expect.objectContaining({ name: "one", direction: "LR" }),
    ]);
  });

  it("normalizes `TD` to `TB`, exactly as the header spelling does", () => {
    const source = `flowchart TB
  subgraph one
    direction TD
    A --> B
  end`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.subgraphs).toEqual([
      expect.objectContaining({ name: "one", direction: "TB" }),
    ]);
  });

  it("leaves a subgraph's direction `null` when the author wrote none", () => {
    const source = `flowchart TB
  subgraph one
    A --> B
  end`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.subgraphs).toEqual([
      expect.objectContaining({ name: "one", direction: null }),
    ]);
  });

  // Measured: Mermaid's direction token takes the rest of its line, so
  // `direction LR zz` and `direction LRzz` both set `dir="LR"` on the block.
  it.each([
    ["direction LR zz", "zz", 18],
    ["direction LRzz", "zz", 17],
    ["direction RL --> B", "--> B", 18],
  ])("reads `%s` onto the subgraph, with a warning that the text after it is ignored", (statement, ignored, column) => {
    const { document, diagnostics } = parseOk(`flowchart TB
  subgraph one
    ${statement}
    A
  end`);

    expect(document.subgraphs).toEqual([
      expect.objectContaining({ name: "one", direction: statement.slice(10, 12), nodeIds: ["A"] }),
    ]);
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message: `Text after "direction ${statement.slice(10, 12)}" is ignored: "${ignored}". Remove it.`,
        line: 3,
        column,
      },
    ]);
  });
});

/**
 * An edge whose endpoint names a `subgraph` block.
 *
 * **Measured.** mermaid 11.17.2 reads `one --> two`, where both are
 * subgraphs, as an edge between the two *frames*, and its renderer joins the
 * clusters (`scripts/mermaid-probe.mjs`). The parser's job here is only to
 * record what was written and to take back the node it would otherwise have
 * declared for the name — resolving the name to the frame's generated id is
 * `buildFlowchartModel`'s.
 */
describe("an edge whose endpoint names a subgraph", () => {
  it("records the edge as written and declares no node for the name", () => {
    const source = `flowchart TB
  subgraph one
    A
  end
  subgraph two
    B
  end
  one --> two`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.edges).toEqual([expect.objectContaining({ from: "one", to: "two" })]);
    // The frames are the endpoints, so there is no box called `one` beside
    // the frame of the same name.
    expect(document.nodes.map((node) => node.id)).toEqual(["A", "B"]);
  });

  it("takes the node back whichever order the two were written in", () => {
    // A subgraph may be declared below the edge that names it, so the node
    // an endpoint provisionally declares can only be taken back once the
    // whole document has been read.
    const source = `flowchart TB
  A --> Ingest
  subgraph Ingest
    B --> C
  end`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.id)).toEqual(["A", "B", "C"]);
    expect(document.edges).toEqual([
      expect.objectContaining({ from: "A", to: "Ingest" }),
      expect.objectContaining({ from: "B", to: "C" }),
    ]);
  });

  it("leaves a node the author declared in their own right alone", () => {
    // `A[Alpha]` is a declaration, not a provisional mention, so the box
    // stays drawn beside the frame of the same name — what Mermaid does, and
    // what ADR-0010's generated subgraph id exists to keep apart. The edge
    // endpoint still means the frame.
    const source = `flowchart TB
  A[Alpha]
  subgraph A
    B --> C
  end
  A --> D`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.id)).toEqual(["A", "B", "C", "D"]);
    expect(document.nodes.find((node) => node.id === "A")?.label.text).toBe("Alpha");
  });

  it("takes the block's claim on the name back with the node", () => {
    // The endpoint is written inside `outer`, which would have claimed it as
    // a member — so taking the node back has to take the membership with it.
    const source = `flowchart TB
  subgraph one
    A
  end
  subgraph outer
    one --> B
  end`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.id)).toEqual(["A", "B"]);
    expect(document.subgraphs.map((sub) => [sub.name, sub.nodeIds])).toEqual([
      ["one", ["A"]],
      ["outer", ["B"]],
    ]);
  });
});

describe("a flowchart's bare node declarations", () => {
  it("declares a node from a bare id on its own line, outside any subgraph", () => {
    const source = `flowchart TB
  Orphan
  A --> B`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.id)).toEqual(["Orphan", "A", "B"]);
    expect(document.nodes.find((node) => node.id === "Orphan")?.label.text).toBe("Orphan");
    expect(document.edges).toEqual([expect.objectContaining({ from: "A", to: "B" })]);
  });
});

describe("a flowchart's click statements", () => {
  it("parses a click href interaction, with and without the trailing tooltip", () => {
    const source = `flowchart TB
  A[Start]
  B[End]
  click A href "https://example.com"
  click B href "https://example.org" "Read the docs"
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.interactions).toEqual([
      {
        interactionKind: "href",
        targetId: "A",
        action: "https://example.com",
        argument: null,
        tooltip: null,
        linkTarget: null,
        line: 4,
        column: 3,
      },
      {
        interactionKind: "href",
        targetId: "B",
        action: "https://example.org",
        argument: null,
        tooltip: "Read the docs",
        linkTarget: null,
        line: 5,
        column: 3,
      },
    ]);
  });

  it("parses a click call interaction, capturing the function name and any literal argument", () => {
    const source = `flowchart TB
  A[Start]
  B[Middle]
  C[End]
  click A call callbackFn()
  click B call callbackFn("arg")
  click C call callbackFn("arg") "Do the thing"
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.interactions).toEqual([
      {
        interactionKind: "call",
        targetId: "A",
        action: "callbackFn",
        argument: null,
        tooltip: null,
        line: 5,
        column: 3,
      },
      {
        interactionKind: "call",
        targetId: "B",
        action: "callbackFn",
        argument: "arg",
        tooltip: null,
        line: 6,
        column: 3,
      },
      {
        interactionKind: "call",
        targetId: "C",
        action: "callbackFn",
        argument: "arg",
        tooltip: "Do the thing",
        line: 7,
        column: 3,
      },
    ]);
  });

  it("parses href's optional trailing target attribute, one of Mermaid's four LINK_TARGET values", () => {
    const source = `flowchart TB
  A[Start]
  B[Middle]
  click A href "https://example.com" "tip" _blank
  click B href "https://example.org" _self
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.interactions).toEqual([
      {
        interactionKind: "href",
        targetId: "A",
        action: "https://example.com",
        argument: null,
        tooltip: "tip",
        linkTarget: "_blank",
        line: 4,
        column: 3,
      },
      {
        interactionKind: "href",
        targetId: "B",
        action: "https://example.org",
        argument: null,
        tooltip: null,
        linkTarget: "_self",
        line: 5,
        column: 3,
      },
    ]);
  });

  it("refuses a target that is not one of Mermaid's four LINK_TARGET values, rather than truncating it away", () => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB
  A[Start]
  click A href "https://example.com" "tip" _bogus
`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'Unrecognized flowchart line: "click A href "https://example.com" "tip" _bogus"',
        line: 3,
        column: 3,
      },
    ]);
  });

  it("parses the bare callback-name shorthand into the same call interaction shape as `call fn()`", () => {
    const { document, diagnostics } = parseOk(`flowchart TB
  A[Start]
  click A myFn
`);

    expect(diagnostics).toEqual([]);
    expect(document.interactions).toEqual([
      {
        interactionKind: "call",
        targetId: "A",
        action: "myFn",
        argument: null,
        tooltip: null,
        line: 3,
        column: 3,
      },
    ]);
  });

  it("still reads a name followed by parens as `call fn()`, not the bare shorthand", () => {
    const { document, diagnostics } = parseOk(`flowchart TB
  A[Start]
  click A call myFn()
`);

    expect(diagnostics).toEqual([]);
    expect(document.interactions).toEqual([
      {
        interactionKind: "call",
        targetId: "A",
        action: "myFn",
        argument: null,
        tooltip: null,
        line: 3,
        column: 3,
      },
    ]);
  });

  it("parses the bare-quoted-string shorthand `click A \"url\"` into the same href interaction shape as `click A href \"url\"`", () => {
    const { document, diagnostics } = parseOk(`flowchart TB
  A[Start]
  click A "https://example.com"
`);

    expect(diagnostics).toEqual([]);
    expect(document.interactions).toEqual([
      {
        interactionKind: "href",
        targetId: "A",
        action: "https://example.com",
        argument: null,
        tooltip: null,
        linkTarget: null,
        line: 3,
        column: 3,
      },
    ]);
  });

  it("parses the bare-quoted-string shorthand's content as written, whether or not it looks like a URL — the http/https/mailto allowlist is resolveInteractions' job, not the parser's", () => {
    const { document, diagnostics } = parseOk(`flowchart TB
  A[Start]
  click A "tip"
`);

    expect(diagnostics).toEqual([]);
    expect(document.interactions).toEqual([
      {
        interactionKind: "href",
        targetId: "A",
        action: "tip",
        argument: null,
        tooltip: null,
        linkTarget: null,
        line: 3,
        column: 3,
      },
    ]);
  });

  it("does not declare a node by naming it in a click statement, unlike an edge or a bracketed declaration", () => {
    const { document, diagnostics } = parseOk(`flowchart TB
  click Ghost href "https://example.com"
`);

    expect(diagnostics).toEqual([]);
    expect(document.nodes).toEqual([]);
    expect(document.interactions).toEqual([
      {
        interactionKind: "href",
        targetId: "Ghost",
        action: "https://example.com",
        argument: null,
        tooltip: null,
        linkTarget: null,
        line: 2,
        column: 3,
      },
    ]);
  });
});

describe("a flowchart's accTitle/accDescr statements", () => {
  it("parses accTitle into the document's accTitle field", () => {
    const { document, diagnostics } = parseOk(`flowchart TB
  accTitle: A short title
  A[Start] --> B[End]
`);

    expect(diagnostics).toEqual([]);
    expect(document.accTitle).toBe("A short title");
  });

  it("parses accDescr into the document's accDescr field", () => {
    const { document, diagnostics } = parseOk(`flowchart TB
  accDescr: A longer description
  A[Start] --> B[End]
`);

    expect(diagnostics).toEqual([]);
    expect(document.accDescr).toBe("A longer description");
  });

  it("reads the braced accDescr block, and `accTitle : x` with a space before the colon (01M4WS1P6)", () => {
    // Measured on mermaid 12.2.0: the block reads as it does in every kind
    // (see `readAccDescrBlock`) — lines lose their indent, blanks go, what
    // follows the `}` is the next statement — and `accTitle : hi` is "hi".
    const { document, diagnostics } = parseOk(`flowchart TB
  accTitle : A short title
  accDescr {
    A longer

      description
  } A[Start] --> B[End]
`);

    expect(diagnostics).toEqual([]);
    expect(document.accTitle).toBe("A short title");
    expect(document.accDescr).toBe("A longer\ndescription");
    expect(document.nodes.map((node) => node.id)).toEqual(["A", "B"]);

    expect(parseOk("flowchart TB\n  accDescr{one}\n  A\n").document.accDescr).toBe("one");
    expect(parseOk("flowchart TB\n  accDescr {\n  }\n  A\n").document.accDescr).toBeNull();
  });

  it("reads the acc keywords in lower case only, as Mermaid's flowchart lexer does", () => {
    // Unlike an ER or a sequence diagram, measured on 12.2.0: `ACCDESCR {`,
    // `ACCDESCR: x` and `ACCTITLE: x` are parse errors in a flowchart.
    for (const line of ["ACCDESCR {", "ACCDESCR: x", "ACCTITLE: x"]) {
      expect([line, parseFlowchart(`flowchart TB\n  ${line}\n  }\n  A\n`).document]).toEqual([line, null]);
    }
  });

  it("refuses an accDescr block that never closes", () => {
    // Mermaid 12.2.0 reads the rest of the document into it and draws an
    // empty flowchart, which is not what the document says.
    const { document, diagnostics } = parseFlowchart("flowchart TB\n  accDescr {\n  one\n  A --> B\n");
    expect(document).toBeNull();
    expect(diagnostics.map((d) => [d.severity, d.line])).toEqual([["error", 2]]);
  });

  it("leaves accTitle and accDescr null when the document declares neither", () => {
    const { document, diagnostics } = parseOk(`flowchart TB
  A[Start] --> B[End]
`);

    expect(diagnostics).toEqual([]);
    expect(document.accTitle).toBeNull();
    expect(document.accDescr).toBeNull();
  });

  it("keeps the last accTitle/accDescr when declared more than once", () => {
    const { document, diagnostics } = parseOk(`flowchart TB
  accTitle: First title
  accTitle: Second title
  accDescr: First description
  accDescr: Second description
  A[Start] --> B[End]
`);

    expect(diagnostics).toEqual([]);
    expect(document.accTitle).toBe("Second title");
    expect(document.accDescr).toBe("Second description");
  });
});

describe("the header a flowchart rejects", () => {
  // Characterization: this message is assembled by `listAcceptedHeaders`
  // rather than written here, and pinning its exact text is what keeps a
  // change to that assembly from quietly rewording every diagnostic that
  // teaches an author which headers exist.
  it("names all eight flowchart spellings, in one list", () => {
    const { document, diagnostics } = parseFlowchart("flowchart SIDEWAYS\n  A[Start]\n");

    expect(document).toBeNull();
    expect(diagnostics[0].message).toBe(
      'Expected "flowchart TB", "flowchart BT", "flowchart LR", "flowchart RL",' +
        ' "graph TB", "graph BT", "graph LR", or "graph RL", found "flowchart SIDEWAYS"',
    );
  });
});

/**
 * Mermaid's style-line rule (its `encodeEntities`): before it parses, it
 * drops the last `;` of every line where `style` (or `classDef`), a `:` and
 * then a `#` come before it — the whole line, not one label. Mermaid
 * 11.17.2, measured with `--html`. `parseSiren` applies it to the whole
 * document, so these read through it.
 */
describe("the `;` Mermaid drops from a style line", () => {
  const nodeLabel = (source: string, id: string) =>
    parseOk(source, parseSiren).document.nodes.find((node) => node.id === id)!.label;

  it("is the line's last `;`, even when that one trails the statement", () => {
    // `A["<span style='color:#f00;'>r</span>"];` draws
    // `<span style="color:&amp;f00;">r</span>`: the dropped `;` is the
    // statement's, so the color's is still a code, and no color is drawn.
    const label = nodeLabel(`flowchart TB\n  A["<span style='color:#f00;'>r</span>"];`, "A");
    expect(label.rows[0]!.map((run) => [run.text, run.color])).toEqual([["r", null]]);
  });

  it("is taken from a later label on the same line, never the earlier one", () => {
    // `A[…#f00;…] --> B["#35;"]` draws A uncolored and B as `#35`.
    const source = `flowchart TB\n  A["<span style='color:#f00;'>r</span>"] --> B["#35;"]`;
    expect(nodeLabel(source, "A").rows[0]!.map((run) => [run.text, run.color])).toEqual([["r", null]]);
    expect(nodeLabel(source, "B").text).toBe("#35");
  });

  it("joins a `style` statement's two declarations around it into one", () => {
    // `style A fill:#fdd;position:fixed,stroke:#c00` records
    // `styles=["fill:#fddposition:fixed","stroke:#c00"]` (measured): the
    // dropped `;` never reaches the declaration gate, so nothing is refused.
    const { document, diagnostics } = parseOk(
      "flowchart TD\n  A --> B\n  style A fill:#fdd;position:fixed,stroke:#c00",
      parseSiren,
    );
    expect(diagnostics).toEqual([]);
    expect(document.styles.map(({ targetIds, properties, line, column }) => ({ targetIds, properties, line, column }))).toEqual([
      {
        targetIds: ["A"],
        properties: [
          { property: "fill", value: "#fddposition:fixed" },
          { property: "stroke", value: "#c00" },
        ],
        line: 3,
        column: 3,
      },
    ]);
  });

  it("leaves every position past it where the author wrote it", () => {
    // `  A["<b style='x:#1'>#35;⚑</b>"] --> C`: the dropped `;` is the 25th
    // character and the ⚑ the 26th, as written.
    expect(positions(`flowchart TB\n  A["<b style='x:#1'>#35;⚑</b>"] --> C`, parseSiren)).toEqual(["warning 2:26"]);
  });
});

/**
 * `linkStyle <address> interpolate <curve> [declarations]` — Mermaid's way
 * of choosing the **Curve** an edge is drawn with. The parser reads the
 * curve name as written; whether it names a curve, and which edges it lands
 * on, is `buildFlowchartModel`'s question.
 */
describe("a flowchart's `linkStyle … interpolate` statement", () => {
  it("reads `linkStyle default interpolate step` as a curve for the default address, with no declarations", () => {
    const { document, diagnostics } = parseOk("flowchart LR\n  A --> B\n  linkStyle default interpolate step");

    expect(diagnostics).toEqual([]);
    expect(document.linkStyles).toEqual([
      { targets: ["default"], interpolate: "step", properties: [], line: 3, column: 3 },
    ]);
  });

  it("reads an index list, the curve, and the declarations written after it on the same line", () => {
    const { document, diagnostics } = parseOk(
      "flowchart LR\n  A --> B --> C\n  linkStyle 0,1 interpolate linear stroke:#f00,stroke-width:2px",
    );

    expect(diagnostics).toEqual([]);
    expect(document.linkStyles).toEqual([
      {
        targets: ["0", "1"],
        interpolate: "linear",
        properties: [
          { property: "stroke", value: "#f00" },
          { property: "stroke-width", value: "2px" },
        ],
        line: 3,
        column: 3,
      },
    ]);
  });
});

/**
 * A `linkStyle` declaration with no `:`. Measured on Mermaid 12.2.0:
 * `linkStyle 0 zz` and `linkStyle 0 interpolate basis zz` are accepted, `zz`
 * written out as a style nothing reads; Siren keeps refusing them (spec
 * decision 2), and says what a declaration looks like. A value holding a
 * space (`stroke:red zz`) is still a `property:value` pair and is passed on
 * as written, as Mermaid does: CSS values hold spaces (`stroke-dasharray: 5 5`).
 */
describe("a flowchart `linkStyle` declaration that is not property:value", () => {
  it.each([["linkStyle 0 zz"], ["linkStyle 0 interpolate basis zz"]])(
    "refuses %s, saying how a declaration is written",
    (statement) => {
      const { document, diagnostics } = parseFlowchart(`flowchart TB\n  A --> B\n  ${statement}`);

      expect(document).toBeNull();
      expect(diagnostics).toEqual([
        {
          severity: "error",
          message: '"zz" is not a style declaration. Write each declaration as property:value, such as stroke:#f00',
          line: 3,
          column: 3,
        },
      ]);
    },
  );

  it("passes a value holding a space through as written", () => {
    const { document, diagnostics } = parseOk("flowchart TB\n  A --> B\n  linkStyle 0 stroke:red zz");

    expect(diagnostics).toEqual([]);
    expect(document.linkStyles.map((style) => style.properties)).toEqual([[{ property: "stroke", value: "red zz" }]]);
  });
});

/**
 * A `%%` in the middle of a flowchart line (CONTEXT.md **Comment**): text
 * inside text, a refusal after a complete statement — measured on Mermaid
 * 12.2.0, whose flowchart lexer has no `%%` rule of its own.
 */
describe("a `%%` in the middle of a flowchart line", () => {
  it("keeps a `%%` on every row of a Markdown string label that spans lines", () => {
    // Measured: "A[\"`a %% b\nc %% d`\"]" records the text "a %% b\nc %% d".
    const { document, diagnostics } = parseOk('flowchart TB\n  A["`a %% b\nc %% d`"] --> B', parseSiren);

    expect(diagnostics).toEqual([]);
    expect(markdownRows(document.nodes[0])).toEqual([
      [{ text: "a %% b", bold: false, italic: false }],
      [{ text: "c %% d", bold: false, italic: false }],
    ]);
  });

  it("keeps a `%%` in an asymmetric node's label, which opens with `>`", () => {
    // Measured: `A>a %% zz]` records the text "a %% zz".
    const { document, diagnostics } = parseOk("flowchart TB\n  A>a %% zz] --> B>b %% c]", parseSiren);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.label.text)).toEqual(["a %% zz", "b %% c"]);
  });

  it("reads a `%%` glued to the end of an id as part of the id", () => {
    // Measured on Mermaid 12.2.0: `A%%B`, `A%%B --> C`, `A-->B%%C`,
    // `A%%B%%C`, `A%%%B`, `A%%`, `A%%[x]`, `A%%:::c` and `A%% --> B` each
    // record the id with its `%%` — the flowchart lexer has no `%%` rule, and
    // only a line that starts with one is a comment.
    const { document, diagnostics } = parseOk(`flowchart TB
  A%%B
  C%%D --> E
  F-->G%%H
  I%%J%%K
  L%%%M
  N%%
  O%%[x]
  P%%:::c
  Q%% --> R`);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.id)).toEqual([
      "A%%B",
      "C%%D",
      "E",
      "F",
      "G%%H",
      "I%%J%%K",
      "L%%%M",
      "N%%",
      "O%%",
      "P%%",
      "Q%%",
      "R",
    ]);
    expect(document.nodes.find((node) => node.id === "O%%")?.label.text).toBe("x");
    expect(document.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["C%%D", "E"],
      ["F", "G%%H"],
      ["Q%%", "R"],
    ]);
  });

  it("still refuses a `%%` written after a space, at the `%%`", () => {
    // Measured: `A %% x` and `A %%B` are both "Expecting 'SEMI', 'NEWLINE',
    // 'EOF', … got 'NODE_STRING'" — two ids in a row, not a comment.
    expect(positions("flowchart TB\n  A %% x")).toEqual(["error 2:5"]);
    expect(positions("flowchart TB\n  A %%B")).toEqual(["error 2:5"]);
    expect(parseFlowchart("flowchart TB\n  A %%B").diagnostics[0]?.message).toMatch(/^A "%%" in the middle of a line/);
  });

  it("refuses a `%%` after an edge at the `%%`, read by the flowchart parser itself", () => {
    // `parseFlowchart` is handed the line as Mermaid's grammar is: it is the
    // flowchart's own reading that refuses the `%%`, not the dispatcher's.
    expect(positions("flowchart TB\n  A -->|a %% b| B[c %% d] %% e")).toEqual(["error 2:27"]);
  });
});

/**
 * Where a flowchart statement's text runs, for every reader that cuts a
 * line — at `;`, at `&`, at an arrow, at a `%%` — measured on Mermaid
 * 12.2.0 with `pnpm --filter siren-core probe`.
 */
describe("the text a flowchart line holds, which no separator cuts", () => {
  it("reads an asymmetric node's label, opened by the `>` right after its id, as one label whatever separator it holds", () => {
    // Measured: `A>a;b] --> B`, `A>a-->b] --> B` and `A>a&b] --> B` record
    // the texts "a;b", "a-->b" and "a&b", each with one edge to B.
    for (const [source, text] of [
      ["A>a;b] --> B", "a;b"],
      ["A>a-->b] --> B", "a-->b"],
      ["A>a&b] --> B", "a&b"],
    ] as const) {
      const { document, diagnostics } = parseOk(`flowchart TB\n  ${source}`);

      expect([source, diagnostics]).toEqual([source, []]);
      expect([source, document.nodes.map((node) => [node.id, node.label.text, node.shape])]).toEqual([
        source,
        [
          ["A", text, "asymmetric"],
          ["B", "B", "rect"],
        ],
      ]);
      expect([source, document.edges.map((edge) => [edge.from, edge.to])]).toEqual([source, [["A", "B"]]]);
    }
  });

  it("lets any closer close a label, so a label holding another bracket's closer is not read whole", () => {
    // Measured: Mermaid refuses `A[a)-->b] --> B` ("got 'PE'") and
    // `A>a)-->b] --> B` alike — a closer that is not the label's own is
    // never a character of it — so neither is read here as one node.
    for (const source of ["A[a)-->b] --> B", "A>a)-->b] --> B", "A[a}-->b] --> B"]) {
      expect([source, parseFlowchart(`flowchart TB\n  ${source}`).document]).toEqual([source, null]);
    }
  });

  it("reads a quoted string outside any bracket as one piece of text, as a `click`'s link and tooltip are", () => {
    // Measured: `click A "https://x.org/a;b" "t;u"` is accepted — the `;`
    // inside each string is a character, not the end of the statement.
    const { document, diagnostics } = parseOk('flowchart TB\n  A\n  click A "https://x.org/a;b" "t;u"');

    expect(diagnostics).toEqual([]);
    expect(document.interactions.map(({ action, tooltip }) => [action, tooltip])).toEqual([
      ["https://x.org/a;b", "t;u"],
    ]);
  });
});
