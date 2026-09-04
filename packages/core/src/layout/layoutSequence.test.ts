import { describe, expect, it } from "vitest";
import type {
  PositionedSequenceElement,
  ResolvedSequenceBlock,
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
});
