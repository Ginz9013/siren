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

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Draws a connector's label — a flowchart edge's, a class relationship's, a
 * state transition's, an ER relationship's — as `drawPlaced` does, with one
 * more thing behind it: a `<rect class="siren-connector-label-background">`
 * over the box the label was measured in, centred on its anchor.
 *
 * Mermaid paints a translucent fill behind every edge label (measured,
 * 11.17.2: `.labelBkg` and `.edgeLabel` cover the label's box), so a line
 * that runs under the label does not strike its text out — and since T3
 * every connector label sits *on* its line, so without it every one would.
 *
 * The rect is the first of the backgrounds, so it sits under whatever the
 * label's runs paint (a `<mark>`'s rect) as well as under the text. It
 * carries no paint: the theme fills it with `--siren-edge-label-fill`, and
 * an author's text color is the text's alone. One class for all four kinds,
 * since it is the same thing in each; "connector" is the word the four
 * share.
 *
 * The rect wears no `data-siren-id`: where the label is a group with the
 * id, the rect inherits the timeline's classes from it, and where it is a
 * bare `<text>` (the flowchart) the renderer stamps the id on both.
 */
export function drawConnectorLabel(placed: PlacedLabel, className: string): DrawnLabel {
  const drawn = drawPlaced(placed, className);
  const { labelBox, anchor } = placed;
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("class", "siren-connector-label-background");
  rect.setAttribute("x", String(anchor.x - labelBox.width / 2));
  rect.setAttribute("y", String(anchor.y - labelBox.height / 2));
  rect.setAttribute("width", String(labelBox.width));
  rect.setAttribute("height", String(labelBox.height));
  return { text: drawn.text, backgrounds: [rect, ...drawn.backgrounds] };
}
