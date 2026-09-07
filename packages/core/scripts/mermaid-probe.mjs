/**
 * The Mermaid probe: ask real Mermaid what a document means.
 *
 *     node packages/core/scripts/mermaid-probe.mjs --source 'flowchart TB
 *     A[(DB)] --> B'
 *     node packages/core/scripts/mermaid-probe.mjs some-diagram.mmd
 *     cat some-diagram.mmd | node packages/core/scripts/mermaid-probe.mjs -
 *     pnpm --filter @siren/core probe some-diagram.mmd
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
 * Mermaid's *own* parse result — the vertices, edges, messages and classes its
 * database recorded — because that is the picture it will draw, and comparing
 * pictures is the whole point. A parse error is printed too: "Mermaid rejects
 * this" is as much a measurement as any other, and it is the answer that tells
 * you a construct does not belong in the corpus.
 *
 * ## How it drives Mermaid
 *
 * Mermaid is browser-only: its label path calls `DOMPurify.addHook`, so a DOM
 * has to exist before the module is imported. jsdom globals are installed
 * first (jsdom is already this package's test environment), and then
 * `mermaidAPI.getDiagramFromText` runs the real grammar over the text and
 * hands back the diagram's database. No rendering, no layout — just the parse.
 */
import { readFileSync } from "node:fs";

/** Install the browser globals Mermaid's module-load path needs, before it loads. */
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
  ];
  for (const name of names) {
    if (globalThis[name] === undefined) globalThis[name] = dom.window[name];
  }
}

/** The document to probe: a file path, `--source <text>`, or `-` for stdin. */
function readSource(argv) {
  const [first, ...rest] = argv;
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
  console.log("  Add one above — the database's own getters are:");
  console.log(
    `  ${Object.keys(db).filter((key) => typeof db[key] === "function").join(", ")}`,
  );
}

const source = readSource(process.argv.slice(2));
if (source === null) {
  console.error("usage: mermaid-probe.mjs <file> | --source <text> | -   (- reads stdin)");
  process.exit(2);
}

await installDomGlobals();
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
