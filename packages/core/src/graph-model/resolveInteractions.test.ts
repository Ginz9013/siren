import { describe, expect, it } from "vitest";
import type { Diagnostic, Interaction } from "../contracts";
import { resolveInteractions } from "./resolveInteractions";

/** An interaction statement with the fields a test does not care about defaulted. */
function interaction(overrides: Partial<Interaction> & Pick<Interaction, "interactionKind" | "targetId" | "action">) {
  return {
    argument: null,
    tooltip: null,
    ...overrides,
  } satisfies Interaction;
}

describe("resolveInteractions", () => {
  it("drops an interaction naming a target that does not exist", () => {
    const diagnostics: Diagnostic[] = [];

    const resolved = resolveInteractions(
      [interaction({ interactionKind: "href", targetId: "Ghost", action: "https://example.com", line: 4, column: 1 })],
      new Set(["Shape"]),
      diagnostics,
    );

    expect(resolved).toEqual([]);
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'click "Ghost" references a target that does not exist; dropping the interaction.',
        line: 4,
        column: 1,
      },
    ]);
  });

  it("drops an href with a disallowed URL scheme", () => {
    const diagnostics: Diagnostic[] = [];

    const resolved = resolveInteractions(
      [interaction({ interactionKind: "href", targetId: "Shape", action: "javascript:alert(1)", line: 2, column: 1 })],
      new Set(["Shape"]),
      diagnostics,
    );

    expect(resolved).toEqual([]);
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message:
          'click "Shape" uses the disallowed URL scheme "javascript:"; only http:, https: and mailto: are allowed; dropping the interaction.',
        line: 2,
        column: 1,
      },
    ]);
  });

  it("resolves an href with an allowed scheme", () => {
    const diagnostics: Diagnostic[] = [];

    const resolved = resolveInteractions(
      [interaction({ interactionKind: "href", targetId: "Shape", action: "https://example.com", tooltip: "docs" })],
      new Set(["Shape"]),
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(resolved).toEqual([
      { targetId: "Shape", interactionKind: "href", action: "https://example.com", argument: null, tooltip: "docs" },
    ]);
  });

  it("resolves an href with a relative URL, which carries no scheme to judge", () => {
    const diagnostics: Diagnostic[] = [];

    const resolved = resolveInteractions(
      [interaction({ interactionKind: "href", targetId: "Shape", action: "./docs/shape.html" })],
      new Set(["Shape"]),
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(resolved).toEqual([
      { targetId: "Shape", interactionKind: "href", action: "./docs/shape.html", argument: null, tooltip: null },
    ]);
  });

  it("resolves a call interaction, carrying its argument through unjudged", () => {
    const diagnostics: Diagnostic[] = [];

    const resolved = resolveInteractions(
      [interaction({ interactionKind: "call", targetId: "Shape", action: "showDetails", argument: "a" })],
      new Set(["Shape"]),
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(resolved).toEqual([
      { targetId: "Shape", interactionKind: "call", action: "showDetails", argument: "a", tooltip: null },
    ]);
  });

  it("resolves several interactions in one call, each independently", () => {
    const diagnostics: Diagnostic[] = [];

    const resolved = resolveInteractions(
      [
        interaction({ interactionKind: "call", targetId: "Shape", action: "showDetails" }),
        interaction({ interactionKind: "href", targetId: "Ghost", action: "https://example.com" }),
      ],
      new Set(["Shape"]),
      diagnostics,
    );

    expect(resolved).toEqual([
      { targetId: "Shape", interactionKind: "call", action: "showDetails", argument: null, tooltip: null },
    ]);
    expect(diagnostics).toHaveLength(1);
  });
});
