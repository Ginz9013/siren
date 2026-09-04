import type {
  ClassRelationshipEnd,
  Point,
  PositionedClass,
  PositionedClassCompartment,
  PositionedClassDiagram,
  PositionedClassRelationship,
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
 * `{ line, fromEnd, toEnd }` triple calls for, label, multiplicity), plus
 * the initial `siren-pending` class on elements with an `enter` action in
 * the resolved timeline (see `pendingElementIds` for the exact rule).
 *
 * Namespaces, notes and annotations, and author styling/links/click hooks
 * are deliberately not rendered here — later tickets on this board own
 * those parts of the frozen conventions.
 */
export function renderClassDiagramToSVG(diagram: PositionedClassDiagram): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(diagram.width));
  svg.setAttribute("height", String(diagram.height));
  svg.setAttribute("viewBox", `0 0 ${diagram.width} ${diagram.height}`);

  const pendingIds = pendingElementIds(diagram);

  svg.appendChild(buildDefs());

  for (const positionedClass of diagram.classes) {
    svg.appendChild(buildClass(positionedClass, pendingIds.has(positionedClass.id)));
  }

  for (const relationship of diagram.relationships) {
    svg.appendChild(buildRelationship(relationship, pendingIds.has(relationship.id)));
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

  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("class", "siren-class-frame");
  frame.setAttribute("x", String(positionedClass.x));
  frame.setAttribute("y", String(positionedClass.y));
  frame.setAttribute("width", String(positionedClass.width));
  frame.setAttribute("height", String(positionedClass.height));
  g.appendChild(frame);

  const name = document.createElementNS(SVG_NS, "text");
  name.setAttribute("class", "siren-class-name");
  name.setAttribute("x", String(positionedClass.x + positionedClass.width / 2));
  name.setAttribute("y", String(nameCenterY(positionedClass)));
  name.setAttribute("text-anchor", "middle");
  name.setAttribute("dominant-baseline", "middle");
  name.textContent = positionedClass.name;
  g.appendChild(name);

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
 * Vertical center of the name compartment — the band between the box's top
 * edge and the first divider, or the whole box when the class declares no
 * members. The frozen `PositionedClass` carries no name anchor of its own,
 * so the dividers the layout recorded are what bound the name's band.
 */
function nameCenterY(positionedClass: PositionedClass): number {
  const [firstCompartment] = compartmentsOf(positionedClass);
  const bandBottom =
    firstCompartment === undefined
      ? positionedClass.y + positionedClass.height
      : firstCompartment.dividerY;
  return (positionedClass.y + bandBottom) / 2;
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
