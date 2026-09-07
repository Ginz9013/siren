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

  it("keeps the three parenthesised spellings this ticket does not draw refused, rather than swallowing them as a round node", () => {
    // The swallow this whole list of spellings exists to prevent, one
    // bracket family over. `A((Circle))` differs from `A(Round)` only by an
    // inner pair of parentheses, so a round pattern that let a parenthesis
    // into its label would read a circle as a round node labelled
    // `(Circle)` — a valid Mermaid document drawn as the wrong picture with
    // no diagnostic, which is the one failure the compatibility corpus
    // exists to keep at zero.
    //
    // Measured (`pnpm --filter @siren/core probe`): `A((Circle))` is
    // `type="circle"`, `A(((Double)))` is `type="doublecircle"` and
    // `A[(DB)]` is `type="cylinder"` — three shapes of later tickets, and
    // all three still refused here.
    const circle = parseSiren(`flowchart TB\n  A((Circle))\n`);
    expect(circle.document).toBeNull();
    expect(circle.diagnostics.map((d) => d.message)).toEqual([
      'Unrecognized flowchart line: "A((Circle))"',
    ]);

    const double = parseSiren(`flowchart TB\n  A(((Double)))\n`);
    expect(double.document).toBeNull();
    expect(double.diagnostics.map((d) => d.message)).toEqual([
      'Unrecognized flowchart line: "A(((Double)))"',
    ]);

    // The cylinder keeps its *named* refusal, which the subroutine has just
    // stopped needing: it is still the one row of
    // `UNIMPLEMENTED_BRACKET_FORMS` that names a shape.
    const cylinder = parseSiren(`flowchart TB\n  A[(DB)]\n`);
    expect(cylinder.document).toBeNull();
    expect(cylinder.diagnostics.map((d) => d.message)).toEqual([
      'Siren does not draw a cylinder (`A[(text)]`) yet: "A[(DB)]"',
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

  it("refuses a form written at an edge endpoint too — where it is written must not decide what it means", () => {
    // Two different rows of the table, so the rule is visibly about the
    // *place* rather than about one form. The slanted shapes used to be the
    // second example here and are drawn now; the Markdown label took their
    // place because it is still refused.
    const source = `flowchart TB
  A[(DB)] --> B[Read]
  C[Write] --> D["` + "`" + `**bold**` + "`" + `"]
`;

    const { document, diagnostics } = parseSiren(source);

    expect(document).toBeNull();
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Siren does not draw a cylinder (`A[(text)]`) yet: "A[(DB)] --> B[Read]"',
      "Siren does not draw a Markdown string label (a quoted label fenced " +
        'in backticks) yet: "C[Write] --> D["`**bold**`"]"',
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
    // The property board 3's pin was protecting, kept now that the line is
    // accepted: reading some of a line's nodes and dropping the rest would
    // draw a diagram nobody wrote. The redeclaration warning is what makes
    // "nothing was taken" observable — `A` already has a label, so if the
    // first endpoint had been declared before the refusal there would be a
    // warning sitting next to the error.
    const shape = parseSiren(`flowchart TD
  A[Start]
  A[Other] --> B[(DB)] --> C
`);

    expect(shape.document).toBeNull();
    expect(shape.diagnostics).toEqual([
      {
        severity: "error",
        message:
          'Siren does not draw a cylinder (`A[(text)]`) yet: "A[Other] --> B[(DB)] --> C"',
        line: 3,
        column: 3,
      },
    ]);

    // Same rule for an endpoint that is not readable at all — here a thick
    // arrow, which is a later board's, in the middle of the line.
    const unreadable = parseSiren(`flowchart TD
  A[Start]
  A[Other] --> B ==> C
`);

    expect(unreadable.document).toBeNull();
    expect(unreadable.diagnostics).toEqual([
      {
        severity: "error",
        message: 'Unrecognized flowchart line: "A[Other] --> B ==> C"',
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
