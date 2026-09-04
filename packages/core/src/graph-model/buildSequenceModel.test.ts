import { describe, expect, it } from "vitest";
import type { SequenceDocument } from "../contracts";
import { buildSequenceModel } from "./buildSequenceModel";

describe("buildSequenceModel", () => {
  it("assigns message ids of the form fromId-toId, suffixing a second message between the same pair with #2", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "B", participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: "B", participantKind: "participant", origin: "declared" },
        {
          kind: "message",
          from: "A",
          to: "B",
          text: "first",
          arrow: { line: "solid", head: "filled" },
        },
        {
          kind: "message",
          from: "A",
          to: "B",
          text: "second",
          arrow: { line: "dotted", head: "none" },
        },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();

    const messageIds = model!.statements
      .filter((s): s is Extract<typeof s, { kind: "message" }> => s.kind === "message")
      .map((s) => s.message.id);

    expect(messageIds).toEqual(["A-B", "A-B#2"]);
  });

  it("resolves every declared participant with origin declared and a full-height extent (createdAt 0, never destroyed)", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [
        { id: "A", label: "Alice", participantKind: "participant" },
        { id: "B", label: "Bob", participantKind: "actor" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "Alice", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: "Bob", participantKind: "actor", origin: "declared" },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    expect(model!.participants).toEqual([
      {
        id: "A",
        label: "Alice",
        participantKind: "participant",
        origin: "declared",
        createdAt: 0,
        destroyedAt: null,
      },
      {
        id: "B",
        label: "Bob",
        participantKind: "actor",
        origin: "declared",
        createdAt: 0,
        destroyedAt: null,
      },
    ]);
  });

  it("drops a message referencing an undeclared participant, reports an error diagnostic, and still resolves every other statement", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "B", participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: "B", participantKind: "participant", origin: "declared" },
        {
          kind: "message",
          from: "A",
          to: "does-not-exist",
          text: "bad",
          arrow: { line: "solid", head: "filled" },
        },
        {
          kind: "message",
          from: "A",
          to: "B",
          text: "good",
          arrow: { line: "solid", head: "filled" },
        },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model).not.toBeNull();
    const messages = model!.statements.filter(
      (s): s is Extract<typeof s, { kind: "message" }> => s.kind === "message",
    );
    expect(messages.map((s) => s.message.id)).toEqual(["A-B"]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("error");
    expect(diagnostics[0]!.message).toContain("does-not-exist");
  });

  it("drops a message referencing a participant declared later in the statement order, even though it is declared somewhere in the document", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "B", participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        {
          kind: "message",
          from: "A",
          to: "B",
          text: "too early",
          arrow: { line: "solid", head: "filled" },
        },
        { kind: "participant", id: "B", label: "B", participantKind: "participant", origin: "declared" },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model).not.toBeNull();
    const messages = model!.statements.filter(
      (s): s is Extract<typeof s, { kind: "message" }> => s.kind === "message",
    );
    expect(messages).toHaveLength(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("error");
    expect(diagnostics[0]!.message).toContain("B");
  });

  it("drops a destroy statement referencing an undeclared participant and reports an error diagnostic", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [{ id: "A", label: "A", participantKind: "participant" }],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "destroy", id: "does-not-exist" },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model).not.toBeNull();
    expect(model!.statements.some((s) => s.kind === "destroy")).toBe(false);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("error");
    expect(diagnostics[0]!.message).toContain("does-not-exist");
  });

  it("passes title through unchanged and assigns sequential autonumbers to messages between autonumber and autonumber off", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: "Order confirmation flow",
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "B", participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: "B", participantKind: "participant", origin: "declared" },
        { kind: "message", from: "A", to: "B", text: "before", arrow: { line: "solid", head: "filled" } },
        { kind: "autonumberOn" },
        { kind: "message", from: "A", to: "B", text: "first", arrow: { line: "solid", head: "filled" } },
        { kind: "message", from: "B", to: "A", text: "second", arrow: { line: "solid", head: "filled" } },
        { kind: "autonumberOff" },
        { kind: "message", from: "A", to: "B", text: "after", arrow: { line: "solid", head: "filled" } },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    expect(model!.title).toBe("Order confirmation flow");

    const messages = model!.statements.filter(
      (s): s is Extract<typeof s, { kind: "message" }> => s.kind === "message",
    );
    expect(messages.map((s) => s.message.autonumber)).toEqual([null, 1, 2, null]);
  });

  it("assigns stable per-kind block ids in document order, e.g. a second top-level loop gets loop-2", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "B", participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: "B", participantKind: "participant", origin: "declared" },
        {
          kind: "loop",
          label: "first loop",
          body: [{ kind: "message", from: "A", to: "B", text: "hi", arrow: { line: "solid", head: "filled" } }],
        },
        {
          kind: "loop",
          label: "second loop",
          body: [{ kind: "message", from: "B", to: "A", text: "bye", arrow: { line: "solid", head: "filled" } }],
        },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();

    const blocks = model!.statements.filter(
      (s): s is Extract<typeof s, { kind: "block" }> => s.kind === "block",
    );
    expect(blocks.map((s) => s.block.id)).toEqual(["loop-1", "loop-2"]);
  });

  it("resolves an alt block's branch labels unchanged, with each branch's body resolved independently", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "B", participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: "B", participantKind: "participant", origin: "declared" },
        {
          kind: "alt",
          branches: [
            {
              label: "success",
              body: [{ kind: "message", from: "A", to: "B", text: "ok", arrow: { line: "solid", head: "filled" } }],
            },
            {
              label: "failure",
              body: [{ kind: "message", from: "B", to: "A", text: "err", arrow: { line: "solid", head: "filled" } }],
            },
          ],
        },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();

    const block = model!.statements.find(
      (s): s is Extract<typeof s, { kind: "block" }> => s.kind === "block",
    )!;

    expect(block.block.branches.map((b) => b.label)).toEqual(["success", "failure"]);
    expect(block.block.branches[0]!.statements).toEqual([
      {
        kind: "message",
        message: {
          id: "A-B",
          from: "A",
          to: "B",
          text: "ok",
          arrow: { line: "solid", head: "filled" },
          autonumber: null,
        },
      },
    ]);
    expect(block.block.branches[1]!.statements).toEqual([
      {
        kind: "message",
        message: {
          id: "B-A",
          from: "B",
          to: "A",
          text: "err",
          arrow: { line: "solid", head: "filled" },
          autonumber: null,
        },
      },
    ]);
  });

  it("computes a block's recursive participantsTouched set across three nested levels (loop > alt > par)", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "B", participantKind: "participant" },
        { id: "C", label: "C", participantKind: "participant" },
        { id: "D", label: "D", participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: "B", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "C", label: "C", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "D", label: "D", participantKind: "participant", origin: "declared" },
        {
          kind: "loop",
          label: "outer",
          body: [
            { kind: "message", from: "A", to: "B", text: "top", arrow: { line: "solid", head: "filled" } },
            {
              kind: "alt",
              branches: [
                {
                  label: "cond",
                  body: [
                    {
                      kind: "par",
                      branches: [
                        {
                          label: null,
                          body: [
                            {
                              kind: "message",
                              from: "C",
                              to: "D",
                              text: "innermost",
                              arrow: { line: "solid", head: "filled" },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();

    const loopBlock = model!.statements.find(
      (s): s is Extract<typeof s, { kind: "block" }> => s.kind === "block",
    )!.block;
    expect(new Set(loopBlock.touchedParticipantIds)).toEqual(new Set(["A", "B", "C", "D"]));

    const altStatement = loopBlock.branches[0]!.statements.find(
      (s): s is Extract<typeof s, { kind: "block" }> => s.kind === "block",
    )!;
    expect(new Set(altStatement.block.touchedParticipantIds)).toEqual(new Set(["C", "D"]));

    const parStatement = altStatement.block.branches[0]!.statements.find(
      (s): s is Extract<typeof s, { kind: "block" }> => s.kind === "block",
    )!;
    expect(new Set(parStatement.block.touchedParticipantIds)).toEqual(new Set(["C", "D"]));
  });

  it("drops a message inside a block body referencing an undeclared participant, reporting the same diagnostic a top-level message would", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [{ id: "A", label: "A", participantKind: "participant" }],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        {
          kind: "loop",
          label: null,
          body: [
            {
              kind: "message",
              from: "A",
              to: "does-not-exist",
              text: "bad",
              arrow: { line: "solid", head: "filled" },
            },
          ],
        },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model).not.toBeNull();
    const loopBlock = model!.statements.find(
      (s): s is Extract<typeof s, { kind: "block" }> => s.kind === "block",
    )!.block;
    expect(loopBlock.branches[0]!.statements).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("error");
    expect(diagnostics[0]!.message).toContain("does-not-exist");
  });

  it("passes a rect block's color string through unvalidated", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "B", participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: "B", participantKind: "participant", origin: "declared" },
        {
          kind: "rect",
          color: "not-a-real-color-value",
          body: [{ kind: "message", from: "A", to: "B", text: "hi", arrow: { line: "solid", head: "filled" } }],
        },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();

    const block = model!.statements.find(
      (s): s is Extract<typeof s, { kind: "block" }> => s.kind === "block",
    )!.block;
    expect(block.kind).toBe("rect");
    expect(block.branches[0]!.label).toBe("not-a-real-color-value");
  });

  it("resolves a create-declared participant with origin created and createdAt at its create statement's position", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "Bob", participantKind: "actor" },
      ],
      boxes: [],
      // Resolved-statement positions, 1-based in flattened order:
      //   1 participant A, 2 message A->A, 3 create actor B, 4 message A->B.
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "message", from: "A", to: "A", text: "self", arrow: { line: "solid", head: "filled" } },
        { kind: "participant", id: "B", label: "Bob", participantKind: "actor", origin: "created" },
        { kind: "message", from: "A", to: "B", text: "hello", arrow: { line: "solid", head: "filled" } },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    expect(model!.participants).toEqual([
      {
        id: "A",
        label: "A",
        participantKind: "participant",
        origin: "declared",
        createdAt: 0,
        destroyedAt: null,
      },
      {
        id: "B",
        label: "Bob",
        participantKind: "actor",
        origin: "created",
        createdAt: 3,
        destroyedAt: null,
      },
    ]);
  });

  it("ends a destroyed participant's lifeline at the destroy statement's position, leaving every other lifeline full-height", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "B", participantKind: "participant" },
      ],
      boxes: [],
      // Resolved-statement positions, 1-based in flattened order:
      //   1 participant A, 2 participant B, 3 loop, 4 message A->B (in the
      //   loop body), 5 destroy B.
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: "B", participantKind: "participant", origin: "declared" },
        {
          kind: "loop",
          label: null,
          body: [
            { kind: "message", from: "A", to: "B", text: "hi", arrow: { line: "solid", head: "filled" } },
          ],
        },
        { kind: "destroy", id: "B" },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    expect(model!.participants.map((p) => [p.id, p.createdAt, p.destroyedAt])).toEqual([
      ["A", 0, null],
      ["B", 0, 5],
    ]);
    expect(model!.statements.at(-1)).toEqual({ kind: "destroy", id: "B" });
  });

  it("rejects a second destroy of an already-destroyed participant, keeping the first destroy's position", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [{ id: "A", label: "A", participantKind: "participant" }],
      boxes: [],
      // Positions: 1 participant A, 2 destroy A. The second destroy is
      // dropped, so it consumes no position.
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "destroy", id: "A" },
        { kind: "destroy", id: "A", line: 4, column: 1 },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model).not.toBeNull();
    expect(model!.participants[0]!.destroyedAt).toBe(2);
    expect(model!.statements.filter((s) => s.kind === "destroy")).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("error");
    expect(diagnostics[0]!.message).toContain("A");
    expect(diagnostics[0]!.line).toBe(4);
  });

  it("warns about a message reaching a participant past the end of its lifeline, without dropping the message", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "B", participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: "B", participantKind: "participant", origin: "declared" },
        { kind: "message", from: "A", to: "B", text: "alive", arrow: { line: "solid", head: "filled" } },
        { kind: "destroy", id: "B" },
        {
          kind: "message",
          from: "A",
          to: "B",
          text: "too late",
          arrow: { line: "solid", head: "filled" },
          line: 7,
          column: 1,
        },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model).not.toBeNull();
    const messages = model!.statements.filter(
      (s): s is Extract<typeof s, { kind: "message" }> => s.kind === "message",
    );
    expect(messages.map((s) => s.message.id)).toEqual(["A-B", "A-B#2"]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(diagnostics[0]!.message).toContain("A-B#2");
    expect(diagnostics[0]!.message).toContain("B");
    expect(diagnostics[0]!.line).toBe(7);
  });

  it("assigns each box a stable box-n id in declaration order, passing its color, label and members through", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "B", participantKind: "participant" },
        { id: "C", label: "C", participantKind: "participant" },
      ],
      boxes: [
        { color: "rgb(0,0,255)", label: "Front end", participantIds: ["A", "B"] },
        { color: null, label: null, participantIds: ["C"] },
      ],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: "B", participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "C", label: "C", participantKind: "participant", origin: "declared" },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();
    expect(model!.boxes).toEqual([
      { id: "box-1", color: "rgb(0,0,255)", label: "Front end", participantIds: ["A", "B"] },
      { id: "box-2", color: null, label: null, participantIds: ["C"] },
    ]);
  });

  it("drops an undeclared member id from a box, reports an error diagnostic, and keeps the box's declared members", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [{ id: "A", label: "A", participantKind: "participant" }],
      boxes: [
        {
          color: null,
          label: "Services",
          participantIds: ["A", "does-not-exist"],
          line: 2,
          column: 1,
        },
      ],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model).not.toBeNull();
    expect(model!.boxes).toEqual([
      { id: "box-1", color: null, label: "Services", participantIds: ["A"] },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("error");
    expect(diagnostics[0]!.message).toContain("does-not-exist");
    expect(diagnostics[0]!.message).toContain("box-1");
    expect(diagnostics[0]!.line).toBe(2);
  });

  it("rejects a message and a destroy that reference a create-declared participant before its create statement", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "B", participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        { kind: "message", from: "A", to: "B", text: "too early", arrow: { line: "solid", head: "filled" } },
        { kind: "destroy", id: "B" },
        { kind: "participant", id: "B", label: "B", participantKind: "participant", origin: "created" },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model).not.toBeNull();
    expect(model!.statements.map((s) => s.kind)).toEqual(["participant", "participant"]);
    expect(model!.participants[1]).toEqual({
      id: "B",
      label: "B",
      participantKind: "participant",
      origin: "created",
      createdAt: 2,
      destroyedAt: null,
    });
    expect(diagnostics.map((d) => d.severity)).toEqual(["error", "error"]);
  });

  it("makes a participant declared inside a block's body visible to a later sibling statement after the block ends (order-sensitive, threaded through recursion)", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      participants: [
        { id: "A", label: "A", participantKind: "participant" },
        { id: "B", label: "B", participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: "A", participantKind: "participant", origin: "declared" },
        {
          kind: "loop",
          label: null,
          body: [
            { kind: "participant", id: "B", label: "B", participantKind: "participant", origin: "declared" },
          ],
        },
        {
          kind: "message",
          from: "A",
          to: "B",
          text: "after the block",
          arrow: { line: "solid", head: "filled" },
        },
      ],
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model).not.toBeNull();

    const messages = model!.statements.filter(
      (s): s is Extract<typeof s, { kind: "message" }> => s.kind === "message",
    );
    expect(messages.map((s) => s.message.id)).toEqual(["A-B"]);
  });
});
