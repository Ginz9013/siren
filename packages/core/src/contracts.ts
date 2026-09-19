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

/**
 * One run of a Markdown-formatted node label: a stretch of text sharing one
 * combination of bold/italic. Independent axes rather than a closed set of
 * "styles" — matches mermaid 11.17.2's own `font-weight`/`font-style` pair,
 * measured (`htmlLabels: false`, a throwaway `mermaid-probe.mjs`-based
 * script): `**bold**` sets only `font-weight`, `*italic*` sets only
 * `font-style`, and a run written inside both would carry both. This
 * board's own corpus rows never nest the two, so no run either of them
 * produces does in practice, but the shape leaves room for one that does.
 */
export interface LabelRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

/** A node as declared in source, before graph-model resolution. */
export interface SirenNode {
  id: string;
  label: string;
  /**
   * The label's Markdown runs, one array per line, in source order — or
   * `null` when the label carries no Markdown formatting, the overwhelming
   * common case: an ordinary `A[label]` or `A["label"]` never sets this.
   *
   * Non-null only when the author wrote the fenced `` "`...`" `` Markdown-
   * string spelling — measured, mermaid 11.17.2's own syntax for a label
   * that may be bold, italic or carry a line break. `label` above still
   * holds the *flattened* plain text in that case (every run's text
   * concatenated in order, each line joined by `\n`), so it stays
   * meaningful to a reader that has never heard of this field — an error
   * message, a diagnostic quoting a redeclared label.
   *
   * Required rather than optional, the same rule `GraphNode.style`/
   * `parentId`/`interaction` already follow: "no formatting" is a state
   * every node has, not the absence of a field some nodes carry and others
   * do not.
   */
  labelRuns: LabelRun[][] | null;
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

/**
 * The line an edge is drawn with — one of the three axes Mermaid's arrow
 * tokens compose from, and the flowchart's counterpart of
 * `SequenceArrowLine` and `ClassRelationshipLine`.
 *
 * `-.-` is `dotted` and `===` is `thick`; every other spelling is `solid`.
 * Measured in mermaid 11.17.2, which records exactly this axis as an edge's
 * `stroke`.
 */
export type EdgeLine = "solid" | "dotted" | "thick";

/**
 * What is drawn at one end of an edge — the other two axes, one per end,
 * mirroring `ClassRelationshipEnd`.
 *
 * `>` is an `arrow`, `o` a `circle`, `x` a `cross`, and an end the token
 * decorates with nothing is `none`. Which end a token decorates was
 * measured rather than recalled: mermaid 11.17.2 reads `A --o B` as
 * `arrow_circle` and turns that into `arrowTypeStart: "none",
 * arrowTypeEnd: "arrow_circle"`, so a single marker always lands on the
 * **to**-end, and only the doubled spellings (`<-->`, `o--o`, `x--x`)
 * decorate the from-end.
 */
export type EdgeEnd = "none" | "arrow" | "circle" | "cross";

/**
 * A directed edge as declared in source, before edge-id assignment,
 * carrying the decomposition of the arrow token that wrote it.
 *
 * Source position is `sourceLine`/`sourceColumn` here, not the
 * `line`/`column` used for most of this file, because `line` already names
 * the edge's line style — the same collision `ClassRelationship` resolved
 * the same way, and for the same reason.
 */
export interface SirenEdge {
  from: string;
  to: string;
  /**
   * The three axes the arrow token decomposed into, all required for the
   * reason `SirenNode.shape` is: `A --> B` is `solid`/`none`/`arrow`, so a
   * plain arrow is one state of the decomposition rather than the absence
   * of one, and no reader downstream has to fold a missing field into a
   * default that one of them would eventually get wrong.
   */
  line: EdgeLine;
  fromEnd: EdgeEnd;
  toEnd: EdgeEnd;
  /**
   * How many ranks apart this edge holds its endpoints — 1 for `-->`, 3
   * for `---->`.
   *
   * The one part of an arrow token that is not about drawing. Mermaid
   * counts the dashes (or the dots) and hands the result to dagre as
   * `minlen`; measured, `A --> B` is `length=1` and `A ----> B` is
   * `length=3`, and the drawn diagram differs because the target sits
   * further down the rank order. Named for what it means to the layout
   * rather than for the characters it was counted from.
   */
  minLength: number;
  /**
   * The text written on the edge itself, in whichever of the two spellings
   * the author used — `A -->|yes| B` and `A -- yes --> B` are the same
   * label on the same edge, and nothing downstream records which one was
   * written.
   *
   * `null` rather than `""` when there is none, because an author cannot
   * write an empty one: mermaid 11.17.2 rejects `A -->|| B` and
   * `A -- --> B` outright (measured), so "unlabelled" and "labelled with
   * nothing" are not two states anyone can author, and only one exists
   * here. That is the same empty-not-absent rule the three axes above
   * follow, arriving at `null` instead of a default because a label has no
   * neutral value to default to — the shape `ClassRelationship.label`
   * already has, for the same reason.
   */
  label: string | null;
  sourceLine?: number;
  sourceColumn?: number;
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
 * A `subgraph title ... end` block as written — the flowchart's grouping
 * construct, and the counterpart of a class diagram's `ClassNamespace`.
 *
 * A **tree**, rather than a flat list with parent pointers, because that is
 * the shape a block already has: the parser opens one on the keyword and
 * closes it on `end`, and nesting is what happens in between. It also means
 * a subgraph needs no id at this stage, which matters because the id it ends
 * up with is not the author's — see `ResolvedSubgraph`.
 */
export interface SirenSubgraph {
  /**
   * The handle the author wrote before the title, or `null` when they wrote
   * none — `subgraph Ingest` and `subgraph one[Title]` name one, and
   * `subgraph "Two Words"` does not (mermaid 11.17.2 mints `subGraph0` for
   * that case, measured).
   *
   * Kept apart from `label` because it is the name an *edge* uses:
   * `One --> Two` joins two subgraph frames, and drawing that needs to know
   * which names are a subgraph's. `buildFlowchartModel` reads this to turn
   * the author's handle into the frame's generated id, and the parser reads
   * it to take back the node an endpoint would otherwise have declared for
   * the name.
   *
   * Still deliberately **not** an id and it never becomes one: what the
   * frame is addressed by downstream is `ResolvedSubgraph.id`, generated per
   * ADR-0010, because a subgraph may legitimately be named after a node.
   */
  name: string | null;
  /** The text drawn on the frame. `subgraph Ingest` labels itself. */
  label: string;
  /**
   * The ids of the nodes named directly inside this block, in source order,
   * excluding any a subgraph already claimed.
   *
   * "Named", not "declared": mermaid 11.17.2 takes a node mentioned inside
   * the block as the block's own even when it was first written outside it
   * (measured), and the **first** subgraph to name a node keeps it, which is
   * what makes `subgraph T / B --> C / end` after `subgraph S / A --> B /
   * end` leave `B` in `S`.
   */
  nodeIds: string[];
  /** Subgraphs opened inside this one, in source order. */
  subgraphs: SirenSubgraph[];
  /**
   * This block's own `direction LR` (or `TB`/`BT`/`RL`), written on a line of
   * its own inside the block — or `null` when the author wrote none.
   *
   * A per-cluster rank direction, not a cascading one: nothing here means
   * "inherit the enclosing block's direction", because there is no such
   * concept to carry — a nested subgraph with no `direction` of its own
   * takes the outer flowchart's, exactly as an unlabelled one always has.
   */
  direction: Direction | null;
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
   * The `subgraph` blocks written at the top level of the document, in
   * source order, each carrying whatever was nested inside it.
   *
   * Empty when the author grouped nothing, never absent — the
   * empty-not-absent rule `linkStyles` already follows.
   */
  subgraphs: SirenSubgraph[];
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
  /**
   * `click X href "..."` and `click X call fn()` statements as written, in
   * source order. The same `Interaction` a class diagram parses to — the
   * contract is kind-agnostic, exactly as `styles` is — so `resolveInteractions`
   * reads both without knowing which kind it was handed.
   *
   * Required, not optional, for the reason `styles` and `linkStyles` are:
   * empty when the author made nothing interactive, never absent, so "no
   * interactions" is one state rather than two.
   *
   * A flowchart accepts only the `click ...` spellings: `link`/`callback`,
   * the class diagram's older spellings of the same two directives, are not
   * valid Mermaid flowchart syntax at all (measured), so there is no second
   * pair of patterns here to produce this array from.
   */
  interactions: Interaction[];
  /**
   * The diagram's screen-reader-only title — Mermaid's `accTitle:` statement.
   * Never drawn as a visible heading; reaches only the rendered SVG's
   * `<title>` element. A flowchart has no visible `title` statement of its
   * own to be distinct from (unlike `SequenceDocument.title`), so this field
   * carries the whole of the construct.
   */
  accTitle: string | null;
  /**
   * The diagram's screen-reader-only description — Mermaid's `accDescr:`
   * statement. Draws nothing on the canvas, the same as `accTitle` above;
   * reaches only the rendered SVG's `<desc>` element.
   */
  accDescr: string | null;
  timeline: SirenTimeline | null;
}

/**
 * The parsed document, tagged by diagram kind. Produced by `parseSiren`
 * (which dispatches on the source's header line to `parseFlowchart`,
 * `parseSequenceDiagram`, `parseClassDiagram` or `parseStateDiagram`).
 */
export type SirenDocument =
  | FlowchartDocument
  | SequenceDocument
  | ClassDocument
  | StateDocument;

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

/**
 * An `activate X` statement, or the equivalent `+` shorthand on an arrow
 * (`A->>+B: text` — the parser expands it into a message immediately
 * followed by this). Opens an activation bar on `id`'s lifeline; bars
 * stack when a participant is activated more than once before its first
 * close (measured against real Mermaid: two `activate A` draw two offset
 * bars, not one).
 */
export interface SequenceActivateStatement {
  kind: "activate";
  id: string;
  line?: number;
  column?: number;
}

/**
 * A `deactivate X` statement, or the equivalent `-` shorthand on an arrow
 * (`B-->>-A: text` — measured against real Mermaid: `-` closes the
 * lifeline the arrow is *sent from* — `B` here — not the one it points
 * at, easy to mis-state because the common `A->>+B` / `B-->>-A` pairing
 * happens to put both markers on `B`). Closes the innermost still-open
 * activation on `id`'s lifeline; `buildSequenceModel` diagnoses one with
 * nothing open, matching Mermaid's own rejection.
 */
export interface SequenceDeactivateStatement {
  kind: "deactivate";
  id: string;
  line?: number;
  column?: number;
}

/**
 * Which side of its lane(s) a note draws on — Mermaid's `note over`, `note
 * right of`, `note left of`. Modeled as one statement with an axis, the
 * way `SequenceArrow` is `{line, head}` rather than ten named forms: all
 * three spellings are the same shape (participant span + text), told apart
 * only by where the box lands relative to that span.
 */
export type SequenceNotePlacement = "left" | "right" | "over";

/**
 * A `note over A,B: text` / `note right of A: text` / `note left of A:
 * text` statement. `from`/`to` are the same participant when the note
 * names only one (`right of`/`left of`, or a single-participant `over`);
 * `over A,B` gives its two distinct ends. Measured against real Mermaid: a
 * note occupies its own rank on the timeline, exactly like a message — it
 * never overlaps the message before or after it.
 */
export interface SequenceNoteStatement {
  kind: "note";
  placement: SequenceNotePlacement;
  from: string;
  to: string;
  text: string;
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
  | SequenceActivateStatement
  | SequenceDeactivateStatement
  | SequenceNoteStatement
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
  /** The diagram's visible heading, drawn on the canvas — Mermaid's `title` statement. */
  title: string | null;
  /**
   * The diagram's screen-reader-only title — Mermaid's `accTitle:` statement.
   * Never drawn as a visible heading; reaches only the rendered SVG's
   * `<title>` element, distinct from `title` above, which draws on the
   * canvas and reaches no accessibility tree entry of its own.
   */
  accTitle: string | null;
  participants: SequenceParticipantDecl[];
  boxes: SequenceBox[];
  statements: SequenceStatement[];
  /**
   * `link A: Label @ url` statements, as written. Reuses the kind-agnostic
   * `Interaction` shape class/flowchart already share (`interactionKind:
   * "href"`) rather than a sequence-only type: Mermaid's own class diagram
   * grammar already treats `link`/`callback` as older spellings of `click
   * ... href`/`click ... call` that "produce the same Interaction shapes... a
   * spelling, not a separate concept" (see `parseClassDiagram.ts`), and
   * sequence's `link` is the same idea under a third spelling. `Label` maps
   * onto `Interaction.tooltip` — Mermaid's own popup-menu behavior for
   * `link` is not something a static SVG renderer reproduces, so nothing
   * else about it needs its own field.
   */
  interactions: Interaction[];
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
  | { kind: "block"; block: ResolvedSequenceBlock }
  /**
   * `activationId` is this bar's own generated id (`generatedId("activation",
   * n)`, ADR-0010) — minted here rather than at layout, the same stage every
   * other generated id in this codebase is minted at — because two bars on
   * the same participant are not the same bar and must not share a `data-
   * siren-id`. `deactivate` needs no id of its own: it only ever closes the
   * innermost bar the walk already knows, never gets addressed on its own.
   */
  | { kind: "activate"; participantId: string; activationId: string }
  | { kind: "deactivate"; participantId: string }
  | { kind: "note"; note: ResolvedSequenceNote };

/**
 * A note after graph-model resolution: assigned id (`generatedId("note",
 * n)`, the same convention a class diagram's note uses), so it is
 * addressable in a `timeline:` block on the same terms as a message or a
 * block.
 */
export interface ResolvedSequenceNote {
  id: string;
  placement: SequenceNotePlacement;
  from: string;
  to: string;
  text: string;
}

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
  /** Carried through unchanged from `SequenceDocument.accTitle` — no resolution needed for plain text with no target to validate against. */
  accTitle: string | null;
  participants: ResolvedSequenceParticipant[];
  boxes: ResolvedSequenceBox[];
  statements: ResolvedSequenceStatement[];
  /** Resolved via the shared `resolveInteractions` — the same href allowlist class/flowchart interactions go through. */
  interactions: ResolvedInteraction[];
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
  /** The link this participant's box(es) wrap, or `null` — mirrors `PositionedClass.interaction`. */
  interaction: ResolvedInteraction | null;
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

/**
 * An activation bar with a layout-assigned span. Not a `PositionedSequenceElement`
 * — unlike a message or a block it occupies no row of its own and can open
 * on one side of a block and close on the other, so it is collected as its
 * own flat, top-level array (`PositionedSequenceDiagram.activations`)
 * instead of nesting inside the block tree — the same reason a lifeline
 * itself is drawn as a flat pass over every participant, independent of
 * block nesting.
 */
export interface PositionedActivation {
  id: string;
  participantId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One element of a block's positioned body, in document order. */
export type PositionedSequenceElement =
  | { kind: "message"; message: PositionedMessage }
  | { kind: "block"; block: PositionedBlock }
  | { kind: "destroyMark"; mark: PositionedDestroyMark }
  | { kind: "note"; note: PositionedNote };

/**
 * A note with a layout-assigned box: measured from its text, positioned
 * beside or spanning the lane(s) it names. Carries no connector of its
 * own — measured against real Mermaid, a sequence note draws as a plain
 * box with no leader line, unlike a class diagram's note.
 */
export interface PositionedNote {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  /** Carried through unchanged; drawn as the SVG's `<title>` element, never on the canvas. */
  accTitle: string | null;
  participants: PositionedParticipant[];
  boxes: PositionedBox[];
  /** Messages, blocks, and destroy marks, in document order. */
  elements: PositionedSequenceElement[];
  /** Every activation bar, independent of block nesting — see `PositionedActivation`. */
  activations: PositionedActivation[];
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
   * Carried unchanged from `SirenNode.labelRuns` — see that field for what
   * `null` versus non-null means. `buildFlowchartModel` re-decides nothing
   * about a label's own text here, the same rule `shape` already follows.
   */
  labelRuns: LabelRun[][] | null;
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
  /**
   * The id of the `subgraph` this node was declared inside, or `null` when
   * it was declared inside none.
   *
   * A `ResolvedSubgraph.id`, which is generated (`subgraph:1`) and never the
   * word the author titled the block with — see that type for why.
   *
   * `null` rather than absent, the empty-not-absent rule `style` and `shape`
   * already follow. It matters more here than usual: this field is what
   * `layoutGraph` turns into dagre's cluster parentage, and dagre's compound
   * mode is switched on by the *presence* of parentage. A field that could
   * be `undefined`-but-set would be an easy way to switch compound mode on
   * for a document with no subgraph at all, which moves every diagram that
   * has none.
   */
  parentId: string | null;
  /**
   * The link or click hook this node's `click` statement resolved to, or
   * `null` when the author made it none.
   *
   * `null` rather than absent, the empty-not-absent rule `style` and
   * `parentId` already follow, and the same shape `PositionedClass.interaction`
   * has.
   */
  interaction: ResolvedInteraction | null;
}

/**
 * A subgraph after model resolution: assigned the id the timeline and the
 * renderer address it by, and pointed at the subgraph enclosing it.
 *
 * **The id is generated, not authored.** A subgraph may legitimately be
 * named after a node — mermaid 11.17.2 accepts `A[Alpha]` beside
 * `subgraph A` and records both, measured — so carrying the author's own
 * word here would hand two unrelated drawn elements one `data-siren-id`, and
 * a `timeline:` entry naming it would address both with nothing to say so.
 * ADR-0010 settles the spelling: `${kind}:${n}`, minted by `generatedId`,
 * and no authored id or `${from}-${to}` connector id can contain a colon.
 * The class diagram's namespace is the same decision one kind over.
 *
 * Flat, in the order the author wrote the `subgraph` keywords (pre-order),
 * rather than the tree `SirenSubgraph` is: what reads this is layout, which
 * wants one cluster per entry and a parent to point each at, and what
 * numbers it is an author counting keywords down the page.
 *
 * Membership is *not* here. It is on `GraphNode.parentId`, in one place, so
 * that a node and the frame around it cannot disagree about which contains
 * it — unlike `ResolvedClassNamespace`, which keeps both and has to promise
 * they agree.
 */
export interface ResolvedSubgraph {
  id: string;
  /** The text drawn on the frame — the author's title, carried through. */
  label: string;
  /** The subgraph this one is nested in, or `null` at the top level. */
  parentId: string | null;
  /**
   * This subgraph's own `direction`, carried straight through from
   * `SirenSubgraph.direction` — a `Direction` is already a closed
   * parser-level type, so there is nothing here for this stage to validate.
   * `null` when the author wrote none, and the block lays out along the
   * document's own direction.
   */
  direction: Direction | null;
}

/** An edge after graph-model resolution, carrying its assigned id. */
export interface GraphEdge {
  /**
   * `${from}-${to}` in the **author's** own words, then `#2`, `#3`, … for
   * repeats of the same pair — so an edge naming a subgraph is `one-two`
   * and not `subgraph:1-subgraph:2`.
   *
   * Spelled from the source rather than from the two fields below precisely
   * so that it stays colon-free, which is the promise ADR-0010 separates
   * generated ids from connector ids on; it also keeps the edge addressable
   * in a `timeline:` block by words the author can actually type. The two
   * spellings cannot collide, because a name a `subgraph` block claimed is
   * never also a node.
   */
  id: string;
  /**
   * The id this edge leaves: a node's, or a **subgraph's** when the author
   * named a block at that end. `buildFlowchartModel` resolves the authored
   * handle to `ResolvedSubgraph.id` here, so nothing downstream has to know
   * that an endpoint could have been written as anything else.
   */
  from: string;
  /** The id this edge arrives at, on the same terms as `from`. */
  to: string;
  /**
   * The arrow token's decomposition, carried unchanged from the spelling
   * the author used — see `SirenEdge`, where the three axes and the length
   * are described in full.
   *
   * Required rather than optional, like `GraphNode.shape`: `A --> B` is
   * `solid` / `none` / `arrow` / 1, so a plain arrow is one state and not
   * two. Layout reads `minLength`, the renderer reads the other three, and
   * neither re-derives any of them from the source.
   */
  line: EdgeLine;
  fromEnd: EdgeEnd;
  toEnd: EdgeEnd;
  minLength: number;
  /**
   * The text drawn on the edge, carried unchanged from whichever spelling
   * wrote it — see `SirenEdge.label`, where the two spellings and the
   * `null`-not-empty rule are described in full.
   *
   * Read by layout as well as by the renderer, which is what makes it
   * unlike the three axes above: a label is a box dagre has to keep clear,
   * so it changes where the edge goes and not only what is drawn on it.
   */
  label: string | null;
  /**
   * Author declarations to emit as this edge's inline `style` attribute, in
   * declaration order, with rejected values already dropped — the same
   * shape, and the same empty-not-absent rule, as `GraphNode.style`.
   *
   * **Both halves land, and this comment used to say neither could.** While
   * an edge was drawn as one `<path>` and nothing else, only `frame` had
   * anywhere to go and a `linkStyle 0 color:#f00` filled `text` with a
   * declaration the renderer dropped. An edge now carries a `label`, drawn
   * as a `<text>` beside that path, so `frame` paints the line and the
   * arrowhead minted for its colour and `text` paints the label — the same
   * split a node's frame and label already make, reached through the same
   * `applyInlineStyle`. Measured before it was wired: mermaid 11.17.2 writes
   * `fill` onto the label's own `<text>` (`scripts/mermaid-probe.mjs
   * --paint`), so dropping it had been a silent mis-render.
   *
   * One case is left where a half has nowhere to land — `text` on an edge
   * with no label — and it is dropped in the renderer rather than guarded
   * here, because the routing rule stays kind-neutral on purpose:
   * `resolveStyles` is read by three diagram kinds and knows what a
   * declaration *means*, not what each kind draws.
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
  /**
   * Every `subgraph` the document declared, flattened into source order.
   * Empty when it declared none — and *only* then, which is what keeps a
   * diagram with no grouping out of dagre's compound mode.
   */
  subgraphs: ResolvedSubgraph[];
  /** Carried through unchanged from `FlowchartDocument.accTitle` — no resolution needed for plain text with no target to validate against. */
  accTitle: string | null;
  /** Carried through unchanged from `FlowchartDocument.accDescr` — no resolution needed for plain text with no target to validate against. */
  accDescr: string | null;
  timeline: ResolvedTimeline;
}

/**
 * Result of `buildGraphModel`. Carries `graph` (flowchart), `model`
 * (sequence), `classModel` (class) and `stateModel` (state) so the one
 * dispatcher function can return any of the four shapes.
 *
 * At most one is non-null, matching the `SirenDocument.kind` of the document
 * it resolved — not exactly one, because a stage that fails resolution
 * returns all four null alongside an error-severity diagnostic explaining
 * why. A caller must therefore branch on the field it expects being non-null,
 * never assume the other three being null means its own is populated.
 *
 * "Four nullable fields, at most one non-null" is a shape a discriminated
 * union would say better, and that is known, recorded debt rather than an
 * oversight: turning it into one touches every caller of every stage and is
 * tracked as its own refactor rather than smuggled into the ticket that
 * added a fourth kind.
 */
export interface GraphModelResult {
  graph: GraphModel | null;
  model: SequenceModel | null;
  classModel: ClassModel | null;
  stateModel: StateModel | null;
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
  /**
   * Where to draw `label`: the centre of the space layout kept clear for
   * it, or `null` when the edge carries no label and asked for none.
   *
   * Reported by the layout rather than computed by the renderer from
   * `points`, because it is where the *reserved box* ended up — the mid-point
   * of a route is not the same place, and drawing there would put the text
   * across the line the space was made beside. The shape a class
   * diagram's `PositionedClassRelationship.labelAnchor` already has, for
   * the same reason.
   */
  labelAnchor: Point | null;
}

/**
 * A subgraph with a layout-assigned frame enclosing everything inside it —
 * its own nodes and, when it nests, the whole of each frame beneath it,
 * title strip included.
 *
 * The shape `PositionedClassNamespace` already has, because it is the same
 * figure: a labelled box drawn *behind* what it groups. It is a separate
 * type rather than a shared one because the two diagram kinds do not share
 * types across the boundary — a flowchart's layout output has never referred
 * to a class diagram's — and collapsing them would be the first time.
 */
export interface PositionedSubgraph {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where the frame's title text is drawn: centred in the strip above its contents. */
  labelAnchor: Point;
}

/**
 * The graph after layout: positioned nodes/edges plus the resolved
 * timeline, ready for `renderToSVG`.
 */
export interface PositionedGraph {
  direction: Direction;
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  /**
   * Subgraph frames, in the model's order — outermost before the frames
   * nested inside them, which is also the order they must be drawn in: a
   * frame is painted behind what it groups, so an inner frame drawn first
   * would be hidden by the outer one.
   */
  subgraphs: PositionedSubgraph[];
  /** Carried through unchanged from `GraphModel.accTitle`. */
  accTitle: string | null;
  /** Carried through unchanged from `GraphModel.accDescr`. */
  accDescr: string | null;
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
 * `arrow`, `()` a `circle` (a lollipop interface marker), and a bare end is
 * `none`.
 *
 * A `circle` end is not just a different marker: measured against real
 * Mermaid (`mermaid-probe.mjs`), the name on that side of the relationship
 * never becomes a class at all — it names a synthetic interface node
 * instead. See `ResolvedClassRelationship.fromInterfaceLabel`.
 */
export type ClassRelationshipEnd =
  | "none"
  | "triangle"
  | "diamondFilled"
  | "diamondHollow"
  | "arrow"
  | "circle";

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
export type InteractionKind = "href" | "call";

/**
 * The window target mermaid 11.17.2's grammar accepts after an `href`
 * interaction's optional tooltip — `click A href "url" "tip" _blank`. A
 * fixed `LINK_TARGET` token in Mermaid's own lexer, not a free string:
 * measured with `scripts/mermaid-probe.mjs`, these four values are the whole
 * of what it accepts there, and a fifth is a parse error
 * ("Expecting 'LINK_TARGET', got 'NODE_STRING'").
 */
export type LinkTarget = "_blank" | "_self" | "_top" | "_parent";

/**
 * A `click`/`link`/`callback` statement making a target interactive, as
 * written. `targetId` is a target's id in the sense the glossary gives that
 * word — the authored thing an interaction is attached to — so it is a
 * class in a class diagram and a node in a flowchart, and this type never
 * has to know which. The URL allowlist is applied later, by the shared
 * `resolveInteractions` — the parser only records syntax.
 */
export interface Interaction {
  interactionKind: InteractionKind;
  targetId: string;
  /** The URL for `href`, or the callback function name for `call`. */
  action: string;
  /** The literal argument of a `call fn("arg")` form, or `null`. */
  argument: string | null;
  /** The optional trailing tooltip string, or `null`. */
  tooltip: string | null;
  /**
   * The optional trailing window target on a flowchart's own `click X href
   * "url" ["tip"] _blank` — `null` when the author wrote no fourth argument.
   *
   * Optional, unlike `argument`/`tooltip`: a class diagram's and a sequence
   * diagram's own `href`-kind spellings (`click ... href`, `link "..."`,
   * `link A: Label @ url`) have no target concept in Mermaid at all, so
   * those parsers never set this field at all rather than setting it to
   * `null` — the empty-not-absent rule the sibling fields follow is a
   * flowchart-only promise here, not a kind-agnostic one. A `call`
   * interaction never sets it either, target being an `href`-only concept.
   */
  linkTarget?: LinkTarget | null;
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
  interactions: Interaction[];
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
  /**
   * The class id this end routes to — or, when the matching `*End` is
   * `"circle"`, a synthetic node id `buildClassModel` minted for the
   * lollipop interface, never a class id. Which one `from`/`to` holds is
   * always readable from `fromEnd`/`toEnd`.
   */
  from: string;
  to: string;
  line: ClassRelationshipLine;
  fromEnd: ClassRelationshipEnd;
  toEnd: ClassRelationshipEnd;
  label: string | null;
  fromMultiplicity: string | null;
  toMultiplicity: string | null;
  /**
   * The name written next to a `()` marker on the from-end (`"Duck"` in
   * `Duck ()-- Quacks`) — non-null exactly when `fromEnd` is `"circle"`.
   * `from` itself is the synthetic node id in that case, not this name.
   */
  fromInterfaceLabel: string | null;
  /** Same as `fromInterfaceLabel`, for a `()` on the to-end. */
  toInterfaceLabel: string | null;
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
 *
 * `targetId` carries the same kind-agnostic meaning `Interaction.targetId`
 * does — a class in a class diagram, a node in a flowchart.
 */
export interface ResolvedInteraction {
  targetId: string;
  interactionKind: InteractionKind;
  action: string;
  argument: string | null;
  tooltip: string | null;
  /** Carried through unchanged from `Interaction.linkTarget` — see that field. */
  linkTarget?: LinkTarget | null;
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
  interactions: ResolvedInteraction[];
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
  interaction: ResolvedInteraction | null;
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
  /** The from-end's lollipop interface name (see `ResolvedClassRelationship.fromInterfaceLabel`), or `null`. */
  fromInterfaceLabel: string | null;
  /** Where the from-end interface label is drawn; `null` when `fromInterfaceLabel` is `null`. */
  fromInterfaceLabelAnchor: Point | null;
  toInterfaceLabel: string | null;
  /** Where the to-end interface label is drawn; `null` when `toInterfaceLabel` is `null`. */
  toInterfaceLabelAnchor: Point | null;
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

// ---------------------------------------------------------------------------
// State diagram — parser-level (pre graph-model) types
// ---------------------------------------------------------------------------

/**
 * Which of three things one box in a state diagram is: a state the author
 * named, or one of the two pseudo-states `[*]` spells.
 *
 * Three values rather than a `isPseudo` flag beside a `start`/`end` one,
 * because start and end are two *different* pseudo-states and not one node
 * used twice — measured (mermaid 11.17.2): `[*] --> A` and `A --> [*]`
 * report the relations `root_start → A` and `A → root_end`. Closed and
 * required, the rule `NodeShape` already follows, so "no kind" is not a
 * fourth state for a reader downstream to fold into one of these.
 *
 * `"state"` is the ordinary case and happens to spell the same word
 * `StateDocument.kind` discriminates the whole diagram by; they are
 * different questions asked at different levels, and nothing reads one for
 * the other.
 */
export type StateKind = "state" | "start" | "end";

/**
 * A state as the parser read it — one declaration per state, in the order
 * the document first named it.
 *
 * Unlike `ClassDecl`, a state carries no repeatable payload (no members, no
 * annotation), so the parser folds repeat mentions here rather than leaving
 * a merge for the model: naming a state five times is one declaration,
 * positioned at its first mention. A pseudo-state folds the same way and
 * for a stronger reason — measured, `[*]` is **one start and one end per
 * level** rather than one per occurrence, so two `[*] -->` lines share a
 * single declaration.
 */
export interface StateDecl {
  /**
   * The id the author wrote — `null` for a pseudo-state, which no author
   * names and which `buildStateModel` gives a generated id (ADR-0010), the
   * way a flowchart subgraph's is `buildFlowchartModel`'s to mint. A parser
   * reads authored spellings; it does not invent ids.
   */
  id: string | null;
  kind: StateKind;
  /** 1-based line the state was first named on. */
  line: number;
  /** 1-based column the statement that first named it starts at. */
  column: number;
}

/**
 * A transition as the parser read it: `A --> B`, with the optional `: label`
 * that rides on it.
 *
 * `label` is `null` when the author wrote none, never `""`. Mermaid reports
 * an unlabelled relation's `relationTitle` as the empty string (measured,
 * 11.17.2), and Siren spells the absence the way `Edge.label` and
 * `ClassRelationship.label` already do — `""` is a label that draws nothing,
 * which is a different document from one that carries no label at all.
 *
 * A self-transition (`A --> A`) is an ordinary transition and not an error:
 * measured, it is one state with one relation onto itself — the "stays in
 * this state" loop.
 */
export interface StateTransition {
  /**
   * The state this transition leaves — `null` when the author wrote `[*]`
   * there, which is the level's **start** pseudo-state. Which of the two
   * pseudo-states `[*]` means is decided by the side of the arrow it sits
   * on and by nothing else, so the endpoint carries no second field saying
   * which: a `null` here is always the start, and a `null` on `to` is
   * always the end.
   */
  from: string | null;
  /** The state this transition enters — `null` for `[*]`, the level's **end** pseudo-state. */
  to: string | null;
  label: string | null;
  /** 1-based line the transition was written on. */
  sourceLine: number;
  /** 1-based column the statement starts at. */
  sourceColumn: number;
}

/**
 * The parsed `stateDiagram` (or `stateDiagram-v2`) source: states and the
 * transitions between them. Produced by `parseStateDiagram`. One arm of the
 * `SirenDocument` union.
 *
 * Which of the two header spellings the author wrote is resolved in the
 * parser and recorded nowhere: measured against mermaid 11.17.2, both
 * report the diagram type `stateDiagram`, so they are one kind with two
 * spellings exactly as `classDiagram`/`classDiagram-v2` are.
 */
export interface StateDocument {
  kind: "state";
  states: StateDecl[];
  transitions: StateTransition[];
}

// ---------------------------------------------------------------------------
// State diagram — graph-model (post `buildStateModel`) types
// ---------------------------------------------------------------------------

/**
 * A state after model resolution — named, whoever named it.
 *
 * `id` is no longer nullable: a pseudo-state the author never named has by
 * now been given its generated id (`start:1`, `end:1`), so everything
 * downstream addresses a state the same way. `kind` survives because the
 * two pseudo-states are *drawn* differently from a state — a disc and a
 * ring rather than a labelled box — and nothing but this field says which.
 */
export interface ResolvedState {
  id: string;
  kind: StateKind;
}

/**
 * A transition after model resolution: assigned the id the renderer — and,
 * once the timeline reaches this kind, a `timeline:` block — addresses it
 * by, following the convention flowchart edges and class relationships
 * already share: `${from}-${to}`, then `#2`, `#3`, ... for repeats of the
 * same ordered pair.
 */
export interface ResolvedStateTransition {
  id: string;
  from: string;
  to: string;
  label: string | null;
}

/**
 * The normalized in-memory state diagram produced by `buildStateModel`:
 * states, identified transitions, and the resolved timeline.
 */
export interface StateModel {
  states: ResolvedState[];
  transitions: ResolvedStateTransition[];
  timeline: ResolvedTimeline;
}

/** Result of `buildStateModel`. */
export interface StateModelResult {
  model: StateModel | null;
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// State diagram — layout (post `layoutStateDiagram`) types
// ---------------------------------------------------------------------------

/**
 * A state with a layout-assigned box. `x`/`y` are the box's top-left corner,
 * matching `PositionedNode` and `PositionedClass`.
 */
export interface PositionedState {
  id: string;
  /**
   * Which figure the renderer draws here — a labelled box, or the filled
   * disc and the ring the two pseudo-states are. Carried this far because
   * layout has already sized the box differently for each and only this
   * says which one was sized.
   */
  kind: StateKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A transition with a layout-assigned path and, when it carries one, a label anchor. */
export interface PositionedStateTransition {
  id: string;
  from: string;
  to: string;
  points: Point[];
  label: string | null;
  /**
   * Where to draw `label`: the centre of the space layout kept clear for it,
   * or `null` when the transition carries no label and asked for none — the
   * shape `PositionedEdge.labelAnchor` already has, for the reason given
   * there.
   */
  labelAnchor: Point | null;
}

/**
 * The state diagram after layout: positioned states and transitions plus the
 * resolved timeline, ready for `renderStateDiagramToSVG`.
 */
export interface PositionedStateDiagram {
  states: PositionedState[];
  transitions: PositionedStateTransition[];
  timeline: ResolvedTimeline;
  width: number;
  height: number;
}
