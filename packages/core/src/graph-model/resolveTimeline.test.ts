import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../contracts";
import { resolveTimeline, warnOnConnectorsOutlivingTheirEndpoints } from "./resolveTimeline";

describe("resolveTimeline", () => {
  it("returns an empty timeline and reports nothing when there is no timeline block", () => {
    const diagnostics: Diagnostic[] = [];

    expect(resolveTimeline(null, new Set(["A"]), diagnostics)).toEqual({
      totalSteps: 0,
      entries: [],
    });
    expect(diagnostics).toEqual([]);
  });

  it("drops an entry naming an id no target holds, reporting an error that carries the entry's source position, and keeps the rest", () => {
    const diagnostics: Diagnostic[] = [];

    const resolved = resolveTimeline(
      {
        entries: [
          { kind: "enter", step: 1, targetId: "A", effect: "fade" },
          { kind: "enter", step: 2, targetId: "Ghost", effect: "fade", line: 7, column: 3 },
          { kind: "highlight", step: 3, targetId: "B", effect: "glow" },
        ],
      },
      new Set(["A", "B"]),
      diagnostics,
    );

    expect(resolved.entries).toEqual([
      { kind: "enter", step: 1, targetId: "A", effect: "fade" },
      { kind: "highlight", step: 3, targetId: "B", effect: "glow" },
    ]);
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'timeline: references unknown id "Ghost"',
        line: 7,
        column: 3,
      },
    ]);
  });

  it("keeps the first-declared of two enter actions that tie on the same step, warning about the loser", () => {
    const diagnostics: Diagnostic[] = [];

    const resolved = resolveTimeline(
      {
        entries: [
          { kind: "enter", step: 1, targetId: "A", effect: "fade" },
          { kind: "enter", step: 1, targetId: "A", effect: "slide-left", line: 4, column: 1 },
        ],
      },
      new Set(["A"]),
      diagnostics,
    );

    expect(resolved.entries).toEqual([{ kind: "enter", step: 1, targetId: "A", effect: "fade" }]);
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          'timeline: "A" already has a "enter" action; keeping the earliest-step occurrence.',
        line: 4,
        column: 1,
      },
    ]);
  });

  it("lets the numerically earliest step win an enter or exit duplicate, even when it is declared last", () => {
    // next()/prev() always walk entries in step order, so "the one that
    // applies" has to mean first in time, not first in the file.
    const diagnostics: Diagnostic[] = [];

    const resolved = resolveTimeline(
      {
        entries: [
          { kind: "enter", step: 3, targetId: "A", effect: "slide-left", line: 3, column: 1 },
          { kind: "enter", step: 1, targetId: "A", effect: "fade", line: 4, column: 1 },
          { kind: "exit", step: 9, targetId: "A", effect: "fade", line: 5, column: 1 },
          { kind: "exit", step: 5, targetId: "A", effect: "slide-top", line: 6, column: 1 },
        ],
      },
      new Set(["A"]),
      diagnostics,
    );

    expect(resolved.entries).toEqual([
      { kind: "enter", step: 1, targetId: "A", effect: "fade" },
      { kind: "exit", step: 5, targetId: "A", effect: "slide-top" },
    ]);
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          'timeline: "A" already has a "enter" action; keeping the earliest-step occurrence.',
        line: 3,
        column: 1,
      },
      {
        severity: "warning",
        message: 'timeline: "A" already has a "exit" action; keeping the earliest-step occurrence.',
        line: 5,
        column: 1,
      },
    ]);
  });

  it("rejects an action on a target before that target becomes visible, counting a never-entered target as visible from step 0", () => {
    const diagnostics: Diagnostic[] = [];

    const resolved = resolveTimeline(
      {
        entries: [
          { kind: "enter", step: 4, targetId: "A", effect: "fade" },
          { kind: "highlight", step: 2, targetId: "A", effect: "glow", line: 6, column: 1 },
          { kind: "highlight", step: 1, targetId: "B", effect: "glow" },
        ],
      },
      new Set(["A", "B"]),
      diagnostics,
    );

    expect(resolved.entries).toEqual([
      { kind: "enter", step: 4, targetId: "A", effect: "fade" },
      { kind: "highlight", step: 1, targetId: "B", effect: "glow" },
    ]);
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'timeline: "highlight" on "A" at step 2 comes before it becomes visible (step 4)',
        line: 6,
        column: 1,
      },
    ]);
  });

  it("reports totalSteps as the highest step that survived, ignoring the steps of dropped entries", () => {
    const diagnostics: Diagnostic[] = [];

    const resolved = resolveTimeline(
      {
        entries: [
          { kind: "enter", step: 1, targetId: "A", effect: "fade" },
          { kind: "highlight", step: 5, targetId: "A", effect: "glow" },
          { kind: "enter", step: 7, targetId: "A", effect: "fade" },
          { kind: "enter", step: 9, targetId: "Ghost", effect: "fade" },
        ],
      },
      new Set(["A"]),
      diagnostics,
    );

    expect(resolved.totalSteps).toBe(5);
    expect(resolved.entries.map((e) => e.step)).toEqual([1, 5]);
  });
});

describe("warnOnConnectorsOutlivingTheirEndpoints", () => {
  it("warns once per connector still on screen after an endpoint exits, spelling the caller's noun into the message, and stays quiet about a connector whose endpoints never leave", () => {
    // The message text is the one `buildFlowchartModel` and `buildClassModel`
    // have always produced, with the noun as the only variable — their own
    // tests still assert it and are not edited by this extraction.
    const diagnostics: Diagnostic[] = [];

    warnOnConnectorsOutlivingTheirEndpoints(
      [{ kind: "exit", step: 5, targetId: "A", effect: "fade" }],
      [
        { id: "A-B", from: "A", to: "B" },
        { id: "B-C", from: "B", to: "C" },
      ],
      "message",
      diagnostics,
    );

    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          'timeline: message "A-B" remains visible after its endpoint "A" exits at step 5 — ' +
          'add "exit A-B ..." at or before step 5',
      },
    ]);
  });
  it("names whichever endpoint leaves first when both do, and the `to` endpoint when it is the only one that leaves", () => {
    // "First" is the earliest exit step, not the endpoint written first: the
    // warning tells the author the step by which the connector has to be gone,
    // and that is the earlier of the two. An exact tie keeps `from`.
    const diagnostics: Diagnostic[] = [];

    warnOnConnectorsOutlivingTheirEndpoints(
      [
        { kind: "exit", step: 7, targetId: "A", effect: "fade" },
        { kind: "exit", step: 3, targetId: "B", effect: "fade" },
        { kind: "exit", step: 4, targetId: "D", effect: "fade" },
        { kind: "exit", step: 2, targetId: "E", effect: "fade" },
        { kind: "exit", step: 2, targetId: "F", effect: "fade" },
      ],
      [
        { id: "A-B", from: "A", to: "B" },
        { id: "C-D", from: "C", to: "D" },
        { id: "E-F", from: "E", to: "F" },
      ],
      "edge",
      diagnostics,
    );

    expect(diagnostics.map((d) => d.message)).toEqual([
      'timeline: edge "A-B" remains visible after its endpoint "B" exits at step 3 — ' +
        'add "exit A-B ..." at or before step 3',
      'timeline: edge "C-D" remains visible after its endpoint "D" exits at step 4 — ' +
        'add "exit C-D ..." at or before step 4',
      'timeline: edge "E-F" remains visible after its endpoint "E" exits at step 2 — ' +
        'add "exit E-F ..." at or before step 2',
    ]);
  });
  it("stays quiet about a connector that exits at or before its endpoint, and still warns about one that exits too late", () => {
    // The warning exists to catch an arrow left pointing at empty space. A
    // connector already gone by the time its endpoint leaves is not that, so
    // an author who took the advice does not keep hearing it.
    const diagnostics: Diagnostic[] = [];

    warnOnConnectorsOutlivingTheirEndpoints(
      [
        { kind: "exit", step: 5, targetId: "A", effect: "fade" },
        { kind: "exit", step: 5, targetId: "A-B", effect: "fade" },
        { kind: "exit", step: 5, targetId: "C", effect: "fade" },
        { kind: "exit", step: 2, targetId: "C-D", effect: "fade" },
        { kind: "exit", step: 5, targetId: "E", effect: "fade" },
        { kind: "exit", step: 8, targetId: "E-F", effect: "fade" },
      ],
      [
        { id: "A-B", from: "A", to: "B" },
        { id: "C-D", from: "C", to: "D" },
        { id: "E-F", from: "E", to: "F" },
      ],
      "relationship",
      diagnostics,
    );

    expect(diagnostics.map((d) => d.message)).toEqual([
      'timeline: relationship "E-F" remains visible after its endpoint "E" exits at step 5 — ' +
        'add "exit E-F ..." at or before step 5',
    ]);
  });
});
