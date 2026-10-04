import { describe, expect, it, vi } from "vitest";
import { parseSequenceDiagram } from "./parseSequenceDiagram";
import type { Diagnostic, Label, SequenceDocument } from "../contracts";
import { plainLabel, plainRun } from "../label/label";

// A stand-in for `readLabel` that reports a problem wherever its source holds
// `⚠` (an error) or `⚑` (a warning): the `sequence` dialect has no tag that
// reports one, so this is how a test asks where a problem would land.
vi.mock("../label/readLabel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../label/readLabel")>();
  return {
    ...actual,
    readLabel: (...args: Parameters<typeof actual.readLabel>) => {
      const read = actual.readLabel(...args);
      const [source] = args;
      const problems = [...read.problems];
      for (const [mark, severity] of [["⚠", "error"], ["⚑", "warning"]] as const) {
        for (let at = source.indexOf(mark); at !== -1; at = source.indexOf(mark, at + 1)) {
          problems.push({ severity, message: `test problem ${mark}`, offset: at });
        }
      }
      return { ...read, problems };
    },
  };
});

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
      { id: "A", label: plainLabel("A"), participantKind: "participant", line: 2, column: 3 },
      { id: "B", label: plainLabel("Bob"), participantKind: "participant", line: 3, column: 3 },
      { id: "C", label: plainLabel("C"), participantKind: "actor", line: 4, column: 3 },
      { id: "D", label: plainLabel("Dave"), participantKind: "actor", line: 5, column: 3 },
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

  it("expands the `+` activation shorthand into the message plus an activate statement targeting the arrow's destination", () => {
    const source = `sequenceDiagram
  participant A
  participant B
  A->>+B: request
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.statements.slice(2)).toEqual([
      {
        kind: "message",
        from: "A",
        to: "B",
        label: plainLabel("request"),
        arrow: { line: "solid", head: "filled" },
        line: 4,
        column: 3,
      },
      { kind: "activate", id: "B", line: 4, column: 3 },
    ]);
  });

  it("expands the `-` activation shorthand into the message plus a deactivate statement targeting the arrow's sender, not its destination", () => {
    // Measured against real Mermaid: `-` closes the lifeline the arrow is
    // *sent from*. In `B-->>-A: response`, that is B — not A, the arrow's
    // destination — which is the detail this shorthand is easy to mis-state.
    const source = `sequenceDiagram
  participant A
  participant B
  B-->>-A: response
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.statements.slice(2)).toEqual([
      {
        kind: "message",
        from: "B",
        to: "A",
        label: plainLabel("response"),
        arrow: { line: "dotted", head: "filled" },
        line: 4,
        column: 3,
      },
      { kind: "deactivate", id: "B", line: 4, column: 3 },
    ]);
  });

  it("parses standalone `activate X` / `deactivate X` statements", () => {
    const source = `sequenceDiagram
  participant A
  activate A
  deactivate A
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.statements.slice(1)).toEqual([
      { kind: "activate", id: "A", line: 3, column: 3 },
      { kind: "deactivate", id: "A", line: 4, column: 3 },
    ]);
  });

  it("parses `note over A,B: text` into a note statement spanning both participants", () => {
    const source = `sequenceDiagram
  participant A
  participant B
  note over A,B: they agree
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.statements.slice(2)).toEqual([
      {
        kind: "note",
        placement: "over",
        from: "A",
        to: "B",
        label: plainLabel("they agree"),
        line: 4,
        column: 3,
      },
    ]);
  });

  it("parses `note over A: text` (a single participant) with from and to equal", () => {
    const source = `sequenceDiagram
  participant A
  note over A: alone
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.statements.slice(1)).toEqual([
      { kind: "note", placement: "over", from: "A", to: "A", label: plainLabel("alone"), line: 3, column: 3 },
    ]);
  });

  it("parses `note right of A: text` and `note left of A: text`, each with from and to equal", () => {
    const source = `sequenceDiagram
  participant A
  note right of A: thinking
  note left of A: pondering
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.statements.slice(1)).toEqual([
      {
        kind: "note",
        placement: "right",
        from: "A",
        to: "A",
        label: plainLabel("thinking"),
        line: 3,
        column: 3,
      },
      {
        kind: "note",
        placement: "left",
        from: "A",
        to: "A",
        label: plainLabel("pondering"),
        line: 4,
        column: 3,
      },
    ]);
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

  it("parses a message naming an undeclared participant id as a plain message — creating the participant is buildSequenceModel's job", () => {
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

  it("parses accTitle into the document's accTitle field, distinct from title", () => {
    const source = `sequenceDiagram
  title Order confirmation flow
  accTitle: A short accessible title
  participant A
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.title).toBe("Order confirmation flow");
    expect(document.accTitle).toBe("A short accessible title");
  });

  it("leaves accTitle null when the document declares none", () => {
    const source = `sequenceDiagram
  participant A
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.accTitle).toBeNull();
  });

  it("parses link into an href interaction, its label carried as the tooltip", () => {
    const source = `sequenceDiagram
  participant A
  link A: Dashboard @ https://example.com
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.interactions).toEqual([
      {
        interactionKind: "href",
        targetId: "A",
        action: "https://example.com",
        argument: null,
        tooltip: "Dashboard",
        line: 3,
        column: 3,
      },
    ]);
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

  it("parses a standalone loop block, wrapping its messages into the body", () => {
    const source = `sequenceDiagram
  participant A
  participant B
  loop Every minute
    A->>B: poll
  end
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.statements.map((s) => s.kind)).toEqual(["participant", "participant", "loop"]);
    const loopStatement = document.statements.find((s) => s.kind === "loop");
    expect(loopStatement!.kind === "loop" && loopStatement!.label).toEqual(plainLabel("Every minute"));
    expect(loopStatement!.kind === "loop" && loopStatement!.body.map((s) => s.kind)).toEqual([
      "message",
    ]);
    expect(
      loopStatement!.kind === "loop" &&
        loopStatement!.body[0].kind === "message" &&
        loopStatement!.body[0].label.text,
    ).toBe("poll");
  });

  it("parses standalone opt, break, and rect blocks, each wrapping their messages into the body", () => {
    const source = `sequenceDiagram
  participant A
  participant B
  opt is available
    A->>B: opt-message
  end
  break connection lost
    A->>B: break-message
  end
  rect rgb(191, 223, 255)
    A->>B: rect-message
  end
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.statements.map((s) => s.kind)).toEqual([
      "participant",
      "participant",
      "opt",
      "break",
      "rect",
    ]);

    const optStatement = document.statements.find((s) => s.kind === "opt");
    expect(optStatement!.kind === "opt" && optStatement!.label).toEqual(plainLabel("is available"));
    expect(optStatement!.kind === "opt" && optStatement!.body.map((s) => s.kind)).toEqual([
      "message",
    ]);

    const breakStatement = document.statements.find((s) => s.kind === "break");
    expect(breakStatement!.kind === "break" && breakStatement!.label).toEqual(plainLabel("connection lost"));
    expect(breakStatement!.kind === "break" && breakStatement!.body.map((s) => s.kind)).toEqual([
      "message",
    ]);

    const rectStatement = document.statements.find((s) => s.kind === "rect");
    expect(rectStatement!.kind === "rect" && rectStatement!.color).toBe("rgb(191, 223, 255)");
    expect(rectStatement!.kind === "rect" && rectStatement!.body.map((s) => s.kind)).toEqual([
      "message",
    ]);
  });

  it("parses a rect block with an rgba(...) color, carrying the raw color string through unvalidated", () => {
    const source = `sequenceDiagram
  participant A
  participant B
  rect rgba(0,255,0,0.1)
    A->>B: hi
  end
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    const rectStatement = document.statements.find((s) => s.kind === "rect");
    expect(rectStatement!.kind === "rect" && rectStatement!.color).toBe("rgba(0,255,0,0.1)");
  });

  it("parses alt/else into one alt node with two branches, each carrying its condition label and body", () => {
    const source = `sequenceDiagram
  participant A
  participant B
  alt is sick
    A->>B: sick message
  else is well
    A->>B: well message
  end
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    const altStatement = document.statements.find((s) => s.kind === "alt");
    expect(altStatement).toBeDefined();
    expect(altStatement!.kind === "alt" && altStatement!.branches).toEqual([
      {
        label: plainLabel("is sick"),
        body: [
          {
            kind: "message",
            from: "A",
            to: "B",
            label: plainLabel("sick message"),
            arrow: { line: "solid", head: "filled" },
            line: 5,
            column: 5,
          },
        ],
      },
      {
        label: plainLabel("is well"),
        body: [
          {
            kind: "message",
            from: "A",
            to: "B",
            label: plainLabel("well message"),
            arrow: { line: "solid", head: "filled" },
            line: 7,
            column: 5,
          },
        ],
      },
    ]);
  });

  it("parses par/and (two `and` branches) into one par node with three branches", () => {
    const source = `sequenceDiagram
  participant A
  participant B
  participant C
  par send to B
    A->>B: first
  and send to C
    A->>C: second
  and send again
    A->>B: third
  end
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    const parStatement = document.statements.find((s) => s.kind === "par");
    expect(parStatement).toBeDefined();
    expect(
      parStatement!.kind === "par" && parStatement!.branches.map((b) => b.label?.text ?? null),
    ).toEqual(["send to B", "send to C", "send again"]);
    expect(
      parStatement!.kind === "par" && parStatement!.branches.map((b) => b.body.length),
    ).toEqual([1, 1, 1]);
  });

  it("parses critical/option (two `option` branches) into one critical node with three branches", () => {
    const source = `sequenceDiagram
  participant A
  participant B
  critical establish connection
    A->>B: connect
  option networkFailure
    A->>B: fail1
  option timeout
    A->>B: fail2
  end
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    const criticalStatement = document.statements.find((s) => s.kind === "critical");
    expect(criticalStatement).toBeDefined();
    expect(
      criticalStatement!.kind === "critical" &&
        criticalStatement!.branches.map((b) => b.label?.text ?? null),
    ).toEqual(["establish connection", "networkFailure", "timeout"]);
    expect(
      criticalStatement!.kind === "critical" &&
        criticalStatement!.branches.map((b) => b.body.length),
    ).toEqual([1, 1, 1]);
  });

  it("parses a loop containing an alt containing a par, three levels deep", () => {
    const source = `sequenceDiagram
  participant A
  participant B
  loop outer
    alt condition
      par branch
        A->>B: deepest
      end
    end
  end
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    const loopStatement = document.statements.find((s) => s.kind === "loop");
    if (loopStatement === undefined || loopStatement.kind !== "loop") {
      throw new Error("expected a loop statement");
    }
    expect(loopStatement.label).toEqual(plainLabel("outer"));

    const altStatement = loopStatement.body.find((s) => s.kind === "alt");
    if (altStatement === undefined || altStatement.kind !== "alt") {
      throw new Error("expected an alt statement nested in the loop");
    }
    expect(altStatement.branches.map((b) => b.label?.text ?? null)).toEqual(["condition"]);

    const parStatement = altStatement.branches[0].body.find((s) => s.kind === "par");
    if (parStatement === undefined || parStatement.kind !== "par") {
      throw new Error("expected a par statement nested in the alt branch");
    }
    expect(parStatement.branches.map((b) => b.label?.text ?? null)).toEqual(["branch"]);
    expect(
      parStatement.branches[0].body.map((s) => (s.kind === "message" ? s.label.text : null)),
    ).toEqual(["deepest"]);
  });

  it("returns a null document plus an error diagnostic for a block missing its end, without throwing", () => {
    const source = `sequenceDiagram
  participant A
  participant B
  loop forever
    A->>B: hi
`;

    expect(() => parseSequenceDiagram(source)).not.toThrow();

    const { document, diagnostics } = parseSequenceDiagram(source);

    expect(document).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("interleaves blocks with plain messages and participant declarations at the same nesting level", () => {
    const source = `sequenceDiagram
  participant A
  participant B
  A->>B: before
  loop repeat
    A->>B: inside
  end
  participant C
  A->>C: after
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.statements.map((s) => s.kind)).toEqual([
      "participant",
      "participant",
      "message",
      "loop",
      "participant",
      "message",
    ]);
    expect(document.participants.map((p) => p.id)).toEqual(["A", "B", "C"]);
  });

  it("parses `create participant`/`create actor`, with and without aliasing, as origin-created participants at their position in the stream", () => {
    const source = `sequenceDiagram
  participant A
  A->>Carl: hi
  create participant Carl
  create actor D as Donald
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.statements).toEqual([
      {
        kind: "participant",
        id: "A",
        label: plainLabel("A"),
        participantKind: "participant",
        origin: "declared",
        line: 2,
        column: 3,
      },
      {
        kind: "message",
        from: "A",
        to: "Carl",
        label: plainLabel("hi"),
        arrow: { line: "solid", head: "filled" },
        line: 3,
        column: 3,
      },
      {
        kind: "participant",
        id: "Carl",
        label: plainLabel("Carl"),
        participantKind: "participant",
        origin: "created",
        line: 4,
        column: 3,
      },
      {
        kind: "participant",
        id: "D",
        label: plainLabel("Donald"),
        participantKind: "actor",
        origin: "created",
        line: 5,
        column: 3,
      },
    ]);
    expect(document.participants).toEqual([
      { id: "A", label: plainLabel("A"), participantKind: "participant", line: 2, column: 3 },
      { id: "Carl", label: plainLabel("Carl"), participantKind: "participant", line: 4, column: 3 },
      { id: "D", label: plainLabel("Donald"), participantKind: "actor", line: 5, column: 3 },
    ]);
  });

  it("parses `destroy X` into a destroy statement, without rejecting an id that was never declared", () => {
    const source = `sequenceDiagram
  participant A
  create participant Carl
  A->>Carl: hi
  destroy Carl
  destroy NeverDeclared
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.statements.filter((s) => s.kind === "destroy")).toEqual([
      { kind: "destroy", id: "Carl", line: 5, column: 3 },
      { kind: "destroy", id: "NeverDeclared", line: 6, column: 3 },
    ]);
  });

  it("reports a malformed `destroy` line as an error diagnostic instead of a statement", () => {
    const source = `sequenceDiagram
  participant A
  destroy
`;

    const { document, diagnostics } = parseSequenceDiagram(source);

    expect(document).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error" && d.line === 3)).toBe(true);
  });

  it("parses `box <color> <label> ... end` into one box referencing its members, whose declarations stay in the statement stream", () => {
    const source = `sequenceDiagram
  box Purple Alice,Bob
    participant Alice
    actor Bob as Bobby
  end
  participant Carl
  Alice->>Bob: hi
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.boxes).toEqual([
      {
        color: "Purple",
        label: plainLabel("Alice,Bob"),
        participantIds: ["Alice", "Bob"],
        line: 2,
        column: 3,
      },
    ]);
    expect(document.participants).toEqual([
      { id: "Alice", label: plainLabel("Alice"), participantKind: "participant", line: 3, column: 5 },
      { id: "Bob", label: plainLabel("Bobby"), participantKind: "actor", line: 4, column: 5 },
      { id: "Carl", label: plainLabel("Carl"), participantKind: "participant", line: 6, column: 3 },
    ]);
    expect(document.statements.map((s) => (s.kind === "participant" ? s.id : s.kind))).toEqual([
      "Alice",
      "Bob",
      "Carl",
      "message",
    ]);
  });

  it("reads a box header's first token as its color only when that token is color-shaped", () => {
    const source = `sequenceDiagram
  box transparent
    participant A
  end
  box rgb(255, 0, 0) Reds
    participant B
  end
  box My Service
    participant C
  end
  box
    participant D
  end
  A->>B: hi
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.boxes.map((b) => ({ color: b.color, label: b.label }))).toEqual([
      { color: "transparent", label: null },
      { color: "rgb(255, 0, 0)", label: plainLabel("Reds") },
      { color: null, label: plainLabel("My Service") },
      { color: null, label: null },
    ]);
    expect(document.boxes.map((b) => b.participantIds)).toEqual([["A"], ["B"], ["C"], ["D"]]);
  });

  it("returns a null document plus an error diagnostic for a box missing its end", () => {
    const source = `sequenceDiagram
  box Purple Group
    participant A
`;

    const { document, diagnostics } = parseSequenceDiagram(source);

    expect(document).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error" && d.line === 2)).toBe(true);
  });

  it("interleaves create/destroy with messages and nested control-flow blocks, including inside a block body", () => {
    const source = `sequenceDiagram
  box Purple Team
    participant A
    participant B
  end
  A->>B: start
  loop retry
    create participant Worker
    A->>Worker: spawn
    alt failed
      destroy Worker
    else ok
      Worker-->>A: done
    end
  end
  destroy B
`;

    const { document, diagnostics } = parseOk(source);

    expect(diagnostics).toEqual([]);
    expect(document.boxes.map((b) => b.participantIds)).toEqual([["A", "B"]]);
    expect(document.participants.map((p) => p.id)).toEqual(["A", "B", "Worker"]);
    expect(document.statements.map((s) => s.kind)).toEqual([
      "participant",
      "participant",
      "message",
      "loop",
      "destroy",
    ]);

    const loopStatement = document.statements.find((s) => s.kind === "loop");
    if (loopStatement === undefined || loopStatement.kind !== "loop") {
      throw new Error("expected a loop statement");
    }
    expect(loopStatement.body.map((s) => s.kind)).toEqual(["participant", "message", "alt"]);
    expect(loopStatement.body[0]).toEqual({
      kind: "participant",
      id: "Worker",
      label: plainLabel("Worker"),
      participantKind: "participant",
      origin: "created",
      line: 8,
      column: 5,
    });

    const altStatement = loopStatement.body.find((s) => s.kind === "alt");
    if (altStatement === undefined || altStatement.kind !== "alt") {
      throw new Error("expected an alt statement nested in the loop");
    }
    expect(altStatement.branches[0].body).toEqual([
      { kind: "destroy", id: "Worker", line: 11, column: 7 },
    ]);
  });

  it("reports a non-declaration statement inside a box body as an error", () => {
    const source = `sequenceDiagram
  box Purple Group
    participant A
    A->>A: not allowed here
  end
`;

    const { document, diagnostics } = parseSequenceDiagram(source);

    expect(document).toBeNull();
    expect(diagnostics.some((d) => d.severity === "error" && d.line === 2)).toBe(true);
  });

  it("parses a top-level `timeline:` block through the shared timeline grammar, ending the diagram body there", () => {
    const source = `sequenceDiagram
  participant A
  participant B
  A->>B: hi
timeline:
  enter A fade
  highlight B glow
`;

    const { document, diagnostics } = parseSequenceDiagram(source);

    expect(diagnostics).toEqual([]);
    const sequenceDocument = document as SequenceDocument | null;
    expect(sequenceDocument?.timeline).toEqual({
      entries: [
        { kind: "enter", step: 1, targetId: "A", effect: "fade", line: 6, column: 3 },
        { kind: "highlight", step: 2, targetId: "B", effect: "glow", line: 7, column: 3 },
      ],
    });
    // The block ends the body: nothing after `timeline:` became a statement.
    expect(sequenceDocument?.statements.map((s) => s.kind)).toEqual([
      "participant",
      "participant",
      "message",
    ]);
  });

  it("leaves timeline null for a document that declares no timeline block", () => {
    const source = `sequenceDiagram
  participant A
  A->>A: hi
`;

    const { document } = parseOk(source);

    expect(document.timeline).toBeNull();
  });
  // All three of the ticket's named body kinds, not just `loop`: the rule is
  // that `TIMELINE_TERMINATOR` reaches only the top-level `parseBody` call, and
  // a body that opens its own terminator set must not inherit it. `alt` also
  // covers the branch case (`else` opens a fresh body of the same block).
  it.each([
    {
      body: "loop",
      source: `sequenceDiagram
  participant A
  loop retry
    timeline:
    A->>A: hi
  end
`,
      line: 4,
      column: 5,
    },
    {
      body: "alt (second branch)",
      source: `sequenceDiagram
  participant A
  alt ok
    A->>A: hi
  else fallback
    timeline:
  end
`,
      line: 6,
      column: 5,
    },
    {
      body: "box",
      source: `sequenceDiagram
  box Blue Team
    participant A
    timeline:
  end
  A->>A: hi
`,
      line: 4,
      column: 5,
    },
  ])(
    "still reports `timeline:` inside a $body body as an unrecognized sequenceDiagram line",
    ({ source, line, column }) => {
      const { document, diagnostics } = parseSequenceDiagram(source);

      expect(document).toBeNull();
      expect(diagnostics).toContainEqual({
        severity: "error",
        message: 'Unrecognized sequenceDiagram line: "timeline:"',
        line,
        column,
      });
    },
  );

  it("reports a malformed timeline line with the shared timeline grammar's own diagnostics", () => {
    const source = `sequenceDiagram
  participant A
  A->>A: hi
timeline:
  wiggle A fade
  enter A
  unhighlight A glow
`;

    const { document, diagnostics } = parseSequenceDiagram(source);

    expect(document).toBeNull();
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Unrecognized timeline verb "wiggle" (expected "enter", "exit", "highlight", or "unhighlight")',
      'Unknown enter effect "" (expected one of: fade, slide-left, slide-right, slide-top, slide-bottom)',
      '"unhighlight" takes no effect, found trailing "glow" in "unhighlight A glow"',
    ]);
  });

});

describe("the header a sequence diagram rejects", () => {
  // Characterization: one accepted spelling, so the list has no conjunction
  // in it at all. Pinned because the assembly is shared with the kinds that
  // have two and eight.
  it("names its one spelling", () => {
    const { document, diagnostics } = parseSequenceDiagram("sequence\n  A->>B: hi\n");

    expect(document).toBeNull();
    expect(diagnostics[0].message).toBe('Expected "sequenceDiagram", found "sequence"');
  });
});

describe("the labels a sequence diagram reads", () => {
  /** A label of plain rows, one plain run each — what `<br>` between words reads as. */
  const rowsLabel = (...rows: string[]): Label => ({
    text: rows.join("\n"),
    rows: rows.map((row) => [plainRun(row)]),
  });

  it("reads a participant's alias as a label, so <br/> breaks it into rows", () => {
    const { document } = parseOk("sequenceDiagram\n  participant A as Web<br/>Client\n");

    expect(document.participants.map((p) => p.label)).toEqual([rowsLabel("Web", "Client")]);
  });

  it("reads a message's and a note's text as a label, so <br/> breaks each into rows", () => {
    const { document } = parseOk(
      "sequenceDiagram\n  A->>B: first<br/>second\n  A->>+B: x<br>y\n  Note over A: a<br/>b\n",
    );

    const labels = document.statements.flatMap((s) =>
      s.kind === "message" || s.kind === "note" ? [s.label] : [],
    );
    expect(labels).toEqual([
      rowsLabel("first", "second"),
      rowsLabel("x", "y"),
      rowsLabel("a", "b"),
    ]);
  });

  it("reads a block's condition, each branch's and a box's label as labels, so <br/> breaks them into rows", () => {
    // Measured (mermaid 11.17.2, `--paint`): `loop every<br/>day` draws
    // "[every" over "day]", `alt c1<br/>c2` / `else e1<br/>e2` draw two rows
    // each, and `box Grp<br/>two` draws "Grp" over "two".
    const { document } = parseOk(`sequenceDiagram
  box Aqua Grp<br/>two
    participant A
  end
  loop every<br/>day
    A->>A: hi
  end
  alt c1<br/>c2
    A->>A: z
  else e1<br/>e2
    A->>A: w
  end
`);

    expect(document.boxes.map((b) => b.label)).toEqual([rowsLabel("Grp", "two")]);
    const [, loop, alt] = document.statements;
    expect(loop!.kind === "loop" && loop!.label).toEqual(rowsLabel("every", "day"));
    expect(alt!.kind === "alt" && alt!.branches.map((b) => b.label)).toEqual([
      rowsLabel("c1", "c2"),
      rowsLabel("e1", "e2"),
    ]);
  });

  it("reports a label's problem at the column the author wrote it, wherever the label is", () => {
    // `⚑` is the stand-in's warning (see the `vi.mock` above). Columns are
    // 1-based, and every label below puts its `⚑` at a known column.
    const placed = (body: string) =>
      parseSequenceDiagram(`sequenceDiagram\n${body}`).diagnostics.map(({ severity, line, column }) => [
        severity,
        line,
        column,
      ]);

    // `  participant A as W⚑` — the 21st character.
    expect(placed("  participant A as W⚑\n")).toEqual([["warning", 2, 21]]);
    // `  create actor C as  W⚑`, the alias past the `create` keyword: the 23rd.
    expect(placed("  A->>B: x\n  create actor C as  W⚑\n")).toEqual([["warning", 3, 23]]);
    // `  A->>B:  m⚑` and `  A->>+B: m⚑`: the 12th, twice.
    expect(placed("  A->>B:  m⚑\n")).toEqual([["warning", 2, 12]]);
    expect(placed("  A->>+B: m⚑\n")).toEqual([["warning", 2, 12]]);
    // `  Note over A: n⚑`: the 17th.
    expect(placed("  Note over A: n⚑\n")).toEqual([["warning", 2, 17]]);
    // `  loop   l⚑` (a run of spaces after the keyword) and `  else e⚑`.
    expect(placed("  loop   l⚑\n    A->>B: x\n  end\n")).toEqual([["warning", 2, 11]]);
    expect(placed("  alt a\n    A->>B: x\n  else e⚑\n    A->>B: y\n  end\n")).toEqual([
      ["warning", 4, 9],
    ]);
    // A box's label, after a color and without one: `  box Aqua  b⚑`, `  box b⚑`.
    expect(placed("  box Aqua  b⚑\n    participant A\n  end\n")).toEqual([["warning", 2, 14]]);
    expect(placed("  box b⚑\n    participant A\n  end\n")).toEqual([["warning", 2, 8]]);
  });

  it("refuses the document when a label holds an error, and says where", () => {
    // `⚠` is the stand-in's error: a label Siren cannot draw as written is
    // not drawn some other way, so the whole document goes.
    const result = parseSequenceDiagram("sequenceDiagram\n  A->>B: m⚠\n");

    expect(result.document).toBeNull();
    expect(result.diagnostics.map((d) => [d.severity, d.line, d.column])).toEqual([["error", 2, 11]]);
  });

  it("draws every tag but <br> as written, as Mermaid draws sequence text", () => {
    // Measured (mermaid 11.17.2, `--paint`): `A->>B: <b>bold</b> msg` draws
    // the one `<text>` "<b>bold</b> msg" — sequence text is SVG in both modes.
    const { document } = parseOk("sequenceDiagram\n  A->>B: <b>bold</b> msg\n");

    const [message] = document.statements;
    expect(message!.kind === "message" && message!.label).toEqual(rowsLabel("<b>bold</b> msg"));
  });
});

/**
 * Mermaid's style-line rule (its `encodeEntities`): before it parses, it
 * drops the last `;` of every line where `style` (or `classDef`), a `:` and
 * then a `#` come before it — the whole line, a participant's name
 * included, not only the text. Sequence text is drawn as SVG, so these were
 * measured as the message Mermaid 11.17.2 recorded.
 */
describe("parseSequenceDiagram — the `;` Mermaid drops from a style line", () => {
  const labelText = (source: string) => {
    const [statement] = parseOk(`sequenceDiagram\n${source}`).document.statements;
    return statement!.kind === "message" || statement!.kind === "note" ? statement!.label.text : null;
  };

  it("drops the line's last `;` when `style` is in a participant's name", () => {
    // `styles->>B:#35; a;b` records `ﬂ°°35¶ß ab`: drawn `# ab`.
    expect(labelText("  styles->>B:#35; a;b")).toBe("# ab");
  });

  it("drops the line's last `;` from a note", () => {
    // `Note over A: style x:#35; a;b` records `style x:ﬂ°°35¶ß ab`.
    expect(labelText("  Note over A: style x:#35; a;b")).toBe("style x:# ab");
  });

  it("leaves a position past it where the author wrote it", () => {
    // `  A->>B: style x:#35;⚑`: the ⚑ is the 22nd character.
    expect(
      parseSequenceDiagram("sequenceDiagram\n  A->>B: style x:#35;⚑").diagnostics.map(
        ({ severity, line, column }) => [severity, line, column],
      ),
    ).toEqual([["warning", 2, 22]]);
  });
});
