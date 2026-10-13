/**
 * The **Curve** names in `CONTEXT.md`: which ways of joining a connector's
 * routed points Siren draws, and which Mermaid draws that Siren does not.
 *
 * A neutral module, shared the way `label/label.ts` is: the parser and the
 * model read these names to judge what an author wrote, the contracts carry
 * a `Curve` on an edge, and the renderer (`renderer/connectorCurve.ts`)
 * draws one — so none of the first three has to depend on the renderer.
 * What a curve does to a route's corners and crossings is decided here too,
 * once, for the layout adapter and the renderer alike (`curveCornerRadius`,
 * `curveDrawsHops`).
 */
import { ROUNDED_CORNER_RADIUS } from "./roundedCorner";

/**
 * Every curve a connector can be drawn with, by its Mermaid name. Exported
 * as a value so a name an author wrote can be told apart from any other.
 */
export const CURVES = ["basis", "linear", "step", "stepBefore", "stepAfter", "rounded"] as const;

/** How a connector's routed points are joined into the drawn line. */
export type Curve = (typeof CURVES)[number];

/**
 * The curves Mermaid 11.17.2 draws that Siren does not implement yet — the
 * rest of the `switch` in mermaid's `insertEdge`, beside `CURVES`. Kept next
 * to `CURVES` so the two lists stay disjoint: a name moves from this one to
 * that one when Siren learns to draw it.
 */
export const MERMAID_ONLY_CURVES = [
  "cardinal",
  "bumpX",
  "bumpY",
  "catmullRom",
  "monotoneX",
  "monotoneY",
  "natural",
] as const;

/**
 * The curve every connector the shared ELK layout core routes is drawn with:
 * `rounded`, the orthogonal route's corners cut back and rounded with a
 * radius of 5. One constant for every kind, because it is one decision —
 * Mermaid 12.2.0's: its `applyElkEdgeLayout` (`elk-V4PLJRSU.mjs`, line
 * 100401) sets `curve = "rounded"` on every edge ELK routed, whatever the
 * kind, and draws it with `generateRoundedPath(points, 5)`
 * (`chunk-RLXJHMIZ.mjs`). That overrides the `basis` an ER diagram's
 * `ErDB.getData` asks for, and covers class relations, note links and
 * state transitions alike (nook decision `01M4VANRC6B2C14NHVC2KRZ9Y8`,
 * rule 6).
 *
 * The class, state and ER diagrams have no `linkStyle … interpolate` to
 * choose another, so their connectors are always drawn with it; a flowchart
 * edge is drawn with it unless its author chose another
 * (`FLOWCHART_DEFAULT_CURVE`). Each layout adapter hands the core its radius
 * (`CONNECTOR_CORNER_RADIUS`) and each renderer draws with it, so the radius
 * the line hops keep clear of and the corners drawn are one decision.
 */
export const CONNECTOR_CURVE: Curve = "rounded";

/**
 * The curve a flowchart edge is drawn with unless a `linkStyle … interpolate`
 * says otherwise: `CONNECTOR_CURVE`. Where Siren departs from Mermaid is the
 * `interpolate` an author wrote: Mermaid 12 ignores it under ELK, Siren still
 * honours it and applies that curve to ELK's points (nook decision
 * `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 6).
 */
export const FLOWCHART_DEFAULT_CURVE: Curve = CONNECTOR_CURVE;

/**
 * The radius `curve` draws a route's corners rounded with — `rounded`'s
 * `ROUNDED_CORNER_RADIUS` — or `undefined` for a curve that draws them sharp
 * (`linear`, the `step` curves) or does not run through them (`basis`).
 */
export function curveCornerRadius(curve: Curve): number | undefined {
  return curve === "rounded" ? ROUNDED_CORNER_RADIUS : undefined;
}

/**
 * The core's `cornerRadius` for a connector drawn with `CONNECTOR_CURVE` —
 * every class relationship and note link, state transition and note link,
 * and ER relationship: the radius that curve rounds its corners with.
 */
export const CONNECTOR_CORNER_RADIUS: number | undefined = curveCornerRadius(CONNECTOR_CURVE);

/**
 * Whether `curve` draws the **line hops** the layout reports: mermaid
 * 12.2.0's `curveSupportsLineHops` (`chunk-UETRLHRR.mjs`, line 295) —
 * `linear`, `rounded` and the three `step` curves. `basis` does not: a soft
 * curve has no straight run at a crossing to jump from.
 */
export function curveDrawsHops(curve: Curve): boolean {
  return curve === "linear" || curve === "rounded" || curve === "step" || curve === "stepBefore" || curve === "stepAfter";
}

/** Whether `name` is one of the curves Siren draws, spelled exactly — Mermaid's match is case-sensitive too. */
export function isCurve(name: string): name is Curve {
  return (CURVES as readonly string[]).includes(name);
}

/** Whether `name` is a curve Mermaid draws and Siren does not implement yet. */
export function isMermaidOnlyCurve(name: string): boolean {
  return (MERMAID_ONLY_CURVES as readonly string[]).includes(name);
}
