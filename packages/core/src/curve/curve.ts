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
 * The curve every connector is drawn with unless told otherwise — Mermaid's
 * default, `basis`, for all four directed-graph kinds.
 */
export const DEFAULT_CURVE: Curve = "basis";

/** Whether `name` is one of the curves Siren draws, spelled exactly — Mermaid's match is case-sensitive too. */
export function isCurve(name: string): name is Curve {
  return (CURVES as readonly string[]).includes(name);
}

/** Whether `name` is a curve Mermaid draws and Siren does not implement yet. */
export function isMermaidOnlyCurve(name: string): boolean {
  return (MERMAID_ONLY_CURVES as readonly string[]).includes(name);
}
