import type { GraphModel, LayoutOptions, NodeShape, PositionedGraph } from "../contracts";
import { layoutDirectedGraph } from "./layoutDirectedGraph";

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
 * The last three are drawn with a `<rect>` rather than a `<path>`, and
 * belong here for exactly the same reason the others do: the renderer reads
 * these numbers as the radius it writes and the inset it places the bars
 * at, so the box layout reserves and the figure drawn stay one decision.
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
      // A rectangle is its own bounding box. Every other member of
      // `NodeShape` is a spelling the parser still refuses, so none of them
      // can reach here — each arrives with the ticket that draws it, and
      // adds the case that sizes it.
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
  const laidOut = layoutDirectedGraph({
    rankdir: graph.direction,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      // The shape decides how much box the measured label needs; the shared
      // layout core is handed sizes and never learns a shape exists.
      ...boxForLabel(node.shape, options.measureText.measure(node.label)),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
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
    };
  });

  const edges = graph.edges.map((edge) => ({
    ...edge,
    points: routeById.get(edge.id)!.points,
  }));

  return {
    direction: graph.direction,
    nodes,
    edges,
    timeline: graph.timeline,
    width: laidOut.width,
    height: laidOut.height,
  };
}
