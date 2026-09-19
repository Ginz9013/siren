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
        text: "request",
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
        text: "response",
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
        text: "they agree",
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
      { kind: "note", placement: "over", from: "A", to: "A", text: "alone", line: 3, column: 3 },
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
        text: "thinking",
        line: 3,
        column: 3,
      },
      {
        kind: "note",
        placement: "left",
        from: "A",
        to: "A",
        text: "pondering",
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
    expect(loopStatement!.kind === "loop" && loopStatement!.label).toBe("Every minute");
    expect(loopStatement!.kind === "loop" && loopStatement!.body.map((s) => s.kind)).toEqual([
      "message",
    ]);
    expect(
      loopStatement!.kind === "loop" &&
        loopStatement!.body[0].kind === "message" &&
        loopStatement!.body[0].text,
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
    expect(optStatement!.kind === "opt" && optStatement!.label).toBe("is available");
    expect(optStatement!.kind === "opt" && optStatement!.body.map((s) => s.kind)).toEqual([
      "message",
    ]);

    const breakStatement = document.statements.find((s) => s.kind === "break");
    expect(breakStatement!.kind === "break" && breakStatement!.label).toBe("connection lost");
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
        label: "is sick",
        body: [
          {
            kind: "message",
            from: "A",
            to: "B",
            text: "sick message",
            arrow: { line: "solid", head: "filled" },
            line: 5,
            column: 5,
          },
        ],
      },
      {
        label: "is well",
        body: [
          {
            kind: "message",
            from: "A",
            to: "B",
            text: "well message",
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
      parStatement!.kind === "par" && parStatement!.branches.map((b) => b.label),
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
        criticalStatement!.branches.map((b) => b.label),
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
    expect(loopStatement.label).toBe("outer");

    const altStatement = loopStatement.body.find((s) => s.kind === "alt");
    if (altStatement === undefined || altStatement.kind !== "alt") {
      throw new Error("expected an alt statement nested in the loop");
    }
    expect(altStatement.branches.map((b) => b.label)).toEqual(["condition"]);

    const parStatement = altStatement.branches[0].body.find((s) => s.kind === "par");
    if (parStatement === undefined || parStatement.kind !== "par") {
      throw new Error("expected a par statement nested in the alt branch");
    }
    expect(parStatement.branches.map((b) => b.label)).toEqual(["branch"]);
    expect(
      parStatement.branches[0].body.map((s) => (s.kind === "message" ? s.text : null)),
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
        label: "A",
        participantKind: "participant",
        origin: "declared",
        line: 2,
        column: 3,
      },
      {
        kind: "message",
        from: "A",
        to: "Carl",
        text: "hi",
        arrow: { line: "solid", head: "filled" },
        line: 3,
        column: 3,
      },
      {
        kind: "participant",
        id: "Carl",
        label: "Carl",
        participantKind: "participant",
        origin: "created",
        line: 4,
        column: 3,
      },
      {
        kind: "participant",
        id: "D",
        label: "Donald",
        participantKind: "actor",
        origin: "created",
        line: 5,
        column: 3,
      },
    ]);
    expect(document.participants).toEqual([
      { id: "A", label: "A", participantKind: "participant", line: 2, column: 3 },
      { id: "Carl", label: "Carl", participantKind: "participant", line: 4, column: 3 },
      { id: "D", label: "Donald", participantKind: "actor", line: 5, column: 3 },
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
        label: "Alice,Bob",
        participantIds: ["Alice", "Bob"],
        line: 2,
        column: 3,
      },
    ]);
    expect(document.participants).toEqual([
      { id: "Alice", label: "Alice", participantKind: "participant", line: 3, column: 5 },
      { id: "Bob", label: "Bobby", participantKind: "actor", line: 4, column: 5 },
      { id: "Carl", label: "Carl", participantKind: "participant", line: 6, column: 3 },
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
      { color: "rgb(255, 0, 0)", label: "Reds" },
      { color: null, label: "My Service" },
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
      label: "Worker",
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
  step 1: enter A fade
  step 2: highlight B glow
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
  step 1: wiggle A fade
  step 2: enter A
  step 3: unhighlight A glow
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
