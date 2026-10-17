import type { NodeShape } from "../../contracts";
import { arcPoints, boxOutline, closedOutline, edgesOf, FRAME_PAINT, pathFrame, type Rect, rectFrame, type ShapeFrame, type ShapeSpec, type Size } from "./shape";

/**
 * Shape-table records for the shapes Mermaid 12.2.0 draws as a figure plus
 * decorations: `bucket`, `person`, `console`, `browser`, `cloud` and
 * `bang`.
 *
 * Each follows its Mermaid handler's formula (classic look), applied to the
 * padded label — the box a rectangle would draw, which stands for
 * Mermaid's label plus its padding on each side — and is drawn inscribed in
 * the box Mermaid lays the node out by (the extent of what it draws). The
 * label goes where that handler puts it. Proportions are Mermaid's; the
 * path is Siren's own (ADR-0004: a shape's kind is the contract, not its
 * exact outline).
 *
 * A decoration Mermaid paints in the node's border colour — a bucket's
 * rim — is a frame of its own, painted hollow, so the theme strokes it as
 * it strokes the outline.
 */

/** How wide a bucket's bottom is, as a share of its rim (Mermaid's `0.72`). */
const BUCKET_TAPER = 0.72;

/** A bucket's rim height for a bucket `width` wide: Mermaid's `clamp(0.08 x w, 5, 12)`. */
function bucketRim(width: number): number {
  return Math.min(Math.max(width * 0.08, 5), 12);
}

/**
 * A person's head for a person `width` wide: its radius, Mermaid's
 * `clamp(0.23 x w, 16, 56)`, and how far down the box the body starts —
 * the head's diameter less the 27% of its radius by which it overlaps the
 * body.
 */
function personHead(width: number): { radius: number; neck: number } {
  const radius = Math.min(Math.max(width * 0.23, 16), 56);
  return { radius, neck: 2 * radius - radius * 0.27 };
}

/**
 * A person's body in `box`: the box below the neck, and its corner
 * radius, Mermaid's `min(0.177 x w, 0.45 x body height)`.
 */
function personBody(box: Rect): { body: Rect; corner: number } {
  const { neck } = personHead(box.width);
  const body = { x: box.x, y: box.y + neck, width: box.width, height: box.height - neck };
  return { body, corner: Math.min(box.width * 0.177, body.height * 0.45) };
}

/** Mermaid's corner radius for a console's and a browser's window. */
const WINDOW_CORNER = 12;

/**
 * The window a console and a browser are drawn as: at least 90px wide, a
 * band `band` tall across its top above a body as tall as a rectangle, and
 * the label centred on that body. `decorations` draws what goes in the
 * band, over the window.
 */
function windowShape(band: number, decorations: (box: Rect) => ShapeFrame[]): ShapeSpec {
  return {
    box: (label: Size) => ({ width: Math.max(label.width, 90), height: label.height + band }),
    labelRect: (box, label) => ({
      x: box.x + (box.width - label.width) / 2,
      y: box.y + band + (box.height - band - label.height) / 2,
      width: label.width,
      height: label.height,
    }),
    frames: (box) => [rectFrame(box, { style: [{ property: "rx", value: `${WINDOW_CORNER}px` }] }), ...decorations(box)],
    // A window's edges meet its box, round corners and all, as Mermaid's do.
    outline: boxOutline,
  };
}

/** Mermaid's `barHeight`: the height of a browser's bar. */
const BROWSER_BAR = 18;

/** Mermaid's flowchart node padding: `p` when a record is told no padding of its own. */
const MERMAID_PADDING: Size = { width: 15, height: 15 };

/**
 * The text a handler measures and the node padding `p`, across and up: the
 * padded label less `padding` on each side, and `padding` itself. A handler
 * that pads by its own multiple of `p` — a bang's and a cloud's
 * `halfPadding` — starts from the text. Laid out, `padding` is Siren's own
 * (`layoutGraph`), so the shape stands to a rectangle as Mermaid's does.
 */
function bareLabel(label: Size, padding: Size = MERMAID_PADDING): { bare: Size; px: number; py: number } {
  return {
    bare: {
      width: Math.max(label.width - 2 * padding.width, 0),
      height: Math.max(label.height - 2 * padding.height, 0),
    },
    px: padding.width,
    py: padding.height,
  };
}

/** `value` to three decimals, so that an outline written from fractions reads as its formula does. */
function n(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The `w x h` a bang's arcs join the corners of, for a padded label:
 * Mermaid's `bbox.width + 10 x halfPadding` by `bbox.height + 8 x
 * halfPadding`.
 */
function bangCorners(label: Size, padding?: Size): Size {
  const { bare, px, py } = bareLabel(label, padding);
  return { width: bare.width + 5 * px, height: bare.height + 4 * py };
}

/** How much bigger a bang's outline is than the `w x h` its corners span, each way. */
const BANG_SPREAD = 1.25;

/** One relative elliptical arc (`a`) of an outline, as SVG writes it: radii, x-axis rotation in degrees, and where it ends. */
interface Arc {
  rx: number;
  ry: number;
  rotation: number;
  dx: number;
  dy: number;
}

/** The extent of a drawn outline: its least and greatest x and y. */
interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Where `angle` falls along an arc that starts at `start` and turns
 * through `sweep` (negative for anticlockwise): `true` when it is passed
 * on the way.
 */
function onArc(angle: number, start: number, sweep: number): boolean {
  const turn = 2 * Math.PI;
  const along = sweep >= 0 ? (angle - start) % turn : (start - angle) % turn;
  return (along + turn) % turn <= Math.abs(sweep);
}

/**
 * The points of a small-arc, clockwise (`0,1`) elliptical arc from `from`
 * that bound it: both ends, and each point where it turns back in x or in
 * y. Follows the SVG arc implementation notes — radii too small to reach
 * the end are scaled up until they do, which is what makes a cloud's sides
 * bulge further the taller it is.
 */
function arcBounds(from: readonly [number, number], arc: Arc): Array<[number, number]> {
  const [x1, y1] = from;
  const x2 = x1 + arc.dx;
  const y2 = y1 + arc.dy;
  const phi = (arc.rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const hx = (x1 - x2) / 2;
  const hy = (y1 - y2) / 2;
  const px = cos * hx + sin * hy;
  const py = -sin * hx + cos * hy;
  const reach = (px * px) / (arc.rx * arc.rx) + (py * py) / (arc.ry * arc.ry);
  const rx = reach > 1 ? arc.rx * Math.sqrt(reach) : arc.rx;
  const ry = reach > 1 ? arc.ry * Math.sqrt(reach) : arc.ry;
  // Large-arc 0 and sweep 1 disagree, which puts the centre on the positive side.
  const numerator = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px;
  const coefficient = Math.sqrt(Math.max(0, numerator / (rx * rx * py * py + ry * ry * px * px)));
  const cxp = (coefficient * rx * py) / ry;
  const cyp = (-coefficient * ry * px) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const start = Math.atan2((py - cyp) / ry, (px - cxp) / rx);
  let sweep = Math.atan2((-py - cyp) / ry, (-px - cxp) / rx) - start;
  if (sweep < 0) sweep += 2 * Math.PI;
  const at = (theta: number): [number, number] => [
    cx + rx * cos * Math.cos(theta) - ry * sin * Math.sin(theta),
    cy + rx * sin * Math.cos(theta) + ry * cos * Math.sin(theta),
  ];
  const turns = [Math.atan2(-ry * sin, rx * cos), Math.atan2(ry * cos, rx * sin)].flatMap((theta) => [theta, theta + Math.PI]);
  return [[x1, y1], [x2, y2], ...turns.filter((theta) => onArc(theta, start, sweep)).map(at)];
}

/** The extent of an outline that starts at the origin and is drawn by `arcs`. */
function extentOf(arcs: readonly Arc[]): Extent {
  let at: [number, number] = [0, 0];
  const points: Array<[number, number]> = [];
  for (const arc of arcs) {
    points.push(...arcBounds(at, arc));
    at = [at[0] + arc.dx, at[1] + arc.dy];
  }
  return {
    minX: Math.min(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxX: Math.max(...points.map(([x]) => x)),
    maxY: Math.max(...points.map(([, y]) => y)),
  };
}

/**
 * Mermaid's cloud joining the corners of a `w x h`, from its top left:
 * five arcs round the top and right, five round the bottom and left, of
 * radii `0.15`, `0.2`, `0.25` and `0.35 x w`. The first is unrotated and
 * the rest turned 1 degree, as Mermaid writes them.
 */
function cloudArcs(w: number, h: number): Arc[] {
  const [r1, r2, r3, r4] = [0.15 * w, 0.25 * w, 0.35 * w, 0.2 * w];
  const arc = (rx: number, ry: number, dx: number, dy: number, rotation = 1): Arc => ({ rx, ry, rotation, dx, dy });
  return [
    arc(r1, r1, 0.25 * w, -0.1 * w, 0),
    arc(r3, r3, 0.4 * w, -0.1 * w),
    arc(r2, r2, 0.35 * w, 0.2 * w),
    arc(r1, r1, 0.15 * w, 0.35 * h),
    arc(r4, r4, -0.15 * w, 0.65 * h),
    arc(r2, r1, -0.25 * w, 0.15 * w),
    arc(r3, r3, -0.5 * w, 0),
    arc(r1, r1, -0.25 * w, -0.15 * w),
    arc(r1, r1, -0.1 * w, -0.35 * h),
    arc(r4, r4, 0.1 * w, -0.65 * h),
  ];
}

/** The `w x h` a cloud's arcs join, for a padded label: Mermaid's `bbox + 2 x halfPadding` each way. */
function cloudCorners(label: Size, padding?: Size): Size {
  const { bare, px, py } = bareLabel(label, padding);
  return { width: bare.width + px, height: bare.height + py };
}

/** The extent of a cloud joining a `1 x ratio` — every cloud is one of these, scaled. */
function unitCloud(ratio: number): { width: number; height: number } {
  const { minX, minY, maxX, maxY } = extentOf(cloudArcs(1, ratio));
  return { width: maxX - minX, height: maxY - minY };
}

/** The last few fits, so a cloud's label and outline do not each fit the same box again. */
const fitted = new Map<string, Size>();

/**
 * The `w x h` whose cloud reaches exactly `box`'s size: what the box was
 * measured from, recovered so the outline can be drawn from the box alone.
 *
 * A cloud scales with its `w x h` — every arc's radius and reach is a
 * multiple of `w` or `h` — so its extent is `w` times that of a cloud
 * joining `1 x h/w`, and only the ratio `h/w` has to be found: the one whose
 * cloud is as much taller than wide as the box is. That cloud's height over
 * width grows with the ratio, so halving an interval finds it, to a
 * millionth of the box, however tall the label.
 */
function cloudFitting(box: Size): Size {
  const key = `${box.width},${box.height}`;
  const known = fitted.get(key);
  if (known !== undefined) {
    return known;
  }
  const target = box.height / box.width;
  let low = 0;
  let high = 1;
  while (high < 1e6) {
    const { width, height } = unitCloud(high);
    if (height / width >= target) break;
    low = high;
    high *= 2;
  }
  for (let pass = 0; pass < 200 && high - low > 1e-12 * Math.max(1, high); pass++) {
    const middle = (low + high) / 2;
    const { width, height } = unitCloud(middle);
    if (height / width < target) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const ratio = (low + high) / 2;
  const w = box.width / unitCloud(ratio).width;
  const fit = { width: w, height: ratio * w };
  if (fitted.size >= 256) {
    fitted.clear();
  }
  fitted.set(key, fit);
  return fit;
}

export const COMPOSITE_SHAPES = {
  // `bucket` (Mermaid's `bucket`, object storage): a body tapering from
  // its full width at the rim to 72% at the bottom, under an open
  // elliptical rim. At least 80px wide; the rim's `ry` bulges above the
  // body and the bottom arc as far below it, so the box is the padded
  // label plus both. The label is centred on the body, which is the box's
  // centre.
  bucket: {
    box: (label) => {
      const width = Math.max(label.width, 80);
      return { width, height: label.height + 2 * bucketRim(width) };
    },
    frames: (box) => {
      const { left, right, top, bottom, midX } = edgesOf(box);
      const ry = bucketRim(box.width);
      const rim = top + ry;
      const base = bottom - ry;
      const half = box.width / 2;
      const baseHalf = half * BUCKET_TAPER;
      return [
        pathFrame(
          `M${left},${rim} L${midX - baseHalf},${base} A${baseHalf},${ry} 0 0 0 ${midX + baseHalf},${base} ` +
            `L${right},${rim} A${half},${ry} 0 0 0 ${left},${rim} Z`,
        ),
        pathFrame(`M${right},${rim} A${half},${ry} 0 0 0 ${left},${rim} A${half},${ry} 0 0 0 ${right},${rim} Z`, {
          classes: FRAME_PAINT.none,
        }),
      ];
    },
    // The silhouette: the far half of the rim, the sides, and the bottom.
    outline: (box) => {
      const { top, bottom, midX } = edgesOf(box);
      const ry = bucketRim(box.width);
      const half = box.width / 2;
      return closedOutline([
        ...arcPoints(midX, top + ry, half, ry, Math.PI, 2 * Math.PI),
        ...arcPoints(midX, bottom - ry, half * BUCKET_TAPER, ry, 0, Math.PI),
      ]);
    },
  },
  // `person` (Mermaid's `person`): a body with rounded corners as tall as
  // a rectangle, under a round head that overlaps its top. At least 100px
  // wide. The label is centred on the body.
  person: {
    box: (label) => {
      const width = Math.max(label.width, 100);
      return { width, height: label.height + personHead(width).neck };
    },
    labelRect: (box, label) => {
      const { neck } = personHead(box.width);
      return {
        x: box.x + (box.width - label.width) / 2,
        y: box.y + neck + (box.height - neck - label.height) / 2,
        width: label.width,
        height: label.height,
      };
    },
    frames: (box) => {
      const { top, midX } = edgesOf(box);
      const { radius } = personHead(box.width);
      const { body, corner } = personBody(box);
      return [
        rectFrame(body, { style: [{ property: "rx", value: `${corner}px` }] }),
        {
          element: "circle",
          attributes: [
            ["cx", midX],
            ["cy", top + radius],
            ["r", radius],
          ],
        },
      ];
    },
    // The silhouette: the head down to where it meets the body's top, then
    // the body's rounded corners — the outline Mermaid meets a person at.
    // It follows the shape's own corner, not an author's `rx`, as Mermaid's
    // `intersect` does.
    outline: (box) => {
      const { left, right, top, bottom, midX } = edgesOf(box);
      const { radius, neck } = personHead(box.width);
      const { body, corner } = personBody(box);
      const bodyTop = body.y;
      const meet = Math.asin(Math.min(1, (neck - radius) / radius));
      const quarter = Math.PI / 2;
      return closedOutline([
        ...arcPoints(midX, top + radius, radius, radius, Math.PI - meet, 2 * Math.PI + meet),
        ...arcPoints(right - corner, bodyTop + corner, corner, corner, -quarter, 0),
        ...arcPoints(right - corner, bottom - corner, corner, corner, 0, quarter),
        ...arcPoints(left + corner, bottom - corner, corner, corner, quarter, 2 * quarter),
        ...arcPoints(left + corner, bodyTop + corner, corner, corner, 2 * quarter, 3 * quarter),
      ]);
    },
  },
  // `console` (Mermaid's `consoleWindow`): a window with a 20px band for a
  // `>_` prompt. Mermaid writes the prompt as text, 14px bold monospace in
  // the border colour, its baseline 16px below the top and 12px in from the
  // left; Siren strokes the two glyphs in the box that text takes (measured
  // 16.86 x 16, 3px below the top), so the prompt is the same whichever
  // monospace face a viewer has. An author's `style` does not reach the
  // prompt (measured).
  console: windowShape(20, (box) => {
    const { left, top } = edgesOf(box);
    return [
      pathFrame(
        `M${left + 13},${top + 6} L${left + 19},${top + 10.5} L${left + 13},${top + 15} ` +
          `M${left + 21},${top + 16} L${left + 28},${top + 16}`,
        {
          classes: FRAME_PAINT.none,
          authorStyle: false,
          style: [
            { property: "stroke-width", value: "2px" },
            { property: "stroke-linecap", value: "round" },
            { property: "stroke-linejoin", value: "round" },
          ],
        },
      ),
    ];
  }),
  // `browser` (Mermaid's `browser`): a window with an 18px bar, a line
  // under it, three dots at its left and an address bar beside them. The
  // dots are filled in the border colour and not stroked; the address bar
  // is unfilled, stroked at 60% opacity, and never under 10px wide. An
  // author's `style` reaches the window only (measured), so the bar's
  // decorations take none of it.
  browser: windowShape(BROWSER_BAR, (box) => {
    const { left, right, top } = edgesOf(box);
    const bar = BROWSER_BAR;
    return [
      {
        element: "line",
        attributes: [
          ["x1", left],
          ["y1", top + bar],
          ["x2", right],
          ["y2", top + bar],
        ],
        authorStyle: false,
      },
      ...[0, 1, 2].map(
        (i): ShapeFrame => ({
          element: "circle",
          attributes: [
            ["cx", left + 12 + i * 9],
            ["cy", top + bar / 2],
            ["r", 2.5],
          ],
          classes: FRAME_PAINT.line,
          authorStyle: false,
          style: [{ property: "stroke", value: "none" }],
        }),
      ),
      rectFrame(
        { x: left + 44, y: top + 4, width: Math.max(box.width - 56, 10), height: bar - 8 },
        {
          classes: FRAME_PAINT.none,
          authorStyle: false,
          style: [
            { property: "rx", value: "3px" },
            { property: "opacity", value: "0.6" },
          ],
        },
      ),
    ];
  }),
  // `cloud` (Mermaid's `cloud`): ten convex arcs joining points round a
  // `w x h` a little bigger than the label, bulging past it — further at
  // the sides the taller the label is, as an arc too short for its end is
  // scaled up. The box is the outline's extent, worked out from the arcs,
  // and the label is centred on the `w x h`, which the bulges leave a
  // little left of and above the box's centre.
  cloud: {
    // Mermaid meets a cloud's box, not its bulges.
    outline: boxOutline,
    box: (label, _direction, padding) => {
      const { width: w, height: h } = cloudCorners(label, padding);
      const { minX, minY, maxX, maxY } = extentOf(cloudArcs(w, h));
      return { width: maxX - minX, height: maxY - minY };
    },
    labelRect: (box, label) => {
      const { width: w, height: h } = cloudFitting(box);
      const { minX, minY } = extentOf(cloudArcs(w, h));
      return {
        x: box.x - minX + (w - label.width) / 2,
        y: box.y - minY + (h - label.height) / 2,
        width: label.width,
        height: label.height,
      };
    },
    frames: (box) => {
      const { width: w, height: h } = cloudFitting(box);
      const arcs = cloudArcs(w, h);
      const { minX, minY } = extentOf(arcs);
      const x = n(box.x - minX);
      const y = n(box.y - minY);
      return [
        pathFrame(
          [
            `M${x},${y}`,
            ...arcs.map(
              ({ rx, ry, rotation, dx, dy }) => `a${n(rx)},${n(ry)} ${rotation} 0,1 ${n(dx)},${n(dy)}`,
            ),
            `H${x} V${y} Z`,
          ].join(" "),
        ),
      ];
    },
  },
  // `bang` (Mermaid's `bang`): a scalloped outline of concave arcs, four
  // along the top and the bottom and three down each side, joining points
  // that reach `0.1 x w` left of the `w x h` they span, `0.15 x w` right of
  // it, `0.1 x h` above and `0.15 x h` below — so the outline's extent, the
  // box, is `1.25 x w` by `1.25 x h`. Mermaid centres the label on the
  // `w x h`, a fortieth of each up and left of the box's centre.
  bang: {
    // Mermaid meets a bang's box, not its scallops.
    outline: boxOutline,
    box: (label, _direction, padding) => {
      const { width, height } = bangCorners(label, padding);
      return { width: BANG_SPREAD * width, height: BANG_SPREAD * height };
    },
    labelRect: (box, label) => {
      const w = box.width / BANG_SPREAD;
      const h = box.height / BANG_SPREAD;
      return {
        x: box.x + 0.1 * w + (w - label.width) / 2,
        y: box.y + 0.1 * h + (h - label.height) / 2,
        width: label.width,
        height: label.height,
      };
    },
    frames: (box) => {
      const w = box.width / BANG_SPREAD;
      const h = box.height / BANG_SPREAD;
      const x = n(box.x + 0.1 * w);
      const y = n(box.y + 0.1 * h);
      const r = n(0.15 * w);
      const end = n(0.8 * 0.15 * w);
      const arc = (radius: number, dx: number, dy: number) => `a${radius},${radius} 1 0,0 ${n(dx)},${n(dy)}`;
      return [
        pathFrame(
          [
            `M${x},${y}`,
            arc(r, 0.25 * w, -0.1 * h),
            arc(r, 0.25 * w, 0),
            arc(r, 0.25 * w, 0),
            arc(r, 0.25 * w, 0.1 * h),
            arc(r, 0.15 * w, 0.33 * h),
            arc(end, 0, 0.34 * h),
            arc(r, -0.15 * w, 0.33 * h),
            arc(r, -0.25 * w, 0.15 * h),
            arc(r, -0.25 * w, 0),
            arc(r, -0.25 * w, 0),
            arc(r, -0.25 * w, -0.15 * h),
            arc(r, -0.1 * w, -0.33 * h),
            arc(end, 0, -0.34 * h),
            arc(r, 0.1 * w, -0.33 * h),
            `H${x} V${y} Z`,
          ].join(" "),
        ),
      ];
    },
  },
} as const satisfies Partial<Record<NodeShape, ShapeSpec>>;
