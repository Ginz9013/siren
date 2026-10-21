import type { StyleProperty } from "../contracts";

/**
 * Writes `style` onto `element` as an inline `style` attribute, in
 * declaration order, or leaves the element without one when the list is
 * empty.
 *
 * One function for every renderer that draws author styling — flowchart,
 * class, state and ER — and, within each, for a node's frame, a node's
 * label and an edge's path, because the rule is the same for all of them:
 * land on the element the theme paints. Which half of the author's
 * declarations each one is handed is not decided here either —
 * `resolveStyles` split them, and this function is told, in the vocabulary
 * the element it writes to actually reads.
 *
 * Almost always the author's declarations and nothing else. A flowchart
 * frame whose shape names its own corners hands over that radius first and
 * the author's list after (a corner radius, from the shape table), and a
 * class member's text hands over its classifier's declaration after the
 * author's, which is why this takes a list rather than a `ResolvedStyle`:
 * the last writer of a property wins, and the right one has to be able to
 * be that writer.
 *
 * Where the author wrote the declarations — `style A`, `classDef`, `class`,
 * `:::`, `cssClass`, `linkStyle 0` — is not visible here, and must not be.
 *
 * Inline rather than a generated class rule, and on the drawn shape rather
 * than its enclosing `<g>` — both for the same cascade reason, recorded in
 * ADR-0008. The theme styles the drawn elements directly
 * (`.siren-node-frame`, `.siren-class-frame`, `.siren-state-frame`,
 * `.siren-state-label`, `.siren-er-entity-frame`, `.siren-er-entity-label`,
 * `.siren-er-attribute`, …), so an inline declaration on the frame outranks
 * the theme's rule without needing `!important`, while the same declaration
 * on the `<g>` would only ever be *inherited* by the frame and so would lose
 * to the theme's own rule — and would leak down onto the node's `<text>`,
 * which the author did not ask to recolor.
 *
 * ⚠️ **No `!important`, and that is a deliberate departure from Mermaid's
 * own markup rather than an oversight.** Mermaid writes `fill:#f96
 * !important` because it applies author styles through a generated class
 * rule that has to beat its own theme; Siren writes the declaration on the
 * element the theme targets, where specificity already settles it — and a
 * `!important` here would also outrank a *consumer's* stylesheet, which is
 * the thing ADR-0008 exists to keep reachable.
 *
 * The `<g>` is left alone for a second reason too: it is where the animation
 * controller stamps `siren-pending` and `siren-enter-*`, and an attribute
 * this function wrote there would be one more thing those classes have to
 * share an element with.
 *
 * The values are written verbatim. The author's arrive here having already
 * passed `resolveStyles`' gate in the kind's model builder (no `url(`, no
 * `expression(`, no `;`, no backslash), and re-checking here would fork that
 * single source of truth; a flowchart shape's own are numbers
 * `renderToSVG` computed. This attribute is a CSS sink, never an HTML one:
 * nothing is parsed as markup, so the hard `textContent`-never-`innerHTML`
 * invariant is untouched.
 */
export function applyInlineStyle(element: SVGElement, style: readonly StyleProperty[]): void {
  if (style.length === 0) {
    return;
  }
  element.setAttribute(
    "style",
    style.map(({ property, value }) => `${property}:${value}`).join(";"),
  );
}
