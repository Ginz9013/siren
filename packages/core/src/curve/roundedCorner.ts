/**
 * How the `rounded` curve rounds a route's corners: the radius it draws them
 * with, and how far back along its two segments a corner is cut.
 *
 * A neutral module, beside `curve.ts`, because two sides read the same
 * numbers: the renderer (`renderer/connectorCurve.ts`) draws the corner, and
 * the layout core's line hops (`layout/directedGraph/lineHops.ts`) keep clear
 * of it. One definition here means the corner drawn and the corner kept
 * clear cannot drift apart, and neither side depends on the other.
 */
import type { Point } from "../contracts";

/**
 * The corner radius the `rounded` curve draws with: mermaid's
 * `generateRoundedPath(points, 5)` (mermaid 12.2.0, `chunk-RLXJHMIZ.mjs`,
 * line 911), and its `lineJump.ts`'s `ROUNDED_CORNER_RADIUS`
 * (`chunk-UETRLHRR.mjs`, line 9).
 */
export const ROUNDED_CORNER_RADIUS = 5;

/**
 * Below this, a length or an angle is taken as none: mermaid 12.2.0's
 * `CORNER_EPSILON` (`chunk-UETRLHRR.mjs`, line 10).
 */
const CORNER_EPSILON = 1e-5;

/**
 * How far back along both of its segments a corner at `at` is cut when it is
 * drawn rounded with `radius`: `min(radius / sin(θ/2), before / 2, after / 2)`
 * for a turn of θ — 7.071 for a right angle at radius 5. `null` where
 * nothing is cut: a segment of no length, or a vertex that does not turn
 * (θ = 0) or turns straight back (θ = π).
 *
 * Mermaid 12.2.0's `generateRoundedPath` (what the `rounded` curve draws,
 * `chunk-RLXJHMIZ.mjs`, line 988) and `lineJump.ts`'s `computeRoundedCorner`
 * (what its hops keep clear of, `chunk-UETRLHRR.mjs`, line 171) both cut by
 * this.
 */
export function cornerCut(previous: Point, at: Point, next: Point, radius: number): number | null {
  const before = Math.hypot(at.x - previous.x, at.y - previous.y);
  const after = Math.hypot(next.x - at.x, next.y - at.y);
  if (before < CORNER_EPSILON || after < CORNER_EPSILON) return null;
  const dot =
    ((at.x - previous.x) / before) * ((next.x - at.x) / after) + ((at.y - previous.y) / before) * ((next.y - at.y) / after);
  const turn = Math.acos(Math.max(-1, Math.min(1, dot)));
  if (turn < CORNER_EPSILON || Math.abs(Math.PI - turn) < CORNER_EPSILON) return null;
  return Math.min(radius / Math.sin(turn / 2), before / 2, after / 2);
}
