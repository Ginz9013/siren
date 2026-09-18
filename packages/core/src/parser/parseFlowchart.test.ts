import { describe, expect, it } from "vitest";
import { parseFlowchart } from "./parseFlowchart";
import type { Diagnostic, FlowchartDocument } from "../contracts";

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

describe("a flowchart node's label", () => {
  it("trims the padding around a label, whether or not it is quoted", () => {
    const source = `flowchart TB
  A[  padded  ] --> B["  padded  "]`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.label)).toEqual(["padded", "padded"]);
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
    expect(document.nodes.find((node) => node.id === "a.b")?.label).toBe("Label");
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

describe("a flowchart's bare node declarations", () => {
  it("declares a node from a bare id on its own line, outside any subgraph", () => {
    const source = `flowchart TB
  Orphan
  A --> B`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.id)).toEqual(["Orphan", "A", "B"]);
    expect(document.nodes.find((node) => node.id === "Orphan")?.label).toBe("Orphan");
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
        line: 4,
        column: 3,
      },
      {
        interactionKind: "href",
        targetId: "B",
        action: "https://example.org",
        argument: null,
        tooltip: "Read the docs",
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

  it("refuses href's target attribute, rather than truncating it to the 3-argument form", () => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB
  A[Start]
  click A href "https://example.com" "tip" _blank
`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'Unrecognized flowchart line: "click A href "https://example.com" "tip" _blank"',
        line: 3,
        column: 3,
      },
    ]);
  });

  it("refuses the bare callback-name shorthand", () => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB
  A[Start]
  click A myFn
`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'Unrecognized flowchart line: "click A myFn"',
        line: 3,
        column: 3,
      },
    ]);
  });

  it("refuses a tooltip-only click, with no href or call", () => {
    const { document, diagnostics } = parseFlowchart(`flowchart TB
  A[Start]
  click A "tip"
`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'Unrecognized flowchart line: "click A "tip""',
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
