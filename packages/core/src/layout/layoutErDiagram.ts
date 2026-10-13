import type {
  ErAttribute,
  ErAttributeColumn,
  ErModel,
  LabelBox,
  LayoutOptions,
  PositionedErDiagram,
  PositionedErEntity,
  PositionedErAttributeCell,
  PositionedErAttributeTable,
  PositionedErRelationship,
  PositionedErSubgraph,
  ResolvedErEntity,
  ResolvedErSubgraph,
} from "../contracts";
import { ER_CONNECTOR_CURVE, curveCornerRadius } from "../curve/curve";
import { layoutLabel } from "../label/layoutLabel";
import { wrapErRelationshipLabel } from "../label/wrapLabel";
import {
  layoutDirectedGraph,
  type DirectedGraphEdge,
  type DirectedGraphNode,
} from "./directedGraph/layoutDirectedGraph";

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
 * How far a cluster's frame clears the boxes it holds on every side, and —
 * doubled, with the title line between the two halves — how tall the strip
 * along its top is.
 *
 * `layoutGraph`'s `SUBGRAPH_PADDING` exactly, and the same number for the
 * same reason the entity padding matches a state box's: the *figure* is
 * Mermaid's (measured with `--markup`, an ER cluster is a `g.cluster` with
 * a `<rect>` and a `g.cluster-label` — the same two elements a flowchart
 * subgraph draws), while the pixel counts are Siren's (ADR-0004). Two
 * labelled frames padded differently would read as two constructs.
 */
const SUBGRAPH_PADDING = 12;

/** The core's `cornerRadius` for a relationship: the radius `ER_CONNECTOR_CURVE` rounds its corners with. */
const CONNECTOR_CORNER_RADIUS = curveCornerRadius(ER_CONNECTOR_CURVE);

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
  { column: "comment", textOf: (attribute) => attribute.comment.text },
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
  /** The name as `layoutLabel` measured it. */
  labelBox: LabelBox;
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
  // Every row of the name, stacked: an alias may break into several (ADR-0015).
  const labelBox = layoutLabel(entity.label, options.measureText);
  const nameRowHeight = labelBox.height + ENTITY_PADDING_Y * 2;
  const nameRowWidth = labelBox.width + ENTITY_PADDING_X * 2;

  if (entity.attributes.length === 0) {
    // The plain labelled rectangle, unchanged: measured with `--markup`, an
    // entity with no attributes is a `rect.basic.label-container` with its
    // name inside, and Mermaid's `erBox` returns early for it.
    return { width: nameRowWidth, height: nameRowHeight, labelBox, table: null };
  }

  const columns = drawnColumns(entity.attributes);
  /**
   * Each attribute's comment as `layoutLabel` measured it — every row of it,
   * so a `<br>` in a comment makes its row taller (ADR-0015). The other
   * columns are one line of literal text, measured as written.
   */
  const commentBoxes = entity.attributes.map((attribute) =>
    layoutLabel(attribute.comment, options.measureText),
  );
  const sizeOf = ({ column, textOf }: (typeof COLUMNS)[number], index: number) =>
    column === "comment" ? commentBoxes[index] : measure(textOf(entity.attributes[index]));
  const widths = columns.map(
    (column) =>
      Math.max(...entity.attributes.map((_, index) => sizeOf(column, index).width)) +
      ENTITY_PADDING_X,
  );
  const columnsWidth = widths.reduce((sum, width) => sum + width, 0);
  const surplus = Math.max(0, nameRowWidth - columnsWidth);
  const grown = widths.map((width) => width + surplus / widths.length);

  const rowHeights = entity.attributes.map((_, index) => {
    const tallest = Math.max(...columns.map((column) => sizeOf(column, index).height));
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
      cells: columns.map(({ column, textOf }, columnIndex): PositionedErAttributeCell => {
        const x = columnLefts[columnIndex] + ENTITY_PADDING_X / 2;
        if (column !== "comment") {
          return { column, text: textOf(attribute), x, y: centerY };
        }
        const labelBox = commentBoxes[index];
        return {
          column,
          x,
          y: centerY,
          label: attribute.comment,
          labelBox,
          // Centred so that the widest row's text starts at `x`, where every
          // cell's in the column does: the box's width holds the measurer's
          // padding, half each side, and a run's `x` is that half
          // (`LabelBox`), so the text is the width less twice that.
          anchor: { x: x + labelBox.width / 2 - labelBox.rows[0].runs[0].x, y: centerY },
        };
      }),
    };
  });

  return {
    width: left,
    height: top,
    labelBox,
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
 * This is the ER adapter over the shared ELK layout core
 * (`directedGraph/layoutDirectedGraph`): it measures each entity's box,
 * hands the sizes to the core — `subgraph` blocks as clusters, with their
 * padding and a band for their title — and reattaches the ER diagram's own
 * data to the coordinates that come back. All graph-layout math lives in
 * the core, frames and every relationship's route included, a
 * self-relationship's loop among them; nothing here moves a box, a frame or
 * a route afterwards (nook decision `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 2).
 * What Mermaid 12.2.0 does with an ER diagram under ELK, and the parity
 * numbers for this adapter, are nook decision `01M4VNEEYAHMFDVRAB4XSAHKCB`.
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
  /**
   * Each relationship's label wrapped and measured at the 12px it is drawn
   * at (`wrapErRelationshipLabel`: 200 × 12/14 ≈ 171.43px of text, as
   * Mermaid wraps its 14px ER label at 200px — the label-wrap ADR, nook
   * `01M4R4WDZ`, as amended), by the relationship's
   * id — once, so the box the core keeps clear and the box the renderer
   * draws in are the same box, and the rows drawn are the wrapped label's.
   */
  const wrappedRelationshipLabelById = new Map(
    model.relationships.map(
      (relationship) =>
        [relationship.id, wrapErRelationshipLabel(relationship.label, options.measureText)] as const,
    ),
  );
  /**
   * Each block's title as `layoutLabel` measured it — every row of it, so a
   * `<br>` makes the band taller (ADR-0015). Never wrapped: Mermaid draws a
   * cluster's title as plain text. Measured once, so the band the core keeps
   * and the title the renderer draws are the same box.
   */
  const titleBoxById = new Map(
    model.subgraphs.map((subgraph) => [subgraph.id, layoutLabel(subgraph.label, options.measureText)] as const),
  );

  const laidOut = layoutDirectedGraph({
    // The document's own direction — `TB` unless the author wrote a
    // `direction` outside every block. A block's own is a separate thing and
    // reaches the core per cluster below.
    direction: model.direction,
    // Blocks before entities, in Mermaid 12.2.0's order — see
    // `mermaidBlockOrder`. The core keeps the order it is handed (ELK's
    // `considerModelOrder`), so this order is a decision about the picture,
    // not bookkeeping. The entities follow in the model's order, the order
    // they were first named — Mermaid's entity table's, which `getData`
    // walks next.
    nodes: [
      // Each block goes to the core as a cluster: the core sizes and places
      // the frame — around its members, its padding and a band for its
      // title — and lays its members out in the block's own direction while
      // no relationship voids it (the **Boundary-crossing edge** rule,
      // Mermaid 12's). The ids cannot collide with an entity's: a block's is
      // generated (`subgraph:1`, ADR-0010).
      ...mermaidBlockOrder(model.subgraphs).map(
        (subgraph): DirectedGraphNode => ({
          id: subgraph.id,
          width: 0,
          height: 0,
          ...(subgraph.parentId === null ? {} : { parentId: subgraph.parentId }),
          cluster: {
            padding: SUBGRAPH_PADDING,
            title: titleBoxById.get(subgraph.id)!,
            ...(subgraph.direction === null ? {} : { direction: subgraph.direction }),
          },
        }),
      ),
      ...model.entities.map((entity): DirectedGraphNode => {
        const plan = planById.get(entity.id)!;
        return {
          id: entity.id,
          width: plan.width,
          height: plan.height,
          ...(entity.parentId === null ? {} : { parentId: entity.parentId }),
        };
      }),
    ],
    edges: model.relationships.map(
      (relationship): DirectedGraphEdge => ({
        id: relationship.id,
        from: relationship.from,
        to: relationship.to,
        // Every ER relationship carries a label — measured, the `: label` is
        // required — so the core is always asked to keep room for one on the
        // line, and it reports back where that room ended up. Sized from
        // every row of the label (ADR-0015).
        label: wrappedRelationshipLabelById.get(relationship.id)!.labelBox,
        // The radius the line hops keep clear of: a relationship is drawn
        // rounded (`ER_CONNECTOR_CURVE`).
        cornerRadius: CONNECTOR_CORNER_RADIUS,
      }),
    ),
  });

  /**
   * Each styled entity's declarations, keyed for lookup below.
   *
   * `buildErModel` has already merged everything one entity was styled by
   * and dropped the values its gate refused, and omits an entity that ended
   * up with none — so there is nothing to reconcile here. An entity absent
   * from this map gets the empty pair, which is what says "no `style`
   * attribute" to the renderer without it having to test for a missing
   * field. `layoutStateDiagram` keys a state's the same way.
   */
  const styleByEntityId = new Map(
    model.styles.map(({ targetId, style }) => [targetId, style]),
  );

  const boxById = new Map(laidOut.nodes.map((box) => [box.id, box]));
  const routeById = new Map(laidOut.edges.map((route) => [route.id, route]));

  const entities: PositionedErEntity[] = model.entities.map((entity) => {
    const box = boxById.get(entity.id)!;
    const { table, labelBox } = planById.get(entity.id)!;
    return {
      id: entity.id,
      label: entity.label,
      labelBox,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      // By id and never by position: a stage that handed the resolved list
      // out in draw order would style the wrong box, draw a perfectly good
      // picture, and report nothing.
      style: styleByEntityId.get(entity.id) ?? { frame: [], text: [] },
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
                cells: row.cells.map((cell): PositionedErAttributeCell => {
                  const x = box.x + cell.x;
                  const y = box.y + cell.y;
                  return cell.column === "comment"
                    ? { ...cell, x, y, anchor: { x: box.x + cell.anchor.x, y: box.y + cell.anchor.y } }
                    : { ...cell, x, y };
                }),
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
        points: route.points,
        hops: route.hops,
        label:
          route.labelAnchor === undefined
            ? null
            : {
                ...wrappedRelationshipLabelById.get(relationship.id)!,
                anchor: route.labelAnchor,
              },
      };
    },
  );

  // Back into the model's own order — outermost first, which is the order
  // they are drawn in so that an inner frame is painted over its parent. A
  // block's box is its frame, as the core placed it, and its title goes
  // where the core put it across the band.
  const subgraphs = model.subgraphs.map((subgraph): PositionedErSubgraph => {
    const frame = boxById.get(subgraph.id)!;
    return {
      id: subgraph.id,
      label: { label: subgraph.label, labelBox: titleBoxById.get(subgraph.id)!, anchor: frame.title! },
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
    };
  });

  return {
    entities,
    relationships,
    subgraphs,
    // The core's extent holds every box, frame, route and label it placed.
    width: laidOut.width,
    height: laidOut.height,
    // Neither is drawn on the canvas, so neither takes part in the geometry
    // above — measured, a document writing both reports the same entity
    // table as one writing neither. They pass through for the renderer,
    // which puts them on the SVG root.
    accTitle: model.accTitle,
    accDescr: model.accDescr,
  };
}

/**
 * The blocks in the order Mermaid hands them to ELK: Mermaid 12.2.0's
 * `ErDB.getData` (`erDiagram-VZDIDQZ7.mjs`, line 1340) lists every block
 * before any entity, walking its block list **backwards** — and that list is
 * in the order the blocks *closed*, because its parser records a block when
 * it reduces the `end` (line 189). So an inner block precedes its parent
 * there, and reversed, a parent precedes its children and the last sibling
 * the first.
 *
 * Measured in headless Chrome against Mermaid 12.2.0: `subgraph SA { A }`,
 * `subgraph SB { B }`, then `X` draws SB, SA, X from left to right; `subgraph
 * O { subgraph I1 { A }, subgraph I2 { B }, C }` draws C, I2, I1 inside O.
 * The flowchart's `FlowDB.getData` does the same, and `layoutGraph` keeps
 * its own copy of this walk for it.
 *
 * Siren's own list is in the order the keywords *opened* (`subgraph:1`,
 * `subgraph:2`, …), parents before children. The closing order is that tree
 * walked children-first.
 */
function mermaidBlockOrder(subgraphs: readonly ResolvedErSubgraph[]): ResolvedErSubgraph[] {
  const closed: ResolvedErSubgraph[] = [];
  const close = (parentId: string | null) => {
    for (const subgraph of subgraphs.filter((candidate) => candidate.parentId === parentId)) {
      close(subgraph.id);
      closed.push(subgraph);
    }
  };
  close(null);
  return closed.reverse();
}
