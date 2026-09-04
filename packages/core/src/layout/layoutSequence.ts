import type {
  LayoutOptions,
  PositionedMessage,
  PositionedParticipant,
  PositionedSequenceDiagram,
  PositionedSequenceElement,
  ResolvedSequenceMessage,
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
 * Assigns a y-coordinate to each top-level message statement, in document
 * order, plus arrow endpoint x-coordinates from the lane centers of its
 * `from`/`to` participants. (Nested block bodies are not yet walked — core
 * subset only; tickets 08/13 extend this same module.)
 */
function layoutMessages(
  model: SequenceModel,
  laneCenterById: Map<string, number>,
  startY: number,
): { elements: PositionedSequenceElement[]; endY: number } {
  const elements: PositionedSequenceElement[] = [];
  let y = startY;

  for (const statement of model.statements) {
    if (statement.kind !== "message") {
      continue;
    }

    y += MESSAGE_ROW_HEIGHT;
    elements.push({
      kind: "message",
      message: layoutMessage(statement.message, laneCenterById, y),
    });
  }

  return { elements, endY: y };
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
 * and each message's y-coordinate, arrow endpoint x-coordinates, and label
 * position, for the core subset of a sequence diagram (no blocks/create/
 * box geometry yet — tickets 08/13 extend this same module).
 */
export function layoutSequence(
  model: SequenceModel,
  options: LayoutOptions,
): PositionedSequenceDiagram {
  const participants = layoutParticipants(model, options);
  const laneCenterById = new Map(participants.map((p) => [p.id, p.x]));

  const maxParticipantHeight = participants.reduce(
    (max, p) => Math.max(max, p.height),
    0,
  );
  const titleHeight = model.title === null ? 0 : TITLE_HEIGHT;
  const lifelineTop = titleHeight + maxParticipantHeight;

  const { elements, endY } = layoutMessages(model, laneCenterById, lifelineTop);
  const lifelineBottom = endY + BOTTOM_MARGIN + maxParticipantHeight;

  for (const participant of participants) {
    participant.top = lifelineTop;
    participant.bottom = lifelineBottom;
  }

  const rightmostEdge = participants.reduce(
    (max, p) => Math.max(max, p.x + p.width / 2),
    0,
  );

  return {
    title: model.title,
    participants,
    boxes: [],
    elements,
    width: rightmostEdge + RIGHT_MARGIN,
    height: lifelineBottom,
  };
}
