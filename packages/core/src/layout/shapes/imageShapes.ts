import type { GraphNode, NodeImage, NodeShape } from "../../contracts";
import { FIGURE_LABEL_GAP, rectFrame, type Rect, type ShapeSpec, type Size } from "./shape";

/**
 * The shape-table record of an image node (`A@{ img: "data:…" }`): the
 * image, over a rectangle in the node's paint, its label below it or, with
 * `pos: t`, above it — Mermaid 12.2.0's `imageSquare` handler, measured in
 * Chrome.
 *
 * Read off the node rather than the label alone: the image's natural size
 * and the size its author asked for are the node's own (`GraphNode.image`).
 */

/**
 * The narrowest a labelled image is drawn: the flowchart's `wrappingWidth`,
 * 120 (Mermaid's `imageRawWidth = max(label ? wrappingWidth : 0, …)`,
 * measured).
 */
const LABELLED_MIN_WIDTH = 120;

/**
 * An image node's `image` when it has none — a node built by hand, which no
 * parsed document makes: a 1 x 1 image with no source, so its proportions
 * are a number.
 */
const NO_IMAGE: NodeImage = { src: "", naturalWidth: 1, naturalHeight: 1, w: null, h: null, constraint: false, pos: "b" };

const imageOf = (node: GraphNode | undefined): NodeImage => node?.image ?? NO_IMAGE;

/** Whether `node` draws a label: an image node given none draws none. */
const labelled = (node: GraphNode | undefined) => node?.label.text !== "";

/**
 * The size the image is drawn at, as `imageSquare` sizes it: `w` (at least
 * 120 with a label) by `h`, each the natural one when not written; with
 * `constraint: on`, the natural proportions kept, the width from `h` when
 * given.
 */
function imageSize(image: NodeImage, withLabel: boolean): Size {
  const ratio = image.naturalWidth / image.naturalHeight;
  const raw = Math.max(withLabel ? LABELLED_MIN_WIDTH : 0, image.w ?? image.naturalWidth);
  if (image.constraint) {
    const width = image.h !== null ? image.h * ratio : raw;
    return { width, height: width / ratio };
  }
  return { width: raw, height: image.h ?? image.naturalHeight };
}

/** Where the image stands in `box`: at the top, or with `pos: t` at the bottom, centred across. */
function imageRect(box: Rect, node: GraphNode): Rect {
  const image = imageOf(node);
  const { width, height } = imageSize(image, labelled(node));
  return {
    x: box.x + (box.width - width) / 2,
    y: image.pos === "t" ? box.y + box.height - height : box.y,
    width,
    height,
  };
}

/** The label this node draws, if any. */
function labelOf(label: Size, node: GraphNode | undefined): Size {
  return labelled(node) ? label : { width: 0, height: 0 };
}

export const IMAGE_SHAPES = {
  image: {
    box: (padded, _direction, _padding, node) => {
      const image = imageSize(imageOf(node), labelled(node));
      const label = labelOf(padded, node);
      return {
        width: Math.max(image.width, label.width),
        height: image.height + (label.height > 0 ? FIGURE_LABEL_GAP + label.height : 0),
      };
    },
    labelRect: (box, padded, node) => {
      const label = labelOf(padded, node);
      return {
        x: box.x + (box.width - label.width) / 2,
        y: imageOf(node).pos === "t" ? box.y : box.y + box.height - label.height,
        width: label.width,
        height: label.height,
      };
    },
    frames: (node) => {
      const rect = imageRect(node, node);
      return [
        // Behind the image, in the node's paint, as Mermaid draws it.
        rectFrame(rect),
        // The image itself: a figure, stretched to its size. Its `href` is
        // a data URL the parser read the size of — the only kind it lets
        // through — so drawing it fetches nothing, and an SVG drawn as an
        // image runs no script and loads nothing.
        {
          element: "image",
          attributes: [
            ["href", imageOf(node).src],
            ["x", rect.x],
            ["y", rect.y],
            ["width", rect.width],
            ["height", rect.height],
            ["preserveAspectRatio", "none"],
          ],
          children: [],
        },
      ];
    },
  },
} as const satisfies Partial<Record<NodeShape, ShapeSpec>>;
