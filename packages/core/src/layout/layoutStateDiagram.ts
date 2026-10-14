import type {
  Direction,
  Label,
  LayoutOptions,
  PositionedState,
  PositionedStateDiagram,
  PositionedStateNote,
  PositionedStateLabel,
  PositionedStateTransition,
  ResolvedState,
  ResolvedStateTransition,
  StateModel,
  StateNote,
} from "../contracts";
import {
  layoutDirectedGraph,
  type DirectedGraphEdge,
  type DirectedGraphEdgeRoute,
  type DirectedGraphNode,
  type DirectedGraphNodeBox,
} from "./layoutDirectedGraph";
import { clusterNode, SUBGRAPH_PADDING } from "./clusters";
import { noteBoxSize, noteLinkEdgeId, noteNodeId } from "./notes";
import { CONNECTOR_CORNER_RADIUS } from "../curve/curve";
import { plainLabel } from "../label/label";
import {
  NO_WRAP,
  wrapConnectorLabel,
  wrapLabel,
  wrapNodeLabel,
  type WrappedLabel,
} from "../label/wrapLabel";

/** Horizontal padding between a state box's edge and its widest label. */
const STATE_PADDING_X = 14;
/**
 * Vertical padding between a state box's edge and its first or last label's
 * text — and, in a box carrying two or more descriptions, between the
 * divider and the labels either side of it, the way a class compartment is
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
const PSEUDO_STATE_ARCHIV = 7;

/**
 * Half the diagonal of the diamond a `<<choice>>` state is drawn as —
 * measured (mermaid 11.17.2, `--markup` plus a reading of the path's own
 * extent): the shape spans `x[-14,14] y[-14,14]`, a 28 × 28 square box, and
 * it is that size whichever direction the level runs in.
 *
 * Sized from the figure and not from the id, for the reason a pseudo-state
 * is: the id stays the author's and stays what a transition names, but
 * nothing draws it, so measuring it would reserve room for a string no
 * reader ever sees.
 */
const CHOICE_ARCHIV = 14;

/**
 * The bar a `<<fork>>` or a `<<join>>` is drawn as — measured: both come
 * back as the *same* path, `M-35 -5 L35 -5 L35 5 L-35 5`, so they are one
 * figure and this is one pair of numbers rather than two.
 *
 * `LENGTH` runs across the level's flow and `THICKNESS` along it; which axis
 * each lands on is `forkJoinBox` below.
 */
const FORK_BAR_LENGTH = 70;
const FORK_BAR_THICKNESS = 10;

/**
 * The box a fork or join's bar occupies at a level running `direction`.
 *
 * **Turned by `LR` and by nothing else**, which is measured rather than
 * reasoned: mermaid 11.17.2's `forkJoin` shape tests `dir === "LR"`
 * exactly, so the bar is 70 × 10 under `TB`, `BT`, `RL` *and* `TD` and only
 * 10 × 70 under `LR`. `RL` getting the horizontal bar looks like an
 * oversight and may well be one, but the document says nothing about which
 * way a bar points — so there is no statement of the author's for Mermaid's
 * picture to contradict, and CONTEXT.md's divergence rule does not reach
 * it. Siren follows the drawing.
 */
const forkBarBox = (direction: Direction): { width: number; height: number } =>
  direction === "LR"
    ? { width: FORK_BAR_THICKNESS, height: FORK_BAR_LENGTH }
    : { width: FORK_BAR_LENGTH, height: FORK_BAR_THICKNESS };

/**
 * Whether this kind of state is drawn as a **frame** — a cluster the shared
 * core sizes around whatever names it as a parent — rather than as a figure
 * of its own size.
 *
 * Two kinds are, for the same structural reason and with two different
 * figures: a composite is the titled frame `state Outer {` opens, and a
 * concurrent region is the untitled one a `--` divides that block into.
 * Everything that hands a frame to the core or asks for its level asks this
 * rather than naming `"composite"`, so a second frame kind could not be half
 * added.
 */
const isFrame = (kind: ResolvedState["kind"]): boolean =>
  kind === "composite" || kind === "region";

/**
 * The direction a composite or region whose block writes no `direction`
 * lays its members out in: Mermaid 12.2.0's `DEFAULT_NESTED_DOC_DIR`
 * (`stateDiagram-v2-MYRXERYP.mjs`, line 964), whatever the document's own.
 */
const NESTED_DIRECTION: Direction = "TB";

/**
 * A state carrying a note, with the note's label wrapped and measured.
 *
 * The note is keyed by the state's own id inside the shared layout core
 * (`noteNodeId`, `noteLinkEdgeId`): a state carries **at most one** note
 * (measured — a second one replaces the first), so the state's id is enough
 * to name both the note and its link without a counter.
 */
type NotedState = { state: ResolvedState; note: StateNote } & WrappedLabel;

/**
 * Whether `note` is written `left of` its state — the spelling whose link
 * runs note → state, and whose connector is reversed to read state → note.
 */
const isLeftOf = (note: StateNote): boolean => note.position === "left of";

/**
 * Computes state boxes and transition paths for a resolved `StateModel`.
 *
 * This is the state-diagram adapter over the shared ELK layout core
 * (`layoutDirectedGraph`): it measures each state's label,
 * hands the resulting sizes to the core — composites and concurrent regions
 * as clusters, notes as boxes of their own, in Mermaid 12.2.0's order — and
 * reattaches the state diagram's own data to the coordinates that come back.
 * All graph-layout math lives in the core, frames, a transition's ends on a
 * composite's frame and every self-transition's loop included; nothing here
 * moves a box, a frame or a route afterwards (nook decision
 * `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 2).
 */
export function layoutStateDiagram(
  model: StateModel,
  options: LayoutOptions,
): PositionedStateDiagram {
  const levelDirectionOf = levelDirections(model);
  const planById = new Map(
    model.states.map(
      (state) =>
        [state.id, planStateBox(state, levelDirectionOf(state), options)] as const,
    ),
  );

  /**
   * The states carrying a note, each with the note itself and its label
   * wrapped at the 14px it is drawn at (`wrapNodeLabel`: measured, mermaid
   * 11.17.2 wraps a note, one-line or block, at 200px) — narrowed and measured
   * here once so that the three places below that add a node, add an edge
   * and read the result back all work from the same list, and the box and
   * rows the note was sized around are the ones it is drawn with.
   */
  const notedStates = model.states.flatMap((state): NotedState[] =>
    state.note === null
      ? []
      : [
          {
            state,
            note: state.note,
            ...wrapNodeLabel(state.note.label, options.measureText),
          },
        ],
  );
  const wrappedNoteById = new Map<string, WrappedLabel>(
    notedStates.map(({ state, label, labelBox }) => [state.id, { label, labelBox }]),
  );

  /**
   * Each labelled transition's label wrapped and measured at the 12px it is
   * drawn at (`wrapConnectorLabel`: 150px of text, Mermaid's 200 scaled to
   * that size, by the label-wrap ADR, nook `01M4R4WDZ`), by the
   * transition's id — once, so the box the core keeps clear and the box the
   * renderer draws in are the same box, and the rows drawn are the wrapped
   * label's.
   */
  const wrappedTransitionLabelById = new Map(
    model.transitions.flatMap((transition) =>
      transition.label === null
        ? []
        : [[transition.id, wrapConnectorLabel(transition.label, options.measureText)] as const],
    ),
  );

  /**
   * A state as the core is handed it. A composite or a concurrent region
   * goes as a cluster (`clusterNode`, as every kind's grouping frame does);
   * a region has no title, so it asks for no band.
   *
   * The frame the core placed comes back through the states below rather
   * than `placedFrame`: a composite's title is the plan's stack of labels
   * (its name and any description rows), not one `PlacedLabel`.
   */
  const stateNode = (state: ResolvedState): DirectedGraphNode => {
    const plan = planById.get(state.id)!;
    if (isFrame(state.kind)) {
      return clusterNode({
        id: state.id,
        parentId: state.parentId,
        title: plan.labels.length === 0 ? null : titleSize(plan),
        // `TB` when the block names none: Mermaid 12.2.0 gives every
        // composite and region a direction of its own,
        // `DEFAULT_NESTED_DOC_DIR` when its block writes no `direction`
        // (`getDir`, `stateDiagram-v2-MYRXERYP.mjs` lines 964 and 1083), so
        // even under a document-level `LR` an undirected block stacks its
        // members.
        direction: state.direction ?? NESTED_DIRECTION,
      });
    }
    return {
      id: state.id,
      width: plan.width,
      height: plan.height,
      ...(state.parentId === null ? {} : { parentId: state.parentId }),
    };
  };

  /**
   * A note as the core is handed it: a box the layout places like any other,
   * which is what keeps it from landing on top of a state — as Mermaid
   * 12.2.0 places it, a node of its own. It joins the level its state is
   * written at.
   */
  const noteNode = ({ state, labelBox }: NotedState): DirectedGraphNode => ({
    id: noteNodeId(state.id),
    ...noteBoxSize(labelBox),
    ...(state.parentId === null ? {} : { parentId: state.parentId }),
  });

  /** A transition as the core is handed it. */
  const transitionEdge = (transition: ResolvedStateTransition): DirectedGraphEdge => ({
    id: transition.id,
    from: transition.from,
    to: transition.to,
    // A labelled transition asks the core to keep room for the text on the
    // line, and reports back where that room ended up.
    ...(transition.label === null
      ? {}
      : { label: wrappedTransitionLabelById.get(transition.id)!.labelBox }),
    // The radius the line hops keep clear of: a transition is drawn rounded
    // (`CONNECTOR_CURVE`).
    cornerRadius: CONNECTOR_CORNER_RADIUS,
  });

  /**
   * The edge that puts a note beside the state it annotates, and whose route
   * is the note's connector. **The side the author named is spent here, as
   * this edge's direction** — Mermaid's own construction: `right of` runs
   * state → note and `left of` runs note → state, so a `left of` note lands
   * before its state along the diagram's direction and a `right of` one
   * after it.
   */
  const noteLinkEdge = ({ state, note }: NotedState): DirectedGraphEdge => ({
    id: noteLinkEdgeId(state.id),
    from: isLeftOf(note) ? noteNodeId(state.id) : state.id,
    to: isLeftOf(note) ? state.id : noteNodeId(state.id),
    cornerRadius: CONNECTOR_CORNER_RADIUS,
  });

  // Where each note goes in the order the core is handed. Mermaid 12.2.0
  // adds a note's box and its link where the `note` statement is written
  // (`dataFetcher`, `stateDiagram-v2-MYRXERYP.mjs` line 1222); the model does
  // not keep that place, so each note is handed over as if it were written
  // right after the statement that first names its state — its box right
  // after the state, its link right after the first transition naming the
  // state, or after every transition when none does. Measured on the state
  // parity fixtures (nook decision `01M4VKTJ2A1DGXAMYVF16BK2W3`): handing
  // every link over after every transition instead mirrors
  // `state-long-labels` left to right.
  const notedById = new Map(notedStates.map((entry) => [entry.state.id, entry]));
  const linksAfter = new Map<string, NotedState[]>();
  const linksLast: NotedState[] = [];
  for (const entry of notedStates) {
    const first = model.transitions.find(
      (transition) => transition.from === entry.state.id || transition.to === entry.state.id,
    );
    if (first === undefined) linksLast.push(entry);
    else linksAfter.set(first.id, [...(linksAfter.get(first.id) ?? []), entry]);
  }

  const laidOut = layoutDirectedGraph({
    // The document's own direction — `TB` unless the author wrote a
    // `direction` outside every composite. A composite's own is a separate
    // thing and reaches the core per cluster below.
    direction: model.direction,
    // Every state in the order Mermaid 12.2.0 hands a state diagram to ELK:
    // its `dataFetcher` (`stateDiagram-v2-MYRXERYP.mjs`, line 1127) walks the
    // document statement by statement, adding each state where it is first
    // named — both ends of a transition in turn — and a composite's members
    // where its block is written, and each transition where it is written.
    // `StateModel.states` and `StateModel.transitions` are already in that
    // order, and the core keeps the order it is handed (`considerModelOrder`).
    nodes: model.states.flatMap((state) => {
      const entry = notedById.get(state.id);
      return entry === undefined ? [stateNode(state)] : [stateNode(state), noteNode(entry)];
    }),
    edges: [
      ...model.transitions.flatMap((transition) => [
        transitionEdge(transition),
        ...(linksAfter.get(transition.id) ?? []).map(noteLinkEdge),
      ]),
      ...linksLast.map(noteLinkEdge),
    ],
  });

  const boxById = new Map(laidOut.nodes.map((box) => [box.id, box]));
  const routeById = new Map(laidOut.edges.map((route) => [route.id, route]));

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
    // A composite's box is its frame, as the core placed it.
    const box = boxById.get(state.id)!;
    const plan = planById.get(state.id)!;
    return {
      id: state.id,
      kind: state.kind,
      stereotype: state.stereotype,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      // The plan measured everything from the box's own top edge, before
      // the core knew where the box would go; this is where that box
      // landed. A frame's title goes where the core put it across its
      // band — centred, or moved along it clear of the routes crossing it.
      labels: plan.labels.map((planned) => ({
        ...planned,
        y: box.y + planned.y,
        ...(box.title === undefined ? {} : { x: box.title.x }),
      })),
      style: styleByStateId.get(state.id) ?? { frame: [], text: [] },
      dividerY: plan.dividerY === null ? null : box.y + plan.dividerY,
      note: placeNote(state, wrappedNoteById, boxById, routeById),
    };
  });

  const transitions = model.transitions.map<PositionedStateTransition>((transition) => {
    const route = routeById.get(transition.id)!;
    return {
      id: transition.id,
      from: transition.from,
      to: transition.to,
      points: route.points,
      hops: route.hops,
      label:
        transition.label === null || route.labelAnchor === undefined
          ? null
          : {
              ...wrappedTransitionLabelById.get(transition.id)!,
              anchor: route.labelAnchor,
            },
    };
  });

  return {
    states,
    transitions,
    // The core's extent holds every box, frame, route and label it placed.
    width: laidOut.width,
    height: laidOut.height,
  };
}

/** A frame's title as the core keeps room for it: its labels stacked, as wide as the widest. */
function titleSize(plan: StateBoxPlan): { width: number; height: number } {
  return {
    width: Math.max(...plan.labels.map((planned) => planned.labelBox.width)),
    height: plan.labels.reduce((sum, planned) => sum + planned.labelBox.height, 0),
  };
}

/**
 * The direction the **level each state sits at** runs in — the one thing a
 * fork or join's bar is turned by.
 *
 * A level's direction is the `direction` statement written *at that level*
 * and nothing else: a composite that names none runs `TB` even under a
 * document-level `direction LR`. Measured (mermaid 11.17.2): a fork inside
 * such a composite comes back as the horizontal 70 × 10 bar, and the
 * composite's own members come back stacked in a column, so the level really
 * is top-to-bottom rather than merely drawn as if it were. Nothing cascades,
 * which is the rule `SirenSubgraph.direction` already follows for a
 * flowchart.
 *
 * The layout agrees: every frame goes to the core with that direction
 * (`NESTED_DIRECTION` when it names none), Mermaid 12.2.0's rule. Where a
 * transition voids it (the **Boundary-crossing edge**) the core lays the
 * level out in its parent's pass; the bar keeps the level's own figure,
 * because it is chosen from what the author wrote, as Mermaid chooses it.
 */
function levelDirections(model: StateModel): (state: ResolvedState) => Direction {
  // Every frame, not only every composite: a concurrent region is a level
  // too, and its own `direction` is the one a fork inside it is turned by.
  // Measured — `direction` written inside a divided block belongs to the
  // region it sits in and leaves the other regions top-to-bottom.
  const frameDirections = new Map(
    model.states
      .filter((state) => isFrame(state.kind))
      .map((state) => [state.id, state.direction] as const),
  );
  return (state) =>
    state.parentId === null
      ? // The document's own level, whose direction is the document's — `TB`
        // when the author named none, resolved in the parser.
        model.direction
      : // A frame's level, whose direction is that block's or region's own
        // statement. `??` covers both "it named none" and — defensively —
        // a parent no frame declares.
        (frameDirections.get(state.parentId) ?? "TB");
}

/**
 * One state's note where the shared core put it, or `null` when the state
 * carries none.
 *
 * Both the box and the connector come straight back out of the core: the
 * note was a node of the laid-out graph and the connector was an edge. The
 * one thing done here is the order: the route is **reordered to run from the
 * state to the note**, since the edge's own direction is the author's
 * `left of`/`right of` and a reader of `connector` should not have to ask
 * which spelling produced it — its line hops with it.
 */
function placeNote(
  state: ResolvedState,
  wrappedNoteById: ReadonlyMap<string, WrappedLabel>,
  boxById: ReadonlyMap<string, DirectedGraphNodeBox>,
  routeById: ReadonlyMap<string, DirectedGraphEdgeRoute>,
): PositionedStateNote | null {
  if (state.note === null) {
    return null;
  }

  const box = boxById.get(noteNodeId(state.id))!;
  const route = routeById.get(noteLinkEdgeId(state.id))!;
  const reversed = isLeftOf(state.note);

  return {
    ...wrappedNoteById.get(state.id)!,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    connector: reversed ? [...route.points].reverse() : route.points,
    // Renumbered along the reversed route, and in the order it meets them.
    connectorHops: reversed
      ? route.hops.map((hop) => ({ ...hop, segment: route.points.length - 2 - hop.segment })).reverse()
      : route.hops,
  };
}

/**
 * A state box measured but not yet placed: its size, and where each of its
 * labels is centred relative to its own top edge. Computed before the shared
 * core runs, because the core needs the size; translated into diagram
 * coordinates once the core has placed the box — the division
 * `layoutClassDiagram` already draws between planning a box and placing it.
 */
interface StateBoxPlan {
  width: number;
  height: number;
  labels: PositionedStateLabel[];
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
 * circle, so the box is square and holds no labels.
 */
function planStateBox(
  state: ResolvedState,
  levelDirection: Direction,
  options: LayoutOptions,
): StateBoxPlan {
  if (state.kind === "start" || state.kind === "end") {
    const size = PSEUDO_STATE_ARCHIV * 2;
    return { width: size, height: size, labels: [], dividerY: null };
  }

  // A concurrent region is a frame with **no title**: measured (mermaid
  // 11.17.2, `--markup`), a divider's group holds one `rect.divider` and no
  // label element at all. Its id is generated (`region:1`), so drawing it
  // would put a string the author never wrote on the picture — the same
  // reason a pseudo-state draws none.
  //
  // So the plan is padding and nothing else: the core keeps the ordinary
  // padding above its first member rather than a title band, and lays a
  // region holding nothing out as a box of its padding — an empty region is
  // a region (measured: two `--` in a row report three dividers, the middle
  // empty).
  if (state.kind === "region") {
    return {
      width: SUBGRAPH_PADDING * 2,
      height: SUBGRAPH_PADDING,
      labels: [],
      dividerY: null,
    };
  }

  // The id is a label of one plain run: it is `\w+`, so there is no tag in
  // it for `readLabel` to have read.
  const labels = state.descriptions.length === 0 ? [plainLabel(state.id)] : state.descriptions;

  // Asked *before* the stereotype, because a state can carry both and
  // Mermaid draws the frame: measured, `state X <<choice>>` followed by
  // `state X { A --> B }` comes back as a cluster holding `A` and `B`, not
  // as a diamond.
  if (state.kind === "composite") {
    return planTitleStrip(labels, options);
  }

  // A stereotyped state is sized from its figure and draws no text at all —
  // measured: Mermaid's `forkJoin` shape blanks the label outright, and none
  // of the three `<g>`s comes back with a label child. The id stays the
  // author's and stays what a transition names; it is simply not drawn, the
  // way a described state's id is not.
  if (state.stereotype !== null) {
    const box =
      state.stereotype === "choice"
        ? { width: CHOICE_ARCHIV * 2, height: CHOICE_ARCHIV * 2 }
        : forkBarBox(levelDirection);
    return { ...box, labels: [], dividerY: null };
  }

  const planned: PositionedStateLabel[] = [];
  let bottom = STATE_PADDING_Y;
  let dividerY: number | null = null;

  labels.forEach((label, index) => {
    // The divider closes the title label and opens the compartment the rest
    // of the descriptions share — the two-compartment shape a class box is
    // built from, with one label in the first compartment instead of one
    // name. Only a box with a second label has one: measured, a single
    // description is drawn as a plain rounded rect with no line in it,
    // however many rows its `<br>`s gave it — and a first description of
    // several rows keeps every one of them above the line (measured,
    // `--markup`: `s1 : a<br/>b` then `s1 : c<br>d` draws `line.divider`
    // between the two label groups, not inside the first).
    if (index === 1) {
      bottom += STATE_PADDING_Y;
      dividerY = bottom;
      bottom += STATE_PADDING_Y;
    }
    // Wrapped at the 14px it is drawn at: measured, mermaid 11.17.2 wraps a
    // state's description and its quoted name at 200px.
    const placed = placeLabel(wrapNodeLabel(label, options.measureText), bottom);
    planned.push(placed);
    bottom += placed.labelBox.height;
  });

  return {
    width: Math.max(...planned.map((placed) => placed.labelBox.width)) + STATE_PADDING_X * 2,
    height: bottom + STATE_PADDING_Y,
    labels: planned,
    dividerY,
  };
}

/**
 * A composite's plan: the strip its title is drawn in, measured from the
 * frame's own top edge, and the smallest frame that strip could sit in.
 *
 * **The plan's `height` is the strip, not the frame.** A frame's size comes
 * from what it holds, which the shared core decides; what is planned here is
 * the part that *is* known — padding, the title rows, padding again — which
 * is the band the core keeps across the frame's top for the title
 * (`titleSize`, with the same padding).
 *
 * No divider: the line under a described state's title label closes a
 * compartment, and a frame's title strip is not one — what is below it is
 * the members' own boxes.
 */
function planTitleStrip(labels: Label[], options: LayoutOptions): StateBoxPlan {
  const planned: PositionedStateLabel[] = [];
  let bottom = SUBGRAPH_PADDING;

  for (const label of labels) {
    // Never wrapped: measured, mermaid 11.17.2 draws a composite's title —
    // its quoted name, or the description `Outer : …` gives it — on one row
    // however long it is, as it does a flowchart subgraph's.
    const placed = placeLabel(wrapLabel(label, options.measureText, NO_WRAP), bottom);
    planned.push(placed);
    bottom += placed.labelBox.height;
  }

  return {
    width: Math.max(...planned.map((placed) => placed.labelBox.width)) + SUBGRAPH_PADDING * 2,
    height: bottom + SUBGRAPH_PADDING,
    labels: planned,
    dividerY: null,
  };
}

/**
 * A label, already wrapped (or not) and measured, placed with its top edge
 * at `top` — the step every stack of labels in a state's box repeats: the
 * caller moves `top` down by the label's height for the next one. The
 * placed label is the wrapped one, so the renderer draws the rows the box
 * was measured around.
 */
function placeLabel(wrapped: WrappedLabel, top: number): PositionedStateLabel {
  return { ...wrapped, y: top + wrapped.labelBox.height / 2 };
}
