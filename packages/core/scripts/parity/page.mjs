/**
 * The HTML page the parity script hands to headless Chrome.
 *
 * One page draws every requested diagram twice — once with Mermaid's own
 * browser bundle, once with Siren's standalone build — in the same document,
 * so both pictures get the same browser, the same fonts and the same canvas.
 * When it is done it writes one JSON array into `<pre id="parity-result">`,
 * which `--dump-dom` hands back to the script. An uncaught error writes
 * `{ "pageError": … }` there instead; a page that never finishes leaves the
 * initial `pending` in place. The script tells those three apart.
 *
 * Everything is loaded from `file://` URLs (Chrome runs with
 * `--allow-file-access-from-files` so the module imports resolve); only this
 * HTML file is written to disk.
 */

/** The id of the element the page writes its result into. */
export const RESULT_ID = "parity-result";

/** The text that element holds until the page writes a result. */
export const PENDING = "pending";

/**
 * Siren's text measurer for the page. **Copied from
 * `packages/board/src/textMeasurer.ts`** (`createCanvasTextMeasurer`) — the
 * measurer a reader of siren-board gets — so the parity picture is the one
 * the board draws: canvas `measureText` at `14px system-ui, sans-serif`, plus
 * 24px horizontal padding, 32px line height. Keep the two in step.
 */
const CANVAS_MEASURER = `
function createCanvasTextMeasurer() {
  const PADDING_X = 24;
  const LINE_HEIGHT = 32;
  const FONT = "14px system-ui, sans-serif";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = FONT;
  return {
    measure(text) {
      const { width } = ctx.measureText(text);
      return { width: width + PADDING_X, height: LINE_HEIGHT };
    },
  };
}`;

/**
 * Installed first, as a classic script, so that an error anywhere later —
 * Mermaid's bundle, or the module below — is reported rather than silently
 * leaving the page pending.
 */
const ERROR_TRAP = `
const fail = (error) => {
  document.getElementById(${JSON.stringify(RESULT_ID)}).textContent =
    JSON.stringify({ pageError: String(error && error.stack ? error.stack : error) });
};
window.addEventListener("error", (event) => fail(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => fail(event.reason));
`;

/**
 * The script the page runs. Kept as a plain string: it executes in Chrome,
 * never in Node.
 */
const PAGE_SCRIPT = `
const out = document.getElementById(${JSON.stringify(RESULT_ID)});

${CANVAS_MEASURER}

const box = (element) => {
  const r = element.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
};
const message = (error) => String(error && error.message ? error.message : error);

// Mermaid: node groups are \`g.node\` whose DOM id carries the authored id
// (see ids.mjs); clusters are \`g.cluster\` (flowchart, ER subgraph) and
// \`g.statediagram-cluster\` (composite state), named by \`data-id\` when present.
async function drawMermaid(index, source, host) {
  const renderId = "pm" + index;
  const { svg } = await mermaid.render(renderId, source);
  host.innerHTML = svg;
  const nodes = {};
  for (const g of host.querySelectorAll("g.node[id]")) {
    const id = mermaidNodeId(g.id, renderId);
    if (id !== null) nodes[id] = box(g);
  }
  const clusters = {};
  for (const g of host.querySelectorAll("g.cluster, g.statediagram-cluster")) {
    clusters[g.getAttribute("data-id") ?? g.id.slice(renderId.length + 1)] = box(g);
  }
  const edges = host.querySelectorAll(".edgePaths > path, .edgePaths > g > path").length;
  return { nodes, clusters, edges };
}

// Siren: every node group carries the authored id as data-siren-id. A
// composite state is a .siren-state too, but it is drawn as a frame around
// its children — Mermaid's cluster — so it is counted as a cluster.
const COMPOSITE = ":scope > .siren-composite-frame, :scope > .siren-state-region";
// A state's note — its frame, its text and the connector to it — is drawn
// inside the state's own group, but Mermaid draws it as a node of its own,
// so the state is sized from its own figure: the note is hidden while the
// group is measured.
const STATE_NOTE = ":scope > .siren-note-frame, :scope > .siren-note-text, :scope > .siren-note-link";
const ownBox = (g) => {
  const note = [...g.querySelectorAll(STATE_NOTE)];
  for (const element of note) element.style.display = "none";
  const measured = box(g);
  for (const element of note) element.style.display = "";
  return measured;
};
function drawSiren(source, host) {
  const result = sirenRender(source, host, { measureText: createCanvasTextMeasurer() });
  if (result.svg === null) {
    const errors = result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
    throw new Error(errors.join(" / ") || "no SVG and no error diagnostic");
  }
  const nodes = {};
  const clusters = {};
  for (const g of host.querySelectorAll("g.siren-node, g.siren-state, g.siren-er-entity")) {
    const id = g.getAttribute("data-siren-id");
    if (g.querySelector(COMPOSITE)) clusters[id] = ownBox(g);
    else nodes[id] = ownBox(g);
  }
  // "clusters" is the key both sides share, Mermaid's own word for a group;
  // on this side it holds subgraphs, composite states and ER subgraph blocks.
  for (const g of host.querySelectorAll("g.siren-subgraph, g.siren-er-subgraph")) {
    clusters[g.getAttribute("data-siren-id")] = box(g);
  }
  const edges = host.querySelectorAll(".siren-edge, .siren-transition, .siren-er-relationship").length;
  return { nodes, clusters, edges };
}

const diagrams = JSON.parse(document.getElementById("diagrams").textContent);
mermaid.initialize({ startOnLoad: false });
const results = [];
for (const [index, { file, source }] of diagrams.entries()) {
  const mermaidHost = document.createElement("div");
  const sirenHost = document.createElement("div");
  document.getElementById("pictures").append(mermaidHost, sirenHost);
  let m;
  let s;
  try { m = await drawMermaid(index, source, mermaidHost); } catch (error) { m = { error: message(error) }; }
  try { s = drawSiren(source, sirenHost); } catch (error) { s = { error: message(error) }; }
  results.push({ file, mermaid: m, siren: s });
}
out.textContent = JSON.stringify(results);
`;

/**
 * Build the page.
 *
 * @param {{ mermaidUrl: string, sirenUrl: string, idsUrl: string,
 *           diagrams: { file: string, source: string }[] }} input
 *   `mermaidUrl` is Mermaid's IIFE bundle (`dist/mermaid.min.js`, which sets
 *   the global `mermaid`); `sirenUrl` is siren-core's standalone ESM build
 *   (`dist/siren-core.js`, exporting `render`); `idsUrl` is `ids.mjs`.
 * @returns {string}
 */
export function buildPage({ mermaidUrl, sirenUrl, idsUrl, diagrams }) {
  // `</` inside a <script> element would end it early; `<\/` is the same
  // string to JSON.parse and invisible to the HTML parser.
  // The pictures' container is far wider than any fixture so neither picture
  // is squeezed: Mermaid's useMaxWidth caps its SVG at the container's width,
  // and a scaled picture would hand back scaled boxes.
  const data = JSON.stringify(diagrams).replaceAll("</", "<\\/");
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>layout parity</title></head>
<body>
<pre id="${RESULT_ID}">${PENDING}</pre>
<div id="pictures" style="width: 6000px"></div>
<script type="application/json" id="diagrams">${data}</script>
<script>${ERROR_TRAP}</script>
<script src="${mermaidUrl}"></script>
<script type="module">
import { render as sirenRender } from ${JSON.stringify(sirenUrl)};
import { mermaidNodeId } from ${JSON.stringify(idsUrl)};
${PAGE_SCRIPT}
</script>
</body>
</html>
`;
}
