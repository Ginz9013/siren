import type {
  ErAttribute,
  ErAttributeColumn,
  ErModel,
  LabelBox,
  LayoutOptions,
  Point,
  PositionedErDiagram,
  PositionedErEntity,
  PositionedErAttributeCell,
  PositionedErAttributeTable,
  PositionedErRelationship,
  PositionedErSubgraph,
  ResolvedErEntity,
  ResolvedErSubgraph,
} from "../contracts";
import { layoutLabel } from "../label/layoutLabel";
import type { DirectedGraphLayoutNodeBox } from "./layoutDirectedGraph";
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
  /** Each relationship's label as `layoutLabel` measured it, by the relationship's id. */
  const relationshipLabelBoxById = new Map(
    model.relationships.map(
      (relationship) =>
        [relationship.id, layoutLabel(relationship.label, options.measureText)] as const,
    ),
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
    nodes: [
      // **The clusters first, and that ordering is the engine's**: a
      // cluster has to exist before a node can name it as `parentId`.
      //
      // The size handed in is the frame's title strip and nothing more,
      // because the engine discards it: a cluster with no directed ancestor
      // is grown from its children outright, and one that has a directed
      // ancestor comes back at exactly the size it was given with its
      // members outside it (the table in `DirectedGraphLayoutNode.isCluster`
      // measures both). `subgraphFrames` below takes the union either way,
      // which is what makes the second case draw.
      //
      // `rankdir` is the block's own direction and `undefined` when it
      // declared none — deliberately not the document's. `rankdirFor` gives
      // a directionless cluster with a *directed* ancestor the graph's
      // rankdir, which is both Mermaid's meaning and what makes the engine
      // expand it; writing the document's direction in here would hand
      // every cluster one and lose that distinction (`01M2XJWM4`).
      ...model.subgraphs.map((subgraph) => {
        const label = layoutLabel(subgraph.label, options.measureText);
        return {
          id: subgraph.id,
          width: label.width + SUBGRAPH_PADDING * 2,
          height: label.height + SUBGRAPH_PADDING * 2,
          isCluster: true,
          ...(subgraph.parentId === null ? {} : { parentId: subgraph.parentId }),
          ...(subgraph.direction === null ? {} : { rankdir: subgraph.direction }),
        };
      }),
      ...model.entities.map((entity) => {
        const plan = planById.get(entity.id)!;
        return {
          id: entity.id,
          width: plan.width,
          height: plan.height,
          ...(entity.parentId === null ? {} : { parentId: entity.parentId }),
        };
      }),
    ],
    edges: model.relationships.map((relationship) => ({
      id: relationship.id,
      from: relationship.from,
      to: relationship.to,
      // Every ER relationship carries a label — measured, the `: label` is
      // required — so the core is always asked to hold the ranks apart for
      // one, and it reports back where that space ended up. Sized from
      // every row of the label (ADR-0015), so a `<br>` holds them further.
      label: relationshipLabelBoxById.get(relationship.id)!,
    })),
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

  const frames = subgraphFrames(model, boxById, options);

  // A frame grows outward — up for its title strip, out for its padding — so
  // it can reach above and left of the corner the core laid the graph out
  // from. Everything below is shifted by however far it did, rather than a
  // frame being drawn at a negative coordinate, which is off the canvas.
  // `Math.max(0, ...)` over an empty list is `0`, so a document with no
  // block shifts by nothing and every coordinate is the core's own number
  // untouched. `layoutGraph` does exactly this, one kind over.
  const shift = {
    x: Math.max(0, ...frames.map((frame) => -frame.x)),
    y: Math.max(0, ...frames.map((frame) => -frame.y)),
  };
  const shifted = (point: Point): Point => ({ x: point.x + shift.x, y: point.y + shift.y });

  const entities: PositionedErEntity[] = model.entities.map((entity) => {
    const placed = boxById.get(entity.id)!;
    const box = { ...placed, ...shifted(placed) };
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
        points: route.points.map(shifted),
        label:
          route.labelAnchor === undefined
            ? null
            : {
                label: relationship.label,
                box: relationshipLabelBoxById.get(relationship.id)!,
                anchor: shifted(route.labelAnchor),
              },
      };
    },
  );

  const subgraphs = frames.map((frame) => ({
    ...frame,
    ...shifted(frame),
    labelAnchor: shifted(frame.labelAnchor),
  }));

  return {
    entities,
    relationships,
    subgraphs,
    timeline: model.timeline,
    // The core reports the extent of the graph *it* placed, which never
    // included the strip a frame grows upward for. Taking the larger of the
    // two keeps a frame from being clipped by the `<svg>` it is drawn in —
    // and with no blocks the second term is `0`, so the core's own numbers
    // come through unchanged.
    width: Math.max(laidOut.width + shift.x, ...subgraphs.map((s) => s.x + s.width)),
    height: Math.max(laidOut.height + shift.y, ...subgraphs.map((s) => s.y + s.height)),
    // Neither is drawn on the canvas, so neither takes part in the geometry
    // above — measured, a document writing both reports the same entity
    // table as one writing neither. They pass through for the renderer,
    // which puts them on the SVG root.
    accTitle: model.accTitle,
    accDescr: model.accDescr,
  };
}

/**
 * Each cluster's frame, in the shared core's own coordinate space.
 *
 * `layoutGraph`'s `subgraphFrames`, ported — the same figure with the same
 * padding, grown from the cluster box the core placed until it clears every
 * box it holds and has a strip along its top for its own title.
 *
 * ⚠️ **Taking the union with what the frame holds is required, not merely
 * conservative, and it is the load-bearing half of this function.** The
 * obvious reading — the core already sized the cluster to hold its children
 * — is false for a block nested inside one that declared a `direction`:
 * there the core hands the inner cluster back at *exactly the size it was
 * given*, never having sized it at all, with its members at coordinates
 * outside it (measured; see `isCluster` in `layoutDirectedGraph.ts`). Drop
 * the member boxes out of the four `Math.min`/`Math.max` calls as redundant
 * and that document draws the inner frame at the size of its own title bar
 * with every box it holds spilled outside it.
 *
 * Frames are grown **innermost first** so that a parent can clear the whole
 * of each frame beneath it, title strip included — the model lists clusters
 * in pre-order, so walking it backwards visits every child before its
 * parent.
 */
function subgraphFrames(
  model: ErModel,
  boxById: ReadonlyMap<string, DirectedGraphLayoutNodeBox>,
  options: LayoutOptions,
): PositionedErSubgraph[] {
  const memberIdsByParent = new Map<string, string[]>();
  for (const entity of model.entities) {
    if (entity.parentId === null) continue;
    memberIdsByParent.set(entity.parentId, [
      ...(memberIdsByParent.get(entity.parentId) ?? []),
      entity.id,
    ]);
  }

  const frameById = new Map<string, PositionedErSubgraph>();

  for (const subgraph of [...model.subgraphs].reverse()) {
    // Every row of the title, stacked: a `<br>` in it makes the strip taller
    // (ADR-0015).
    const label = layoutLabel(subgraph.label, options.measureText);
    const cluster = boxById.get(subgraph.id)!;

    const held: { x: number; y: number; width: number; height: number }[] = [
      ...(memberIdsByParent.get(subgraph.id) ?? []).map((id) => boxById.get(id)!),
      ...model.subgraphs
        .filter((child: ResolvedErSubgraph) => child.parentId === subgraph.id)
        .map((child) => frameById.get(child.id)!),
    ];

    const left = Math.min(cluster.x, ...held.map((box) => box.x - SUBGRAPH_PADDING));
    const top = Math.min(
      cluster.y,
      // The title strip: padding, the title line, then padding again before
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
  return model.subgraphs.map((subgraph) => frameById.get(subgraph.id)!);
}
