import type {
  ClassRelationshipEnd,
  ClassStyleProperty,
  Point,
  PositionedClass,
  PositionedClassCompartment,
  PositionedClassDiagram,
  PositionedClassNamespace,
  PositionedClassNote,
  PositionedClassRelationship,
  ResolvedClassInteraction,
} from "../contracts";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Marker id in `<defs>` for each endpoint style, or `null` for `"none"` (no
 * marker at all). One def per shape serves both ends: the defs below are
 * `orient="auto-start-reverse"`, so the same marker points outward whether
 * it is applied as `marker-start` or `marker-end` — the sequence renderer's
 * `bidirectionalFilled` trick, which class relationships need generally
 * because Mermaid decorates the from-end (`Animal <|-- Duck`) as often as
 * the to-end (`Duck ..|> Flyer`).
 */
const TRIANGLE_MARKER_ID = "siren-class-triangle";
const DIAMOND_FILLED_MARKER_ID = "siren-class-diamond-filled";
const DIAMOND_HOLLOW_MARKER_ID = "siren-class-diamond-hollow";
const ARROW_MARKER_ID = "siren-class-arrow";

const END_MARKER_ID: Record<ClassRelationshipEnd, string | null> = {
  none: null,
  triangle: TRIANGLE_MARKER_ID,
  diamondFilled: DIAMOND_FILLED_MARKER_ID,
  diamondHollow: DIAMOND_HOLLOW_MARKER_ID,
  arrow: ARROW_MARKER_ID,
};

/**
 * The canonical Mermaid name for a `{ line, decorated end }` pair, emitted
 * as `data-siren-relationship`. Keyed by the decorated end rather than by
 * from/to, so a relationship and its mirrored spelling (`Animal <|-- Duck`
 * and `Duck --|> Animal`) report the same type.
 */
const RELATIONSHIP_TYPE_NAME: Record<string, string> = {
  "solid|triangle": "inheritance",
  "solid|diamondFilled": "composition",
  "solid|diamondHollow": "aggregation",
  "solid|arrow": "association",
  "solid|none": "link",
  "dashed|arrow": "dependency",
  "dashed|triangle": "realization",
  "dashed|none": "dashedLink",
};

/**
 * Dash pattern for a `dashed` relationship line. Longer than the sequence
 * renderer's `4,3` dotted messages: Mermaid draws a class diagram's
 * dependency/realization lines as dashes, visibly distinct from a dotted
 * message even at small scale.
 */
const DASH_PATTERN = "6,4";

/**
 * Builds a real `SVGSVGElement` from a `PositionedClassDiagram`, per the
 * frozen SVG conventions in spec.md ("SVG conventions" bullet list): one
 * `<g class="siren-class">` per class (frame rect, name, compartment
 * dividers, member lines) and one `<g class="siren-relationship">` per
 * relationship (line with the markers and dash its
 * `{ line, fromEnd, toEnd }` triple calls for, label, multiplicity), one
 * `<g class="siren-namespace">` per namespace frame and one
 * `<g class="siren-note">` per note, plus the initial `siren-pending` class
 * on elements with an `enter` action in the resolved timeline (see
 * `pendingElementIds` for the exact rule).
 *
 * Document order is the paint order: namespace frames, then classes, then
 * relationships, then notes.
 *
 * A class the author made interactive or styled also carries that here: the
 * resolved declarations become an inline `style` on the frame rect (ADR-0008),
 * an allowed `href` wraps the group in `<a class="siren-link">`, a callback
 * marks it `data-siren-click`, and a tooltip becomes a leading `<title>`. The
 * click *listener* is deliberately not attached here — `render()` owns that,
 * so this stays a pure DOM-building function with no event wiring.
 */
export function renderClassDiagramToSVG(diagram: PositionedClassDiagram): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(diagram.width));
  svg.setAttribute("height", String(diagram.height));
  svg.setAttribute("viewBox", `0 0 ${diagram.width} ${diagram.height}`);

  const pendingIds = pendingElementIds(diagram);

  svg.appendChild(buildDefs());

  // Namespaces first, and nothing else before them: SVG has no z-index, so a
  // frame is behind the boxes it encloses only by being drawn before them.
  for (const namespace of diagram.namespaces) {
    svg.appendChild(buildNamespace(namespace));
  }

  for (const positionedClass of diagram.classes) {
    const group = buildClass(positionedClass, pendingIds.has(positionedClass.id));
    svg.appendChild(wrapInteraction(group, positionedClass.interaction));
  }

  for (const relationship of diagram.relationships) {
    svg.appendChild(buildRelationship(relationship, pendingIds.has(relationship.id)));
  }

  // Notes last: a note box is opaque, and it annotates the figure rather than
  // being part of it, so nothing drawn here should cover one.
  for (const note of diagram.notes) {
    svg.appendChild(buildNote(note));
  }

  return svg;
}

/**
 * Ids of elements with an `enter` action in the diagram's resolved
 * timeline. Only these start hidden as `siren-pending`; an element whose
 * only actions are `exit`/`highlight`/`unhighlight` must already be visible,
 * and one never mentioned in the timeline renders visible too — the same
 * rule as `renderToSVG`, and for the same reason.
 */
function pendingElementIds(diagram: PositionedClassDiagram): Set<string> {
  const ids = new Set<string>();
  for (const entry of diagram.timeline.entries) {
    if (entry.kind === "enter") {
      ids.add(entry.targetId);
    }
  }
  return ids;
}

/**
 * Builds the `<g class="siren-relationship">` for one relationship: a
 * `<path class="siren-relationship-line">` following the layout's points.
 */
function buildRelationship(
  relationship: PositionedClassRelationship,
  pending: boolean,
): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", pending ? "siren-relationship siren-pending" : "siren-relationship");
  g.setAttribute("data-siren-id", relationship.id);
  g.setAttribute("data-siren-relationship", relationshipTypeName(relationship));

  const line = document.createElementNS(SVG_NS, "path");
  line.setAttribute("class", "siren-relationship-line");
  line.setAttribute("d", pointsToPathData(relationship.points));
  // Explicit, not left to CSS: a relationship's points make an open,
  // multi-segment path, which a default fill would paint as a filled polygon
  // over the classes it connects.
  line.setAttribute("fill", "none");

  const startMarker = END_MARKER_ID[relationship.fromEnd];
  if (startMarker !== null) {
    line.setAttribute("marker-start", `url(#${startMarker})`);
  }
  const endMarker = END_MARKER_ID[relationship.toEnd];
  if (endMarker !== null) {
    line.setAttribute("marker-end", `url(#${endMarker})`);
  }
  if (relationship.line === "dashed") {
    line.setAttribute("stroke-dasharray", DASH_PATTERN);
  }
  g.appendChild(line);

  const label = buildRelationshipText(
    "siren-relationship-label",
    relationship.label,
    relationship.labelAnchor,
  );
  if (label !== null) {
    g.appendChild(label);
  }

  for (const [text, anchor] of [
    [relationship.fromMultiplicity, relationship.fromMultiplicityAnchor],
    [relationship.toMultiplicity, relationship.toMultiplicityAnchor],
  ] as const) {
    const multiplicity = buildRelationshipText("siren-multiplicity", text, anchor);
    if (multiplicity !== null) {
      g.appendChild(multiplicity);
    }
  }

  return g;
}

/**
 * Builds one of a relationship's `<text>` elements at its layout-assigned
 * anchor, or `null` when the relationship carries no such text — an absent
 * label or multiplicity renders nothing at all, not an empty `<text>`.
 */
function buildRelationshipText(
  className: string,
  content: string | null,
  anchor: Point | null,
): SVGTextElement | null {
  if (content === null || anchor === null) {
    return null;
  }
  const text = document.createElementNS(SVG_NS, "text") as SVGTextElement;
  text.setAttribute("class", className);
  text.setAttribute("x", String(anchor.x));
  text.setAttribute("y", String(anchor.y));
  text.setAttribute("text-anchor", "middle");
  text.textContent = content;
  return text;
}

/**
 * The `data-siren-relationship` value for a relationship: the Mermaid type
 * name when its `{ line, fromEnd, toEnd }` triple spells one of the eight
 * canonical forms, and a composed `{line}-{fromEnd}-{toEnd}` descriptor
 * otherwise — the triple is two free axes, so combinations Mermaid has no
 * name for (a two-headed `<|--|>`, say) still have to describe themselves
 * rather than throw or report a wrong name.
 */
function relationshipTypeName(relationship: PositionedClassRelationship): string {
  const decorated = [relationship.fromEnd, relationship.toEnd].filter((end) => end !== "none");
  if (new Set(decorated).size > 1) {
    return `${relationship.line}-${relationship.fromEnd}-${relationship.toEnd}`;
  }
  const end = decorated[0] ?? "none";
  return RELATIONSHIP_TYPE_NAME[`${relationship.line}|${end}`] ?? `${relationship.line}-${end}`;
}

/**
 * Builds the shared `<defs>` block: one `<marker>` per endpoint shape.
 * `markerUnits="userSpaceOnUse"` (not the SVG default) keeps every endpoint
 * a fixed absolute size when a highlighted relationship's stroke-width
 * changes, and `refX` equals `markerWidth` throughout so the shape's tip
 * lands exactly on the path's endpoint — both for the reasons recorded in
 * `renderToSVG.ts`.
 */
function buildDefs(): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, "defs") as SVGDefsElement;
  // A hollow shape has to be filled with the surface color rather than left
  // unfilled: an unfilled UML triangle/diamond lets the relationship line
  // show straight through the middle of the head.
  defs.appendChild(
    buildMarker(TRIANGLE_MARKER_ID, 12, 10, "M0,0 L12,5 L0,10 Z", "siren-arrow-hollow"),
  );
  defs.appendChild(
    buildMarker(DIAMOND_FILLED_MARKER_ID, 14, 10, "M0,5 L7,0 L14,5 L7,10 Z", "siren-arrow-fill"),
  );
  defs.appendChild(
    buildMarker(DIAMOND_HOLLOW_MARKER_ID, 14, 10, "M0,5 L7,0 L14,5 L7,10 Z", "siren-arrow-hollow"),
  );
  // The association/dependency head is an open V — two strokes, never
  // closed, so it must not be filled (the `siren-arrow-stroke` precedent
  // from the sequence renderer's open marker).
  defs.appendChild(
    buildMarker(ARROW_MARKER_ID, 8, 8, "M0,0 L8,4 L0,8", "siren-arrow-stroke", true),
  );
  return defs;
}

/**
 * Builds one endpoint `<marker>`, its tip at the path's endpoint and
 * oriented outward at whichever end it is applied to.
 */
function buildMarker(
  id: string,
  width: number,
  height: number,
  d: string,
  shapeClass: string,
  unfilled = false,
): SVGMarkerElement {
  const marker = document.createElementNS(SVG_NS, "marker") as SVGMarkerElement;
  marker.setAttribute("id", id);
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("markerWidth", String(width));
  marker.setAttribute("markerHeight", String(height));
  marker.setAttribute("refX", String(width));
  marker.setAttribute("refY", String(height / 2));
  marker.setAttribute("orient", "auto-start-reverse");

  const shape = document.createElementNS(SVG_NS, "path");
  shape.setAttribute("d", d);
  shape.setAttribute("class", shapeClass);
  if (unfilled) {
    shape.setAttribute("fill", "none");
  }
  marker.appendChild(shape);
  return marker;
}

/** Converts a layout-assigned point path into an SVG `<path>` `d` attribute. */
function pointsToPathData(points: Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
}

/**
 * Builds the `<g class="siren-class">` for one class: a
 * `<rect class="siren-class-frame">` at its layout-assigned box, a
 * `<text class="siren-class-name">` centered in the name compartment, and —
 * per compartment the layout recorded — a
 * `<line class="siren-class-divider">` above one
 * `<text class="siren-member">` per member line.
 *
 * As on `.siren-node`, `data-siren-id` and the animation classes land on
 * this enclosing `<g>`; its parts carry none of their own.
 */
function buildClass(positionedClass: PositionedClass, pending: boolean): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", pending ? "siren-class siren-pending" : "siren-class");
  g.setAttribute("data-siren-id", positionedClass.id);

  // First child, before the frame: SVG surfaces a `<title>` as the hover
  // tooltip only when it is its parent's first child element.
  const tooltip = positionedClass.interaction?.tooltip ?? null;
  if (tooltip !== null) {
    const title = document.createElementNS(SVG_NS, "title");
    // textContent, never innerHTML — a tooltip is author input like any label.
    title.textContent = tooltip;
    g.appendChild(title);
  }

  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("class", "siren-class-frame");
  frame.setAttribute("x", String(positionedClass.x));
  frame.setAttribute("y", String(positionedClass.y));
  frame.setAttribute("width", String(positionedClass.width));
  frame.setAttribute("height", String(positionedClass.height));
  applyAuthorStyle(frame, positionedClass.style);
  g.appendChild(frame);

  const centerX = positionedClass.x + positionedClass.width / 2;
  const band = nameBand(positionedClass);
  if (positionedClass.annotation === null) {
    g.appendChild(
      buildCenteredText("siren-class-name", positionedClass.name, {
        x: centerX,
        y: (band.top + band.bottom) / 2,
      }),
    );
  } else {
    // Two lines share the band — `planClassBox` reserved a line above the name
    // for the annotation — so each takes half of it. The annotation is drawn
    // in Mermaid's guillemets, which is also why the layout measured it
    // without them.
    const split = (band.top + band.bottom) / 2;
    g.appendChild(
      buildCenteredText("siren-class-annotation", `«${positionedClass.annotation}»`, {
        x: centerX,
        y: (band.top + split) / 2,
      }),
    );
    g.appendChild(
      buildCenteredText("siren-class-name", positionedClass.name, {
        x: centerX,
        y: (split + band.bottom) / 2,
      }),
    );
  }

  for (const compartment of compartmentsOf(positionedClass)) {
    g.appendChild(buildDivider(positionedClass, compartment.dividerY));
    for (const member of compartment.members) {
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("class", "siren-member");
      text.setAttribute("x", String(member.x));
      text.setAttribute("y", String(member.y));
      text.setAttribute("text-anchor", "start");
      // textContent, never innerHTML — the hard invariant of every Siren
      // renderer: member text is author input and must render literally.
      text.textContent = member.text;
      g.appendChild(text);
    }
  }

  return g;
}

/**
 * Builds the `<g class="siren-namespace">` for one namespace: a
 * `<rect class="siren-namespace-frame">` at the frame the layout grew around
 * its member boxes, and a `<text class="siren-namespace-label">` centered on
 * the layout-assigned anchor in the strip along the frame's top edge.
 */
function buildNamespace(namespace: PositionedClassNamespace): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-namespace");
  g.setAttribute("data-siren-id", namespace.id);

  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("class", "siren-namespace-frame");
  frame.setAttribute("x", String(namespace.x));
  frame.setAttribute("y", String(namespace.y));
  frame.setAttribute("width", String(namespace.width));
  frame.setAttribute("height", String(namespace.height));
  g.appendChild(frame);

  g.appendChild(
    buildCenteredText("siren-namespace-label", namespace.label, namespace.labelAnchor),
  );
  return g;
}

/**
 * Builds the `<g class="siren-note">` for one note: a
 * `<rect class="siren-note-frame">` at its layout-assigned box with the note's
 * text centered inside it, plus — for an attached note only — a
 * `<path class="siren-note-link">` along the connector the layout routed from
 * the note to the class it annotates. A free note is a box on its own.
 *
 * The text is centered rather than placed at an anchor of its own because
 * `PositionedClassNote` carries no anchor: `layoutClassDiagram` sizes the box
 * by padding the one line it measured, so the box's center *is* where that
 * line goes.
 */
function buildNote(note: PositionedClassNote): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-note");
  g.setAttribute("data-siren-id", note.id);

  if (note.linkPoints !== null) {
    const link = document.createElementNS(SVG_NS, "path");
    link.setAttribute("class", "siren-note-link");
    link.setAttribute("d", pointsToPathData(note.linkPoints));
    // Explicit, for the same reason a relationship line carries it: an open,
    // multi-segment path would otherwise be painted as a filled polygon.
    link.setAttribute("fill", "none");
    g.appendChild(link);
  }

  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("class", "siren-note-frame");
  frame.setAttribute("x", String(note.x));
  frame.setAttribute("y", String(note.y));
  frame.setAttribute("width", String(note.width));
  frame.setAttribute("height", String(note.height));
  g.appendChild(frame);

  g.appendChild(
    buildCenteredText("siren-note-text", note.text, {
      x: note.x + note.width / 2,
      y: note.y + note.height / 2,
    }),
  );
  return g;
}

/**
 * A `<text>` centered on `anchor` in both axes — the shape every box label in
 * this renderer takes, since the layout hands over a center point rather than
 * a baseline. Text is set with `textContent`, never `innerHTML`.
 */
function buildCenteredText(className: string, content: string, anchor: Point): SVGTextElement {
  const text = document.createElementNS(SVG_NS, "text") as SVGTextElement;
  text.setAttribute("class", className);
  text.setAttribute("x", String(anchor.x));
  text.setAttribute("y", String(anchor.y));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  text.textContent = content;
  return text;
}

/** The class's compartments in drawn order: attributes above methods, skipping the absent ones. */
function compartmentsOf(positionedClass: PositionedClass): PositionedClassCompartment[] {
  const compartments: PositionedClassCompartment[] = [];
  if (positionedClass.attributes !== null) {
    compartments.push(positionedClass.attributes);
  }
  if (positionedClass.methods !== null) {
    compartments.push(positionedClass.methods);
  }
  return compartments;
}

/**
 * The name compartment — the band between the box's top edge and the first
 * divider, or the whole box when the class declares no members. The frozen
 * `PositionedClass` carries no name or annotation anchor of its own, so the
 * dividers the layout recorded are what bound the band the two share.
 */
function nameBand(positionedClass: PositionedClass): { top: number; bottom: number } {
  const [firstCompartment] = compartmentsOf(positionedClass);
  return {
    top: positionedClass.y,
    bottom:
      firstCompartment === undefined
        ? positionedClass.y + positionedClass.height
        : firstCompartment.dividerY,
  };
}

/**
 * Applies a class's resolved interaction, returning whatever should be
 * appended to the diagram in the group's place: an `href` interaction returns
 * an `<a class="siren-link">` wrapping the group, anything else returns the
 * group itself.
 *
 * The group is wrapped rather than turned into a link so that `data-siren-id`,
 * the animation classes and the theme's `.siren-class` rules all keep landing
 * on the same element whether or not the author made the class clickable.
 *
 * The URL is written verbatim: `buildClassModel` has already checked it against
 * the `http`/`https`/`mailto` allowlist and dropped anything else with an error
 * diagnostic, so a `javascript:` URL never reaches this function.
 */
function wrapInteraction(
  group: SVGGElement,
  interaction: ResolvedClassInteraction | null,
): SVGElement {
  if (interaction === null) {
    return group;
  }

  if (interaction.interactionKind === "href") {
    const link = document.createElementNS(SVG_NS, "a");
    link.setAttribute("class", "siren-link");
    link.setAttribute("href", interaction.action);
    link.appendChild(group);
    return link;
  }

  // A callback is a hook, not navigation: the renderer attaches no listener of
  // its own (that is `render()`'s job, per the design contract) and emits no
  // `<a>`, which with no href would still take focus and show a link cursor
  // while going nowhere.
  group.setAttribute("data-siren-click", interaction.action);
  if (interaction.argument !== null) {
    group.setAttribute("data-siren-click-arg", interaction.argument);
  }
  return group;
}

/**
 * Writes the author's resolved `style`/`classDef`/`cssClass` declarations onto
 * `element` as an inline `style` attribute, in declaration order, or leaves the
 * element without one when the author styled nothing.
 *
 * Inline rather than a generated class rule, and on the drawn shape rather than
 * its enclosing `<g>` — both for the same cascade reason, recorded in ADR-0008.
 * The theme styles `.siren-class-frame` directly, so an inline declaration on
 * the frame outranks it without needing `!important`, while the same
 * declaration on the `<g>` would only ever be *inherited* by the frame and so
 * would lose to the theme's own rule.
 *
 * The values are written verbatim. They are author input, but they arrive here
 * having already passed `buildClassModel`'s gate (no `url(`, no `expression(`,
 * no `;`, no backslash), and re-checking here would fork that single source of
 * truth. This attribute is a CSS sink, never an HTML one: nothing is parsed as
 * markup, so the hard `textContent`-never-`innerHTML` invariant is untouched.
 */
function applyAuthorStyle(element: SVGElement, style: ClassStyleProperty[]): void {
  if (style.length === 0) {
    return;
  }
  element.setAttribute(
    "style",
    style.map(({ property, value }) => `${property}:${value}`).join(";"),
  );
}

/** Builds one `<line class="siren-class-divider">` spanning the class frame's full width. */
function buildDivider(positionedClass: PositionedClass, y: number): SVGLineElement {
  const line = document.createElementNS(SVG_NS, "line") as SVGLineElement;
  line.setAttribute("class", "siren-class-divider");
  line.setAttribute("x1", String(positionedClass.x));
  line.setAttribute("y1", String(y));
  line.setAttribute("x2", String(positionedClass.x + positionedClass.width));
  line.setAttribute("y2", String(y));
  return line;
}
