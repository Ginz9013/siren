import type {
  GraphModel,
  LabelBox,
  LayoutOptions,
  NodeShape,
  Point,
  PositionedGraph,
  PositionedSubgraph,
  ResolvedSubgraph,
  TextMeasurer,
} from "../contracts";
import {
  clipRouteEndToBox,
  layoutDirectedGraph,
  type DirectedGraphLayoutNodeBox,
} from "./layoutDirectedGraph";
import { layoutLabel } from "../label/layoutLabel";

/** Gap between a subgraph's frame and the boxes and frames it encloses. */
const SUBGRAPH_PADDING = 12;

/**
 * How far a shape's outline leans in from the bounding box it is inscribed
 * in, **per side, as a fraction of the box's height** — the one number that
 * decides both how much box a label needs (`boxForLabel`, here) and where
 * the outline's corners go (`renderToSVG`'s path builders).
 *
 * Exported, and imported by the renderer, because those two are one
 * contract and not two: layout enlarges the box so the label fits inside
 * the inscribed outline, and the renderer draws the outline that box was
 * sized for. Two constants that agreed today would be free to drift, and
 * the symptom would be a label crossing its own frame — silently, in the
 * picture only. `index.test.ts` checks the contract end to end by testing
 * the label's corners against the drawn path, so a drift fails a test
 * rather than a diagram.
 *
 * `lean` means a different thing to each outline and the same number does
 * for all of them: a hexagon's end inset, a parallelogram's slant, a
 * trapezoid's inset per side, the asymmetric flag's notch depth, a round
 * node's and a stadium's corner radius, a subroutine's bar inset. What they
 * share is that each displaces exactly `lean x height` horizontally at the
 * height where a centred label meets it.
 *
 * Three of those are drawn with a `<rect>` rather than a `<path>`, and
 * belong here for exactly the same reason the others do: the renderer reads
 * these numbers as the radius it writes and the inset it places the bars
 * at, so the box layout reserves and the figure drawn stay one decision.
 *
 * **The last two displace vertically instead, and are the same contract.**
 * A double circle's `lean` is the gap between its two rings, and a
 * cylinder's is the vertical semi-axis of the ellipse its lid and its
 * bottom bulge are halves of — in both, a fraction of the box's height that
 * layout makes room for and the renderer draws with. `circle` is absent
 * because it leans nowhere: its outline touches all four edges of its box,
 * and the whole of its sizing is the label's diagonal (`boxForLabel`).
 *
 * **A stadium's `1/2` is not a proportion anyone chose.** Its ends are
 * semicircles or it is not a stadium, so its radius is half the height by
 * definition; the other two are Siren's own (the board's decision 1), and
 * the pair of them is what keeps three rectangles telling apart: a round
 * node's corner is half a stadium's, and a subroutine's bars are a slim
 * eighth so that they read as a marking on a box rather than as a third
 * shape.
 */
export const SHAPE_LEAN = {
  hexagon: 1 / 4,
  parallelogram: 1 / 2,
  "parallelogram-alt": 1 / 2,
  trapezoid: 1 / 2,
  "trapezoid-alt": 1 / 2,
  asymmetric: 1 / 4,
  round: 1 / 4,
  stadium: 1 / 2,
  subroutine: 1 / 8,
  "double-circle": 1 / 16,
  cylinder: 1 / 8,
} as const satisfies Partial<Record<NodeShape, number>>;

/** A measured label, and the bounding box a shape needs to hold one. */
interface Box {
  width: number;
  height: number;
}

/**
 * How much bounding box `shape` needs so that a `label`-sized text box fits
 * **inside the drawn outline**, rather than inside the box that outline is
 * inscribed in.
 *
 * This is the whole reason node shapes are not a renderer-only change, and
 * the one answer every shape after the diamond inherits. A rectangle *is*
 * its bounding box, so a rectangle can take the measured label unchanged;
 * every other shape is inscribed in that box and therefore cuts corners off
 * it. A diamond that circumscribed its text box the way a rectangle does
 * would cross its own label on all four diagonals.
 *
 * **The rule: the smallest box in which this shape, inscribed, still
 * contains the measured label — keeping the label's own proportions.** It is
 * a function of the label rather than a constant added to it, so a
 * one-character node stays small and a long one grows, and it is expressible
 * for every shape on the board: a hexagon's slanted ends and a circle's
 * diameter are the same question asked of a different outline.
 *
 * For a rhombus the arithmetic is exact. A diamond inscribed in `W x H` is
 * the set `|x| / (W/2) + |y| / (H/2) <= 1` about the centre, so a centred
 * `w x h` label fits exactly when `w/W + h/H <= 1`; at `W = 2w, H = 2h` that
 * sum is 1 and the label's corners lie **on** the outline. That is the
 * minimum, and it is enough because what was measured is the glyphs plus the
 * theme's padding — the corners that touch belong to the padding, not to the
 * text.
 *
 * Every shape whose outline is straight lines leaning in from the box —
 * the hexagon, both parallelograms, both trapezoids and the asymmetric
 * flag — has the same answer with a different constant, and `SHAPE_LEAN`
 * is that constant. In each of them the box need be no taller than the
 * label, and the outline has displaced `lean x H` horizontally by the time
 * it reaches the label's own edge:
 *
 * - A hexagon at `H = h` meets the label along its own flat top, which is
 *   the box inset by `m = lean x H` at each end.
 * - A parallelogram's leaning side displaces `s = lean x H` over the full
 *   height, so at the label's top edge it has displaced `s(1 + h/H)/2` —
 *   which is `s` exactly when `H = h`. A trapezoid is that on both sides at
 *   once, at its narrow edge.
 * - The asymmetric flag's notch is deepest, `d = lean x H`, at mid-height,
 *   which is where a centred label is widest.
 *
 * So all six read `W = w + 2 x lean x h, H = h`, and none of them needs a
 * per-shape formula in the switch below.
 *
 * The three shapes drawn with a `<rect>` join them, which is worth stating
 * because nothing about them is slanted:
 *
 * - A stadium's end is a semicircle of radius `H/2`, and at `H = h` the
 *   label's top corners lie on the box's top edge — the one height at which
 *   a semicircle has bulged out no distance at all. So the whole of each
 *   end lies outside the label: `lean = 1/2`.
 * - A round node is the same figure with a smaller radius `r`: the corner
 *   starts `r` in from each end, so `lean = r/H = 1/4`.
 * - A subroutine's label goes *between* its two inner bars, each inset
 *   `lean x H` from its own end, so `lean = 1/8` is that inset.
 *
 * The proportions are Siren's, not Mermaid's: the board's decision 1 says a
 * shape's *kind* is the compatibility contract and its geometry belongs to
 * the theme, exactly as ADR-0004 already says for colour and spacing. These
 * happen to agree with Mermaid 11.17.2's, measured off its rendered
 * polygons with `scripts/mermaid-probe.mjs` and the shape sources beside
 * it.
 */
function boxForLabel(shape: NodeShape, label: Box): Box {
  switch (shape) {
    case "rhombus":
      return { width: label.width * 2, height: label.height * 2 };
    case "cylinder":
      // The only shape here that grows in **height**. Its sides are
      // straight, so the label needs no extra width; its top and bottom are
      // ellipses of vertical semi-axis `r = lean x H`, and the lid — a
      // whole ellipse drawn inside the top edge — reaches `2r` down.
      //
      // `4r`, not `3r`, because the label is **centred**: the room a
      // cylinder leaves runs from `2r` to `H - r`, which is not centred on
      // the box, while the renderer puts every node's text on `H/2`. So the
      // lid's `2r` is what the box has to clear on both sides of centre,
      // and the bulge is then clear by a margin rather than tight. Sizing
      // to the uncentred band would put the label's top edge through the
      // lid — the exact failure this function exists to prevent.
      return {
        width: label.width,
        height: label.height / (1 - 4 * SHAPE_LEAN.cylinder),
      };
    case "double-circle": {
      // Two rings, and the label belongs inside the **inner** one: a box
      // sized for the outer circle would draw the inner ring through the
      // text. So the inner circle takes the diameter a plain circle would
      // have, and the box is that plus the ring gap on each side.
      //
      // The gap is a fraction of the box rather than a constant, for the
      // same reason every other number here is: a one-character double
      // circle stays small and still reads as two rings.
      const gap = SHAPE_LEAN["double-circle"];
      const diameter = Math.hypot(label.width, label.height) / (1 - 2 * gap);
      return { width: diameter, height: diameter };
    }
    case "circle": {
      // A circle is only a circle in a square box, so both axes take the
      // same number, and the smallest circle containing the centred label
      // is the one whose diameter is the label's **diagonal** — every
      // corner of the label then lies on the outline, exactly as a
      // rhombus's corners do.
      //
      // This is the shape where fitting inside costs the most, and the
      // cost is not hidden: a wide label makes a very large node, because
      // the diameter is driven by a width the height never needed. It is
      // not capped. A cap is a circle that clips its own label, which is
      // the one failure this whole function exists to prevent, and the
      // board's decision 1 makes a shape's kind the contract — an author
      // who wants the box a rectangle would have gets it by writing
      // `A(text)`.
      const diameter = Math.hypot(label.width, label.height);
      return { width: diameter, height: diameter };
    }
    case "hexagon":
    case "parallelogram":
    case "parallelogram-alt":
    case "trapezoid":
    case "trapezoid-alt":
    case "asymmetric":
    case "round":
    case "stadium":
    case "subroutine":
      return {
        width: label.width + 2 * SHAPE_LEAN[shape] * label.height,
        height: label.height,
      };
    default:
      // A rectangle is its own bounding box, and with the three curved
      // shapes it is the only member of `NodeShape` left here: every one of
      // Mermaid's fourteen bracket spellings now has a case above. The
      // default stays a default rather than an exhaustive `rect` case
      // because a rectangle taking its label unchanged is the base the
      // whole rule is stated against, not a shape's own arithmetic.
      return label;
  }
}

/**
 * Computes node positions and edge paths for a resolved `GraphModel`.
 *
 * This is the flowchart adapter over `layoutDirectedGraph`: it measures each
 * node's label, asks the node's shape how much bounding box that label needs
 * (`boxForLabel`), hands the resulting sizes to the shared layout core, and
 * reattaches the flowchart's own data (labels, shapes, the resolved timeline)
 * to the coordinates that come back. All graph-layout math — and the only
 * dependency on the layout engine — lives in the shared core.
 *
 * `PositionedNode.x/y` are the top-left corner of the node's bounding box,
 * as the core returns them, so renderer code can place a `<rect>` directly.
 */
export function layoutGraph(
  graph: GraphModel,
  options: LayoutOptions,
): PositionedGraph {
  // Each label measured once, here, and carried to the renderer on the
  // positioned node: the shape is sized around this box, and the rows are
  // drawn where it says they sit. The renderer has no measurer, so a second
  // opinion there was never an option.
  const labelBoxById = new Map(
    graph.nodes.map((node) => [node.id, layoutLabel(node.label, options.measureText)]),
  );

  // A subgraph's title is measured once too, for the same two readers: the
  // cluster size handed to the core below, and the frame grown afterwards.
  const titleBoxById = new Map(
    graph.subgraphs.map((subgraph) => [subgraph.id, layoutLabel(subgraph.label, options.measureText)]),
  );

  const edgeLabelBoxById = new Map(
    graph.edges.flatMap((edge) =>
      edge.label === null ? [] : [[edge.id, layoutLabel(edge.label, options.measureText)] as const],
    ),
  );

  const laidOut = layoutDirectedGraph({
    rankdir: graph.direction,
    nodes: [
      ...graph.nodes.map((node) => ({
        id: node.id,
        // The shape decides how much box the measured label needs; the
        // shared layout core is handed sizes and never learns a shape
        // exists.
        ...boxForLabel(node.shape, labelBoxById.get(node.id)!),
        // Grouping, and the only thing about a subgraph the shared core is
        // told. `undefined` rather than `null` when the node is in no
        // subgraph, because the core switches dagre's compound mode on by
        // the *presence* of parentage — a field written as `null` would
        // count.
        ...(node.parentId === null ? {} : { parentId: node.parentId }),
      })),
      // One cluster per subgraph — the machinery `layoutClassDiagram` has
      // driven since the class board, reached by declaring a node a frame
      // rather than by anything new here. `layoutDirectedGraph` needed no
      // change at all, nesting included.
      //
      // **The ids cannot collide with a node's, and not because they are
      // prefixed here.** `layoutClassDiagram` has to prefix a namespace's
      // (`namespace:${id}`) because a namespace carries the author's own
      // word for it, and a class may be called the same thing. A subgraph's
      // id is *generated* — `subgraph:1`, per ADR-0010 — and a node id is
      // `\w+` by the parser's grammar, which cannot contain a colon. So the
      // guard is already discharged one stage earlier, in the stronger form:
      // unconstructible rather than avoided. Prefixing again would only
      // produce `subgraph:subgraph:1`.
      ...graph.subgraphs.map((subgraph) => {
        // The core sizes a cluster from its children and ignores what it is
        // given here; the title's own size is passed anyway, as the smallest
        // the frame could sensibly be — and as what a childless subgraph,
        // which the core lays out as an ordinary box, is drawn at.
        const label = titleBoxById.get(subgraph.id)!;
        return {
          id: subgraph.id,
          isCluster: true,
          width: label.width + SUBGRAPH_PADDING * 2,
          height: label.height + SUBGRAPH_PADDING * 2,
          ...(subgraph.parentId === null ? {} : { parentId: subgraph.parentId }),
          // The subgraph's own `direction LR` (or `TB`/`BT`/`RL`), reaching
          // dagre's `recursiveClusterLayout` through the one field it reads
          // per cluster. `undefined` rather than `null` when the author
          // wrote none, matching `parentId`'s own convention just above —
          // the shared core switches this behavior on by the field's
          // *presence*, so a subgraph that named no direction lays out along
          // the outer graph's, exactly as before this field existed.
          ...(subgraph.direction === null ? {} : { rankdir: subgraph.direction }),
        };
      }),
    ],
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      // The one part of an arrow token that reaches layout rather than the
      // renderer: `A ----> B` puts B further down the rank order, so it is
      // a rank constraint and not a proportion. Mermaid does exactly this —
      // it hands its parsed `length` to dagre as `minlen`, measured — and
      // drawing every length alike would be a silent mis-render by the
      // compatibility corpus's own definition.
      minlen: edge.minLength,
      // The other part that reaches layout rather than the renderer, and a
      // port rather than new machinery: the shared core has taken an edge
      // label's size and returned where it put it since the class board,
      // and `layoutClassDiagram` passes a relationship's label through this
      // very field. What was missing was only that a flowchart edge had no
      // label to pass.
      //
      // Measured with `options.measureText`, the one measurer every other
      // piece of text in this pipeline goes through, so a long label
      // reserves more room than a short one for the same reason a long node
      // label makes a wider box.
      ...(edge.label === null ? {} : { label: edgeLabelBoxById.get(edge.id)! }),
    })),
  });

  // Boxes as the shared core placed them, in *core* coordinates. The frames
  // below are grown in this space and can reach outside it; the translation
  // that follows is what moves everything into the space the diagram is
  // finally described in. `layoutClassDiagram` does exactly this, for
  // exactly this reason.
  const boxInCoreSpaceById = new Map(laidOut.nodes.map((box) => [box.id, box]));
  const frames = subgraphFrames(graph.subgraphs, graph.nodes, boxInCoreSpaceById, titleBoxById);

  // A frame grows outward — up for its title strip, out for its padding — so
  // it can reach above and left of the corner the core laid the graph out
  // from. Everything is shifted by however far it did, rather than a frame
  // being drawn at a negative coordinate, which is off the canvas.
  //
  // `Math.max(0, ...)` over an empty list is `0`, so a document with no
  // subgraph shifts by nothing and every coordinate below is the core's own
  // number untouched.
  const shift = {
    x: Math.max(0, ...frames.map((frame) => -frame.x)),
    y: Math.max(0, ...frames.map((frame) => -frame.y)),
  };
  const shifted = (point: Point): Point => ({ x: point.x + shift.x, y: point.y + shift.y });

  const routeById = new Map(laidOut.edges.map((route) => [route.id, route]));

  const nodes = graph.nodes.map((node) => {
    const box = boxInCoreSpaceById.get(node.id)!;
    return {
      ...node,
      ...shifted(box),
      width: box.width,
      height: box.height,
      labelBox: labelBoxById.get(node.id)!,
    };
  });

  // Edges whose endpoints are frames rather than boxes, re-clipped to the
  // frame this module drew.
  //
  // The shared core already clipped such an edge to the *cluster box* it
  // placed, which is the honest answer in its own coordinates — but a frame
  // is grown outward from that box, by `SUBGRAPH_PADDING` all round and a
  // title strip along the top (`subgraphFrames`, below). An arrowhead left
  // where the core put it would therefore land inside the frame by exactly
  // the height of the title strip. Growing the frame is this module's
  // decision, so paying for it is too — with the core's own clipper, so that
  // "on the boundary" means one thing in both spaces.
  const frameById = new Map(frames.map((frame) => [frame.id, frame]));

  const edges = graph.edges.map((edge) => {
    const route = routeById.get(edge.id)!;

    let points = route.points;
    const fromFrame = frameById.get(edge.from);
    if (fromFrame !== undefined) {
      points = clipRouteEndToBox(points, fromFrame, "start");
    }
    const toFrame = frameById.get(edge.to);
    if (toFrame !== undefined) {
      points = clipRouteEndToBox(points, toFrame, "end");
    }

    return {
      ...edge,
      points: points.map(shifted),
      // `null` rather than absent, matching the label it belongs to: an
      // edge that asked for no space has nowhere to draw text, and one
      // state is easier to read than a missing field.
      labelAnchor: route.labelAnchor === undefined ? null : shifted(route.labelAnchor),
      labelBox: edgeLabelBoxById.get(edge.id) ?? null,
    };
  });

  const subgraphs = frames.map((frame) => ({
    ...frame,
    ...shifted(frame),
    labelAnchor: shifted(frame.labelAnchor),
  }));

  return {
    direction: graph.direction,
    nodes,
    edges,
    subgraphs,
    accTitle: graph.accTitle,
    accDescr: graph.accDescr,
    timeline: graph.timeline,
    // The core reports the extent of the graph *it* placed, which never
    // included the title strip a frame grows upward for. Taking the larger
    // of the two keeps a frame from being clipped by the `<svg>` it is drawn
    // in — and with no subgraphs the second term is `0`, so the core's own
    // numbers come through unchanged.
    width: Math.max(laidOut.width + shift.x, ...subgraphs.map((s) => s.x + s.width)),
    height: Math.max(laidOut.height + shift.y, ...subgraphs.map((s) => s.y + s.height)),
  };
}

/**
 * Each subgraph's frame, in the shared core's own coordinate space.
 *
 * A frame is grown from the cluster box the core placed until it clears every
 * box it holds by `SUBGRAPH_PADDING` and has a strip along its top for its
 * own title. That is `layoutClassDiagram`'s `namespaceFrame`, ported.
 *
 * **Taking the union with what the frame holds is required, not merely
 * conservative, and it is the load-bearing half of this function.** The
 * obvious reading — the core already sized the cluster to hold its children,
 * so the members only ever widen the frame by the padding and the title strip
 * — is false for a `subgraph` nested inside one that declared a `direction`.
 * There the core hands the inner cluster back at *exactly the size it was
 * given*, never having sized it at all, with its members at coordinates
 * outside it (measured; see `isCluster` in `layoutDirectedGraph.ts` for the
 * table and `layoutDirectedGraph.test.ts` for the test that pins it). Drop
 * the member boxes out of the four `Math.min`/`Math.max` calls below as
 * redundant and that document draws the inner `subgraph` at the size of its
 * own title bar — the `label.width + SUBGRAPH_PADDING * 2` this module hands
 * in — with every node it holds spilled outside it. The cluster box is a hint
 * about where the frame goes, not a statement of what it encloses.
 *
 * **What is not ported is the nesting**, because a class diagram has none. A
 * frame must clear the whole of each frame *beneath* it — title strip
 * included, since that strip is the part that reaches highest — so the frames
 * are grown innermost first and each parent then grows around the children
 * already grown. The model lists subgraphs in pre-order, so walking it
 * backwards visits every child before its parent.
 */
function subgraphFrames(
  subgraphs: readonly ResolvedSubgraph[],
  nodes: GraphModel["nodes"],
  boxInCoreSpaceById: ReadonlyMap<string, DirectedGraphLayoutNodeBox>,
  titleBoxById: ReadonlyMap<string, LabelBox>,
): PositionedSubgraph[] {
  const nodeIdsByParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId !== null) {
      nodeIdsByParent.set(node.parentId, [...(nodeIdsByParent.get(node.parentId) ?? []), node.id]);
    }
  }

  const frameById = new Map<string, PositionedSubgraph>();

  for (const subgraph of [...subgraphs].reverse()) {
    const label = titleBoxById.get(subgraph.id)!;
    const cluster = boxInCoreSpaceById.get(subgraph.id)!;

    const held: { x: number; y: number; width: number; height: number }[] = [
      ...(nodeIdsByParent.get(subgraph.id) ?? []).map((id) => boxInCoreSpaceById.get(id)!),
      ...subgraphs
        .filter((child) => child.parentId === subgraph.id)
        .map((child) => frameById.get(child.id)!),
    ];

    const left = Math.min(cluster.x, ...held.map((box) => box.x - SUBGRAPH_PADDING));
    const top = Math.min(
      cluster.y,
      // The title strip: padding, the title's rows, then padding again before
      // whatever the frame holds starts.
      ...held.map((box) => box.y - SUBGRAPH_PADDING * 2 - label.height),
    );
    const right = Math.max(
      cluster.x + cluster.width,
      left + label.width + SUBGRAPH_PADDING * 2,
      ...held.map((box) => box.x + box.width + SUBGRAPH_PADDING),
    );
    const bottom = Math.max(
      cluster.y + cluster.height,
      ...held.map((box) => box.y + box.height + SUBGRAPH_PADDING),
    );

    frameById.set(subgraph.id, {
      id: subgraph.id,
      label: subgraph.label,
      labelBox: label,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      labelAnchor: {
        x: (left + right) / 2,
        y: top + SUBGRAPH_PADDING + label.height / 2,
      },
    });
  }

  // Back into the model's own order — outermost first, which is the order
  // they are drawn in so that an inner frame is painted over its parent.
  return subgraphs.map((subgraph) => frameById.get(subgraph.id)!);
}
