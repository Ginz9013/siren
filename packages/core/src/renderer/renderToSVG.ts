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

  // One arrowhead per distinct color, not per styled edge. A marker is a
  // pure function of the color it carries, so two edges of one color have
  // the same arrowhead by definition and a second def for it would be a
  // second copy of the same picture — fifty edges under one `linkStyle
  // default` would otherwise mint fifty. Distinctness is by the declaration's
  // exact text, so `#f00` and `red` are two colors here: over-minting draws
  // the right picture from an extra def, and under-minting would not.
  const arrowMarkerIdByStroke = new Map<string, string>();
  for (const edge of graph.edges) {
    const stroke = strokeOf(edge.style);
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

/**
 * Mints the token every id in one rendered SVG is namespaced by.
 *
 * The hazard it answers: an SVG `<marker>` is referenced as `url(#id)`, and
 * that reference resolves against the whole **document**, never against the
 * SVG it is written in. A fixed id therefore means the *first* matching
 * marker on the page wins, so two Siren diagrams on one page would draw the
 * first diagram's arrowheads on both. ADR-0008 rejected a generated `<style>`
 * block partly over this same global namespace ("two Siren diagrams on one
 * page would have to coordinate their generated names"); the answer here is
 * to need no coordination at all, by giving each render a name space nobody
 * else draws from.
 *
 * A random token rather than a counter, deliberately. A module-level counter
 * is only unique per *module instance*: two copies of `@siren/core` on one
 * page — an ordinary outcome of a dependency tree, and of a dual ESM/CJS
 * build — each start at 1 and collide, which is precisely the bug this
 * exists to prevent. A token drawn per call has no such shared state to
 * disagree about. `Math.random` rather than `crypto`: an id is a name, not a
 * secret, and nothing here is defended by unguessability.
 *
 * What it costs: the markup is no longer byte-reproducible across renders, so
 * two renders of the same document differ in exactly these tokens and in
 * nothing else. Nothing may cache or hardcode a marker id, and a test that
 * wants one must read it out of the DOM.
 *
 * The `__` is load-bearing rather than decorative: no `siren-*` class name
 * contains an underscore, so `siren-arrow__k3f9a1x2` is unambiguously a base
 * name plus a scope, and a reader (or a test normalizing markup back to "the
 * same drawing") can tell the two apart without a table of known names.
 */
function mintIdScope(): string {
  return `__${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
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
