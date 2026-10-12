// node --test scripts/parity — the command line of `pnpm parity`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./cli.mjs";

test("no arguments: every fixture, text report", () => {
  assert.deepEqual(parseArgs([]), { files: [], json: false });
});

test("files and --json in any order", () => {
  assert.deepEqual(parseArgs(["a.mmd", "--json", "b.mmd"]), { files: ["a.mmd", "b.mmd"], json: true });
});

test("an unknown flag is refused by name", () => {
  assert.throws(() => parseArgs(["--jsno"]), /--jsno/);
});

import { exitCodeFor } from "./cli.mjs";

const drawn = (file, metrics) => ({ file, mermaid: { nodes: {} }, siren: { nodes: {} }, metrics });

test("terrible numbers still exit 0: the report is a measurement, not a gate", () => {
  const awful = { verticalAgreement: 0, horizontalAgreement: 0, meanOffset: 1.4, maxOffset: 1.4 };
  assert.equal(exitCodeFor([drawn("a.mmd", awful)]), 0);
});

test("a diagram one side could not draw exits non-zero", () => {
  const failed = { file: "b.mmd", mermaid: { nodes: {} }, siren: { error: "parse error" } };
  assert.equal(exitCodeFor([drawn("a.mmd", {}), failed]), 1);
});

import { formatText } from "./cli.mjs";

test("the text report names each diagram, its counts, both agreements, the offsets and the worst nodes", () => {
  const metrics = {
    mermaidNodes: 4, sirenNodes: 3, matched: 3, mermaidOnly: ["X"], sirenOnly: [],
    verticalAgreement: 1 / 3, horizontalAgreement: 1, meanOffset: 1 / 3, maxOffset: 1,
    worst: [{ id: "C", offset: 1 }, { id: "A", offset: 0 }, { id: "B", offset: 0 }],
  };
  assert.equal(
    formatText([{ file: "three.mmd", mermaid: { nodes: {} }, siren: { nodes: {} }, metrics }]),
    [
      "three.mmd",
      "  nodes       mermaid 4  siren 3  matched 3",
      "  unmatched   mermaid only: X",
      "  agreement   vertical 33.3%  horizontal 100.0%",
      "  offset      mean 0.333  max 1.000",
      "  worst       C 1.000, A 0.000, B 0.000",
      "",
    ].join("\n"),
  );
});

test("a diagram one side could not draw says which side and why", () => {
  assert.equal(
    formatText([{ file: "bad.mmd", mermaid: { nodes: {} }, siren: { error: "Unexpected token" } }]),
    ["bad.mmd", "  FAILED      siren could not draw it: Unexpected token", ""].join("\n"),
  );
});
