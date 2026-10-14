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

// ─── Edge geometry ─────────────────────────────────────────────────────────
// What metrics.mjs's measureEdges reads: each edge sampled into a polyline,
// the boxes an edge can be drawn across, the group titles, and the size of
// the picture. Points and boxes are both in the page's client px, so they
// share one frame however each side scales or translates its SVG.

// Sample a line every this many of its own units: fine enough that a
// polyline through the samples is the line to within a pixel on any curve
// either renderer draws.
const SAMPLE_UNITS = 3;
const SVG_NS = "http://www.w3.org/2000/svg";

// Each path's \`d\` is sampled through a copy with its line jumps
// straightened (see straightenArcs), placed beside the original so it sits in
// the same coordinate system, then removed.
function sampleEdges(host, selector) {
  const edges = [];
  for (const path of host.querySelectorAll(selector)) {
    const d = path.getAttribute("d");
    if (!d) continue;
    const probe = document.createElementNS(SVG_NS, "path");
    probe.setAttribute("d", straightenArcs(d));
    const transform = path.getAttribute("transform");
    if (transform) probe.setAttribute("transform", transform);
    path.parentNode.appendChild(probe);
    const length = probe.getTotalLength();
    if (length > 0) {
      const ctm = probe.getScreenCTM();
      const steps = Math.max(2, Math.ceil(length / SAMPLE_UNITS));
      const points = [];
      for (let i = 0; i <= steps; i++) {
        const p = probe.getPointAtLength((length * i) / steps);
        points.push({ x: ctm.a * p.x + ctm.c * p.y + ctm.e, y: ctm.b * p.x + ctm.d * p.y + ctm.f });
      }
      edges.push({ points });
    }
    probe.remove();
  }
  return edges;
}

// The size of everything a side drew, in its own units: only the ratio is
// read, so the units do not matter.
function drawnSize(host) {
  const svg = host.querySelector("svg");
  if (svg === null) return { width: 0, height: 0 };
  const { width, height } = svg.getBBox();
  return { width, height };
}

// Mermaid draws every connector — flowchart edge, class relation (and the
// link to a note), state transition, ER relationship — as a path in
// \`.edgePaths\`.
const MERMAID_EDGES = ".edgePaths > path, .edgePaths > g > path";

// Mermaid: node groups are \`g.node\` whose DOM id carries the authored id
// (see ids.mjs); clusters are \`g.cluster\` (flowchart subgraph, class
// namespace, ER subgraph) and \`g.statediagram-cluster\` (composite state),
// named by \`data-id\` when present.
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
  const edgeGeometry = {
    edges: sampleEdges(host, MERMAID_EDGES),
    // Every \`g.node\` is something a line can be drawn across: flowchart
    // nodes, classes and class notes, states (a composite is a cluster, not a
    // node), ER entities.
    nodes: [...host.querySelectorAll("g.node")].map(box),
    // A cluster's title in every diagram type: subgraph, namespace,
    // composite state, ER subgraph block.
    titles: [...host.querySelectorAll("g.cluster-label")].map(box).filter((b) => b.width > 1),
    ...drawnSize(host),
  };
  return { nodes, clusters, edgeGeometry };
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
// The one path each connector is drawn as, Mermaid's set of connectors:
// flowchart edges, class relationships and note links, transitions, ER
// relationships. (Arrowheads are markers, not paths of the connector.)
const SIREN_EDGES =
  "path.siren-edge, path.siren-relationship-line, path.siren-note-link, path.siren-transition-line, path.siren-er-relationship-line";
// What a line can be drawn across, as Mermaid's g.node: flowchart nodes,
// classes, class notes, states, ER entities. Composite states are dropped
// below — they are clusters, as on Mermaid's side.
const SIREN_OBSTACLES = "g.siren-node, g.siren-class, g.siren-note, g.siren-state, g.siren-er-entity";
// The title text of a subgraph, namespace, composite state and ER subgraph
// block — Mermaid's g.cluster-label.
const SIREN_TITLES =
  "text.siren-subgraph-label, text.siren-namespace-label, text.siren-composite-label, text.siren-er-subgraph-label";
function drawSiren(source, host) {
  const result = sirenRender(source, host, { measureText: createCanvasTextMeasurer() });
  if (result.svg === null) {
    const errors = result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
    throw new Error(errors.join(" / ") || "no SVG and no error diagnostic");
  }
  const nodes = {};
  const clusters = {};
  for (const g of host.querySelectorAll("g.siren-node, g.siren-class, g.siren-state, g.siren-er-entity")) {
    const id = g.getAttribute("data-siren-id");
    if (g.querySelector(COMPOSITE)) clusters[id] = ownBox(g);
    else nodes[id] = ownBox(g);
  }
  // "clusters" is the key both sides share, Mermaid's own word for a group;
  // on this side it holds subgraphs, class namespaces, composite states and
  // ER subgraph blocks.
  for (const g of host.querySelectorAll("g.siren-subgraph, g.siren-namespace, g.siren-er-subgraph")) {
    clusters[g.getAttribute("data-siren-id")] = box(g);
  }
  const obstacles = [...host.querySelectorAll(SIREN_OBSTACLES)].filter((g) => !g.querySelector(COMPOSITE));
  const edgeGeometry = {
    edges: sampleEdges(host, SIREN_EDGES),
    nodes: obstacles.map(ownBox),
    titles: [...host.querySelectorAll(SIREN_TITLES)].map(box).filter((b) => b.width > 1),
    ...drawnSize(host),
  };
  return { nodes, clusters, edgeGeometry };
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
 * @param {{ mermaidUrl: string, sirenUrl: string, idsUrl: string, metricsUrl: string,
 *           diagrams: { file: string, source: string }[] }} input
 *   `mermaidUrl` is Mermaid's IIFE bundle (`dist/mermaid.min.js`, which sets
 *   the global `mermaid`); `sirenUrl` is siren-core's standalone ESM build
 *   (`dist/siren-core.js`, exporting `render`); `idsUrl` is `ids.mjs`;
 *   `metricsUrl` is `metrics.mjs`, for `straightenArcs`.
 * @returns {string}
 */
export function buildPage({ mermaidUrl, sirenUrl, idsUrl, metricsUrl, diagrams }) {
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
import { straightenArcs } from ${JSON.stringify(metricsUrl)};
${PAGE_SCRIPT}
</script>
</body>
</html>
`;
}
