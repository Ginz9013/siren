import { describe, expect, it } from "vitest";
import { parseTimelineBody } from "./parseTimelineBlock";

describe("parseTimelineBody", () => {
  it("derives an entry's column from the indentation of the line it was written on", () => {
    const lines = [
      "flowchart TD",
      "  A[Start]",
      "  B[Stop]",
      "  A --> B",
      "",
      "timeline:",
      "    enter Duck fade",
    ];

    const { entries, diagnostics } = parseTimelineBody(lines, 6);

    expect(diagnostics).toEqual([]);
    expect(entries).toEqual([
      {
        kind: "enter",
        step: 1,
        targetId: "Duck",
        effect: "fade",
        line: 7,
        column: 5,
      },
    ]);
  });

  it("contributes neither an entry nor a diagnostic for a blank line", () => {
    const lines = ["timeline:", "", "  enter A fade", "   \t "];

    expect(parseTimelineBody(lines, 1)).toEqual({
      entries: [
        {
          kind: "enter",
          step: 1,
          targetId: "A",
          effect: "fade",
          line: 3,
          column: 3,
        },
      ],
      diagnostics: [],
    });
  });

  it("drains every line from startIndex to the end, numbered by its place in the document", () => {
    const lines = [
      "flowchart TD",
      "  A[Start]",
      "timeline:",
      "  enter A fade",
      "",
      "    exit A slide-top",
    ];

    const { entries, diagnostics } = parseTimelineBody(lines, 3);

    expect(diagnostics).toEqual([]);
    expect(entries).toEqual([
      {
        kind: "enter",
        step: 1,
        targetId: "A",
        effect: "fade",
        line: 4,
        column: 3,
      },
      {
        kind: "exit",
        step: 2,
        targetId: "A",
        effect: "slide-top",
        line: 6,
        column: 5,
      },
    ]);
  });

  it("numbers each non-blank line as the next step, in the order written, with a blank line taking no number", () => {
    const lines = [
      "timeline:",
      "  enter A fade, enter B fade",
      "",
      "",
      "  highlight A outline",
      "  unhighlight A, exit B fade",
    ];

    const { entries, diagnostics } = parseTimelineBody(lines, 1);

    expect(diagnostics).toEqual([]);
    expect(entries.map((entry) => `${entry.step} ${entry.kind} ${entry.targetId}`)).toEqual([
      "1 enter A",
      "1 enter B",
      "2 highlight A",
      "3 unhighlight A",
      "3 exit B",
    ]);
  });

  it("keeps the entries around a bad line, reports one error per bad line, and still counts a bad line as a step", () => {
    const lines = [
      "timeline:",
      "  enter A fade",
      "  nonsense",
      "  exit A slide-top",
      "  enter B wobble",
      "  highlight B glow",
    ];

    const { entries, diagnostics } = parseTimelineBody(lines, 1);

    // `nonsense` is step 2 and `enter B wobble` is step 4 even though neither
    // produced an entry: a line's step is its place in the block, so fixing a
    // typo never renumbers the lines after it.
    expect(entries.map((entry) => `${entry.step} ${entry.kind} ${entry.targetId}`)).toEqual([
      "1 enter A",
      "3 exit A",
      "5 highlight B",
    ]);
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'Unrecognized timeline action: "nonsense"',
        line: 3,
        column: 3,
      },
      {
        severity: "error",
        message:
          'Unknown enter effect "wobble" (expected one of: fade, slide-left, slide-right, slide-top, slide-bottom)',
        line: 5,
        column: 3,
      },
    ]);
  });

  it("rejects the retired `step N:` prefix rather than reading a step number from it", () => {
    const lines = ["timeline:", "  step 1: enter A fade", "  step 2: A"];

    const { entries, diagnostics } = parseTimelineBody(lines, 1);

    expect(entries).toEqual([]);
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'Unrecognized timeline action: "step 1: enter A fade"',
        line: 2,
        column: 3,
      },
      {
        severity: "error",
        message:
          'Unrecognized timeline verb "step" (expected "enter", "exit", "highlight", or "unhighlight")',
        line: 3,
        column: 3,
      },
    ]);
  });
});
