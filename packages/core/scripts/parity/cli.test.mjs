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

import { reportDiagram } from "./cli.mjs";

// What the page hands back for one side that drew: node centers, clusters,
// and the sampled lines the edge metrics are read from. Two edges, one
// straight and one crossing it, so the counts are not all zero.
const page = () => ({
  nodes: { A: { x: 0, y: 0, width: 40, height: 40 }, B: { x: 200, y: 0, width: 40, height: 40 } },
  clusters: {},
  // A count read off the DOM with some other selector, disagreeing with the
  // two lines sampled below.
  edges: 5,
  edgeGeometry: {
    edges: [
      { points: [{ x: 20, y: 0 }, { x: 180, y: 0 }] },
      { points: [{ x: 100, y: -100 }, { x: 100, y: 100 }] },
    ],
    nodes: [],
    titles: [],
    width: 300,
    height: 100,
  },
});

// The sampled geometry is read into the metrics and never reported, and the
// one edge count a side has is the one the metrics read off that geometry.
test("a diagram both sides drew reports each side's edges once, from the sampled lines, and no geometry", () => {
  const r = reportDiagram({ file: "a.mmd", mermaid: page(), siren: page() });
  for (const side of ["mermaid", "siren"]) {
    assert.equal(r[side].edgeGeometry, undefined, `${side} geometry`);
    assert.equal(r[side].edges, undefined, `${side} carries a second edge count`);
    assert.equal(r.metrics.edges[side].edges, 2);
    assert.equal(r.metrics.edges[side].crossings, 1);
  }
  assert.equal(r.metrics.matched, 2);
});

// When one side fails there is nothing to compare, but the side that did
// draw still must not leak its thousands of sampled points into --json.
test("a diagram one side could not draw keeps the error and drops the other side's geometry", () => {
  const r = reportDiagram({ file: "b.mmd", mermaid: page(), siren: { error: "parse error" } });
  assert.equal(r.mermaid.edgeGeometry, undefined);
  assert.deepEqual(r.siren, { error: "parse error" });
  assert.equal(r.metrics, undefined);
  assert.equal(exitCodeFor([r]), 1);
});

import { corpusTotals } from "./cli.mjs";

// A reported diagram both sides drew, reduced to what the totals read.
const edgesOf = (crossings, throughNodes, throughTitles, reversals) => ({
  edges: 10, crossings, throughNodes, throughTitles, reversals, detour: 1.2, aspect: 1,
});
const reported = (file, pairs, verticalAgreed, horizontalAgreed, mermaidEdges, sirenEdges) => ({
  file,
  mermaid: { nodes: {} },
  siren: { nodes: {} },
  metrics: {
    pairs, verticalAgreed, horizontalAgreed,
    verticalAgreement: pairs > 0 ? verticalAgreed / pairs : null,
    horizontalAgreement: pairs > 0 ? horizontalAgreed / pairs : null,
    edges: { mermaid: mermaidEdges, siren: sirenEdges },
  },
});

// Pooled, not averaged: a.mmd agrees on its 1 pair (100%), b.mmd on none of
// its 9 vertically (0%). The mean of the shares would be 50%; the pooled
// agreement is 1 agreeing pair of 10 = 10%. Horizontally 1 + 6 of 10 = 70%.
// The edge counts are summed side by side.
test("corpus totals: each side's edge counts summed, agreement pooled over every pair", () => {
  const t = corpusTotals([
    reported("a.mmd", 1, 1, 1, edgesOf(1, 0, 2, 3), edgesOf(4, 1, 0, 2)),
    reported("b.mmd", 9, 0, 6, edgesOf(10, 0, 1, 1), edgesOf(20, 5, 1, 0)),
  ]);
  assert.deepEqual(t, {
    diagrams: 2,
    drawn: 2,
    failed: { mermaid: 0, siren: 0 },
    mermaid: { edges: 20, crossings: 11, throughNodes: 0, throughTitles: 3, reversals: 4 },
    siren: { edges: 20, crossings: 24, throughNodes: 6, throughTitles: 1, reversals: 2 },
    pairs: 10,
    verticalAgreed: 1,
    horizontalAgreed: 7,
    verticalAgreement: 0.1,
    horizontalAgreement: 0.7,
  });
});

// A diagram a side could not draw has no metrics: it is counted as a failure
// of that side (both, when both failed) and kept out of every sum — the
// other side's picture of it included, since there is nothing to compare it
// with. With no diagram drawn by both there is no pair, so no agreement.
test("corpus totals: a failed diagram counts as a failure of its side and stays out of the sums", () => {
  const t = corpusTotals([
    { file: "a.mmd", mermaid: { nodes: {} }, siren: { error: "parse error" } },
    { file: "b.mmd", mermaid: { error: "boom" }, siren: { error: "parse error" } },
  ]);
  assert.deepEqual(t.failed, { mermaid: 1, siren: 2 });
  assert.equal(t.diagrams, 2);
  assert.equal(t.drawn, 0);
  assert.deepEqual(t.siren, { edges: 0, crossings: 0, throughNodes: 0, throughTitles: 0, reversals: 0 });
  assert.equal(t.pairs, 0);
  assert.equal(t.verticalAgreement, null);
  assert.equal(t.horizontalAgreement, null);
});

import { formatTotals } from "./cli.mjs";

// The totals block follows the per-diagram sections, laid out like one of
// them: a heading, then the failures, the pooled agreement with the pairs it
// pooled, and one line of summed edge counts per side, padded to line up.
test("the totals block gives failures, pooled agreement and each side's summed edge counts", () => {
  const totals = {
    diagrams: 3, drawn: 2, failed: { mermaid: 0, siren: 1 },
    mermaid: { edges: 120, crossings: 11, throughNodes: 0, throughTitles: 3, reversals: 4 },
    siren: { edges: 120, crossings: 24, throughNodes: 6, throughTitles: 1, reversals: 2 },
    pairs: 10, verticalAgreed: 1, horizontalAgreed: 7, verticalAgreement: 0.1, horizontalAgreement: 0.7,
  };
  assert.equal(
    formatTotals(totals),
    [
      "TOTALS over the 2 of 3 diagrams both sides drew",
      "  failed      mermaid 0  siren 1",
      "  agreement   vertical 10.0%  horizontal 70.0%  (pooled over 10 pairs)",
      "  edges       mermaid 120 drawn  crossings 11  through nodes 0  through titles 3  reversals 4",
      "  edges       siren   120 drawn  crossings 24  through nodes 6  through titles 1  reversals 2",
      "",
    ].join("\n"),
  );
});

// Nothing drawn by both: no pair to pool, so the agreement is n/a, and the
// sums are zeros rather than missing.
test("the totals block with no diagram both sides drew prints n/a agreement and zero sums", () => {
  const zero = { edges: 0, crossings: 0, throughNodes: 0, throughTitles: 0, reversals: 0 };
  const totals = {
    diagrams: 1, drawn: 0, failed: { mermaid: 1, siren: 1 }, mermaid: zero, siren: zero,
    pairs: 0, verticalAgreed: 0, horizontalAgreed: 0, verticalAgreement: null, horizontalAgreement: null,
  };
  assert.equal(
    formatTotals(totals),
    [
      "TOTALS over the 0 of 1 diagrams both sides drew",
      "  failed      mermaid 1  siren 1",
      "  agreement   vertical n/a  horizontal n/a  (pooled over 0 pairs)",
      "  edges       mermaid 0 drawn  crossings 0  through nodes 0  through titles 0  reversals 0",
      "  edges       siren   0 drawn  crossings 0  through nodes 0  through titles 0  reversals 0",
      "",
    ].join("\n"),
  );
});

import { jsonReport } from "./cli.mjs";

// --json is one object: the per-diagram array, as it was, under `diagrams`,
// and the corpus totals beside it — so a reader takes `.diagrams` where it
// took the array, and the totals are not mistaken for a diagram.
test("--json carries the per-diagram array under diagrams and the totals beside it", () => {
  const diagrams = [
    reported("a.mmd", 1, 1, 1, edgesOf(1, 0, 2, 3), edgesOf(4, 1, 0, 2)),
    { file: "b.mmd", mermaid: { nodes: {} }, siren: { error: "parse error" } },
  ];
  const report = JSON.parse(jsonReport(diagrams));
  assert.deepEqual(Object.keys(report), ["diagrams", "totals"]);
  assert.deepEqual(report.diagrams, diagrams);
  assert.deepEqual(report.totals, corpusTotals(diagrams));
  assert.equal(report.totals.failed.siren, 1);
});
