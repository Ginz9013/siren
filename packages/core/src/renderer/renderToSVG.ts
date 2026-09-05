import type { PositionedGraph } from "../contracts";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Builds a real `SVGSVGElement` from a `PositionedGraph`, per the frozen
 * SVG conventions in spec.md ("SVG conventions" bullet list): one
 * `<g class="siren-node">` per node, one `<path class="siren-edge">` per
 * edge, and `data-siren-id` on both.
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
    rect.setAttribute("x", String(node.x));
    rect.setAttribute("y", String(node.y));
    rect.setAttribute("width", String(node.width));
    rect.setAttribute("height", String(node.height));
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
    svg.appendChild(path);
  }

  return svg;
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
