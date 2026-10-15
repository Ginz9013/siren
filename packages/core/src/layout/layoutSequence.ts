import type {
  Label,
  LabelBox,
  LayoutOptions,
  PlacedLabel,
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
import { layoutLabel, type LineSpacing } from "../label/layoutLabel";

/** Horizontal padding added around a participant's measured label. */
const PARTICIPANT_PADDING_X = 16;
/** Vertical padding added around a participant's measured label. */
const PARTICIPANT_PADDING_Y = 12;
/**
 * Height of an `actor`'s stick figure, which stands above its label: an
 * actor's row is this plus its label, every row of it, and the renderer
 * draws the label in the bottom `labelBox.height` of the row and the figure
 * above it. Twice `PARTICIPANT_PADDING_Y`, so an actor's row is exactly as
 * tall as a participant's with the same label and the two kinds line up.
 */
const ACTOR_FIGURE_HEIGHT = 2 * PARTICIPANT_PADDING_Y;
/**
 * Width of an `actor`'s stick figure, arm tip to arm tip: fixed, whatever
 * its label. Mermaid 12.2.0's `ACTOR_TYPE_WIDTH` (`18 * 2`, svgDraw.js),
 * which `adjustCreatedDestroyedData` stops a creating message's arrow
 * against for every figure kind rather than the label's width
 * (`ACTOR_TYPE_WIDTH / 2 + 3`; measured: lane 275, arrow line ends at 247
 * with its 7px marker). Its classic glyph, measured from `drawActorTypeActor`
 * as offsets from the actor's top and lane: head `cy 10`, `r 15`; torso
 * 25 to 45; arms at 33, `±18`; legs from the torso's foot at 45 to `-18`
 * and `+16` at 60 — 65 tall in all (`ACTOR_GLYPH_TOP` -5 to
 * `ACTOR_GLYPH_BOTTOM` 60). The default `neo` look scales that glyph by
 * 44/65 (arms `±12.18`, head `r 10.15`) but still stops the arrow by the
 * unscaled 36. Siren keeps the 36 and its own shorter figure
 * (`ACTOR_FIGURE_HEIGHT`). The label keeps its own width under the figure
 * and may be wider than it; the participant's `width`, and with it lane
 * spacing, stays the label's. Exported because the renderer draws the
 * figure at this width (`renderSequenceToSVG`'s `buildActorIcon`), as
 * `layoutGraph`'s `SHAPE_LEAN` is shared with `renderToSVG`: one number the
 * layout stops arrows at and the renderer draws to.
 */
export const ACTOR_FIGURE_WIDTH = 36;
/**
 * Half of `ACTOR_FIGURE_WIDTH`: how far each arm tip reaches from the lane,
 * and so how far short of the lane a created actor's creating arrow stops.
 */
export const ACTOR_FIGURE_HALF_WIDTH = ACTOR_FIGURE_WIDTH / 2;
/** Minimum horizontal gap between adjacent participant lane boxes. */
const LANE_GAP = 40;
/** Horizontal room either side of a link-menu entry's label. */
const LINK_MENU_PADDING_X = 10;
/** Vertical room above and below a link-menu entry's label. */
const LINK_MENU_PADDING_Y = 6;
/** Left margin before the first participant lane's box. */
const LEFT_MARGIN = 20;
/**
 * Vertical distance between consecutive message rows, for a label of one
 * row; each row a label adds above that one widens the gap above its arrow
 * by that row's height (see `layoutStatements`).
 */
const MESSAGE_ROW_HEIGHT = 40;

/**
 * The line of a message, a note, and a block's or a divider's condition.
 * Mermaid draws sequence text as SVG `<text>`, and these rows sit 19px apart
 * at 16px (measured in headless Chrome, mermaid 11.17.2: a two-row message,
 * note, `alt` condition and `else` condition alike) — not the 1.5 of its
 * HTML labels — so at Siren's 14px a row is 16.625px.
 */
const SEQUENCE_LINE: LineSpacing = { lineHeightRatio: 19 / 16 };

/**
 * The line of a participant and a box's caption, which Mermaid spaces closer
 * than its other sequence text: one font size apart, each row's `dy` 8px
 * either side of the centre at 16px (measured, mermaid 11.17.2). At Siren's
 * 14px a row is 14px.
 */
const SEQUENCE_PARTICIPANT_LINE: LineSpacing = { lineHeightRatio: 1 };
/** Vertical gap between the bottom of a message's label and its arrow. */
const MESSAGE_LABEL_GAP = 4;
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
/** How far a condition's box begins inside the block frame's left edge (or a divider's). */
const BLOCK_LABEL_INSET_X = 8;
/** How far below the frame's top edge (or a divider's line) a condition's first row is centred. */
const BLOCK_LABEL_FIRST_ROW_Y = 14;
/**
 * Room the header leaves for the block's own keyword (`loop`, `alt`, ...)
 * before its condition: wide enough for `critical`, the longest of the six,
 * at the block label's font size. The renderer draws the keyword at the
 * same inset, its centre on the condition's first row.
 */
const BLOCK_KEYWORD_WIDTH = 64;
/** Vertical space reserved for a branch divider line + its condition label (`else`/`and`/`option`). */
const BLOCK_DIVIDER_HEIGHT = 30;
/** Vertical gap between a branch's last content and the next branch's divider line. */
const BLOCK_DIVIDER_TOP_GAP = 10;
/** Vertical gap between a block's last content and its own frame's bottom edge. */
const BLOCK_MARGIN_BOTTOM = 20;
/**
 * Vertical gap above a `create`d participant's box, separating it from the
 * preceding row — only for a `create` whose creating message was refused,
 * the one case whose box still sits where `create` is written.
 */
const CREATE_ROW_GAP = 20;
/**
 * Vertical gap above a `destroy`ed participant's closing box, separating it
 * from the preceding row — only for a `destroy` whose destroying message was
 * refused, the one case whose lifeline still ends where `destroy` is written.
 */
const DESTROY_ROW_GAP = 20;
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
  /**
   * Participants whose `destroy` statement takes a row of its own: those
   * the model ends (`destroyedAt` set) with no message destroying them
   * (`ResolvedSequenceMessage.destroys`) — a declaration refused for its
   * missing destroying message. Every other `destroy` takes no row: a paired
   * one ends on its destroying message's row, and one no message came after
   * leaves its participant destroyed by nothing and draws nothing, as in
   * Mermaid 12.2.0 (nook 01M4YWYFJ). A participant is destroyed at most
   * once, so the id alone says which `destroy` this is.
   */
  destroyedOnOwnRow: Set<string>;
  /**
   * Participants some message creates (`ResolvedSequenceMessage.creates`),
   * collected before the walk: their `create` statement takes no row,
   * because the creating message's row is where their box is drawn.
   */
  createdByMessage: Set<string>;
  /** Activations not yet closed, per participant id — a stack, since Mermaid stacks repeat activations rather than merging them. */
  openActivationsByParticipantId: Map<string, OpenActivation[]>;
  /** Every closed bar, in the order it closed — `layoutSequence` sorts nothing further, since draw order does not depend on it. */
  closedActivations: PositionedActivation[];
  /** Threaded down for the labels `layoutStatements` measures: a message's and a note's. */
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
 * Stops the end of `message` that meets a created or destroyed
 * participant's box at that box's near edge, or for an actor at its
 * figure's near arm tip, whatever its label — the tip when the participant
 * receives the message, the tail when it sends it. A message the
 * participant sends itself loops out from its lane and is left as it is.
 */
function stopAtNearEdge(message: PositionedMessage, participant: PositionedParticipant): void {
  if (message.from === message.to) return;
  const halfWidth = participant.participantKind === "actor" ? ACTOR_FIGURE_HALF_WIDTH : participant.width / 2;
  if (participant.id === message.to) {
    message.toX += message.toX > message.fromX ? -halfWidth : halfWidth;
  } else {
    message.fromX += message.fromX < message.toX ? halfWidth : -halfWidth;
  }
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
  labelBox: LabelBox,
  ctx: SequenceLayoutContext,
  y: number,
): PositionedNote {
  const width = labelBox.width + NOTE_PADDING_X * 2;
  const height = labelBox.height + NOTE_PADDING_Y * 2;

  if (note.placement === "right" || note.placement === "left") {
    const participant = ctx.participantsById.get(note.from);
    const laneCenter = ctx.laneCenterById.get(note.from) ?? 0;
    const laneHalfWidth = (participant?.width ?? 0) / 2;
    const x =
      note.placement === "right"
        ? laneCenter + laneHalfWidth + NOTE_SIDE_GAP
        : laneCenter - laneHalfWidth - NOTE_SIDE_GAP - width;
    return { id: note.id, label: note.label, labelBox, x, y, width, height };
  }

  const fromCenter = ctx.laneCenterById.get(note.from) ?? 0;
  const toCenter = ctx.laneCenterById.get(note.to) ?? 0;
  const spanLeft = Math.min(fromCenter, toCenter);
  const spanRight = Math.max(fromCenter, toCenter);
  const midpoint = (spanLeft + spanRight) / 2;
  const spanWidth = Math.max(spanRight - spanLeft, width);
  return {
    id: note.id,
    label: note.label,
    labelBox,
    x: midpoint - spanWidth / 2,
    y,
    width: spanWidth,
    height,
  };
}

/**
 * Computes participant lane x-positions (`model.participants` order — first
 * mention, ADR-0013 — sized
 * from measured label width) and their box `width`/`height`. `top`/`bottom`
 * and `drawnInBottomRow` are filled in afterward, once the statement walk has found the diagram's
 * full vertical extent and any `create`/`destroy` row that truncates this
 * particular lifeline.
 */
function layoutParticipants(
  model: SequenceModel,
  options: LayoutOptions,
): PositionedParticipant[] {
  const participants: PositionedParticipant[] = [];
  let nextLeft = LEFT_MARGIN;

  const linksByParticipantId = mergeLinks(model.interactions);

  for (const decl of model.participants) {
    const labelBox = layoutLabel(decl.label, options.measureText, SEQUENCE_PARTICIPANT_LINE);
    const width = labelBox.width + PARTICIPANT_PADDING_X * 2;
    const height =
      decl.participantKind === "actor"
        ? ACTOR_FIGURE_HEIGHT + labelBox.height
        : labelBox.height + PARTICIPANT_PADDING_Y * 2;
    // A lane created after something drawn moves right (`createdAfterDrawing`).
    if (decl.createdAfterDrawing === true) nextLeft += width / 2;
    const x = nextLeft + width / 2;

    participants.push({
      id: decl.id,
      label: decl.label,
      labelBox,
      participantKind: decl.participantKind,
      origin: decl.origin,
      x,
      top: 0,
      bottom: 0,
      drawnInBottomRow: true,
      width,
      height,
      ...linksOf(linksByParticipantId.get(decl.id) ?? [], width, options),
    });

    nextLeft = nextLeft + width + LANE_GAP;
  }

  return participants;
}

/**
 * Each participant's links, merged as Mermaid 12.2.0 merges them into the
 * participant's `links` object: in document order, and a later link with an
 * earlier one's label replacing that one's url in its place (measured:
 * `links A: {"Home": x, "Docs": d}` then `link A: Home @ z` gives
 * `{Home: z, Docs: d}`). A `Map` keyed by label keeps exactly that order on
 * `set`, as an object does on assignment.
 */
function mergeLinks(interactions: ResolvedInteraction[]): Map<string, ResolvedInteraction[]> {
  const byLabelByParticipant = new Map<string, Map<string, ResolvedInteraction>>();
  for (const interaction of interactions) {
    let byLabel = byLabelByParticipant.get(interaction.targetId);
    if (byLabel === undefined) {
      byLabel = new Map();
      byLabelByParticipant.set(interaction.targetId, byLabel);
    }
    byLabel.set(interaction.tooltip ?? interaction.action, interaction);
  }
  return new Map(
    [...byLabelByParticipant].map(([participantId, byLabel]) => [participantId, [...byLabel.values()]]),
  );
}

/**
 * A single link makes the participant's box that link (the `seq-link`
 * decision); two or more become a menu, and the box itself links nowhere.
 */
function linksOf(
  links: ResolvedInteraction[],
  participantWidth: number,
  options: LayoutOptions,
): Pick<PositionedParticipant, "interaction" | "linkMenu"> {
  if (links.length < 2) return { interaction: links[0] ?? null, linkMenu: null };

  let width = participantWidth;
  let textHeight = 0;
  for (const link of links) {
    const size = options.measureText.measure(link.tooltip ?? link.action);
    width = Math.max(width, size.width + LINK_MENU_PADDING_X * 2);
    textHeight = Math.max(textHeight, size.height);
  }
  // `x` is placed by `placeLinkMenus`, once the diagram's width is known.
  return {
    interaction: null,
    linkMenu: { links, x: 0, width, rowHeight: textHeight + LINK_MENU_PADDING_Y * 2 },
  };
}

/**
 * Places each link menu toward the diagram's interior (see
 * `PositionedSequenceLinkMenu.x`), and returns the diagram's extent grown to
 * hold every menu — a menu wider than the diagram, or one hanging below a
 * short diagram's last statement, would otherwise be cut off.
 */
function placeLinkMenus(
  participants: PositionedParticipant[],
  width: number,
  height: number,
): { width: number; height: number } {
  for (const participant of participants) {
    const menu = participant.linkMenu;
    if (!menu) continue;
    const boxLeft = participant.x - participant.width / 2;
    menu.x =
      participant.x <= width / 2
        ? boxLeft
        : Math.max(0, boxLeft + participant.width - menu.width);
    width = Math.max(width, menu.x + menu.width);
    height = Math.max(
      height,
      participant.top + participant.height + menu.rowHeight * menu.links.length,
    );
  }
  return { width, height };
}

/**
 * Assigns a y-coordinate to each message and a bounding box to each block,
 * walking `statements` recursively (block bodies included) in document
 * order, so the whole diagram shares one strictly-increasing time axis
 * regardless of nesting. A created participant's box is centred on its
 * creating message's arrow, and the next row starts below the box; a
 * `create` with no creating message claims a row of its own instead —
 * enough for the box — and records where that participant's lifeline
 * begins.
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
      // A label's rows stack upward from its arrow, so its last row sits
      // where a one-row label always did and every row above it pushes the
      // arrow down by its own height.
      const labelBox = layoutLabel(statement.message.label, ctx.measureText, SEQUENCE_LINE);
      y += MESSAGE_ROW_HEIGHT + heightBesides(labelBox, labelBox.rows.length - 1);
      const message = layoutMessage(statement.message, labelBox, ctx.laneCenterById, y);
      elements.push({ kind: "message", message });

      // The destroying message ends its participant's lifeline on its own
      // row, with X's closing box. Measured against Mermaid 12.2.0: the
      // destroyed actor's `stopy` — the top of the box it draws a second
      // time — is this message's `lineStartY` less half the box
      // (`adjustCreatedDestroyedData`), so the box is centred on the arrow,
      // whether X sends or receives it. The lifeline runs under the box to
      // its bottom edge, as every lifeline runs under the box at its ends.
      // The next row starts half a box lower (`bumpVerticalPos(actor.height
      // / 2)`), clearing the box's lower half, as after a creating message.
      //
      // The arrow stops at the box's near edge at X's end, tip or tail, as a
      // creating arrow does (`receiverAdjustment` / `senderAdjustment`); a
      // message X sends itself loops out from its lane and is left as it is.
      const destroyedId = statement.message.destroys;
      const destroyed = destroyedId === undefined ? undefined : ctx.participantsById.get(destroyedId);
      if (destroyed !== undefined) {
        stopAtNearEdge(message, destroyed);
        ctx.destroyedBottomById.set(destroyed.id, y + destroyed.height / 2);
        y += destroyed.height / 2;
      }

      // The creating message starts its participant's lifeline on its own
      // row. Measured against Mermaid 12.2.0: the created actor's `starty`
      // is this message's `lineStartY` less half the box, so the box is
      // centred on the arrow, and the next row starts half a box lower
      // (`bumpVerticalPos(actor.height / 2)`) to clear the box's lower half.
      //
      // Its arrow stops at the box's near edge rather than running under the
      // box to the lane (Mermaid's `receiverAdjustment` pulls the arrow's end
      // back by half the box) — for an actor, at its figure's near arm tip,
      // `ACTOR_FIGURE_HALF_WIDTH` from the lane whatever its label, as
      // Mermaid pulls it back by `ACTOR_TYPE_WIDTH / 2` for every figure
      // kind; the label stays centred between the lanes, as Mermaid places it
      // before that adjustment. A message X sends itself loops out from its
      // lane and is left as it is.
      const createdId = statement.message.creates;
      const created = createdId === undefined ? undefined : ctx.participantsById.get(createdId);
      if (created === undefined) continue;
      stopAtNearEdge(message, created);
      ctx.createdTopById.set(created.id, y - created.height / 2);
      y += created.height / 2;
      continue;
    }

    if (statement.kind === "participant") {
      const participant = ctx.participantsById.get(statement.participant.id);
      // Paired with a creating message: that message's row is where the box
      // goes, and `create` itself takes no row, as it takes none in Mermaid.
      // With no message after it, the model resolved the participant as
      // `declared`, drawn from the top, so it takes no row either.
      if (participant !== undefined && participant.origin === "created" && !ctx.createdByMessage.has(participant.id)) {
        y += CREATE_ROW_GAP;
        ctx.createdTopById.set(participant.id, y);
        y += participant.height;
      }
      continue;
    }

    if (statement.kind === "destroy") {
      // Paired with a destroying message later on, that message's row is the
      // end; with no message after it, it ends nothing. Either way `destroy`
      // itself takes no row, as it takes none in Mermaid.
      // A `destroy` refused for its missing destroying message takes a row
      // of its own instead, enough for the closing box, as a refused
      // `create` does for its box.
      const participant = ctx.participantsById.get(statement.id);
      if (participant === undefined || !ctx.destroyedOnOwnRow.has(statement.id)) continue;
      y += DESTROY_ROW_GAP + participant.height;
      ctx.destroyedBottomById.set(statement.id, y);
      continue;
    }

    if (statement.kind === "note") {
      const labelBox = layoutLabel(statement.note.label, ctx.measureText, SEQUENCE_LINE);
      y += NOTE_ROW_GAP;
      const note = layoutNote(statement.note, labelBox, ctx, y);
      elements.push({ kind: "note", note });
      y += note.height;
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

  // A condition's rows stack downward from where a one-row condition sits,
  // so each row it adds makes its header or divider band that much taller.
  const top = startY + BLOCK_MARGIN_TOP;
  const header =
    block.kind === "rect"
      ? null
      : placeCondition(bracketed(block.branches[0]?.label ?? null), ctx, left + BLOCK_KEYWORD_WIDTH, top);
  let y = top + BLOCK_HEADER_HEIGHT + heightBesides(header?.labelBox ?? null, 0);

  const dividers: PositionedBlockDivider[] = [];
  const children: PositionedSequenceElement[] = [];

  block.branches.forEach((branch, index) => {
    if (index > 0) {
      y += BLOCK_DIVIDER_TOP_GAP;
      const label = placeCondition(bracketed(branch.label), ctx, left, y);
      dividers.push({ label, y });
      y += BLOCK_DIVIDER_HEIGHT + heightBesides(label?.labelBox ?? null, 0);
    }

    const { elements, endY } = layoutStatements(branch.statements, ctx, y, depth + 1);
    children.push(...elements);
    y = endY;
  });

  const bottom = y + BLOCK_MARGIN_BOTTOM;

  return {
    element: {
      id: block.id,
      kind: block.kind,
      label: header,
      color: block.color,
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
  labelBox: LabelBox | null,
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
    // The top of the background is the caption band reserved above the
    // participants, as tall as this label — so the label fills it.
    label:
      box.label === null || labelBox === null
        ? null
        : {
            label: box.label,
            labelBox,
            anchor: { x: (left + right) / 2, y: top + labelBox.height / 2 },
          },
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * A block's or branch's condition as Mermaid draws it: in brackets that
 * open its first row and close its last (measured: `loop every<br/>day`
 * draws "[every" over "day]"). An empty condition draws nothing at all, not
 * a pair of brackets around nothing — Mermaid draws an invisible
 * placeholder there, which here means no label.
 */
function bracketed(label: Label | null): Label | null {
  if (label === null || label.text.length === 0) {
    return null;
  }
  const rows = label.rows.map((row) => row.map((run) => ({ ...run })));
  rows[0]![0]!.text = `[${rows[0]![0]!.text}`;
  const lastRow = rows[rows.length - 1]!;
  lastRow[lastRow.length - 1]!.text += "]";
  return { text: `[${label.text}]`, rows };
}

/**
 * A block's or divider's condition, measured and placed: anchored at the
 * centre of its box, whose left edge is `BLOCK_LABEL_INSET_X` past `left`
 * and whose first row is centred `BLOCK_LABEL_FIRST_ROW_Y` below `lineY` —
 * the frame's top edge or the divider's line — so a condition of several
 * rows begins where a one-row condition does and grows downward into the
 * band its rows added. `null` for no condition.
 */
function placeCondition(
  label: Label | null,
  ctx: SequenceLayoutContext,
  left: number,
  lineY: number,
): PlacedLabel | null {
  if (label === null) {
    return null;
  }
  const labelBox = layoutLabel(label, ctx.measureText, SEQUENCE_LINE);
  return {
    label,
    labelBox,
    anchor: {
      x: left + BLOCK_LABEL_INSET_X + labelBox.width / 2,
      y: lineY + BLOCK_LABEL_FIRST_ROW_Y - labelBox.rows[0]!.y + labelBox.height / 2,
    },
  };
}

/**
 * The height of every row of `box` but `kept`: what a label of several rows
 * adds to a band sized for one, where `kept` is the row that sits where a
 * one-row label would — and `0` for no label at all, or a label of one row.
 * Counted from the rows alone, not from `box.height`, which also holds the
 * measurer's vertical padding: the band sized for one row already has room
 * for that, so adding it again would push every one-row message and
 * condition down by it.
 */
function heightBesides(box: LabelBox | null, kept: number): number {
  if (box === null) {
    return 0;
  }
  return box.rows.reduce((sum, row, index) => (index === kept ? sum : sum + row.height), 0);
}

function layoutMessage(
  message: ResolvedSequenceMessage,
  labelBox: LabelBox,
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
    label: {
      label: message.label,
      labelBox,
      anchor: { x: (fromX + toX) / 2, y: y - MESSAGE_LABEL_GAP - labelBox.height / 2 },
    },
    arrow: message.arrow,
    autonumber: message.autonumber,
    y,
    fromX,
    toX,
  };
}

/**
 * Computes participant lane x-positions, each lifeline's y-extent —
 * full-height (ending at the reserved bottom row where a
 * never-destroyed participant's box is drawn again), or truncated to its
 * creating message's row and its destroying message's row (a refused
 * `create` or `destroy`, with no such message, to its own row) — each
 * message's
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
    destroyedOnOwnRow: destroyedOnOwnRow(model),
    createdByMessage: pairedByMessage(model.statements, "creates"),
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
  // caption lower — by the tallest caption, every row of it — whenever a
  // labelled box would otherwise be drawn behind (and hidden by) the
  // participant boxes it groups.
  const boxLabelBoxes = model.boxes.map((box) =>
    box.label === null ? null : layoutLabel(box.label, options.measureText, SEQUENCE_PARTICIPANT_LINE),
  );
  const topRowTop =
    titleHeight + boxLabelBoxes.reduce((max, box) => Math.max(max, box?.height ?? 0), 0);

  const { elements, endY } = layoutStatements(model.statements, ctx, topRowTop + topRowHeight);
  // Every participant never destroyed, declared or `create`d, is drawn in
  // the bottom row (measured on Mermaid 12.2.0: a created participant's
  // bottom box is level with a declared one's); a destroyed one is not.
  for (const participant of participants) {
    participant.drawnInBottomRow = !ctx.destroyedBottomById.has(participant.id);
  }
  // The bottom row exists only for participants drawn there. A diagram whose
  // lanes are all destroyed reserves nothing, rather than trailing an empty
  // band the renderer never fills.
  const bottomRowHeight = participants.reduce(
    (max, p) => (p.drawnInBottomRow ? Math.max(max, p.height) : max),
    0,
  );
  // A bottom-row box's link menu opens upward, ending at that box's top edge
  // (`PositionedSequenceLinkMenu.rowHeight`). A short diagram would push it
  // above the canvas, so its lifeline is stretched until the rows fit
  // between the top box and the bottom one.
  const lifelineBottom = participants.reduce(
    (bottom, p) =>
      p.linkMenu && p.drawnInBottomRow
        ? Math.max(bottom, topRowTop + p.height + p.linkMenu.rowHeight * p.linkMenu.links.length + p.height)
        : bottom,
    endY + BOTTOM_MARGIN + bottomRowHeight,
  );

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

  const boxes = model.boxes.map((box, index) =>
    layoutBox(box, boxLabelBoxes[index]!, ctx.participantsById, titleHeight, lifelineBottom),
  );
  const rightmostBoxEdge = boxes.reduce((max, box) => Math.max(max, box.x + box.width), 0);

  const extent = placeLinkMenus(
    participants,
    Math.max(rightmostParticipantEdge, rightmostBlockEdge, rightmostBoxEdge) + RIGHT_MARGIN,
    lifelineBottom,
  );

  return {
    title: model.title,
    accTitle: model.accTitle,
    accDescr: model.accDescr,
    participants,
    boxes,
    elements,
    activations: ctx.closedActivations,
    width: extent.width,
    height: extent.height,
  };
}

/**
 * Every participant a message destroys (`"destroys"`) or creates
 * (`"creates"`), anywhere in the statement tree (block bodies included).
 */
function pairedByMessage(
  statements: readonly ResolvedSequenceStatement[],
  mark: "destroys" | "creates",
): Set<string> {
  const ids = new Set<string>();
  for (const statement of statements) {
    if (statement.kind === "message" && statement.message[mark] !== undefined) {
      ids.add(statement.message[mark]);
    } else if (statement.kind === "block") {
      for (const branch of statement.block.branches) {
        for (const id of pairedByMessage(branch.statements, mark)) ids.add(id);
      }
    }
  }
  return ids;
}

/** `SequenceLayoutContext.destroyedOnOwnRow`: ended by the model, destroyed by no message. */
function destroyedOnOwnRow(model: SequenceModel): Set<string> {
  const byMessage = pairedByMessage(model.statements, "destroys");
  return new Set(
    model.participants.filter((p) => p.destroyedAt !== null && !byMessage.has(p.id)).map((p) => p.id),
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
