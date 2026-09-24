import { describe, expect, it } from "vitest";
import type { ErDocument, ErRelationshipDecl } from "../contracts";
import { buildErModel } from "./buildErModel";

/** An `ErDocument` naming `names`, in the order given, and nothing else. */
const documentOf = (...names: string[]): ErDocument => ({
  kind: "er",
  entities: names.map((name) => ({ name })),
  relationships: [],
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
  entities: relationships.flatMap((relationship) => [
    { name: relationship.left },
    { name: relationship.right },
  ]),
  relationships,
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
      { id: "CUSTOMER", label: "CUSTOMER" },
      { id: "ORDER", label: "ORDER" },
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
      entities: [
        { name: "ZZZ" },
        { name: "A" },
        { name: "B" },
        { name: "B" },
        { name: "A" },
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

  it("hands back a timeline with no steps, since this kind reads no timeline block yet", () => {
    const { model } = buildErModel(documentOf("CUSTOMER"));

    expect(model.timeline).toEqual({ totalSteps: 0, entries: [] });
  });
});
