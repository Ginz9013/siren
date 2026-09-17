import type {
  LayoutOptions,
  PositionedBlock,
  PositionedBlockDivider,
  PositionedBox,
  PositionedMessage,
  PositionedParticipant,
  PositionedSequenceDiagram,
  PositionedSequenceElement,
  PositionedActivation,
  PositionedNote,
  ResolvedInteraction,
  ResolvedSequenceBlock,
  ResolvedSequenceBox,
  ResolvedSequenceMessage,
  ResolvedSequenceNote,
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
/** Horizontal padding added around a note's measured text. */
const NOTE_PADDING_X = 10;
/** Vertical padding added around a note's measured text. */
const NOTE_PADDING_Y = 8;
/** Vertical gap between the row before a note and the note's own row. */
const NOTE_ROW_GAP = 20;
/** Horizontal gap between a `right of`/`left of` note and the lane box it sits beside. */
const NOTE_SIDE_GAP = 10;
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
/** Vertical gap above a `create`d participant's box, separating it from the preceding row. */
const CREATE_ROW_GAP = 20;
/** Vertical distance a `destroy` statement's X mark sits below the preceding row. */
const DESTROY_ROW_HEIGHT = 30;
/**
 * Horizontal padding a box's background rect extends beyond its outermost
 * member lane's own box. Kept below `LEFT_MARGIN` so a box grouping the
 * first lane still starts inside the diagram.
 */
const BOX_PADDING_X = 12;

/**
 * Everything the recursive statement walk needs: the lane geometry it reads,
 * and the truncated-lifeline extents it discovers on the way (a `create`d
 * participant's top and a `destroy`ed participant's bottom are only known
 * once the walk reaches that statement's row).
 */
interface SequenceLayoutContext {
  /** Lane center x-coordinate per participant id. */
  laneCenterById: Map<string, number>;
  /** The positioned participant per id, for its box width/height. */
  participantsById: Map<string, PositionedParticipant>;
  /** y-coordinate a `create`d participant's lifeline starts at, keyed by id. */
  createdTopById: Map<string, number>;
  /** y-coordinate a `destroy`ed participant's lifeline ends at, keyed by id. */
  destroyedBottomById: Map<string, number>;
  /** Activations not yet closed, per participant id — a stack, since Mermaid stacks repeat activations rather than merging them. */
  openActivationsByParticipantId: Map<string, OpenActivation[]>;
  /** Every closed bar, in the order it closed — `layoutSequence` sorts nothing further, since draw order does not depend on it. */
  closedActivations: PositionedActivation[];
  /** Threaded down for note sizing, the one statement kind `layoutStatements` measures text for. */
  measureText: LayoutOptions["measureText"];
}

/** One activation bar's still-open half: its own id and the y it opened at. */
interface OpenActivation {
  activationId: string;
  startY: number;
}

/** Width every activation bar shares, regardless of nesting depth (measured against real Mermaid). */
const ACTIVATION_BAR_WIDTH = 10;
/** Per-nesting-level x offset a stacked activation bar shifts by (measured). */
const ACTIVATION_BAR_NESTED_OFFSET_X = 5;
/** Per-nesting-level y inset a stacked activation bar's top/bottom shrink by (measured). */
const ACTIVATION_BAR_NESTED_INSET_Y = 2;

/**
 * Turns one closed activation into its positioned bar. `nestingLevel` is
 * how many activations are still open on the same lifeline at the moment
 * this one closes — 0 when this was the only one open (or the last still
 * open to close), 1 when one more was open underneath it, and so on —
 * read from the stack's length right after this bar's own pop, which is
 * exactly that count. The first-opened bar on a lifeline therefore closes
 * *last* and gets `nestingLevel` 0 then; a bar opened while another was
 * already open closes first (LIFO) and gets a higher `nestingLevel`,
 * offset further from the lifeline than the one still open beneath it.
 */
function closeActivation(
  open: OpenActivation,
  participantId: string,
  endY: number,
  ctx: SequenceLayoutContext,
): PositionedActivation {
  const nestingLevel = ctx.openActivationsByParticipantId.get(participantId)?.length ?? 0;
  const laneCenter = ctx.laneCenterById.get(participantId) ?? 0;
  const x = laneCenter - ACTIVATION_BAR_WIDTH / 2 + nestingLevel * ACTIVATION_BAR_NESTED_OFFSET_X;
  const y = open.startY + nestingLevel * ACTIVATION_BAR_NESTED_INSET_Y;
  const height = Math.max(0, endY - open.startY - nestingLevel * ACTIVATION_BAR_NESTED_INSET_Y * 2);
  return {
    id: open.activationId,
    participantId,
    x,
    y,
    width: ACTIVATION_BAR_WIDTH,
    height,
  };
}

/**
 * Positions one note's box. `right`/`left` sit beside their one lane,
 * outside its box; `over` centers on the midpoint between its two lanes
 * (the same lane twice, for a single-participant `over`), widening past
 * the natural gap when the measured text needs more room than the lanes
 * leave between them — matching how a class diagram's namespace frame
 * grows to fit rather than clipping its label.
 */
function layoutNote(
  note: ResolvedSequenceNote,
  measuredTextWidth: number,
  height: number,
  ctx: SequenceLayoutContext,
  y: number,
): PositionedNote {
  const width = measuredTextWidth + NOTE_PADDING_X * 2;

  if (note.placement === "right" || note.placement === "left") {
    const participant = ctx.participantsById.get(note.from);
    const laneCenter = ctx.laneCenterById.get(note.from) ?? 0;
    const laneHalfWidth = (participant?.width ?? 0) / 2;
    const x =
      note.placement === "right"
        ? laneCenter + laneHalfWidth + NOTE_SIDE_GAP
        : laneCenter - laneHalfWidth - NOTE_SIDE_GAP - width;
    return { id: note.id, text: note.text, x, y, width, height };
  }

  const fromCenter = ctx.laneCenterById.get(note.from) ?? 0;
  const toCenter = ctx.laneCenterById.get(note.to) ?? 0;
  const spanLeft = Math.min(fromCenter, toCenter);
  const spanRight = Math.max(fromCenter, toCenter);
  const midpoint = (spanLeft + spanRight) / 2;
  const spanWidth = Math.max(spanRight - spanLeft, width);
  return { id: note.id, text: note.text, x: midpoint - spanWidth / 2, y, width: spanWidth, height };
}

/**
 * Computes participant lane x-positions (first-declaration order, sized
 * from measured label width) and their box `width`/`height`. `top`/`bottom`
 * are filled in afterward, once the statement walk has found the diagram's
 * full vertical extent and any `create`/`destroy` row that truncates this
 * particular lifeline.
 */
function layoutParticipants(
  model: SequenceModel,
  options: LayoutOptions,
): PositionedParticipant[] {
  const participants: PositionedParticipant[] = [];
  let nextLeft = LEFT_MARGIN;

  // One `link` per participant at most, mirroring `layoutClassDiagram`'s
  // `interactionByClassId` — the later one wins if an author repeats it.
  const interactionByParticipantId = new Map<string, ResolvedInteraction>();
  for (const interaction of model.interactions) {
    interactionByParticipantId.set(interaction.targetId, interaction);
  }

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
      interaction: interactionByParticipantId.get(decl.id) ?? null,
    });

    nextLeft = nextLeft + width + LANE_GAP;
  }

  return participants;
}

/**
 * Assigns a y-coordinate to each message and a bounding box to each block,
 * walking `statements` recursively (block bodies included) in document
 * order, so the whole diagram shares one strictly-increasing time axis
 * regardless of nesting. A `create` statement claims a row of its own —
 * enough for the created participant's box — and records where that
 * participant's lifeline begins.
 */
function layoutStatements(
  statements: ResolvedSequenceStatement[],
  ctx: SequenceLayoutContext,
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
        message: layoutMessage(statement.message, ctx.laneCenterById, y),
      });
      continue;
    }

    if (statement.kind === "participant") {
      const participant = ctx.participantsById.get(statement.participant.id);
      if (participant !== undefined && participant.origin === "created") {
        y += CREATE_ROW_GAP;
        ctx.createdTopById.set(participant.id, y);
        y += participant.height;
      }
      continue;
    }

    if (statement.kind === "destroy") {
      y += DESTROY_ROW_HEIGHT;
      ctx.destroyedBottomById.set(statement.id, y);
      elements.push({
        kind: "destroyMark",
        mark: {
          participantId: statement.id,
          x: ctx.laneCenterById.get(statement.id) ?? 0,
          y,
        },
      });
      continue;
    }

    if (statement.kind === "note") {
      const measured = ctx.measureText.measure(statement.note.text);
      const height = measured.height + NOTE_PADDING_Y * 2;
      y += NOTE_ROW_GAP;
      elements.push({
        kind: "note",
        note: layoutNote(statement.note, measured.width, height, ctx, y),
      });
      y += height;
      continue;
    }

    if (statement.kind === "activate") {
      // Opens at the current y — the row the triggering message (or the
      // standalone `activate` line) already claimed — and occupies no row
      // of its own: an activation bar is a decoration on the lifeline, not
      // a new event on the timeline.
      const stack = ctx.openActivationsByParticipantId.get(statement.participantId) ?? [];
      stack.push({ activationId: statement.activationId, startY: y });
      ctx.openActivationsByParticipantId.set(statement.participantId, stack);
      continue;
    }

    if (statement.kind === "deactivate") {
      const stack = ctx.openActivationsByParticipantId.get(statement.participantId);
      // `buildSequenceModel` already diagnosed and dropped a `deactivate`
      // with nothing open, so an empty stack here would mean a bug in that
      // check rather than a document to render defensively around — but an
      // empty stack is still handled rather than trusted, the same
      // discipline `resolveClasses`' own defensive fallback follows.
      const open = stack?.pop();
      if (open !== undefined) {
        ctx.closedActivations.push(closeActivation(open, statement.participantId, y, ctx));
      }
      continue;
    }

    if (statement.kind === "block") {
      const { element, endY } = layoutBlock(statement.block, ctx, y, depth);
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
  ctx: SequenceLayoutContext,
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

    const { elements, endY } = layoutStatements(branch.statements, ctx, y, depth + 1);
    children.push(...elements);
    y = endY;
  });

  const bottom = y + BLOCK_MARGIN_BOTTOM;

  const touchedParticipants = block.touchedParticipantIds
    .map((id) => ctx.participantsById.get(id))
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

/**
 * Computes one box's background rect: horizontally spanning its member
 * lanes' boxes plus padding, vertically the diagram's full height below the
 * title, so it sits behind every lifeline it groups.
 */
function layoutBox(
  box: ResolvedSequenceBox,
  participantsById: Map<string, PositionedParticipant>,
  top: number,
  bottom: number,
): PositionedBox {
  const members = box.participantIds
    .map((id) => participantsById.get(id))
    .filter((p): p is PositionedParticipant => p !== undefined);

  const left =
    members.reduce((min, p) => Math.min(min, p.x - p.width / 2), Number.POSITIVE_INFINITY) -
    BOX_PADDING_X;
  const right =
    members.reduce((max, p) => Math.max(max, p.x + p.width / 2), Number.NEGATIVE_INFINITY) +
    BOX_PADDING_X;

  return {
    id: box.id,
    color: box.color,
    label: box.label,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
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
 * Computes participant lane x-positions, each lifeline's y-extent —
 * full-height (ending at the reserved bottom row where a declared,
 * never-destroyed participant's box is drawn again), or truncated to its
 * `create`/`destroy` rows — each message's
 * y-coordinate and arrow endpoint x-coordinates, every nested control-flow
 * block's bounding box (recursively, so time flows strictly top-to-bottom
 * across the whole diagram regardless of nesting), and every box group's
 * background rect.
 */
export function layoutSequence(
  model: SequenceModel,
  options: LayoutOptions,
): PositionedSequenceDiagram {
  const participants = layoutParticipants(model, options);
  const ctx: SequenceLayoutContext = {
    laneCenterById: new Map(participants.map((p) => [p.id, p.x])),
    participantsById: new Map(participants.map((p) => [p.id, p])),
    createdTopById: new Map(),
    destroyedBottomById: new Map(),
    openActivationsByParticipantId: new Map(),
    closedActivations: [],
    measureText: options.measureText,
  };

  // Every declared lane's box hangs downward from the top row's own top edge
  // — the band `[top, top + height]`, exactly as a `create` row already
  // reserves it — so the row has to be tall enough for the tallest box in it
  // and the statements below it start where that band ends. Reserving the
  // band above `top` instead would lay the first message inside the box.
  const topRowHeight = participants.reduce((max, p) => Math.max(max, p.height), 0);
  const titleHeight = model.title === null ? 0 : TITLE_HEIGHT;
  // A box's background starts at the same edge the top row now does, and its
  // caption is drawn across the top of that background — so the row starts a
  // caption line lower whenever a labelled box would otherwise be drawn
  // behind (and hidden by) the participant boxes it groups.
  const topRowTop = titleHeight + boxCaptionHeight(model, options);

  const { elements, endY } = layoutStatements(model.statements, ctx, topRowTop + topRowHeight);
  // The bottom row exists only for participants drawn there — declared and
  // never destroyed (see spec.md's "SVG conventions"). A diagram whose lanes
  // are all `create`d or destroyed reserves nothing, rather than trailing an
  // empty band the renderer never fills.
  const bottomRowHeight = participants.reduce(
    (max, p) =>
      p.origin === "declared" && !ctx.destroyedBottomById.has(p.id)
        ? Math.max(max, p.height)
        : max,
    0,
  );
  const lifelineBottom = endY + BOTTOM_MARGIN + bottomRowHeight;

  // Mermaid's own behavior for an activation that outlives the diagram was
  // not among the constructs this board measured; extending it to the
  // lifeline's own bottom is the same policy an un-`destroy`ed lifeline
  // already gets, applied consistently rather than left undefined.
  for (const [participantId, stack] of ctx.openActivationsByParticipantId) {
    for (let open = stack.pop(); open !== undefined; open = stack.pop()) {
      ctx.closedActivations.push(closeActivation(open, participantId, lifelineBottom, ctx));
    }
  }

  for (const participant of participants) {
    participant.top = ctx.createdTopById.get(participant.id) ?? topRowTop;
    participant.bottom = ctx.destroyedBottomById.get(participant.id) ?? lifelineBottom;
  }

  const rightmostParticipantEdge = participants.reduce(
    (max, p) => Math.max(max, p.x + p.width / 2),
    0,
  );
  const rightmostBlockEdge = maxBlockRightEdge(elements);

  const boxes = model.boxes.map((box) =>
    layoutBox(box, ctx.participantsById, titleHeight, lifelineBottom),
  );
  const rightmostBoxEdge = boxes.reduce((max, box) => Math.max(max, box.x + box.width), 0);

  return {
    title: model.title,
    accTitle: model.accTitle,
    participants,
    boxes,
    elements,
    activations: ctx.closedActivations,
    // Carried straight through: the timeline names ids, and layout assigns
    // coordinates — neither has anything to say about the other.
    timeline: model.timeline,
    width:
      Math.max(rightmostParticipantEdge, rightmostBlockEdge, rightmostBoxEdge) + RIGHT_MARGIN,
    height: lifelineBottom,
  };
}

/**
 * Height of the tallest box caption in the diagram, or `0` when no box
 * carries a label — the vertical band a box's background needs above the top
 * participant row for its own caption text.
 */
function boxCaptionHeight(model: SequenceModel, options: LayoutOptions): number {
  return model.boxes.reduce(
    (max, box) =>
      box.label === null ? max : Math.max(max, options.measureText.measure(box.label).height),
    0,
  );
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
