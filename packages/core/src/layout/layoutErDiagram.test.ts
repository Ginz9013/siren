import { describe, expect, it } from "vitest";
import type {
  ErAttribute,
  ErModel,
  Point,
  PositionedErAttributeTable,
  PositionedErDiagram,
  TextMeasurer,
} from "../contracts";
import { layoutErDiagram } from "./layoutErDiagram";

/** Deterministic fake measurer, the fixture pattern every layout test here uses. */
const fakeMeasurer: TextMeasurer = {
  measure(text: string) {
    return { width: text.length * 8, height: 24 };
  },
};

const options = { measureText: fakeMeasurer };

/** Width the fake measurer reports for `text` — the tests' independent yardstick. */
const measuredWidth = (text: string) => fakeMeasurer.measure(text).width;

const model = (...names: string[]): ErModel => ({
  direction: "TB",
  entities: names.map((name) => ({ id: name, label: name, attributes: [] })),
  relationships: [],
  timeline: { totalSteps: 0, entries: [] },
  accTitle: null,
  accDescr: null,
});

/** One entity carrying `attributes`, and nothing else in the diagram. */
const modelWithAttributes = (name: string, attributes: ErAttribute[]): ErModel => ({
  direction: "TB",
  entities: [{ id: name, label: name, attributes }],
  relationships: [],
  timeline: { totalSteps: 0, entries: [] },
  accTitle: null,
  accDescr: null,
});

/**
 * The attribute table the layout planned for `id`, or a thrown explanation
 * naming what it planned instead — narrowed once here, so no test below
 * reaches for `table!`.
 */
const tableOf = (laidOut: PositionedErDiagram, id: string): PositionedErAttributeTable => {
  const entity = laidOut.entities.find((candidate) => candidate.id === id);
  if (entity === undefined) throw new Error(`no entity "${id}" was placed`);
  if (entity.attributeTable === null) {
    throw new Error(`entity "${id}" was given no attribute table`);
  }
  return entity.attributeTable;
};

/** One row of the table as `column=text` pairs, left to right by where they were placed. */
const rowTexts = (table: PositionedErAttributeTable, index: number): string[] =>
  [...table.rows[index].cells]
    .sort((a, b) => a.x - b.x)
    .map((cell) => `${cell.column}=${cell.text}`);

/**
 * A model of exactly the two entities `relationship` joins.
 *
 * Every relationship written in this file is **asymmetric** — one end
 * `onlyOne`, the other `zeroOrMore` — because the three symmetric pairs
 * (`||--||`, `}|--|{`, `|o--o|`) pass just as well with the two sides
 * swapped, which is the one defect these tests exist to catch.
 */
const relating = (relationship: ErModel["relationships"][number]): ErModel => ({
  direction: "TB",
  entities: [relationship.from, relationship.to].map((id) => ({
    id,
    label: id,
    attributes: [],
  })),
  relationships: [relationship],
  timeline: { totalSteps: 0, entries: [] },
  accTitle: null,
  accDescr: null,
});

const CUSTOMER_PLACES_ORDER: ErModel["relationships"][number] = {
  id: "CUSTOMER:ORDER",
  from: "CUSTOMER",
  to: "ORDER",
  fromCardinality: "onlyOne",
  toCardinality: "zeroOrMore",
  line: "identifying",
  label: "places",
};

/** The box `id` was placed in, as edges rather than a corner plus a size. */
const boxOf = (entities: PositionedErDiagram["entities"], id: string) => {
  const entity = entities.find((candidate) => candidate.id === id);
  if (entity === undefined) throw new Error(`no entity "${id}" was placed`);
  return {
    left: entity.x,
    right: entity.x + entity.width,
    top: entity.y,
    bottom: entity.y + entity.height,
  };
};

/**
 * Where the layout put `id`'s label, or a thrown explanation instead —
 * narrowing once here rather than a vacuous `not.toBeNull()` at each use.
 */
const labelAnchorOf = (laidOut: PositionedErDiagram, id: string): Point => {
  const relationship = laidOut.relationships.find((candidate) => candidate.id === id);
  if (relationship === undefined) throw new Error(`no relationship "${id}" was routed`);
  if (relationship.labelAnchor === null) {
    throw new Error(`relationship "${id}" reserved no room for its label`);
  }
  return relationship.labelAnchor;
};

/** Whether `point` is inside `box` or on its boundary. */
const touches = (
  box: { left: number; right: number; top: number; bottom: number },
  point: { x: number; y: number },
) => point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;

describe("layoutErDiagram", () => {
  it("makes every box wide enough for the label it holds, and wider for a longer name", () => {
    // Stated as a relation to what the measurer reported rather than as a
    // pixel count: the padding is Siren's (ADR-0004) and may be retuned, but
    // a box narrower than its own text is a box with the name spilling out
    // of it whatever the padding is. The *difference* between the two boxes
    // is the measured difference between the two strings, which is what says
    // the label was measured at all rather than every box given one size.
    const { entities } = layoutErDiagram(model("CUSTOMER", "LINE-ITEM"), options);

    const [customer, lineItem] = entities;
    expect(customer.width).toBeGreaterThan(measuredWidth("CUSTOMER"));
    expect(lineItem.width - customer.width).toBe(
      measuredWidth("LINE-ITEM") - measuredWidth("CUSTOMER"),
    );
    expect(customer.height).toBeGreaterThan(fakeMeasurer.measure("CUSTOMER").height);
  });

  it("lays an attribute out as four columns in Mermaid's own order, under a name row", () => {
    // Measured (mermaid 11.17.2, `--markup`): an entity with attributes is
    // drawn as a table — the name on a row of its own at the top, a rule
    // under it, and then one row per attribute whose four labels carry the
    // classes `attribute-type`, `attribute-name`, `attribute-keys` and
    // `attribute-comment`, placed left to right at rising x in that order.
    // The keys cell is `attribute.keys.join()` — the list re-joined with a
    // comma, which is why `UK,PK` reads back as it was written even though
    // the model holds two of them.
    const laidOut = layoutErDiagram(
      modelWithAttributes("CUSTOMER", [
        { type: "int", name: "age", keys: ["PK"], comment: "the age" },
        { type: "string", name: "c", keys: ["UK", "PK"], comment: "both" },
      ]),
      options,
    );
    const table = tableOf(laidOut, "CUSTOMER");

    expect(rowTexts(table, 0)).toEqual([
      "type=int",
      "name=age",
      "keys=PK",
      "comment=the age",
    ]);
    expect(rowTexts(table, 1)).toEqual([
      "type=string",
      "name=c",
      "keys=UK,PK",
      "comment=both",
    ]);

    // The name row is a band of its own above every attribute: the rule
    // under the name sits inside the box, and every cell below it.
    const box = boxOf(laidOut.entities, "CUSTOMER");
    expect(table.headerDividerY).toBeGreaterThan(box.top);
    expect(table.headerDividerY).toBeLessThan(box.bottom);
    for (const row of table.rows) {
      for (const cell of row.cells) {
        expect(cell.y, `${cell.column} sits below the name row`).toBeGreaterThan(
          table.headerDividerY,
        );
      }
    }

    // An entity that declared none gets no table at all — the plain
    // labelled rectangle Mermaid draws for it (`rect.basic.label-container`
    // with the name inside), not an empty one.
    expect(layoutErDiagram(model("ORDER"), options).entities[0].attributeTable).toBeNull();
  });

  it("drops the keys and comment columns an entity wrote nothing in", () => {
    // Measured from Mermaid's own `erBox` renderer: `maxKeysWidth <= PADDING`
    // sets `keysPresent = false`, which zeroes the column's width *and*
    // skips the divider that would have bounded it; `commentPresent` does
    // the same for the last column. So an entity of plain `type name` pairs
    // is drawn as two columns and one rule, not four columns of which two
    // are blank.
    //
    // ⚠️ This is the one question `--markup` cannot answer. The probe's
    // `getBBox` stub reports a constant width 40 for *every* label, empty
    // ones included, so both flags come back true there whatever the
    // document says — the stub's answer, not Mermaid's.
    const plain = tableOf(
      layoutErDiagram(
        modelWithAttributes("E", [{ type: "string", name: "a", keys: [], comment: "" }]),
        options,
      ),
      "E",
    );
    expect(rowTexts(plain, 0)).toEqual(["type=string", "name=a"]);
    expect(plain.columnDividerXs).toHaveLength(1);

    // Keys but no comment: three columns, two rules. The dropped column is
    // the *last* one, so this also says the comment column is not simply
    // being drawn empty at the end.
    const keyed = tableOf(
      layoutErDiagram(
        modelWithAttributes("E", [
          { type: "string", name: "a", keys: [], comment: "" },
          { type: "int", name: "b", keys: ["FK"], comment: "" },
        ]),
        options,
      ),
      "E",
    );
    expect(rowTexts(keyed, 0)).toEqual(["type=string", "name=a", "keys="]);
    expect(rowTexts(keyed, 1)).toEqual(["type=int", "name=b", "keys=FK"]);
    expect(keyed.columnDividerXs).toHaveLength(2);

    // A comment with no keys anywhere: the keys column goes and the comment
    // column stays, which is what says the two are decided independently
    // rather than by a count of how many columns are in use.
    const commented = tableOf(
      layoutErDiagram(
        modelWithAttributes("E", [
          { type: "string", name: "a", keys: [], comment: "why" },
        ]),
        options,
      ),
      "E",
    );
    expect(rowTexts(commented, 0)).toEqual(["type=string", "name=a", "comment=why"]);
    expect(commented.columnDividerXs).toHaveLength(2);
  });

  it("makes the box wide enough for the widest cell in every column", () => {
    // The defect this catches is silent: a box sized from its name alone
    // draws perfectly well and simply has its attribute text hanging out
    // past the frame, with no diagnostic anywhere. So every cell is asked
    // to start inside the frame and to have room for its own text before
    // the next column's rule — measured against the fake measurer, which is
    // the independent yardstick here.
    const laidOut = layoutErDiagram(
      modelWithAttributes("E", [
        {
          type: "averyverylongtypename",
          name: "andaverylongattributename",
          keys: ["PK", "FK", "UK"],
          comment: "a comment longer than everything else on this row",
        },
      ]),
      options,
    );
    const box = boxOf(laidOut.entities, "E");
    const table = tableOf(laidOut, "E");
    const boundaries = [...table.columnDividerXs, box.right];

    for (const [index, cell] of [...table.rows[0].cells]
      .sort((a, b) => a.x - b.x)
      .entries()) {
      expect(cell.x, `${cell.column} starts inside the frame`).toBeGreaterThan(box.left);
      expect(
        cell.x + fakeMeasurer.measure(cell.text).width,
        `${cell.column} ends before its column does`,
      ).toBeLessThanOrEqual(boundaries[index]);
    }

    // And the rules really are between the columns rather than heaped at
    // one edge: strictly rising, and all of them inside the frame.
    expect(table.columnDividerXs).toEqual([...table.columnDividerXs].sort((a, b) => a - b));
    for (const x of table.columnDividerXs) {
      expect(x).toBeGreaterThan(box.left);
      expect(x).toBeLessThan(box.right);
    }
  });

  it("puts entities with no relationship between them side by side, not stacked", () => {
    // Measured (mermaid 11.17.2, `--markup`): `erDiagram / CUSTOMER / ORDER`
    // draws the two boxes at `translate(28, 18)` and `translate(208, 18)` —
    // the **same y**, different x. Nothing joins them, so they share a rank
    // and run across the page. A column of boxes would be a different
    // picture from the one Mermaid draws.
    const { entities } = layoutErDiagram(model("CUSTOMER", "ORDER"), options);

    const [customer, order] = entities;
    expect(customer.y).toBe(order.y);
    expect(order.x).toBeGreaterThan(customer.x + customer.width);
  });

  it("routes a relationship from its own left entity to its own right one", () => {
    // **The side check, and the reason the cardinalities are asymmetric.**
    // Mermaid records a relationship's two cardinalities crossed (measured:
    // `CUSTOMER ||--o{ ORDER : places` reports `cardA="ZERO_OR_MORE"`, which
    // is the marker next to `ORDER`), so the failure this guards against is
    // a route drawn ORDER-to-CUSTOMER carrying the markers the other way
    // round. Asserting which end of the route touches which box is what
    // sees it; a `||--||` source could not.
    const { entities, relationships } = layoutErDiagram(
      relating(CUSTOMER_PLACES_ORDER),
      options,
    );

    const [route] = relationships;
    expect(route.id).toBe("CUSTOMER:ORDER");
    expect(route.points.length).toBeGreaterThanOrEqual(2);
    expect(
      touches(boxOf(entities, "CUSTOMER"), route.points[0]),
      "the route starts at CUSTOMER, the entity the left marker belongs to",
    ).toBe(true);
    expect(
      touches(boxOf(entities, "ORDER"), route.points[route.points.length - 1]),
      "the route ends at ORDER, the entity the right marker belongs to",
    ).toBe(true);
    // And the markers travel with the ends rather than being re-derived.
    expect([route.fromCardinality, route.toCardinality, route.line]).toEqual([
      "onlyOne",
      "zeroOrMore",
      "identifying",
    ]);
  });

  it("stacks two entities a relationship joins, where two unrelated ones sit side by side", () => {
    // The observable difference between an ER diagram with a relationship
    // and one without: measured with `--markup`, two unrelated entities
    // share a rank and run across the page (`translate(28, 18)` and
    // `translate(208, 18)`), while a relationship puts them on consecutive
    // ranks. Without this the relationship could be routed as a
    // zero-length line between two boxes that never moved apart.
    const { entities } = layoutErDiagram(relating(CUSTOMER_PLACES_ORDER), options);

    const customer = boxOf(entities, "CUSTOMER");
    const order = boxOf(entities, "ORDER");
    expect(order.top).toBeGreaterThanOrEqual(customer.bottom);
  });

  it("reserves room for a relationship's label and reports where it goes", () => {
    // The label is not optional in ER — measured, `CUSTOMER ||--o{ ORDER`
    // with no colon is a Mermaid parse error — so every relationship has
    // one, and the space for it has to come out of the gap between the
    // ranks rather than being painted over a box.
    //
    // Stated against the measurer's own answers rather than against pixel
    // counts (ADR-0004), and the taller measurer is what says the label was
    // measured at all: a layout that reserved a fixed gap, or none, gives
    // the same answer for both.
    const tall: TextMeasurer = { measure: (text) => ({ width: text.length * 8, height: 96 }) };
    const shortLabel = layoutErDiagram(relating(CUSTOMER_PLACES_ORDER), options);
    const tallLabel = layoutErDiagram(relating(CUSTOMER_PLACES_ORDER), {
      measureText: tall,
    });

    const gapFor = (laidOut: PositionedErDiagram) =>
      boxOf(laidOut.entities, "ORDER").top - boxOf(laidOut.entities, "CUSTOMER").bottom;
    expect(gapFor(shortLabel)).toBeGreaterThanOrEqual(
      fakeMeasurer.measure("places").height,
    );
    expect(gapFor(tallLabel) - gapFor(shortLabel)).toBeGreaterThanOrEqual(
      tall.measure("places").height - fakeMeasurer.measure("places").height,
    );

    // And it is reported somewhere on the way between the two boxes, not at
    // the origin: a label drawn at (0, 0) still has the right characters in
    // it.
    const anchor = labelAnchorOf(shortLabel, "CUSTOMER:ORDER");
    expect(anchor.y).toBeGreaterThan(boxOf(shortLabel.entities, "CUSTOMER").top);
    expect(anchor.y).toBeLessThan(boxOf(shortLabel.entities, "ORDER").bottom);
  });

  it("carries each entity's id and drawn label through untouched", () => {
    const { entities } = layoutErDiagram(model("CUSTOMER"), options);

    expect(entities.map((entity) => [entity.id, entity.label])).toEqual([
      ["CUSTOMER", "CUSTOMER"],
    ]);
  });

  it("reports bounds that enclose every box it placed", () => {
    const { entities, width, height } = layoutErDiagram(
      model("CUSTOMER", "ORDER", "LINE-ITEM"),
      options,
    );

    for (const entity of entities) {
      expect(entity.x, entity.id).toBeGreaterThanOrEqual(0);
      expect(entity.y, entity.id).toBeGreaterThanOrEqual(0);
      expect(entity.x + entity.width, entity.id).toBeLessThanOrEqual(width);
      expect(entity.y + entity.height, entity.id).toBeLessThanOrEqual(height);
    }
  });

  it("ranks the diagram along the direction the model names", () => {
    // **Asserted by comparing coordinates, and it has to be.** A direction
    // read and dropped is the silent defect this construct exists to avoid:
    // every diagnostic stays empty, a picture is still drawn, and only where
    // the two boxes ended up says whether the author was obeyed.
    //
    // A relationship puts the two entities on consecutive ranks, so the axis
    // they are separated along *is* the direction, and the order along it is
    // its sign. `TB` and `LR` are checked against their own opposites rather
    // than against each other, so a layout that ignored the field and always
    // ranked downward fails the `LR` pair, and one that swapped a sign fails
    // the `BT`/`RL` pair.
    const placed = (direction: ErModel["direction"]) => {
      const laidOut = layoutErDiagram(
        { ...relating(CUSTOMER_PLACES_ORDER), direction },
        options,
      );
      return {
        customer: boxOf(laidOut.entities, "CUSTOMER"),
        order: boxOf(laidOut.entities, "ORDER"),
      };
    };

    const topToBottom = placed("TB");
    expect(topToBottom.customer.bottom).toBeLessThanOrEqual(topToBottom.order.top);

    const bottomToTop = placed("BT");
    expect(bottomToTop.order.bottom).toBeLessThanOrEqual(bottomToTop.customer.top);

    const leftToRight = placed("LR");
    expect(leftToRight.customer.right).toBeLessThanOrEqual(leftToRight.order.left);

    const rightToLeft = placed("RL");
    expect(rightToLeft.order.right).toBeLessThanOrEqual(rightToLeft.customer.left);

    // And the two axes really are different pictures: under `LR` the boxes
    // share a band of rows, which under `TB` they cannot. Without this, a
    // layout that placed everything on one diagonal would satisfy all four
    // inequalities above.
    expect(leftToRight.customer.top).toBeLessThan(leftToRight.order.bottom);
    expect(leftToRight.order.top).toBeLessThan(leftToRight.customer.bottom);
  });

  it("gives a header-only document finite bounds and no boxes", () => {
    // Measured: `erDiagram` alone is not an error in Mermaid — it reports the
    // diagram type with an empty entity table. So this document reaches
    // layout, and what it must not produce is a `NaN` width: the `<svg>`
    // root's width, height and viewBox are computed from these, and `NaN`
    // there is not a wrong picture but an absent one.
    const { entities, width, height } = layoutErDiagram(model(), options);

    expect(entities).toEqual([]);
    expect(Number.isFinite(width)).toBe(true);
    expect(Number.isFinite(height)).toBe(true);
  });
});

describe("layoutErDiagram carries the timeline", () => {
  it("hands the resolved timeline through to the positioned diagram unchanged", () => {
    // Layout places boxes and routes lines; it decides nothing about
    // animation. The timeline was resolved once, against the ids
    // `buildErModel` assigned, and anything re-derived here would be a
    // second answer to a settled question — so this asserts *identity*, not
    // equality: a copy would pass a deep comparison while still being a
    // second object for a future stage to disagree with.
    const resolved: ErModel["timeline"] = {
      totalSteps: 2,
      entries: [
        { kind: "enter", step: 1, targetId: "CUSTOMER", effect: "fade" },
        { kind: "enter", step: 2, targetId: "CUSTOMER:ORDER", effect: "fade" },
      ],
    };

    const laidOut = layoutErDiagram(
      { ...relating(CUSTOMER_PLACES_ORDER), timeline: resolved },
      options,
    );

    expect(laidOut.timeline).toBe(resolved);
  });

  it("carries the accessible title and description to the positioned diagram", () => {
    // Neither takes any space on the canvas — measured, the document that
    // writes both reports the same entity table as the one that writes
    // neither — so layout has nothing to place and only has to hand them on
    // to the renderer, which is the one stage that draws them.
    const laidOut = layoutErDiagram(
      { ...model("CUSTOMER"), accTitle: "Order book", accDescr: "how orders relate" },
      options,
    );

    expect(laidOut.accTitle).toBe("Order book");
    expect(laidOut.accDescr).toBe("how orders relate");
  });
});
