import type {
  PositionedBlock,
  PositionedBox,
  PositionedDestroyMark,
  PositionedMessage,
  PositionedParticipant,
  PositionedSequenceDiagram,
  PositionedSequenceElement,
  SequenceArrowHead,
} from "../contracts";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Horizontal/vertical inset for a block's header/branch condition labels
 * from the block frame's top-left corner — matches Mermaid's own visual
 * convention of hugging the frame's top-left, not centering.
 */
const BLOCK_LABEL_PADDING_X = 8;
const BLOCK_LABEL_PADDING_Y = 14;

/**
 * Half-diagonal of a destroy mark's X, in user units: each of its two
 * strokes runs from `-arm` to `+arm` on both axes around the lifeline's
 * truncation point.
 */
const DESTROY_MARK_ARM = 7;

/**
 * Baseline offset of a box's label from the top of its background rect —
 * Mermaid captions a box across the top of the group, above the
 * participants it contains, not centered in the fill.
 */
const BOX_LABEL_PADDING_Y = 14;

/**
 * Share of an `actor` row's reserved height `[top, top + height]` given to
 * the stick figure, measured from the row's top edge; the remainder is the
 * label's own band. An actor is the one participant shape whose label sits
 * beside its shape rather than inside it, so the row has to be split — drawing
 * the figure across the whole row and hanging the label off its bottom edge
 * (as this did before) printed the label through the figure's legs. 0.6 is
 * roughly Mermaid's own figure-to-label proportion, and leaves the label a
 * band comfortably taller than a line of text at the theme's font size.
 */
const ACTOR_ICON_BAND_RATIO = 0.6;

/**
 * Marker id in `<defs>` for each arrowhead style, or `null` for `"none"`
 * (no marker at all). `"filled"` and `"bidirectionalFilled"` share the same
 * marker id — `orient="auto-start-reverse"` on the `<marker>` def makes the
 * one def point outward correctly whether it's used as `marker-start` or
 * `marker-end`, so `bidirectionalFilled` just applies it at both ends
 * rather than needing a second mirrored def.
 */
const HEAD_MARKER_ID: Record<SequenceArrowHead, string | null> = {
  none: null,
  filled: "siren-arrow-filled",
  bidirectionalFilled: "siren-arrow-filled",
  cross: "siren-arrow-cross",
  open: "siren-arrow-open",
};

/**
 * Builds a real `SVGSVGElement` from a `PositionedSequenceDiagram`, per the
 * frozen SVG conventions in spec.md ("SVG conventions" bullet list): a
 * `<g class="siren-participant">` per participant at the top of its lifeline
 * (box for `participant`, stick figure for `actor`) plus a second one at the
 * diagram's bottom row for each declared, never-destroyed participant, one
 * `<line class="siren-lifeline">` per participant, one
 * `<g class="siren-message">` per message (all ten
 * arrow-marker/dash combinations), a `<g class="siren-block">` per
 * control-flow block (frame/fill, header/branch labels, dividers — see
 * `buildBlock`), a `<g class="siren-box">` background per participant
 * grouping, a `<path class="siren-destroy-mark">` per destroyed
 * participant's lifeline truncation point, and a `<text class="siren-title">`
 * when a title is present.
 */
export function renderSequenceToSVG(diagram: PositionedSequenceDiagram): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(diagram.width));
  svg.setAttribute("height", String(diagram.height));
  svg.setAttribute("viewBox", `0 0 ${diagram.width} ${diagram.height}`);

  svg.appendChild(buildDefs());

  if (diagram.title !== null) {
    svg.appendChild(buildTitle(diagram.title, diagram.width));
  }

  // Boxes first, before anything they group: SVG paints in document order,
  // so a background rect appended alongside its members would cover them.
  for (const box of diagram.boxes) {
    svg.appendChild(buildBox(box));
  }

  for (const participant of diagram.participants) {
    svg.appendChild(buildLifeline(participant));
  }

  for (const participant of diagram.participants) {
    svg.appendChild(buildParticipant(participant, participant.top));
  }

  // A preamble-declared participant that survives to the end of the diagram is
  // drawn a second time at the far end of its lifeline (Mermaid's own bottom
  // row); a `create`d or destroyed one is drawn only once. See spec.md's "SVG
  // conventions".
  const destroyedIds = collectDestroyedParticipantIds(diagram.elements);
  for (const participant of diagram.participants) {
    if (participant.origin !== "declared" || destroyedIds.has(participant.id)) {
      continue;
    }
    svg.appendChild(buildParticipant(participant, participant.bottom - participant.height));
  }

  for (const element of diagram.elements) {
    const node = buildSequenceElement(element);
    if (node !== null) {
      svg.appendChild(node);
    }
  }

  return svg;
}

/**
 * Builds the `<g class="siren-box">` for one participant grouping: a
 * `<rect class="siren-box-background">` at the box's bounding box, filled
 * with the author's `box <color>` when one was given. Emitted before the
 * participants/lifelines/messages it groups (see `renderSequenceToSVG`), so
 * it paints behind them rather than over them.
 */
function buildBox(box: PositionedBox): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-box");
  g.setAttribute("data-siren-id", box.id);

  const background = document.createElementNS(SVG_NS, "rect");
  background.setAttribute("class", "siren-box-background");
  background.setAttribute("x", String(box.x));
  background.setAttribute("y", String(box.y));
  background.setAttribute("width", String(box.width));
  background.setAttribute("height", String(box.height));
  if (box.color !== null) {
    background.setAttribute("fill", box.color);
  }
  g.appendChild(background);

  if (box.label !== null) {
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("class", "siren-box-label");
    label.setAttribute("x", String(box.x + box.width / 2));
    label.setAttribute("y", String(box.y + BOX_LABEL_PADDING_Y));
    label.setAttribute("text-anchor", "middle");
    label.textContent = box.label;
    g.appendChild(label);
  }

  return g;
}

/** Dispatches one `PositionedSequenceElement` to its builder. */
function buildSequenceElement(element: PositionedSequenceElement): SVGElement | null {
  switch (element.kind) {
    case "message":
      return buildMessage(element.message);
    case "block":
      return buildBlock(element.block);
    case "destroyMark":
      return buildDestroyMark(element.mark);
  }
}

/**
 * Builds the `<path class="siren-destroy-mark">` X at a destroyed
 * participant's lifeline truncation point: two crossing strokes as two
 * subpaths of one path, centered on the mark, with `fill="none"` so the
 * two subpaths are never closed into a filled quad however this element is
 * themed (same explicit-`fill="none"` precedent as `buildOpenMarker`).
 */
function buildDestroyMark(mark: PositionedDestroyMark): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path") as SVGPathElement;
  path.setAttribute("class", "siren-destroy-mark");
  path.setAttribute("data-siren-id", mark.participantId);

  const left = mark.x - DESTROY_MARK_ARM;
  const right = mark.x + DESTROY_MARK_ARM;
  const top = mark.y - DESTROY_MARK_ARM;
  const bottom = mark.y + DESTROY_MARK_ARM;
  path.setAttribute("d", `M${left},${top} L${right},${bottom} M${right},${top} L${left},${bottom}`);
  path.setAttribute("fill", "none");
  return path;
}

/**
 * Builds the `<g class="siren-block">` for one control-flow block: for the
 * six framed kinds (`loop`/`alt`/`opt`/`par`/`critical`/`break`), a
 * `<rect class="siren-block-frame">` at the block's exact bounding box (with
 * `fill="none"` so it never obscures nested content regardless of paint
 * order — mirrors the `fill="none"` precedent in `buildOpenMarker` below),
 * a top-left `<text class="siren-block-label">` for the header condition,
 * and one `<line class="siren-block-divider">` (+ label, when given) per
 * branch after the first. `rect` blocks get a distinct treatment instead —
 * see `buildBlockFill`. Children (messages/nested blocks) are always
 * rendered afterward, in document order, so they paint on top of this
 * block's own frame/fill.
 */
function buildBlock(block: PositionedBlock): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-block");
  g.setAttribute("data-siren-id", block.id);
  g.setAttribute("data-siren-block-kind", block.kind);

  if (block.kind === "rect") {
    g.appendChild(buildBlockFill(block));
  } else {
    g.appendChild(buildBlockFrame(block));
    g.appendChild(
      buildBlockLabel(block.label ?? "", block.x + BLOCK_LABEL_PADDING_X, block.y + BLOCK_LABEL_PADDING_Y),
    );
    for (const divider of block.dividers) {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("class", "siren-block-divider");
      line.setAttribute("x1", String(block.x));
      line.setAttribute("y1", String(divider.y));
      line.setAttribute("x2", String(block.x + block.width));
      line.setAttribute("y2", String(divider.y));
      g.appendChild(line);

      if (divider.label !== null) {
        g.appendChild(
          buildBlockLabel(
            divider.label,
            block.x + BLOCK_LABEL_PADDING_X,
            divider.y + BLOCK_LABEL_PADDING_Y,
          ),
        );
      }
    }
  }

  for (const child of block.children) {
    const node = buildSequenceElement(child);
    if (node !== null) {
      g.appendChild(node);
    }
  }

  return g;
}

/** Builds the outlined `<rect class="siren-block-frame">` for a non-`rect`-kind block. */
function buildBlockFrame(block: PositionedBlock): SVGRectElement {
  const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
  rect.setAttribute("class", "siren-block-frame");
  rect.setAttribute("x", String(block.x));
  rect.setAttribute("y", String(block.y));
  rect.setAttribute("width", String(block.width));
  rect.setAttribute("height", String(block.height));
  // Explicit, not left to CSS: an unfilled frame must never obscure the
  // nested content painted after it, however this element is themed.
  rect.setAttribute("fill", "none");
  return rect;
}

/**
 * Builds the filled `<rect class="siren-block-fill">` for a `rect`-kind
 * block: the background-highlight treatment, with no frame border, using
 * the `rect rgb(...)`/`rgba(...)` color Mermaid syntax captured — per the
 * frozen `PositionedBlock` shape, which carries no separate color field —
 * in this block's `label`.
 */
function buildBlockFill(block: PositionedBlock): SVGRectElement {
  const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
  rect.setAttribute("class", "siren-block-fill");
  rect.setAttribute("x", String(block.x));
  rect.setAttribute("y", String(block.y));
  rect.setAttribute("width", String(block.width));
  rect.setAttribute("height", String(block.height));
  rect.setAttribute("fill", block.label ?? "none");
  return rect;
}

/** Builds one top-left-anchored `<text class="siren-block-label">`. */
function buildBlockLabel(text: string, x: number, y: number): SVGTextElement {
  const label = document.createElementNS(SVG_NS, "text") as SVGTextElement;
  label.setAttribute("class", "siren-block-label");
  label.setAttribute("x", String(x));
  label.setAttribute("y", String(y));
  label.setAttribute("text-anchor", "start");
  label.textContent = text;
  return label;
}

/** Builds the `<text class="siren-title">`, centered above the diagram. */
function buildTitle(title: string, diagramWidth: number): SVGTextElement {
  const text = document.createElementNS(SVG_NS, "text") as SVGTextElement;
  text.setAttribute("class", "siren-title");
  text.setAttribute("x", String(diagramWidth / 2));
  text.setAttribute("y", "20");
  text.setAttribute("text-anchor", "middle");
  text.textContent = title;
  return text;
}

/**
 * Builds the `<g class="siren-message">` for one message: a
 * `<path class="siren-message-arrow">` with marker-start/marker-end and
 * stroke-dasharray matching its `{ line, head }`, a
 * `<text class="siren-message-label">`, and — when autonumbering was
 * active for this message — an adjacent `<text class="siren-autonumber">`.
 */
function buildMessage(message: PositionedMessage): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-message");
  g.setAttribute("data-siren-id", message.id);

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("class", "siren-message-arrow");
  path.setAttribute("d", `M${message.fromX},${message.y} L${message.toX},${message.y}`);

  const markerId = HEAD_MARKER_ID[message.arrow.head];
  if (markerId !== null) {
    path.setAttribute("marker-end", `url(#${markerId})`);
    if (message.arrow.head === "bidirectionalFilled") {
      path.setAttribute("marker-start", `url(#${markerId})`);
    }
  }
  if (message.arrow.line === "dotted") {
    path.setAttribute("stroke-dasharray", "4,3");
  }
  g.appendChild(path);

  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("class", "siren-message-label");
  label.setAttribute("x", String((message.fromX + message.toX) / 2));
  label.setAttribute("y", String(message.y - 6));
  label.setAttribute("text-anchor", "middle");
  label.textContent = message.text;
  g.appendChild(label);

  if (message.autonumber !== null) {
    const autonumber = document.createElementNS(SVG_NS, "text");
    autonumber.setAttribute("class", "siren-autonumber");
    autonumber.setAttribute("x", String(Math.min(message.fromX, message.toX) - 12));
    autonumber.setAttribute("y", String(message.y + 4));
    autonumber.textContent = String(message.autonumber);
    g.appendChild(autonumber);
  }

  return g;
}

/**
 * Builds the shared `<defs>` block: one `<marker>` per distinct arrowhead
 * shape (`"none"` needs none; `"filled"`/`"bidirectionalFilled"` share one).
 */
function buildDefs(): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, "defs") as SVGDefsElement;
  defs.appendChild(buildFilledMarker());
  defs.appendChild(buildCrossMarker());
  defs.appendChild(buildOpenMarker());
  return defs;
}

function buildFilledMarker(): SVGMarkerElement {
  const marker = document.createElementNS(SVG_NS, "marker") as SVGMarkerElement;
  marker.setAttribute("id", "siren-arrow-filled");
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("markerWidth", "8");
  marker.setAttribute("markerHeight", "6");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "3");
  marker.setAttribute("orient", "auto-start-reverse");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M0,0 L8,3 L0,6 Z");
  path.setAttribute("class", "siren-arrow-fill");
  marker.appendChild(path);
  return marker;
}

function buildCrossMarker(): SVGMarkerElement {
  const marker = document.createElementNS(SVG_NS, "marker") as SVGMarkerElement;
  marker.setAttribute("id", "siren-arrow-cross");
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("markerWidth", "8");
  marker.setAttribute("markerHeight", "8");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "4");
  marker.setAttribute("orient", "auto-start-reverse");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M0,0 L8,8 M8,0 L0,8");
  path.setAttribute("class", "siren-arrow-stroke");
  marker.appendChild(path);
  return marker;
}

function buildOpenMarker(): SVGMarkerElement {
  const marker = document.createElementNS(SVG_NS, "marker") as SVGMarkerElement;
  marker.setAttribute("id", "siren-arrow-open");
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("markerWidth", "8");
  marker.setAttribute("markerHeight", "8");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "4");
  marker.setAttribute("orient", "auto-start-reverse");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M0,0 L8,4 L0,8");
  path.setAttribute("class", "siren-arrow-stroke");
  path.setAttribute("fill", "none");
  marker.appendChild(path);
  return marker;
}

/**
 * Builds the `<line class="siren-lifeline">` for one participant, spanning
 * its layout-assigned top-to-bottom extent.
 */
function buildLifeline(participant: PositionedParticipant): SVGLineElement {
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("class", "siren-lifeline");
  line.setAttribute("data-siren-id", participant.id);
  line.setAttribute("x1", String(participant.x));
  line.setAttribute("y1", String(participant.top));
  line.setAttribute("x2", String(participant.x));
  line.setAttribute("y2", String(participant.bottom));
  return line;
}

/**
 * Every participant id carrying a destroy mark anywhere in the diagram — the
 * renderer's way of telling a destroyed lifeline from a surviving one, since
 * the frozen `PositionedParticipant` shape carries `origin` but no destroyed
 * flag. Recurses into block children, because a `destroy` written inside a
 * `loop`/`alt`/... body puts its mark there rather than at the top level.
 */
function collectDestroyedParticipantIds(
  elements: PositionedSequenceElement[],
  ids: Set<string> = new Set<string>(),
): Set<string> {
  for (const element of elements) {
    if (element.kind === "destroyMark") {
      ids.add(element.mark.participantId);
    } else if (element.kind === "block") {
      collectDestroyedParticipantIds(element.block.children, ids);
    }
  }
  return ids;
}

/**
 * Builds the `<g class="siren-participant">` for one participant, with its
 * shape's top edge at `top`: a `<rect>`+`<text>` box for
 * `kind: "participant"`, or a stick-figure `<g>` (head circle + body/arm/leg
 * lines) + `<text>` label for `kind: "actor"`. `top` is a parameter rather
 * than read off the participant because a surviving declared participant is
 * drawn twice — once at its lifeline's top, once at the bottom row.
 */
function buildParticipant(participant: PositionedParticipant, top: number): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-participant");
  g.setAttribute("data-siren-id", participant.id);

  if (participant.participantKind === "actor") {
    g.appendChild(buildActorIcon(participant, top));

    // The figure owns the top of the row and the label owns what is left, so
    // the two never share pixels; centring the label in that free band (rather
    // than sitting it on the band's bottom edge) keeps ascenders and
    // descenders inside the row, exactly as a participant box's label does.
    const iconBottom = top + participant.height * ACTOR_ICON_BAND_RATIO;
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(participant.x));
    text.setAttribute("y", String((iconBottom + top + participant.height) / 2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.textContent = participant.label;
    g.appendChild(text);

    return g;
  }

  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", String(participant.x - participant.width / 2));
  rect.setAttribute("y", String(top));
  rect.setAttribute("width", String(participant.width));
  rect.setAttribute("height", String(participant.height));
  g.appendChild(rect);

  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", String(participant.x));
  text.setAttribute("y", String(top + participant.height / 2));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  text.textContent = participant.label;
  g.appendChild(text);

  return g;
}

/**
 * Builds the stick-figure icon for an `actor` participant: a head circle,
 * a body line, an arm line, and two leg lines, drawn inside the icon band —
 * the top `ACTOR_ICON_BAND_RATIO` of the participant's layout-assigned row
 * `[top, top + height]`. The rest of the row is the label's band (see
 * `buildParticipant`); drawing the figure across the whole row instead put the
 * label's glyphs straight through the figure's legs.
 */
function buildActorIcon(participant: PositionedParticipant, top: number): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  const centerX = participant.x;
  const iconHeight = participant.height * ACTOR_ICON_BAND_RATIO;
  const headRadius = Math.max(Math.min(participant.width, iconHeight) / 6, 4);
  const headCenterY = top + headRadius;
  const bodyTopY = headCenterY + headRadius;
  const bodyBottomY = top + iconHeight * 0.7;
  const legBottomY = top + iconHeight;

  const head = document.createElementNS(SVG_NS, "circle");
  head.setAttribute("cx", String(centerX));
  head.setAttribute("cy", String(headCenterY));
  head.setAttribute("r", String(headRadius));
  g.appendChild(head);

  const body = document.createElementNS(SVG_NS, "line");
  body.setAttribute("x1", String(centerX));
  body.setAttribute("y1", String(bodyTopY));
  body.setAttribute("x2", String(centerX));
  body.setAttribute("y2", String(bodyBottomY));
  g.appendChild(body);

  const armSpan = participant.width / 3;
  const armY = bodyTopY + (bodyBottomY - bodyTopY) * 0.3;
  const arms = document.createElementNS(SVG_NS, "line");
  arms.setAttribute("x1", String(centerX - armSpan));
  arms.setAttribute("y1", String(armY));
  arms.setAttribute("x2", String(centerX + armSpan));
  arms.setAttribute("y2", String(armY));
  g.appendChild(arms);

  const legSpan = participant.width / 4;
  const legLeft = document.createElementNS(SVG_NS, "line");
  legLeft.setAttribute("x1", String(centerX));
  legLeft.setAttribute("y1", String(bodyBottomY));
  legLeft.setAttribute("x2", String(centerX - legSpan));
  legLeft.setAttribute("y2", String(legBottomY));
  g.appendChild(legLeft);

  const legRight = document.createElementNS(SVG_NS, "line");
  legRight.setAttribute("x1", String(centerX));
  legRight.setAttribute("y1", String(bodyBottomY));
  legRight.setAttribute("x2", String(centerX + legSpan));
  legRight.setAttribute("y2", String(legBottomY));
  g.appendChild(legRight);

  return g;
}
