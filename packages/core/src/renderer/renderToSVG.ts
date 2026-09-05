import type { PositionedGraph, StyleProperty } from "../contracts";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Builds a real `SVGSVGElement` from a `PositionedGraph`, per the frozen
 * SVG conventions in spec.md ("SVG conventions" bullet list): one
 * `<g class="siren-node">` per node, wrapping a
 * `<rect class="siren-node-frame">` and its label, one
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

  svg.appendChild(buildDefs());

  for (const node of graph.nodes) {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "siren-node");
    g.setAttribute("data-siren-id", node.id);

    const rect = document.createElementNS(SVG_NS, "rect");
    // The drawn shape carries a class of its own, mirroring the class
    // diagram's `<rect class="siren-class-frame">`. The theme selects it
    // directly, so an author's inline `style` lands on exactly the element the
    // theme paints rather than on an anonymous descendant of the group — the
    // placement ADR-0008 argues for. `data-siren-id` and the animation classes
    // stay on the enclosing `<g>`.
    rect.setAttribute("class", "siren-node-frame");
    rect.setAttribute("x", String(node.x));
    rect.setAttribute("y", String(node.y));
    rect.setAttribute("width", String(node.width));
    rect.setAttribute("height", String(node.height));
    applyAuthorStyle(rect, node.style);
    g.appendChild(rect);

    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(node.x + node.width / 2));
    text.setAttribute("y", String(node.y + node.height / 2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.textContent = node.label;
    g.appendChild(text);

    svg.appendChild(g);
  }

  for (const edge of graph.edges) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "siren-edge");
    path.setAttribute("data-siren-id", edge.id);
    path.setAttribute("d", pointsToPathData(edge.points));
    path.setAttribute("marker-end", "url(#siren-arrow)");
    // The path is the whole drawn edge, so unlike a node there is no frame
    // to choose: this is the element the theme's `.siren-edge` paints and
    // the element the animation classes land on alike. It is also as far as
    // the declarations reach — the arrowhead is one shared `<marker>` in
    // `<defs>`, whose content inherits from its own ancestors rather than
    // from the path referencing it, so an author's `stroke` recolors the
    // line and leaves the arrowhead the theme's color.
    applyAuthorStyle(path, edge.style);
    svg.appendChild(path);
  }

  return svg;
}

/**
 * Writes the author's resolved `style` declarations onto `element` as an
 * inline `style` attribute, in declaration order, or leaves the element
 * without one when the author styled nothing.
 *
 * One function for a node's frame and for an edge's path, because the rule
 * is the same for both: land on the element the theme paints. Where the
 * author wrote the declarations — `style A`, `classDef`, `linkStyle 0` —
 * is not visible here, and must not be: `resolveStyles` settled what they
 * mean and `buildFlowchartModel` settled which element they belong to.
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

/** Builds the shared `<defs>` block, including the `siren-arrow` marker every edge references. */
function buildDefs(): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, "defs") as SVGDefsElement;

  const marker = document.createElementNS(SVG_NS, "marker");
  marker.setAttribute("id", "siren-arrow");
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
  marker.appendChild(arrowPath);

  defs.appendChild(marker);
  return defs;
}

/** Converts a layout-assigned point path into an SVG `<path>` `d` attribute. */
function pointsToPathData(points: { x: number; y: number }[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
}
