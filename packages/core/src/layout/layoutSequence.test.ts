import { describe, expect, it } from "vitest";
import type { SequenceModel, TextMeasurer } from "../contracts";
import { layoutSequence } from "./layoutSequence";

/** Deterministic fake measurer, same fixture pattern as layoutGraph.test.ts. */
const fakeMeasurer: TextMeasurer = {
  measure(text: string) {
    return { width: text.length * 8, height: 24 };
  },
};

function coreModel(): SequenceModel {
  return {
    title: null,
    participants: [
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
      {
        id: "C",
        label: "Carol",
        participantKind: "participant",
        origin: "declared",
        createdAt: 0,
        destroyedAt: null,
      },
    ],
    boxes: [],
    statements: [
      {
        kind: "message",
        message: {
          id: "A-B",
          from: "A",
          to: "B",
          text: "Hello Bob",
          arrow: { line: "solid", head: "filled" },
          autonumber: null,
        },
      },
      {
        kind: "message",
        message: {
          id: "B-C",
          from: "B",
          to: "C",
          text: "Hi Carol",
          arrow: { line: "dotted", head: "open" },
          autonumber: null,
        },
      },
    ],
  };
}

describe("layoutSequence", () => {
  it("assigns each participant a distinct x in declaration order, sized from its label", () => {
    const model = coreModel();

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
    expect(byId.A.x).toBeLessThan(byId.B.x);
    expect(byId.B.x).toBeLessThan(byId.C.x);

    for (const decl of model.participants) {
      const measured = fakeMeasurer.measure(decl.label);
      expect(byId[decl.id].width).toBeGreaterThanOrEqual(measured.width);
      expect(byId[decl.id].height).toBeGreaterThanOrEqual(measured.height);
    }
  });

  it("assigns each message a y strictly greater than every message before it, and endpoint x matching its lane centers", () => {
    const model = coreModel();

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    const messages = positioned.elements
      .filter((el): el is Extract<typeof el, { kind: "message" }> => el.kind === "message")
      .map((el) => el.message);

    expect(messages).toHaveLength(2);
    expect(messages[1].y).toBeGreaterThan(messages[0].y);

    const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
    expect(messages[0].fromX).toBe(byId.A.x);
    expect(messages[0].toX).toBe(byId.B.x);
    expect(messages[1].fromX).toBe(byId.B.x);
    expect(messages[1].toX).toBe(byId.C.x);
  });

  it("gives a self-message a distinct fromX/toX loop instead of a zero-length path", () => {
    const model: SequenceModel = {
      title: null,
      participants: [
        {
          id: "A",
          label: "Alice",
          participantKind: "participant",
          origin: "declared",
          createdAt: 0,
          destroyedAt: null,
        },
      ],
      boxes: [],
      statements: [
        {
          kind: "message",
          message: {
            id: "A-A",
            from: "A",
            to: "A",
            text: "Think",
            arrow: { line: "solid", head: "filled" },
            autonumber: null,
          },
        },
      ],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    const message = (
      positioned.elements[0] as Extract<
        (typeof positioned.elements)[number],
        { kind: "message" }
      >
    ).message;

    expect(message.from).toBe(message.to);
    expect(message.fromX).not.toBe(message.toX);
  });

  it("returns width/height that bound every participant and message computed", () => {
    const model = coreModel();

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    for (const participant of positioned.participants) {
      expect(participant.x + participant.width / 2).toBeLessThanOrEqual(positioned.width);
      expect(participant.bottom).toBeLessThanOrEqual(positioned.height);
    }

    for (const el of positioned.elements) {
      if (el.kind !== "message") continue;
      expect(el.message.fromX).toBeLessThanOrEqual(positioned.width);
      expect(el.message.toX).toBeLessThanOrEqual(positioned.width);
      expect(el.message.y).toBeLessThanOrEqual(positioned.height);
    }
  });

  it("reserves space for a title above the first participant row and carries it through unchanged", () => {
    const withoutTitle = coreModel();
    const withTitle: SequenceModel = { ...coreModel(), title: "My Diagram" };

    const positionedWithout = layoutSequence(withoutTitle, { measureText: fakeMeasurer });
    const positionedWith = layoutSequence(withTitle, { measureText: fakeMeasurer });

    expect(positionedWith.title).toBe("My Diagram");
    expect(positionedWithout.title).toBeNull();

    const firstMessageWithout = (
      positionedWithout.elements[0] as Extract<
        (typeof positionedWithout.elements)[number],
        { kind: "message" }
      >
    ).message;
    const firstMessageWith = (
      positionedWith.elements[0] as Extract<
        (typeof positionedWith.elements)[number],
        { kind: "message" }
      >
    ).message;

    expect(firstMessageWith.y).toBeGreaterThan(firstMessageWithout.y);
    expect(positionedWith.height).toBeGreaterThan(positionedWithout.height);
  });
});
