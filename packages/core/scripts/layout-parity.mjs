/**
 * The layout parity report: how far Siren's picture of a Mermaid document is
 * from Mermaid's own.
 *
 *     pnpm --filter siren-core build             # the report draws dist/siren-core.js
 *     pnpm --filter siren-core parity            # every scripts/parity-fixtures/*.mmd
 *     pnpm --filter siren-core parity a.mmd b.mmd
 *     pnpm --filter siren-core parity --json     # { diagrams: [one per diagram], totals }
 *     SIREN_PARITY_CHROME=/path/to/chrome pnpm --filter siren-core parity
 *
 * For every diagram it draws the same source twice in one headless Chrome
 * page — once with `mermaid@12.2.0` at its defaults (`startOnLoad: false`,
 * no theme or layout settings), once with siren-core's standalone build and
 * the canvas text measurer siren-board uses — and reads back each node's box and
 * each edge's path.
 * Nodes are matched across the two pictures by the id the author wrote
 * (`scripts/parity/ids.mjs` says how that id is read off Mermaid's DOM). Per
 * diagram it prints:
 *
 * - node counts and the nodes only one side drew (unmatched, kept out of the
 *   numbers below);
 * - **structural agreement**: over every pair of matched nodes, the share
 *   whose above/below relation is the same in both pictures, and separately
 *   the share whose left/right relation is;
 * - **normalized position error**: each picture's node centers scaled to
 *   0..1 on each axis, then the mean and max distance between a node's two
 *   centers, and the five nodes that moved most;
 * - **node size**: the mean of Siren's width over Mermaid's, and of the
 *   heights, with Siren's 14px text scaled to Mermaid's 16px and then raw,
 *   and the five nodes whose size is furthest from Mermaid's (every node's
 *   two boxes are in the `--json` output);
 * - **edge metrics**, for each side on its own (they read one picture, not
 *   the distance between two): how many times two edges cross, how many
 *   edges are drawn across a node that is not one of their ends, how many
 *   across a group's title, how many overshoot their ends and turn back,
 *   the mean detour (drawn length over the straight distance between an
 *   edge's ends), and the picture's aspect ratio. Each line is sampled along
 *   its drawn path (`getPointAtLength`) with any line-jump arc straightened
 *   first, so a crossing a jump marks is still counted.
 *
 * After the last diagram come the **totals** over every diagram both sides
 * drew — each side's crossings, edges through nodes and through titles, and
 * reversals, summed; how many diagrams each side failed to draw; and the
 * structural agreement pooled over every matched pair in the corpus (the
 * agreeing pairs summed over the pairs summed, not a mean of percentages).
 * `--json` prints one object, `{ diagrams, totals }`: the per-diagram array
 * under `diagrams`, the same totals beside it. In both, a side's one edge
 * count is the number of lines its edge selector sampled.
 *
 * The metrics are pure functions in `scripts/parity/metrics.mjs`, tested with
 * `node --test scripts/parity`; this file is the part that needs Chrome.
 *
 * ## Division of labour with `mermaid-probe.mjs`
 *
 * The probe asks **"what does Mermaid understand this document to mean?"** —
 * its parse, its paint, its label markup — and runs in jsdom, where `getBBox`
 * is stubbed and every coordinate is the stub's. This script asks **"how far
 * apart are the two pictures?"**, which only a real layout engine can answer,
 * so it runs in a real browser and reads nothing but geometry.
 *
 * ## Why Chrome on the command line, not playwright or puppeteer
 *
 * The one thing needed from a browser is "load this page, wait for it, give
 * back the DOM", and `chrome --headless=new --dump-dom` already does that
 * (`--virtual-time-budget` lets the page's async rendering finish first).
 * A development script that a handful of people run by hand does not earn a
 * browser-automation dependency and its download; it uses the Chrome already
 * on the machine, at `SIREN_PARITY_CHROME` or the default macOS path.
 *
 * ## Why it is not in CI and has no threshold
 *
 * The numbers move with the installed fonts and the browser version: a label
 * a pixel wider can reorder a dagre rank. A threshold would fail on a font
 * update with no change to Siren, so this is a measurement for a developer —
 * each ticket of the Mermaid-parity board records its numbers before and
 * after — and never a test. Only a failure to *run* exits non-zero: Chrome
 * missing, the page throwing, or a diagram one side could not draw.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  corpusTotals,
  exitCodeFor,
  failedSides,
  formatText,
  formatTotals,
  jsonReport,
  parseArgs,
  reportDiagram,
} from "./parity/cli.mjs";
import { buildPage, PENDING, RESULT_ID } from "./parity/page.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = resolve(HERE, "..");
const FIXTURES = join(HERE, "parity-fixtures");
const SIREN_BUILD = join(PACKAGE, "dist", "siren-core.js");
const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** Virtual milliseconds Chrome lets the page run before dumping the DOM. */
const TIME_BUDGET_MS = 60_000;

/** Print a run failure and exit non-zero. */
function die(message) {
  process.stderr.write(`parity: ${message}\n`);
  process.exit(1);
}

/**
 * Mermaid's IIFE bundle, which loads standalone in a page and sets the global
 * `mermaid`. Resolved through the package's own `exports`, so it is the
 * pinned devDependency and not whatever else is on disk.
 */
function mermaidBundle() {
  const require = createRequire(join(PACKAGE, "package.json"));
  let entry;
  try {
    entry = require.resolve("mermaid");
  } catch {
    die("mermaid is not installed (it is a devDependency of siren-core; run pnpm install).");
  }
  let dir = dirname(entry);
  while (!existsSync(join(dir, "package.json"))) dir = dirname(dir);
  return join(dir, "dist", "mermaid.min.js");
}

/** The files to compare: the arguments, or every fixture. */
function diagramFiles(files) {
  if (files.length > 0) {
    // pnpm runs package scripts from the package directory; INIT_CWD is where
    // the developer typed the command, which is what a relative path means.
    // A bare name that is not there is looked up among the fixtures, so
    // `parity long-edges.mmd` works from anywhere.
    const base = process.env.INIT_CWD ?? process.cwd();
    return files.map((f) => {
      const typed = resolve(base, f);
      const fixture = join(FIXTURES, f);
      return !existsSync(typed) && existsSync(fixture) ? fixture : typed;
    });
  }
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".mmd"))
    .sort()
    .map((f) => join(FIXTURES, f));
}

/** Run headless Chrome over the page and return the DOM it dumps. */
function dumpDom(chrome, pageUrl) {
  return new Promise((resolveDom) => {
    execFile(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--allow-file-access-from-files",
        `--virtual-time-budget=${TIME_BUDGET_MS}`,
        "--dump-dom",
        pageUrl,
      ],
      { maxBuffer: 512 * 1024 * 1024, timeout: 5 * 60_000 },
      (error, stdout, stderr) => {
        if (error) die(`Chrome failed (${chrome}): ${error.message}\n${stderr}`);
        resolveDom(stdout);
      },
    );
  });
}

/** The JSON the page left in its result element, entity-decoded. */
function readResult(dom) {
  const match = new RegExp(`<pre id="${RESULT_ID}">([\\s\\S]*?)</pre>`).exec(dom);
  if (!match) die("the page's result element is missing from Chrome's DOM dump.");
  const text = match[1]
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");
  if (text === PENDING) die(`the page never finished within ${TIME_BUDGET_MS} ms of virtual time.`);
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) die(`the page script failed:\n${parsed.pageError}`);
  return parsed;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    die(error.message);
  }

  const chrome = process.env.SIREN_PARITY_CHROME ?? DEFAULT_CHROME;
  if (!existsSync(chrome)) {
    die(`Chrome not found at ${chrome}. Set SIREN_PARITY_CHROME to a Chrome or Chromium binary.`);
  }
  if (!existsSync(SIREN_BUILD)) {
    die(`${SIREN_BUILD} is missing. Run pnpm --filter siren-core build first.`);
  }

  const files = diagramFiles(args.files);
  for (const f of files) if (!existsSync(f)) die(`no such diagram file: ${f}`);
  const diagrams = files.map((f) => ({ file: basename(f), source: readFileSync(f, "utf8") }));

  const workDir = mkdtempSync(join(tmpdir(), "siren-parity-"));
  const cleanUp = () => rmSync(workDir, { recursive: true, force: true });
  process.on("exit", cleanUp);

  const pagePath = join(workDir, "parity.html");
  writeFileSync(
    pagePath,
    buildPage({
      mermaidUrl: pathToFileURL(mermaidBundle()).href,
      sirenUrl: pathToFileURL(SIREN_BUILD).href,
      idsUrl: pathToFileURL(join(HERE, "parity", "ids.mjs")).href,
      metricsUrl: pathToFileURL(join(HERE, "parity", "metrics.mjs")).href,
      diagrams,
    }),
  );

  const drawn = readResult(await dumpDom(chrome, pathToFileURL(pagePath).href));
  const results = drawn.map(reportDiagram);

  if (args.json) {
    process.stdout.write(jsonReport(results));
  } else {
    process.stdout.write(formatText(results));
    process.stdout.write(`\n${formatTotals(corpusTotals(results))}`);
    for (const r of results) {
      for (const side of failedSides(r)) process.stderr.write(`parity: ${side} could not draw ${r.file}\n`);
    }
  }
  process.exitCode = exitCodeFor(results);
}

await main();
