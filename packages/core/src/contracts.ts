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
 * Result of `buildGraphModel`. Carries `graph` (flowchart), `model`
 * (sequence) and `classModel` (class) so the one dispatcher function can
 * return any of the three shapes; at most one of them is non-null,
 * matching the `SirenDocument.kind` of the document it resolved.
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
  controller: AnimationController | null;
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Class diagram — parser-level (pre graph-model) types
// ---------------------------------------------------------------------------

/**
 * Layout direction of a class diagram, from its `direction` statement.
 * Wider than the flowchart header's `TD|LR` on purpose: Mermaid accepts all
 * four here, and this board deliberately does not widen the flowchart
 * header to match.
 */
export type ClassDirection = "TB" | "BT" | "LR" | "RL";

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
export interface ClassStyleProperty {
  property: string;
  value: string;
}

/** Which author-styling statement a `ClassStyleDecl` came from. */
export type ClassStyleDeclKind = "style" | "classDef" | "cssClass";

/**
 * A `style X fill:#fdd`, `classDef name fill:#fdd`, or `cssClass "A,B"
 * name` statement, as written. Values are not validated here — rejecting
 * `url(`/`expression(` is `buildClassModel`'s job.
 */
export interface ClassStyleDecl {
  styleKind: ClassStyleDeclKind;
  /** The classes targeted by `style`/`cssClass`; empty for `classDef`. */
  classIds: string[];
  /** The definition name of `classDef`/`cssClass`; `null` for `style`. */
  name: string | null;
  /** The declarations of `style`/`classDef`; empty for `cssClass`. */
  properties: ClassStyleProperty[];
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
  direction: ClassDirection;
  classes: ClassDecl[];
  relationships: ClassRelationship[];
  namespaces: ClassNamespace[];
  notes: ClassNote[];
  interactions: ClassInteraction[];
  styles: ClassStyleDecl[];
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
 * Author styling after model resolution: `classDef`/`cssClass` flattened
 * onto each class it applies to, in declaration order, with rejected
 * values already dropped.
 */
export interface ResolvedClassStyle {
  classId: string;
  properties: ClassStyleProperty[];
}

/**
 * The normalized in-memory class diagram produced by `buildClassModel`:
 * merged classes, identified relationships, resolved namespaces, notes,
 * interactions and styles, and the resolved timeline.
 */
export interface ClassModel {
  direction: ClassDirection;
  classes: ResolvedClass[];
  relationships: ResolvedClassRelationship[];
  namespaces: ResolvedClassNamespace[];
  notes: ResolvedClassNote[];
  interactions: ResolvedClassInteraction[];
  styles: ResolvedClassStyle[];
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
  /** Author declarations to emit as this element's inline `style` attribute. */
  style: ClassStyleProperty[];
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
  direction: ClassDirection;
  classes: PositionedClass[];
  relationships: PositionedClassRelationship[];
  /** Namespace frames, drawn before (behind) the classes they enclose. */
  namespaces: PositionedClassNamespace[];
  notes: PositionedClassNote[];
  timeline: ResolvedTimeline;
  width: number;
  height: number;
}
