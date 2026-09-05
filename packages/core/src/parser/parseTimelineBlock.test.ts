import { describe, expect, it } from "vitest";
import { parseTimelineBody, parseTimelineBodyLine } from "./parseTimelineBlock";

describe("parseTimelineBodyLine", () => {
  it("numbers an entry by the line it was given and by the column its indentation implies", () => {
    const { entries, diagnostics } = parseTimelineBodyLine(
      "    step 1: enter Duck fade",
      7,
    );

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
    expect(parseTimelineBodyLine("", 3)).toEqual({
      entries: [],
      diagnostics: [],
    });
    expect(parseTimelineBodyLine("   \t ", 4)).toEqual({
      entries: [],
      diagnostics: [],
    });
  });
});

describe("parseTimelineBody", () => {
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
