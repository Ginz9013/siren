import type { PositionedGraph } from "../contracts";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Builds a real `SVGSVGElement` from a `PositionedGraph`, per the frozen
 * SVG conventions in spec.md ("SVG conventions" bullet list): one
 * `<g class="siren-node">` per node, one `<path class="siren-edge">` per
 * edge, `data-siren-id` on both, and the initial `siren-pending` class on
 * elements with an `enter` action in the graph's resolved timeline (see
 * `pendingElementIds` for the exact rule).
 */
export function renderToSVG(graph: PositionedGraph): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(graph.width));
  svg.setAttribute("height", String(graph.height));
  svg.setAttribute("viewBox", `0 0 ${graph.width} ${graph.height}`);
  const pendingIds = pendingElementIds(graph);

  svg.appendChild(buildDefs());

  for (const node of graph.nodes) {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", pendingIds.has(node.id) ? "siren-node siren-pending" : "siren-node");
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
    path.setAttribute("class", pendingIds.has(edge.id) ? "siren-edge siren-pending" : "siren-edge");
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
  marker.setAttribute("markerWidth", "10");
  marker.setAttribute("markerHeight", "10");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "5");
  marker.setAttribute("orient", "auto-start-reverse");

  const arrowPath = document.createElementNS(SVG_NS, "path");
  arrowPath.setAttribute("d", "M0,0 L10,5 L0,10 Z");
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

/**
 * Ids of elements with an `enter` action in the graph's resolved timeline.
 * Only these elements start hidden as `siren-pending`; an element whose
 * only timeline actions are `exit`/`highlight`/`unhighlight` must already
 * be visible (see spec.md's "Visibility precondition" domain decision), and
 * an element never mentioned in the timeline (implicit "step 0") also
 * renders immediately visible.
 */
function pendingElementIds(graph: PositionedGraph): Set<string> {
  const ids = new Set<string>();
  for (const entry of graph.timeline.entries) {
    if (entry.kind === "enter") {
      ids.add(entry.targetId);
    }
  }
  return ids;
}
