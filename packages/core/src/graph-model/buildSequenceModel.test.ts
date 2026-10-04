import { describe, expect, it } from "vitest";
import { plainLabel } from "../label/label";
import type { SequenceDocument, SequenceStatement } from "../contracts";
import { buildSequenceModel } from "./buildSequenceModel";

describe("buildSequenceModel", () => {
  it("assigns message ids of the form fromId-toId, suffixing a second message between the same pair with #2", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        {
          kind: "message",
          from: "A",
          to: "B",
          label: plainLabel("first"),
          arrow: { line: "solid", head: "filled" },
        },
        {
          kind: "message",
          from: "A",
          to: "B",
          label: plainLabel("second"),
          arrow: { line: "dotted", head: "none" },
        },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);

    const messageIds = model.statements
      .filter((s): s is Extract<typeof s, { kind: "message" }> => s.kind === "message")
      .map((s) => s.message.id);

    expect(messageIds).toEqual(["A-B", "A-B#2"]);
  });

  it("resolves every declared participant with origin declared and a full-height extent (createdAt 0, never destroyed)", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("Alice"), participantKind: "participant" },
        { id: "B", label: plainLabel("Bob"), participantKind: "actor" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("Alice"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("Bob"), participantKind: "actor", origin: "declared" },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model.participants).toEqual([
      {
        id: "A",
        label: plainLabel("Alice"),
        participantKind: "participant",
        origin: "declared",
        createdAt: 0,
        destroyedAt: null,
      },
      {
        id: "B",
        label: plainLabel("Bob"),
        participantKind: "actor",
        origin: "declared",
        createdAt: 0,
        destroyedAt: null,
      },
    ]);
  });

  it("creates the participant a message names without declaring it, after the declared lanes, with no diagnostic", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        {
          kind: "message",
          from: "A",
          to: "does-not-exist",
          label: plainLabel("to a participant nobody declared"),
          arrow: { line: "solid", head: "filled" },
        },
        {
          kind: "message",
          from: "A",
          to: "B",
          label: plainLabel("good"),
          arrow: { line: "solid", head: "filled" },
        },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    const messages = model.statements.filter(
      (s): s is Extract<typeof s, { kind: "message" }> => s.kind === "message",
    );
    expect(messages.map((s) => s.message.id)).toEqual(["A-does-not-exist", "A-B"]);
    expect(model.participants.map((p) => p.id)).toEqual(["A", "B", "does-not-exist"]);
    expect(diagnostics).toEqual([]);
  });

  it("keeps a message naming a participant declared later, and the lane where it was first named", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        {
          kind: "message",
          from: "A",
          to: "B",
          label: plainLabel("too early"),
          arrow: { line: "solid", head: "filled" },
        },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    const messages = model.statements.filter(
      (s): s is Extract<typeof s, { kind: "message" }> => s.kind === "message",
    );
    expect(messages.map((s) => s.message.id)).toEqual(["A-B"]);
    expect(model.participants.map((p) => p.id)).toEqual(["A", "B"]);
    expect(diagnostics).toEqual([]);
  });

  it("creates a participant first named by a destroy, whose lifeline ends there", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [{ id: "A", label: plainLabel("A"), participantKind: "participant" }],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "destroy", id: "does-not-exist" },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model.statements.some((s) => s.kind === "destroy")).toBe(true);
    expect(model.participants.find((p) => p.id === "does-not-exist")?.destroyedAt).not.toBeNull();
    expect(diagnostics).toEqual([]);
  });

  it("resolves activate/deactivate into their own statements, minting a generated activation id", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [{ id: "A", label: plainLabel("A"), participantKind: "participant" }],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "activate", id: "A" },
        { kind: "deactivate", id: "A" },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model.statements).toEqual([
      { kind: "participant", participant: expect.objectContaining({ id: "A" }) },
      { kind: "activate", participantId: "A", activationId: "activation:1" },
      { kind: "deactivate", participantId: "A" },
    ]);
  });

  it("gives two separate activations on the same participant distinct generated ids, in document order", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [{ id: "A", label: plainLabel("A"), participantKind: "participant" }],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "activate", id: "A" },
        { kind: "deactivate", id: "A" },
        { kind: "activate", id: "A" },
        { kind: "deactivate", id: "A" },
      ],
      timeline: null,
    };

    const { model } = buildSequenceModel(document);

    const activationIds = model.statements
      .filter((s): s is Extract<typeof s, { kind: "activate" }> => s.kind === "activate")
      .map((s) => s.activationId);
    expect(activationIds).toEqual(["activation:1", "activation:2"]);
  });

  it("allows stacked activations on one participant — two opens before any close", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [{ id: "A", label: plainLabel("A"), participantKind: "participant" }],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "activate", id: "A" },
        { kind: "activate", id: "A" },
        { kind: "deactivate", id: "A" },
        { kind: "deactivate", id: "A" },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model.statements.filter((s) => s.kind === "deactivate")).toHaveLength(2);
  });

  it("drops a deactivate with nothing open on that participant, reporting an error diagnostic (matches Mermaid's own rejection)", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [{ id: "A", label: plainLabel("A"), participantKind: "participant" }],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "deactivate", id: "A", line: 3, column: 1 },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model.statements.some((s) => s.kind === "deactivate")).toBe(false);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("error");
    expect(diagnostics[0]!.message).toContain("A");
    expect(diagnostics[0]!.message.toLowerCase()).toContain("no open activation");
  });

  it("creates a participant first named by an activate", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [],
      boxes: [],
      statements: [{ kind: "activate", id: "does-not-exist" }],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model.statements.map((s) => s.kind)).toEqual(["activate"]);
    expect(model.participants.map((p) => p.id)).toEqual(["does-not-exist"]);
    expect(diagnostics).toEqual([]);
  });

  it("resolves a note into a generated note:n id, carrying its placement, span and text through unchanged", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        { kind: "note", placement: "over", from: "A", to: "B", label: plainLabel("they agree") },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model.statements.at(-1)).toEqual({
      kind: "note",
      note: { id: "note:1", placement: "over", from: "A", to: "B", label: plainLabel("they agree") },
    });
  });

  it("gives two notes distinct generated ids in document order", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [{ id: "A", label: plainLabel("A"), participantKind: "participant" }],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "note", placement: "right", from: "A", to: "A", label: plainLabel("first") },
        { kind: "note", placement: "left", from: "A", to: "A", label: plainLabel("second") },
      ],
      timeline: null,
    };

    const { model } = buildSequenceModel(document);

    const noteIds = model.statements
      .filter((s): s is Extract<typeof s, { kind: "note" }> => s.kind === "note")
      .map((s) => s.note.id);
    expect(noteIds).toEqual(["note:1", "note:2"]);
  });

  it("creates a participant first named by a note", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [{ id: "A", label: plainLabel("A"), participantKind: "participant" }],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "note", placement: "over", from: "A", to: "does-not-exist", label: plainLabel("x") },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model.statements.some((s) => s.kind === "note")).toBe(true);
    expect(model.participants.map((p) => p.id)).toEqual(["A", "does-not-exist"]);
    expect(diagnostics).toEqual([]);
  });

  it("passes title through unchanged and assigns sequential autonumbers to messages between autonumber and autonumber off", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: "Order confirmation flow",
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        { kind: "message", from: "A", to: "B", label: plainLabel("before"), arrow: { line: "solid", head: "filled" } },
        { kind: "autonumberOn" },
        { kind: "message", from: "A", to: "B", label: plainLabel("first"), arrow: { line: "solid", head: "filled" } },
        { kind: "message", from: "B", to: "A", label: plainLabel("second"), arrow: { line: "solid", head: "filled" } },
        { kind: "autonumberOff" },
        { kind: "message", from: "A", to: "B", label: plainLabel("after"), arrow: { line: "solid", head: "filled" } },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model.title).toBe("Order confirmation flow");

    const messages = model.statements.filter(
      (s): s is Extract<typeof s, { kind: "message" }> => s.kind === "message",
    );
    expect(messages.map((s) => s.message.autonumber)).toEqual([null, 1, 2, null]);
  });

  it("assigns stable per-kind block ids in document order, e.g. a second top-level loop gets loop:2", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        {
          kind: "loop",
          label: plainLabel("first loop"),
          body: [{ kind: "message", from: "A", to: "B", label: plainLabel("hi"), arrow: { line: "solid", head: "filled" } }],
        },
        {
          kind: "loop",
          label: plainLabel("second loop"),
          body: [{ kind: "message", from: "B", to: "A", label: plainLabel("bye"), arrow: { line: "solid", head: "filled" } }],
        },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);

    const blocks = model.statements.filter(
      (s): s is Extract<typeof s, { kind: "block" }> => s.kind === "block",
    );
    expect(blocks.map((s) => s.block.id)).toEqual(["loop:1", "loop:2"]);
  });

  it("separates a block id's kind from its number with a colon, which no `\\w+` participant id can contain, for all seven block kinds", () => {
    const msg = (): SequenceStatement => ({
      kind: "message",
      from: "A",
      to: "B",
      label: plainLabel("x"),
      arrow: { line: "solid", head: "filled" },
    });
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        { kind: "loop", label: plainLabel("again"), body: [msg()] },
        { kind: "alt", branches: [{ label: plainLabel("yes"), body: [msg()] }] },
        { kind: "opt", label: plainLabel("maybe"), body: [msg()] },
        { kind: "par", branches: [{ label: plainLabel("fan out"), body: [msg()] }] },
        { kind: "critical", branches: [{ label: plainLabel("lock"), body: [msg()] }] },
        { kind: "break", label: plainLabel("boom"), body: [msg()] },
        { kind: "rect", color: "rgb(0,0,255)", body: [msg()] },
        { kind: "loop", label: plainLabel("again again"), body: [msg()] },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);

    const blocks = model.statements.filter(
      (s): s is Extract<typeof s, { kind: "block" }> => s.kind === "block",
    );
    expect(blocks.map((s) => s.block.id)).toEqual([
      "loop:1",
      "alt:1",
      "opt:1",
      "par:1",
      "critical:1",
      "break:1",
      "rect:1",
      "loop:2",
    ]);
  });

  it("resolves an alt block's branch labels unchanged, with each branch's body resolved independently", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        {
          kind: "alt",
          branches: [
            {
              label: plainLabel("success"),
              body: [{ kind: "message", from: "A", to: "B", label: plainLabel("ok"), arrow: { line: "solid", head: "filled" } }],
            },
            {
              label: plainLabel("failure"),
              body: [{ kind: "message", from: "B", to: "A", label: plainLabel("err"), arrow: { line: "solid", head: "filled" } }],
            },
          ],
        },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);

    const block = model.statements.find(
      (s): s is Extract<typeof s, { kind: "block" }> => s.kind === "block",
    )!;

    expect(block.block.branches.map((b) => b.label)).toEqual([plainLabel("success"), plainLabel("failure")]);
    expect(block.block.branches[0]!.statements).toEqual([
      {
        kind: "message",
        message: {
          id: "A-B",
          from: "A",
          to: "B",
          label: plainLabel("ok"),
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
          label: plainLabel("err"),
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
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
        { id: "C", label: plainLabel("C"), participantKind: "participant" },
        { id: "D", label: plainLabel("D"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "C", label: plainLabel("C"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "D", label: plainLabel("D"), participantKind: "participant", origin: "declared" },
        {
          kind: "loop",
          label: plainLabel("outer"),
          body: [
            { kind: "message", from: "A", to: "B", label: plainLabel("top"), arrow: { line: "solid", head: "filled" } },
            {
              kind: "alt",
              branches: [
                {
                  label: plainLabel("cond"),
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
                              label: plainLabel("innermost"),
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
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);

    const loopBlock = model.statements.find(
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

  it("creates a participant first named inside a block body, as a top-level message would", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [{ id: "A", label: plainLabel("A"), participantKind: "participant" }],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        {
          kind: "loop",
          label: null,
          body: [
            {
              kind: "message",
              from: "A",
              to: "does-not-exist",
              label: plainLabel("bad"),
              arrow: { line: "solid", head: "filled" },
            },
          ],
        },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    const loopBlock = model.statements.find(
      (s): s is Extract<typeof s, { kind: "block" }> => s.kind === "block",
    )!.block;
    expect(loopBlock.branches[0]!.statements.map((s) => s.kind)).toEqual(["message"]);
    expect(model.participants.map((p) => p.id)).toEqual(["A", "does-not-exist"]);
    expect(diagnostics).toEqual([]);
  });

  it("passes a rect block's color string through unvalidated", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        {
          kind: "rect",
          color: "not-a-real-color-value",
          body: [{ kind: "message", from: "A", to: "B", label: plainLabel("hi"), arrow: { line: "solid", head: "filled" } }],
        },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);

    const block = model.statements.find(
      (s): s is Extract<typeof s, { kind: "block" }> => s.kind === "block",
    )!.block;
    expect(block.kind).toBe("rect");
    expect(block.branches[0]!.label).toEqual(plainLabel("not-a-real-color-value"));
  });

  it("resolves a create-declared participant with origin created and createdAt at its create statement's position", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("Bob"), participantKind: "actor" },
      ],
      boxes: [],
      // Resolved-statement positions, 1-based in flattened order:
      //   1 participant A, 2 message A->A, 3 create actor B, 4 message A->B.
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "message", from: "A", to: "A", label: plainLabel("self"), arrow: { line: "solid", head: "filled" } },
        { kind: "participant", id: "B", label: plainLabel("Bob"), participantKind: "actor", origin: "created" },
        { kind: "message", from: "A", to: "B", label: plainLabel("hello"), arrow: { line: "solid", head: "filled" } },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model.participants).toEqual([
      {
        id: "A",
        label: plainLabel("A"),
        participantKind: "participant",
        origin: "declared",
        createdAt: 0,
        destroyedAt: null,
      },
      {
        id: "B",
        label: plainLabel("Bob"),
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
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      // Resolved-statement positions, 1-based in flattened order:
      //   1 participant A, 2 participant B, 3 loop, 4 message A->B (in the
      //   loop body), 5 destroy B.
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        {
          kind: "loop",
          label: null,
          body: [
            { kind: "message", from: "A", to: "B", label: plainLabel("hi"), arrow: { line: "solid", head: "filled" } },
          ],
        },
        { kind: "destroy", id: "B" },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model.participants.map((p) => [p.id, p.createdAt, p.destroyedAt])).toEqual([
      ["A", 0, null],
      ["B", 0, 5],
    ]);
    expect(model.statements.at(-1)).toEqual({ kind: "destroy", id: "B" });
  });

  it("rejects a second destroy of an already-destroyed participant, keeping the first destroy's position", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [{ id: "A", label: plainLabel("A"), participantKind: "participant" }],
      boxes: [],
      // Positions: 1 participant A, 2 destroy A. The second destroy is
      // dropped, so it consumes no position.
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "destroy", id: "A" },
        { kind: "destroy", id: "A", line: 4, column: 1 },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model.participants[0]!.destroyedAt).toBe(2);
    expect(model.statements.filter((s) => s.kind === "destroy")).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("error");
    expect(diagnostics[0]!.message).toContain("A");
    expect(diagnostics[0]!.line).toBe(4);
  });

  it("warns about a message reaching a participant past the end of its lifeline, without dropping the message", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        { kind: "message", from: "A", to: "B", label: plainLabel("alive"), arrow: { line: "solid", head: "filled" } },
        { kind: "destroy", id: "B" },
        {
          kind: "message",
          from: "A",
          to: "B",
          label: plainLabel("too late"),
          arrow: { line: "solid", head: "filled" },
          line: 7,
          column: 1,
        },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    const messages = model.statements.filter(
      (s): s is Extract<typeof s, { kind: "message" }> => s.kind === "message",
    );
    expect(messages.map((s) => s.message.id)).toEqual(["A-B", "A-B#2"]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(diagnostics[0]!.message).toContain("A-B#2");
    expect(diagnostics[0]!.message).toContain("B");
    expect(diagnostics[0]!.line).toBe(7);
  });

  it("assigns each box a stable box:n id in declaration order, passing its color, label and members through", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
        { id: "C", label: plainLabel("C"), participantKind: "participant" },
      ],
      boxes: [
        { color: "rgb(0,0,255)", label: plainLabel("Front end"), participantIds: ["A", "B"] },
        { color: null, label: null, participantIds: ["C"] },
      ],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "C", label: plainLabel("C"), participantKind: "participant", origin: "declared" },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model.boxes).toEqual([
      { id: "box:1", color: "rgb(0,0,255)", label: plainLabel("Front end"), participantIds: ["A", "B"] },
      { id: "box:2", color: null, label: null, participantIds: ["C"] },
    ]);
  });

  it("drops an undeclared member id from a box, reports an error diagnostic, and keeps the box's declared members", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [{ id: "A", label: plainLabel("A"), participantKind: "participant" }],
      boxes: [
        {
          color: null,
          label: plainLabel("Services"),
          participantIds: ["A", "does-not-exist"],
          line: 2,
          column: 1,
        },
      ],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model.boxes).toEqual([
      { id: "box:1", color: null, label: plainLabel("Services"), participantIds: ["A"] },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("error");
    expect(diagnostics[0]!.message).toContain("does-not-exist");
    expect(diagnostics[0]!.message).toContain("box:1");
    expect(diagnostics[0]!.line).toBe(2);
  });

  it("rejects a create statement for a participant a message and a destroy already named, keeping the lane they created", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "message", from: "A", to: "B", label: plainLabel("too early"), arrow: { line: "solid", head: "filled" } },
        { kind: "destroy", id: "B" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "created" },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model.statements.map((s) => s.kind)).toEqual(["participant", "message", "destroy"]);
    expect(model.participants[1]).toEqual({
      id: "B",
      label: plainLabel("B"),
      participantKind: "participant",
      origin: "declared",
      createdAt: 0,
      destroyedAt: 3,
    });
    expect(diagnostics.map((d) => d.severity)).toEqual(["error"]);
    expect(diagnostics[0]!.message).toContain("create participant");
  });

  it("makes a participant declared inside a block's body visible to a later sibling statement after the block ends (order-sensitive, threaded through recursion)", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        {
          kind: "loop",
          label: null,
          body: [
            { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
          ],
        },
        {
          kind: "message",
          from: "A",
          to: "B",
          label: plainLabel("after the block"),
          arrow: { line: "solid", head: "filled" },
        },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);

    const messages = model.statements.filter(
      (s): s is Extract<typeof s, { kind: "message" }> => s.kind === "message",
    );
    expect(messages.map((s) => s.message.id)).toEqual(["A-B"]);
  });
  it("resolves the document's timeline block against the participant ids it holds", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        {
          kind: "message",
          from: "A",
          to: "B",
          label: plainLabel("hi"),
          arrow: { line: "solid", head: "filled" },
        },
      ],
      timeline: {
        entries: [
          { kind: "enter", step: 1, targetId: "A", effect: "fade", line: 5, column: 3 },
          { kind: "highlight", step: 3, targetId: "B", effect: "glow", line: 6, column: 3 },
        ],
      },
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model.timeline).toEqual({
      totalSteps: 3,
      entries: [
        { kind: "enter", step: 1, targetId: "A", effect: "fade" },
        { kind: "highlight", step: 3, targetId: "B", effect: "glow" },
      ],
    });
  });

  it("resolves a null timeline block to an empty resolved timeline", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [{ id: "A", label: plainLabel("A"), participantKind: "participant" }],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model.timeline).toEqual({ totalSteps: 0, entries: [] });
  });

  it("resolves a timeline entry naming a message, a control-flow block or a box grouping — every id the renderer tags is addressable", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [{ color: null, label: plainLabel("Group"), participantIds: ["A", "B"], line: 2, column: 3 }],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        {
          kind: "message",
          from: "A",
          to: "B",
          label: plainLabel("hi"),
          arrow: { line: "solid", head: "filled" },
        },
        {
          kind: "loop",
          label: plainLabel("retry"),
          body: [
            {
              kind: "message",
              from: "B",
              to: "A",
              label: plainLabel("ack"),
              arrow: { line: "solid", head: "filled" },
            },
          ],
        },
      ],
      timeline: {
        entries: [
          { kind: "highlight", step: 1, targetId: "A-B", effect: "glow", line: 9, column: 3 },
          { kind: "highlight", step: 2, targetId: "loop:1", effect: "outline", line: 10, column: 3 },
          { kind: "enter", step: 3, targetId: "box:1", effect: "fade", line: 11, column: 3 },
        ],
      },
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model.timeline).toEqual({
      totalSteps: 3,
      entries: [
        { kind: "highlight", step: 1, targetId: "A-B", effect: "glow" },
        { kind: "highlight", step: 2, targetId: "loop:1", effect: "outline" },
        { kind: "enter", step: 3, targetId: "box:1", effect: "fade" },
      ],
    });
  });

  it("reaches a message and a block nested inside another block's branch — the id set comes from a recursive walk, not the top-level statement list", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        {
          kind: "loop",
          label: plainLabel("retry"),
          body: [
            {
              kind: "alt",
              branches: [
                {
                  label: plainLabel("ok"),
                  body: [
                    {
                      kind: "message",
                      from: "A",
                      to: "B",
                      label: plainLabel("deep"),
                      arrow: { line: "solid", head: "filled" },
                    },
                  ],
                },
                {
                  label: plainLabel("not ok"),
                  body: [
                    {
                      kind: "message",
                      from: "B",
                      to: "A",
                      label: plainLabel("deeper still"),
                      arrow: { line: "solid", head: "filled" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      timeline: {
        entries: [
          { kind: "highlight", step: 1, targetId: "A-B", effect: "glow", line: 12, column: 3 },
          { kind: "highlight", step: 2, targetId: "B-A", effect: "glow", line: 13, column: 3 },
          { kind: "highlight", step: 3, targetId: "alt:1", effect: "outline", line: 14, column: 3 },
        ],
      },
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model.timeline.entries.map((e) => e.targetId)).toEqual(["A-B", "B-A", "alt:1"]);
  });

  it("addresses a repeat message pair by its #2 id, and still rejects an id no element holds", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        { kind: "message", from: "A", to: "B", label: plainLabel("first"), arrow: { line: "solid", head: "filled" } },
        { kind: "message", from: "A", to: "B", label: plainLabel("second"), arrow: { line: "solid", head: "filled" } },
      ],
      timeline: {
        entries: [
          { kind: "highlight", step: 1, targetId: "A-B#2", effect: "glow", line: 7, column: 3 },
          { kind: "highlight", step: 2, targetId: "A-B#3", effect: "glow", line: 8, column: 3 },
          { kind: "highlight", step: 3, targetId: "loop:1", effect: "glow", line: 9, column: 3 },
        ],
      },
    };

    const { model, diagnostics } = buildSequenceModel(document);

    // The second message between the same pair is addressable under the id
    // it actually holds, not under the pair's base id.
    expect(model.timeline.entries.map((e) => e.targetId)).toEqual(["A-B#2"]);
    // Widening the set widened it to real ids only: a third A-B message and
    // a loop block were never written, so naming them is the same
    // unknown-id error it was before.
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'timeline: references unknown id "A-B#3"',
        line: 8,
        column: 3,
      },
      {
        severity: "error",
        message: 'timeline: references unknown id "loop:1"',
        line: 9,
        column: 3,
      },
    ]);
  });

  it("warns once when a message stays on screen after a participant it touches exits, naming the message and that participant", () => {
    // The flowchart's edge-outlives-its-node rule, applied to the third
    // connector. Distinct from the `destroy` warning this file already
    // covers: nothing here is destroyed, the lifeline runs full height, and
    // the defect is only visible while the animation plays.
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        { kind: "message", from: "A", to: "B", label: plainLabel("hi"), arrow: { line: "solid", head: "filled" } },
      ],
      timeline: {
        entries: [{ kind: "exit", step: 2, targetId: "A", effect: "fade", line: 7, column: 3 }],
      },
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          'timeline: message "A-B" remains visible after its endpoint "A" exits at step 2 — ' +
          'add "exit A-B ..." at or before step 2',
      },
    ]);
    // Advisory only: the exit still applies and the message still resolves.
    expect(model.timeline.entries).toEqual([
      { kind: "exit", step: 2, targetId: "A", effect: "fade" },
    ]);
    expect(model.statements).toContainEqual({
      kind: "message",
      message: {
        id: "A-B",
        from: "A",
        to: "B",
        label: plainLabel("hi"),
        arrow: { line: "solid", head: "filled" },
        autonumber: null,
      },
    });
  });
  it("reaches a message nested inside a block branch, warning about it just as it would about one at the top level", () => {
    // Most messages are written inside a loop or an alt, so a rule that only
    // saw the top-level statement list would miss the common case entirely.
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        {
          kind: "loop",
          label: plainLabel("retry"),
          body: [
            {
              kind: "alt",
              branches: [
                {
                  label: plainLabel("ok"),
                  body: [
                    { kind: "message", from: "A", to: "B", label: plainLabel("deep"), arrow: { line: "solid", head: "filled" } },
                  ],
                },
                {
                  label: plainLabel("not ok"),
                  body: [
                    { kind: "message", from: "B", to: "A", label: plainLabel("deeper still"), arrow: { line: "solid", head: "filled" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
      timeline: {
        entries: [{ kind: "exit", step: 3, targetId: "A", effect: "fade", line: 14, column: 3 }],
      },
    };

    const { diagnostics } = buildSequenceModel(document);

    expect(diagnostics.map((d) => d.message)).toEqual([
      'timeline: message "A-B" remains visible after its endpoint "A" exits at step 3 — ' +
        'add "exit A-B ..." at or before step 3',
      'timeline: message "B-A" remains visible after its endpoint "A" exits at step 3 — ' +
        'add "exit B-A ..." at or before step 3',
    ]);
  });
  it("goes quiet once the message is given its own exit at or before the participant's", () => {
    // The way the author acts on the warning. It also pins the wiring the
    // shared rule depends on: a message id has to be recognised as a
    // connector, not mistaken for a fourth kind of endpoint.
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "participant", id: "B", label: plainLabel("B"), participantKind: "participant", origin: "declared" },
        { kind: "message", from: "A", to: "B", label: plainLabel("hi"), arrow: { line: "solid", head: "filled" } },
      ],
      timeline: {
        entries: [
          { kind: "exit", step: 2, targetId: "A-B", effect: "fade", line: 7, column: 3 },
          { kind: "exit", step: 2, targetId: "A", effect: "fade", line: 8, column: 3 },
        ],
      },
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model.timeline.entries).toEqual([
      { kind: "exit", step: 2, targetId: "A-B", effect: "fade" },
      { kind: "exit", step: 2, targetId: "A", effect: "fade" },
    ]);
  });
});
