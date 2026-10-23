/**
 * What the adapters over the shared layout core (`layoutDirectedGraph`) do
 * alike with a connector — a flowchart edge, a class relationship, a state
 * transition, an ER relationship: wrap and measure its label once, before the
 * core, so the box the core keeps clear on the line is the box the renderer
 * draws in; then, after the core, re-attach the route, its line hops and the
 * label placed at the anchor the core reserved.
 *
 * Shared because the four adapters each kept a copy of these two steps, and
 * what comes out of them is one record, `PlacedConnector`, every kind's
 * connector extends (nook decision `01M5D99KNB4R5FVDRWCG902ZAC`). The wrap
 * function is a parameter because it is the one thing that differs: an ER
 * relationship wraps at 200 × 12/14 ≈ 171.43px (`wrapErRelationshipLabel`),
 * the others at 150px (`wrapConnectorLabel`) — the label-wrap ADR, nook
 * `01M4R4WDZ`, as amended.
 */
import type { Label, LabelBox, PlacedConnector, PlacedLabel, Point, TextMeasurer } from "../contracts";
import type { LabelSizes } from "../label/label";
import { type WrappedLabel, wrapConnectorLabel } from "../label/wrapLabel";
import type { DirectedGraphEdgeRoute } from "./layoutDirectedGraph";

/**
 * A **connector** as a kind's model declares it — a flowchart edge, a class
 * relationship, a state transition, an ER relationship: what
 * `placeConnectors` reads of it. Any of their model types fits.
 */
export interface ConnectorItem {
  id: string;
  from: string;
  to: string;
  label: Label | null;
}

/** The part of a shared-core route (`DirectedGraphEdgeRoute`) `place` reads. */
export type ConnectorRoute = Pick<DirectedGraphEdgeRoute, "points" | "hops" | "labelAnchor">;

/**
 * How a kind wraps its connector labels: `wrapConnectorLabel`, or
 * `wrapErRelationshipLabel` for an ER diagram. `sizes` is the typography
 * `placeConnectors` was handed, absent when it was handed none.
 */
export type ConnectorLabelWrap = (label: Label, measureText: TextMeasurer, sizes?: LabelSizes) => WrappedLabel;

/** What `placeConnectors` answers: each label wrapped, and the step that places them once the core has routed them. */
export interface ConnectorPlacement {
  /**
   * The box a connector's label was wrapped and measured to, by the
   * connector's id; `undefined` for an unlabelled connector. It is the size
   * the adapter hands `layoutDirectedGraph` as the core edge's label (the
   * `DirectedGraphEdge` it builds for the connector), so the box the core
   * keeps clear and the box the renderer draws in are the same box, and the
   * rows drawn are the wrapped label's.
   */
  labelBoxOf(id: string): LabelBox | undefined;
  /**
   * Places every connector on the route the core gave it, by id: one
   * `PlacedConnector` per item, in the items' order. A connector with no
   * route is a programmer error and throws.
   */
  place(routeById: ReadonlyMap<string, ConnectorRoute>): PlacedConnector[];
}

/**
 * Lays a graph-shaped kind's connectors out around the shared core, in two
 * phases (nook decision `01M5D99KNB4R5FVDRWCG902ZAC`):
 *
 * 1. **Before the core** — called, it wraps and measures each labelled
 *    connector's label **once**, with `wrap`, at the `labelFontSize` a
 *    connector label is drawn at (`sizes`, the caller's typography; 12px
 *    when it gives none). `wrap` is the one thing that differs by kind: a flowchart
 *    edge, a class relationship and a state transition wrap at 150px of text
 *    (`wrapConnectorLabel`, the default); an ER relationship at 200 × 12/14 ≈
 *    171.43px (`wrapErRelationshipLabel`), as Mermaid wraps its 14px ER label
 *    at 200px (the label-wrap ADR, nook `01M4R4WDZ`, as amended).
 * 2. **After the core** — `place` re-attaches each connector to its route:
 *    `points` and `hops` straight from the route, and the wrapped label
 *    placed at `labelAnchor` — or `null` when the model gave no label or the
 *    core reserved no room (no `labelAnchor`).
 *
 * It does not call the core and knows no kind: clipping, multiplicities,
 * cardinalities, interface labels and terminal labels stay with each
 * adapter, which reads them off the same route.
 */
export function placeConnectors(
  items: readonly ConnectorItem[],
  measureText: TextMeasurer,
  wrap: ConnectorLabelWrap = wrapConnectorLabel,
  sizes?: LabelSizes,
): ConnectorPlacement {
  const wrappedById = new Map(
    items.flatMap((item) => (item.label === null ? [] : [[item.id, wrap(item.label, measureText, sizes)] as const])),
  );
  return {
    labelBoxOf: (id) => wrappedById.get(id)?.labelBox,
    place: (routeById) =>
      items.map((item) => {
        const route = routeById.get(item.id);
        if (route === undefined) {
          throw new Error(`placeConnectors: no route for connector ${item.id}`);
        }
        return {
          id: item.id,
          from: item.from,
          to: item.to,
          points: route.points,
          hops: route.hops,
          label:
            item.label === null || route.labelAnchor === undefined ? null : placedLabel(item.id, route.labelAnchor),
        };
      }),
  };

  /**
   * A labelled connector's wrapped label at the anchor the core reserved.
   * Every labelled item was wrapped above, by this same placement, so a
   * missing entry is a programmer error and throws rather than placing
   * nothing.
   */
  function placedLabel(id: string, anchor: Point): PlacedLabel {
    const wrapped = wrappedById.get(id);
    if (wrapped === undefined) {
      throw new Error(`placeConnectors: no wrapped label for labelled connector ${id}`);
    }
    return { ...wrapped, anchor };
  }
}
