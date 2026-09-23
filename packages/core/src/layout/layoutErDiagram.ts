import type {
  ErModel,
  LayoutOptions,
  PositionedErDiagram,
  PositionedErEntity,
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
 * Places an `ErModel`'s entities and reports the diagram's bounds.
 *
 * **Through the shared layout core, with no edges at all.** That looks like
 * a roundabout way to lay boxes out in a row, and it is the arrangement
 * Mermaid produces: measured with `--markup`, `erDiagram / CUSTOMER / ORDER`
 * draws the two at `translate(28, 18)` and `translate(208, 18)` — the same
 * y, side by side — because nothing joins them and they share a rank. Laying
 * them out here by hand would reproduce that for this document and then have
 * to grow a second layout engine for the one relationships land in.
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
    edges: [],
  });

  const boxById = new Map(laidOut.nodes.map((box) => [box.id, box]));
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

  return {
    entities,
    timeline: model.timeline,
    width: laidOut.width,
    height: laidOut.height,
  };
}
