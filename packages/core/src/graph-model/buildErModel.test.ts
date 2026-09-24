import { describe, expect, it } from "vitest";
import type { ErAttribute, ErDocument, ErRelationshipDecl } from "../contracts";
import { buildErModel } from "./buildErModel";

/** An `ErDocument` naming `names`, in the order given, and nothing else. */
const documentOf = (...names: string[]): ErDocument => ({
  kind: "er",
  direction: "TB",
  entities: names.map((name) => ({ name, alias: null, attributes: [] })),
  relationships: [],
  timeline: null,
});

/**
 * One relationship declaration, written the way the parser hands it over —
 * left to right in the source's own order, so a test reading it back cannot
 * quietly pick up Mermaid's crossed `cardA`/`cardB`.
 *
 * The default pair is **asymmetric** on purpose: `||--o{` read backwards is
 * `}o--||`, a different picture, which is what makes a swapped
 * implementation fail rather than pass.
 */
const relates = (
  left: string,
  right: string,
  overrides: Partial<ErRelationshipDecl> = {},
): ErRelationshipDecl => ({
  left,
  leftCardinality: "onlyOne",
  line: "identifying",
  rightCardinality: "zeroOrMore",
  right,
  label: "places",
  ...overrides,
});

/** An `ErDocument` whose entities are exactly the ones its relationships name. */
const documentRelating = (...relationships: ErRelationshipDecl[]): ErDocument => ({
  kind: "er",
  direction: "TB",
  entities: relationships.flatMap((relationship) => [
    { name: relationship.left, alias: null, attributes: [] },
    { name: relationship.right, alias: null, attributes: [] },
  ]),
  relationships,
  timeline: null,
});

describe("buildErModel", () => {
  it("gives each entity its authored name as both its id and its drawn label", () => {
    // Measured (mermaid 11.17.2): Mermaid keys its entity table on the name
    // the author wrote and reports `label="CUSTOMER"` for it — so the name
    // is both what addresses the entity and what is drawn in the box. They
    // are two fields here rather than one because an alias splits them: a
    // later ticket puts the alias in `label` and leaves `id` alone, which is
    // what keeps a timeline target (ADR-0009 — a target is an id) pointing
    // at the same entity after it is renamed on screen.
    const { model, diagnostics } = buildErModel(documentOf("CUSTOMER", "ORDER"));

    expect(diagnostics).toEqual([]);
    expect(model.entities).toEqual([
      { id: "CUSTOMER", label: "CUSTOMER", attributes: [] },
      { id: "ORDER", label: "ORDER", attributes: [] },
    ]);
  });

  it("draws an entity's alias in place of its name, and leaves its id alone", () => {
    // Measured (mermaid 11.17.2): `CUSTOMER["Customer Account"]` records one
    // entity keyed on `CUSTOMER` — `label="CUSTOMER" alias="Customer
    // Account"` — and `--markup` shows the *box* reading "Customer Account".
    // So the two fields part company exactly here: `id` stays the authored
    // name, which is what a `timeline:` target addresses (ADR-0009), and
    // `label` becomes the alias.
    //
    // ⚠️ Not a state diagram's `state "text" as s`, which is a *description*
    // drawn beside the id and leaves the drawn name alone. Different
    // mechanism, different picture.
    const { model, diagnostics } = buildErModel({
      kind: "er",
      timeline: null,
      direction: "TB",
      entities: [{ name: "CUSTOMER", alias: "Customer Account", attributes: [] }],
      relationships: [],
    });

    expect(diagnostics).toEqual([]);
    expect(model.entities).toEqual([
      { id: "CUSTOMER", label: "Customer Account", attributes: [] },
    ]);
  });

  it("lets the first alias an entity is given win, and a later bare mention not clear it", () => {
    // ⚠️ Measured, and **the opposite of `direction`'s rule one field over**
    // — which is why it could not be inherited from it. Mermaid's
    // `addEntity(name, alias)` ends `else if (!existing.alias && alias)
    // existing.alias = alias`, so:
    //
    // - `A["x"]` then `A["y"]` reports `alias="x"` — first wins.
    // - `A` then `A["Second"]` reports `alias="Second"` — a mention with no
    //   alias does not claim the field, so a later one still can.
    // - `A["First"]` then `A` reports `alias="First"` — and does not clear
    //   it, which is the defect a naive last-wins would produce: the box
    //   would fall back to its id with nothing said.
    const first = (...entities: { name: string; alias: string | null }[]) =>
      buildErModel({
        kind: "er",
        timeline: null,
        direction: "TB",
        entities: entities.map((entity) => ({ ...entity, attributes: [] })),
        relationships: [],
      }).model.entities[0].label;

    expect(first({ name: "A", alias: "x" }, { name: "A", alias: "y" })).toBe("x");
    expect(first({ name: "A", alias: null }, { name: "A", alias: "Second" })).toBe("Second");
    expect(first({ name: "A", alias: "First" }, { name: "A", alias: null })).toBe("First");

    // The over-reach control, and it is not hypothetical: measured,
    // `A["A"]` then `A["B"]` reports `alias="A"`. An implementation that
    // read "has an alias yet?" off the *drawn label* — "is it still equal to
    // the id?" — would answer no here and let `B` through, replacing an
    // alias Mermaid keeps. The question is whether an alias was claimed, not
    // whether it happens to read like the name.
    expect(first({ name: "A", alias: "A" }, { name: "A", alias: "B" })).toBe("A");
  });

  it("carries an entity's attributes through, and concatenates a second block onto the first", () => {
    // Measured (mermaid 11.17.2): an entity may open **several** blocks —
    // `E { string a }` followed by `E { string b }` reports one entity
    // carrying both attributes, in that order. The parser records a block on
    // the mention that opened it, so joining them belongs here, beside the
    // de-duplication of the name itself. Keeping only the first block's
    // would silently drop attributes Mermaid draws; keeping only the last's
    // would silently drop different ones.
    const attribute = (name: string): ErAttribute => ({
      type: "string",
      name,
      keys: [],
      comment: "",
    });
    const { model, diagnostics } = buildErModel({
      kind: "er",
      timeline: null,
      direction: "TB",
      entities: [
        { name: "CUSTOMER", alias: null, attributes: [attribute("a")] },
        { name: "ORDER", alias: null, attributes: [] },
        { name: "CUSTOMER", alias: null, attributes: [attribute("b")] },
      ],
      relationships: [],
    });

    expect(diagnostics).toEqual([]);
    expect(model.entities).toEqual([
      {
        id: "CUSTOMER",
        label: "CUSTOMER",
        attributes: [attribute("a"), attribute("b")],
      },
      { id: "ORDER", label: "ORDER", attributes: [] },
    ]);
  });

  it("records an entity named twice once, in the position it was first named", () => {
    // Measured: `CUSTOMER / ORDER / CUSTOMER` reports **two** entities, with
    // `CUSTOMER` still first — Mermaid's table is keyed on the name, so a
    // second mention finds the entry already there. Two boxes with the same
    // `data-siren-id` would make a timeline entry naming it ambiguous, so
    // this is a rule the model owes rather than a tidy-up.
    const { model, diagnostics } = buildErModel(documentOf("CUSTOMER", "ORDER", "CUSTOMER"));

    // Silently, and that is measured too: Mermaid reports nothing for the
    // repeat, so a warning here would be Siren's opinion rather than a fact
    // about the document.
    expect(diagnostics).toEqual([]);
    expect(model.entities.map((entity) => entity.id)).toEqual(["CUSTOMER", "ORDER"]);
  });

  it("keeps each relationship's two markers on the sides the source wrote them", () => {
    // **The whole point of this test, and the reason the source is
    // asymmetric.** Mermaid records the two cardinalities crossed — measured,
    // `CUSTOMER ||--o{ ORDER : places` comes back `cardA="ZERO_OR_MORE"
    // cardB="ONLY_ONE"`, where `cardA` is the marker written next to
    // `entityB`. An implementation that reads them back in field-name order
    // draws every relationship backwards, and `||--||` would not notice.
    const { model, diagnostics } = buildErModel(
      documentRelating(relates("CUSTOMER", "ORDER")),
    );

    expect(diagnostics).toEqual([]);
    expect(model.relationships).toEqual([
      {
        id: "CUSTOMER-ORDER",
        from: "CUSTOMER",
        to: "ORDER",
        fromCardinality: "onlyOne",
        toCardinality: "zeroOrMore",
        line: "identifying",
        label: "places",
      },
    ]);
  });

  it("declares the entities a relationship names, in first-mention order", () => {
    // Measured: `erDiagram / ZZZ / A ||--o{ B : first / B / A` reports three
    // entities in the order `ZZZ`, `A`, `B` — a relationship declares its
    // endpoints exactly as a bare name does, and a repeat of either finds
    // the entry already there.
    const { model } = buildErModel({
      kind: "er",
      timeline: null,
      direction: "TB",
      entities: [
        { name: "ZZZ", alias: null, attributes: [] },
        { name: "A", alias: null, attributes: [] },
        { name: "B", alias: null, attributes: [] },
        { name: "B", alias: null, attributes: [] },
        { name: "A", alias: null, attributes: [] },
      ],
      relationships: [relates("A", "B", { label: "first" })],
    });

    expect(model.entities.map((entity) => entity.id)).toEqual(["ZZZ", "A", "B"]);
  });

  it("gives two relationships between the same pair distinct ids", () => {
    // Measured: two relationships naming the same two entities are both
    // kept — `A ||--o{ B : first` and `A }o--|| B : second` report two
    // relationships, not one overwriting the other. Two elements sharing a
    // `data-siren-id` would make a timeline entry naming it ambiguous
    // (ADR-0009), so the second takes `#2` — the convention a flowchart edge
    // and a class relationship already use.
    //
    // The two are each other's mirror image, so a `from`/`to` swap shows up
    // here as well as in the ids.
    const { model } = buildErModel(
      documentRelating(
        relates("A", "B", { label: "first" }),
        relates("A", "B", {
          leftCardinality: "zeroOrMore",
          rightCardinality: "onlyOne",
          label: "second",
        }),
      ),
    );

    expect(
      model.relationships.map((r) => [r.id, r.fromCardinality, r.toCardinality]),
    ).toEqual([
      ["A-B", "onlyOne", "zeroOrMore"],
      ["A-B#2", "zeroOrMore", "onlyOne"],
    ]);
  });

  it("carries the document's direction through unchanged", () => {
    // Which way round the diagram runs is settled in the parser (last wins,
    // measured) and read by the layout. This stage identifies and
    // de-duplicates; it does not reinterpret, so a direction that arrived
    // `LR` leaves `LR` — and the default arrives as `TB` rather than being
    // re-derived here, so there is only one place that decides it.
    const laidOutIn = (direction: ErDocument["direction"]) =>
      buildErModel({ kind: "er", direction, entities: [], relationships: [], timeline: null })
        .model.direction;

    expect(laidOutIn("LR")).toBe("LR");
    expect(laidOutIn("BT")).toBe("BT");
    expect(laidOutIn("TB")).toBe("TB");
  });

  it("hands back a timeline with no steps for a document that opens no block", () => {
    const { model } = buildErModel(documentOf("CUSTOMER"));

    expect(model.timeline).toEqual({ totalSteps: 0, entries: [] });
  });
});

describe("buildErModel resolves the timeline", () => {
  /** A document naming `CUSTOMER`, `ORDER` and the relationship between them. */
  const withTimeline = (timeline: ErDocument["timeline"]): ErDocument => ({
    ...documentRelating(relates("CUSTOMER", "ORDER")),
    timeline,
  });

  it("keeps an entry naming an entity and an entry naming a relationship", () => {
    // The two kinds of ER timeline target, asserted together because the
    // question ADR-0009 asks of a new diagram kind is *which ids exist*, and
    // the answer here is both the boxes and the lines between them — every
    // one of which `renderErDiagramToSVG` already stamps `data-siren-id` on.
    const { model, diagnostics } = buildErModel(
      withTimeline({
        entries: [
          { kind: "enter", step: 1, targetId: "CUSTOMER", effect: "fade" },
          { kind: "enter", step: 2, targetId: "CUSTOMER-ORDER", effect: "fade" },
          { kind: "highlight", step: 3, targetId: "ORDER", effect: "outline" },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.timeline).toEqual({
      totalSteps: 3,
      entries: [
        { kind: "enter", step: 1, targetId: "CUSTOMER", effect: "fade" },
        { kind: "enter", step: 2, targetId: "CUSTOMER-ORDER", effect: "fade" },
        { kind: "highlight", step: 3, targetId: "ORDER", effect: "outline" },
      ],
    });
  });

  it("drops an entry naming an id nothing holds, and says which id", () => {
    // An attribute is deliberately **not** a target: its cells are drawn
    // inside the entity's own `<g>` and carry no id of their own, so `email`
    // below is an unknown id rather than a row that could be animated.
    const document = withTimeline({
      entries: [{ kind: "enter", step: 1, targetId: "email", effect: "fade", line: 6, column: 3 }],
    });
    document.entities[0].attributes.push({ type: "string", name: "email", keys: [], comment: "" });

    const { model, diagnostics } = buildErModel(document);

    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'timeline: references unknown id "email"',
        line: 6,
        column: 3,
      },
    ]);
    expect(model.timeline.entries).toEqual([]);
  });

  it("warns when a relationship outlives an entity it joins", () => {
    // The shared rule, with this kind's own noun: nothing hides a line
    // because a box it touches went away, so a relationship left drawn from
    // empty space is the author's to exit.
    const { diagnostics } = buildErModel(
      withTimeline({
        entries: [{ kind: "exit", step: 2, targetId: "CUSTOMER", effect: "fade" }],
      }),
    );

    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          'timeline: relationship "CUSTOMER-ORDER" remains visible after its endpoint ' +
          '"CUSTOMER" exits at step 2 — add "exit CUSTOMER-ORDER ..." at or before step 2',
      },
    ]);
  });
});
