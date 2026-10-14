/**
 * The examples check: every Siren document this repository ships, with its
 * timeline blocks removed, must be a document Mermaid 12.2.0 accepts.
 *
 *     pnpm --filter siren-core check-examples
 *     pnpm --filter siren-core check-examples -- diagram.srn other.srn
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
 * The files named on the command line, when any are (a relative path is read
 * from the directory the command was typed in); otherwise every document the
 * repository ships: `examples/*.srn` and the root's `commerce-domain.srn`. The pages
 * under `demos/` inline no Siren source — every one `fetch()`es its document
 * from `examples/` — so they add nothing to the list.
 *
 * ## The removal rule
 *
 * CONTEXT.md **Timeline block**: an unnamed `timeline:` or a named
 * `timeline <name>:` header opens a block, which runs to the next timeline
 * header or the end of the document. Blocks only ever follow the diagram, so
 * everything from the first timeline header to the end is removed — cut from
 * the document as written, so what Mermaid is handed is the author's text.
 *
 * Where that header is, is found the way `parseSiren` finds it: on the
 * document as `asMermaidReads` (`src/parser/parseSiren.ts`) reads it, its
 * lines split on every spelling of a line break, its frontmatter and
 * `%%{…}%%` directives blanked in place, and every `%%` comment, whole-line
 * or end-of-line, removed. The diagram's header is the first line left that
 * is not blank, and the first line below it that is a timeline header
 * (`isTimelineHeader` in `src/parser/parseTimelineBlock.ts`) starts the
 * blocks. Tag-quote rewriting and the style-line rule are not repeated: they
 * change no line break and cannot make or unmake a header line.
 *
 * Each rule is a small reimplementation of the TypeScript one, named beside
 * it — importing `src/` from here is not possible without a build step. The
 * self-test below pins the result; it runs before every check.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Mirrors `isTimelineHeader` in `src/parser/parseTimelineBlock.ts`. */
const TIMELINE_HEADER_RE = /^timeline(?: (\S+))?:\s*$/;

/** Mirrors `DIRECTIVE` in `src/parser/documentConfig.ts` (Mermaid's `directiveRegex`). */
const DIRECTIVE = /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi;

/** Mermaid's `whitespace`, as `documentConfig.ts` spells it. */
const WHITESPACE = /\s/;
const isLineBreak = (char) => char === "\n" || char === "\r";

/** Mirrors `lastLineBreakInWhitespaceRun` in `src/parser/documentConfig.ts`. */
function lastLineBreakInWhitespaceRun(text, from) {
  let index = -1;
  for (let i = from; i < text.length && WHITESPACE.test(text[i]); i++) {
    if (isLineBreak(text[i])) index = i;
  }
  return index;
}

/**
 * Mirrors `matchFrontmatter` in `src/parser/documentConfig.ts` (Mermaid
 * 12.2.0's `matchFrontMatter`), reduced to what is needed here: how many
 * characters at the top of `text` the frontmatter takes up, or 0 for none.
 */
function frontmatterLength(text) {
  let cursor = 0;
  while (cursor < text.length && WHITESPACE.test(text[cursor]) && !isLineBreak(text[cursor])) cursor++;
  const indent = text.slice(0, cursor);
  if (!text.startsWith("---", cursor)) return 0;
  const openingEnds = [];
  for (let i = cursor + 3; i < text.length && WHITESPACE.test(text[i]); i++) {
    if (isLineBreak(text[i])) openingEnds.push(i);
  }
  if (openingEnds.length === 0) return 0;
  const closingFence = `${indent}---`;
  const closingEnd = (i) =>
    isLineBreak(text[i]) && text.startsWith(closingFence, i + 1)
      ? lastLineBreakInWhitespaceRun(text, i + 1 + closingFence.length)
      : -1;
  let lastClosingFence = -1;
  for (let i = openingEnds[0] + 1; i < text.length; i++) {
    if (closingEnd(i) !== -1) lastClosingFence = i;
  }
  if (lastClosingFence === -1) return 0;
  let openingEnd = openingEnds[0];
  for (const candidate of openingEnds) {
    if (candidate < lastClosingFence) openingEnd = candidate;
  }
  for (let i = openingEnd + 1; i <= lastClosingFence; i++) {
    const matchEnd = closingEnd(i);
    if (matchEnd !== -1) return matchEnd + 1;
  }
  return 0;
}

/** Every character but a line break turned into a space, so no line moves. */
const blanked = (text) => text.replace(/[^\n]/g, " ");

/**
 * The lines of `source` as `parseSiren` tests them for a header: split on
 * `\r\n`, `\r` or `\n`; frontmatter, then directives, blanked in place; and
 * each line cut at its first `%%`. One line per line as written.
 */
function linesAsSirenReads(source) {
  let text = source.split(/\r\n|\r|\n/).join("\n");
  const frontmatter = frontmatterLength(text);
  text = blanked(text.slice(0, frontmatter)) + text.slice(frontmatter);
  text = text.replace(DIRECTIVE, blanked);
  return text.split("\n").map((line) => {
    const commentStart = line.indexOf("%%");
    return commentStart === -1 ? line : line.slice(0, commentStart);
  });
}

/** `source` with every timeline block removed: the Mermaid half of the document. */
export function stripTimelineBlocks(source) {
  const lines = linesAsSirenReads(source);
  const diagramHeader = lines.findIndex((line) => line.trim().length > 0);
  if (diagramHeader === -1) return source;
  const firstBlock = lines.findIndex((line, index) => index > diagramHeader && TIMELINE_HEADER_RE.test(line.trim()));
  if (firstBlock === -1) return source;
  // Where line `firstBlock` starts in the source as written.
  const breaks = [...source.matchAll(/\r\n|\r|\n/g)];
  const cut = firstBlock === 0 ? 0 : breaks[firstBlock - 1].index + breaks[firstBlock - 1][0].length;
  return source.slice(0, cut);
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
  {
    name: "a frontmatter is not the diagram, even where its YAML spells a header",
    source:
      "---\nconfig:\n  timeline:\n    disableMulticolor: true\n---\nflowchart TB\n  A --> B\ntimeline:\n  enter A fade\n",
    expected: "---\nconfig:\n  timeline:\n    disableMulticolor: true\n---\nflowchart TB\n  A --> B\n",
  },
  {
    name: "a multi-line init above the header is blanked whole, whatever its lines hold",
    source: '%%{init: {\n  "theme": "dark"\ntimeline:\n}}%%\nflowchart TB\n  A --> B\ntimeline:\n  enter A fade\n',
    expected: '%%{init: {\n  "theme": "dark"\ntimeline:\n}}%%\nflowchart TB\n  A --> B\n',
  },
  {
    name: "an end-of-line comment after a header does not stop it opening a block",
    source: "flowchart TB\n  A --> B\ntimeline: %% steps\n  enter A fade\n",
    expected: "flowchart TB\n  A --> B\n",
  },
  {
    name: "a file whose lines end in a lone \\r is read line by line",
    source: "flowchart TB\r  A --> B\rtimeline:\r  enter A fade\r",
    expected: "flowchart TB\r  A --> B\r",
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

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (!runSelfTest()) process.exit(1);
if (args.includes("--self-test")) process.exit(0);

/** The Siren documents this repository ships, as absolute paths, in a stable order. */
function shippedDocuments() {
  const examples = join(REPO_ROOT, "examples");
  return [
    ...readdirSync(examples)
      .filter((name) => name.endsWith(".srn"))
      .sort()
      .map((name) => join(examples, name)),
    join(REPO_ROOT, "commerce-domain.srn"),
  ];
}

// `pnpm --filter` runs this from the package directory, so a relative path is
// resolved against the directory the command was typed in (`INIT_CWD`).
const typedFrom = process.env.INIT_CWD ?? process.cwd();
const named = args.filter((argument) => !argument.startsWith("--"));
const documents =
  named.length > 0 ? named.map((path) => (isAbsolute(path) ? path : resolve(typedFrom, path))) : shippedDocuments();

/** How a document is named in the output: repository-relative when it is inside it. */
function displayName(path) {
  const inRepo = relative(REPO_ROOT, path);
  return inRepo.startsWith("..") || isAbsolute(inRepo) ? path : inRepo;
}

const { loadMermaid } = await import("./mermaid-loader.mjs");
const { mermaid, version } = await loadMermaid();
console.log(`# mermaid ${version}: each document with its timeline blocks removed`);

let failed = 0;
for (const path of documents) {
  const name = displayName(path);
  try {
    const diagramHalf = stripTimelineBlocks(readFileSync(path, "utf8"));
    await mermaid.mermaidAPI.getDiagramFromText(diagramHalf);
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}\n  ${String(error?.message ?? error).split("\n").join("\n  ")}`);
  }
}

console.log(`\n${documents.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
