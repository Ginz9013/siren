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
