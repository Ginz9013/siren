import { describe, expect, it } from "vitest";
import { CURVES } from "../curve/curve";
import { connectorPathData } from "./connectorCurve";

// Expected values are worked by hand from the two definitions the curves
// copy, never read back from this module:
//
// - d3-shape 3.2.0, `src/curve/basis.js`, `linear.js` and `step.js` — the
//   curves mermaid 11.17.2 hands to `line().curve(...)` in `insertEdge`
//   (`dist/chunks/mermaid.core/chunk-OSK3NFVY.mjs`).
// - mermaid 11.17.2, `generateRoundedPath(points, 5)` in the same chunk —
//   what `rounded` draws instead of a d3 curve.
//
// Points are chosen as multiples of 6 so every `/3` and `/6` the B-spline
// takes is exact, and the strings can be compared whole.

describe("connectorPathData", () => {
  describe("basis", () => {
    it("draws d3's curveBasis through three points, starting and ending on the route's ends", () => {
      // d3 curveBasis, point by point:
      //   p0 (0,0)   → moveTo(0,0)
      //   p1 (60,0)  → nothing drawn yet
      //   p2 (60,60) → lineTo((5·p0 + p1)/6) = (10,0), then
      //                bezierCurveTo((2·p0 + p1)/3, (p0 + 2·p1)/3, (p0 + 4·p1 + p2)/6)
      //                = (20,0) (40,0) (50,10)
      //   lineEnd    → bezierCurveTo((2·p1 + p2)/3, (p1 + 2·p2)/3, (p1 + 4·p2 + p2)/6)
      //                = (60,20) (60,40) (60,50), then lineTo(p2) = (60,60)
      expect(
        connectorPathData(
          [
            { x: 0, y: 0 },
            { x: 60, y: 0 },
            { x: 60, y: 60 },
          ],
          "basis",
        ),
      ).toBe("M0,0 L10,0 C20,0 40,0 50,10 C60,20 60,40 60,50 L60,60");
    });

    it("draws one more cubic per further point, as d3's curveBasis does", () => {
      // As above to (50,10); then p3 (120,60) adds
      //   bezierCurveTo((2·p1 + p2)/3, (p1 + 2·p2)/3, (p1 + 4·p2 + p3)/6)
      //   = (60,20) (60,40) (70,50)
      // and lineEnd closes on p2 → p3:
      //   bezierCurveTo((2·p2 + p3)/3, (p2 + 2·p3)/3, (p2 + 4·p3 + p3)/6)
      //   = (80,60) (100,60) (110,60), then lineTo(120,60).
      expect(
        connectorPathData(
          [
            { x: 0, y: 0 },
            { x: 60, y: 0 },
            { x: 60, y: 60 },
            { x: 120, y: 60 },
          ],
          "basis",
        ),
      ).toBe("M0,0 L10,0 C20,0 40,0 50,10 C60,20 60,40 70,50 C80,60 100,60 110,60 L120,60");
    });
  });

  describe("linear", () => {
    it("joins the points with straight segments, the polyline the renderers drew before curves", () => {
      // d3 curveLinear: moveTo the first point, lineTo every later one.
      expect(
        connectorPathData(
          [
            { x: 0, y: 0 },
            { x: 60, y: 0 },
            { x: 60, y: 60 },
            { x: 120, y: 60 },
          ],
          "linear",
        ),
      ).toBe("M0,0 L60,0 L60,60 L120,60");
    });
  });

  describe("step, stepBefore, stepAfter", () => {
    // d3 `step.js`: each point after the first draws two segments, a
    // horizontal one and then a vertical one, turning at
    // x = prev.x · (1 − t) + x · t — t = 0.5 for `step`, 1 for `stepAfter`;
    // `stepBefore` (t = 0) goes vertical first, to (prev.x, y). `step` alone
    // finishes with lineTo(last point). d3 writes the zero-length segments
    // it produces at an aligned point too, and so does the port.
    const route = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 60 },
      { x: 120, y: 60 },
    ];

    it("draws d3's curveStep, turning halfway between each pair of points", () => {
      // (60,0):  x1 = 30 → L30,0 L30,0
      // (60,60): x1 = 60 → L60,0 L60,60
      // (120,60): x1 = 90 → L90,60 L90,60;  lineEnd → L120,60
      expect(connectorPathData(route, "step")).toBe(
        "M0,0 L30,0 L30,0 L60,0 L60,60 L90,60 L90,60 L120,60",
      );
    });

    it("draws d3's curveStepBefore, going vertical before horizontal", () => {
      // (60,0): L0,0 L60,0;  (60,60): L60,60 L60,60;  (120,60): L60,60 L120,60
      expect(connectorPathData(route, "stepBefore")).toBe(
        "M0,0 L0,0 L60,0 L60,60 L60,60 L60,60 L120,60",
      );
    });

    it("draws d3's curveStepAfter, going horizontal before vertical", () => {
      // (60,0): L60,0 L60,0;  (60,60): L60,0 L60,60;  (120,60): L120,60 L120,60
      expect(connectorPathData(route, "stepAfter")).toBe(
        "M0,0 L60,0 L60,0 L60,0 L60,60 L120,60 L120,60",
      );
    });

    it("draws a staircase even between two points, as d3 and so mermaid do", () => {
      // Two points that are not aligned are not a straight line under a step
      // curve: d3 draws (0,0) → (60,30) as a stair, and mermaid 11.17.2 draws
      // what d3 draws.
      const two = [
        { x: 0, y: 0 },
        { x: 60, y: 30 },
      ];
      expect({
        step: connectorPathData(two, "step"),
        stepBefore: connectorPathData(two, "stepBefore"),
        stepAfter: connectorPathData(two, "stepAfter"),
      }).toEqual({
        step: "M0,0 L30,0 L30,30 L60,30",
        stepBefore: "M0,0 L0,30 L60,30",
        stepAfter: "M0,0 L60,0 L60,30",
      });
    });
  });

  describe("rounded", () => {
    // mermaid 11.17.2 `generateRoundedPath(points, 5)`: at each interior
    // vertex, cut back cutLen = min(5 / sin(θ/2), before/2, after/2) along
    // both segments — θ the turn between them — and join the two cut points
    // with a quadratic whose control point is the vertex. Expected strings
    // are that function's own output, run on these points, with a space
    // between commands.

    it("cuts a right angle back by 5 / sin(45°) and rounds it with a quadratic", () => {
      expect(
        connectorPathData(
          [
            { x: 0, y: 0 },
            { x: 60, y: 0 },
            { x: 60, y: 60 },
          ],
          "rounded",
        ),
      ).toBe("M0,0 L52.928932188134524,0 Q60,0 60,7.0710678118654755 L60,60");
    });

    it("cuts no further than half of either segment", () => {
      // 5 / sin(45°) ≈ 7.07 is longer than half of an 8-long leg, so the cut
      // is 4.
      expect(
        connectorPathData(
          [
            { x: 0, y: 0 },
            { x: 8, y: 0 },
            { x: 8, y: 8 },
          ],
          "rounded",
        ),
      ).toBe("M0,0 L4,0 Q8,0 8,4 L8,8");
    });

    it("leaves a vertex that does not turn as a plain corner", () => {
      // θ = 0 (straight on) and θ = π (doubling back) are both left uncut.
      expect({
        collinear: connectorPathData(
          [
            { x: 0, y: 0 },
            { x: 30, y: 0 },
            { x: 60, y: 0 },
          ],
          "rounded",
        ),
        reversal: connectorPathData(
          [
            { x: 0, y: 0 },
            { x: 30, y: 0 },
            { x: 10, y: 0 },
          ],
          "rounded",
        ),
      }).toEqual({
        collinear: "M0,0 L30,0 L60,0",
        reversal: "M0,0 L30,0 L10,0",
      });
    });
  });

  describe("short routes", () => {
    const smooth = ["basis", "linear", "rounded"] as const;

    it("draws two points as one straight segment under basis, linear and rounded", () => {
      // d3 curveBasis with two points: moveTo, then lineEnd's `case 2:
      // lineTo`. generateRoundedPath has no interior vertex to cut. (The step
      // curves are the exception — see the staircase test above.)
      const two = [
        { x: 0, y: 0 },
        { x: 60, y: 30 },
      ];
      expect(smooth.map((curve) => connectorPathData(two, curve))).toEqual(
        smooth.map(() => "M0,0 L60,30"),
      );
    });

    it("draws a single point as a bare move and no points as an empty path, under every curve", () => {
      // Deliberately neither d3's nor mermaid's output. d3 3.2.0 closes a
      // one-point line (`line()([[6,12]])` is `M6,12Z`) and returns null for
      // none; mermaid 11.17.2's generateRoundedPath returns "" for both. All
      // three draw nothing, so the choice is about what is left to read:
      // `M6,12` still says where the connector is, is the same under every
      // curve, and needs no `Z` that would mean "closed" on an open line.
      // No points have nowhere to be, so "" — d3's null as a string.
      expect(CURVES.map((curve) => connectorPathData([{ x: 6, y: 12 }], curve))).toEqual(
        CURVES.map(() => "M6,12"),
      );
      expect(CURVES.map((curve) => connectorPathData([], curve))).toEqual(CURVES.map(() => ""));
    });
  });
});

describe("connectorPathData with line hops", () => {
  // The arc Mermaid 12.2.0 draws (`lineJump.ts`'s `emitJump`): a line to
  // `radius` before the crossing, then `A r,r 0 0 sweep` to `radius` past it
  // — a half circle centred on the crossing. Expected strings are measured
  // off Mermaid 12.2.0's own pictures where one is quoted, and otherwise
  // worked from that definition.

  it("draws a half circle across the crossing on a linear route", () => {
    // Measured in Mermaid 12.2.0: a hop at (104.5, 137) on a rightward run
    // is drawn `L98.5,137 A6,6 0 0 1 110.5,137`.
    expect(
      connectorPathData(
        [
          { x: 0, y: 137 },
          { x: 200, y: 137 },
        ],
        "linear",
        [{ x: 104.5, y: 137, radius: 6, segment: 0 }],
      ),
    ).toBe("M0,137 L98.5,137 A6,6 0 0 1 110.5,137 L200,137");
  });

  it("bulges up travelling left too: sweep 0 where the route runs toward −x", () => {
    // Measured in Mermaid 12.2.0: a hop at (280, 117) on a leftward run is
    // drawn `L286,117 A6,6 0 0 0 274,117` — from the right, counter-clockwise,
    // over the top.
    expect(
      connectorPathData(
        [
          { x: 400, y: 117 },
          { x: 100, y: 117 },
        ],
        "linear",
        [{ x: 280, y: 117, radius: 6, segment: 0 }],
      ),
    ).toBe("M400,117 L286,117 A6,6 0 0 0 274,117 L100,117");
  });

  it("takes the sweep from the travel on a vertical run too: 1 going down, 0 going up", () => {
    // Mermaid's `getArcSweepFlag`: on a segment that is not horizontal, the
    // sign of its dy decides, as dx's does on one that is.
    const down = connectorPathData(
      [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
      "linear",
      [{ x: 50, y: 40, radius: 6, segment: 0 }],
    );
    expect(down).toBe("M50,0 L50,34 A6,6 0 0 1 50,46 L50,100");
    const up = connectorPathData(
      [
        { x: 50, y: 100 },
        { x: 50, y: 0 },
      ],
      "linear",
      [{ x: 50, y: 40, radius: 6, segment: 0 }],
    );
    expect(up).toBe("M50,100 L50,46 A6,6 0 0 0 50,34 L50,0");
  });

  it("draws the hop on its own segment of a rounded route, between that segment's corners", () => {
    // Every segment beside a corner is 10 long, so each corner is cut back
    // by half of it, 5 (under 5 / sin 45° = 7.071): `L` to 5 short of the
    // corner, `Q` through it to 5 past. The hop sits on the middle run.
    expect(
      connectorPathData(
        [
          { x: 0, y: 0 },
          { x: 0, y: 10 },
          { x: 200, y: 10 },
          { x: 200, y: 20 },
        ],
        "rounded",
        [{ x: 100, y: 10, radius: 6, segment: 1 }],
      ),
    ).toBe("M0,0 L0,5 Q0,10 5,10 L94,10 A6,6 0 0 1 106,10 L195,10 Q200,10 200,15 L200,20");
  });

  describe("which curves draw them", () => {
    const run = [
      { x: 0, y: 137 },
      { x: 60, y: 137 },
      { x: 200, y: 137 },
    ];
    const hop = [{ x: 104.5, y: 137, radius: 6, segment: 1 }];

    it.each(["step", "stepBefore", "stepAfter"] as const)(
      "%s draws them, on the route's own straight runs, as Mermaid's rewrite does",
      (curve) => {
        // Mermaid 12.2.0's `rewriteEdgePath` redraws a hopped `step*` line
        // through the route's points: on an orthogonal route the line it
        // draws is the one the step curve draws.
        expect(connectorPathData(run, curve, hop)).toBe("M0,137 L60,137 L98.5,137 A6,6 0 0 1 110.5,137 L200,137");
      },
    );

    it("basis does not: a soft curve has no straight run to jump from, and Mermaid skips it", () => {
      expect(connectorPathData(run, "basis", hop)).toBe(connectorPathData(run, "basis"));
      expect(connectorPathData(run, "basis", hop)).not.toContain("A");
    });
  });
});
