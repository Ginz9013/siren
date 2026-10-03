import { isPlain, relativeScale, type Label, type LabelBox, type LabelRun } from "./label";

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
 * which go before the `<text>` (document order is paint order —
 * `appendLabel` attaches both in that order). Neither is attached anywhere
 * yet.
 */
export interface DrawnLabel {
  text: SVGTextElement;
  backgrounds: SVGElement[];
}

/**
 * Appends a drawn label to `parent`: what its runs paint behind the text
 * first, then the `<text>` itself, since document order is paint order. The
 * one place that order is written, for every renderer and every label.
 */
export function appendLabel(parent: Element, drawn: DrawnLabel): void {
  for (const background of drawn.backgrounds) {
    parent.appendChild(background);
  }
  parent.appendChild(drawn.text);
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
 * relative position in a row. A marked run's text color is the theme's, not
 * an attribute: it carries `class="siren-label-mark-text"`, which
 * `default.css` paints with `--siren-label-mark-text`.
 *
 * Author text reaches the DOM through `textContent` only, never `innerHTML`:
 * the tags were read into runs by `readLabel`, and nothing here parses
 * markup.
 *
 * `backgrounds` are what a run's background paint needs drawn under the
 * text: one `<rect>` per run that has one, as wide as `box` measured the
 * run and as tall as the run's *own* line — one measured line times its
 * scale, not its row — centred on the row's centre and moved with a
 * `sub`/`sup` shift. That is CSS's rule, not a measurement: an inline
 * element paints its background over its own inline box, which follows the
 * element's font size and vertical-align, not over the line box around it.
 * The shift is taken as a fraction of the run's line rather than of its
 * font size, which `drawLabel` does not know (the theme sets it), so a
 * shifted rect moves further than its glyphs by the ratio of the two. A
 * marked run's is
 * `<rect class="siren-label-mark">`, filled by the theme with
 * `--siren-label-mark-fill`. Its width is the measurer's, so it can miss the
 * glyphs a browser actually draws by a few pixels — the same approximation
 * every label box already makes. The caller inserts them before the
 * `<text>`, since document order is paint order.
 *
 * `className`, when given, is the `<text>`'s `class` — the name each
 * renderer gives the construct's label (`siren-note-text`,
 * `siren-edge-label`, …) for the theme to reach it by.
 *
 * Builds elements and attaches none of them; where they go is the caller's.
 */
export function drawLabel(
  label: Label,
  box: LabelBox,
  anchor: { x: number; y: number },
  className?: string,
): DrawnLabel {
  const text = document.createElementNS(SVG_NS, "text") as SVGTextElement;
  text.setAttribute("x", String(anchor.x));
  text.setAttribute("y", String(anchor.y));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  if (className !== undefined) {
    text.setAttribute("class", className);
  }

  const soleRun = label.rows.length === 1 && label.rows[0]!.length === 1 ? label.rows[0]![0]! : null;
  if (soleRun !== null && isPlain(soleRun)) {
    text.textContent = soleRun.text;
    return { text, backgrounds: [] };
  }

  const backgrounds: SVGElement[] = [];
  const top = anchor.y - box.height / 2;
  label.rows.forEach((runs, index) => {
    const measured = box.rows[index]!;
    const row = document.createElementNS(SVG_NS, "tspan");
    row.setAttribute("class", "siren-label-row");
    row.setAttribute("x", String(anchor.x));
    row.setAttribute("y", String(top + measured.y));
    // Where the row's measured band starts: it is drawn centred, so its left
    // edge is half its own width left of the anchor, and every run's `x` in
    // the box counts from there.
    const left = anchor.x - measured.width / 2;
    const centre = top + measured.y;
    // One line at the base size: a row is as tall as its tallest run, and
    // every run is one measured line times its scale (`layoutLabel`).
    const line = measured.height / Math.max(...runs.map((run) => relativeScale(run) ?? 1));
    // How far below the row's baseline the text position is, in the
    // `<text>` element's font size; every row starts at its absolute `y`,
    // so at zero.
    let shift = 0;
    runs.forEach((run, runIndex) => {
      const scale = relativeScale(run) ?? 1;
      if (run.mark) {
        const place = measured.runs[runIndex]!;
        const height = line * scale;
        // The run's own line, shifted as its text is — by the same fraction,
        // of the line rather than of a font size nothing here knows.
        const y = centre + BASELINE_SHIFT[run.baseline] * height - height / 2;
        const rect = backgroundRect({ x: left + place.x, width: place.width, y, height });
        rect.setAttribute("class", "siren-label-mark");
        backgrounds.push(rect);
      }
      const element = document.createElementNS(SVG_NS, "tspan");
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
      if (scale !== 1) {
        element.setAttribute("font-size", `${numeral(scale)}em`);
      }
      if (run.mark) {
        element.setAttribute("class", "siren-label-mark-text");
      }
      element.textContent = run.text;
      row.appendChild(element);
    });
    text.appendChild(row);
  });
  return { text, backgrounds };
}

/**
 * A `<rect>` at `place`, unpainted: what fills it, a theme class or an
 * author's color, is the caller's.
 */
function backgroundRect(place: { x: number; y: number; width: number; height: number }): SVGElement {
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", String(place.x));
  rect.setAttribute("y", String(place.y));
  rect.setAttribute("width", String(place.width));
  rect.setAttribute("height", String(place.height));
  return rect;
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
