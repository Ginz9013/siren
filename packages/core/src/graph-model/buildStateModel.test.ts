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
    states: ids.map((id) => ({ id, line: 1, column: 1 })),
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
});
