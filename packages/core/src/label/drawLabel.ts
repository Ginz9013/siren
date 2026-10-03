import { isPlain, type Label, type LabelBox } from "./label";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * A drawn label: the `<text>`, and the elements its runs paint *behind* it,
 * which the caller inserts before the `<text>` (document order is paint
 * order). Neither is attached anywhere yet.
 */
export interface DrawnLabel {
  text: SVGTextElement;
  backgrounds: SVGElement[];
}

/**
 * Draws a measured label as one SVG `<text>`, centred on `anchor`, and
 * hands back the elements that have to be painted *behind* it.
 *
 * `anchor` is the centre of `box`, which is what every layout in this repo
 * already reports for a label — a node's centre, an edge label's reserved
 * slot, a subgraph's title strip. The `<text>` carries
 * `text-anchor: middle` and `dominant-baseline: middle`, so a row's `y` is
 * its vertical centre and its `x` the horizontal one.
 *
 * **Two shapes of DOM, and the plain one is unchanged.** A label of one row
 * holding one plain run — nearly every label anyone writes — is the
 * `<text>`'s own `textContent`, exactly the element every renderer drew
 * before labels had rows, so nothing reading `text.textContent` or styling
 * `text` has anything new to learn. Anything else is one
 * `<tspan class="siren-label-row">` per row, each at an absolute `x`/`y`,
 * holding one inner `<tspan>` per run — the structure Mermaid's own SVG
 * labels use (`htmlLabels: false`: one row tspan, one tspan per run), which
 * ADR-0015 keeps as the DOM reference while holding the *picture* to its
 * HTML labels.
 *
 * Absolute `y` on every row rather than Mermaid's chained `dy`: everything
 * else Siren draws is in absolute coordinates, and `box` already says where
 * each row's centre is, so nothing here re-derives a line height.
 *
 * A run's properties are written only when they are not neutral — no
 * `font-weight="normal"` on a plain run — the omit-the-default convention
 * every conditional attribute in the renderers follows.
 *
 * Author text reaches the DOM through `textContent` only, never `innerHTML`:
 * the tags were read into runs by `readLabel`, and nothing here parses
 * markup.
 *
 * `backgrounds` are what a run's background paint needs drawn under the
 * text — none yet, because no tag the reader honors sets one. The caller
 * inserts them before the `<text>`, since document order is paint order.
 *
 * Builds elements and attaches none of them; where they go is the caller's.
 */
export function drawLabel(
  label: Label,
  box: LabelBox,
  anchor: { x: number; y: number },
): DrawnLabel {
  const text = document.createElementNS(SVG_NS, "text") as SVGTextElement;
  text.setAttribute("x", String(anchor.x));
  text.setAttribute("y", String(anchor.y));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");

  const soleRun = label.rows.length === 1 && label.rows[0]!.length === 1 ? label.rows[0]![0]! : null;
  if (soleRun !== null && isPlain(soleRun)) {
    text.textContent = soleRun.text;
    return { text, backgrounds: [] };
  }

  const top = anchor.y - box.height / 2;
  label.rows.forEach((runs, index) => {
    const row = document.createElementNS(SVG_NS, "tspan");
    row.setAttribute("class", "siren-label-row");
    row.setAttribute("x", String(anchor.x));
    row.setAttribute("y", String(top + box.rows[index]!.y));
    for (const run of runs) {
      const element = document.createElementNS(SVG_NS, "tspan");
      if (run.bold) {
        element.setAttribute("font-weight", "bold");
      }
      if (run.italic) {
        element.setAttribute("font-style", "italic");
      }
      element.textContent = run.text;
      row.appendChild(element);
    }
    text.appendChild(row);
  });
  return { text, backgrounds: [] };
}
