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
      "    step 1: enter Duck fade",
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
    const lines = ["timeline:", "", "  step 1: enter A fade", "   \t "];

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
      "  step 1: enter A fade",
      "",
      "    step 2: exit A slide-top",
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

  it("keeps the entries around a bad line, and reports one error per bad line", () => {
    const lines = [
      "timeline:",
      "  step 1: enter A fade",
      "  nonsense",
      "  step 2: exit A slide-top",
      "  step 3: enter B wobble",
    ];

    const { entries, diagnostics } = parseTimelineBody(lines, 1);

    expect(entries.map((entry) => `${entry.kind} ${entry.targetId}`)).toEqual([
      "enter A",
      "exit A",
    ]);
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'Unrecognized timeline line: "nonsense"',
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
});
