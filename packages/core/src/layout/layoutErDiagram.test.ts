import { describe, expect, it } from "vitest";
import type { ErModel, TextMeasurer } from "../contracts";
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
  timeline: { totalSteps: 0, entries: [] },
});

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
