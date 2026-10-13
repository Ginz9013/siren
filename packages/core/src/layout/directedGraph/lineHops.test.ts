import { describe, expect, it } from "vitest";
import { lineHops } from "./lineHops";

// Expected values are worked by hand from the rule (nook decision
// 01M4VANRC6B2C14NHVC2KRZ9Y8, rule 7) and Mermaid 12.2.0's `lineJump.ts`
// (`findEdgeIntersections`, `rewriteEdgePath`), which the rule restates: a
// hop of radius 6 centred on the crossing, on the segment of the route that
// carries it, the segment counted from the route's first point.

/** A route through `points`, given as `[x, y]` pairs. */
const route = (...points: [number, number][]) => ({ points: points.map(([x, y]) => ({ x, y })) });

describe("lineHops", () => {
  it("puts a hop of radius 6 on the horizontal route where a vertical one crosses it", () => {
    // A runs left to right along y = 50; B runs down x = 100 across it.
    const hops = lineHops([route([0, 50], [200, 50]), route([100, 0], [100, 100])]);
    expect(hops).toEqual([[{ x: 100, y: 50, radius: 6, segment: 0 }], []]);
  });

  it("puts the hop on the horizontal route whichever of the two comes first", () => {
    const hops = lineHops([route([100, 0], [100, 100]), route([200, 50], [0, 50])]);
    expect(hops).toEqual([[], [{ x: 100, y: 50, radius: 6, segment: 0 }]]);
  });

  it("puts no hop where one route ends on another (a T) or two routes share an end", () => {
    // B starts on A's line, at (100, 50): the two meet there, they do not cross.
    expect(lineHops([route([0, 50], [200, 50]), route([100, 50], [100, 100])])).toEqual([[], []]);
    // Two routes into the same point of the same box.
    expect(lineHops([route([0, 50], [200, 50]), route([200, 0], [200, 50])])).toEqual([[], []]);
  });

  it("puts no hop where a route ends a sub-pixel distance past another's line (a T with float drift)", () => {
    // B ends 0.01 past A's line at y = 50, its coordinates having
    // drifted in floating point: drawn, the two still only meet.
    expect(lineHops([route([0, 50], [200, 50]), route([100, 0], [100, 50.01])])).toEqual([[], []]);
    // The same drift at B's start.
    expect(lineHops([route([0, 50], [200, 50]), route([100, 49.99], [100, 100])])).toEqual([[], []]);
  });

  it("puts no hop where two routes run along each other, one a sub-pixel off parallel", () => {
    // B lies on A's line but for 0.0001 of float drift at either end, so the
    // two lines meet at (100, 50), halfway along both: drawn, they overlap.
    expect(lineHops([route([0, 50], [200, 50]), route([50, 49.9999], [150, 50.0001])])).toEqual([[], []]);
  });

  describe("inside a corner's rounding", () => {
    // A route drawn with rounded corners (`cornerRadius: 5`, the `rounded`
    // curve's) cuts each corner back by min(5 / sin(θ/2), half of either
    // segment): 5 / sin(45°) = 7.071 for a right angle.

    it("puts no hop where the crossing falls in the rounding of the carrying route's corner", () => {
      // A turns down at (200, 50); B crosses A's horizontal 5 short of that corner.
      const a = { ...route([0, 50], [200, 50], [200, 150]), cornerRadius: 5 };
      expect(lineHops([a, route([195, 0], [195, 100])])).toEqual([[], []]);
    });

    it("puts no hop where the crossing falls in the rounding of the crossed route's corner", () => {
      // B comes down x = 100 and turns right at (100, 55): it crosses A
      // 5 before its own corner, inside that corner's 7.071.
      const b = route([100, 0], [100, 55], [150, 55]);
      expect(lineHops([route([0, 50], [200, 50]), { ...b, cornerRadius: 5 }])).toEqual([[], []]);
      // Drawn with a sharp corner, B crosses A on a line, and A hops it.
      expect(lineHops([route([0, 50], [200, 50]), b])).toEqual([[{ x: 100, y: 50, radius: 6, segment: 0 }], []]);
    });
  });

  describe("near a corner or a route's end", () => {
    const vertical = (x: number) => route([x, 0], [x, 100]);

    it("shrinks the hop to 2 short of the corner's rounding", () => {
      // A's corner at (200, 50) is rounded back to x = 200 − 7.071 = 192.929.
      // A crossing at x = 185 has 7.929 to it: radius 7.929 − 2 = 5.929.
      const a = { ...route([0, 50], [200, 50], [200, 150]), cornerRadius: 5 };
      const [[hop]] = lineHops([a, vertical(185)]);
      expect(hop.x).toBe(185);
      expect(hop.radius).toBeCloseTo(5.929, 3);
    });

    it("drops a hop with less than 3.6 left", () => {
      // At x = 188: 4.929 − 2 = 2.929, under 6 × 0.6.
      const a = { ...route([0, 50], [200, 50], [200, 150]), cornerRadius: 5 };
      expect(lineHops([a, vertical(188)])).toEqual([[], []]);
    });

    it("keeps 2 clear of a sharp route's ends too", () => {
      // A straight A from x = 0 to 200: at x = 194 the end is 6 away, radius 4;
      // at x = 5 the start is 5 away, 3 left, dropped.
      expect(lineHops([route([0, 50], [200, 50]), vertical(194)])).toEqual([
        [{ x: 194, y: 50, radius: 4, segment: 0 }],
        [],
      ]);
      expect(lineHops([route([0, 50], [200, 50]), vertical(5)])).toEqual([[], []]);
    });
  });

  describe("side by side", () => {
    const vertical = (x: number) => route([x, 0], [x, 100]);

    it("shrinks two hops that would overlap to half the gap between them, in the order the route meets them", () => {
      // Crossings 8 apart: 6 + 6 > 8, so each takes 8 / 2 = 4. Listed out
      // of order on purpose: the hops come in the order A runs.
      expect(lineHops([route([0, 50], [200, 50]), vertical(108), vertical(100)])).toEqual([
        [
          { x: 100, y: 50, radius: 4, segment: 0 },
          { x: 108, y: 50, radius: 4, segment: 0 },
        ],
        [],
        [],
      ]);
    });

    it("drops both where half the gap is under 3.6", () => {
      // 6 apart: 3 each.
      expect(lineHops([route([0, 50], [200, 50]), vertical(100), vertical(106)])).toEqual([[], [], []]);
    });
  });

  it("puts the hop on the later route where neither crossing segment is horizontal", () => {
    // Two steep diagonals crossing at (10, 50), halfway along both.
    const down = route([0, 0], [20, 100]);
    const up = route([20, 0], [0, 100]);
    expect(lineHops([down, up])).toEqual([[], [{ x: 10, y: 50, radius: 6, segment: 0 }]]);
    expect(lineHops([up, down])).toEqual([[], [{ x: 10, y: 50, radius: 6, segment: 0 }]]);
  });
});
