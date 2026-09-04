import type {
  LayoutOptions,
  PositionedBlock,
  PositionedBlockDivider,
  PositionedMessage,
  PositionedParticipant,
  PositionedSequenceDiagram,
  PositionedSequenceElement,
  ResolvedSequenceBlock,
  ResolvedSequenceMessage,
  ResolvedSequenceStatement,
  SequenceModel,
} from "../contracts";

/** Horizontal padding added around a participant's measured label. */
const PARTICIPANT_PADDING_X = 16;
/** Vertical padding added around a participant's measured label. */
const PARTICIPANT_PADDING_Y = 12;
/** Minimum horizontal gap between adjacent participant lane boxes. */
const LANE_GAP = 40;
/** Left margin before the first participant lane's box. */
const LEFT_MARGIN = 20;
/** Vertical distance between consecutive message rows. */
const MESSAGE_ROW_HEIGHT = 40;
/** Horizontal distance a self-message's arrow loops out from its lane center. */
const SELF_MESSAGE_LOOP_WIDTH = 50;
/** Right margin reserved after the last participant lane's box. */
const RIGHT_MARGIN = 20;
/** Vertical space reserved below the last message row, above the bottom participant boxes. */
const BOTTOM_MARGIN = 20;
/** Vertical space reserved above the first participant row when a title is present. */
const TITLE_HEIGHT = 40;
/** Horizontal padding a block's frame extends beyond the leftmost/rightmost lane it touches. */
const BLOCK_PADDING_X = 20;
/**
 * Horizontal padding shed per nesting level (down to a floor), so a nested
 * block's frame is always visibly inside its parent's even when both touch
 * the same leftmost/rightmost lane (matches Mermaid's own nested-frame
 * rendering).
 */
const BLOCK_NESTED_INSET_X = 6;
/** Horizontal padding never shrinks below this floor, regardless of nesting depth. */
const BLOCK_PADDING_X_FLOOR = 6;
/** Vertical gap between a block's preceding content and its own frame's top edge. */
const BLOCK_MARGIN_TOP = 20;
/** Vertical space reserved inside a block's frame for its header condition label. */
const BLOCK_HEADER_HEIGHT = 30;
/** Vertical space reserved for a branch divider line + its condition label (`else`/`and`/`option`). */
const BLOCK_DIVIDER_HEIGHT = 30;
/** Vertical gap between a branch's last content and the next branch's divider line. */
const BLOCK_DIVIDER_TOP_GAP = 10;
/** Vertical gap between a block's last content and its own frame's bottom edge. */
const BLOCK_MARGIN_BOTTOM = 20;

/**
 * Computes participant lane x-positions (first-declaration order, sized
 * from measured label width) and their box `width`/`height`. `top`/`bottom`
 * are filled in afterward, once the lifeline's full vertical extent (which
 * depends on the message rows below) is known.
 */
function layoutParticipants(
  model: SequenceModel,
  options: LayoutOptions,
): PositionedParticipant[] {
  const participants: PositionedParticipant[] = [];
  let nextLeft = LEFT_MARGIN;

  for (const decl of model.participants) {
    const measured = options.measureText.measure(decl.label);
    const width = measured.width + PARTICIPANT_PADDING_X * 2;
    const height = measured.height + PARTICIPANT_PADDING_Y * 2;
    const x = nextLeft + width / 2;

    participants.push({
      id: decl.id,
      label: decl.label,
      participantKind: decl.participantKind,
      origin: decl.origin,
      x,
      top: 0,
      bottom: 0,
      width,
      height,
    });

    nextLeft = nextLeft + width + LANE_GAP;
  }

  return participants;
}

/**
 * Assigns a y-coordinate to each message and a bounding box to each block,
 * walking `statements` recursively (block bodies included) in document
 * order, so the whole diagram shares one strictly-increasing time axis
 * regardless of nesting. `participant`/`destroy` statements are not yet
 * laid out — ticket 13 extends this same module.
 */
function layoutStatements(
  statements: ResolvedSequenceStatement[],
  laneCenterById: Map<string, number>,
  participantsById: Map<string, PositionedParticipant>,
  startY: number,
  depth = 0,
): { elements: PositionedSequenceElement[]; endY: number } {
  const elements: PositionedSequenceElement[] = [];
  let y = startY;

  for (const statement of statements) {
    if (statement.kind === "message") {
      y += MESSAGE_ROW_HEIGHT;
      elements.push({
        kind: "message",
        message: layoutMessage(statement.message, laneCenterById, y),
      });
      continue;
    }

    if (statement.kind === "block") {
      const { element, endY } = layoutBlock(
        statement.block,
        laneCenterById,
        participantsById,
        y,
        depth,
      );
      elements.push({ kind: "block", block: element });
      y = endY;
    }
  }

  return { elements, endY: y };
}

/**
 * Computes one block's bounding box: horizontal extent from the leftmost to
 * the rightmost lane in its (already-recursive) `touchedParticipantIds`
 * set, and vertical extent covering its header, every branch's divider +
 * label, and its full nested body (via `layoutStatements` recursion, so a
 * block containing blocks reserves enough vertical space for their boxes
 * too, and its own box fully encloses each child's).
 */
function layoutBlock(
  block: ResolvedSequenceBlock,
  laneCenterById: Map<string, number>,
  participantsById: Map<string, PositionedParticipant>,
  startY: number,
  depth: number,
): { element: PositionedBlock; endY: number } {
  const top = startY + BLOCK_MARGIN_TOP;
  let y = top + BLOCK_HEADER_HEIGHT;

  const dividers: PositionedBlockDivider[] = [];
  const children: PositionedSequenceElement[] = [];

  block.branches.forEach((branch, index) => {
    if (index > 0) {
      y += BLOCK_DIVIDER_TOP_GAP;
      dividers.push({ label: branch.label, y });
      y += BLOCK_DIVIDER_HEIGHT;
    }

    const { elements, endY } = layoutStatements(
      branch.statements,
      laneCenterById,
      participantsById,
      y,
      depth + 1,
    );
    children.push(...elements);
    y = endY;
  });

  const bottom = y + BLOCK_MARGIN_BOTTOM;

  const touchedParticipants = block.touchedParticipantIds
    .map((id) => participantsById.get(id))
    .filter((p): p is PositionedParticipant => p !== undefined);

  // Nested blocks shed horizontal padding per level, so a child's frame is
  // always visibly inside its parent's even when both touch the same
  // extreme lane.
  const horizontalPadding = Math.max(
    BLOCK_PADDING_X_FLOOR,
    BLOCK_PADDING_X - depth * BLOCK_NESTED_INSET_X,
  );

  const left =
    touchedParticipants.reduce(
      (min, p) => Math.min(min, p.x - p.width / 2),
      Number.POSITIVE_INFINITY,
    ) - horizontalPadding;
  const right =
    touchedParticipants.reduce(
      (max, p) => Math.max(max, p.x + p.width / 2),
      Number.NEGATIVE_INFINITY,
    ) + horizontalPadding;

  return {
    element: {
      id: block.id,
      kind: block.kind,
      label: block.branches[0]?.label ?? null,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      dividers,
      children,
    },
    endY: bottom,
  };
}

function layoutMessage(
  message: ResolvedSequenceMessage,
  laneCenterById: Map<string, number>,
  y: number,
): PositionedMessage {
  const fromX = laneCenterById.get(message.from) ?? 0;
  const toX =
    message.to === message.from
      ? fromX + SELF_MESSAGE_LOOP_WIDTH
      : laneCenterById.get(message.to) ?? 0;

  return {
    id: message.id,
    from: message.from,
    to: message.to,
    text: message.text,
    arrow: message.arrow,
    autonumber: message.autonumber,
    y,
    fromX,
    toX,
  };
}

/**
 * Computes participant lane x-positions, full-height lifeline y-extents,
 * each message's y-coordinate and arrow endpoint x-coordinates, and every
 * nested control-flow block's bounding box (recursively, so time flows
 * strictly top-to-bottom across the whole diagram regardless of nesting).
 * `create`/`destroy`/`box` geometry is not yet computed — ticket 13 extends
 * this same module.
 */
export function layoutSequence(
  model: SequenceModel,
  options: LayoutOptions,
): PositionedSequenceDiagram {
  const participants = layoutParticipants(model, options);
  const laneCenterById = new Map(participants.map((p) => [p.id, p.x]));
  const participantsById = new Map(participants.map((p) => [p.id, p]));

  const maxParticipantHeight = participants.reduce(
    (max, p) => Math.max(max, p.height),
    0,
  );
  const titleHeight = model.title === null ? 0 : TITLE_HEIGHT;
  const lifelineTop = titleHeight + maxParticipantHeight;

  const { elements, endY } = layoutStatements(
    model.statements,
    laneCenterById,
    participantsById,
    lifelineTop,
  );
  const lifelineBottom = endY + BOTTOM_MARGIN + maxParticipantHeight;

  for (const participant of participants) {
    participant.top = lifelineTop;
    participant.bottom = lifelineBottom;
  }

  const rightmostParticipantEdge = participants.reduce(
    (max, p) => Math.max(max, p.x + p.width / 2),
    0,
  );
  const rightmostBlockEdge = maxBlockRightEdge(elements);

  return {
    title: model.title,
    participants,
    boxes: [],
    elements,
    width: Math.max(rightmostParticipantEdge, rightmostBlockEdge) + RIGHT_MARGIN,
    height: lifelineBottom,
  };
}

/** Finds the rightmost frame edge across every block, recursively including nested children. */
function maxBlockRightEdge(elements: PositionedSequenceElement[]): number {
  let max = 0;
  for (const el of elements) {
    if (el.kind !== "block") {
      continue;
    }
    max = Math.max(max, el.block.x + el.block.width, maxBlockRightEdge(el.block.children));
  }
  return max;
}
