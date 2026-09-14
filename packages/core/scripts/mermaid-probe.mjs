/**
 * The Mermaid probe: ask real Mermaid what a document means.
 *
 *     node packages/core/scripts/mermaid-probe.mjs --source 'flowchart TB
 *     A[(DB)] --> B'
 *     node packages/core/scripts/mermaid-probe.mjs some-diagram.mmd
 *     cat some-diagram.mmd | node packages/core/scripts/mermaid-probe.mjs -
 *     pnpm --filter @siren/core probe some-diagram.mmd
 *     node packages/core/scripts/mermaid-probe.mjs --paint --source 'flowchart TB
 *     A -->|yes| B
 *     linkStyle 0 stroke:#00ff00,color:#ff0000'
 *     pnpm --filter @siren/core probe --paint some-diagram.mmd
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
 * eating it, so the habitual `pnpm --filter @siren/core probe -- --paint`
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
// A flag rather than a positional, and taken out of the list wherever it
// was written, so that `--paint` reads the same before a file path, after
// `pnpm run`'s own `--`, or at the end of a line someone is editing.
const wantsPaint = argv.includes("--paint");
const source = readSource(argv.filter((argument) => argument !== "--paint"));
if (source === null) {
  console.error(
    "usage: mermaid-probe.mjs [--paint] <file> | --source <text> | -   (- reads stdin)",
  );
  process.exit(2);
}

const dom = await installDomGlobals();
if (wantsPaint) installLayoutStubs(dom);
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
