import type {
  ErCardinality,
  Point,
  PositionedErDiagram,
  PositionedErEntity,
  PositionedErRelationship,
  PositionedErSubgraph,
  StyleProperty,
} from "../contracts";
import { appendLabel, drawLabel } from "../label/drawLabel";
import { mintIdScope } from "./mintIdScope";
import { sizeCanvas } from "./sizeCanvas";

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
  sizeCanvas(svg, diagram.width, diagram.height);

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

  // **Before the boxes**, because SVG has no z-index and a frame is painted
  // behind what it groups. The model's order is outermost first, so an
  // inner frame is drawn over its parent rather than under it.
  for (const subgraph of diagram.subgraphs) {
    svg.appendChild(buildSubgraph(subgraph));
  }

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
 * Builds the `<g class="siren-er-subgraph">` for one cluster: a
 * `<rect class="siren-er-subgraph-frame">` at the frame layout grew around
 * everything the block holds, and a
 * `<text class="siren-er-subgraph-label">` at the anchor in the strip along
 * its top edge.
 *
 * **The figure is Mermaid's, measured** with `--markup`: an ER `subgraph`
 * comes out a `g.cluster` holding a `<rect>` and a `g.cluster-label` — the
 * same two elements a flowchart subgraph draws, which is why this is
 * `renderToSVG`'s `buildSubgraph` in this kind's own vocabulary rather than
 * a second figure. The classes carry the `siren-er-` prefix every other
 * element of this kind does, so a theme or a consumer can paint one kind's
 * frames without reaching the other's.
 *
 * The anchor is layout's rather than computed here from the frame. That
 * strip is the reason the frame is as tall as it is — `subgraphFrames` grew
 * it to hold the title — so recomputing the position here would be a second
 * opinion on one number, free to drift from the space reserved for it.
 *
 * `data-siren-id` goes on the group, which is what makes a cluster a
 * timeline target: ADR-0009 resolves a target to *every* element carrying
 * its id, and the frame and its title are two elements of one thing.
 */
function buildSubgraph(subgraph: PositionedErSubgraph): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-er-subgraph");
  g.setAttribute("data-siren-id", subgraph.id);

  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("class", "siren-er-subgraph-frame");
  frame.setAttribute("x", String(subgraph.x));
  frame.setAttribute("y", String(subgraph.y));
  frame.setAttribute("width", String(subgraph.width));
  frame.setAttribute("height", String(subgraph.height));
  g.appendChild(frame);

  // Drawn by `drawLabel` at the anchor in the title strip: one plain row is
  // the `<text>`'s own `textContent`, anything else a row tspan per row
  // (ADR-0015).
  appendLabel(
    g,
    drawLabel(subgraph.label.label, subgraph.label.labelBox, subgraph.label.anchor, "siren-er-subgraph-label"),
  );

  return g;
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

  if (relationship.label !== null) {
    // Drawn by `drawLabel` at the anchor the layout reserved room for: one
    // plain row is the `<text>`'s own `textContent`, anything else a row
    // tspan per row (ADR-0015).
    const { label, labelBox, anchor } = relationship.label;
    appendLabel(g, drawLabel(label, labelBox, anchor, "siren-er-relationship-label"));
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
  applyAuthorStyle(frame, entity.style.frame);
  g.appendChild(frame);

  const table = entity.attributeTable;
  const nameRowBottom = table === null ? entity.y + entity.height : table.headerDividerY;

  // Drawn by `drawLabel`, centred in the name row: one plain row is the
  // `<text>`'s own `textContent`, anything else a row tspan per row
  // (ADR-0015). The author's text style goes on the `<text>`, which every
  // row inherits it from.
  const drawn = drawLabel(
    entity.label,
    entity.labelBox,
    { x: entity.x + entity.width / 2, y: (entity.y + nameRowBottom) / 2 },
    "siren-er-entity-label",
  );
  applyAuthorStyle(drawn.text, entity.style.text);
  appendLabel(g, drawn);

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
        const className = `siren-er-attribute siren-er-attribute-${cell.column}`;
        if (cell.column === "comment") {
          // The comment is a label (ADR-0015), drawn by `drawLabel` at the
          // anchor layout placed so its widest row starts where the column's
          // cells do. One plain row is the `<text>`'s own `textContent`.
          const drawn = drawLabel(cell.label, cell.labelBox, cell.anchor, className);
          applyAuthorStyle(drawn.text, entity.style.text);
          appendLabel(g, drawn);
          continue;
        }
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("class", className);
        text.setAttribute("x", String(cell.x));
        text.setAttribute("y", String(cell.y));
        // `start`, not `middle`: the layout's `x` is the text's **left
        // edge**, because a column of left-aligned cells is what makes a
        // column read as one. A `middle` anchor here would draw every cell
        // half its own width to the right of its column.
        text.setAttribute("text-anchor", "start");
        text.setAttribute("dominant-baseline", "middle");
        // `textContent` rather than any markup path, the rule every other
        // renderer here keeps: an attribute's type, name and keys are author
        // input drawn as written, never read for tags.
        text.textContent = cell.text;
        // **Every cell, not just the name.** Measured with `--markup`
        // (mermaid 11.17.2): an author's `color` reaches the name label and
        // every attribute label in the same box alike — a `class` names the
        // entity, not one of its rows. `renderStateDiagramToSVG` gives a
        // state's description rows the same reading.
        applyAuthorStyle(text, entity.style.text);
        g.appendChild(text);
      }
    }
  }

  return g;
}

/**
 * Writes the author's resolved `style`/`classDef`/`class`/`:::` declarations
 * onto `element` as an inline `style` attribute, in declaration order, or
 * leaves the element without one when the author styled nothing.
 *
 * The same function `renderClassDiagramToSVG` and `renderStateDiagramToSVG`
 * have, for the same reasons, spelled the same way: inline rather than a
 * generated class rule, and on the **drawn shape** rather than its enclosing
 * `<g>`, both for the cascade reason ADR-0008 records. The theme styles
 * `.siren-er-entity-frame`, `.siren-er-entity-label` and
 * `.siren-er-attribute` directly, so an inline declaration on those elements
 * outranks it without `!important`, while the same declaration on the `<g>`
 * would only ever be *inherited* by them and so would lose.
 *
 * ⚠️ **No `!important`, and that is a deliberate departure from Mermaid's
 * own markup rather than an oversight.** Mermaid writes `fill:#f96
 * !important` because it applies author styles through a generated class
 * rule that has to beat its own theme; Siren writes the declaration on the
 * element the theme targets, where specificity already settles it — and a
 * `!important` here would also outrank a *consumer's* stylesheet, which is
 * the thing ADR-0008 exists to keep reachable.
 *
 * The values are written verbatim. They are author input, but they arrive
 * here having already passed `resolveStyles`' gate in `buildErModel` (no
 * `url(`, no `expression(`, no `;`, no backslash), and re-checking here
 * would fork that single source of truth. This attribute is a CSS sink,
 * never an HTML one: nothing is parsed as markup, so the hard
 * `textContent`-never-`innerHTML` invariant is untouched.
 *
 * A **relationship** is deliberately not reached by this: measured, no
 * styling statement in this kind can name one (see `buildErModel`).
 */
function applyAuthorStyle(element: SVGElement, style: StyleProperty[]): void {
  if (style.length === 0) {
    return;
  }
  element.setAttribute(
    "style",
    style.map(({ property, value }) => `${property}:${value}`).join(";"),
  );
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
