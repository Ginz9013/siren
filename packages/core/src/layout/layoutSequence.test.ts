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
    accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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

  describe("a destroying message (the message right after `destroy X` that X sends or receives)", () => {
    // Measured against Mermaid 12.2.0 (probe, jsdom layout stubs): the
    // destroyed participant's lifeline ends on the destroying message's own
    // row — Mermaid centres X's closing box on that arrow — and the arrow is
    // drawn exactly as tall a row as any other message; `destroy` claims no
    // row of its own. Siren marks the end with its X, so the X sits on the
    // arrow's end at X's lane: its tip when X receives, its tail when X sends.
    function destroyedBy(from: string, to: string): SequenceModel {
      // `buildSequenceModel` marks the destroying message with the id it
      // destroys; that mark is the pairing layout reads.
      const destroying = messageStatement("m2", from, to, "bye");
      if (destroying.kind === "message") destroying.message.destroys = "B";
      return {
        title: null,
        accTitle: null,
        accDescr: null,
        interactions: [],
        // Positions: 1 hi, 2 destroy B, 3 the destroying message, 4 ok.
        participants: [declaredParticipant("A", "Alice"), { ...declaredParticipant("B", "Bob"), destroyedAt: 3 }],
        boxes: [],
        statements: [
          messageStatement("m1", "A", "B", "hi"),
          { kind: "destroy", id: "B" },
          destroying,
          messageStatement("m3", "A", "A", "ok"),
        ],
        timeline: { totalSteps: 0, entries: [] },
      };
    }

    it("puts X's mark on the arrow's tip and ends its lifeline there when X receives it, with no row for `destroy`", () => {
      const positioned = layoutSequence(destroyedBy("A", "B"), {
        measureText: fakeMeasurer,
      });

      const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
      const [hi, bye, ok] = messagesOf(positioned);
      expect(destroyMarksOf(positioned)).toEqual([{ participantId: "B", x: bye!.toX, y: bye!.y }]);
      expect(byId.B!.bottom).toBe(bye!.y);
      // Every row is a plain message row: `destroy` added nothing between them.
      expect(bye!.y - hi!.y).toBe(ok!.y - bye!.y);
    });

    it("puts X's mark on the arrow's tail and ends its lifeline there when X sends it", () => {
      const positioned = layoutSequence(destroyedBy("B", "A"), {
        measureText: fakeMeasurer,
      });

      const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
      const [hi, bye, ok] = messagesOf(positioned);
      expect(destroyMarksOf(positioned)).toEqual([{ participantId: "B", x: bye!.fromX, y: bye!.y }]);
      expect(byId.B!.bottom).toBe(bye!.y);
      expect(bye!.y - hi!.y).toBe(ok!.y - bye!.y);
    });

    it("keeps X's mark on X's own lane, at the arrow's tail, when X sends the destroying message to itself", () => {
      const positioned = layoutSequence(destroyedBy("B", "B"), { measureText: fakeMeasurer });

      const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
      const [, bye] = messagesOf(positioned);
      // A self-message's arrow loops out from the lane and back; its tail is
      // on B's lane, its tip at the loop's far end.
      expect(bye!.fromX).toBe(byId.B!.x);
      expect(bye!.toX).not.toBe(byId.B!.x);
      expect(destroyMarksOf(positioned)).toEqual([{ participantId: "B", x: byId.B!.x, y: bye!.y }]);
      expect(byId.B!.bottom).toBe(bye!.y);
    });

    it("pairs a `destroy` inside an `alt` branch with the destroying message right after it in that branch", () => {
      // A block boundary between the two is refused by `buildSequenceModel`
      // (nook 01M4YS7DV8), so a pair inside a block sits in one branch.
      function altWith(firstBranch: ResolvedSequenceStatement[], destroyedAt: number | null): SequenceModel {
        const alt: ResolvedSequenceBlock = {
          id: "alt:1",
          kind: "alt",
          touchedParticipantIds: ["A", "B"],
          color: null,
          branches: [
            { label: plainLabel("first"), statements: firstBranch },
            { label: plainLabel("second"), statements: [messageStatement("A-A", "A", "A", "other")] },
          ],
        };
        return {
          title: null,
          accTitle: null,
          accDescr: null,
          interactions: [],
          participants: [declaredParticipant("A", "Alice"), { ...declaredParticipant("B", "Bob"), destroyedAt }],
          boxes: [],
          statements: [{ kind: "block", block: alt }],
          timeline: { totalSteps: 0, entries: [] },
        };
      }
      const destroying = messageStatement("B-A", "B", "A", "bye");
      if (destroying.kind === "message") destroying.message.destroys = "B";
      const blockOf = (positioned: ReturnType<typeof layoutSequence>) =>
        positioned.elements.filter(
          (el): el is Extract<PositionedSequenceElement, { kind: "block" }> => el.kind === "block",
        )[0]!.block;

      // Positions: 1 alt, 2 A->>B, 3 destroy B, 4 B->>A (the destroying message), 5 A->>A.
      const positioned = layoutSequence(
        altWith([messageStatement("A-B", "A", "B", "hi"), { kind: "destroy", id: "B" }, destroying], 4),
        { measureText: fakeMeasurer },
      );
      // The same branch with no `destroy` at all, for the plain row pitch.
      const plain = layoutSequence(
        altWith([messageStatement("A-B", "A", "B", "hi"), messageStatement("B-A", "B", "A", "bye")], null),
        { measureText: fakeMeasurer },
      );

      const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
      const block = blockOf(positioned);
      const [hi, bye] = messagesOf({ elements: block.children });
      const [plainHi, plainBye] = messagesOf({ elements: blockOf(plain).children });
      // One mark, on the destroying message's tail (B sends it), and B's
      // lifeline stops there.
      expect(destroyMarksOf({ elements: block.children })).toEqual([{ participantId: "B", x: bye!.fromX, y: bye!.y }]);
      expect(byId.B!.bottom).toBe(bye!.y);
      // `destroy` takes no row: the two messages and the branch's end sit
      // exactly where they do with no `destroy` in the branch.
      expect(bye!.y - hi!.y).toBe(plainBye!.y - plainHi!.y);
      expect(block.dividers[0]!.y).toBe(blockOf(plain).dividers[0]!.y);
    });
  });

  describe("a creating message (the message right after `create participant X`, sent to X)", () => {
    // Measured against Mermaid 12.2.0 (probe, jsdom layout stubs, 76px
    // boxes): for `A->>A`, `create participant C`, `A->>C: make`, `A->>C:
    // again`, C's box spans y 168–244 and `make`'s arrow is at y 206 — the
    // box is centred on the arrow; C's lifeline starts at 244, the box's
    // bottom; `make`'s arrow stops at x 265, short of the box's near edge
    // at 275 (`receiverAdjustment` pulls it back half the box plus 3), while
    // `again` runs on to the lane at 350 less its arrowhead; and `again` is
    // 88 below `make`, a plain row plus half the box (`bumpVerticalPos(
    // actor.height / 2)`). `create` itself claims no row.
    const carol: ResolvedSequenceParticipant = {
      id: "C",
      label: plainLabel("Carol"),
      participantKind: "participant",
      origin: "created",
      createdAt: 3,
      destroyedAt: null,
    };
    function createdBy(participants: ResolvedSequenceParticipant[]): SequenceModel {
      // `buildSequenceModel` marks the creating message with the id it
      // creates; that mark is the pairing layout reads.
      const creating = messageStatement("m2", "A", "C", "make");
      if (creating.kind === "message") creating.message.creates = "C";
      return {
        title: null,
        accTitle: null,
        accDescr: null,
        interactions: [],
        // Positions: 1 before, 2 create C, 3 the creating message, 4 again.
        participants,
        boxes: [],
        statements: [
          messageStatement("m1", "A", "A", "before"),
          { kind: "participant", participant: carol },
          creating,
          messageStatement("m3", "A", "C", "again"),
        ],
        timeline: { totalSteps: 0, entries: [] },
      };
    }

    it("centres X's box on the creating message's arrow, takes no row for `create`, and starts the next row below the box", () => {
      const positioned = layoutSequence(createdBy([declaredParticipant("A", "Alice"), carol]), {
        measureText: fakeMeasurer,
      });

      const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
      const [before, make, again] = messagesOf(positioned);
      // The box (and the lifeline under it, which starts at its bottom edge)
      // is centred on the arrow.
      expect(byId.C!.top + byId.C!.height / 2).toBe(make!.y);
      // `make` follows `before` by a plain message row, the same as with no
      // `create` at all: `create` claims no row.
      const [plainBefore, plainMake] = messagesOf(
        layoutSequence(
          {
            ...createdBy([declaredParticipant("A", "Alice"), declaredParticipant("C", "Carol")]),
            statements: [messageStatement("m1", "A", "A", "before"), messageStatement("m2", "A", "C", "make")],
          },
          { measureText: fakeMeasurer },
        ),
      );
      const plainRow = plainMake!.y - plainBefore!.y;
      expect(make!.y - before!.y).toBe(plainRow);
      // The next row is a plain row below the box's centre plus its lower half.
      expect(again!.y - make!.y).toBe(plainRow + byId.C!.height / 2);
      expect(byId.C!.top + byId.C!.height).toBeLessThan(again!.y);
    });

    it("stops the creating arrow at the box's near edge, and only that arrow", () => {
      const positioned = layoutSequence(createdBy([declaredParticipant("A", "Alice"), carol]), {
        measureText: fakeMeasurer,
      });

      const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
      const [, make, again] = messagesOf(positioned);
      // C's lane is right of A's, so the near edge is the box's left one.
      expect(make!.fromX).toBe(byId.A!.x);
      expect(make!.toX).toBe(byId.C!.x - byId.C!.width / 2);
      expect(again!.toX).toBe(byId.C!.x);
    });

    it("stops the creating arrow at the box's right edge when X's lane is left of the sender's", () => {
      const positioned = layoutSequence(createdBy([carol, declaredParticipant("A", "Alice")]), {
        measureText: fakeMeasurer,
      });

      const byId = Object.fromEntries(positioned.participants.map((p) => [p.id, p]));
      const [, make] = messagesOf(positioned);
      expect(byId.C!.x).toBeLessThan(byId.A!.x);
      expect(make!.toX).toBe(byId.C!.x + byId.C!.width / 2);
    });
  });

  it("spans an activation bar from its activate statement's row to its deactivate statement's row, centered on the participant's lane", () => {
    const model: SequenceModel = {
      title: null,
      accTitle: null,
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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
      accDescr: null,
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

  /**
   * What each row past the first adds: one line of Mermaid's sequence text,
   * 19px at 16px (measured), so 14 × 19/16 at Siren's 14px. The rest of
   * `fakeMeasurer`'s 24px is the padding a label carries once.
   */
  const ROW = (14 * 19) / 16;

  /** What each row past the first adds to a participant or a box's caption: one 14px font size (measured). */
  const PARTICIPANT_ROW = 14;

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

    expect(byId.A.height - byId.B.height).toBe(PARTICIPANT_ROW);
    // "Client" is the wider row: 6 characters, plus 16 of padding a side.
    expect(byId.A.width).toBe(6 * 8 + 2 * 16);
    expect(byId.A.labelBox.rows).toHaveLength(2);
  });

  // Mermaid draws a participant's and a box's caption rows a font size
  // apart — `dy` of ∓8 around the centre at 16px (measured in headless
  // Chrome, mermaid 11.17.2) — closer than its message rows; at Siren's 14px
  // they sit 14px apart.
  it("spaces a participant's and a box caption's rows one 14px font size apart", () => {
    const model: SequenceModel = {
      ...coreModel(),
      participants: [{ ...declaredParticipant("A", "x"), label: rowsLabel("Web", "Client") }, declaredParticipant("B", "B")],
      boxes: [{ id: "box:1", color: null, label: rowsLabel("Grp", "two"), participantIds: ["A", "B"] }],
      statements: [],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });
    const participantRows = positioned.participants.find((p) => p.id === "A")!.labelBox.rows;
    const captionRows = positioned.boxes[0]!.label!.labelBox.rows;

    expect(participantRows[1]!.y - participantRows[0]!.y).toBe(14);
    expect(captionRows[1]!.y - captionRows[0]!.y).toBe(14);
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
    expect(two.before - one.before).toBe(ROW);
    expect(two.after).toBe(one.after);
  });

  // Mermaid draws sequence text as SVG, its rows 19px apart at 16px
  // (measured in headless Chrome, mermaid 11.17.2) — not the 1.5 its HTML
  // labels have — so at Siren's 14px they sit 14 × 19/16 = 16.625px apart.
  it("spaces a message label's rows 14 × 19/16px apart, the line Mermaid's sequence text has", () => {
    const model: SequenceModel = { ...coreModel(), statements: [labelled("m1", rowsLabel("first", "second"))] };

    const [m1] = messagesOf(layoutSequence(model, { measureText: fakeMeasurer }));
    const rows = m1!.label.labelBox.rows;

    expect(rows.map((row) => row.height)).toEqual([16.625, 16.625]);
    expect(rows[1]!.y - rows[0]!.y).toBe(16.625);
  });

  // A one-row label adds nothing to the band a message or a condition is
  // laid out in: messages are MESSAGE_ROW_HEIGHT (40) apart, and a branch's
  // first message sits a header or divider band (30) and a message row (40)
  // below the block's top or the divider's line — however much of the
  // measurer's answer for one line is padding rather than row.
  it("keeps one-row messages and conditions where the bands alone put them", () => {
    const block: ResolvedSequenceBlock = {
      id: "alt:1",
      kind: "alt",
      touchedParticipantIds: ["A", "B"],
      color: null,
      branches: [
        { label: rowsLabel("c"), statements: [labelled("m2", rowsLabel("x"))] },
        { label: rowsLabel("e"), statements: [labelled("m3", rowsLabel("x"))] },
      ],
    };
    const model: SequenceModel = {
      ...coreModel(),
      statements: [labelled("m0", rowsLabel("x")), labelled("m1", rowsLabel("x")), { kind: "block", block }],
    };

    const positioned = layoutSequence(model, { measureText: fakeMeasurer });
    const [m0, m1] = messagesOf(positioned);
    const element = positioned.elements.find((e) => e.kind === "block");
    if (element?.kind !== "block") throw new Error("expected a block");
    const [m2, m3] = messagesOf({ elements: element.block.children });

    expect(m1!.y - m0!.y).toBe(40);
    expect(m2!.y - element.block.y).toBe(30 + 40);
    expect(m3!.y - element.block.dividers[0]!.y).toBe(30 + 40);
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

    expect(two.height - one.height).toBe(ROW);
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
    expect(tallHeader.m1.y - tallHeader.block.y).toBe(plain.m1.y - plain.block.y + ROW);
    // The divider's second row pushes the second branch's content down a row,
    // and leaves where the divider itself is drawn alone.
    expect(tallDivider.block.dividers[0]!.y).toBe(plain.block.dividers[0]!.y);
    expect(tallDivider.m2.y - tallDivider.block.dividers[0]!.y).toBe(
      plain.m2.y - plain.block.dividers[0]!.y + ROW,
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

    expect(two.band - one.band).toBe(PARTICIPANT_ROW);
    expect(two.box.label?.labelBox.rows).toHaveLength(2);
    // Centred across the box, its two rows filling the top of it: one line
    // and one row more.
    expect(two.box.label?.anchor).toEqual({ x: two.box.x + two.box.width / 2, y: two.box.y + (LINE + PARTICIPANT_ROW) / 2 });
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
    // the frame's top, or the divider's line: a second row puts the box's
    // centre half a row lower than one row's.
    expect(positioned.label?.anchor).toEqual({
      x: positioned.x + 8 + 64 + "[every".length * 4,
      y: positioned.y + 14 + ROW / 2,
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


describe("layoutSequence's participant links (01M3NM3BZ)", () => {
  /** A resolved `link X: Label @ url`, as the model hands it over. */
  const link = (targetId: string, label: string, url: string) => ({
    targetId,
    interactionKind: "href" as const,
    action: url,
    argument: null,
    tooltip: label,
    linkTarget: null,
  });

  function participantsWith(interactions: SequenceModel["interactions"]) {
    const model: SequenceModel = { ...coreModel(), interactions };
    return new Map(layoutSequence(model, { measureText: fakeMeasurer }).participants.map((p) => [p.id, p]));
  }

  it("keeps every link a participant has, in document order, as a menu rather than its box's one link", () => {
    const participants = participantsWith([
      link("A", "Home", "https://x.com"),
      link("A", "Docs", "https://d.com"),
    ]);

    const alice = participants.get("A")!;
    expect(alice.interaction).toBeNull();
    expect(alice.linkMenu?.links.map((l) => [l.tooltip, l.action])).toEqual([
      ["Home", "https://x.com"],
      ["Docs", "https://d.com"],
    ]);
  });

  it("lets a later link with the same label replace the earlier one's url, keeping its place", () => {
    // Measured on Mermaid 12.2.0: `links A: {"Home": x, "Docs": d}` then
    // `link A: Home @ z` gives `{Home: z, Docs: d}`.
    const participants = participantsWith([
      link("A", "Home", "https://x.com"),
      link("A", "Docs", "https://d.com"),
      link("A", "Home", "https://z.com"),
    ]);

    expect(participants.get("A")!.linkMenu?.links.map((l) => [l.tooltip, l.action])).toEqual([
      ["Home", "https://z.com"],
      ["Docs", "https://d.com"],
    ]);
  });

  it("makes a participant left with one link after merging a plain link, with no menu", () => {
    const participants = participantsWith([
      link("B", "Home", "https://x.com"),
      link("B", "Home", "https://z.com"),
      link("C", "Docs", "https://d.com"),
    ]);

    expect(participants.get("B")!.interaction?.action).toBe("https://z.com");
    expect(participants.get("B")!.linkMenu ?? null).toBeNull();
    expect(participants.get("C")!.interaction?.action).toBe("https://d.com");
    expect(participants.get("C")!.linkMenu ?? null).toBeNull();
    expect(participants.get("A")!.interaction).toBeNull();
    expect(participants.get("A")!.linkMenu ?? null).toBeNull();
  });

  describe("the menu's place", () => {
    const longLabel = "The full reference manual";
    const menuLinks = (id: string) => [link(id, "Home", "https://x.com"), link(id, longLabel, "https://d.com")];

    function laidOut() {
      const model: SequenceModel = {
        ...coreModel(),
        interactions: [...menuLinks("A"), ...menuLinks("C")],
      };
      return layoutSequence(model, { measureText: fakeMeasurer });
    }

    it("is wide enough for its box and every label, one text row per link", () => {
      const diagram = laidOut();
      for (const id of ["A", "C"]) {
        const participant = diagram.participants.find((p) => p.id === id)!;
        const menu = participant.linkMenu!;
        expect(menu.width).toBeGreaterThanOrEqual(participant.width);
        expect(menu.width).toBeGreaterThan(fakeMeasurer.measure(longLabel).width);
        expect(menu.rowHeight).toBeGreaterThanOrEqual(fakeMeasurer.measure(longLabel).height);
      }
    });

    it("opens toward the diagram's interior, so it is never cut off at either side", () => {
      const diagram = laidOut();
      const first = diagram.participants.find((p) => p.id === "A")!;
      const last = diagram.participants.find((p) => p.id === "C")!;

      // The leftmost lane's menu hangs from its box's left edge and grows
      // rightward; the rightmost lane's from its right edge, growing leftward.
      expect(first.linkMenu!.x).toBe(first.x - first.width / 2);
      expect(last.linkMenu!.x + last.linkMenu!.width).toBe(last.x + last.width / 2);
      for (const menu of [first.linkMenu!, last.linkMenu!]) {
        expect(menu.x).toBeGreaterThanOrEqual(0);
        expect(menu.x + menu.width).toBeLessThanOrEqual(diagram.width);
      }
    });

    it("keeps every row of both of a lone participant's menus inside the canvas, top to bottom", () => {
      // `participant A` and four links, nothing else: the bottom-row box's
      // menu, which ends at that box's top edge, used to climb above y 0.
      const model: SequenceModel = {
        ...coreModel(),
        participants: [coreModel().participants[0]!],
        statements: [],
        interactions: ["a", "b", "c", "d"].map((key) => link("A", key, `https://${key}.com`)),
      };
      const diagram = layoutSequence(model, { measureText: fakeMeasurer });
      const alice = diagram.participants[0]!;
      const menu = alice.linkMenu!;
      const menuHeight = menu.rowHeight * menu.links.length;

      // Rows as `PositionedSequenceLinkMenu.rowHeight` places them: below the
      // top box's bottom edge, and above the bottom-row box's top edge.
      const underTopBox = { top: alice.top + alice.height, bottom: alice.top + alice.height + menuHeight };
      const overBottomBox = { top: alice.bottom - alice.height - menuHeight, bottom: alice.bottom - alice.height };
      for (const rows of [underTopBox, overBottomBox]) {
        expect(rows.top).toBeGreaterThanOrEqual(0);
        expect(rows.bottom).toBeLessThanOrEqual(diagram.height);
      }
    });
  });
});
