import { describe, expect, it } from "vitest";
import type { StateDocument } from "../contracts";
import { parseStateDiagram } from "./parseStateDiagram";

/** The parsed document, or a thrown explanation naming what went wrong instead. */
function documentOf(source: string): StateDocument {
  const { document, diagnostics } = parseStateDiagram(source);
  if (document === null) {
    throw new Error(
      `expected a state document, got diagnostics: ${diagnostics
        .map((d) => d.message)
        .join("; ")}`,
    );
  }
  if (document.kind !== "state") {
    throw new Error(`expected a state document, got a ${document.kind} one`);
  }
  return document;
}

describe("parseStateDiagram", () => {
  it("accepts both of Mermaid's header spellings and collapses them onto one kind", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs): both spellings
    // report diagram type `stateDiagram`, exactly as `classDiagram` and
    // `classDiagram-v2` do — so nothing downstream may learn which was
    // written.
    for (const header of ["stateDiagram", "stateDiagram-v2"]) {
      const { document, diagnostics } = parseStateDiagram(`${header}\n`);

      expect(diagnostics, `for the header "${header}"`).toEqual([]);
      expect(document, `for the header "${header}"`).not.toBeNull();
      expect(document!.kind, `for the header "${header}"`).toBe("state");
    }
  });

  it("declares both of a transition's states by naming them, and gives an unlabelled transition no label", () => {
    // Measured (mermaid 11.17.2): `Idle --> Running` produces two states and
    // one relation whose `relationTitle` is the empty string. Siren spells
    // "no label" as `null`, the convention `Edge.label` and
    // `ClassRelationship.label` already follow — `""` is a label that draws
    // nothing, and that is a different document.
    const document = documentOf("stateDiagram-v2\n  Idle --> Running\n");

    expect(document.states.map((state) => state.id)).toEqual(["Idle", "Running"]);
    expect(document.transitions).toEqual([
      { from: "Idle", to: "Running", label: null, parentId: null, sourceLine: 2, sourceColumn: 3 },
    ]);
  });

  it("reads the `: label` a transition carries, and keeps it as written", () => {
    // Measured: `Idle --> Running : start` is one relation whose
    // `relationTitle` is "start". The label rides on the transition — there
    // is no separate label statement in this grammar.
    const document = documentOf("stateDiagram-v2\n  Idle --> Running : start the job\n");

    expect(document.transitions).toEqual([
      {
        from: "Idle",
        to: "Running",
        label: "start the job",
        parentId: null,
        sourceLine: 2,
        sourceColumn: 3,
      },
    ]);
  });

  it("reads a transition whose `:` is followed by nothing as carrying no label", () => {
    // `""` would be a label that draws nothing, which is a different
    // document from one that carries none — the same rule
    // `parseClassDiagram` applies to a relationship's empty label.
    const document = documentOf("stateDiagram-v2\n  Idle --> Running :   \n");

    expect(document.transitions[0].label).toBeNull();
  });

  it("declares a state named by several transitions exactly once, in first-mention order", () => {
    const document = documentOf(
      "stateDiagram-v2\n  Idle --> Running\n  Running --> Done\n  Idle --> Done\n",
    );

    expect(document.states.map((state) => state.id)).toEqual(["Idle", "Running", "Done"]);
    expect(document.transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      "Idle->Running",
      "Running->Done",
      "Idle->Done",
    ]);
  });

  it("reads a self-transition as one state with one transition onto itself", () => {
    // Measured: `Running --> Running : retry` is one state and one relation
    // — the "stays in this state" loop, and legitimate syntax rather than an
    // error. A guard rather than a red-green slice: it falls out of the
    // transition rule above, and this is what keeps a future "a transition
    // must join two different states" check from being added by mistake.
    const document = documentOf("stateDiagram-v2\n  Running --> Running : retry\n");

    expect(document.states.map((state) => state.id)).toEqual(["Running"]);
    expect(document.transitions).toEqual([
      {
        from: "Running",
        to: "Running",
        label: "retry",
        parentId: null,
        sourceLine: 2,
        sourceColumn: 3,
      },
    ]);
  });

  it("declares a state written on a line of its own, in either of Mermaid's two spellings", () => {
    // Measured: `Lonely` on its own line and `state Named` both put a state
    // into Mermaid's own state table, and neither needs a transition to
    // exist. A state nothing points at still draws.
    const document = documentOf("stateDiagram-v2\n  Lonely\n  state Named\n");

    expect(document.states.map((state) => state.id)).toEqual(["Lonely", "Named"]);
    expect(document.transitions).toEqual([]);
  });

  it("keeps a state's first-mention position when a later transition names it again", () => {
    const document = documentOf("stateDiagram-v2\n  Idle\n  Idle --> Running\n");

    expect(document.states).toEqual([
      { id: "Idle", kind: "state", descriptions: [], parentId: null, direction: null, line: 2, column: 3 },
      {
        id: "Running",
        kind: "state",
        descriptions: [],
        parentId: null,
        direction: null,
        line: 3,
        column: 3,
      },
    ]);
  });

  it("reads `[*]` as the start pseudo-state on the from side and the end one on the to side", () => {
    // Measured (mermaid 11.17.2): `[*] --> A` and `A --> [*]` report the
    // relations `root_start → A` and `A → root_end` — two *different*
    // pseudo-states, told apart by which side of the arrow `[*]` was
    // written on, and not one node used twice.
    //
    // The parser names neither of them: an id the author never wrote is a
    // generated id, and generated ids are `buildStateModel`'s to mint
    // (ADR-0010), exactly as a subgraph's is `buildFlowchartModel`'s. So
    // `id` is null here and the endpoint that named it is too.
    const document = documentOf("stateDiagram-v2\n  [*] --> Idle\n  Idle --> [*]\n");

    expect(document.states).toEqual([
      { id: null, kind: "start", descriptions: [], parentId: null, direction: null, line: 2, column: 3 },
      { id: "Idle", kind: "state", descriptions: [], parentId: null, direction: null, line: 2, column: 3 },
      { id: null, kind: "end", descriptions: [], parentId: null, direction: null, line: 3, column: 3 },
    ]);
    expect(document.transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      "null->Idle",
      "Idle->null",
    ]);
  });

  it("gives the level one start and one end however many times `[*]` is written", () => {
    // The fact most likely to be got wrong, and the one that is measured:
    // two `[*] -->` lines both came back from the same `root_start`, and
    // two `--> [*]` lines both reached the same `root_end`. One per level,
    // not one per occurrence.
    const document = documentOf(
      "stateDiagram-v2\n  [*] --> Idle\n  [*] --> Busy\n  Idle --> [*]\n  Busy --> [*]\n",
    );

    expect(document.states.map((state) => `${state.kind}:${state.id}`)).toEqual([
      "start:null",
      "state:Idle",
      "state:Busy",
      "end:null",
    ]);
  });

  it("reads `[*] --> [*]` as the start pseudo-state pointing at the end one", () => {
    // Measured: legal, and one relation — `root_start → root_end`.
    const document = documentOf("stateDiagram-v2\n  [*] --> [*]\n");

    expect(document.states.map((state) => state.kind)).toEqual(["start", "end"]);
    expect(document.transitions).toEqual([
      { from: null, to: null, label: null, parentId: null, sourceLine: 2, sourceColumn: 3 },
    ]);
  });

  it("reads `s : text` as a description on that state, and declares the state by describing it", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs):
    // `Lonely :    waits here` puts `Lonely` into the state table with
    // `descriptions=["waits here"]` — the id is untouched, the text is
    // trimmed, and no relation is produced by a colon with no arrow in
    // front of it.
    const document = documentOf("stateDiagram-v2\n  Lonely :    waits here\n");

    expect(document.states).toEqual([
      {
        id: "Lonely",
        kind: "state",
        descriptions: ["waits here"],
        parentId: null,
        direction: null,
        line: 2,
        column: 3,
      },
    ]);
    expect(document.transitions).toEqual([]);
  });

  it("accumulates a state's descriptions in written order, whichever spelling wrote each one", () => {
    // Measured (mermaid 11.17.2): `Both : one` followed by
    // `state "two" as Both` reports `descriptions=["one","two"]` on the one
    // state — a second description is a second line of text rather than a
    // correction of the first, and the two spellings share the one list.
    //
    // A guard rather than a red-green slice: accumulation falls out of the
    // array the two branches above push into, and this is what keeps a
    // later "one description per state" narrowing from being made by
    // mistake. The state also keeps the position of the line that first
    // named it.
    const document = documentOf(
      'stateDiagram-v2\n  Both : one\n  state "two" as Both\n  Both : three\n',
    );

    expect(document.states).toEqual([
      {
        id: "Both",
        kind: "state",
        descriptions: ["one", "two", "three"],
        parentId: null,
        direction: null,
        line: 2,
        column: 3,
      },
    ]);
  });

  it('reads `state "text" as s` as the very same document `s : text` parses to', () => {
    // The two spellings are one construct, and this is the assertion that
    // says so: **identical documents**, not merely the same text somewhere.
    // A field recording which spelling was written, or an id taken from the
    // quoted half, fails here rather than passing unnoticed — the shape the
    // flowchart's two edge-label spellings are held to.
    //
    // Measured (mermaid 11.17.2): both report
    // `descriptions=["waiting for work"]` on a state whose id is still `s`.
    // `state "text" as s` is emphatically **not** a rename, which is the
    // reading the keyword `as` invites — the transition below still names
    // the state `s` in both documents.
    const colon = parseStateDiagram("stateDiagram-v2\n  s : waiting for work\n  s --> Done\n");
    const quoted = parseStateDiagram(
      'stateDiagram-v2\n  state "waiting for work" as s\n  s --> Done\n',
    );

    expect(quoted.diagnostics).toEqual([]);
    expect(quoted.document).not.toBeNull();
    expect(quoted.document).toEqual(colon.document);
  });

  it("reads a composite state's block, and holds the states written inside it", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs): `state Outer {
    // Inner1 --> Inner2 }` reports `Outer in="root"` and both inner states
    // `in="root/Outer"` — the block is a level of its own, and the composite
    // is a state at the level that holds it.
    const document = documentOf(
      "stateDiagram-v2\n  state Outer {\n    Inner1 --> Inner2\n  }\n",
    );

    expect(document.states.map((state) => [state.id, state.kind, state.parentId])).toEqual([
      ["Outer", "composite", null],
      ["Inner1", "state", "Outer"],
      ["Inner2", "state", "Outer"],
    ]);
  });

  it("gives a composite's block its own start and end, apart from the document's", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs): `state Outer {
    // [*] --> Inner }` reports `Outer_start in="root/Outer"` — the
    // composite's own start, not `root_start`. So "one start and one end per
    // level" is exactly that: per level, and a block is a level.
    const document = documentOf(
      "stateDiagram-v2\n" +
        "  [*] --> Outer\n" +
        "  state Outer {\n    [*] --> Inner\n    Inner --> [*]\n  }\n" +
        "  Outer --> [*]\n",
    );

    expect(
      document.states.map((state) => [state.kind, state.id, state.parentId]),
    ).toEqual([
      ["start", null, null],
      ["composite", "Outer", null],
      ["start", null, "Outer"],
      ["state", "Inner", "Outer"],
      ["end", null, "Outer"],
      ["end", null, null],
    ]);
    // And each transition says which level it was written at, which is the
    // only thing that can tell those two starts apart at the far end.
    expect(
      document.transitions.map((t) => [t.from, t.to, t.parentId]),
    ).toEqual([
      [null, "Outer", null],
      [null, "Inner", "Outer"],
      ["Inner", null, "Outer"],
      ["Outer", null, null],
    ]);
  });

  it("reads a composite's own `direction` onto that block alone", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs): `direction LR`
    // inside `state Outer { }` is that block's own rank direction, and the
    // document's stays `TB`. A per-level statement, not a cascading one —
    // the reading `SirenSubgraph.direction` already records for a subgraph.
    const document = documentOf(
      "stateDiagram-v2\n  state Outer {\n    direction LR\n    A --> B\n  }\n",
    );

    expect(
      document.states.map((state) => [state.id, state.direction]),
    ).toEqual([
      ["Outer", "LR"],
      ["A", null],
      ["B", null],
    ]);
  });

  it("leaves a state where the first block that named it put it", () => {
    // The rule CONTEXT.md's **Subgraph** entry already records for a
    // flowchart — "a node is claimed by the first block that names it" —
    // applied here rather than invented a second time. A state written at
    // the document's level joins the first composite to name it, and a
    // second composite naming it again leaves it where it is.
    //
    // (Mermaid's own parse tree keeps a same-named state at each level it
    // was written at and its renderer then draws one node for them, so
    // Mermaid has no answer to borrow here; Siren's ids are global, and
    // this is the rule Siren already applies to the same question.)
    const document = documentOf(
      "stateDiagram-v2\n" +
        "  Shared --> Other\n" +
        "  state First {\n    Shared --> A\n  }\n" +
        "  state Second {\n    Shared --> B\n  }\n",
    );

    expect(
      document.states.map((state) => [state.id, state.parentId]),
    ).toEqual([
      ["Shared", "First"],
      ["Other", null],
      ["First", null],
      ["A", "First"],
      ["Second", null],
      ["B", "Second"],
    ]);
  });

  it("refuses a composite block the author never closed, in the words they opened it with", () => {
    // The answer `parseFlowchart` gives an unterminated `subgraph` and
    // `parseClassDiagram` an unterminated `namespace` — one diagnostic per
    // open block, innermost first, so nesting is described rather than
    // summarized.
    const { document, diagnostics } = parseStateDiagram(
      "stateDiagram-v2\n  state Outer {\n    state Inner {\n      A --> B\n",
    );

    expect(document).toBeNull();
    expect(diagnostics.map((d) => [d.severity, d.message, d.line])).toEqual([
      ["error", 'Unterminated "state Inner {" block: missing matching "}"', 3],
      ["error", 'Unterminated "state Outer {" block: missing matching "}"', 2],
    ]);
  });

  it("names both spellings when the header is something else", () => {
    const { document, diagnostics } = parseStateDiagram("stateChart\n");

    expect(document).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain('"stateDiagram"');
    expect(diagnostics[0].message).toContain('"stateDiagram-v2"');
    expect(diagnostics[0].message).toContain('found "stateChart"');
  });
});
