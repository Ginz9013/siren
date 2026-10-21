import type {
  ErAttribute,
  ErAttributeColumn,
  ErCardinality,
  ErModel,
  Label,
  LabelBox,
  LayoutOptions,
  PositionedErDiagram,
  PositionedErEntity,
  PositionedErAttributeCell,
  PositionedErAttributeTable,
  PositionedErRelationship,
  PositionedErSubgraph,
  ResolvedErEntity,
} from "../contracts";
import { CONNECTOR_CORNER_RADIUS } from "../curve/curve";
import { plainRun } from "../label/label";
import { layoutLabel } from "../label/layoutLabel";
import { wrapErRelationshipLabel } from "../label/wrapLabel";
import {
  layoutDirectedGraph,
  type DirectedGraphEdge,
  type DirectedGraphNode,
} from "./layoutDirectedGraph";
import { clusterNode, measureTitles, mermaidClosingOrder, placedFrame } from "./clusters";
import { placeConnectors } from "./connectors";

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
 * How far out from its entity box each cardinality's marker reaches along the
 * line, by the glyph farthest from the box: the bars, circle and almond
 * `renderErDiagramToSVG` draws, placed as Mermaid 12.2.0's end markers place
 * them. Exactly one is two bars, the outer 15 out; zero or one a bar and then
 * a circle of radius 6 centred 21 out; one or more an almond centred on the
 * box's edge, half of it inside the box, and a bar 24 out; zero or more the
 * almond and a circle centred 28 out, reaching 34 (nook decision
 * `01M4W687VYADT35JXWTPSCBQ9G`). The buried half of an almond needs no
 * straight run: it lies under the box, not along the line.
 *
 * The core keeps that much of each end of the route straight
 * (`straightEnds`), so the marker lies on the line rather than past its
 * first bend. The renderer's own test reads the drawn markers and requires
 * this table to equal them, so a marker redrawn without this table following
 * it fails there — longer, because the marker would run past the bend;
 * shorter, because the picture would be stretched for nothing.
 */
export const CARDINALITY_MARKER_REACH: Record<ErCardinality, number> = {
  onlyOne: 15,
  zeroOrOne: 27,
  oneOrMore: 24,
  zeroOrMore: 34,
};

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
 * The lines a type or name draws: split at each line break, each line
 * trimmed, and the blank ones dropped. Measured (mermaid 12.2.0,
 * `--markup`), the name `a\n    b` — a backticked word across two lines —
 * draws as the rows `a` and `b`, and `a\n\n    b` as the same two: the
 * source's indentation is not part of the picture, though it is part of
 * the record.
 */
function splitDrawnLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The label a type or name cell draws when its text spans more than one
 * line once `splitDrawnLines` has read it — one plain row per line, never
 * read for tags — or `null` when it draws as one line of text.
 */
function drawnRows(text: string): Label | null {
  if (!text.includes("\n")) return null;
  const lines = splitDrawnLines(text);
  if (lines.length < 2) return null;
  return { text: lines.join("\n"), rows: lines.map((line) => [plainRun(line)]) };
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
  /** Each type and name that spans lines, as the rows it draws — `drawnRows`. */
  const rowsByCell = new Map<string, { label: Label; labelBox: LabelBox }>();
  entity.attributes.forEach((attribute, index) => {
    for (const { column, textOf } of columns) {
      if (column !== "type" && column !== "name") continue;
      const label = drawnRows(textOf(attribute));
      if (label !== null) {
        rowsByCell.set(`${index}:${column}`, { label, labelBox: layoutLabel(label, options.measureText) });
      }
    }
  });
  /** What a text cell draws when it is one line: the text, unless a break left one line of it. */
  const lineOf = (text: string): string =>
    text.includes("\n") ? (splitDrawnLines(text)[0] ?? "") : text;
  const sizeOf = ({ column, textOf }: (typeof COLUMNS)[number], index: number) =>
    column === "comment"
      ? commentBoxes[index]
      : (rowsByCell.get(`${index}:${column}`)?.labelBox ?? measure(lineOf(textOf(entity.attributes[index]))));
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
          const rows = rowsByCell.get(`${index}:${column}`);
          if (rows === undefined || column === "keys") {
            return { column, text: lineOf(textOf(attribute)), x, y: centerY };
          }
          return {
            column,
            text: rows.label.text,
            x,
            y: centerY,
            ...rows,
            // Placed as a comment's rows are, below.
            anchor: { x: x + rows.labelBox.width / 2 - rows.labelBox.rows[0].runs[0].x, y: centerY },
          };
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
 * (`layoutDirectedGraph`): it measures each entity's box,
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
   * Each relationship's label wrapped once, before the core
   * (`placeConnectors`) — at ER's own width, `wrapErRelationshipLabel`'s
   * 200 × 12/14 ≈ 171.43px of text rather than every other connector's
   * 150px, as Mermaid wraps its 14px ER label at 200px.
   */
  const connectors = placeConnectors(model.relationships, options.measureText, wrapErRelationshipLabel);
  /** Each block's title, measured once (`measureTitles`). */
  const titleBoxById = measureTitles(model.subgraphs, options.measureText);

  const laidOut = layoutDirectedGraph({
    // The document's own direction — `TB` unless the author wrote a
    // `direction` outside every block. A block's own is a separate thing and
    // reaches the core per cluster below.
    direction: model.direction,
    // Blocks before entities, in Mermaid 12.2.0's order — see
    // `mermaidClosingOrder`. The core keeps the order it is handed (ELK's
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
      ...mermaidClosingOrder(model.subgraphs).map((subgraph) =>
        clusterNode({
          id: subgraph.id,
          parentId: subgraph.parentId,
          title: titleBoxById.get(subgraph.id)!,
          direction: subgraph.direction,
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
        // Either end may be a cluster's id (`s1 ||--o{ B : r`, with `s1` a
        // block): the core routes it to the frame itself, as it does a
        // flowchart's `one --> two`.
        from: relationship.from,
        to: relationship.to,
        // Every ER relationship carries a label — measured, the `: label` is
        // required — so the core is always asked to keep room for one on the
        // line, and it reports back where that room ended up. Sized from
        // every row of the label (ADR-0015).
        label: connectors.labelBoxOf(relationship.id),
        // The radius the line hops keep clear of: a relationship is drawn
        // rounded (`CONNECTOR_CURVE`).
        cornerRadius: CONNECTOR_CORNER_RADIUS,
        // Each end runs straight for as long as the marker drawn along it,
        // so a crow's foot never reaches past the bend.
        straightEnds: {
          start: CARDINALITY_MARKER_REACH[relationship.fromCardinality],
          end: CARDINALITY_MARKER_REACH[relationship.toCardinality],
        },
      }),
    ),
  });

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
      // Read off the entity itself, so no list handed out in another order
      // can style the wrong box. `buildErModel` has already merged everything
      // one entity was styled by and dropped the values its gate refused, so
      // there is nothing to reconcile here; an entity it left without a
      // `style` gets the empty pair, which is what says "no `style`
      // attribute" to the renderer without it having to test for a missing
      // field. `layoutStateDiagram` reads a state's the same way.
      style: entity.style ?? { frame: [], text: [] },
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
                  return "anchor" in cell
                    ? { ...cell, x, y, anchor: { x: box.x + cell.anchor.x, y: box.y + cell.anchor.y } }
                    : { ...cell, x, y };
                }),
              })),
            },
    };
  });

  const relationships: PositionedErRelationship[] = connectors.place(routeById).map(
    (placed, index) => {
      const relationship = model.relationships[index]!;
      return {
        ...placed,
        fromCardinality: relationship.fromCardinality,
        toCardinality: relationship.toCardinality,
        line: relationship.line,
      };
    },
  );

  // Back into the model's own order — outermost first, which is the order
  // they are drawn in so that an inner frame is painted over its parent. A
  // block's box is its frame, as the core placed it, and its title goes
  // where the core put it across the band.
  const subgraphs = model.subgraphs.map(
    (subgraph): PositionedErSubgraph => ({
      id: subgraph.id,
      ...placedFrame(boxById.get(subgraph.id)!, subgraph.label, titleBoxById.get(subgraph.id)!),
      // Written onto the cluster under the generated id `buildErModel`
      // rewrote the author's block name to, and never inherited by a nested
      // frame — measured, mermaid 12.2.0 paints only the cluster the
      // statement named.
      style: subgraph.style ?? { frame: [], text: [] },
    }),
  );

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
