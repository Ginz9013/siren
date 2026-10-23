/**
 * What the adapters over the shared layout core (`layoutDirectedGraph`) do
 * alike with a grouping frame — a flowchart subgraph, a class namespace, an
 * ER block, and the padding of a state composite: how far the frame clears
 * what it holds, how its title is measured, how it is handed to the core as
 * a cluster, the order Mermaid hands such frames to ELK in, and how the
 * frame the core placed becomes a positioned group.
 *
 * Shared mechanics with caller-specific padding: flowchart keeps more room
 * inside its frames, while other diagram kinds retain the shared default.
 */
import type { Direction, Label, LabelBox, PlacedLabel, TextMeasurer } from "../contracts";
import { DEFAULT_TYPOGRAPHY, type LabelSizes } from "../label/label";
import { baseSizeSpacing, layoutLabel } from "../label/layoutLabel";
import type { DirectedGraphNode, DirectedGraphNodeBox } from "./layoutDirectedGraph";

/**
 * How far a grouping frame clears the boxes and frames it holds on every
 * side, and — doubled, with the title line between the two halves — how tall
 * the strip along its top is.
 *
 * The default for grouping frames: measured with
 * `--markup`, Mermaid draws a flowchart subgraph, an ER block and a state
 * composite alike as a `g.cluster` holding a `<rect>` and a title. Which
 * pixel count it is remains Siren's (ADR-0004). Flowchart overrides this
 * default to give its nodes and subgraphs more breathing room.
 */
export const SUBGRAPH_PADDING = 12;

/**
 * Each frame's title as `layoutLabel` measured it, by the frame's id — every
 * row of it, so a `<br>` makes the band taller (ADR-0015). Measured once, so
 * the band the core keeps in the frame and the title the renderer draws are
 * the same box. Never wrapped: Mermaid draws a frame's title as plain text,
 * which it does not wrap (the label-wrap ADR, nook `01M4R4WDZ`).
 *
 * At `sizes.fontSize`, the `Typography.fontSize` the measurer measures at
 * (`baseSizeSpacing`): a frame's title is drawn at `--siren-font-size`, not
 * at the title size, which is a sequence diagram's `.siren-title` alone.
 * `sizes` defaults to `DEFAULT_TYPOGRAPHY`.
 */
export function measureTitles(
  groups: readonly { id: string; label: Label }[],
  measureText: TextMeasurer,
  sizes: LabelSizes = DEFAULT_TYPOGRAPHY,
): Map<string, LabelBox> {
  const spacing = baseSizeSpacing(sizes);
  return new Map(groups.map((group) => [group.id, layoutLabel(group.label, measureText, spacing)] as const));
}

/**
 * A grouping frame as the core is handed it: a cluster, which the core sizes
 * and places — around its members, its padding and a band for its title —
 * and whose members it lays out in `direction` while no edge voids it (the
 * **Boundary-crossing edge** rule, Mermaid 12's). The adapter only says how
 * much padding and how big a title (nook decision
 * `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 2: nothing moves a box or a frame
 * afterwards). Its own `width`/`height` are 0: the core ignores them for a
 * cluster. A frame drawn with no title (a state diagram's concurrent region)
 * gives none, and the core keeps plain padding where the band would be.
 */
export function clusterNode(group: {
  id: string;
  parentId?: string | null;
  title?: { width: number; height: number } | null;
  direction?: Direction | null;
  padding?: number;
}): DirectedGraphNode {
  return {
    id: group.id,
    width: 0,
    height: 0,
    ...(group.parentId === undefined || group.parentId === null ? {} : { parentId: group.parentId }),
    cluster: {
      padding: group.padding ?? SUBGRAPH_PADDING,
      ...(group.title === undefined || group.title === null ? {} : { title: group.title }),
      ...(group.direction === undefined || group.direction === null ? {} : { direction: group.direction }),
    },
  };
}

/**
 * The frame the core placed, as a positioned group: its box, and its title
 * centred where the core put it across the band — centred, or moved along it
 * clear of the routes crossing it.
 */
export function placedFrame(
  frame: DirectedGraphNodeBox,
  label: Label,
  labelBox: LabelBox,
): { label: PlacedLabel; x: number; y: number; width: number; height: number } {
  return {
    label: { label, labelBox, anchor: frame.title! },
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
  };
}

/**
 * The frames in the order Mermaid hands them to ELK, given in the order the
 * keywords *opened* (`subgraph:1`, `subgraph:2`, …), parents before children.
 *
 * Mermaid 12.2.0's `FlowDB.getData` (`chunk-LJKG65JO.mjs`, line 963) and `ErDB.getData`
 * (`erDiagram-VZDIDQZ7.mjs`, line 1340) both list every frame before any box,
 * walking their frame list **backwards** — and that list is in the order the
 * frames *closed*, because the parser records one when it reduces the `end`
 * (`erDiagram-VZDIDQZ7.mjs`, line 189). So an inner frame precedes its parent
 * there, and reversed, a parent precedes its children and the last sibling
 * the first. The closing order is the opening order's tree walked
 * children-first.
 *
 * This is how the frames come out in Mermaid's picture, not a choice made
 * here. Measured in headless Chrome against Mermaid 12.2.0, for the
 * flowchart and the ER diagram alike: `subgraph SA { A }`, `subgraph SB { B
 * }`, then a box `X` draws SB, SA, X from left to right, whether `X` is
 * declared first or last; `O { I1 { A }, I2 { B }, C }` draws C, I2, I1
 * inside O.
 */
export function mermaidClosingOrder<T extends { id: string; parentId: string | null }>(groups: readonly T[]): T[] {
  const closed: T[] = [];
  const close = (parentId: string | null) => {
    for (const group of groups.filter((candidate) => candidate.parentId === parentId)) {
      close(group.id);
      closed.push(group);
    }
  };
  close(null);
  return closed.reverse();
}
