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

/**
 * Layout direction, shared by every diagram kind that has one: a flowchart's
 * `flowchart ...` header and a class diagram's `direction` statement. `TD` is
 * Mermaid's alias for `TB` and is normalized away by the parser (see
 * `normalizeDirection`), so nothing downstream ever sees it.
 *
 * `layoutDirectedGraph` takes this type directly as its `rankdir` — the four
 * values are dagre's own, so there is nothing left to map.
 */
export type Direction = "TB" | "BT" | "LR" | "RL";

/**
 * The shape a flowchart node is drawn as — the *kind* of outline, never its
 * proportions. Mermaid spells fourteen of them with brackets, and the
 * compatibility condition is that `A{X}` draws a diamond, not that the
 * diamond is Mermaid's own diamond: Siren has had its own theme, font and
 * spacing since ADR-0004, so it has never drawn a Mermaid-identical
 * picture, and geometry is no different.
 *
 * The full set is named here rather than grown one member at a time, so
 * that every stage downstream is written against the finished vocabulary
 * and a shape arriving later is an implementation, not a contract change.
 * All fourteen have since landed, so this type and what the parser accepts
 * are now the same set: no member of this union is refused anywhere.
 */
export type NodeShape =
  | "rect"
  | "round"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "double-circle"
  | "asymmetric"
  | "rhombus"
  | "hexagon"
  | "parallelogram"
  | "parallelogram-alt"
  | "trapezoid"
  | "trapezoid-alt";

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
  /**
   * The shape its bracket spelling named — `"rect"` for a bare `A`, for
   * `A[label]`, and for `A:::name`.
   *
   * Required, not optional, for the reason `GraphNode.style` is: an absent
   * field would make "no shape" a second state that every reader has to
   * fold into `"rect"` for itself, and one of them eventually would not.
   */
  shape: NodeShape;
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
 * A `linkStyle 0 stroke:#f00` statement, as written — the one author-styling
 * statement that reaches an edge, and the one that does not address its
 * targets by id.
 *
 * It is kept apart from `StyleDecl` for exactly that reason. Mermaid
 * addresses an edge by its declaration index, and an index is an authored
 * spelling rather than a name: `buildFlowchartModel` resolves it to the edge
 * id (`A-B`, `A-B#2`) that `timeline:` and `data-siren-id` already use, and
 * hands the shared `resolveStyles` a `StyleDecl` like any other. Putting an
 * index into `StyleDecl.targetIds` — a field every diagram kind reads as
 * ids — would give one edge two names and let one of them travel.
 */
export interface LinkStyleDecl {
  /**
   * The edges this statement addresses, exactly as authored and in the
   * order written: a zero-based declaration index (`"0"`), or `"default"`
   * for every edge in the document.
   *
   * Deliberately not `targetIds`: these are addresses, not ids, and nothing
   * has checked yet that any of them names an edge. Whether `"0"` resolves,
   * and to what, is `buildFlowchartModel`'s question — the parser owns only
   * the statement's shape.
   */
  targets: string[];
  /** The declarations to apply, in author order. Values are not validated
   * here — the gate is `resolveStyles`', reached once the addresses have
   * become ids. */
  properties: StyleProperty[];
  line?: number;
  column?: number;
}

/**
 * The parsed flowchart document: a flowchart header, its nodes/edges, its
 * author-styling statements, and an optional timeline block. One arm of the
 * `SirenDocument` union.
 */
export interface FlowchartDocument {
  kind: "flowchart";
  direction: Direction;
  nodes: SirenNode[];
  edges: SirenEdge[];
  /**
   * Author-styling statements as written, in source order. The same
   * `StyleDecl` a class diagram parses to — the contract is the language's,
   * not one kind's — so `resolveStyles` reads both without knowing which
   * kind it was handed.
   */
  styles: StyleDecl[];
  /**
   * `linkStyle` statements as written, in source order — the edge half of
   * author styling, which `styles` cannot express because it addresses its
   * targets by index rather than by id.
   *
   * Empty when the author wrote none, never absent, so "styled no edge" is
   * one state rather than two.
   */
  linkStyles: LinkStyleDecl[];
  timeline: SirenTimeline | null;
}

/**
 * The parsed document, tagged by diagram kind. Produced by `parseSiren`
 * (which dispatches on the source's header line to `parseFlowchart`,
 * `parseSequenceDiagram` or `parseClassDiagram`).
 */
export type SirenDocument = FlowchartDocument | SequenceDocument | ClassDocument;

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
 * groupings, the recursive statement tree, and an optional timeline block.
 * Produced by `parseSequenceDiagram`. One arm of the `SirenDocument` union.
 */
export interface SequenceDocument {
  kind: "sequence";
  title: string | null;
  participants: SequenceParticipantDecl[];
  boxes: SequenceBox[];
  statements: SequenceStatement[];
  /**
   * The `timeline:` block as written, or `null` when the document declares
   * none at all (as opposed to declaring an empty one) — the same
   * distinction `FlowchartDocument` and `ClassDocument` draw. The ids in it
   * are resolved by `buildSequenceModel` and nowhere else.
   */
  timeline: SirenTimeline | null;
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
 * block participant-touch sets, and the resolved timeline.
 */
export interface SequenceModel {
  title: string | null;
  participants: ResolvedSequenceParticipant[];
  boxes: ResolvedSequenceBox[];
  statements: ResolvedSequenceStatement[];
  timeline: ResolvedTimeline;
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
 * The sequence diagram after layout: positioned participants, messages,
 * control-flow blocks, box groupings and destroy marks, plus the resolved
 * timeline, ready for
 * `renderSequenceToSVG`.
 */
export interface PositionedSequenceDiagram {
  title: string | null;
  participants: PositionedParticipant[];
  boxes: PositionedBox[];
  /** Messages, blocks, and destroy marks, in document order. */
  elements: PositionedSequenceElement[];
  /** Carried through `layoutSequence` unchanged; the rules are `resolveTimeline`'s. */
  timeline: ResolvedTimeline;
  width: number;
  height: number;
}

/** A node after graph-model resolution (duplicates merged, ids validated). */
export interface GraphNode {
  id: string;
  label: string;
  /**
   * The shape this node is drawn as, carried unchanged from the spelling
   * the author used. Required for the same reason `style` is: "no shape"
   * is not a second state, it is `"rect"`.
   *
   * Layout reads it to decide how much bounding box the label needs — a
   * label fits inside the *shape*, not inside the box the shape is
   * inscribed in — and the renderer reads it to decide what element to
   * draw. Neither of them re-derives it from the source.
   */
  shape: NodeShape;
  /**
   * Author declarations to emit as this node's inline `style` attributes, in
   * declaration order, with rejected values already dropped and each half
   * addressed to one of the node's two drawn elements — the frame rect and
   * the label `<text>`.
   *
   * Each half is empty when the author styled nothing — never absent — so
   * "no styling" is one state rather than two, and the renderer's "emit no
   * attribute" case is a length check rather than a presence check.
   */
  style: AuthorStyle;
}

/** An edge after graph-model resolution, carrying its assigned id. */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /**
   * Author declarations to emit as this edge's inline `style` attribute, in
   * declaration order, with rejected values already dropped — the same
   * shape, and the same empty-not-absent rule, as `GraphNode.style`.
   *
   * An edge is drawn as one `<path>` and nothing else, so only `frame` has
   * anywhere to land: a `linkStyle 0 color:#f00` fills `text` with a
   * declaration the renderer has no element for. The routing rule stays
   * kind-neutral on purpose — `resolveStyles` is read by three diagram
   * kinds and knows what a declaration *means*, not what each kind draws.
   *
   * The author wrote them as `linkStyle 0`, addressing this edge by its
   * declaration index. That index is gone by the time it reaches this
   * field: `buildFlowchartModel` resolved it to `id`, so an edge has one
   * name downstream of the model rather than a name and a position.
   */
  style: AuthorStyle;
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
 * Result of `buildGraphModel`. Carries `graph` (flowchart), `model`
 * (sequence) and `classModel` (class) so the one dispatcher function can
 * return any of the three shapes.
 *
 * At most one is non-null, matching the `SirenDocument.kind` of the document
 * it resolved — not exactly one, because a stage that fails resolution
 * returns all three null alongside an error-severity diagnostic explaining
 * why. A caller must therefore branch on the field it expects being non-null,
 * never assume the other two being null means its own is populated.
 */
export interface GraphModelResult {
  graph: GraphModel | null;
  model: SequenceModel | null;
  classModel: ClassModel | null;
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
  /**
   * The step-reveal controller, or `null` **only** when rendering failed and
   * `svg` is `null` too -- the two are always null together.
   *
   * It used to also be null for a sequence diagram, which had no animation
   * integration. That is gone: every diagram kind now returns a controller,
   * and a document with no `timeline:` block returns one with
   * `totalSteps: 0` rather than nothing. So a caller that has checked `svg`
   * has already checked this.
   */
  controller: AnimationController | null;
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Class diagram — parser-level (pre graph-model) types
// ---------------------------------------------------------------------------

/** Whether a class member is an attribute (no parameter list) or a method. */
export type ClassMemberKind = "attribute" | "method";

/**
 * A member's visibility marker, stored as the character the author wrote —
 * which is also the character the renderer prints: `+` public, `-` private,
 * `#` protected, `~` package/internal.
 */
export type ClassMemberVisibility = "+" | "-" | "#" | "~";

/**
 * A member's classifier, stored as the character the author wrote: `*`
 * abstract, `$` static. Mermaid appends it to the end of the member line.
 */
export type ClassMemberClassifier = "*" | "$";

/**
 * One attribute or method line of a class. Every part is kept as written,
 * so the source line can be reconstructed from the parts (that is how the
 * renderer prints it) without the parser having to keep the raw string.
 */
export interface ClassMember {
  memberKind: ClassMemberKind;
  visibility: ClassMemberVisibility | null;
  classifier: ClassMemberClassifier | null;
  name: string;
  /** An attribute's type (`int` in `+int size`), or `null` when untyped. Always `null` for a method. */
  type: string | null;
  /** A method's parameter text between its parens, `""` for `()`. Always `null` for an attribute. */
  parameters: string | null;
  /** A method's return type (`bool` in `+swim() bool`), or `null` when it declares none. */
  returnType: string | null;
  line?: number;
  column?: number;
}

/**
 * One `class X`, `class X { ... }` or `X : member` declaration, as written.
 * The parser does not merge repeat declarations of the same name — that is
 * `buildClassModel`'s job — so the same id may appear more than once.
 */
export interface ClassDecl {
  id: string;
  /** Generic parameter text between the `~`s (`Shape` in `class Square~Shape~`), or `null`. */
  generic: string | null;
  /** Annotation text without its `<<`/`>>` (`interface`), or `null`. */
  annotation: string | null;
  members: ClassMember[];
  line?: number;
  column?: number;
}

/**
 * Line style of a relationship — one of the two axes Mermaid's eight
 * relationship forms compose from.
 */
export type ClassRelationshipLine = "solid" | "dashed";

/**
 * The marker drawn at one end of a relationship — the other axis. `<|`/`|>`
 * is a `triangle`, `*` a `diamondFilled`, `o` a `diamondHollow`, `<`/`>` an
 * `arrow`, and a bare end is `none`.
 */
export type ClassRelationshipEnd =
  | "none"
  | "triangle"
  | "diamondFilled"
  | "diamondHollow"
  | "arrow";

/**
 * One relationship statement between two classes.
 *
 * The relationship *type* is the `{ line, fromEnd, toEnd }` triple rather
 * than one of eight opaque names, so the renderer switches on two small
 * enums and every Mermaid spelling — including the mirrored ones
 * (`Duck --|> Animal` for `Animal <|-- Duck`) — lands in the same model.
 *
 * Source position is `sourceLine`/`sourceColumn` here, not the `line`/
 * `column` used everywhere else in this file, because `line` already names
 * the relationship's line style.
 */
export interface ClassRelationship {
  from: string;
  to: string;
  line: ClassRelationshipLine;
  fromEnd: ClassRelationshipEnd;
  toEnd: ClassRelationshipEnd;
  /** The `: label` text, or `null`. */
  label: string | null;
  /** The quoted multiplicity next to `from` (`"1"` in `Customer "1" --> "*" Ticket`), or `null`. */
  fromMultiplicity: string | null;
  /** The quoted multiplicity next to `to` (`"*"` in the same example), or `null`. */
  toMultiplicity: string | null;
  sourceLine?: number;
  sourceColumn?: number;
}

/**
 * A `namespace Name { ... }` grouping. Its member classes also appear in
 * `ClassDocument.classes` as ordinary declarations; this only records the
 * grouping.
 */
export interface ClassNamespace {
  id: string;
  classIds: string[];
  line?: number;
  column?: number;
}

/** A `note "text"` (free) or `note for X "text"` (attached) statement. */
export interface ClassNote {
  text: string;
  /** The class this note is attached to, or `null` for a free note. */
  targetId: string | null;
  line?: number;
  column?: number;
}

/**
 * Whether an interaction navigates to a URL (`click X href "..."`, `link X
 * "..."`) or invokes a caller-supplied callback (`click X call fn()`,
 * `callback X "fn"`).
 */
export type ClassInteractionKind = "href" | "call";

/**
 * A `click`/`link`/`callback` statement making a class interactive, as
 * written. The URL allowlist is applied later, by `buildClassModel` — the
 * parser only records syntax.
 */
export interface ClassInteraction {
  interactionKind: ClassInteractionKind;
  classId: string;
  /** The URL for `href`, or the callback function name for `call`. */
  action: string;
  /** The literal argument of a `call fn("arg")` form, or `null`. */
  argument: string | null;
  /** The optional trailing tooltip string, or `null`. */
  tooltip: string | null;
  line?: number;
  column?: number;
}

/** One `property:value` pair of an author style declaration. */
export interface StyleProperty {
  property: string;
  value: string;
}

/**
 * One target's accepted author declarations, already split by which of the
 * target's drawn elements each one is emitted onto.
 *
 * The split is made in `resolveStyles` and nowhere else, so a flowchart and
 * a class diagram cannot end up with two opinions about what a text
 * property is. A renderer receives the answer and picks the element.
 *
 * Both halves are empty rather than absent when the author declared
 * nothing for them, so "no styling" stays one state, as `GraphNode.style`
 * has always had it.
 */
export interface AuthorStyle {
  /**
   * The declarations bound for the shape the target is drawn as — a node's
   * or a class's frame rect, an edge's whole path.
   */
  frame: StyleProperty[];
  /**
   * The declarations bound for the target's label text, in the vocabulary
   * SVG paints text with: an author's `color` arrives here spelled `fill`,
   * because an inline `color` sits in a different property and would never
   * reach a `<text>`. Empty for a target the author gave no `color`, and
   * ignored by a target that draws no text at all — a flowchart edge.
   */
  text: StyleProperty[];
}

/**
 * What an author-styling statement *does*, with each diagram kind's spelling
 * already normalized away.
 *
 * `apply` is the apply-directive — Mermaid's `cssClass` in a class diagram
 * and its `class` in a flowchart. It is named for the role rather than for
 * either spelling: `class` would read inside this package as "a class
 * diagram's class", the sense `ClassDecl`, `classIds` and `ResolvedClass`
 * already own, and `cssClass` is one kind's word for a statement both kinds
 * write. The spelling an author used survives in `StyleDecl.authoredAs`.
 */
export type StyleDeclKind = "style" | "classDef" | "apply";

/**
 * A `style X fill:#fdd`, `classDef name fill:#fdd`, or apply-directive
 * (`cssClass "A,B" name`) statement, as written. Values are not validated
 * here — rejecting `url(`/`expression(` is `resolveStyles`' job.
 */
export interface StyleDecl {
  styleKind: StyleDeclKind;
  /**
   * The keyword the author actually typed, which is the only thing a
   * diagnostic about this statement may quote.
   *
   * `styleKind` is what the statement *means* and is normalized at the
   * parser, so it cannot answer this: a flowchart spells the
   * apply-directive `class` and a class diagram spells it `cssClass`, and
   * both arrive here as one kind. Telling an author who wrote `class` that
   * their `cssClass` is wrong points at a line they never wrote.
   */
  authoredAs: string;
  /**
   * The ids this statement targets — one for `style`, one or more for the
   * apply-directive, none for `classDef`, which defines rather than
   * targets.
   *
   * Not `classIds`: since flowchart gained `style`, these are as often node
   * ids as class ids, and `resolveStyles` — the one resolver both kinds
   * call — already read them as targets. `ClassNamespace.classIds` keeps
   * that name because its members really are classes.
   */
  targetIds: string[];
  /** The definition name of `classDef`/`apply`; `null` for `style`. */
  name: string | null;
  /** The declarations of `style`/`classDef`; empty for `apply`. */
  properties: StyleProperty[];
  line?: number;
  column?: number;
}

/**
 * The parsed `classDiagram` (or `classDiagram-v2`) source: classes,
 * relationships, namespaces, notes, interaction and styling directives, and
 * an optional timeline block. Produced by `parseClassDiagram`. One arm of
 * the `SirenDocument` union.
 */
export interface ClassDocument {
  kind: "class";
  direction: Direction;
  classes: ClassDecl[];
  relationships: ClassRelationship[];
  namespaces: ClassNamespace[];
  notes: ClassNote[];
  interactions: ClassInteraction[];
  styles: StyleDecl[];
  timeline: SirenTimeline | null;
}

// ---------------------------------------------------------------------------
// Class diagram — graph-model (post `buildClassModel`) types
// ---------------------------------------------------------------------------

/**
 * A class after model resolution: repeat declarations of the same name
 * merged into one, and its namespace membership resolved.
 */
export interface ResolvedClass {
  id: string;
  generic: string | null;
  annotation: string | null;
  members: ClassMember[];
  /** The namespace this class belongs to, or `null` when it belongs to none. */
  namespaceId: string | null;
}

/**
 * A relationship after model resolution: assigned the id the timeline and
 * the renderer address it by, following the flowchart edge convention —
 * `${from}-${to}`, then `#2`, `#3`, ... for repeats of the same pair.
 */
export interface ResolvedClassRelationship {
  id: string;
  from: string;
  to: string;
  line: ClassRelationshipLine;
  fromEnd: ClassRelationshipEnd;
  toEnd: ClassRelationshipEnd;
  label: string | null;
  fromMultiplicity: string | null;
  toMultiplicity: string | null;
}

/** A namespace after model resolution: assigned id, membership resolved. */
export interface ResolvedClassNamespace {
  id: string;
  label: string;
  classIds: string[];
}

/** A note after model resolution: assigned id, attachment resolved. */
export interface ResolvedClassNote {
  id: string;
  text: string;
  /** The class this note is attached to, or `null` for a free note. */
  targetId: string | null;
}

/**
 * An interaction after model resolution: target resolved and the URL
 * checked against the `http`/`https`/`mailto` allowlist (a rejected one is
 * dropped with an error diagnostic and never reaches here).
 */
export interface ResolvedClassInteraction {
  classId: string;
  interactionKind: ClassInteractionKind;
  action: string;
  argument: string | null;
  tooltip: string | null;
}

/**
 * Author styling after model resolution: an apply-directive's `classDef`
 * flattened onto each target it applies to, in declaration order, with
 * rejected values already dropped and the survivors split between the
 * target's frame and its label text.
 *
 * `targetId` is a target's id in the sense the glossary gives that word —
 * the authored thing a style is attached to — so it is a class in a class
 * diagram and a node in a flowchart, and this type never has to know which.
 */
export interface ResolvedStyle {
  targetId: string;
  style: AuthorStyle;
}

/**
 * The normalized in-memory class diagram produced by `buildClassModel`:
 * merged classes, identified relationships, resolved namespaces, notes,
 * interactions and styles, and the resolved timeline.
 */
export interface ClassModel {
  direction: Direction;
  classes: ResolvedClass[];
  relationships: ResolvedClassRelationship[];
  namespaces: ResolvedClassNamespace[];
  notes: ResolvedClassNote[];
  interactions: ResolvedClassInteraction[];
  styles: ResolvedStyle[];
  timeline: ResolvedTimeline;
}

/** Result of `buildClassModel`. */
export interface ClassModelResult {
  model: ClassModel | null;
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Class diagram — layout (post `layoutClassDiagram`) types
// ---------------------------------------------------------------------------

/** One member line with the position its text is drawn at. */
export interface PositionedClassMember {
  /** The member's rendered text, e.g. `+int size` or `+swim() bool`. */
  text: string;
  x: number;
  y: number;
}

/**
 * One compartment of a class box — its attributes or its methods —
 * together with the divider drawn above it.
 */
export interface PositionedClassCompartment {
  /** The y-coordinate of the `<line class="siren-class-divider">` above this compartment. */
  dividerY: number;
  members: PositionedClassMember[];
}

/**
 * A class with a layout-assigned box, compartment boundaries, and whatever
 * author styling and interaction the model resolved for it.
 *
 * `x`/`y` are the box's top-left corner, matching `PositionedNode`.
 */
export interface PositionedClass {
  id: string;
  /** The class-name text as drawn, including any generic parameter. */
  name: string;
  /** Annotation text without its `<<`/`>>`, or `null`. */
  annotation: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The attribute compartment, or `null` when the class declares none. */
  attributes: PositionedClassCompartment | null;
  /** The method compartment, or `null` when the class declares none. */
  methods: PositionedClassCompartment | null;
  /** Author declarations to emit as this class's inline `style` attributes: the frame's on the frame rect, the text's on every label the class draws. */
  style: AuthorStyle;
  /** The link or click hook to attach, or `null`. */
  interaction: ResolvedClassInteraction | null;
}

/** A relationship with a layout-assigned path and text anchors. */
export interface PositionedClassRelationship {
  id: string;
  from: string;
  to: string;
  line: ClassRelationshipLine;
  fromEnd: ClassRelationshipEnd;
  toEnd: ClassRelationshipEnd;
  points: Point[];
  label: string | null;
  /** Where the label is drawn; `null` when there is no label. */
  labelAnchor: Point | null;
  fromMultiplicity: string | null;
  /** Where the from-end multiplicity is drawn; `null` when there is none. */
  fromMultiplicityAnchor: Point | null;
  toMultiplicity: string | null;
  /** Where the to-end multiplicity is drawn; `null` when there is none. */
  toMultiplicityAnchor: Point | null;
}

/** A namespace with a layout-assigned frame enclosing its member classes. */
export interface PositionedClassNamespace {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where the frame's label text is drawn. */
  labelAnchor: Point;
}

/** A note with a layout-assigned box and, when attached, its connector. */
export interface PositionedClassNote {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The connector path to the class this note is attached to; `null` for a free note. */
  linkPoints: Point[] | null;
}

/**
 * The class diagram after layout: positioned classes, relationships,
 * namespaces and notes plus the resolved timeline, ready for
 * `renderClassDiagramToSVG`.
 */
export interface PositionedClassDiagram {
  direction: Direction;
  classes: PositionedClass[];
  relationships: PositionedClassRelationship[];
  /** Namespace frames, drawn before (behind) the classes they enclose. */
  namespaces: PositionedClassNamespace[];
  notes: PositionedClassNote[];
  timeline: ResolvedTimeline;
  width: number;
  height: number;
}
