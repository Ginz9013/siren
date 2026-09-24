import type {
  ErCardinality,
  Point,
  PositionedErDiagram,
  PositionedErEntity,
  PositionedErRelationship,
} from "../contracts";
import { mintIdScope } from "./mintIdScope";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The *base* name of each cardinality's marker — never an id on its own.
 * Every id this renderer mints is one of these plus the render's own scope
 * (`mintIdScope`), because `url(#id)` resolves against the whole document
 * rather than against the SVG it is written in.
 */
const MARKER_NAME: Record<ErCardinality, string> = {
  onlyOne: "siren-er-only-one",
  zeroOrOne: "siren-er-zero-or-one",
  oneOrMore: "siren-er-one-or-more",
  zeroOrMore: "siren-er-zero-or-more",
};

/**
 * Dash for a `nonIdentifying` relationship. Measured: Mermaid gives that
 * line the class `edge-pattern-dashed`, whose rule in the stylesheet it
 * emits inside the SVG is `stroke-dasharray: 8,8` — the whole of the
 * difference between `--` and `..` in its picture.
 *
 * Inline rather than a theme rule, for the reason `renderClassDiagramToSVG`
 * gives about its own: the dash is what the *document* said, not what the
 * theme prefers, and a consumer redeclaring `.siren-er-relationship-line`
 * must not be able to turn an identifying relationship into a
 * non-identifying one.
 */
const DASH_PATTERN = "8,8";

/**
 * How tall a cardinality marker's glyphs are drawn, and how far out along
 * the line each one sits from the entity box.
 *
 * The **figure** is Mermaid's, measured from its own marker definitions
 * (11.17.2) and confirmed against a rendered ER diagram: a "one" is a
 * vertical bar, an "optional" is a small hollow circle, and a "many" is a
 * closed almond of two quadratic curves — **not** three prongs, whatever
 * the name "crow's foot" suggests. Each cardinality is two of those, the
 * inner one saying *one* or *many* and the outer one saying *mandatory* or
 * *optional*.
 *
 * The **pixel counts** are Siren's (ADR-0004), and they differ from
 * Mermaid's in one deliberate way: every glyph here sits outside the entity
 * box, because `refX` equals `markerWidth` throughout — the convention
 * `renderClassDiagramToSVG` and `renderToSVG` already keep, so a marker
 * attaches by its tip wherever it is applied. Mermaid instead centres the
 * almond *on* the box's edge, half-burying it.
 */
const GLYPH_HEIGHT = 18;
const FOOT_LENGTH = 36;

/**
 * One relationship's route as an SVG `d`. Shared with the class renderer's
 * convention: an open, multi-segment path, so it is drawn with `fill:
 * none` rather than painted as a polygon over the boxes it joins.
 */
function pointsToPathData(points: Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
}

/**
 * Builds a real `SVGSVGElement` from a `PositionedErDiagram`: one
 * `<g class="siren-er-entity">` per entity, holding the
 * `<rect class="siren-er-entity-frame">` at the box layout placed and the
 * `<text class="siren-er-entity-label">` naming it, centred inside.
 *
 * **A plain rectangle, measured rather than chosen.** With `--markup`,
 * mermaid 11.17.2 draws an entity as a `rect.basic.label-container` carrying
 * no `rx` at all, with the name in a `<text>` inside it. No `rx` is written
 * here either, and for a second reason: a corner radius is decoration of the
 * box rather than the figure, so it belongs to the theme
 * (`--siren-node-border-radius`) where a consumer can reach it — ADR-0008,
 * and the rule a flowchart rectangle already follows.
 *
 * `data-siren-id` and the animation classes land on the enclosing `<g>`, as
 * they do on `.siren-node`, `.siren-class` and `.siren-state`; its two parts
 * carry none of their own, so one timeline entry moves an entity's box and
 * its name together (ADR-0009). A relationship's `<g>` carries its own id
 * the same way, over its line, its two markers and its label.
 *
 * ⚠️ **`fromCardinality` is `marker-start` and `toCardinality` is
 * `marker-end`, with nothing reversed anywhere.** Mermaid records the two
 * crossed (`cardA` is the marker next to `entityB` — see
 * `ErRelationshipDecl`) and undoes the crossing in its own renderer;
 * `parseErDiagram` undoes it once, at the only place it is ever seen, and
 * every stage after that is in the source's own left-to-right order. A
 * second reversal here would cancel out on `||--||`, `}|--|{` and `|o--o|`
 * and draw every other relationship backwards.
 *
 * Nothing here reads `diagram.timeline` — step 0 is
 * `createAnimationController(...).reset()`'s to establish, in `render()`, for
 * every diagram kind.
 */
export function renderErDiagramToSVG(diagram: PositionedErDiagram): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(diagram.width));
  svg.setAttribute("height", String(diagram.height));
  svg.setAttribute("viewBox", `0 0 ${diagram.width} ${diagram.height}`);

  // Every marker id below is namespaced by this one freshly drawn token —
  // see `mintIdScope`. Two ER diagrams on one page would otherwise share
  // four fixed ids, and `url(#...)` resolves document-wide.
  const scope = mintIdScope();

  // **Measured for ER rather than inherited**, because this repo already
  // holds two different answers on this line. Real mermaid 11.17.2 renders
  // an `erDiagram` carrying `accTitle:` and `accDescr:` with `<title>` and
  // `<desc>` as the root's first two children and `aria-labelledby` /
  // `aria-describedby` naming them — identical to what it does for a
  // flowchart, so `renderToSVG`'s arrangement is the one this kind follows.
  //
  // ⚠️ **And no `role`.** Mermaid writes `role="graphics-document document"`
  // on both roots, unconditionally and unrelated to these two statements;
  // Siren draws that attribute for no kind, so nothing is written here.
  // `renderSequenceToSVG` writes `role="img"` instead — a spelling Mermaid
  // uses for neither kind, left alone there as an older unmeasured line and
  // deliberately not copied into this one.
  //
  // Before `<defs>`, because Mermaid puts them first and an accessible name
  // is read from the first `<title>` a consumer finds.
  if (diagram.accTitle !== null) {
    const accTitleId = `chart-title${scope}`;
    const accTitleEl = document.createElementNS(SVG_NS, "title");
    accTitleEl.setAttribute("id", accTitleId);
    accTitleEl.textContent = diagram.accTitle;
    svg.appendChild(accTitleEl);
    svg.setAttribute("aria-labelledby", accTitleId);
  }
  // Its own `if` rather than an `else` or a shared one: two statements, two
  // stores in Mermaid, and a document may write either alone.
  if (diagram.accDescr !== null) {
    const accDescrId = `chart-desc${scope}`;
    const accDescrEl = document.createElementNS(SVG_NS, "desc");
    accDescrEl.setAttribute("id", accDescrId);
    accDescrEl.textContent = diagram.accDescr;
    svg.appendChild(accDescrEl);
    svg.setAttribute("aria-describedby", accDescrId);
  }

  svg.appendChild(buildDefs(scope));

  for (const entity of diagram.entities) {
    svg.appendChild(buildEntity(entity));
  }

  // After the boxes: SVG has no z-index, and a relationship's marker meets
  // the edge of a filled box.
  for (const relationship of diagram.relationships) {
    svg.appendChild(buildRelationship(relationship, scope));
  }

  return svg;
}

/**
 * Builds the `<g class="siren-er-relationship">` for one relationship: the
 * line along the layout's route, a cardinality marker at each end, and the
 * label at the anchor the layout reserved room for.
 */
function buildRelationship(
  relationship: PositionedErRelationship,
  scope: string,
): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-er-relationship");
  g.setAttribute("data-siren-id", relationship.id);

  const line = document.createElementNS(SVG_NS, "path");
  line.setAttribute("class", "siren-er-relationship-line");
  line.setAttribute("d", pointsToPathData(relationship.points));
  // Explicit, not left to CSS: the route is an open, multi-segment path,
  // which a default fill would paint as a filled polygon over the entities
  // it joins.
  line.setAttribute("fill", "none");
  // The route runs `from` → `to`, so `marker-start` is the `from` end. No
  // conditional and no reversal — see this module's header.
  line.setAttribute(
    "marker-start",
    `url(#${MARKER_NAME[relationship.fromCardinality]}${scope})`,
  );
  line.setAttribute("marker-end", `url(#${MARKER_NAME[relationship.toCardinality]}${scope})`);
  if (relationship.line === "nonIdentifying") {
    line.setAttribute("stroke-dasharray", DASH_PATTERN);
  }
  g.appendChild(line);

  if (relationship.labelAnchor !== null) {
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("class", "siren-er-relationship-label");
    label.setAttribute("x", String(relationship.labelAnchor.x));
    label.setAttribute("y", String(relationship.labelAnchor.y));
    // Presentation attributes rather than theme rules, for the reason
    // `renderToSVG` gives: CSS would win over them and could drift out of
    // sync with the anchor the layout computed.
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.textContent = relationship.label;
    g.appendChild(label);
  }

  return g;
}

/**
 * Builds the shared `<defs>` block: one `<marker>` per cardinality, each
 * built from the glyphs `GLYPH_HEIGHT` documents.
 *
 * All four are `orient="auto-start-reverse"`, which is what lets one
 * definition serve both ends — the trick the class renderer already relies
 * on, and it is load-bearing here rather than a saving: an ER marker is
 * asymmetric along the line, so a marker that did not flip at the start end
 * would put the circle against the box and the bar out on the line.
 */
function buildDefs(scope: string): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, "defs") as SVGDefsElement;

  // Exactly one: two bars, the inner one 9 out and the outer one 15 — the
  // spacing of Mermaid's own `M3,0 L3,18 M9,0 L9,18`.
  const onlyOne = buildMarker(MARKER_NAME.onlyOne + scope, 18, GLYPH_HEIGHT);
  onlyOne.append(bar(9), bar(3));
  defs.appendChild(onlyOne);

  // Zero or one: the bar against the box, the hollow circle outside it.
  const zeroOrOne = buildMarker(MARKER_NAME.zeroOrOne + scope, 30, GLYPH_HEIGHT);
  zeroOrOne.append(bar(21), hollowCircle(9, GLYPH_HEIGHT / 2));
  defs.appendChild(zeroOrOne);

  // One or more: the foot against the box, a bar outside it. The taller box
  // is the foot's: its curves reach `FOOT_LENGTH / 2` above and below the
  // line, where a bar reaches `GLYPH_HEIGHT / 2`.
  const oneOrMore = buildMarker(MARKER_NAME.oneOrMore + scope, 63, FOOT_LENGTH);
  oneOrMore.append(crowsFoot(63), bar(21, FOOT_LENGTH / 2));
  defs.appendChild(oneOrMore);

  // Zero or more: the foot against the box, the hollow circle outside it.
  const zeroOrMore = buildMarker(MARKER_NAME.zeroOrMore + scope, 63, FOOT_LENGTH);
  zeroOrMore.append(crowsFoot(63), hollowCircle(15, FOOT_LENGTH / 2));
  defs.appendChild(zeroOrMore);

  return defs;
}

/**
 * One empty `<marker>`, attaching by its right-hand edge so that everything
 * drawn in it sits outside the entity box, and flipping at the start end so
 * that one definition serves both.
 */
function buildMarker(id: string, width: number, height: number): SVGMarkerElement {
  const marker = document.createElementNS(SVG_NS, "marker") as SVGMarkerElement;
  marker.setAttribute("id", id);
  // Not the SVG default: `userSpaceOnUse` keeps a marker a fixed absolute
  // size when a highlighted relationship's stroke-width changes, the reason
  // `renderToSVG` records.
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("markerWidth", String(width));
  marker.setAttribute("markerHeight", String(height));
  marker.setAttribute("refX", String(width));
  marker.setAttribute("refY", String(height / 2));
  marker.setAttribute("orient", "auto-start-reverse");
  return marker;
}

/** One vertical stroke across the line, `GLYPH_HEIGHT` tall, centred on `centerY`. */
function bar(x: number, centerY: number = GLYPH_HEIGHT / 2): SVGLineElement {
  const line = document.createElementNS(SVG_NS, "line") as SVGLineElement;
  line.setAttribute("class", "siren-er-cardinality-bar");
  line.setAttribute("x1", String(x));
  line.setAttribute("x2", String(x));
  line.setAttribute("y1", String(centerY - GLYPH_HEIGHT / 2));
  line.setAttribute("y2", String(centerY + GLYPH_HEIGHT / 2));
  return line;
}

/**
 * The small circle that says *optional*. Hollow on purpose and measured:
 * Mermaid fills it with the surface colour rather than leaving it
 * unfilled, so the line does not show straight through the middle of it.
 * The fill is the theme's — see `.siren-er-cardinality-circle`.
 */
function hollowCircle(cx: number, cy: number): SVGCircleElement {
  const circle = document.createElementNS(SVG_NS, "circle") as SVGCircleElement;
  circle.setAttribute("class", "siren-er-cardinality-circle");
  circle.setAttribute("cx", String(cx));
  circle.setAttribute("cy", String(cy));
  circle.setAttribute("r", "6");
  return circle;
}

/**
 * The "many" glyph, with its nearest point at `tipX`: a closed almond of
 * two quadratic curves, `FOOT_LENGTH` long and `FOOT_LENGTH / 2` across at
 * its widest.
 *
 * Measured, and worth stating because the name misleads: Mermaid's
 * `one_or_more` and `zero_or_more` markers draw this and not three prongs
 * (`M0,18 Q 18,0 36,18 Q 18,36 0,18`). Copying the three-pronged foot the
 * name suggests would be a different figure from the one Mermaid draws,
 * with nothing in the document to say which is right.
 */
function crowsFoot(tipX: number): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path") as SVGPathElement;
  path.setAttribute("class", "siren-er-cardinality-crows-foot");
  const farX = tipX - FOOT_LENGTH;
  const midX = tipX - FOOT_LENGTH / 2;
  const centerY = FOOT_LENGTH / 2;
  const spread = FOOT_LENGTH / 2;
  path.setAttribute(
    "d",
    `M${farX},${centerY} Q${midX},${centerY - spread} ${tipX},${centerY}` +
      ` Q${midX},${centerY + spread} ${farX},${centerY}`,
  );
  // Never filled: the almond is an outline, and a fill would make it a
  // solid blob against the box.
  path.setAttribute("fill", "none");
  return path;
}

/**
 * The `<g class="siren-er-entity">` for one entity: its frame, its name, and
 * — when it declared attributes — the table under the name.
 *
 * **The name is centred in the *name row*, not in the box.** With no
 * attributes the two are the same thing; with attributes they are not, and
 * the difference is a silent one: a name centred in the box draws without a
 * diagnostic anywhere and lands on top of the attribute rows. The band is
 * the box's top edge down to `headerDividerY`, exactly the band the rule
 * under the name bounds — the arrangement `renderClassDiagramToSVG` already
 * uses for a class's name above its first compartment divider.
 */
function buildEntity(entity: PositionedErEntity): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-er-entity");
  g.setAttribute("data-siren-id", entity.id);

  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("class", "siren-er-entity-frame");
  frame.setAttribute("x", String(entity.x));
  frame.setAttribute("y", String(entity.y));
  frame.setAttribute("width", String(entity.width));
  frame.setAttribute("height", String(entity.height));
  g.appendChild(frame);

  const table = entity.attributeTable;
  const nameRowBottom = table === null ? entity.y + entity.height : table.headerDividerY;

  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("class", "siren-er-entity-label");
  label.setAttribute("x", String(entity.x + entity.width / 2));
  label.setAttribute("y", String((entity.y + nameRowBottom) / 2));
  // Presentation attributes rather than theme rules, for the reason
  // `renderToSVG` gives: CSS would win over them and could drift out of sync
  // with the centering math above.
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "middle");
  label.textContent = entity.label;
  g.appendChild(label);

  if (table !== null) {
    // The full-width rule under the name row first, then one at each
    // internal column boundary — running from that rule to the box's foot,
    // so no vertical stroke crosses the name the entity is known by.
    g.appendChild(
      buildDivider(entity.x, table.headerDividerY, entity.x + entity.width, table.headerDividerY),
    );
    for (const x of table.columnDividerXs) {
      g.appendChild(buildDivider(x, table.headerDividerY, x, entity.y + entity.height));
    }
    for (const row of table.rows) {
      for (const cell of row.cells) {
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("class", `siren-er-attribute siren-er-attribute-${cell.column}`);
        text.setAttribute("x", String(cell.x));
        text.setAttribute("y", String(cell.y));
        // `start`, not `middle`: the layout's `x` is the text's **left
        // edge**, because a column of left-aligned cells is what makes a
        // column read as one. A `middle` anchor here would draw every cell
        // half its own width to the right of its column.
        text.setAttribute("text-anchor", "start");
        text.setAttribute("dominant-baseline", "middle");
        // `textContent` rather than any markup path, the rule every other
        // renderer here keeps: attribute text is author input and must
        // render literally.
        text.textContent = cell.text;
        g.appendChild(text);
      }
    }
  }

  return g;
}

/** One `<line class="siren-er-entity-divider">` between the two points given. */
function buildDivider(x1: number, y1: number, x2: number, y2: number): SVGLineElement {
  const line = document.createElementNS(SVG_NS, "line") as SVGLineElement;
  line.setAttribute("class", "siren-er-entity-divider");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  return line;
}
