import type {
  Diagnostic,
  ErDocument,
  ErModelResult,
  ResolvedErEntity,
  ResolvedErRelationship,
} from "../contracts";
import {
  resolveTimeline,
  warnOnConnectorsOutlivingTheirEndpoints,
} from "./resolveTimeline";

/**
 * Resolves a parsed `ErDocument` into an `ErModel`: the entities, each named
 * once, in the order they were first named.
 *
 * **De-duplication is the whole of this stage's work today, and it is a
 * measured rule rather than tidiness.** Mermaid keys its entity table on the
 * name the author wrote, so `CUSTOMER / ORDER / CUSTOMER` reports two
 * entities with `CUSTOMER` still first (measured, mermaid 11.17.2 with
 * `scripts/mermaid-probe.mjs`) — and it says nothing about the repeat, so
 * neither does this. Drawing the second box would give two elements one
 * `data-siren-id`, which makes a `timeline:` entry naming it ambiguous
 * (ADR-0009).
 *
 * **And the `timeline:` block, resolved against the ids this stage just
 * settled.** Only a document that wrote one can produce a diagnostic here;
 * `model` is still non-nullable for the reason `GraphModelResult` records —
 * a bad timeline entry costs itself and not the picture, so there is no
 * failure path and a nullable payload would be a state no caller can reach.
 */
export function buildErModel(document: ErDocument): ErModelResult {
  const diagnostics: Diagnostic[] = [];
  const byId = new Map<string, ResolvedErEntity>();
  /**
   * The entities some mention has already given an alias — asked rather than
   * inferring it from the drawn label, because the two answers differ.
   * Measured: `A["A"]` then `A["B"]` reports `alias="A"`, and a reader that
   * took "label still equals id" for "no alias yet" would let `B` replace
   * it.
   */
  const aliased = new Set<string>();
  for (const entity of document.entities) {
    const existing = byId.get(entity.name);
    if (existing === undefined) {
      // The name is what Mermaid's table is keyed on, so it is the id
      // whatever the entity is called on screen. An **alias** is what parts
      // the two: measured with `--markup`, the box of
      // `CUSTOMER["Customer Account"]` draws "Customer Account", while the
      // table entry stays keyed on `CUSTOMER` — so the alias replaces the
      // drawn text and nothing else (see `ResolvedErEntity`).
      byId.set(entity.name, {
        id: entity.name,
        label: entity.alias ?? entity.name,
        attributes: [...entity.attributes],
      });
      if (entity.alias !== null) {
        aliased.add(entity.name);
      }
      continue;
    }
    // The **attributes** of a repeat do join the first mention, where its
    // name does not. Measured: `E { string a }` followed by `E { string b }`
    // reports one entity carrying both, in that order — so a second block is
    // an addition to the table, not a replacement of it, and dropping either
    // one would silently lose a row Mermaid draws.
    existing.attributes.push(...entity.attributes);
    // The **first alias wins, and a mention without one does not clear it.**
    // Measured from Mermaid's own `addEntity`, whose last branch is
    // `else if (!existing.alias && alias) existing.alias = alias`: `A["x"]`
    // then `A["y"]` reports `x`, while `A` then `A["Second"]` reports
    // `Second` — so the test is "is the field still unclaimed", not "is this
    // the first mention".
    //
    // ⚠️ First-wins here and **last**-wins for `direction` one stage back,
    // both measured on this one diagram kind. Neither rule is the other's.
    if (!aliased.has(entity.name) && entity.alias !== null) {
      aliased.add(entity.name);
      existing.label = entity.alias;
    }
  }

  const entities = [...byId.values()];
  const relationships = assignRelationshipIds(document);

  // **Two kinds of timeline target: an entity and a relationship**, sharing
  // one id space exactly as a flowchart's nodes and edges do, so the shared
  // resolver never has to learn which kind of element an id belongs to.
  //
  // An entity is named by the id the *author* wrote, which is what an alias
  // deliberately leaves alone (see `ResolvedErEntity`): renaming a box on
  // screen must not move the target a `timeline:` entry names.
  //
  // An **attribute** is not a target and has no id. Its four cells are drawn
  // inside the entity's own `<g>` and carry no `data-siren-id` — ADR-0009
  // makes a target an id, and a row of a table has no identity of its own in
  // Mermaid's record either (attributes are a plain array on the entity,
  // keyed by nothing, and `PK,PK` reports two of them). Giving a row an id
  // would mean minting one from its position, which changes the moment the
  // author inserts a row above it; the entity that owns it is the stable
  // thing to animate, and it already is one.

  // **One list, because two things need exactly it and must not drift
  // apart**: the set of ids a `timeline:` entry may name, and the check that
  // no two drawn elements wear the same one. Built as an array rather than
  // straight into the `Set` the resolver wants, because a `Set` is precisely
  // what makes a collision disappear without trace — that is where this
  // kind's ambiguity hid.
  //
  // ⚠️ **A new kind of addressable ER element is added here**, and gets
  // checked for free by doing so. `01M395S26` brings ER `subgraph`
  // clusters, whose ids `generatedId` mints as `subgraph:1`; measured,
  // `erDiagram / "subgraph:1" ||--|| B : y` is a legal document in mermaid
  // 11.17.2, so those ids are collidable and not merely in theory.
  const addressable: AddressableElement[] = [
    ...entities.map((entity) => ({ noun: "entity", id: entity.id })),
    ...relationships.map((relationship) => ({
      noun: "relationship",
      id: relationship.id,
    })),
  ];

  reportIdCollisions(addressable, diagnostics);

  const timeline = resolveTimeline(
    document.timeline,
    new Set(addressable.map((element) => element.id)),
    diagnostics,
  );

  // A relationship is a connector — two ids joined by a drawn line — so the
  // rule that already covers a flowchart edge, a class relationship, a
  // sequence message and a state transition covers it, called rather than
  // copied. Advisory only: nothing is dropped, and an author who gives the
  // relationship its own `exit` silences it.
  warnOnConnectorsOutlivingTheirEndpoints(
    timeline.entries,
    relationships,
    "relationship",
    diagnostics,
  );

  return {
    model: {
      // Straight through: which statement won is the parser's measurement
      // (last wins), and re-deciding it here would be a second answer to a
      // question already settled.
      direction: document.direction,
      entities,
      relationships,
      timeline,
    },
    diagnostics,
  };
}

/**
 * One element a render will draw with a `data-siren-id` of its own, and the
 * word a diagnostic calls it by. Deliberately says nothing about which
 * diagram kind it came from: the rule below is about strings, and a kind
 * that had to be named in it would be a kind the rule could get wrong.
 */
interface AddressableElement {
  /** `"entity"`, `"relationship"`, `"subgraph"` — the noun, singular. */
  readonly noun: string;
  /** The `data-siren-id` this element will be stamped with. */
  readonly id: string;
}

/**
 * Reports every id that more than one drawn element would wear.
 *
 * **This is an invariant enforced by measurement rather than by argument,
 * and that is the whole point of it.** ADR-0010 keeps generated ids and
 * connector ids apart by a forbidden character: an authored id is `\w+`, so
 * `${from}-${to}` cannot spell `${kind}:${n}` and vice versa. That argument
 * holds for four diagram kinds and fails for ER, twice over — an unquoted
 * ER name may contain `-`, and a **quoted** one may contain anything at all,
 * colon included (measured, mermaid 11.17.2: `"CUSTOMER:ORDER" ||--|| X : y`
 * and `"subgraph:1" ||--|| B : y` both parse). No separator survives that,
 * so ER does not try to find one; it compares the ids it actually minted.
 *
 * **Advisory, never fatal.** A colliding document is one Mermaid draws, and
 * the compatibility condition says Siren draws it too — the picture was
 * never the ambiguous part. What is ambiguous is a `timeline:` entry naming
 * the shared id, which `createAnimationController` resolves with
 * `querySelectorAll` and so applies to every element wearing it (ADR-0009).
 * An `error` here would be the wrong trade twice: it would cost the author
 * a diagram over an ambiguity that only bites if they write a timeline, and
 * the corpus runner reads an error-severity diagnostic as a *rejection*, so
 * it would turn a drawn document into a refused one.
 *
 * Kind-agnostic on purpose although only `buildErModel` calls it today. It
 * belongs beside `warnOnConnectorsOutlivingTheirEndpoints` in
 * `resolveTimeline` the moment a second kind needs it; it is here rather
 * than there because ER is the only kind whose ids can collide at all, and
 * a shared home would suggest the other four were being checked too.
 */
function reportIdCollisions(
  elements: readonly AddressableElement[],
  diagnostics: Diagnostic[],
): void {
  const nounsById = new Map<string, string[]>();
  for (const element of elements) {
    const nouns = nounsById.get(element.id);
    if (nouns === undefined) {
      nounsById.set(element.id, [element.noun]);
      continue;
    }
    nouns.push(element.noun);
  }

  // In first-appearance order, so that a document with two collisions
  // reports them the same way on every render — the same reproducibility
  // `data-siren-id` itself owes (see the id-stability test in `index.test.ts`).
  for (const [id, nouns] of nounsById) {
    if (nouns.length < 2) continue;
    diagnostics.push({
      severity: "warning",
      message:
        `id collision: "${id}" is drawn on ${listOf(nouns.map(withArticle))} — a ` +
        "`timeline:` entry naming it addresses every one of them (ADR-0009)",
    });
  }
}

/** `entity` → `an entity`, `relationship` → `a relationship`. */
function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

/** `[a, b]` → `a and b`; `[a, b, c]` → `a, b and c`. */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Gives every relationship the id the renderer and a future `timeline:`
 * entry address it by. Everything else passes through exactly as the parser
 * read it — this stage identifies, it does not reinterpret.
 *
 * **In particular it does not touch the two cardinalities.** The parser
 * already undid Mermaid's crossed `cardA`/`cardB` (see
 * `ErRelationshipDecl`), and `left`/`right` become `from`/`to` in place; a
 * stage that reversed them here would be a second, silent swap on top of
 * the one this codebase exists to avoid.
 */
function assignRelationshipIds(document: ErDocument): ResolvedErRelationship[] {
  // `${from}:${to}`, then `#2`, `#3`, ... for repeats of the same ordered
  // pair. The `#2` half is `buildClassModel` and `buildFlowchartModel`'s
  // convention exactly; the separator is **not**, and this is the only kind
  // that departs from it.
  //
  // Those kinds join with `-` because their authored ids are `\w+`, which
  // cannot contain one. An ER entity name can: measured from Mermaid's own
  // lexer it is `([^\x00-\x7F]|\w|-|\*|\.)+`, so `LINE-ITEM` beside `LINE
  // ||--o{ ITEM : x` handed a box and a line the same `data-siren-id` with
  // no diagnostic. A colon is refused everywhere an *unquoted* ER name is
  // read (measured: `A:B`, `A:B ||--o{ C : has`, `A ||--o{ C:D : has`,
  // `A { str:ing x }` and `A { string x:y }` are all parse errors in mermaid
  // 11.17.2), which makes this spelling strictly better than the hyphen
  // rather than impossible to collide — a *quoted* name does take a colon.
  // `reportIdCollisions` below is what actually holds the invariant.
  const seenPairCounts = new Map<string, number>();

  return document.relationships.map((relationship) => {
    const pairKey = `${relationship.left}->${relationship.right}`;
    const occurrence = (seenPairCounts.get(pairKey) ?? 0) + 1;
    seenPairCounts.set(pairKey, occurrence);
    const baseId = `${relationship.left}:${relationship.right}`;

    return {
      id: occurrence === 1 ? baseId : `${baseId}#${occurrence}`,
      from: relationship.left,
      to: relationship.right,
      fromCardinality: relationship.leftCardinality,
      toCardinality: relationship.rightCardinality,
      line: relationship.line,
      label: relationship.label,
    };
  });
}
