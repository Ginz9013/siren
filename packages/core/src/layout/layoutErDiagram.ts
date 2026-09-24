import type {
  ErModel,
  LayoutOptions,
  PositionedErDiagram,
  PositionedErEntity,
  PositionedErRelationship,
} from "../contracts";
import { layoutDirectedGraph } from "./layoutDirectedGraph";

/**
 * Horizontal padding between an entity box's edge and its name, and vertical
 * padding above and below it.
 *
 * The same pair a state box takes, and deliberately so. The *figure* is
 * Mermaid's — measured with `--markup`, an entity is a
 * `rect.basic.label-container` with the name in a `<text>` inside it — but
 * the pixel counts are Siren's (ADR-0004), and geometry read back from the
 * probe cannot settle them: jsdom performs no layout, so every coordinate in
 * that mode is the measuring stub's answer rather than Mermaid's. What is
 * left to decide is how a labelled rectangle is padded, and this kind draws
 * the same labelled rectangle a state does. Two of them padded differently
 * would read as two constructs.
 */
const ENTITY_PADDING_X = 14;
const ENTITY_PADDING_Y = 8;

/**
 * The direction an ER diagram ranks in, until `direction` is implemented.
 *
 * Measured: a document naming no `direction` reports `TB`, which is also
 * what `erDiagram` alone reports. `direction LR` is refused by name by
 * `parseErDiagram` until the ticket that draws it, so no document reaching
 * here asks for anything else — and when one can, this becomes a field on
 * the model the way `StateModel.direction` already is.
 */
const DEFAULT_RANKDIR = "TB";

/**
 * Places an `ErModel`'s entities, routes its relationships, and reports the
 * diagram's bounds.
 *
 * **Through the shared layout core.** Measured with `--markup`,
 * `erDiagram / CUSTOMER / ORDER` draws the two unrelated boxes at
 * `translate(28, 18)` and `translate(208, 18)` — the same y, side by side,
 * because nothing joins them and they share a rank — and a relationship
 * puts them on consecutive ranks instead. That is what a ranked graph
 * layout produces, so this asks for one rather than growing a second engine
 * beside `layoutDirectedGraph`.
 *
 * **Every route runs from the relationship's `from` to its `to`**, which is
 * the source's own left-to-right order, and the two cardinalities travel
 * with their own ends. Mermaid's record of the pair is crossed (see
 * `ErRelationshipDecl`); the parser undid it once, and nothing here undoes
 * it again.
 */
export function layoutErDiagram(model: ErModel, options: LayoutOptions): PositionedErDiagram {
  const sizeById = new Map(
    model.entities.map((entity) => {
      const text = options.measureText.measure(entity.label);
      return [
        entity.id,
        {
          width: text.width + ENTITY_PADDING_X * 2,
          height: text.height + ENTITY_PADDING_Y * 2,
        },
      ] as const;
    }),
  );

  const laidOut = layoutDirectedGraph({
    rankdir: DEFAULT_RANKDIR,
    nodes: model.entities.map((entity) => ({
      id: entity.id,
      ...sizeById.get(entity.id)!,
    })),
    edges: model.relationships.map((relationship) => ({
      id: relationship.id,
      from: relationship.from,
      to: relationship.to,
      // Every ER relationship carries a label — measured, the `: label` is
      // required — so the core is always asked to hold the ranks apart for
      // one, and it reports back where that space ended up.
      label: options.measureText.measure(relationship.label),
    })),
  });

  const boxById = new Map(laidOut.nodes.map((box) => [box.id, box]));
  const routeById = new Map(laidOut.edges.map((route) => [route.id, route]));
  const entities: PositionedErEntity[] = model.entities.map((entity) => {
    const box = boxById.get(entity.id)!;
    return {
      id: entity.id,
      label: entity.label,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
  });

  const relationships: PositionedErRelationship[] = model.relationships.map(
    (relationship) => {
      const route = routeById.get(relationship.id)!;
      return {
        id: relationship.id,
        from: relationship.from,
        to: relationship.to,
        fromCardinality: relationship.fromCardinality,
        toCardinality: relationship.toCardinality,
        line: relationship.line,
        label: relationship.label,
        points: route.points,
        labelAnchor: route.labelAnchor ?? null,
      };
    },
  );

  return {
    entities,
    relationships,
    timeline: model.timeline,
    width: laidOut.width,
    height: laidOut.height,
  };
}
