import type { NodeShape } from "../../contracts";
import { edgesOf, FRAME_PAINT, pathFrame, type Rect, type ShapeFrame, type ShapeSpec, type Size } from "./shape";

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
 * text: the padded label less Mermaid's 15px node padding on each side
 * (`textOf`), the padding a rectangle's box stands for.
 */

/** Mermaid's flowchart node padding, `p` in the formulas below. */
const PADDING = 15;

/** The text Mermaid measures, before its padding: the padded label less `PADDING` a side. */
function textOf(label: Size): Size {
  return { width: Math.max(label.width - 2 * PADDING, 0), height: Math.max(label.height - 2 * PADDING, 0) };
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

/** A point, as `[x, y]`. */
type Point = readonly [number, number];

/**
 * Mermaid's `generateFullSineWavePoints`: `cycles` cycles of a sine wave of
 * `amplitude` about the middle of `from` and `to`, sampled at 51 evenly
 * spaced points from `from`'s x to `to`'s. A negative `cycles` or
 * `amplitude` flips the wave.
 */
function sineWave(from: Point, to: Point, amplitude: number, cycles: number): Point[] {
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

/** `points` as an open polyline, `M x,y L x,y …`, to the hundredth. */
function polyline(points: readonly Point[]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${hundredths(x)},${hundredths(y)}`).join(" ");
}

/**
 * A document's outline in `box`: a straight top, and a bottom that is a
 * sine wave of amplitude `h/8` — `h` the body a rectangle would be, `0.8`
 * of the box — 0.8 of a cycle long, its middle `h + h/8` below the top
 * (Mermaid's `waveEdgedRectangle`). Returns the path and the wave, so a
 * shape that marks the document can find where its bottom runs.
 */
function documentOutline(box: Rect): { d: string; amplitude: number; middle: number } {
  const { left, right, top } = edgesOf(box);
  const amplitude = (0.8 * box.height) / 8;
  const middle = top + 0.8 * box.height + amplitude;
  const wave = sineWave([left, middle], [right, middle], amplitude, 0.8);
  return { d: `${polyline(wave)} L${right},${top} L${left},${top} Z`, amplitude, middle };
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

export const CURVED_SHAPES = {
  // `delay` (Mermaid's `halfRoundedRectangle`): a rectangle whose right end
  // is a half circle of radius `h/2`, widened on both sides by the cap's
  // depth at the text's corners so the label stays centred.
  "half-rounded-rectangle": {
    box: (label) => {
      // `h = max(10, text) + 2p`, `w = max(15, text) + 2 x capClearance + 2p`.
      const text = textOf(label);
      const height = Math.max(10, text.height) + 2 * PADDING;
      const width = Math.max(15, text.width) + 2 * capClearance(height / 2, text.height) + 2 * PADDING;
      return { width, height };
    },
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const r = box.height / 2;
      return [pathFrame(`M${left},${top} L${right - r},${top} A${r},${r} 0 0 1 ${right - r},${bottom} L${left},${bottom} Z`)];
    },
  },
  // `curv-trap` (Mermaid's `curvedTrapezoid`, a display): a left end that
  // comes to a point `h/4` deep and a right end that is a half circle. At
  // least a quarter wider than the padded text, and wide enough for the
  // deeper of the point and the cap at the text's corners on each side.
  "curved-trapezoid": {
    box: (label) => {
      // `h = max(5, text + 2p)`, `side = max(h/4, capClearance)`, `w =
      // max(text + 2p + 2 x side, 1.25 x (text + 2p))`.
      const text = textOf(label);
      const height = Math.max(5, text.height + 2 * PADDING);
      const side = Math.max(height / 4, capClearance(height / 2, text.height));
      const padded = text.width + 2 * PADDING;
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
  },
  // `h-cyl` (Mermaid's `tiltedCylinder`, direct access storage): a
  // cylinder lying on its side, its ends ellipses of radii `rx` across and
  // `h/2` up. The body is `label + rx` wide between the ends' centres and
  // the label is centred on what lies left of the lid at the right end.
  //
  // Drawn as the bracket cylinder is: the tube, then the whole lid over
  // it, wound the same way so the nonzero fill adds them.
  "horizontal-cylinder": {
    box: (label) => ({ width: label.width + 3 * ellipseRadius(label.height / 2), height: label.height }),
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
  },
  // `bow-rect` (Mermaid's `bowTieRect`, stored data): a rectangle whose
  // left end bulges out and whose right end curves in, each half an
  // ellipse of radii `rx` across and `h/2` up. The box is the label's width
  // plus the arcs' sagitta, which for a half ellipse is `rx`.
  "bow-tie-rectangle": {
    box: (label) => ({ width: label.width + ellipseRadius(label.height / 2), height: label.height }),
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
  },
  // `doc` (Mermaid's `waveEdgedRectangle`): a rectangle as wide as a plain
  // one whose bottom is a sine wave; the label moves `h/8` up, which puts
  // the padded label at the top of the box.
  document: {
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
    box: documentBox(1.1),
    labelRect: documentLabel(0, 1 / 16),
    frames: (box) => {
      const { midX, midY } = edgesOf(box);
      const w = box.width / 1.1;
      const h = 0.8 * box.height;
      const at = (x: number, y: number): Point => [midX + x * w, midY + y * h - h / 16];
      const corner = at(0.35, 0.46475);
      const tag = [corner, at(0.55, 0.1575), at(0.55, 0.32175), ...sineWave(at(0.55, 0.446875), corner, -0.02 * h, 0.5)];
      return [pathFrame(documentOutline(box).d), pathFrame(`${polyline(tag)} Z`)];
    },
  },
  // `docs` (Mermaid's `multiWaveEdgedRectangle`, documents): three sheets
  // `SHEET` apart, the front one at the bottom left — a body `h + h/16`
  // tall over a wave of amplitude `h/8` — so the box is `2 x SHEET` wider
  // and `h/16 + h/8 + 2 x SHEET` taller than a rectangle. The label moves
  // `SHEET` left and `SHEET - h/8` down, onto the front sheet. Drawn as
  // Mermaid draws it: the stack's silhouette, then the middle sheet's
  // visible edges over it, both filled.
  "stacked-document": {
    box: (label) => ({ width: label.width + 2 * SHEET, height: label.height * (1 + 1 / 16 + 1 / 8) + 2 * SHEET }),
    labelRect: (box, label) => ({
      x: box.x + (box.width - label.width) / 2 - SHEET,
      y: box.y + (box.height - label.height) / 2 + SHEET - label.height / 8,
      width: label.width,
      height: label.height,
    }),
    frames: (box) => {
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
      const outer: Point[] = [
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
      const inner: Point[] = [
        [x, y + o],
        [x + w - o, y + o],
        [x + w - o, end - o],
        [x + w, end - o],
        [x + w, y],
        [x, y],
      ];
      return [pathFrame(`${polyline(outer)} Z`), pathFrame(`${polyline(inner)} Z`)];
    },
  },
  // `flag` (Mermaid's `waveRectangle`, a paper tape): as wide as a
  // rectangle, its top and bottom each a whole cycle of a sine wave of
  // amplitude `h/8` about lines `h/2 + h/8` either side of the centre, so
  // the box is `1.5 x h` tall; the label is centred.
  flag: {
    box: (label) => ({ width: label.width, height: label.height * 1.5 }),
    frames: (box) => {
      const { left, right, midY } = edgesOf(box);
      const h = box.height / 1.5;
      const amplitude = h / 8;
      const bottom = midY + h / 2 + amplitude;
      const top = midY - h / 2 - amplitude;
      const wave = [
        ...sineWave([left, bottom], [right, bottom], amplitude, 1),
        ...sineWave([right, top], [left, top], amplitude, -1),
      ];
      return [pathFrame(`${polyline(wave)} Z`)];
    },
  },
  // `brace` (Mermaid's `curlyBraceLeft`, a comment): a brace left of the
  // label, curls of radius `r = max(5, 0.1 x h)` making the box `h + 2r`
  // tall. Mermaid's box is the larger of the brace and label (`w + 2r`) and
  // the hit area it draws behind them, which reaches `0.1 x w` left of the
  // label rather than `2r`; the label starts at the brace's tips, at the
  // right of the box.
  "brace-left": {
    box: (label) => {
      const r = curlRadius(label.height);
      return { width: Math.max(label.width * 1.1, label.width + 2 * r), height: label.height + 2 * r };
    },
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
    box: (label) => {
      const r = curlRadius(label.height);
      return { width: label.width + 2 * r, height: label.height + 2 * r };
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
    box: (label) => {
      const r = curlRadius(label.height);
      return { width: label.width + 2.5 * r, height: label.height + 2 * r };
    },
    frames: (box) => {
      const { left, right, top, bottom } = edgesOf(box);
      const r = curlRadiusIn(box.height);
      return [brace("left", left + 2 * r, top, bottom, r), brace("right", right - 2 * r, top, bottom, r)];
    },
  },
} as const satisfies Partial<Record<NodeShape, ShapeSpec>>;
