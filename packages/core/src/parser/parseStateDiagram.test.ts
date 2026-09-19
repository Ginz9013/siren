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
      { from: "Idle", to: "Running", label: null, sourceLine: 2, sourceColumn: 3 },
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
      { from: "Running", to: "Running", label: "retry", sourceLine: 2, sourceColumn: 3 },
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
      { id: "Idle", line: 2, column: 3 },
      { id: "Running", line: 3, column: 3 },
    ]);
  });

  it("refuses by name every construct this parser does not draw, rather than swallowing it", () => {
    // CONTEXT.md's opening policy: while a construct is unimplemented, Siren
    // rejects it rather than rendering it wrongly. Each of these is valid
    // Mermaid that a later ticket implements, and each would otherwise be
    // read as something else — `[*] --> Still` as a state literally named
    // `[*]`, `Idle : running` as a transition-shaped line with no arrow.
    const refusals: [string, string][] = [
      ["[*] --> Still", "start/end pseudo-state"],
      ["Still --> [*]", "start/end pseudo-state"],
      ["Idle : waiting for work", "state description"],
      ['state "waiting for work" as Idle', "state description"],
      ["state Outer {", "composite state"],
    ];

    for (const [statement, construct] of refusals) {
      const { document, diagnostics } = parseStateDiagram(
        `stateDiagram-v2\n  ${statement}\n`,
      );

      expect(document, statement).toBeNull();
      expect(diagnostics, statement).toHaveLength(1);
      expect(diagnostics[0].severity, statement).toBe("error");
      // Named, not merely refused: an author who reads "unrecognized line"
      // goes looking for a typo they did not make.
      expect(diagnostics[0].message, statement).toContain(construct);
      expect(diagnostics[0].message, statement).toContain(statement);
      expect(diagnostics[0], statement).toMatchObject({ line: 2, column: 3 });
    }
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
