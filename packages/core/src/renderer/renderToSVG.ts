import type {
  EdgeEnd,
  EdgeLine,
  PositionedEdge,
  PositionedGraph,
  PositionedNode,
  PositionedSubgraph,
  StyleProperty,
} from "../contracts";
import { FLOWCHART_DEFAULT_CURVE } from "../curve/curve";
import { appendLabel, drawLabel, type DrawnLabel } from "../label/drawLabel";
import { drawConnectorLabel, drawPlaced } from "../label/drawPlaced";
import { SHAPES } from "../layout/shapes/shapeTable";
import type { FigureElement, ShapeFrame } from "../layout/shapes/shape";
import { drawConnectorRoute } from "./connectorCurve";
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
  // `A ~~~ B`: laid out and drawn as a path, so its label and an author's
  // `linkStyle` still reach it, but themed with no width.
  invisible: "siren-edge-invisible",
};

/**
 * How each end shape is drawn — the flowchart's `END_MARKER_NAME`, and the
 * class renderer's is the template it was written from.
 *
 * `name` is the *base* name of the marker's id and never an id on its own:
 * every id this renderer mints carries the render's own scope, because
 * `url(#id)` resolves against the whole page.
 *
 * A filled head shows its edge's colour as its `fill`; a hollow ring and an
 * open cross show it as their `stroke`, because a ring's `fill` is the
 * *surface* it sits on (that is what makes it read as hollow rather than
 * letting the line show through its middle) and an open cross has no
 * interior at all. That choice is the theme's, made by each shape's class,
 * so nothing here names a property.
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
  },
  circle: {
    name: "siren-circle",
    width: 8,
    height: 8,
    shapeClass: "siren-arrow-hollow",
  },
  cross: {
    name: "siren-cross",
    width: 8,
    height: 8,
    shapeClass: "siren-arrow-stroke",
  },
} as const satisfies Record<
  Exclude<EdgeEnd, "none">,
  { name: string; width: number; height: number; shapeClass: string }
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
 * This function never sees a timeline: `render()` hands it to the animation
 * controller alone. The initial `siren-pending` state is therefore not this
 * function's to decide: `createAnimationController(...).reset()`
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

  // Document order is paint order. Flowchart puts every line below every
  // frame and title as well as labels and nodes (ADR-0016):
  // `edgePaths → clusters → edgeLabels → nodes`.
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
    // The curve the model resolved from `linkStyle … interpolate`; an edge
    // no `interpolate` reached is drawn on the flowchart's default, `rounded`.
    // Its line hops are drawn by that curve, or not at all where it is one
    // that draws none (`basis`).
    drawConnectorRoute(path, edge.points, edge.curve ?? FLOWCHART_DEFAULT_CURVE, edge.hops);
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
    // its own ancestors, never from the path referencing it. The theme
    // paints a head with this path's stroke instead (`context-stroke`, see
    // `.siren-edge-marker` in default.css), which is why `stroke` colours
    // the whole arrow here as it does in Mermaid, rather than the line
    // alone. A browser without that keyword paints the head from the
    // marker's own token, so an edge that names a `stroke` is still given
    // markers of its own above, carrying that colour.
    //
    // Only the frame half. The text half goes to the label, drawn in the
    // label layer after every line, which is
    // the element it means: measured with the probe's `--paint` mode,
    // mermaid 11.17.2 paints an edge's label with the author's `color` and
    // paints the line with everything else, so the split a node already
    // makes is the split an edge makes too.
    applyInlineStyle(path, edge.style.frame);
    svg.appendChild(path);
  }

  // Keep frames and their titles above every line, but behind their nodes
  // and edge labels. The model's outermost-before-nested order still
  // paints each inner frame over its parent.
  for (const subgraph of graph.subgraphs) {
    svg.appendChild(buildSubgraph(subgraph));
  }

  // Every label after every line, in a loop of its own rather than beside
  // its own path. Beside its path, a label would be painted under every
  // edge drawn after it, and a later edge routed through that slot would
  // strike its text out; a layer of its own is Mermaid's `edgeLabels`
  // guarantee that no line crosses a label. Still under every node, so a
  // node is never hidden by the text of an edge that merely passes it.
  //
  // A sibling of the path rather than a child of a wrapping `<g>`, which
  // is what the class renderer uses. An edge *is* its path here — that
  // element carries `data-siren-id` and the animation classes, and board
  // 3 put the author's declarations on it — so introducing a group now
  // would move the id off the element three other places already find it
  // on. Two elements wearing one id is exactly what ADR-0009 settles: a
  // timeline target is an id, not an element, so `exit A-B fade` takes
  // the label with the line without the controller learning anything —
  // and that is also why splitting the two into separate layers costs the
  // flowchart nothing, where the class renderer needs a second group.
  // What the label paints behind its text goes first, so it sits over
  // every line and under its own text.
  for (const edge of graph.edges) {
    const drawnLabel = buildEdgeLabel(edge);
    if (drawnLabel !== null) {
      appendLabel(svg, drawnLabel);
    }
  }

  // Nodes last, over every line and every label. A line under an opaque
  // box disappears only where the two meet, and layout already stops each
  // line at the edge of the boxes it joins, so what the box hides is a
  // line that was only passing through — which is the point.
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
    for (const { element, classes, geometry, takesAuthorStyle, figure } of frames) {
      // A figure (an icon's glyph) is painted by its shape alone, which has
      // already read the author's declarations for the colour it asks for:
      // a frame's class or the author's `fill` would repaint its insides.
      if (figure) {
        applyInlineStyle(element, geometry);
        g.appendChild(element);
        continue;
      }
      element.setAttribute("class", ["siren-node-frame", ...classes].join(" "));
      // Two writers, one attribute — and the order is the authority. The
      // shape's own geometry goes first and the author's declarations
      // after, so `style A rx:0` overrides a stadium's ends exactly as an
      // author's declaration overrides the theme, while every other
      // declaration lands *alongside* a shape that stays itself.
      // A decoration the shape keeps in its own paint (a browser's dots)
      // takes none of the author's declarations.
      applyInlineStyle(element, takesAuthorStyle ? [...geometry, ...node.style.frame] : geometry);
      g.appendChild(element);
    }

    // A shape that draws no text (a fork, a small circle) says so in the
    // shape table, and its node draws no label at all — not an empty one.
    if (SHAPES[node.shape].drawsLabel !== false) {
      // Centred on the node, which is where layout centred the box the shape
      // was sized around — or moved off it by the offset layout reported for
      // a shape that puts its label elsewhere (`labelOffset`). What the
      // label paints behind its text goes in first, over the frame and
      // under the text, since document order is paint order.
      const drawn = drawLabel(node.label, node.labelBox, {
        x: node.x + node.width / 2 + (node.labelOffset?.x ?? 0),
        y: node.y + node.height / 2 + (node.labelOffset?.y ?? 0),
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
    }

    // The same wrapper the class diagram renderer calls, on the terms
    // ADR-0008 already established for a node's frame: `null` draws nothing
    // extra, an `href` interaction wraps the group in a link, a `call`
    // interaction stamps the click hook `attachClickHooks` reads back.
    svg.appendChild(wrapInteraction(g, node.interaction));
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
 * box the layout kept clear, which is *not* the middle of the route — a renderer
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
  const drawn = drawConnectorLabel(edge.label, "siren-edge-label");
  const { text } = drawn;
  // The same id the path wears — see ADR-0009, and the call site above —
  // on the text and on the background `drawConnectorLabel` draws behind
  // it, which is part of the label and has to enter and exit with it.
  text.setAttribute("data-siren-id", edge.id);
  drawn.background.setAttribute("data-siren-id", edge.id);
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
  // An animated edge's marching dashes are a class for the reason a line
  // style is: the theme owns the motion, and can stop it for a reader who
  // asked for less (`prefers-reduced-motion`).
  const animationClass = edge.animation === undefined ? null : `siren-edge-animation-${edge.animation}`;
  return ["siren-edge", lineClass, animationClass].filter((name) => name !== null).join(" ");
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
 * is the reason the frame is as tall as it is — the layout core sized the
 * frame to hold the title — so recomputing the position here would be a
 * second opinion on one number, free to drift from the space reserved for it.
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
  // The author's `style`/`class` on the block's handle, split by
  // `resolveStyles` as a node's is: the frame takes all but `color`.
  applyInlineStyle(frame, subgraph.style?.frame ?? []);
  g.appendChild(frame);

  // Over the frame and under the title, since document order is paint order.
  // The title takes the `color` half, translated to the `fill` text paints with.
  const title = drawPlaced(subgraph.label, "siren-subgraph-label");
  applyInlineStyle(title.text, subgraph.style?.text ?? []);
  appendLabel(g, title);

  return g;
}

/**
 * The elements that draw a node's outline, read off the shape table:
 * whichever shape the node has, its record says which elements to draw and
 * where, and this only turns that data into elements (`drawFrame`). Usually
 * one element; a subroutine is three and a double circle two, and the
 * caller writes the class and the style on each the same way, so nothing
 * here learns which shape draws how much.
 *
 * Every shape is drawn **inscribed in the node's bounding box**, the box
 * `layoutGraph` sized from the same record, so the label fits the figure
 * that is drawn.
 */
function buildNodeFrames(node: PositionedNode): DrawnFrame[] {
  return SHAPES[node.shape].frames(node).map((frame) => ({
    element: drawFrame(frame),
    classes: frame.classes ?? [],
    geometry: frame.style ?? [],
    takesAuthorStyle: frame.authorStyle !== false,
    figure: frame.children !== undefined,
  }));
}

/** One frame element, with what the shape itself declares on it. */
interface DrawnFrame {
  element: SVGElement;
  /** Classes the shape adds beside `siren-node-frame`. */
  classes: readonly string[];
  /**
   * What the shape itself has to declare in CSS rather than in an
   * attribute, such as a corner radius the shape owns — written inline
   * ahead of the author's declarations, so the author's win.
   */
  geometry: readonly StyleProperty[];
  /** Whether the author's `style` reaches this frame (`ShapeFrame.authorStyle`). */
  takesAuthorStyle: boolean;
  /** Whether it is a figure drawn inside the node (`ShapeFrame.children`), not part of its outline. */
  figure: boolean;
}

/** The SVG element one shape-table frame describes, with its geometry attributes. */
function drawFrame(frame: ShapeFrame): SVGElement {
  const element = document.createElementNS(SVG_NS, frame.element);
  for (const [name, value] of frame.attributes) {
    element.setAttribute(name, String(value));
  }
  frame.children?.forEach((child) => element.appendChild(drawFigureElement(child)));
  return element;
}

/**
 * One element of a figure, built from its data — its name and attributes
 * set one by one, never parsed from markup — with what it holds.
 */
function drawFigureElement(figure: FigureElement): SVGElement {
  const element = document.createElementNS(SVG_NS, figure.element);
  for (const [name, value] of figure.attributes) {
    element.setAttribute(name, value);
  }
  figure.children.forEach((child) => element.appendChild(drawFigureElement(child)));
  return element;
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
 * list after (a corner radius, from the shape table), which is why this takes a list rather
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
function applyInlineStyle(element: SVGElement, style: readonly StyleProperty[]): void {
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
 *
 * A `stroke` that reads the edge token itself — `var(--siren-edge-stroke)`,
 * bare or nested, as in `color-mix(in srgb, var(--siren-edge-stroke) 50%,
 * red)` — is `null` too, so its edge shares the theme's marker. The colour
 * is carried on a minted head as `--siren-edge-stroke:<stroke>`, and here
 * that would declare the token in terms of itself: a cycle, invalid at
 * computed-value time, which leaves a browser without `context-stroke` a
 * head whose `var()` fails, painted with whatever fill it inherits (black,
 * where nothing sets one). The theme's head already
 * paints through the token, which is what such a line reads, so sharing it
 * is the head the line asks for and writes nothing that can cycle. (The
 * flowchart parser refuses `(` in a declaration list, so no source text
 * reaches this today; the renderer keeps the rule on its own rather than
 * lean on that.)
 */
function strokeOf(style: StyleProperty[]): string | null {
  let stroke: string | null = null;
  for (const { property, value } of style) {
    if (property.toLowerCase() === "stroke") {
      stroke = value;
    }
  }
  return stroke !== null && READS_EDGE_TOKEN.test(stroke) ? null : stroke;
}

/**
 * A `var()` of the edge token anywhere in a value. The function name is
 * case-insensitive in CSS and a custom property's name is not, and a longer
 * name (`--siren-edge-stroke-width`) is a different property.
 */
const READS_EDGE_TOKEN = /[vV][aA][rR]\(\s*--siren-edge-stroke(?![-\w])/;

/**
 * Builds one end's `<marker>`: the theme's when `stroke` is `null`, and an
 * edge's own when it is a colour.
 *
 * The colour is written as the edge token, `--siren-edge-stroke`, declared
 * inline on the drawn shape, and never as the `fill` or `stroke` it ends up
 * painting. The theme paints a flowchart head with its line's stroke
 * (`context-stroke`), which already is the author's colour, a redeclared
 * token or a highlight, whichever the line wears; an inline `fill` would
 * outrank that rule (ADR-0008's cascade argument, which made it the right
 * spelling while a head could not see its line) and pin the head to the
 * author's colour under a highlight. The token outranks nothing: it only
 * matters to a browser that drops `context-stroke`, whose fallback rule for
 * each shape's class paints the token in the property that shape shows its
 * colour with. Keeping the class keeps the theme in charge of the ring's
 * surface fill too, which the author's `stroke` deliberately does not touch.
 *
 * So where `context-stroke` is supported, a coloured marker draws exactly
 * what the theme's does, and the per-(shape, colour) minting above is moot
 * there; it is kept, at the same economy, for the browsers that do not.
 */
function buildEndMarker(id: string, end: Exclude<EdgeEnd, "none">, stroke: string | null): SVGMarkerElement {
  const shape = END_SHAPES[end];
  const marker = document.createElementNS(SVG_NS, "marker") as SVGMarkerElement;
  marker.setAttribute("id", id);
  // What the theme paints a flowchart head through: its own edge's stroke,
  // where the browser knows `context-stroke` (default.css says which do).
  marker.setAttribute("class", "siren-edge-marker");
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
    drawn.setAttribute("style", `--siren-edge-stroke:${stroke}`);
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
