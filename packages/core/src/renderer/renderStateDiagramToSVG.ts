import type {
  Point,
  PositionedState,
  PositionedStateDiagram,
  PositionedStateTransition,
  StyleProperty,
} from "../contracts";
import { mintIdScope } from "./mintIdScope";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The *base* name of the transition arrowhead's marker — never an id on its
 * own. Every id this renderer mints is that base name plus the render's own
 * scope (`mintIdScope`), because `url(#id)` resolves against the whole page
 * rather than against the SVG it is written in, so two diagrams sharing a
 * fixed id would both draw the first one's arrowheads.
 */
const ARROW_MARKER_NAME = "siren-transition-arrow";

/**
 * Builds a real `SVGSVGElement` from a `PositionedStateDiagram`: one
 * `<g class="siren-state">` per state (a rounded
 * `<rect class="siren-state-frame">` and the
 * `<text class="siren-state-label">` titling it, plus — for a state the
 * author wrote two or more descriptions on — a
 * `<line class="siren-state-divider">` under that title row and a
 * `<text class="siren-state-description">` for each row below it — or, for the two
 * pseudo-states `[*]` spells, the filled `<circle class="siren-state-start">`
 * or the `<circle class="siren-state-end">` ring around its
 * `.siren-state-end-inner` disc) and one
 * `<g class="siren-transition">` per transition (a
 * `<path class="siren-transition-line">` along the layout's points, ending
 * in an arrowhead, plus a `<text class="siren-transition-label">` when the
 * author wrote one).
 *
 * A state the author wrote a `note` on carries that note **inside its own
 * group** — the class diagram's three note parts (`.siren-note-link`,
 * `.siren-note-frame`, `.siren-note-text`), reused because it is the same
 * figure, and put there rather than in a group of their own because a state
 * diagram's note has no id (see `appendNote`).
 *
 * A self-transition needs no case of its own: it is a route like any other,
 * drawn along whatever points the layout returned, and the loop is in those
 * points rather than in this file.
 *
 * Nothing here reads `diagram.timeline`. The initial `siren-pending` state is
 * not this function's to decide: `createAnimationController(...).reset()`
 * establishes it in `render()` for every diagram kind, out of the one rule
 * every later step comes from. A copy of that rule here would be a second
 * opinion on step 0 that has to agree with the controller's, forever, by
 * hand.
 *
 * Document order is the paint order: states, then transitions — a line drawn
 * under an opaque box would disappear where the two meet.
 */
export function renderStateDiagramToSVG(diagram: PositionedStateDiagram): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(diagram.width));
  svg.setAttribute("height", String(diagram.height));
  svg.setAttribute("viewBox", `0 0 ${diagram.width} ${diagram.height}`);

  const scope = mintIdScope();
  svg.appendChild(buildDefs(scope));

  for (const state of diagram.states) {
    svg.appendChild(buildState(state));
  }

  for (const transition of diagram.transitions) {
    svg.appendChild(buildTransition(transition, scope));
  }

  return svg;
}

/**
 * How much of a pseudo-state's radius the filled disc inside an end
 * pseudo-state's ring takes up.
 *
 * The *figure* is UML's and Mermaid's — a ring around a filled disc,
 * measured (11.17.2: an outer circle of r=7 with a smaller filled one
 * inside it). The *proportion* is Siren's, the split CONTEXT.md's
 * design-token entry draws between a shape's kind and how it is
 * proportioned.
 */
const END_STATE_INNER_RATIO = 0.5;

/**
 * Builds the `<g class="siren-state">` for one state: its frame at the
 * layout-assigned box, and its name centred inside it — or, for a
 * pseudo-state, the disc or ring that stands in for both.
 *
 * As on `.siren-node` and `.siren-class`, `data-siren-id` and the animation
 * classes land on this enclosing `<g>`; its parts carry none of their own.
 * The group's class is the same `siren-state` whichever figure is inside
 * it, for the reason a participant's `<g>` does not say whether it holds a
 * box or an actor: what is drawn differs, what it *is* does not, and the
 * timeline addresses the group.
 */
function buildState(state: PositionedState): SVGGElement {
  if (state.kind === "start" || state.kind === "end") {
    return buildPseudoState(state);
  }

  // Asked before the stereotype, because a state can carry both and Mermaid
  // draws the frame — measured (11.17.2, `--markup`): `state X <<choice>>`
  // followed by `state X { A --> B }` comes back as a cluster holding `A`
  // and `B`, with no diamond anywhere in the picture.
  if (state.kind === "composite") {
    return buildComposite(state);
  }

  if (state.kind === "region") {
    return buildRegion(state);
  }

  if (state.stereotype !== null) {
    return buildStereotypedState(state);
  }

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-state");
  g.setAttribute("data-siren-id", state.id);

  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("class", "siren-state-frame");
  frame.setAttribute("x", String(state.x));
  frame.setAttribute("y", String(state.y));
  frame.setAttribute("width", String(state.width));
  frame.setAttribute("height", String(state.height));
  applyAuthorStyle(frame, state.style.frame);
  g.appendChild(frame);

  // No `rx` here: a state's corner radius is a decoration of the box rather
  // than the figure itself, so it is the theme's (`--siren-node-border-radius`
  // on `.siren-state-frame`) exactly as a flowchart rectangle's is. Writing
  // one inline would put it out of a consumer's reach — see the design-token
  // entry in CONTEXT.md.

  // The divider before the text, so a row is never drawn under the line it
  // sits beside: document order is paint order.
  if (state.dividerY !== null) {
    g.appendChild(buildDivider(state, state.dividerY));
  }

  // The rows, at the y the layout measured each one at. *What* they say was
  // settled there: a described state's rows are its descriptions and an
  // undescribed one's is its id, and by here they are simply the text this
  // box holds.
  //
  // The first row titles the box — the id, the one description, or the
  // first of several — and every row below the divider is a description
  // row, the split `.siren-class-name` and `.siren-member` already draw so
  // that a theme can weight the title differently from what follows it.
  //
  // Every row wears the author's text declarations, not just the title: a
  // `class` names the state and not one of its lines, so an author who
  // recolors a box meant its title and its descriptions alike — the same
  // reading `renderClassDiagramToSVG` gives a class's name, annotation and
  // members.
  const centerX = state.x + state.width / 2;
  state.rows.forEach((row, index) => {
    const className = index === 0 ? "siren-state-label" : "siren-state-description";
    const label = buildCenteredText(className, row.text, { x: centerX, y: row.y });
    applyAuthorStyle(label, state.style.text);
    g.appendChild(label);
  });

  appendNote(g, state);

  return g;
}

/**
 * Adds the note hanging off `state` to its group — the
 * `<path class="siren-note-link">` tying it to the state, the
 * `<rect class="siren-note-frame">` at the box layout placed, and the
 * `<text class="siren-note-text">` centred in it — or adds nothing at all
 * when the author wrote no note.
 *
 * **The class diagram's three note classes, reused rather than doubled.** It
 * is the same figure drawn for the same reason, and `renderClassDiagramToSVG`
 * already draws it from exactly these three parts; a second set of names
 * would give the theme two notes to paint identically and forever. What
 * differs is the *group* they live in: a class note is a `siren-note` group
 * of its own wearing its own id, and a state note has no id at all
 * (measured — Mermaid names the drawn note after its state), so it is drawn
 * **inside the annotated state's own `<g>`**. That is also what animates it:
 * the timeline's classes land on that group, so a note fades and slides with
 * the state it belongs to, which is the only animation it can have.
 *
 * The connector goes in first, so the note's own box paints over the end of
 * it: document order is paint order. It carries no `marker-end` — measured,
 * Mermaid builds this edge with `arrowhead: "none"`, and an arrowhead would
 * read as a transition into the note.
 *
 * The author's `style` declarations are deliberately not written onto any of
 * this: measured (mermaid 11.17.2), a `class` applied to a state paints the
 * state's own rect, and the note keeps the note colours whatever the state
 * is painted.
 */
function appendNote(g: SVGGElement, state: PositionedState): void {
  const note = state.note;
  if (note === null) {
    return;
  }

  const link = document.createElementNS(SVG_NS, "path");
  link.setAttribute("class", "siren-note-link");
  link.setAttribute("d", pointsToPathData(note.connector));
  // Explicit, for the same reason a transition line carries it: an open,
  // multi-segment path would otherwise be painted as a filled polygon.
  link.setAttribute("fill", "none");
  g.appendChild(link);

  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("class", "siren-note-frame");
  frame.setAttribute("x", String(note.x));
  frame.setAttribute("y", String(note.y));
  frame.setAttribute("width", String(note.width));
  frame.setAttribute("height", String(note.height));
  g.appendChild(frame);

  g.appendChild(
    buildCenteredText("siren-note-text", note.text, {
      x: note.x + note.width / 2,
      y: note.y + note.height / 2,
    }),
  );
}

/**
 * Builds the `<g class="siren-state">` for a composite state: the
 * `<rect class="siren-composite-frame">` at the frame layout grew around
 * everything the block holds, and the
 * `<text class="siren-composite-label">` titling it in the strip along its
 * top.
 *
 * **Still a `siren-state` group, wearing the composite's own id.** A
 * composite is a state — a transition may name one at either end, and
 * everything that addresses a state by id addresses this the same way — so
 * the group's class does not change for the figure inside it, exactly as a
 * participant's `<g>` does not say whether it holds a box or an actor. What
 * changes is the two parts, which carry classes of their own because a
 * frame is painted differently from a box: `.siren-state-frame` is filled,
 * and a composite drawn with one would hide everything inside it.
 *
 * The title's rows come from layout, which measured them and left room in
 * the strip; a composite draws no divider, because the line under a
 * described state's title row closes a compartment and what is under this
 * strip is the members' own boxes.
 */
function buildComposite(state: PositionedState): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-state");
  g.setAttribute("data-siren-id", state.id);

  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("class", "siren-composite-frame");
  frame.setAttribute("x", String(state.x));
  frame.setAttribute("y", String(state.y));
  frame.setAttribute("width", String(state.width));
  frame.setAttribute("height", String(state.height));
  // A class applied to a composite reaches its **frame**, measured (mermaid
  // 11.17.2): `class Outer urgent` puts the class on the cluster's own `<g>`
  // and its generated rule paints the rects inside it. So a composite is
  // styled exactly as a state is, on the one rect it is drawn as.
  applyAuthorStyle(frame, state.style.frame);
  g.appendChild(frame);

  // No `rx` here either — a frame's corner radius is the theme's, for the
  // reason `buildState` gives for a state's box.
  const centerX = state.x + state.width / 2;
  for (const row of state.rows) {
    const label = buildCenteredText("siren-composite-label", row.text, {
      x: centerX,
      y: row.y,
    });
    applyAuthorStyle(label, state.style.text);
    g.appendChild(label);
  }

  // A composite carries a note exactly as a state does — measured: mermaid
  // 11.17.2 records the note on the composite's own record, and the same
  // statement writes it.
  appendNote(g, state);

  return g;
}

/**
 * Builds the `<g class="siren-state">` for one concurrent region — the
 * `<rect class="siren-state-region">` at the frame layout grew around that
 * region's members, and nothing else.
 *
 * **Untitled, and that is measured rather than a simplification.** With
 * `--markup` (mermaid 11.17.2) a divider's group comes back holding exactly
 * one element, a `rect.divider`, with no label child anywhere in it — and
 * mermaid's own stylesheet gives that rect `stroke-dasharray: 10,10`, so
 * the figure is a *dashed frame* around the region rather than a single
 * line between two of them. The dashes are the theme's
 * (`.siren-state-region`), the figure is this.
 *
 * There is also nothing it *could* be titled with: a region's id is
 * generated (`region:1`), so drawing it would put a string the author never
 * wrote onto the picture — the reason a pseudo-state draws no label either.
 *
 * **Still a `siren-state` group wearing that generated id**, for the reason
 * a composite's is: everything that addresses a state by id addresses this
 * the same way, so the theme's highlight rules and a `timeline:` entry both
 * reach it through the selector they already use. That the id is generated
 * rather than authored changes nothing about the lookup — a pseudo-state's
 * `start:1` is addressable on exactly these terms (ADR-0009: a target is an
 * id, and this one has one because the renderer needed it anyway).
 *
 * No author style: a region carries none and can carry none, because a
 * `class` statement names a `\w+` id and `region:1` has a colon in it.
 */
function buildRegion(state: PositionedState): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-state");
  g.setAttribute("data-siren-id", state.id);

  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("class", "siren-state-region");
  frame.setAttribute("x", String(state.x));
  frame.setAttribute("y", String(state.y));
  frame.setAttribute("width", String(state.width));
  frame.setAttribute("height", String(state.height));
  g.appendChild(frame);

  return g;
}

/**
 * Writes the author's resolved `classDef`/`class` declarations onto
 * `element` as an inline `style` attribute, in declaration order, or leaves
 * the element without one when the author styled nothing.
 *
 * The same function `renderClassDiagramToSVG` has, for the same reasons,
 * spelled the same way: inline rather than a generated class rule, and on
 * the drawn shape rather than its enclosing `<g>`, both for the cascade
 * reason ADR-0008 records. The theme styles `.siren-state-frame` and
 * `.siren-state-label` directly, so an inline declaration on those elements
 * outranks it without `!important`, while the same declaration on the `<g>`
 * would only ever be *inherited* by them and so would lose.
 *
 * The values are written verbatim. They are author input, but they arrive
 * here having already passed `resolveStyles`' gate in `buildStateModel` (no
 * `url(`, no `expression(`, no `;`, no backslash), and re-checking here
 * would fork that single source of truth. This attribute is a CSS sink,
 * never an HTML one: nothing is parsed as markup, so the hard
 * `textContent`-never-`innerHTML` invariant is untouched.
 *
 * A pseudo-state is deliberately not reached by this: `[*]` is not an id, so
 * no `class` statement can name one.
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
 * Builds the `<g class="siren-state">` for a state carrying a
 * `<<choice>>`, `<<fork>>` or `<<join>>` marker: the diamond one is drawn as,
 * or the solid bar the other two share.
 *
 * **Still a `siren-state` group wearing the author's own id**, for the reason
 * a composite's is: the state keeps its place in the relations and everything
 * that addresses a state by id addresses this the same way. All that changes
 * is the figure inside — measured (mermaid 11.17.2, `--markup`): the state's
 * record keeps its id and its relations, and only the drawn shape differs.
 *
 * **No label, for all three.** Measured: Mermaid's `forkJoin` shape sets
 * `node.label = ""` outright, and none of the three groups comes back with a
 * label child where an ordinary state's does. `layoutStateDiagram` has
 * already said so by handing over no rows; this draws none either way, so a
 * row arriving here could not put text on a figure with no room for it.
 *
 * **One figure for fork and join, not two.** Measured: both come back as the
 * same path, `M-35 -5 L35 -5 L35 5 L-35 5`, so the two spellings name one
 * drawing and there is nothing here to tell them apart. Which way the bar
 * lies is not asked either: layout turned the box, and the bar fills it.
 */
function buildStereotypedState(state: PositionedState): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-state");
  g.setAttribute("data-siren-id", state.id);

  if (state.stereotype === "choice") {
    const diamond = document.createElementNS(SVG_NS, "polygon");
    // **`.siren-state-frame`, not a name of its own.** A diamond is this
    // state's frame drawn as a different element, exactly as a flowchart's
    // diamond wears `.siren-node-frame` while a rectangle does — and
    // measured, Mermaid paints it in the same pair a state box takes (fill
    // `mainBkg`, stroke `primaryBorderColor`), so a second class would give
    // the theme two names to paint identically forever. It is also what
    // keeps `class Choice urgent` landing on the figure (ADR-0008).
    diamond.setAttribute("class", "siren-state-frame");
    const midX = state.x + state.width / 2;
    const midY = state.y + state.height / 2;
    diamond.setAttribute(
      "points",
      [
        `${midX},${state.y}`,
        `${state.x + state.width},${midY}`,
        `${midX},${state.y + state.height}`,
        `${state.x},${midY}`,
      ].join(" "),
    );
    applyAuthorStyle(diamond, state.style.frame);
    g.appendChild(diamond);
    return g;
  }

  const bar = document.createElementNS(SVG_NS, "rect");
  // A class of its own, unlike the diamond: measured, Mermaid fills this one
  // with `lineColor` rather than the node fill — it is an ink mark rather
  // than a box, the way `.siren-state-start`'s disc is, and painting it with
  // `.siren-state-frame`'s rule would draw a pale, outlined slab where UML
  // draws a solid bar.
  bar.setAttribute("class", "siren-state-bar");
  bar.setAttribute("x", String(state.x));
  bar.setAttribute("y", String(state.y));
  bar.setAttribute("width", String(state.width));
  bar.setAttribute("height", String(state.height));
  applyAuthorStyle(bar, state.style.frame);
  g.appendChild(bar);
  return g;
}

/**
 * Builds the `<g class="siren-state">` for a start or end pseudo-state: the
 * filled disc UML draws a start as, or the ring around a filled disc it
 * draws an end as. Concentric in the square box layout sized for it.
 *
 * No label, and deliberately: a pseudo-state's id is *generated*
 * (`start:1`), so the only text there could be to draw is a string the
 * author never wrote and no reader should be shown.
 */
function buildPseudoState(state: PositionedState): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-state");
  g.setAttribute("data-siren-id", state.id);

  const center = { x: state.x + state.width / 2, y: state.y + state.height / 2 };
  const radius = state.width / 2;

  if (state.kind === "start") {
    g.appendChild(buildCircle("siren-state-start", center, radius));
    return g;
  }

  // Drawn outer first so the inner disc lands on top of it — a ring is a
  // circle with a smaller one over it, and document order is paint order.
  g.appendChild(buildCircle("siren-state-end", center, radius));
  g.appendChild(
    buildCircle("siren-state-end-inner", center, radius * END_STATE_INNER_RATIO),
  );
  return g;
}

/**
 * Builds the `<line class="siren-state-divider">` closing a described
 * state's title row, spanning the frame's full width — the line Mermaid
 * draws as `line.divider` inside a `rect.outer.title-state` (measured,
 * 11.17.2), and the same figure a class box's compartment divider is.
 */
function buildDivider(state: PositionedState, y: number): SVGLineElement {
  const line = document.createElementNS(SVG_NS, "line") as SVGLineElement;
  line.setAttribute("class", "siren-state-divider");
  line.setAttribute("x1", String(state.x));
  line.setAttribute("y1", String(y));
  line.setAttribute("x2", String(state.x + state.width));
  line.setAttribute("y2", String(y));
  return line;
}

/** One `<circle>` of the given class, centred on `center`. */
function buildCircle(
  className: string,
  center: Point,
  radius: number,
): SVGCircleElement {
  const circle = document.createElementNS(SVG_NS, "circle") as SVGCircleElement;
  circle.setAttribute("class", className);
  circle.setAttribute("cx", String(center.x));
  circle.setAttribute("cy", String(center.y));
  circle.setAttribute("r", String(radius));
  return circle;
}

/**
 * Builds the `<g class="siren-transition">` for one transition: the routed
 * line with its arrowhead, and the label when there is one.
 */
function buildTransition(
  transition: PositionedStateTransition,
  scope: string,
): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "siren-transition");
  g.setAttribute("data-siren-id", transition.id);

  const line = document.createElementNS(SVG_NS, "path");
  line.setAttribute("class", "siren-transition-line");
  line.setAttribute("d", pointsToPathData(transition.points));
  // Explicit, not left to CSS: a transition's points make an open,
  // multi-segment path, which a default fill would paint as a filled polygon
  // over the states it connects.
  line.setAttribute("fill", "none");
  line.setAttribute("marker-end", `url(#${ARROW_MARKER_NAME}${scope})`);
  g.appendChild(line);

  if (transition.label !== null && transition.labelAnchor !== null) {
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("class", "siren-transition-label");
    label.setAttribute("x", String(transition.labelAnchor.x));
    label.setAttribute("y", String(transition.labelAnchor.y));
    label.setAttribute("text-anchor", "middle");
    // textContent, never innerHTML — the hard invariant of every Siren
    // renderer: a label is author input and must render literally.
    label.textContent = transition.label;
    g.appendChild(label);
  }

  return g;
}

/**
 * The shared `<defs>` block: the one `<marker>` every transition ends in.
 *
 * `markerUnits="userSpaceOnUse"` (not the SVG default) keeps the arrowhead a
 * fixed absolute size when a highlighted transition's stroke-width changes,
 * and `refX` equals `markerWidth` so the tip lands exactly on the path's
 * endpoint rather than overshooting into the state it points at — both for
 * the reasons recorded in `renderToSVG.ts`.
 *
 * `siren-arrow-fill` is the class the flowchart, sequence and class
 * renderers already use for a filled head, so the theme paints this one
 * without learning a name.
 */
function buildDefs(scope: string): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, "defs") as SVGDefsElement;
  const marker = document.createElementNS(SVG_NS, "marker") as SVGMarkerElement;
  marker.setAttribute("id", `${ARROW_MARKER_NAME}${scope}`);
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("markerWidth", "8");
  marker.setAttribute("markerHeight", "6");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "3");
  marker.setAttribute("orient", "auto-start-reverse");

  const head = document.createElementNS(SVG_NS, "path");
  head.setAttribute("d", "M0,0 L8,3 L0,6 Z");
  head.setAttribute("class", "siren-arrow-fill");
  marker.appendChild(head);

  defs.appendChild(marker);
  return defs;
}

/** Converts a layout-assigned point path into an SVG `<path>` `d` attribute. */
function pointsToPathData(points: Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
}

/**
 * A `<text>` centred on `anchor` in both axes — the shape a box label takes
 * in every Siren renderer, since the layout hands over a centre point rather
 * than a baseline. Text is set with `textContent`, never `innerHTML`.
 */
function buildCenteredText(className: string, content: string, anchor: Point): SVGTextElement {
  const text = document.createElementNS(SVG_NS, "text") as SVGTextElement;
  text.setAttribute("class", className);
  text.setAttribute("x", String(anchor.x));
  text.setAttribute("y", String(anchor.y));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  text.textContent = content;
  return text;
}
