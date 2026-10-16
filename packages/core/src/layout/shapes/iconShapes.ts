import type { GraphNode, NodeIcon, NodeShape, PositionedNode } from "../../contracts";
import { DEFAULT_ICON_SIZE } from "../../nodeShapeTraits";
import {
  closedPath,
  edgesOf,
  FIGURE_LABEL_GAP,
  FRAME_PAINT,
  pathFrame,
  rectFrame,
  type Rect,
  type ShapeFrame,
  type ShapeSpec,
  type Size,
} from "./shape";

/**
 * The shape-table record of an icon node (`A@{ icon: "fa:user" }`, and
 * `shape: icon`): an icon, a figure behind it in the form `form` names, and
 * its label below the figure or, with `pos: t`, above it — Mermaid 12.2.0's
 * `icon`, `iconSquare`, `iconRounded` and `iconCircle` handlers, measured in
 * Chrome with a registered pack.
 *
 * Read off the node rather than the label alone: the icon's size, its form
 * and its label's side are the node's own (`GraphNode.icon`).
 */

/** An icon node's `icon` when it has none: `shape: icon` read as nothing else. */
const NO_ICON: NodeIcon = { name: null, form: null, pos: "b", size: DEFAULT_ICON_SIZE };

/**
 * How much wider and taller than the icon a square or rounded form is: the
 * flowchart's node padding, 15 (Mermaid's `halfPadding * 2`, measured 63
 * for a 48px icon).
 */
const FORM_PADDING = 15;

/** How much a circle form's diameter adds to the icon's diagonal (Mermaid's `padding * 2`). */
const CIRCLE_PADDING = 40;

/** A rounded form's corner radius (Mermaid's `createRoundedRectPathD(…, 5)`). */
const ROUNDED_RADIUS = 5;

const iconOf = (node: GraphNode | undefined): NodeIcon => node?.icon ?? NO_ICON;

/**
 * The side of the figure behind the icon: the icon itself with no form.
 * A circle's diameter is Mermaid's formula over the icon's square rather
 * than over the ink its glyph happens to cover, so that a glyph does not
 * resize its node.
 */
function figureSide({ form, size }: NodeIcon): number {
  if (form === "circle") {
    return size * Math.SQRT2 + CIRCLE_PADDING;
  }
  return form === null ? size : size + FORM_PADDING;
}

/** Where the figure stands in `box`: at the top, or with `pos: t` at the bottom, centred across. */
function figureRect(box: Rect, icon: NodeIcon): Rect {
  const side = figureSide(icon);
  return {
    x: box.x + (box.width - side) / 2,
    y: icon.pos === "t" ? box.y + box.height - side : box.y,
    width: side,
    height: side,
  };
}

/** The colour the glyph is drawn in: the author's `stroke`, else the node's line colour, as Mermaid's `color:` is. */
function glyphColour(node: PositionedNode | undefined): string {
  const strokes = (node?.style.frame ?? []).filter((declaration) => declaration.property.toLowerCase() === "stroke");
  return strokes.at(-1)?.value ?? "var(--siren-node-stroke)";
}

/**
 * The glyph, scaled to the icon's square and centred in the figure — a
 * glyph that is not square centred in the square, as an `<svg>` with that
 * `viewBox` meets it.
 */
function glyphFrame(figure: Rect, icon: NodeIcon, node: PositionedNode | undefined): ShapeFrame[] {
  const glyph = icon.glyph;
  if (glyph === undefined) {
    return [];
  }
  const { left, top, width, height } = glyph.viewBox;
  const scale = icon.size / Math.max(width, height);
  const { midX, midY } = edgesOf(figure);
  const x = midX - (width * scale) / 2 - left * scale;
  const y = midY - (height * scale) / 2 - top * scale;
  return [
    {
      element: "g",
      attributes: [["transform", `translate(${x},${y}) scale(${scale})`]],
      style: [
        { property: "color", value: glyphColour(node) },
        { property: "fill", value: "currentColor" },
        { property: "stroke", value: "none" },
      ],
      children: glyph.elements,
    },
  ];
}

/** What is drawn behind the icon: nothing but a frame the highlight can outline, or the form. */
function formFrame(box: Rect, figure: Rect, icon: NodeIcon): ShapeFrame {
  // Mermaid strokes a form in its fill colour, and an icon with no form not
  // at all, whatever the author's `stroke` — which colours the glyph — so no
  // outline shows. Drawn 0 wide through the theme's width token rather than
  // with `stroke: none`: an author's `stroke` lands on a line of no width,
  // and the highlight rule, which sets a width of its own, still outlines it.
  const unoutlined = [{ property: "--siren-stroke-width", value: "0" }];
  switch (icon.form) {
    case null:
      return rectFrame(box, { classes: FRAME_PAINT.bare, style: unoutlined });
    case "square": {
      const { left, right, top, bottom } = edgesOf(figure);
      return pathFrame(
        closedPath([
          [left, top],
          [right, top],
          [right, bottom],
          [left, bottom],
        ]),
        { style: unoutlined },
      );
    }
    case "rounded":
      return rectFrame(figure, {
        style: [...unoutlined, { property: "rx", value: `${ROUNDED_RADIUS}px` }, { property: "ry", value: `${ROUNDED_RADIUS}px` }],
      });
    case "circle": {
      const { midX, midY } = edgesOf(figure);
      return {
        element: "circle",
        attributes: [
          ["cx", midX],
          ["cy", midY],
          ["r", figure.width / 2],
        ],
        style: unoutlined,
      };
    }
  }
}

/** The label this node draws, if any: none for an icon node given no label. */
function labelOf(label: Size, node: GraphNode | undefined): Size {
  return node?.label.text === "" ? { width: 0, height: 0 } : label;
}

export const ICON_SHAPES = {
  icon: {
    box: (padded, _direction, _padding, node) => {
      const icon = iconOf(node);
      const side = figureSide(icon);
      const label = labelOf(padded, node);
      return {
        width: Math.max(side, label.width),
        height: side + (label.height > 0 ? FIGURE_LABEL_GAP + label.height : 0),
      };
    },
    labelRect: (box, padded, node) => {
      const label = labelOf(padded, node);
      return {
        x: box.x + (box.width - label.width) / 2,
        y: iconOf(node).pos === "t" ? box.y : box.y + box.height - label.height,
        width: label.width,
        height: label.height,
      };
    },
    frames: (node) => {
      const icon = iconOf(node);
      const figure = figureRect(node, icon);
      return [formFrame(node, figure, icon), ...glyphFrame(figure, icon, node)];
    },
  },
} as const satisfies Partial<Record<NodeShape, ShapeSpec>>;
