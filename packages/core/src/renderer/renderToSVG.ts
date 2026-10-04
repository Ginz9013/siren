import type {
  EdgeEnd,
  EdgeLine,
  PositionedEdge,
  PositionedGraph,
  PositionedNode,
  PositionedSubgraph,
  StyleProperty,
} from "../contracts";
import { appendLabel, drawLabel, type DrawnLabel } from "../label/drawLabel";
import { SHAPE_LEAN } from "../layout/layoutGraph";
import { mintIdScope } from "./mintIdScope";
import { sizeCanvas } from "./sizeCanvas";
import { wrapInteraction } from "./wrapInteraction";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The extra class a non-solid line wears, or `null` for the solid one the
 * base `.siren-edge` rule already draws.
 *
 * **A class rather than an inline declaration, and that is the one cascade
 * decision this file's edges force.** A thick line is a `stroke-width`, and
 * three other declarations want that same property: the theme's
 * `.siren-edge` base, the theme's `.siren-edge.siren-highlight-outline`,
 * and an author's `linkStyle 0 stroke-width:6px`. Written inline here, a
 * thick line would outrank all three — including the highlight, so
 * `highlight X outline` on a thick edge would stop thickening it, and an
 * edge is a timeline target. Written as a class it lands *between* them,
 * which is exactly the order that is wanted:
 *
 * - it beats `.siren-edge` (one class each, and this rule is written
 *   after), so a thick edge is thicker than a plain one;
 * - it loses to `.siren-edge.siren-highlight-outline` (two classes), so a
 *   highlighted thick edge still visibly highlights;
 * - it loses to the author's inline `style` attribute, whatever they set —
 *   the same answer board 3 gave for the theme and board 5 for a stadium's
 *   `rx`: **the author's declaration wins the property it names**, and a
 *   `linkStyle 0 stroke-width:6px` on `A ==> B` draws a 6px line. What the
 *   author does *not* override stays: the line keeps its dash, and
 *   `linkStyle 0 stroke:#f00` recolours a thick line without thinning it.
 *
 * The theme then owns the two numbers, which is ADR-0004's line: the *kind*
 * is the compatibility contract and the proportions are the theme's. It
 * expresses the thick width in terms of `--siren-stroke-width` so that a
 * consumer retuning that token cannot accidentally flatten the distinction
 * between a thick edge and a plain one.
 */
const EDGE_LINE_CLASS: Record<EdgeLine, string | null> = {
  solid: null,
  dotted: "siren-edge-dotted",
  thick: "siren-edge-thick",
};

/**
 * How each end shape is drawn — the flowchart's `END_MARKER_NAME`, and the
 * class renderer's is the template it was written from.
 *
 * `name` is the *base* name of the marker's id and never an id on its own:
 * every id this renderer mints carries the render's own scope, because
 * `url(#id)` resolves against the whole page.
 *
 * `colours` says which property an author's `stroke` paints on this shape,
 * and it is not the same one for all three. A filled head takes the colour
 * as its `fill`; a hollow ring and an open cross take it as their
 * `stroke`, because a ring's `fill` is the *surface* it sits on (that is
 * what makes it read as hollow rather than letting the line show through
 * its middle) and an open cross has no interior at all. Painting a ring's
 * fill would produce a filled dot in the author's colour — the wrong
 * shape, in the right colour.
 *
 * The three CSS classes are the ones the sequence and class renderers
 * already emit, so the theme paints every one of them without learning a
 * name: a new `siren-*` class would ship unthemed unless someone widened
 * `theme/default.test.ts`'s fixture, and none is needed here.
 */
const END_SHAPES = {
  arrow: {
    name: "siren-arrow",
    width: 8,
    height: 6,
    shapeClass: "siren-arrow-fill",
    colours: "fill",
  },
  circle: {
    name: "siren-circle",
    width: 8,
    height: 8,
    shapeClass: "siren-arrow-hollow",
    colours: "stroke",
  },
  cross: {
    name: "siren-cross",
    width: 8,
    height: 8,
    shapeClass: "siren-arrow-stroke",
    colours: "stroke",
  },
} as const satisfies Record<
  Exclude<EdgeEnd, "none">,
  { name: string; width: number; height: number; shapeClass: string; colours: "fill" | "stroke" }
>;

/**
 * Builds a real `SVGSVGElement` from a `PositionedGraph`, per the frozen
 * SVG conventions in spec.md ("SVG conventions" bullet list): one
 * `<g class="siren-node">` per node, wrapping its frame — a
 * `<rect class="siren-node-frame">`, or the `<path>` carrying that same
 * class that draws an outlined shape, or the `<circle>` — two of them for a
 * double circle — that draws a round one, or (for a subroutine) that rect
 * and the two `<line>`s marking it, every one of them wearing the same
 * name — and its label, one `<path class="siren-edge">` per edge, and
 * `data-siren-id` on the group and the path.
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
  sizeCanvas(svg, graph.width, graph.height);

  // Every id this SVG mints is namespaced by one freshly drawn token. See
  // `mintIdScope`: a marker id is a *document*-wide name, not an SVG-wide
  // one, so without this the second diagram on a page silently borrows the
  // first's arrowheads.
  const scope = mintIdScope();

  // Measured against real Mermaid (mermaid-probe.mjs): `accTitle` becomes
  // the SVG's own `<title>` — its first child — and `accDescr` becomes its
  // own `<desc>`, right after `<title>` when both are present. Each wires
  // the root via its own aria attribute independently of the other.
  // Deliberately no `role` attribute: real Mermaid never sets `role="img"`
  // here for a flowchart (it is unconditionally `role="graphics-document
  // document"`, unrelated to accTitle/accDescr, and Siren does not draw
  // that attribute at all yet) — unlike `renderSequenceToSVG.ts`, which
  // sets `role="img"` and was not re-measured for this change.
  if (graph.accTitle !== null) {
    const accTitleId = `chart-title${scope}`;
    const accTitleEl = document.createElementNS(SVG_NS, "title");
    accTitleEl.setAttribute("id", accTitleId);
    accTitleEl.textContent = graph.accTitle;
    svg.appendChild(accTitleEl);
    svg.setAttribute("aria-labelledby", accTitleId);
  }
  if (graph.accDescr !== null) {
    const accDescrId = `chart-desc${scope}`;
    const accDescrEl = document.createElementNS(SVG_NS, "desc");
    accDescrEl.setAttribute("id", accDescrId);
    accDescrEl.textContent = graph.accDescr;
    svg.appendChild(accDescrEl);
    svg.setAttribute("aria-describedby", accDescrId);
  }

  // Empty on arrival: every marker in it is minted below, by an edge that
  // actually draws one. A document of nothing but `A --- B` needs no
  // marker at all, and a `<defs>` block seeded with one would be a
  // reference nobody makes.
  const defs = document.createElementNS(SVG_NS, "defs") as SVGDefsElement;
  svg.appendChild(defs);

  // Frames first, because document order is paint order and a frame is drawn
  // *behind* what it groups. The class renderer puts namespaces here for the
  // same reason, and the model's own order — outermost before nested — is
  // what keeps an inner frame painted over its parent rather than under it.
  for (const subgraph of graph.subgraphs) {
    svg.appendChild(buildSubgraph(subgraph));
  }

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

    // First child, before the frame: SVG surfaces a `<title>` as the hover
    // tooltip only when it is its parent's first child element — the same
    // convention the class and sequence renderers follow for their clicks.
    const tooltip = node.interaction?.tooltip ?? null;
    if (tooltip !== null) {
      const title = document.createElementNS(SVG_NS, "title");
      // textContent, never innerHTML — a tooltip is author input like any label.
      title.textContent = tooltip;
      g.appendChild(title);
    }

    const frames = buildNodeFrames(node);
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
    //
    // Frame**s**, plural, because a subroutine's box and its two inner bars
    // are one outline drawn in three elements, and all three wear the name:
    // an author's `style A stroke:#00f` that reached the box and not the
    // bars would leave the bars looking detached from the shape they mark.
    // Nothing here has to know which shape drew how many.
    for (const { element, geometry } of frames) {
      element.setAttribute("class", "siren-node-frame");
      // Two writers, one attribute — and the order is the authority. The
      // shape's own geometry goes first and the author's declarations
      // after, so `style A rx:0` overrides a stadium's ends exactly as an
      // author's declaration overrides the theme, while every other
      // declaration lands *alongside* a shape that stays itself.
      applyInlineStyle(element, [...geometry, ...node.style.frame]);
      g.appendChild(element);
    }

    // Centred on the node, which is where layout centred the box the shape
    // was sized around. What the label paints behind its text goes in
    // first, over the frame and under the text, since document order is
    // paint order.
    const drawn = drawLabel(node.label, node.labelBox, {
      x: node.x + node.width / 2,
      y: node.y + node.height / 2,
    });
    // The other half of the author's declaration. A node draws two things —
    // the frame and this label — and `resolveStyles` already decided which
    // of them each declaration is about, so there is nothing to sort here.
    //
    // No class is added for the sake of it. The theme reaches this element
    // by `.siren-node text`, and an inline declaration outranks an element
    // selector exactly as it outranks a class selector, so a
    // `siren-node-label` mirroring `.siren-class-name` would change nothing
    // about where this lands.
    applyInlineStyle(drawn.text, node.style.text);
    appendLabel(g, drawn);

    // The same wrapper the class diagram renderer calls, on the terms
    // ADR-0008 already established for a node's frame: `null` draws nothing
    // extra, an `href` interaction wraps the group in a link, a `call`
    // interaction stamps the click hook `attachClickHooks` reads back.
    svg.appendChild(wrapInteraction(g, node.interaction));
  }

  // One marker per (shape, colour) pair actually drawn, and not one per
  // edge. A marker is a pure function of those two things, so two edges
  // wanting the same pair want the same picture and a second def for it
  // would be a second copy — fifty edges under one `linkStyle default`
  // would otherwise mint fifty. Minted lazily, so a document with one
  // colour and one head shape emits exactly one marker, and one whose
  // edges are all `---` emits none at all.
  //
  // Board 3 keyed this by colour alone; an end has a shape now, so the key
  // is the pair. Distinctness of a colour is by the declaration's exact
  // text, so `#f00` and `red` are two: over-minting draws the right picture
  // from a spare def, and under-minting would not.
  const markerIdByPair = new Map<string, string>();
  // The colour half of the id, shared across shapes, so one `linkStyle` that
  // paints an arrow and a circle numbers them both `-1` rather than giving
  // one colour two numbers.
  const suffixByStroke = new Map<string, string>();

  const markerReference = (end: EdgeEnd, stroke: string | null) => {
    if (end === "none") {
      return null;
    }
    const shape = END_SHAPES[end];
    const key = `${end}|${stroke ?? ""}`;
    let id = markerIdByPair.get(key);
    if (id === undefined) {
      let suffix = "";
      if (stroke !== null) {
        suffix = suffixByStroke.get(stroke) ?? `-${suffixByStroke.size + 1}`;
        suffixByStroke.set(stroke, suffix);
      }
      id = `${shape.name}${suffix}${scope}`;
      markerIdByPair.set(key, id);
      defs.appendChild(buildEndMarker(id, end, stroke));
    }
    return `url(#${id})`;
  };

  for (const edge of graph.edges) {
    const stroke = strokeOf(edge.style.frame);

    const path = document.createElementNS(SVG_NS, "path");
    // The line style is a second class on the one element the theme paints,
    // never a second element: `.siren-edge` still selects every edge, an
    // author's `linkStyle` still lands here, and the animation controller
    // still adds and removes its own classes alongside.
    path.setAttribute("class", edgeClasses(edge));
    path.setAttribute("data-siren-id", edge.id);
    path.setAttribute("d", pointsToPathData(edge.points));
    // One marker per end, each pointing outward at the end it is applied
    // to — the class renderer's `auto-start-reverse` def, which is why
    // `<-->` needs one def rather than a mirrored pair.
    const startMarker = markerReference(edge.fromEnd, stroke);
    if (startMarker !== null) {
      path.setAttribute("marker-start", startMarker);
    }
    const endMarker = markerReference(edge.toEnd, stroke);
    if (endMarker !== null) {
      path.setAttribute("marker-end", endMarker);
    }
    // The path is the whole drawn edge, so unlike a node there is no frame
    // to choose: this is the element the theme's `.siren-edge` paints and
    // the element the animation classes land on alike.
    //
    // The markers are the one part of the arrow these declarations cannot
    // reach: a `<marker>` lives in `<defs>` and its content inherits from
    // its own ancestors, never from the path referencing it. So an edge that
    // names a `stroke` is given markers of its own above, carrying that
    // colour — which is why `stroke` colours the whole arrow here as it does
    // in Mermaid, rather than the line alone.
    //
    // Only the frame half. The text half goes to the label below, which is
    // the element it means: measured with the probe's `--paint` mode,
    // mermaid 11.17.2 paints an edge's label with the author's `color` and
    // paints the line with everything else, so the split a node already
    // makes is the split an edge makes too.
    applyInlineStyle(path, edge.style.frame);
    svg.appendChild(path);

    // A sibling of the path rather than a child of a wrapping `<g>`, which
    // is what the class renderer uses. An edge *is* its path here — that
    // element carries `data-siren-id` and the animation classes, and board
    // 3 put the author's declarations on it — so introducing a group now
    // would move the id off the element three other places already find it
    // on. Two elements wearing one id is exactly what ADR-0009 settles: a
    // timeline target is an id, not an element, so `exit A-B fade` takes
    // the label with the line without the controller learning anything.
    // What the label paints behind its text goes first: document order is
    // paint order.
    const drawnLabel = buildEdgeLabel(edge);
    if (drawnLabel !== null) {
      appendLabel(svg, drawnLabel);
    }
  }

  return svg;
}

/**
 * The `<text>` drawn on an edge, with what its label paints behind it, or
 * `null` when the edge carries none.
 *
 * `null` rather than an empty element, the rule
 * `renderClassDiagramToSVG.buildRelationshipText` already follows: an empty
 * `<text>` is a node in every consumer's DOM for nothing, and a paintless
 * element the theme's own coverage check then has to account for.
 *
 * The anchor is used exactly as layout reported it. It is the centre of the
 * box dagre kept clear, which is *not* the middle of the route — a renderer
 * that recomputed a mid-point from `points` would draw the text across the
 * line the space was reserved beside.
 */
function buildEdgeLabel(
  edge: PositionedEdge,
): DrawnLabel | null {
  if (edge.label === null) {
    return null;
  }

  // A sibling of `.siren-relationship-label`, not that class reused. Every
  // `siren-*` name here is the construct's own: a *relationship* belongs to
  // the class diagram and an *edge* to the flowchart, which is why
  // `.siren-edge` and `.siren-relationship-line` are already two names for
  // two connectors. One shared name would mean a consumer restyling class
  // labels silently restyled every flowchart edge label as well.
  const drawn = drawLabel(edge.label.label, edge.label.labelBox, edge.label.anchor, "siren-edge-label");
  const { text } = drawn;
  // The same id the path wears — see ADR-0009, and the call site above.
  text.setAttribute("data-siren-id", edge.id);
  // The author's text half, on the one element an edge has to put it on.
  //
  // **Measured, not chosen.** `linkStyle 0 color:#f00` used to be resolved,
  // reach this renderer and be dropped, because an edge had no text; the
  // question of whether it should paint the label an edge now has was left
  // for its own decision, and the decision was settled by rendering the
  // document in Mermaid (`pnpm --filter siren-core probe --paint`).
  // Mermaid paints it — `<text style="fill:#f00 !important">` on the very
  // label this element is — so dropping it was a silent mis-render.
  //
  // Nothing here knows the word `color`: ADR-0008 puts that translation in
  // `resolveStyles`, once, so the author's spelling is normalized in the
  // model and every renderer only ever sees the `fill` a `<text>` is
  // painted with. This is the same call `renderToSVG` already makes for a
  // node's label, on the same half of the same resolved style.
  applyInlineStyle(text, edge.style.text);
  return drawn;
}

/** The classes one edge's path wears: the name every edge has, plus its line's own. */
function edgeClasses(edge: PositionedEdge): string {
  const lineClass = EDGE_LINE_CLASS[edge.line];
  return lineClass === null ? "siren-edge" : `siren-edge ${lineClass}`;
}

/**
 * Builds the `<g class="siren-subgraph">` for one subgraph: a
 * `<rect class="siren-subgraph-frame">` at the frame layout grew around
 * everything the block holds, and a `<text class="siren-subgraph-label">` at
 * the anchor in the strip along its top edge.
 *
 * `renderClassDiagramToSVG`'s `buildNamespace`, one diagram kind over, and
 * deliberately the same figure: both are a labelled box drawn behind what it
 * groups, and a theme or an author who has learned to read one should not
 * have to learn a second vocabulary for the other.
 *
 * The anchor is layout's rather than computed here from the frame. That strip
 * is the reason the frame is as tall as it is — `subgraphFrames` grew it to
 * hold the title — so recomputing the position here would be a second opinion
 * on one number, free to drift from the space reserved for it.
 *
 * `data-siren-id` goes on the group, which is what makes a subgraph a
 * timeline target: ADR-0009 resolves a target to *every* element carrying its
 * id, and the frame and its title are two elements of one thing.
 */
function buildSubgraph(subgraph: PositionedSubgraph): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-subgraph");
  g.setAttribute("data-siren-id", subgraph.id);

  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("class", "siren-subgraph-frame");
  frame.setAttribute("x", String(subgraph.x));
  frame.setAttribute("y", String(subgraph.y));
  frame.setAttribute("width", String(subgraph.width));
  frame.setAttribute("height", String(subgraph.height));
  g.appendChild(frame);

  // Over the frame and under the title, since document order is paint order.
  appendLabel(g, drawLabel(subgraph.label.label, subgraph.label.labelBox, subgraph.label.anchor, "siren-subgraph-label"));

  return g;
}

/**
 * One element a node's outline is drawn with, and the declarations the
 * *shape* needs on it — never the author's, which the caller appends.
 */
interface NodeFrame {
  element: SVGElement;
  /**
   * What the shape itself has to declare in CSS rather than in an
   * attribute, which today is only a corner radius. Empty for every shape
   * whose whole outline is geometry the element already carries.
   */
  geometry: StyleProperty[];
}

/**
 * The elements that draw a node's outline, in whichever shape the node has
 * — positioned and sized, but not yet classed or styled: those are the same
 * two lines for every shape, so the caller writes them once.
 *
 * Usually one element. A subroutine is three — its box and an inner bar
 * down each end — and a double circle is two, and returning a list rather
 * than special-casing either is what keeps the caller from learning which
 * shapes draw how much. Nothing above this has had to change for one.
 *
 * Every shape is drawn **inscribed in the node's bounding box**, which is
 * the contract that pairs with `layoutGraph`'s `boxForLabel`: layout
 * enlarges the box so the label fits inside the inscribed outline, and this
 * draws the outline that box was sized for. Split the two and the label
 * fits a figure nobody drew.
 */
function buildNodeFrames(node: PositionedNode): NodeFrame[] {
  const rings = ringsOf(node);
  if (rings.length > 0) {
    return rings;
  }

  const outline = outlineFor(node);
  if (outline !== null) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", outline);
    return [{ element: path, geometry: [] }];
  }

  // A rectangle, the three shapes that are a rectangle with a corner
  // radius or a marking of their own, and every shape whose ticket has not
  // landed — which the parser still refuses, so none of them can reach
  // here.
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", String(node.x));
  rect.setAttribute("y", String(node.y));
  rect.setAttribute("width", String(node.width));
  rect.setAttribute("height", String(node.height));
  return [{ element: rect, geometry: cornerRadiusOf(node) }, ...innerBarsOf(node)];
}

/**
 * The concentric rings a node is drawn with, or nothing for every shape
 * whose outline is not a circle.
 *
 * A `<circle>` rather than a `<path>` of two arcs, because the element
 * names the figure and `r` is the whole of its geometry — and rather than
 * an `<ellipse>`, which is the same figure written in a way the theme can
 * deform: `rx` and `ry` are CSS geometry properties on an ellipse, and the
 * theme sets `rx: var(--siren-node-border-radius)` on `.siren-node-frame`.
 * So ticket 03's question — who owns the radius, the shape or the token —
 * simply does not arise here, and that is a property of the element chosen
 * rather than an oversight.
 *
 * Inscribed in the node's bounding box, taking the **smaller** of the two
 * axes as the diameter. `layoutGraph` gives both circles a square box, so
 * the two axes agree; taking the minimum is what keeps the figure a circle
 * rather than an ellipse were a box ever to arrive that was not square, and
 * a circle that stopped being round would stop being the shape the spelling
 * names.
 *
 * Two of them for a double circle, and both are returned as frames rather
 * than one frame and one decoration. Every element a node draws wears
 * `siren-node-frame` (the caller writes it), which is what makes an
 * author's `style A fill:#fdd` paint the whole shape instead of leaving a
 * white disc inside a coloured circle — the same answer a subroutine's
 * inner bars were given, arriving at the shape that would have broken most
 * visibly without it.
 */
function ringsOf(node: PositionedNode): NodeFrame[] {
  if (node.shape !== "circle" && node.shape !== "double-circle") {
    return [];
  }
  const radius = Math.min(node.width, node.height) / 2;
  const radii =
    node.shape === "circle"
      ? [radius]
      : // Outer first, so the inner ring is stroked over the outer's fill
        // rather than under it. The gap is `SHAPE_LEAN x height`, the same
        // number `layoutGraph` enlarged the box by so that the label fits
        // inside the *inner* ring — two copies of it would drift into a
        // ring drawn through the text.
        [radius, radius - SHAPE_LEAN["double-circle"] * node.height];
  return radii.map((r) => {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(node.x + node.width / 2));
    circle.setAttribute("cy", String(node.y + node.height / 2));
    circle.setAttribute("r", String(r));
    return { element: circle, geometry: [] };
  });
}

/**
 * The corner radius a shape names itself for, as an inline CSS declaration
 * — or nothing at all for a shape whose corners are the theme's business.
 *
 * **The one decision this pairing forces.** The theme sets `rx:
 * var(--siren-node-border-radius)` on `.siren-node-frame`, so for a
 * `<rect>` frame a shape and a documented token both want to set one
 * property. The rule: *a shape named for its corners owns them; the token
 * rounds the shapes whose corners are only decoration.*
 *
 * - `rect` and `subroutine` declare nothing here, so the token is the whole
 *   story for them, exactly as it has been since before shapes existed. A
 *   consumer who retunes it to `0` gets square boxes, and to `12px` gets
 *   rounder ones.
 * - `stadium` and `round` take `SHAPE_LEAN x height`. A stadium's ends are
 *   semicircles or it is not a stadium, so its radius is half its height by
 *   definition and no token may move it; a round node's is half of that,
 *   which is Siren's own proportion (the board's decision 1) chosen to sit
 *   visibly between a decorated corner and a semicircular end. Retuning the
 *   token does nothing to either — including at `0`, where a rectangle goes
 *   square and `A(Round)` stays round, which is the point: a shape's *kind*
 *   is the compatibility contract and must survive the theme.
 *
 * Written as an inline **declaration** and not as an `rx` attribute, and
 * that is the whole mechanism. A presentation attribute loses to *any*
 * stylesheet rule, so `rx="30"` here would be silently overruled by the
 * theme's own `.siren-node-frame` rule and the stadium would come back as a
 * 6px-cornered box with nothing in the picture to say why — ADR-0008's
 * cascade argument, arriving one property over from the `fill` it was
 * written about.
 *
 * The number is `SHAPE_LEAN`'s, the same one `layoutGraph` widened the box
 * by, for the reason that constant is exported at all: a radius and the
 * room reserved for it are one decision, and two copies would drift into a
 * label crossing its own corner.
 */
function cornerRadiusOf(node: PositionedNode): StyleProperty[] {
  if (node.shape !== "round" && node.shape !== "stadium") {
    return [];
  }
  return [{ property: "rx", value: `${SHAPE_LEAN[node.shape] * node.height}px` }];
}

/**
 * The inner bars a subroutine draws down each end of its box, or nothing
 * for every other shape.
 *
 * A `<line>` apiece rather than a second `<rect>`: a bar is a stroke, and
 * an element with a width would take the frame's `fill` as an area of paint
 * across the middle of the node.
 *
 * They carry no class of their own — the caller names every frame element
 * `siren-node-frame` — and that is deliberate rather than incidental. A
 * `siren-node-bar` would be a class the default theme has to learn about
 * separately, and `theme/default.test.ts`'s coverage net renders only
 * rectangles, so it would ship unthemed without failing anything. Wearing
 * the frame's name instead means the theme strokes a bar because it strokes
 * a frame, and an author's `style A stroke:#00f` reaches the bars for the
 * same reason.
 *
 * Inset by `SHAPE_LEAN.subroutine x height` from each end — the number
 * `layoutGraph` widened the box by, so the label sits between the bars
 * rather than across one.
 */
function innerBarsOf(node: PositionedNode): NodeFrame[] {
  if (node.shape !== "subroutine") {
    return [];
  }
  const inset = SHAPE_LEAN.subroutine * node.height;
  return [node.x + inset, node.x + node.width - inset].map((x) => {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(x));
    line.setAttribute("y1", String(node.y));
    line.setAttribute("x2", String(x));
    line.setAttribute("y2", String(node.y + node.height));
    return { element: line, geometry: [] };
  });
}

/**
 * The outline one node draws as a `<path>`, inscribed in its bounding box —
 * or `null` for a shape drawn by some other element: the rectangle, and the
 * two shapes `ringsOf` draws with a `<circle>`.
 *
 * Every outline here but the cylinder's is straight segments between
 * corners of, or points on, the node's own box, so each is expressible as
 * the box's four edges plus
 * `SHAPE_LEAN` — the same number `layoutGraph` used to decide how big that
 * box had to be. Importing it rather than restating it is deliberate: two
 * copies that agreed today could drift, and the symptom would be a label
 * crossing its own frame in the picture with every number in every unit
 * test still correct.
 *
 * `rx` no longer reaches any of these frames, and that is correct rather
 * than unfortunate — the theme sets `rx: var(--siren-node-border-radius)`
 * on `.siren-node-frame` and a `<path>` reads no such property. None of
 * these shapes has rounded corners to give it, so a documented token
 * quietly ceasing to apply is the right behavior (the board's decision 4).
 * For the cylinder it is more than right, it is load-bearing: its lid's
 * radii are the figure rather than a decoration of it, and drawing it with
 * an element the token *could* reach would let a theme flatten the shape
 * out of existence. The shapes that *are* drawn with a `<rect>` have the
 * same question with a real answer to give; it is `cornerRadiusOf`'s.
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
    case "cylinder": {
      // The one outline here that is not straight segments. `r` is the
      // vertical semi-axis of the ellipse the top and the bottom are both
      // halves of, and the horizontal one is the box's own half-width, so
      // the lid spans the tube exactly.
      //
      // Two closed subpaths in one `d`: the tube, then the whole lid drawn
      // over it. Wound the same way — left to right across the top in both
      // — so the default nonzero fill rule adds them and paints a solid
      // drum; opposite windings would cut the lid out as a hole. The lid's
      // upper half retraces the tube's top arc, which is what makes the
      // silhouette one curve and the lid's *lower* half the only new line
      // in the picture: that line is the cylinder.
      //
      // Not an `<ellipse>` element for the lid, which would be the obvious
      // way to draw one: `rx` and `ry` are CSS geometry properties on an
      // ellipse, and the theme sets `rx: var(--siren-node-border-radius)`
      // on `.siren-node-frame`, so a documented token about a rectangle's
      // corners would silently flatten the lid to 6px. A `<path>` reads
      // neither property. Ticket 03 gave a stadium its radius inline to win
      // that same cascade; here the radius *is* the figure rather than a
      // proportion of it, so the answer is an element the token cannot
      // reach at all.
      const r = SHAPE_LEAN.cylinder * node.height;
      const rx = node.width / 2;
      const lid = top + r;
      const base = bottom - r;
      const arc = (x: number, y: number) => `A${rx},${r} 0 0 1 ${x},${y}`;
      return (
        `M${left},${lid} ${arc(right, lid)} L${right},${base} ${arc(left, base)} Z ` +
        `M${left},${lid} ${arc(right, lid)} ${arc(left, lid)} Z`
      );
    }
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
 * Writes `style` onto `element` as an inline `style` attribute, in
 * declaration order, or leaves the element without one when the list is
 * empty.
 *
 * One function for a node's frame, a node's label and an edge's path,
 * because the rule is the same for all three: land on the element the theme
 * paints. Which half of the author's declarations each one is handed is not
 * decided here either — `resolveStyles` split them, and this function is
 * told, in the vocabulary the element it writes to actually reads.
 *
 * Almost always the author's declarations and nothing else. A frame whose
 * shape names its own corners hands over that radius first and the author's
 * list after (see `cornerRadiusOf`), which is why this takes a list rather
 * than a `ResolvedStyle`: the last writer of a property wins, and the
 * author has to be able to be that writer.
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
 * The values are written verbatim. The author's arrive here having already
 * passed `resolveStyles`' gate (no `url(`, no `expression(`, no `;`, no
 * backslash), and re-checking here would fork that single source of truth;
 * a shape's own are numbers this file computed. This attribute is a CSS
 * sink, never an HTML one: nothing is parsed as markup.
 */
function applyInlineStyle(element: SVGElement, style: StyleProperty[]): void {
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

/**
 * Builds one end's `<marker>`: the theme's when `stroke` is `null`, and an
 * edge's own when it is a colour.
 *
 * The colour is written as an inline `style` rather than as a presentation
 * attribute, and the shape's class stays on either way. That is ADR-0008's
 * cascade argument applied to a marker: a presentation attribute loses to
 * *any* stylesheet rule, so `fill="#f00"` here would be silently overruled
 * by the theme's own `.siren-arrow-fill` rule, while an inline declaration
 * outranks it without needing `!important`. Keeping the class also keeps
 * the theme in charge of every marker no author coloured — and, for the
 * hollow ring, in charge of the surface colour filling it, which the
 * author's `stroke` deliberately does not touch.
 */
function buildEndMarker(id: string, end: Exclude<EdgeEnd, "none">, stroke: string | null): SVGMarkerElement {
  const shape = END_SHAPES[end];
  const marker = document.createElementNS(SVG_NS, "marker") as SVGMarkerElement;
  marker.setAttribute("id", id);
  // userSpaceOnUse (not the SVG default, strokeWidth) keeps the marker a
  // fixed absolute size regardless of the edge's current stroke-width —
  // otherwise it silently doubles when an edge is highlighted (stroke-width
  // goes from 1.5 to 3), and again when the edge is a thick one.
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("markerWidth", String(shape.width));
  marker.setAttribute("markerHeight", String(shape.height));
  // refX equals markerWidth (the shape's leading edge) so that edge lands
  // exactly on the path's endpoint — anything less overshoots past the
  // boundary and visually pierces into the node the edge points at.
  marker.setAttribute("refX", String(shape.width));
  marker.setAttribute("refY", String(shape.height / 2));
  // One def serves both ends: reversed at a `marker-start`, so the same
  // picture points outward wherever it is applied. The class renderer's
  // trick, and what makes `<-->` one def rather than a mirrored pair.
  marker.setAttribute("orient", "auto-start-reverse");

  const drawn = buildEndShape(end);
  // No fill/stroke attribute here on purpose — an SVG shape with none set
  // falls back to the initial value (black fill, no stroke), which reads
  // fine against a light background and disappears against a dark one. The
  // class lets the shipped theme colour it to match the edge's own stroke,
  // the same way every other themeable part of the SVG is class-driven.
  drawn.setAttribute("class", shape.shapeClass);
  if (stroke !== null) {
    drawn.setAttribute("style", `${shape.colours}:${stroke}`);
  }
  marker.appendChild(drawn);

  return marker;
}

/**
 * The element one end shape is drawn with, inside its marker's box.
 *
 * Each is drawn so that its **leading edge** sits at `x = width`, which is
 * where `refX` puts the path's endpoint: the arrowhead's tip, and the ring's
 * rightmost point, land exactly there, and the cross straddles the line just
 * short of it, as Mermaid's own does.
 *
 * A `<circle>` rather than a path of two arcs, for the reason a circular
 * node is one: the element names the figure and `r` is the whole of its
 * geometry. The cross is two open subpaths, which is why it must not be
 * filled — a filled open subpath is implicitly closed, turning a cross into
 * a pair of solid triangles (the sequence renderer's `siren-arrow-stroke`
 * precedent, arriving at the same shape).
 */
function buildEndShape(end: Exclude<EdgeEnd, "none">): SVGElement {
  const { width, height } = END_SHAPES[end];
  if (end === "circle") {
    const radius = height / 2 - 1;
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(width - radius));
    circle.setAttribute("cy", String(height / 2));
    circle.setAttribute("r", String(radius));
    return circle;
  }

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute(
    "d",
    end === "arrow"
      ? `M0,0 L${width},${height / 2} L0,${height} Z`
      : `M1,1 L${width - 1},${height - 1} M${width - 1},1 L1,${height - 1}`,
  );
  return path;
}

/** Converts a layout-assigned point path into an SVG `<path>` `d` attribute. */
function pointsToPathData(points: { x: number; y: number }[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
}
