import { describe, expect, it } from "vitest";
import { parseFlowchart } from "./parseFlowchart";
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

  it("reads a `graph` header as the `flowchart` header it is a spelling of, direction for direction", () => {
    // Mermaid's original keyword, and still the one most documents in the
    // wild open with. Compared against the `flowchart` document rather than
    // against a hand-written expectation on purpose: the claim is not "graph
    // parses", it is that nothing downstream can tell which word was
    // written, `TD` alias included.
    for (const spelling of ["TB", "TD", "BT", "LR", "RL"]) {
      const body = `
  A[Start]
  A --> B[End]
`;

      expect(parseSiren(`graph ${spelling}${body}`)).toEqual(
        parseSiren(`flowchart ${spelling}${body}`),
      );
    }
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

  it("names `graph` as well as `flowchart` when either the dispatcher or the flowchart parser rejects a header", () => {
    // An author who wrote `graph SIDEWAYS` got their keyword right and their
    // direction wrong. A list naming only the `flowchart` spellings would
    // send them off to rewrite the half of the line that was fine, so the
    // accepted set is stated in full — from both places that state it, which
    // is what `listAcceptedHeaders` exists to keep identical.
    const messages = [
      parseSiren("graph SIDEWAYS\n  A[Start]\n").diagnostics[0].message,
      parseFlowchart("graph SIDEWAYS\n  A[Start]\n").diagnostics[0].message,
    ];

    for (const message of messages) {
      for (const keyword of ["flowchart", "graph"]) {
        for (const direction of ["TB", "BT", "LR", "RL"]) {
          expect(message).toContain(`${keyword} ${direction}`);
        }
      }
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

  it("strips the quotes fencing a label, and keeps the punctuation they fenced", () => {
    const source = `flowchart TB
  A["Quoted, with comma"]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => n.label)).toEqual(["Quoted, with comma"]);
  });

  it("lets a fenced label hold the `]` that would otherwise end it, which is what quoting is for", () => {
    // The point of the feature, not merely that two characters were
    // stripped: `]` ends the bracket, so an unquoted label cannot contain
    // one. Mermaid 11.17.2 agrees on both halves — it reads `A["a]b"]` as
    // the label `a]b` and raises a parse error on `A[a]b]`.
    const quoted = `flowchart TB
  A["a]b"]
`;
    const unquoted = `flowchart TB
  A[a]b]
`;

    const fenced = parseFlowchartOk(quoted);
    expect(fenced.diagnostics).toEqual([]);
    expect(fenced.document.nodes.map((n) => n.label)).toEqual(["a]b"]);

    const bare = parseSiren(unquoted);
    expect(bare.document).toBeNull();
    expect(bare.diagnostics.map((d) => d.message)).toEqual([
      'Unrecognized flowchart line: "A[a]b]"',
    ]);
  });

  it("fences a label wherever one may be written — an edge endpoint and a `:::` declaration alike", () => {
    // Checked against Mermaid 11.17.2 rather than assumed: it reads
    // `A["a]b-->c"] --> B["x, y"]` as two nodes and one edge, and takes a
    // `:::` on a fenced endpoint. The label here carries both `]` and
    // `-->`, so the cut into statements has to know where a fence starts —
    // bracket depth alone loses the line at the `]` inside the quotes.
    const source = `flowchart TB
  A["a]b-->c"] --> B["x, y"]:::hot
  classDef hot fill:#fdd
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => `${n.id}=${n.label}`)).toEqual([
      "A=a]b-->c",
      "B=x, y",
    ]);
    expect(document.edges.map((e) => `${e.from}-${e.to}`)).toEqual(["A-B"]);
    expect(
      document.styles
        .filter((style) => style.styleKind === "apply")
        .map((style) => `${style.targetIds.join(",")}:${style.name}`),
    ).toEqual(["B:hot"]);
  });

  it("takes an empty fenced label as empty, and refuses a fence that never closes", () => {
    // Mermaid 11.17.2 raises a parse error on all three, so none of them is
    // a document Siren is obliged to draw — but each has to be answered
    // deliberately rather than by whatever the pattern happens to do.
    //
    // `A[""]` is the fence with nothing inside it, so it is the empty label
    // `A[]` already draws here. `A["]` and `A["""]` have a quote that never
    // closes: there is no fenced label and no ordinary one either, so the
    // line is refused rather than drawn with a stray quote in it.
    const empty = parseFlowchartOk('flowchart TB\n  A[""]\n');
    expect(empty.diagnostics).toEqual([]);
    expect(empty.document.nodes.map((n) => n.label)).toEqual([""]);

    for (const line of ['A["]', 'A["""]']) {
      const { document, diagnostics } = parseSiren(`flowchart TB\n  ${line}\n`);

      expect(document).toBeNull();
      expect(diagnostics.map((d) => d.message)).toEqual([
        `Unrecognized flowchart line: "${line}"`,
      ]);
    }
  });

  it("does not read two quoted runs as one fence — `A[\"hi\" and \"bye\"]` keeps every quote", () => {
    // The mangling this ticket has to avoid. The content begins and ends
    // with a quote, so a fence rule that only looked at the two ends would
    // strip them and hand back `hi" and "bye` — a label nobody wrote, with
    // the quotes that were the author's text now half gone. A fence is a
    // quoted run spanning the whole content, and this is two of them.
    const source = `flowchart TB
  A["hi" and "bye"]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => n.label)).toEqual(['"hi" and "bye"']);
  });

  it("reads `A{text}` as a rhombus, and every other node spelling as a rect", () => {
    // Measured against mermaid 11.17.2 (`pnpm --filter @siren/core probe`):
    // `A{Is it ready?}` is `type="diamond" text="Is it ready?"`, `B[Done]`
    // is `type="square"`, and a bare `C` names no type at all — the default
    // rectangle. The braces are syntax, so they are no more part of the
    // label than the brackets are.
    const source = `flowchart TB
  A{Is it ready?} --> B[Done]
  B --> C
  D:::hot
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["A", "Is it ready?", "rhombus"],
      ["B", "Done", "rect"],
      ["C", "C", "rect"],
      ["D", "D", "rect"],
    ]);
  });

  it("keeps `-->`, `;` and `&` inside a braced label, exactly as it keeps them inside a bracketed one", () => {
    // Carried from ticket 01, which found this and could not fix it inside
    // its own ratchet. `splitOutsideLabel` tracked `[`/`]` and the quote
    // fence but not `{`/`}`, so `A{a-->b}` was cut at the arrow and refused
    // while `A["a-->b"]` worked — two spellings of one idea disagreeing
    // about what a label is.
    //
    // Measured against mermaid 11.17.2 (`pnpm --filter @siren/core probe`):
    // `A{a-->b} --> C` is a diamond labelled `a-->b` with one edge to `C`,
    // `A{a;b}` and `A{a&b}` are diamonds labelled `a;b` and `a&b`, and
    // `A{{a-->b}} --> C` is the same for the hexagon — which is why the
    // counter has to be a depth rather than a flag.
    const source = `flowchart TB
  A{a-->b} --> C
  D{a;b}
  E{a&b}
  F{{a-->b}} --> G
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["A", "a-->b", "rhombus"],
      ["C", "C", "rect"],
      ["D", "a;b", "rhombus"],
      ["E", "a&b", "rhombus"],
      ["F", "a-->b", "hexagon"],
      ["G", "G", "rect"],
    ]);
    expect(document.edges.map((e) => [e.from, e.to])).toEqual([
      ["A", "C"],
      ["F", "G"],
    ]);
  });

  it("reads `A>text]` as the asymmetric flag, a spelling with no opening bracket at all", () => {
    // Board 4's named-shape table never covered this one: it only reads
    // what lies inside `[...]`, and this spelling opens with `>`. So
    // `A>Flag]` reached a plain "Unrecognized flowchart line" rather than a
    // named refusal, and now it draws instead.
    //
    // Measured against mermaid 11.17.2 (`pnpm --filter @siren/core probe`):
    // `A>Flag]` is `type="odd" text="Flag"`, `A>a>b]` is `odd` labelled
    // `a>b` — so a `>` inside the label is ordinary text — and `A>]` is a
    // parse error.
    const source = `flowchart TB
  A>Flag]
  B>a>b]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["A", "Flag", "asymmetric"],
      ["B", "a>b", "asymmetric"],
    ]);
  });

  it("reads `A>text]` at an edge endpoint, where the arrow's own `>` must not be mistaken for the spelling's", () => {
    // The one spelling whose opening character also appears in `-->`. The
    // line is cut into endpoints at the arrow first, so what each pattern
    // ever sees is one endpoint — but a chain is the case that would show a
    // reader getting that wrong, so it is the case asserted.
    const source = `flowchart TB
  A>Flag] --> B>Other]:::hot
  B --> C
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["A", "Flag", "asymmetric"],
      ["B", "Other", "asymmetric"],
      ["C", "C", "rect"],
    ]);
    expect(document.edges.map((e) => [e.from, e.to])).toEqual([
      ["A", "B"],
      ["B", "C"],
    ]);
  });

  it("reads `A{{text}}` as a hexagon, not as a diamond labelled `{text}`", () => {
    // Ticket 01 excluded `{` from `BRACE_LABEL_CONTENT` precisely so this
    // spelling could not be swallowed as a rhombus labelled `{Hexagon}`.
    // Now that a hexagon is drawn, the exclusion earns its keep the other
    // way round: it is what lets the two brace spellings be told apart at
    // all, since `\{…\}` can never reach across an inner brace.
    //
    // Measured against mermaid 11.17.2 (`pnpm --filter @siren/core probe`):
    // `A{{Hexagon}}` is `type="hexagon" text="Hexagon"`, `B{"a}}b"}}`
    // written as `{{"a}}b"}}` is a hexagon labelled `a}}b` — a fenced brace
    // is a label character here exactly as a fenced `]` is — and `A{{a}b}}`
    // is a **parse error**, so an unfenced brace inside the label is not
    // Mermaid and is not read here either.
    const source = `flowchart TB
  A{{Hexagon}}
  B{{"a}}b"}}
  C{Rhombus}
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["A", "Hexagon", "hexagon"],
      ["B", "a}}b", "hexagon"],
      ["C", "Rhombus", "rhombus"],
    ]);
  });

  it("reads `A{{text}}` the same way at an edge endpoint, and still refuses an unfenced brace inside the label", () => {
    const source = `flowchart TB
  A{{Hexagon}} --> B{Ready?}
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["A", "Hexagon", "hexagon"],
      ["B", "Ready?", "rhombus"],
    ]);

    // Mermaid rejects `A{{a}b}}`, so Siren refuses it too rather than
    // inventing a reading for it.
    const refused = parseSiren(`flowchart TB\n  A{{a}b}}\n`);
    expect(refused.document).toBeNull();
    expect(refused.diagnostics.map((d) => d.message)).toEqual([
      'Unrecognized flowchart line: "A{{a}b}}"',
    ]);
  });

  it("reads `A(text)`, `A([text])` and `A[[text]]` as the round, stadium and subroutine spellings", () => {
    // Measured against mermaid 11.17.2 (`pnpm --filter @siren/core probe`):
    // `A(Round)` is `type="round"`, `B([Stadium])` is `type="stadium"` and
    // `C[[Subroutine]]` is `type="subroutine"`, each labelled with the text
    // inside its punctuation. The same probe reads `A(Round) --> B([Stadium])
    // --> C[[Sub]]` as those three shapes joined by two edges, and
    // `A(Round):::hot` as a round node carrying the class — so the spelling
    // means the same thing wherever it is written.
    //
    // The fenced forms come from the probe too: `A(["a]b"])` is a stadium
    // labelled `a]b` and `A[["a]b"]]` a subroutine labelled `a]b`, while the
    // unfenced `A([a]b])` and `A[[a]b]]` are parse errors — the quote is how
    // a Mermaid author writes a closing bracket into one of these labels,
    // exactly as it is inside `A[...]`.
    const source = `flowchart TB
  A(Round)
  B([Stadium])
  C[[Subroutine]]
  D(Round) --> E([Stadium]) --> F[[Sub]]
  G(Round):::hot
  H(["a]b"])
  I[["a]b"]]
classDef hot fill:#fdd
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["A", "Round", "round"],
      ["B", "Stadium", "stadium"],
      ["C", "Subroutine", "subroutine"],
      ["D", "Round", "round"],
      ["E", "Stadium", "stadium"],
      ["F", "Sub", "subroutine"],
      ["G", "Round", "round"],
      ["H", "a]b", "stadium"],
      ["I", "a]b", "subroutine"],
    ]);
    expect(document.edges.map((e) => [e.from, e.to])).toEqual([
      ["D", "E"],
      ["E", "F"],
    ]);
  });

  it("reads the three curved spellings as the shapes Mermaid names them, wherever they are written", () => {
    // The last three bracket spellings, and the two of them that a round
    // node's own pattern is one pair of parentheses away from: `A((Circle))`
    // differs from `A(Round)` by an inner pair and `A(((Double)))` by two,
    // so the label pattern that excludes a parenthesis is what keeps a
    // circle from being read as a round node labelled `(Circle)`. The
    // cylinder is the same question one bracket family over — `A[(DB)]`
    // against `A[DB]`.
    //
    // Measured, not remembered (`pnpm --filter @siren/core probe`, mermaid
    // 11.17.2): `A((Circle))` is `type="circle"`, `A(((Double)))` is
    // `type="doublecircle"` and `A[(DB)]` is `type="cylinder"`, each
    // labelled with the text inside its punctuation and none of the
    // punctuation kept. The fenced forms come from the same probe:
    // `A(("a)b"))` is a circle labelled `a)b`, `A((("x)y")))` a double
    // circle labelled `x)y` and `A[("a)b")]` a cylinder labelled `a)b`,
    // while the unfenced `A((a)b))`, `A[(a)b)]` and `A[(a[b)]` are all
    // parse errors — the quote is how a Mermaid author writes a bracket
    // into one of these labels, exactly as it is inside `A[...]`.
    const source = `flowchart TB
  A((Circle))
  B(((Double)))
  C[(DB)]
  D((Circle)) --> E(((Double))) --> F[(DB)]
  G((Circle)):::hot
  H(("a)b"))
  I((("x)y")))
  J[("a)b")]
classDef hot fill:#fdd
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["A", "Circle", "circle"],
      ["B", "Double", "double-circle"],
      ["C", "DB", "cylinder"],
      ["D", "Circle", "circle"],
      ["E", "Double", "double-circle"],
      ["F", "DB", "cylinder"],
      ["G", "Circle", "circle"],
      ["H", "a)b", "circle"],
      ["I", "x)y", "double-circle"],
      ["J", "a)b", "cylinder"],
    ]);
    expect(document.edges.map((e) => [e.from, e.to])).toEqual([
      ["D", "E"],
      ["E", "F"],
    ]);
  });

  it("keeps `-->`, `;` and `&` inside a parenthesised label too, not only inside a bracketed or braced one", () => {
    // The same gap ticket 01 carried for `{`/`}` and ticket 02b closed,
    // arriving one bracket family later: `splitOutsideLabel` counted `[`,
    // `]`, `{`, `}` and the quote fence, so a round node's own parentheses
    // did not open a label and `A(a-->b)` was cut at the arrow and refused
    // while `A[a-->b]` and `A{a-->b}` worked. Three spellings of one idea
    // disagreeing about what a label is.
    //
    // Measured against mermaid 11.17.2 (`pnpm --filter @siren/core probe`):
    // `A(a-->b)` is a round node labelled `a-->b`, and `A([a-->b])` and
    // `A[[a-->b]]` are the stadium and the subroutine labelled the same
    // way — the last two already worked, since their square brackets were
    // counted, and they are here so the three stay agreed.
    const source = `flowchart TB
  A(a-->b) --> C
  D(a;b)
  E(a&b)
  F([a-->b]) --> G
  H[[a-->b]] --> I
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["A", "a-->b", "round"],
      ["C", "C", "rect"],
      ["D", "a;b", "round"],
      ["E", "a&b", "round"],
      ["F", "a-->b", "stadium"],
      ["G", "G", "rect"],
      ["H", "a-->b", "subroutine"],
      ["I", "I", "rect"],
    ]);
    expect(document.edges.map((e) => [e.from, e.to])).toEqual([
      ["A", "C"],
      ["F", "G"],
      ["H", "I"],
    ]);
  });

  it("reads the four slanted `A[<open>text<close>]` spellings as the two parallelograms and the two trapezoids", () => {
    // Measured against mermaid 11.17.2 (`pnpm --filter @siren/core probe`):
    // `A[/Para/]` is `type="lean_right"`, `B[\Alt\]` is `type="lean_left"`,
    // `C[/Trap\]` is `type="trapezoid"` and `D[\TrapAlt/]` is
    // `type="inv_trapezoid"`. Four spellings that differ only in which way
    // each of two characters leans, so reading them by anything less than
    // both characters would collapse two pairs into one shape each.
    //
    // Their labels carry the slashes back: the probe reads `E[/a\b/]` as
    // `lean_right` labelled `a\b` and `F[\a/\]` as `lean_left` labelled
    // `a/`, so it is the *closing* pair that decides the shape and the
    // label may contain either character.
    const source = `flowchart TB
  A[/Para/]
  B[\\Alt\\]
  C[/Trap\\]
  D[\\TrapAlt/]
  E[/a\\b/]
  F[\\a/\\]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["A", "Para", "parallelogram"],
      ["B", "Alt", "parallelogram-alt"],
      ["C", "Trap", "trapezoid"],
      ["D", "TrapAlt", "trapezoid-alt"],
      ["E", "a\\b", "parallelogram"],
      ["F", "a/", "parallelogram-alt"],
    ]);
  });

  it("reads a slanted spelling the same way at an edge endpoint as on a line of its own", () => {
    // The shape is a property of the node, not of where it was mentioned —
    // the reason `NODE_SPELLINGS` builds both readers. `A[/Para/] --> B` is
    // the same parallelogram `A[/Para/]` on a line by itself is, and
    // mermaid agrees: the probe reads that line as `lean_right` too.
    const source = `flowchart TB
  A[/Para/] --> B[\\Alt\\] --> C[/Trap\\]
  C --> D[\\TrapAlt/]:::hot
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["A", "Para", "parallelogram"],
      ["B", "Alt", "parallelogram-alt"],
      ["C", "Trap", "trapezoid"],
      ["D", "TrapAlt", "trapezoid-alt"],
    ]);
  });

  it("still reads a lone slash or backslash inside `[...]` as an ordinary label, not as an empty slanted shape", () => {
    // The length rule board 4 wrote for `unimplementedFormIn`, kept now
    // that these forms are read rather than refused: `A[/]` is one
    // character of label, so the `/` cannot be both the opening and the
    // closing half of a parallelogram. Mermaid draws a rectangle here too.
    const source = `flowchart TB
  A[/]
  B[\\]
  C[a/b]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label, n.shape])).toEqual([
      ["A", "/", "rect"],
      ["B", "\\", "rect"],
      ["C", "a/b", "rect"],
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

  it("names a Markdown string label as Markdown, drawing **bold** as one bold run", () => {
    // Mermaid draws **bold** as bold text here — the construct this used to
    // be refused by name, before the flowchart leftover-gaps board
    // implemented it.
    const source = `flowchart TB
  A["\`**bold**\`"]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => n.label)).toEqual(["bold"]);
    expect(document.nodes.map((n) => n.labelRuns)).toEqual([
      [[{ text: "bold", bold: true, italic: false }]],
    ]);
  });

  it("reads a form written at an edge endpoint too — where it is written must not decide what it means", () => {
    // Two endpoints on two different lines and at both ends of an arrow, so
    // the rule is visibly about the *place* rather than about one line's
    // shape: a Markdown label declared inline at an edge endpoint parses
    // into the exact same labelRuns a standalone declaration would.
    const source = `flowchart TB
  A["` + "`" + `**bold**` + "`" + `"] --> B[Read]
  C[Write] --> D["` + "`" + `**bold**` + "`" + `"]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    const byId = Object.fromEntries(document.nodes.map((n) => [n.id, n]));
    expect(byId.A.labelRuns).toEqual([[{ text: "bold", bold: true, italic: false }]]);
    expect(byId.D.labelRuns).toEqual([[{ text: "bold", bold: true, italic: false }]]);
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

  it("parses activation shorthand through the dispatching seam too, expanding it into activate/deactivate statements", () => {
    // This test used to assert the opposite: that the seam refused these
    // lines. Siren now draws the activation bar the shorthand describes, so
    // the dispatching seam's job is to pass the expanded statements through
    // unchanged, the same as it does for any other sequence construct.
    const source = `sequenceDiagram
  participant A
  participant B
  A->>+B: request
  B-->>-A: response
`;

    const { document, diagnostics } = parseSiren(source);

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document!.kind).toBe("sequence");
    const statementKinds =
      document!.kind === "sequence" ? document!.statements.map((s) => s.kind) : [];
    expect(statementKinds).toEqual([
      "participant",
      "participant",
      "message",
      "activate",
      "message",
      "deactivate",
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

  it("dispatches both stateDiagram spellings to parseStateDiagram, tagged kind: \"state\"", () => {
    // Measured (mermaid 11.17.2): both report the diagram type
    // `stateDiagram`, so — exactly as with `classDiagram-v2` above — the two
    // spellings are one kind and nothing downstream learns which was
    // written.
    for (const header of ["stateDiagram", "stateDiagram-v2"]) {
      const { document, diagnostics } = parseSiren(`${header}\n`);

      expect(diagnostics, header).toEqual([]);
      expect(document, header).not.toBeNull();
      expect(document!.kind, header).toBe("state");
    }
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

  it("reads a chained `A --> B --> C` as one edge per arrow, declaring every node on the line", () => {
    const { document, diagnostics } = parseFlowchartOk(`flowchart TD
  A --> B --> C
`);

    // The edge ids `timeline:` and `linkStyle` end up addressing are
    // `${from}-${to}`, so the pairs are what a chain has to get right — a
    // count alone would pass for `A-B` twice.
    expect(diagnostics).toEqual([]);
    expect(document.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["A", "B"],
      ["B", "C"],
    ]);
    expect(document.nodes.map((node) => node.id)).toEqual(["A", "B", "C"]);
  });

  it("keeps one edge per arrow at length: a four-node chain is three edges, not two", () => {
    const { document, diagnostics } = parseFlowchartOk(`flowchart TD
  A[Start] --> B --> C --> D[End]
`);

    // Three links rather than two. A two-node chain cannot tell a loop that
    // stops one short from a correct one, and stopping short is the likely
    // bug here — it would silently drop the tail of every longer chain.
    expect(diagnostics).toEqual([]);
    expect(document.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["A", "B"],
      ["B", "C"],
      ["C", "D"],
    ]);
    expect(document.nodes.map((node) => [node.id, node.label])).toEqual([
      ["A", "Start"],
      ["B", "B"],
      ["C", "C"],
      ["D", "End"],
    ]);
  });

  it("expands an `&` group on either side of the arrow into one edge per member", () => {
    const fromGroup = parseFlowchartOk(`flowchart TD
  A & B --> C
`);
    const toGroup = parseFlowchartOk(`flowchart TD
  A --> B & C
`);

    expect(fromGroup.diagnostics).toEqual([]);
    expect(fromGroup.document.edges.map((edge) => `${edge.from}-${edge.to}`)).toEqual([
      "A-C",
      "B-C",
    ]);
    expect(fromGroup.document.nodes.map((node) => node.id)).toEqual(["A", "B", "C"]);

    expect(toGroup.diagnostics).toEqual([]);
    expect(toGroup.document.edges.map((edge) => `${edge.from}-${edge.to}`)).toEqual([
      "A-B",
      "A-C",
    ]);
    expect(toGroup.document.nodes.map((node) => node.id)).toEqual(["A", "B", "C"]);
  });

  it("pairs an `&` group on both sides source-outermost, the order Mermaid produces", () => {
    const { document, diagnostics } = parseFlowchartOk(`flowchart TD
  A & B --> C & D
`);

    // The order is Mermaid's own, not a preference. `FlowDB.addLink` in
    // mermaid 11.17.2 is `for (const start of _start) { for (const end of
    // _end) { ... } }` — sources outermost — and running that parser on
    // this exact source produces A-C, A-D, B-C, B-D in that order.
    expect(diagnostics).toEqual([]);
    expect(document.edges.map((edge) => `${edge.from}-${edge.to}`)).toEqual([
      "A-C",
      "A-D",
      "B-C",
      "B-D",
    ]);
    expect(document.nodes.map((node) => node.id)).toEqual(["A", "B", "C", "D"]);
  });

  it("continues a chain from the whole group the last arrow named, so `&` and chaining compose", () => {
    const oneThenChain = parseFlowchartOk(`flowchart TD
  A & B --> C --> D
`);
    const groupThenChain = parseFlowchartOk(`flowchart TD
  A & B --> C & D --> E
`);

    // What composition means: each arrow pairs the group before it with the
    // group after it, and the next arrow starts from that same second
    // group — not from the line's first group. So `A & B --> C --> D` is
    // three edges, and D is reached only from C. Read off mermaid 11.17.2
    // by running its flowchart parser on both sources.
    expect(oneThenChain.diagnostics).toEqual([]);
    expect(oneThenChain.document.edges.map((edge) => `${edge.from}-${edge.to}`)).toEqual([
      "A-C",
      "B-C",
      "C-D",
    ]);

    // And when that second group has several members, every one of them
    // continues the chain: C-E and D-E, and still nothing from A or B to E.
    expect(groupThenChain.diagnostics).toEqual([]);
    expect(groupThenChain.document.edges.map((edge) => `${edge.from}-${edge.to}`)).toEqual([
      "A-C",
      "A-D",
      "B-C",
      "B-D",
      "C-E",
      "D-E",
    ]);
    expect(groupThenChain.document.nodes.map((node) => node.id)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
  });

  it("ends a statement at `;`, so one line may carry several and a trailing one is spare", () => {
    // In Mermaid `;` is a separator that is also allowed to trail, because
    // an empty statement is legal: running mermaid 11.17.2's own flowchart
    // parser accepts `A --> B;`, `A --> B; B --> C`, `A --> B; B --> C;`,
    // `A --> B ; ; B --> C` and a line that is nothing but `;`, and gives
    // the same two edges for every spelling that names them. So the rule is
    // "`;` ends a statement", and what lies between two of them may be
    // nothing at all.
    for (const line of [
      "A --> B; B --> C;",
      "A --> B; B --> C",
      "A-->B;B-->C;",
      "A --> B ; ; B --> C",
    ]) {
      const { document, diagnostics } = parseFlowchartOk(`flowchart TD\n${line}\n`);

      expect([line, diagnostics]).toEqual([line, []]);
      expect([line, document.edges.map((edge) => `${edge.from}-${edge.to}`)]).toEqual([
        line,
        ["A-B", "B-C"],
      ]);
      expect([line, document.nodes.map((node) => node.id)]).toEqual([line, ["A", "B", "C"]]);
    }
  });

  it("lets a `;` trail any statement kind, and reads a lone `;` as no statement at all", () => {
    const { document, diagnostics } = parseFlowchartOk(`flowchart TD
  ;
  classDef hot fill:#fdd;
  A[Start]:::hot;
  A --> B[End];
  style B stroke:#00f;
  linkStyle 0 stroke:#f00;
  class B hot;
`);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label])).toEqual([
      ["A", "Start"],
      ["B", "End"],
    ]);
    expect(document.edges.map((edge) => `${edge.from}-${edge.to}`)).toEqual(["A-B"]);
    expect(document.styles.map((style) => [style.styleKind, style.authoredAs, style.name])).toEqual(
      [
        ["classDef", "classDef", "hot"],
        ["apply", ":::", "hot"],
        ["style", "style", null],
        ["apply", "class", "hot"],
      ],
    );
    expect(document.linkStyles.map((linkStyle) => linkStyle.targets)).toEqual([["0"]]);
  });

  it("keeps a `;` and an `&` that are inside a label out of the split", () => {
    const { document, diagnostics } = parseFlowchartOk(`flowchart TD
  A[one; two] --> B[three & four]
`);

    // `A[a;b]` and `A[a&b]` are ordinary labels in Mermaid — checked
    // against its own parser — so a splitter that did not know where a
    // label starts would cut them into nonsense.
    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label])).toEqual([
      ["A", "one; two"],
      ["B", "three & four"],
    ]);
    expect(document.edges.map((edge) => `${edge.from}-${edge.to}`)).toEqual(["A-B"]);
  });

  it("diagnoses only the statement that is wrong when a line carries several, at that statement's own column", () => {
    const { document, diagnostics } = parseSiren(`flowchart TD
  A --> B; nonsense here
`);

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'Unrecognized flowchart line: "nonsense here"',
        line: 2,
        column: 12,
      },
    ]);
  });

  it("applies a `:::` at every endpoint a chained or `&` line multiplies, and once per endpoint", () => {
    const { document, diagnostics } = parseFlowchartOk(`flowchart TD
  A:::hot --> B --> C:::cold
  D --> E:::warm --> F
  G:::hot & H:::cold --> I:::warm
`);

    expect(diagnostics).toEqual([]);
    // Once per endpoint that wore one — not once per link the endpoint
    // takes part in. E sits in the middle of a chain and so belongs to two
    // edges; it still applies `warm` a single time.
    expect(document.styles.map((style) => [style.targetIds, style.name])).toEqual([
      [["A"], "hot"],
      [["C"], "cold"],
      [["E"], "warm"],
      [["G"], "hot"],
      [["H"], "cold"],
      [["I"], "warm"],
    ]);
    expect(document.styles.every((style) => style.authoredAs === ":::")).toBe(true);
    // And the shorthand still claims no label, so every node keeps its id.
    expect(document.nodes.map((node) => [node.id, node.label])).toEqual([
      ["A", "A"],
      ["B", "B"],
      ["C", "C"],
      ["D", "D"],
      ["E", "E"],
      ["F", "F"],
      ["G", "G"],
      ["H", "H"],
      ["I", "I"],
    ]);
    expect(document.edges.map((edge) => `${edge.from}-${edge.to}`)).toEqual([
      "A-B",
      "B-C",
      "D-E",
      "E-F",
      "G-I",
      "H-I",
    ]);
  });

  it("refuses a chain whole, declaring nothing from the endpoints it could read", () => {
    // The property board 3's pin was protecting: reading some of a line's
    // nodes and dropping the rest would draw a diagram nobody wrote. Proven
    // with an arrow token that is not readable at all — here `o--x`, whose
    // two ends disagree, in the middle of the line. It used to be `==>`,
    // which was refused for the same reason until a thick line became one of
    // the three an edge can be drawn with; the Markdown label used to be a
    // second demonstration of the same rule here, until the flowchart
    // leftover-gaps board implemented it — the rule this test is about is
    // the refusal being total, not which construct triggers it, and one
    // still-unreadable construct is enough to show that.
    //
    // The redeclaration warning is what makes "nothing was taken" observable
    // — `A` already has a label, so if the first endpoint had been declared
    // before the refusal there would be a warning sitting next to the error.
    const unreadable = parseSiren(`flowchart TD
  A[Start]
  A[Other] --> B o--x C
`);

    expect(unreadable.document).toBeNull();
    expect(unreadable.diagnostics).toEqual([
      {
        severity: "error",
        message: 'Siren does not draw the arrow "o--x" yet: "A[Other] --> B o--x C"',
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

/**
 * An arrow token is not a name, it is a decomposition: a line style, an end
 * on each side, and a distance. Every test here reads the four fields the
 * token produced rather than a token name, for the reason `SequenceArrow`
 * and `ClassRelationship` are shaped the same way — thirteen spellings
 * compose out of three small axes, and a fourteenth name for a combination
 * of them would be a vocabulary nobody could compose in.
 *
 * Every expectation below was measured against mermaid 11.17.2 with
 * `scripts/mermaid-probe.mjs`, whose flowchart reader prints exactly the
 * three axes its own parser records (`type`, `stroke`, `length`). The
 * measurement is quoted in the test that depends on it.
 */
describe("the arrow token an edge is written with", () => {
  /** The `{ line, fromEnd, toEnd, minLength }` each of a document's edges decomposed to. */
  const formsOf = (source: string) => {
    const { document, diagnostics } = parseFlowchartOk(`flowchart TB\n  ${source}\n`);
    expect(diagnostics).toEqual([]);
    return document.edges.map((edge) => ({
      line: edge.line,
      fromEnd: edge.fromEnd,
      toEnd: edge.toEnd,
      minLength: edge.minLength,
    }));
  };

  it("reads `A --> B` as a solid line with an arrow on its to-end, one rank long", () => {
    // The plain arrow is one state of the decomposition rather than the
    // absence of one — `type="arrow_point" stroke="normal" length=1` in
    // mermaid 11.17.2, measured, and every field is required here for the
    // same reason `GraphNode.shape` is required for a rectangle.
    expect(formsOf("A --> B")).toEqual([
      { line: "solid", fromEnd: "none", toEnd: "arrow", minLength: 1 },
    ]);
  });

  it("reads the line out of what the token is drawn with, and the ends out of its markers", () => {
    // One row per spelling, each naming the `type`/`stroke` mermaid 11.17.2
    // recorded for it (`pnpm --filter @siren/core probe`). Written as a
    // table because the point is that thirteen spellings are three axes:
    // every row below is a *combination*, and none of them is a special
    // case in the parser.
    const measured: [string, string, string, string][] = [
      // token          mermaid `type`         mermaid `stroke`   line
      ["A --- B", "arrow_open", "normal", "solid"],
      ["A -.-> B", "arrow_point", "dotted", "dotted"],
      ["A -.- B", "arrow_open", "dotted", "dotted"],
      ["A ==> B", "arrow_point", "thick", "thick"],
      ["A === B", "arrow_open", "thick", "thick"],
    ];
    const ends: Record<string, [string, string]> = {
      arrow_open: ["none", "none"],
      arrow_point: ["none", "arrow"],
    };

    expect(
      measured.map(([source, type, , line]) => [source, line, ...ends[type]]),
    ).toEqual(
      measured.map(([source, type, , line]) => {
        const [form] = formsOf(source);
        return [source, form.line, form.fromEnd, form.toEnd];
      }),
    );
  });

  it("puts a lone marker on the to-end, and a repeated one on both", () => {
    // Which end a marker lands on is the question this ticket was told to
    // measure rather than recall. Mermaid reads `A --o B` as
    // `type="arrow_circle"` and turns that into `arrowTypeStart: "none",
    // arrowTypeEnd: "arrow_circle"` — so the circle is at B. Only the
    // doubled spellings (`double_arrow_*`) decorate both ends.
    expect([
      formsOf("A --o B")[0],
      formsOf("A --x B")[0],
      formsOf("A <--> B")[0],
      formsOf("A o--o B")[0],
      formsOf("A x--x B")[0],
    ]).toEqual([
      { line: "solid", fromEnd: "none", toEnd: "circle", minLength: 1 },
      { line: "solid", fromEnd: "none", toEnd: "cross", minLength: 1 },
      { line: "solid", fromEnd: "arrow", toEnd: "arrow", minLength: 1 },
      { line: "solid", fromEnd: "circle", toEnd: "circle", minLength: 1 },
      { line: "solid", fromEnd: "cross", toEnd: "cross", minLength: 1 },
    ]);
  });

  it("composes the three axes freely: `<-.->` is a dotted line with an arrow at each end", () => {
    // The whole reason for decomposing rather than enumerating. Neither of
    // these is a name anyone had to add: they fall out of a line and two
    // ends, and Mermaid agrees — `double_arrow_point` with `stroke="dotted"`
    // and `stroke="thick"` respectively.
    expect([formsOf("A <-.-> B")[0], formsOf("A <==> B")[0]]).toEqual([
      { line: "dotted", fromEnd: "arrow", toEnd: "arrow", minLength: 1 },
      { line: "thick", fromEnd: "arrow", toEnd: "arrow", minLength: 1 },
    ]);
  });

  it("reads a dotted arrow written without its leading dash, on either end", () => {
    // The short dotted spellings, measured with `pnpm --filter @siren/core
    // probe` against mermaid 11.17.2: `A .-> B` is `type="arrow_point"
    // stroke="dotted" length=1` and `A .- B` is the `arrow_open` of the
    // same. Both are documents Mermaid draws, so the absolute condition
    // says Siren draws them — the dash on the left of the dots is
    // decoration, not grammar.
    expect([formsOf("A .-> B")[0], formsOf("A .- B")[0]]).toEqual([
      { line: "dotted", fromEnd: "none", toEnd: "arrow", minLength: 1 },
      { line: "dotted", fromEnd: "none", toEnd: "none", minLength: 1 },
    ]);
  });

  it("counts a longer token as more ranks — dashes for a solid line, dots for a dotted one", () => {
    // `length` in mermaid 11.17.2, measured for each: an extra dash is an
    // extra rank, and a dotted token counts its *dots* instead, which is
    // why this cannot be "count the dashes".
    expect([
      formsOf("A ---> B")[0].minLength,
      formsOf("A ----> B")[0].minLength,
      formsOf("A ---- B")[0].minLength,
      formsOf("A ----- B")[0].minLength,
      formsOf("A ====> B")[0].minLength,
      formsOf("A -..-> B")[0].minLength,
      formsOf("A -...-> B")[0].minLength,
      formsOf("A -..- B")[0].minLength,
    ]).toEqual([2, 3, 2, 3, 3, 2, 3, 2]);
  });

  it("gives each link of a chain its own arrow", () => {
    // A line is a chain of links, and the token is a property of the link
    // rather than of the line: reading the first token and reusing it would
    // draw the second edge as the wrong picture with nothing to notice.
    expect(formsOf("A --> B ==> C -.- D")).toEqual([
      { line: "solid", fromEnd: "none", toEnd: "arrow", minLength: 1 },
      { line: "thick", fromEnd: "none", toEnd: "arrow", minLength: 1 },
      { line: "dotted", fromEnd: "none", toEnd: "none", minLength: 1 },
    ]);
  });

  it("gives every edge of an `&` group the arrow that group was joined with", () => {
    expect(formsOf("A & B -.-> C & D")).toEqual([
      { line: "dotted", fromEnd: "none", toEnd: "arrow", minLength: 1 },
      { line: "dotted", fromEnd: "none", toEnd: "arrow", minLength: 1 },
      { line: "dotted", fromEnd: "none", toEnd: "arrow", minLength: 1 },
      { line: "dotted", fromEnd: "none", toEnd: "arrow", minLength: 1 },
    ]);
  });

  it("composes the short dotted body with every end and every length, and refuses the two spellings Mermaid will not draw", () => {
    // The whole family, measured with `pnpm --filter @siren/core probe`
    // against mermaid 11.17.2 before a character of the pattern moved.
    // Written as one table because the point is that dropping the leading
    // dash is a property of the *body* and composes with everything else:
    // not one of these rows is a special case in the parser.
    //
    //   A .-> B     arrow_point         dotted length=1
    //   A .- B      arrow_open          dotted length=1
    //   A ..-> B    arrow_point         dotted length=2
    //   A ...-> B   arrow_point         dotted length=3
    //   A ..- B     arrow_open          dotted length=2
    //   A .-o B     arrow_circle        dotted length=1
    //   A .-x B     arrow_cross         dotted length=1
    //   A <.-> B    double_arrow_point  dotted length=1
    //   A o.-o B    double_arrow_circle dotted length=1
    //   A x.-x B    double_arrow_cross  dotted length=1
    expect([
      formsOf("A ..-> B")[0],
      formsOf("A ...-> B")[0],
      formsOf("A ..- B")[0],
      formsOf("A .-o B")[0],
      formsOf("A .-x B")[0],
      formsOf("A <.-> B")[0],
      formsOf("A o.-o B")[0],
      formsOf("A x.-x B")[0],
    ]).toEqual([
      { line: "dotted", fromEnd: "none", toEnd: "arrow", minLength: 2 },
      { line: "dotted", fromEnd: "none", toEnd: "arrow", minLength: 3 },
      { line: "dotted", fromEnd: "none", toEnd: "none", minLength: 2 },
      { line: "dotted", fromEnd: "none", toEnd: "circle", minLength: 1 },
      { line: "dotted", fromEnd: "none", toEnd: "cross", minLength: 1 },
      { line: "dotted", fromEnd: "arrow", toEnd: "arrow", minLength: 1 },
      { line: "dotted", fromEnd: "circle", toEnd: "circle", minLength: 1 },
      { line: "dotted", fromEnd: "cross", toEnd: "cross", minLength: 1 },
    ]);

    // The two the table above does not contain, and a spelling Mermaid
    // refuses is one Siren must refuse too. `A .--> B` is a parse error
    // there ("Expecting 'SQE', ... got '1'"), and `A <.- B` is the silent
    // reading `A <-.- B` already stands for: an `arrow_open` whose `<`
    // vanishes, a picture the author did not write with no diagnostic.
    for (const source of ["A .--> B", "A <.- B"]) {
      const { document } = parseSiren(`flowchart TB\n  ${source}\n`);
      expect([source, document]).toEqual([source, null]);
    }
  });

  it("does not read the `.` inside an id as the start of a dotted arrow", () => {
    // The collateral question every widening of this pattern has to answer:
    // **what else in this grammar can contain the character it now reads?**
    // A node id can. `a.-b --> c` is *one* node called `a.-b` with one edge
    // to `c` in mermaid 11.17.2, measured with the probe, and the boundary
    // is whitespace: `A .->B` is a dotted edge there while `A.->B` is a
    // parse error, both measured.
    //
    // So a leading `.` opens an arrow only where an id cannot be — exactly
    // the rule the `o` and `x` markers already follow, for exactly the same
    // reason. Once the id alphabet was widened to admit `.` (the
    // `fc-node-id-dot` ticket), Siren draws `a.-b` under that same reading
    // rather than merely refusing it: this guard is what leaves the `.-`
    // whole for the id reader, instead of cutting the line at it and
    // drawing three nodes and two edges where Mermaid draws two and one.
    const dotDash = parseSiren("flowchart TB\n  a.-b --> c\n");
    expect(dotDash.diagnostics).toEqual([]);
    expect(dotDash.document?.kind).toBe("flowchart");
    if (dotDash.document?.kind === "flowchart") {
      expect(dotDash.document.nodes.map((node) => node.id)).toEqual(["a.-b", "c"]);
      expect(dotDash.document.edges).toEqual([
        expect.objectContaining({ from: "a.-b", to: "c" }),
      ]);
    }

    const bareThird = parseSiren("flowchart TB\n  A --> B; C.-D\n");
    expect(bareThird.diagnostics).toEqual([]);
    expect(bareThird.document?.kind).toBe("flowchart");
    if (bareThird.document?.kind === "flowchart") {
      expect(bareThird.document.nodes.map((node) => node.id)).toEqual(["A", "B", "C.-D"]);
      expect(bareThird.document.edges).toEqual([expect.objectContaining({ from: "A", to: "B" })]);
    }
  });

  it("refuses a token whose two ends disagree, rather than drawing Mermaid's silent reading of it", () => {
    // The one place this diverges from Mermaid, and it is the exception
    // CONTEXT.md carves out rather than a gap. Measured: `A o--x B` is read
    // by mermaid 11.17.2 as a plain `arrow_cross` whose leading `o` becomes
    // part of the *length* (`length=2`), and `A <-.- B` as a plain
    // `arrow_open` whose `<` vanishes. Both draw a picture the author did
    // not write, with no diagnostic — so Siren refuses and says which token
    // it could not read.
    for (const [source, token] of [
      ["A o--x B", "o--x"],
      ["A <-.- B", "<-.-"],
      ["A x--o B", "x--o"],
    ]) {
      const { document, diagnostics } = parseSiren(`flowchart TB\n  ${source}\n`);
      expect([source, document]).toEqual([source, null]);
      expect(diagnostics).toEqual([
        {
          severity: "error",
          message: `Siren does not draw the arrow "${token}" yet: "${source}"`,
          line: 2,
          column: 3,
        },
      ]);
    }
  });

  it("refuses a bare opener, which is half an arrow and not a short one", () => {
    // What is left of the boundary the previous ticket guarded here. Both
    // edge-label spellings are read now (see "the label an edge carries"
    // below), and this is the part that did not change: `--`, `==` and `-.`
    // open a labelled arrow and are not arrows themselves. Mermaid rejects
    // `A -- B` outright, measured — it would be zero ranks long — and
    // reading one as a plain link would draw an edge the author did not
    // write.
    for (const source of ["A -- B", "A == B", "A -. B"]) {
      const { document, diagnostics } = parseSiren(`flowchart TB\n  ${source}\n`);
      expect([source, document]).toEqual([source, null]);
      expect(diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(["error"]);
    }
  });

  it("keeps a declaration list out of the arrow cut, so a `--custom-property` is still a declaration", () => {
    // Found by asking what else on a flowchart line can contain `--` now
    // that the separator is a pattern rather than the literal `-->`. A
    // styling statement's body is a declaration list, and `splitStatements`
    // already keeps `;` from meaning anything inside one; this is the same
    // rule for the same reason, one separator over.
    //
    // Mermaid rejects `style A --my-token:4` outright (measured), so no
    // document it draws turns on this. What turns on it is the diagnostic:
    // without the guard the author of a `style` statement was told Siren
    // could not draw the arrow `--`.
    for (const statement of [
      "style A --my-token:4",
      "classDef hot --my-token:4",
      "linkStyle 0 stroke-dasharray:4--4",
    ]) {
      const { diagnostics } = parseSiren(`flowchart TB\n  A[X] --> B\n  ${statement}\n`);
      expect([statement, diagnostics]).toEqual([statement, []]);
    }
  });

  it("keeps an arrow inside a label a label, whichever token it spells", () => {
    // `splitOutsideLabel`'s rule, now that the separator is a pattern: the
    // cut still happens outside labels only, so a label may say `a==>b`.
    const { document, diagnostics } = parseFlowchartOk(`flowchart TB\n  A[a==>b] --> B\n`);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => node.label)).toEqual(["a==>b", "B"]);
    expect(document.edges.map((edge) => `${edge.from}-${edge.to}`)).toEqual(["A-B"]);
  });
});

/**
 * An edge's label — the text an author writes on the connector itself,
 * `A -->|yes| B` or `A -- yes --> B`.
 *
 * Every expectation here was measured against mermaid 11.17.2 with
 * `scripts/mermaid-probe.mjs`, which prints the `text` its own flowchart
 * database recorded for each edge alongside the three arrow axes. The
 * measurement is quoted in the test that depends on it.
 */
describe("the label an edge carries", () => {
  /** Each of a document's edges as `from-to` and the label it carries. */
  const labelsOf = (source: string) => {
    const { document, diagnostics } = parseFlowchartOk(`flowchart TB\n  ${source}\n`);
    expect(diagnostics).toEqual([]);
    return document.edges.map((edge) => [`${edge.from}-${edge.to}`, edge.label]);
  };

  it("reads `A -->|yes| B` as the edge A to B labelled `yes`", () => {
    // Measured: `text="yes"` on `L_A_B_0`, whose arrow axes are unchanged
    // (`type="arrow_point" stroke="normal" length=1`) — a label decorates
    // an arrow rather than being one.
    expect(labelsOf("A -->|yes| B")).toEqual([["A-B", "yes"]]);
  });

  it("reads `A -- yes --> B` as the very same document `A -->|yes| B` parses to", () => {
    // The two spellings are one construct, and this is the assertion that
    // says so: **identical documents**, not merely the same label. A field
    // recording which spelling was written — or a `sourceColumn` measured
    // from the wrong half of the token — fails here rather than passing
    // unnoticed, which is the shape board 4 used to hold `graph` against
    // `flowchart`.
    //
    // Measured: mermaid 11.17.2 records `text="yes"` with
    // `type="arrow_point" stroke="normal" length=1` for both, and its
    // database keeps no trace of which one it read.
    const pipe = parseFlowchartOk("flowchart TB\n  A -->|yes| B\n");
    const inline = parseFlowchartOk("flowchart TB\n  A -- yes --> B\n");

    expect(inline.diagnostics).toEqual([]);
    expect(inline.document).toEqual(pipe.document);
  });

  it("takes the arrow's line, ends and length from the half that closes an inline label", () => {
    // `A -- yes ==> B` is not a thick edge and `A ---- yes --> B` is not a
    // long one — both were measured. The opener says only *that* a label
    // follows; every axis comes from the closing half, which is why
    // `A -- yes ---> B` is `length=2` in mermaid 11.17.2 while its opener
    // is the same two characters as a one-rank arrow's.
    const { document, diagnostics } = parseFlowchartOk(
      "flowchart TB\n  A -- yes ---> B\n  B == no ==> C\n  C -. maybe -.-> D\n  D <-- both --> E\n",
    );

    expect(diagnostics).toEqual([]);
    expect(
      document.edges.map((edge) => [edge.label, edge.line, edge.fromEnd, edge.toEnd, edge.minLength]),
    ).toEqual([
      ["yes", "solid", "none", "arrow", 2],
      ["no", "thick", "none", "arrow", 1],
      ["maybe", "dotted", "none", "arrow", 1],
      ["both", "solid", "arrow", "arrow", 1],
    ]);
  });

  it("lets an inline label close with the short dotted body, and does not let one open with it", () => {
    // Both halves measured with `pnpm --filter @siren/core probe` against
    // mermaid 11.17.2, and they do not answer alike — which is the reason
    // to measure rather than to reason from symmetry.
    //
    // The **closer** may drop its leading dash: `A -. yes .-> B` is one
    // `arrow_point` labelled "yes", dotted, length=1, and `A -. yes .- B`
    // is the `arrow_open` of the same.
    const { document, diagnostics } = parseFlowchartOk(
      "flowchart TB\n  A -. yes .-> B\n  B -. no .- C\n",
    );
    expect(diagnostics).toEqual([]);
    expect(
      document.edges.map((edge) => [edge.label, edge.line, edge.fromEnd, edge.toEnd, edge.minLength]),
    ).toEqual([
      ["yes", "dotted", "none", "arrow", 1],
      ["no", "dotted", "none", "none", 1],
    ]);

    // The **opener** may not. `.-` is a whole arrow, so `A .- yes .-> B` is
    // not a labelled edge at all in Mermaid: it is a chain of three nodes,
    // `L_A_yes_0` then `L_yes_B_0`, both dotted, measured. An opener is
    // `-.` and only `-.`, and the word "yes" is a node.
    const chain = parseFlowchartOk("flowchart TB\n  A .- yes .-> B\n");
    expect(chain.diagnostics).toEqual([]);
    expect(chain.document.nodes.map((node) => node.id)).toEqual(["A", "yes", "B"]);
    expect(
      chain.document.edges.map((edge) => [edge.from, edge.to, edge.label, edge.line, edge.toEnd]),
    ).toEqual([
      ["A", "yes", null, "dotted", "none"],
      ["yes", "B", null, "dotted", "arrow"],
    ]);
  });

  it("closes an inline label that runs straight into its closing arrow, dotted as well as solid", () => {
    // The space around an inline label is the author's, not the grammar's:
    // `A -- yes--> B` is one solid edge labelled "yes" in mermaid 11.17.2,
    // and `A -. yes.-> B` and `A -.yes.-> B` are the dotted spellings of
    // the same thing, all three measured.
    //
    // Worth its own test because the short dotted body is the one body a
    // *plain* arrow may not begin with after a word character — a `.` is a
    // node-id character there, so `a.-b` is one id. That guard has no job
    // once an opener has already said an arrow is being written: an id
    // ended at the `-.`, so the dots that close the run cannot be inside
    // one. Applying it here anyway refuses a document Mermaid draws, and
    // refuses it for the dotted stroke only, which no author could predict.
    const { document, diagnostics } = parseFlowchartOk(
      "flowchart TB\n  A -. yes.-> B\n  B -.no.-> C\n  C -- sure--> D\n",
    );
    expect(diagnostics).toEqual([]);
    expect(
      document.edges.map((edge) => [edge.label, edge.line, edge.toEnd, edge.minLength]),
    ).toEqual([
      ["yes", "dotted", "arrow", 1],
      ["no", "dotted", "arrow", 1],
      ["sure", "solid", "arrow", 1],
    ]);
  });

  it("keeps the characters the grammar would otherwise eat inside the label", () => {
    // The three the ticket named, each measured against mermaid 11.17.2
    // rather than decided here — an edge label is exactly where an author
    // writes the punctuation the surrounding grammar means something by.
    //
    //   A -->|a-->b| B    text="a-->b"   an arrow inside a pipe label
    //   A -- a;b --> B    text="a;b"     a statement end inside an inline one
    //   A -- a|b --> B    text="a|b"     a pipe inside an inline one
    //
    // The `;` is the sharpest of the three: it is the statement separator,
    // and the splitter that cuts a line into statements runs *before* the
    // one that finds arrows. Without the arrow's own label being a place a
    // `;` means nothing, `A -- a;b --> B` is two half-statements and two
    // diagnostics.
    const measured: [string, string][] = [
      ["A -->|a-->b| B", "a-->b"],
      ["A -- a;b --> B", "a;b"],
      ["A -- a|b --> B", "a|b"],
    ];

    expect(measured.map(([source, text]) => [source, [["A-B", text]]])).toEqual(
      measured.map(([source]) => [source, labelsOf(source)]),
    );
  });

  it("takes a `|` into a pipe label only through the fence written to carry it", () => {
    // Measured both ways: mermaid 11.17.2 rejects `A -->|a|b| B` with a
    // parse error and reads `A -->|"a|b"| B` as the label `a|b`. So the
    // fence is not decoration here, it is the only spelling that works —
    // and the quotes are syntax, never part of the picture, exactly as
    // they are in a node's label.
    expect(labelsOf('A -->|"a|b"| B')).toEqual([["A-B", "a|b"]]);

    const { document, diagnostics } = parseSiren("flowchart TB\n  A -->|a|b| B\n");
    expect(document).toBeNull();
    expect(diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(["error"]);
  });

  it("leaves an unlabelled edge's label null rather than empty", () => {
    // `null`, not `""`: an author cannot write an empty label — mermaid
    // 11.17.2 rejects `A -->|| B` outright, measured — so "no label" and
    // "a label that says nothing" are not two states an author can tell
    // apart, and only one of them exists.
    expect(labelsOf("A --> B")).toEqual([["A-B", null]]);
  });
});

/**
 * `subgraph title ... end` is a block, which is a shape this parser did not
 * have: every other flowchart statement is one line about one thing. What a
 * block adds is *scope* — the nodes named between the keyword and its `end`
 * belong to it — so the tests below are about membership as much as about
 * the keyword parsing.
 *
 * Membership is Mermaid's, measured with `scripts/mermaid-probe.mjs` against
 * mermaid 11.17.2 rather than reasoned about:
 *
 *     subgraph Ingest / A --> B / end        -> subgraph id="Ingest" nodes=["B","A"]
 *     subgraph Outer / subgraph Inner ...    -> Inner nodes=["B","A"], Outer nodes=["Inner","C"]
 *     subgraph "Two Words"                   -> id="subGraph0" title="Two Words"
 *     subgraph one[Two Words]                -> id="one" title="Two Words"
 *     A --> B / subgraph S / B --> C / end   -> S nodes=["C","B"]  (a node named
 *                                               outside and again inside is the
 *                                               subgraph's)
 *     subgraph S / A --> B / end / subgraph T / B --> C / end
 *                                            -> S=["B","A"], T=["C"]  (the first
 *                                               subgraph to name a node keeps it)
 */
describe("a subgraph", () => {
  it("groups the nodes named between its keyword and its end", () => {
    const { document, diagnostics } = parseFlowchartOk(
      "flowchart TB\n  subgraph Ingest\n    A --> B\n  end\n  B --> C\n",
    );

    expect(diagnostics).toEqual([]);
    expect(document.subgraphs).toEqual([
      {
        name: "Ingest",
        label: "Ingest",
        nodeIds: ["A", "B"],
        subgraphs: [],
        direction: null,
        line: 2,
        column: 3,
      },
    ]);
    // The nodes and the edges themselves are untouched by the grouping: `C`
    // is declared exactly as it would have been without the block, and both
    // edges exist.
    expect(document.nodes.map((node) => node.id)).toEqual(["A", "B", "C"]);
    expect(document.edges.map((edge) => `${edge.from}-${edge.to}`)).toEqual(["A-B", "B-C"]);
  });

  it("nests, and a nested subgraph is a member of the one that encloses it", () => {
    const { document, diagnostics } = parseFlowchartOk(
      "flowchart TB\n" +
        "  subgraph Outer\n" +
        "    subgraph Inner\n" +
        "      A --> B\n" +
        "    end\n" +
        "    C --> A\n" +
        "  end\n" +
        "  B --> D\n",
    );

    expect(diagnostics).toEqual([]);
    expect(document.subgraphs).toHaveLength(1);
    const [outer] = document.subgraphs;
    expect(outer.label).toBe("Outer");
    // `A` was named inside `Inner` first, so it is `Inner`'s and not
    // `Outer`'s — the first-claim rule mermaid 11.17.2 applies, measured.
    expect(outer.nodeIds).toEqual(["C"]);
    expect(outer.subgraphs.map((sub) => sub.label)).toEqual(["Inner"]);
    expect(outer.subgraphs[0].nodeIds).toEqual(["A", "B"]);
  });

  it("keeps a node for the first subgraph that names it", () => {
    const { document } = parseFlowchartOk(
      "flowchart TB\n" +
        "  subgraph S\n    A --> B\n  end\n" +
        "  subgraph T\n    B --> C\n  end\n",
    );

    expect(document.subgraphs.map((sub) => [sub.label, sub.nodeIds])).toEqual([
      ["S", ["A", "B"]],
      ["T", ["C"]],
    ]);
  });

  it("takes a node named before the block as the block's own when it is named again inside", () => {
    const { document } = parseFlowchartOk(
      "flowchart TB\n  A --> B\n  subgraph S\n    B --> C\n  end\n",
    );

    expect(document.subgraphs.map((sub) => sub.nodeIds)).toEqual([["B", "C"]]);
  });

  it("reads a quoted or bracketed title, and keeps the author's own handle apart from it", () => {
    const titles = (source: string) =>
      parseFlowchartOk(`flowchart TB\n  ${source}\n    A --> B\n  end\n`).document.subgraphs.map(
        (sub) => [sub.name, sub.label],
      );

    // A bare word is both: mermaid 11.17.2 records `id="Ingest"
    // title="Ingest"`.
    expect(titles("subgraph Ingest")).toEqual([["Ingest", "Ingest"]]);
    // A quoted title names nothing — mermaid mints `subGraph0` for it — so
    // the author's handle is `null` and only the title survives.
    expect(titles('subgraph "Two Words"')).toEqual([[null, "Two Words"]]);
    // The bracket spelling is the one that separates them: `id="one"
    // title="Two Words"`.
    expect(titles("subgraph one[Two Words]")).toEqual([["one", "Two Words"]]);
    expect(titles('subgraph one["Two Words"]')).toEqual([["one", "Two Words"]]);
  });

  it("closes on an `end` written as a statement on the same line", () => {
    // `subgraph S A --> B end` is a *parse error* in mermaid 11.17.2
    // (measured: "Expecting ... got 'LINK'"), and `subgraph S; A --> B; end`
    // is not — the block boundary is a statement boundary, which is exactly
    // what `;` already makes.
    const { document, diagnostics } = parseFlowchartOk(
      "flowchart TB\n  subgraph S; A --> B; end\n",
    );

    expect(diagnostics).toEqual([]);
    expect(document.subgraphs.map((sub) => [sub.label, sub.nodeIds])).toEqual([["S", ["A", "B"]]]);
  });

  it("refuses an `end` with no subgraph open, and a subgraph never closed", () => {
    const stray = parseSiren("flowchart TB\n  A --> B\n  end\n");
    expect(stray.document).toBeNull();
    expect(stray.diagnostics.map((d) => [d.severity, d.message])).toEqual([
      ["error", 'Unrecognized flowchart line: "end"'],
    ]);

    const unterminated = parseSiren("flowchart TB\n  subgraph S\n    A --> B\n");
    expect(unterminated.document).toBeNull();
    expect(unterminated.diagnostics.map((d) => [d.severity, d.message])).toEqual([
      ["error", 'Unterminated "subgraph S" block: missing matching "end"'],
    ]);
  });
});

/**
 * `direction LR` inside a subgraph — a per-cluster rank direction.
 *
 * **Measured.** mermaid 11.17.2 records it as `dir="LR"` on that subgraph
 * alone and leaves the document's own direction where the header put it
 * (`scripts/mermaid-probe.mjs`, `subgraph Ingest / direction LR / A --> B /
 * end` -> `subgraphs: id="Ingest" ... dir="LR"`, `direction: TB`).
 * `layoutDirectedGraph` honors it the same way, by way of dagre's own
 * `recursiveClusterLayout`: a cluster node carrying a `rankdir` of its own
 * lays its children out as a sub-graph of their own.
 */
describe("a direction written inside a subgraph", () => {
  it("is read onto that subgraph, not refused", () => {
    const { document, diagnostics } = parseSiren(
      "flowchart TB\n  subgraph Ingest\n    direction LR\n    A --> B\n  end\n",
    );

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect(document!.kind).toBe("flowchart");
    expect((document as FlowchartDocument).subgraphs).toEqual([
      expect.objectContaining({ name: "Ingest", direction: "LR" }),
    ]);
    // The document's own direction, where the header put it — untouched by
    // the subgraph's own.
    expect((document as FlowchartDocument).direction).toBe("TB");
  });

  it("costs the author nothing when they never wrote one", () => {
    const { diagnostics } = parseSiren(
      "flowchart TB\n  subgraph Ingest\n    A --> B\n  end\n",
    );

    expect(diagnostics).toEqual([]);
  });
});

/**
 * An edge whose endpoint names a subgraph — an edge between two *frames*
 * rather than two boxes.
 *
 * **Measured.** mermaid 11.17.2 reads `One --> Two`, where `One` and `Two`
 * are subgraphs, as an edge between the two frames — it records vertices for
 * both names *and* the subgraphs, and its renderer joins the clusters
 * (`scripts/mermaid-probe.mjs`). Siren draws it the same way now: the
 * endpoint is recorded as the author wrote it here, resolved to the frame's
 * generated id by `buildFlowchartModel`, and routed by `layoutDirectedGraph`
 * through a member of the frame whose route is then clipped back to the
 * frame's own boundary.
 *
 * It used to be **refused by name**, and this block used to pin the refusal.
 * That was the honest state while nothing could route it: the alternative
 * then was two stray boxes drawn beside the frames of the same name, with no
 * diagnostic — a `silently-wrong` row, and the policy on those says their
 * count's destination is zero.
 */
describe("an edge that addresses a subgraph", () => {
  it("joins the two frames rather than drawing stray nodes beside them", () => {
    const { document, diagnostics } = parseSiren(
      "flowchart TB\n" +
        "  subgraph One\n    A\n  end\n" +
        "  subgraph Two\n    B\n  end\n" +
        "  One --> Two\n",
    );

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    const flowchart = document as FlowchartDocument;
    expect(flowchart.edges.map((edge) => [edge.from, edge.to])).toEqual([["One", "Two"]]);
    // No box called `One` beside the frame of the same name.
    expect(flowchart.nodes.map((node) => node.id)).toEqual(["A", "B"]);
  });

  it("reads it whichever order the two were written in", () => {
    // A subgraph may be declared after the edge that names it, so this
    // cannot be decided while the line is read.
    const { document, diagnostics } = parseSiren(
      "flowchart TB\n  A --> Ingest\n  subgraph Ingest\n    B --> C\n  end\n",
    );

    expect(diagnostics).toEqual([]);
    expect((document as FlowchartDocument).nodes.map((node) => node.id)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("says nothing about a node that merely shares a subgraph's name", () => {
    // `A[Alpha]` beside `subgraph A` is valid Mermaid that draws a box and a
    // frame, and Siren draws both. Only an *edge* endpoint means the frame,
    // so a declaration keeps its box whatever a block is called.
    const { document, diagnostics } = parseSiren(
      "flowchart TB\n  A[Alpha]\n  subgraph A\n    B --> C\n  end\n",
    );

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect((document as FlowchartDocument).nodes.map((node) => node.id)).toContain("A");
  });
});

/**
 * A node written as a bare id on a line of its own, inside a subgraph or at
 * the top level alike.
 *
 * This is how an author puts a node with no edges into a document, and
 * inside a block it is the second most common line after `A --> B`. Siren
 * used to refuse the top-level spelling — a bare word declared a node only
 * inside a `subgraph` block, never outside one — on a since-corrected
 * measurement: re-measured with `scripts/mermaid-probe.mjs` (mermaid
 * 11.17.2), `flowchart TB / A / B[Box]` records vertices `A` *and* `B`, not
 * `B` alone (`fc-stmt-bare-node`). The two spellings are one rule, not two:
 * a bare id declares a node wherever it is written.
 */
describe("a bare node id on its own line", () => {
  it("declares the node and puts it in the block, inside a subgraph", () => {
    const { document, diagnostics } = parseFlowchartOk(
      "flowchart TB\n  subgraph One\n    A\n    B[Box]\n  end\n",
    );

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label])).toEqual([
      ["A", "A"],
      ["B", "Box"],
    ]);
    expect(document.subgraphs.map((sub) => sub.nodeIds)).toEqual([["A", "B"]]);
  });

  it("declares the node outside every block too", () => {
    const { document, diagnostics } = parseFlowchartOk("flowchart TB\n  A\n");

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label])).toEqual([["A", "A"]]);
  });
});

describe("the header spellings the dispatcher teaches", () => {
  /**
   * Every spelling `parseSiren` accepts, in the order its diagnostics name
   * them. Written out once here, as the author reads it, so the test is an
   * independent statement of the set rather than a second derivation of it.
   */
  const ACCEPTED =
    '"flowchart TB", "flowchart BT", "flowchart LR", "flowchart RL",' +
    ' "graph TB", "graph BT", "graph LR", "graph RL",' +
    ' "sequenceDiagram", "classDiagram", "classDiagram-v2",' +
    ' "stateDiagram", or "stateDiagram-v2"';

  it("names both `classDiagram-v2` and `stateDiagram-v2` among them when it rejects a header", () => {
    // `parseClassDiagram` has always accepted `classDiagram-v2`, and the
    // dispatcher has always dispatched it, while this message taught only
    // the bare spelling — an author sent to rewrite a header that was
    // already correct. The state diagram arrived with both spellings at
    // once, and this is what keeps the pair from drifting the same way.
    //
    // The probe is a header no kind claims: every spelling this message
    // names is now routed somewhere, so a rejection can only be provoked by
    // a word that is not one of them.
    const { document, diagnostics } = parseSiren("stateChart-v2\n  Still --> Moving\n");

    expect(document).toBeNull();
    expect(diagnostics[0].message).toBe(`Expected ${ACCEPTED}, found "stateChart-v2"`);
  });
  it("names the same set when the document is empty", () => {
    const { document, diagnostics } = parseSiren("\n  \n");

    expect(document).toBeNull();
    expect(diagnostics[0].message).toBe(`Empty document: expected a ${ACCEPTED} header`);
  });

  it("dispatches every spelling it names", () => {
    // The property the single list buys, stated without naming the list: a
    // spelling the diagnostic teaches has to be one the dispatcher routes,
    // or the message is sending authors to write a header that is rejected.
    const rejected = parseSiren("stateChart-v2\n").diagnostics[0].message;
    const named = rejected.slice(0, rejected.indexOf(', found "'));
    const spellings = [...named.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

    expect(spellings).toHaveLength(13);
    for (const spelling of spellings) {
      // Only the header is under test: a document that is nothing but one
      // has other things wrong with it (an empty `sequenceDiagram` has no
      // body), and none of those is a header rejection.
      // A rejected header is the one diagnostic that quotes the header line
      // back, from the dispatcher and from the kind's own parser alike, so
      // its absence is the whole property — including for a spelling the
      // dispatcher routes and the parser it routes to then refuses.
      const { diagnostics } = parseSiren(`${spelling}\n`);
      const rejections = diagnostics.filter((diagnostic) =>
        diagnostic.message.includes(`found "${spelling}"`),
      );
      expect(rejections).toEqual([]);
    }
  });
});
