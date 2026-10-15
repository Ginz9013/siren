import { describe, expect, it } from "vitest";
import { parseFlowchart } from "./parseFlowchart";
import { parseSiren } from "./parseSiren";
import { plainLabel, plainRun } from "../label/label";
import type {
  ClassDocument,
  Diagnostic,
  ErDocument,
  FlowchartDocument,
  SequenceDocument,
  SirenDocument,
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

/**
 * Narrows a dispatched document to the ER arm, so the tests below read its
 * entities without a `document!` or a vacuous `not.toBeNull()` — the shape
 * `buildFlowchart` in `buildGraphModel.test.ts` has one stage downstream.
 */
function erDocument(document: SirenDocument | null): ErDocument {
  if (document === null || document.kind !== "er") {
    throw new Error(
      `expected an ER document, got ${document === null ? "null" : document.kind}`,
    );
  }
  return document;
}

describe("parseSiren", () => {
  it("parses a minimal flowchart with inline edge node declarations and a timeline block", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[Process]
  B --> C[End]

timeline:
  enter B fade
  enter C fade
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

  it("keeps the last label, silently and in the first position, when a node id is redeclared with different bracket text", () => {
    // Mermaid 11.17.2, measured: `A[x]` then `A[y]` draws "y" and says
    // nothing — the later declaration is used, so it is not a mistake to
    // warn about. The node stays where it was first written.
    const source = `flowchart TD
  A[Start]
  A --> B[End]
  A[Begin]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label.text, n.line])).toEqual([
      ["A", "Begin", 2],
      ["B", "End", 3],
    ]);
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
    expect(document.nodes.map((n) => n.label.text)).toEqual([
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
    expect(document.nodes.map((n) => n.label.text)).toEqual(["Quoted, with comma"]);
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
    expect(fenced.document.nodes.map((n) => n.label.text)).toEqual(["a]b"]);

    const bare = parseSiren(unquoted);
    expect(bare.document).toBeNull();
    expect(bare.diagnostics.map((d) => d.message)).toEqual([
      'A node label without quotes cannot hold "]". Put the whole label in quotes: A["a]b"]',
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
    expect(document.nodes.map((n) => `${n.id}=${n.label.text}`)).toEqual([
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
    expect(empty.document.nodes.map((n) => n.label.text)).toEqual([""]);

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
    expect(document.nodes.map((n) => n.label.text)).toEqual(['"hi" and "bye"']);
  });

  it("reads `A{text}` as a rhombus, and every other node spelling as a rect", () => {
    // Measured against mermaid 11.17.2 (`pnpm --filter siren-core probe`):
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
    expect(document.nodes.map((n) => [n.id, n.label.text, n.shape])).toEqual([
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
    // Measured against mermaid 11.17.2 (`pnpm --filter siren-core probe`):
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
    expect(document.nodes.map((n) => [n.id, n.label.text, n.shape])).toEqual([
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
    // Measured against mermaid 11.17.2 (`pnpm --filter siren-core probe`):
    // `A>Flag]` is `type="odd" text="Flag"`, `A>a>b]` is `odd` labelled
    // `a>b` — so a `>` inside the label is ordinary text — and `A>]` is a
    // parse error.
    const source = `flowchart TB
  A>Flag]
  B>a>b]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label.text, n.shape])).toEqual([
      ["A", "Flag", "asymmetric"],
      ["B", "a>b", "asymmetric"],
    ]);
  });

  it("accepts unquoted parentheses in a bracketed label, which Mermaid rejects — a recorded permissive divergence", () => {
    // Measured on mermaid 12.2.0: `P[a (b)]` is a parse error ("got 'PS'"),
    // and only the quoted `P["a (b)"]` draws, as the rect `a (b)`. Siren
    // draws both, deliberately (nook 01M4R3RVV, at `LABEL_CONTENT`): a
    // corpus row cannot hold it, since its source is not valid Mermaid, so
    // this test is the record. Changing it is a policy change, not a fix.
    const { document, diagnostics } = parseFlowchartOk(`flowchart TB
  P[Watering 灌溉控制器 (Rain / Pump / Wells)]
  Q["a (b)"] --> R[a (b)]
`);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => [n.id, n.label.text, n.shape])).toEqual([
      ["P", "Watering 灌溉控制器 (Rain / Pump / Wells)", "rect"],
      ["Q", "a (b)", "rect"],
      ["R", "a (b)", "rect"],
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
    expect(document.nodes.map((n) => [n.id, n.label.text, n.shape])).toEqual([
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
    // Ticket 01 excluded `{` from the brace label content (now
    // `LABEL_CONTENT`) so this spelling could not be swallowed as a rhombus
    // labelled `{Hexagon}`.
    // Now that a hexagon is drawn, the exclusion earns its keep the other
    // way round: it is what lets the two brace spellings be told apart at
    // all, since `\{…\}` can never reach across an inner brace.
    //
    // Measured against mermaid 11.17.2 (`pnpm --filter siren-core probe`):
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
    expect(document.nodes.map((n) => [n.id, n.label.text, n.shape])).toEqual([
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
    expect(document.nodes.map((n) => [n.id, n.label.text, n.shape])).toEqual([
      ["A", "Hexagon", "hexagon"],
      ["B", "Ready?", "rhombus"],
    ]);

    // Mermaid rejects `A{{a}b}}`, so Siren refuses it too rather than
    // inventing a reading for it.
    const refused = parseSiren(`flowchart TB\n  A{{a}b}}\n`);
    expect(refused.document).toBeNull();
    expect(refused.diagnostics.map((d) => d.message)).toEqual([
      'A node label without quotes cannot hold "}". Put the whole label in quotes: A{{"a}b"}}',
    ]);
  });

  it("reads `A(text)`, `A([text])` and `A[[text]]` as the round, stadium and subroutine spellings", () => {
    // Measured against mermaid 11.17.2 (`pnpm --filter siren-core probe`):
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
    expect(document.nodes.map((n) => [n.id, n.label.text, n.shape])).toEqual([
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
    // Measured, not remembered (`pnpm --filter siren-core probe`, mermaid
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
    expect(document.nodes.map((n) => [n.id, n.label.text, n.shape])).toEqual([
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
    // Measured against mermaid 11.17.2 (`pnpm --filter siren-core probe`):
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
    expect(document.nodes.map((n) => [n.id, n.label.text, n.shape])).toEqual([
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
    // Measured against mermaid 11.17.2 (`pnpm --filter siren-core probe`):
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
    expect(document.nodes.map((n) => [n.id, n.label.text, n.shape])).toEqual([
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
    expect(document.nodes.map((n) => [n.id, n.label.text, n.shape])).toEqual([
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
    expect(document.nodes.map((n) => [n.id, n.label.text, n.shape])).toEqual([
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
    expect(document.nodes.map((n) => n.label.text)).toEqual(['say "hi" now']);
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
    expect(document.nodes.map((n) => n.label.text)).toEqual(["bold"]);
    expect(document.nodes.map((n) => n.label.rows)).toEqual([
      [[{ ...plainRun("bold"), bold: true }]],
    ]);
  });

  it("reads a form written at an edge endpoint too — where it is written must not decide what it means", () => {
    // Two endpoints on two different lines and at both ends of an arrow, so
    // the rule is visibly about the *place* rather than about one line's
    // shape: a Markdown label declared inline at an edge endpoint parses
    // into the exact same label a standalone declaration would.
    const source = `flowchart TB
  A["` + "`" + `**bold**` + "`" + `"] --> B[Read]
  C[Write] --> D["` + "`" + `**bold**` + "`" + `"]
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    const byId = Object.fromEntries(document.nodes.map((n) => [n.id, n]));
    expect(byId.A.label.rows).toEqual([[{ ...plainRun("bold"), bold: true }]]);
    expect(byId.D.label.rows).toEqual([[{ ...plainRun("bold"), bold: true }]]);
  });

  it("parses all four timeline verbs with the correct kind/targetId/step, and effect only where expected", () => {
    const source = `flowchart TD
  A[Start]
  A --> B[Process]

timeline:
  enter B fade
  exit A slide-left
  highlight A-B outline
  unhighlight A-B
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
  enter B slide-left
  enter B slide-right
  enter B slide-top
  enter B slide-bottom
  exit B slide-left
  exit B slide-right
  exit B slide-top
  exit B slide-bottom
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
  highlight A-B outline
  highlight A-B glow
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
  enter A outline
`;
    expect(() => parseSiren(source1)).not.toThrow();
    const result1 = parseSiren(source1);
    expect(result1.document).toBeNull();
    expect(result1.diagnostics.some((d) => d.severity === "error")).toBe(true);

    const source2 = `flowchart TD
  A[Start]
  A --> B[Process]

timeline:
  highlight A-B slide-left
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
  unhighlight A-B outline
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
      { id: "A", label: plainLabel("Alice"), participantKind: "participant", line: 3, column: 3 },
      { id: "B", label: plainLabel("Bob"), participantKind: "actor", line: 4, column: 3 },
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

  it('dispatches an erDiagram document to parseErDiagram, tagged kind: "er"', () => {
    const { document, diagnostics } = parseSiren("erDiagram\n  CUSTOMER\n  ORDER\n");

    expect(diagnostics).toEqual([]);
    expect(erDocument(document).entities.map((entity) => entity.name)).toEqual([
      "CUSTOMER",
      "ORDER",
    ]);
  });

  it("strips whole-line %% comments from an erDiagram before the kind's parser sees them, and leaves a mid-line %% to it", () => {
    // The dispatcher owns comment stripping for the whole language, so a
    // fifth kind gets it without a line of its own — and this is what says
    // so rather than assuming it. Only whole lines: a `%%` after a
    // statement reaches `parseErDiagram`, outside the entity alphabet, and
    // costs the document, as Mermaid 12.2.0 refuses it (see "a `%%` in the
    // middle of an ER line" below).
    const { document, diagnostics } = parseSiren(
      "%% the shop's records\nerDiagram\n  %% the one who pays\n  CUSTOMER\n",
    );

    expect(diagnostics).toEqual([]);
    expect(erDocument(document).entities.map((entity) => entity.name)).toEqual(["CUSTOMER"]);
    expect(parseSiren("erDiagram\n  CUSTOMER %% the one who pays\n").diagnostics.map((d) => d.column)).toEqual([12]);
  });

  it("ignores whole-line and indented %% comments in a flowchart", () => {
    // Only whole lines: a `%%` trailing a flowchart statement is refused
    // (see "a `%%` in the middle of a flowchart line" below).
    const source = `%% what this diagram is for
flowchart TD
  A[Start]
    %% the interesting bit
  A --> B[End]
  %% and back again
`;

    const { document, diagnostics } = parseFlowchartOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((n) => n.id)).toEqual(["A", "B"]);
    expect(document.edges.map((e) => ({ from: e.from, to: e.to }))).toEqual([
      { from: "A", to: "B" },
    ]);
  });

  it("ignores whole-line %% comments in a sequence diagram, and keeps a %% after a message's colon as its text", () => {
    // Measured (Mermaid 12.2.0): only the whole line is a comment; the
    // message text runs on past its `%%`. Siren used to cut it to "Sync call".
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
    expect(messages[0].kind === "message" && messages[0].label.text).toBe("Sync call %% the important one");
  });

  it("ignores whole-line and indented %% comments in a class diagram, and a %% after its last statement", () => {
    // Only on the last line: the class lexer's `%%` rule swallows the line
    // break after it, so on any other line Mermaid 12.2.0 refuses the
    // document and Siren refuses the `%%` (see parseClassDiagram.test.ts,
    // "a `%%` in the middle of a class-diagram line").
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

  it("keeps a %% inside a sequence message's text as text — only a whole line is a comment", () => {
    // Measured (Mermaid 12.2.0): `cleanupComments` removes whole-line
    // comments only, and the sequence lexer's message-text rule
    // (`:[^#\n;]*`) reads on past a `%%`, so `A->>B: 50%% done` draws the
    // message "50%% done". Siren used to cut the line at the `%%` and draw "50".
    const source = `sequenceDiagram
  participant A as Alice
  participant B as Bob
  A->>B: 50%% done
`;

    const { document, diagnostics } = parseSiren(source);

    expect(diagnostics).toEqual([]);
    const messages = (document as SequenceDocument).statements.filter((s) => s.kind === "message");
    expect(messages[0].kind === "message" && messages[0].label.text).toBe("50%% done");
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

  describe("a line that is nothing but `%%` (ADR-0017; measured on Mermaid 12.2.0)", () => {
    // Mermaid's `cleanupComments` removes `^\s*%%(?!{)[^\n]+\n?`: a comment
    // needs at least one character after its `%%`. A bare `%%` line is left
    // to the diagram's own grammar, which in a flowchart draws a node named
    // `%%` and in an ER diagram refuses the document.
    // The messages name the cause and the fix, never Mermaid.
    const FLOWCHART_DRAWS_IT =
      'A line that is nothing but "%%" is not a comment: a comment needs text after its "%%", ' +
      'so this line is a node named "%%". Write "%% text", or leave the line blank.';
    const REFUSED_OUTRIGHT =
      'A line that is nothing but "%%" is not a comment: a comment needs text after its "%%". ' +
      'Write "%% text", or leave the line blank.';

    it("refuses a bare `%%` line below a flowchart header, where Mermaid draws a node named `%%`", () => {
      const { document, diagnostics } = parseSiren("flowchart TB\n%%\nA-->B\n");

      expect(document).toBeNull();
      expect(diagnostics).toEqual([
        { severity: "error", message: FLOWCHART_DRAWS_IT, line: 2, column: 1 },
      ]);
    });

    it("refuses an indented bare `%%` too, at the column of its `%%`, once per line", () => {
      // `^\s*` before the `%%`: Mermaid's indented bare `%%` is a node too.
      const { document, diagnostics } = parseSiren("flowchart TB\n  %%\nA-->B\n\t%%\nB-->C\n");

      expect(document).toBeNull();
      expect(diagnostics).toEqual([
        { severity: "error", message: FLOWCHART_DRAWS_IT, line: 2, column: 3 },
        { severity: "error", message: FLOWCHART_DRAWS_IT, line: 4, column: 2 },
      ]);
    });

    it("refuses a bare `%%` line in an ER diagram, which Mermaid refuses outright", () => {
      const { document, diagnostics } = parseSiren("erDiagram\n%%\nA ||--o{ B : has\n");

      expect(document).toBeNull();
      expect(diagnostics).toEqual([
        { severity: "error", message: REFUSED_OUTRIGHT, line: 2, column: 1 },
      ]);
    });

    it("says Mermaid refuses a flowchart whose bare `%%` stands above the header, where it draws no node", () => {
      // Measured: `%%\nflowchart TB\nA-->B` and `%%\ngraph TB\nA-->B` are
      // parse errors on line 1; below the header the same line is a node.
      const { document, diagnostics } = parseSiren("%%\ngraph TB\n%%\nA-->B\n");

      expect(document).toBeNull();
      expect(diagnostics).toEqual([
        { severity: "error", message: REFUSED_OUTRIGHT, line: 1, column: 1 },
        { severity: "error", message: FLOWCHART_DRAWS_IT, line: 3, column: 1 },
      ]);
    });

    it("reads a bare `%%` line as a comment in sequence, class and state diagrams, whose grammars Mermaid lets read it as one", () => {
      // Measured: each kind's own lexer has a `%%` rule, so Mermaid draws
      // these documents exactly as it draws them without the line.
      for (const [header, body] of [
        ["sequenceDiagram", "A->>B: hi"],
        ["classDiagram", "A <|-- B"],
        ["stateDiagram-v2", "A --> B"],
      ]) {
        const bare = parseSiren(`%%\n${header}\n%%\n  %%\n${body}\n%%`);
        const without = parseSiren(`\n${header}\n\n\n${body}\n`);

        expect([header, bare.diagnostics]).toEqual([header, []]);
        expect([header, bare.document]).toEqual([header, without.document]);
      }
    });

    it("still reads `%%` followed by nothing but spaces or a tab as a comment, as Mermaid does — any character after `%%` makes one", () => {
      // `[^\n]+` matches a space as well as a word: measured, `%%   `, `%%\t`
      // and `%%%` vanish in a flowchart and in an ER diagram alike.
      for (const [header, body] of [
        ["flowchart TB", "A-->B"],
        ["erDiagram", "A ||--o{ B : has"],
      ]) {
        const spaced = parseSiren(`${header}\n%%   \n\t%%\t\n%%%\n${body}\n%%  `);
        const without = parseSiren(`${header}\n\n\n\n${body}\n`);

        expect([header, spaced.diagnostics]).toEqual([header, []]);
        expect([header, spaced.document]).toEqual([header, without.document]);
      }
    });

    it("refuses a bare `%%` on the document's last line, with or without a line break after it, and between CRLF line breaks", () => {
      // Measured: `flowchart TB\nA-->B\n%%` and `…\n%%\n` both draw a `%%`
      // node, and both refuse an ER diagram. `cleanupText` makes `\r\n`
      // a `\n` before comments are read, so `%%\r\n` is bare too.
      for (const ending of ["", "\n", "\r\n"]) {
        expect(parseSiren(`flowchart TB\r\nA-->B\r\n%%${ending}`).diagnostics).toEqual([
          { severity: "error", message: FLOWCHART_DRAWS_IT, line: 3, column: 1 },
        ]);
        expect(parseSiren(`erDiagram\nA ||--o{ B : has\n%%${ending}`).diagnostics).toEqual([
          { severity: "error", message: REFUSED_OUTRIGHT, line: 3, column: 1 },
        ]);
      }
    });

    it("leaves a `%%` trailing real syntax to the mid-line rule — it is not a bare line", () => {
      // Measured: Mermaid reads `A-->B %%` exactly as it reads `A-->B %% x`
      // (a flowchart refuses both), so the bare-line rule has nothing to say
      // about it; it means here what any mid-line `%%` means in its kind.
      for (const [header, body] of [
        ["flowchart TB", "A-->B"],
        ["erDiagram", "A ||--o{ B : has"],
      ]) {
        const bare = parseSiren(`${header}\n${body} %%\n${body} %%`);
        const worded = parseSiren(`${header}\n${body} %% x\n${body} %% x`);

        expect([header, bare]).toEqual([header, worded]);
      }
      // Each kind refuses each `%%` as the mid-line `%%` it is, not as a
      // bare line.
      const midLine =
        'A "%%" in the middle of a line is not a comment: only a line that starts with "%%" is one. ' +
        "If it is a comment, move it to a line of its own.";
      expect(parseSiren("flowchart TB\nA-->B %%\nA-->B %%").diagnostics).toEqual([
        { severity: "error", message: midLine, line: 2, column: 7 },
        { severity: "error", message: midLine, line: 3, column: 7 },
      ]);
      expect(parseSiren("erDiagram\nA ||--o{ B : has %%\nA ||--o{ B : has %%").diagnostics).toEqual([
        { severity: "error", message: midLine, line: 2, column: 18 },
        { severity: "error", message: midLine, line: 3, column: 18 },
      ]);
    });

    it("reads a bare `%%` inside a timeline block as a comment, unnamed or named — Mermaid never sees that block", () => {
      // ADR-0017: a Siren document without its timeline blocks is the
      // Mermaid document, so a line inside one is not Mermaid's to refuse.
      // A block runs from its header to the next header or the end.
      for (const [header, body] of [
        ["flowchart TB", "A-->B"],
        ["erDiagram", "A ||--o{ B : has"],
      ]) {
        for (const [bare, without] of [
          [`timeline:\n%%\n  %%\nenter B fade\n%%`, `timeline:\n\n\nenter B fade\n`],
          [
            `timeline one:\n%%\nenter B fade\ntimeline two:\n\t%%\nenter A fade\n%%\n`,
            `timeline one:\n\nenter B fade\ntimeline two:\n\nenter A fade\n\n`,
          ],
        ]) {
          const withBare = parseSiren(`${header}\n${body}\n${bare}`);
          const withoutBare = parseSiren(`${header}\n${body}\n${without}`);

          expect([header, bare, withBare.diagnostics]).toEqual([header, bare, []]);
          expect([header, bare, withBare]).toEqual([header, bare, withoutBare]);
        }
      }
    });

    it("still refuses a bare `%%` above the first timeline header", () => {
      const { document, diagnostics } = parseSiren("flowchart TB\nA-->B\n%%\ntimeline:\nenter B\n");

      expect(document).toBeNull();
      expect(diagnostics).toEqual([
        { severity: "error", message: FLOWCHART_DRAWS_IT, line: 3, column: 1 },
      ]);
    });
  });

  it("reports the same error for a second unnamed timeline: header, in all three diagram kinds", () => {
    // The unnamed block is declared at most once. A repeated header is not
    // a second block and not a no-op: it is the error that says only named
    // blocks may be several, in every kind. Each source below puts the repeat at
    // line 5, column 3, so the three diagnostics must be identical objects
    // — a future divergence between the kinds fails here rather than being
    // discovered by an extraction three boards later.
    const repeated = {
      flowchart: `flowchart TD
  A[Start]
timeline:
  enter A fade
  timeline:
`,
      class: `classDiagram
  Animal <|-- Duck
timeline:
  enter Animal fade
  timeline:
`,
      sequence: `sequenceDiagram
  participant A as Alice
timeline:
  enter A fade
  timeline:
`,
    };

    const expected: Diagnostic[] = [
      {
        severity: "error",
        message:
          'A document declares at most one unnamed "timeline:" block; name each block ("timeline <name>:") to declare several',
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
        message: '"oops" is not a style declaration. Write each declaration as property:value, such as stroke:#f00',
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
    expect(document.nodes.map((node) => [node.id, node.label.text])).toEqual([
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
    expect(document.nodes.map((node) => [node.id, node.label.text])).toEqual([
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
    // keeps `End` rather than being relabelled with its own id.
    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label.text])).toEqual([
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
    expect(document.nodes.map((node) => [node.id, node.label.text])).toEqual([
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
    expect(document.nodes.map((node) => [node.id, node.label.text])).toEqual([
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
    expect(document.nodes.map((node) => [node.id, node.label.text])).toEqual([
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
    expect(document.nodes.map((node) => [node.id, node.label.text])).toEqual([
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
    expect(document.nodes.map((node) => [node.id, node.label.text])).toEqual([
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
    // "Nothing was taken" is observed through a warning that reading the
    // first endpoint would raise: on its own, the line
    // `A[<span style="foo:1">Other</span>] --> B` warns that `<span style>`
    // ignores "foo". (This used to lean on the redeclaration warning
    // `A[Other]` raised, until a later label came to replace an earlier one
    // silently, as in Mermaid 11.17.2.) With the unreadable arrow at the end
    // of the same line, the refusal must be the only diagnostic — so `A`'s
    // label was never read.
    const unreadable = parseSiren(`flowchart TD
  A[Start]
  A[<span style="foo:1">Other</span>] --> B o--x C
`);

    expect(unreadable.document).toBeNull();
    expect(unreadable.diagnostics).toEqual([
      {
        severity: "error",
        message:
          // The line is quoted as it is read: after Mermaid's tag-quote
          // rewrite (`tagQuotesRewritten`), which made the span's `"` a `'`.
          'Siren does not draw the arrow "o--x" yet: "A[<span style=\'foo:1\'>Other</span>] --> B o--x C"',
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
        message: '"oops" is not a style declaration. Write each declaration as property:value, such as stroke:#f00',
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
    // recorded for it (`pnpm --filter siren-core probe`). Written as a
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
    // The short dotted spellings, measured with `pnpm --filter siren-core
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
    // The whole family, measured with `pnpm --filter siren-core probe`
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

  it("reads `-` inside a node id wherever Mermaid's lexer does, and not where it starts an arrow", () => {
    // 01M2SVAFT, every case measured on mermaid 12.2.0. Mermaid's id
    // alphabet takes `-` unless the next character is `>`, `-` or `.`, the
    // three that begin an arrow — so `a-b-->c` is `a-b` and an arrow with no
    // space between them, and `a--b`, `a-.b`, `a - b` are parse errors.
    const reads: [string, string[], string[]][] = [
      ["a-b --> c", ["a-b", "c"], ["a-b>c"]],
      ["a-b-->c", ["a-b", "c"], ["a-b>c"]],
      ["a-->b-c", ["a", "b-c"], ["a>b-c"]],
      ["a-b-c --> d", ["a-b-c", "d"], ["a-b-c>d"]],
      ["a-b", ["a-b"], []],
      ["a- --> b", ["a-", "b"], ["a->b"]],
      ["a-", ["a-"], []],
      ["b --> a-", ["b", "a-"], ["b>a-"]],
      ["-a --> b", ["-a", "b"], ["-a>b"]],
      ["a-b-- text -->c", ["a-b", "c"], ["a-b>c"]],
      ["a-b---c", ["a-b", "c"], ["a-b>c"]],
      ["a-b==>c", ["a-b", "c"], ["a-b>c"]],
      ["a-b-.->c", ["a-b", "c"], ["a-b>c"]],
      ["a-b[Label] --> c", ["a-b", "c"], ["a-b>c"]],
      ["a-b:::x --> c", ["a-b", "c"], ["a-b>c"]],
      ["a-b & c-d --> e", ["a-b", "c-d", "e"], ["a-b>e", "c-d>e"]],
      // An `o` or an `x` after a dash is inside the id, not an arrow's
      // marker: `a-o-->b` is `a-o` and a plain arrow, and so is `a.o-->b`.
      ["a-o-->b", ["a-o", "b"], ["a-o>b"]],
      ["a.o-->b", ["a.o", "b"], ["a.o>b"]],
    ];
    for (const [line, nodeIds, edgeEnds] of reads) {
      const { document, diagnostics } = parseSiren(`flowchart TB\n  ${line}\n`);
      expect([line, diagnostics]).toEqual([line, []]);
      if (document?.kind !== "flowchart") throw new Error(`no flowchart for "${line}"`);
      expect([line, document.nodes.map((n) => n.id)]).toEqual([line, nodeIds]);
      expect([line, document.edges.map((e) => `${e.from}>${e.to}`)]).toEqual([line, edgeEnds]);
    }

    // The marker still works where it is one: `a-o--ob` ends in a circle.
    const circle = parseSiren("flowchart TB\n  a-o--ob\n");
    if (circle.document?.kind !== "flowchart") throw new Error("no flowchart");
    expect(circle.document.edges.map((e) => [e.from, e.to, e.toEnd])).toEqual([
      ["a-o", "b", "circle"],
    ]);

    for (const refused of ["a--b", "a - b", "a-.b --> c"]) {
      expect([refused, parseSiren(`flowchart TB\n  ${refused}\n`).document]).toEqual([refused, null]);
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
    expect(document.nodes.map((node) => node.label.text)).toEqual(["a==>b", "B"]);
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
    return document.edges.map((edge) => [`${edge.from}-${edge.to}`, (edge.label?.text ?? null)]);
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
      document.edges.map((edge) => [(edge.label?.text ?? null), edge.line, edge.fromEnd, edge.toEnd, edge.minLength]),
    ).toEqual([
      ["yes", "solid", "none", "arrow", 2],
      ["no", "thick", "none", "arrow", 1],
      ["maybe", "dotted", "none", "arrow", 1],
      ["both", "solid", "arrow", "arrow", 1],
    ]);
  });

  it("lets an inline label close with the short dotted body, and does not let one open with it", () => {
    // Both halves measured with `pnpm --filter siren-core probe` against
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
      document.edges.map((edge) => [(edge.label?.text ?? null), edge.line, edge.fromEnd, edge.toEnd, edge.minLength]),
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
      chain.document.edges.map((edge) => [edge.from, edge.to, (edge.label?.text ?? null), edge.line, edge.toEnd]),
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
      document.edges.map((edge) => [(edge.label?.text ?? null), edge.line, edge.toEnd, edge.minLength]),
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
        label: plainLabel("Ingest"),
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
    expect(outer.label.text).toBe("Outer");
    // `A` was named inside `Inner` first, so it is `Inner`'s and not
    // `Outer`'s — the first-claim rule mermaid 11.17.2 applies, measured.
    expect(outer.nodeIds).toEqual(["C"]);
    expect(outer.subgraphs.map((sub) => sub.label.text)).toEqual(["Inner"]);
    expect(outer.subgraphs[0].nodeIds).toEqual(["A", "B"]);
  });

  it("keeps a node for the first subgraph that names it", () => {
    const { document } = parseFlowchartOk(
      "flowchart TB\n" +
        "  subgraph S\n    A --> B\n  end\n" +
        "  subgraph T\n    B --> C\n  end\n",
    );

    expect(document.subgraphs.map((sub) => [sub.label.text, sub.nodeIds])).toEqual([
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
        (sub) => [sub.name, sub.label.text],
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
    expect(document.subgraphs.map((sub) => [sub.label.text, sub.nodeIds])).toEqual([["S", ["A", "B"]]]);
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
 * `layoutDirectedGraph` honors it the way Mermaid 12's ELK layout does: a
 * cluster carrying a direction of its own lays its children out in it, for
 * as long as no edge voids it.
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
 * to the frame itself, as Mermaid 12's ELK layout routes it.
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
    expect(document.nodes.map((node) => [node.id, node.label.text])).toEqual([
      ["A", "A"],
      ["B", "Box"],
    ]);
    expect(document.subgraphs.map((sub) => sub.nodeIds)).toEqual([["A", "B"]]);
  });

  it("declares the node outside every block too", () => {
    const { document, diagnostics } = parseFlowchartOk("flowchart TB\n  A\n");

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label.text])).toEqual([["A", "A"]]);
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
    ' "stateDiagram", "stateDiagram-v2", or "erDiagram"';

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

    // Fourteen since the ER diagram joined, and it contributes exactly one:
    // measured, `erDiagram` has no `-v2` alias to collapse the way the class
    // and state rows above it do — the prefix detector fires on
    // `erDiagram-v2` but the lexer's keyword token stops at the `\b`, so that
    // spelling is the header plus an **entity named `-v2`**.
    expect(spellings).toHaveLength(14);
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

/**
 * Mermaid's order of work before any parser reads a line (11.17.2): its
 * `cleanupComments` removes only whole-line `%%` comments, then its
 * `encodeEntities` drops a style line's last `;` — so a `;` after a
 * mid-line `%%` is still on the line when that rule picks one.
 */
describe("the style-line `;` and a mid-line `%%`", () => {
  it("drops the comment's `;`, leaving the label's color a code", () => {
    // Measured (`--html`): `state "<span style='color:#f00;'>r</span>" as A %% x;`
    // draws `<span style="color:&amp;f00;">r</span>` — uncolored.
    const { document } = parseSiren(`stateDiagram-v2\n  state "<span style='color:#f00;'>r</span>" as A %% x;`);
    if (document === null || document.kind !== "state") {
      throw new Error("expected a state document");
    }
    const label = document.states.find((state) => state.id === "A")!.descriptions[0]!;
    expect(label.rows[0]!.map((run) => [run.text, run.color])).toEqual([["r", null]]);
  });
});

/**
 * Mermaid's `cleanupText` (11.17.2, `preprocessDiagram`'s first step): over
 * the whole document, before any diagram reads a line, each `="…"` inside a
 * stretch shaped `/<(\w+)([^>]*)>/` becomes `='…'`. The stretch is the
 * document's, not one label's, so it can run past a line's end to the next
 * `>` anywhere below.
 */
describe("Mermaid's tag-quote rewrite over the whole document", () => {
  it("rewrites a tag's quotes when the `>` ending its stretch is on a later line", () => {
    // Measured (probe): `A->>B: a<b c="d"` followed by `B->>A: e` stores
    // the first message as `a<b c='d'` — the second line's `->>` ends the
    // stretch.
    const { document } = parseSiren(`sequenceDiagram\nA->>B: a<b c="d"\nB->>A: e`);
    if (document === null || document.kind !== "sequence") {
      throw new Error("expected a sequence document");
    }
    expect(document.statements.map((statement) => ("label" in statement ? statement.label?.text : null))).toEqual([
      "a<b c='d'",
      "e",
    ]);
  });

  // Measured with the probe (mermaid 11.17.2), moved here from the
  // sequence dialect's reader when the rewrite became the document's: a
  // message `A->>B: a<b c="d">e` is stored and drawn `a<b c='d'>e`, while a
  // `"` anywhere else, or after `= ` with a space, or in an end tag, or in a
  // value the stretch's first `>` cuts short, is drawn as written.
  for (const [text, drawn] of [
    ['a<b c="d">e', "a<b c='d'>e"],
    ['<b c="d" e="f">g "h"', "<b c='d' e='f'>g \"h\""],
    ['a<1 x="y">z', "a<1 x='y'>z"],
    ['x<br class="x">y', "x<br class='x'>y"],
    ['say "hi"', 'say "hi"'],
    ['a<b c = "d">e', 'a<b c = "d">e'],
    ['a</b c="d">e', 'a</b c="d">e'],
    ['<b c="d>e">f', '<b c="d>e">f'],
    ['x="y" <b>', 'x="y" <b>'],
  ] as const) {
    it(`stores the message ${text} with Mermaid's quotes`, () => {
      const { document } = parseSiren(`sequenceDiagram\nA->>B: ${text}`);
      if (document === null || document.kind !== "sequence") {
        throw new Error("expected a sequence document");
      }
      const message = document.statements[0]!;
      expect("label" in message ? message.label?.text : null).toBe(drawn);
    });
  }

  it("reads a double-quoted attribute inside a quoted flowchart label as the tag's own", () => {
    // Measured (`--html`): `A["<span style="color:red">t</span>"]` draws
    // `<span style="color:red">t</span>` — the rewrite turns the inner
    // quotes into `'`, so they no longer end the label's fence.
    const { document, diagnostics } = parseFlowchartOk(`flowchart TB\nA["<span style="color:red">t</span>"]`);
    expect(diagnostics).toEqual([]);
    const label = document.nodes.find((node) => node.id === "A")!.label;
    expect(label.rows.map((row) => row.map((run) => [run.text, run.color]))).toEqual([[["t", "red"]]]);
  });
});

/**
 * The **document config** a Mermaid document carries in its frontmatter,
 * read as Mermaid 12.2.0 reads it (`matchFrontMatter`, `extractFrontMatter`,
 * `processFrontmatter`) and kept in `ParseResult.config`, applied nowhere
 * yet (ADR-0017).
 */
describe("a document's frontmatter", () => {
  it("leaves the config empty when the document carries none", () => {
    expect(parseSiren("flowchart TD\n  A --> B").config).toEqual({});
  });

  it("draws the diagram below a frontmatter and keeps its `config` as written", () => {
    // Measured (probe, 12.2.0): this document draws A --> B.
    const { document, diagnostics, config } = parseSiren(
      "---\nconfig:\n  theme: forest\n  themeVariables:\n    primaryColor: '#ff0000'\n---\nflowchart TD\n  A --> B",
    );
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(document?.kind).toBe("flowchart");
    expect(config).toEqual({ theme: "forest", themeVariables: { primaryColor: "#ff0000" } });
  });

  it("folds a frontmatter `displayMode` into `config.gantt.displayMode`, as Mermaid's `processFrontmatter` does", () => {
    expect(parseSiren("---\ndisplayMode: compact\n---\nflowchart TD\n  A --> B").config).toEqual({
      gantt: { displayMode: "compact" },
    });
    expect(
      parseSiren("---\ndisplayMode: compact\nconfig:\n  gantt:\n    barHeight: 30\n---\nflowchart TD\n  A --> B").config,
    ).toEqual({ gantt: { barHeight: 30, displayMode: "compact" } });
  });

  // Measured (probe, 12.2.0): MERMAID REJECTS THIS — "Cannot create
  // property 'displayMode' on boolean 'true'", and "... 'gantt' on string
  // 'foo'": `processFrontmatter` writes `displayMode` into whatever
  // `config.gantt` (or `config`) is, and a scalar takes no property.
  for (const [where, config] of [
    ["config.gantt", "config:\n  gantt: true\n"],
    ["config", "config: foo\n"],
  ] as const) {
    it(`refuses the document, at the opening fence, when \`displayMode\` must be written into a scalar ${where}`, () => {
      expect(parseSiren(`---\ndisplayMode: compact\n${config}---\nflowchart TD\n  A --> B`)).toEqual({
        document: null,
        diagnostics: [
          {
            severity: "error",
            message:
              `Frontmatter displayMode cannot be written into ${where}, which is not a mapping; ` +
              `the document is not drawn until ${where} is a mapping or displayMode is removed.`,
            line: 1,
            column: 1,
          },
        ],
        config: {},
      });
    });
  }

  it("refuses the document, at the opening fence, when its frontmatter is not YAML — Mermaid refuses it too", () => {
    // Measured (probe, 12.2.0): MERMAID REJECTS THIS — "unexpected end of
    // the stream within a flow collection (2:1)".
    expect(parseSiren("---\nconfig: [\n---\nflowchart TD\n  A --> B")).toEqual({
      document: null,
      diagnostics: [
        {
          severity: "error",
          message:
            "Frontmatter is not valid YAML (unexpected end of the stream within a flow collection); " +
            "the document is not drawn until the frontmatter is valid YAML.",
          line: 1,
          column: 1,
        },
      ],
      config: {},
    });
  });

  // Measured (probe, 12.2.0): each of these frontmatters is accepted and
  // the diagram below drawn.
  for (const [what, body] of [
    ["a string", "just a string\n"],
    ["a list", "- a\n- b\n"],
    ["nothing", "\n"],
  ] as const) {
    it(`reads a frontmatter holding ${what} as an empty one, without a word`, () => {
      const { document, diagnostics, config } = parseSiren(`---\n${body}---\nflowchart TD\n  A --> B`);
      expect(diagnostics).toEqual([]);
      expect(document?.kind).toBe("flowchart");
      expect(config).toEqual({});
    });
  }

  // Measured (probe, 12.2.0): each draws A --> B.
  for (const config of ["foo", "[1]"] as const) {
    it(`ignores a \`config: ${config}\` that is not a mapping, and says so at the opening fence`, () => {
      const { document, diagnostics, config: read } = parseSiren(`---\nconfig: ${config}\n---\nflowchart TD\n  A --> B`);
      expect(document?.kind).toBe("flowchart");
      expect(read).toEqual({});
      expect(diagnostics).toEqual([
        {
          severity: "warning",
          message: "Frontmatter config is not a mapping; it is ignored, and the diagram is drawn without it.",
          line: 1,
          column: 1,
        },
      ]);
    });
  }

  it("drops a top-level key Mermaid does not know, unread and unreported, as Mermaid does", () => {
    // Measured (probe, 12.2.0): `siren:` beside `config:` draws A --> B.
    const { document, diagnostics, config } = parseSiren(
      "---\nsiren:\n  roles: x\nconfig:\n  theme: forest\n---\nflowchart TD\n  A --> B",
    );
    expect(document?.kind).toBe("flowchart");
    expect(config).toEqual({ theme: "forest" });
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Document config "theme" is read but not applied yet; the diagram is drawn without it.',
    ]);
  });

  it("reads an indented frontmatter, closed at the same indent, with the indent taken off each YAML line", () => {
    // Measured (probe, 12.2.0): this document draws A --> B.
    const { document, diagnostics, config } = parseSiren(
      "  ---\n  config:\n    theme: forest\n  ---\nflowchart TD\n  A --> B",
    );
    expect(document?.kind).toBe("flowchart");
    expect(config).toEqual({ theme: "forest" });
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message: 'Document config "theme" is read but not applied yet; the diagram is drawn without it.',
        line: 1,
        column: 3,
      },
    ]);
  });

  // Each measured (probe, 12.2.0) as MERMAID REJECTS THIS: a blank line
  // above the fence, a fence never closed, and a body with no line between
  // the fences are no frontmatter, so the `---` is diagram text.
  for (const [what, source] of [
    ["below a blank line", "\n---\nconfig:\n  theme: forest\n---\nflowchart TD\n  A --> B"],
    ["never closed", "---\nconfig:\n  theme: forest\nflowchart TD\n  A --> B"],
    ["closed on the very next line", "---\n---\nflowchart TD\n  A --> B"],
  ] as const) {
    it(`does not read a frontmatter ${what}, and refuses the \`---\` as it always has`, () => {
      const { document, diagnostics, config } = parseSiren(source);
      expect(document).toBeNull();
      expect(config).toEqual({});
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ severity: "error", line: source.startsWith("\n") ? 2 : 1, column: 1 });
      expect(diagnostics[0]!.message).toMatch(/found "---"$/);
    });
  }

  // Measured (probe, 12.2.0), both MERMAID REJECTS THIS: a closing fence
  // closes only at the opening fence's own indent, so neither of these has
  // a frontmatter at all.
  for (const [what, source, column] of [
    ["a deeper indent than the opening", "---\nconfig:\n  theme: forest\n  ---\nflowchart TD\n  A --> B", 1],
    ["a shallower indent than the opening", "  ---\n  config:\n    theme: forest\n---\nflowchart TD\n  A --> B", 3],
  ] as const) {
    it(`does not read a frontmatter whose closing fence is at ${what}`, () => {
      const { document, diagnostics, config } = parseSiren(source);
      expect(document).toBeNull();
      expect(config).toEqual({});
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ severity: "error", line: 1, column });
      expect(diagnostics[0]!.message).toMatch(/found "---"$/);
    });
  }

  it("ends a frontmatter at its first closing fence, so a second `---` further down is diagram text", () => {
    // Measured (probe, 12.2.0), MERMAID REJECTS THIS — "No diagram type
    // detected" for the text from `config:` on: the frontmatter was
    // `title: a` alone.
    const { document, diagnostics } = parseSiren(
      "---\ntitle: a\n---\nconfig:\n  theme: forest\n---\nflowchart TD\n  A --> B",
    );
    expect(document).toBeNull();
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 4, column: 1 });
    expect(errors[0]!.message).toMatch(/found "config:"$/);
  });

  it("leaves a `---` after the diagram to the diagram, though it is the document's last closing fence", () => {
    // Measured (probe, 12.2.0), MERMAID REJECTS THIS — a parse error at
    // the trailing `---`: Mermaid's rule looks for the last fence only to
    // bound its search, and the frontmatter still closes at the first.
    const { document, diagnostics, config } = parseSiren(
      "---\nconfig:\n  theme: forest\n---\nflowchart TD\n  A --> B\n---\n",
    );
    expect(document).toBeNull();
    expect(config).toEqual({ theme: "forest" });
    expect(diagnostics.filter((d) => d.severity === "error").map((d) => d.line)).toEqual([7]);
  });

  it("keeps every later line's number: an error below a frontmatter points at the line the author wrote", () => {
    const { document, diagnostics } = parseSiren(
      "---\nconfig:\n  theme: forest\n---\nflowchart TD\n  A --> B\n  A -->",
    );
    expect(document).toBeNull();
    expect(diagnostics.filter((d) => d.severity === "error").map((d) => d.line)).toEqual([7]);
  });

  it("warns once for the title and once for each top-level config key, at the opening fence, that none is applied yet", () => {
    const { diagnostics } = parseSiren(
      "---\ntitle: Orders\nconfig:\n  theme: forest\n  look: handDrawn\n---\nflowchart TD\n  A --> B",
    );
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message: "Frontmatter title is read but not drawn yet; the diagram is drawn without it.",
        line: 1,
        column: 1,
      },
      {
        severity: "warning",
        message: 'Document config "theme" is read but not applied yet; the diagram is drawn without it.',
        line: 1,
        column: 1,
      },
      {
        severity: "warning",
        message: 'Document config "look" is read but not applied yet; the diagram is drawn without it.',
        line: 1,
        column: 1,
      },
    ]);
  });
});

/**
 * A document's `%%{…}%%` directives, read and removed as Mermaid 12.2.0
 * reads and removes them (`directiveRegex`, `detectInit`, `detectDirective`,
 * `processDirectives`), their settings joined to the frontmatter's in
 * `ParseResult.config` as `preprocessDiagram` joins them, applied nowhere
 * yet (ADR-0017). Every config below was measured with Mermaid's own
 * `mermaid.parse`, which hands back the config its preprocessing read.
 */
describe("a document's directives", () => {
  it("reads a one-line init into the config, and says at the directive that it is not applied yet", () => {
    // Measured (12.2.0): config `{ theme: "dark" }`, and A --> B drawn.
    const { document, diagnostics, config } = parseSiren('%%{init: {"theme": "dark"}}%%\nflowchart TB\n  A --> B');
    expect(document?.kind).toBe("flowchart");
    expect(config).toEqual({ theme: "dark" });
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message: 'Document config "theme" is read but not applied yet; the diagram is drawn without it.',
        line: 1,
        column: 1,
      },
    ]);
  });

  it("reads an init spread over several lines whole, so none of its lines is left behind as diagram text", () => {
    // Measured (12.2.0): config `{ theme: "dark", flowchart: { curve: "basis" } }`, and A --> B drawn.
    const { document, diagnostics, config } = parseSiren(
      '%%{\n  init: {\n    "theme": "dark",\n    "flowchart": {"curve": "basis"}\n  }\n}%%\nflowchart TB\n  A --> B',
    );
    expect(document?.kind).toBe("flowchart");
    expect(config).toEqual({ theme: "dark", flowchart: { curve: "basis" } });
    expect(diagnostics.map((d) => [d.severity, d.line])).toEqual([
      ["warning", 1],
      ["warning", 1],
    ]);
  });

  it("keeps every later line's number: an error below a multi-line init points at the line the author wrote", () => {
    // Measured (12.2.0): Mermaid rejects the trailing `A -->` too.
    const { document, diagnostics } = parseSiren(
      '%%{\n  init: {\n    "theme": "dark"\n  }\n}%%\nflowchart TB\n  A --> B\n  A -->',
    );
    expect(document).toBeNull();
    expect(diagnostics.filter((d) => d.severity === "error").map((d) => d.line)).toEqual([8]);
  });

  it("merges several inits in order, a later one's settings over an earlier one's, each key reported where it was decided", () => {
    // Measured (12.2.0): config `{ look: "handDrawn", theme: "forest",
    // flowchart: { curve: "basis", htmlLabels: false } }`.
    const { document, diagnostics, config } = parseSiren(
      '%%{init: {"look": "handDrawn", "theme": "dark", "flowchart": {"curve": "basis"}}}%%\n' +
        '%%{init: {"theme": "forest", "flowchart": {"htmlLabels": false}}}%%\n' +
        "flowchart TB\n  A --> B",
    );
    expect(document?.kind).toBe("flowchart");
    expect(config).toEqual({ look: "handDrawn", theme: "forest", flowchart: { curve: "basis", htmlLabels: false } });
    expect(diagnostics.map((d) => [d.message, d.line])).toEqual([
      ['Document config "look" is read but not applied yet; the diagram is drawn without it.', 1],
      ['Document config "theme" is read but not applied yet; the diagram is drawn without it.', 2],
      ['Document config "flowchart" is read but not applied yet; the diagram is drawn without it.', 2],
    ]);
  });

  // Measured (12.2.0, `detectInit`): an init's `config` is moved under the
  // key of the diagram type Mermaid detects — `flowchart` for both of its
  // headers, `classDiagram` and `stateDiagram` for both spellings of theirs.
  for (const [header, body, key] of [
    ["flowchart TB", "A --> B", "flowchart"],
    ["graph TB", "A --> B", "flowchart"],
    ["sequenceDiagram", "A->>B: hi", "sequence"],
    ["classDiagram-v2", "class A", "classDiagram"],
    ["stateDiagram-v2", "A --> B", "stateDiagram"],
    ["erDiagram", "A ||--o{ B : has", "er"],
  ] as const) {
    it(`moves an init's \`config\` under \`${key}\` in a document headed \`${header}\`, as Mermaid's detectInit does`, () => {
      const { document, diagnostics, config } = parseSiren(
        `%%{init: {"theme": "dark", "config": {"padding": 5}}}%%\n${header}\n  ${body}`,
      );
      expect(document).not.toBeNull();
      expect(config).toEqual({ theme: "dark", [key]: { padding: 5 } });
      expect(diagnostics.map((d) => d.message)).toEqual([
        'Document config "theme" is read but not applied yet; the diagram is drawn without it.',
        `Document config "${key}" is read but not applied yet; the diagram is drawn without it.`,
      ]);
    });
  }

  it("ignores every init when one is not JSON, as Mermaid does, says so at that one, and draws the diagram", () => {
    // Measured (12.2.0): config `{}` — `detectDirective` stops at the first
    // init it cannot parse and hands back none of them — and A --> B drawn.
    const { document, diagnostics, config } = parseSiren(
      '%%{init: {"theme": "dark"}}%%\n  %%{init: {bad json}}%%\nflowchart TB\n  A --> B',
    );
    expect(document?.kind).toBe("flowchart");
    expect(config).toEqual({});
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          "Init directive is not valid JSON, so every init directive in the document is ignored and " +
          "the diagram is drawn without them; every init directive must be valid JSON for any of them to apply.",
        line: 2,
        column: 3,
      },
    ]);
  });

  it("reads a `%%{wrap}%%` as the config's `wrap`, as Mermaid's processDirectives does, and removes it", () => {
    // Measured (12.2.0): config `{ theme: "dark", wrap: true }`, and A --> B drawn.
    const { document, diagnostics, config } = parseSiren(
      '%%{init: {"theme": "dark"}}%%\n%%{wrap}%%\nflowchart TB\n  A --> B',
    );
    expect(document?.kind).toBe("flowchart");
    expect(config).toEqual({ theme: "dark", wrap: true });
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message: 'Document config "theme" is read but not applied yet; the diagram is drawn without it.',
        line: 1,
        column: 1,
      },
      {
        severity: "warning",
        message: 'Document config "wrap" is read but not applied yet; the diagram is drawn without it.',
        line: 2,
        column: 1,
      },
    ]);
  });

  it("removes a directive Mermaid does not read, and says it was removed unread", () => {
    // Measured (12.2.0): config `{}`, and A --> B drawn.
    const { document, diagnostics, config } = parseSiren(
      '%%{foo}%%\nflowchart TB\n  A --> B %%{bar: {"x": 1}}%%',
    );
    expect(document?.kind).toBe("flowchart");
    expect(config).toEqual({});
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          'Directive "foo" is removed unread; the diagram is drawn without it. ' +
          "Only init and wrap directives are read, and wrap directives only while every wrap directive's " +
          "arguments are valid JSON; remove this directive or rewrite it to be read.",
        line: 1,
        column: 1,
      },
      {
        severity: "warning",
        message:
          'Directive "bar" is removed unread; the diagram is drawn without it. ' +
          "Only init and wrap directives are read, and wrap directives only while every wrap directive's " +
          "arguments are valid JSON; remove this directive or rewrite it to be read.",
        line: 3,
        column: 11,
      },
    ]);
  });

  it("removes every wrap directive unread when one's arguments are not JSON, and says how each would be read", () => {
    // `wrapOf`: one wrap directive whose arguments do not parse leaves the
    // config without `wrap`, so the readable `%%{wrap}%%` is removed unread
    // too — the warning has to be true of it as well as of the broken one.
    const { diagnostics } = parseSiren("%%{wrap}%%\n%%{wrap: {bad}}%%\nflowchart TB\n  A --> B");
    const unread =
      'Directive "wrap" is removed unread; the diagram is drawn without it. ' +
      "Only init and wrap directives are read, and wrap directives only while every wrap directive's " +
      "arguments are valid JSON; remove this directive or rewrite it to be read.";
    expect(diagnostics).toEqual([
      { severity: "warning", message: unread, line: 1, column: 1 },
      { severity: "warning", message: unread, line: 2, column: 1 },
    ]);
  });

  it("merges an init over the frontmatter's config, the init winning, each key reported where its value was decided", () => {
    // Measured (12.2.0): config `{ theme: "dark", look: "handDrawn",
    // flowchart: { curve: "basis", htmlLabels: false } }` —
    // `cleanAndMerge(frontmatter, directive)`, merged all the way down.
    const { document, diagnostics, config } = parseSiren(
      "---\nconfig:\n  theme: forest\n  look: handDrawn\n  flowchart:\n    curve: linear\n    htmlLabels: false\n---\n" +
        '%%{init: {"theme": "dark", "flowchart": {"curve": "basis"}}}%%\nflowchart TB\n  A --> B',
    );
    expect(document?.kind).toBe("flowchart");
    expect(config).toEqual({ theme: "dark", look: "handDrawn", flowchart: { curve: "basis", htmlLabels: false } });
    expect(diagnostics.map((d) => [d.message, d.line])).toEqual([
      ['Document config "look" is read but not applied yet; the diagram is drawn without it.', 1],
      ['Document config "theme" is read but not applied yet; the diagram is drawn without it.', 9],
      ['Document config "flowchart" is read but not applied yet; the diagram is drawn without it.', 9],
    ]);
  });

  it("reads an `initialize` as an init, and its `'` as `\"`, as Mermaid's detectDirective does", () => {
    // Measured (12.2.0): config `{ theme: "dark" }`, and A --> B drawn.
    const { document, config } = parseSiren("%%{initialize: {'theme': 'dark'}}%%\nflowchart TB\n  A --> B");
    expect(document?.kind).toBe("flowchart");
    expect(config).toEqual({ theme: "dark" });
  });

  it("keeps every later column: an error after a directive on the same line points at the column the author wrote", () => {
    // Measured (probe, 12.2.0): MERMAID REJECTS THIS — no diagram type
    // detected for `classDiagrm`.
    const { document, diagnostics } = parseSiren("  %%{wrap}%%  classDiagrm\n  class A");
    expect(document).toBeNull();
    expect(diagnostics.filter((d) => d.severity === "error").map((d) => [d.line, d.column])).toEqual([[1, 15]]);
  });

  it("keeps every later column on the line where a multi-line init ends", () => {
    // Measured (probe, 12.2.0): MERMAID REJECTS THIS — a parse error at
    // `flowchartTB`.
    const { document, diagnostics } = parseSiren('%%{init: {\n  "theme": "dark"}}%% flowchartTB\n  A --> B');
    expect(document).toBeNull();
    expect(diagnostics.filter((d) => d.severity === "error").map((d) => [d.line, d.column])).toEqual([[2, 23]]);
  });

  it("reports a key at the init that last changed it, not at a later init whose value Mermaid's merge refuses", () => {
    // Measured (12.2.0): config `{ flowchart: { curve: "basis" } }` — a
    // scalar never replaces an object in `assignWithDepth`.
    const { config, diagnostics } = parseSiren(
      '%%{init: {"flowchart": {"curve": "basis"}}}%%\n%%{init: {"flowchart": 1}}%%\nflowchart TB\n  A --> B',
    );
    expect(config).toEqual({ flowchart: { curve: "basis" } });
    expect(diagnostics.map((d) => [d.message, d.line])).toEqual([
      ['Document config "flowchart" is read but not applied yet; the diagram is drawn without it.', 1],
    ]);
  });

  it("reads a lone init holding a list as Mermaid's merge reads it: each item under its index", () => {
    // Measured (12.2.0): `detectInit` hands back `[1, 2]`, and
    // `cleanAndMerge({}, [1, 2])` (es-toolkit's `merge`) makes it
    // `{ "0": 1, "1": 2 }`; A --> B drawn.
    const { document, config } = parseSiren("%%{init: [1, 2]}%%\nflowchart TB\n  A --> B");
    expect(document?.kind).toBe("flowchart");
    expect(config).toEqual({ 0: 1, 1: 2 });
  });

  it("refuses the document, at the wrap directive, when a bare-word init leaves `wrap` nowhere to go — Mermaid refuses it too", () => {
    // Measured (probe, 12.2.0): MERMAID REJECTS THIS — "Cannot create
    // property 'wrap' on string 'dark'".
    expect(parseSiren("%%{init: dark}%%\n  %%{wrap}%%\nflowchart TB\n  A --> B")).toEqual({
      document: null,
      diagnostics: [
        {
          severity: "error",
          message:
            'Wrap directive cannot be written into the init directive "dark", which is not a mapping; ' +
            'the document is not drawn until that init directive is a mapping, such as {"theme": "dark"}, ' +
            "or the wrap directive is removed.",
          line: 2,
          column: 3,
        },
      ],
      config: {},
    });
  });

  it("drops an init's `config` when there are several inits, as Mermaid's sanitizing does before any move", () => {
    // Measured (12.2.0, `detectInit`): `{ theme: "dark", look: "neo" }`.
    const { config } = parseSiren(
      '%%{init: {"theme": "dark"}}%%\n%%{init: {"config": {"curve": "basis"}, "look": "neo"}}%%\nflowchart TB\n  A --> B',
    );
    expect(config).toEqual({ theme: "dark", look: "neo" });
  });
});

/**
 * A `%%` in the middle of a flowchart line (CONTEXT.md **Comment**).
 * Mermaid 12.2.0's `cleanupComments` removes whole-line comments only, and
 * the flowchart lexer has no `%%` rule of its own (`%` is a node-string
 * character), so a mid-line `%%` reaches the grammar: inside text it is
 * text, and after a complete statement it is a parse error. Measured with
 * `pnpm --filter siren-core probe`; the table is T1's 量測結果.
 */
describe("a `%%` in the middle of a flowchart line", () => {
  const NOT_A_COMMENT =
    'A "%%" in the middle of a line is not a comment: only a line that starts with "%%" is one. ' +
    "If it is a comment, move it to a line of its own.";

  it("refuses a `%%` trailing an edge, at its `%%`, where the grammar has no room for it", () => {
    // Measured: `A --> B %% x` is a parse error ("Expecting 'SEMI',
    // 'NEWLINE', 'EOF', … got 'NODE_STRING'"), on the last line or not.
    const { document, diagnostics } = parseSiren("flowchart TB\n  A --> B %% and back\n  B --> C");

    expect(document).toBeNull();
    expect(diagnostics).toEqual([{ severity: "error", message: NOT_A_COMMENT, line: 2, column: 11 }]);
  });

  it("reads a subgraph's bare name with a `%%` after it as one title, as its grammar reads a run of words", () => {
    // Measured: `subgraph S %% zz` records the title "S %% zz" under a
    // generated id (`subGraph0`), so `S --> B` below names a node, not it;
    // `subgraph S [t %% zz]` keeps "t %% zz" as the bracketed title.
    const { document, diagnostics } = parseFlowchartOk(
      "flowchart TB\n  subgraph S %% zz\n    A\n  end\n  subgraph T [t %% zz]\n    C\n  end",
    );

    expect(diagnostics).toEqual([]);
    expect(document.subgraphs.map((subgraph) => [subgraph.name, subgraph.label.text])).toEqual([
      [null, "S %% zz"],
      ["T", "t %% zz"],
    ]);
  });

  it("refuses a `%%` after a subgraph's bracketed title, at its `%%`", () => {
    // Measured: `subgraph S[t] %% zz` is "Expecting 'SEMI', 'NEWLINE', 'EOF', got 'SPACE'".
    const { document, diagnostics } = parseSiren("flowchart TB\n  subgraph S[t] %% zz\n    A\n  end");

    expect(document).toBeNull();
    expect(diagnostics).toEqual([{ severity: "error", message: NOT_A_COMMENT, line: 2, column: 17 }]);

    // Measured: `subgraph S %% end` is read with its `end` as the block's
    // own end, swallowing the next line into the title ("S %% end\nA") —
    // a picture nobody wrote, so it is refused rather than drawn.
    const swallowed = parseSiren("flowchart TB\n  subgraph S %% end\n    A\n  end");
    expect(swallowed.document).toBeNull();
    expect(swallowed.diagnostics).toEqual([{ severity: "error", message: NOT_A_COMMENT, line: 2, column: 14 }]);
  });

  it("reads a word that only contains `end` as a word of a subgraph's title", () => {
    // Measured: `subgraph S %% %%end` records the title "S %% %%end" — only a
    // word that is `end` ends the block.
    const { document, diagnostics } = parseFlowchartOk("flowchart TB\n  subgraph S %% %%end\n    A\n  end");

    expect(diagnostics).toEqual([]);
    expect(document.subgraphs.map((subgraph) => [subgraph.name, subgraph.label.text])).toEqual([[null, "S %% %%end"]]);
  });

  it("reads a block's `direction` with a `%%` after it as that direction — its rule runs to the line's end", () => {
    // Measured: `direction LR %% zz` inside a subgraph records `dir: "LR"` —
    // the lexer's `.*direction\s+LR[^\n]*` takes the rest of the line.
    const { document, diagnostics } = parseFlowchartOk(
      "flowchart TB\n  subgraph S\n    direction LR %% across\n    A --> B\n  end",
    );

    expect(diagnostics).toEqual([]);
    expect(document.subgraphs.map((subgraph) => subgraph.direction)).toEqual(["LR"]);
  });

  it("keeps a `%%` in a declaration list and an accessibility line as part of what they hold", () => {
    // Measured: `style A fill:#f00 %% zz` records `fill:#f00 %% zz`,
    // `classDef c fill:#f00 %% zz` the same, `linkStyle 0 stroke:#f00 %% zz`
    // `stroke:#f00 %% zz`; `accTitle: t %% zz` the title "t %% zz" and
    // `accDescr: d %% zz` the description "d %% zz".
    const { document, diagnostics } = parseFlowchartOk(
      [
        "flowchart TB",
        "  accTitle: t %% zz",
        "  accDescr: d %% zz",
        "  A --> B",
        "  style A fill:#f00 %% zz",
        "  classDef c fill:#0f0 %% zz",
        "  linkStyle 0 stroke:#00f %% zz",
      ].join("\n"),
    );

    expect(diagnostics).toEqual([]);
    expect([document.accTitle, document.accDescr]).toEqual(["t %% zz", "d %% zz"]);
    expect(document.styles.map((style) => [style.styleKind, style.properties])).toEqual([
      ["style", [{ property: "fill", value: "#f00 %% zz" }]],
      ["classDef", [{ property: "fill", value: "#0f0 %% zz" }]],
    ]);
    expect(document.linkStyles.map((style) => style.properties)).toEqual([
      [{ property: "stroke", value: "#00f %% zz" }],
    ]);
  });

  it("keeps a `%%` in a click's quoted tooltip, and refuses one trailing the click", () => {
    // Measured: `click A "https://x.org" "t %% zz"` records the tooltip
    // "t %% zz"; `click A "https://x.org" %% zz` is "Expecting 'STR',
    // 'LINK_TARGET', got 'NODE_STRING'".
    const kept = parseFlowchartOk('flowchart TB\n  A\n  click A "https://x.org" "t %% zz"');
    expect(kept.diagnostics).toEqual([]);
    expect(kept.document.interactions.map((interaction) => interaction.tooltip)).toEqual(["t %% zz"]);

    const refused = parseSiren('flowchart TB\n  A\n  click A "https://x.org" %% zz');
    expect(refused.document).toBeNull();
    expect(refused.diagnostics).toEqual([{ severity: "error", message: NOT_A_COMMENT, line: 3, column: 27 }]);
  });

  it("refuses a `%%` after every other complete statement, at its `%%`, once", () => {
    // Measured, each a parse error on its line: a node's declaration
    // (`A[a] %% zz`, `A %% zz`, `A:::c %% zz`, `A@{ shape: rect } %% zz`),
    // a statement ended by `;` (`A --> B; %% zz`), a block's `end`
    // (`end %% zz`) and a class list (`class A c %% zz`).
    for (const [body, line, column] of [
      ["  A[a] %% zz", 2, 8],
      ["  A %% zz", 2, 5],
      ["  A:::c %% zz", 2, 9],
      ["  A@{ shape: rect } %% zz", 2, 21],
      ["  A --> B; %% zz", 2, 12],
      ["  subgraph S\n    A\n  end %% zz", 4, 7],
      ["  A\n  classDef c fill:#f00\n  class A c %% zz", 4, 13],
    ] as const) {
      const { document, diagnostics } = parseSiren(`flowchart TB\n${body}`);

      expect([body, document]).toEqual([body, null]);
      expect([body, diagnostics]).toEqual([body, [{ severity: "error", message: NOT_A_COMMENT, line, column }]]);
    }
  });

  it("still cuts a `%%` in a timeline block to the line's end — that block is Siren's syntax, not Mermaid's", () => {
    // ADR-0017: the document without its timeline blocks is the Mermaid one,
    // so a flowchart's reading of `%%` stops at its first timeline header.
    const commented = parseSiren("flowchart TB\n  A --> B\ntimeline: %% the reveal\n  enter B fade %% last\n");
    const plain = parseSiren("flowchart TB\n  A --> B\ntimeline:\n  enter B fade\n");

    expect(commented.diagnostics).toEqual([]);
    expect(commented).toEqual(plain);
  });

  it("reads a `%%` glued to the end of a timeline target as the target's, as the flowchart reads the id", () => {
    // `A%%x` is one node id (measured on Mermaid 12.2.0), so a timeline
    // must be able to name it; cutting the line at its `%%` used to aim
    // every action at `A` instead, silently.
    const { document, diagnostics } = parseSiren(
      "flowchart TB\n  A --> A%%x\ntimeline:\n  enter A%%x fade\n  highlight A%%x glow\n  unhighlight A%%x %% back\n",
    );

    expect(diagnostics).toEqual([]);
    expect(document?.timeline?.entries.map((entry) => [entry.kind, entry.targetId])).toEqual([
      ["enter", "A%%x"],
      ["highlight", "A%%x"],
      ["unhighlight", "A%%x"],
    ]);
  });

  it("refuses a `%%` trailing the header, at its `%%`", () => {
    // Measured: `flowchart TB %% x` is "Expecting 'NEWLINE', got 'NODE_STRING'"
    // on line 1; so is `graph LR %% x`.
    for (const header of ["flowchart TB", "graph LR"]) {
      const { document, diagnostics } = parseSiren(`${header} %% what this is\n  A --> B`);

      expect([header, document]).toEqual([header, null]);
      expect([header, diagnostics]).toEqual([
        header,
        [{ severity: "error", message: NOT_A_COMMENT, line: 1, column: header.length + 2 }],
      ]);
    }
  });

  it("keeps a `%%` written inside a node's label or an edge's label as text", () => {
    // Measured: `A[50 %% done]` → text "50 %% done"; `-->|a %% b|` → "a %% b";
    // `-- c %% d -->` → "c %% d"; `B("e %% f")` → "e %% f".
    const { document, diagnostics } = parseFlowchartOk(
      'flowchart TB\n  A[50 %% done] -->|a %% b| B("e %% f")\n  B -- c %% d --> C{g %% h}',
    );

    expect(diagnostics).toEqual([]);
    expect(document.nodes.map((node) => [node.id, node.label.text])).toEqual([
      ["A", "50 %% done"],
      ["B", "e %% f"],
      ["C", "g %% h"],
    ]);
    expect(document.edges.map((edge) => edge.label?.text)).toEqual(["a %% b", "c %% d"]);
  });
});

/**
 * A `%%` in the middle of a sequence line (CONTEXT.md **Comment**). Mermaid
 * 12.2.0's `cleanupComments` removes whole-line comments only; the sequence
 * lexer has `%%` rules of its own (`%(?!\{)[^\n]*` and `[^\}]%%[^\n]*`), but
 * they only fire at a token boundary — the rules that read text (a
 * message's or note's text after its `:`, a block's label, a participant's
 * name, a title) read on past a `%%` first. Measured with
 * `pnpm --filter siren-core probe`; the table is T1's 量測結果 (sequence).
 */
describe("a `%%` in the middle of a sequence line", () => {
  const NOT_A_COMMENT =
    'A "%%" in the middle of a line is not a comment: only a line that starts with "%%" is one. ' +
    "If it is a comment, move it to a line of its own.";

  function sequenceOk(body: string): SequenceDocument {
    const { document, diagnostics } = parseSiren(`sequenceDiagram\n${body}`);
    expect([body, diagnostics]).toEqual([body, []]);
    if (document === null || document.kind !== "sequence") {
      throw new Error(`expected a sequence document for ${JSON.stringify(body)}`);
    }
    return document;
  }

  it("keeps a `%%` in every piece of text a statement holds, as Mermaid records it", () => {
    // Measured: each row's text is stored with its `%% zz` — a message's and
    // a note's text, a block's or branch's label (a label-less `loop %% zz`
    // has the label "%% zz"), a box's label with or without a color, the
    // title in both spellings, the accessibility lines, and a participant's
    // `as` alias, declared or created.
    const messageText = (document: SequenceDocument) =>
      document.statements.flatMap((s) => (s.kind === "message" || s.kind === "note" ? [s.label.text] : []));
    const blockLabels = (document: SequenceDocument) =>
      document.statements.flatMap((s) =>
        s.kind === "loop" || s.kind === "opt" || s.kind === "break"
          ? [s.label?.text ?? null]
          : s.kind === "alt" || s.kind === "par" || s.kind === "critical"
            ? s.branches.map((branch) => branch.label?.text ?? null)
            : [],
      );

    expect(messageText(sequenceOk("  A->>B: hi %% zz"))).toEqual(["hi %% zz"]);
    expect(messageText(sequenceOk("  A-->>B: hi %% zz"))).toEqual(["hi %% zz"]);
    expect(messageText(sequenceOk("  A->>+B: hi %% zz"))).toEqual(["hi %% zz"]);
    expect(messageText(sequenceOk("  A->>B: m\n  note over A: n %% zz"))).toEqual(["m", "n %% zz"]);
    expect(messageText(sequenceOk("  A->>B: m\n  note right of A: n %% zz"))).toEqual(["m", "n %% zz"]);
    expect(messageText(sequenceOk("  A->>B: m\n  note over A,B: n %% zz"))).toEqual(["m", "n %% zz"]);

    expect(blockLabels(sequenceOk("  loop L %% zz\n    A->>B: m\n  end"))).toEqual(["L %% zz"]);
    expect(blockLabels(sequenceOk("  loop %% zz\n    A->>B: m\n  end"))).toEqual(["%% zz"]);
    expect(blockLabels(sequenceOk("  opt O %% zz\n    A->>B: m\n  end"))).toEqual(["O %% zz"]);
    expect(blockLabels(sequenceOk("  break B %% zz\n    A->>B: m\n  end"))).toEqual(["B %% zz"]);
    expect(blockLabels(sequenceOk("  alt X\n    A->>B: m\n  else Y %% zz\n    A->>B: n\n  end"))).toEqual([
      "X",
      "Y %% zz",
    ]);
    expect(blockLabels(sequenceOk("  par X\n    A->>B: m\n  and Y %% zz\n    A->>B: n\n  end"))).toEqual([
      "X",
      "Y %% zz",
    ]);
    expect(
      blockLabels(sequenceOk("  critical X\n    A->>B: m\n  option Y %% zz\n    A->>B: n\n  end")),
    ).toEqual(["X", "Y %% zz"]);

    const boxed = sequenceOk("  box aqua G %% zz\n    participant A\n  end\n  A->>B: m");
    expect(boxed.boxes.map((box) => [box.color, box.label?.text])).toEqual([["aqua", "G %% zz"]]);
    const plainBox = sequenceOk("  box G %% zz\n    participant A\n  end\n  A->>B: m");
    expect(plainBox.boxes.map((box) => [box.color, box.label?.text])).toEqual([[null, "G %% zz"]]);

    expect(sequenceOk("  title T %% zz\n  A->>B: m").title).toBe("T %% zz");
    expect(sequenceOk("  title: T %% zz\n  A->>B: m").title).toBe("T %% zz");
    expect(sequenceOk("  accTitle: T %% zz\n  A->>B: m").accTitle).toBe("T %% zz");
    expect(sequenceOk("  accDescr: T %% zz\n  A->>B: m").accDescr).toBe("T %% zz");

    const aliased = sequenceOk("  participant A as Al %% zz\n  A->>B: m");
    expect(aliased.participants.map((p) => [p.id, p.label.text])).toEqual([["A", "Al %% zz"]]);
    const createdAlias = sequenceOk("  A->>B: m\n  create participant C as Cee %% zz\n  A->>C: n");
    expect(createdAlias.participants.map((p) => [p.id, p.label.text])).toEqual([["C", "Cee %% zz"]]);
  });

  it("reads a `%%` after the header as a comment, as the sequence lexer does after a keyword", () => {
    // Measured: `sequenceDiagram %% zz` is accepted and nothing stores "zz".
    const commented = parseSiren("sequenceDiagram %% what this is\n  A->>B: m");
    const plain = parseSiren("sequenceDiagram\n  A->>B: m");

    expect(commented.diagnostics).toEqual([]);
    expect(commented).toEqual(plain);
  });

  it("refuses a `%%` after `activate` or `deactivate` names its participant, at its `%%`", () => {
    // Measured: `deactivate B %% zz` is refused ("Trying to inactivate an
    // inactive participant (B %% zz)"); `activate B %% zz` activates a
    // participant "B %% zz" that no lane has, and Mermaid fails to draw it
    // ("Cannot read properties of undefined (reading 'x')").
    for (const [body, line, column] of [
      ["  A->>B: m\n  activate B %% zz\n  A->>B: n", 3, 14],
      ["  A->>B: m\n  activate B\n  A->>B: n\n  deactivate B %% zz", 5, 16],
    ] as const) {
      const { document, diagnostics } = parseSiren(`sequenceDiagram\n${body}`);

      expect([body, document]).toEqual([body, null]);
      expect([body, diagnostics]).toEqual([body, [{ severity: "error", message: NOT_A_COMMENT, line, column }]]);
    }
  });

  it("refuses a `%%` after a `rect`'s color, at its `%%` — Mermaid fills the block with it as written", () => {
    // Measured: `rect rgb(0,0,0) %% zz` records the color "rgb(0,0,0) %% zz"
    // and draws `<rect fill="rgb(0,0,0) %% zz">` — not a color, so the block
    // is not filled as written: a wrong picture with no diagnostic, which
    // Siren refuses (ADR-0001).
    const { document, diagnostics } = parseSiren("sequenceDiagram\n  rect rgb(0,0,0) %% zz\n    A->>B: m\n  end");

    expect(document).toBeNull();
    expect(diagnostics).toEqual([{ severity: "error", message: NOT_A_COMMENT, line: 2, column: 19 }]);
  });

  it("reads a `%%` after `end`, `autonumber` or `autonumber off` as a comment, as the sequence lexer does after a keyword", () => {
    // Measured: `end %% zz`, `end%%zz`, `autonumber %% zz` and
    // `autonumber off %% zz` are accepted, and nothing stores "zz".
    for (const [commented, plain] of [
      ["  loop L\n    A->>B: m\n  end %% the loop", "  loop L\n    A->>B: m\n  end"],
      ["  loop L\n    A->>B: m\n  end%%the loop", "  loop L\n    A->>B: m\n  end"],
      ["  autonumber %% from here\n  A->>B: m", "  autonumber\n  A->>B: m"],
      ["  autonumber\n  A->>B: m\n  autonumber off %% no more\n  B->>A: n", "  autonumber\n  A->>B: m\n  autonumber off\n  B->>A: n"],
    ]) {
      const read = parseSiren(`sequenceDiagram\n${commented}`);

      expect([commented, read.diagnostics]).toEqual([commented, []]);
      expect([commented, read]).toEqual([commented, parseSiren(`sequenceDiagram\n${plain}`)]);
    }
  });

  it("reads a `%%` after a `;` as a comment, as the sequence lexer does once a `;` ends the text", () => {
    // Measured: `A->>B: hi; %% zz` and `note over A: n; %% zz` are accepted
    // and nothing stores "zz" — the text rule stops at `;`. What Siren makes
    // of the `;` itself is unchanged here.
    for (const [commented, plain] of [
      ["  A->>B: hi; %% zz", "  A->>B: hi;"],
      ["  A->>B: hi;%% zz", "  A->>B: hi;"],
      ["  A->>B: m\n  note over A: n; %% zz", "  A->>B: m\n  note over A: n;"],
    ]) {
      const read = parseSiren(`sequenceDiagram\n${commented}`);

      expect([commented, read.diagnostics]).toEqual([commented, []]);
      expect([commented, read]).toEqual([commented, parseSiren(`sequenceDiagram\n${plain}`)]);
    }
  });

  it("keeps a `%%` after a `link`'s url as part of the url, as Mermaid records it", () => {
    // Measured: `link A: D @ https://x.org %% zz` records the link
    // {"D": "https://x.org %% zz"}.
    const document = sequenceOk("  participant A\n  link A: D @ https://x.org %% zz");

    expect(document.interactions.map((link) => [link.targetId, link.tooltip, link.action])).toEqual([
      ["A", "D", "https://x.org %% zz"],
    ]);
  });

  it("reads a `%%` after a `links` object as part of its JSON, so the statement adds no link, as in Mermaid", () => {
    // Measured: `links A: {"D": "https://x.org"} %% zz` records no link —
    // the text after the colon, `%%` and all, is not JSON.
    const { document, diagnostics } = parseSiren(
      'sequenceDiagram\n  participant A\n  links A: {"D": "https://x.org"} %% zz',
    );

    expect((document as SequenceDocument).interactions).toEqual([]);
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message: "links A: the text after the colon is not JSON; no link is added",
        line: 3,
        column: 3,
      },
    ]);
  });

  it("still cuts a `%%` in a timeline block to the line's end — that block is Siren's syntax, not Mermaid's", () => {
    // ADR-0017: the document without its timeline blocks is the Mermaid one,
    // so a sequence diagram's reading of `%%` stops at its first timeline header.
    const commented = parseSiren("sequenceDiagram\n  A->>B: m\ntimeline: %% the reveal\n  enter B fade %% last\n");
    const plain = parseSiren("sequenceDiagram\n  A->>B: m\ntimeline:\n  enter B fade\n");

    expect(commented.diagnostics).toEqual([]);
    expect(commented).toEqual(plain);
  });

  it("refuses a `%%` written right after a one-character name where the lexer reads a name, at its `%%`", () => {
    // The sequence lexer's `[^\}]%%[^\n]*` rule fires where a name starts:
    // a name of one character followed at once by `%%` is a comment from that
    // character on. Measured: `A->>B%% zz: m`, `A->>B%%zz: m`, `A->>+B%%x: m`,
    // `note over A%%x: n`, `note over A,B%%x: n` are parse errors and
    // `destroy B%%x` is refused ("The destroyed participant undefined …");
    // `A%%x->>B: m` is accepted and draws nothing for the line — a wrong
    // picture with no diagnostic, which Siren refuses (ADR-0001).
    for (const [body, line, column] of [
      ["  A->>B%% zz: m", 2, 8],
      ["  A->>B%%zz: m", 2, 8],
      ["  A->>+B%%x: m", 2, 9],
      ["  A%%x->>B: m", 2, 4],
      ["  A->>B: m\n  note over A%%x: n", 3, 14],
      ["  A->>B: m\n  note over A,B%%x: n", 3, 16],
      ["  A->>B: m\n  destroy B%%x\n  A->>B: n", 3, 12],
    ] as const) {
      const { document, diagnostics } = parseSiren(`sequenceDiagram\n${body}`);

      expect([body, document]).toEqual([body, null]);
      expect([body, diagnostics]).toEqual([body, [{ severity: "error", message: NOT_A_COMMENT, line, column }]]);
    }
  });

  it("reads a `%%` written right after a longer name, or after a space, as part of the name", () => {
    // Measured: `A->>BC%% zz: m` sends to "BC%% zz", `AB%%x->>B: m` sends
    // from "AB%%x", `note over AB%%x: n` stands over "AB%%x", and
    // `destroy BC%%x` then `A->>BC%%x: n` destroys "BC%%x".
    const named = (body: string) =>
      sequenceOk(body).statements.map((s) =>
        s.kind === "message" || s.kind === "note" ? [s.from, s.to] : s.kind === "destroy" ? [s.id] : [],
      );

    expect(named("  A->>BC%% zz: m")).toEqual([["A", "BC%% zz"]]);
    expect(named("  AB%%x->>B: m")).toEqual([["AB%%x", "B"]]);
    expect(named("  note over AB%%x: n")).toEqual([["AB%%x", "AB%%x"]]);
    expect(named("  A->>B: m\n  destroy BC%%x\n  A->>BC%%x: n")).toEqual([["A", "B"], ["BC%%x"], ["A", "BC%%x"]]);
  });
});

describe("a `%%` in the middle of a class or state line", () => {
  it("still cuts a `%%` in a timeline block to the line's end — that block is Siren's syntax, not Mermaid's", () => {
    // ADR-0017: the document without its timeline blocks is the Mermaid one,
    // so a class or state diagram's reading of `%%` stops at its first
    // timeline header, as a sequence diagram's does.
    for (const [header, body, id] of [
      ["classDiagram", "  Animal <|-- Duck", "Duck"],
      ["stateDiagram-v2", "  Idle --> Busy", "Busy"],
    ] as const) {
      const commented = parseSiren(`${header}\n${body}\ntimeline: %% the reveal\n  enter ${id} fade %% last\n`);
      const plain = parseSiren(`${header}\n${body}\ntimeline:\n  enter ${id} fade\n`);

      expect([header, commented.diagnostics]).toEqual([header, []]);
      expect([header, commented]).toEqual([header, plain]);
    }
  });
});

/**
 * The dispatcher hands an ER diagram its lines as Mermaid's grammar is
 * handed them — only whole-line comments removed — so the ER parser decides
 * what a mid-line `%%` means (see parseErDiagram.test.ts, "a `%%` in the
 * middle of a line"). Measured on Mermaid 12.2.0: the ER lexer has no `%`
 * rule, so a `%%` is text only inside a relationship's quoted label, an
 * attribute's quoted comment, a backticked name, a generic type, the
 * accessibility lines, and a line `direction` swallows whole.
 */
describe("a `%%` in the middle of an ER line", () => {
  const erOk = (body: string) => {
    const { document, diagnostics } = parseSiren(`erDiagram\n${body}`);
    expect(diagnostics).toEqual([]);
    return erDocument(document);
  };

  it("keeps a `%%` in every piece of text an ER statement holds, as Mermaid records it", () => {
    expect(erOk('  A ||--o{ B : "r %% zz"\n  C').relationships.map((r) => r.label.text)).toEqual(["r %% zz"]);
    const attributes = erOk('  A {\n    int x "c %% zz"\n    string `a %% b`\n    list~a %% b~ y\n  }').entities[0]!
      .attributes;
    expect(attributes.map((a) => [a.type, a.name, a.comment.text])).toEqual([
      ["int", "x", "c %% zz"],
      ["string", "a %% b", ""],
      ["list~a %% b~", "y", ""],
    ]);
    const described = erOk("  accTitle: t %% zz\n  accDescr: d %% zz\n  A");
    expect([described.accTitle, described.accDescr]).toEqual(["t %% zz", "d %% zz"]);
    expect(erOk("  accDescr {\n    d %% zz\n  }\n  A").accDescr).toBe("d %% zz");
  });

  it("reads a line `direction` swallows whole as that direction, `%%` and all, as Mermaid's lexer does", () => {
    // Measured: the direction rules are `.*direction\s+LR[^\n]*`, so
    // `direction LR %% zz` and `A %% direction LR` each set `LR` and
    // declare nothing.
    for (const body of ["  direction LR %% zz\n  A", "  A %% direction LR\n  A"]) {
      const document = erOk(body);
      expect([body, document.direction, document.entities.map((e) => e.name)]).toEqual([body, "LR", ["A"]]);
    }
  });

  it("refuses a `%%` after a complete statement, at its `%%`", () => {
    const midLine =
      'A "%%" in the middle of a line is not a comment: only a line that starts with "%%" is one. ' +
      "If it is a comment, move it to a line of its own.";
    const { document, diagnostics } = parseSiren("erDiagram\n  A ||--o{ B : r %% zz\n  C");

    expect(document).toBeNull();
    expect(diagnostics).toEqual([{ severity: "error", message: midLine, line: 2, column: 18 }]);
  });

  it("still cuts a `%%` in a timeline block to the line's end — that block is Siren's syntax, not Mermaid's", () => {
    const commented = parseSiren("erDiagram\n  A ||--o{ B : r\ntimeline: %% the reveal\n  enter B fade %% last\n");
    const plain = parseSiren("erDiagram\n  A ||--o{ B : r\ntimeline:\n  enter B fade\n");

    expect(commented.diagnostics).toEqual([]);
    expect(commented).toEqual(plain);
  });
});
