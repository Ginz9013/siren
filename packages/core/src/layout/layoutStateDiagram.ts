import type {
  LayoutOptions,
  PositionedState,
  PositionedStateDiagram,
  PositionedStateRow,
  PositionedStateTransition,
  ResolvedState,
  StateModel,
} from "../contracts";
import { layoutDirectedGraph } from "./layoutDirectedGraph";

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
 * The direction a state diagram is laid out in.
 *
 * Measured against mermaid 11.17.2: a state diagram with no `direction`
 * statement reports `TB`. A `direction` statement of its own is not read by
 * `parseStateDiagram` yet — it is refused with the rest of what this board
 * has not reached — so there is nothing on the model for this to come from,
 * and pretending otherwise with a field that is always `"TB"` would be a
 * contract saying something the parser cannot say.
 */
const STATE_RANKDIR = "TB";

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
    rankdir: STATE_RANKDIR,
    nodes: model.states.map((state) => {
      const plan = planById.get(state.id)!;
      return { id: state.id, width: plan.width, height: plan.height };
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

  const boxById = new Map(laidOut.nodes.map((box) => [box.id, box]));
  const routeById = new Map(laidOut.edges.map((route) => [route.id, route]));

  const states = model.states.map<PositionedState>((state) => {
    const box = boxById.get(state.id)!;
    const plan = planById.get(state.id)!;
    return {
      id: state.id,
      kind: state.kind,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      // The plan measured everything from the box's own top edge, before
      // the core knew where the box would go; this is where that box
      // landed.
      rows: plan.rows.map((row) => ({ text: row.text, y: box.y + row.y })),
      dividerY: plan.dividerY === null ? null : box.y + plan.dividerY,
    };
  });

  const transitions = model.transitions.map<PositionedStateTransition>((transition) => {
    const route = routeById.get(transition.id)!;
    return {
      id: transition.id,
      from: transition.from,
      to: transition.to,
      points: route.points,
      label: transition.label,
      labelAnchor: route.labelAnchor ?? null,
    };
  });

  const bounds = diagramBounds(states, transitions, options);

  return {
    states,
    transitions,
    timeline: model.timeline,
    // The core reports the bounds of the graph it placed; this takes
    // whichever is larger so that a route the core routed outside its own
    // figure — a self-transition's loop is the case that reaches for room
    // beside its box — is inside the canvas rather than clipped by the
    // `viewBox`.
    width: Math.max(laidOut.width, bounds.width),
    height: Math.max(laidOut.height, bounds.height),
  };
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
  if (state.kind !== "state") {
    const size = PSEUDO_STATE_RADIUS * 2;
    return { width: size, height: size, rows: [], dividerY: null };
  }

  const texts = state.descriptions.length === 0 ? [state.id] : state.descriptions;
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
