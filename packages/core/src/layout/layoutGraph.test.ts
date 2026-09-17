import { describe, expect, it } from "vitest";
import type { GraphModel, TextMeasurer } from "../contracts";
import { layoutDirectedGraph } from "./layoutDirectedGraph";
import { layoutGraph } from "./layoutGraph";

/** Deterministic fake measurer per the ticket: width = text.length * 8, height = 24. */
const fakeMeasurer: TextMeasurer = {
  measure(text: string) {
    return { width: text.length * 8, height: 24 };
  },
};

/**
 * `A --> B`'s decomposition — a solid line, an arrow on the to-end only,
 * one rank long — spread into the fixtures below, which are about
 * positions and paint rather than about which arrow was written. A test
 * that *is* about the arrow sets its own.
 */
const PLAIN_ARROW = {
  line: "solid",
  fromEnd: "none",
  toEnd: "arrow",
  minLength: 1,
  label: null,
} as const;

function chainGraph(direction: GraphModel["direction"]): GraphModel {
  return {
    direction,
    nodes: [
      { id: "A", label: "A", shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
      { id: "B", label: "B", shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
      { id: "C", label: "C", shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
    ],
    edges: [
      { id: "A-B", from: "A", to: "B", ...PLAIN_ARROW, style: { frame: [], text: [] } },
      { id: "B-C", from: "B", to: "C", ...PLAIN_ARROW, style: { frame: [], text: [] } },
    ],
    subgraphs: [],
    accTitle: null,
    accDescr: null,
    timeline: { totalSteps: 0, entries: [] },
  };
}

describe("layoutGraph", () => {
  it("stacks ranks downward for a TB chain graph", () => {
    const graph = chainGraph("TB");

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));
    expect(byId.B.y).toBeGreaterThan(byId.A.y);
    expect(byId.C.y).toBeGreaterThan(byId.B.y);
  });

  it("stacks ranks rightward for an LR chain graph", () => {
    const graph = chainGraph("LR");

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));
    expect(byId.B.x).toBeGreaterThan(byId.A.x);
    expect(byId.C.x).toBeGreaterThan(byId.B.x);
  });

  it("honors all four rank directions, not just the two the header used to accept", () => {
    const byIdFor = (direction: GraphModel["direction"]) => {
      const positioned = layoutGraph(chainGraph(direction), { measureText: fakeMeasurer });
      return Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));
    };

    const bt = byIdFor("BT");
    expect(bt.B.y).toBeLessThan(bt.A.y);
    expect(bt.C.y).toBeLessThan(bt.B.y);

    const rl = byIdFor("RL");
    expect(rl.B.x).toBeLessThan(rl.A.x);
    expect(rl.C.x).toBeLessThan(rl.B.x);
  });

  it("produces non-overlapping bounding boxes for all nodes", () => {
    const graph = chainGraph("TB");

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    function overlaps(
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number },
    ): boolean {
      return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      );
    }

    for (let i = 0; i < positioned.nodes.length; i++) {
      for (let j = i + 1; j < positioned.nodes.length; j++) {
        expect(overlaps(positioned.nodes[i], positioned.nodes[j])).toBe(
          false,
        );
      }
    }
  });

  it("routes each edge's path from the source node's boundary to the target node's boundary, not their centers", () => {
    const graph = chainGraph("TB");

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));

    function centerOf(node: { x: number; y: number; width: number; height: number }) {
      return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    }

    for (const edge of positioned.edges) {
      const source = byId[edge.from];
      const target = byId[edge.to];
      const first = edge.points[0];
      const last = edge.points[edge.points.length - 1];

      expect(first).not.toEqual(centerOf(source));
      expect(last).not.toEqual(centerOf(target));
    }
  });

  it("produces identical output for two calls with the same graph and measurer (deterministic)", () => {
    const graph = chainGraph("TB");

    const first = layoutGraph(graph, { measureText: fakeMeasurer });
    const second = layoutGraph(graph, { measureText: fakeMeasurer });

    expect(second).toEqual(first);
  });

  it("gives a rhombus enough box that its label fits inside the diamond, not merely inside its bounding box", () => {
    // The rule this ticket settles, and the one the other twelve shapes
    // inherit: a shape is drawn *inscribed* in the node's bounding box, so
    // layout asks the shape how much box its label needs rather than
    // handing every shape the label's own box the way a rectangle can take
    // it. A diamond circumscribing the text box the way a rectangle does
    // would cross its own label on all four diagonals.
    //
    // For a rhombus that box is exactly twice the label on each axis. A
    // diamond inscribed in `W x H` contains the centred `w x h` label
    // exactly when `w/W + h/H <= 1`, so `W = 2w, H = 2h` is the smallest
    // diamond of the label's own proportions that holds it — which is why
    // the numbers scale with the label instead of a constant pad being
    // added to it. The measured box is the glyphs *plus* the theme's
    // padding, so corners lying on the outline still leave the text inside
    // it.
    const graph: GraphModel = {
      direction: "TB",
      nodes: [
        { id: "A", label: "Is it ready?", shape: "rhombus", style: { frame: [], text: [] }, parentId: null, interaction: null },
        { id: "B", label: "?", shape: "rhombus", style: { frame: [], text: [] }, parentId: null, interaction: null },
        { id: "C", label: "Is it ready?", shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
      ],
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));

    // `fakeMeasurer`: 8px per character wide, 24px tall.
    expect([byId.A.width, byId.A.height]).toEqual([12 * 8 * 2, 24 * 2]);
    // A one-character label gets a small diamond rather than the same one:
    // the box is proportional to the label, not the label plus a constant.
    expect([byId.B.width, byId.B.height]).toEqual([1 * 8 * 2, 24 * 2]);
    // A rect still takes the measured box exactly — the shape it is
    // inscribed in is the box, so it needs nothing extra, and no existing
    // flowchart changes size because shapes arrived.
    expect([byId.C.width, byId.C.height]).toEqual([12 * 8, 24]);

    // The rule itself, stated as geometry rather than as the two numbers
    // above, because it is what a hexagon and a circle will be measured
    // against too.
    const fitsInsideDiamond = (node: (typeof positioned.nodes)[number]) => {
      const label = fakeMeasurer.measure(node.label);
      return label.width / node.width + label.height / node.height <= 1;
    };
    expect(fitsInsideDiamond(byId.A)).toBe(true);
    expect(fitsInsideDiamond(byId.B)).toBe(true);
  });

  it("gives each shape drawn with a slanted or notched outline exactly the box its label needs, and no more", () => {
    // The same rule ticket 01 settled for the rhombus, applied rather than
    // reinvented: **the smallest bounding box in which this shape,
    // inscribed, still contains the centred measured label.**
    //
    // For all six of this ticket's shapes that box works out to one
    // formula, because in every one of them the outline's horizontal
    // displacement at the *label's own edge* is `lean x H` per side, and
    // nothing forces the box taller than the label:
    //
    //   H = h,  W = w + 2 x lean x h
    //
    // Worked, per shape, with `lean` the outline's run per side as a
    // fraction of the box height:
    //
    // - hexagon (`lean = 1/4`): at `H = h` the label's top edge *is* the
    //   hexagon's top edge, which spans the box inset by `m = lean x H` at
    //   each end, so `w <= W - 2m`.
    // - parallelogram / -alt (`lean = 1/2`): the leaning side displaces
    //   `s = lean x H` across the full height, so at the label's top edge
    //   it has displaced `s(1 + h/H)/2`, which is `s` when `H = h`.
    // - trapezoid / -alt (`lean = 1/2`): the same arithmetic on both sides
    //   at once, at the narrow edge.
    // - asymmetric (`lean = 1/4`): the notch reaches its deepest, `d = lean
    //   x H`, exactly at mid-height, which is where the label is centred —
    //   so the box must grow by `d` on the notched side, and the label
    //   being centred makes that `2d` overall.
    //
    // Proportions are Siren's own (the board's decision 1), and these
    // happen to be Mermaid's: measured from mermaid 11.17.2's rendered
    // polygons, a `lean_right` displaces `h/2`, a `trapezoid` insets `h/2`
    // per side, a `hexagon` insets `h/4` per end and an `odd`'s notch is
    // `h/4` deep.
    const shapes = [
      "hexagon",
      "parallelogram",
      "parallelogram-alt",
      "trapezoid",
      "trapezoid-alt",
      "asymmetric",
    ] as const;
    const graph: GraphModel = {
      direction: "TB",
      nodes: shapes.flatMap((shape) => [
        { id: `${shape}-long`, label: "A rather long label", shape, style: { frame: [], text: [] }, parentId: null, interaction: null },
        { id: `${shape}-short`, label: "x", shape, style: { frame: [], text: [] }, parentId: null, interaction: null },
      ]),
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });
    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));

    // `fakeMeasurer`: 8px per character wide, 24px tall. "A rather long
    // label" is 19 characters, so `w = 152, h = 24`.
    const lean: Record<(typeof shapes)[number], number> = {
      hexagon: 1 / 4,
      parallelogram: 1 / 2,
      "parallelogram-alt": 1 / 2,
      trapezoid: 1 / 2,
      "trapezoid-alt": 1 / 2,
      asymmetric: 1 / 4,
    };
    for (const shape of shapes) {
      const long = byId[`${shape}-long`];
      const short = byId[`${shape}-short`];
      expect([shape, long.width, long.height]).toEqual([
        shape,
        152 + 2 * lean[shape] * 24,
        24,
      ]);
      // Proportional to the label rather than the label plus a constant, so
      // a one-character node stays small — the property ticket 01 asserted
      // for the rhombus, which is what makes these formulas rather than
      // fudge factors.
      expect([shape, short.width, short.height]).toEqual([
        shape,
        8 + 2 * lean[shape] * 24,
        24,
      ]);
      // And the box is the *smallest* one: one pixel narrower and the label
      // would cross the outline.
      expect(long.width - 2 * lean[shape] * long.height).toBe(152);
    }
  });

  it("gives the three rect-drawn shapes the box their label needs to clear a corner radius or an inner bar", () => {
    // Ticket 01's rule again, and it lands in the same family as ticket
    // 02's six even though nothing here is drawn with a `<path>`: **the
    // smallest bounding box in which this shape, inscribed, still contains
    // the centred measured label**, which for all three is `H = h, W = w +
    // 2 x lean x h`.
    //
    // What `lean` is here is the corner radius, or the bar inset, as a
    // fraction of the box height — the same number the renderer draws
    // with, which is why it stays in `SHAPE_LEAN` rather than being
    // restated:
    //
    // - stadium (`lean = 1/2`): the ends are semicircles of radius `H/2`.
    //   At `H = h` the label's top corners sit *on* the box's top edge,
    //   where a semicircular end has bulged no distance at all, so the
    //   whole of each end has to lie outside the label: `W >= w + H`.
    // - round (`lean = 1/4`): the same argument with a smaller radius. The
    //   rounded corner starts `r` in from each end, and at `H = h` the
    //   label's corner is on the top edge, so `W >= w + 2r`.
    // - subroutine (`lean = 1/8`): the label goes *between* the two inner
    //   bars, each inset `lean x H` from its own end, so `W >= w + 2 x
    //   inset` — the shape's whole content is those bars, and a label
    //   crossing one is the picture broken.
    //
    // A rectangle still takes the measured label unchanged, which is the
    // control: these three are not "a rect plus a pad", they are three
    // outlines each reserving exactly what it draws.
    const shapes = ["round", "stadium", "subroutine"] as const;
    const graph: GraphModel = {
      direction: "TB",
      nodes: [
        ...shapes.flatMap((shape) => [
          { id: `${shape}-long`, label: "A rather long label", shape, style: { frame: [], text: [] }, parentId: null, interaction: null },
          { id: `${shape}-short`, label: "x", shape, style: { frame: [], text: [] }, parentId: null, interaction: null },
        ]),
        { id: "rect-long", label: "A rather long label", shape: "rect" as const, style: { frame: [], text: [] }, parentId: null, interaction: null },
      ],
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });
    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));

    // `fakeMeasurer`: 8px per character wide, 24px tall. "A rather long
    // label" is 19 characters, so `w = 152, h = 24`.
    const lean: Record<(typeof shapes)[number], number> = {
      round: 1 / 4,
      stadium: 1 / 2,
      subroutine: 1 / 8,
    };
    for (const shape of shapes) {
      const long = byId[`${shape}-long`];
      const short = byId[`${shape}-short`];
      expect([shape, long.width, long.height]).toEqual([shape, 152 + 2 * lean[shape] * 24, 24]);
      // Proportional to the label rather than the label plus a constant, so
      // a one-character node stays small.
      expect([shape, short.width, short.height]).toEqual([shape, 8 + 2 * lean[shape] * 24, 24]);
      // And the *smallest* such box: one pixel narrower and the label would
      // cross the corner, or the bar.
      expect(long.width - 2 * lean[shape] * long.height).toBe(152);
    }

    // The three are three different boxes, not one shared pad: a stadium
    // reserves the most room, a subroutine the least, and a rectangle none.
    expect(byId["stadium-long"].width).toBeGreaterThan(byId["round-long"].width);
    expect(byId["round-long"].width).toBeGreaterThan(byId["subroutine-long"].width);
    expect(byId["subroutine-long"].width).toBeGreaterThan(byId["rect-long"].width);
    expect([byId["rect-long"].width, byId["rect-long"].height]).toEqual([152, 24]);
  });

  it("gives a circle a diameter spanning its label's diagonal, so a wide label makes a large node on both axes", () => {
    // Ticket 01's rule, applied to the outline it costs the most: **the
    // smallest bounding box in which this shape, inscribed, still contains
    // the centred measured label.** A circle inscribed in `W x H` is only a
    // circle when `W = H`, and the smallest circle containing a centred
    // `w x h` rectangle is the one whose diameter is that rectangle's
    // *diagonal* — every corner of the label lies on it. So
    //
    //   W = H = hypot(w, h)
    //
    // and ticket 01 named this answer in advance. It is honest rather than
    // convenient, and the consequence is stated here rather than
    // discovered in a diagram: a wide label makes a **very large** node,
    // because the circle has to grow in height to accommodate width it
    // never needed. Nothing caps it. A cap would be a circle that clips its
    // own label, which is the one thing the rule exists to prevent, and a
    // shape's kind is the compatibility contract (the board's decision 1) —
    // so `A((A rather long label))` is a 154-unit-tall node, and an author
    // who does not want one writes `A(A rather long label)`.
    const graph: GraphModel = {
      direction: "TB",
      nodes: [
        { id: "long", label: "A rather long label", shape: "circle", style: { frame: [], text: [] }, parentId: null, interaction: null },
        { id: "short", label: "x", shape: "circle", style: { frame: [], text: [] }, parentId: null, interaction: null },
        { id: "rect-long", label: "A rather long label", shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
      ],
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });
    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));

    // `fakeMeasurer`: 8px per character wide, 24px tall. "A rather long
    // label" is 19 characters, so `w = 152, h = 24` and the diagonal is
    // `hypot(152, 24)`.
    const diagonal = Math.hypot(152, 24);
    expect([byId.long.width, byId.long.height]).toEqual([diagonal, diagonal]);
    // Square, because an inscribed figure in a non-square box is an
    // ellipse and `A((x))` has to be a circle.
    expect(byId.long.width).toBe(byId.long.height);
    // Proportional to the label rather than the label plus a constant.
    expect([byId.short.width, byId.short.height]).toEqual([
      Math.hypot(8, 24),
      Math.hypot(8, 24),
    ]);

    // The diagonal, not the width: a box merely as wide as the label would
    // clip all four of its corners. The difference is unmistakable on the
    // vertical axis — the same label in a rectangle is 24 tall and here it
    // is more than six times that.
    expect(byId.long.height).toBeGreaterThan(6 * byId["rect-long"].height);
    // And the rule itself, stated as geometry: every corner of the centred
    // label is within the circle's radius of its centre.
    for (const id of ["long", "short"]) {
      const node = byId[id];
      const label = fakeMeasurer.measure(node.label);
      expect([id, Math.hypot(label.width / 2, label.height / 2) <= node.width / 2]).toEqual([
        id,
        true,
      ]);
    }
  });

  it("gives a double circle enough box that its label fits inside the *inner* ring, not merely inside the outer one", () => {
    // A double circle is two rings, and the label belongs inside the inner
    // one — a box sized for the outer circle would draw the inner ring
    // straight through the text. So the rule reads off the inner circle:
    // its diameter is the label's diagonal, and the box is that plus the
    // gap between the rings on each side.
    //
    // The gap is `SHAPE_LEAN["double-circle"] x H` per side, the same
    // number the renderer insets the inner ring by, so
    //
    //   W = H = hypot(w, h) / (1 - 2 x lean)
    //
    // which is the smallest such box: at one unit narrower the inner ring
    // crosses the label's corners.
    const lean = 1 / 16;
    const graph: GraphModel = {
      direction: "TB",
      nodes: [
        { id: "long", label: "A rather long label", shape: "double-circle", style: { frame: [], text: [] }, parentId: null, interaction: null },
        { id: "short", label: "x", shape: "double-circle", style: { frame: [], text: [] }, parentId: null, interaction: null },
        { id: "circle-long", label: "A rather long label", shape: "circle", style: { frame: [], text: [] }, parentId: null, interaction: null },
      ],
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });
    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));

    // `fakeMeasurer`: 8px per character wide, 24px tall.
    expect([byId.long.width, byId.long.height]).toEqual([
      Math.hypot(152, 24) / (1 - 2 * lean),
      Math.hypot(152, 24) / (1 - 2 * lean),
    ]);
    expect([byId.short.width, byId.short.height]).toEqual([
      Math.hypot(8, 24) / (1 - 2 * lean),
      Math.hypot(8, 24) / (1 - 2 * lean),
    ]);

    // Wider than the single circle holding the same label, and by exactly
    // the two gaps — a double circle is a circle plus a ring, and this is
    // the room that ring is drawn in.
    expect(byId.long.width).toBeGreaterThan(byId["circle-long"].width);

    // The rule itself, as geometry: every corner of the centred label is
    // within the *inner* radius of the centre.
    for (const id of ["long", "short"]) {
      const node = byId[id];
      const label = fakeMeasurer.measure(node.label);
      const inner = node.width / 2 - lean * node.height;
      expect([id, Math.hypot(label.width / 2, label.height / 2) <= inner]).toEqual([id, true]);
    }
  });

  it("gives a cylinder the height its label needs to clear the lid drawn across its top and the bulge under its bottom", () => {
    // The one shape on this board whose box grows in **height** rather than
    // in width, and the reason the rule is stated as a box rather than as a
    // pad: a cylinder's sides are straight, so it needs no extra width at
    // all, while its top and bottom are ellipses of vertical semi-axis
    // `r = lean x H` and both eat into the room a label has.
    //
    // Worked from the outline the renderer draws:
    //
    // - The lid is a full ellipse centred `r` below the top edge, so its
    //   lowest point is `2r` down and no label may start above that.
    // - The bottom bulges from `H - r` down to `H`, and at the label's own
    //   corners — which are at the full width, where the bulge has not yet
    //   dropped at all — the outline is exactly at `H - r`.
    //
    // So the label may occupy `2r` to `H - r`. That band is **not centred**
    // on the box, and the renderer centres every node's text on `H/2`
    // (`.siren-node text` is placed at the box's middle for all fourteen
    // shapes), so the binding constraint is the lid, mirrored: the label's
    // top edge at `H/2 - h/2` must clear `2r`, which gives `H - h = 4r` and
    //
    //   W = w,  H = h / (1 - 4 x lean)
    //
    // and it is the smallest such box: one unit shorter and the centred
    // label's top edge crosses the lid. The bulge is then clear by `r`,
    // which is the room the label does not use because it sits above
    // centre in the shape's own terms.
    const lean = 1 / 8;
    const graph: GraphModel = {
      direction: "TB",
      nodes: [
        { id: "long", label: "A rather long label", shape: "cylinder", style: { frame: [], text: [] }, parentId: null, interaction: null },
        { id: "short", label: "x", shape: "cylinder", style: { frame: [], text: [] }, parentId: null, interaction: null },
        { id: "rect-long", label: "A rather long label", shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
      ],
      edges: [],
      subgraphs: [],
      accTitle: null,
      accDescr: null,
      timeline: { totalSteps: 0, entries: [] },
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });
    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));

    // `fakeMeasurer`: 8px per character wide, 24px tall.
    expect([byId.long.width, byId.long.height]).toEqual([152, 24 / (1 - 4 * lean)]);
    expect([byId.short.width, byId.short.height]).toEqual([8, 24 / (1 - 4 * lean)]);

    // No wider than the rectangle holding the same label — the sides are
    // straight, so nothing is reserved on an axis the outline does not
    // lean on — and taller than it, which nothing else on this board is.
    expect(byId.long.width).toBe(byId["rect-long"].width);
    expect(byId.long.height).toBeGreaterThan(byId["rect-long"].height);

    // The rule itself, as geometry: the centred label's band lies between
    // the bottom of the lid and the top of the bulge.
    for (const id of ["long", "short"]) {
      const node = byId[id];
      const label = fakeMeasurer.measure(node.label);
      const r = lean * node.height;
      const top = node.height / 2 - label.height / 2;
      const bottom = node.height / 2 + label.height / 2;
      expect([id, top >= 2 * r, bottom <= node.height - r]).toEqual([id, true, true]);
    }
  });

  it("passes the resolved timeline through unchanged onto PositionedGraph.timeline", () => {
    const graph: GraphModel = {
      ...chainGraph("TB"),
      timeline: {
        totalSteps: 2,
        entries: [
          { kind: "enter", step: 1, targetId: "B", effect: "fade" },
          { kind: "enter", step: 2, targetId: "C", effect: "fade" },
        ],
      },
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    expect(positioned.timeline).toEqual(graph.timeline);
  });

  it("passes accTitle and accDescr through unchanged onto PositionedGraph", () => {
    const graph: GraphModel = {
      ...chainGraph("TB"),
      accTitle: "A short title",
      accDescr: "A longer description",
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    expect(positioned.accTitle).toBe("A short title");
    expect(positioned.accDescr).toBe("A longer description");
  });

  it("passes each node's resolved author styling through unchanged onto PositionedNode.style", () => {
    // Layout has no opinion about styling: the declarations, their order, the
    // half each one was sorted into and the empty halves of an unstyled node
    // all arrive at the renderer exactly as `buildFlowchartModel` resolved
    // them. What they *mean* was settled at `resolveStyles`, and this stage
    // may not re-decide any of it — which is why the text half is carried
    // here too rather than dropped as the half this stage has no use for.
    const base = chainGraph("TB");
    const graph: GraphModel = {
      ...base,
      nodes: [
        {
          ...base.nodes[0],
          style: {
            frame: [
              { property: "fill", value: "#fdd" },
              { property: "stroke", value: "#c00" },
            ],
            text: [{ property: "fill", value: "#fff" }],
          },
        },
        ...base.nodes.slice(1),
      ],
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));
    expect(byId.A.style).toEqual({
      frame: [
        { property: "fill", value: "#fdd" },
        { property: "stroke", value: "#c00" },
      ],
      text: [{ property: "fill", value: "#fff" }],
    });
    expect(byId.B.style).toEqual({ frame: [], text: [] });
  });

  it("passes each edge's resolved author styling through unchanged onto PositionedEdge.style", () => {
    // The same rule the node styling above follows, and the reason
    // `linkStyle`'s index has to die at the model: what arrives here is
    // already keyed by edge id, so layout reattaches declarations to routes
    // without ever asking which position an edge was declared at.
    const base = chainGraph("TB");
    const graph: GraphModel = {
      ...base,
      edges: [
        {
          ...base.edges[0],
          style: { frame: [{ property: "stroke", value: "#f00" }], text: [] },
        },
        ...base.edges.slice(1),
      ],
    };

    const positioned = layoutGraph(graph, { measureText: fakeMeasurer });

    const byId = Object.fromEntries(positioned.edges.map((e) => [e.id, e]));
    expect(byId["A-B"].style).toEqual({
      frame: [{ property: "stroke", value: "#f00" }],
      text: [],
    });
    expect(byId["B-C"].style).toEqual({ frame: [], text: [] });
  });
});

/**
 * A long arrow is the one part of an arrow token that is not about drawing:
 * `A ----> B` puts B further down the rank order, so the claim is about
 * where the boxes end up and it is asserted here, against coordinates,
 * rather than in the renderer against a path nobody can read a rank off.
 */
describe("how long an edge holds its endpoints apart", () => {
  const twoNodes = (minLength: number): GraphModel => ({
    direction: "TB",
    nodes: [
      { id: "A", label: "A", shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
      { id: "B", label: "B", shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
    ],
    edges: [
      {
        id: "A-B",
        from: "A",
        to: "B",
        line: "solid",
        fromEnd: "none",
        toEnd: "arrow",
        minLength,
        label: null,
        style: { frame: [], text: [] },
      },
    ],
    subgraphs: [],
    accTitle: null,
    accDescr: null,
    timeline: { totalSteps: 0, entries: [] },
  });

  const gap = (minLength: number) => {
    const positioned = layoutGraph(twoNodes(minLength), { measureText: fakeMeasurer });
    const byId = Object.fromEntries(positioned.nodes.map((node) => [node.id, node]));
    return byId.B.y - byId.A.y;
  };

  it("puts a longer arrow's target further down the rank order", () => {
    // Three ranks apart rather than one, which is what mermaid 11.17.2 does
    // with `A ----> B`: it reads `length=3` and hands it to dagre as
    // `minlen`, measured. Asserted as a *strict* increase rather than
    // against a number, because how tall a rank is belongs to the theme
    // (ADR-0004) while how many ranks apart the two nodes are is the
    // compatibility contract.
    expect(gap(3)).toBeGreaterThan(gap(1));
    expect(gap(2)).toBeGreaterThan(gap(1));
    expect(gap(3)).toBeGreaterThan(gap(2));
  });

  it("leaves a plain arrow's graph exactly where it was", () => {
    // The one thing a new layout input must not do: move a diagram nobody
    // asked to change. Checked against the chain fixture every other test
    // in this file lays out — the graph as it was before an edge had a
    // length at all — rather than against a number copied out of a run,
    // which would pass whatever this code did.
    const chain = layoutGraph(chainGraph("TB"), { measureText: fakeMeasurer });
    const byId = Object.fromEntries(chain.nodes.map((node) => [node.id, node]));

    expect(gap(1)).toBe(byId.B.y - byId.A.y);
  });
});

/**
 * An edge label is a box dagre has to keep clear, not decoration the
 * renderer adds afterwards. That claim is about numbers — the ranks move
 * apart and the route reports where the space ended up — and neither half
 * of it is visible in the drawn path alone, which is why it is asserted
 * here rather than against an SVG.
 *
 * The reserved space is `layoutDirectedGraph`'s, unchanged: it has taken an
 * edge label's width and height and returned a `labelAnchor` since the
 * class board, and what was missing was only that a flowchart edge had no
 * label to pass.
 */
describe("the room an edge label is given", () => {
  const twoNodes = (
    label: string | null,
    direction: GraphModel["direction"] = "TB",
  ): GraphModel => ({
    direction,
    nodes: [
      { id: "A", label: "A", shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
      { id: "B", label: "B", shape: "rect", style: { frame: [], text: [] }, parentId: null, interaction: null },
    ],
    edges: [
      {
        id: "A-B",
        from: "A",
        to: "B",
        ...PLAIN_ARROW,
        label,
        style: { frame: [], text: [] },
      },
    ],
    subgraphs: [],
    accTitle: null,
    accDescr: null,
    timeline: { totalSteps: 0, entries: [] },
  });

  const laidOut = (label: string | null, direction: GraphModel["direction"] = "TB") =>
    layoutGraph(twoNodes(label, direction), { measureText: fakeMeasurer });

  /** How far apart the two boxes ended up — the room the label was given. */
  const gap = (label: string | null) => {
    const byId = Object.fromEntries(laidOut(label).nodes.map((node) => [node.id, node]));
    return byId.B.y - byId.A.y;
  };

  it("routes a labelled edge differently from an unlabelled one", () => {
    // The whole claim of this criterion: a label is not paint. A renderer
    // test cannot see reserved space — it would draw the text at whatever
    // anchor it was handed and pass either way — so the geometry is
    // asserted at the seam that decides it.
    expect(gap("yes")).toBeGreaterThan(gap(null));
  });

  it("gives a long label more room than a short one, measured with the same measurer", () => {
    // The measurer is the one everything else uses, so a label's width is
    // the glyphs it actually has — `fakeMeasurer` reports `text.length * 8`
    // for the width and a constant 24 for the height, exactly as a real
    // one-line measurement behaves.
    //
    // **Which way the extra room goes is the direction's, and both are
    // asserted.** A reserved box lies between two ranks, so in `TB` a
    // longer label is a *wider* one and widens the drawing, while in `LR`
    // that same width is what separates the ranks and pushes the boxes
    // apart. Asserting only the first would pass for a layout that measured
    // the label and then ignored the measurement in half the directions.
    //
    // Strict inequalities rather than numbers: how many pixels a rank is
    // worth belongs to the theme (ADR-0004); that a longer label costs more
    // room is the contract.
    const long = "a very long edge label indeed";

    expect(laidOut(long).width).toBeGreaterThan(laidOut("no").width);

    const spread = (label: string) => {
      const byId = Object.fromEntries(laidOut(label, "LR").nodes.map((n) => [n.id, n]));
      return byId.B.x - byId.A.x;
    };
    expect(spread(long)).toBeGreaterThan(spread("no"));
  });

  it("reports where the reserved space ended up, and nothing for an edge that asked for none", () => {
    // The anchor is what the renderer draws the text at, so an edge with a
    // label must have one and an edge without must not — `null` rather than
    // a point nobody should use, which is the shape `layoutClassDiagram`
    // already gives a relationship's label.
    const [labelled] = laidOut("yes").edges;
    const [plain] = laidOut(null).edges;

    expect(plain.labelAnchor).toBeNull();
    expect(labelled.labelAnchor).not.toBeNull();
    // Somewhere on the way between the two boxes, rather than at the
    // origin: an anchor that defaulted to `{ x: 0, y: 0 }` would draw every
    // label in the corner and still be "not null".
    const byId = Object.fromEntries(laidOut("yes").nodes.map((node) => [node.id, node]));
    expect(labelled.labelAnchor!.y).toBeGreaterThan(byId.A.y + byId.A.height);
    expect(labelled.labelAnchor!.y).toBeLessThan(byId.B.y);
  });
});

/**
 * The regression that would otherwise be invisible.
 *
 * `layoutDirectedGraph` switches dagre's compound mode on **only when a
 * cluster is declared**, and its own comment says why: with compound mode on
 * dagre reserves extra horizontal room for self-edges, which shifts the
 * routing and the graph width of graphs that have no clusters at all. So a
 * flowchart adapter that declared a cluster unconditionally — one empty
 * cluster, or a `parentId` written as `undefined` in a way the `some` check
 * still counts — would move every diagram in the world by a few pixels with
 * every test in this repo still green and every picture subtly different.
 *
 * Asserted as an *equivalence* rather than against coordinates copied out of
 * a run: a graph whose model declares no subgraph must lay out exactly as the
 * shared core lays out the same boxes and edges with no clustering mentioned
 * at all. That says the thing that must stay true, and keeps saying it when
 * the theme retunes a number nobody promised.
 */
describe("a graph with no subgraph", () => {
  it("lays out exactly as the shared core does with no clustering mentioned at all", () => {
    const graph = chainGraph("TB");

    const throughAdapter = layoutGraph(graph, { measureText: fakeMeasurer });

    // The same three boxes and two edges, handed to the shared core with no
    // `parentId` and no `isCluster` anywhere — which is the input that keeps
    // compound mode off.
    const throughCore = layoutDirectedGraph({
      rankdir: "TB",
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        ...fakeMeasurer.measure(node.label),
      })),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        minlen: edge.minLength,
      })),
    });

    expect(
      throughAdapter.nodes.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
    ).toEqual(throughCore.nodes);
    expect(throughAdapter.edges.map(({ id, points }) => ({ id, points }))).toEqual(
      throughCore.edges,
    );
    expect(throughAdapter.width).toBe(throughCore.width);
    expect(throughAdapter.height).toBe(throughCore.height);
  });
});

/**
 * A subgraph is a **cluster**, and the whole point of that word is that the
 * layout engine places the group rather than a frame being drawn around
 * whatever a flat layout happened to produce. The difference is invisible in
 * a one-group diagram and obvious in a two-group one: a flat layout is free
 * to put a node of `T` between two nodes of `S`, and a frame drawn around
 * `S` afterwards would then enclose it.
 *
 * So these tests are about *separation* as much as about enclosure — a frame
 * holds its own members and no one else's — and about the edges that make
 * grouping worth having: one that leaves a group, and one that joins two.
 *
 * `layoutDirectedGraph` already does all of it: `parentId`, `isCluster`, and
 * nested clusters (verified against `@dagrejs/dagre` directly before any of
 * this was written). Nothing about the shared core changed for this.
 */
describe("a subgraph's frame", () => {
  /** A node, with everything a layout does not care about spelled once. */
  const node = (id: string, parentId: string | null = null) => ({
    id,
    label: id,
    shape: "rect" as const,
    style: { frame: [], text: [] },
    parentId,
    interaction: null,
  });

  const edge = (from: string, to: string) => ({
    id: `${from}-${to}`,
    from,
    to,
    ...PLAIN_ARROW,
    style: { frame: [], text: [] },
  });

  const model = (
    nodes: GraphModel["nodes"],
    edges: GraphModel["edges"],
    subgraphs: GraphModel["subgraphs"],
  ): GraphModel => ({
    direction: "TB",
    nodes,
    edges,
    subgraphs,
    accTitle: null,
    accDescr: null,
    timeline: { totalSteps: 0, entries: [] },
  });

  const laidOut = (graph: GraphModel) => layoutGraph(graph, { measureText: fakeMeasurer });

  /** Whether `outer` wholly contains `inner`. */
  const contains = (
    outer: { x: number; y: number; width: number; height: number },
    inner: { x: number; y: number; width: number; height: number },
  ) =>
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height;

  const overlaps = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) =>
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;

  it("encloses the nodes inside it, with room above them for its own title", () => {
    const positioned = laidOut(
      model(
        [node("A", "subgraph:1"), node("B", "subgraph:1"), node("C")],
        [edge("A", "B"), edge("B", "C")],
        [{ id: "subgraph:1", label: "Ingest", parentId: null }],
      ),
    );

    expect(positioned.subgraphs).toHaveLength(1);
    const [frame] = positioned.subgraphs;
    expect(frame.id).toBe("subgraph:1");
    expect(frame.label).toBe("Ingest");

    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));
    expect(contains(frame, byId.A)).toBe(true);
    expect(contains(frame, byId.B)).toBe(true);
    // `C` belongs to nothing, so the frame must not have swallowed it.
    expect(contains(frame, byId.C)).toBe(false);

    // The title is drawn on the frame, above everything the frame holds —
    // not through the first member box. Same strip `layoutClassDiagram`
    // reserves for a namespace's label.
    expect(frame.labelAnchor.y).toBeGreaterThan(frame.y);
    expect(frame.labelAnchor.y).toBeLessThan(Math.min(byId.A.y, byId.B.y));
    expect(frame.labelAnchor.x).toBeGreaterThan(frame.x);
    expect(frame.labelAnchor.x).toBeLessThan(frame.x + frame.width);
  });

  it("nests, and the outer frame contains the inner one whole", () => {
    const positioned = laidOut(
      model(
        [node("A", "subgraph:2"), node("B", "subgraph:2"), node("C", "subgraph:1"), node("D")],
        [edge("A", "B"), edge("C", "A"), edge("B", "D")],
        [
          { id: "subgraph:1", label: "Outer", parentId: null },
          { id: "subgraph:2", label: "Inner", parentId: "subgraph:1" },
        ],
      ),
    );

    const frames = Object.fromEntries(positioned.subgraphs.map((s) => [s.id, s]));
    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));

    // Two levels, because one level can be made to work by an
    // implementation that cannot nest: `Outer` must hold the whole of
    // `Inner`'s frame — its title strip included — and not merely the boxes
    // inside it.
    expect(contains(frames["subgraph:1"], frames["subgraph:2"])).toBe(true);
    expect(contains(frames["subgraph:2"], byId.A)).toBe(true);
    expect(contains(frames["subgraph:2"], byId.B)).toBe(true);
    expect(contains(frames["subgraph:1"], byId.C)).toBe(true);
    // `C` is `Outer`'s own, not `Inner`'s.
    expect(contains(frames["subgraph:2"], byId.C)).toBe(false);
    // `D` is nobody's.
    expect(contains(frames["subgraph:1"], byId.D)).toBe(false);
  });

  it("keeps two groups apart, and routes the edge that joins them between them", () => {
    const positioned = laidOut(
      model(
        [node("A", "subgraph:1"), node("B", "subgraph:1"), node("C", "subgraph:2"), node("D", "subgraph:2")],
        [edge("A", "B"), edge("B", "C"), edge("C", "D")],
        [
          { id: "subgraph:1", label: "One", parentId: null },
          { id: "subgraph:2", label: "Two", parentId: null },
        ],
      ),
    );

    const frames = Object.fromEntries(positioned.subgraphs.map((s) => [s.id, s]));
    const byId = Object.fromEntries(positioned.nodes.map((n) => [n.id, n]));

    // What compound layout is *for*. Without it a flat layout is free to
    // interleave the two groups' nodes, and two frames drawn afterwards
    // would overlap — each enclosing a node that is not its own.
    expect(overlaps(frames["subgraph:1"], frames["subgraph:2"])).toBe(false);
    expect(contains(frames["subgraph:1"], byId.C)).toBe(false);
    expect(contains(frames["subgraph:2"], byId.A)).toBe(false);

    // The edge crossing the boundary is routed between the two boxes it
    // joins rather than left at the origin: it starts at `B`, inside the
    // first frame, and ends at `C`, inside the second.
    const crossing = positioned.edges.find((e) => e.id === "B-C")!;
    const first = crossing.points[0];
    const last = crossing.points[crossing.points.length - 1];
    expect(crossing.points.length).toBeGreaterThan(1);
    expect(first.y).toBeGreaterThanOrEqual(byId.B.y);
    expect(last.y).toBeLessThanOrEqual(byId.C.y + byId.C.height);
    expect(last.y).toBeGreaterThan(first.y);
  });

  it("keeps every frame on the canvas and inside the reported bounds", () => {
    // A frame is grown *outward* from the boxes it holds — up for its title
    // strip, out for its padding — so it can reach above and left of the
    // corner the shared core laid the graph out from. Left alone that draws
    // at a negative coordinate, which is off the canvas: the class diagram
    // translates for the same reason, and the bounds have to grow with it or
    // the `<svg>` clips its own frame.
    const positioned = laidOut(
      model(
        [node("A", "subgraph:1"), node("B", "subgraph:1")],
        [edge("A", "B")],
        [{ id: "subgraph:1", label: "A very long group title indeed", parentId: null }],
      ),
    );

    for (const frame of positioned.subgraphs) {
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(positioned.width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(positioned.height);
    }
    for (const box of positioned.nodes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
    }
  });
});
