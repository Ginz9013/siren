import { describe, expect, it } from "vitest";
import type {
  ErCardinality,
  PositionedErDiagram,
  PositionedErRelationship,
} from "../contracts";
import { renderErDiagramToSVG } from "./renderErDiagramToSVG";

const diagram = (
  entities: PositionedErDiagram["entities"],
  bounds: { width: number; height: number } = { width: 400, height: 100 },
  relationships: PositionedErRelationship[] = [],
): PositionedErDiagram => ({
  entities,
  relationships,
  timeline: { totalSteps: 0, entries: [] },
  ...bounds,
});

const CUSTOMER = { id: "CUSTOMER", label: "CUSTOMER", x: 10, y: 20, width: 92, height: 40 };
const ORDER = { id: "ORDER", label: "ORDER", x: 10, y: 200, width: 92, height: 40 };

/**
 * `CUSTOMER ||--o{ ORDER : places`, routed downward.
 *
 * **Asymmetric, always.** `||--||`, `}|--|{` and `|o--o|` are the three
 * pairs a swapped implementation still draws correctly, so no test in this
 * file uses one: the marker at the `from` end and the marker at the `to`
 * end must be different for an assertion about *which side* to mean
 * anything.
 */
const PLACES: PositionedErRelationship = {
  id: "CUSTOMER-ORDER",
  from: "CUSTOMER",
  to: "ORDER",
  fromCardinality: "onlyOne",
  toCardinality: "zeroOrMore",
  line: "identifying",
  label: "places",
  points: [
    { x: 56, y: 60 },
    { x: 56, y: 200 },
  ],
  labelAnchor: { x: 56, y: 130 },
};

/** The `<marker>` `cardinality`'s figure is built in, or a thrown explanation. */
function markerFor(svg: SVGSVGElement, cardinality: ErCardinality): Element {
  const name = {
    onlyOne: "siren-er-only-one",
    zeroOrOne: "siren-er-zero-or-one",
    oneOrMore: "siren-er-one-or-more",
    zeroOrMore: "siren-er-zero-or-more",
  }[cardinality];
  const marker = svg.querySelector(`defs marker[id^="${name}"]`);
  if (marker === null) throw new Error(`no <marker> was defined for ${cardinality}`);
  return marker;
}

/**
 * How far out along the line each of a marker's glyphs sits, keyed by the
 * glyph's own class: `0` is the entity box's edge and a larger number is
 * further from it.
 *
 * This is the whole of what "which figure" means once the marker is drawn —
 * the glyphs it is built from and the order they run in — so it is read out
 * of the geometry rather than out of any attribute the renderer wrote for
 * the test's benefit. `refX` is the point the marker attaches by, so
 * `refX - x` is the distance outward.
 */
function glyphDistances(marker: Element): { bar: number[]; circle: number[]; foot: number[] } {
  const refX = Number(marker.getAttribute("refX"));
  const bar: number[] = [];
  const circle: number[] = [];
  const foot: number[] = [];
  for (const glyph of Array.from(marker.children)) {
    const className = glyph.getAttribute("class") ?? "";
    if (className.includes("siren-er-cardinality-bar")) {
      // A bar is one vertical stroke, so both its ends share an x.
      expect(glyph.getAttribute("x1")).toBe(glyph.getAttribute("x2"));
      bar.push(refX - Number(glyph.getAttribute("x1")));
    } else if (className.includes("siren-er-cardinality-circle")) {
      circle.push(refX - Number(glyph.getAttribute("cx")));
    } else if (className.includes("siren-er-cardinality-crows-foot")) {
      // The foot's nearest point to the box: the largest x in its path.
      const xs = Array.from(
        (glyph.getAttribute("d") ?? "").matchAll(/(-?[\d.]+),(-?[\d.]+)/g),
        (pair) => Number(pair[1]),
      );
      foot.push(refX - Math.max(...xs));
    }
  }
  return { bar, circle, foot };
}

describe("renderErDiagramToSVG", () => {
  it("sizes the root svg from the bounds layout reported", () => {
    const svg = renderErDiagramToSVG(diagram([CUSTOMER], { width: 400, height: 100 }));

    expect(svg.getAttribute("width")).toBe("400");
    expect(svg.getAttribute("height")).toBe("100");
    expect(svg.getAttribute("viewBox")).toBe("0 0 400 100");
  });

  it("draws one box per entity, at the box layout placed", () => {
    // Measured with `--markup` (mermaid 11.17.2): an entity is drawn as a
    // `rect.basic.label-container` — a plain rectangle carrying no `rx` — so
    // that is the figure, and its corner radius stays the theme's the way a
    // flowchart rectangle's does.
    const svg = renderErDiagramToSVG(diagram([CUSTOMER]));

    const frames = Array.from(svg.querySelectorAll("rect.siren-er-entity-frame"));
    expect(frames).toHaveLength(1);
    expect(
      ["x", "y", "width", "height"].map((name) => frames[0].getAttribute(name)),
    ).toEqual(["10", "20", "92", "40"]);
    // Not written inline, so a consumer redeclaring the theme's token can
    // actually round it — the argument ADR-0008 makes for a flowchart frame.
    expect(frames[0].getAttribute("rx")).toBeNull();
  });

  it("draws the entity's name inside its own box, not merely somewhere in the picture", () => {
    // The assertion that makes this a *picture* check rather than a text
    // check: a label drawn at the origin while its box sits elsewhere still
    // has the right characters in it.
    const svg = renderErDiagramToSVG(diagram([CUSTOMER]));

    const label = svg.querySelector("text.siren-er-entity-label");
    expect(label?.textContent).toBe("CUSTOMER");

    const x = Number(label?.getAttribute("x"));
    const y = Number(label?.getAttribute("y"));
    expect(x).toBeGreaterThan(CUSTOMER.x);
    expect(x).toBeLessThan(CUSTOMER.x + CUSTOMER.width);
    expect(y).toBeGreaterThan(CUSTOMER.y);
    expect(y).toBeLessThan(CUSTOMER.y + CUSTOMER.height);
  });

  it("puts each entity's id on its group, so a timeline entry can name it", () => {
    // ADR-0009: a timeline target is an id, and the id lands on the
    // enclosing `<g>` rather than on the parts inside it — the same place
    // `.siren-node`, `.siren-class` and `.siren-state` carry theirs, so one
    // controller drives an entity's box and its label together.
    const svg = renderErDiagramToSVG(
      diagram([CUSTOMER, { ...CUSTOMER, id: "ORDER", label: "ORDER", x: 150 }]),
    );

    const groups = Array.from(svg.querySelectorAll("g.siren-er-entity"));
    expect(groups.map((group) => group.getAttribute("data-siren-id"))).toEqual([
      "CUSTOMER",
      "ORDER",
    ]);
    // The frame and the label are inside the group that names them, which is
    // what makes the id reach both.
    for (const group of groups) {
      expect(group.querySelector("rect.siren-er-entity-frame")).not.toBeNull();
      expect(group.querySelector("text.siren-er-entity-label")).not.toBeNull();
    }
  });

  it("builds each of the four cardinalities out of the glyphs Mermaid builds it from", () => {
    // Measured from mermaid 11.17.2's own marker definitions, read back out
    // of a rendered ER diagram (`only_one`, `zero_or_one`, `one_or_more`,
    // `zero_or_more` in its marker table):
    //
    //   only_one     `M3,0 L3,18 M9,0 L9,18`                  two bars
    //   zero_or_one  `<circle r=6>` + `M21,0 L21,18`          bar, then a circle
    //   one_or_more  `M9,18 Q27,0 45,18 Q27,36 9,18` + a bar  foot, then a bar
    //   zero_or_more the same closed curve + `<circle r=6>`   foot, then a circle
    //
    // **The "crow's foot" is not three prongs**, which is the thing worth
    // measuring rather than inferring from the name: Mermaid draws it as a
    // closed almond of two quadratic curves, and that is the figure copied
    // here.
    //
    // The two glyphs decompose the value: the one touching the box says
    // *one* (bar) or *many* (foot), and the one further out says
    // *mandatory* (bar) or *optional* (circle). Asserting the distances
    // rather than a count is what pins that order — a marker with the
    // circle against the box and the bar outside it has the same parts and
    // is a different figure.
    const svg = renderErDiagramToSVG(diagram([CUSTOMER, ORDER], undefined, [PLACES]));

    const onlyOne = glyphDistances(markerFor(svg, "onlyOne"));
    expect(onlyOne.bar).toHaveLength(2);
    expect(onlyOne.circle).toEqual([]);
    expect(onlyOne.foot).toEqual([]);
    expect(onlyOne.bar[0]).not.toBe(onlyOne.bar[1]);

    const zeroOrOne = glyphDistances(markerFor(svg, "zeroOrOne"));
    expect([zeroOrOne.bar.length, zeroOrOne.circle.length, zeroOrOne.foot.length]).toEqual([
      1, 1, 0,
    ]);
    expect(zeroOrOne.bar[0]).toBeLessThan(zeroOrOne.circle[0]);

    const oneOrMore = glyphDistances(markerFor(svg, "oneOrMore"));
    expect([oneOrMore.bar.length, oneOrMore.circle.length, oneOrMore.foot.length]).toEqual([
      1, 0, 1,
    ]);
    expect(oneOrMore.foot[0]).toBeLessThan(oneOrMore.bar[0]);

    const zeroOrMore = glyphDistances(markerFor(svg, "zeroOrMore"));
    expect([zeroOrMore.bar.length, zeroOrMore.circle.length, zeroOrMore.foot.length]).toEqual([
      0, 1, 1,
    ]);
    expect(zeroOrMore.foot[0]).toBeLessThan(zeroOrMore.circle[0]);
  });

  it("hangs each marker on the end of the line the author wrote it against", () => {
    // ⚠️ **The one that catches a swap.** Mermaid records a relationship's
    // two cardinalities crossed — measured, `CUSTOMER ||--o{ ORDER : places`
    // reports `cardA="ZERO_OR_MORE"`, and that is the marker next to
    // `ORDER`, not next to `CUSTOMER`. Anything that reads them back in
    // field-name order puts `||` on ORDER and `o{` on CUSTOMER, and every
    // relationship in every diagram is then drawn backwards.
    //
    // Both halves are asserted, because either alone can be satisfied by a
    // swap: *which* marker is at each end of the path, and which *box* each
    // end of the path is at.
    const svg = renderErDiagramToSVG(diagram([CUSTOMER, ORDER], undefined, [PLACES]));

    const line = svg.querySelector("path.siren-er-relationship-line");
    if (line === null) throw new Error("no relationship line was drawn");

    const onlyOneId = markerFor(svg, "onlyOne").getAttribute("id");
    const zeroOrMoreId = markerFor(svg, "zeroOrMore").getAttribute("id");
    expect(line.getAttribute("marker-start")).toBe(`url(#${onlyOneId})`);
    expect(line.getAttribute("marker-end")).toBe(`url(#${zeroOrMoreId})`);

    // And `marker-start` really is the CUSTOMER end: the path runs from
    // CUSTOMER's box to ORDER's, in that direction.
    expect(line.getAttribute("d")).toBe("M56,60 L56,200");
    expect(CUSTOMER.y + CUSTOMER.height).toBe(60);
    expect(ORDER.y).toBe(200);
  });

  it("draws the two line types differently, and only one of them dashed", () => {
    // Measured: Mermaid gives an `IDENTIFYING` relationship the class
    // `edge-pattern-solid` and a `NON_IDENTIFYING` one `edge-pattern-dashed`,
    // whose rule in the stylesheet it emits is `stroke-dasharray: 8,8`. So
    // the difference between `--` and `..` is a dash and nothing else —
    // which means a renderer that ignored `line` would draw two documents
    // identically with no diagnostic to say so.
    const identifying = renderErDiagramToSVG(
      diagram([CUSTOMER, ORDER], undefined, [PLACES]),
    );
    const nonIdentifying = renderErDiagramToSVG(
      diagram([CUSTOMER, ORDER], undefined, [{ ...PLACES, line: "nonIdentifying" }]),
    );

    const dashOf = (svg: SVGSVGElement) =>
      svg.querySelector("path.siren-er-relationship-line")?.getAttribute("stroke-dasharray");
    expect(dashOf(identifying)).toBeNull();
    expect(dashOf(nonIdentifying)).toBe("8,8");
  });

  it("draws the relationship's label where the layout reserved room for it", () => {
    // Measured with a rendered ER diagram: Mermaid puts the role's
    // `<g class="edgeLabel">` at `translate(28, 78)` on a path running from
    // (28, 28) to (28, 128) — the middle of the line. Siren draws it at the
    // anchor the layout reports, which is the middle of the space the same
    // layout kept clear. Asserting the anchor rather than the mere presence
    // of the text is what makes this a picture check: a label drawn at the
    // origin still reads "places".
    const svg = renderErDiagramToSVG(diagram([CUSTOMER, ORDER], undefined, [PLACES]));

    const label = svg.querySelector("text.siren-er-relationship-label");
    expect(label?.textContent).toBe("places");
    expect(label?.getAttribute("x")).toBe("56");
    expect(label?.getAttribute("y")).toBe("130");
  });

  it("puts each relationship's id on its group, so a timeline entry can name it", () => {
    // ADR-0009 again: the id lands on the enclosing `<g>`, so one entry
    // moves a relationship's line, its markers and its label together.
    const svg = renderErDiagramToSVG(diagram([CUSTOMER, ORDER], undefined, [PLACES]));

    const group = svg.querySelector("g.siren-er-relationship");
    expect(group?.getAttribute("data-siren-id")).toBe("CUSTOMER-ORDER");
    expect(group?.querySelector("path.siren-er-relationship-line")).not.toBeNull();
    expect(group?.querySelector("text.siren-er-relationship-label")).not.toBeNull();
  });

  it("draws an empty document as an empty picture rather than throwing", () => {
    const svg = renderErDiagramToSVG(diagram([], { width: 0, height: 0 }));

    expect(svg.querySelectorAll("g.siren-er-entity")).toHaveLength(0);
    expect(svg.getAttribute("viewBox")).toBe("0 0 0 0");
  });
});
