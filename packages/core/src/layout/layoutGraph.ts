import type {
  GraphModel,
  LayoutOptions,
  NodeShape,
  PositionedGraph,
  PositionedSubgraph,
} from "../contracts";
import { type Curve, curveCornerRadius, FLOWCHART_DEFAULT_CURVE } from "../curve/curve";
import { layoutDirectedGraph } from "./layoutDirectedGraph";
import { clusterNode, measureTitles, mermaidClosingOrder, placedFrame, SUBGRAPH_PADDING } from "./clusters";
import { wrapConnectorLabel, wrapNodeLabel } from "../label/wrapLabel";
import { BASE_FONT_SIZE_PX } from "../label/label";
import { LINE_HEIGHT_RATIO } from "../label/layoutLabel";

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

/** The core's `cornerRadius` for an edge drawn with `curve`: present only where the curve rounds its corners. */
function cornerRadiusOf(curve: Curve): { cornerRadius?: number } {
  const cornerRadius = curveCornerRadius(curve);
  return cornerRadius === undefined ? {} : { cornerRadius };
}

/**
 * Computes node positions and edge paths for a resolved `GraphModel`.
 *
 * This is the flowchart adapter over `layoutDirectedGraph`: it measures each
 * node's label, asks the node's shape how much bounding box that label needs
 * (`boxForLabel`), hands the resulting sizes to the shared layout core, and
 * reattaches the flowchart's own data (labels, shapes) to the coordinates
 * that come back. All graph-layout math — and the only dependency on the
 * layout engine — lives in the shared core.
 *
 * `PositionedNode.x/y` are the top-left corner of the node's bounding box,
 * as the core returns them, so renderer code can place a `<rect>` directly.
 */
export function layoutGraph(
  graph: GraphModel,
  options: LayoutOptions,
): PositionedGraph {
  // Each label wrapped and measured once, here, and carried to the renderer
  // on the positioned node: the shape is sized around this box, and the
  // wrapped rows are drawn where it says they sit. The renderer has no
  // measurer, so a second opinion there was never an option. A node's text
  // is drawn at the 14px base, so it wraps at Mermaid's 200px scaled to 14
  // (`wrapNodeLabel`; the label-wrap ADR, nook `01M4R4WDZ`).
  const wrappedById = new Map(
    graph.nodes.map((node) => [node.id, wrapNodeLabel(node.label, options.measureText)]),
  );
  // The empty measurement contains padding only horizontally and one
  // 21px text row vertically. Enlarge the shape envelope, leaving the
  // original label box and wrap width for the renderer.
  const empty = options.measureText.measure("");
  const extraPadding = {
    width: Math.max(0, empty.width),
    height: Math.max(0, empty.height - BASE_FONT_SIZE_PX * LINE_HEIGHT_RATIO),
  };

  // A subgraph's title is measured once too, for the same two readers: the
  // title band the core keeps in the frame, and the renderer.
  const titleBoxById = measureTitles(graph.subgraphs, options.measureText);

  // At the 12px an edge label is drawn at, not the node's 14px, and wrapped
  // at Mermaid's 200px scaled to that size (the label-wrap ADR, nook
  // `01M4R4WDZ`): the box handed to the core below and the one the renderer
  // draws in are this one, and the rows drawn are the wrapped label's.
  const wrappedEdgeLabelById = new Map(
    graph.edges.flatMap((edge) =>
      edge.label === null ? [] : [[edge.id, wrapConnectorLabel(edge.label, options.measureText)] as const],
    ),
  );

  const laidOut = layoutDirectedGraph({
    direction: graph.direction,
    // Subgraphs before boxes, in Mermaid's order — see `mermaidClosingOrder`.
    // The core keeps the order it is handed (ELK's `considerModelOrder`), so
    // this order is a decision about the picture, not bookkeeping.
    nodes: [
      // Each subgraph goes to the core as a cluster. The core sizes and
      // places the frame — around its members, its padding and a band for
      // its title — and this adapter only says how much padding and how big
      // a title (nook decision `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 2: nothing
      // here moves a box or a frame afterwards).
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
      ...mermaidClosingOrder(graph.subgraphs).map((subgraph) =>
        clusterNode({
          id: subgraph.id,
          parentId: subgraph.parentId,
          title: titleBoxById.get(subgraph.id)!,
          padding: SUBGRAPH_PADDING * 2,
          // The subgraph's own `direction LR` (or `TB`/`BT`/`RL`). Whether
          // it holds is the core's to decide, by Mermaid's rule (see
          // `voidedDirections`).
          direction: subgraph.direction,
        }),
      ),
      ...graph.nodes.map((node) => ({
        id: node.id,
        // The shape decides how much box the measured label needs; the
        // shared layout core is handed sizes and never learns a shape
        // exists.
        ...boxForLabel(node.shape, {
          width: wrappedById.get(node.id)!.labelBox.width + extraPadding.width,
          height: wrappedById.get(node.id)!.labelBox.height + extraPadding.height,
        }),
        // Membership, and the only thing about a subgraph a member tells the
        // core. `undefined` rather than `null` when the node is in no
        // subgraph, matching the core's optional field.
        ...(node.parentId === null ? {} : { parentId: node.parentId }),
      })),
    ],
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      // Either end may name a subgraph (`one --> two`): the core routes it to
      // the frame itself, as Mermaid's ELK layout does — measured, its route
      // runs from one frame's bottom edge to the other's top edge.
      from: edge.from,
      to: edge.to,
      // The one part of an arrow token that reaches layout rather than the
      // renderer: `A ----> B` puts B three layers below A. Mermaid 12 on ELK
      // drops this (measured: drawn exactly as `-->`); Siren keeps it, a
      // divergence the core implements and documents (`chainOf`).
      minLength: edge.minLength,
      // The other part of an edge that reaches layout rather than the
      // renderer: the core keeps this much room on the line and reports
      // where it put it. Measured with `options.measureText`, the one
      // measurer every other piece of text in this pipeline goes through.
      ...(edge.label === null ? {} : { label: wrappedEdgeLabelById.get(edge.id)!.labelBox }),
      // How the renderer will draw the edge's corners, which the line hops
      // keep clear of: the radius of the curve it will be drawn with (the
      // flowchart's default unless an `interpolate` chose another), absent
      // where that curve draws them sharp.
      ...cornerRadiusOf(edge.curve ?? FLOWCHART_DEFAULT_CURVE),
    })),
  });

  const boxById = new Map(laidOut.nodes.map((box) => [box.id, box]));
  const routeById = new Map(laidOut.edges.map((route) => [route.id, route]));

  const nodes = graph.nodes.map((node) => {
    const box = boxById.get(node.id)!;
    return {
      ...node,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      // The wrapped label and the box it was measured into: what the
      // shape was sized around and what the renderer draws.
      ...wrappedById.get(node.id)!,
    };
  });

  const edges = graph.edges.map((edge) => {
    const route = routeById.get(edge.id)!;
    return {
      ...edge,
      points: route.points,
      hops: route.hops,
      // `null` rather than absent: an edge that asked for no space has
      // nowhere to draw text, and one state is easier to read than a
      // missing field.
      label:
        edge.label === null || route.labelAnchor === undefined
          ? null
          : { ...wrappedEdgeLabelById.get(edge.id)!, anchor: route.labelAnchor },
    };
  });

  // Back into the model's own order — outermost first, which is the order
  // they are drawn in so that an inner frame is painted over its parent.
  const subgraphs = graph.subgraphs.map<PositionedSubgraph>((subgraph) => ({
    id: subgraph.id,
    ...placedFrame(boxById.get(subgraph.id)!, subgraph.label, titleBoxById.get(subgraph.id)!),
  }));

  return {
    direction: graph.direction,
    nodes,
    edges,
    subgraphs,
    accTitle: graph.accTitle,
    accDescr: graph.accDescr,
    width: laidOut.width,
    height: laidOut.height,
  };
}
