/**
 * The pure half of `pnpm parity`'s command line: argument parsing, the exit
 * code, and the text report. Everything that touches Chrome or the disk is in
 * `layout-parity.mjs`.
 */

import { compareLayouts, compareSizes, measureEdges, WORST_COUNT } from "./metrics.mjs";

/** The looks Mermaid draws a flowchart in, as `--look` names them. */
const LOOKS = ["classic", "neo"];

/**
 * `parity [file…] [--json] [--look classic|neo]`. No files means every
 * fixture; no `--look` means Mermaid's own default look (`neo` in 12.2.0).
 *
 * @param {string[]} argv the arguments after the script name
 * @returns {{ files: string[], json: boolean, look?: "classic" | "neo" }}
 */
export function parseArgs(argv) {
  const usage = "Usage: parity [file…] [--json] [--look classic|neo]";
  const files = [];
  let json = false;
  let look;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    else if (arg === "--look" || arg.startsWith("--look=")) {
      const value = arg === "--look" ? argv[++i] : arg.slice("--look=".length);
      if (value === undefined) throw new Error(`--look needs a look, classic or neo. ${usage}`);
      if (!LOOKS.includes(value)) throw new Error(`Unknown look ${value}: use classic or neo. ${usage}`);
      look = value;
    } else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}. ${usage}`);
    else files.push(arg);
  }
  return look === undefined ? { files, json } : { files, json, look };
}

/**
 * 1 when any diagram could not be drawn by one side, else 0. The metrics are
 * deliberately not consulted: they move with fonts and browsers, so no number
 * they produce is a failure.
 *
 * @param {{ mermaid: { error?: string }, siren: { error?: string } }[]} results
 */
export function exitCodeFor(results) {
  return results.some((r) => failedSides(r).length > 0) ? 1 : 0;
}

/**
 * Which renderers could not draw this diagram: `[]` when both did.
 *
 * @param {{ mermaid: { error?: string }, siren: { error?: string } }} result
 * @returns {("mermaid" | "siren")[]}
 */
export function failedSides(result) {
  return ["mermaid", "siren"].filter((side) => result[side].error !== undefined);
}

/**
 * One diagram's entry in the report, from what the page drew.
 *
 * The page hands back each side's sampled edge geometry — thousands of
 * points per diagram. It is read into the edge metrics here and dropped from
 * both sides on every path, a diagram one side could not draw included, so
 * it never reaches `--json`. A side's one edge count is
 * `metrics.edges.<side>.edges`, the lines that geometry sampled; any other
 * count a side carries is dropped with it, so the report never shows two.
 * When both sides drew, `metrics` holds the node comparison, the sizes and
 * each side's edge metrics; when either failed there is no `metrics`.
 *
 * @param {{ file: string, mermaid: object, siren: object }} r one diagram as the page drew it
 */
export function reportDiagram(r) {
  const reported = ({ edgeGeometry, edges, ...side }) => side;
  const result = { file: r.file, mermaid: reported(r.mermaid), siren: reported(r.siren) };
  if (failedSides(r).length > 0) return result;
  return {
    ...result,
    metrics: {
      ...compareLayouts(r.mermaid.nodes, r.siren.nodes),
      sizes: compareSizes(r.mermaid.nodes, r.siren.nodes),
      edges: {
        mermaid: measureEdges(r.mermaid.edgeGeometry),
        siren: measureEdges(r.siren.edgeGeometry),
      },
    },
  };
}

const SIDES = ["mermaid", "siren"];
/** The edge counts the totals sum: the per-diagram means and ratios do not add up. */
const SUMMED_EDGE_COUNTS = ["edges", "crossings", "throughNodes", "throughTitles", "reversals"];

/**
 * The corpus at once, which is what a gate over the whole corpus reads.
 *
 * Every sum is over the diagrams **both** sides drew: a diagram either side
 * could not draw has no metrics, so it only adds to that side's `failed`
 * (to both sides' when both failed). Per side, the edge counts are summed —
 * edges drawn, crossings, edges through an unrelated node, through a group
 * title, reversals. Structural agreement is pooled: the matched pairs that
 * agree, summed over the diagrams, over the pairs summed — not the mean of
 * each diagram's share, which would weigh a three-node diagram like a
 * fifty-node one. With no pair anywhere the agreements are `null`.
 *
 * @param {object[]} results the report's diagrams, as `reportDiagram` builds them
 */
export function corpusTotals(results) {
  const zero = () => Object.fromEntries(SUMMED_EDGE_COUNTS.map((k) => [k, 0]));
  const totals = {
    diagrams: results.length,
    drawn: 0,
    failed: { mermaid: 0, siren: 0 },
    mermaid: zero(),
    siren: zero(),
    pairs: 0,
    verticalAgreed: 0,
    horizontalAgreed: 0,
  };
  for (const r of results) {
    const failed = failedSides(r);
    for (const side of failed) totals.failed[side]++;
    if (failed.length > 0) continue;
    totals.drawn++;
    for (const side of SIDES) {
      for (const k of SUMMED_EDGE_COUNTS) totals[side][k] += r.metrics.edges[side][k];
    }
    totals.pairs += r.metrics.pairs;
    totals.verticalAgreed += r.metrics.verticalAgreed;
    totals.horizontalAgreed += r.metrics.horizontalAgreed;
  }
  const share = (agreed) => (totals.pairs > 0 ? agreed / totals.pairs : null);
  return {
    ...totals,
    verticalAgreement: share(totals.verticalAgreed),
    horizontalAgreement: share(totals.horizontalAgreed),
  };
}

/**
 * The `--json` report: one object, `{ diagrams, totals }`. `diagrams` is the
 * per-diagram array exactly as it was printed bare before the totals
 * existed — read `.diagrams` where the array was read — and `totals` is
 * `corpusTotals` over it, kept beside the array rather than appended to it
 * so nothing iterating the diagrams mistakes it for one.
 *
 * @param {object[]} results the report's diagrams, as `reportDiagram` builds them
 * @returns {string} the JSON text, pretty-printed, newline-terminated
 */
export function jsonReport(results) {
  return `${JSON.stringify({ diagrams: results, totals: corpusTotals(results) }, null, 2)}\n`;
}

const percent = (v) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const offset = (v) => (v === null ? "n/a" : v.toFixed(3));
const ratio = (v) => (v === null ? "n/a" : `×${v.toFixed(2)}`);
const dimensions = ({ width, height }) => `${Math.round(width)}×${Math.round(height)}`;

/** One diagram's section of the text report. */
function formatOne(result) {
  const lines = [result.file];
  const failed = failedSides(result);
  if (failed.length > 0) {
    for (const side of failed) lines.push(`  FAILED      ${side} could not draw it: ${result[side].error}`);
    return lines;
  }
  const m = result.metrics;
  lines.push(`  nodes       mermaid ${m.mermaidNodes}  siren ${m.sirenNodes}  matched ${m.matched}`);
  const unmatched = [];
  if (m.mermaidOnly.length > 0) unmatched.push(`mermaid only: ${m.mermaidOnly.join(", ")}`);
  if (m.sirenOnly.length > 0) unmatched.push(`siren only: ${m.sirenOnly.join(", ")}`);
  if (unmatched.length > 0) lines.push(`  unmatched   ${unmatched.join("; ")}`);
  lines.push(`  agreement   vertical ${percent(m.verticalAgreement)}  horizontal ${percent(m.horizontalAgreement)}`);
  lines.push(`  offset      mean ${offset(m.meanOffset)}  max ${offset(m.maxOffset)}`);
  lines.push(`  worst       ${m.worst.map((w) => `${w.id} ${offset(w.offset)}`).join(", ")}`);
  if (m.sizes !== undefined) {
    const s = m.sizes;
    lines.push(
      `  size        siren/mermaid at one font size: width ${ratio(s.meanWidthRatio)}  height ${ratio(s.meanHeightRatio)}` +
        `  (raw width ${ratio(s.rawMeanWidthRatio)}  height ${ratio(s.rawMeanHeightRatio)})`,
    );
    const furthest = s.nodes.slice(0, WORST_COUNT).map((n) => `${n.id} ${dimensions(n.mermaid)} → ${dimensions(n.siren)}`);
    lines.push(`  size worst  ${furthest.join(", ")}`);
  }
  if (m.edges !== undefined) lines.push(...formatEdges(m.edges));
  return lines;
}

/**
 * The text report's closing block: `corpusTotals` laid out like a diagram's
 * section — the failures per side, the pooled agreement and the pairs it
 * pooled, then one line per side of summed edge counts, padded to line up.
 */
export function formatTotals(totals) {
  const countWidth = Math.max(...SIDES.map((side) => String(totals[side].edges).length));
  return [
    `TOTALS over the ${totals.drawn} of ${totals.diagrams} diagrams both sides drew`,
    `  failed      mermaid ${totals.failed.mermaid}  siren ${totals.failed.siren}`,
    `  agreement   vertical ${percent(totals.verticalAgreement)}  horizontal ${percent(totals.horizontalAgreement)}` +
      `  (pooled over ${totals.pairs} pairs)`,
    ...SIDES.map((side) => {
      const e = totals[side];
      return (
        `  edges       ${side.padEnd(7)} ${String(e.edges).padStart(countWidth)} drawn` +
        `  crossings ${e.crossings}  through nodes ${e.throughNodes}  through titles ${e.throughTitles}` +
        `  reversals ${e.reversals}`
      );
    }),
    "",
  ].join("\n");
}

const twoPlaces = (v) => (v === null ? "n/a" : v.toFixed(2));

/**
 * Each side's edge metrics, one line per side. They are not a comparison —
 * each picture is measured on its own — so the two lines are padded to line
 * up and a reader compares them by eye.
 */
function formatEdges(edges) {
  const sides = ["mermaid", "siren"];
  const countWidth = Math.max(...sides.map((side) => String(edges[side].edges).length));
  return sides.map((side) => {
    const e = edges[side];
    return (
      `  edges       ${side.padEnd(7)} ${String(e.edges).padStart(countWidth)} drawn` +
      `  crossings ${e.crossings}  through nodes ${e.throughNodes}  through titles ${e.throughTitles}` +
      `  reversals ${e.reversals}  detour ${ratio(e.detour)}  aspect ${twoPlaces(e.aspect)}`
    );
  });
}

/**
 * The human-readable report: one section per diagram, separated by a blank
 * line. Agreements print as percentages, offsets in normalized units (the
 * diagonal of the 0..1 frame is 1.414), node sizes as Siren's over
 * Mermaid's — at one font size, then raw — and, for the nodes furthest from
 * Mermaid's size, both raw boxes in whole px. Every node's two boxes are in the `--json` output.
 * Last come the edge metrics, one line per side: counts, then detour as a
 * multiple of the straight line and aspect as width over height.
 */
export function formatText(results) {
  return results.map((r) => [...formatOne(r), ""].join("\n")).join("\n");
}
