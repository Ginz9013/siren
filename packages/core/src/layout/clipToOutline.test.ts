import { describe, expect, it } from "vitest";
import { clipRouteToOutlines, outlineCrossing } from "./clipToOutline";

/** A diamond inscribed in the 100 x 60 box at 0,0. */
const diamond = [
  { x: 50, y: 0 },
  { x: 100, y: 30 },
  { x: 50, y: 60 },
  { x: 0, y: 30 },
];

/** An hourglass in the 30 x 30 box at 0,0: two triangles meeting at a pinch in the middle. */
const hourglass = [
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 0, y: 30 },
  { x: 30, y: 30 },
];

describe("outlineCrossing", () => {
  it("carries a line on past its end to the first side it meets", () => {
    // Down x = 25 onto the diamond's upper left side, y = 30 - 0.6 x 25.
    expect(outlineCrossing({ x: 25, y: -40 }, { x: 25, y: 0 }, diamond)).toEqual({ x: 25, y: 15 });
  });

  it("stops a line short where the outline reaches past its end", () => {
    expect(outlineCrossing({ x: 50, y: -40 }, { x: 50, y: 20 }, diamond)).toEqual({ x: 50, y: 0 });
  });

  it("meets nothing when the line misses the outline", () => {
    expect(outlineCrossing({ x: 120, y: -40 }, { x: 120, y: 0 }, diamond)).toBeNull();
  });

  it("meets nothing behind where the line starts", () => {
    expect(outlineCrossing({ x: 50, y: 80 }, { x: 50, y: 120 }, diamond)).toBeNull();
  });

  it("meets an hourglass from above on its top edge, not at its pinch", () => {
    expect(outlineCrossing({ x: 15, y: -40 }, { x: 15, y: 0 }, hourglass)).toEqual({ x: 15, y: 0 });
  });

  it("does not stop a line at the pinch where an hourglass crosses itself", () => {
    expect(outlineCrossing({ x: -40, y: 15 }, { x: 0, y: 15 }, hourglass)).toBeNull();
  });

  it("stops a line through an hourglass's side on its slanted edge", () => {
    // Level with y = 5, the upper triangle spans 5 to 25.
    expect(outlineCrossing({ x: -40, y: 5 }, { x: 0, y: 5 }, hourglass)).toEqual({ x: 5, y: 5 });
  });
});

describe("clipRouteToOutlines", () => {
  it("moves each end along its own run onto the outline it is given", () => {
    const route = [
      { x: 25, y: -40 },
      { x: 25, y: 0 },
    ];
    expect(clipRouteToOutlines(route, null, diamond)).toEqual([
      { x: 25, y: -40 },
      { x: 25, y: 15 },
    ]);
  });

  it("leaves an end with no outline, or whose run misses it, where it was", () => {
    const route = [
      { x: 120, y: -40 },
      { x: 120, y: -20 },
      { x: 120, y: 0 },
    ];
    expect(clipRouteToOutlines(route, diamond, diamond)).toEqual(route);
    expect(clipRouteToOutlines(route, null, null)).toEqual(route);
  });

  it("reads the run past a repeated end point", () => {
    const route = [
      { x: 25, y: -40 },
      { x: 25, y: 0 },
      { x: 25, y: 0 },
    ];
    expect(clipRouteToOutlines(route, null, diamond).at(-1)).toEqual({ x: 25, y: 15 });
  });

  it("leaves a two-point route alone when moving both ends would turn it back on itself", () => {
    // Each end's outline lies across the route nearer the other end.
    const box = (left: number, right: number) => [
      { x: left, y: -5 },
      { x: right, y: -5 },
      { x: right, y: 5 },
      { x: left, y: 5 },
    ];
    const route = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(clipRouteToOutlines(route, box(60, 70), box(30, 40))).toEqual(route);
  });
});
