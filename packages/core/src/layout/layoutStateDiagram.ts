import type {
  LayoutOptions,
  Point,
  PositionedState,
  PositionedStateDiagram,
  PositionedStateRow,
  PositionedStateTransition,
  ResolvedState,
  StateModel,
} from "../contracts";
import {
  clipRouteEndToBox,
  layoutDirectedGraph,
  type DirectedGraphLayoutNodeBox,
} from "./layoutDirectedGraph";

/** Horizontal padding between a state box's edge and its widest row of text. */
const STATE_PADDING_X = 14;
/**
 * Vertical padding between a state box's edge and its first or last row of
 * text — and, in a box carrying two or more descriptions, between the
 * divider and the rows either side of it, the way a class compartment is
 * padded.
 */
const STATE_PADDING_Y = 8;

/**
 * The radius of the disc a start pseudo-state is drawn as, and of the ring
 * around an end one — measured: mermaid 11.17.2 draws both at `r = 7`.
 *
 * A pseudo-state is sized from this rather than from its id, because its id
 * is generated (`start:1`) and nothing draws it: measuring it would reserve
 * the diagram room for a string no reader ever sees. The figure is a circle,
 * so the box is square.
 */
const PSEUDO_STATE_RADIUS = 7;

/**
 * Gap between a composite state's frame and the boxes and frames it
 * encloses, and the margin above and below its own title inside the strip
 * along its top.
 *
 * The same number `layoutGraph` pads a subgraph's frame by, because it is
 * the same figure: measured with `--markup`, mermaid 11.17.2 draws a
 * composite as a titled frame exactly as it draws a flowchart subgraph.
 * Which pixel count it is remains Siren's (ADR-0004), but one grouping frame
 * padded differently from the other would read as two constructs.
 */
const COMPOSITE_PADDING = 12;

/**
 * Computes state boxes and transition paths for a resolved `StateModel`.
 *
 * This is the state-diagram adapter over `layoutDirectedGraph`: it measures
 * each state's label, hands the resulting sizes to the shared layout core,
 * and reattaches the state diagram's own data to the coordinates that come
 * back. All graph-layout math lives in the core — including a
 * self-transition's loop, which is an ordinary edge whose two endpoints are
 * the same node and needs nothing special here.
 */
export function layoutStateDiagram(
  model: StateModel,
  options: LayoutOptions,
): PositionedStateDiagram {
  const planById = new Map(
    model.states.map((state) => [state.id, planStateBox(state, options)] as const),
  );

  const laidOut = layoutDirectedGraph({
    // The document's own rank direction — `TB` unless the author wrote a
    // `direction` outside every composite, which is the default measured
    // against mermaid 11.17.2. A *composite's* own direction is a separate
    // thing and reaches dagre per cluster below; measured, the two are
    // independent, so neither overrides the other.
    rankdir: model.direction,
    nodes: model.states.map((state) => {
      const plan = planById.get(state.id)!;
      return {
        id: state.id,
        width: plan.width,
        height: plan.height,
        // A composite is a *frame*: the states that name it as their parent
        // are laid out inside it. What the core hands back for it is the box
        // the core placed, which is *not* promised to have been sized from
        // those states or to enclose them — a composite nested inside one
        // carrying a `direction` comes back at exactly the size given above,
        // never having been sized at all (see `isCluster` in
        // `layoutDirectedGraph.ts` for the measured table). `compositeFrames`
        // is where the frame the picture shows is actually computed, by
        // union with the members, and that is why it cannot be skipped.
        // The size above is still worth giving: it is the smallest the frame
        // could sensibly be, and it is what a composite holding nothing is
        // drawn at, since the core lays a childless cluster out as an
        // ordinary box.
        ...(state.kind === "composite" ? { isCluster: true } : {}),
        // Membership, and the only thing about a composite the shared core
        // is told. `undefined` rather than `null` at the document's own
        // level, because the core switches dagre's compound mode on by the
        // *presence* of parentage — a field written as `null` would count.
        ...(state.parentId === null ? {} : { parentId: state.parentId }),
        // The composite's own `direction`, reaching dagre's
        // `recursiveClusterLayout` through the one field it reads per
        // cluster — the same port `layoutGraph` makes for a subgraph's.
        ...(state.direction === null ? {} : { rankdir: state.direction }),
      };
    }),
    edges: model.transitions.map((transition) => ({
      id: transition.id,
      from: transition.from,
      to: transition.to,
      // A labelled transition asks the core to keep its ranks far enough
      // apart for the text, and reports back where that space ended up.
      ...(transition.label === null
        ? {}
        : { label: options.measureText.measure(transition.label) }),
    })),
  });

  // Boxes as the shared core placed them, in *core* coordinates. The frames
  // below are grown in this space and can reach outside it; the shift that
  // follows moves everything into the space the diagram is finally described
  // in. `layoutGraph` does exactly this, for exactly this reason.
  const boxById = new Map(laidOut.nodes.map((box) => [box.id, box]));
  const routeById = new Map(laidOut.edges.map((route) => [route.id, route]));
  const frameById = compositeFrames(model, boxById, planById);

  // A frame grows outward — up for its title strip, out for its padding —
  // so it can reach above and left of the corner the core laid the graph out
  // from. Everything is shifted by however far it did, rather than a frame
  // being drawn at a negative coordinate, which is off the canvas.
  //
  // `Math.max(0, ...)` over an empty list is `0`, so a diagram with no
  // composite in it shifts by nothing and every coordinate below is the
  // core's own number untouched.
  const shift = {
    x: Math.max(0, ...[...frameById.values()].map((frame) => -frame.x)),
    y: Math.max(0, ...[...frameById.values()].map((frame) => -frame.y)),
  };
  const shifted = (point: Point): Point => ({ x: point.x + shift.x, y: point.y + shift.y });

  /**
   * Each styled state's declarations, keyed for lookup below.
   *
   * `buildStateModel` has already merged everything one state was styled by
   * and dropped the values its gate refused, and omits a state that ended up
   * with none — so there is nothing to reconcile here. A state absent from
   * this map gets the empty pair, which is what says "no `style` attribute"
   * to the renderer without it having to test for a missing field.
   */
  const styleByStateId = new Map(
    model.styles.map(({ targetId, style }) => [targetId, style]),
  );

  const states = model.states.map<PositionedState>((state) => {
    // A composite is drawn at its *frame*, which is grown from the cluster
    // box the core placed; everything else is drawn at the box itself.
    const box = frameById.get(state.id) ?? boxById.get(state.id)!;
    const plan = planById.get(state.id)!;
    const placed = shifted(box);
    return {
      id: state.id,
      kind: state.kind,
      x: placed.x,
      y: placed.y,
      width: box.width,
      height: box.height,
      // The plan measured everything from the box's own top edge, before
      // the core knew where the box would go; this is where that box
      // landed.
      rows: plan.rows.map((row) => ({ text: row.text, y: placed.y + row.y })),
      style: styleByStateId.get(state.id) ?? { frame: [], text: [] },
      dividerY: plan.dividerY === null ? null : placed.y + plan.dividerY,
    };
  });

  const transitions = model.transitions.map<PositionedStateTransition>((transition) => {
    const route = routeById.get(transition.id)!;

    // An endpoint that is a composite names the *frame*. The shared core
    // already clipped such a route to the cluster box it placed, which is
    // the honest answer in its own coordinates — but a frame is grown
    // outward from that box, by `COMPOSITE_PADDING` all round and a title
    // strip along the top, so an arrowhead left where the core put it would
    // land inside the frame by exactly that much. Growing the frame is this
    // module's decision, so paying for it is too — with the core's own
    // clipper, so that "on the boundary" means one thing in both spaces.
    let points = route.points;
    const fromFrame = frameById.get(transition.from);
    if (fromFrame !== undefined) {
      points = clipRouteEndToBox(points, fromFrame, "start");
    }
    const toFrame = frameById.get(transition.to);
    if (toFrame !== undefined) {
      points = clipRouteEndToBox(points, toFrame, "end");
    }

    return {
      id: transition.id,
      from: transition.from,
      to: transition.to,
      points: points.map(shifted),
      label: transition.label,
      labelAnchor: route.labelAnchor === undefined ? null : shifted(route.labelAnchor),
    };
  });

  const bounds = diagramBounds(states, transitions, options);

  return {
    states,
    transitions,
    timeline: model.timeline,
    // The core reports the bounds of the graph it placed, which never
    // included the title strip a frame grows upward for; this takes
    // whichever is larger so that neither a frame nor a route the core
    // routed outside its own figure — a self-transition's loop is the case
    // that reaches for room beside its box — is clipped by the `viewBox`.
    width: Math.max(laidOut.width + shift.x, bounds.width),
    height: Math.max(laidOut.height + shift.y, bounds.height),
  };
}

/**
 * Each composite's frame, in the shared core's own coordinate space, by the
 * composite's id.
 *
 * A frame is grown from the cluster box the core placed until it clears
 * everything it holds by `COMPOSITE_PADDING` and has a strip along its top
 * for its own title. That is `layoutGraph`'s `subgraphFrames`, ported —
 * including its nesting: a frame must clear the whole of each frame *beneath*
 * it, title strip included, since that strip is the part that reaches
 * highest.
 *
 * **Taking the union with what the frame holds is required, not merely
 * conservative.** The core's cluster box is not promised to have been sized
 * from the members or to enclose them: a composite nested inside one that
 * declared a `direction` comes back at *exactly the size this module handed
 * in* — its own title strip — with the states it holds at coordinates outside
 * it (measured; the table is on `isCluster` in `layoutDirectedGraph.ts` and
 * the test that pins it is in `layoutDirectedGraph.test.ts`). This diagram
 * kind reaches that combination on ordinary input, since `state Outer {` may
 * hold both a `direction` and another `state Inner {`. So the member boxes in
 * the four `Math.min`/`Math.max` calls below are not padding-and-titles
 * arithmetic that the core has already done — they are the only thing making
 * the inner frame the right size at all, and deleting them as redundant
 * draws a title bar with its whole contents spilled out of it.
 *
 * Grown by recursion rather than by walking the model backwards, which is
 * what `layoutGraph` can do because its subgraphs are listed in pre-order. A
 * composite's place in `StateModel.states` is where it was first *named*,
 * and a composite can be named by a transition written above the block that
 * opens its parent — so parent-before-child is not a property of this list,
 * and asking each frame for its children's frames is what makes the order
 * right whatever the list says.
 */
function compositeFrames(
  model: StateModel,
  boxById: ReadonlyMap<string, DirectedGraphLayoutNodeBox>,
  planById: ReadonlyMap<string, StateBoxPlan>,
): Map<string, DirectedGraphLayoutNodeBox> {
  const stateById = new Map(model.states.map((state) => [state.id, state]));
  const memberIdsByParent = new Map<string, string[]>();
  for (const state of model.states) {
    if (state.parentId !== null) {
      memberIdsByParent.set(state.parentId, [
        ...(memberIdsByParent.get(state.parentId) ?? []),
        state.id,
      ]);
    }
  }

  const frameById = new Map<string, DirectedGraphLayoutNodeBox>();

  const frameOf = (id: string): DirectedGraphLayoutNodeBox => {
    const already = frameById.get(id);
    if (already !== undefined) {
      return already;
    }

    const cluster = boxById.get(id)!;
    const plan = planById.get(id)!;
    // The plan's height *is* the title strip: padding, the title rows, then
    // padding again before whatever the frame holds starts.
    const strip = plan.height;

    const held = (memberIdsByParent.get(id) ?? []).map((memberId) =>
      stateById.get(memberId)!.kind === "composite"
        ? frameOf(memberId)
        : boxById.get(memberId)!,
    );

    const left = Math.min(cluster.x, ...held.map((box) => box.x - COMPOSITE_PADDING));
    const top = Math.min(cluster.y, ...held.map((box) => box.y - strip));
    const right = Math.max(
      cluster.x + cluster.width,
      // No narrower than its own title, whatever it holds.
      left + plan.width,
      ...held.map((box) => box.x + box.width + COMPOSITE_PADDING),
    );
    const bottom = Math.max(
      cluster.y + cluster.height,
      ...held.map((box) => box.y + box.height + COMPOSITE_PADDING),
    );

    const frame = { id, x: left, y: top, width: right - left, height: bottom - top };
    frameById.set(id, frame);
    return frame;
  };

  for (const state of model.states) {
    if (state.kind === "composite") {
      frameOf(state.id);
    }
  }

  return frameById;
}

/**
 * A state box measured but not yet placed: its size, and where each row of
 * its text sits relative to its own top edge. Computed before the shared
 * core runs, because the core needs the size; translated into diagram
 * coordinates once the core has placed the box — the division
 * `layoutClassDiagram` already draws between planning a box and placing it.
 */
interface StateBoxPlan {
  width: number;
  height: number;
  rows: PositionedStateRow[];
  dividerY: number | null;
}

/**
 * Measures one state's box from the text it actually draws.
 *
 * **Which text that is, is the whole point.** A state with descriptions
 * draws them and not its id — measured (mermaid 11.17.2): once `s : text`
 * is written, `s` appears nowhere in the picture, and the id is left doing
 * the job a flowchart id does under `A[label]`, namely addressing. A state
 * with no descriptions draws its id, as it always has.
 *
 * A pseudo-state is sized from the disc's radius instead, because its id is
 * generated (`start:1`) and nothing draws it: measuring it would reserve
 * the diagram room for a string no reader ever sees. The figure is a
 * circle, so the box is square and holds no rows.
 */
function planStateBox(state: ResolvedState, options: LayoutOptions): StateBoxPlan {
  if (state.kind === "start" || state.kind === "end") {
    const size = PSEUDO_STATE_RADIUS * 2;
    return { width: size, height: size, rows: [], dividerY: null };
  }

  const texts = state.descriptions.length === 0 ? [state.id] : state.descriptions;

  if (state.kind === "composite") {
    return planTitleStrip(texts, options);
  }

  const widths: number[] = [];
  const rows: PositionedStateRow[] = [];
  let bottom = STATE_PADDING_Y;
  let dividerY: number | null = null;

  texts.forEach((text, index) => {
    // The divider closes the title row and opens the compartment the rest
    // of the descriptions share — the two-compartment shape a class box is
    // built from, with one row in the first compartment instead of one
    // name. Only a box with a second row has one: measured, a single
    // description is drawn as a plain rounded rect with no line in it.
    if (index === 1) {
      bottom += STATE_PADDING_Y;
      dividerY = bottom;
      bottom += STATE_PADDING_Y;
    }
    const measured = options.measureText.measure(text);
    widths.push(measured.width);
    rows.push({ text, y: bottom + measured.height / 2 });
    bottom += measured.height;
  });

  return {
    width: Math.max(...widths) + STATE_PADDING_X * 2,
    height: bottom + STATE_PADDING_Y,
    rows,
    dividerY,
  };
}

/**
 * A composite's plan: the strip its title is drawn in, measured from the
 * frame's own top edge, and the smallest frame that strip could sit in.
 *
 * **The plan's `height` is the strip, not the frame.** A frame's height
 * comes from what it holds, which is not known until the shared core has
 * placed those members, so what is planned here is the part that *is* known:
 * padding, the title rows, padding again, which is what `compositeFrames`
 * then leaves clear above the first member. It doubles as the box a
 * composite holding nothing is drawn at, since the core lays a childless
 * cluster out as an ordinary node.
 *
 * No divider: the line under a described state's title row closes a
 * compartment, and a frame's title strip is not one — what is below it is
 * the members' own boxes.
 */
function planTitleStrip(texts: string[], options: LayoutOptions): StateBoxPlan {
  const widths: number[] = [];
  const rows: PositionedStateRow[] = [];
  let bottom = COMPOSITE_PADDING;

  for (const text of texts) {
    const measured = options.measureText.measure(text);
    widths.push(measured.width);
    rows.push({ text, y: bottom + measured.height / 2 });
    bottom += measured.height;
  }

  return {
    width: Math.max(...widths) + COMPOSITE_PADDING * 2,
    height: bottom + COMPOSITE_PADDING,
    rows,
    dividerY: null,
  };
}

/**
 * The extent every drawn thing fits inside: state boxes, transition paths,
 * and the text anchored along them.
 */
function diagramBounds(
  states: PositionedState[],
  transitions: PositionedStateTransition[],
  options: LayoutOptions,
): { width: number; height: number } {
  let right = 0;
  let bottom = 0;

  const cover = (x: number, y: number) => {
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  };

  for (const state of states) {
    cover(state.x + state.width, state.y + state.height);
  }

  for (const transition of transitions) {
    for (const point of transition.points) cover(point.x, point.y);
    if (transition.label !== null && transition.labelAnchor !== null) {
      const size = options.measureText.measure(transition.label);
      cover(
        transition.labelAnchor.x + size.width / 2,
        transition.labelAnchor.y + size.height / 2,
      );
    }
  }

  return { width: right, height: bottom };
}
