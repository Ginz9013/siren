import { isPlain, type Label, type LabelBox, type LabelRun } from "./label";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * How far a `sub`/`sup` run sits below / above the baseline, as a fraction
 * of the run's own font size — measured in headless Chrome rather than
 * recalled: in a 16px line, a 13.33px `<sub>` sits 4.19px below the
 * baseline and a `<sup>` 6.33px above it. (Chrome derives both from the
 * size around the run plus 1px, so the fraction drifts by a few hundredths
 * at other sizes; the 16px one is the picture the board measured at.)
 *
 * Drawn as `dy` rather than `baseline-shift`, which Firefox does not
 * support on SVG text: the shifted run moves the text position, and the run
 * after it moves it back, so a shift ends with its run — and with its row,
 * which is placed at an absolute `y`.
 */
const BASELINE_SHIFT: Readonly<Record<LabelRun["baseline"], number>> = {
  normal: 0,
  sub: 0.314,
  super: -0.475,
};

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
 * every conditional attribute in the renderers follows. Each is the SVG
 * attribute for the CSS Mermaid's picture shows: `font-weight`,
 * `font-style`, `text-decoration` (`underline`, `line-through`, or both),
 * `font-family="monospace"`, and a scaled size as `font-size` in `em`, so
 * it stays relative to whatever size the theme gives the `<text>`. A
 * `sub`/`sup` run is shifted with `dy` (see `BASELINE_SHIFT`), the one
 * relative position in a row.
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
    // How far below the row's baseline the text position is, in the
    // `<text>` element's font size; every row starts at its absolute `y`,
    // so at zero.
    let shift = 0;
    for (const run of runs) {
      const element = document.createElementNS(SVG_NS, "tspan");
      const scale = "scale" in run.fontSize ? run.fontSize.scale : 1;
      const target = BASELINE_SHIFT[run.baseline] * scale;
      // `em` in a `dy` is the run's own size, so the distance is divided by it.
      const dy = numeral((target - shift) / scale);
      if (dy !== "0") {
        element.setAttribute("dy", `${dy}em`);
      }
      shift = target;
      if (run.bold) {
        element.setAttribute("font-weight", "bold");
      }
      if (run.italic) {
        element.setAttribute("font-style", "italic");
      }
      const decoration = [
        run.underline ? "underline" : "",
        run.strikethrough ? "line-through" : "",
      ].filter((line) => line !== "");
      if (decoration.length > 0) {
        element.setAttribute("text-decoration", decoration.join(" "));
      }
      if (run.monospace) {
        element.setAttribute("font-family", "monospace");
      }
      if ("scale" in run.fontSize && run.fontSize.scale !== 1) {
        element.setAttribute("font-size", `${numeral(run.fontSize.scale)}em`);
      }
      element.textContent = run.text;
      row.appendChild(element);
    }
    text.appendChild(row);
  });
  return { text, backgrounds: [] };
}

/**
 * `value` rounded to four decimal places, for an attribute: a scale that
 * multiplied (`<small><big>` is 0.833 × 1.2) would otherwise be written
 * with a tail of floating-point digits, which no reader of the SVG wants and
 * no browser draws differently.
 */
function numeral(value: number): string {
  return String(Number(value.toFixed(4)));
}
