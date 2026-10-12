/**
 * The pure half of `pnpm parity`'s command line: argument parsing, the exit
 * code, and the text report. Everything that touches Chrome or the disk is in
 * `layout-parity.mjs`.
 */

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
  return results.some((r) => r.mermaid.error !== undefined || r.siren.error !== undefined) ? 1 : 0;
}

const percent = (v) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const offset = (v) => (v === null ? "n/a" : v.toFixed(3));

/** One diagram's section of the text report. */
function formatOne(result) {
  const lines = [result.file];
  const failed = ["mermaid", "siren"].filter((side) => result[side].error !== undefined);
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
  return lines;
}

/**
 * The human-readable report: one section per diagram, separated by a blank
 * line. Agreements print as percentages, offsets in normalized units (the
 * diagonal of the 0..1 frame is 1.414).
 */
export function formatText(results) {
  return results.map((r) => [...formatOne(r), ""].join("\n")).join("\n");
}
