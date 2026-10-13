/**
 * The pure half of `pnpm parity`'s command line: argument parsing, the exit
 * code, and the text report. Everything that touches Chrome or the disk is in
 * `layout-parity.mjs`.
 */

import { WORST_COUNT } from "./metrics.mjs";

/**
 * `parity [file…] [--json]`. No files means every fixture.
 *
 * @param {string[]} argv the arguments after the script name
 * @returns {{ files: string[], json: boolean }}
 */
export function parseArgs(argv) {
  const files = [];
  let json = false;
  for (const arg of argv) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}. Usage: parity [file…] [--json]`);
    else files.push(arg);
  }
  return { files, json };
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
