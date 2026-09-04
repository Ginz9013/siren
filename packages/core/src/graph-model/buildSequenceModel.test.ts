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
});
