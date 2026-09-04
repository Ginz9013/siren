/**
 * Cross-module type contracts for @siren/core.
 *
 * This file holds every interface type shared between the parser, graph
 * model, layout, renderer, animation runtime, and public API modules. It is
 * frozen after ticket 01 lands: downstream tickets implement and test
 * against these shapes without waiting on each other's internals.
 *
 * Types and JSDoc only — no functions, no logic.
 */

/** Severity of a parse/build-time diagnostic. */
export type Severity = "error" | "warning";

/**
 * A diagnostic surfaced by any pipeline stage (parser, graph model, ...).
 * Diagnostics are always returned, never thrown, except for truly
 * unexpected internal errors (bugs).
 */
export interface Diagnostic {
  severity: Severity;
  message: string;
  line?: number;
  column?: number;
}

/** Flowchart layout direction, taken from the `flowchart TD|LR` header. */
export type Direction = "TD" | "LR";

/** Effect names accepted by `enter`/`exit` timeline actions. */
export type EnterExitEffect =
  | "fade"
  | "slide-left"
  | "slide-right"
  | "slide-top"
  | "slide-bottom";

/** Effect names accepted by `highlight` timeline actions. */
export type HighlightEffect = "outline" | "glow";

/** Verbs recognized in a `timeline:` block. */
export type TimelineActionKind = "enter" | "exit" | "highlight" | "unhighlight";

/** A node as declared in source, before graph-model resolution. */
export interface SirenNode {
  id: string;
  label: string;
  line?: number;
  column?: number;
}

/** A directed edge as declared in source, before edge-id assignment. */
export interface SirenEdge {
  from: string;
  to: string;
  line?: number;
  column?: number;
}

/**
 * One `step N: <verb> <id> [<effect>]` entry from the `timeline:` block.
 * `effect` is present for `enter`/`exit`/`highlight` and absent for
 * `unhighlight`.
 */
export interface TimelineEntry {
  kind: TimelineActionKind;
  step: number;
  targetId: string;
  effect?: EnterExitEffect | HighlightEffect;
  line?: number;
  column?: number;
}

/** The raw `timeline:` block as declared in source, before resolution. */
export interface SirenTimeline {
  entries: TimelineEntry[];
}

/**
 * The parsed flowchart document: a flowchart header, its nodes/edges, and
 * an optional timeline block. One arm of the `SirenDocument` union.
 */
export interface FlowchartDocument {
  kind: "flowchart";
  direction: Direction;
  nodes: SirenNode[];
  edges: SirenEdge[];
  timeline: SirenTimeline | null;
}

/**
 * The parsed document, tagged by diagram kind. Produced by `parseSiren`
 * (which dispatches on the source's header line to `parseFlowchart` or
 * `parseSequenceDiagram`).
 */
export type SirenDocument = FlowchartDocument | SequenceDocument;

/** Result of `parseSiren` (and, independently, `parseSequenceDiagram`). */
export interface ParseResult {
  document: SirenDocument | null;
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Sequence diagram — parser-level (pre graph-model) types
// ---------------------------------------------------------------------------

/** Whether a declared sequence-diagram lane is a `participant` (box) or `actor` (stick figure). */
export type SequenceParticipantKind = "participant" | "actor";

/**
 * Whether a participant's lifeline begins from the preamble (declared
 * before the first statement, box/icon rendered at both top and bottom of
 * the lifeline) or from a `create` statement partway through the diagram
 * (lifeline starts at that point, no top box/icon).
 */
export type SequenceParticipantOrigin = "declared" | "created";

/**
 * Line style of a message arrow — one of the two independent axes Mermaid's
 * ten arrow forms compose from.
 */
export type SequenceArrowLine = "solid" | "dotted";

/**
 * Arrowhead style of a message arrow — the other of the two independent
 * axes Mermaid's ten arrow forms compose from.
 */
export type SequenceArrowHead =
  | "none"
  | "filled"
  | "bidirectionalFilled"
  | "cross"
  | "open";

/** The two-axis description of a Mermaid sequence message arrow. */
export interface SequenceArrow {
  line: SequenceArrowLine;
  head: SequenceArrowHead;
}

/**
 * A `participant X [as Label]` / `actor X [as Label]` declaration, as it
 * appears in `SequenceDocument.participants` — a flat list in
 * first-declaration order, populated by both preamble declarations and
 * `create` statements. Use the corresponding `SequenceParticipantStatement`
 * (found at this id's declaring position in `statements`) to tell which.
 */
export interface SequenceParticipantDecl {
  id: string;
  label: string;
  participantKind: SequenceParticipantKind;
  line?: number;
  column?: number;
}

/**
 * A `box <color>? <label>? ... end` grouping of adjacent participant
 * declarations. `color` and `label` are both optional in Mermaid syntax.
 */
export interface SequenceBox {
  color: string | null;
  label: string | null;
  participantIds: string[];
  line?: number;
  column?: number;
}

/** One `A<arrow>B: text` message statement. */
export interface SequenceMessageStatement {
  kind: "message";
  from: string;
  to: string;
  text: string;
  arrow: SequenceArrow;
  line?: number;
  column?: number;
}

/**
 * A `participant X` / `actor X` (origin `"declared"`) or `create
 * participant X` / `create actor X` (origin `"created"`) statement, at the
 * position it appears in the flattened statement order.
 */
export interface SequenceParticipantStatement {
  kind: "participant";
  id: string;
  label: string;
  participantKind: SequenceParticipantKind;
  origin: SequenceParticipantOrigin;
  line?: number;
  column?: number;
}

/** A `destroy X` statement — the referenced participant's lifeline ends here. */
export interface SequenceDestroyStatement {
  kind: "destroy";
  id: string;
  line?: number;
  column?: number;
}

/** An `autonumber` statement — sequential message numbering turns on from here. */
export interface SequenceAutonumberOnStatement {
  kind: "autonumberOn";
  line?: number;
  column?: number;
}

/** An `autonumber off` statement — sequential message numbering turns off from here. */
export interface SequenceAutonumberOffStatement {
  kind: "autonumberOff";
  line?: number;
  column?: number;
}

/** A `loop <label>? ... end` block. */
export interface SequenceLoopStatement {
  kind: "loop";
  label: string | null;
  body: SequenceStatement[];
  line?: number;
  column?: number;
}

/** One branch of an `alt`/`else` block — the first branch is the `alt` condition, the rest are `else`. */
export interface SequenceAltBranch {
  label: string | null;
  body: SequenceStatement[];
}

/** An `alt <cond> ... (else <cond>)* ... end` block. */
export interface SequenceAltStatement {
  kind: "alt";
  branches: SequenceAltBranch[];
  line?: number;
  column?: number;
}

/** An `opt <label>? ... end` block. */
export interface SequenceOptStatement {
  kind: "opt";
  label: string | null;
  body: SequenceStatement[];
  line?: number;
  column?: number;
}

/** One branch of a `par`/`and` block — the first branch is the `par` condition, the rest are `and`. */
export interface SequenceParBranch {
  label: string | null;
  body: SequenceStatement[];
}

/** A `par <label>? ... (and <label>?)* ... end` block. */
export interface SequenceParStatement {
  kind: "par";
  branches: SequenceParBranch[];
  line?: number;
  column?: number;
}

/** One branch of a `critical`/`option` block — the first branch is the `critical` condition, the rest are `option`. */
export interface SequenceCriticalBranch {
  label: string | null;
  body: SequenceStatement[];
}

/** A `critical <label>? ... (option <label>?)* ... end` block. */
export interface SequenceCriticalStatement {
  kind: "critical";
  branches: SequenceCriticalBranch[];
  line?: number;
  column?: number;
}

/** A `break <label>? ... end` block. */
export interface SequenceBreakStatement {
  kind: "break";
  label: string | null;
  body: SequenceStatement[];
  line?: number;
  column?: number;
}

/** A `rect rgb(...)|rgba(...) ... end` background-highlight block. */
export interface SequenceRectStatement {
  kind: "rect";
  color: string;
  body: SequenceStatement[];
  line?: number;
  column?: number;
}

/**
 * One node in the sequence diagram's recursive body tree, in source order.
 * Leaf kinds (`message`, `participant`, `destroy`, `autonumberOn`,
 * `autonumberOff`) are the only ones ticket 01's parser produces; block
 * kinds are recognized by later tickets but declared here now so the
 * contract never needs to change shape again.
 */
export type SequenceStatement =
  | SequenceMessageStatement
  | SequenceParticipantStatement
  | SequenceDestroyStatement
  | SequenceAutonumberOnStatement
  | SequenceAutonumberOffStatement
  | SequenceLoopStatement
  | SequenceAltStatement
  | SequenceOptStatement
  | SequenceParStatement
  | SequenceCriticalStatement
  | SequenceBreakStatement
  | SequenceRectStatement;

/**
 * The parsed `sequenceDiagram` source: title, flat participants list, box
 * groupings, and the recursive statement tree. Produced by
 * `parseSequenceDiagram`. One arm of the `SirenDocument` union.
 */
export interface SequenceDocument {
  kind: "sequence";
  title: string | null;
  participants: SequenceParticipantDecl[];
  boxes: SequenceBox[];
  statements: SequenceStatement[];
}

// ---------------------------------------------------------------------------
// Sequence diagram — graph-model (post `buildSequenceModel`) types
// ---------------------------------------------------------------------------

/**
 * A participant after graph-model resolution: its lifeline's extent as
 * statement-order positions. `createdAt`/`destroyedAt` are indices into the
 * model's flattened statement order (not pixel positions — that's
 * `layoutSequence`'s job).
 */
export interface ResolvedSequenceParticipant {
  id: string;
  label: string;
  participantKind: SequenceParticipantKind;
  origin: SequenceParticipantOrigin;
  /** Flattened-statement-order index the lifeline begins at (0 for a preamble declaration). */
  createdAt: number;
  /** Flattened-statement-order index the lifeline ends at, or `null` if never destroyed. */
  destroyedAt: number | null;
}

/** A message after graph-model resolution: assigned id and resolved autonumber. */
export interface ResolvedSequenceMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  arrow: SequenceArrow;
  /** Sequential autonumber label, or `null` when autonumbering was off for this message. */
  autonumber: number | null;
}

/** One resolved branch of a block, mirroring `SequenceAltBranch`/`SequenceParBranch`/`SequenceCriticalBranch` post-resolution. */
export interface ResolvedSequenceBranch {
  label: string | null;
  statements: ResolvedSequenceStatement[];
}

/** A block after graph-model resolution: assigned id and its recursive participant-touch set. */
export interface ResolvedSequenceBlock {
  id: string;
  kind: "loop" | "alt" | "opt" | "par" | "critical" | "break" | "rect";
  /** Every participant lane touched anywhere in this block's body, recursively — used to compute the block's horizontal extent. */
  touchedParticipantIds: string[];
  branches: ResolvedSequenceBranch[];
}

/** One node in the resolved statement tree, mirroring `SequenceStatement` post-resolution. */
export type ResolvedSequenceStatement =
  | { kind: "message"; message: ResolvedSequenceMessage }
  | { kind: "participant"; participant: ResolvedSequenceParticipant }
  | { kind: "destroy"; id: string }
  | { kind: "block"; block: ResolvedSequenceBlock };

/** A box after graph-model resolution: assigned id. */
export interface ResolvedSequenceBox {
  id: string;
  color: string | null;
  label: string | null;
  participantIds: string[];
}

/**
 * The normalized in-memory sequence diagram produced by
 * `buildSequenceModel`: resolved ids, resolved lifeline extents, resolved
 * block participant-touch sets.
 */
export interface SequenceModel {
  title: string | null;
  participants: ResolvedSequenceParticipant[];
  boxes: ResolvedSequenceBox[];
  statements: ResolvedSequenceStatement[];
}

/** Result of `buildSequenceModel`. */
export interface SequenceModelResult {
  model: SequenceModel | null;
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Sequence diagram — layout (post `layoutSequence`) types
// ---------------------------------------------------------------------------

/** A participant with layout-assigned lane position and lifeline extent. */
export interface PositionedParticipant {
  id: string;
  label: string;
  participantKind: SequenceParticipantKind;
  origin: SequenceParticipantOrigin;
  /** Lane center x-coordinate. */
  x: number;
  /** Lifeline's top y-coordinate (box/icon top, or the `create` statement's y if `origin: "created"`). */
  top: number;
  /** Lifeline's bottom y-coordinate (diagram bottom, or the destroy mark's y if destroyed). */
  bottom: number;
  width: number;
  height: number;
}

/** A message with layout-assigned y-coordinate and endpoint x-coordinates. */
export interface PositionedMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  arrow: SequenceArrow;
  autonumber: number | null;
  y: number;
  fromX: number;
  toX: number;
}

/** A destroy mark (the X at a lifeline's truncation point) with layout-assigned position. */
export interface PositionedDestroyMark {
  participantId: string;
  x: number;
  y: number;
}

/** One element of a block's positioned body, in document order. */
export type PositionedSequenceElement =
  | { kind: "message"; message: PositionedMessage }
  | { kind: "block"; block: PositionedBlock }
  | { kind: "destroyMark"; mark: PositionedDestroyMark };

/** A branch divider (used for `else`/`and`/`option`) with layout-assigned position. */
export interface PositionedBlockDivider {
  label: string | null;
  y: number;
}

/** A block with layout-assigned bounding box spanning the lanes it touches. */
export interface PositionedBlock {
  id: string;
  kind: "loop" | "alt" | "opt" | "par" | "critical" | "break" | "rect";
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  /** One entry per branch after the first (`else`/`and`/`option`). */
  dividers: PositionedBlockDivider[];
  children: PositionedSequenceElement[];
}

/** A box grouping with layout-assigned background-rect position. */
export interface PositionedBox {
  id: string;
  color: string | null;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The sequence diagram after layout: positioned participants/messages/
 * blocks/boxes/destroy-marks, ready for `renderSequenceToSVG`.
 */
export interface PositionedSequenceDiagram {
  title: string | null;
  participants: PositionedParticipant[];
  boxes: PositionedBox[];
  /** Messages, blocks, and destroy marks, in document order. */
  elements: PositionedSequenceElement[];
  width: number;
  height: number;
}

/** A node after graph-model resolution (duplicates merged, ids validated). */
export interface GraphNode {
  id: string;
  label: string;
}

/** An edge after graph-model resolution, carrying its assigned id. */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
}

/**
 * One resolved timeline entry, referencing a validated graph node/edge id.
 * `effect` is present for `enter`/`exit`/`highlight` and absent for
 * `unhighlight`.
 */
export interface ResolvedTimelineEntry {
  kind: TimelineActionKind;
  step: number;
  targetId: string;
  effect?: EnterExitEffect | HighlightEffect;
}

/** The timeline after resolution against the graph's node/edge ids. */
export interface ResolvedTimeline {
  totalSteps: number;
  entries: ResolvedTimelineEntry[];
}

/**
 * The normalized in-memory graph produced by `buildGraphModel`: validated
 * nodes/edges with assigned edge ids, plus the resolved timeline.
 */
export interface GraphModel {
  direction: Direction;
  nodes: GraphNode[];
  edges: GraphEdge[];
  timeline: ResolvedTimeline;
}

/**
 * Result of `buildGraphModel`. Carries both `graph` (flowchart) and `model`
 * (sequence) so the one dispatcher function can return either shape;
 * exactly one of the two is non-null, matching the `SirenDocument.kind` of
 * the document it resolved.
 */
export interface GraphModelResult {
  graph: GraphModel | null;
  model: SequenceModel | null;
  diagnostics: Diagnostic[];
}

/** A 2D point used for edge path routing. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Injectable text-measurement seam used by `layoutGraph` for label sizing.
 * Production wires a canvas/DOM-based measurer; tests use a deterministic
 * fake.
 */
export interface TextMeasurer {
  measure(text: string): { width: number; height: number };
}

/** Options accepted by `layoutGraph`. */
export interface LayoutOptions {
  measureText: TextMeasurer;
}

/**
 * A node with layout-assigned position and size.
 *
 * `x`/`y` are the top-left corner of the bounding box (matches SVG `<rect x y>`
 * directly) — not the center. `layoutGraph` is responsible for converting from
 * dagre's center-based coordinates before returning.
 */
export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An edge with a layout-assigned point path. */
export interface PositionedEdge extends GraphEdge {
  points: Point[];
}

/**
 * The graph after layout: positioned nodes/edges plus the resolved
 * timeline, ready for `renderToSVG`.
 */
export interface PositionedGraph {
  direction: Direction;
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  timeline: ResolvedTimeline;
  width: number;
  height: number;
}

/**
 * Caller-driven step-reveal controller returned by
 * `createAnimationController`. `next()` reveals the next step's elements;
 * `prev()` jumps back one step instantly (no transition), to the DOM state
 * `next()` would have produced at that step; `reset()` restores the initial
 * pending state.
 */
export interface AnimationController {
  totalSteps: number;
  currentStep: number;
  next(): void;
  prev(): void;
  reset(): void;
}

/** Result of the public `render()` entry point. */
export interface SirenRenderResult {
  svg: SVGSVGElement | null;
  controller: AnimationController | null;
  diagnostics: Diagnostic[];
}
