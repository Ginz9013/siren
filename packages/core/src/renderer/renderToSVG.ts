import type { PositionedGraph, PositionedNode, StyleProperty } from "../contracts";
import { SHAPE_LEAN } from "../layout/layoutGraph";
import { mintIdScope } from "./mintIdScope";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Builds a real `SVGSVGElement` from a `PositionedGraph`, per the frozen
 * SVG conventions in spec.md ("SVG conventions" bullet list): one
 * `<g class="siren-node">` per node, wrapping its frame — a
 * `<rect class="siren-node-frame">`, or the `<path>` carrying that same
 * class that draws any other shape — and its label, one
 * `<path class="siren-edge">` per edge, and `data-siren-id` on the group and
 * the path.
 *
 * Nothing here reads `graph.timeline`. The initial `siren-pending` state is
 * not this function's to decide: `createAnimationController(...).reset()`
 * establishes it in `render()` for all three diagram kinds, out of the same
 * `computeClassStateAtStep` that every later step comes from. A copy of that
 * rule here would be a second opinion on step 0 that has to agree with the
 * controller's, forever, by hand.
 */
export function renderToSVG(graph: PositionedGraph): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(graph.width));
  svg.setAttribute("height", String(graph.height));
  svg.setAttribute("viewBox", `0 0 ${graph.width} ${graph.height}`);

  // Every id this SVG mints is namespaced by one freshly drawn token. See
  // `mintIdScope`: a marker id is a *document*-wide name, not an SVG-wide
  // one, so without this the second diagram on a page silently borrows the
  // first's arrowheads.
  const scope = mintIdScope();
  const themeArrowId = `siren-arrow${scope}`;
  const defs = buildDefs(themeArrowId);
  svg.appendChild(defs);

  for (const node of graph.nodes) {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "siren-node");
    g.setAttribute("data-siren-id", node.id);
    // The shape as data, on the element that already *is* the node — the one
    // carrying `data-siren-id` and the animation classes — rather than on
    // one of the things the node draws, since a later shape draws more than
    // one frame element and they would then disagree.
    //
    // Written for every node, rect included, because `GraphNode.shape` is
    // required: nothing downstream should have to read a missing attribute
    // as "rect".
    //
    // In addition to drawing the shape, never instead of it. Board 4
    // reclassified two corpus rows on exactly that point: an attribute is
    // not the picture.
    g.setAttribute("data-siren-shape", node.shape);

    const frame = buildNodeFrame(node);
    // The drawn shape carries a class of its own, mirroring the class
    // diagram's `<rect class="siren-class-frame">`. The theme selects it
    // directly, so an author's inline `style` lands on exactly the element the
    // theme paints rather than on an anonymous descendant of the group — the
    // placement ADR-0008 argues for. `data-siren-id` and the animation classes
    // stay on the enclosing `<g>`.
    //
    // The class is on the frame whatever element draws it — a `<rect>` for a
    // rectangle, a `<path>` for a diamond. Board 3 named this element and
    // ADR-0008 puts the author's declarations here, so a frame that changed
    // class with its shape would silently stop taking `style A fill:#f00`.
    frame.setAttribute("class", "siren-node-frame");
    applyAuthorStyle(frame, node.style.frame);
    g.appendChild(frame);

    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(node.x + node.width / 2));
    text.setAttribute("y", String(node.y + node.height / 2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.textContent = node.label;
    // The other half of the author's declaration. A node draws two things —
    // the frame and this label — and `resolveStyles` already decided which
    // of them each declaration is about, so there is nothing to sort here.
    //
    // No class is added for the sake of it. The theme reaches this element
    // by `.siren-node text`, and an inline declaration outranks an element
    // selector exactly as it outranks a class selector, so a
    // `siren-node-label` mirroring `.siren-class-name` would change nothing
    // about where this lands.
    applyAuthorStyle(text, node.style.text);
    g.appendChild(text);

    svg.appendChild(g);
  }

  // One arrowhead per distinct color, not per styled edge. A marker is a
  // pure function of the color it carries, so two edges of one color have
  // the same arrowhead by definition and a second def for it would be a
  // second copy of the same picture — fifty edges under one `linkStyle
  // default` would otherwise mint fifty. Distinctness is by the declaration's
  // exact text, so `#f00` and `red` are two colors here: over-minting draws
  // the right picture from an extra def, and under-minting would not.
  const arrowMarkerIdByStroke = new Map<string, string>();
  for (const edge of graph.edges) {
    const stroke = strokeOf(edge.style.frame);
    let arrowMarkerId = themeArrowId;
    if (stroke !== null) {
      const minted = arrowMarkerIdByStroke.get(stroke);
      if (minted === undefined) {
        arrowMarkerId = `siren-arrow-${arrowMarkerIdByStroke.size + 1}${scope}`;
        arrowMarkerIdByStroke.set(stroke, arrowMarkerId);
        defs.appendChild(buildArrowMarker(arrowMarkerId, stroke));
      } else {
        arrowMarkerId = minted;
      }
    }

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "siren-edge");
    path.setAttribute("data-siren-id", edge.id);
    path.setAttribute("d", pointsToPathData(edge.points));
    path.setAttribute("marker-end", `url(#${arrowMarkerId})`);
    // The path is the whole drawn edge, so unlike a node there is no frame
    // to choose: this is the element the theme's `.siren-edge` paints and
    // the element the animation classes land on alike.
    //
    // The arrowhead is the one part of the arrow these declarations cannot
    // reach: a `<marker>` lives in `<defs>` and its content inherits from
    // its own ancestors, never from the path referencing it. So an edge that
    // names a `stroke` is given a marker of its own above, carrying that
    // color — which is why `stroke` colors the whole arrow here as it does
    // in Mermaid, rather than the line alone.
    //
    // Only the frame half: an edge draws no text, so `edge.style.text` — a
    // `linkStyle 0 color:#f00` — has no element here to land on and is
    // deliberately dropped rather than folded into this attribute, where
    // `color` paints nothing and would tell the author their declaration
    // worked.
    applyAuthorStyle(path, edge.style.frame);
    svg.appendChild(path);
  }

  return svg;
}

/**
 * The one element that draws a node's outline, in whichever shape the node
 * has — positioned and sized, but not yet classed or styled: those are the
 * same two lines for every shape, so the caller writes them once.
 *
 * Every shape is drawn **inscribed in the node's bounding box**, which is
 * the contract that pairs with `layoutGraph`'s `boxForLabel`: layout
 * enlarges the box so the label fits inside the inscribed outline, and this
 * draws the outline that box was sized for. Split the two and the label
 * fits a figure nobody drew.
 */
function buildNodeFrame(node: PositionedNode): SVGElement {
  const outline = outlineFor(node);
  if (outline !== null) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", outline);
    return path;
  }

  // A rectangle, and every shape whose ticket has not landed — which the
  // parser still refuses, so none of them can reach here.
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", String(node.x));
  rect.setAttribute("y", String(node.y));
  rect.setAttribute("width", String(node.width));
  rect.setAttribute("height", String(node.height));
  return rect;
}

/**
 * The outline one node draws as a `<path>`, inscribed in its bounding box —
 * or `null` for a shape drawn by some other element, which today is the
 * rectangle.
 *
 * Every outline here is straight segments between corners of, or points on,
 * the node's own box, so each is expressible as the box's four edges plus
 * `SHAPE_LEAN` — the same number `layoutGraph` used to decide how big that
 * box had to be. Importing it rather than restating it is deliberate: two
 * copies that agreed today could drift, and the symptom would be a label
 * crossing its own frame in the picture with every number in every unit
 * test still correct.
 *
 * `rx` no longer reaches any of these frames, and that is correct rather
 * than unfortunate — the theme sets `rx: var(--siren-node-border-radius)`
 * on `.siren-node-frame` and a `<path>` reads no such attribute. None of
 * these shapes has rounded corners to give it, so a documented token
 * quietly ceasing to apply is the right behavior (the board's decision 4).
 */
function outlineFor(node: PositionedNode): string | null {
  const left = node.x;
  const right = node.x + node.width;
  const top = node.y;
  const bottom = node.y + node.height;
  const midX = node.x + node.width / 2;
  const midY = node.y + node.height / 2;
  const closed = (points: ReadonlyArray<readonly [number, number]>) =>
    `${points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ")} Z`;

  switch (node.shape) {
    case "rhombus":
      // The midpoint of each of the four sides.
      return closed([
        [midX, top],
        [right, midY],
        [midX, bottom],
        [left, midY],
      ]);
    case "hexagon": {
      // Flat top and bottom inset by `m` at each end, with a point at
      // mid-height on each side.
      const m = SHAPE_LEAN.hexagon * node.height;
      return closed([
        [left + m, top],
        [right - m, top],
        [right, midY],
        [right - m, bottom],
        [left + m, bottom],
        [left, midY],
      ]);
    }
    case "parallelogram": {
      // Leaning right: the top edge sits `s` to the right of the bottom
      // one. Mermaid 11.17.2 calls this `lean_right` and draws it the same
      // way round, measured off its rendered polygon.
      const s = SHAPE_LEAN.parallelogram * node.height;
      return closed([
        [left + s, top],
        [right, top],
        [right - s, bottom],
        [left, bottom],
      ]);
    }
    case "parallelogram-alt": {
      // Leaning left — the mirror of `parallelogram`, which is the whole
      // point of there being two spellings.
      const s = SHAPE_LEAN["parallelogram-alt"] * node.height;
      return closed([
        [left, top],
        [right - s, top],
        [right, bottom],
        [left + s, bottom],
      ]);
    }
    case "trapezoid": {
      // Narrow top, wide bottom: `A[/Trap\]`, whose two leaning characters
      // lean the way its two sloping sides do.
      const s = SHAPE_LEAN.trapezoid * node.height;
      return closed([
        [left + s, top],
        [right - s, top],
        [right, bottom],
        [left, bottom],
      ]);
    }
    case "trapezoid-alt": {
      // Wide top, narrow bottom — `trapezoid` flipped, for `A[\Trap/]`.
      const s = SHAPE_LEAN["trapezoid-alt"] * node.height;
      return closed([
        [left, top],
        [right, top],
        [right - s, bottom],
        [left + s, bottom],
      ]);
    }
    case "asymmetric": {
      // A rectangle with a chevron cut into its **left** edge, apex
      // pointing right at mid-height; the right edge stays flat. Which way
      // that points was measured, not recalled: mermaid 11.17.2 reads
      // `A>Flag]` as `type="odd"` and draws it with `rect_left_inv_arrow`,
      // whose vertices put both left corners further left than the
      // mid-height vertex between them — the `>` of the spelling, drawn.
      const d = SHAPE_LEAN.asymmetric * node.height;
      return closed([
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
        [left + d, midY],
      ]);
    }
    default:
      return null;
  }
}

/**
 * Writes the author's resolved `style` declarations onto `element` as an
 * inline `style` attribute, in declaration order, or leaves the element
 * without one when the author styled nothing.
 *
 * One function for a node's frame, a node's label and an edge's path,
 * because the rule is the same for all three: land on the element the theme
 * paints. Which half of the author's declarations each one is handed is not
 * decided here either — `resolveStyles` split them, and this function is
 * told, in the vocabulary the element it writes to actually reads.
 *
 * Where the author wrote the declarations — `style A`, `classDef`,
 * `linkStyle 0` — is not visible here, and must not be.
 *
 * Inline rather than a generated class rule, and on the drawn shape rather
 * than its enclosing `<g>` — both for the same cascade reason, recorded in
 * ADR-0008. The theme styles `.siren-node-frame` directly, so an inline
 * declaration on the frame outranks it without needing `!important`, while
 * the same declaration on the `<g>` would only ever be *inherited* by the
 * frame and so would lose to the theme's own rule — and would leak down onto
 * the node's `<text>`, which the author did not ask to recolor.
 *
 * The `<g>` is left alone for a second reason too: it is where the animation
 * controller stamps `siren-pending` and `siren-enter-*`, and an attribute
 * this function wrote there would be one more thing those classes have to
 * share a element with.
 *
 * The values are written verbatim. They are author input, but they arrive
 * here having already passed `resolveStyles`' gate (no `url(`, no
 * `expression(`, no `;`, no backslash), and re-checking here would fork that
 * single source of truth. This attribute is a CSS sink, never an HTML one:
 * nothing is parsed as markup.
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

/**
 * The `stroke` an edge's author style resolves to, or `null` when it names
 * none.
 *
 * `null` is the whole reason an unstyled edge — and an edge whose
 * `linkStyle` sets only `stroke-width` — mints no marker: there is no color
 * to carry, so the theme's shared arrowhead is still the right answer and a
 * per-edge copy of it would be a copy that says nothing.
 *
 * Case-insensitive because CSS property names are, and the *last* match
 * because that is the one a browser applies out of the inline attribute
 * these same declarations are written to. The arrowhead has to be the color
 * the line actually takes, not the color it was first told to take.
 */
function strokeOf(style: StyleProperty[]): string | null {
  let stroke: string | null = null;
  for (const { property, value } of style) {
    if (property.toLowerCase() === "stroke") {
      stroke = value;
    }
  }
  return stroke;
}

/** Builds the shared `<defs>` block, including the arrow marker an unstyled edge references. */
function buildDefs(themeArrowId: string): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, "defs") as SVGDefsElement;
  defs.appendChild(buildArrowMarker(themeArrowId, null));
  return defs;
}

/**
 * Builds one arrowhead `<marker>`: the theme's when `fill` is `null`, and an
 * edge's own when it is a color.
 *
 * The color is written as an inline `style` rather than as a `fill`
 * attribute, and the `siren-arrow-fill` class stays on either way. That is
 * ADR-0008's cascade argument applied to the arrowhead: a presentation
 * attribute loses to *any* stylesheet rule, so `fill="#f00"` here would be
 * silently overruled by the theme's own `.siren-arrow-fill { fill:
 * var(--siren-edge-stroke) }`, while an inline declaration outranks it
 * without needing `!important`. Keeping the class also keeps the theme in
 * charge of every arrowhead no author colored.
 */
function buildArrowMarker(id: string, fill: string | null): SVGMarkerElement {
  const marker = document.createElementNS(SVG_NS, "marker") as SVGMarkerElement;
  marker.setAttribute("id", id);
  // userSpaceOnUse (not the SVG default, strokeWidth) keeps the arrowhead a
  // fixed absolute size regardless of the edge's current stroke-width —
  // otherwise it silently doubles when an edge is highlighted (stroke-width
  // goes from 1.5 to 3).
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("markerWidth", "8");
  marker.setAttribute("markerHeight", "6");
  // refX equals markerWidth (the tip's x) so the tip lands exactly on the
  // path's endpoint — anything less overshoots past the boundary and
  // visually pierces into the node the arrow points at.
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "3");
  marker.setAttribute("orient", "auto-start-reverse");

  const arrowPath = document.createElementNS(SVG_NS, "path");
  arrowPath.setAttribute("d", "M0,0 L8,3 L0,6 Z");
  // No fill attribute here on purpose — an SVG <path> with none set falls
  // back to the initial value (black), which reads fine against a light
  // background but disappears against a dark one. The class lets the
  // shipped theme (packages/core/src/theme/default.css) color it to match
  // the edge's own stroke, the same way every other themeable part of the
  // SVG is class-driven rather than hardcoded here.
  arrowPath.setAttribute("class", "siren-arrow-fill");
  if (fill !== null) {
    arrowPath.setAttribute("style", `fill:${fill}`);
  }
  marker.appendChild(arrowPath);

  return marker;
}

/** Converts a layout-assigned point path into an SVG `<path>` `d` attribute. */
function pointsToPathData(points: { x: number; y: number }[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
}
