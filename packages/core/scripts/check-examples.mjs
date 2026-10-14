/**
 * The examples check: every Siren document this repository ships, with its
 * timeline blocks removed, must be a document Mermaid 12.2.0 accepts.
 *
 *     pnpm --filter siren-core check-examples
 *     pnpm --filter siren-core check-examples --self-test
 *
 * ADR-0017: "a Siren document with its timeline blocks removed is a Mermaid
 * document". Text Siren itself produces — the examples, the skill's output,
 * what the GUI writes — is held to that absolutely, and this script is the
 * check. It asks only whether Mermaid *parses* the diagram half
 * (`mermaidAPI.getDiagramFromText`); a construct Mermaid accepts but draws
 * differently passes here.
 *
 * Lives under `scripts/`, never `src/` (ADR-0001), and loads Mermaid the same
 * way `mermaid-probe.mjs` does, through `mermaid-loader.mjs`.
 *
 * ## What is checked
 *
 * `examples/*.srn` and the repository root's `commerce-domain.srn`. The pages
 * under `demos/` inline no Siren source — every one `fetch()`es its document
 * from `examples/` — so they add nothing to the list.
 *
 * ## The removal rule
 *
 * CONTEXT.md **Timeline block**: an unnamed `timeline:` or a named
 * `timeline <name>:` header opens a block, which runs to the next timeline
 * header or the end of the document. Blocks only ever follow the diagram, so
 * everything from the first timeline header to the end is removed. The header
 * predicate is a reimplementation of `isTimelineHeader` in
 * `src/parser/parseTimelineBlock.ts` (a trimmed line matching
 * `/^timeline(?: (\S+))?:\s*$/`), and the search starts below the diagram's
 * header line, as `parseSiren`'s `firstTimelineHeader` does — importing the
 * TypeScript source from here is not possible without a build step. The
 * self-test below pins the rule; it runs before every check.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Mirrors `isTimelineHeader` in `src/parser/parseTimelineBlock.ts`. */
const TIMELINE_HEADER_RE = /^timeline(?: (\S+))?:\s*$/;

function isTimelineHeader(line) {
  return TIMELINE_HEADER_RE.test(line.trim());
}

/** `source` with every timeline block removed: the Mermaid half of the document. */
export function stripTimelineBlocks(source) {
  const lines = source.split("\n");
  // The diagram's header: the first line that is neither blank nor a `%%`
  // comment (parseSiren finds it after removing comments).
  const diagramHeader = lines.findIndex((line) => line.trim().length > 0 && !line.trim().startsWith("%%"));
  if (diagramHeader === -1) return source;
  const firstBlock = lines.findIndex((line, index) => index > diagramHeader && isTimelineHeader(line));
  if (firstBlock === -1) return source;
  return lines.slice(0, firstBlock).map((line) => `${line}\n`).join("");
}

/** Each case: a Siren document and the Mermaid document it must reduce to. */
const SELF_TEST_CASES = [
  {
    name: "no timeline block leaves the document unchanged",
    source: "flowchart TB\n  A --> B\n",
    expected: "flowchart TB\n  A --> B\n",
  },
  {
    name: "an unnamed timeline: block is removed to the end",
    source: "flowchart TB\n  A --> B\n\ntimeline:\n  enter A fade\n  enter B fade\n",
    expected: "flowchart TB\n  A --> B\n\n",
  },
  {
    name: "every named block is removed, from the first header on",
    source:
      "classDiagram\n  class A\n\ntimeline card:\n  enter A fade\n\ntimeline wallet:\n  enter A slide-left\n",
    expected: "classDiagram\n  class A\n\n",
  },
  {
    name: "an indented header with trailing space still opens a block",
    source: "flowchart TB\n  A --> B\n  timeline:  \n  enter A fade\n",
    expected: "flowchart TB\n  A --> B\n",
  },
  {
    name: "lines that only resemble a header are diagram text",
    source: "flowchart TB\n  timeline --> B\n  %% timeline:\n  timeline a b:\n  timelines:\n",
    expected: "flowchart TB\n  timeline --> B\n  %% timeline:\n  timeline a b:\n  timelines:\n",
  },
];

/** The cases `stripTimelineBlocks` gets wrong, as printable lines; empty when it passes. */
function selfTestFailures() {
  const failures = [];
  for (const { name, source, expected } of SELF_TEST_CASES) {
    const actual = stripTimelineBlocks(source);
    if (actual !== expected) {
      failures.push(`self-test FAIL: ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
    }
  }
  return failures;
}

function runSelfTest() {
  const failures = selfTestFailures();
  for (const failure of failures) console.log(failure);
  if (failures.length > 0) return false;
  console.log(`self-test PASS: ${SELF_TEST_CASES.length} removal cases`);
  return true;
}

const argv = process.argv.slice(2).filter((argument) => argument !== "--");
if (!runSelfTest()) process.exit(1);
if (argv.includes("--self-test")) process.exit(0);

/** The Siren documents this repository ships, as absolute paths, in a stable order. */
function documentsToCheck() {
  const examples = join(REPO_ROOT, "examples");
  return [
    ...readdirSync(examples)
      .filter((name) => name.endsWith(".srn"))
      .sort()
      .map((name) => join(examples, name)),
    join(REPO_ROOT, "commerce-domain.srn"),
  ];
}

const { loadMermaid } = await import("./mermaid-loader.mjs");
const { mermaid, version } = await loadMermaid();
console.log(`# mermaid ${version}: each document with its timeline blocks removed`);

let failed = 0;
const documents = documentsToCheck();
for (const path of documents) {
  const name = relative(REPO_ROOT, path);
  const diagramHalf = stripTimelineBlocks(readFileSync(path, "utf8"));
  try {
    await mermaid.mermaidAPI.getDiagramFromText(diagramHalf);
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}\n  ${String(error?.message ?? error).split("\n").join("\n  ")}`);
  }
}

console.log(`\n${documents.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
