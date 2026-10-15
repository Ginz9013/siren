import { describe, expect, it, vi } from "vitest";
import type { DiagramParseResult, StateDocument } from "../contracts";
import { plainLabel, plainRun } from "../label/label";
import { parseSiren } from "./parseSiren";
import { parseStateDiagram } from "./parseStateDiagram";

/**
 * The test-only input for the one thing no real tag can exercise yet: how a
 * problem `readLabel` reports becomes a diagnostic — the device
 * `parseFlowchart.test.ts` uses, for the same reason. `readLabel` is the real
 * one, delegated to unchanged, except that a `⚠` in a label's source is
 * reported as an error at that character and a `⚑` as a warning, so where
 * the diagnostic lands can be checked against where the author wrote the
 * character. No real label here contains either, so every other test in
 * this file reads labels exactly as production does.
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

/** The parsed document, or a thrown explanation naming what went wrong instead. */
function documentOf(source: string, parse: (source: string) => DiagramParseResult = parseStateDiagram): StateDocument {
  const { document, diagnostics } = parse(source);
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
      { from: "Idle", to: "Running", label: null, parentId: null, regionIndex: null, sourceLine: 2, sourceColumn: 3 },
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
        label: plainLabel("start the job"),
        parentId: null,
        regionIndex: null,
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
        label: plainLabel("retry"),
        parentId: null,
        regionIndex: null,
        sourceLine: 2,
        sourceColumn: 3,
      },
    ]);
  });

  it("declares a state written as a bare identifier on a line of its own", () => {
    // Measured (mermaid 11.17.2): `Lonely` alone puts a state into Mermaid's
    // own state table with no transition needed, so a state nothing points
    // at still draws. The *keyword* spelling does not — see the test below.
    const document = documentOf("stateDiagram-v2\n  Lonely\n");

    expect(document.states.map((state) => state.id)).toEqual(["Lonely"]);
    expect(document.transitions).toEqual([]);
  });

  it("reads bare ids written one after another on a line as one statement each, the last one joining what follows", () => {
    // Measured (mermaid 12.2.0): a bare id ends its statement at the space
    // after it, and the rest of the line is the next statement. `Foo Bar`
    // declares both, `A B C` all three, `direction sideways` and `hide X`
    // (neither word is reserved) both words, `Foo Bar --> C` Foo and the
    // transition Bar → C, and `Foo Bar : hi` Foo and Bar described "hi".
    // 01M369AQW: Siren refused every one of these documents outright.
    const cases: [string, string[], [string, string][]][] = [
      ["Foo Bar", ["Idle", "Busy", "Foo", "Bar"], []],
      ["A B C", ["Idle", "Busy", "A", "B", "C"], []],
      ["direction sideways", ["Idle", "Busy", "direction", "sideways"], []],
      ["hide X", ["Idle", "Busy", "hide", "X"], []],
      ["Foo\tBar", ["Idle", "Busy", "Foo", "Bar"], []],
      ["Foo Bar --> C", ["Idle", "Busy", "Foo", "Bar", "C"], [["Bar", "C"]]],
    ];
    for (const [line, states, extraTransitions] of cases) {
      const document = documentOf(`stateDiagram-v2\n  Idle --> Busy\n  ${line}\n`);

      expect(document.states.map((state) => state.id), `for "${line}"`).toEqual(states);
      expect(
        document.transitions.map((t) => [t.from, t.to]),
        `for "${line}"`,
      ).toEqual([["Idle", "Busy"], ...extraTransitions]);
    }

    const described = documentOf("stateDiagram-v2\n  Foo Bar : hi\n");
    expect(described.states.map((s) => [s.id, s.descriptions.map((d) => d.text)])).toEqual([
      ["Foo", []],
      ["Bar", ["hi"]],
    ]);
  });

  it("reads `[*]` on a line of its own as the level's start pseudo-state", () => {
    // 01M4WSRMX, measured on mermaid 12.2.0 with `--markup`: a lone `[*]`
    // draws the start disc of the level it is written at (`root_start`, or
    // the composite's own start), and a later `[*] --> A` leaves from that
    // same disc rather than a second one. `Foo [*]` is Foo and the start.
    expect(documentOf("stateDiagram-v2\n  A --> B\n  [*]\n").states.map((s) => [s.kind, s.id])).toEqual([
      ["state", "A"],
      ["state", "B"],
      ["start", null],
    ]);
    const shared = documentOf("stateDiagram-v2\n  [*]\n  [*] --> A\n");
    expect(shared.states.filter((s) => s.kind === "start")).toHaveLength(1);
    const nested = documentOf("stateDiagram-v2\n  state C {\n    X\n    [*]\n  }\n");
    expect(nested.states.filter((s) => s.kind === "start").map((s) => s.parentId)).toEqual(["C"]);
    expect(documentOf("stateDiagram-v2\n  Foo [*]\n").states.map((s) => [s.kind, s.id])).toEqual([
      ["state", "Foo"],
      ["start", null],
    ]);
  });

  it("still refuses a line whose rest is not a statement, reporting it where the rest starts", () => {
    const { document, diagnostics } = parseStateDiagram("stateDiagram-v2\n  Idle -> Busy\n");

    expect(document).toBeNull();
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: "error", line: 2, column: 8, message: expect.stringContaining("-> Busy") }),
    ]);
  });

  it("declares nothing for `state X` on a line of its own, and says nothing about it either", () => {
    // Measured (mermaid 11.17.2): `state Skipped` alone reports *no* state —
    // it is `state Skipped {` with the brace missing, which Mermaid tolerates
    // and ignores — and it is **not** a parse error, so there is nothing to
    // report. Refusing it would leave a document Mermaid draws with no
    // picture here, which is the trade CONTEXT.md's compatibility condition
    // exists to forbid.
    const { document, diagnostics } = parseStateDiagram("stateDiagram-v2\n  state Skipped\n");

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    expect((document as StateDocument).states).toEqual([]);
    expect((document as StateDocument).transitions).toEqual([]);

    // Ignored at a composite's level too, and without costing the composite
    // its other members — measured: `state Outer { state Skipped / Inner }`
    // reports `Outer` and `Inner in="root/Outer"`, and no `Skipped`.
    const nested = documentOf(
      "stateDiagram-v2\n  state Outer {\n    state Skipped\n    Inner\n  }\n",
    );
    expect(nested.states.map((state) => `${state.id}:${state.parentId}`)).toEqual([
      "Outer:null",
      "Inner:Outer",
    ]);
  });

  it("leaves a state some other line declares alone when a `state X` line also names it", () => {
    // Characterization, pinned before `state X` stopped declaring anything:
    // measured (mermaid 11.17.2), `state Skipped` + `A --> Skipped` puts
    // `Skipped` into the state table — declared by the *transition*, not by
    // the `state` line — so narrowing that line must not cost this document
    // its state. The same holds for the description spelling: `Skipped :
    // waiting` declares it too (measured, descriptions=["waiting"]).
    //
    // Membership rather than draw order on purpose: which line first
    // mentions `Skipped` is exactly what this narrowing moves, and a
    // characterization test that pinned it would be pinning the defect.
    const byTransition = documentOf("stateDiagram-v2\n  state Skipped\n  A --> Skipped\n");
    expect([...byTransition.states.map((state) => state.id)].sort()).toEqual([
      "A",
      "Skipped",
    ]);
    expect(byTransition.transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      "A->Skipped",
    ]);

    const byDescription = documentOf("stateDiagram-v2\n  state Skipped\n  Skipped : waiting\n");
    expect(byDescription.states.map((state) => state.id)).toEqual(["Skipped"]);
    expect(byDescription.states[0].descriptions).toEqual([plainLabel("waiting")]);
  });

  it("keeps a state's first-mention position when a later transition names it again", () => {
    const document = documentOf("stateDiagram-v2\n  Idle\n  Idle --> Running\n");

    expect(document.states).toEqual([
      { id: "Idle", kind: "state", stereotype: null, descriptions: [], parentId: null, regionIndex: null, direction: null, note: null, line: 2, column: 3 },
      {
        id: "Running",
        kind: "state",
        stereotype: null,
        descriptions: [],
        parentId: null,
        regionIndex: null,
        direction: null,
        note: null,
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
      { id: null, kind: "start", stereotype: null, descriptions: [], parentId: null, regionIndex: null, direction: null, note: null, line: 2, column: 3 },
      { id: "Idle", kind: "state", stereotype: null, descriptions: [], parentId: null, regionIndex: null, direction: null, note: null, line: 2, column: 3 },
      { id: null, kind: "end", stereotype: null, descriptions: [], parentId: null, regionIndex: null, direction: null, note: null, line: 3, column: 3 },
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
      { from: null, to: null, label: null, parentId: null, regionIndex: null, sourceLine: 2, sourceColumn: 3 },
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
        stereotype: null,
        descriptions: [plainLabel("waits here")],
        parentId: null,
        regionIndex: null,
        direction: null,
        note: null,
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
        stereotype: null,
        descriptions: [plainLabel("one"), plainLabel("two"), plainLabel("three")],
        parentId: null,
        regionIndex: null,
        direction: null,
        note: null,
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

  it("splits a composite's block into concurrent regions at each `--`", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs): `state Active {
    // A --> B  --  C --> D }` reports two `divider`-typed states
    // `in="root/Active"` with `A`/`B` under the first and `C`/`D` under the
    // second — so `--` opens a level, and everything written before the
    // first one is already in a region rather than directly in the block.
    //
    // The parser names neither region: their ids are generated, and
    // generated ids are `buildStateModel`'s to mint (ADR-0010), exactly as
    // a pseudo-state's is. What it records is *which* region each statement
    // was written in.
    const document = documentOf(
      "stateDiagram-v2\n  state Active {\n    A --> B\n    --\n    C --> D\n  }\n",
    );

    expect(document.regions).toEqual([
      { parentId: "Active", index: 0, direction: null },
      { parentId: "Active", index: 1, direction: null },
    ]);
    expect(
      document.states.map((state) => [state.id, state.parentId, state.regionIndex]),
    ).toEqual([
      ["Active", null, null],
      ["A", "Active", 0],
      ["B", "Active", 0],
      ["C", "Active", 1],
      ["D", "Active", 1],
    ]);
    expect(
      document.transitions.map((t) => [t.from, t.to, t.parentId, t.regionIndex]),
    ).toEqual([
      ["A", "B", "Active", 0],
      ["C", "D", "Active", 1],
    ]);
  });

  it("counts a `--` per token, so `----` opens two regions and leaves an empty one between", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs): `--` is one
    // lexer token, so a line of `----` reports *two* dividers and three
    // regions with the middle one holding nothing — byte for byte the dump
    // two consecutive `--` lines produce. `------` reports three dividers
    // and four regions.
    //
    // An empty region is a region: it is in the list, and nothing collapses
    // it away.
    const inline = documentOf(
      "stateDiagram-v2\n  state Active {\n    A --> B\n    ----\n    C --> D\n  }\n",
    );
    const stacked = documentOf(
      "stateDiagram-v2\n  state Active {\n    A --> B\n    --\n    --\n    C --> D\n  }\n",
    );

    for (const [name, document] of [["----", inline], ["-- --", stacked]] as const) {
      expect(document.regions, `for ${name}`).toEqual([
        { parentId: "Active", index: 0, direction: null },
        { parentId: "Active", index: 1, direction: null },
        { parentId: "Active", index: 2, direction: null },
      ]);
      expect(
        document.states.map((state) => [state.id, state.regionIndex]),
        `for ${name}`,
      ).toEqual([
        ["Active", null],
        ["A", 0],
        ["B", 0],
        ["C", 2],
        ["D", 2],
      ]);
    }

    expect(
      documentOf(
        "stateDiagram-v2\n  state Active {\n    A --> B\n    ------\n    C --> D\n  }\n",
      ).regions.length,
    ).toBe(4);
  });

  it("reads only a whole line of `--` pairs as a divider, and nothing else", () => {
    // The pattern's reach, measured against mermaid 11.17.2 in both
    // directions.
    //
    // **Under-reach is not the risk here; over-reach is.** An *odd* run of
    // dashes is a lexical error in mermaid — both `-` and `---` come back
    // "Unrecognized text" — so reading `---` as a divider would draw a
    // picture for a document mermaid refuses. And `--` inside a label or a
    // description produces no divider at all: `A --> B : go -- now` reports
    // one plain relation.
    const inALabel = documentOf(
      "stateDiagram-v2\n  state Active {\n    A --> B : go -- now\n  }\n",
    );
    expect(inALabel.regions).toEqual([]);
    expect(inALabel.transitions.map((t) => t.label)).toEqual([plainLabel("go -- now")]);

    const inADescription = documentOf(
      "stateDiagram-v2\n  state Active {\n    A : waits -- then goes\n  }\n",
    );
    expect(inADescription.regions).toEqual([]);
    expect(inADescription.states.map((state) => state.descriptions)).toEqual([
      [],
      [plainLabel("waits -- then goes")],
    ]);

    for (const dashes of ["-", "---", "-----"]) {
      const { document, diagnostics } = parseStateDiagram(
        `stateDiagram-v2\n  state Active {\n    A --> B\n    ${dashes}\n  }\n`,
      );
      expect(document, `for "${dashes}"`).toBeNull();
      expect(
        diagnostics.map((d) => d.message),
        `for "${dashes}"`,
      ).toContain(`Unrecognized stateDiagram line: "${dashes}"`);
    }
  });

  it("reads a `direction` inside a divided block onto the region it was written in", () => {
    // The surprising half of this construct, and measured rather than
    // reasoned (mermaid 11.17.2, rendering and reading the node transforms):
    // `direction LR` above the `--` lays the **first** region's members out
    // left-to-right (A and B at one y, 180 apart in x) and leaves the second
    // region's stacked in a column; moving the same statement below the `--`
    // swaps exactly which region turns. So the statement is the region's,
    // not the block's — and a divided composite therefore has no direction
    // of its own.
    const above = documentOf(
      "stateDiagram-v2\n  state Active {\n    direction LR\n    A --> B\n    --\n    C --> D\n  }\n",
    );
    expect(above.regions).toEqual([
      { parentId: "Active", index: 0, direction: "LR" },
      { parentId: "Active", index: 1, direction: null },
    ]);

    const below = documentOf(
      "stateDiagram-v2\n  state Active {\n    A --> B\n    --\n    direction LR\n    C --> D\n  }\n",
    );
    expect(below.regions).toEqual([
      { parentId: "Active", index: 0, direction: null },
      { parentId: "Active", index: 1, direction: "LR" },
    ]);

    // Neither of them puts anything on the composite: measured, mermaid
    // keeps the statement in the region's own doc, and the block around
    // them lays its regions out along the document's direction.
    for (const document of [above, below]) {
      expect(document.states.map((state) => [state.id, state.direction])[0]).toEqual([
        "Active",
        null,
      ]);
      expect(document.direction).toBe("TB");
    }
  });

  it("refuses a `--` written outside every composite block, the way Mermaid does", () => {
    // Measured (mermaid 11.17.2): a `--` at the document's own level is a
    // **parse error** — "Expecting 'SPACE', 'NL', ... got 'INVALID'" — so
    // there is no picture here to be compatible with, and accepting the
    // line would be Siren drawing something Mermaid will not. Refused by
    // name rather than as an unrecognized line, since the author wrote a
    // construct this parser knows: they put it in the wrong place.
    const { document, diagnostics } = parseStateDiagram(
      "stateDiagram-v2\n  A --> B\n  --\n  C --> D\n",
    );

    expect(document).toBeNull();
    const refusal = diagnostics.find((d) => d.line === 3);
    expect(refusal?.severity).toBe("error");
    expect(refusal?.message).toBe(
      'A "--" concurrency divider belongs inside a composite state\'s block, in "--"',
    );
  });

  it("opens a composite with the quoted-description spelling, carrying that description onto the frame", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs):
    // `state "the outer block" as Outer { First --> Second }` reports one
    // composite `Outer in="root" descriptions=["the outer block"]` with
    // `First` and `Second` both `in="root/Outer"` — two constructs on one
    // line, and neither half lost. Measured again against the spelling that
    // writes them apart (`state "the outer block" as Outer` above a separate
    // `state Outer { ... }`): the two dumps are identical, state for state
    // and relation for relation, so this is the same document written
    // shorter rather than a construct of its own.
    const document = documentOf(
      'stateDiagram-v2\n  state "the outer block" as Outer {\n    First --> Second\n  }\n',
    );

    expect(
      document.states.map((state) => [
        state.id,
        state.kind,
        state.parentId,
        state.descriptions,
      ]),
    ).toEqual([
      ["Outer", "composite", null, [plainLabel("the outer block")]],
      ["First", "state", "Outer", []],
      ["Second", "state", "Outer", []],
    ]);
  });

  it("nests the quoted spelling inside itself, each frame keeping its own description", () => {
    // Measured (mermaid 11.17.2): `state "a" as A { state "b" as B { Deep -->
    // Deeper } }` renders — `B in="root/A"`, `Deep` and `Deeper`
    // `in="root/A/B"` — and with `--markup`, each frame's `g.cluster-label`
    // carries its own quoted text ("a" on the outer, "b" on the inner). So
    // the description travels with whichever block it was written on, and
    // the inner one does not overwrite or join the outer's.
    const document = documentOf(
      'stateDiagram-v2\n' +
        '  state "a" as A {\n' +
        '    state "b" as B {\n' +
        '      Deep --> Deeper\n' +
        '    }\n' +
        '  }\n',
    );

    expect(
      document.states.map((state) => [
        state.id,
        state.kind,
        state.parentId,
        state.descriptions,
      ]),
    ).toEqual([
      ["A", "composite", null, [plainLabel("a")]],
      ["B", "composite", "A", [plainLabel("b")]],
      ["Deep", "state", "B", []],
      ["Deeper", "state", "B", []],
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

  it("reads a `timeline:` block through the shared grammar, and lets the block run to the end of the document", () => {
    // ADR-0002 keeps the block separate from the structural definition, so
    // the grammar is `parseTimelineBlock`'s and this parser only decides
    // where the block starts — the same split `parseFlowchart` and
    // `parseClassDiagram` already make.
    const document = documentOf(
      "stateDiagram-v2\n" +
        "  [*] --> Idle\n" +
        "  state Outer {\n" +
        "    Idle --> Busy\n" +
        "  }\n" +
        "timeline:\n" +
        "  enter Idle fade\n" +
        "  enter Idle-Busy fade, highlight Outer outline\n",
    );

    expect(document.timeline).not.toBeNull();
    expect(
      document.timeline!.entries.map((e) => [e.kind, e.step, e.targetId, e.effect ?? null]),
    ).toEqual([
      ["enter", 1, "Idle", "fade"],
      ["enter", 2, "Idle-Busy", "fade"],
      ["highlight", 2, "Outer", "outline"],
    ]);
  });

  it("gives a document with no `timeline:` block a null timeline, not an empty one", () => {
    // The distinction `ClassDocument.timeline` already draws: `null` says the
    // author declared no animation at all, which is a different document from
    // one declaring an empty block.
    expect(documentOf("stateDiagram-v2\n  Idle --> Running\n").timeline).toBeNull();
  });

  it("costs the whole document when a line inside the `timeline:` block is malformed", () => {
    const { document, diagnostics } = parseStateDiagram(
      "stateDiagram-v2\n  Idle --> Running\ntimeline:\n  wobble Idle fade\n",
    );

    expect(document).toBeNull();
    expect(diagnostics.map((d) => [d.severity, d.line])).toEqual([["error", 4]]);
    expect(diagnostics[0].message).toContain('Unrecognized timeline verb "wobble"');
  });

  it("hangs `note … of [*]` on the start pseudo-state of the level it is written at", () => {
    // 01M36DWFN gap 1, measured on mermaid 12.2.0: the note lands on the
    // level's start pseudo-state whichever side of an arrow the author's
    // `[*]` sits on — `root_start` at the top, `C_start` inside `state C`.
    // Both spellings, and the multi-line form, attach the same way.
    const top = documentOf("stateDiagram-v2\n  [*] --> Idle\n  Idle --> [*]\n  note right of [*] : begins\n");
    expect(top.states.map((s) => [s.kind, s.id, s.note])).toEqual([
      ["start", null, { position: "right of", label: plainLabel("begins") }],
      ["state", "Idle", null],
      ["end", null, null],
    ]);

    const nested = documentOf(
      "stateDiagram-v2\n  state C {\n    [*] --> X\n    note left of [*]\n      inner\n    end note\n  }\n",
    );
    expect(nested.states.filter((s) => s.kind === "start").map((s) => [s.parentId, s.note])).toEqual([
      ["C", { position: "left of", label: plainLabel("inner") }],
    ]);
  });

  it("refuses `note … of [*]` at a level with no start pseudo-state, which Mermaid cannot draw either", () => {
    // Measured on 12.2.0: with only an end `[*]` at that level, Mermaid
    // invents a start with no shape and fails to render ("No such shape:
    // undefined"), at the top level and inside a composite alike.
    for (const source of [
      "stateDiagram-v2\n  Idle --> [*]\n  note right of [*] : done?\n",
      "stateDiagram-v2\n  state C {\n    X --> [*]\n    note right of [*] : inner\n  }\n",
    ]) {
      const { document, diagnostics } = parseStateDiagram(source);
      expect(document, source).toBeNull();
      expect(diagnostics.map((d) => [d.severity, d.message.includes("no start pseudo-state")]), source).toEqual([
        ["error", true],
      ]);
    }
  });

  it("reads a multi-line `note … end note` as one row per non-blank line, without the source's indent", () => {
    // 01M36DWFN gap 2, measured on mermaid 12.2.0: the note's text reaches
    // the state with its indentation (`"line one\n      line two"`), but the
    // drawn note is two rows, `line one` and `line two`, with no leading
    // space and no row for a blank line. `END NOTE` closes it too, and a
    // colon is ordinary text inside it.
    const document = documentOf(
      "stateDiagram-v2\n  Idle --> Busy\n  note right of Idle\n    line one\n\n      line two: ok\n  END NOTE\n",
    );
    expect(document.states[0].note?.position).toBe("right of");
    expect(document.states[0].note?.label.rows.map((row) => row.map((run) => run.text).join(""))).toEqual([
      "line one",
      "line two: ok",
    ]);

    const { document: unclosed, diagnostics } = parseStateDiagram(
      "stateDiagram-v2\n  Idle --> Busy\n  note right of Idle\n    never closed\n",
    );
    expect(unclosed).toBeNull();
    expect(diagnostics.map((d) => [d.severity, d.line])).toEqual([["error", 3]]);
  });

  it("reads a note's side in any case, and draws it on the side the words name (CONTEXT.md's third rule)", () => {
    // 01M36DWFN gap 3, decided 2026-09-23. Mermaid 12.2.0 accepts
    // `note LEFT OF Idle`, records "LEFT OF" verbatim, and then draws it on
    // the *right* — its side test is an exact `=== "left of"`. The document
    // names the left, so Siren draws the left, as CONTEXT.md's third rule
    // says, and the multi-line form reads the same way.
    for (const [statement, position] of [
      ["note LEFT OF Idle : shouty", "left of"],
      ["note Right Of Idle : mixed", "right of"],
      ["note left  of Idle : spaced", "left of"],
    ] as const) {
      const document = documentOf(`stateDiagram-v2\n  Idle --> Busy\n  ${statement}\n`);
      expect(document.states[0].note?.position, statement).toBe(position);
    }
  });

  it("marks a state with the stereotype it was declared with, and leaves everything else about it alone", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs): a closed set of
    // three, recorded as a `type` field on the state's own record —
    // `id="Choice" type="choice"`. The state keeps the id the author wrote
    // and its place in the relations, so this is a change of *figure* and
    // not of structure.
    const document = documentOf(
      "stateDiagram-v2\n" +
        "  state Choice <<choice>>\n" +
        "  state Split <<fork>>\n" +
        "  state Merge <<join>>\n" +
        "  Choice --> Split\n" +
        "  Split --> Merge\n",
    );

    expect(document.states.map((state) => [state.id, state.kind, state.stereotype])).toEqual([
      ["Choice", "state", "choice"],
      ["Split", "state", "fork"],
      ["Merge", "state", "join"],
    ]);
    // Still an ordinary endpoint: the stereotype line declared the state, so
    // the transitions name it rather than declaring a second one beside it.
    expect(document.transitions.map((t) => [t.from, t.to])).toEqual([
      ["Choice", "Split"],
      ["Split", "Merge"],
    ]);
  });

  it("reads the stereotype word case-insensitively, as Mermaid's own lexer rule does", () => {
    // Measured (mermaid 11.17.2): `<<CHOICE>>`, `<<FORK>>` and `<<Join>>`
    // each report the lowercase `type`, because the lexer rule is
    // `/^(?:.*<<fork>>)/i`. Unlike a note's `position` — which Mermaid
    // records verbatim and then compares exactly, drawing the wrong side —
    // the casing changes nothing about what is recorded here, so there is no
    // wrong picture to decline and refusing it would cost a document Mermaid
    // draws.
    for (const [written, expected] of [
      ["<<CHOICE>>", "choice"],
      ["<<Fork>>", "fork"],
      ["<<jOiN>>", "join"],
    ]) {
      const document = documentOf(`stateDiagram-v2\n  state X ${written}\n`);
      expect(
        document.states.map((state) => state.stereotype),
        `for "${written}"`,
      ).toEqual([expected]);
    }
  });

  it("leaves a stereotype written below its state's first mention inert, as Mermaid does", () => {
    // Measured (mermaid 11.17.2): `A --> X` followed by
    // `state X <<choice>>` reports `id="X" type="default"` — Mermaid's
    // `addState` guards the field with `if (!state.type)`, and a state that
    // already exists always has one. So the marker only takes on the line
    // that *first names* the state.
    //
    // The opposite of the way a block upgrades a state to a composite, which
    // Mermaid does do (`if (!state.doc)`), and the reason these two are not
    // one rule.
    const late = documentOf("stateDiagram-v2\n  A --> X\n  state X <<choice>>\n");
    expect(late.states.map((state) => [state.id, state.stereotype])).toEqual([
      ["A", null],
      ["X", null],
    ]);

    // And, for the same reason, a second marker on one state cannot replace
    // the first.
    const twice = documentOf(
      "stateDiagram-v2\n  state X <<choice>>\n  state X <<fork>>\n",
    );
    expect(twice.states.map((state) => [state.id, state.stereotype])).toEqual([
      ["X", "choice"],
    ]);
  });

  it("refuses the stereotype-shaped lines Mermaid does not read as one", () => {
    // Over-reach guards on `STEREOTYPE_RE`, every row measured against
    // mermaid 11.17.2 with scripts/mermaid-probe.mjs. The pattern this one
    // replaced (the `UNIMPLEMENTED` entry) was `/<<\s*(choice|fork|join)\s*>>/`
    // — unanchored at both ends and tolerant of inner spaces — and every row
    // below is a line it would have claimed.
    const refused = [
      // Mermaid's rule spells the brackets literally, so spaces inside them
      // are not a stereotype: measured, this declares *nothing* and `X` comes
      // back `type="default"` from the transition alone.
      "state X << choice >>",
      // Measured: this *is* a stereotype in Mermaid, and it also declares a
      // second, phantom state called `trailing` — the `.*<<choice>>` token
      // takes the prefix as the id and the rest becomes an id of its own.
      // Drawing a box nobody wrote is the silently-wrong answer; refusing is
      // the honest one.
      "state X <<choice>> trailing",
      // Measured: Mermaid reports a state whose id is literally `Foo Bar` —
      // a name no transition can reach. Ids are read in `\w+` here.
      "state Foo Bar <<choice>>",
      // Measured: the id comes back as `"desc" as X`, with a *separate* `X`
      // beside it. Two states where the author wrote one.
      'state "desc" as X <<choice>>',
      // The second spelling Mermaid's lexer accepts — `[[fork]]`, measured to
      // report `type="fork"`. No corpus row covers it, so it stays refused
      // rather than quietly implemented.
      "state X [[fork]]",
      // Not one of the three. Measured: `<<end>>`, `<<start>>` and `<<foo>>`
      // are each accepted and *ignored* by Mermaid — the statement declares
      // nothing at all. No corpus row covers that, so it is not implemented
      // here either.
      "state X <<end>>",
      "state X <<foo>>",
    ];

    for (const statement of refused) {
      const { document, diagnostics } = parseStateDiagram(
        `stateDiagram-v2\n  A --> X\n  ${statement}\n`,
      );

      expect(document, `for "${statement}"`).toBeNull();
      const refusal = diagnostics.find((d) => d.line === 3);
      expect(refusal, `for "${statement}"`).toBeDefined();
      expect(refusal!.severity, `for "${statement}"`).toBe("error");
      expect(refusal!.message, `for "${statement}"`).toContain(`"${statement}"`);
    }
  });

  it("hangs a note off the state it names, carrying the side the author wrote", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs): the note is
    // recorded **on the state itself** —
    // `id="Idle" note={"position":"right of","text":"waiting for work"}` —
    // not in a separate note collection the way a class diagram's is.
    const document = documentOf(
      "stateDiagram-v2\n  Idle --> Busy\n  note right of Idle : waiting for work\n",
    );

    expect(document.states.map((state) => [state.id, state.note])).toEqual([
      ["Idle", { position: "right of", label: plainLabel("waiting for work") }],
      ["Busy", null],
    ]);
  });

  it("lets a second note on one state replace the first, whichever sides they were written on", () => {
    // **The measurement that decided the field is singular.** Mermaid
    // 11.17.2, measured twice: `note right of Idle : first` followed by
    // `note left of Idle : second` reports the one note
    // `{"position":"left of","text":"second"}`, and the same pair written on
    // the same side reports `{"position":"right of","text":"second"}`. Two
    // notes on one state is not a document Mermaid has — which is why this is
    // a `StateNote | null` field on the state and not the `ClassNote[]`
    // collection a class diagram carries.
    const crossed = documentOf(
      "stateDiagram-v2\n  Idle --> Busy\n  note right of Idle : first\n  note left of Idle : second\n",
    );
    expect(crossed.states[0].note).toEqual({ position: "left of", label: plainLabel("second") });

    const sameSide = documentOf(
      "stateDiagram-v2\n  Idle --> Busy\n  note right of Idle : first\n  note right of Idle : second\n",
    );
    expect(sameSide.states[0].note).toEqual({ position: "right of", label: plainLabel("second") });

    // One state, not two: the second statement annotates the state again
    // rather than declaring anything new.
    expect(sameSide.states.map((state) => state.id)).toEqual(["Idle", "Busy"]);
  });

  it("declares the state a note names when no other line has", () => {
    // Measured (mermaid 11.17.2): `note right of Ghost : who?` puts `Ghost`
    // into the state table carrying the note, with nothing pointing at it —
    // so the note declares its state exactly as a description does
    // (`Lonely : waits`), and the state is drawn.
    const document = documentOf(
      "stateDiagram-v2\n  Idle --> Busy\n  note right of Ghost : who?\n",
    );

    expect(document.states.map((state) => state.id)).toEqual(["Idle", "Busy", "Ghost"]);
    expect(document.states[2].note).toEqual({ position: "right of", label: plainLabel("who?") });

    // And inside a composite it joins that block, the way every other
    // first mention of a state does — measured: mermaid reports
    // `id="Ghost" in="root/Outer"` for a note written inside `state Outer {`.
    const nested = documentOf(
      "stateDiagram-v2\n  state Outer {\n    Inner --> Done\n    note right of Ghost : who?\n  }\n",
    );
    expect(nested.states.map((state) => `${state.id}:${state.parentId}`)).toEqual([
      "Outer:null",
      "Inner:Outer",
      "Done:Outer",
      "Ghost:Outer",
    ]);
  });

  it("refuses the note spellings Mermaid itself refuses, rather than reading them as text", () => {
    // The other half of implementing a construct: the pattern must not reach
    // past what Mermaid accepts, or Siren draws a picture for a document that
    // does not render. Each line below is a **parse or lexical error in
    // mermaid 11.17.2** (measured, scripts/mermaid-probe.mjs), so the whole
    // document is refused here too — and refused as *malformed*, which is
    // what it is, rather than named as an unimplemented construct.
    const refused = [
      // `over` is a sequence diagram's word: "Lexical error on line 3."
      "note over Idle : hovering",
      // A second colon is not note text: "Expecting ... got 'DESCR'".
      "note right of Idle : a : b : c",
      // Nothing after the colon is not an empty note: "Lexical error".
      "note right of Idle :",
    ];

    for (const statement of refused) {
      const { document, diagnostics } = parseStateDiagram(
        `stateDiagram-v2\n  Idle --> Busy\n  ${statement}\n`,
      );

      expect(document, `for "${statement}"`).toBeNull();
      expect(
        diagnostics.map((d) => [d.severity, d.line]),
        `for "${statement}"`,
      ).toEqual([["error", 3]]);
    }

    // And the state keeps no note from any of them — the refusal is not a
    // half-read statement that left something behind.
    const { document } = parseStateDiagram(
      "stateDiagram-v2\n  Idle --> Busy\n  note over Idle : hovering\n",
    );
    expect(document).toBeNull();
  });

  it("ignores `note \"text\" as N`, the floating spelling Mermaid records nothing for", () => {
    // Measured (mermaid 11.17.2): this line parses — it is not an error —
    // and reaches **no** state table and no drawn figure: `--markup` shows
    // only `Idle` and `Busy`. So Mermaid renders this document, and refusing
    // it here would trade a document that renders for no picture at all,
    // which is the one thing CONTEXT.md's compatibility condition forbids.
    // Accepted and dropped on the floor, exactly as `state Skipped` is.
    const { document, diagnostics } = parseStateDiagram(
      'stateDiagram-v2\n  Idle --> Busy\n  note "floating" as N\n',
    );

    expect(diagnostics).toEqual([]);
    expect(document).not.toBeNull();
    // No state `N`, and no note on anything: Mermaid records neither.
    expect((document as StateDocument).states.map((state) => [state.id, state.note])).toEqual([
      ["Idle", null],
      ["Busy", null],
    ]);
  });

  it("reads `classDef` and the `class` apply-directive into the document's styles", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs): this document
    // reports `id="Busy" classes=["urgent"]`, and `--markup` shows the
    // author's `fill` reaching the drawn state's rect.
    //
    // Two statements, two roles, exactly as a class diagram's `classDef` and
    // `cssClass` are: the `classDef` defines and applies to nothing, and the
    // apply-directive names the targets. They are kept apart here and paired
    // by `resolveStyles`, which is what lets an apply-directive name a
    // `classDef` written below it.
    const document = documentOf(
      "stateDiagram-v2\n  classDef urgent fill:#f96\n  Idle --> Busy\n  class Busy urgent\n",
    );

    expect(document.styles).toEqual([
      {
        styleKind: "classDef",
        authoredAs: "classDef",
        targetIds: [],
        name: "urgent",
        properties: [{ property: "fill", value: "#f96" }],
        line: 2,
        column: 3,
      },
      {
        styleKind: "apply",
        authoredAs: "class",
        targetIds: ["Busy"],
        name: "urgent",
        properties: [],
        line: 4,
        column: 3,
      },
    ]);
  });

  it("splits the apply-directive's comma-separated target list", () => {
    // Measured (mermaid 11.17.2): `class Busy,Done urgent` reports
    // `classes=["urgent"]` on **both** states — the comma list sits in the
    // *id* position, and a space after the comma reads the same.
    //
    // Deliberately not the other position: measured, `class Busy a,b` takes
    // the whole tail as one class name (`classes=["a,b"]`), so a state
    // carrying two classes is written as two `class` statements — see the
    // test below for how the tail is read.
    for (const list of ["Busy,Done", "Busy, Done"]) {
      const document = documentOf(
        `stateDiagram-v2\n  classDef urgent fill:#f96\n  Idle --> Busy\n  Idle --> Done\n  class ${list} urgent\n`,
      );

      expect(
        document.styles.filter((s) => s.styleKind === "apply").map((s) => s.targetIds),
        `for "class ${list} urgent"`,
      ).toEqual([["Busy", "Done"]]);
    }
  });

  it("reads the apply-directive's class names as the rest of the line, one per word, as Mermaid paints them", () => {
    // 01M37GQRM, measured on mermaid 12.2.0: `class Busy a,b` gives Busy
    // `classes=["a,b"]` and `class Busy u extra` gives `["u extra"]` — the
    // name is everything after the target list. No classDef carries `a,b`,
    // so nothing is painted (`resolveStyles` warns), and the picture is
    // Mermaid's. `u extra` is drawn as `class="node u extra …"` and Busy
    // painted with `u`'s fill (`--markup`), so the tail is split on
    // whitespace. Siren used to refuse both documents outright.
    for (const [statement, names] of [
      ["class Busy a,b", ["a,b"]],
      ["class Busy u extra", ["u", "extra"]],
      ["class Busy, Idle u", ["u"]],
    ] as const) {
      const document = documentOf(`stateDiagram-v2\n  classDef u fill:#00f\n  Idle --> Busy\n  ${statement}\n`);
      const apply = document.styles.filter((s) => s.styleKind === "apply");
      expect(apply.map((s) => s.name), `for "${statement}"`).toEqual(names);
    }
  });

  it("accepts an apply-directive with no class name, applying nothing and saying so", () => {
    // Measured on 12.2.0: `class Busy` and `class Busy,Idle` draw, giving the
    // targets `classes=[""]` — nothing is painted. Siren used to refuse the
    // document. A warning, since an author who wrote a target and no class
    // has very likely left something out.
    const { document, diagnostics } = parseStateDiagram("stateDiagram-v2\n  Idle --> Busy\n  class Busy,Idle\n");

    expect(document).not.toBeNull();
    expect((document as StateDocument).styles).toEqual([]);
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: "warning", line: 3, message: expect.stringContaining("names no class") }),
    ]);
  });

  it("reads every statement keyword in any case, as Mermaid 12.2.0's lexer does", () => {
    // 01M4WAFCY, measured on 12.2.0: CLASSDEF, CLASS, STYLE, DIRECTION (and
    // its value: `Direction Rl` is RL, `direction Td` TB), `STATE C {` and
    // `STATE "x" AS y` each read as their lower-case spelling. Siren refused
    // them all as unrecognized lines.
    const document = documentOf(
      [
        "stateDiagram-v2",
        "  CLASSDEF u fill:#00f",
        "  Idle --> Busy",
        "  CLASS Busy u",
        "  STYLE Idle fill:#f00",
        "  Direction Rl",
        "  STATE C {",
        "    X",
        "  }",
        '  STATE "Long name" AS L',
        "",
      ].join("\n"),
    );

    expect(document.styles.map((s) => [s.styleKind, s.name ?? s.targetIds.join(",")])).toEqual([
      ["classDef", "u"],
      ["apply", "u"],
      ["style", "Idle"],
    ]);
    expect(document.direction).toBe("RL");
    expect(document.states.map((s) => [s.id, s.kind])).toEqual([
      ["Idle", "state"],
      ["Busy", "state"],
      ["C", "composite"],
      ["X", "state"],
      ["L", "state"],
    ]);
    expect(documentOf("stateDiagram-v2\n  A\n  direction Td\n").direction).toBe("TB");
  });

  it("reads accTitle and accDescr as the diagram's accessible title and description, never as states", () => {
    // 01M4WVVN9, measured on mermaid 12.2.0: `accTitle: T` and `accDescr: D`
    // set the two fields and draw nothing, in any case and with whitespace
    // before the colon, and the braced block reads as in every kind
    // (`readAccDescrBlock`). Siren read both lines as descriptions and drew
    // states called `accTitle` and `accDescr`, with no diagnostic.
    const document = documentOf("stateDiagram-v2\n  ACCTITLE : Orders\n  accDescr {\n    how\n      orders move\n  }\n  A\n");
    expect(document.accTitle).toBe("Orders");
    expect(document.accDescr).toBe("how\norders move");
    expect(document.states.map((s) => s.id)).toEqual(["A"]);

    expect(documentOf("stateDiagram-v2\n  accDescr:D\n  A\n").accDescr).toBe("D");
    expect(documentOf("stateDiagram-v2\n  accDescr {\n  }\n  A\n").accDescr).toBeNull();
    // A lone `accTitle` with no colon is still an ordinary state.
    expect(documentOf("stateDiagram-v2\n  accTitle\n").states.map((s) => s.id)).toEqual(["accTitle"]);

    const unclosed = parseStateDiagram("stateDiagram-v2\n  accDescr {\n  one\n  A\n");
    expect(unclosed.document).toBeNull();
  });

  it("records `style X props` as a style on its comma-separated targets, in source order", () => {
    // Measured (mermaid 12.2.0, `--markup`): `style Busy fill:#f00` paints
    // Busy's rect `fill:#f00 !important`, and `style A,B fill:#f00` paints
    // both. 01M36C24S: this used to refuse the whole document.
    const document = documentOf(
      "stateDiagram-v2\n  Idle --> Busy\n  style Busy fill:#f00,stroke:#00f\n  style Idle,Busy color:#fff\n",
    );

    expect(document.styles).toEqual([
      {
        styleKind: "style",
        authoredAs: "style",
        targetIds: ["Busy"],
        name: null,
        properties: [
          { property: "fill", value: "#f00" },
          { property: "stroke", value: "#00f" },
        ],
        line: 3,
        column: 3,
      },
      {
        styleKind: "style",
        authoredAs: "style",
        targetIds: ["Idle", "Busy"],
        name: null,
        properties: [{ property: "color", value: "#fff" }],
        line: 4,
        column: 3,
      },
    ]);
  });

  it("reads `style A, B props` as styling both, where Mermaid paints `B props` onto A", () => {
    // Measured (mermaid 12.2.0, `--markup`): with a space after the comma,
    // A's rect carries `style="B fill:#f00 !important"` and B carries
    // nothing — Mermaid's picture contradicts the line, with no diagnostic.
    // CONTEXT.md's third rule: Siren draws what the document says, both.
    const document = documentOf("stateDiagram-v2\n  A --> B\n  style A, B fill:#f00\n");

    expect(document.styles.map((s) => [s.targetIds, s.properties])).toEqual([
      [["A", "B"], [{ property: "fill", value: "#f00" }]],
    ]);
  });

  it("keeps the reserved-word guard the two styling statements were reserved for", () => {
    // The boundary the new patterns must not cross. `classDef` and `class`
    // became statement keywords above; a bare one, with no operands, is
    // still a **whole-document parse error in Mermaid** (measured, 11.17.2:
    // "Expecting 'CLASSDEF_ID', 'DEFAULT'" and "Expecting
    // 'CLASSENTITY_IDS'"), so it must stay an error here rather than being
    // swallowed by the statement patterns or declaring a state of that name.
    //
    // `CLASS_APPLY_RE` requires two operands and `CLASS_DEF_RE` requires a
    // declaration list, which is what leaves both of these to
    // `RESERVED_WORD_RE` — the reservation `01M2ZPJKH` made for exactly
    // this ticket.
    for (const word of ["class", "classDef", "Class", "CLASSDEF"]) {
      const { document, diagnostics } = parseStateDiagram(
        `stateDiagram-v2\n  Idle --> Busy\n  ${word}\n`,
      );

      expect(document, `for "${word}"`).toBeNull();
      const refusal = diagnostics.find((d) => d.line === 3);
      expect(refusal, `for "${word}"`).toBeDefined();
      expect(refusal!.severity, `for "${word}"`).toBe("error");
      expect(refusal!.message, `for "${word}"`).toMatch(/reserved/i);
    }

    // And the reservation is still not global: after the `state ` keyword
    // Mermaid's lexer leaves its INITIAL condition, so these words still
    // name a state there (measured), and the new patterns must not have
    // started claiming those lines either.
    expect(documentOf('stateDiagram-v2\n  state "x" as class\n').states.map((s) => s.id)).toEqual(
      ["class"],
    );
  });

  it("still reads the two `direction` and `state ... {` spellings it does implement", () => {
    // The refusals above must not shadow what already works: `direction` is
    // read inside a composite's block, and `state Outer {` opens one.
    const document = documentOf(
      "stateDiagram-v2\n  state Outer {\n    direction LR\n    A --> B\n  }\n",
    );

    expect(document.states.map((s) => [s.id, s.kind, s.direction])).toEqual([
      ["Outer", "composite", "LR"],
      ["A", "state", null],
      ["B", "state", null],
    ]);
  });

  it("reads a `direction` written at the document's own level onto the document", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs): this document
    // reports `direction LR`, and its three states are drawn left to right
    // on one row (`--markup`: x = 28, 158, 288, all at y = 18).
    const document = documentOf("stateDiagram-v2\n  direction LR\n  Idle --> Busy\n");

    expect(document.direction).toBe("LR");
  });

  it("keeps the *first* document-level `direction`, wherever on the page it was written", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs), and the one
    // place this kind parts company with `parseClassDiagram`, where a later
    // statement overwrites an earlier one:
    //
    //   direction LR / Idle --> Busy / direction RL   reports LR
    //   direction RL / Idle --> Busy / direction LR   reports RL
    //   direction BT / ... / direction LR / direction RL   reports BT
    //   Idle --> Busy / direction LR                  reports LR
    //
    // Its database answers `getDirection()` from the *first* `dir` statement
    // in the root document, so a second one at the same level is inert.
    const directionOf = (source: string) => documentOf(source).direction;

    expect(directionOf("stateDiagram-v2\n  Idle --> Busy\n")).toBe("TB");
    expect(directionOf("stateDiagram-v2\n  Idle --> Busy\n  direction LR\n")).toBe("LR");
    expect(
      directionOf("stateDiagram-v2\n  direction LR\n  Idle --> Busy\n  direction RL\n"),
    ).toBe("LR");
    expect(
      directionOf("stateDiagram-v2\n  direction RL\n  Idle --> Busy\n  direction LR\n"),
    ).toBe("RL");
    expect(
      directionOf("stateDiagram-v2\n  direction BT\n  Idle --> Busy\n  direction LR\n  direction RL\n"),
    ).toBe("BT");
  });

  it("keeps a composite's `direction` and the document's own apart, each governing its own level", () => {
    // Measured: with `direction LR` at the document's level and
    // `direction TB` inside `Outer`, the document reports `LR` and the
    // composite's block carries its own `{"stmt":"dir","value":"TB"}`.
    // Neither overrides the other.
    const both = documentOf(
      "stateDiagram-v2\n  direction LR\n  Before --> Outer\n  state Outer {\n    direction TB\n    First --> Second\n  }\n",
    );

    expect(both.direction).toBe("LR");
    expect(both.states.find((s) => s.id === "Outer")!.direction).toBe("TB");

    // And the other way round: measured, a document whose only `direction`
    // is inside a composite reports `TB` — the composite's statement lives
    // in that block's own doc and never reaches the root.
    const insideOnly = documentOf(
      "stateDiagram-v2\n  Before --> Outer\n  state Outer {\n    direction LR\n    First --> Second\n  }\n",
    );

    expect(insideOnly.direction).toBe("TB");
    expect(insideOnly.states.find((s) => s.id === "Outer")!.direction).toBe("LR");

    // Measured: a document-level `direction` written *after* the block still
    // governs the document, and the composite keeps its own.
    const afterTheBlock = documentOf(
      "stateDiagram-v2\n  Before --> Outer\n  state Outer {\n    direction LR\n    First --> Second\n  }\n  direction BT\n",
    );

    expect(afterTheBlock.direction).toBe("BT");
    expect(afterTheBlock.states.find((s) => s.id === "Outer")!.direction).toBe("LR");
  });

  it("leaves the keyword-shaped words Mermaid does *not* reserve as ordinary state ids", () => {
    // Characterization, and the guard rail on the reserved-word rule below.
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs, each word on a
    // line of its own and again as `A --> word`): every one of these eight
    // declares an ordinary state in **both** positions. Mermaid recognizes
    // `direction lr`, `hide empty description` and `accTitle:` as
    // prefix-plus-argument statements rather than by reserving the bare
    // word, so the bare word falls through to its ordinary id rule.
    //
    // `direction` and `end` are the two that look most like keywords and
    // are the likeliest to be swept up by a reserved-word rule written from
    // impression rather than from measurement — which is exactly what this
    // test exists to catch.
    const survivors = [
      "hide",
      "end",
      "direction",
      "fork",
      "join",
      "choice",
      "accTitle",
      "accDescr",
    ];

    for (const word of survivors) {
      const alone = documentOf(`stateDiagram-v2\n  ${word}\n`);
      expect(
        alone.states.map((s) => s.id),
        `for "${word}" on a line of its own`,
      ).toEqual([word]);

      const endpoint = documentOf(`stateDiagram-v2\n  A --> ${word}\n`);
      expect(
        endpoint.states.map((s) => s.id),
        `for "A --> ${word}"`,
      ).toEqual(["A", word]);
      expect(
        endpoint.transitions.map((t) => [t.from, t.to]),
        `for "A --> ${word}"`,
      ).toEqual([["A", word]]);
    }
  });

  it("refuses a reserved word written on a line of its own, and says it is reserved", () => {
    // Measured (mermaid 11.17.2): each of these six on a line of its own is
    // a **parse error** — Mermaid's lexer takes the word for itself before
    // its ordinary id rule can see it, and the whole document fails to
    // render. Siren drew a box labelled with the word instead, with no
    // diagnostic at all, which is the silently-wrong shape this refusal
    // closes.
    //
    // `state` is the one exception and is tested separately: it alone is
    // tolerated and ignored rather than refused.
    //
    // Case-insensitive, because Mermaid's lexer rules are: measured, `Note`,
    // `NOTE`, `Class`, `Style`, `Click`, `Scale` and `ClassDef` are each
    // refused exactly as their lowercase spelling is.
    //
    // 01M2ZQQQ6, re-measured on 12.2.0: `href`, `default` and `stateDiagram`
    // are reserved too (each a parse error alone and as an endpoint), so the
    // set is ten words, not seven.
    const reserved = [
      "note",
      "classDef",
      "class",
      "style",
      "click",
      "scale",
      "href",
      "default",
      "stateDiagram",
      "Note",
      "STYLE",
      "HREF",
    ];

    for (const word of reserved) {
      const { document, diagnostics } = parseStateDiagram(
        `stateDiagram-v2\n  Idle --> Busy\n  ${word}\n`,
      );

      expect(document, `for "${word}"`).toBeNull();
      const refusal = diagnostics.find((d) => d.line === 3);
      expect(refusal, `for "${word}"`).toBeDefined();
      expect(refusal!.severity, `for "${word}"`).toBe("error");
      // The author needs to learn that *renaming the state* fixes this, not
      // that their line is malformed — so the word is named and the reason
      // is given, and the generic unrecognized-line wording is excluded.
      expect(refusal!.message, `for "${word}"`).toMatch(/reserved/i);
      expect(refusal!.message, `for "${word}"`).toContain(`"${word}"`);
      expect(refusal!.message, `for "${word}"`).not.toContain("Unrecognized");
    }
  });

  it("declares nothing for a lone `state`, and says nothing about it either", () => {
    // `state` is the one reserved word that is **not** refused here, and the
    // only one of the seven Mermaid treats differently in the two positions.
    // Measured (mermaid 11.17.2): `state` on a line of its own is not a
    // parse error and puts no state into the state table — the same
    // tolerate-and-ignore `state X` gets, one argument further truncated.
    // Refusing it would cost a document Mermaid renders its picture.
    //
    // Case-insensitive with the rest of the rule: measured, `State` and
    // `STATE` alone are ignored too.
    for (const spelling of ["state", "State", "STATE"]) {
      const { document, diagnostics } = parseStateDiagram(
        `stateDiagram-v2\n  Idle --> Busy\n  ${spelling}\n`,
      );

      expect(diagnostics, `for "${spelling}"`).toEqual([]);
      expect(document, `for "${spelling}"`).not.toBeNull();
      // `Idle` and `Busy` are here so the absence is read off a document
      // that was actually parsed: asserting an empty state list would pass
      // just as happily on a document that came back as nothing at all.
      expect(
        (document as StateDocument).states.map((s) => s.id),
        `for "${spelling}"`,
      ).toEqual(["Idle", "Busy"]);
    }
  });

  it("refuses a reserved word at either end of a transition, `state` included", () => {
    // The second position an id is read from Mermaid's INITIAL lexer
    // condition, and the one where the rule has no exception: measured
    // (mermaid 11.17.2), all **seven** are a parse error as a transition
    // endpoint — `state` among them, unlike on a line of its own. So the
    // reservation is a rule about the word, not about one line shape.
    const reserved = [
      "state",
      "note",
      "classDef",
      "class",
      "style",
      "click",
      "scale",
      "href",
      "default",
      "stateDiagram",
    ];

    for (const word of reserved) {
      for (const statement of [`Idle --> ${word}`, `${word} --> Idle`]) {
        const { document, diagnostics } = parseStateDiagram(
          `stateDiagram-v2\n  ${statement}\n`,
        );

        expect(document, `for "${statement}"`).toBeNull();
        const refusal = diagnostics.find((d) => d.line === 2);
        expect(refusal, `for "${statement}"`).toBeDefined();
        expect(refusal!.severity, `for "${statement}"`).toBe("error");
        expect(refusal!.message, `for "${statement}"`).toMatch(/reserved/i);
        expect(refusal!.message, `for "${statement}"`).toContain(`"${word}"`);
      }
    }
  });

  it("refuses a reserved word as the subject of a description, `state` alone excepted", () => {
    // The third place an id is read from Mermaid's INITIAL condition
    // (01M2ZQQQ6). Measured (mermaid 12.2.0): `style : hi`, `scale : hi`,
    // `click : hi`, `note : hi`, `class : hi`, `classDef : hi`, `href : hi`,
    // `default : hi` and `stateDiagram : hi` are each a parse error, and
    // case does not matter (`Note : hi` too). Siren declared a state for
    // every one of them, with no diagnostic.
    for (const word of ["style", "scale", "click", "note", "class", "classDef", "href", "default", "stateDiagram", "Note"]) {
      const { document, diagnostics } = parseStateDiagram(
        `stateDiagram-v2\n  Idle --> Busy\n  ${word} : hi\n`,
      );

      expect(document, `for "${word} : hi"`).toBeNull();
      const refusal = diagnostics.find((d) => d.line === 3);
      expect(refusal?.severity, `for "${word} : hi"`).toBe("error");
      expect(refusal?.message, `for "${word} : hi"`).toMatch(/reserved/i);
      expect(refusal?.message, `for "${word} : hi"`).toContain(`"${word}"`);
    }

    // `state : hi` is tolerated and declares nothing, as `state` alone is
    // (measured: no state, no error; `STATE : hi` the same).
    for (const spelling of ["state", "STATE"]) {
      const { document, diagnostics } = parseStateDiagram(
        `stateDiagram-v2\n  Idle --> Busy\n  ${spelling} : hi\n`,
      );

      expect(diagnostics, `for "${spelling} : hi"`).toEqual([]);
      expect((document as StateDocument).states.map((s) => s.id), `for "${spelling} : hi"`).toEqual(["Idle", "Busy"]);
    }

    // And the words Mermaid does not reserve stay ordinary subjects here too
    // (measured: `direction : hi`, `end : hi`, `hide : hi` each declare a
    // described state) — the third position the survivors are checked in.
    // `accTitle : hi` and `accDescr : hi` are not among them: there they are
    // the accessibility statements (01M4WVVN9).
    for (const word of ["hide", "end", "direction", "fork", "join", "choice"]) {
      const document = documentOf(`stateDiagram-v2\n  ${word} : hi\n`);
      expect(document.states.map((s) => [s.id, s.descriptions.map((d) => d.text)]), `for "${word} : hi"`).toEqual([
        [word, ["hi"]],
      ]);
    }
  });

  it("still lets a reserved word name a state where Mermaid's own lexer lets it", () => {
    // Characterization, and the second guard rail: the reservation is **not
    // global**, however much it looks like one. Measured (mermaid 11.17.2):
    // `state "x" as note` declares a state `note` with description `x`, and
    // `state note { ... }` declares a composite named `note` holding its
    // members — both render.
    //
    // The reason is lexical: after the `state ` keyword Mermaid's lexer
    // leaves its INITIAL condition, and in the condition it enters these
    // words carry no special meaning. So a rule that refused them
    // everywhere would cost two documents Mermaid draws their picture,
    // which is the trade CONTEXT.md's compatibility condition forbids.
    const described = documentOf('stateDiagram-v2\n  state "waiting" as note\n');
    expect(described.states.map((s) => [s.id, s.descriptions])).toEqual([
      ["note", [plainLabel("waiting")]],
    ]);

    const composite = documentOf("stateDiagram-v2\n  state class {\n    A --> B\n  }\n");
    expect(composite.states.map((s) => [s.id, s.kind, s.parentId])).toEqual([
      ["class", "composite", null],
      ["A", "state", "class"],
      ["B", "state", "class"],
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

/**
 * Every place a state diagram writes text is a label read by `readLabel`
 * in the full `html` dialect — measured (mermaid 11.17.2, `--paint` with
 * `htmlLabels: true`): `s2 : d<b>bold</b>e` reads "dbolde", a transition's
 * `t<br/>u` reads "tu", `state "c<br/>d" as X {` titles its cluster "cd",
 * and `note left of s2 : p<i>q</i>r` reads "pqr". So `<br>` breaks a row in
 * all four, and every other tag is the label module's to read.
 */
describe("parseStateDiagram — labels", () => {
  /** A label of these rows, each one plain run. */
  const rowsLabel = (...rows: string[]) => ({
    text: rows.join("\n"),
    rows: rows.map((row) => [plainRun(row)]),
  });

  it("reads a description's <br/> as a row break", () => {
    const document = documentOf("stateDiagram-v2\n  s1 : a<br/>b\n");

    expect(document.states[0].descriptions).toEqual([rowsLabel("a", "b")]);
  });

  it("reads a transition label's <br/> as a row break", () => {
    const document = documentOf("stateDiagram-v2\n  s1 --> s2 : a<br/>b\n");

    expect(document.transitions[0].label).toEqual(rowsLabel("a", "b"));
  });

  it("reads a note's <br/> as a row break", () => {
    const document = documentOf("stateDiagram-v2\n  note right of s1 : a<br/>b\n");

    expect(document.states[0].note).toEqual({ position: "right of", label: rowsLabel("a", "b") });
  });
});

describe("parseStateDiagram — a problem in a label, reported where the author wrote it", () => {
  /** Each diagnostic as `severity line:column`. */
  const positions = (source: string): string[] =>
    parseStateDiagram(source).diagnostics.map((d) => `${d.severity} ${d.line}:${d.column}`);

  it("points into a description, in both spellings", () => {
    // `  s1 : ab⚠c` — the ⚠ is the 10th character of line 2.
    expect(positions("stateDiagram-v2\n  s1 : ab⚠c")).toEqual(["error 2:10"]);
    // `  state "x⚠" as S` — past the quote.
    expect(positions('stateDiagram-v2\n  state "x⚠" as S')).toEqual(["error 2:11"]);
  });

  it("points into a composite's quoted title", () => {
    // `  state "c⚠" as X {`
    expect(positions('stateDiagram-v2\n  state "c⚠" as X {\n    A\n  }')).toEqual([
      "error 2:11",
    ]);
  });

  it("points into a transition label, past the padding after the colon", () => {
    // `  A --> B :  y⚠`
    expect(positions("stateDiagram-v2\n  A --> B :  y⚠")).toEqual(["error 2:15"]);
  });

  it("points into a note", () => {
    // `  note right of A : n⚠`
    expect(positions("stateDiagram-v2\n  note right of A : n⚠")).toEqual(["error 2:22"]);
  });

  it("costs the document for an error and not for a warning", () => {
    expect(parseStateDiagram("stateDiagram-v2\n  s1 : a⚠").document).toBeNull();

    const warned = parseStateDiagram("stateDiagram-v2\n  s1 : a⚑");
    expect(warned.document).not.toBeNull();
    expect(warned.diagnostics).toEqual([
      { severity: "warning", message: "test problem ⚑", line: 2, column: 9 },
    ]);
  });
});

/**
 * Mermaid's style-line rule (its `encodeEntities`): before it parses, it
 * drops the last `;` of every line where `style` (or `classDef`), a `:` and
 * then a `#` come before it — the whole line, not one label. Mermaid
 * 11.17.2, measured with `--html`. `parseSiren` applies it to the whole
 * document, so these read through it.
 */
describe("parseStateDiagram — the `;` Mermaid drops from a style line", () => {
  const colors = (label: { rows: { text: string; color: string | null }[][] } | null | undefined) =>
    label?.rows[0]!.map((run) => [run.text, run.color]);

  it("keeps a color whose `;` is the line's last", () => {
    // `state "<span style='color:#f00;'>r</span>" as A` draws `color:#f00`.
    const document = documentOf(`stateDiagram-v2\n  state "<span style='color:#f00;'>r</span>" as A`, parseSiren);
    expect(colors(document.states.find((state) => state.id === "A")!.descriptions[0])).toEqual([["r", "#f00"]]);
  });

  it("drops the line's last `;` and not the color's, in a transition label", () => {
    // `A --> B : <span style='color:#f00;'>r</span> #35;` draws
    // `<span style="color:&amp;f00;">r</span> #35`.
    const document = documentOf(`stateDiagram-v2\n  A --> B : <span style='color:#f00;'>r</span> #35;`, parseSiren);
    const label = document.transitions[0]!.label!;
    expect(label.text).toBe("r #35");
    expect(colors(label)).toEqual([["r #35", null]]);
  });

  it("leaves a position past it where the author wrote it", () => {
    // `  A --> B : <b style='x:#1'>#35;⚑</b>`: the ⚑ is the 33rd character.
    expect(
      parseSiren("stateDiagram-v2\n  A --> B : <b style='x:#1'>#35;⚑</b>").diagnostics.map(
        (d) => `${d.severity} ${d.line}:${d.column}`,
      ),
    ).toEqual(["warning 2:33"]);
  });
});

/**
 * A `%%` in the middle of a state-diagram line (CONTEXT.md **Comment**),
 * measured on Mermaid 12.2.0 (the state table in the mermaid-parity
 * measurement). Only a whole line is a comment; the state lexer's own rule
 * `%%(?!\{)[^\n]*` reads one wherever a token ends, and a rule that reads
 * text — a label, a description, a note, a declaration list — reads past a
 * `%%` to the line's end. Read through `parseSiren`, which hands a state
 * diagram its lines as written.
 */
describe("a `%%` in the middle of a state-diagram line", () => {
  const NOT_A_COMMENT =
    'A "%%" in the middle of a line is not a comment: only a line that starts with "%%" is one. ' +
    "If it is a comment, move it to a line of its own.";

  const stateOk = (body: string): StateDocument => {
    const { diagnostics } = parseSiren(`stateDiagram-v2\n${body}`);
    expect([body, diagnostics]).toEqual([body, []]);
    return documentOf(`stateDiagram-v2\n${body}`, parseSiren);
  };
  const descriptionsOf = (document: StateDocument) =>
    document.states.flatMap((state) => state.descriptions.map((label) => label.text));
  const notesOf = (document: StateDocument) => document.states.flatMap((state) => (state.note ? [state.note.label.text] : []));

  it("keeps a `%%` in every piece of text a statement holds, as Mermaid records it", () => {
    // Measured: a transition's label, a description in either spelling, a
    // note on one line or in a block, a declaration list and the
    // accessibility lines all keep their `%% zz`.
    expect(stateOk("  A --> B : go %% zz\n  B --> C").transitions.map((t) => t.label?.text ?? null)).toEqual([
      "go %% zz",
      null,
    ]);
    expect(descriptionsOf(stateOk("  A : desc %% zz\n  B"))).toEqual(["desc %% zz"]);
    expect(descriptionsOf(stateOk("  A : %% zz"))).toEqual(["%% zz"]);
    expect(descriptionsOf(stateOk('  state "d %% zz" as A\n  A --> B'))).toEqual(["d %% zz"]);
    expect(notesOf(stateOk("  A\n  note right of A : n %% zz"))).toEqual(["n %% zz"]);
    expect(notesOf(stateOk("  A\n  note right of A\n    n %% zz\n  end note"))).toEqual(["n %% zz"]);
    const styled = stateOk("  classDef c fill:#f00 %% zz\n  A\n  style A fill:#0f0 %% zz");
    expect(styled.styles.map((s) => [s.styleKind, s.properties])).toEqual([
      ["classDef", [{ property: "fill", value: "#f00 %% zz" }]],
      ["style", [{ property: "fill", value: "#0f0 %% zz" }]],
    ]);
    const described = stateOk("  accTitle: t %% zz\n  accDescr: d %% zz\n  A");
    expect([described.accTitle, described.accDescr]).toEqual(["t %% zz", "d %% zz"]);
  });

  it("reads a `%%` where a token ends as a comment, on any line, as Mermaid's lexer does", () => {
    // Measured: each of these is drawn exactly as the same document without
    // its `%% zz` — after the header (either spelling), a state's id, a
    // transition (last line or not, spaced or not), `state "d" as A`, a
    // composite's `{` and `}`, a stereotype, a `--` divider, `end note`,
    // a `[*]` and a `direction`.
    for (const [commented, plain] of [
      ["stateDiagram-v2 %% zz\n  A --> B", "stateDiagram-v2\n  A --> B"],
      ["stateDiagram %% zz\n  A --> B", "stateDiagram\n  A --> B"],
      ["stateDiagram-v2\n  A %% zz\n  B", "stateDiagram-v2\n  A\n  B"],
      ["stateDiagram-v2\n  A%%zz\n  B", "stateDiagram-v2\n  A\n  B"],
      ["stateDiagram-v2\n  A --> B %% zz\n  B --> C", "stateDiagram-v2\n  A --> B\n  B --> C"],
      ["stateDiagram-v2\n  A --> B %% zz", "stateDiagram-v2\n  A --> B"],
      ["stateDiagram-v2\n  A-->B%%zz", "stateDiagram-v2\n  A-->B"],
      ['stateDiagram-v2\n  state "d" as A %% zz\n  A --> B', 'stateDiagram-v2\n  state "d" as A\n  A --> B'],
      ['stateDiagram-v2\n  state "d" as A%%zz', 'stateDiagram-v2\n  state "d" as A'],
      ["stateDiagram-v2\n  state A { %% zz\n    B --> C\n  }", "stateDiagram-v2\n  state A {\n    B --> C\n  }"],
      [
        "stateDiagram-v2\n  state A {\n    B --> C\n  } %% zz\n  A --> D",
        "stateDiagram-v2\n  state A {\n    B --> C\n  }\n  A --> D",
      ],
      ["stateDiagram-v2\n  state A {\n    B\n  }%%zz", "stateDiagram-v2\n  state A {\n    B\n  }"],
      ["stateDiagram-v2\n  state c <<choice>> %% zz\n  A --> c", "stateDiagram-v2\n  state c <<choice>>\n  A --> c"],
      ["stateDiagram-v2\n  state f <<fork>> %% zz\n  A --> f", "stateDiagram-v2\n  state f <<fork>>\n  A --> f"],
      ["stateDiagram-v2\n  state j <<join>>%%zz\n  A --> j", "stateDiagram-v2\n  state j <<join>>\n  A --> j"],
      [
        "stateDiagram-v2\n  state A {\n    B\n    -- %% zz\n    C\n  }",
        "stateDiagram-v2\n  state A {\n    B\n    --\n    C\n  }",
      ],
      [
        "stateDiagram-v2\n  A\n  note right of A\n    n\n  end note %% zz",
        "stateDiagram-v2\n  A\n  note right of A\n    n\n  end note",
      ],
      ["stateDiagram-v2\n  [*] --> A %% zz", "stateDiagram-v2\n  [*] --> A"],
      ["stateDiagram-v2\n  direction LR %% zz\n  A", "stateDiagram-v2\n  direction LR\n  A"],
    ] as const) {
      const read = parseSiren(commented);
      expect([commented, read.diagnostics]).toEqual([commented, []]);
      expect([commented, read.document]).toEqual([commented, parseSiren(plain).document]);
    }
  });

  it("reads a `class` statement's `%%` as one more class name, as Mermaid paints it", () => {
    // Measured: `class A c %% zz` records the class "c %% zz", and Mermaid
    // draws A with `class="node c %% zz statediagram-state"` — split on
    // whitespace, so `c` paints A (fill #f00), exactly as `class A c` does,
    // and `%%` and `zz` paint whatever their `classDef`s say (here none).
    const document = stateOk("  classDef c fill:#f00\n  A\n  class A c %% zz");
    const applied = document.styles.filter((s) => s.styleKind === "apply");
    expect(applied.map((s) => [s.targetIds, s.name])).toEqual([
      [["A"], "c"],
      [["A"], "%%"],
      [["A"], "zz"],
    ]);
  });

  it("keeps a `%%` after a block note's opener as the note's first row, as Mermaid records it", () => {
    // Measured: `note right of A %% zz` opens a block note whose text is
    // "%% zz\nn" — the opener's `%%` is text, as `class A { %% zz` keeps
    // "%% zz" as a member.
    const document = stateOk("  A\n  note right of A %% zz\n    n\n  end note");
    expect(notesOf(document)).toEqual(["%% zz\nn"]);
    expect(document.states.find((state) => state.id === "A")?.note?.label.rows.length).toBe(2);
  });

  it("refuses a `%%` run into the header, as Mermaid does, at its `%%`", () => {
    // Measured: `stateDiagram-v2%%zz` is a parse error ("Expecting 'SPACE',
    // 'NL', 'SD', got 'ID'").
    for (const [source, line] of [["stateDiagram-v2%%zz\n  A", 1]] as const) {
      const column = source.split("\n")[line - 1]!.indexOf("%%") + 1;
      const { document, diagnostics } = parseSiren(source);
      expect([source, document]).toEqual([source, null]);
      expect([source, diagnostics]).toEqual([source, [{ severity: "error", message: NOT_A_COMMENT, line, column }]]);
    }
  });
});
