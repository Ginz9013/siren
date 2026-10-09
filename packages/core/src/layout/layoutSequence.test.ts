import { describe, expect, it } from "vitest";
import { plainLabel, plainRun } from "../label/label";
import type {
  Label,
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
    accTitle: null,
    interactions: [],
    participants: [
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
      {
        id: "C",
        label: plainLabel("Carol"),
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
          label: plainLabel("Hello Bob"),
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
          label: plainLabel("Hi Carol"),
          arrow: { line: "dotted", head: "open" },
          autonumber: null,
        },
      },
    ],
    timeline: { totalSteps: 0, entries: [] },
  };
}

/** A preamble-declared participant: full-height lifeline, boxes at both ends. */
function declaredParticipant(id: string, label: string): ResolvedSequenceParticipant {
  return {
    id,
    label: plainLabel(label),
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
      label: plainLabel(text),
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

function notesOf(positioned: { elements: PositionedSequenceElement[] }) {
  return positioned.elements
    .filter((el): el is Extract<PositionedSequenceElement, { kind: "note" }> => el.kind === "note")
    .map((el) => el.note);
}

describe("layoutSequence", () => {
  it("assigns each participant a distinct x in declaration order, sized from its label", () => {
    const model = coreModel();

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
    expect(byId.A.x).toBeLessThan(byId.B.x);
    expect(byId.B.x).toBeLessThan(byId.C.x);

    for (const decl of model.participants) {
      const measured = fakeMeasurer.measure(decl.label.text);
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
      accTitle: null,
      interactions: [],
      participants: [
        {
          id: "A",
          label: plainLabel("Alice"),
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
            label: plainLabel("Think"),
            arrow: { line: "solid", head: "filled" },
            autonumber: null,
          },
        },
      ],
      timeline: { totalSteps: 0, entries: [] },
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
      accTitle: null,
      interactions: [],
      participants: [
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
            id: "loop:1",
            kind: "loop",
            touchedParticipantIds: ["A", "B"],
            color: null,
            branches: [
              {
                label: plainLabel("Every minute"),
                statements: [
                  {
                    kind: "message",
                    message: {
                      id: "A-B-1",
                      from: "A",
                      to: "B",
                      label: plainLabel("Poll"),
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
                      label: plainLabel("Ack"),
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
      timeline: { totalSteps: 0, entries: [] },
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
    expect(block.label?.label).toEqual(plainLabel("[Every minute]"));
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
      accTitle: null,
      interactions: [],
      participants: [
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
            id: "alt:1",
            kind: "alt",
            touchedParticipantIds: ["A", "B"],
            color: null,
            branches: [
              {
                label: plainLabel("is valid"),
                statements: [
                  {
                    kind: "message",
                    message: {
                      id: "A-B-1",
                      from: "A",
                      to: "B",
                      label: plainLabel("OK"),
                      arrow: { line: "solid", head: "filled" },
                      autonumber: null,
                    },
                  },
                ],
              },
              {
                label: plainLabel("is invalid"),
                statements: [
                  {
                    kind: "message",
                    message: {
                      id: "A-B-2",
                      from: "A",
                      to: "B",
                      label: plainLabel("Error"),
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
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    const blockElement = positioned.elements[0];
    if (blockElement.kind !== "block") throw new Error("expected block element");
    const block = blockElement.block;

    expect(block.label?.label).toEqual(plainLabel("[is valid]"));
    expect(block.dividers).toHaveLength(1);
    expect(block.dividers[0].label?.label).toEqual(plainLabel("[is invalid]"));

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
      accTitle: null,
      interactions: [],
      participants: [
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
          participantKind: "participant",
          origin: "declared",
          createdAt: 0,
          destroyedAt: null,
        },
        {
          id: "C",
          label: plainLabel("Carol"),
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
            id: "opt:1",
            kind: "opt",
            // Touches only the outer lanes A and C — B is declared but not referenced.
            touchedParticipantIds: ["A", "C"],
            color: null,
            branches: [
              {
                label: plainLabel("maybe"),
                statements: [
                  {
                    kind: "message",
                    message: {
                      id: "A-C-1",
                      from: "A",
                      to: "C",
                      label: plainLabel("Ping"),
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
      timeline: { totalSteps: 0, entries: [] },
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
        label: plainLabel("Work"),
        arrow: { line: "solid", head: "filled" },
        autonumber: null,
      },
    };
    const innermost: ResolvedSequenceBlock = {
      id: "par:1",
      kind: "par",
      touchedParticipantIds: ["B", "C"],
      color: null,
      branches: [{ label: plainLabel("path 1"), statements: [innermostMessage] }],
    };
    const middle: ResolvedSequenceBlock = {
      id: "alt:1",
      kind: "alt",
      touchedParticipantIds: ["B", "C"],
      color: null,
      branches: [{ label: plainLabel("ready"), statements: [{ kind: "block", block: innermost }] }],
    };
    const outer: ResolvedSequenceBlock = {
      id: "loop:1",
      kind: "loop",
      touchedParticipantIds: ["A", "B", "C"],
      color: null,
      branches: [
        {
          label: plainLabel("retry"),
          statements: [
            {
              kind: "message",
              message: {
                id: "A-B-1",
                from: "A",
                to: "B",
                label: plainLabel("Start"),
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
      accTitle: null,
      interactions: [],
      participants: [
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
          participantKind: "participant",
          origin: "declared",
          createdAt: 0,
          destroyedAt: null,
        },
        {
          id: "C",
          label: plainLabel("Carol"),
          participantKind: "participant",
          origin: "declared",
          createdAt: 0,
          destroyedAt: null,
        },
      ],
      boxes: [],
      statements: [{ kind: "block", block: outer }],
      timeline: { totalSteps: 0, entries: [] },
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
        label: plainLabel(label),
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
          label: plainLabel(text),
          arrow: { line: "solid", head: "filled" },
          autonumber: null,
        },
      };
    }

    const model: SequenceModel = {
      title: null,
      accTitle: null,
      interactions: [],
      participants: [participant("A", "Alice"), participant("B", "Bob"), participant("C", "Carol")],
      boxes: [],
      statements: [
        message("m1", "A", "B", "before"),
        {
          kind: "block",
          block: {
            id: "loop:1",
            kind: "loop",
            touchedParticipantIds: ["A", "B", "C"],
            color: null,
            branches: [
              {
                label: plainLabel("outer"),
                statements: [
                  message("m2", "A", "B", "in outer"),
                  {
                    kind: "block",
                    block: {
                      id: "alt:1",
                      kind: "alt",
                      touchedParticipantIds: ["B", "C"],
                      color: null,
                      branches: [
                        { label: plainLabel("branch 1"), statements: [message("m3", "B", "C", "branch 1 msg")] },
                        { label: plainLabel("branch 2"), statements: [message("m4", "B", "C", "branch 2 msg")] },
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
      timeline: { totalSteps: 0, entries: [] },
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
        label: plainLabel(label),
        participantKind: "participant" as const,
        origin: "declared" as const,
        createdAt: 0,
        destroyedAt: null,
      };
    }

    const withoutBlock: SequenceModel = {
      title: null,
      accTitle: null,
      interactions: [],
      participants: [participant("A", "Alice"), participant("B", "Bob")],
      boxes: [],
      statements: [
        {
          kind: "message",
          message: {
            id: "m1",
            from: "A",
            to: "B",
            label: plainLabel("Hi"),
            arrow: { line: "solid", head: "filled" },
            autonumber: null,
          },
        },
      ],
      timeline: { totalSteps: 0, entries: [] },
    };

    const withBlock: SequenceModel = {
      ...withoutBlock,
      statements: [
        {
          kind: "block",
          block: {
            id: "alt:1",
            kind: "alt",
            touchedParticipantIds: ["A", "B"],
            color: null,
            branches: [
              {
                label: plainLabel("branch 1"),
                statements: [
                  {
                    kind: "message",
                    message: {
                      id: "m1",
                      from: "A",
                      to: "B",
                      label: plainLabel("Hi"),
                      arrow: { line: "solid", head: "filled" },
                      autonumber: null,
                    },
                  },
                ],
              },
              {
                label: plainLabel("branch 2"),
                statements: [
                  {
                    kind: "message",
                    message: {
                      id: "m2",
                      from: "B",
                      to: "A",
                      label: plainLabel("Yo"),
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
      accTitle: null,
      interactions: [],
      participants: [
        declaredParticipant("A", "Alice"),
        declaredParticipant("B", "Bob"),
        {
          id: "C",
          label: plainLabel("Carol"),
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
            label: plainLabel("Carol"),
            participantKind: "participant",
            origin: "created",
            createdAt: 1,
            destroyedAt: null,
          },
        },
        messageStatement("m2", "B", "C", "after create"),
      ],
      timeline: { totalSteps: 0, entries: [] },
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
      accTitle: null,
      interactions: [],
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
      timeline: { totalSteps: 0, entries: [] },
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

  it("spans an activation bar from its activate statement's row to its deactivate statement's row, centered on the participant's lane", () => {
    const model: SequenceModel = {
      title: null,
      accTitle: null,
      interactions: [],
      participants: [declaredParticipant("A", "Alice"), declaredParticipant("B", "Bob")],
      boxes: [],
      statements: [
        messageStatement("m1", "A", "B", "request"),
        { kind: "activate", participantId: "B", activationId: "activation:1" },
        messageStatement("m2", "B", "A", "response"),
        { kind: "deactivate", participantId: "B" },
      ],
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    expect(positioned.activations).toHaveLength(1);
    const bar = positioned.activations[0]!;
    expect(bar.id).toBe("activation:1");
    expect(bar.participantId).toBe("B");

    const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
    const [request, response] = messagesOf(positioned);

    // Centered on B's lane.
    expect(bar.x).toBeLessThan(byId.B.x);
    expect(bar.x + bar.width).toBeGreaterThan(byId.B.x);

    // Opens at the request's row, closes at the response's row.
    expect(bar.y).toBe(request.y);
    expect(bar.y + bar.height).toBe(response.y);
  });

  it("offsets two stacked activations on one participant so both are visible, without changing either's width", () => {
    const model: SequenceModel = {
      title: null,
      accTitle: null,
      interactions: [],
      participants: [declaredParticipant("A", "Alice")],
      boxes: [],
      statements: [
        { kind: "activate", participantId: "A", activationId: "activation:1" },
        { kind: "activate", participantId: "A", activationId: "activation:2" },
        { kind: "deactivate", participantId: "A" },
        { kind: "deactivate", participantId: "A" },
      ],
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    expect(positioned.activations).toHaveLength(2);
    const outer = positioned.activations.find((a) => a.id === "activation:1")!;
    const inner = positioned.activations.find((a) => a.id === "activation:2")!;
    expect(outer.width).toBe(inner.width);
    expect(outer.x).not.toBe(inner.x);
  });

  it("extends an activation that is never deactivated to the diagram's own bottom, the same policy an un-destroyed lifeline gets", () => {
    const model: SequenceModel = {
      title: null,
      accTitle: null,
      interactions: [],
      participants: [declaredParticipant("A", "Alice"), declaredParticipant("B", "Bob")],
      boxes: [],
      statements: [
        messageStatement("m1", "A", "B", "request"),
        { kind: "activate", participantId: "B", activationId: "activation:1" },
      ],
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    expect(positioned.activations).toHaveLength(1);
    const bar = positioned.activations[0]!;
    expect(bar.y + bar.height).toBe(positioned.height);
  });

  it("occupies its own rank, positioned strictly between the message rows before and after it", () => {
    const model: SequenceModel = {
      title: null,
      accTitle: null,
      interactions: [],
      participants: [declaredParticipant("A", "Alice"), declaredParticipant("B", "Bob")],
      boxes: [],
      statements: [
        messageStatement("m1", "A", "B", "request"),
        {
          kind: "note",
          note: { id: "note:1", placement: "over", from: "A", to: "B", label: plainLabel("they agree") },
        },
        messageStatement("m2", "B", "A", "response"),
      ],
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    const notes = notesOf(positioned);
    expect(notes).toHaveLength(1);
    const [request, response] = messagesOf(positioned);
    expect(notes[0]!.y).toBeGreaterThan(request.y);
    expect(notes[0]!.y).toBeLessThan(response.y);
  });

  it("spans a note over two participants from one lane center to the other, growing symmetrically when the text is wider than the gap", () => {
    const model: SequenceModel = {
      title: null,
      accTitle: null,
      interactions: [],
      participants: [declaredParticipant("A", "Alice"), declaredParticipant("B", "Bob")],
      boxes: [],
      statements: [
        {
          kind: "note",
          note: { id: "note:1", placement: "over", from: "A", to: "B", label: plainLabel("they agree") },
        },
      ],
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
    const note = notesOf(positioned)[0]!;
    expect(note.x).toBeLessThanOrEqual(byId.A.x);
    expect(note.x + note.width).toBeGreaterThanOrEqual(byId.B.x);
    // Centered on the midpoint between the two lanes.
    const midpoint = (byId.A.x + byId.B.x) / 2;
    expect(note.x + note.width / 2).toBeCloseTo(midpoint, 5);
  });

  it("places a note right of / left of a single participant's lane, on the correct side, with from and to the same participant", () => {
    const model: SequenceModel = {
      title: null,
      accTitle: null,
      interactions: [],
      participants: [declaredParticipant("A", "Alice")],
      boxes: [],
      statements: [
        {
          kind: "note",
          note: { id: "note:1", placement: "right", from: "A", to: "A", label: plainLabel("thinking") },
        },
        {
          kind: "note",
          note: { id: "note:2", placement: "left", from: "A", to: "A", label: plainLabel("pondering") },
        },
      ],
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
    const [right, left] = notesOf(positioned);
    expect(right!.x).toBeGreaterThan(byId.A.x);
    expect(left!.x + left!.width).toBeLessThan(byId.A.x);
  });

  it("spans a created-then-destroyed participant's lifeline exactly between its create and destroy rows, even nested inside a block", () => {
    const carol: ResolvedSequenceParticipant = {
      id: "C",
      label: plainLabel("Carol"),
      participantKind: "actor",
      origin: "created",
      createdAt: 2,
      destroyedAt: 4,
    };

    const model: SequenceModel = {
      title: null,
      accTitle: null,
      interactions: [],
      participants: [declaredParticipant("A", "Alice"), carol],
      boxes: [],
      statements: [
        messageStatement("m1", "A", "A", "before"),
        {
          kind: "block",
          block: {
            id: "loop:1",
            kind: "loop",
            touchedParticipantIds: ["A", "C"],
            color: null,
            branches: [
              {
                label: plainLabel("each retry"),
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
      timeline: { totalSteps: 0, entries: [] },
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
      accTitle: null,
      interactions: [],
      participants: [declaredParticipant("A", "Alice"), declaredParticipant("B", "Bob")],
      boxes: [],
      statements: [messageStatement("m1", "A", "B", "Hi")],
      timeline: { totalSteps: 0, entries: [] },
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
      label: plainLabel("Carol"),
      participantKind: "participant",
      origin: "created",
      createdAt: 1,
      destroyedAt: 3,
    };
    const withoutBottomRow: SequenceModel = {
      title: null,
      accTitle: null,
      interactions: [],
      participants: [{ ...declaredParticipant("A", "Alice"), destroyedAt: 4 }, carol],
      boxes: [],
      statements: [
        messageStatement("m1", "A", "A", "start"),
        { kind: "participant", participant: carol },
        messageStatement("m2", "A", "C", "work"),
        { kind: "destroy", id: "C" },
        { kind: "destroy", id: "A" },
      ],
      timeline: { totalSteps: 0, entries: [] },
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
      accTitle: null,
      interactions: [],
      participants: [
        declaredParticipant("A", "Alice"),
        declaredParticipant("B", "Bob"),
        declaredParticipant("C", "Carol"),
      ],
      boxes: [
        {
          id: "box:1",
          color: "rgb(200, 220, 255)",
          label: plainLabel("Service tier"),
          participantIds: ["A", "B"],
        },
      ],
      statements: [messageStatement("m1", "A", "C", "Ping")],
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });

    expect(positioned.boxes).toHaveLength(1);
    const box = positioned.boxes[0];
    expect(box.id).toBe("box:1");
    expect(box.color).toBe("rgb(200, 220, 255)");
    expect(box.label?.label).toEqual(plainLabel("Service tier"));

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
      label: plainLabel("Carol"),
      participantKind: "participant",
      origin: "created",
      createdAt: 1,
      destroyedAt: 3,
    };

    const withoutBox: SequenceModel = {
      title: null,
      accTitle: null,
      interactions: [],
      participants: [declaredParticipant("A", "Alice"), declaredParticipant("B", "Bob"), carol],
      boxes: [],
      statements: [
        messageStatement("m1", "A", "B", "start"),
        { kind: "participant", participant: carol },
        messageStatement("m2", "B", "C", "work"),
        { kind: "destroy", id: "C" },
      ],
      timeline: { totalSteps: 0, entries: [] },
    };

    // The box wraps the rightmost lanes, so its padding sits beyond every
    // participant box the width already accounted for.
    const withBox: SequenceModel = {
      ...withoutBox,
      boxes: [{ id: "box:1", color: null, label: null, participantIds: ["B", "C"] }],
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
      accTitle: null,
      interactions: [],
      participants: [declaredParticipant("A", "Alice"), declaredParticipant("B", "Bob")],
      boxes: [],
      statements: [messageStatement("m1", "A", "B", "first message")],
      timeline: { totalSteps: 0, entries: [] },
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
      accTitle: null,
      interactions: [],
      participants: [declaredParticipant("A", "Alice"), declaredParticipant("B", "Bob")],
      boxes: [],
      statements: [
        {
          kind: "block",
          block: {
            id: "loop:1",
            kind: "loop",
            touchedParticipantIds: ["A", "B"],
            color: null,
            branches: [
              {
                label: plainLabel("each retry"),
                statements: [messageStatement("m1", "A", "B", "first message")],
              },
            ],
          } satisfies ResolvedSequenceBlock,
        },
      ],
      timeline: { totalSteps: 0, entries: [] },
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
      accTitle: null,
      interactions: [],
      participants: [declaredParticipant("A", "Alice"), declaredParticipant("B", "Bob")],
      boxes: [
        { id: "box:1", color: null, label: plainLabel("Service tier"), participantIds: ["A", "B"] },
      ],
      statements: [messageStatement("m1", "A", "B", "Ping")],
      timeline: { totalSteps: 0, entries: [] },
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

describe("layoutSequence's labels", () => {
  /** A label of plain rows — what `<br>` between words reads as. */
  const rowsLabel = (...rows: string[]): Label => ({
    text: rows.join("\n"),
    rows: rows.map((row) => [plainRun(row)]),
  });

  /** One line is 24 tall and 8 wide a character, with no padding (`fakeMeasurer`). */
  const LINE = 24;

  it("sizes a participant's box for every row of its label, as wide as its widest row", () => {
    const model: SequenceModel = {
      ...coreModel(),
      participants: [
        { ...declaredParticipant("A", "x"), label: rowsLabel("Web", "Client") },
        declaredParticipant("B", "Web"),
      ],
      statements: [],
    };

    const byId = Object.fromEntries(
      layoutSequence(model, { measureText: fakeMeasurer }).participants.map((p) => [p.id, p]),
    );

    expect(byId.A.height - byId.B.height).toBe(LINE);
    // "Client" is the wider row: 6 characters, plus 16 of padding a side.
    expect(byId.A.width).toBe(6 * 8 + 2 * 16);
    expect(byId.A.labelBox.rows).toHaveLength(2);
  });

  /** A message from A to B labelled `label`. */
  const labelled = (id: string, label: Label): ResolvedSequenceStatement => {
    const statement = messageStatement(id, "A", "B", "x");
    return statement.kind === "message"
      ? { kind: "message", message: { ...statement.message, label } }
      : statement;
  };

  it("spaces a message a row further from the one before it for every row its label adds", () => {
    const gapAfter = (first: Label) => {
      const model: SequenceModel = {
        ...coreModel(),
        statements: [labelled("m1", rowsLabel("x")), labelled("m2", first), labelled("m3", rowsLabel("x"))],
      };
      const [m1, m2, m3] = messagesOf(layoutSequence(model, { measureText: fakeMeasurer }));
      return { before: m2!.y - m1!.y, after: m3!.y - m2!.y };
    };

    const one = gapAfter(rowsLabel("first"));
    const two = gapAfter(rowsLabel("first", "second"));

    // The rows stack upward from the arrow, so it is the gap *above* the
    // message that grows, and the one below it stays as it was.
    expect(two.before - one.before).toBe(LINE);
    expect(two.after).toBe(one.after);
  });

  it("stands a message's label on its arrow, centred between its ends and clear of the arrow above", () => {
    const model: SequenceModel = {
      ...coreModel(),
      statements: [labelled("m1", rowsLabel("x")), labelled("m2", rowsLabel("first", "second"))],
    };

    const [m1, m2] = messagesOf(layoutSequence(model, { measureText: fakeMeasurer }));

    expect(m2!.label.anchor.x).toBe((m2!.fromX + m2!.toX) / 2);
    const top = m2!.label.anchor.y - m2!.label.labelBox.height / 2;
    const bottom = m2!.label.anchor.y + m2!.label.labelBox.height / 2;
    expect(bottom).toBeLessThan(m2!.y);
    expect(top).toBeGreaterThan(m1!.y);
  });

  it("sizes a note for every row of its label, as wide as its widest row", () => {
    const noteOf = (label: Label) => {
      const model: SequenceModel = {
        ...coreModel(),
        statements: [
          { kind: "note", note: { id: "note:1", placement: "right", from: "A", to: "A", label } },
        ],
      };
      return notesOf(layoutSequence(model, { measureText: fakeMeasurer }))[0]!;
    };

    const one = noteOf(rowsLabel("aa"));
    const two = noteOf(rowsLabel("aa", "bbbb"));

    expect(two.height - one.height).toBe(LINE);
    // "bbbb" is two characters wider than "aa".
    expect(two.width - one.width).toBe(2 * 8);
    expect(two.labelBox.rows).toHaveLength(2);
  });

  it("makes a block's header and each divider a row taller for every row their condition adds", () => {
    // An alt: its condition heads the frame, the else branch's heads the divider.
    const layoutAlt = (condition: Label, otherwise: Label) => {
      const block: ResolvedSequenceBlock = {
        id: "alt:1",
        kind: "alt",
        touchedParticipantIds: ["A", "B"],
        color: null,
        branches: [
          { label: condition, statements: [labelled("m1", rowsLabel("x"))] },
          { label: otherwise, statements: [labelled("m2", rowsLabel("x"))] },
        ],
      };
      const model: SequenceModel = { ...coreModel(), statements: [{ kind: "block", block }] };
      const [element] = layoutSequence(model, { measureText: fakeMeasurer }).elements;
      if (element?.kind !== "block") throw new Error("expected a block");
      const [m1, m2] = messagesOf({ elements: element.block.children });
      return { block: element.block, m1: m1!, m2: m2! };
    };

    const plain = layoutAlt(rowsLabel("c"), rowsLabel("e"));
    const tallHeader = layoutAlt(rowsLabel("c1", "c2"), rowsLabel("e"));
    const tallDivider = layoutAlt(rowsLabel("c"), rowsLabel("e1", "e2"));

    // The header's second row pushes the first branch's content down a row.
    expect(tallHeader.m1.y - tallHeader.block.y).toBe(plain.m1.y - plain.block.y + LINE);
    // The divider's second row pushes the second branch's content down a row,
    // and leaves where the divider itself is drawn alone.
    expect(tallDivider.block.dividers[0]!.y).toBe(plain.block.dividers[0]!.y);
    expect(tallDivider.m2.y - tallDivider.block.dividers[0]!.y).toBe(
      plain.m2.y - plain.block.dividers[0]!.y + LINE,
    );
    expect(tallHeader.block.label?.labelBox.rows).toHaveLength(2);
    expect(tallDivider.block.dividers[0]!.label?.labelBox.rows).toHaveLength(2);
  });

  it("leaves a box's caption a band as tall as every row of its label", () => {
    const captionBand = (label: Label) => {
      const model: SequenceModel = {
        ...coreModel(),
        boxes: [{ id: "box:1", color: null, label, participantIds: ["A", "B"] }],
      };
      const positioned = layoutSequence(model, { measureText: fakeMeasurer });
      return { band: positioned.participants[0]!.top - positioned.boxes[0]!.y, box: positioned.boxes[0]! };
    };

    const one = captionBand(rowsLabel("Grp"));
    const two = captionBand(rowsLabel("Grp", "two"));

    expect(two.band - one.band).toBe(LINE);
    expect(two.box.label?.labelBox.rows).toHaveLength(2);
    // Centred across the box, its two rows filling the top two lines of it.
    expect(two.box.label?.anchor).toEqual({ x: two.box.x + two.box.width / 2, y: two.box.y + LINE });
  });

  it("anchors a block's and a divider's condition so its first row sits where a one-row condition does, past the keyword in the header", () => {
    const block: ResolvedSequenceBlock = {
      id: "alt:1",
      kind: "alt",
      touchedParticipantIds: ["A", "B"],
      color: null,
      branches: [
        { label: rowsLabel("every", "day"), statements: [] },
        { label: rowsLabel("e1"), statements: [] },
        { label: null, statements: [] },
      ],
    };
    const model: SequenceModel = { ...coreModel(), statements: [{ kind: "block", block }] };

    const [element] = layoutSequence(model, { measureText: fakeMeasurer }).elements;
    if (element?.kind !== "block") throw new Error("expected a block");
    const { block: positioned } = element;
    const [divider, bare] = positioned.dividers;

    // The condition's box begins 8 in from the frame — past the 64 reserved
    // for the keyword in the header — and its first row is centred 14 below
    // the frame's top, or the divider's line: two rows of 24 put the box's
    // centre a row lower than one row's.
    expect(positioned.label?.anchor).toEqual({
      x: positioned.x + 8 + 64 + "[every".length * 4,
      y: positioned.y + 14 + LINE / 2,
    });
    expect(divider!.label?.anchor).toEqual({ x: positioned.x + 8 + "[e1]".length * 4, y: divider!.y + 14 });
    expect(bare!.label).toBeNull();
  });

  it("brackets a block's condition around all its rows, and measures it as drawn", () => {
    // Measured (mermaid 11.17.2, `--paint`): `loop every<br/>day` draws
    // "[every" over "day]", and `else e1<br/>e2` draws "[e1" over "e2]".
    const block: ResolvedSequenceBlock = {
      id: "alt:1",
      kind: "alt",
      touchedParticipantIds: ["A", "B"],
      color: null,
      branches: [
        { label: rowsLabel("every", "day"), statements: [] },
        { label: rowsLabel("e1", "e2"), statements: [] },
        { label: null, statements: [] },
      ],
    };
    const model: SequenceModel = { ...coreModel(), statements: [{ kind: "block", block }] };

    const [element] = layoutSequence(model, { measureText: fakeMeasurer }).elements;
    if (element?.kind !== "block") throw new Error("expected a block");

    expect(element.block.label?.label).toEqual(rowsLabel("[every", "day]"));
    expect(element.block.label?.labelBox.width).toBe("[every".length * 8);
    expect(element.block.dividers.map((divider) => divider.label?.label ?? null)).toEqual([
      rowsLabel("[e1", "e2]"),
      null,
    ]);
  });

  it("carries a rect block's color as written, and gives it no condition to draw", () => {
    // `rect rgb(191, 223, 255)`: the syntax puts the color where a condition
    // would be, and Mermaid paints it as the block's fill rather than
    // drawing it as text — so it is neither bracketed nor measured.
    const block: ResolvedSequenceBlock = {
      id: "rect:1",
      kind: "rect",
      touchedParticipantIds: ["A", "B"],
      color: "rgb(191, 223, 255)",
      branches: [{ label: null, statements: [] }],
    };
    const model: SequenceModel = { ...coreModel(), statements: [{ kind: "block", block }] };

    const [element] = layoutSequence(model, { measureText: fakeMeasurer }).elements;
    if (element?.kind !== "block") throw new Error("expected a block");

    expect(element.block.color).toBe("rgb(191, 223, 255)");
    expect(element.block.label).toBeNull();
  });
});

