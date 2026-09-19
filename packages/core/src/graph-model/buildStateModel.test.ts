import { describe, expect, it } from "vitest";
import type { StateDocument } from "../contracts";
import { buildStateModel } from "./buildStateModel";

/** A parsed state document, with the source positions every fixture ignores filled in. */
function document(
  transitions: { from: string; to: string; label?: string | null }[],
  stateIds?: string[],
): StateDocument {
  const ids =
    stateIds ??
    transitions.flatMap(({ from, to }) => [from, to]).filter((id, index, all) => all.indexOf(id) === index);
  return {
    kind: "state",
    states: ids.map((id) => ({ id, kind: "state" as const, line: 1, column: 1 })),
    transitions: transitions.map(({ from, to, label }, index) => ({
      from,
      to,
      label: label ?? null,
      sourceLine: index + 2,
      sourceColumn: 3,
    })),
  };
}

describe("buildStateModel", () => {
  it("gives every transition the id `${from}-${to}`", () => {
    // The convention flowchart edges and class relationships already share,
    // used a third time rather than invented a third time: one timeline
    // vocabulary addresses every diagram kind.
    const { model, diagnostics } = buildStateModel(
      document([
        { from: "Idle", to: "Running" },
        { from: "Running", to: "Done" },
      ]),
    );

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    expect(model!.transitions.map((t) => t.id)).toEqual(["Idle-Running", "Running-Done"]);
  });

  it("suffixes a repeated pair with #2, and the one after it with #3", () => {
    const { model } = buildStateModel(
      document([
        { from: "Idle", to: "Running", label: "start" },
        { from: "Idle", to: "Running", label: "resume" },
        { from: "Idle", to: "Running", label: "retry" },
      ]),
    );

    expect(model!.transitions.map((t) => t.id)).toEqual([
      "Idle-Running",
      "Idle-Running#2",
      "Idle-Running#3",
    ]);
  });

  it("gives a self-transition the same shape of id, on its one state", () => {
    const { model, diagnostics } = buildStateModel(
      document([{ from: "Running", to: "Running", label: "retry" }]),
    );

    expect(diagnostics).toEqual([]);
    expect(model!.states.map((s) => s.id)).toEqual(["Running"]);
    expect(model!.transitions).toEqual([
      { id: "Running-Running", from: "Running", to: "Running", label: "retry" },
    ]);
  });

  it("carries each transition's label through unchanged, `null` included", () => {
    const { model } = buildStateModel(
      document([
        { from: "Idle", to: "Running", label: "start" },
        { from: "Running", to: "Idle" },
      ]),
    );

    expect(model!.transitions.map((t) => t.label)).toEqual(["start", null]);
  });

  it("keeps every declared state, including one no transition names", () => {
    const { model } = buildStateModel(
      document([{ from: "Idle", to: "Running" }], ["Idle", "Running", "Lonely"]),
    );

    expect(model!.states.map((s) => s.id)).toEqual(["Idle", "Running", "Lonely"]);
  });

  it("names the level's start and end pseudo-states with generated ids, and joins the transitions to them", () => {
    // `[*] --> Idle` / `Idle --> [*]`, as the parser hands it over: the
    // endpoints the author wrote `[*]` for arrive as `null`, and naming
    // them is this stage's job (ADR-0010 — `${kind}:${n}`, a colon, which
    // no authored `\w+` id can spell).
    const { model, diagnostics } = buildStateModel({
      kind: "state",
      states: [
        { id: null, kind: "start", line: 2, column: 3 },
        { id: "Idle", kind: "state", line: 2, column: 3 },
        { id: null, kind: "end", line: 3, column: 3 },
      ],
      transitions: [
        { from: null, to: "Idle", label: null, sourceLine: 2, sourceColumn: 3 },
        { from: "Idle", to: null, label: null, sourceLine: 3, sourceColumn: 3 },
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(model!.states).toEqual([
      { id: "start:1", kind: "start" },
      { id: "Idle", kind: "state" },
      { id: "end:1", kind: "end" },
    ]);
    expect(model!.transitions).toEqual([
      { id: "start:1-Idle", from: "start:1", to: "Idle", label: null },
      { id: "Idle-end:1", from: "Idle", to: "end:1", label: null },
    ]);
  });

  it("points every `[*] -->` at the one start pseudo-state, and every `--> [*]` at the one end", () => {
    // The fact most likely to be got wrong. Measured: two `[*] -->` lines
    // both came back from a single `root_start`, so the id the model mints
    // has to be shared rather than minted per occurrence — `start:1` twice
    // and never `start:1` beside `start:2`.
    const { model } = buildStateModel({
      kind: "state",
      states: [
        { id: null, kind: "start", line: 2, column: 3 },
        { id: "Idle", kind: "state", line: 2, column: 3 },
        { id: "Busy", kind: "state", line: 3, column: 3 },
        { id: null, kind: "end", line: 4, column: 3 },
      ],
      transitions: [
        { from: null, to: "Idle", label: null, sourceLine: 2, sourceColumn: 3 },
        { from: null, to: "Busy", label: null, sourceLine: 3, sourceColumn: 3 },
        { from: "Idle", to: null, label: null, sourceLine: 4, sourceColumn: 3 },
        { from: "Busy", to: null, label: null, sourceLine: 5, sourceColumn: 3 },
      ],
    });

    expect(model!.states.filter((s) => s.kind === "start")).toHaveLength(1);
    expect(model!.states.filter((s) => s.kind === "end")).toHaveLength(1);
    expect(model!.transitions.map((t) => t.from)).toEqual([
      "start:1",
      "start:1",
      "Idle",
      "Busy",
    ]);
    expect(model!.transitions.map((t) => t.to)).toEqual(["Idle", "Busy", "end:1", "end:1"]);
  });

  it("joins `[*] --> [*]` from the start pseudo-state to the end one, which are two different states", () => {
    const { model } = buildStateModel({
      kind: "state",
      states: [
        { id: null, kind: "start", line: 2, column: 3 },
        { id: null, kind: "end", line: 2, column: 3 },
      ],
      transitions: [{ from: null, to: null, label: null, sourceLine: 2, sourceColumn: 3 }],
    });

    expect(model!.states.map((s) => s.id)).toEqual(["start:1", "end:1"]);
    expect(model!.transitions).toEqual([
      { id: "start:1-end:1", from: "start:1", to: "end:1", label: null },
    ]);
  });

  it("leaves a state the author named `root_start` alone — the pseudo-state is not spellable", () => {
    // **A divergence from Mermaid, recorded beside the code it diverges
    // from** (`buildStateModel.ts`, `pseudoStateIds`). Measured, mermaid
    // 11.17.2 on `[*] --> root_start` / `root_start --> B`: the author
    // means three nodes and two edges, and Mermaid draws two nodes with the
    // relations `root_start → root_start` and `root_start → B` — the start
    // pseudo-state is swallowed by the author's own state and its edge
    // becomes a self-loop nobody wrote, with no diagnostic. Siren's
    // generated ids carry a colon and authored ids are `\w+`, so the
    // collision is unconstructible rather than merely unlikely.
    const { model } = buildStateModel({
      kind: "state",
      states: [
        { id: null, kind: "start", line: 2, column: 3 },
        { id: "root_start", kind: "state", line: 2, column: 3 },
        { id: "B", kind: "state", line: 3, column: 3 },
      ],
      transitions: [
        { from: null, to: "root_start", label: null, sourceLine: 2, sourceColumn: 3 },
        { from: "root_start", to: "B", label: null, sourceLine: 3, sourceColumn: 3 },
      ],
    });

    expect(model!.states.map((s) => s.id)).toEqual(["start:1", "root_start", "B"]);
    expect(model!.transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      "start:1->root_start",
      "root_start->B",
    ]);
    // And no self-loop was invented: the thing Mermaid produces here.
    expect(model!.transitions.some((t) => t.from === t.to)).toBe(false);
  });
});
