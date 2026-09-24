import { describe, expect, it } from "vitest";
import type { ErModel, Point, PositionedErDiagram, TextMeasurer } from "../contracts";
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
  entities: names.map((name) => ({ id: name, label: name })),
  relationships: [],
  timeline: { totalSteps: 0, entries: [] },
});

/**
 * A model of exactly the two entities `relationship` joins.
 *
 * Every relationship written in this file is **asymmetric** — one end
 * `onlyOne`, the other `zeroOrMore` — because the three symmetric pairs
 * (`||--||`, `}|--|{`, `|o--o|`) pass just as well with the two sides
 * swapped, which is the one defect these tests exist to catch.
 */
const relating = (relationship: ErModel["relationships"][number]): ErModel => ({
  entities: [relationship.from, relationship.to].map((id) => ({ id, label: id })),
  relationships: [relationship],
  timeline: { totalSteps: 0, entries: [] },
});

const CUSTOMER_PLACES_ORDER: ErModel["relationships"][number] = {
  id: "CUSTOMER-ORDER",
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
    expect(route.id).toBe("CUSTOMER-ORDER");
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
    const anchor = labelAnchorOf(shortLabel, "CUSTOMER-ORDER");
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
