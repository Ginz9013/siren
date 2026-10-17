import type { NodeShape } from "../../contracts";
import { arcPoints, boxOutline, closedOutline, edgesOf, FRAME_PAINT, pathFrame, pointsOf, type Rect, type ShapeFrame, type ShapeSpec, type Size, type Vertex } from "./shape";

/**
 * Shape-table records for the shapes Mermaid 12.2.0 names only in a node's
 * `@{ shape: … }` block whose outline is curved: round ends, cylinders,
 * wavy-edged documents and curly braces.
 *
 * Each follows its Mermaid handler's formula (classic look), applied to the
 * padded label — the box a rectangle would draw — and the label goes where
 * that handler puts it. A round end or a brace's curl is an SVG arc; a wavy
 * edge is the sine wave Mermaid samples, 51 points. Proportions are
 * Mermaid's; the path is Siren's own (ADR-0004: a shape's kind is the
 * contract, not its exact outline).
 *
 * Each handler pads its text its own way, so each record starts from the
 * text: the padded label less the node padding on each side (`textOf`),
 * the padding a rectangle's box stands for.
 */

/** Mermaid's flowchart node padding: `p` when a record is told no padding of its own. */
const MERMAID_PADDING: Size = { width: 15, height: 15 };

/**
 * The text and the node padding `p` a record's formula starts from: the
 * padded label less `padding` on each side, and `padding` itself, across
 * and up. Laid out, `padding` is Siren's own (`layoutGraph`), so a shape
 * pads Siren's text as its handler pads Mermaid's and stands to a
 * rectangle as Mermaid's does.
 */
function textOf(label: Size, padding: Size = MERMAID_PADDING): { text: Size; px: number; py: number } {
  return {
    text: { width: Math.max(label.width - 2 * padding.width, 0), height: Math.max(label.height - 2 * padding.height, 0) },
    px: padding.width,
    py: padding.height,
  };
}

/**
 * How deep a round end of radius `radius` is at a label `height` tall
 * centred on it: Mermaid's `capClearance`, the room a label's corners need
 * to clear the arc.
 */
function capClearance(radius: number, height: number): number {
  return radius - Math.sqrt(Math.max(0, radius ** 2 - (height / 2) ** 2));
}

/**
 * The minor radius of the ellipse that ends a cylinder whose major radius
 * is `major`: Mermaid's `major / (2.5 + diameter / 50)`, so a bigger
 * cylinder's ends grow flatter.
 */
function ellipseRadius(major: number): number {
  return major / (2.5 + (2 * major) / 50);
}

/** An elliptical arc of radii `rx`, `ry` to `x,y`, swept clockwise (`1`) or not (`0`). */
function arc(rx: number, ry: number, sweep: 0 | 1, x: number, y: number): string {
  return `A${rx},${ry} 0 0 ${sweep} ${x},${y}`;
}

/**
 * Mermaid's `generateFullSineWavePoints`: `cycles` cycles of a sine wave of
 * `amplitude` about the middle of `from` and `to`, sampled at 51 evenly
 * spaced points from `from`'s x to `to`'s. A negative `cycles` or
 * `amplitude` flips the wave.
 */
function sineWave(from: Vertex, to: Vertex, amplitude: number, cycles: number): Vertex[] {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const middle = y1 + (y2 - y1) / 2;
  const frequency = (2 * Math.PI * cycles) / (x2 - x1);
  return Array.from({ length: 51 }, (_, i) => {
    const x = x1 + (i / 50) * (x2 - x1);
    return [x, middle + amplitude * Math.sin(frequency * (x - x1))] as const;
  });
}

/** A sampled coordinate to the hundredth: a wave's 51 points need no more. */
function hundredths(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A vertex to the hundredth, as `polyline` writes it. */
function toHundredths([x, y]: Vertex): Vertex {
  return [hundredths(x), hundredths(y)];
}

/** `points` as an open polyline, `M x,y L x,y …`, to the hundredth. */
function polyline(points: readonly Vertex[]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${hundredths(x)},${hundredths(y)}`).join(" ");
}

/**
 * A document's outline in `box`: a straight top, and a bottom that is a
 * sine wave of amplitude `h/8` — `h` the body a rectangle would be, `0.8`
 * of the box — 0.8 of a cycle long, its middle `h + h/8` below the top
 * (Mermaid's `waveEdgedRectangle`). Returns the path and the wave, so a
 * shape that marks the document can find where its bottom runs.
 */
function documentOutline(box: Rect): { d: string; vertices: Vertex[]; amplitude: number; middle: number } {
  const { left, right, top } = edgesOf(box);
  const amplitude = (0.8 * box.height) / 8;
  const middle = top + 0.8 * box.height + amplitude;
  const wave = sineWave([left, middle], [right, middle], amplitude, 0.8);
  return {
    d: `${polyline(wave)} L${right},${top} L${left},${top} Z`,
    vertices: [...wave.map(toHundredths), [right, top], [left, top]],
    amplitude,
    middle,
  };
}

/**
 * A document's outline: the wave its bottom is sampled at and its two top
 * corners, the vertices its frame is drawn through — Mermaid meets a
 * document at the same points, its lines and tags inside it.
 */
function documentEdge(box: Rect) {
  return pointsOf(documentOutline(box).vertices);
}

/** A document's box: `1.1` of the label wide for the shapes that widen it, and a quarter taller. */
function documentBox(widen: number): (label: Size) => Size {
  return (label) => ({ width: label.width * widen, height: label.height * 1.25 });
}

/**
 * Where a document's label goes: moved `dx` right of the centre and `dy`
 * of the label's own height up — a padded label as tall as the body a
 * rectangle would be.
 */
function documentLabel(dx: number, dy: number): (box: Rect, label: Size) => Rect {
  return (box, label) => ({
    x: box.x + (box.width - label.width) / 2 + dx * label.width,
    y: box.y + (box.height - label.height) / 2 - dy * label.height,
    width: label.width,
    height: label.height,
  });
}

/** Mermaid's `rectOffset` for a stacked document: how far each sheet stands from the next. */
const SHEET = 10;

/**
 * The `w x h` a curly brace is drawn about: the text padded by the node
 * padding once each way, half what a rectangle has (Mermaid's
 * `curlyBraceLeft`, `curlyBraceRight` and `curlyBraces`).
 */
function braceText(label: Size, padding?: Size): Size {
  const { text, px, py } = textOf(label, padding);
  return { width: text.width + px, height: text.height + py };
}

/** A curly brace's curl radius for a label `height` tall: Mermaid's `max(5, 0.1 x h)`. */
function curlRadius(height: number): number {
  return Math.max(5, 0.1 * height);
}

/**
 * The curl radius of a brace drawn in a box `height` tall — the label's
 * height and a curl above and below it: 5 up to a 60px box, where a tenth
 * of the label reaches 5, and a twelfth of the box beyond.
 */
function curlRadiusIn(height: number): number {
  return height <= 60 ? 5 : height / 12;
}

/**
 * A curly brace from `top` to `bottom` along the `side` of a label: its
 * tips at `tip`, its stem `r` further out and its point at the middle `2r`
 * out, every bend a quarter circle of radius `r` (Mermaid's
 * `curlyBraceLeft` and `curlyBraceRight`). Drawn from one tip to the other
 * as an open path, and painted hollow: Mermaid gives it no fill.
 */
function brace(side: "left" | "right", tip: number, top: number, bottom: number, r: number): ShapeFrame {
  const out = side === "left" ? -r : r;
  const stem = tip + out;
  const point = stem + out;
  const middle = (top + bottom) / 2;
  // A left brace is drawn up from its bottom tip, a right one down from its
  // top tip, so that the curls turn the same way along the path.
  const [from, to] = side === "left" ? [bottom, top] : [top, bottom];
  const step = side === "left" ? -r : r;
  return pathFrame(
    `M${tip},${from} ${arc(r, r, 1, stem, from + step)} L${stem},${middle - step} ` +
      `${arc(r, r, 0, point, middle)} ${arc(r, r, 0, stem, middle + step)} ` +
      `L${stem},${to - step} ${arc(r, r, 1, tip, to)}`,
    { classes: FRAME_PAINT.none },
  );
}

/**
 * A stack of three documents in `box` (Mermaid's
 * `multiWaveEdgedRectangle`): the stack's silhouette, which is also its
 * outline, and the middle sheet's visible edges.
 */
function documentStack(box: Rect): { outer: Vertex[]; inner: Vertex[] } {
  const { left, top } = edgesOf(box);
  const o = SHEET;
  const w = box.width - 2 * o;
  const h = (box.height - 2 * o) / (1 + 1 / 16 + 1 / 8);
  // Mermaid's corner of the middle sheet, from which it writes the rest.
  const x = left + o;
  const y = top + o;
  const front = y + h + h / 16 + o;
  const wave = sineWave([x - o, front], [x + w - o, front], h / 8, 0.8);
  const end = wave[wave.length - 1]![1];
  const outer: Vertex[] = [
    [x - o, y + o],
    ...wave,
    [x + w - o, end - o],
    [x + w, end - o],
    [x + w, end - 2 * o],
    [x + w + o, end - 2 * o],
    [x + w + o, y - o],
    [x + o, y - o],
    [x + o, y],
    [x, y],
    [x, y + o],
  ];
  const inner: Vertex[] = [
    [x, y + o],
    [x + w - o, y + o],
    [x + w - o, end - o],
    [x + w, end - o],
    [x + w, y],
    [x, y],
  ];
  return { outer, inner };
}

/**
 * A flag's outline in `box`: its bottom, a whole cycle of a sine wave from
 * left to right, then its top, the same wave flipped, back from right to
 * left (Mermaid's `waveRectangle`).
 */
function flagWaves(box: Rect): Vertex[] {
  const { left, right, midY } = edgesOf(box);
  const h = box.height / 1.5;
  const amplitude = h / 8;
  const bottom = midY + h / 2 + amplitude;
  const top = midY - h / 2 - amplitude;
  return [...sineWave([left, bottom], [right, bottom], amplitude, 1), ...sineWave([right, top], [left, top], amplitude, -1)];
}

export const CURVED_SHAPES = {
  // `delay` (Mermaid's `halfRoundedRectangle`): a rectangle whose right end
  // is a half circle of radius `h/2`, widened on both sides by the cap's
  // depth at the text's corners so the label stays centred.
  "half-rounded-rectangle": {
    box: (label, _direction, padding) => {
      // `h = max(10, text) + 2p`, `w = max(15, text) + 2 x capClearance + 2p`.
      const { text, px, py } = textOf(label, padding);
      const height = Math.max(10, text.height) + 2 * py;
      const width = Math.max(15, text.width) + 2 * capClearance(height / 2, text.height) + 2 * px;
      return { width, height };
    },
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const r = box.height / 2;
      return [pathFrame(`M${left},${top} L${right - r},${top} A${r},${r} 0 0 1 ${right - r},${bottom} L${left},${bottom} Z`)];
    },
    outline: (box) => {
      const { left, right, top, bottom, midY } = edgesOf(box);
      const r = box.height / 2;
      return closedOutline([
        { x: left, y: top },
        ...arcPoints(right - r, midY, r, r, -Math.PI / 2, Math.PI / 2),
        { x: left, y: bottom },
      ]);
    },
  },
  // `curv-trap` (Mermaid's `curvedTrapezoid`, a display): a left end that
  // comes to a point `h/4` deep and a right end that is a half circle. At
  // least a quarter wider than the padded text, and wide enough for the
  // deeper of the point and the cap at the text's corners on each side.
  "curved-trapezoid": {
    box: (label, _direction, padding) => {
      // `h = max(5, text + 2p)`, `side = max(h/4, capClearance)`, `w =
      // max(text + 2p + 2 x side, 1.25 x (text + 2p))`.
      const { text, px, py } = textOf(label, padding);
      const height = Math.max(5, text.height + 2 * py);
      const side = Math.max(height / 4, capClearance(height / 2, text.height));
      const padded = text.width + 2 * px;
      return { width: Math.max(padded + 2 * side, 1.25 * padded), height };
    },
    frames: (box) => {
      const { left, right, top, bottom, midY } = edgesOf(box);
      const r = box.height / 2;
      const point = box.height / 4;
      return [
        pathFrame(
          `M${right - r},${top} L${left + point},${top} L${left},${midY} L${left + point},${bottom} ` +
            `L${right - r},${bottom} A${r},${r} 0 0 0 ${right - r},${top} Z`,
        ),
      ];
    },
    outline: (box) => {
      const { left, right, top, bottom, midY } = edgesOf(box);
      const r = box.height / 2;
      const point = box.height / 4;
      return closedOutline([
        { x: left + point, y: top },
        ...arcPoints(right - r, midY, r, r, -Math.PI / 2, Math.PI / 2),
        { x: left + point, y: bottom },
        { x: left, y: midY },
      ]);
    },
  },
  // `h-cyl` (Mermaid's `tiltedCylinder`, direct access storage): a
  // cylinder lying on its side, its ends ellipses of radii `rx` across and
  // `h/2` up. Padded by half the node padding each way, not the whole: it
  // is the text plus `p/2` tall, and `text + p/2 + rx` wide between the
  // ends' centres. The label is centred on what lies left of the lid at the
  // right end.
  //
  // Drawn as the bracket cylinder is: the tube, then the whole lid over
  // it, wound the same way so the nonzero fill adds them.
  "horizontal-cylinder": {
    box: (label, _direction, padding) => {
      // `h = text + p/2`, `w = text + p/2 + rx` between the ends' centres.
      const { text, px, py } = textOf(label, padding);
      const height = text.height + py / 2;
      return { width: text.width + px / 2 + 3 * ellipseRadius(height / 2), height };
    },
    labelRect: (box, label) => {
      const rx = ellipseRadius(box.height / 2);
      return {
        x: box.x + (box.width - 2 * rx - label.width) / 2,
        y: box.y + (box.height - label.height) / 2,
        width: label.width,
        height: label.height,
      };
    },
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const ry = box.height / 2;
      const rx = ellipseRadius(ry);
      const lid = right - rx;
      return [
        pathFrame(
          `M${left + rx},${bottom} ${arc(rx, ry, 1, left + rx, top)} L${lid},${top} ${arc(rx, ry, 1, lid, bottom)} Z ` +
            `M${lid},${top} ${arc(rx, ry, 1, lid, bottom)} ${arc(rx, ry, 1, lid, top)} Z`,
        ),
      ];
    },
    // The silhouette: the outer half of each end and the tube between.
    outline: (box) => {
      const { left, right, midY } = edgesOf(box);
      const ry = box.height / 2;
      const rx = ellipseRadius(ry);
      return closedOutline([
        ...arcPoints(right - rx, midY, rx, ry, -Math.PI / 2, Math.PI / 2),
        ...arcPoints(left + rx, midY, rx, ry, Math.PI / 2, (3 * Math.PI) / 2),
      ]);
    },
  },
  // `lin-cyl` (Mermaid's `linedCylinder`, disk storage): a cylinder as
  // wide as a rectangle, its lid an ellipse of radii `w/2` and `ry`, its
  // body `label + ry` tall, and a line across it `0.1 x body` below the
  // lid's middle. The label moves `ry` down, off the lid.
  "lined-cylinder": {
    box: (label) => ({ width: label.width, height: label.height + 3 * ellipseRadius(label.width / 2) }),
    labelRect: (box, label) => ({
      x: box.x + (box.width - label.width) / 2,
      y: box.y + ellipseRadius(box.width / 2) + (box.height - label.height) / 2,
      width: label.width,
      height: label.height,
    }),
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const rx = box.width / 2;
      const ry = ellipseRadius(rx);
      const lid = top + ry;
      const base = bottom - ry;
      const line = lid + 0.1 * (base - lid);
      return [
        pathFrame(
          `M${left},${lid} ${arc(rx, ry, 1, right, lid)} L${right},${base} ${arc(rx, ry, 1, left, base)} Z ` +
            `M${left},${lid} ${arc(rx, ry, 1, right, lid)} ${arc(rx, ry, 1, left, lid)} Z ` +
            `M${left},${line} ${arc(rx, ry, 0, right, line)}`,
        ),
      ];
    },
    // The silhouette: the top half of the lid, the sides, and the bottom
    // half of the base.
    outline: (box) => {
      const { top, bottom, midX } = edgesOf(box);
      const rx = box.width / 2;
      const ry = ellipseRadius(rx);
      return closedOutline([
        ...arcPoints(midX, top + ry, rx, ry, Math.PI, 2 * Math.PI),
        ...arcPoints(midX, bottom - ry, rx, ry, 0, Math.PI),
      ]);
    },
  },
  // `bow-rect` (Mermaid's `bowTieRect`, stored data): a rectangle whose
  // left end bulges out and whose right end curves in, each half an
  // ellipse of radii `rx` across and `h/2` up. Padded by the node padding
  // once in height and on both sides in width: `text + p` tall and `text +
  // 2p` wide plus the arcs' sagitta, which for a half ellipse is `rx`.
  "bow-tie-rectangle": {
    box: (label, _direction, padding) => {
      // `h = text + p`, `w = text + 2p + sagitta`.
      const { text, px, py } = textOf(label, padding);
      const height = text.height + py;
      return { width: text.width + 2 * px + ellipseRadius(height / 2), height };
    },
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const ry = box.height / 2;
      const rx = ellipseRadius(ry);
      return [
        pathFrame(
          `M${right},${top} L${left + rx},${top} ${arc(rx, ry, 0, left + rx, bottom)} ` +
            `L${right},${bottom} ${arc(rx, ry, 1, right, top)} Z`,
        ),
      ];
    },
    // The left end bulging out, the right end curving in.
    outline: (box) => {
      const { left, right, top, midY } = edgesOf(box);
      const ry = box.height / 2;
      const rx = ellipseRadius(ry);
      return closedOutline([
        { x: right, y: top },
        ...arcPoints(left + rx, midY, rx, ry, (3 * Math.PI) / 2, Math.PI / 2),
        ...arcPoints(right, midY, rx, ry, Math.PI / 2, (3 * Math.PI) / 2),
      ]);
    },
  },
  // `doc` (Mermaid's `waveEdgedRectangle`): a rectangle as wide as a plain
  // one whose bottom is a sine wave; the label moves `h/8` up, which puts
  // the padded label at the top of the box.
  document: {
    outline: documentEdge,
    box: documentBox(1),
    labelRect: documentLabel(0, 1 / 8),
    frames: (box) => [pathFrame(documentOutline(box).d)],
  },
  // `lin-doc` (Mermaid's `linedWaveEdgedRect`): a document spanning `1.1 x
  // w`, with a line down it `0.05 x w` in from the left; the label moves as
  // a document's does and `0.025 x w` right, centred on what lies right of
  // the line. Mermaid runs the line to `1.1 x` the body's half height, past
  // the wave; Siren stops it where it meets the wave.
  "lined-document": {
    outline: documentEdge,
    box: documentBox(1.1),
    labelRect: documentLabel(0.025, 1 / 8),
    frames: (box) => {
      const { left, right, top } = edgesOf(box);
      const { d, amplitude, middle } = documentOutline(box);
      const x = left + (0.05 * box.width) / 1.1;
      const meets = middle + amplitude * Math.sin((2 * Math.PI * 0.8 * (x - left)) / (right - left));
      return [pathFrame(`${d} M${x},${top} L${x},${hundredths(meets)}`)];
    },
  },
  // `tag-doc` (Mermaid's `taggedWaveEdgedRectangle`): a document spanning
  // `1.1 x w` with a filled tag over its bottom right corner, the label
  // moved `h/16` up. The tag is Mermaid's polygon, written about the
  // node's centre in fractions of `w` and `h` — three corners and a half
  // cycle of wave of amplitude `-0.02 x h` back — and moved `h/16` up with
  // the outline, as Mermaid moves both.
  "tagged-document": {
    outline: documentEdge,
    box: documentBox(1.1),
    labelRect: documentLabel(0, 1 / 16),
    frames: (box) => {
      const { midX, midY } = edgesOf(box);
      const w = box.width / 1.1;
      const h = 0.8 * box.height;
      const at = (x: number, y: number): Vertex => [midX + x * w, midY + y * h - h / 16];
      const corner = at(0.35, 0.46475);
      const tag = [corner, at(0.55, 0.1575), at(0.55, 0.32175), ...sineWave(at(0.55, 0.446875), corner, -0.02 * h, 0.5)];
      return [pathFrame(documentOutline(box).d), pathFrame(`${polyline(tag)} Z`)];
    },
  },
  // `docs` (Mermaid's `multiWaveEdgedRectangle`, documents): three sheets
  // `SHEET` apart, the front one at the bottom left — a body `h + h/16`
  // tall over a wave of amplitude `h/8`, `h` the text plus three times the
  // node padding (half again what a rectangle has) — so the box is
  // `text + 2p + 2 x SHEET` wide and `1.1875 x h + 2 x SHEET` tall. The
  // label moves `SHEET` left and `SHEET - h/8` down, onto the front sheet. Drawn as
  // Mermaid draws it: the stack's silhouette, then the middle sheet's
  // visible edges over it, both filled.
  "stacked-document": {
    box: (label, _direction, padding) => {
      // `w = text + 2p`, `h = text + 3p` — padded half again in height.
      const { text, px, py } = textOf(label, padding);
      const body = text.height + 3 * py;
      return { width: text.width + 2 * px + 2 * SHEET, height: body * (1 + 1 / 16 + 1 / 8) + 2 * SHEET };
    },
    labelRect: (box, label) => {
      const body = (box.height - 2 * SHEET) / (1 + 1 / 16 + 1 / 8);
      return {
        x: box.x + (box.width - label.width) / 2 - SHEET,
        y: box.y + (box.height - label.height) / 2 + SHEET - body / 8,
        width: label.width,
        height: label.height,
      };
    },
    frames: (box) => {
      const { outer, inner } = documentStack(box);
      return [pathFrame(`${polyline(outer)} Z`), pathFrame(`${polyline(inner)} Z`)];
    },
    outline: (box) => pointsOf(documentStack(box).outer.map(toHundredths)),
  },
  // `flag` (Mermaid's `waveRectangle`, a paper tape): as wide as a
  // rectangle, `h` the text plus the node padding once, its top and bottom
  // each a whole cycle of a sine wave of amplitude `h/8` about lines `h/2 +
  // h/8` either side of the centre, so the box is `1.5 x h` tall; the label
  // is centred.
  flag: {
    box: (label, _direction, padding) => {
      // `w = text + 2p`, `h = text + p`, the box `1.5 x h` tall.
      const { text, px, py } = textOf(label, padding);
      return { width: text.width + 2 * px, height: (text.height + py) * 1.5 };
    },
    frames: (box) => [pathFrame(`${polyline(flagWaves(box))} Z`)],
    outline: (box) => pointsOf(flagWaves(box).map(toHundredths)),
  },
  // `brace` (Mermaid's `curlyBraceLeft`, a comment): a brace left of the
  // text, `w x h` the text padded once each way (`braceText`), curls of
  // radius `r = max(5, 0.1 x h)` making the box `h + 2r` tall. Mermaid's box
  // is the larger of the brace and text (`w + 2r`) and the hit area it draws
  // behind them, which reaches `0.1 x w` left of it rather than `2r`; the
  // text starts at the brace's tips.
  "brace-left": {
    // Edges meet the invisible hit rectangle behind the brace: the box.
    // Mermaid's hit polygon follows the curls; the box contains it and
    // stands in for it.
    outline: boxOutline,
    box: (label, _direction, padding) => {
      const { width, height } = braceText(label, padding);
      const r = curlRadius(height);
      return { width: Math.max(width * 1.1, width + 2 * r), height: height + 2 * r };
    },
    // The text starts where the brace's tips stand, `w` in from the right,
    // and ends `p` short of it; the padded label, which is the text and `p`
    // either side, therefore ends at the right edge.
    labelRect: (box, label) => ({
      x: box.x + box.width - label.width,
      y: box.y + (box.height - label.height) / 2,
      width: label.width,
      height: label.height,
    }),
    frames: (box) => {
      const { right, top, bottom } = edgesOf(box);
      const r = curlRadiusIn(box.height);
      const w = Math.min((box.width * 10) / 11, box.width - 2 * r);
      return [brace("left", right - w, top, bottom, r)];
    },
  },
  // `brace-r` (Mermaid's `curlyBraceRight`): a brace along the right of a
  // centred label, the box `w + 2r` by `h + 2r`.
  "brace-right": {
    // Edges meet the invisible hit rectangle behind the brace: the box.
    outline: boxOutline,
    box: (label, _direction, padding) => {
      const { width, height } = braceText(label, padding);
      const r = curlRadius(height);
      return { width: width + 2 * r, height: height + 2 * r };
    },
    frames: (box) => {
      const { right, top, bottom } = edgesOf(box);
      const r = curlRadiusIn(box.height);
      return [brace("right", right - 2 * r, top, bottom, r)];
    },
  },
  // `braces` (Mermaid's `curlyBraces`): a brace on each side of a centred
  // label, the box `w + 2.5r` by `h + 2r` — each brace reaches `3r/4` in
  // over the padded label.
  braces: {
    // Edges meet the invisible hit rectangle behind the brace: the box.
    outline: boxOutline,
    box: (label, _direction, padding) => {
      const { width, height } = braceText(label, padding);
      const r = curlRadius(height);
      return { width: width + 2.5 * r, height: height + 2 * r };
    },
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const r = curlRadiusIn(box.height);
      return [brace("left", left + 2 * r, top, bottom, r), brace("right", right - 2 * r, top, bottom, r)];
    },
  },
} as const satisfies Partial<Record<NodeShape, ShapeSpec>>;
