import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../contracts";
import { resolveTimeline } from "./resolveTimeline";

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
