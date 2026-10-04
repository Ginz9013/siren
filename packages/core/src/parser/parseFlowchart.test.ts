import { describe, expect, it, vi } from "vitest";
import { parseFlowchart } from "./parseFlowchart";
import type { Diagnostic, FlowchartDocument, SirenNode } from "../contracts";
import { plainRun } from "../label/label";

/**
 * Asserts a `parseFlowchart` call produced a document and narrows it to
 * `FlowchartDocument`, so tests can read flowchart fields without repeating
 * the null check.
 */
function parseOk(source: string): { document: FlowchartDocument; diagnostics: Diagnostic[] } {
  const { document, diagnostics } = parseFlowchart(source);
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
function positions(source: string): string[] {
  return parseFlowchart(source).diagnostics.map((d) => `${d.severity} ${d.line}:${d.column}`);
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
