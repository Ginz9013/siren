import type { PositionedErDiagram, PositionedErEntity } from "../contracts";

const SVG_NS = "http://www.w3.org/2000/svg";

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
 * its name together (ADR-0009).
 *
 * There are no relationships to draw, and so no `<defs>` and no arrowhead
 * marker: this kind refuses a relationship by name until the ticket that
 * implements one. Nothing here reads `diagram.timeline` — step 0 is
 * `createAnimationController(...).reset()`'s to establish, in `render()`, for
 * every diagram kind.
 */
export function renderErDiagramToSVG(diagram: PositionedErDiagram): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(diagram.width));
  svg.setAttribute("height", String(diagram.height));
  svg.setAttribute("viewBox", `0 0 ${diagram.width} ${diagram.height}`);

  for (const entity of diagram.entities) {
    svg.appendChild(buildEntity(entity));
  }

  return svg;
}

/** The `<g class="siren-er-entity">` for one entity: its frame and its name. */
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

  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("class", "siren-er-entity-label");
  // Centred in the box the layout sized for it. The box holds exactly one
  // row, so the centre is the whole of the placement — there is no stack of
  // rows here for layout to have assigned a y to, the way a state's
  // descriptions are.
  label.setAttribute("x", String(entity.x + entity.width / 2));
  label.setAttribute("y", String(entity.y + entity.height / 2));
  // Presentation attributes rather than theme rules, for the reason
  // `renderToSVG` gives: CSS would win over them and could drift out of sync
  // with the centering math above.
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "middle");
  label.textContent = entity.label;
  g.appendChild(label);

  return g;
}
