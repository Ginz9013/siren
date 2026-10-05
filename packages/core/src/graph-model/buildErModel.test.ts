import { describe, expect, it } from "vitest";
import type {
  ErAttribute,
  ErDocument,
  ErRelationshipDecl,
  ErSubgraph,
  StyleDecl,
} from "../contracts";
import { plainLabel, plainRun } from "../label/label";
import { buildErModel } from "./buildErModel";

/** An `ErDocument` naming `names`, in the order given, and nothing else. */
const documentOf = (...names: string[]): ErDocument => ({
  kind: "er",
  subgraphs: [],
  styles: [],
  direction: "TB",
  entities: names.map((name) => ({ name, alias: null, attributes: [] })),
  relationships: [],
  timeline: null,
  accTitle: null,
  accDescr: null,
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
  label: plainLabel("places"),
  ...overrides,
});

/** An `ErDocument` whose entities are exactly the ones its relationships name. */
const documentRelating = (...relationships: ErRelationshipDecl[]): ErDocument => ({
  kind: "er",
  subgraphs: [],
  styles: [],
  direction: "TB",
  entities: relationships.flatMap((relationship) => [
    { name: relationship.left, alias: null, attributes: [] },
    { name: relationship.right, alias: null, attributes: [] },
  ]),
  relationships,
  timeline: null,
  accTitle: null,
  accDescr: null,
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
      { id: "CUSTOMER", label: plainLabel("CUSTOMER"), attributes: [], parentId: null },
      { id: "ORDER", label: plainLabel("ORDER"), attributes: [], parentId: null },
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
      subgraphs: [],
      styles: [],
      timeline: null,
      accTitle: null,
      accDescr: null,
      direction: "TB",
      entities: [{ name: "CUSTOMER", alias: plainLabel("Customer Account"), attributes: [] }],
      relationships: [],
    });

    expect(diagnostics).toEqual([]);
    expect(model.entities).toEqual([
      { id: "CUSTOMER", label: plainLabel("Customer Account"), attributes: [], parentId: null },
    ]);
  });

  it("draws an alias as the label the parser read, rows and all, and a bare name as a plain label", () => {
    // ADR-0015: an alias is a label — `CUSTOMER["Customer<br/>Record"]`
    // draws two rows (measured, mermaid 11.17.2, `--html`). The name an
    // entity falls back to is never read for tags: it is the id, drawn as
    // written.
    const twoRows = {
      text: "Customer\nRecord",
      rows: [[plainRun("Customer")], [plainRun("Record")]],
    };
    const { model } = buildErModel({
      kind: "er",
      subgraphs: [],
      styles: [],
      timeline: null,
      accTitle: null,
      accDescr: null,
      direction: "TB",
      entities: [
        { name: "CUSTOMER", alias: twoRows, attributes: [] },
        { name: "A<b>B", alias: null, attributes: [] },
      ],
      relationships: [],
    });

    expect(model.entities.map((entity) => entity.label)).toEqual([twoRows, plainLabel("A<b>B")]);
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
      subgraphs: [],
        styles: [],
        timeline: null,
        accTitle: null,
        accDescr: null,
        direction: "TB",
        entities: entities.map(({ name, alias }) => ({
          name,
          alias: alias === null ? null : plainLabel(alias),
          attributes: [],
        })),
        relationships: [],
      }).model.entities[0].label.text;

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
      comment: plainLabel(""),
    });
    const { model, diagnostics } = buildErModel({
      kind: "er",
      subgraphs: [],
      styles: [],
      timeline: null,
      accTitle: null,
      accDescr: null,
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
        label: plainLabel("CUSTOMER"),
        attributes: [attribute("a"), attribute("b")],
        parentId: null,
      },
      { id: "ORDER", label: plainLabel("ORDER"), attributes: [], parentId: null },
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
        id: "CUSTOMER:ORDER",
        from: "CUSTOMER",
        to: "ORDER",
        fromCardinality: "onlyOne",
        toCardinality: "zeroOrMore",
        line: "identifying",
        label: plainLabel("places"),
      },
    ]);
  });

  it("joins a relationship's two endpoint names with a colon, and counts a repeated pair from #2", () => {
    // **This kind spells its connector ids `${from}:${to}`, and it is the
    // only kind that does.** A flowchart edge, a class relationship, a
    // sequence message and a state transition all keep `${from}-${to}`,
    // because their authored ids are `\w+` and a hyphen cannot appear in
    // one. An ER entity name can: measured from Mermaid's own lexer, it is
    // `([^\x00-\x7F]|\w|-|\*|\.)+`, so `LINE-ITEM` beside `LINE ||--o{ ITEM`
    // gave a box and a line one `data-siren-id` with no diagnostic at all.
    //
    // A colon is the better separator here because it is measured to be
    // refused everywhere an *unquoted* ER name is read — every one of
    // `A:B`, `A:B ||--o{ C : has`, `A ||--o{ C:D : has`, `A { str:ing x }`
    // and `A { string x:y }` is a Mermaid parse error (mermaid 11.17.2, via
    // `scripts/mermaid-probe.mjs`). It is **not** impossible outright: a
    // *quoted* name takes one, and `reportIdCollisions` rather than this
    // spelling is what guards against that. See `ResolvedErRelationship`.
    //
    // The `#2` suffix is unchanged and still load-bearing: measured, `A
    // ||--o{ B : first` and `A }o--|| B : second` report **two**
    // relationships over the same ordered pair.
    const { model, diagnostics } = buildErModel(
      documentRelating(
        relates("CUSTOMER", "ORDER"),
        relates("CUSTOMER", "ORDER", { label: plainLabel("also places") }),
        relates("ORDER", "LINE-ITEM", { label: plainLabel("contains") }),
      ),
    );

    expect(diagnostics).toEqual([]);
    expect(model.relationships.map((relationship) => relationship.id)).toEqual([
      "CUSTOMER:ORDER",
      "CUSTOMER:ORDER#2",
      "ORDER:LINE-ITEM",
    ]);
  });

  it("declares the entities a relationship names, in first-mention order", () => {
    // Measured: `erDiagram / ZZZ / A ||--o{ B : first / B / A` reports three
    // entities in the order `ZZZ`, `A`, `B` — a relationship declares its
    // endpoints exactly as a bare name does, and a repeat of either finds
    // the entry already there.
    const { model } = buildErModel({
      kind: "er",
      subgraphs: [],
      styles: [],
      timeline: null,
      accTitle: null,
      accDescr: null,
      direction: "TB",
      entities: [
        { name: "ZZZ", alias: null, attributes: [] },
        { name: "A", alias: null, attributes: [] },
        { name: "B", alias: null, attributes: [] },
        { name: "B", alias: null, attributes: [] },
        { name: "A", alias: null, attributes: [] },
      ],
      relationships: [relates("A", "B", { label: plainLabel("first") })],
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
        relates("A", "B", { label: plainLabel("first") }),
        relates("A", "B", {
          leftCardinality: "zeroOrMore",
          rightCardinality: "onlyOne",
          label: plainLabel("second"),
        }),
      ),
    );

    expect(
      model.relationships.map((r) => [r.id, r.fromCardinality, r.toCardinality]),
    ).toEqual([
      ["A:B", "onlyOne", "zeroOrMore"],
      ["A:B#2", "zeroOrMore", "onlyOne"],
    ]);
  });

  it("warns when two drawn elements would wear one data-siren-id, and still draws both", () => {
    // **The invariant this kind cannot get from its alphabet, so it checks
    // for it instead.** Every other kind argues the collision away: an
    // authored id is `\w+`, a connector joins two of them with `-`, a
    // generated id carries a colon (ADR-0010), so no two spaces meet. ER
    // breaks that argument twice over, both measured in mermaid 11.17.2:
    //
    // - an unquoted entity name may contain `-`, which is why the connector
    //   separator moved to `:` above;
    // - a **quoted** entity name may contain anything at all, colon
    //   included — `erDiagram / "CUSTOMER:ORDER" ||--|| X : y` parses, and
    //   so does `erDiagram / "subgraph:1" ||--|| B : y`, which is the id
    //   `generatedId("subgraph", 1)` mints.
    //
    // So the rule is checked against the ids actually minted rather than
    // argued from which characters can appear. The document below is one
    // the ER parser cannot produce *today* (its name alphabet has no colon)
    // and one Mermaid accepts, which is exactly the gap `01M3978B7` opens
    // when it lands quoted entity names.
    const document = documentRelating(relates("CUSTOMER", "ORDER"));
    document.entities.push({ name: "CUSTOMER:ORDER", alias: null, attributes: [] });

    const { model, diagnostics } = buildErModel(document);

    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          'id collision: "CUSTOMER:ORDER" is drawn on an entity and a relationship — a ' +
          '`timeline:` entry naming it addresses every one of them (ADR-0009)',
      },
    ]);

    // **A warning, and nothing is dropped.** A document that collides is one
    // Mermaid draws, and the absolute compatibility condition says Siren
    // draws it too; the picture was never the ambiguous part, the target
    // space was. Both elements are still here, ids and all.
    expect(model.entities.map((entity) => entity.id)).toEqual([
      "CUSTOMER",
      "ORDER",
      "CUSTOMER:ORDER",
    ]);
    expect(model.relationships.map((relationship) => relationship.id)).toEqual([
      "CUSTOMER:ORDER",
    ]);
  });

  it("says nothing when every drawn element's id is its own", () => {
    // The control the warning above needs: the construct that used to
    // collide under the `-` spelling. `erDiagram / LINE-ITEM / LINE ||--o{
    // ITEM : x` gave the box `LINE-ITEM` and the line `LINE-ITEM` one id
    // with no diagnostic at all — three drawn elements, two of them
    // indistinguishable to `querySelectorAll`. Under `:` the line is
    // `LINE:ITEM`, and this asserts the silence is earned rather than the
    // detector being asleep.
    const document = documentRelating(relates("LINE", "ITEM", { label: plainLabel("x") }));
    document.entities.unshift({ name: "LINE-ITEM", alias: null, attributes: [] });

    const { model, diagnostics } = buildErModel(document);

    expect(diagnostics).toEqual([]);
    expect([
      ...model.entities.map((entity) => entity.id),
      ...model.relationships.map((relationship) => relationship.id),
    ]).toEqual(["LINE-ITEM", "LINE", "ITEM", "LINE:ITEM"]);
  });

  it("carries the document's direction through unchanged", () => {
    // Which way round the diagram runs is settled in the parser (last wins,
    // measured) and read by the layout. This stage identifies and
    // de-duplicates; it does not reinterpret, so a direction that arrived
    // `LR` leaves `LR` — and the default arrives as `TB` rather than being
    // re-derived here, so there is only one place that decides it.
    const laidOutIn = (direction: ErDocument["direction"]) =>
      buildErModel({
        kind: "er",
      subgraphs: [],
        styles: [],
        direction,
        entities: [],
        relationships: [],
        timeline: null,
        accTitle: null,
        accDescr: null,
      }).model.direction;

    expect(laidOutIn("LR")).toBe("LR");
    expect(laidOutIn("BT")).toBe("BT");
    expect(laidOutIn("TB")).toBe("TB");
  });

  it("hands back a timeline with no steps for a document that opens no block", () => {
    const { model } = buildErModel(documentOf("CUSTOMER"));

    expect(model.timeline).toEqual({ totalSteps: 0, entries: [] });
  });

  it("carries the accessible title and description through untouched", () => {
    // Plain text with no target to resolve against, so this stage has
    // nothing to decide about either — the rule `GraphModel.accTitle`
    // already records for a flowchart. Asserting it here is what stops a
    // later stage inventing a second answer.
    const { model, diagnostics } = buildErModel({
      ...documentOf("CUSTOMER"),
      accTitle: "Order book",
      accDescr: "how orders relate to customers",
    });

    expect(model.accTitle).toBe("Order book");
    expect(model.accDescr).toBe("how orders relate to customers");
    expect(diagnostics).toEqual([]);
  });

  it("leaves both null for a document that wrote neither", () => {
    const { model } = buildErModel(documentOf("CUSTOMER"));

    expect(model.accTitle).toBeNull();
    expect(model.accDescr).toBeNull();
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
          { kind: "enter", step: 2, targetId: "CUSTOMER:ORDER", effect: "fade" },
          { kind: "highlight", step: 3, targetId: "ORDER", effect: "outline" },
        ],
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(model.timeline).toEqual({
      totalSteps: 3,
      entries: [
        { kind: "enter", step: 1, targetId: "CUSTOMER", effect: "fade" },
        { kind: "enter", step: 2, targetId: "CUSTOMER:ORDER", effect: "fade" },
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
    document.entities[0].attributes.push({ type: "string", name: "email", keys: [], comment: plainLabel("") });

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
          'timeline: relationship "CUSTOMER:ORDER" remains visible after its endpoint ' +
          '"CUSTOMER" exits at step 2 — add "exit CUSTOMER:ORDER ..." at or before step 2',
      },
    ]);
  });
});

/** An `ErDocument` naming `names` and carrying `styles`. */
const documentStyling = (names: string[], styles: StyleDecl[]): ErDocument => ({
  ...documentOf(...names),
  styles,
});

describe("buildErModel resolves the author's styling", () => {
  it("flattens a classDef and the directive applying it onto the entity named", () => {
    // Through the very call `buildStateModel`, `buildClassModel` and
    // `buildFlowchartModel` make: nothing about this is ER's, so the pairing
    // of a definition with the directive applying it, the value gate, and
    // the split of `color` off onto the label all stay decided once.
    const { model, diagnostics } = buildErModel(
      documentStyling(
        ["CUSTOMER", "ORDER"],
        [
          {
            styleKind: "classDef",
            authoredAs: "classDef",
            targetIds: [],
            name: "urgent",
            properties: [
              { property: "fill", value: "#f96" },
              { property: "color", value: "#fff" },
            ],
          },
          {
            styleKind: "apply",
            authoredAs: "class",
            targetIds: ["ORDER"],
            name: "urgent",
            properties: [],
          },
        ],
      ),
    );

    expect(diagnostics).toEqual([]);
    // One entry, and it is `ORDER`'s: a mutation that styled the first
    // entity instead of the named one leaves every diagnostic empty and
    // still draws a picture.
    expect(model.styles).toEqual([
      {
        targetId: "ORDER",
        style: {
          frame: [{ property: "fill", value: "#f96" }],
          // The author's `color` arrives spelled `fill`, because SVG paints
          // a `<text>` with `fill` and an inline `color` would never reach
          // it. Decided in `resolveStyles` and not re-decided here.
          text: [{ property: "fill", value: "#fff" }],
        },
      },
    ]);
  });

  it("hands the resolver the entity ids alone, because no relationship can be styled", () => {
    // ⚠️ Measured from Mermaid's own database rather than inferred:
    // `addCssStyles(ids, styles)` and `setClass(ids, classNames)` each look
    // up `this.entities.get(id)` and `this.subGraphLookup.get(id)` and
    // nothing else. So `style CUSTOMER:ORDER fill:#f96` reaches
    // `addCssStyles`, finds no entity of that name, and paints **nothing** —
    // measured end to end with `--markup`, where the relationship's path
    // carries no author declaration at all.
    //
    // The relationship's id is `${from}:${to}` on Siren's side (01M3977716),
    // which is exactly the string an author would reach for. Listing it as a
    // valid target would paint a line Mermaid leaves alone, silently.
    const { model, diagnostics } = buildErModel({
      ...documentRelating(relates("CUSTOMER", "ORDER")),
      styles: [
        {
          styleKind: "style",
          authoredAs: "style",
          targetIds: ["CUSTOMER:ORDER"],
          name: null,
          properties: [{ property: "fill", value: "#f96" }],
        },
      ],
    });

    // The id really is the one that was aimed at, so this is a test about
    // the target set and not about a typo.
    expect(model.relationships.map((r) => r.id)).toEqual(["CUSTOMER:ORDER"]);
    // Dropped in silence, which is `resolveStyles`' settled answer for a
    // target that does not exist — Mermaid says nothing either.
    expect(diagnostics).toEqual([]);
    expect(model.styles).toEqual([]);
  });
});

/**
 * `subgraph` clusters, resolved: each given the generated id everything
 * downstream addresses it by, pointed at the block enclosing it, and its
 * members pushed onto the entities that belong to it.
 *
 * The **generated** id is ADR-0010's rule and not a choice made here: a
 * block may legitimately share its name with something else in the document,
 * so carrying the author's word would hand two drawn elements one
 * `data-siren-id`. `subgraph:1` is what `generatedId("subgraph", 1)` mints,
 * exactly as a flowchart's frame and a class diagram's namespace get theirs.
 */
describe("buildErModel resolves subgraph clusters", () => {
  /** An `ErDocument` with `subgraphs` and the entities they name. */
  const documentGrouping = (
    subgraphs: ErSubgraph[],
    ...names: string[]
  ): ErDocument => ({
    ...documentOf(...names),
    subgraphs,
  });

  const block = (overrides: Partial<ErSubgraph> & { name: string }): ErSubgraph => ({
    label: plainLabel(overrides.name),
    direction: null,
    entityNames: [],
    subgraphs: [],
    ...overrides,
  });

  it("mints a generated id per block and puts each entity in the block that claimed it", () => {
    const { model, diagnostics } = buildErModel(
      documentGrouping(
        [block({ name: "sales", direction: "LR", entityNames: ["CUSTOMER", "ORDER"] })],
        "CUSTOMER",
        "ORDER",
        "WAREHOUSE",
      ),
    );

    expect(diagnostics).toEqual([]);
    expect(model.subgraphs).toEqual([
      { id: "subgraph:1", label: plainLabel("sales"), parentId: null, direction: "LR" },
    ]);
    // Membership lands on the entity and nowhere else — the rule
    // `ResolvedSubgraph` states one kind over, so a frame and the box it
    // holds cannot disagree about which contains which.
    expect(model.entities.map((entity) => [entity.id, entity.parentId])).toEqual([
      ["CUSTOMER", "subgraph:1"],
      ["ORDER", "subgraph:1"],
      ["WAREHOUSE", null],
    ]);
  });

  it("warns when a quoted entity name collides with a cluster's generated id", () => {
    // ⚠️ **The reason ADR-0010's separating argument does not reach this
    // kind, made to bite.** A quoted ER entity name takes anything — 
    // measured (mermaid 11.17.2), `erDiagram / "subgraph:1" ||--|| B : y`
    // parses and keys the entity on exactly that string — so the
    // `${kind}:${n}` spelling that keeps a generated id out of every other
    // kind's authored id space cannot do it here. `reportIdCollisions` is
    // what holds the invariant instead, and a cluster is the third kind of
    // element registered with it.
    const { model, diagnostics } = buildErModel(
      documentGrouping([block({ name: "sales", entityNames: ["A"] })], "A", "subgraph:1"),
    );

    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message:
          'id collision: "subgraph:1" is drawn on an entity and a subgraph — a ' +
          "`timeline:` entry naming it addresses every one of them (ADR-0009)",
      },
    ]);
    // Advisory and never fatal: Mermaid draws this document, so Siren does
    // too. Both elements are still in the model.
    expect(model.entities.map((entity) => entity.id)).toEqual(["A", "subgraph:1"]);
    expect(model.subgraphs.map((subgraph) => subgraph.id)).toEqual(["subgraph:1"]);
  });

  it("lets the block that closes first keep a name two blocks claimed", () => {
    // ⚠️ **Closing order, not opening order**, and the two disagree exactly
    // when one block nests inside another. Measured: `subgraph outer / A /
    // subgraph inner / A / end / end` answers `inner` holding `A` while
    // `outer` holds only `inner` — Mermaid's `makeUniq` runs inside
    // `addSubGraph`, which fires at the closing `end`. Resolving in the
    // order the keywords were written would put `A` in `outer`, draw a
    // perfectly good picture, and report nothing.
    const { model } = buildErModel(
      documentGrouping(
        [
          block({
            name: "outer",
            entityNames: ["A"],
            subgraphs: [block({ name: "inner", entityNames: ["A"] })],
          }),
        ],
        "A",
      ),
    );

    // The ids are still minted in the order the keywords were written.
    expect(model.subgraphs).toEqual([
      { id: "subgraph:1", label: plainLabel("outer"), parentId: null, direction: null },
      { id: "subgraph:2", label: plainLabel("inner"), parentId: "subgraph:1", direction: null },
    ]);
    expect(model.entities.map((entity) => entity.parentId)).toEqual(["subgraph:2"]);
  });
});
