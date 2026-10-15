import { describe, expect, it } from "vitest";
import { plainLabel } from "../label/label";
import type { ResolvedSequenceMessage, ResolvedSequenceStatement, SequenceDocument, SequenceStatement } from "../contracts";
import { buildSequenceModel } from "./buildSequenceModel";
import { parseSequenceDiagram } from "../parser/parseSequenceDiagram";

/**
 * Parses `body` under a `sequenceDiagram` header and builds it, returning
 * the model and the parts of it these tests read: the lane order, each
 * lane's lifeline extent, the link targets, every message's `creates` mark
 * (block bodies included) and the diagnostics as `severity line:column:
 * message`.
 */
function build(body: string) {
  const { document } = parseSequenceDiagram(`sequenceDiagram\n${body}\n`);
  if (document === null || document.kind !== "sequence") throw new Error("expected a sequence document");
  const { model, diagnostics } = buildSequenceModel(document);
  const messages = (statements: ResolvedSequenceStatement[]): ResolvedSequenceMessage[] =>
    statements.flatMap((s) =>
      s.kind === "message" ? [s.message] : s.kind === "block" ? s.block.branches.flatMap((b) => messages(b.statements)) : [],
    );
  return {
    model,
    lanes: model.participants.map((p) => p.id),
    linked: model.interactions.map((i) => i.targetId),
    createdAt: Object.fromEntries(model.participants.map((p) => [p.id, p.createdAt])),
    destroyedAt: Object.fromEntries(model.participants.map((p) => [p.id, p.destroyedAt])),
    creates: messages(model.statements).map((m) => [m.id, m.creates ?? null]),
    diagnostics: diagnostics.map((d) => `${d.severity} ${d.line}:${d.column}: ${d.message}`),
  };
}

describe("buildSequenceModel", () => {
  it("assigns message ids of the form fromId-toId, suffixing a second message between the same pair with #2", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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

  it("creates no participant for an id only a destroy names, keeping the destroy statement and warning that it draws nothing", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      accDescr: null,
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
    expect(model.participants.map((p) => p.id)).toEqual(["A"]);
    expect(diagnostics.map((d) => d.severity)).toEqual(["warning"]);
  });

  it("resolves activate/deactivate into their own statements, minting a generated activation id", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
    expect(block.color).toBe("not-a-real-color-value");
    expect(block.branches[0]!.label).toBeNull();
  });

  it("resolves a create-declared participant with origin created and createdAt at its creating message's position", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      accDescr: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("Bob"), participantKind: "actor" },
      ],
      boxes: [],
      // Resolved-statement positions, 1-based in flattened order:
      //   1 participant A, 2 message A->A, 3 create actor B, 4 message A->B
      //   — B's creating message, where its lifeline starts.
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
        createdAt: 4,
        destroyedAt: null,
        // `A->>A: self` is drawn before `create actor B`.
        createdAfterDrawing: true,
      },
    ]);
  });

  it("ends a destroyed participant's lifeline at its destroying message's position, after a block, leaving every other lifeline full-height", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      accDescr: null,
      interactions: [],
      participants: [
        { id: "A", label: plainLabel("A"), participantKind: "participant" },
        { id: "B", label: plainLabel("B"), participantKind: "participant" },
      ],
      boxes: [],
      // Resolved-statement positions, 1-based in flattened order:
      //   1 participant A, 2 participant B, 3 loop, 4 message A->B (in the
      //   loop body), 5 destroy B, 6 message B->A — the destroying message.
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
        { kind: "message", from: "B", to: "A", label: plainLabel("bye"), arrow: { line: "solid", head: "filled" } },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(diagnostics).toEqual([]);
    expect(model.participants.map((p) => [p.id, p.createdAt, p.destroyedAt])).toEqual([
      ["A", 0, null],
      ["B", 0, 6],
    ]);
    expect(model.statements.at(-2)).toEqual({ kind: "destroy", id: "B" });
  });

  it("rejects a second destroy of an already-destroyed participant, keeping the first one's destroying message", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      accDescr: null,
      interactions: [],
      participants: [{ id: "A", label: plainLabel("A"), participantKind: "participant" }],
      boxes: [],
      // Positions: 1 participant A, 2 destroy A, 3 A->>A — the destroying
      // message. The second destroy is dropped, so it consumes no position.
      statements: [
        { kind: "participant", id: "A", label: plainLabel("A"), participantKind: "participant", origin: "declared" },
        { kind: "destroy", id: "A" },
        { kind: "message", from: "A", to: "A", label: plainLabel("bye"), arrow: { line: "solid", head: "filled" } },
        { kind: "destroy", id: "A", line: 4, column: 1 },
      ],
      timeline: null,
    };

    const { model, diagnostics } = buildSequenceModel(document);

    expect(model.participants[0]!.destroyedAt).toBe(3);
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
      accDescr: null,
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
        // The destroying message: B receives it before its lifeline ends, so
        // it is not past the end and is not warned about.
        { kind: "message", from: "A", to: "B", label: plainLabel("goodbye"), arrow: { line: "solid", head: "filled" } },
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
    expect(messages.map((s) => s.message.id)).toEqual(["A-B", "A-B#2", "A-B#3"]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(diagnostics[0]!.message).toContain("A-B#3");
    expect(diagnostics[0]!.message).toContain("B");
    expect(diagnostics[0]!.line).toBe(7);
  });

  it("assigns each box a stable box:n id in declaration order, passing its color, label and members through", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      // No message after the `destroy`: it ends nothing (nook 01M4YWYFJ).
      destroyedAt: null,
    });
    expect(diagnostics.map((d) => d.severity)).toEqual(["error", "warning"]);
    expect(diagnostics[0]!.message).toContain("create participant");
  });

  it("makes a participant declared inside a block's body visible to a later sibling statement after the block ends (order-sensitive, threaded through recursion)", () => {
    const document: SequenceDocument = {
      kind: "sequence",
      title: null,
      accTitle: null,
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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

  describe("a link names its participant, like any other mention (01M3NNNE6)", () => {
    // Each case measured on Mermaid 12.2.0: a link creates its participant's
    // lane, at the place in the document the link is written.
    it("resolves a link to a participant only a message created", () => {
      const { lanes, linked, diagnostics } = build("  A->>B: x\n  link B: Docs @ https://x.com");
      expect({ lanes, linked, diagnostics }).toEqual({
        lanes: ["A", "B"],
        linked: ["B"],
        diagnostics: [],
      });
    });

    it("creates the lane of a participant nothing else names, where the link is written", () => {
      expect(build("  link C: Docs @ https://x.com\n  A->>B: x").lanes).toEqual(["C", "A", "B"]);
      expect(build("  A->>B: x\n  link C: Docs @ https://x.com").lanes).toEqual(["A", "B", "C"]);
      expect(build("  link C: Docs @ https://x.com").lanes).toEqual(["C"]);
    });

    // Measured on Mermaid 12.2.0: `links` places its lane exactly as `link`
    // does — even when its text names no usable link (`not-json`, `{}`), the
    // lane is still created there, with no links on it.
    it("creates a lane where a links statement is written, usable or not", () => {
      const links = '{"Home": "https://x.com", "Docs": "https://d.com"}';
      expect(build(`  links C: ${links}\n  A->>B: x`).lanes).toEqual(["C", "A", "B"]);
      expect(build(`  A->>B: x\n  links C: ${links}`).lanes).toEqual(["A", "B", "C"]);
      expect(build("  links C: not-json\n  A->>B: x").lanes).toEqual(["C", "A", "B"]);
      expect(build("  A->>B: x\n  links C: {}").lanes).toEqual(["A", "B", "C"]);
      expect(build("  links C: {}").lanes).toEqual(["C"]);
    });

    it("places a link written inside a block between the statements around it", () => {
      expect(build("  A->>B: x\n  loop L\n    link C: Docs @ https://x.com\n  end\n  B->>D: y").lanes).toEqual([
        "A",
        "B",
        "C",
        "D",
      ]);
    });

    it("keeps a later declaration's label but the link's place", () => {
      const { document } = parseSequenceDiagram(
        "sequenceDiagram\n  link C: Docs @ https://x.com\n  participant A\n  participant C as See\n",
      );
      const { model } = buildSequenceModel(document as SequenceDocument);
      expect(model.participants.map((p) => [p.id, p.label.text])).toEqual([
        ["C", "See"],
        ["A", "A"],
      ]);
    });

    it("refuses a create after a link has already named the participant, as Mermaid does", () => {
      expect(build("  link C: Docs @ https://x.com\n  create participant C\n  A->>C: x").diagnostics).toEqual([
        'error 3:3: create participant "C" comes after "C" is already used; a created participant must be created before it is first named',
      ]);
    });
  });

  describe("destroying messages (the message right after `destroy X`, which X sends or receives)", () => {
    it("ends X's lifeline at the message X receives right after `destroy X`, with no warning for it", () => {
      // Positions: 1 participant A, 2 participant B, 3 A->>B hi, 4 destroy B,
      // 5 A->>B bye — the destroying message.
      const result = build("participant A\nparticipant B\nA->>B: hi\ndestroy B\nA->>B: bye");

      expect(result.diagnostics).toEqual([]);
      expect(result.destroyedAt).toEqual({ A: null, B: 5 });
    });

    it("marks the destroying message with the participant it destroys, and no other message", () => {
      const result = build("participant A\nparticipant B\nA->>B: hi\ndestroy B\nB->>A: bye\nA->>A: ok");

      const messages = result.model.statements.flatMap((s) => (s.kind === "message" ? [s.message] : []));
      expect(messages.map((m) => [m.id, m.destroys ?? null])).toEqual([
        ["A-B", null],
        ["B-A", "B"],
        ["A-A", null],
      ]);
    });

    it("ends X's lifeline at the message X sends right after `destroy X`, with no warning for it", () => {
      const result = build("participant A\nparticipant B\nA->>B: hi\ndestroy B\nB->>A: bye");

      expect(result.diagnostics).toEqual([]);
      expect(result.destroyedAt).toEqual({ A: null, B: 5 });
    });

    it("still warns about a later message naming X, past its destroying message", () => {
      const result = build("participant A\nparticipant B\ndestroy B\nB->>A: bye\nA->>B: too late");

      expect(result.destroyedAt).toEqual({ A: null, B: 4 });
      expect(result.diagnostics).toEqual([
        'warning 6:1: Message "A-B" references participant "B", whose lifeline already ended — the arrow points past the destroy mark',
      ]);
    });

    it("pairs with a destroying message in the same block, and refuses one past a block boundary, naming the boundary", () => {
      // Measured on Mermaid 12.2.0: a block's start, its `else`/`and`/`option`
      // and its `end` are each a record of their own, so a destroying message
      // past one is accepted and then not drawn — B's lifeline runs to the
      // bottom. Inside one branch, the pair is drawn.
      // Positions: 1–2 participants, 3 alt, 4 A->>A, 5 destroy B, 6 B->>A, 7 A->>A.
      const sameBranch = build(
        ["participant A", "participant B", "alt first", "A->>A: think", "destroy B", "B->>A: bye", "else second", "A->>A: other", "end"].join("\n"),
      );
      expect(sameBranch.diagnostics).toEqual([]);
      expect(sameBranch.destroyedAt).toEqual({ A: null, B: 6 });

      const refusal = (keyword: string) =>
        `The destroyed participant "B" has no destroying message: the message sent by or to it must come right after the destroy, with no "${keyword}" in between.`;
      const firstError = (body: string[]) =>
        build(["participant A", "participant B", ...body].join("\n")).diagnostics.find((d) => d.startsWith("error"));
      expect(firstError(["alt first", "A->>A: think", "destroy B", "else second", "B->>A: bye", "end"])).toBe(`error 6:1: ${refusal("else")}`);
      expect(firstError(["loop again", "A->>A: think", "destroy B", "end", "B->>A: bye"])).toBe(`error 6:1: ${refusal("end")}`);
      expect(firstError(["destroy B", "opt maybe", "B->>A: bye", "end"])).toBe(`error 4:1: ${refusal("opt")}`);
      expect(firstError(["par one", "A->>A: think", "destroy B", "and two", "B->>A: bye", "end"])).toBe(`error 6:1: ${refusal("and")}`);
      expect(firstError(["critical one", "A->>A: think", "destroy B", "option two", "B->>A: bye", "end"])).toBe(`error 6:1: ${refusal("option")}`);
    });

    it("refuses a `destroy X` whose next message does not touch X, at the `destroy` line, saying why without naming Mermaid", () => {
      const result = build("participant A\nparticipant B\nparticipant C\ndestroy B\nA->>C: unrelated");

      expect(result.diagnostics).toEqual([
        'error 5:1: The destroyed participant "B" has no destroying message: the next message must be sent by or to it.',
      ]);
      expect(result.diagnostics.join("\n")).not.toMatch(/mermaid/i);
    });
  });

  describe("a `create` or `destroy` with another record before its message (nook 01M4YS7DV8)", () => {
    // Measured on Mermaid 12.2.0: its drawing finds a creating or destroying
    // message by the index of the record right after the declaration, so
    // whenever anything else comes first — another `create` or `destroy`, a
    // note, an activation, a block boundary — the declaration is accepted and
    // then not drawn at all, with no diagnostic. Siren refuses those, at the
    // declaration's line, once a message follows.
    it("refuses a `destroy` followed by another `destroy` before any message, at the first one's line", () => {
      // Mermaid draws C's lifeline ending on `A-xC` and B's running to the
      // bottom, as if B were never destroyed.
      // Positions: 1–3 participants, 4 destroy B, 5 destroy C, 6 A-xC.
      const result = build("participant A\nparticipant B\nparticipant C\ndestroy B\ndestroy C\nA-xC: bye");

      expect(result.diagnostics).toEqual([
        'error 5:1: The destroyed participant "B" has no destroying message: the message sent by or to it must come right after the destroy, with no "destroy" in between.',
      ]);
      expect(result.destroyedAt).toEqual({ A: null, B: 4, C: 6 });
    });

    it("refuses a `destroy` followed by a `create` before any message, at the `destroy` line", () => {
      // Mermaid accepts `destroy B`, `create C`, `A->>C` and draws C's box on
      // `A->>C` and B's lifeline to the bottom, as if B were never
      // destroyed; it refuses the document only when the message after that
      // one does not touch B, as `A->>A` here does not.
      // Positions: 1–2 participants, 3 destroy B, 4 create C, 5 A->>C, 6 A->>A.
      const result = build("participant A\nparticipant B\ndestroy B\ncreate participant C\nA->>C: hello\nA->>A: other");

      expect(result.diagnostics).toEqual([
        'error 4:1: The destroyed participant "B" has no destroying message: the message sent by or to it must come right after the destroy, with no "create" in between.',
      ]);
      expect(result.destroyedAt).toEqual({ A: null, B: 3, C: null });
      expect(result.createdAt).toEqual({ A: 0, B: 0, C: 5 });
    });

    it("refuses a `create` followed by another `create` before any message, at the first one's line", () => {
      // Mermaid accepts `create C`, `create D`, `A->>D`, draws D's box on
      // `A->>D` and C's at the top, as if C were declared there.
      // Positions: 1 participant A, 2 create C, 3 create D, 4 A->>D.
      const result = build("participant A\ncreate participant C\ncreate participant D\nA->>D: make");

      expect(result.diagnostics).toEqual([
        'error 3:1: The created participant "C" has no creating message: the message sent to it must come right after the create, with no "create" in between.',
      ]);
      expect(result.createdAt).toEqual({ A: 0, C: 2, D: 4 });
    });

    it("refuses a `create` followed by a `destroy` before any message, at the `create` line, and still checks the `destroy` against that message", () => {
      // Mermaid accepts `create C`, `destroy B`, `A->>C`, `B->>A`, draws C's
      // box on `A->>C` and B's lifeline to the bottom, as if B were never
      // destroyed. Siren's `destroy B` is the latest declaration, so
      // `A->>C`, which does not touch B, is checked as its message too.
      // Positions: 1–2 participants, 3 create C, 4 destroy B, 5 A->>C, 6 B->>A.
      const result = build("participant A\nparticipant B\ncreate participant C\ndestroy B\nA->>C: make\nB->>A: bye");

      expect(result.diagnostics).toEqual([
        'error 4:1: The created participant "C" has no creating message: the message sent to it must come right after the create, with no "destroy" in between.',
        'error 5:1: The destroyed participant "B" has no destroying message: the next message must be sent by or to it.',
        'warning 7:1: Message "B-A" references participant "B", whose lifeline already ended — the arrow points past the destroy mark',
      ]);
      expect(result.createdAt).toEqual({ A: 0, B: 0, C: 3 });
      expect(result.destroyedAt).toEqual({ A: null, B: 4, C: null });
    });

    it("does not warn that a message ends past B's destroy mark when it is B's own destroying message, after an interrupted `create`", () => {
      // `create C`, `destroy B`, `B->>C`: C's `create` is refused, and
      // `B->>C` is B's destroying message — not a message past B's end.
      // Positions: 1–2 participants, 3 create C, 4 destroy B, 5 B->>C.
      const result = build("participant A\nparticipant B\ncreate participant C\ndestroy B\nB->>C: bye");

      expect(result.diagnostics).toEqual([
        'error 4:1: The created participant "C" has no creating message: the message sent to it must come right after the create, with no "destroy" in between.',
      ]);
      expect(result.destroyedAt).toEqual({ A: null, B: 5, C: null });
      expect(result.creates).toEqual([["B-C", null]]);
    });

    it("refuses a `destroy` or a `create` with a note before its message, and keeps the lifeline's end or start at the declaration", () => {
      // Mermaid accepts both and draws them as if neither declaration were
      // written: B's lifeline runs to the bottom, C's box sits at the top.
      // Positions: 1–2 participants, 3 destroy B, 4 note, 5 A->>B.
      const destroyed = build("participant A\nparticipant B\ndestroy B\nNote over A: aside\nA->>B: bye");
      expect(destroyed.diagnostics).toEqual([
        'error 4:1: The destroyed participant "B" has no destroying message: the message sent by or to it must come right after the destroy, with no "note" in between.',
        'warning 6:1: Message "A-B" references participant "B", whose lifeline already ended — the arrow points past the destroy mark',
      ]);
      expect(destroyed.destroyedAt).toEqual({ A: null, B: 3 });

      // Positions: 1 participant A, 2 create C, 3 note, 4 A->>C.
      const created = build("participant A\ncreate participant C\nnote over A: aside\nA->>C: make");
      expect(created.diagnostics).toEqual([
        'error 3:1: The created participant "C" has no creating message: the message sent to it must come right after the create, with no "note" in between.',
      ]);
      expect(created.createdAt).toEqual({ A: 0, C: 2 });
      expect(created.creates).toEqual([["A-C", null]]);
    });

    it("refuses a `destroy` or a `create` with an `activate` or a `deactivate` before its message", () => {
      // Measured: Mermaid draws these as it draws a note in between — B's
      // lifeline to the bottom, C's box at the top.
      const activated = build("participant A\nparticipant B\ndestroy B\nactivate A\nB->>A: bye\ndeactivate A");
      expect(activated.diagnostics).toEqual([
        'error 4:1: The destroyed participant "B" has no destroying message: the message sent by or to it must come right after the destroy, with no "activate" in between.',
        'warning 6:1: Message "B-A" references participant "B", whose lifeline already ended — the arrow points past the destroy mark',
      ]);

      const deactivated = build("participant A\nactivate A\nA->>A: think\ncreate participant C\ndeactivate A\nA->>C: make");
      expect(deactivated.diagnostics).toEqual([
        'error 5:1: The created participant "C" has no creating message: the message sent to it must come right after the create, with no "deactivate" in between.',
      ]);
    });

    it("refuses a `destroy` or a `create` with an `autonumber` before its message", () => {
      // Measured on Mermaid 12.2.0: `autonumber` and `autonumber off` are
      // records too, drawn past as a note is.
      expect(build("participant A\nparticipant B\ndestroy B\nautonumber\nA->>B: bye").diagnostics[0]).toBe(
        'error 4:1: The destroyed participant "B" has no destroying message: the message sent by or to it must come right after the destroy, with no "autonumber" in between.',
      );
      expect(build("autonumber\nparticipant A\ncreate participant C\nautonumber off\nA->>C: make").diagnostics).toEqual([
        'error 4:1: The created participant "C" has no creating message: the message sent to it must come right after the create, with no "autonumber" in between.',
      ]);
    });

    it("lets a participant declaration, a link or an activation written on the message itself stand next to the pair", () => {
      // Measured on Mermaid 12.2.0: none of these is a record of its own
      // between the two (`A->>+B` and `B-->>-A` record the message first), so
      // the pair is drawn.
      // Positions: 1–2 participants, 3 destroy B, 4 participant E, 5 A->>+B.
      const declared = build("participant A\nparticipant B\ndestroy B\nparticipant E\nlink A: Docs @ https://x.com\nA->>+B: bye");
      expect(declared.diagnostics).toEqual([]);
      expect(declared.destroyedAt).toEqual({ A: null, B: 5, E: null });

      const created = build("participant A\ncreate participant C\nparticipant E\nA->>+C: make\nC-->>-A: done");
      expect(created.diagnostics).toEqual([]);
      expect(created.creates).toEqual([
        ["A-C", "C"],
        ["C-A", null],
      ]);
    });
  });

  describe("creating messages (the message right after `create participant X`, which must be sent to X)", () => {
    it("starts X's lifeline at the message sent to X right after `create participant X`, and marks that message alone", () => {
      // Positions: 1 participant A, 2 create C, 3 A->>C make — the creating
      // message, 4 A->>C again.
      const result = build("participant A\ncreate participant C\nA->>C: make\nA->>C: again");

      expect(result.diagnostics).toEqual([]);
      expect(result.createdAt).toEqual({ A: 0, C: 3 });
      expect(result.creates).toEqual([
        ["A-C", "C"],
        ["A-C#2", null],
      ]);
    });

    it("refuses a `create participant X` whose next message is sent by X, at the `create` line and column, saying why without naming Mermaid", () => {
      const result = build("participant A\n  create participant C\nC->>A: hi");

      expect(result.diagnostics).toEqual([
        'error 3:3: The created participant "C" has no creating message: the next message must be sent to it.',
      ]);
      expect(result.diagnostics.join("\n")).not.toMatch(/mermaid/i);
      expect(result.creates).toEqual([["C-A", null]]);
    });

    it("refuses a `create participant X` whose next message does not touch X, keeping X's lifeline at the `create`", () => {
      // Positions: 1–2 participants, 3 create C, 4 A->>B.
      const result = build("participant A\nparticipant B\ncreate participant C\nA->>B: hi");

      expect(result.diagnostics).toEqual([
        'error 4:1: The created participant "C" has no creating message: the next message must be sent to it.',
      ]);
      expect(result.createdAt).toEqual({ A: 0, B: 0, C: 3 });
    });

    it("refuses a `create` whose message is past a block boundary, naming the boundary", () => {
      // Measured on Mermaid 12.2.0: accepted, and C's box is drawn at the top.
      const result = build(["participant A", "alt first", "create participant C", "else second", "A->>C: make", "end"].join("\n"));

      expect(result.diagnostics).toEqual([
        'error 4:1: The created participant "C" has no creating message: the message sent to it must come right after the create, with no "else" in between.',
      ]);
      expect(result.creates).toEqual([["A-C", null]]);
    });
  });

  describe("a `create` or `destroy` with no message after it (drawn as Mermaid draws it, nook 01M4YWYFJ)", () => {
    // Measured on Mermaid 12.2.0 (layout-stubbed render): a declaration with
    // no message after it pairs with nothing, so it draws nothing — a
    // `destroy`ed participant's lifeline runs to the bottom row with its box
    // there and no X; a `create`d participant is drawn like any other, its
    // box in the top row and the bottom row and its lifeline full height;
    // and neither takes a row of its own.
    it("leaves a participant destroyed by nothing when its `destroy` has no message after it", () => {
      const result = build("participant A\nparticipant B\nA->>B: hi\ndestroy B");

      expect(result.destroyedAt).toEqual({ A: null, B: null });
      expect(result.model.statements.at(-1)).toEqual({ kind: "destroy", id: "B" });
    });

    it("resolves a `create`d participant with no message after its `create` as one drawn from the top: origin declared, createdAt 0", () => {
      const result = build("participant A\nA->>A: think\ncreate actor C");

      expect(result.model.participants.find((p) => p.id === "C")).toMatchObject({
        participantKind: "actor",
        origin: "declared",
        createdAt: 0,
        destroyedAt: null,
      });
      expect(result.lanes).toEqual(["A", "C"]);
    });

    it("undoes every declaration still waiting at the end, interrupted or not, and refuses none of them", () => {
      // Measured on Mermaid 12.2.0: `destroy B`, `destroy C` at the end draw
      // B and C never destroyed; a note after `destroy B`, or a block's `end`
      // after `create participant C`, draw the same as nothing after it.
      const twoAtEnd = build("participant A\nparticipant B\nparticipant C\nA->>B: hi\nA->>C: hi\ndestroy B\ndestroy C");
      expect(twoAtEnd.diagnostics.filter((d) => d.startsWith("error"))).toEqual([]);
      expect(twoAtEnd.destroyedAt).toEqual({ A: null, B: null, C: null });

      const noteAfter = build("participant A\nparticipant B\nA->>B: hi\ndestroy B\nnote over A: done");
      expect(noteAfter.diagnostics.filter((d) => d.startsWith("error"))).toEqual([]);
      expect(noteAfter.destroyedAt).toEqual({ A: null, B: null });

      const endAfter = build("participant A\nloop again\nA->>A: hi\ncreate participant C\nend");
      expect(endAfter.diagnostics.filter((d) => d.startsWith("error"))).toEqual([]);
      expect(endAfter.model.participants.find((p) => p.id === "C")).toMatchObject({ origin: "declared", createdAt: 0 });

      const destroyThenCreate = build("participant A\nparticipant B\nA->>B: hi\ndestroy B\ncreate participant C");
      expect(destroyThenCreate.diagnostics.filter((d) => d.startsWith("error"))).toEqual([]);
      expect(destroyThenCreate.destroyedAt).toEqual({ A: null, B: null, C: null });
      expect(destroyThenCreate.createdAt).toEqual({ A: 0, B: 0, C: 0 });
    });

    it("does not refuse a second `destroy B` while the first is still waiting, and leaves B destroyed by neither", () => {
      // Measured on Mermaid 12.2.0: accepted, B drawn never destroyed. Only a
      // `destroy` of a participant some message already destroyed is refused.
      const result = build("participant A\nparticipant B\nA->>B: hi\ndestroy B\ndestroy B");

      expect(result.diagnostics.filter((d) => d.startsWith("error"))).toEqual([]);
      expect(result.destroyedAt).toEqual({ A: null, B: null });
    });

    it("reads a repeated `destroy B` while B's is still waiting as that same declaration, pairing it with the message after", () => {
      // Measured on Mermaid 12.2.0 (layout-stubbed render): `destroy B`,
      // `destroy B`, `A-xB` draws exactly what one `destroy B` does — B ends
      // on `A-xB` — since Mermaid keeps one pending destroy per participant.
      // Positions: 1–2 participants, 3 A->>B, 4 destroy B, 5 destroy B, 6 A-xB.
      const repeated = build("participant A\nparticipant B\nA->>B: hi\ndestroy B\ndestroy B\nA-xB: bye");
      expect(repeated.diagnostics).toEqual([]);
      expect(repeated.destroyedAt).toEqual({ A: null, B: 6 });

      // A different participant's `destroy` in between is still refused:
      // Mermaid checks only the latest, ends B on `A-xB` and draws C never
      // destroyed, in silence.
      const between = build("participant A\nparticipant B\nparticipant C\ndestroy B\ndestroy C\ndestroy B\nA-xB: bye");
      expect(between.diagnostics).toEqual([
        'error 6:1: The destroyed participant "C" has no destroying message: the message sent by or to it must come right after the destroy, with no "destroy" in between.',
      ]);
      expect(between.destroyedAt).toMatchObject({ B: 7 });
    });

    it("still refuses a repeated `create` of the same participant, as Mermaid refuses a second actor with one id", () => {
      expect(build("participant A\ncreate participant C\ncreate participant C\nA->>C: make").diagnostics).toEqual([
        'error 4:1: create participant "C" comes after "C" is already used; a created participant must be created before it is first named',
      ]);
    });

    it("warns at each such declaration that it draws nothing, saying how to pair it, without naming Mermaid", () => {
      const result = build("participant A\nparticipant B\nA->>B: hi\n  destroy B\ncreate participant C");

      expect(result.diagnostics).toEqual([
        'warning 5:3: The destroyed participant "B" has no destroying message, so the destroy draws nothing: its lifeline runs to the bottom. A message sent by or to it right after the destroy ends it there.',
        'warning 6:1: The created participant "C" has no creating message, so the create draws nothing: its lifeline starts at the top. A message sent to it right after the create starts it there.',
      ]);
      expect(result.diagnostics.join("\n")).not.toMatch(/mermaid/i);
    });
  });

  describe("a `destroy` naming a participant nothing else has named yet (ADR-0013 amendment)", () => {
    // Measured on Mermaid 12.2.0: `destroy Z` records a pending destroy and
    // nothing else; it does not add Z to the actors. Z gets a lane only from
    // a statement that does name it — typically its destroying message.
    it("gives Z no lane when nothing but its `destroy` names it, at the end or inside a block", () => {
      const atEnd = build("A->>B: hi\ndestroy Z");
      expect(atEnd.lanes).toEqual(["A", "B"]);

      const inBlock = build("A->>B: hi\nloop again\ndestroy Z\nend");
      expect(inBlock.lanes).toEqual(["A", "B"]);
    });

    it("places Z's lane where its destroying message first names it, and ends Z on that message", () => {
      // Measured on Mermaid 12.2.0 (layout-stubbed render): `A->>B`,
      // `destroy Z`, `C-xZ` draws lanes A, B, C, Z — C before Z, the order
      // the message names them in — with Z's lifeline ending on `C-xZ`.
      // Positions: 1 A->>B, 2 destroy Z, 3 C-xZ.
      const result = build("A->>B: hi\ndestroy Z\nC-xZ: bye");

      expect(result.diagnostics).toEqual([]);
      expect(result.lanes).toEqual(["A", "B", "C", "Z"]);
      expect(result.destroyedAt).toEqual({ A: null, B: null, C: null, Z: 3 });
      const messages = result.model.statements.flatMap((s) => (s.kind === "message" ? [s.message] : []));
      expect(messages.map((m) => [m.id, m.destroys ?? null])).toEqual([
        ["A-B", null],
        ["C-Z", "Z"],
      ]);
    });

    it("refuses a `destroy Z` whose next message does not touch Z, and still gives Z no lane", () => {
      // Mermaid 12.2.0 refuses the document ("The destroyed participant …
      // does not have an associated destroying message").
      const result = build("A->>B: hi\ndestroy Z\nA->>B: again");

      expect(result.diagnostics).toEqual([
        'error 3:1: The destroyed participant "Z" has no destroying message: the next message must be sent by or to it.',
      ]);
      expect(result.lanes).toEqual(["A", "B"]);
    });

    it("lets `create participant Z` follow `destroy Z`, since the `destroy` did not name Z, refusing the interrupted `destroy`", () => {
      // Measured on Mermaid 12.2.0 (layout-stubbed render): `destroy Z`,
      // `create participant Z`, `A->>Z` is accepted — Mermaid's "actors with
      // the same id" check finds no Z — and draws Z created on `A->>Z`, never
      // destroyed. The `destroy` is interrupted by the `create`, so Siren
      // refuses it as it refuses any interrupted declaration.
      // Positions: 1 A->>B, 2 destroy Z, 3 create Z, 4 A->>Z.
      const result = build("A->>B: hi\ndestroy Z\ncreate participant Z\nA->>Z: new");

      expect(result.diagnostics).toEqual([
        'error 3:1: The destroyed participant "Z" has no destroying message: the message sent by or to it must come right after the destroy, with no "create" in between.',
      ]);
      expect(result.lanes).toEqual(["A", "B", "Z"]);
      expect(result.model.participants.find((p) => p.id === "Z")).toMatchObject({
        origin: "created",
        createdAt: 4,
        destroyedAt: null,
      });
    });

    it("warns that a `destroy` with no message after it draws nothing, saying Z has no lane when nothing else names it", () => {
      const result = build("A->>B: hi\n  destroy Z");

      expect(result.diagnostics).toEqual([
        'warning 3:3: The destroyed participant "Z" has no destroying message, so the destroy draws nothing: no other statement names "Z", so it has no lane. A message sent by or to it right after the destroy draws its lane and ends it there.',
      ]);
      expect(result.diagnostics.join("\n")).not.toMatch(/mermaid/i);
    });
  });

  describe("whether a participant's `create` comes after something drawn", () => {
    // Measured on Mermaid 12.2.0 (layout-stubbed render, 150-wide boxes): a
    // created B's box sits at x 275, half its width right of the 200 a
    // declared B's would have, when anything was drawn before its `create`,
    // and at 200 when only declarations came before it.
    const createdAfterDrawing = (body: string, id = "B") =>
      build(body).model.participants.find((p) => p.id === id)?.createdAfterDrawing ?? false;

    it("says so for a `create` after a message, and not for one after nothing but declarations", () => {
      expect(createdAfterDrawing("participant A\nA->>A: x\ncreate participant B\nA->>B: hi")).toBe(true);
      expect(createdAfterDrawing("participant A\ncreate participant B\nA->>B: hi")).toBe(false);
      expect(createdAfterDrawing("participant A\nparticipant B\nA->>B: hi")).toBe(false);
    });

    it("counts a note, an activation and a block's start or end as drawn, at any depth, but not a `destroy` or a `link`", () => {
      // Measured: B at 275 after `note over A`, after `activate A`, first
      // inside a `loop`, and after an empty `loop`; at 200 after a `link`
      // only, and at 400 — where a declared B's would be, after C — after
      // `destroy C` only.
      expect(createdAfterDrawing("participant A\nnote over A: n\ncreate participant B\nA->>B: hi")).toBe(true);
      expect(createdAfterDrawing("participant A\nactivate A\ncreate participant B\nA->>B: hi\ndeactivate A")).toBe(true);
      expect(createdAfterDrawing("participant A\nloop L\ncreate participant B\nA->>B: hi\nend")).toBe(true);
      expect(createdAfterDrawing("participant A\nloop L\nend\ncreate participant B\nA->>B: hi")).toBe(true);
      expect(createdAfterDrawing("participant A\nlink A: x @ https://e.x\ncreate participant B\nA->>B: hi")).toBe(false);
      expect(createdAfterDrawing("participant A\nparticipant C\ndestroy C\ncreate participant B")).toBe(false);
    });

    it("counts an `autonumber` and an `autonumber off` as drawn, though neither numbers anything", () => {
      // Measured: `autonumber`, `autonumber off`, `create participant B`,
      // `A->>B` puts B at 275, and so does a lone `autonumber off`, with or
      // without the `A->>B`.
      expect(createdAfterDrawing("participant A\nautonumber\nautonumber off\ncreate participant B\nA->>B: hi")).toBe(true);
      expect(createdAfterDrawing("participant A\nautonumber off\ncreate participant B")).toBe(true);
    });
  });
});
