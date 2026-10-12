// node --test scripts/parity — the parity metrics, checked against small
// layouts whose numbers are worked out by hand in the comments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareLayouts } from "./metrics.mjs";

// Three nodes. Mermaid: A(0,0) B(0,100) C(100,100). Siren: A(0,0) B(0,100)
// C(100,0) — C has moved from beside B to beside A.
// Normalized (each picture to 0..1 per axis): Mermaid A(0,0) B(0,1) C(1,1);
// Siren A(0,0) B(0,1) C(1,0).
// Vertical relations (sign of dy for each pair):
//   A-B: below / below  -> same
//   A-C: below / level  -> differ
//   B-C: level / above  -> differ          => 1/3
// Horizontal relations: A-B level/level, A-C right/right, B-C right/right => 1
// Offsets: A 0, B 0, C |(1,1)-(1,0)| = 1  => mean 1/3, max 1, worst C first.
test("three nodes, one moved: agreement and normalized offset by hand", () => {
  const mermaid = { A: { x: 0, y: 0 }, B: { x: 0, y: 100 }, C: { x: 100, y: 100 } };
  const siren = { A: { x: 0, y: 0 }, B: { x: 0, y: 100 }, C: { x: 100, y: 0 } };
  const r = compareLayouts(mermaid, siren);
  assert.equal(r.matched, 3);
  assert.ok(Math.abs(r.verticalAgreement - 1 / 3) < 1e-9, `vertical ${r.verticalAgreement}`);
  assert.equal(r.horizontalAgreement, 1);
  assert.ok(Math.abs(r.meanOffset - 1 / 3) < 1e-9, `mean ${r.meanOffset}`);
  assert.equal(r.maxOffset, 1);
  assert.equal(r.worst[0].id, "C");
  assert.equal(r.worst[0].offset, 1);
});

// Mermaid has A B X; Siren has A B Y. Matched: A, B. X and Y are unmatched
// and must not move any number: A above B in both, same columns, so both
// agreements are 1 and both offsets 0 (A(0,0)/(0,0), B(0,1)/(0,1) normalized
// — the unmatched X at (500,500) would otherwise stretch Mermaid's frame).
test("a node in only one picture is counted as unmatched and kept out of the metrics", () => {
  const mermaid = { A: { x: 10, y: 10 }, B: { x: 10, y: 60 }, X: { x: 500, y: 500 } };
  const siren = { A: { x: 0, y: 0 }, B: { x: 0, y: 40 }, Y: { x: -300, y: 9 } };
  const r = compareLayouts(mermaid, siren);
  assert.equal(r.mermaidNodes, 3);
  assert.equal(r.sirenNodes, 3);
  assert.equal(r.matched, 2);
  assert.deepEqual(r.mermaidOnly, ["X"]);
  assert.deepEqual(r.sirenOnly, ["Y"]);
  assert.equal(r.verticalAgreement, 1);
  assert.equal(r.horizontalAgreement, 1);
  assert.equal(r.meanOffset, 0);
  assert.equal(r.maxOffset, 0);
});

import { compareSizes } from "./metrics.mjs";

// Node sizes, compared as Siren's over Mermaid's at one font size (Siren's
// box scaled by 16/14). Mermaid A 200x50, B 100x100; Siren A 87.5x43.75,
// B 87.5x262.5 — at 16/14 that is A 100x50, B 100x300. Normalized width
// ratios: A 0.5, B 1 => mean 0.75. Height ratios: A 1, B 3 => mean 2.
// Unmatched X and Y are kept out. Nodes are listed furthest from their
// Mermaid size first, by the larger of the two normalized ratios' distance
// from 1 on a log scale: B |ln 3| = 1.10 before A |ln 0.5| = 0.69. Each
// node's boxes are listed raw.
test("node sizes: each matched node's two boxes, and the mean ratio on each axis", () => {
  const mermaid = {
    A: { x: 0, y: 0, width: 200, height: 50 },
    B: { x: 0, y: 100, width: 100, height: 100 },
    X: { x: 9, y: 9, width: 1, height: 1 },
  };
  const siren = {
    A: { x: 0, y: 0, width: 87.5, height: 43.75 },
    B: { x: 0, y: 100, width: 87.5, height: 262.5 },
    Y: { x: 9, y: 9, width: 1, height: 1 },
  };
  const r = compareSizes(mermaid, siren);
  assert.equal(r.meanWidthRatio, 0.75);
  assert.equal(r.meanHeightRatio, 2);
  assert.deepEqual(r.nodes, [
    { id: "B", mermaid: { width: 100, height: 100 }, siren: { width: 87.5, height: 262.5 } },
    { id: "A", mermaid: { width: 200, height: 50 }, siren: { width: 87.5, height: 43.75 } },
  ]);
});

test("node sizes with no matched node: no ratio to take", () => {
  const r = compareSizes({ X: { x: 0, y: 0, width: 1, height: 1 } }, {});
  assert.equal(r.meanWidthRatio, null);
  assert.equal(r.meanHeightRatio, null);
  assert.equal(r.rawMeanWidthRatio, null);
  assert.equal(r.rawMeanHeightRatio, null);
  assert.deepEqual(r.nodes, []);
});

// Review item 2: Mermaid draws its text at 16px and Siren at 14px, so a
// Siren node exactly 14/16 the size of Mermaid's is the same node, and
// reads ×1 on both axes. Mermaid A 160x48, Siren A 140x42: 140/160 = 42/48
// = 14/16. Mermaid B 160x48, Siren B 280x42: width ×2 once normalized, so
// B is listed first. The raw ratios are reported beside the normalized
// ones: A 0.875, B 1.75 => raw mean width 1.3125; heights 0.875 both.
test("node sizes are compared at one font size: Siren's 14px scaled to Mermaid's 16px", () => {
  const mermaid = { A: { x: 0, y: 0, width: 160, height: 48 }, B: { x: 0, y: 99, width: 160, height: 48 } };
  const siren = { A: { x: 0, y: 0, width: 140, height: 42 }, B: { x: 0, y: 99, width: 280, height: 42 } };
  const r = compareSizes(mermaid, siren);
  assert.equal(r.meanWidthRatio, 1.5);
  assert.equal(r.meanHeightRatio, 1);
  assert.equal(r.rawMeanWidthRatio, 1.3125);
  assert.equal(r.rawMeanHeightRatio, 0.875);
  assert.deepEqual(r.nodes.map((n) => n.id), ["B", "A"]);
});
