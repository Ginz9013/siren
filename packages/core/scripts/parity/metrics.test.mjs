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

// ─── Edge metrics ───────────────────────────────────────────────────────────
// Each edge metric is checked on a few straight segments whose answer can be
// read off a sketch: a positive case the metric must count, and a near miss
// it must not.

import { straightenArcs } from "./metrics.mjs";

// A line jump is a small arc drawn where one line crosses another; the
// crossing it marks must still be counted, so the arc is replaced by the
// straight chord to its end point. Absolute `A` becomes `L` and relative `a`
// becomes `l`, whatever separators the writer used — including the compact
// form that runs the two flags into the end point (`0 0110,20` is flags 0
// and 1, then x 10).
test("straightenArcs: a line jump's arc becomes the chord to its end point", () => {
  assert.equal(straightenArcs("M0,0L94,0A6,6,0,0,1,106,0L200,0"), "M0,0L94,0L106,0L200,0");
  assert.equal(straightenArcs("M0 0 a 6 6 0 0 0 12 0"), "M0 0 l12 0");
  assert.equal(straightenArcs("M0,0A6 6 0 0110,20"), "M0,0L10,20");
});

test("straightenArcs: a path without arcs is returned unchanged", () => {
  const d = "M0,0C10,0,20,10,30,10Q40,10,40,20L50,50";
  assert.equal(straightenArcs(d), d);
});

import { countCrossings } from "./metrics.mjs";

const line = (...xy) => {
  const points = [];
  for (let i = 0; i < xy.length; i += 2) points.push({ x: xy[i], y: xy[i + 1] });
  return { points };
};

// An X: the two diagonals of a 100px square cross at (50,50), 70px from
// every end.
test("crossings: two edges that cross mid-way count one", () => {
  assert.equal(countCrossings([line(0, 0, 100, 100), line(0, 100, 100, 0)]), 1);
});

// Two edges leaving one node fan out from (nearly) one point; where they
// meet is the node, not a crossing. A horizontal edge from (0,0) is cut by a
// vertical one 10px from its start — inside the 14px end zone, not counted —
// and by another 20px from its start — outside it, counted.
test("crossings: a meeting within 14px of an edge's end is not a crossing", () => {
  assert.equal(countCrossings([line(0, 0, 100, 0), line(10, -50, 10, 50)]), 0);
  assert.equal(countCrossings([line(0, 0, 100, 0), line(20, -50, 20, 50)]), 1);
});

// Two edges sharing an end but otherwise apart never cross; and a parallel
// pair never does either.
test("crossings: edges that only share an end, or run parallel, do not cross", () => {
  assert.equal(countCrossings([line(0, 0, 100, 100), line(0, 0, 100, 0)]), 0);
  assert.equal(countCrossings([line(0, 0, 100, 0), line(0, 10, 100, 10)]), 0);
});

// A sampled line has a vertex every few px, so a crossing can land exactly
// on one: the vertical edge meets the horizontal one at (50,0), the shared
// end of its two segments. It is one crossing, not two and not none. And an
// edge that weaves across another twice crosses it twice.
test("crossings: a crossing on a sample point counts once; two crossings count two", () => {
  assert.equal(countCrossings([line(0, 0, 50, 0, 100, 0), line(50, -50, 50, 50)]), 1);
  assert.equal(countCrossings([line(0, 0, 200, 0), line(40, -50, 80, 50, 120, -50)]), 2);
});

import { countThroughNodes } from "./metrics.mjs";

// Three 40px boxes in a row, centered at x 0, 100, 200 on y 0: A, C, B.
// Box edges: A x -20..20, C x 80..120, B x 180..220; all y -20..20.
const box = (x, y, width = 40, height = 40) => ({ x, y, width, height });
const row = [box(0, 0), box(100, 0), box(200, 0)];

// A→B drawn straight runs through C; its own ends A and B are where it is
// meant to be. One edge through an unrelated node.
test("through nodes: an edge drawn across an unrelated node counts", () => {
  assert.equal(countThroughNodes([line(20, 0, 180, 0)], row), 1);
  // Starting inside its own nodes changes nothing: A and B are its ends.
  assert.equal(countThroughNodes([line(0, 0, 200, 0)], row), 1);
});

// A→B routed over the top (y -60) clears C; and a line 1.5px inside C's top
// border (y -18.5) only grazes it — under the 3px a line must be inside a box
// to be drawn across it rather than along its outline.
test("through nodes: an edge that goes around, or only grazes a border, does not", () => {
  assert.equal(countThroughNodes([line(0, -20, 0, -60, 200, -60, 200, -20)], row), 0);
  assert.equal(countThroughNodes([line(20, -18.5, 180, -18.5)], row), 0);
});

import { countThroughTitles } from "./metrics.mjs";

// A group title 60x16 centered at (100,0): x 70..130, y -8..8.
const title = box(100, 0, 60, 16);

test("through titles: an edge drawn across a group's title counts", () => {
  assert.equal(countThroughTitles([line(100, -50, 100, 50), line(0, 0, 200, 0)], [title]), 2);
});

// One edge stops 1px short of the title's top; another runs 0.5px inside
// its bottom border, under the 1px a line must reach into the title.
test("through titles: an edge that stops short of a title, or skims its border, does not", () => {
  assert.equal(countThroughTitles([line(100, -50, 100, -9), line(0, 7.5, 200, 7.5)], [title]), 0);
});

import { countReversals } from "./metrics.mjs";

// A→B (the row above) leaving A's right side at x 20, ending 10px above B's
// box at (220,-30). Its ends span x 20..220; going out to x 232 first and
// coming back overshoots by 12px, over the 10px that counts as a reversal.
// The same route turning at x 228 overshoots by 8 and does not count.
test("reversals: a line that overshoots its ends' span by more than 10px and comes back counts", () => {
  assert.equal(countReversals([line(20, 0, 232, 0, 232, -30, 220, -30)], row), 1);
  assert.equal(countReversals([line(20, 0, 228, 0, 228, -30, 220, -30)], row), 0);
});

// Overshooting on the cross axis counts too: from A's bottom down to y 60,
// across, and back up to B's bottom — the ends are both at y 20.
test("reversals: an overshoot on either axis counts", () => {
  assert.equal(countReversals([line(0, 20, 0, 60, 200, 60, 200, 20)], row), 1);
});

// A self-loop leaves and re-enters one node, so it always "overshoots" its
// ends; it is not a reversal.
test("reversals: a self-loop is not a reversal", () => {
  assert.equal(countReversals([line(20, -10, 50, -10, 50, 10, 20, 10)], row), 0);
});

import { meanDetour } from "./metrics.mjs";

// A straight A→B, 160px long between ends 160px apart: ×1, no detour.
test("detour: a straight edge is ×1", () => {
  assert.equal(meanDetour([line(20, 0, 180, 0)], row), 1);
});

// Over the top: 40 up + 200 across + 40 down = 280px between ends 200px
// apart, ×1.4. With the straight edge beside it, the mean is (1 + 1.4) / 2 =
// 1.2. A self-loop's ends are a few px apart however far it travels, so it
// is kept out of the mean.
test("detour: the mean over edges of path length over the straight distance between its ends", () => {
  const overTheTop = line(0, -20, 0, -60, 200, -60, 200, -20);
  const loop = line(20, -10, 50, -10, 50, 10, 20, 10);
  const r = meanDetour([line(20, 0, 180, 0), overTheTop, loop], row);
  assert.ok(Math.abs(r - 1.2) < 1e-9, `detour ${r}`);
});

test("detour: no edge but self-loops, no ratio to take", () => {
  assert.equal(meanDetour([line(20, -10, 50, -10, 50, 10, 20, 10)], row), null);
});

import { measureEdges } from "./metrics.mjs";

// One picture, every edge metric at once. The row A C B, plus D above C
// (y -140..-100) and E below it (y 100..140), and a title 60x16 at (100,-30)
// (y -38..-22). Three edges:
// - A→B straight, through C: through a node, ×1;
// - A→B over the top at y -60: ×1.4, and a reversal (its ends are at y -20);
// - D→E straight down x 100: through C and through the title, ×1, crossing
//   the over-the-top edge at (100,-60) and the straight one at (100,0).
// Two crossings, two edges through a node, one through the title, one
// reversal, detour (1 + 1.4 + 1) / 3. Canvas 400 wide, 100 tall: aspect 4.
test("measureEdges: every edge metric of one picture, and its aspect ratio", () => {
  const r = measureEdges({
    edges: [line(20, 0, 180, 0), line(0, -20, 0, -60, 200, -60, 200, -20), line(100, -100, 100, 100)],
    nodes: [...row, box(100, -120), box(100, 120)],
    titles: [box(100, -30, 60, 16)],
    width: 400,
    height: 100,
  });
  assert.equal(r.edges, 3);
  assert.equal(r.crossings, 2);
  assert.equal(r.throughNodes, 2);
  assert.equal(r.throughTitles, 1);
  assert.equal(r.reversals, 1);
  assert.ok(Math.abs(r.detour - 3.4 / 3) < 1e-9, `detour ${r.detour}`);
  assert.equal(r.aspect, 4);
});

// Aspect is width over height: a tall picture reads under 1, and a picture
// with no height has none.
test("measureEdges: a tall canvas has aspect under 1; an empty one has none", () => {
  const tall = measureEdges({ edges: [], nodes: [], titles: [], width: 100, height: 400 });
  assert.equal(tall.aspect, 0.25);
  assert.equal(tall.detour, null);
  assert.equal(measureEdges({ edges: [], nodes: [], titles: [], width: 0, height: 0 }).aspect, null);
});
