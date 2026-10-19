/**
 * Does a flowchart edge's arrowhead take the colour its line is painted, in
 * a real browser?
 *
 *     pnpm --filter siren-core build
 *     node packages/core/scripts/edge-arrowhead-colour.mjs
 *     SIREN_PARITY_CHROME=/path/to/chrome node packages/core/scripts/edge-arrowhead-colour.mjs
 *     node packages/core/scripts/edge-arrowhead-colour.mjs --without-context-stroke
 *
 * jsdom cannot answer it: it resolves no `var()` and paints nothing, so
 * `default.test.ts` can show which paint the theme gives a head and the
 * renderer tests which marker an edge points at, but neither can show the
 * colour a browser draws a `context-stroke` head in. So this reads pixels:
 * one cell per
 * case, drawn in headless Chrome with `default.css` applied, then
 * screenshotted, and the pixel at the middle of the line compared with the
 * pixel inside the head.
 *
 * Every end shape (`-->`, `--o`, `--x`) is drawn four ways — unstyled,
 * coloured by `linkStyle 0 stroke:#f00`, coloured the same with
 * `omitAuthorStyles: ["stroke"]`, and unstyled beside a second edge out of
 * the same node (`A-->B; A-->C`), whose two paths point at one theme
 * marker and only A-B is acted on, both heads read — in five states: as drawn, with
 * `--siren-edge-stroke: #00f` redeclared on the edge's own
 * `path[data-siren-id]`, highlighted under `outline` and under `glow` with
 * the transition run to its end, and straight after `prev()`. Where a head
 * is sampled depends on the shape: inside a filled head, on the top of the
 * ring, on one stroke of the cross — each clear of the line itself, so a
 * head drawn in the wrong colour cannot be hidden by the line beneath it.
 *
 * "Run to the end" is `animation.finish()` on every running animation, for
 * the reason `highlight-author-stroke.mjs` gives. `prev()` is read twice:
 * the line's computed `stroke` the moment it returns, which shows the snap,
 * and the pixels at the end, which show the head followed the line back.
 *
 * `--without-context-stroke` serves the theme with every `context-stroke`
 * declaration taken out, which is what a browser that does not know the
 * keyword is left with (Safari, per default.css), so the fallback is
 * measured in the same Chrome.
 *
 * Two Chrome runs of one page: `--dump-dom` hands back the sample points,
 * `--screenshot` the pixels. The page draws the same thing both times.
 * Chrome on the command line, as `layout-parity.mjs` drives it and for its
 * reasons: no browser-automation dependency, the Chrome already on the
 * machine. A measurement for a developer, never a test.
 *
 * Measured 2026-10-19 in Chrome 155 (macOS), at device scale 2, the same
 * for all three shapes. Before the change, a head kept its marker's colour:
 * a token redeclared on the path turned an unstyled line `#0000ff` and left
 * its head the theme's `#6f6a84`, and a highlight turned the line `#0d9488`
 * and left the head `#6f6a84`, or the author's `#ff0000` — 24 of the 45 rows
 * differed. After it, all 45 read the head the line's own colour, and
 * `prev()` had the line's computed stroke back at its colour before the
 * step with no time allowed. (An author's `stroke` still outranks a token
 * redeclared on its edge, line and head alike, as it outranks every token.)
 * The two-edge cases, added 2026-10-19 in the same Chrome, read one marker
 * on both paths and each head its own line's colour: A-B `#0000ff` under
 * its redeclared token and `#0d9488` under `outline` and `glow`, while
 * A-C, on the same marker, stayed `#6f6a84` with its line — all 30 rows the
 * same, and the 45 above unchanged.
 * Without `context-stroke`, the rows read as they did before the change:
 * the author's head `#ff0000` from its marker's own token, the theme's head
 * `#6f6a84`.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = resolve(HERE, "..");
const SIREN_BUILD = join(PACKAGE, "dist", "siren-core.js");
const THEME = join(PACKAGE, "src", "theme", "default.css");
const WITHOUT_CONTEXT_STROKE = process.argv.includes("--without-context-stroke");
const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RESULT_ID = "result";
const CELL_WIDTH = 260;
const CELL_HEIGHT = 240;
const SCALE = 2;

/** Each end shape, as an author writes it, and where inside its marker's box its colour shows. */
const SHAPES = [
  // The filled triangle `M0,0 L8,3 L0,6`, at its centroid.
  ["arrow", "-->", [8 / 3, 3]],
  // The ring's top, `r` 3 above the line: clear of a highlighted line's 1.5.
  ["circle", "--o", [5, 1]],
  // One stroke of the cross, 2.5 off the line.
  ["cross", "--x", [1.5, 1.5]],
];

/**
 * Who colours the edge: nobody, the author, or the author with the colour
 * omitted — and, as `shared`, nobody on a diagram of two edges out of A,
 * `A-B` and `A-C`, which point at one and the same theme marker. Only A-B
 * is acted on (its token redeclared, it highlighted), and both heads are
 * read, so a marker shared by two lines that differ is shown to draw each
 * head in its own line's colour rather than one colour for both.
 */
const PAINTS = [
  ["theme", "", undefined],
  ["author", "\n  linkStyle 0 stroke:#f00", undefined],
  ["omitted", "\n  linkStyle 0 stroke:#f00", ["stroke"]],
  ["shared", "", undefined],
];

const STATES = ["drawn", "token", "outline", "glow", "prev"];

const CASES = SHAPES.flatMap(([shape, arrow, sample]) =>
  PAINTS.flatMap(([paint, style, omitAuthorStyles]) =>
    STATES.map((state) => ({
      shape,
      paint,
      state,
      sample,
      omitAuthorStyles,
      effect: state === "glow" ? "glow" : "outline",
      edges: paint === "shared" ? ["A-B", "A-C"] : ["A-B"],
      source: `flowchart TB\n  A ${arrow} B${paint === "shared" ? `\n  A ${arrow} C` : ""}${style}`,
    })),
  ),
);
const COLUMNS = SHAPES.length * PAINTS.length;

function die(message) {
  process.stderr.write(`edge-arrowhead-colour: ${message}\n`);
  process.exit(1);
}

function buildPage(sirenUrl, themeUrl) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="${themeUrl}">
<style>
html, body { margin: 0; background: #fff; }
.cell { position: absolute; width: ${CELL_WIDTH}px; height: ${CELL_HEIGHT}px; overflow: hidden; }
#${RESULT_ID} { position: absolute; top: ${CELL_HEIGHT * STATES.length}px; font-size: 1px; }
</style></head>
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
  const states = ${JSON.stringify(STATES)};
  const rows = [];
  cases.forEach((c, index) => {
    const container = document.createElement("div");
    container.className = "cell";
    container.style.left = (Math.floor(index / states.length) * ${CELL_WIDTH}) + "px";
    container.style.top = ((index % states.length) * ${CELL_HEIGHT}) + "px";
    document.body.appendChild(container);
    const { controller, diagnostics } = render(c.source + "\\ntimeline:\\nhighlight A-B " + c.effect, container, {
      omitAuthorStyles: c.omitAuthorStyles,
    });
    if (diagnostics.length > 0) throw new Error(c.source + ": " + diagnostics.map((d) => d.message).join("; "));
    const edgePath = (id) => container.querySelector('path.siren-edge[data-siren-id="' + id + '"]');
    const path = edgePath("A-B");
    let strokeAfterPrev = null;
    if (c.state === "token") path.style.setProperty("--siren-edge-stroke", "#00f");
    if (c.state === "outline" || c.state === "glow" || c.state === "prev") {
      controller.next();
      for (const animation of document.getAnimations()) animation.finish();
    }
    if (c.state === "prev") {
      controller.prev();
      strokeAfterPrev = getComputedStyle(path).stroke;
    }

    for (const id of c.edges) {
      // The marker's box is laid with its (refX, refY) on the path's end and
      // turned to the direction the path arrives in (orient auto).
      const path = edgePath(id);
      const length = path.getTotalLength();
      const end = path.getPointAtLength(length);
      const back = path.getPointAtLength(length - 0.5);
      const angle = Math.atan2(end.y - back.y, end.x - back.x);
      const marker = container.querySelector("marker#" + CSS.escape(path.getAttribute("marker-end").slice(5, -1)));
      const [x, y] = c.sample;
      const dx = x - Number(marker.getAttribute("refX"));
      const dy = y - Number(marker.getAttribute("refY"));
      const ctm = path.getScreenCTM();
      const toPage = (point) => {
        const p = new DOMPoint(point.x, point.y).matrixTransform(ctm);
        return [p.x, p.y];
      };
      const head = toPage({
        x: end.x + dx * Math.cos(angle) - dy * Math.sin(angle),
        y: end.y + dx * Math.sin(angle) + dy * Math.cos(angle),
      });
      const line = toPage(path.getPointAtLength(length / 2));
      const sharedMarker = new Set(c.edges.map((id) => edgePath(id).getAttribute("marker-end"))).size === 1;
      rows.push({ shape: c.shape, paint: c.paint, state: c.state, edge: id, head, line, strokeAfterPrev, sharedMarker });
    }
  });
  out.textContent = JSON.stringify(rows);
} catch (error) {
  out.textContent = JSON.stringify({ pageError: String(error && error.stack ? error.stack : error) });
}
</script></body></html>`;
}

function runChrome(chrome, args) {
  return new Promise((done) => {
    execFile(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--allow-file-access-from-files",
        "--virtual-time-budget=60000",
        `--force-device-scale-factor=${SCALE}`,
        `--window-size=${CELL_WIDTH * COLUMNS},${CELL_HEIGHT * STATES.length + 40}`,
        ...args,
      ],
      { maxBuffer: 64 * 1024 * 1024, timeout: 5 * 60_000 },
      (error, stdout, stderr) => {
        if (error) die(`Chrome failed (${chrome}): ${error.message}\n${stderr}`);
        done(stdout);
      },
    );
  });
}

/** An 8-bit, non-interlaced RGB or RGBA PNG — what Chrome's `--screenshot` writes — as rows of pixels. */
function decodePng(bytes) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const data = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0 || (body[9] !== 2 && body[9] !== 6)) die("the screenshot is not an 8-bit RGB(A) PNG.");
      channels = body[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      data.push(body);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return (x, y) => {
    const at = Math.round(y * SCALE) * stride + Math.round(x * SCALE) * channels;
    return `#${[0, 1, 2].map((i) => pixels[at + i].toString(16).padStart(2, "0")).join("")}`;
  };
}

const chrome = process.env.SIREN_PARITY_CHROME ?? DEFAULT_CHROME;
if (!existsSync(chrome)) die(`Chrome not found at ${chrome}. Set SIREN_PARITY_CHROME to a Chrome or Chromium binary.`);
if (!existsSync(SIREN_BUILD)) die(`${SIREN_BUILD} is missing. Run pnpm --filter siren-core build first.`);

const workDir = mkdtempSync(join(tmpdir(), "siren-arrowhead-"));
process.on("exit", () => rmSync(workDir, { recursive: true, force: true }));
const pagePath = join(workDir, "page.html");
const shotPath = join(workDir, "shot.png");
let themePath = THEME;
if (WITHOUT_CONTEXT_STROKE) {
  themePath = join(workDir, "theme.css");
  writeFileSync(themePath, readFileSync(THEME, "utf8").replace(/^\s*(?:fill|stroke):\s*context-stroke;$/gm, ""));
}
writeFileSync(pagePath, buildPage(pathToFileURL(SIREN_BUILD).href, pathToFileURL(themePath).href));

const dom = await runChrome(chrome, ["--dump-dom", pathToFileURL(pagePath).href]);
const match = new RegExp(`<pre id="${RESULT_ID}">([\\s\\S]*?)</pre>`).exec(dom);
if (!match) die("the page's result element is missing from Chrome's DOM dump.");
const result = JSON.parse(match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
if (!Array.isArray(result)) die(`the page script failed:\n${result.pageError}`);

await runChrome(chrome, [`--screenshot=${shotPath}`, pathToFileURL(pagePath).href]);
const pixelAt = decodePng(readFileSync(shotPath));

for (const r of result) {
  const line = pixelAt(...r.line);
  const head = pixelAt(...r.head);
  const prev = r.strokeAfterPrev === null || r.edge !== "A-B" ? "" : `  stroke straight after prev() ${r.strokeAfterPrev}`;
  const shared = r.paint === "shared" ? `  ${r.sharedMarker ? "one marker" : "TWO MARKERS"}` : "";
  process.stdout.write(
    `${r.shape.padEnd(7)} ${r.paint.padEnd(8)} ${r.state.padEnd(8)} ${r.edge} line ${line}  head ${head}  ${head === line ? "same" : "DIFFERENT"}${prev}${shared}\n`,
  );
}
