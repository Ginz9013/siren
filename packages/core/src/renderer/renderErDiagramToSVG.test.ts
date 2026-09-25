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
  subgraphs: PositionedErDiagram["subgraphs"] = [],
): PositionedErDiagram => ({
  entities,
  relationships,
  subgraphs,
  timeline: { totalSteps: 0, entries: [] },
  accTitle: null,
  accDescr: null,
  ...bounds,
});

const CUSTOMER = {
  id: "CUSTOMER",
  label: "CUSTOMER",
  x: 10,
  y: 20,
  width: 92,
  height: 40,
  style: { frame: [], text: [] },
  attributeTable: null,
};
const ORDER = {
  id: "ORDER",
  label: "ORDER",
  x: 10,
  y: 200,
  width: 92,
  height: 40,
  style: { frame: [], text: [] },
  attributeTable: null,
};

/**
 * `CUSTOMER` with one attribute, `string c UK,PK`, and every coordinate
 * written out rather than computed.
 *
 * The name row is the band from `y` (20) to `headerDividerY` (60); the one
 * attribute row runs from there to the box's foot (140), so its cells sit
 * on its centre line at 100. The three drawn columns start at 10, 70 and
 * 130, and each cell's text starts half a padding in from its column's own
 * left edge. Writing the numbers out is the point: these tests are about
 * what the renderer does with the layout's geometry, and a fixture that
 * recomputed it could not tell a misplaced cell from a correct one.
 */
const WITH_ATTRIBUTES = {
  id: "CUSTOMER",
  label: "CUSTOMER",
  x: 10,
  y: 20,
  width: 180,
  height: 120,
  style: { frame: [], text: [] },
  attributeTable: {
    headerDividerY: 60,
    columnDividerXs: [70, 130],
    rows: [
      {
        cells: [
          { column: "type" as const, text: "string", x: 17, y: 100 },
          { column: "name" as const, text: "c", x: 77, y: 100 },
          { column: "keys" as const, text: "UK,PK", x: 137, y: 100 },
        ],
      },
    ],
  },
};

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
  id: "CUSTOMER:ORDER",
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

  it("draws a name-row text that an alias's own punctuation cannot escape out of", () => {
    // An **alias** is what makes this reachable in the name row: an entity
    // *name* is `([^\x00-\x7F]|\w|-|\*|\.)+` and can hold none of these, but
    // an alias is a quoted run of anything but a quote — measured,
    // `A["a & b <c> d"]` reports exactly that alias, so the characters an
    // SVG serializer has to escape are ordinary text here.
    //
    // Asserted on the **serialized** markup, not on `textContent`, because
    // that is where the defect would show: a label built by writing markup
    // would put a `<c>` element into the picture, and reading `textContent`
    // back would report the characters either way.
    const ALIASED = { ...CUSTOMER, label: "a & b <c> d" };
    const svg = renderErDiagramToSVG(diagram([ALIASED]));

    const label = svg.querySelector("text.siren-er-entity-label");
    expect(label?.textContent).toBe("a & b <c> d");
    expect(label?.children).toHaveLength(0);
    expect(new XMLSerializer().serializeToString(svg)).toContain("a &amp; b &lt;c&gt; d");
  });

  it("draws every attribute cell where the layout put it, and the rules between them", () => {
    // Measured (mermaid 11.17.2, `--markup`): an entity with attributes is
    // drawn as a table — the name on its own row, a full-width rule under
    // it, one vertical rule at each internal column boundary, and the four
    // fields left-aligned in their columns. Every coordinate here is the
    // layout's, so this test is about *what the renderer does with them*:
    // a cell drawn somewhere other than where it was placed reads perfectly
    // well and points at the wrong column.
    const svg = renderErDiagramToSVG(diagram([WITH_ATTRIBUTES]));

    const cells = Array.from(svg.querySelectorAll("text.siren-er-attribute")).map(
      (text) => [
        text.getAttribute("class"),
        text.textContent,
        Number(text.getAttribute("x")),
        Number(text.getAttribute("y")),
      ],
    );
    expect(cells).toEqual([
      ["siren-er-attribute siren-er-attribute-type", "string", 17, 100],
      ["siren-er-attribute siren-er-attribute-name", "c", 77, 100],
      ["siren-er-attribute siren-er-attribute-keys", "UK,PK", 137, 100],
    ]);
    // Left-aligned, not centred: a column of types reads as a column only
    // if every cell starts at the same x, and `x` is the text's left edge.
    for (const text of Array.from(svg.querySelectorAll("text.siren-er-attribute"))) {
      expect(text.getAttribute("text-anchor")).toBe("start");
    }

    // Three rules: the full-width one under the name row, and one at each
    // of the two internal column boundaries. The vertical ones start at the
    // name row's foot rather than at the box's top — a rule drawn through
    // the name row would cut the entity's own name in three.
    const rules = Array.from(svg.querySelectorAll("line.siren-er-entity-divider")).map(
      (line) =>
        ["x1", "y1", "x2", "y2"].map((name) => Number(line.getAttribute(name))),
    );
    expect(rules).toEqual([
      [10, 60, 190, 60],
      [70, 60, 70, 140],
      [130, 60, 130, 140],
    ]);
  });

  it("centres the name in the name row when the box carries a table, not in the box", () => {
    // The silent defect one figure over: a name centred in the *box* draws
    // with no diagnostic anywhere and lands on top of the attribute rows.
    // So the name is asked to sit above the rule, which is exactly the band
    // Mermaid gives it (measured with `--markup`: `.label.name` is
    // translated to the top of the shape, above every `.attribute-*` label).
    const svg = renderErDiagramToSVG(diagram([WITH_ATTRIBUTES]));

    const label = svg.querySelector("text.siren-er-entity-label");
    expect(label?.textContent).toBe("CUSTOMER");
    expect(Number(label?.getAttribute("y"))).toBeLessThan(
      WITH_ATTRIBUTES.attributeTable.headerDividerY,
    );
    expect(Number(label?.getAttribute("y"))).toBeGreaterThan(WITH_ATTRIBUTES.y);

    // An entity with no table keeps the centre of the whole box, which is
    // the picture Mermaid draws for it.
    const plain = renderErDiagramToSVG(diagram([CUSTOMER]));
    expect(Number(plain.querySelector("text.siren-er-entity-label")?.getAttribute("y"))).toBe(
      CUSTOMER.y + CUSTOMER.height / 2,
    );
    expect(plain.querySelectorAll("line.siren-er-entity-divider")).toHaveLength(0);
    expect(plain.querySelectorAll("text.siren-er-attribute")).toHaveLength(0);
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
    expect(group?.getAttribute("data-siren-id")).toBe("CUSTOMER:ORDER");
    expect(group?.querySelector("path.siren-er-relationship-line")).not.toBeNull();
    expect(group?.querySelector("text.siren-er-relationship-label")).not.toBeNull();
  });

  it("draws an empty document as an empty picture rather than throwing", () => {
    const svg = renderErDiagramToSVG(diagram([], { width: 0, height: 0 }));

    expect(svg.querySelectorAll("g.siren-er-entity")).toHaveLength(0);
    expect(svg.getAttribute("viewBox")).toBe("0 0 0 0");
  });

  it("puts the accessible title in a <title> and the description in a <desc>, each wired to the root", () => {
    // **Measured for this kind, not carried over from either of the two
    // arrangements already in this repo.** Real mermaid 11.17.2 renders
    //
    //     erDiagram
    //       accTitle: Order book
    //       accDescr: how orders relate to customers
    //       CUSTOMER ||--o{ ORDER : places
    //
    // with `<title id="chart-title-…">Order book</title>` and
    // `<desc id="chart-desc-…">how orders relate to customers</desc>` as the
    // root's first two children, and `aria-labelledby` / `aria-describedby`
    // on the root naming those two ids — byte for byte the flowchart's
    // arrangement.
    const svg = renderErDiagramToSVG({
      ...diagram([CUSTOMER]),
      accTitle: "Order book",
      accDescr: "how orders relate to customers",
    });

    const title = svg.querySelector("title");
    const desc = svg.querySelector("desc");
    expect(title?.textContent).toBe("Order book");
    expect(desc?.textContent).toBe("how orders relate to customers");
    // Wired, rather than merely present: a `<title>` no `aria-labelledby`
    // points at is read by no screen reader, and the two assertions above
    // cannot tell that case from this one.
    expect(svg.getAttribute("aria-labelledby")).toBe(title?.getAttribute("id"));
    expect(svg.getAttribute("aria-describedby")).toBe(desc?.getAttribute("id"));
    expect(title?.getAttribute("id")).not.toBe(desc?.getAttribute("id"));

    // ⚠️ **No `role`.** Measured: mermaid puts `role="graphics-document
    // document"` on the ER root exactly as it does on a flowchart's, and
    // unconditionally — nothing to do with `accTitle` — and Siren draws that
    // attribute for no kind. `renderSequenceToSVG` writes `role="img"`,
    // which is neither what Mermaid does nor what this kind was measured to
    // need; it is an older unmeasured line and is deliberately not copied
    // here.
    expect(svg.getAttribute("role")).toBeNull();
  });

  it("draws neither element for a document that named neither", () => {
    // `null` has to mean "draw nothing": an empty `<title>` would be read
    // aloud as an unnamed figure, which is worse than no title at all.
    const svg = renderErDiagramToSVG(diagram([CUSTOMER]));

    expect(svg.querySelector("title")).toBeNull();
    expect(svg.querySelector("desc")).toBeNull();
    expect(svg.getAttribute("aria-labelledby")).toBeNull();
    expect(svg.getAttribute("aria-describedby")).toBeNull();
  });

  it("draws each of the two independently of the other", () => {
    // Two statements, two stores, two aria attributes — so a document
    // writing only one must get only that one. Asserted both ways round
    // because the single most likely defect is one `if` guarding both,
    // which passes every test that writes both.
    const titleOnly = renderErDiagramToSVG({ ...diagram([CUSTOMER]), accTitle: "T" });
    expect(titleOnly.querySelector("title")?.textContent).toBe("T");
    expect(titleOnly.querySelector("desc")).toBeNull();
    expect(titleOnly.getAttribute("aria-describedby")).toBeNull();

    const descrOnly = renderErDiagramToSVG({ ...diagram([CUSTOMER]), accDescr: "D" });
    expect(descrOnly.querySelector("desc")?.textContent).toBe("D");
    expect(descrOnly.querySelector("title")).toBeNull();
    expect(descrOnly.getAttribute("aria-labelledby")).toBeNull();
  });
});

describe("renderErDiagramToSVG writes the author's declarations onto the elements they are about", () => {
  /** The `style` attribute of the one element matching `selector` inside `id`'s group. */
  const styleOf = (svg: SVGSVGElement, id: string, selector: string) =>
    svg
      .querySelector(`g.siren-er-entity[data-siren-id="${id}"] ${selector}`)
      ?.getAttribute("style") ?? null;

  const STYLED = {
    ...WITH_ATTRIBUTES,
    style: {
      frame: [
        { property: "fill", value: "#f96" },
        { property: "stroke", value: "#333" },
      ],
      text: [{ property: "fill", value: "#fff" }],
    },
  };

  it("puts the frame's declarations on the drawn rect and the text's on the name", () => {
    // ⚠️ On the drawn shape, never on the enclosing `<g>` — ADR-0008's
    // cascade reason, and the mutation this row exists to catch: the theme
    // styles `.siren-er-entity-frame` and `.siren-er-entity-label`
    // directly, so an inline declaration on those elements outranks it
    // without `!important`, while the same declaration on the `<g>` would
    // only ever be *inherited* and so would lose. Moving it leaves every
    // diagnostic empty and the declaration present in the markup.
    const svg = renderErDiagramToSVG(diagram([STYLED]));

    expect(styleOf(svg, "CUSTOMER", "rect.siren-er-entity-frame")).toBe(
      "fill:#f96;stroke:#333",
    );
    expect(styleOf(svg, "CUSTOMER", "text.siren-er-entity-label")).toBe("fill:#fff");
    expect(
      svg.querySelector('g.siren-er-entity[data-siren-id="CUSTOMER"]')?.getAttribute("style"),
    ).toBeNull();
  });

  it("paints every attribute cell with the author's text declarations, not just the name", () => {
    // Measured with `--markup` (mermaid 11.17.2): `classDef u fill:#000,
    // color:#fff` applied to an entity with a `string n` row puts
    // `style="fill:#fff !important"` on the `<text>` of the name **and** of
    // every `attribute-type` / `attribute-name` / `attribute-keys` /
    // `attribute-comment` label. A `class` names the entity and not one of
    // its rows.
    const svg = renderErDiagramToSVG(diagram([STYLED]));
    const cells = Array.from(
      svg.querySelectorAll('g.siren-er-entity[data-siren-id="CUSTOMER"] text.siren-er-attribute'),
    );

    // The fixture's row is `string c UK,PK` — three columns drawn, so three
    // cells, and the list asserted whole so that dropping the last one is
    // caught rather than passing on the two that remain.
    expect(cells.map((cell) => cell.textContent)).toEqual(["string", "c", "UK,PK"]);
    expect(cells.map((cell) => cell.getAttribute("style"))).toEqual([
      "fill:#fff",
      "fill:#fff",
      "fill:#fff",
    ]);
    // The frame's half stays off the text: `fill:#f96` on a cell would
    // repaint the letters the box's colour and hide them.
    expect(cells.every((cell) => !cell.getAttribute("style")?.includes("#f96"))).toBe(true);
  });

  it("writes no `style` attribute at all for an entity the author styled with nothing", () => {
    // The empty pair is a state, not an absence: an element carrying
    // `style=""` is a different document from one carrying none, and the
    // theme is what should be reaching these elements.
    const svg = renderErDiagramToSVG(diagram([WITH_ATTRIBUTES]));

    expect(styleOf(svg, "CUSTOMER", "rect.siren-er-entity-frame")).toBeNull();
    expect(styleOf(svg, "CUSTOMER", "text.siren-er-entity-label")).toBeNull();
    expect(styleOf(svg, "CUSTOMER", "text.siren-er-attribute")).toBeNull();
  });
});

/**
 * A cluster's frame, drawn as the same two elements Mermaid draws it with —
 * measured with `--markup`, an ER `subgraph` comes out a `g.cluster` holding
 * a `<rect>` and a `g.cluster-label`.
 *
 * `data-siren-id` goes on the group and on neither part, which is what makes
 * a cluster a timeline target: ADR-0009 resolves a target to *every* element
 * carrying its id, and the frame and its title are two elements of one
 * thing. The id is the generated `subgraph:1`, never the author's word.
 */
describe("renderErDiagramToSVG draws subgraph clusters", () => {
  const FRAME = {
    id: "subgraph:1",
    label: "sales",
    x: 4,
    y: 6,
    width: 200,
    height: 120,
    labelAnchor: { x: 104, y: 20 },
  };

  it("draws a frame and its title under one addressable group", () => {
    const svg = renderErDiagramToSVG(
      diagram([CUSTOMER], { width: 400, height: 200 }, [], [FRAME]),
    );

    const group = svg.querySelector("g.siren-er-subgraph");
    expect(group).not.toBeNull();
    expect(group?.getAttribute("data-siren-id")).toBe("subgraph:1");

    const frame = group?.querySelector("rect.siren-er-subgraph-frame");
    expect(frame?.getAttribute("x")).toBe("4");
    expect(frame?.getAttribute("y")).toBe("6");
    expect(frame?.getAttribute("width")).toBe("200");
    expect(frame?.getAttribute("height")).toBe("120");

    const title = group?.querySelector("text.siren-er-subgraph-label");
    expect(title?.textContent).toBe("sales");
    expect(title?.getAttribute("x")).toBe("104");
    expect(title?.getAttribute("y")).toBe("20");

    // Neither part carries an id of its own — one timeline entry moves the
    // frame and its title together.
    expect(frame?.hasAttribute("data-siren-id")).toBe(false);
    expect(title?.hasAttribute("data-siren-id")).toBe(false);
  });

  it("paints a frame behind the boxes it groups", () => {
    // SVG has no z-index, so the order elements are appended in *is* the
    // stacking. A frame drawn after the entity it holds would cover it.
    const svg = renderErDiagramToSVG(
      diagram([CUSTOMER], { width: 400, height: 200 }, [], [FRAME]),
    );

    const drawn = Array.from(svg.querySelectorAll("g.siren-er-subgraph, g.siren-er-entity"));
    expect(drawn.map((element) => element.getAttribute("class"))).toEqual([
      "siren-er-subgraph",
      "siren-er-entity",
    ]);
  });
});
