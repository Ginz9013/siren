import { describe, expect, it } from "vitest";
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
      // Siren's own choice, not d3's: d3 closes a one-point line (`M6,12Z`)
      // and returns null for none; generateRoundedPath returns "" for both.
      // A bare move draws nothing either way, and keeps the point readable.
      const every = ["basis", "linear", "step", "stepBefore", "stepAfter", "rounded"] as const;
      expect(every.map((curve) => connectorPathData([{ x: 6, y: 12 }], curve))).toEqual(
        every.map(() => "M6,12"),
      );
      expect(every.map((curve) => connectorPathData([], curve))).toEqual(every.map(() => ""));
    });
  });
});
