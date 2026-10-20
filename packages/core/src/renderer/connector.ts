/**
 * Draws a **connector** — a class diagram's relationship, a state diagram's
 * transition, an ER diagram's **ER relationship** — as the two groups
 * ADR-0016 splits it into: its line, and its text.
 *
 * Shared because each renderer kept a copy of the ADR-0016 two-group figure,
 * and what it draws from is one record, `PlacedConnector`, every kind's
 * connector extends (nook decision `01M5D99KNB4R5FVDRWCG902ZAC`). This is the
 * renderer-side half; `layout/connectors.ts` is the layout-side half, which
 * wraps the label and places the record this module draws.
 *
 * Every connector's line is drawn before every connector's text, and both
 * before the nodes: Mermaid's `edgePaths → edgeLabels → nodes`. A line routed
 * past a node it does not end at runs under that box, and no line — this
 * connector's or a later one's — crosses a label, because every label is
 * drawn after every line. That ordering is why the text cannot sit inside the
 * line's group.
 *
 * The two groups wear the same `data-siren-id`. ADR-0009 makes a timeline
 * target an id rather than an element, so `exit Animal-Duck fade` reaches
 * both groups with no help from the controller (ADR-0016). The labels
 * group's class name is in each theme's shared font rule, so its text
 * inherits the face and size it would have had inside the line group.
 *
 * What a kind adds is left to it: which marker each end wears (the renderer
 * owns its `<defs>`), its own dash pattern, attributes such as a class
 * relationship's `data-siren-relationship`, and any text beyond the label
 * (a class relationship's multiplicities and interface labels). A flowchart
 * edge is not drawn here: its DOM is a bare `<path>` with its label in a
 * separate label layer (see `renderToSVG.ts`).
 */
import type { PlacedConnector } from "../contracts";
import { CONNECTOR_CURVE } from "../curve/curve";
import { appendLabel } from "../label/drawLabel";
import { drawConnectorLabel } from "../label/drawPlaced";
import { drawConnectorRoute } from "./connectorCurve";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Builds a connector's line group: `<g class="${className}" data-siren-id>`
 * holding one `<path class="${className}-line">` along the connector's
 * route, and nothing else.
 *
 * `markerStart` / `markerEnd` are marker *base* names; each is suffixed with
 * this render's `scope` (`mintIdScope`) because `url(#id)` resolves against
 * the whole document. An end with no marker (omitted or `null`) is left
 * bare. `dashArray`, when given, is written as `stroke-dasharray` inline: it
 * is what the document said, not what the theme prefers, so a consumer's
 * stylesheet must not be able to undo it.
 *
 * Attributes are set in a fixed order — group: `class`, `data-siren-id`;
 * path: `class`, `d` (and `data-siren-points`), `fill`, `marker-start`,
 * `marker-end`, `stroke-dasharray` — because `outerHTML` serialises them in
 * that order. A caller adding its own attributes to the group sets them
 * after this returns, so they serialise after the id.
 */
export function buildConnectorLine(
  connector: PlacedConnector,
  options: {
    className: string;
    scope: string;
    markerStart?: string | null;
    markerEnd?: string | null;
    dashArray?: string | null;
  },
): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.setAttribute("class", options.className);
  g.setAttribute("data-siren-id", connector.id);

  const line = document.createElementNS(SVG_NS, "path");
  line.setAttribute("class", `${options.className}-line`);
  // Drawn with `CONNECTOR_CURVE`, the rounded curve: the layout handed the
  // core that curve's corner radius, so the line hops it found already keep
  // clear of the corners cut back here.
  drawConnectorRoute(line, connector.points, CONNECTOR_CURVE, connector.hops);
  // Explicit, not left to CSS: a route is an open, multi-segment path, which
  // a default fill would paint as a filled polygon spanning the nodes it
  // joins.
  line.setAttribute("fill", "none");
  if (options.markerStart != null) {
    line.setAttribute("marker-start", `url(#${options.markerStart}${options.scope})`);
  }
  if (options.markerEnd != null) {
    line.setAttribute("marker-end", `url(#${options.markerEnd}${options.scope})`);
  }
  if (options.dashArray != null) {
    line.setAttribute("stroke-dasharray", options.dashArray);
  }
  g.appendChild(line);

  return g;
}

/**
 * Builds a connector's labels group:
 * `<g class="${className}-labels" data-siren-id>`, the same id as its line
 * group, holding the connector's label — drawn centred on the anchor layout
 * reserved room for, over the background every connector label is painted
 * on — when it has one.
 *
 * The label is drawn by `drawConnectorLabel`: one plain row is the
 * `<text>`'s own `textContent`, anything else a tspan per row (ADR-0015).
 * `drawLabel` centres it on the anchor with `dominant-baseline: middle`; a
 * state transition's label used to sit with its baseline on the anchor,
 * above the middle of the room reserved for it, and the move is half the
 * font's x-height — about 0.26em, some 4px at 14px.
 *
 * Always a group, empty when the connector has no label: whether an empty
 * group is drawn is the caller's call. A state transition or ER relationship
 * with no label draws none; a class relationship first adds its
 * multiplicities and interface labels, and draws the group if anything is
 * in it.
 */
export function buildConnectorLabels(connector: PlacedConnector, className: string): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.setAttribute("class", `${className}-labels`);
  g.setAttribute("data-siren-id", connector.id);
  if (connector.label !== null) {
    appendLabel(g, drawConnectorLabel(connector.label, `${className}-label`));
  }
  return g;
}
