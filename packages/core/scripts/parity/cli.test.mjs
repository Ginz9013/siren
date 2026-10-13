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

test("the text report gives the mean size ratios, normalized and raw, and the five nodes furthest from Mermaid's size", () => {
  const box = (width, height) => ({ width, height });
  const metrics = {
    mermaidNodes: 2, sirenNodes: 2, matched: 2, mermaidOnly: [], sirenOnly: [],
    verticalAgreement: 1, horizontalAgreement: 1, meanOffset: 0, maxOffset: 0,
    worst: [{ id: "A", offset: 0 }],
    sizes: {
      meanWidthRatio: 0.75, meanHeightRatio: 2, rawMeanWidthRatio: 0.65625, rawMeanHeightRatio: 1.75,
      nodes: [
        { id: "B", mermaid: box(100, 100), siren: box(87.5, 262.5) },
        { id: "A", mermaid: box(200, 50.4), siren: box(87.5, 43.75) },
      ],
    },
  };
  assert.equal(
    formatText([{ file: "sizes.mmd", mermaid: { nodes: {} }, siren: { nodes: {} }, metrics }]),
    [
      "sizes.mmd",
      "  nodes       mermaid 2  siren 2  matched 2",
      "  agreement   vertical 100.0%  horizontal 100.0%",
      "  offset      mean 0.000  max 0.000",
      "  worst       A 0.000",
      "  size        siren/mermaid at one font size: width ×0.75  height ×2.00  (raw width ×0.66  height ×1.75)",
      "  size worst  B 100×100 → 88×263, A 200×50 → 88×44",
      "",
    ].join("\n"),
  );
});

// Edge metrics are per side, not a comparison: one line for each picture,
// the side's name padded so the two lines' numbers line up. Detour and
// aspect print to two places; a side with no ratio to take prints n/a.
test("the text report gives each side's edge metrics on a line of its own", () => {
  const metrics = {
    mermaidNodes: 2, sirenNodes: 2, matched: 2, mermaidOnly: [], sirenOnly: [],
    verticalAgreement: 1, horizontalAgreement: 1, meanOffset: 0, maxOffset: 0,
    worst: [{ id: "A", offset: 0 }],
    edges: {
      mermaid: { edges: 27, crossings: 6, throughNodes: 0, throughTitles: 7, reversals: 9, detour: 1.3412, aspect: 0.6 },
      siren: { edges: 0, crossings: 0, throughNodes: 0, throughTitles: 0, reversals: 0, detour: null, aspect: null },
    },
  };
  assert.equal(
    formatText([{ file: "edges.mmd", mermaid: { nodes: {} }, siren: { nodes: {} }, metrics }]),
    [
      "edges.mmd",
      "  nodes       mermaid 2  siren 2  matched 2",
      "  agreement   vertical 100.0%  horizontal 100.0%",
      "  offset      mean 0.000  max 0.000",
      "  worst       A 0.000",
      "  edges       mermaid 27 drawn  crossings 6  through nodes 0  through titles 7  reversals 9  detour ×1.34  aspect 0.60",
      "  edges       siren    0 drawn  crossings 0  through nodes 0  through titles 0  reversals 0  detour n/a  aspect n/a",
      "",
    ].join("\n"),
  );
});
