/**
 * Does a timeline highlight beat an author's `stroke` in a real browser?
 *
 *     pnpm --filter siren-core build
 *     node packages/core/scripts/highlight-author-stroke.mjs
 *     SIREN_PARITY_CHROME=/path/to/chrome node packages/core/scripts/highlight-author-stroke.mjs
 *
 * jsdom cannot answer it: its cascade ignores `!important` and lets an inline
 * declaration win regardless, so `default.test.ts` can show which rule the
 * theme declares and the controller tests can show that the author's
 * declaration is lifted, but neither can show what a browser paints when an
 * author wrote `stroke:#f00 !important`. This draws one document per kind
 * that accepts an author's style, in headless Chrome with `default.css`
 * applied, and reads the frame's computed `stroke` three times: before the
 * step, after `highlight … <effect>` with its transition run to the end, and
 * straight after `prev()` with no time allowed — a `prev()` that snaps reads
 * the author's color at once.
 *
 * "Run to the end" is `animation.finish()` on every running animation, not a
 * wait: under `--virtual-time-budget` headless Chrome let a second of
 * virtual time pass with most of the 300ms stroke transitions still running
 * (measured), so a read after a timer caught their starting color.
 *
 * Chrome on the command line (`--dump-dom`), as `layout-parity.mjs` drives
 * it and for its reasons: no browser-automation dependency, the Chrome
 * already on the machine. A measurement for a developer, never a test.
 *
 * Measured 2026-10-19 in Chrome 155 (macOS), the author's `#f00` reading
 * back as `rgb(255, 0, 0)` and the highlight color `#0d9488` as
 * `rgb(13, 148, 136)`: all fourteen rows — seven kinds under `outline` and
 * `glow`, `!important` wherever the kind's `style` accepts it (an ER
 * `style` refuses it) — read `rgb(255, 0, 0)` before, `rgb(13, 148, 136)`
 * highlighted and `rgb(255, 0, 0)` straight after `prev()`. With the
 * controller's lift disabled, every row read `rgb(255, 0, 0)` highlighted.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = resolve(HERE, "..");
const SIREN_BUILD = join(PACKAGE, "dist", "siren-core.js");
const THEME = join(PACKAGE, "src", "theme", "default.css");
const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RESULT_ID = "result";

/** One document per kind: its source, the target to highlight, and the frame carrying the author's stroke. */
const KINDS = [
  ["node", "flowchart TB\n  A --> B\n  style A stroke:#f00 !important", "A", '[data-siren-id="A"] .siren-node-frame'],
  ["edge", "flowchart TB\n  A --> B\n  linkStyle 0 stroke:#f00 !important", "A-B", 'path.siren-edge[data-siren-id="A-B"]'],
  [
    "subgraph",
    "flowchart TB\n  subgraph s1 [Box]\n    A\n  end\n  style s1 stroke:#f00 !important",
    "subgraph:1",
    '[data-siren-id="subgraph:1"] .siren-subgraph-frame',
  ],
  ["class", "classDiagram\n  class Duck\n  style Duck stroke:#f00 !important", "Duck", '[data-siren-id="Duck"] .siren-class-frame'],
  ["state", "stateDiagram-v2\n  [*] --> Idle\n  style Idle stroke:#f00 !important", "Idle", '[data-siren-id="Idle"] .siren-state-frame'],
  [
    "composite",
    "stateDiagram-v2\n  state Outer {\n    Inner\n  }\n  style Outer stroke:#f00 !important",
    "Outer",
    '[data-siren-id="Outer"] .siren-composite-frame',
  ],
  ["entity", "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  style CUSTOMER stroke:#f00", "CUSTOMER", '[data-siren-id="CUSTOMER"] .siren-er-entity-frame'],
];

const CASES = KINDS.flatMap(([kind, source, id, selector]) =>
  ["outline", "glow"].map((effect) => ({
    kind,
    effect,
    source: `${source}\ntimeline:\nhighlight ${id} ${effect}`,
    selector,
  })),
);

function die(message) {
  process.stderr.write(`highlight-author-stroke: ${message}\n`);
  process.exit(1);
}

function buildPage(sirenUrl, themeUrl) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="${themeUrl}"></head>
<body><pre id="${RESULT_ID}">pending</pre>
<script>
window.addEventListener("error", (event) => {
  document.getElementById(${JSON.stringify(RESULT_ID)}).textContent =
    JSON.stringify({ pageError: String(event.error ?? event.message) });
});
</script>
<script type="module">
import { render } from ${JSON.stringify(sirenUrl)};
const out = document.getElementById(${JSON.stringify(RESULT_ID)});
try {
  const cases = ${JSON.stringify(CASES)};
  const rows = [];
  for (const c of cases) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const { controller, diagnostics } = render(c.source, container);
    if (diagnostics.length > 0) throw new Error(c.kind + ": " + diagnostics.map((d) => d.message).join("; "));
    const frame = container.querySelector(c.selector);
    const before = getComputedStyle(frame).stroke;
    controller.next();
    for (const animation of document.getAnimations()) animation.finish();
    const highlighted = getComputedStyle(frame).stroke;
    controller.prev();
    const afterPrev = getComputedStyle(frame).stroke;
    rows.push({ kind: c.kind, effect: c.effect, before, highlighted, afterPrev });
  }
  out.textContent = JSON.stringify(rows);
} catch (error) {
  out.textContent = JSON.stringify({ pageError: String(error && error.stack ? error.stack : error) });
}
</script></body></html>`;
}

function dumpDom(chrome, pageUrl) {
  return new Promise((done) => {
    execFile(
      chrome,
      ["--headless=new", "--disable-gpu", "--allow-file-access-from-files", "--virtual-time-budget=60000", "--dump-dom", pageUrl],
      { maxBuffer: 64 * 1024 * 1024, timeout: 5 * 60_000 },
      (error, stdout, stderr) => {
        if (error) die(`Chrome failed (${chrome}): ${error.message}\n${stderr}`);
        done(stdout);
      },
    );
  });
}

const chrome = process.env.SIREN_PARITY_CHROME ?? DEFAULT_CHROME;
if (!existsSync(chrome)) die(`Chrome not found at ${chrome}. Set SIREN_PARITY_CHROME to a Chrome or Chromium binary.`);
if (!existsSync(SIREN_BUILD)) die(`${SIREN_BUILD} is missing. Run pnpm --filter siren-core build first.`);

const workDir = mkdtempSync(join(tmpdir(), "siren-highlight-"));
process.on("exit", () => rmSync(workDir, { recursive: true, force: true }));
const pagePath = join(workDir, "page.html");
writeFileSync(pagePath, buildPage(pathToFileURL(SIREN_BUILD).href, pathToFileURL(THEME).href));

const dom = await dumpDom(chrome, pathToFileURL(pagePath).href);
const match = new RegExp(`<pre id="${RESULT_ID}">([\\s\\S]*?)</pre>`).exec(dom);
if (!match) die("the page's result element is missing from Chrome's DOM dump.");
const result = JSON.parse(match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
if (!Array.isArray(result)) die(`the page script failed:\n${result.pageError}`);

for (const r of result) {
  process.stdout.write(
    `${r.kind.padEnd(10)} ${r.effect.padEnd(8)} before ${r.before}  highlighted ${r.highlighted}  after prev() ${r.afterPrev}\n`,
  );
}
