#!/usr/bin/env node
/**
 * Validates Siren (.srn) documents by rendering them with siren-core, and
 * prints every diagnostic as file:line:column.
 *
 *   node validate.mjs <file.srn>... [--ids]
 *   cat doc.srn | node validate.mjs - [--ids]
 *
 * --ids also lists every id a timeline can name in the rendered diagram,
 * including generated ones such as subgraph:1, loop:1 or start:1.
 *
 * Needs `siren-core` and `jsdom`, resolved from the current directory:
 *
 *   npm install --no-save siren-core jsdom
 *
 * Exit code: 0 when no document has an error, 1 when any does, 2 on bad usage.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const showIds = args.includes("--ids");
const files = args.filter((arg) => arg !== "--ids");

if (files.length === 0) {
  console.error("Usage: node validate.mjs <file.srn>... [--ids]   (use - to read stdin)");
  process.exit(2);
}

// Resolve from the directory the user runs in, not from this script's own
// location: a skill folder has no node_modules of its own.
const requireFromCwd = createRequire(join(process.cwd(), "noop.js"));

// Finds a package's ES module entry through its package.json. siren-core is
// ESM-only, so require.resolve() on its name finds no CommonJS entry.
function resolveEntry(name) {
  const manifestPath = requireFromCwd.resolve(`${name}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const root = manifest.exports?.["."] ?? manifest.exports;
  const entry =
    (typeof root === "string" ? root : root?.import ?? root?.default) ?? manifest.module ?? manifest.main ?? "index.js";
  return join(dirname(manifestPath), entry);
}

async function load(name) {
  try {
    return await import(pathToFileURL(resolveEntry(name)).href);
  } catch {
    console.error(
      `Cannot find "${name}" from ${process.cwd()}.\n` +
        "Install the validator's dependencies here first:\n\n" +
        "  npm install --no-save siren-core jsdom\n",
    );
    process.exit(2);
  }
}

const { JSDOM } = await load("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
for (const key of ["window", "document", "Node", "Element", "HTMLElement", "SVGElement", "MouseEvent"]) {
  globalThis[key] = key === "window" ? dom.window : dom.window[key];
}
const { render } = await load("siren-core");

let failed = false;

for (const file of files) {
  const source = readFileSync(file === "-" ? 0 : file, "utf8");
  const name = file === "-" ? "<stdin>" : file;
  const container = document.createElement("div");
  const { svg, controller, diagnostics } = render(source, container);

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  if (errors.length > 0) failed = true;

  const status = svg === null ? "FAILED" : errors.length > 0 ? "ERRORS" : warnings.length > 0 ? "WARNINGS" : "OK";
  const steps = controller === null ? "" : `, ${controller.totalSteps} step(s)`;
  console.log(`${name}: ${status} (${errors.length} error(s), ${warnings.length} warning(s)${steps})`);

  for (const d of diagnostics) {
    const at = d.line === undefined ? name : `${name}:${d.line}${d.column === undefined ? "" : `:${d.column}`}`;
    console.log(`  ${at} ${d.severity}: ${d.message}`);
  }

  if (showIds && svg !== null) {
    const ids = [...new Set([...svg.querySelectorAll("[data-siren-id]")].map((el) => el.getAttribute("data-siren-id")))];
    console.log(`  ids: ${ids.join(", ")}`);
  }
}

process.exit(failed ? 1 : 0);
