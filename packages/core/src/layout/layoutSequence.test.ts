import { describe, expect, it } from "vitest";
import type {
  PositionedSequenceElement,
  ResolvedSequenceBlock,
  ResolvedSequenceParticipant,
  ResolvedSequenceStatement,
  SequenceModel,
  TextMeasurer,
} from "../contracts";
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

/** A preamble-declared participant: full-height lifeline, boxes at both ends. */
function declaredParticipant(id: string, label: string): ResolvedSequenceParticipant {
  return {
    id,
    label,
    participantKind: "participant",
    origin: "declared",
    createdAt: 0,
    destroyedAt: null,
  };
}

function messageStatement(
  id: string,
  from: string,
  to: string,
  text: string,
): ResolvedSequenceStatement {
  return {
    kind: "message",
    message: {
      id,
      from,
      to,
      text,
      arrow: { line: "solid", head: "filled" },
      autonumber: null,
    },
  };
}

function messagesOf(positioned: { elements: PositionedSequenceElement[] }) {
  return positioned.elements
    .filter((el): el is Extract<PositionedSequenceElement, { kind: "message" }> =>
      el.kind === "message",
    )
    .map((el) => el.message);
}

function destroyMarksOf(positioned: { elements: PositionedSequenceElement[] }) {
  return positioned.elements
    .filter((el): el is Extract<PositionedSequenceElement, { kind: "destroyMark" }> =>
      el.kind === "destroyMark",
    )
    .map((el) => el.mark);
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

  it("gives a loop wrapping two messages a box spanning its two adjacent participant lanes, enclosing both messages vertically", () => {
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
        {
          id: "B",
          label: "Bob",
          participantKind: "participant",
          origin: "declared",
          createdAt: 0,
          destroyedAt: null,
        },
      ],
      boxes: [],
      statements: [
        {
          kind: "block",
          block: {
            id: "loop-1",
            kind: "loop",
            touchedParticipantIds: ["A", "B"],
            branches: [
              {
                label: "Every minute",
                statements: [
                  {
                    kind: "message",
                    message: {
                      id: "A-B-1",
                      from: "A",
                      to: "B",
                      text: "Poll",
                      arrow: { line: "solid", head: "filled" },
                      autonumber: null,
                    },
                  },
                  {
                    kind: "message",
                    message: {
                      id: "B-A-1",
                      from: "B",
                      to: "A",
                      text: "Ack",
                      arrow: { line: "dotted", head: "open" },
                      autonumber: null,
                    },
                  },
                ],
              },
            ],
          } satisfies ResolvedSequenceBlock,
        },
      ],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    expect(positioned.elements).toHaveLength(1);
    const blockElement = positioned.elements[0];
    expect(blockElement.kind).toBe("block");
    if (blockElement.kind !== "block") throw new Error("expected block element");
    const block = blockElement.block;

    const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));

    // x-range spans both lanes, with visible padding beyond each lane's own box.
    expect(block.x).toBeLessThan(byId.A.x - byId.A.width / 2);
    expect(block.x + block.width).toBeGreaterThan(byId.B.x + byId.B.width / 2);

    // y-range encloses the header label plus both messages.
    expect(block.label).toBe("Every minute");
    expect(block.children).toHaveLength(2);
    const [first, second] = block.children as Extract<
      PositionedSequenceElement,
      { kind: "message" }
    >[];
    expect(block.y).toBeLessThan(first.message.y);
    expect(block.y + block.height).toBeGreaterThan(second.message.y);
  });

  it("gives an alt with two branches one divider labeled with the else branch's condition, positioned between the branches", () => {
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
        {
          id: "B",
          label: "Bob",
          participantKind: "participant",
          origin: "declared",
          createdAt: 0,
          destroyedAt: null,
        },
      ],
      boxes: [],
      statements: [
        {
          kind: "block",
          block: {
            id: "alt-1",
            kind: "alt",
            touchedParticipantIds: ["A", "B"],
            branches: [
              {
                label: "is valid",
                statements: [
                  {
                    kind: "message",
                    message: {
                      id: "A-B-1",
                      from: "A",
                      to: "B",
                      text: "OK",
                      arrow: { line: "solid", head: "filled" },
                      autonumber: null,
                    },
                  },
                ],
              },
              {
                label: "is invalid",
                statements: [
                  {
                    kind: "message",
                    message: {
                      id: "A-B-2",
                      from: "A",
                      to: "B",
                      text: "Error",
                      arrow: { line: "solid", head: "filled" },
                      autonumber: null,
                    },
                  },
                ],
              },
            ],
          } satisfies ResolvedSequenceBlock,
        },
      ],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    const blockElement = positioned.elements[0];
    if (blockElement.kind !== "block") throw new Error("expected block element");
    const block = blockElement.block;

    expect(block.label).toBe("is valid");
    expect(block.dividers).toHaveLength(1);
    expect(block.dividers[0].label).toBe("is invalid");

    expect(block.children).toHaveLength(2);
    const [first, second] = block.children as Extract<
      PositionedSequenceElement,
      { kind: "message" }
    >[];
    // Divider sits between the first branch's message and the second's.
    expect(block.dividers[0].y).toBeGreaterThan(first.message.y);
    expect(block.dividers[0].y).toBeLessThan(second.message.y);
  });

  it("spans a block touching non-adjacent lanes across the untouched lane in between, matching Mermaid's own behavior", () => {
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
        {
          id: "B",
          label: "Bob",
          participantKind: "participant",
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
          kind: "block",
          block: {
            id: "opt-1",
            kind: "opt",
            // Touches only the outer lanes A and C — B is declared but not referenced.
            touchedParticipantIds: ["A", "C"],
            branches: [
              {
                label: "maybe",
                statements: [
                  {
                    kind: "message",
                    message: {
                      id: "A-C-1",
                      from: "A",
                      to: "C",
                      text: "Ping",
                      arrow: { line: "solid", head: "filled" },
                      autonumber: null,
                    },
                  },
                ],
              },
            ],
          } satisfies ResolvedSequenceBlock,
        },
      ],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });
    const blockElement = positioned.elements[0];
    if (blockElement.kind !== "block") throw new Error("expected block element");
    const block = blockElement.block;

    const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));

    // Box spans from A's lane to C's lane, visually covering B's lane in between.
    expect(block.x).toBeLessThan(byId.A.x - byId.A.width / 2);
    expect(block.x + block.width).toBeGreaterThan(byId.C.x + byId.C.width / 2);
    expect(block.x).toBeLessThan(byId.B.x - byId.B.width / 2);
    expect(block.x + block.width).toBeGreaterThan(byId.B.x + byId.B.width / 2);
  });

  it("fully contains each nested block's box within its parent's, with visible padding, three levels deep", () => {
    const innermostMessage: ResolvedSequenceStatement = {
      kind: "message",
      message: {
        id: "B-C-1",
        from: "B",
        to: "C",
        text: "Work",
        arrow: { line: "solid", head: "filled" },
        autonumber: null,
      },
    };
    const innermost: ResolvedSequenceBlock = {
      id: "par-1",
      kind: "par",
      touchedParticipantIds: ["B", "C"],
      branches: [{ label: "path 1", statements: [innermostMessage] }],
    };
    const middle: ResolvedSequenceBlock = {
      id: "alt-1",
      kind: "alt",
      touchedParticipantIds: ["B", "C"],
      branches: [{ label: "ready", statements: [{ kind: "block", block: innermost }] }],
    };
    const outer: ResolvedSequenceBlock = {
      id: "loop-1",
      kind: "loop",
      touchedParticipantIds: ["A", "B", "C"],
      branches: [
        {
          label: "retry",
          statements: [
            {
              kind: "message",
              message: {
                id: "A-B-1",
                from: "A",
                to: "B",
                text: "Start",
                arrow: { line: "solid", head: "filled" },
                autonumber: null,
              },
            },
            { kind: "block", block: middle },
          ],
        },
      ],
    };

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
        {
          id: "B",
          label: "Bob",
          participantKind: "participant",
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
      statements: [{ kind: "block", block: outer }],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    const outerEl = positioned.elements[0];
    if (outerEl.kind !== "block") throw new Error("expected outer block element");
    const outerBlock = outerEl.block;

    const middleEl = outerBlock.children.find(
      (el): el is Extract<PositionedSequenceElement, { kind: "block" }> => el.kind === "block",
    );
    if (!middleEl) throw new Error("expected middle block element");
    const middleBlock = middleEl.block;

    const innerEl = middleBlock.children.find(
      (el): el is Extract<PositionedSequenceElement, { kind: "block" }> => el.kind === "block",
    );
    if (!innerEl) throw new Error("expected inner block element");
    const innerBlock = innerEl.block;

    // Each parent's box fully contains its child's, with a visible gap on every edge.
    expect(outerBlock.x).toBeLessThan(middleBlock.x);
    expect(outerBlock.x + outerBlock.width).toBeGreaterThan(middleBlock.x + middleBlock.width);
    expect(outerBlock.y).toBeLessThan(middleBlock.y);
    expect(outerBlock.y + outerBlock.height).toBeGreaterThan(middleBlock.y + middleBlock.height);

    expect(middleBlock.y).toBeLessThan(innerBlock.y);
    expect(middleBlock.y + middleBlock.height).toBeGreaterThan(innerBlock.y + innerBlock.height);
  });

  it("keeps every message's y strictly increasing in document order across the whole diagram, even nested inside blocks", () => {
    function participant(id: string, label: string) {
      return {
        id,
        label,
        participantKind: "participant" as const,
        origin: "declared" as const,
        createdAt: 0,
        destroyedAt: null,
      };
    }

    function message(id: string, from: string, to: string, text: string): ResolvedSequenceStatement {
      return {
        kind: "message",
        message: {
          id,
          from,
          to,
          text,
          arrow: { line: "solid", head: "filled" },
          autonumber: null,
        },
      };
    }

    const model: SequenceModel = {
      title: null,
      participants: [participant("A", "Alice"), participant("B", "Bob"), participant("C", "Carol")],
      boxes: [],
      statements: [
        message("m1", "A", "B", "before"),
        {
          kind: "block",
          block: {
            id: "loop-1",
            kind: "loop",
            touchedParticipantIds: ["A", "B", "C"],
            branches: [
              {
                label: "outer",
                statements: [
                  message("m2", "A", "B", "in outer"),
                  {
                    kind: "block",
                    block: {
                      id: "alt-1",
                      kind: "alt",
                      touchedParticipantIds: ["B", "C"],
                      branches: [
                        { label: "branch 1", statements: [message("m3", "B", "C", "branch 1 msg")] },
                        { label: "branch 2", statements: [message("m4", "B", "C", "branch 2 msg")] },
                      ],
                    } satisfies ResolvedSequenceBlock,
                  },
                  message("m5", "A", "B", "after nested block"),
                ],
              },
            ],
          } satisfies ResolvedSequenceBlock,
        },
        message("m6", "A", "C", "after loop"),
      ],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    function flattenMessageYs(elements: PositionedSequenceElement[]): number[] {
      const ys: number[] = [];
      for (const el of elements) {
        if (el.kind === "message") {
          ys.push(el.message.y);
        } else if (el.kind === "block") {
          ys.push(...flattenMessageYs(el.block.children));
        }
      }
      return ys;
    }

    const ys = flattenMessageYs(positioned.elements);
    expect(ys).toHaveLength(6);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    }
  });

  it("grows width/height to account for a block's frame, divider, and label space, while keeping every block box within bounds", () => {
    function participant(id: string, label: string) {
      return {
        id,
        label,
        participantKind: "participant" as const,
        origin: "declared" as const,
        createdAt: 0,
        destroyedAt: null,
      };
    }

    const withoutBlock: SequenceModel = {
      title: null,
      participants: [participant("A", "Alice"), participant("B", "Bob")],
      boxes: [],
      statements: [
        {
          kind: "message",
          message: {
            id: "m1",
            from: "A",
            to: "B",
            text: "Hi",
            arrow: { line: "solid", head: "filled" },
            autonumber: null,
          },
        },
      ],
    };

    const withBlock: SequenceModel = {
      ...withoutBlock,
      statements: [
        {
          kind: "block",
          block: {
            id: "alt-1",
            kind: "alt",
            touchedParticipantIds: ["A", "B"],
            branches: [
              {
                label: "branch 1",
                statements: [
                  {
                    kind: "message",
                    message: {
                      id: "m1",
                      from: "A",
                      to: "B",
                      text: "Hi",
                      arrow: { line: "solid", head: "filled" },
                      autonumber: null,
                    },
                  },
                ],
              },
              {
                label: "branch 2",
                statements: [
                  {
                    kind: "message",
                    message: {
                      id: "m2",
                      from: "B",
                      to: "A",
                      text: "Yo",
                      arrow: { line: "solid", head: "filled" },
                      autonumber: null,
                    },
                  },
                ],
              },
            ],
          } satisfies ResolvedSequenceBlock,
        },
      ],
    };

    const positionedWithout = layoutSequence(withoutBlock, { measureText: fakeMeasurer });
    const positionedWith = layoutSequence(withBlock, { measureText: fakeMeasurer });

    // The header, divider, and per-branch margins reserve real vertical space.
    expect(positionedWith.height).toBeGreaterThan(positionedWithout.height);

    function assertBlocksInBounds(elements: PositionedSequenceElement[]): void {
      for (const el of elements) {
        if (el.kind !== "block") continue;
        expect(el.block.x).toBeGreaterThanOrEqual(0);
        expect(el.block.x + el.block.width).toBeLessThanOrEqual(positionedWith.width);
        expect(el.block.y).toBeGreaterThanOrEqual(0);
        expect(el.block.y + el.block.height).toBeLessThanOrEqual(positionedWith.height);
        assertBlocksInBounds(el.block.children);
      }
    }

    assertBlocksInBounds(positionedWith.elements);
  });

  it("starts a created participant's lifeline at its create statement's y, below the messages that precede it", () => {
    const model: SequenceModel = {
      title: null,
      participants: [
        declaredParticipant("A", "Alice"),
        declaredParticipant("B", "Bob"),
        {
          id: "C",
          label: "Carol",
          participantKind: "participant",
          origin: "created",
          createdAt: 1,
          destroyedAt: null,
        },
      ],
      boxes: [],
      statements: [
        messageStatement("m1", "A", "B", "before create"),
        {
          kind: "participant",
          participant: {
            id: "C",
            label: "Carol",
            participantKind: "participant",
            origin: "created",
            createdAt: 1,
            destroyedAt: null,
          },
        },
        messageStatement("m2", "B", "C", "after create"),
      ],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
    const [before, after] = messagesOf(positioned);

    // The declared lanes still start at the diagram's participant row.
    expect(byId.A.top).toBe(byId.B.top);
    expect(byId.A.top).toBeLessThan(before.y);

    // Carol's lifeline (and her only box) begins at the create statement's position.
    expect(byId.C.top).toBeGreaterThan(before.y);
    expect(byId.C.top).toBeLessThan(after.y);
    // Her box fits between the create point and the message that follows it.
    expect(byId.C.top + byId.C.height).toBeLessThanOrEqual(after.y);
    // Undestroyed, she still runs to the diagram's bottom.
    expect(byId.C.bottom).toBe(byId.A.bottom);
  });

  it("ends a destroyed participant's lifeline at its destroy statement's y and emits a destroy mark there", () => {
    const model: SequenceModel = {
      title: null,
      participants: [
        declaredParticipant("A", "Alice"),
        { ...declaredParticipant("B", "Bob"), destroyedAt: 1 },
      ],
      boxes: [],
      statements: [
        messageStatement("m1", "A", "B", "goodbye"),
        { kind: "destroy", id: "B" },
        messageStatement("m2", "A", "A", "carry on"),
      ],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
    const [goodbye, carryOn] = messagesOf(positioned);
    const marks = destroyMarksOf(positioned);

    expect(marks).toHaveLength(1);
    expect(marks[0].participantId).toBe("B");
    expect(marks[0].x).toBe(byId.B.x);

    // The mark sits at the destroy statement's row, between the two messages.
    expect(marks[0].y).toBeGreaterThan(goodbye.y);
    expect(marks[0].y).toBeLessThan(carryOn.y);

    // Bob's lifeline stops there; Alice's still reaches the diagram's bottom.
    expect(byId.B.bottom).toBe(marks[0].y);
    expect(byId.B.bottom).toBeLessThan(byId.A.bottom);
    expect(byId.B.top).toBe(byId.A.top);
  });

  it("spans a created-then-destroyed participant's lifeline exactly between its create and destroy rows, even nested inside a block", () => {
    const carol: ResolvedSequenceParticipant = {
      id: "C",
      label: "Carol",
      participantKind: "actor",
      origin: "created",
      createdAt: 2,
      destroyedAt: 4,
    };

    const model: SequenceModel = {
      title: null,
      participants: [declaredParticipant("A", "Alice"), carol],
      boxes: [],
      statements: [
        messageStatement("m1", "A", "A", "before"),
        {
          kind: "block",
          block: {
            id: "loop-1",
            kind: "loop",
            touchedParticipantIds: ["A", "C"],
            branches: [
              {
                label: "each retry",
                statements: [
                  { kind: "participant", participant: carol },
                  messageStatement("m2", "A", "C", "work"),
                  { kind: "destroy", id: "C" },
                ],
              },
            ],
          } satisfies ResolvedSequenceBlock,
        },
        messageStatement("m3", "A", "A", "after"),
      ],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
    const blockElement = positioned.elements[1];
    if (blockElement.kind !== "block") throw new Error("expected block element");

    const [work] = messagesOf({ elements: blockElement.block.children });
    const [mark] = destroyMarksOf({ elements: blockElement.block.children });

    // Both ends of the span come from the nested statements, not the diagram edges.
    expect(byId.C.top).toBeGreaterThan(byId.A.top);
    expect(byId.C.top).toBeLessThan(work.y);
    expect(byId.C.bottom).toBe(mark.y);
    expect(mark.y).toBeGreaterThan(work.y);
    expect(byId.C.bottom).toBeLessThan(byId.A.bottom);

    // The enclosing block still contains the whole truncated lifeline.
    expect(blockElement.block.y).toBeLessThan(byId.C.top);
    expect(blockElement.block.y + blockElement.block.height).toBeGreaterThan(byId.C.bottom);
  });

  it("reserves a bottom row inside the diagram's height for participants that get a bottom box, and none when every participant is created or destroyed", () => {
    const withBottomRow: SequenceModel = {
      title: null,
      participants: [declaredParticipant("A", "Alice"), declaredParticipant("B", "Bob")],
      boxes: [],
      statements: [messageStatement("m1", "A", "B", "Hi")],
    };

    const positioned = layoutSequence(withBottomRow, { measureText: fakeMeasurer });
    const [message] = messagesOf(positioned);

    for (const participant of positioned.participants) {
      // A full box height fits between the last message and the lifeline's
      // end, and that end is still inside the diagram — so the bottom box
      // clears the diagram's content and never spills past its height.
      expect(participant.bottom - message.y).toBeGreaterThanOrEqual(participant.height);
      expect(participant.bottom).toBeLessThanOrEqual(positioned.height);
    }

    // Alice is declared but destroyed, Carol is created and destroyed: nobody
    // is eligible for a bottom box, so no bottom row is reserved.
    const carol: ResolvedSequenceParticipant = {
      id: "C",
      label: "Carol",
      participantKind: "participant",
      origin: "created",
      createdAt: 1,
      destroyedAt: 3,
    };
    const withoutBottomRow: SequenceModel = {
      title: null,
      participants: [{ ...declaredParticipant("A", "Alice"), destroyedAt: 4 }, carol],
      boxes: [],
      statements: [
        messageStatement("m1", "A", "A", "start"),
        { kind: "participant", participant: carol },
        messageStatement("m2", "A", "C", "work"),
        { kind: "destroy", id: "C" },
        { kind: "destroy", id: "A" },
      ],
    };

    const bare = layoutSequence(withoutBottomRow, { measureText: fakeMeasurer });
    const lastMarkY = Math.max(...destroyMarksOf(bare).map((mark) => mark.y));
    const shortestParticipant = Math.min(...bare.participants.map((p) => p.height));

    expect(lastMarkY).toBeLessThanOrEqual(bare.height);
    expect(bare.height - lastMarkY).toBeLessThan(shortestParticipant);
  });

  it("gives a box a background rect spanning its member lanes only, over the diagram's full height", () => {
    const model: SequenceModel = {
      title: "Grouped",
      participants: [
        declaredParticipant("A", "Alice"),
        declaredParticipant("B", "Bob"),
        declaredParticipant("C", "Carol"),
      ],
      boxes: [
        {
          id: "box-1",
          color: "rgb(200, 220, 255)",
          label: "Service tier",
          participantIds: ["A", "B"],
        },
      ],
      statements: [messageStatement("m1", "A", "C", "Ping")],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    expect(positioned.boxes).toHaveLength(1);
    const box = positioned.boxes[0];
    expect(box.id).toBe("box-1");
    expect(box.color).toBe("rgb(200, 220, 255)");
    expect(box.label).toBe("Service tier");

    const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));

    // Padding on both sides of the member lanes' own boxes.
    expect(box.x).toBeLessThan(byId.A.x - byId.A.width / 2);
    expect(box.x + box.width).toBeGreaterThan(byId.B.x + byId.B.width / 2);
    expect(box.x).toBeGreaterThanOrEqual(0);

    // Carol is not a member, so her lane stays outside the background.
    expect(box.x + box.width).toBeLessThan(byId.C.x - byId.C.width / 2);

    // Full diagram height: covers every member lifeline end to end, below the title.
    expect(box.y).toBeLessThanOrEqual(byId.A.top);
    expect(box.y + box.height).toBeGreaterThanOrEqual(byId.A.bottom);
    expect(box.y).toBeGreaterThan(0);
  });

  it("grows width for a box's background padding and keeps create/destroy geometry inside the diagram bounds", () => {
    const carol: ResolvedSequenceParticipant = {
      id: "C",
      label: "Carol",
      participantKind: "participant",
      origin: "created",
      createdAt: 1,
      destroyedAt: 3,
    };

    const withoutBox: SequenceModel = {
      title: null,
      participants: [declaredParticipant("A", "Alice"), declaredParticipant("B", "Bob"), carol],
      boxes: [],
      statements: [
        messageStatement("m1", "A", "B", "start"),
        { kind: "participant", participant: carol },
        messageStatement("m2", "B", "C", "work"),
        { kind: "destroy", id: "C" },
      ],
    };

    // The box wraps the rightmost lanes, so its padding sits beyond every
    // participant box the width already accounted for.
    const withBox: SequenceModel = {
      ...withoutBox,
      boxes: [{ id: "box-1", color: null, label: null, participantIds: ["B", "C"] }],
    };

    const positionedWithout = layoutSequence(withoutBox, { measureText: fakeMeasurer });
    const positionedWith = layoutSequence(withBox, { measureText: fakeMeasurer });

    expect(positionedWith.width).toBeGreaterThan(positionedWithout.width);

    const box = positionedWith.boxes[0];
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(positionedWith.width);
    expect(box.y + box.height).toBeLessThanOrEqual(positionedWith.height);

    const byId = Object.fromEntries(positionedWith.participants.map((p) => [p.id, p]));
    const [mark] = destroyMarksOf(positionedWith);

    // The created participant's box and the destroy mark both fit inside the height.
    expect(byId.C.top + byId.C.height).toBeLessThanOrEqual(positionedWith.height);
    expect(mark.y).toBeLessThanOrEqual(positionedWith.height);
    for (const participant of positionedWith.participants) {
      expect(participant.bottom).toBeLessThanOrEqual(positionedWith.height);
    }
  });

  it("reserves the top row's band below each declared participant's top, so the first message clears its box", () => {
    const model: SequenceModel = {
      title: null,
      participants: [declaredParticipant("A", "Alice"), declaredParticipant("B", "Bob")],
      boxes: [],
      statements: [messageStatement("m1", "A", "B", "first message")],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });
    const [first] = messagesOf(positioned);

    for (const participant of positioned.participants) {
      // A box hangs downward from `top` — the same band a `create` row
      // already reserves — so [top, top + height] has to end before the
      // first message row rather than straddle it.
      expect(participant.top).toBeGreaterThanOrEqual(0);
      expect(participant.top + participant.height).toBeLessThanOrEqual(first.y);
    }
  });

  it("keeps a block that opens the diagram below the top row's band, frame and message alike", () => {
    const model: SequenceModel = {
      title: null,
      participants: [declaredParticipant("A", "Alice"), declaredParticipant("B", "Bob")],
      boxes: [],
      statements: [
        {
          kind: "block",
          block: {
            id: "loop-1",
            kind: "loop",
            touchedParticipantIds: ["A", "B"],
            branches: [
              {
                label: "each retry",
                statements: [messageStatement("m1", "A", "B", "first message")],
              },
            ],
          } satisfies ResolvedSequenceBlock,
        },
      ],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });
    const blockElement = positioned.elements[0];
    if (blockElement.kind !== "block") throw new Error("expected block element");
    const [first] = messagesOf({ elements: blockElement.block.children });

    for (const participant of positioned.participants) {
      expect(participant.top + participant.height).toBeLessThanOrEqual(blockElement.block.y);
      expect(participant.top + participant.height).toBeLessThanOrEqual(first.y);
    }
  });

  it("leaves a labelled box's caption band clear of the participant boxes it groups", () => {
    const model: SequenceModel = {
      title: "Grouped",
      participants: [declaredParticipant("A", "Alice"), declaredParticipant("B", "Bob")],
      boxes: [
        { id: "box-1", color: null, label: "Service tier", participantIds: ["A", "B"] },
      ],
      statements: [messageStatement("m1", "A", "B", "Ping")],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });
    const box = positioned.boxes[0];
    const caption = fakeMeasurer.measure("Service tier");

    for (const participant of positioned.participants) {
      // The caption is drawn across the top of the background, above the
      // members — so a full line of it has to fit before the top row starts.
      expect(participant.top - box.y).toBeGreaterThanOrEqual(caption.height);
    }
    // The background still covers every member lifeline end to end.
    expect(box.y + box.height).toBeGreaterThanOrEqual(positioned.participants[0].bottom);
  });
});
