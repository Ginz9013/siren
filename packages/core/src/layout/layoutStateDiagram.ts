import type {
  Direction,
  Label,
  LabelBox,
  LayoutOptions,
  Point,
  PositionedState,
  PositionedStateDiagram,
  PositionedStateNote,
  PositionedStateLabel,
  PositionedStateTransition,
  ResolvedState,
  StateModel,
} from "../contracts";
import {
  clipRouteEndToBox,
  layoutDirectedGraph,
  type DirectedGraphLayoutNodeBox,
} from "./layoutDirectedGraph";
import { plainLabel } from "../label/label";
import { layoutLabel } from "../label/layoutLabel";

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
const PSEUDO_STATE_RADIUS = 7;

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
const CHOICE_RADIUS = 14;

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
 * Whether this kind of state is drawn as a **frame** — a box grown around
 * whatever names it as a parent — rather than as a figure of its own size.
 *
 * Two kinds are, for the same structural reason and with two different
 * figures: a composite is the titled frame `state Outer {` opens, and a
 * concurrent region is the untitled one a `--` divides that block into.
 * Everything that grows, shifts, clips to or nests a frame asks this rather
 * than naming `"composite"`, so a second frame kind could not be half
 * added.
 */
const isFrame = (kind: ResolvedState["kind"]): boolean =>
  kind === "composite" || kind === "region";

/** Horizontal padding between a note box's edge and its text. */
const NOTE_PADDING_X = 10;
/** Vertical padding between a note box's edge and its text. */
const NOTE_PADDING_Y = 8;

/**
 * The id a state's note is known by inside the shared layout core, and the
 * id of the edge joining the two.
 *
 * Prefixed away from everything a document can spell, the way
 * `layoutClassDiagram`'s `note:`/`note-link:` ids are: an authored state id
 * is `\w+` and cannot contain a colon, and a generated pseudo-state id is
 * `start:1`, so neither can collide with these. A state carries **at most
 * one** note (measured — a second one replaces the first), so the state's own
 * id is enough to name both without a counter.
 */
const noteNodeId = (stateId: string): string => `note:${stateId}`;
const noteLinkEdgeId = (stateId: string): string => `note-link:${stateId}`;

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
  const levelDirectionOf = levelDirections(model);
  const planById = new Map(
    model.states.map(
      (state) =>
        [state.id, planStateBox(state, levelDirectionOf(state), options)] as const,
    ),
  );

  /**
   * The states carrying a note, each with the note itself and the box
   * `layoutLabel` measured for its label — narrowed and measured here once
   * so that the three places below that add a node, add an edge and read
   * the result back all work from the same list, and the box the note was
   * sized around is the one it is drawn with.
   */
  const notedStates = model.states.flatMap((state) =>
    state.note === null
      ? []
      : [
          {
            state,
            note: state.note,
            labelBox: layoutLabel(state.note.label, options.measureText),
          },
        ],
  );
  const noteLabelBoxById = new Map(notedStates.map(({ state, labelBox }) => [state.id, labelBox]));

  /**
   * Each labelled transition's label as `layoutLabel` measured it, by the
   * transition's id — measured once, so the box the core keeps clear and the
   * box the renderer draws in are the same box.
   */
  const transitionLabelBoxById = new Map(
    model.transitions.flatMap((transition) =>
      transition.label === null
        ? []
        : [[transition.id, layoutLabel(transition.label, options.measureText)] as const],
    ),
  );

  const laidOut = layoutDirectedGraph({
    // The document's own rank direction — `TB` unless the author wrote a
    // `direction` outside every composite, which is the default measured
    // against mermaid 11.17.2. A *composite's* own direction is a separate
    // thing and reaches dagre per cluster below; measured, the two are
    // independent, so neither overrides the other.
    rankdir: model.direction,
    nodes: [
      ...model.states.map((state) => {
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
          ...(isFrame(state.kind) ? { isCluster: true } : {}),
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
      // A note is a box the layout places like any other, which is what
      // keeps it from landing on top of a state — the same answer
      // `layoutClassDiagram` gives a class note, and the same one Mermaid
      // gives this note (measured: it inserts the note into its own graph as
      // a node and lets the layout engine place it).
      //
      // It joins the **level its state is written at**, so a note on a state
      // inside a composite is laid out inside that composite's cluster and
      // ends up inside the frame drawn for it, rather than floating outside
      // the block whose state it annotates.
      ...notedStates.map(({ state, labelBox }) => ({
        id: noteNodeId(state.id),
        width: labelBox.width + NOTE_PADDING_X * 2,
        height: labelBox.height + NOTE_PADDING_Y * 2,
        ...(state.parentId === null ? {} : { parentId: state.parentId }),
      })),
    ],
    edges: [
      ...model.transitions.map((transition) => ({
        id: transition.id,
        from: transition.from,
        to: transition.to,
        // A labelled transition asks the core to keep its ranks far enough
        // apart for the text, and reports back where that space ended up.
        ...(transition.label === null
          ? {}
          : { label: transitionLabelBoxById.get(transition.id)! }),
      })),
      // The edge that puts the note beside the state it annotates, and whose
      // route is the note's connector. It is never drawn as a transition:
      // measured, Mermaid builds this one with `arrowhead: "none"`, which is
      // what keeps it from reading as a transition into the note.
      //
      // **The side the author named is spent here, as this edge's
      // direction** — measured from Mermaid's own construction, which is the
      // only place the two spellings differ: `right of` runs state → note and
      // `left of` runs note → state, and the rank order that falls out of
      // that is the whole of what `left`/`right` mean. So a `left of` note
      // lands *before* its state along the diagram's direction and a
      // `right of` one *after* it, which is left and right under `direction
      // LR` and above and below under the default `TB` — Mermaid's behaviour
      // exactly, because it is Mermaid's mechanism.
      ...notedStates.map(({ state, note }) => ({
        id: noteLinkEdgeId(state.id),
        from: note.position === "left of" ? noteNodeId(state.id) : state.id,
        to: note.position === "left of" ? state.id : noteNodeId(state.id),
      })),
    ],
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
      stereotype: state.stereotype,
      x: placed.x,
      y: placed.y,
      width: box.width,
      height: box.height,
      // The plan measured everything from the box's own top edge, before
      // the core knew where the box would go; this is where that box
      // landed.
      labels: plan.labels.map((planned) => ({ ...planned, y: placed.y + planned.y })),
      style: styleByStateId.get(state.id) ?? { frame: [], text: [] },
      dividerY: plan.dividerY === null ? null : placed.y + plan.dividerY,
      note: placeNote(state, noteLabelBoxById, boxById, routeById, frameById, shifted),
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
      label:
        transition.label === null || route.labelAnchor === undefined
          ? null
          : {
              label: transition.label,
              labelBox: transitionLabelBoxById.get(transition.id)!,
              anchor: shifted(route.labelAnchor),
            },
    };
  });

  const bounds = diagramBounds(states, transitions);

  return {
    states,
    transitions,
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
 * **Mermaid lays that one level out differently from Siren's shared core**,
 * which gives a cluster carrying no `rankdir` the graph's own (see
 * `rankdirFor` in `layoutDirectedGraph.ts`). This function answers what
 * *Mermaid* means, because it is choosing a figure and the figure is what
 * compatibility is owed; the ranks around it are the core's business and
 * that disagreement is the core's to settle.
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
 * note was a node of the laid-out graph and the connector was an edge, so
 * neither is computed here — what is done here is the two things the core
 * cannot know about. The route is **reordered to run from the state to the
 * note**, since the edge's own direction is the author's `left of`/`right of`
 * and a reader of `connector` should not have to ask which spelling produced
 * it; and a route ending on a *composite* is re-clipped to that composite's
 * grown frame, exactly as a transition naming one is, because the frame is
 * this module's own growth and the core clipped to the cluster box inside it.
 */
function placeNote(
  state: ResolvedState,
  noteLabelBoxById: ReadonlyMap<string, LabelBox>,
  boxById: ReadonlyMap<string, DirectedGraphLayoutNodeBox>,
  routeById: ReadonlyMap<string, { points: Point[] }>,
  frameById: ReadonlyMap<string, DirectedGraphLayoutNodeBox>,
  shifted: (point: Point) => Point,
): PositionedStateNote | null {
  if (state.note === null) {
    return null;
  }

  const box = boxById.get(noteNodeId(state.id))!;
  const placed = shifted(box);

  // The edge runs state → note for `right of` and note → state for
  // `left of`; the connector is always reported the first way round.
  const routed = routeById.get(noteLinkEdgeId(state.id))!.points;
  const stateEnd = state.note.position === "left of" ? "end" : "start";
  const frame = frameById.get(state.id);
  const clipped = frame === undefined ? routed : clipRouteEndToBox(routed, frame, stateEnd);
  const fromState = state.note.position === "left of" ? [...clipped].reverse() : clipped;

  return {
    label: state.note.label,
    labelBox: noteLabelBoxById.get(state.id)!,
    x: placed.x,
    y: placed.y,
    width: box.width,
    height: box.height,
    connector: fromState.map(shifted),
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
    // padding again before whatever the frame holds starts. A region has no
    // title, so its plan is one padding and the clearance above its first
    // member is the ordinary padding rather than a strip.
    const strip = plan.height;

    const held = (memberIdsByParent.get(id) ?? []).flatMap((memberId) => {
      const member = stateById.get(memberId)!;
      return [
        isFrame(member.kind) ? frameOf(memberId) : boxById.get(memberId)!,
        // A member's **note** is held by this frame too: it was laid out at
        // the same level and is drawn inside the block, so a frame grown
        // from the state boxes alone leaves it hanging outside the figure
        // that holds the state it annotates.
        ...(member.note === null ? [] : [boxById.get(noteNodeId(memberId))!]),
      ];
    });

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
    if (isFrame(state.kind)) {
      frameOf(state.id);
    }
  }

  return frameById;
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
    const size = PSEUDO_STATE_RADIUS * 2;
    return { width: size, height: size, labels: [], dividerY: null };
  }

  // A concurrent region is a frame with **no title**: measured (mermaid
  // 11.17.2, `--markup`), a divider's group holds one `rect.divider` and no
  // label element at all. Its id is generated (`region:1`), so drawing it
  // would put a string the author never wrote on the picture — the same
  // reason a pseudo-state draws none.
  //
  // So the plan is padding and nothing else. That number doubles as the
  // clearance `compositeFrames` leaves above the first member, which for a
  // region is the ordinary padding rather than a strip, and as the box a
  // region holding nothing is drawn at — an empty region is a region
  // (measured: two `--` in a row report three dividers, the middle empty).
  if (state.kind === "region") {
    return {
      width: COMPOSITE_PADDING * 2,
      height: COMPOSITE_PADDING,
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
        ? { width: CHOICE_RADIUS * 2, height: CHOICE_RADIUS * 2 }
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
    const placed = placeLabel(label, bottom, options);
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
 * **The plan's `height` is the strip, not the frame.** A frame's height
 * comes from what it holds, which is not known until the shared core has
 * placed those members, so what is planned here is the part that *is* known:
 * padding, the title rows, padding again, which is what `compositeFrames`
 * then leaves clear above the first member. It doubles as the box a
 * composite holding nothing is drawn at, since the core lays a childless
 * cluster out as an ordinary node.
 *
 * No divider: the line under a described state's title label closes a
 * compartment, and a frame's title strip is not one — what is below it is
 * the members' own boxes.
 */
function planTitleStrip(labels: Label[], options: LayoutOptions): StateBoxPlan {
  const planned: PositionedStateLabel[] = [];
  let bottom = COMPOSITE_PADDING;

  for (const label of labels) {
    const placed = placeLabel(label, bottom, options);
    planned.push(placed);
    bottom += placed.labelBox.height;
  }

  return {
    width: Math.max(...planned.map((placed) => placed.labelBox.width)) + COMPOSITE_PADDING * 2,
    height: bottom + COMPOSITE_PADDING,
    labels: planned,
    dividerY: null,
  };
}

/**
 * `label` measured and placed with its top edge at `top` — the step every
 * stack of labels in a state's box repeats: the caller moves `top` down by
 * the label's height for the next one.
 */
function placeLabel(label: Label, top: number, options: LayoutOptions): PositionedStateLabel {
  const labelBox = layoutLabel(label, options.measureText);
  return { label, labelBox, y: top + labelBox.height / 2 };
}

/**
 * The extent every drawn thing fits inside: state boxes, transition paths,
 * and the text anchored along them — each label at the box layout already
 * measured for it, so nothing here asks the measurer again.
 */
function diagramBounds(
  states: PositionedState[],
  transitions: PositionedStateTransition[],
): { width: number; height: number } {
  let right = 0;
  let bottom = 0;

  const cover = (x: number, y: number) => {
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  };

  for (const state of states) {
    cover(state.x + state.width, state.y + state.height);
    // A note is a figure of its own, and its connector a routed line of its
    // own: neither is inside the state's box, so neither is covered by it.
    if (state.note !== null) {
      cover(state.note.x + state.note.width, state.note.y + state.note.height);
      for (const point of state.note.connector) cover(point.x, point.y);
    }
  }

  for (const transition of transitions) {
    for (const point of transition.points) cover(point.x, point.y);
    if (transition.label !== null) {
      cover(
        transition.label.anchor.x + transition.label.labelBox.width / 2,
        transition.label.anchor.y + transition.label.labelBox.height / 2,
      );
    }
  }

  return { width: right, height: bottom };
}
