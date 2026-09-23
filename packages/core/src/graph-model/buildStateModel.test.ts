import { describe, expect, it } from "vitest";
import type { Direction, StateDocument } from "../contracts";
import { parseStateDiagram } from "../parser/parseStateDiagram";
import { buildStateModel } from "./buildStateModel";

/**
 * A parsed state document, with the source positions every fixture ignores
 * filled in — and `TB`, the direction a document naming none carries, unless
 * a test is about the direction.
 */
function document(
  transitions: { from: string; to: string; label?: string | null }[],
  stateIds?: string[],
  direction: Direction = "TB",
): StateDocument {
  const ids =
    stateIds ??
    transitions.flatMap(({ from, to }) => [from, to]).filter((id, index, all) => all.indexOf(id) === index);
  return {
    kind: "state",
    direction,
    regions: [],
    styles: [],
    timeline: null,
    states: ids.map((id) => ({
      id,
      kind: "state" as const,
      stereotype: null,
      descriptions: [],
      parentId: null,
      regionIndex: null,
      direction: null,
      note: null,
      line: 1,
      column: 1,
    })),
    transitions: transitions.map(({ from, to, label }, index) => ({
      from,
      to,
      label: label ?? null,
      parentId: null,
      regionIndex: null,
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
    expect(model.transitions.map((t) => t.id)).toEqual(["Idle-Running", "Running-Done"]);
  });

  it("suffixes a repeated pair with #2, and the one after it with #3", () => {
    const { model } = buildStateModel(
      document([
        { from: "Idle", to: "Running", label: "start" },
        { from: "Idle", to: "Running", label: "resume" },
        { from: "Idle", to: "Running", label: "retry" },
      ]),
    );

    expect(model.transitions.map((t) => t.id)).toEqual([
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
    expect(model.states.map((s) => s.id)).toEqual(["Running"]);
    expect(model.transitions).toEqual([
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

    expect(model.transitions.map((t) => t.label)).toEqual(["start", null]);
  });

  it("keeps every declared state, including one no transition names", () => {
    const { model } = buildStateModel(
      document([{ from: "Idle", to: "Running" }], ["Idle", "Running", "Lonely"]),
    );

    expect(model.states.map((s) => s.id)).toEqual(["Idle", "Running", "Lonely"]);
  });

  it("carries a state's note through unchanged, and gives a state without one null", () => {
    // Authored text and an authored side, with nothing for this stage to
    // resolve — the way a description is. It is carried at all because the
    // model is what layout reads, and a note that stopped at the parser
    // would be a statement the author wrote and the picture never showed.
    //
    // A pseudo-state can never carry one: `note right of [*]` is refused by
    // name in the parser, so no note ever reaches a state with a generated
    // id, and there is nothing here for this stage to decide about it.
    const parsed = document([{ from: "Idle", to: "Busy" }]);
    parsed.states[0].note = { position: "right of", text: "waiting for work" };

    const { model, diagnostics } = buildStateModel(parsed);

    expect(diagnostics).toEqual([]);
    expect(model.states.map((state) => [state.id, state.note])).toEqual([
      ["Idle", { position: "right of", text: "waiting for work" }],
      ["Busy", null],
    ]);
  });

  it("carries a state's stereotype through unchanged, and gives a pseudo-state none", () => {
    // Authored, and with nothing for this stage to resolve — the way a note
    // and a description already are. It is carried at all because the model
    // is what layout reads, and a stereotype that stopped at the parser
    // would be a marker the author wrote and the picture never showed.
    //
    // A pseudo-state can never carry one: `[*]` is not an id, so no
    // `state ... <<choice>>` statement can name one.
    const parsed = document([{ from: "Idle", to: "Busy" }]);
    parsed.states[0].stereotype = "choice";

    const { model, diagnostics } = buildStateModel(parsed);

    expect(diagnostics).toEqual([]);
    expect(model.states.map((state) => [state.id, state.stereotype])).toEqual([
      ["Idle", "choice"],
      ["Busy", null],
    ]);
  });

  it("carries the document's own direction through to the model, `TB` included", () => {
    // Authored, resolved by the parser, and with nothing for this stage to
    // decide — so it passes through exactly as a composite's own direction
    // already does. It is carried at all because the model is what layout
    // reads: a direction that stopped at the document would leave the
    // picture top-to-bottom whatever the author wrote.
    expect(buildStateModel(document([{ from: "Idle", to: "Busy" }], undefined, "LR")).model.direction).toBe("LR");
    expect(buildStateModel(document([{ from: "Idle", to: "Busy" }])).model.direction).toBe("TB");
  });

  it("carries a described state's descriptions through unchanged, and gives a pseudo-state none", () => {
    // A description is authored text with nothing for this stage to resolve
    // — unlike a transition, which arrives needing an id — so it comes
    // through exactly as written, in written order. A pseudo-state has
    // none and can have none: `[*]` is not an id, so no description
    // statement can name one.
    const { model, diagnostics } = buildStateModel({
      kind: "state",
      direction: "TB",
      regions: [],
      styles: [],
      timeline: null,
      states: [
        {
          id: null,
          kind: "start",
          stereotype: null,
          descriptions: [],
          parentId: null,
          regionIndex: null,
          direction: null,
          note: null,
          line: 2,
          column: 3,
        },
        {
          id: "Idle",
          kind: "state",
          stereotype: null,
          descriptions: ["waiting for work", "nothing queued"],
          parentId: null,
          regionIndex: null,
          direction: null,
          note: null,
          line: 2,
          column: 3,
        },
        {
          id: "Busy",
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
      ],
      transitions: [
        {
          from: null,
          to: "Idle",
          label: null,
          parentId: null,
          regionIndex: null,
          sourceLine: 2,
          sourceColumn: 3,
        },
        {
          from: "Idle",
          to: "Busy",
          label: null,
          parentId: null,
          regionIndex: null,
          sourceLine: 3,
          sourceColumn: 3,
        },
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(model.states).toEqual([
      { id: "start:1", kind: "start", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
      { id: "Idle", kind: "state", stereotype: null, descriptions: ["waiting for work", "nothing queued"], parentId: null, direction: null, note: null },
      { id: "Busy", kind: "state", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
    ]);
  });

  it("names the level's start and end pseudo-states with generated ids, and joins the transitions to them", () => {
    // `[*] --> Idle` / `Idle --> [*]`, as the parser hands it over: the
    // endpoints the author wrote `[*]` for arrive as `null`, and naming
    // them is this stage's job (ADR-0010 — `${kind}:${n}`, a colon, which
    // no authored `\w+` id can spell).
    const { model, diagnostics } = buildStateModel({
      kind: "state",
      direction: "TB",
      regions: [],
      styles: [],
      timeline: null,
      states: [
        {
          id: null,
          kind: "start",
          stereotype: null,
          descriptions: [],
          parentId: null,
          regionIndex: null,
          direction: null,
          note: null,
          line: 2,
          column: 3,
        },
        {
          id: "Idle",
          kind: "state",
          stereotype: null,
          descriptions: [],
          parentId: null,
          regionIndex: null,
          direction: null,
          note: null,
          line: 2,
          column: 3,
        },
        {
          id: null,
          kind: "end",
          stereotype: null,
          descriptions: [],
          parentId: null,
          regionIndex: null,
          direction: null,
          note: null,
          line: 3,
          column: 3,
        },
      ],
      transitions: [
        {
          from: null,
          to: "Idle",
          label: null,
          parentId: null,
          regionIndex: null,
          sourceLine: 2,
          sourceColumn: 3,
        },
        {
          from: "Idle",
          to: null,
          label: null,
          parentId: null,
          regionIndex: null,
          sourceLine: 3,
          sourceColumn: 3,
        },
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(model.states).toEqual([
      { id: "start:1", kind: "start", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
      { id: "Idle", kind: "state", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
      { id: "end:1", kind: "end", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
    ]);
    expect(model.transitions).toEqual([
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
      direction: "TB",
      regions: [],
      styles: [],
      timeline: null,
      states: [
        {
          id: null,
          kind: "start",
          stereotype: null,
          descriptions: [],
          parentId: null,
          regionIndex: null,
          direction: null,
          note: null,
          line: 2,
          column: 3,
        },
        {
          id: "Idle",
          kind: "state",
          stereotype: null,
          descriptions: [],
          parentId: null,
          regionIndex: null,
          direction: null,
          note: null,
          line: 2,
          column: 3,
        },
        {
          id: "Busy",
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
        {
          id: null,
          kind: "end",
          stereotype: null,
          descriptions: [],
          parentId: null,
          regionIndex: null,
          direction: null,
          note: null,
          line: 4,
          column: 3,
        },
      ],
      transitions: [
        {
          from: null,
          to: "Idle",
          label: null,
          parentId: null,
          regionIndex: null,
          sourceLine: 2,
          sourceColumn: 3,
        },
        {
          from: null,
          to: "Busy",
          label: null,
          parentId: null,
          regionIndex: null,
          sourceLine: 3,
          sourceColumn: 3,
        },
        {
          from: "Idle",
          to: null,
          label: null,
          parentId: null,
          regionIndex: null,
          sourceLine: 4,
          sourceColumn: 3,
        },
        {
          from: "Busy",
          to: null,
          label: null,
          parentId: null,
          regionIndex: null,
          sourceLine: 5,
          sourceColumn: 3,
        },
      ],
    });

    expect(model.states.filter((s) => s.kind === "start")).toHaveLength(1);
    expect(model.states.filter((s) => s.kind === "end")).toHaveLength(1);
    expect(model.transitions.map((t) => t.from)).toEqual([
      "start:1",
      "start:1",
      "Idle",
      "Busy",
    ]);
    expect(model.transitions.map((t) => t.to)).toEqual(["Idle", "Busy", "end:1", "end:1"]);
  });

  it("joins `[*] --> [*]` from the start pseudo-state to the end one, which are two different states", () => {
    const { model } = buildStateModel({
      kind: "state",
      direction: "TB",
      regions: [],
      styles: [],
      timeline: null,
      states: [
        {
          id: null,
          kind: "start",
          stereotype: null,
          descriptions: [],
          parentId: null,
          regionIndex: null,
          direction: null,
          note: null,
          line: 2,
          column: 3,
        },
        {
          id: null,
          kind: "end",
          stereotype: null,
          descriptions: [],
          parentId: null,
          regionIndex: null,
          direction: null,
          note: null,
          line: 2,
          column: 3,
        },
      ],
      transitions: [{
          from: null,
          to: null,
          label: null,
          parentId: null,
          regionIndex: null,
          sourceLine: 2,
          sourceColumn: 3,
        }],
    });

    expect(model.states.map((s) => s.id)).toEqual(["start:1", "end:1"]);
    expect(model.transitions).toEqual([
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
      direction: "TB",
      regions: [],
      styles: [],
      timeline: null,
      states: [
        {
          id: null,
          kind: "start",
          stereotype: null,
          descriptions: [],
          parentId: null,
          regionIndex: null,
          direction: null,
          note: null,
          line: 2,
          column: 3,
        },
        {
          id: "root_start",
          kind: "state",
          stereotype: null,
          descriptions: [],
          parentId: null,
          regionIndex: null,
          direction: null,
          note: null,
          line: 2,
          column: 3,
        },
        {
          id: "B",
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
      ],
      transitions: [
        {
          from: null,
          to: "root_start",
          label: null,
          parentId: null,
          regionIndex: null,
          sourceLine: 2,
          sourceColumn: 3,
        },
        {
          from: "root_start",
          to: "B",
          label: null,
          parentId: null,
          regionIndex: null,
          sourceLine: 3,
          sourceColumn: 3,
        },
      ],
    });

    expect(model.states.map((s) => s.id)).toEqual(["start:1", "root_start", "B"]);
    expect(model.transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      "start:1->root_start",
      "root_start->B",
    ]);
    // And no self-loop was invented: the thing Mermaid produces here.
    expect(model.transitions.some((t) => t.from === t.to)).toBe(false);
  });
  it("gives each level its own start and end, and carries a composite through as a state", () => {
    // Two things in one fixture, because they are one fact: a composite is a
    // level, so `[*]` inside it is *that* level's start. Measured (mermaid
    // 11.17.2): `state Outer { [*] --> Inner }` reports `Outer_start
    // in="root/Outer"`, beside the document's own `root_start`.
    //
    // The ids stay ADR-0010's `${kind}:${n}`, with `n` counting levels in
    // the order they are declared — the root first — rather than a second
    // spelling being invented for a nested one.
    const { model, diagnostics } = buildStateModel({
      kind: "state",
      direction: "TB",
      regions: [],
      styles: [],
      timeline: null,
      states: [
        { id: null, kind: "start", stereotype: null, descriptions: [], parentId: null, regionIndex: null, direction: null, note: null, line: 2, column: 3 },
        {
          id: "Outer",
          kind: "composite",
          stereotype: null,
          descriptions: [],
          parentId: null,
          regionIndex: null,
          direction: "LR",
          note: null,
          line: 3,
          column: 3,
        },
        { id: null, kind: "start", stereotype: null, descriptions: [], parentId: "Outer", regionIndex: null, direction: null, note: null, line: 5, column: 5 },
        { id: "Inner", kind: "state", stereotype: null, descriptions: [], parentId: "Outer", regionIndex: null, direction: null, note: null, line: 5, column: 5 },
      ],
      transitions: [
        { from: null, to: "Outer", label: null, parentId: null, regionIndex: null, sourceLine: 2, sourceColumn: 3 },
        { from: null, to: "Inner", label: null, parentId: "Outer", regionIndex: null, sourceLine: 5, sourceColumn: 5 },
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(model.states).toEqual([
      { id: "start:1", kind: "start", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
      { id: "Outer", kind: "composite", stereotype: null, descriptions: [], parentId: null, direction: "LR", note: null },
      { id: "start:2", kind: "start", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
      { id: "Inner", kind: "state", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
    ]);
    // Each `[*]` endpoint resolves against the level the transition was
    // written at — the only thing that tells the two starts apart.
    expect(model.transitions.map((t) => t.id)).toEqual(["start:1-Outer", "start:2-Inner"]);
  });

  it("mints an id for each concurrent region and re-parents that region's members under it", () => {
    // `state Active { A --> B  --  C --> D }`, as the parser hands it over:
    // two regions with no names, and each member carrying the pair
    // (`parentId`, `regionIndex`) that says which one holds it.
    //
    // Naming them is this stage's, for the same reason a pseudo-state's
    // name is (ADR-0010): an id the author never wrote is a generated id.
    // **And it must be minted rather than copied.** Measured (mermaid
    // 11.17.2): mermaid's own divider ids carry a random component — the
    // second came back `id-g8d8ncxe8va-1`, a different string on every run
    // — so they are not reproducible and nothing here may read them.
    // `region:1` is, and the colon keeps it out of the `\w+` space every
    // authored id lives in.
    const { model, diagnostics } = buildStateModel({
      kind: "state",
      direction: "TB",
      regions: [
        { parentId: "Active", index: 0, direction: null },
        { parentId: "Active", index: 1, direction: "LR" },
      ],
      styles: [],
      timeline: null,
      states: [
        { id: "Active", kind: "composite", stereotype: null, descriptions: [], parentId: null, regionIndex: null, direction: null, note: null, line: 2, column: 3 },
        { id: "A", kind: "state", stereotype: null, descriptions: [], parentId: "Active", regionIndex: 0, direction: null, note: null, line: 3, column: 5 },
        { id: "B", kind: "state", stereotype: null, descriptions: [], parentId: "Active", regionIndex: 0, direction: null, note: null, line: 3, column: 5 },
        { id: "C", kind: "state", stereotype: null, descriptions: [], parentId: "Active", regionIndex: 1, direction: null, note: null, line: 5, column: 5 },
        { id: "D", kind: "state", stereotype: null, descriptions: [], parentId: "Active", regionIndex: 1, direction: null, note: null, line: 5, column: 5 },
      ],
      transitions: [
        { from: "A", to: "B", label: null, parentId: "Active", regionIndex: 0, sourceLine: 3, sourceColumn: 5 },
        { from: "C", to: "D", label: null, parentId: "Active", regionIndex: 1, sourceLine: 5, sourceColumn: 5 },
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(model.states.map((state) => [state.id, state.kind, state.parentId])).toEqual([
      ["Active", "composite", null],
      // The regions sit beside their composite, between it and the members
      // they hold, so the list reads in the order the picture nests.
      ["region:1", "region", "Active"],
      ["region:2", "region", "Active"],
      ["A", "state", "region:1"],
      ["B", "state", "region:1"],
      ["C", "state", "region:2"],
      ["D", "state", "region:2"],
    ]);
    // The `direction` statement written inside a region is that region's
    // (measured), so it arrives on the region and not on the block.
    expect(model.states.map((state) => [state.id, state.direction])).toEqual([
      ["Active", null],
      ["region:1", null],
      ["region:2", "LR"],
      ["A", null],
      ["B", null],
      ["C", null],
      ["D", null],
    ]);
  });

  it("gives each concurrent region its own start and end, apart from the block's", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs): a `[*]` written
    // in each of two regions comes back as *two* starts, named after the
    // divider that holds them — `divider-id-1_start` and the second
    // divider's own — so a region is a level in the same sense a composite
    // is, and not a decoration inside one.
    //
    // The level numbers follow the page: the document, the composite, then
    // that composite's regions in order. The divided composite's own level
    // (2) holds no `[*]` at all and keeps its number anyway — a gap in the
    // numbering costs nothing, and closing it would move an unrelated
    // block's ids.
    const { model, diagnostics } = buildStateModel({
      kind: "state",
      direction: "TB",
      regions: [
        { parentId: "Active", index: 0, direction: null },
        { parentId: "Active", index: 1, direction: null },
      ],
      styles: [],
      timeline: null,
      states: [
        { id: "Active", kind: "composite", stereotype: null, descriptions: [], parentId: null, regionIndex: null, direction: null, note: null, line: 2, column: 3 },
        { id: null, kind: "start", stereotype: null, descriptions: [], parentId: "Active", regionIndex: 0, direction: null, note: null, line: 3, column: 5 },
        { id: "A", kind: "state", stereotype: null, descriptions: [], parentId: "Active", regionIndex: 0, direction: null, note: null, line: 3, column: 5 },
        { id: null, kind: "start", stereotype: null, descriptions: [], parentId: "Active", regionIndex: 1, direction: null, note: null, line: 5, column: 5 },
        { id: "C", kind: "state", stereotype: null, descriptions: [], parentId: "Active", regionIndex: 1, direction: null, note: null, line: 5, column: 5 },
        { id: null, kind: "end", stereotype: null, descriptions: [], parentId: "Active", regionIndex: 1, direction: null, note: null, line: 6, column: 5 },
      ],
      transitions: [
        { from: null, to: "A", label: null, parentId: "Active", regionIndex: 0, sourceLine: 3, sourceColumn: 5 },
        { from: null, to: "C", label: null, parentId: "Active", regionIndex: 1, sourceLine: 5, sourceColumn: 5 },
        { from: "C", to: null, label: null, parentId: "Active", regionIndex: 1, sourceLine: 6, sourceColumn: 5 },
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(model.states.map((state) => [state.id, state.parentId])).toEqual([
      ["Active", null],
      ["region:1", "Active"],
      ["region:2", "Active"],
      ["start:3", "region:1"],
      ["A", "region:1"],
      ["start:4", "region:2"],
      ["C", "region:2"],
      ["end:4", "region:2"],
    ]);
    expect(model.transitions.map((t) => t.id)).toEqual([
      "start:3-A",
      "start:4-C",
      "C-end:4",
    ]);
  });

  it("resolves a timeline naming all four addressable kinds — a state, a transition, a composite and a pseudo-state", () => {
    // States and transitions share one id space, exactly as a flowchart's
    // nodes and edges do, and a composite is a state — so `highlight Outer`
    // needs no separate collection for the resolver to look in. A
    // pseudo-state is addressable for free: `buildStateModel` has just given
    // it a generated id, and an id is all `resolveTimeline` asks for.
    const { model, diagnostics } = buildStateModel({
      kind: "state",
      direction: "TB",
      regions: [],
      styles: [],
      states: [
        { id: null, kind: "start", stereotype: null, descriptions: [], parentId: null, regionIndex: null, direction: null, note: null, line: 2, column: 3 },
        { id: "Outer", kind: "composite", stereotype: null, descriptions: [], parentId: null, regionIndex: null, direction: null, note: null, line: 3, column: 3 },
        { id: "Inner", kind: "state", stereotype: null, descriptions: [], parentId: "Outer", regionIndex: null, direction: null, note: null, line: 4, column: 5 },
      ],
      transitions: [
        { from: null, to: "Outer", label: null, parentId: null, regionIndex: null, sourceLine: 2, sourceColumn: 3 },
        { from: "Outer", to: "Inner", label: null, parentId: null, regionIndex: null, sourceLine: 5, sourceColumn: 3 },
      ],
      timeline: {
        entries: [
          { kind: "enter", step: 1, targetId: "start:1", effect: "fade", line: 8, column: 3 },
          { kind: "enter", step: 2, targetId: "Outer", effect: "fade", line: 9, column: 3 },
          { kind: "enter", step: 3, targetId: "Inner", effect: "slide-top", line: 10, column: 3 },
          { kind: "highlight", step: 4, targetId: "Outer-Inner", effect: "outline", line: 11, column: 3 },
        ],
      },
    });

    expect(diagnostics).toEqual([]);
    expect(model.timeline.totalSteps).toBe(4);
    expect(model.timeline.entries.map((e) => [e.step, e.targetId])).toEqual([
      [1, "start:1"],
      [2, "Outer"],
      [3, "Inner"],
      [4, "Outer-Inner"],
    ]);
  });

  it("drops a timeline entry naming an id no state or transition carries, reports it, and still builds the model", () => {
    const source = document([{ from: "Idle", to: "Busy" }]);
    const { model, diagnostics } = buildStateModel({
      ...source,
      timeline: {
        entries: [
          { kind: "enter", step: 1, targetId: "Idle", effect: "fade", line: 5, column: 3 },
          { kind: "enter", step: 1, targetId: "Ghost", effect: "fade", line: 5, column: 20 },
        ],
      },
    });

    expect(model.timeline.entries.map((e) => e.targetId)).toEqual(["Idle"]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("Ghost");
  });

  it("pairs a `classDef` with the `class` directive applying it, onto the state named", () => {
    // The shared `resolveStyles` does the pairing — the same call
    // `buildClassModel` and `buildFlowchartModel` make — so a state diagram
    // gets the identical rules rather than a fourth copy of them. Measured
    // (mermaid 11.17.2): `classDef urgent fill:#f96` plus `class Busy urgent`
    // reports `classes=["urgent"]` on `Busy` and paints its rect `#f96`.
    const source = document([{ from: "Idle", to: "Busy" }]);
    const { model, diagnostics } = buildStateModel({
      ...source,
      styles: [
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
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(model.styles).toEqual([
      { targetId: "Busy", style: { frame: [{ property: "fill", value: "#f96" }], text: [] } },
    ]);
  });

  it("stacks two classes on one state in application order, last value winning", () => {
    // Measured (mermaid 11.17.2) — the stacking order this pins. A state
    // wearing two classes takes them from two `class` statements, not from a
    // comma list (`class Busy a,b` reads `a,b` as one class name), and the
    // drawn rect comes back
    //
    //   class Busy alpha / class Busy beta  →  fill:#0f0 stroke:#00f
    //   class Busy beta  / class Busy alpha →  fill:#f00 stroke:#00f
    //
    // with `classDef alpha fill:#f00,stroke:#00f` and `classDef beta
    // fill:#0f0`. So the properties **merge** — `stroke` survives from the
    // class that is not last — and only a property both classes declare is
    // decided, by the one applied **last**. That is the CSS cascade's answer
    // for one element, which is the answer `resolveStyles` already gives.
    const classDefs = [
      {
        styleKind: "classDef" as const,
        authoredAs: "classDef",
        targetIds: [],
        name: "alpha",
        properties: [
          { property: "fill", value: "#f00" },
          { property: "stroke", value: "#00f" },
        ],
        line: 2,
        column: 3,
      },
      {
        styleKind: "classDef" as const,
        authoredAs: "classDef",
        targetIds: [],
        name: "beta",
        properties: [{ property: "fill", value: "#0f0" }],
        line: 3,
        column: 3,
      },
    ];
    const apply = (name: string, line: number) => ({
      styleKind: "apply" as const,
      authoredAs: "class",
      targetIds: ["Busy"],
      name,
      properties: [],
      line,
      column: 3,
    });
    const source = document([{ from: "Idle", to: "Busy" }]);

    const alphaThenBeta = buildStateModel({
      ...source,
      styles: [...classDefs, apply("alpha", 5), apply("beta", 6)],
    });
    expect(alphaThenBeta.diagnostics).toEqual([]);
    expect(alphaThenBeta.model.styles).toEqual([
      {
        targetId: "Busy",
        style: {
          frame: [
            { property: "fill", value: "#0f0" },
            { property: "stroke", value: "#00f" },
          ],
          text: [],
        },
      },
    ]);

    const betaThenAlpha = buildStateModel({
      ...source,
      styles: [...classDefs, apply("beta", 5), apply("alpha", 6)],
    });
    expect(betaThenAlpha.diagnostics).toEqual([]);
    expect(betaThenAlpha.model.styles).toEqual([
      {
        targetId: "Busy",
        style: {
          frame: [
            { property: "fill", value: "#f00" },
            { property: "stroke", value: "#00f" },
          ],
          text: [],
        },
      },
    ]);
  });

  it("warns when a transition stays visible after a state it joins has exited", () => {
    // A transition is a connector, so the rule `warnOnConnectorsOutlivingTheirEndpoints`
    // already applies to a flowchart edge and a class relationship applies
    // here too — a line left drawn into empty space. Advisory only: nothing
    // is dropped.
    const source = document([{ from: "Idle", to: "Busy" }]);
    const { model, diagnostics } = buildStateModel({
      ...source,
      timeline: {
        entries: [
          { kind: "exit", step: 1, targetId: "Busy", effect: "fade", line: 5, column: 3 },
        ],
      },
    });

    expect(model.timeline.entries).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].message).toContain('transition "Idle-Busy"');
    expect(diagnostics[0].message).toContain('"Busy" exits at step 1');
  });
});

/**
 * The property this construct exists to have and Mermaid does not: the same
 * document, read twice, names its concurrent regions the same way.
 *
 * Driven from source text through `parseStateDiagram` rather than from a
 * hand-built document, because what has to be reproducible is the whole
 * path from the author's line to the id — a region's index, its place in
 * `StateDocument.regions`, and the counter `generatedId` runs off it.
 */
describe("buildStateModel, on the ids it mints for concurrent regions", () => {
  const modelOf = (source: string) => {
    const { document, diagnostics } = parseStateDiagram(source);
    expect(diagnostics).toEqual([]);
    const built = buildStateModel(document as StateDocument);
    expect(built.diagnostics).toEqual([]);
    return built.model;
  };

  const SOURCE = `stateDiagram-v2
  [*] --> Active
  state Active {
    [*] --> Reading
    Reading --> Parsing
    --
    Logging --> Flushed
  }
  state Second {
    P --> Q
    --
    R --> S
  }
`;

  it("names them the same way on every run, which is what Mermaid cannot do", () => {
    // **Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs): mermaid's own
    // divider ids are not reproducible.** The first in a block is
    // `divider-id-1`, and every one after it is built from a random
    // component — the second came back `id-wjxqkl6axch-1`,
    // `id-g8d8ncxe8va-1`, `id-kql3sfhyxu-1` on three consecutive runs of the
    // same document. An implementation that read those ids would give
    // `data-siren-id` a different value every render, so a `timeline:` entry
    // naming a region would work or not depending on the run.
    //
    // `generatedId` counts from the document's own order instead, so the
    // answer is the same every time by construction — and the colon in
    // `region:1` keeps it out of the `\w+` space every authored id lives in
    // (ADR-0010), which is why no collision check is needed either.
    const first = modelOf(SOURCE).states.map((state) => state.id);
    const second = modelOf(SOURCE).states.map((state) => state.id);

    expect(first).toEqual(second);
    expect(first).toEqual([
      "start:1",
      "Active",
      "region:1",
      "region:2",
      "start:3",
      "Reading",
      "Parsing",
      "Logging",
      "Flushed",
      "Second",
      "region:3",
      "region:4",
      "P",
      "Q",
      "R",
      "S",
    ]);

    // The transitions too, since a transition's id is built from its
    // endpoints and a region's `[*]` is one of them.
    expect(modelOf(SOURCE).transitions.map((t) => t.id)).toEqual(
      modelOf(SOURCE).transitions.map((t) => t.id),
    );
    expect(modelOf(SOURCE).transitions.map((t) => t.id)).toContain("start:3-Reading");
  });

  it("gives no region an id an author could have written", () => {
    // Not a guarded collision but an unconstructible one: `region:1` has a
    // colon in it, every authored state id is `\w+`, and `\w` does not
    // match a colon — so no `class` statement, no transition endpoint and
    // no `timeline:` target can name one by accident (ADR-0010). Asserted
    // on the shape rather than on a list, so a future generated id is held
    // to the same rule.
    for (const state of modelOf(SOURCE).states) {
      if (state.kind === "region") {
        expect(state.id).toMatch(/^region:\d+$/);
      }
    }
  });
});
