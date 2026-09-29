/**
 * The Mermaid probe: ask real Mermaid what a document means.
 *
 *     node packages/core/scripts/mermaid-probe.mjs --source 'flowchart TB
 *     A[(DB)] --> B'
 *     node packages/core/scripts/mermaid-probe.mjs some-diagram.mmd
 *     cat some-diagram.mmd | node packages/core/scripts/mermaid-probe.mjs -
 *     pnpm --filter siren-core probe some-diagram.mmd
 *     node packages/core/scripts/mermaid-probe.mjs --paint --source 'flowchart TB
 *     A -->|yes| B
 *     linkStyle 0 stroke:#00ff00,color:#ff0000'
 *     pnpm --filter siren-core probe --paint some-diagram.mmd
 *
 * Two things to know before pointing it at an `examples/*.srn` file, both
 * measured the hard way:
 *
 * - A Siren document carrying a `timeline:` block is **not** a Mermaid
 *   document — that block is Siren's own syntax. Probe the diagram half:
 *   `sed '/^timeline:/,$d' examples/flowchart-syntax.srn | ... -`
 * - Mermaid rejects a line that is nothing but `%%`. Its comment cleanup
 *   wants at least one character after the `%%`, while Siren strips from the
 *   first `%%` to the end of the line whatever follows. Siren is the more
 *   permissive of the two, so this breaks nothing — the condition is
 *   one-directional — but several `examples/*.srn` files use bare `%%` as a
 *   paragraph break and so cannot be fed to Mermaid as they stand.
 *
 * ## Why this is committed code rather than a note
 *
 * Siren is held to an absolute condition — a document that renders in Mermaid
 * must render here — with exactly one exception: where Mermaid itself draws a
 * wrong picture with no diagnostic, Siren refuses and says why. That exception
 * comes with an obligation: **Mermaid's behavior is measured, not remembered.**
 * A divergence claimed from recollection is not a divergence, it is a guess.
 *
 * So a repeatable way to measure Mermaid is load-bearing for every
 * compatibility board, not a convenience for one of them. Three boards' worth
 * of questions were settled with a throwaway copy of this script and then lost
 * with the scratch directory it lived in — edge ordering, chain composition,
 * `;` inside a declaration list, label whitespace, and which lifeline the
 * activation shorthand's `-` closes. It lives here, beside `src/compat/`, and
 * `mermaid` is a devDependency of this package, so a fresh clone can rerun any
 * of them. `.dev/` would have been the obvious home and is gitignored, which
 * is exactly how the previous copies were lost.
 *
 * **`mermaid` is a measuring instrument and nothing else.** Nothing under
 * `src/` imports it, and nothing may: ADR-0001 says this repo builds its own
 * pipeline rather than wrapping Mermaid, and that is unchanged. This script is
 * the one place the dependency is allowed, and it produces text for a human,
 * never input for the library.
 *
 * ## What it prints
 *
 * Mermaid's *own* parse result — the vertices, edges, messages, classes and
 * entities its database recorded — because that is the picture it will draw,
 * and comparing
 * pictures is the whole point. A parse error is printed too: "Mermaid rejects
 * this" is as much a measurement as any other, and it is the answer that tells
 * you a construct does not belong in the corpus.
 *
 * ## What `--paint` prints
 *
 * The parse alone cannot answer every compatibility question, because a
 * directive that reaches the database intact may still be *dropped* by the
 * renderer, and a database dump cannot tell the two apart. `linkStyle 0
 * stroke:#00ff00,color:#ff0000` appears nowhere in the reader above at all,
 * so "does Mermaid paint an edge's label with the author's `color`?" was
 * unanswerable here until this mode existed — which is exactly the shape of
 * question that gets settled from recollection when the instrument cannot
 * reach it.
 *
 * So `--paint` runs Mermaid's *renderer*, puts the SVG it produced into the
 * jsdom document, and prints what reaches each drawn label: the element, the
 * inline declarations Mermaid wrote onto it, and what `getComputedStyle`
 * resolves for `fill` and `color`. Each edge path's inline style is printed
 * beside them, because a question about a label is nearly always a question
 * about whether it agrees with the line it is written on.
 *
 * **The declaration is the measurement; the resolved value is corroboration.**
 * The `style=` column is read straight out of Mermaid's own markup and is
 * exact. The `resolves to` column is jsdom's, and jsdom implements a subset of
 * CSS — under the version this package pins it does not resolve `fill` from a
 * stylesheet rule at all — so an empty value there means "nothing inline
 * reached this element" rather than "nothing paints it"; what the theme would
 * have painted is in the `<style>` block Mermaid emits inside the SVG. The
 * contrast that settles a question of this kind is between a label the
 * author's directive reached and one it did not, and both columns show it.
 *
 * It renders **twice, once per label mechanism**, because Mermaid has two and
 * they spell one author declaration differently. `htmlLabels` — its default —
 * puts a label in a `<foreignObject>`, where it is HTML and `color` is the
 * property that paints it; `htmlLabels: false` puts it in an SVG `<text>`,
 * where `color` names no paint at all and Mermaid emits `fill` instead.
 * Siren draws SVG text, so the second is the comparable measurement, but a
 * mode that reported only one would make Mermaid's own translation look like
 * a quirk of this script.
 *
 * **Geometry from this mode is meaningless.** jsdom performs no layout, so
 * `getBBox` and friends are stubbed with a fixed box purely to let Mermaid's
 * measuring pass complete; every coordinate downstream of that stub is the
 * stub's answer rather than Mermaid's, and several arrive as `NaN`. Ask this
 * mode about paint, and ask the layout seam about geometry.
 *
 * ## How it drives Mermaid
 *
 * Mermaid is browser-only: its label path calls `DOMPurify.addHook`, so a DOM
 * has to exist before the module is imported. jsdom globals are installed
 * first (jsdom is already this package's test environment), and then
 * `mermaidAPI.getDiagramFromText` runs the real grammar over the text and
 * hands back the diagram's database. No rendering, no layout — just the parse,
 * unless `--paint` asked for the render as well.
 */
import { readFileSync } from "node:fs";

/**
 * Install the browser globals Mermaid's module-load path needs, before it
 * loads, and hand back the jsdom the SVG will later be read out of.
 *
 * `CSSStyleSheet` is only reached by the render path — `createCssStyles`
 * builds the stylesheet Mermaid emits inside the SVG — but it is installed
 * for both, because a global that appears only under a flag is a global that
 * is missing the first time someone else needs it.
 */
async function installDomGlobals() {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  const names = [
    "window",
    "document",
    "navigator",
    "DOMParser",
    "Node",
    "Element",
    "SVGElement",
    "HTMLElement",
    "MutationObserver",
    "requestAnimationFrame",
    "getComputedStyle",
    "CSSStyleSheet",
  ];
  for (const name of names) {
    if (globalThis[name] === undefined) globalThis[name] = dom.window[name];
  }
  return dom;
}

/**
 * The layout primitives jsdom does not implement, stubbed so that Mermaid's
 * renderer runs to completion.
 *
 * jsdom parses and cascades but never lays anything out, so `getBBox` on an
 * SVG element does not exist at all and Mermaid's measuring pass throws on
 * the first label it sizes. A fixed box gets it past that, at the price named
 * in the header: **every coordinate this mode produces is this stub's answer
 * and not Mermaid's.** That is an acceptable price for a paint question and
 * not for any other, which is why the stubs are installed only for `--paint`
 * rather than beside the globals above — the parse path must stay a
 * measurement of Mermaid with nothing of ours in it.
 */
function installLayoutStubs(dom) {
  const box = () => ({ x: 0, y: 0, width: 40, height: 20 });
  for (const proto of [dom.window.SVGElement.prototype, dom.window.Element.prototype]) {
    if (proto.getBBox === undefined) proto.getBBox = box;
    if (proto.getComputedTextLength === undefined) proto.getComputedTextLength = () => box().width;
  }
}

/**
 * The document to probe: a file path, `--source <text>`, or `-` for stdin.
 *
 * A bare `--` is dropped first. `pnpm run` forwards it verbatim rather than
 * eating it, so the habitual `pnpm --filter siren-core probe -- --paint`
 * otherwise arrives here as a request to read a file called `--`, and the
 * measurement fails with an `ENOENT` that says nothing about the mistake.
 */
function readSource(argv) {
  const [first, ...rest] = argv[0] === "--" ? argv.slice(1) : argv;
  if (first === undefined) return null;
  if (first === "--source") return rest.join(" ");
  if (first === "-") return readFileSync(0, "utf8");
  return readFileSync(first, "utf8");
}

/**
 * Mermaid's collections as a plain array. Its databases variously return an
 * array, a `Map` or a plain object for the same shape of thing, and which one
 * has changed between versions — normalizing here keeps every reader below
 * reading rather than defending.
 */
function records(collection) {
  if (collection === undefined || collection === null) return [];
  if (Array.isArray(collection)) return collection;
  if (collection instanceof Map) return [...collection.values()];
  return Object.values(collection);
}

/** `key: value` lines for one record, skipping what Mermaid left empty. */
function describe(record, keys) {
  return keys
    .filter((key) => record[key] !== undefined && record[key] !== null && record[key] !== "")
    .map((key) => `${key}=${JSON.stringify(record[key])}`)
    .join(" ");
}

function section(title, lines) {
  console.log(`\n## ${title}`);
  if (lines.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const line of lines) console.log(`  ${line}`);
}

/**
 * What each diagram kind's database is worth reading out.
 *
 * Deliberately a small, named set per kind rather than a dump of the whole
 * object: the fields below are the ones a compatibility question is ever
 * about — what a node is labelled and what shape it takes, which edges exist
 * and in what order, which lifeline a message activates.
 */
/**
 * The `state` statements inside a composite state's `doc`, which mixes
 * statement kinds: a `relation` entry holds its two states inline rather
 * than declaring them, so the states a composite *contains* are the ones it
 * declares plus the ones its relations mention.
 */
function statesIn(doc) {
  return doc.flatMap((entry) =>
    entry.stmt === "relation" ? [entry.state1, entry.state2] : entry.stmt === "state" ? [entry] : [],
  );
}

/**
 * The shape of one getter's answer, in a few characters.
 *
 * A shape and never the value: the question this is answering is only "does
 * this getter hold the document", and the reader about to be written is what
 * prints the contents properly. `getConfig()` alone would bury the hint.
 */
function summarizeValue(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  if (typeof value === "object") {
    const keys = Object.keys(value);
    const shown = keys.length > 6 ? `${keys.slice(0, 6).join(", ")}, … (${keys.length} keys)` : keys.join(", ");
    return `object{${shown}}`;
  }
  return JSON.stringify(value);
}

/**
 * Every getter a diagram database answers, each with what it returned for the
 * document just probed. The whole content of the "no reader for diagram type"
 * hint, and the only thing the next person adding a reader has to go on.
 *
 * **Mermaid keeps these getters on the database's class prototype, and
 * `Object.keys` reports own properties only — so `Object.keys(db)` finds none
 * of them.** That is not a hypothetical: measured on Mermaid 11.17.2, an ER
 * database's own keys are `getAccTitle, getAccDescription, getDiagramTitle,
 * getConfig` — four pieces of boilerplate — while `getEntities`,
 * `getRelationships`, `getClasses` and `getDirection` all sit on
 * `ErDB.prototype`. Requirement, architecture, treemap and all four of
 * flowchart/sequence/state/class are the same shape. **Do not reduce this back
 * to `Object.keys`.** The ER board lost time to exactly that: the hint printed
 * a list with no getter in it, and the real API had to be found by walking the
 * prototype by hand.
 *
 * The reason the broken version looked plausible is worth recording too. A
 * handful of older kinds — journey, gantt, pie, sankey, gitGraph, timeline,
 * c4, block, xychart, quadrantChart, radar — still build their database as a
 * plain object literal, where the getters *are* own properties, so `Object.keys`
 * appears to work if that is what you test against. Both sources are read here
 * every time; the prototype is not a fallback. One level of it is enough:
 * measured across all twenty-one kinds Mermaid 11.17.2 parses, every database
 * is either a plain object or a class extending nothing, so the chain is never
 * deeper than `db -> XxxDB.prototype -> Object.prototype`.
 *
 * Each getter is **called**, because the names alone are the weak half of the
 * hint. A requirement diagram answers twelve of them and only three carry the
 * document; annotated, `getRequirements() -> Map(1)` stands out from
 * `getAccTitle() -> ""` at a glance, and that is the whole job. Several take
 * arguments (`getEntity`, `getNode`) or throw when called bare
 * (`getCompiledStyles`); the throw is printed as-is, since "this one needs
 * arguments" is also an answer.
 *
 * Calling them is safe from this branch: it is the end of the parse report,
 * and `--paint`/`--markup` hand the *source text* back to Mermaid, which
 * parses it into a fresh database rather than reusing this one.
 */
function getterHints(db) {
  const names = [
    ...new Set([
      ...Object.keys(db),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(db) ?? {}),
    ]),
  ].filter((name) => typeof db[name] === "function" && name.startsWith("get"));
  if (names.length === 0) return ["(this database answers no getter at all)"];
  return names.map((name) => {
    try {
      return `${name}() -> ${summarizeValue(db[name]())}`;
    } catch (error) {
      return `${name}() -> throws: ${String(error.message).split("\n")[0]}`;
    }
  });
}

function report(type, db) {
  if (typeof db.getVertices === "function") {
    section(
      "vertices",
      records(db.getVertices()).map((vertex) =>
        describe(vertex, ["id", "text", "type", "labelType", "styles", "classes", "dir"]),
      ),
    );
    section(
      "edges (in Mermaid's own order)",
      records(db.getEdges()).map((edge) =>
        describe(edge, ["id", "start", "end", "type", "text", "labelType", "stroke", "length"]),
      ),
    );
    section(
      "subgraphs",
      records(db.getSubGraphs()).map((sub) => describe(sub, ["id", "title", "nodes", "dir"])),
    );
    section("direction", [String(db.getDirection?.() ?? "(unset)")]);
    return;
  }

  if (typeof db.getMessages === "function") {
    section(
      "actors",
      records(db.getActors()).map((actor) =>
        describe(actor, ["name", "description", "type"]),
      ),
    );
    // `type` is a LINETYPE constant, and the ones a compatibility question
    // usually turns on are the *synthetic* messages Mermaid inserts: an
    // activation is not a flag on the message that wrote `+`, it is a
    // record of its own naming the lane whose bar opens or closes.
    section(
      "messages (in Mermaid's own order, including the ones it synthesizes)",
      records(db.getMessages()).map((message) =>
        describe(message, ["id", "type", "from", "to", "message", "activate", "wrap"]),
      ),
    );
    return;
  }

  // Asked before the class-diagram branch, and that order is the whole point:
  // a state diagram's database *also* answers `getClasses` (it is where
  // `classDef` lives for that kind too), so without this the state reader
  // below is unreachable and a state document is reported as a class diagram
  // with no classes — a wrong report rather than the honest "no reader for
  // diagram type" this file falls back to. Measured the hard way, by a board
  // that read that empty table as a fact.
  if (typeof db.getStates === "function") {
    // A composite state carries its children in `doc`, so the tree is walked
    // rather than listed: the id a nested state is recorded under is scoped
    // to the composite that holds it (`Compound_start`, not `root_start`),
    // and a flat table would hide that.
    //
    // Deduplicated per level, because a state is reached once per relation
    // that names it — `[*] --> Inner` and `Inner --> [*]` mention `Inner`
    // twice, and printing it twice would read as two states.
    const walk = (states, path) => {
      const seen = new Set();
      return records(states).flatMap((state) => {
        if (seen.has(state.id)) return [];
        seen.add(state.id);
        return [
          describe({ ...state, in: path }, ["id", "type", "in", "descriptions", "note", "classes"]),
          ...(state.doc === undefined ? [] : walk(statesIn(state.doc), `${path}/${state.id}`)),
        ];
      });
    };
    section("states (nested ones shown under the composite that holds them)", walk(db.getStates(), "root"));

    // `getRelations()` answers for the root level only; a composite's own
    // transitions live in its `doc` and are gathered here, so "which
    // transitions exist" is one question with one answer.
    const relationsIn = (doc, path) =>
      doc.flatMap((entry) => [
        ...(entry.stmt === "relation"
          ? [describe({ ...entry, id1: entry.state1.id, id2: entry.state2.id, in: path }, ["id1", "id2", "relationTitle", "in"])]
          : []),
        ...(entry.stmt === "state" && entry.doc !== undefined
          ? relationsIn(entry.doc, `${path}/${entry.id}`)
          : []),
      ]);
    section("relations", [
      ...records(db.getRelations()).map((relation) =>
        describe({ ...relation, in: "root" }, ["id1", "id2", "relationTitle", "in"]),
      ),
      ...records(db.getStates()).flatMap((state) =>
        state.doc === undefined ? [] : relationsIn(state.doc, `root/${state.id}`),
      ),
    ]);
    console.log(`\n## direction\n  ${db.getDirection?.() ?? "(none recorded)"}`);
    return;
  }

  // Asked before the class-diagram branch for the same reason the state
  // branch is: an ER database *also* answers `getClasses` (it returns an
  // empty collection), so with the order reversed an ER document is reported
  // as a class diagram with no classes and then crashes on `getRelations`,
  // which ER does not have. The empty `## classes` table printed on the way
  // out is the dangerous part — it reads as a measurement. The state board
  // found this exact failure for state diagrams (commit `e545fbf`) after a
  // board had already read its empty table as a fact.
  //
  // The criterion is `getEntities` + `getRelationships`, which of the five
  // kinds this file reads only ER answers (measured: flowchart has
  // getVertices/getClasses/getSubGraphs, sequence only getMessages, state has
  // getStates/getClasses/getRelations, class has getClasses/getRelations).
  // So this branch cannot be reached by a class document, and moving it would
  // not make a class document reachable from here — but it would put ER back
  // in the class branch, so leave it above.
  if (typeof db.getEntities === "function" && typeof db.getRelationships === "function") {
    // `getEntities()` is a `Map` keyed by **the name the author wrote**, and
    // that key is not carried inside the value: the value's `id` is Mermaid's
    // own minted `entity-CUSTOMER-0`, and `label`/`alias` are the display
    // text. Relationships name entities by that minted `id`, so the key is
    // read off the entries here and the ids are translated back to it below —
    // printing the ids raw would make every relationship line unmatchable
    // against the source.
    const entities = [...db.getEntities().entries()];
    const authored = new Map(entities.map(([name, entity]) => [entity.id, name]));
    section(
      "entities (by the name the author wrote, attributes indented under each)",
      entities.flatMap(([name, entity]) => [
        `${name} ${describe(entity, ["id", "label", "alias", "shape", "cssClasses"])}`,
        ...records(entity.attributes).map(
          (attribute) =>
            `  attribute ${describe(
              { ...attribute, keys: records(attribute.keys).join(",") },
              ["type", "name", "keys", "comment"],
            )}`,
        ),
      ]),
    );

    // **Mermaid records a relationship's two cardinalities crossed over, and
    // this was measured here rather than remembered.** Three asymmetric
    // sources, each read back out of `getRelationships()`:
    //
    //     CUSTOMER ||--o{ ORDER      cardA=ZERO_OR_MORE  cardB=ONLY_ONE
    //     ORDER    }o--|| SHIPPER    cardA=ONLY_ONE      cardB=ZERO_OR_MORE
    //     ORDER    |o..|{ LINE_ITEM  cardA=ONE_OR_MORE   cardB=ZERO_OR_ONE
    //
    // In every one of them `cardA` is the marker written next to `entityB`
    // and `cardB` the marker written next to `entityA`. A symmetric source
    // (`||--||`, `}|--|{`) cannot tell the two apart, which is exactly how
    // this gets written backwards.
    //
    // So the crossing is undone here rather than passed on: the line below is
    // printed left-to-right in the source's own order — left entity, left
    // marker, relationship type, right marker, right entity — and the field
    // names `cardA`/`cardB` deliberately do not appear in the output. A
    // reader lining a line up against their source should never have to work
    // out which of A and B is which.
    section(
      "relationships (in Mermaid's own order; left and right are the source's, not Mermaid's A and B)",
      records(db.getRelationships()).map((relationship) =>
        describe(
          {
            leftEntity: authored.get(relationship.entityA) ?? relationship.entityA,
            leftCard: relationship.relSpec?.cardB,
            relType: relationship.relSpec?.relType,
            rightCard: relationship.relSpec?.cardA,
            rightEntity: authored.get(relationship.entityB) ?? relationship.entityB,
            label: relationship.roleA,
          },
          ["leftEntity", "leftCard", "relType", "rightCard", "rightEntity", "label"],
        ),
      ),
    );
    section("direction", [String(db.getDirection?.() ?? "(unset)")]);
    return;
  }

  if (typeof db.getClasses === "function") {
    section(
      "classes",
      records(db.getClasses()).map((cls) =>
        describe(cls, ["id", "type", "label", "annotations", "members", "methods", "cssClasses"]),
      ),
    );
    section(
      "relations",
      records(db.getRelations()).map((relation) =>
        describe(relation, ["id1", "id2", "relation", "title", "relationTitle1", "relationTitle2"]),
      ),
    );
    section(
      "notes",
      records(db.getNotes?.()).map((note) => describe(note, ["id", "class", "text"])),
    );
    return;
  }

  console.log(`\n## no reader for diagram type ${JSON.stringify(type)}`);
  console.log("  Add one above. Every getter this database answers, and what each");
  console.log("  returned for the document probed above — the ones holding something");
  console.log("  are the ones your reader wants:");
  for (const line of getterHints(db)) console.log(`    ${line}`);
}

/**
 * Which half of the drawn picture a label belongs to, named by the group
 * Mermaid put it in rather than by its own tag — the two mechanisms below
 * draw a label with different tags, and the question being asked is always
 * "whose label is this".
 */
function labelOwner(element) {
  if (element.closest(".edgeLabels") !== null) return "edge label";
  if (element.closest(".clusters") !== null) return "cluster label";
  if (element.closest(".nodes") !== null) return "node label";
  return "label";
}

/** One drawn label: what it says, what Mermaid wrote onto it, and what that resolves to. */
function paintLine(dom, element) {
  const resolved = dom.window.getComputedStyle(element);
  const text = element.textContent.replace(/\s+/g, " ").trim();
  const written = element.getAttribute("style");
  return (
    `${labelOwner(element)} ${JSON.stringify(text)} <${element.tagName}>` +
    ` style=${JSON.stringify(written)}` +
    ` resolves to fill=${resolved.fill || "(nothing inline)"}` +
    ` color=${resolved.color || "(nothing inline)"}`
  );
}

/**
 * The two ways Mermaid can draw a label, as the config that selects each and
 * the selector that finds the element carrying the paint.
 *
 * The selectors differ because the mechanisms do: an SVG label is a `<text>`
 * with tspans under it that inherit, and an HTML label is a `<span>` inside a
 * `<foreignObject>` with a `<p>` under it that does the same. Both name the
 * outermost element of the pair, which is the one Mermaid writes the author's
 * declaration onto.
 */
const LABEL_MECHANISMS = [
  {
    htmlLabels: false,
    title: "paint, with labels as SVG `<text>` (`htmlLabels: false` — the form Siren draws)",
    labels: "text",
  },
  {
    htmlLabels: true,
    title: "paint, with labels as HTML in a `<foreignObject>` (`htmlLabels: true` — Mermaid's default)",
    labels: "foreignObject span[class]",
  },
];

/**
 * What Mermaid's renderer actually paints, once per label mechanism.
 *
 * The SVG is put into the jsdom document rather than read as a string,
 * because the answer is a *computed* value: Mermaid emits a `<style>` block
 * inside the SVG whose selectors are scoped to its id, so what a label ends
 * up painted with is settled by the cascade between that block and whatever
 * inline declarations the author's directives produced. Reading the markup
 * alone would report the declaration and not the outcome, which is the
 * distinction this mode exists to make.
 */
/**
 * **Which elements Mermaid draws each node and cluster with** — the question
 * `--paint` cannot answer.
 *
 * `--paint` reports the paint landing on labels and edge paths, which
 * settles "does this directive reach the picture". It says nothing about
 * *figure*: whether a state's end marker is a ring around a disc or a plain
 * circle, how many elements a shape is built from, what Mermaid's own
 * stylesheet names them. A board needing that had to write a throwaway
 * jsdom script, twice, before this mode existed.
 *
 * Attributes are printed rather than the subtree's text, and geometry is
 * printed with them **knowing it is the layout stub's answer and not
 * Mermaid's** (the header says why). What survives that stub is the part
 * this mode is for: tag names, class names, nesting, and the shape of the
 * `d` a path is built from.
 */
async function reportMarkup(mermaid, dom, source) {
  mermaid.initialize({ startOnLoad: false, htmlLabels: false, flowchart: { htmlLabels: false } });
  let svg;
  try {
    ({ svg } = await mermaid.render("siren-probe-markup", source));
  } catch (error) {
    section("markup", ["MERMAID FAILED TO RENDER THIS", String(error.message)]);
    return;
  }
  const host = dom.window.document.createElement("div");
  host.innerHTML = svg;
  dom.window.document.body.appendChild(host);

  // A shape's `d` is a bezier approximation running to thousands of
  // characters, and none of it is readable as geometry — Mermaid draws a
  // circle as 30-odd curve segments. Printing it whole buries the tag names
  // and class names this mode exists to show, so a long value is cut and its
  // true length reported instead: "it is a path, and it is this big" is the
  // whole of what survives the layout stub anyway.
  const VALUE_LIMIT = 60;
  const describeValue = (value) =>
    value.length <= VALUE_LIMIT
      ? JSON.stringify(value)
      : `${JSON.stringify(value.slice(0, VALUE_LIMIT))}… (${value.length} chars)`;

  const describeElement = (element, depth) =>
    `${"  ".repeat(depth)}<${element.tagName}` +
    [...element.attributes]
      .filter((attribute) => attribute.name !== "style" || attribute.value !== "")
      .map((attribute) => ` ${attribute.name}=${describeValue(attribute.value)}`)
      .join("") +
    `>${element.children.length === 0 && element.textContent ? ` ${describeValue(element.textContent)}` : ""}`;

  const walk = (element, depth) => [
    describeElement(element, depth),
    ...[...element.children].flatMap((child) => walk(child, depth + 1)),
  ];

  // Nodes and clusters only. The `<style>` block Mermaid inlines is its own
  // theme rather than its figures, and printing it would bury them.
  for (const selector of ["g.node", "g.cluster", "g.statediagram-cluster"]) {
    const found = [...host.querySelectorAll(selector)];
    if (found.length === 0) continue;
    section(
      `markup — ${selector}`,
      found.flatMap((element) => [`--- id=${JSON.stringify(element.id)}`, ...walk(element, 1)]),
    );
  }
  host.remove();
}

async function reportPaint(mermaid, dom, source) {
  for (const { htmlLabels, title, labels } of LABEL_MECHANISMS) {
    mermaid.initialize({ startOnLoad: false, htmlLabels, flowchart: { htmlLabels } });
    let svg;
    try {
      ({ svg } = await mermaid.render(`siren-probe-${htmlLabels ? "html" : "svg"}`, source));
    } catch (error) {
      section(title, [`MERMAID FAILED TO RENDER THIS`, String(error.message)]);
      continue;
    }
    const host = dom.window.document.createElement("div");
    host.innerHTML = svg;
    dom.window.document.body.appendChild(host);
    section(title, [
      ...[...host.querySelectorAll(labels)].map((element) => paintLine(dom, element)),
      // Printed beside the labels rather than in a section of its own: the
      // question is nearly always whether a label agrees with its line.
      ...[...host.querySelectorAll(".edgePaths path")].map(
        (path) =>
          `edge path ${JSON.stringify(path.getAttribute("data-id"))}` +
          ` style=${JSON.stringify(path.getAttribute("style"))}`,
      ),
    ]);
    host.remove();
  }
}

const argv = process.argv.slice(2);
// Flags rather than positionals, and taken out of the list wherever they
// were written, so that `--paint` reads the same before a file path, after
// `pnpm run`'s own `--`, or at the end of a line someone is editing.
const FLAGS = ["--paint", "--markup"];
const wantsPaint = argv.includes("--paint");
const wantsMarkup = argv.includes("--markup");
const source = readSource(argv.filter((argument) => !FLAGS.includes(argument)));
if (source === null) {
  console.error(
    "usage: mermaid-probe.mjs [--paint] [--markup] <file> | --source <text> | -   (- reads stdin)",
  );
  process.exit(2);
}

const dom = await installDomGlobals();
if (wantsPaint || wantsMarkup) installLayoutStubs(dom);
const mermaid = (await import("mermaid")).default;
mermaid.initialize({ startOnLoad: false });

console.log(`# mermaid ${(await import("mermaid/package.json", { with: { type: "json" } })).default.version}`);
console.log("# source");
for (const line of source.replace(/\n$/, "").split("\n")) console.log(`  | ${line}`);

let diagram;
try {
  diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
} catch (error) {
  // A rejection is a measurement: it says the construct is not valid Mermaid,
  // and so does not belong in the compatibility corpus at all.
  console.log(`\n## MERMAID REJECTS THIS\n  ${String(error.message).split("\n").join("\n  ")}`);
  process.exit(1);
}

console.log(`\n## diagram type\n  ${diagram.type}`);
report(diagram.type, diagram.db);

// The parse is printed first even under `--paint`, because the two readings
// answer different halves of one question: the database says what Mermaid
// understood, and the paint says what it did with it. A directive present in
// the first and absent from the second is the finding.
if (wantsPaint) await reportPaint(mermaid, dom, source);
if (wantsMarkup) await reportMarkup(mermaid, dom, source);
