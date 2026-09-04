import { describe, expect, it } from "vitest";
import { parseSequenceDiagram } from "./parseSequenceDiagram";
import type { Diagnostic, SequenceDocument } from "../contracts";

/**
 * Asserts a `parseSequenceDiagram` call succeeded and narrows its document
 * to `SequenceDocument`, so the rest of a test can access sequence-only
 * fields without fighting `SirenDocument`'s discriminated union.
 */
function parseOk(source: string): { document: SequenceDocument; diagnostics: Diagnostic[] } {
  const { document, diagnostics } = parseSequenceDiagram(source);
  if (document === null || document.kind !== "sequence") {
    throw new Error(
      `expected a sequence document, got ${document === null ? "null" : document.kind}`,
    );
  }
  return { document, diagnostics };
}

describe("parseSequenceDiagram", () => {
  it("parses a minimal sequenceDiagram with two declared participants and no statements as an error (unterminated, no body)", () => {
    const source = `sequenceDiagram
`;

    const { document, diagnostics } = parseSequenceDiagram(source);

    expect(document).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("parses participant/actor declarations, with and without `as` aliasing, into the flat participants list", () => {
    const source = `sequenceDiagram
  participant A
  participant B as Bob
  actor C
  actor D as Dave
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.participants).toEqual([
      { id: "A", label: "A", participantKind: "participant", line: 2, column: 3 },
      { id: "B", label: "Bob", participantKind: "participant", line: 3, column: 3 },
      { id: "C", label: "C", participantKind: "actor", line: 4, column: 3 },
      { id: "D", label: "Dave", participantKind: "actor", line: 5, column: 3 },
    ]);
  });

  it("parses all ten Mermaid message arrow forms into the correct { line, head } pair", () => {
    const source = `sequenceDiagram
  participant A
  participant B
  A->B: solid none
  A-->B: dotted none
  A->>B: solid filled
  A-->>B: dotted filled
  A<<->>B: solid bidirectionalFilled
  A<<-->>B: dotted bidirectionalFilled
  A-xB: solid cross
  A--xB: dotted cross
  A-)B: solid open
  A--)B: dotted open
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    const messages = document.statements.filter((s) => s.kind === "message");
    expect(messages).toHaveLength(10);
    expect(messages.map((m) => (m.kind === "message" ? m.arrow : null))).toEqual([
      { line: "solid", head: "none" },
      { line: "dotted", head: "none" },
      { line: "solid", head: "filled" },
      { line: "dotted", head: "filled" },
      { line: "solid", head: "bidirectionalFilled" },
      { line: "dotted", head: "bidirectionalFilled" },
      { line: "solid", head: "cross" },
      { line: "dotted", head: "cross" },
      { line: "solid", head: "open" },
      { line: "dotted", head: "open" },
    ]);
    expect(messages.every((m) => m.kind === "message" && m.from === "A" && m.to === "B")).toBe(
      true,
    );
  });

  it("parses a self-message (undeclared-but-self target) as a message between the same participant id", () => {
    const source = `sequenceDiagram
  participant A
  A->>A: self
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    const message = document.statements.find((s) => s.kind === "message");
    expect(message).toBeDefined();
    expect(message!.kind === "message" && message!.from).toBe("A");
    expect(message!.kind === "message" && message!.to).toBe("A");
  });

  it("does not reject a message referencing an undeclared participant id — that's buildSequenceModel's job", () => {
    const source = `sequenceDiagram
  A->>B: no prior declaration of A or B
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.participants).toEqual([]);
    const message = document.statements.find((s) => s.kind === "message");
    expect(message!.kind === "message" && message!.from).toBe("A");
    expect(message!.kind === "message" && message!.to).toBe("B");
  });

  it("parses autonumber and autonumber off into their own statement kinds, at whatever position they appear", () => {
    const source = `sequenceDiagram
  participant A
  participant B
  autonumber
  A->>B: first
  autonumber off
  A->>B: second
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.statements.map((s) => s.kind)).toEqual([
      "participant",
      "participant",
      "autonumberOn",
      "message",
      "autonumberOff",
      "message",
    ]);
  });

  it("parses title into the document's title field", () => {
    const source = `sequenceDiagram
  title Order confirmation flow
  participant A
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.title).toBe("Order confirmation flow");
  });

  it("returns a null document plus an error diagnostic for an unrecognized statement line, without throwing", () => {
    const source = `sequenceDiagram
  participant A
  this is not a valid statement
`;

    expect(() => parseSequenceDiagram(source)).not.toThrow();

    const { document, diagnostics } = parseSequenceDiagram(source);

    expect(document).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});
