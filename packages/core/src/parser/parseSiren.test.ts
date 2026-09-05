import { describe, expect, it } from "vitest";
import { parseSiren } from "./parseSiren";
import type {
  ClassDocument,
  Diagnostic,
  FlowchartDocument,
  SequenceDocument,
} from "../contracts";

/**
 * Asserts a `parseSiren` call produced a flowchart document and narrows to
 * `FlowchartDocument`, so existing tests below can keep accessing
 * flowchart-only fields now that `SirenDocument` is a `kind`-discriminated
 * union.
 */
function parseFlowchartOk(source: string): {
  document: FlowchartDocument;
  diagnostics: Diagnostic[];
} {
  const { document, diagnostics } = parseSiren(source);
  if (document === null || document.kind !== "flowchart") {
    throw new Error(
      `expected a flowchart document, got ${document === null ? "null" : document.kind}`,
    );
  }
  return { document, diagnostics };
}

describe("parseSiren", () => {
  it("parses a minimal flowchart with inline edge node declarations and a timeline block", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[Process]
  B --> C[End]

timeline:
  step 1: enter B fade
  step 2: enter C fade
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    // `flowchart TD` still parses; it resolves to the one spelling, `TB`.
    expect(document.direction).toBe("TB");
    expect(document.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C"]);
    expect(document.edges).toHaveLength(2);
    expect(document.edges.map((e) => ({ from: e.from, to: e.to }))).toEqual([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ]);
    expect(document.timeline).not.toBeNull();
    expect(document.timeline!.entries.map((e) => e.step)).toEqual([1, 2]);
  });

  it("accepts flowchart LR and sets direction to LR", () => {
    const source = `flowchart LR
  A[Start]
  A --> B[End]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document.direction).toBe("LR");
  });

  it("accepts flowchart TB, the spelling Mermaid's own documentation leads with", () => {
    const source = `flowchart TB
  A[Start]
  A --> B[End]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.direction).toBe("TB");
  });

  it("accepts the BT and RL headers a class diagram has always accepted", () => {
    for (const direction of ["BT", "RL"] as const) {
      const source = `flowchart ${direction}
  A[Start]
  A --> B[End]
`;

      const { document, diagnostics } = parseFlowchartOk(source);

      expect(diagnostics).toEqual([]);
      expect(document.direction).toBe(direction);
    }
  });

  it("normalizes the TD alias to TB, so nothing downstream sees two spellings of one direction", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[End]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.direction).toBe("TB");
  });

  it("names every accepted flowchart direction when it rejects a header", () => {
    const source = `flowchart SIDEWAYS
  A[Start]
`;

    const { document, diagnostics } = parseSiren(source);

    expect(document).toBeNull();
    const message = diagnostics[0].message;
    for (const spelling of ["TB", "BT", "LR", "RL"]) {
      expect(message).toContain(`flowchart ${spelling}`);
    }
  });

  it("reports an error diagnostic and returns a null document for a malformed edge line, without throwing", () => {
    const source = `flowchart TD
  A[Start]
  A -->
`;

    expect(() => parseSiren(source)).not.toThrow();

    const { document, diagnostics } = parseSiren(source);

    expect(document).toBeNull();
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("keeps the first label and emits a warning when a node id is redeclared with different bracket text", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[End]
  A[Begin]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(document).not.toBeNull();
    const nodeA = document.nodes.find((n) => n.id === "A");
    expect(nodeA?.label).toBe("Start");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
  });

  /**
   * The guard on the narrowing below. A label is allowed to *contain* a
   * character that also opens a shape — `a/b`, `x (y)` and `100%` are
   * ordinary labels, and an over-tight pattern that refused them would be
   * its own compatibility bug, traded for the one it fixed.
   */
  it("keeps drawing a label that merely contains a character a shape opener also uses", () => {
    const source = `flowchart TB
  A[a/b]
  B[x (y)]
  C[100%]
  D[Plain label]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => n.label)).toEqual([
      "a/b",
      "x (y)",
      "100%",
      "Plain label",
    ]);
  });

  it("rejects `A[(DB)]` as a cylinder instead of drawing a rectangle labelled `(DB)`", () => {
    const source = `flowchart TB
  A[(DB)]
`;

    const { document, diagnostics } = parseSiren(source);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message:
          'Siren does not draw a cylinder (`A[(text)]`) yet: "A[(DB)]"',
        line: 2,
        column: 3,
      },
    ]);
  });

  it("names each slash-and-backslash bracket shape rather than reading its punctuation as a label", () => {
    // Mermaid's own four names for the four pairings, so the diagnostic
    // tells an author which shape it thinks they wrote.
    const forms: ReadonlyArray<[string, string]> = [
      ["A[/Process/]", "a parallelogram (`A[/text/]`)"],
      ["A[\\Process\\]", "a parallelogram alt (`A[\\text\\]`)"],
      ["A[/Trapezoid\\]", "a trapezoid (`A[/text\\]`)"],
      ["A[\\Trapezoid/]", "a trapezoid alt (`A[\\text/]`)"],
    ];

    for (const [declaration, described] of forms) {
      const { document, diagnostics } = parseSiren(
        `flowchart TB\n  ${declaration}\n`,
      );

      expect(document).toBeNull();
      expect(diagnostics.map((d) => d.message)).toEqual([
        `Siren does not draw ${described} yet: "${declaration}"`,
      ]);
    }
  });

  it("names the subroutine box in `A[[Subroutine]]` instead of calling the line unrecognized", () => {
    // Already an error today, but the wrong one: an author who wrote valid
    // Mermaid is told their line makes no sense rather than that this one
    // shape is not drawn yet, which is the difference between "wait" and
    // "rewrite it".
    const source = `flowchart TB
  A[[Subroutine]]
`;

    const { document, diagnostics } = parseSiren(source);

    expect(document).toBeNull();
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Siren does not draw a subroutine box (`A[[text]]`) yet: "A[[Subroutine]]"',
    ]);
  });

  it("rejects a quoted label instead of drawing the quotation marks as part of it", () => {
    const source = `flowchart TB
  A["Quoted, with comma"]
`;

    const { document, diagnostics } = parseSiren(source);

    expect(document).toBeNull();
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Siren does not draw a quoted label (`A["text"]`) yet: ' +
        '"A["Quoted, with comma"]"',
    ]);
  });

  it("leaves a quote in the middle of a label alone — only a fenced label is a quoted one", () => {
    const source = `flowchart TB
  A[say "hi" now]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => n.label)).toEqual(['say "hi" now']);
  });

  it("names a Markdown string label as Markdown, not merely as a quoted label", () => {
    // Mermaid draws **bold** as bold text here. Siren drew the backticks
    // and the asterisks; naming the construct is what tells an author the
    // feature is missing rather than that their quoting was wrong.
    const source = `flowchart TB
  A["\`**bold**\`"]
`;

    const { document, diagnostics } = parseSiren(source);

    expect(document).toBeNull();
    expect(diagnostics.map((d) => d.message)).toEqual([
      "Siren does not draw a Markdown string label (a quoted label fenced " +
        'in backticks) yet: "A["`**bold**`"]"',
    ]);
  });

  it("refuses a shape written at an edge endpoint too — where it is written must not decide what it means", () => {
    const source = `flowchart TB
  A[(DB)] --> B[Read]
  C[Write] --> D[/Report/]
`;

    const { document, diagnostics } = parseSiren(source);

    expect(document).toBeNull();
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Siren does not draw a cylinder (`A[(text)]`) yet: "A[(DB)] --> B[Read]"',
      'Siren does not draw a parallelogram (`A[/text/]`) yet: "C[Write] --> D[/Report/]"',
    ]);
  });

  it("parses all four timeline verbs with the correct kind/targetId/step, and effect only where expected", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[Process]

timeline:
  step 1: enter B fade
  step 2: exit A slide-left
  step 3: highlight A-B outline
  step 4: unhighlight A-B
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document.timeline!.entries).toEqual([
      { kind: "enter", step: 1, targetId: "B", effect: "fade", line: 6, column: 3 },
      { kind: "exit", step: 2, targetId: "A", effect: "slide-left", line: 7, column: 3 },
      { kind: "highlight", step: 3, targetId: "A-B", effect: "outline", line: 8, column: 3 },
      { kind: "unhighlight", step: 4, targetId: "A-B", line: 9, column: 3 },
    ]);
  });

  it("parses all four slide directions for both enter and exit", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[Process]

timeline:
  step 1: enter B slide-left
  step 2: enter B slide-right
  step 3: enter B slide-top
  step 4: enter B slide-bottom
  step 5: exit B slide-left
  step 6: exit B slide-right
  step 7: exit B slide-top
  step 8: exit B slide-bottom
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document.timeline!.entries.map((e) => `${e.kind}:${e.effect}`)).toEqual([
      "enter:slide-left",
      "enter:slide-right",
      "enter:slide-top",
      "enter:slide-bottom",
      "exit:slide-left",
      "exit:slide-right",
      "exit:slide-top",
      "exit:slide-bottom",
    ]);
  });

  it("parses highlight with both outline and glow effects", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[Process]

timeline:
  step 1: highlight A-B outline
  step 2: highlight A-B glow
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document.timeline!.entries.map((e) => e.effect)).toEqual([
      "outline",
      "glow",
    ]);
  });

  it("reports an error diagnostic, not a throw, for an effect name not valid for the given verb", () => {
    const source1 = `flowchart TD
  A[Start]

timeline:
  step 1: enter A outline
`;
    expect(() => parseSiren(source1)).not.toThrow();
    const result1 = parseSiren(source1);
    expect(result1.document).toBeNull();
    expect(result1.diagnostics.some((d) => d.severity === "error")).toBe(true);

    const source2 = `flowchart TD
  A[Start]
  A --> B[Process]

timeline:
  step 1: highlight A-B slide-left
`;
    expect(() => parseSiren(source2)).not.toThrow();
    const result2 = parseSiren(source2);
    expect(result2.document).toBeNull();
    expect(result2.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("reports an error diagnostic, not a throw, for a trailing effect token on unhighlight", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[Process]

timeline:
  step 1: unhighlight A-B outline
`;
    expect(() => parseSiren(source)).not.toThrow();
    const { document, diagnostics } = parseSiren(source);
    expect(document).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("dispatches a flowchart document to parseFlowchart, tagged kind: \"flowchart\"", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[End]
`;

    const { document, diagnostics } = parseSiren(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document!.kind).toBe("flowchart");
  });

  it("dispatches a sequenceDiagram document to parseSequenceDiagram, parsing title, both declaration forms, and arrows, tagged kind: \"sequence\"", () => {
    const source = `sequenceDiagram
  title Order confirmation flow
  participant A as Alice
  actor B as Bob
  A->>B: Sync call
  A-->>B: Dotted no arrow
`;

    const { document, diagnostics } = parseSiren(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document!.kind).toBe("sequence");
    const sequenceDocument = document as SequenceDocument;
    expect(sequenceDocument.title).toBe("Order confirmation flow");
    expect(sequenceDocument.participants).toEqual([
      { id: "A", label: "Alice", participantKind: "participant", line: 3, column: 3 },
      { id: "B", label: "Bob", participantKind: "actor", line: 4, column: 3 },
    ]);
    const messages = sequenceDocument.statements.filter((s) => s.kind === "message");
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => (m.kind === "message" ? m.arrow : null))).toEqual([
      { line: "solid", head: "filled" },
      { line: "dotted", head: "filled" },
    ]);
  });

  it("refuses activation shorthand through the dispatching seam too, naming activation", () => {
    // This test used to assert the reverse: it fed `A->>+B` and expected zero
    // diagnostics, because `MESSAGE_RE` matched the `+` and threw it away.
    // Mermaid draws an activation bar and a thickened lifeline for it and
    // Siren draws neither, so the swallow handed the author a wrong picture
    // with nothing in it to say so. Being told what is missing is the point.
    const source = `sequenceDiagram
  participant A
  participant B
  A->>+B: request
  B-->>-A: response
`;

    const { document, diagnostics } = parseSiren(source);

    expect(document).toBeNull();
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Siren does not draw an activation bar (the `+` after the arrow) yet: "A->>+B: request"',
      'Siren does not draw an activation bar (the `-` after the arrow) yet: "B-->>-A: response"',
    ]);
  });

  it("dispatches a classDiagram document to parseClassDiagram, tagged kind: \"class\"", () => {
    const source = `classDiagram
`;

    const { document, diagnostics } = parseSiren(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document!.kind).toBe("class");
  });

  it("accepts the classDiagram-v2 header as the same diagram kind", () => {
    const source = `classDiagram-v2
`;

    const { document, diagnostics } = parseSiren(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document!.kind).toBe("class");
  });

  it("ignores whole-line, indented and trailing %% comments in a flowchart", () => {
    const source = `%% what this diagram is for
flowchart TD
  A[Start]
    %% the interesting bit
  A --> B[End] %% and back again
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => n.id)).toEqual(["A", "B"]);
    expect(document.edges.map((e) => ({ from: e.from, to: e.to }))).toEqual([
      { from: "A", to: "B" },
    ]);
  });

  it("ignores whole-line and trailing %% comments in a sequence diagram", () => {
    const source = `sequenceDiagram
  %% who is involved
  participant A as Alice
  participant B as Bob
  A->>B: Sync call %% the important one
`;

    const { document, diagnostics } = parseSiren(source);

    expect(diagnostics).toEqual([]);
    expect(document!.kind).toBe("sequence");
    const sequenceDocument = document as SequenceDocument;
    expect(sequenceDocument.participants.map((p) => p.id)).toEqual(["A", "B"]);
    const messages = sequenceDocument.statements.filter((s) => s.kind === "message");
    expect(messages).toHaveLength(1);
    expect(messages[0].kind === "message" && messages[0].text).toBe("Sync call");
  });

  it("ignores whole-line, indented and trailing %% comments in a class diagram", () => {
    const source = `%% the domain, roughly
classDiagram
    %% ducks are animals
  Animal <|-- Duck %% and so are fish
`;

    const { document, diagnostics } = parseSiren(source);

    expect(diagnostics).toEqual([]);
    expect(document!.kind).toBe("class");
    const classDocument = document as ClassDocument;
    expect(classDocument.classes.map((c) => c.id)).toEqual(["Animal", "Duck"]);
    expect(classDocument.relationships).toHaveLength(1);
  });

  it("strips %% line-wise, so a %% inside message text starts a comment there too", () => {
    // Documented decision (see parseSiren.ts): comments are stripped
    // line-wise before parsing, exactly as Mermaid does, so `%%` starts a
    // comment even inside quoted text or a label. There is no escape.
    const source = `sequenceDiagram
  participant A as Alice
  participant B as Bob
  A->>B: 50%% done
`;

    const { document, diagnostics } = parseSiren(source);

    expect(diagnostics).toEqual([]);
    const messages = (document as SequenceDocument).statements.filter((s) => s.kind === "message");
    expect(messages[0].kind === "message" && messages[0].text).toBe("50");
  });

  it("reports an error diagnostic, not a throw, for a document that is only comments", () => {
    const source = `%% nothing here yet
   %% still nothing
`;

    expect(() => parseSiren(source)).not.toThrow();

    const { document, diagnostics } = parseSiren(source);

    expect(document).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("reports the same error for a second timeline: inside an open timeline block, in all three diagram kinds", () => {
    // The block is declared once. A repeated header inside it is not a
    // second block and not a no-op: it is a line the timeline grammar does
    // not recognise, in every kind. Each source below puts the repeat at
    // line 5, column 3, so the three diagnostics must be identical objects
    // — a future divergence between the kinds fails here rather than being
    // discovered by an extraction three boards later.
    const repeated = {
      flowchart: `flowchart TD
  A[Start]
timeline:
  step 1: enter A fade
  timeline:
`,
      class: `classDiagram
  Animal <|-- Duck
timeline:
  step 1: enter Animal fade
  timeline:
`,
      sequence: `sequenceDiagram
  participant A as Alice
timeline:
  step 1: enter A fade
  timeline:
`,
    };

    const expected: Diagnostic[] = [
      {
        severity: "error",
        message: 'Unrecognized timeline line: "timeline:"',
        line: 5,
        column: 3,
      },
    ];

    for (const [kind, source] of Object.entries(repeated)) {
      const { document, diagnostics } = parseSiren(source);

      expect(document, kind).toBeNull();
      expect(diagnostics, kind).toEqual(expected);
    }
  });

  it("records a flowchart `style` statement as a StyleDecl instead of calling the line unrecognized", () => {
    const source = `flowchart TD
  A[Start] --> B[End]
  style A fill:#fdd,stroke:#c00
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    // The same shape a class diagram's `style` parses to — one statement,
    // one target, its declarations in author order — because the contract
    // is the language's, not the class diagram's.
    expect(document.styles).toEqual([
      {
        styleKind: "style",
        authoredAs: "style",
        targetIds: ["A"],
        name: null,
        properties: [
          { property: "fill", value: "#fdd" },
          { property: "stroke", value: "#c00" },
        ],
        line: 3,
        column: 3,
      },
    ]);
  });

  it("keeps a value's own commas and colons inside one flowchart declaration", () => {
    const source = `flowchart TD
  A[Start]
  style A fill:rgb(255, 0, 0),stroke-width:2px
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.styles[0].properties).toEqual([
      { property: "fill", value: "rgb(255, 0, 0)" },
      { property: "stroke-width", value: "2px" },
    ]);
  });

  it("diagnoses a flowchart style segment that is not a property:value pair, keeping the pairs around it", () => {
    const source = `flowchart TD
  A[Start]
  style A fill:#fdd,oops,stroke:#c00
`;

    const { document, diagnostics } = parseSiren(source);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'Unrecognized style declaration: "oops"',
        line: 3,
        column: 3,
      },
    ]);
  });

  it("records a flowchart `classDef` as a named definition that targets nothing on its own", () => {
    const source = `flowchart TD
  A[Start] --> B[End]
  classDef emphasis fill:#fdd,stroke:#c00
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    // Byte-for-byte the shape a class diagram's `classDef` parses to: it
    // defines a name and targets nothing, and pairing it with whoever
    // applies it is `resolveStyles`' pass, not the parser's.
    expect(document.styles).toEqual([
      {
        styleKind: "classDef",
        authoredAs: "classDef",
        targetIds: [],
        name: "emphasis",
        properties: [
          { property: "fill", value: "#fdd" },
          { property: "stroke", value: "#c00" },
        ],
        line: 3,
        column: 3,
      },
    ]);
  });

  it("records a flowchart `class A,B name` as the apply-directive, under the keyword the author typed", () => {
    const source = `flowchart TD
  A[Start] --> B[End]
  class A,B emphasis
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    // One canonical kind for both spellings: a flowchart writes `class` and
    // a class diagram writes `cssClass`, and only `authoredAs` — which no
    // logic reads, only diagnostics quote — remembers which.
    expect(document.styles).toEqual([
      {
        styleKind: "apply",
        authoredAs: "class",
        targetIds: ["A", "B"],
        name: "emphasis",
        properties: [],
        line: 3,
        column: 3,
      },
    ]);
  });

  it("applies a definition at the node declaration itself in both `:::` forms, and the bare form claims no label from a node an edge already labelled", () => {
    const source = `flowchart TD
  A[Start]:::emphasis
  A --> B[End]
  B:::emphasis
  C:::emphasis
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    // The bare form is a shorthand for applying, not for declaring a label:
    // it gives an id nothing else declares the id as its label, and leaves
    // the label an edge already wrote alone rather than fighting it.
    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label])).toEqual([
      ["A", "Start"],
      ["B", "End"],
      ["C", "C"],
    ]);
    // One apply-directive per shorthand, quoting `:::` — the keyword the
    // author typed. Telling them their `class` is wrong points at a line
    // they never wrote.
    expect(document.styles).toEqual([
      {
        styleKind: "apply",
        authoredAs: ":::",
        targetIds: ["A"],
        name: "emphasis",
        properties: [],
        line: 2,
        column: 3,
      },
      {
        styleKind: "apply",
        authoredAs: ":::",
        targetIds: ["B"],
        name: "emphasis",
        properties: [],
        line: 4,
        column: 3,
      },
      {
        styleKind: "apply",
        authoredAs: ":::",
        targetIds: ["C"],
        name: "emphasis",
        properties: [],
        line: 5,
        column: 3,
      },
    ]);
  });

  it("applies a `:::` shorthand written on a labelled edge endpoint, declaring both endpoints as usual", () => {
    const source = `flowchart TD
  A[Start]:::emphasis --> B[End]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    // The shorthand rides along with the endpoint; it does not take the
    // label away from it, and the far endpoint is untouched.
    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label])).toEqual([
      ["A", "Start"],
      ["B", "End"],
    ]);
    expect(document.edges.map((edge) => [edge.from, edge.to])).toEqual([["A", "B"]]);
    expect(document.styles).toEqual([
      {
        styleKind: "apply",
        authoredAs: ":::",
        targetIds: ["A"],
        name: "emphasis",
        properties: [],
        line: 2,
        column: 3,
      },
    ]);
  });

  it("lets the bare `A:::name --> B` apply without claiming a label, keeping one an earlier edge wrote", () => {
    const source = `flowchart TD
  A --> B[End]
  B:::emphasis --> C
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    // Ticket 04's rule for the standalone bare form, in the edge position:
    // the shorthand applies, and declares only what nothing else has. So B
    // keeps `End` rather than being redeclared as its own id, and no
    // redeclaration warning fires.
    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label])).toEqual([
      ["A", "A"],
      ["B", "End"],
      ["C", "C"],
    ]);
    expect(document.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["A", "B"],
      ["B", "C"],
    ]);
    expect(document.styles).toEqual([
      {
        styleKind: "apply",
        authoredAs: ":::",
        targetIds: ["B"],
        name: "emphasis",
        properties: [],
        line: 3,
        column: 3,
      },
    ]);
  });

  it("reads the `:::` shorthand on either edge endpoint and on both at once", () => {
    const source = `flowchart TD
  A --> B[End]:::emphasis
  A:::warm --> C:::cold
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label])).toEqual([
      ["A", "A"],
      ["B", "End"],
      ["C", "C"],
    ]);
    // Three positions, three apply-directives, in the order the author
    // wrote them — and on one line, the source endpoint before the target.
    expect(document.styles).toEqual([
      {
        styleKind: "apply",
        authoredAs: ":::",
        targetIds: ["B"],
        name: "emphasis",
        properties: [],
        line: 2,
        column: 3,
      },
      {
        styleKind: "apply",
        authoredAs: ":::",
        targetIds: ["A"],
        name: "warm",
        properties: [],
        line: 3,
        column: 3,
      },
      {
        styleKind: "apply",
        authoredAs: ":::",
        targetIds: ["C"],
        name: "cold",
        properties: [],
        line: 3,
        column: 3,
      },
    ]);
  });

  it("leaves a flowchart document that declares no styling with an empty styles list", () => {
    const { document } = parseFlowchartOk(`flowchart TD
  A[Start] --> B[End]
`);

    expect(document.styles).toEqual([]);
  });

  it("records a flowchart `linkStyle 0` as a link-style statement addressing an edge by declaration index", () => {
    const source = `flowchart TD
  A[Start] --> B[End]
  linkStyle 0 stroke:#f00,stroke-width:2px
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    // The address stays exactly as the author wrote it. Which edge `0`
    // names is `buildFlowchartModel`'s question, asked against the edge ids
    // it assigns — the parser only owns the statement's shape.
    expect(document.linkStyles).toEqual([
      {
        targets: ["0"],
        properties: [
          { property: "stroke", value: "#f00" },
          { property: "stroke-width", value: "2px" },
        ],
        line: 3,
        column: 3,
      },
    ]);
    // It is not a `style`: a `style` targets an id, and there is no id here
    // to target yet.
    expect(document.styles).toEqual([]);
  });

  it("reads a linkStyle's declarations with the same splitter every other styling statement uses", () => {
    const source = `flowchart TD
  A[Start] --> B[End]
  linkStyle 0 stroke:#f00,oops
`;

    const { document, diagnostics } = parseSiren(source);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'Unrecognized style declaration: "oops"',
        line: 3,
        column: 3,
      },
    ]);
  });

  it("reads a linkStyle's `0,2` as several addresses, in the order written", () => {
    const source = `flowchart TD
  A[Start] --> B[Middle]
  B --> C[End]
  linkStyle 0,2 stroke:#f00
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.linkStyles[0].targets).toEqual(["0", "2"]);
  });
});
