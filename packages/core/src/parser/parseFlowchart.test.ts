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
