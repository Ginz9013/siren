import type {
  Direction,
  GraphModel,
  GraphNode,
  LayoutOptions,
  PositionedGraph,
  PositionedSubgraph,
} from "../contracts";
import { type Curve, curveCornerRadius, FLOWCHART_DEFAULT_CURVE } from "../curve/curve";
import { layoutDirectedGraph } from "./layoutDirectedGraph";
import { clusterNode, measureTitles, mermaidClosingOrder, placedFrame, SUBGRAPH_PADDING } from "./clusters";
import { wrapConnectorLabel, wrapNodeLabel } from "../label/wrapLabel";
import { BASE_FONT_SIZE_PX } from "../label/label";
import { LINE_HEIGHT_RATIO } from "../label/layoutLabel";
import { SHAPES } from "./shapes/shapeTable";
import type { Rect, Size } from "./shapes/shape";

/**
 * Where a node's label sits, as the offset of its centre from the box's
 * centre — or nothing, for a shape that centres it. The shape table's
 * `labelRect` says where the padded label goes in the box layout placed;
 * this turns that into the one number the renderer needs.
 */
function labelOffsetOf(node: GraphNode, box: Rect, label: Size): { labelOffset?: { x: number; y: number } } {
  const placed = SHAPES[node.shape].labelRect?.(box, label, node);
  if (placed === undefined) {
    return {};
  }
  const x = placed.x + placed.width / 2 - (box.x + box.width / 2);
  const y = placed.y + placed.height / 2 - (box.y + box.height / 2);
  return x === 0 && y === 0 ? {} : { labelOffset: { x, y } };
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
 * (the shape table, `shapes/shapeTable.ts`), hands the resulting sizes to the shared layout core, and
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

  // The direction a shape is drawn for: its nearest enclosing subgraph's
  // own `direction`, or the graph's — Mermaid's `resolveNodeDir`, which
  // hands a fork the direction as written, whether or not layout keeps it.
  const subgraphById = new Map(graph.subgraphs.map((subgraph) => [subgraph.id, subgraph]));
  const directionOf = (parentId: string | null): Direction => {
    for (let id = parentId; id !== null; ) {
      const subgraph = subgraphById.get(id);
      if (subgraph === undefined) {
        break;
      }
      if (subgraph.direction !== null) {
        return subgraph.direction;
      }
      id = subgraph.parentId;
    }
    return graph.direction;
  };

  // The box a rectangle would draw around each label: what every shape's
  // record sizes its own box from.
  const paddedLabelOf = (id: string) => ({
    width: wrappedById.get(id)!.labelBox.width + extraPadding.width,
    height: wrappedById.get(id)!.labelBox.height + extraPadding.height,
  });

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
        ...SHAPES[node.shape].box(paddedLabelOf(node.id), directionOf(node.parentId), extraPadding, node),
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
      ...labelOffsetOf(node, box, paddedLabelOf(node.id)),
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
