/**
 * The **Curve** names in `CONTEXT.md`: which ways of joining a connector's
 * routed points Siren draws, and which Mermaid draws that Siren does not.
 *
 * A neutral module, shared the way `label/label.ts` is: the parser and the
 * model read these names to judge what an author wrote, the contracts carry
 * a `Curve` on an edge, and the renderer (`renderer/connectorCurve.ts`)
 * draws one — so none of the first three has to depend on the renderer.
 */

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
 * The curve a class, state or ER connector is drawn with — Mermaid's `basis`,
 * which is what those three kinds are drawn with while they are still laid out
 * by dagre. Each moves to `rounded` in its own ticket of the elk-migration
 * board, when it moves onto ELK, and this constant goes with the last of them.
 */
export const DEFAULT_CURVE: Curve = "basis";

/**
 * The curve a flowchart edge is drawn with unless a `linkStyle … interpolate`
 * says otherwise: `rounded`, the orthogonal route's corners cut back and
 * rounded with a radius of 5.
 *
 * Mermaid 12's own, now that its default layout is ELK: mermaid 12.2.0's
 * `applyElkEdgeLayout` (`elk-V4PLJRSU.mjs`) sets `curve = "rounded"` on every
 * edge ELK routed, and draws it with `generateRoundedPath(points, 5)`
 * (`chunk-RLXJHMIZ.mjs`). Where Siren departs is the `interpolate` an author
 * wrote: Mermaid 12 ignores it under ELK, Siren still honours it and applies
 * that curve to ELK's points (the migration's Domain decision 6).
 */
export const FLOWCHART_DEFAULT_CURVE: Curve = "rounded";

/** Whether `name` is one of the curves Siren draws, spelled exactly — Mermaid's match is case-sensitive too. */
export function isCurve(name: string): name is Curve {
  return (CURVES as readonly string[]).includes(name);
}

/** Whether `name` is a curve Mermaid draws and Siren does not implement yet. */
export function isMermaidOnlyCurve(name: string): boolean {
  return (MERMAID_ONLY_CURVES as readonly string[]).includes(name);
}
