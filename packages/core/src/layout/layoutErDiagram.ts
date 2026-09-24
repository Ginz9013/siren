import type {
  ErAttribute,
  ErAttributeColumn,
  ErModel,
  LayoutOptions,
  PositionedErDiagram,
  PositionedErEntity,
  PositionedErAttributeTable,
  PositionedErRelationship,
  ResolvedErEntity,
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
 * The four columns of an attribute table, in the order Mermaid draws them
 * and paired with the text each one takes from an attribute.
 *
 * `keys` is re-joined with a comma because that is what Mermaid draws —
 * `attribute.keys.join()` — so the cell reads back exactly as the author
 * wrote it while the model keeps the list the picture cannot show.
 */
const COLUMNS: readonly { column: ErAttributeColumn; textOf: (a: ErAttribute) => string }[] = [
  { column: "type", textOf: (attribute) => attribute.type },
  { column: "name", textOf: (attribute) => attribute.name },
  { column: "keys", textOf: (attribute) => attribute.keys.join(",") },
  { column: "comment", textOf: (attribute) => attribute.comment },
];

/**
 * The columns `attributes` actually uses: always `type` and `name`, plus
 * `keys` and `comment` only where some attribute wrote one.
 *
 * Measured from Mermaid's `erBox` renderer, which is the only instrument
 * that can answer it: `maxKeysWidth <= PADDING` sets `keysPresent = false`,
 * zeroing the column's width and skipping the rule beside it, and
 * `commentPresent` does the same one column over. `--markup` cannot be used
 * here — the probe's `getBBox` stub reports a constant width for every
 * label, empty ones included, so both flags come back true there whatever
 * the document says.
 *
 * `type` and `name` have no such flag in Mermaid and need none: an
 * attribute cannot be written without both (measured — `string` alone
 * inside a block is a parse error).
 */
function drawnColumns(attributes: readonly ErAttribute[]): typeof COLUMNS {
  return COLUMNS.filter(
    ({ column, textOf }) =>
      column === "type" ||
      column === "name" ||
      attributes.some((attribute) => textOf(attribute).length > 0),
  );
}

/**
 * An entity box measured but not yet placed: its size, and where its name
 * row, rules and cells sit relative to its own top-left corner.
 *
 * Computed before the shared layout core runs, because the core needs the
 * size, and translated into diagram coordinates once the core has placed the
 * box — the two-step `layoutClassDiagram` already takes for a class's
 * compartments.
 */
interface ErBoxPlan {
  width: number;
  height: number;
  table: PositionedErAttributeTable | null;
}

/**
 * Measures one entity box: as wide as its name or its widest column stack,
 * whichever is greater, and as tall as its name row plus one row per
 * attribute.
 *
 * Every column is its widest cell plus `ENTITY_PADDING_X`, half of which
 * sits to the left of the text — Mermaid's own arrangement, which is what
 * makes a column of left-aligned cells clear the rule beside it at both
 * ends. When the name is wider than the columns together, the surplus is
 * shared out equally among them, again as Mermaid does; the alternative,
 * hanging it off the right-hand edge, would leave the last rule floating in
 * the middle of a wide box.
 */
function planErBox(entity: ResolvedErEntity, options: LayoutOptions): ErBoxPlan {
  const measure = (text: string) => options.measureText.measure(text);
  const name = measure(entity.label);
  const nameRowHeight = name.height + ENTITY_PADDING_Y * 2;
  const nameRowWidth = name.width + ENTITY_PADDING_X * 2;

  if (entity.attributes.length === 0) {
    // The plain labelled rectangle, unchanged: measured with `--markup`, an
    // entity with no attributes is a `rect.basic.label-container` with its
    // name inside, and Mermaid's `erBox` returns early for it.
    return { width: nameRowWidth, height: nameRowHeight, table: null };
  }

  const columns = drawnColumns(entity.attributes);
  const cellTexts = columns.map(({ textOf }) => entity.attributes.map(textOf));
  const widths = cellTexts.map(
    (texts) => Math.max(...texts.map((text) => measure(text).width)) + ENTITY_PADDING_X,
  );
  const columnsWidth = widths.reduce((sum, width) => sum + width, 0);
  const surplus = Math.max(0, nameRowWidth - columnsWidth);
  const grown = widths.map((width) => width + surplus / widths.length);

  const rowHeights = entity.attributes.map((attribute) => {
    const tallest = Math.max(
      ...columns.map(({ textOf }) => measure(textOf(attribute)).height),
    );
    return tallest + ENTITY_PADDING_Y * 2;
  });

  // Left edge of each column, and then the rules at every internal boundary
  // between two of them. The box's own edges are not rules: the frame is.
  const columnLefts: number[] = [];
  let left = 0;
  for (const width of grown) {
    columnLefts.push(left);
    left += width;
  }

  let top = nameRowHeight;
  const rows = entity.attributes.map((attribute, index) => {
    const centerY = top + rowHeights[index] / 2;
    top += rowHeights[index];
    return {
      cells: columns.map(({ column, textOf }, columnIndex) => ({
        column,
        text: textOf(attribute),
        x: columnLefts[columnIndex] + ENTITY_PADDING_X / 2,
        y: centerY,
      })),
    };
  });

  return {
    width: left,
    height: top,
    table: {
      headerDividerY: nameRowHeight,
      columnDividerXs: columnLefts.slice(1),
      rows,
    },
  };
}

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
  const planById = new Map(
    model.entities.map((entity) => [entity.id, planErBox(entity, options)] as const),
  );

  const laidOut = layoutDirectedGraph({
    // The document's own rank direction — `TB` unless the author wrote a
    // `direction`, which is the default measured against mermaid 11.17.2.
    // The four values are dagre's own, so there is nothing to map.
    //
    // A direction read by the parser and dropped here would be **silent**:
    // no diagnostic is missing, a picture is still drawn, and only where the
    // boxes landed says the author was disobeyed. That is why the test for
    // this compares coordinates rather than counting diagnostics.
    rankdir: model.direction,
    nodes: model.entities.map((entity) => {
      const plan = planById.get(entity.id)!;
      return { id: entity.id, width: plan.width, height: plan.height };
    }),
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
    const table = planById.get(entity.id)!.table;
    return {
      id: entity.id,
      label: entity.label,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      // The plan was measured against the box's own top-left corner, so
      // placing it is one translation — the step `layoutClassDiagram` takes
      // for a class's compartments, and the reason nothing downstream has to
      // know where the box ended up.
      attributeTable:
        table === null
          ? null
          : {
              headerDividerY: box.y + table.headerDividerY,
              columnDividerXs: table.columnDividerXs.map((x) => box.x + x),
              rows: table.rows.map((row) => ({
                cells: row.cells.map((cell) => ({
                  ...cell,
                  x: box.x + cell.x,
                  y: box.y + cell.y,
                })),
              })),
            },
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
