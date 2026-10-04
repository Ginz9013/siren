import { drawLabel, type DrawnLabel } from "./drawLabel";
import type { PlacedLabel } from "./label";

/**
 * Draws a label a layout placed — its label, box and anchor in one — with
 * `drawLabel`, giving the `<text>` `className` when there is one. The form
 * every renderer holding a `PlacedLabel` draws it in; `drawLabel` stays for
 * a caller that puts the anchor itself.
 *
 * A module of its own, like `readLabelAt`, rather than an export of
 * `drawLabel.ts`: it reaches `drawLabel` through that module's export, so a
 * test that mocks `../label/drawLabel` (as `renderToSVG.test.ts` does, to
 * hand a label a background) still sees every label drawn this way. A call
 * from inside `drawLabel.ts` would bypass the mock.
 */
export function drawPlaced(placed: PlacedLabel, className?: string): DrawnLabel {
  return drawLabel(placed.label, placed.labelBox, placed.anchor, className);
}
