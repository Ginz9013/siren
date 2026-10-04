/**
 * Cross-module type contracts for siren-core.
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
 * The label model — `Label`, its runs, its measured box, and the problems
 * reading one can raise. Declared in `label/label.ts`, beside the three
 * functions that read, measure and draw a label, so that the tickets growing
 * the tag vocabulary (ADR-0015) never have to touch this file; re-exported
 * here so every other module still finds its cross-module types in one place.
 */
import type { Label, LabelBox } from "./label/label";

export type {
  Label,
  LabelBox,
  LabelBoxRow,
  LabelDialect,
  LabelProblem,
  LabelRun,
} from "./label/label";

/** A node as declared in source, before graph-model resolution. */
export interface SirenNode {
  id: string;
  /**
   * The label as `readLabel` read it — rows of runs, with the tags the
   * author wrote already turned into row breaks and run properties
   * (ADR-0015). A node written with no label at all is labelled with its
   * own id, as one plain run.
   *
   * Every spelling reads into this one shape: an ordinary `A[label]`, a
   * quoted `A["label"]`, and the fenced Markdown string
   * `` A["`**bold**`"] `` whose `**`/`*` and real line breaks are read by
   * the same function. `label.text` is the flattened plain text, for a
   * reader that only wants a string — a diagnostic quoting the label, the
   * redeclaration warning comparing two.
   */
  label: Label;
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
   *
   * Read by `readLabel` like a node's, so `<br>` breaks a row here too
   * (ADR-0015). Never a Markdown string: Mermaid reads one on an edge and
   * Siren does not yet, which is a gap of its own.
   */
  label: Label | null;
  sourceLine?: number;
  sourceColumn?: number;
}

/**
 * One `<verb> <id> [<effect>]` action from the `timeline:` block. `step` is
 * never written: it is the place of the action's line among the block's
 * non-blank lines, counting from 1 (ADR-0012). `effect` is present for
 * `enter`/`exit`/`highlight` and absent for `unhighlight`.
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
  /**
   * The title drawn on the frame, read by `readLabel` like a node's label —
   * so `<br>` breaks a row here too (ADR-0015). `subgraph Ingest` labels
   * itself.
   */
  label: Label;
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
 * `parseSequenceDiagram`, `parseClassDiagram`, `parseStateDiagram` or
 * `parseErDiagram`).
 */
export type SirenDocument =
  | FlowchartDocument
  | SequenceDocument
  | ClassDocument
  | StateDocument
  | ErDocument;

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
 * Whether a participant's lifeline runs from the diagram's top (`declared`:
 * box/icon rendered at both top and bottom of the lifeline) or begins at a
 * `create` statement partway through the diagram (`created`: lifeline starts
 * at that point, no top box/icon). A participant created by a mention rather
 * than a declaration (ADR-0013) runs from the top too, so it is `declared`
 * here: the value names where the lifeline starts, not whether a
 * `participant` line was written.
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
 * `create` statements. This is not the lane order: `SequenceModel.participants`
 * adds the participants created by a mention and orders all of them by first
 * mention (ADR-0013). Use the corresponding `SequenceParticipantStatement`
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
  /**
   * Every lane, declared or created by a mention, in first-mention order —
   * the left-to-right order the layout draws them in (ADR-0013).
   */
  participants: ResolvedSequenceParticipant[];
  boxes: ResolvedSequenceBox[];
  statements: ResolvedSequenceStatement[];
  /** Resolved via the shared `resolveInteractions` — the same href allowlist class/flowchart interactions go through. */
  interactions: ResolvedInteraction[];
  timeline: ResolvedTimeline;
}

/** Result of `buildSequenceModel`. */
export interface SequenceModelResult {
  model: SequenceModel;
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
  /**
   * Carried unchanged from `SirenNode.label` — `buildFlowchartModel`
   * re-decides nothing about a label's own text, the same rule `shape`
   * already follows.
   */
  label: Label;
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
 * ADR-0010 settles the spelling: `${kind}:${n}`, minted by `generatedId`.
 * The class diagram's namespace is the same decision one kind over.
 *
 * ⚠️ **The separation that spelling buys holds for the flowchart, class,
 * sequence and state kinds, and not for ER.** For those four it is exact:
 * an authored id is `\w+`, so neither it nor a `${from}-${to}` connector id
 * built from two of them can contain a colon, and a generated id therefore
 * cannot be spelled by either. ER breaks both halves — its connector ids
 * *are* colon-bearing (`${from}:${to}`, see `ResolvedErRelationship`), and
 * a quoted entity name may contain a colon too, so `"subgraph:1"` is a
 * legal entity name and exactly what `generatedId("subgraph", 1)` mints
 * (measured, mermaid 11.17.2). ER holds the invariant with a runtime check
 * instead — `reportIdCollisions` in `buildErModel` — which is where a
 * future ER `subgraph` cluster's id must be registered. See ADR-0010's own
 * "Where this argument does not reach" section.
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
  /** The title drawn on the frame — the author's, carried through. */
  label: Label;
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
  label: Label | null;
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
 * Result of `buildGraphModel`, tagged by the kind of document it resolved —
 * the same four words `SirenDocument.kind` uses, so a caller that knows what
 * it parsed reads the same vocabulary back.
 *
 * **A tag, not four nullable fields.** This used to be `{ graph, model,
 * classModel, stateModel, diagnostics }` with the rule "at most one is
 * non-null", which a caller could only act on by picking a field and
 * null-checking it — and which grew a fifth nullable field with every
 * diagram kind the roadmap adds. The union says the same thing in a form the
 * compiler enforces: narrow on `kind` and the payload is *there*.
 *
 * **Every arm carries a model, and there is no failure arm.** No sub-builder
 * has a failure path: one that takes exception to part of its document says
 * so in `diagnostics` — at error severity when it dropped something — and
 * still returns the model it built from the rest. So `diagnostics` being
 * non-empty says nothing about whether `model` is there; it always is. A
 * fifth diagram kind should declare its own `ModelResult.model` non-nullable
 * for the same reason, rather than reintroducing a state no caller can
 * reach.
 *
 * **One payload name, `model`, on every arm** rather than a per-kind name.
 * After narrowing, `result.model` is already the right type, so the per-kind
 * names bought nothing a reader needed — while costing a fresh naming
 * decision on every kind added, which is the cost this shape exists to
 * remove. Nothing can read `model` without narrowing first, so a mis-narrowed
 * caller is a type error and not a wrong field.
 */
export type GraphModelResult =
  | { kind: "flowchart"; model: GraphModel; diagnostics: Diagnostic[] }
  | { kind: "sequence"; model: SequenceModel; diagnostics: Diagnostic[] }
  | { kind: "class"; model: ClassModel; diagnostics: Diagnostic[] }
  | { kind: "state"; model: StateModel; diagnostics: Diagnostic[] }
  | { kind: "er"; model: ErModel; diagnostics: Diagnostic[] };

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
  /**
   * The label as `layoutLabel` measured it: the box the node's shape was
   * sized to hold, and where each row sits inside it. Centred on the node,
   * which is the anchor the renderer hands `drawLabel`.
   *
   * Reported by layout rather than re-measured by the renderer, which has
   * no measurer: the rows are drawn where the space for them was reserved.
   */
  labelBox: LabelBox;
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
  /**
   * The label as `layoutLabel` measured it — the box dagre was asked to keep
   * clear, centred on `labelAnchor` — or `null` exactly when `label` is.
   */
  labelBox: LabelBox | null;
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
  label: Label;
  /** The title as `layoutLabel` measured it, centred on `labelAnchor`. */
  labelBox: LabelBox;
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
  /**
   * The label written in brackets after the name — `class Order["Order
   * Line"]` — or `null` when the declaration wrote none, in which case the
   * class draws its id (and generic). Read by `readLabel` in the full
   * `html` dialect (ADR-0015); measured (mermaid 11.17.2, `--paint`):
   * `class A["Order<br/>Line"]` draws "Order" over "Line" in both label
   * modes, and a label replaces the whole drawn name, generic included —
   * `class A~T~["Lab"]` draws "Lab".
   */
  label: Label | null;
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
  /**
   * The `: label`, or `null` — read by `readLabel` in the full `html`
   * dialect (ADR-0015), so `<br>` breaks a row here as it does on a
   * flowchart edge. Measured (mermaid 11.17.2, `--paint`): `A --> B :
   * a<br/>b` draws "a" over "b" in both label modes.
   */
  label: Label | null;
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
  /**
   * The label written in brackets after the name — `namespace Zoo["Big
   * Zoo"] {` — or `null` when the block wrote none, in which case the frame
   * is labelled by its name. Read by `readLabel` in the full `html` dialect
   * (ADR-0015): not on the board's table of measured places, so measured
   * (mermaid 11.17.2, `--paint`): `namespace Zoo["Big<br/>Zoo <b>x</b>"]`
   * keeps `Zoo` as the cluster's id and draws "Big" over "Zoo x".
   */
  label: Label | null;
  classIds: string[];
  line?: number;
  column?: number;
}

/** A `note "text"` (free) or `note for X "text"` (attached) statement. */
export interface ClassNote {
  /**
   * The quoted text, read by `readLabel` in the full `html` dialect
   * (ADR-0015), which the board had only inferred for this position and
   * which was then measured (mermaid 11.17.2, `--paint`, `htmlLabels:
   * true`): `note for A "n<br/>m <i>q</i>r"` draws "n" over "m qr", the tags
   * honored rather than drawn, and a free note the same.
   */
  label: Label;
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
  /**
   * The first label any declaration of the class wrote, or `null` when none
   * did — merged by the rule `annotation` and `generic` are (first-named
   * wins, a conflict is a warning), compared by flattened text.
   */
  label: Label | null;
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
  /** Carried unchanged from `ClassRelationship.label`. */
  label: Label | null;
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
  /**
   * The frame's label: the one written in brackets (`ClassNamespace.label`),
   * or else the namespace's name as one plain run.
   */
  label: Label;
  classIds: string[];
}

/** A note after model resolution: assigned id, attachment resolved. */
export interface ResolvedClassNote {
  id: string;
  /** Carried unchanged from `ClassNote.label`. */
  label: Label;
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
  model: ClassModel;
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
  /**
   * What the name band draws: the class's written label, or else its id with
   * any generic parameter composed in (`Registry<T>`) as one plain run.
   */
  label: Label;
  /**
   * The label as `layoutLabel` measured it — the box the name band was
   * sized around, centred in the part of the band the name takes.
   */
  labelBox: LabelBox;
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
  label: Label | null;
  /**
   * Where the label is drawn — the centre of the space the shared core kept
   * clear for it; `null` when there is no label.
   */
  labelAnchor: Point | null;
  /**
   * The label as `layoutLabel` measured it — the box the core was asked to
   * keep clear, centred on `labelAnchor` — or `null` exactly when `label`
   * is. `PositionedStateTransition.labelBox` carries a transition's the same
   * way.
   */
  labelBox: LabelBox | null;
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
  label: Label;
  /**
   * The label as `layoutLabel` measured it — the strip along the frame's top
   * is as tall as all its rows — centred on `labelAnchor`.
   */
  labelBox: LabelBox;
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
  label: Label;
  /**
   * The label as `layoutLabel` measured it — the box the note's own was
   * padded around — centred on the note box, which is the anchor the
   * renderer hands `drawLabel`.
   */
  labelBox: LabelBox;
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
 * Which of four things one figure in a state diagram is: a state the author
 * named, a **composite** state they opened a `{ }` block on, or one of the
 * two pseudo-states `[*]` spells.
 *
 * Separate values rather than an `isPseudo` flag beside a `start`/`end` one,
 * because start and end are two *different* pseudo-states and not one node
 * used twice — measured (mermaid 11.17.2): `[*] --> A` and `A --> [*]`
 * report the relations `root_start → A` and `A → root_end`. Closed and
 * required, the rule `NodeShape` already follows, so "no kind" is not a
 * fifth state for a reader downstream to fold into one of these.
 *
 * `"composite"` is a state *and* a frame, which is why it is a value of this
 * union rather than a list beside the states: a transition may name one at
 * either end, and everything that addresses a state by id addresses a
 * composite the same way. What differs is the figure — a titled frame around
 * the states written inside its block, rather than a labelled box — and this
 * field is what says so.
 *
 * `"state"` is the ordinary case and happens to spell the same word
 * `StateDocument.kind` discriminates the whole diagram by; they are
 * different questions asked at different levels, and nothing reads one for
 * the other.
 *
 * `"region"` is the one value **no `StateDecl` ever carries**: a concurrent
 * region has no authored spelling, so the parser cannot declare one and it
 * appears first on `ResolvedState`, where `buildStateModel` mints it beside
 * the composite it divides (`StateRegion`). It is a frame like a composite
 * — a cluster holding its own members — and it is a separate value because
 * the two are drawn differently: a composite is a titled, solid-outlined
 * frame, a region an untitled dashed one (measured, mermaid 11.17.2: a
 * divider's `rect.divider` takes `stroke-dasharray: 10,10` and carries no
 * label element at all).
 */
export type StateKind = "state" | "composite" | "start" | "end" | "region";

/**
 * The stereotype marker a state was declared with — `state Choice <<choice>>`
 * — and the closed set of three Mermaid recognizes.
 *
 * **A second axis, not three more `StateKind` values**, and that is measured
 * rather than chosen (mermaid 11.17.2, `scripts/mermaid-probe.mjs`):
 *
 * - Mermaid records this as a `type` field on the state's own record
 *   (`id="Choice" type="choice"`), and the *same* field reads `"default"` on
 *   the start and end pseudo-states `[*]` spells (`id="root_start"
 *   type="default"`). So Mermaid's `type` does not encode start/end at all,
 *   and folding these three into `StateKind` would merge two questions its
 *   own model keeps apart.
 * - A stereotyped state can also be a **composite**: `state X <<choice>>`
 *   followed by `state X { A --> B }` reports one state, `type="choice"`,
 *   with `A` and `B` `in="root/X"`. Two values of one union could not both
 *   be true, so they cannot be one union. (Mermaid draws that document as
 *   the frame, measured with `--markup` — X comes back as a cluster and not
 *   as a node — which is why the renderer asks `kind` first.)
 *
 * `null` is the ordinary case: the author wrote no stereotype. The word is
 * read case-insensitively, as every one of Mermaid's lexer rules is
 * (`/^(?:.*<<fork>>)/i` — measured: `<<CHOICE>>`, `<<FORK>>` and `<<Join>>`
 * each land on the lowercase value here), so which casing was written is
 * recorded nowhere.
 *
 * The state **keeps its authored id and its place in the relations**: this
 * is a change of figure, not of structure, so nothing else on `StateDecl`
 * moves and a transition names a stereotyped state exactly as it names any
 * other.
 */
export type StateStereotype = "choice" | "fork" | "join";

/**
 * Which side of its state a note was written on: the two spellings, and the
 * only two — measured (mermaid 11.17.2), `note over Idle : text` is a
 * **lexical error**, so `over` is not a third position here the way it is in
 * a sequence diagram.
 *
 * Kept as the author's own two-word spelling rather than folded to
 * `"left"`/`"right"`, because that is the whole of what Mermaid records
 * (`note={"position":"right of",...}`) and a renamed value would be a
 * vocabulary of Siren's own for a construct it is copying.
 */
export type StateNotePosition = "left of" | "right of";

/**
 * A note written onto one state — `note right of Idle : waiting for work`.
 *
 * **It hangs off the state**, which is why this is a field on `StateDecl`
 * rather than an entry in a list beside the states. Measured (mermaid
 * 11.17.2): the note is reported *on the state's own record* as
 * `note={"position":"right of","text":"waiting for work"}` — emphatically
 * not the shape `ClassDocument.notes` has, where a note is an element of its
 * own that may float free or attach to a class. Copying that shape here
 * would build a data model Mermaid does not have.
 *
 * **Singular, not a list**, and that too is measured rather than assumed: a
 * second `note ... of Idle` **replaces** the first, whichever side either
 * was written on (`note right of Idle : first` then
 * `note left of Idle : second` reports one note,
 * `{"position":"left of","text":"second"}`). So a state carries at most one,
 * last statement wins, and there is no document in which two notes annotate
 * one state.
 *
 * **It has no id of its own.** Mermaid's drawn note is addressed by a name
 * derived from its state (`state-Idle----note-1`), never by anything the
 * author wrote, so a note is reachable only *through* the state it annotates
 * and is **not** a timeline target — ADR-0009's targets are ids, and there is
 * no id here to be one. Minting one would invent an author-facing handle
 * Mermaid has no spelling for, so nothing does.
 */
export interface StateNote {
  position: StateNotePosition;
  /**
   * The note's text, trimmed — never empty, because `note right of Idle :`
   * with nothing after the colon is a lexical error in Mermaid (measured),
   * not a note carrying a blank line.
   *
   * Read by `readLabel` in the full `html` dialect (ADR-0015), which the
   * board had only inferred for this position and which was then measured
   * (mermaid 11.17.2, `--paint`, `htmlLabels: true`): `note right of s1 :
   * n<br/>m` draws "n" over "m" and `note left of s2 : p<i>q</i>r` reads
   * "pqr", the tags honored rather than drawn.
   */
  label: Label;
}

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
  /**
   * The `<<choice>>`/`<<fork>>`/`<<join>>` marker written on this state's
   * declaration, or `null` when the author wrote none — a second axis
   * beside `kind`, for the measured reasons `StateStereotype` records.
   *
   * **Only the line that first names the state can set it.** Measured
   * (mermaid 11.17.2): `A --> X` followed by `state X <<choice>>` reports
   * `id="X" type="default"` — Mermaid's `addState` upgrades an existing
   * state's `doc` but guards its `type` behind `if (!state.type)`, and an
   * existing state always already has one. So a stereotype written below
   * the first mention of its state is inert, which is the opposite of the
   * way a later `state X { }` block upgrades `kind` to `composite`.
   *
   * Always `null` on a pseudo-state: `[*]` is not an id and there is no
   * spelling of this statement that names one.
   */
  stereotype: StateStereotype | null;
  /**
   * The descriptions the author wrote for this state, in written order —
   * empty when they wrote none, which is the ordinary case and the one that
   * keeps drawing the id.
   *
   * An array rather than a string because descriptions **accumulate**:
   * measured (mermaid 11.17.2), `s : first` followed by `s : second`
   * reports `descriptions=["first","second"]` on the one state.
   *
   * The two spellings — `s : text` and `state "text" as s` — write into
   * this same list and are recorded nowhere else, because they are one
   * construct written two ways: measured, both land in `descriptions` and
   * **neither renames the state**, so `state "text" as s` is a description
   * and not an alias. A field saying which spelling was read would be a
   * difference downstream could act on where Mermaid has none.
   *
   * **Each description is a label of its own**, read by `readLabel` in the
   * full `html` dialect (ADR-0015), so `s : a<br/>b` is one description of
   * two rows. Measured (mermaid 11.17.2, `--markup`): `s1 : a<br/>b` and
   * `s1 : c<br>d` draw two separate label groups of two rows each, with the
   * divider between the groups — so the rows a `<br>` makes stay inside the
   * description that wrote it, and never become descriptions themselves.
   */
  descriptions: Label[];
  /**
   * The composite state whose `{ }` block holds this one, or `null` at the
   * document's own level.
   *
   * **Membership lives here rather than in a list on the composite**, the
   * split CONTEXT.md's **Subgraph** entry already draws between
   * `GraphNode.parentId` and `ResolvedClassNamespace.classIds`: a state and
   * the frame around it cannot disagree about which holds it. It is also the
   * only place it *could* live for a pseudo-state, which has no id for a
   * membership list to name — and a composite's `[*]` belongs to that
   * composite's level (measured: `state Outer { [*] --> Inner }` reports
   * `Outer_start in="root/Outer"`, not `root_start`).
   *
   * A composite's own id, not a generated one: unlike a flowchart subgraph,
   * a composite state is named by the author, so there is nothing for
   * ADR-0010 to mint here.
   *
   * **A state is claimed by the first block that names it** — the rule
   * `SirenSubgraph.nodeIds` records for a flowchart, applied here rather
   * than invented again. So a state first written at the document's level
   * joins the first composite to name it, and a second composite naming it
   * again leaves it where it is. (Mermaid's own parse tree keeps a
   * same-named state per level and its renderer then draws one node for
   * them; Siren's ids are global, so one rule decides which level that one
   * node is drawn at.)
   */
  parentId: string | null;
  /**
   * Which **concurrent region** of `parentId`'s block this state was written
   * in, counting from `0` in written order — and `null` whenever its level
   * has no `--` in it at all, which is every level in a document that never
   * writes one.
   *
   * An index rather than an id because the region has no id yet: the parser
   * reads authored spellings and a region's name is generated
   * (`buildStateModel` mints `region:1`, ADR-0010), exactly as a
   * pseudo-state's is. The pair (`parentId`, this) is what that stage
   * re-parents by.
   *
   * Always `null` at the document's own level: measured (mermaid 11.17.2),
   * a `--` outside every composite is a **parse error**, so there is no
   * document in which the top level has regions.
   */
  regionIndex: number | null;
  /**
   * This composite's own `direction LR` (or `TB`/`BT`/`RL`), written on a
   * line of its own inside its block — `null` when the author wrote none,
   * and always `null` on anything that is not a composite.
   *
   * A per-level rank direction and not a cascading one, exactly as
   * `SirenSubgraph.direction` is: a nested composite that names none lays
   * out along the document's own direction rather than its parent's.
   *
   * Always `null` on a composite whose block carries a `--`: measured, the
   * statement belongs to the **region** it was written in and not to the
   * block around them (`StateRegion.direction`), so a divided composite has
   * no direction of its own to carry.
   */
  direction: Direction | null;
  /**
   * The note written onto this state, or `null` when the author wrote none —
   * which is the ordinary case and the one every other statement leaves
   * alone.
   *
   * One field rather than a list, and a field here rather than a collection
   * beside the states: both are measured, and `StateNote` records what was
   * measured and why.
   */
  note: StateNote | null;
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
  /**
   * Read by `readLabel` in the full `html` dialect, so `<br>` breaks a row
   * here as it does on a flowchart edge (ADR-0015) — measured (mermaid
   * 11.17.2, `htmlLabels: true`): `s1 --> s2 : t<br/>u` draws "t" over "u".
   */
  label: Label | null;
  /**
   * The composite state whose block this transition was written in, or
   * `null` at the document's own level.
   *
   * Carried for one reason: it is what says *which* level's start or end a
   * `null` endpoint means, now that `[*]` is one pair per level rather than
   * one per document. `buildStateModel` resolves both endpoints against it
   * and nothing downstream needs it, because by then every endpoint is an
   * id in the diagram's one global id space.
   */
  parentId: string | null;
  /**
   * Which concurrent region of `parentId`'s block this transition was
   * written in, on exactly the terms `StateDecl.regionIndex` records — and
   * carried for the same one reason `parentId` is: it is what says *which*
   * level's start or end a `null` endpoint means, now that a `--` makes a
   * block several levels rather than one.
   */
  regionIndex: number | null;
  /** 1-based line the transition was written on. */
  sourceLine: number;
  /** 1-based column the statement starts at. */
  sourceColumn: number;
}

/**
 * One **concurrent region** of a composite state's block — the thing a `--`
 * line divides that block into.
 *
 * ```
 * state Active {
 *   Reading --> Parsing
 *   --
 *   Logging --> Flushed
 * }
 * ```
 *
 * Measured (mermaid 11.17.2, `scripts/mermaid-probe.mjs`): Mermaid
 * synthesises a `divider`-typed state **per region** and re-parents each
 * region's members under it (`in="root/Active/divider-id-1"`), so a region
 * is a level of its own and not a decoration of the block. `n` dividers
 * make `n + 1` regions, the first of which holds everything written above
 * the first `--`; an empty one is a region like any other (measured:
 * `--` twice in a row reports three dividers, the middle one holding
 * nothing).
 *
 * **A region has no authored name, and Mermaid's own name for it cannot be
 * copied**: the second divider comes back as `id-g8d8ncxe8va-1`, a
 * different string on every run. So the id is minted by `buildStateModel`
 * through `generatedId` (`region:1`, ADR-0010), which is both reproducible
 * and — carrying a colon, where every authored id is `\w+` — impossible for
 * an author to collide with.
 *
 * Regions live in a list of their own on the document rather than among the
 * states, for the reason `StateDecl.regionIndex` gives: at parse time they
 * have no id for a `parentId` to name, so the pair (`parentId`, `index`) is
 * the handle until one is minted.
 */
export interface StateRegion {
  /** The composite state whose block this region is part of. Never `null`: a `--` at the document's own level is a parse error in Mermaid (measured). */
  parentId: string;
  /** Which region of that block this is, counting from `0` in written order. */
  index: number;
  /**
   * The `direction` statement written **inside this region**, or `null`
   * when it carries none.
   *
   * Measured, and the measurement is the surprising half of this construct:
   * `direction` is scoped to the region it sits in, not to the block. In
   * `state Active { A --> B  --  direction LR  C --> D }` mermaid lays the
   * *second* region's members out left-to-right and leaves the first one
   * top-to-bottom; moving the statement above the `--` swaps which region
   * turns. So a divided composite's own `StateDecl.direction` is always
   * `null` and this is where the statement lands.
   */
  direction: Direction | null;
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
  /**
   * The whole diagram's rank direction: the `direction LR` (or `TB`/`BT`/
   * `RL`) the author wrote at the document's own level, outside every
   * composite, and `TB` when they wrote none.
   *
   * Non-null, the way `ClassDocument.direction` is: every document lays out
   * in *some* direction, and "the author named none" is not a third answer
   * downstream could do anything with. A composite's own direction is the
   * nullable one (`StateDecl.direction`), because there "none" genuinely
   * means "lay this block out along the document's direction".
   *
   * **The first statement wins, not the last** — measured against mermaid
   * 11.17.2, which is the one place this diagram kind disagrees with
   * `ClassDocument.direction`'s last-wins rule. `direction LR` followed by
   * `direction RL` reports `LR`, and `direction RL` followed by
   * `direction LR` reports `RL`: mermaid's state database answers
   * `getDirection()` from `rootDoc.find(stmt === "dir")`, so a later
   * statement at the same level is inert rather than an overwrite.
   *
   * Position on the page does not matter otherwise: a `direction` written
   * after the first transition governs the document just as one written
   * first does. And a composite's own `direction` never reaches here —
   * measured: it lives in that block's own doc, so a document whose only
   * `direction` is inside a composite reports `TB`.
   */
  direction: Direction;
  states: StateDecl[];
  transitions: StateTransition[];
  /**
   * Every concurrent region every composite's block was divided into, in
   * written order — empty for a document that writes no `--`, which is the
   * ordinary case and the one in which `StateDecl.regionIndex` is `null`
   * everywhere.
   *
   * A list beside the states rather than entries among them, because a
   * region has no id until `buildStateModel` mints one and `StateDecl.id`
   * is where an id belongs.
   */
  regions: StateRegion[];
  /**
   * The `classDef` and `class` statements the author wrote, in written
   * order, as the same kind-agnostic `StyleDecl` a flowchart and a class
   * diagram parse to — so `resolveStyles` pairs a definition with the
   * directive applying it here exactly as it does there.
   *
   * `class` is this kind's spelling of the apply-directive (a class diagram
   * writes `cssClass`, a flowchart writes `class`), normalized to the
   * `apply` kind by the parser with the author's own spelling kept in
   * `StyleDecl.authoredAs`.
   *
   * There is no `style` statement here, deliberately: measured, mermaid
   * 11.17.2 *does* accept `style Busy fill:#f00` in a state diagram and
   * paints it, but no compatibility-corpus row covers that construct yet,
   * so it stays refused rather than half-implemented from one measurement.
   */
  styles: StyleDecl[];
  /**
   * The `timeline:` block the author wrote, or `null` when they wrote none —
   * the same distinction `ClassDocument.timeline` draws, where `null` means
   * "declares no animation at all" rather than "declares an empty block".
   *
   * Read by the shared `parseTimelineBlock` grammar rather than by anything
   * this kind owns: ADR-0002 keeps the block apart from the structural
   * definition precisely so its entries name ids and verbs and know nothing
   * about the statements above them. So the ids in it are resolved by
   * `buildStateModel` and validated nowhere else.
   */
  timeline: SirenTimeline | null;
}

// ---------------------------------------------------------------------------
// State diagram — graph-model (post `buildStateModel`) types
// ---------------------------------------------------------------------------

/**
 * A state after model resolution — named, whoever named it.
 *
 * `id` is no longer nullable: a pseudo-state the author never named has by
 * now been given its generated id (`start:1`, `end:1` — `start:2` for the
 * first composite's own level), so everything downstream addresses a state
 * the same way. `kind` survives because a composite and the two
 * pseudo-states are *drawn* differently from a state — a titled frame, a
 * disc and a ring rather than a labelled box — and nothing but this field
 * says which.
 *
 * **This list holds states the parser never declared.** A `kind: "region"`
 * entry is one concurrent region of a composite's block, synthesised here
 * from `StateDocument.regions` and wearing a generated id of its own
 * (`region:1`) — and the members written inside it arrive with their
 * `parentId` pointing at it rather than at the block, which is the whole of
 * what a `--` does to the model.
 *
 * **Flat, with a `parentId`, rather than the tree the parser read.** The
 * shape `ResolvedSubgraph` already takes and for the same reason: what
 * reads this is layout, which wants one cluster per entry and a parent to
 * point each at. What is *not* the same is that there is no second list
 * beside the states — a composite is a state, so nesting is a field on the
 * one list rather than a parallel one to keep in step.
 */
export interface ResolvedState {
  id: string;
  kind: StateKind;
  /**
   * The `<<choice>>`/`<<fork>>`/`<<join>>` marker the author wrote on this
   * state, carried straight through from `StateDecl.stereotype` — authored,
   * and with nothing for this stage to resolve.
   *
   * A second axis beside `kind` rather than three more of its values, for
   * the measured reasons `StateStereotype` records; `kind` is asked first
   * downstream, because a state that is both a composite and stereotyped is
   * drawn as the frame (measured).
   *
   * Always `null` on a pseudo-state: `[*]` is not an id, so no statement
   * can mark one.
   */
  stereotype: StateStereotype | null;
  /**
   * The composite state that holds this one, or `null` at the document's
   * own level — carried through from `StateDecl.parentId`, which is where
   * the "first block to name it claims it" rule was already applied.
   */
  parentId: string | null;
  /**
   * A composite's own rank direction, carried straight through from
   * `StateDecl.direction`; `null` on everything else, and on a composite
   * whose block named none. A `Direction` is already a closed parser-level
   * type, so there is nothing here for this stage to validate.
   */
  direction: Direction | null;
  /**
   * The descriptions the author wrote, in written order, exactly as
   * `StateDecl.descriptions` carried them — authored text with nothing for
   * this stage to resolve.
   *
   * Empty is the ordinary case, and it is what keeps the **id** on the
   * drawn box: a state with descriptions draws them instead, and its id
   * becomes addressing-only. That is the split a flowchart's `A[label]`
   * already draws between the id and the text — measured for a state
   * diagram too (mermaid 11.17.2 draws no `s` once `s : text` is written).
   *
   * Each one a `Label`, as `readLabel` read it in the parser.
   */
  descriptions: Label[];
  /**
   * The note written onto this state, or `null` when the author wrote none —
   * carried straight through from `StateDecl.note`, authored text and an
   * authored side with nothing for this stage to resolve.
   *
   * Always `null` on a pseudo-state, and not by a rule of this stage's:
   * `note right of [*]` is refused by name in the parser, so no note ever
   * reaches a state whose id was generated.
   *
   * It stays a field on the state rather than becoming an element beside
   * them, because it has no id — see `StateNote`, and ADR-0009 on why that
   * makes it unaddressable from a `timeline:` block.
   */
  note: StateNote | null;
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
  /** Carried unchanged from `StateTransition.label`. */
  label: Label | null;
}

/**
 * The normalized in-memory state diagram produced by `buildStateModel`:
 * states, identified transitions, and the resolved timeline.
 */
export interface StateModel {
  /**
   * The whole diagram's rank direction, carried through from
   * `StateDocument.direction` — authored, already resolved to one of the
   * four canonical spellings, and with nothing for the model stage to
   * decide. `ClassModel.direction` carries a class diagram's the same way.
   *
   * Beside it, and not instead of it, `ResolvedState.direction` carries a
   * composite's own: measured, the two are independent, so this one governs
   * the document's own level and each composite's governs its block.
   */
  direction: Direction;
  states: ResolvedState[];
  transitions: ResolvedStateTransition[];
  /**
   * Each styled state's accepted declarations, already flattened by the
   * shared `resolveStyles` — one entry per state that ended up with at
   * least one, and none for a state the author styled with nothing.
   *
   * Only a **state** can be a target: measured, mermaid 11.17.2 records a
   * `classes` array on a state and nowhere else, so no `class` statement
   * can name a transition.
   */
  styles: ResolvedStyle[];
  timeline: ResolvedTimeline;
}

/** Result of `buildStateModel`. */
export interface StateModelResult {
  model: StateModel;
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// State diagram — layout (post `layoutStateDiagram`) types
// ---------------------------------------------------------------------------

/**
 * One label drawn inside a state's box — the id, or one description — with
 * the box `layoutLabel` measured for it and the y that box is centred on, in
 * diagram coordinates.
 *
 * A label rather than a row, now that a label has rows of its own: a
 * description written `a<br/>b` is one of these holding two rows, and a
 * described state draws several of them stacked — `PositionedClass`'s
 * member lines in the shape a state's box needs. Measured (mermaid 11.17.2,
 * `--markup`): each description is its own label group, so the divider
 * under the first sits below *all* of that description's rows.
 *
 * Centred on the box's horizontal middle, which the renderer takes from the
 * state's own `x`/`width`; only `y` is the label's to report.
 */
export interface PositionedStateLabel {
  label: Label;
  labelBox: LabelBox;
  y: number;
}

/**
 * A state's note with a layout-assigned box and the connector joining it to
 * that state. `x`/`y` are the box's top-left corner, as everywhere else here.
 *
 * **Placed, not merely sized.** Measured (mermaid 11.17.2): the note is a
 * node of the layout graph in its own right — Mermaid inserts it as one,
 * joined to its state by an edge with `arrowhead: "none"` — which is what
 * keeps it clear of the states around it instead of drawn over them. Siren
 * hands it to the same shared layout core for the same reason, exactly as
 * `layoutClassDiagram` already does with a class note.
 *
 * `position` does not survive to here, and that is the point of laying it out
 * this way: the side the author named has already been spent, as the
 * *direction* of that joining edge — `right of` runs state → note and
 * `left of` runs note → state (measured, from Mermaid's own construction) —
 * so which side the note ended up on is now a fact about `x`/`y`, not a flag
 * for the renderer to act on a second time.
 */
export interface PositionedStateNote {
  /** The note's label, exactly as `readLabel` read it. */
  label: Label;
  /**
   * The label as `layoutLabel` measured it — the box the note's own was
   * sized around, padding aside — centred on the note box, which is the
   * anchor the renderer hands `drawLabel`.
   */
  labelBox: LabelBox;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * The connector between the state and the note, **always ordered from the
   * state to the note** whichever side the author put it on — so a reader of
   * these points never has to ask which spelling produced them.
   *
   * Drawn with no arrowhead, measured: Mermaid builds this edge with
   * `arrowhead: "none"`, which is what keeps a note's connector from reading
   * as a transition into the note.
   */
  connector: Point[];
}

/**
 * A state with a layout-assigned box. `x`/`y` are the box's top-left corner,
 * matching `PositionedNode` and `PositionedClass`.
 */
export interface PositionedState {
  id: string;
  /**
   * Which figure the renderer draws here — a labelled box, the filled disc
   * and the ring the two pseudo-states are, the titled frame a composite
   * is, or the untitled dashed one a concurrent region is. Carried this far
   * because layout has already sized the box differently for each and only
   * this says which one was sized.
   */
  kind: StateKind;
  /**
   * The stereotype marker this state was declared with, or `null` — which
   * figure to draw inside the box, once `kind` has said it is an ordinary
   * state rather than a frame or a pseudo-state.
   *
   * Carried this far for the same reason `kind` is: layout has already
   * sized the box for the figure (28 × 28 for a choice's diamond, 70 × 10
   * for a fork or join's bar, turned through a right angle where the
   * level runs `LR`), and only this says which one it sized. The
   * *orientation* is not carried, because it is already in the box: a bar
   * wider than it is tall is the horizontal one.
   */
  stereotype: StateStereotype | null;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * The labels this box draws, top to bottom: the state's descriptions when
   * it has any, and otherwise the one label its id makes. Empty for a
   * pseudo-state, which draws a mark and no text at all.
   *
   * Which of the two a label came from is deliberately not recorded: by
   * here it is simply the text the box holds, the same way a flowchart node
   * arrives at the renderer carrying its label rather than the question of
   * whether the author wrote one.
   */
  labels: PositionedStateLabel[];
  /**
   * Author declarations to emit as this state's inline `style` attributes:
   * the frame's on the box (or, for a composite, on the frame rect), the
   * text's on every row it draws. `PositionedClass.style` carries a class
   * diagram's the same way.
   *
   * Both halves are empty rather than absent for a state the author styled
   * with nothing, so the renderer asks one question instead of two.
   */
  style: AuthorStyle;
  /**
   * Where the divider under the first row goes, or `null` when this box
   * draws none.
   *
   * Measured (mermaid 11.17.2): a state with **two or more** descriptions
   * is drawn as a titled box — the first description above a divider and
   * the rest below it — while one description, or none, gets a plain
   * rounded rect with no divider at all. So this is `null` for every box
   * with fewer than two labels, however many rows a `<br>` gave one of
   * them, and the divider never separates the id from the descriptions: an
   * id is not drawn once a description exists.
   */
  dividerY: number | null;
  /**
   * The note hanging off this state, placed and connected, or `null` when
   * the author wrote none.
   *
   * Carried **on the state** rather than in a list beside them, all the way
   * to the renderer, for the reason `StateNote` gives: it has no id, so
   * there is nothing else it could be addressed as, and the elements drawn
   * for it wear the state's own `data-siren-id` rather than one of their own
   * (ADR-0009 — a timeline target is an id, and a note has none).
   */
  note: PositionedStateNote | null;
}

/** A transition with a layout-assigned path and, when it carries one, a label anchor. */
export interface PositionedStateTransition {
  id: string;
  from: string;
  to: string;
  points: Point[];
  label: Label | null;
  /**
   * Where to draw `label`: the centre of the space layout kept clear for it,
   * or `null` when the transition carries no label and asked for none — the
   * shape `PositionedEdge.labelAnchor` already has, for the reason given
   * there.
   */
  labelAnchor: Point | null;
  /**
   * The label as `layoutLabel` measured it — the box the shared core was
   * asked to keep clear, centred on `labelAnchor` — or `null` exactly when
   * `label` is. `PositionedEdge.labelBox` carries a flowchart edge's the
   * same way.
   */
  labelBox: LabelBox | null;
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

// ---------------------------------------------------------------------------
// ER diagram — parser-level (pre graph-model) types
// ---------------------------------------------------------------------------

/**
 * One entity as the author declared it: a name on a line of its own.
 *
 * **A relationship is not what declares an entity.** Measured (mermaid
 * 11.17.2, `scripts/mermaid-probe.mjs`): `erDiagram` followed by nothing but
 * `CUSTOMER` and `ORDER` reports two entities, `shape="erBox"` each, with no
 * relationships — so a standalone entity is legal ER and draws a box, rather
 * than being an empty diagram waiting for an arrow.
 *
 * The name is the field an entity is *addressed* by: Mermaid keys its entity
 * table on the name the author wrote, so it is the id downstream whatever
 * else the declaration carries. The alias and the attribute list are
 * recorded *beside* it — measured, `CUSTOMER["Customer Account"]` reports
 * one entity `label="CUSTOMER" alias="Customer Account"` — not instead of
 * it.
 */
export interface ErEntityDecl {
  /**
   * The name exactly as written. Its alphabet is measured rather than
   * borrowed from another kind: Mermaid's ER lexer reads an entity name as
   * `([^\x00-\x7F]|\w|-|\*|\.)+`, so `LINE-ITEM`, `P.Q` and `中文實體` are
   * each one entity — a **different language** from a flowchart, whose ids
   * carry no hyphen.
   */
  name: string;
  /**
   * The bracketed quoted string written after the name —
   * `CUSTOMER["Customer Account"]` — or `null` when this mention wrote
   * none.
   *
   * **Beside the name, not instead of it**, and that is the whole point of
   * the field: measured (mermaid 11.17.2), the entity comes back
   * `label="CUSTOMER" alias="Customer Account"`, keyed on `CUSTOMER`. What
   * the *box* draws is the alias — measured with `--markup`, the name row
   * of `CUSTOMER["Customer Account"]` reads "Customer Account" — so the two
   * part company exactly where `ResolvedErEntity`'s `id` and `label` do.
   *
   * ⚠️ **Not a description, however much a state diagram's `state "text" as
   * s` looks like it.** Measured one kind over, that one writes into the
   * state's `descriptions` and is drawn *under* the id; this replaces the
   * drawn name outright. Two different mechanisms with two different
   * pictures.
   *
   * Nullable rather than `""`, because Mermaid's own empty is not reachable:
   * `A[""]` is a **parse error** ("Expecting 'UNICODE_TEXT', ... got
   * 'WORD'"), so an empty string here could only ever mean "none", and a
   * field with two spellings of one state is a field two readers will
   * disagree about.
   *
   * Per mention, like `attributes`: an entity may be named several times and
   * only one of those mentions carry an alias. Which one wins is
   * `buildErModel`'s — measured, the **first non-empty** one does.
   *
   * Read by `readLabel` in the full `html` dialect (ADR-0015): measured
   * (mermaid 11.17.2, `--html`), `CUSTOMER["Customer<br/>Record"]` draws
   * `Customer` over `Record`.
   */
  alias: Label | null;
  /**
   * The attributes this *mention* of the entity declared, in source order —
   * empty for a bare name and for either end of a relationship.
   *
   * Per mention rather than per entity, because an entity may open several
   * blocks: measured (mermaid 11.17.2), `E { string a }` followed by
   * `E { string b }` reports **one** entity carrying **both** attributes, in
   * that order. Concatenating them is `buildErModel`'s, alongside the
   * de-duplication of the name itself.
   */
  attributes: ErAttribute[];
}

/**
 * One attribute inside an entity's `{ ... }` block: `type name [keys]
 * [comment]`, the four fields Mermaid records for it and in that order.
 *
 * The shape is measured rather than designed — `int age PK "the age"` comes
 * back `{ type: "int", name: "age", keys: ["PK"], comment: "the age" }`
 * (mermaid 11.17.2, `scripts/mermaid-probe.mjs`) — and it is one interface
 * shared by the parser and the model, the way `ClassMember` is, because
 * nothing between the two stages reinterprets an attribute.
 *
 * `keys` and `comment` are always present and are empty when the author
 * wrote neither, rather than nullable: Mermaid reports `keys: []` and
 * `comment: ""` for `string name`, and the drawn table treats "no keys at
 * all in this entity" as the question, which a list answers and a `null`
 * only complicates.
 */
export interface ErAttribute {
  /**
   * The type word, exactly as written — **parentheses and brackets
   * included**. Measured: `string(99) code` reports `type="string(99)"` and
   * `int[] xs` reports `type="int[]"`, because Mermaid's in-block word rule
   * is `[*A-Za-z_À-￿][A-Za-z0-9\-_\[\]().,À-￿*]*` — a
   * *third* alphabet in this one diagram kind, neither the entity name's nor
   * a flowchart id's. It may not **begin** with a digit (`int 1st` is a
   * parse error in Mermaid), and `PK`, `FK` and `UK` are not words at all
   * here: the key rule is read first, so `PK x` is a parse error too.
   */
  type: string;
  /** The attribute's name, in the same alphabet as `type`. */
  name: string;
  /**
   * The key kinds written after the name, in source order and **split on
   * the comma**: `string c UK,PK "both"` reports `keys: ["UK", "PK"]`.
   *
   * ⚠️ That split is this construct's own and must not be generalized.
   * Measured one kind over, a state diagram's `class Busy alpha,beta` does
   * **not** split — it yields one literal class name `"alpha,beta"` — so a
   * comma means a list here and a character there.
   *
   * Three kinds and no more: Mermaid's in-block key rule is
   * `\b((?:PK)|(?:FK)|(?:UK))\b`, case-insensitively, and the spelling is
   * kept as written (`pk` stays `pk`). A fourth word in the key position is
   * a parse error — `string c UK,XX "both"` is refused by Mermaid — and a
   * repeat is not (`PK,PK` reports two).
   */
  keys: string[];
  /**
   * The quoted comment after the keys, without its quotes, or `""` when the
   * author wrote none. It is the **last** thing on an attribute: measured,
   * `string x "a" PK` is a parse error, and so is a second comment. A comma
   * inside it is ordinary text (`"x, y"` is one comment), which is the same
   * character that splits `keys` two fields to the left.
   *
   * Read by `readLabel` in the full `html` dialect (ADR-0015): measured
   * (mermaid 11.17.2, `--html`), `string name "a<br/>b"` draws `a` over
   * `b`. No comment written is the empty label — one row, one empty run —
   * so "wrote none" is `comment.text === ""`. `type` and `name` are never
   * read for tags: they are drawn as written.
   */
  comment: Label;
}

/**
 * The parsed ER document: an `erDiagram` header and the entities under it.
 * One arm of the `SirenDocument` union.
 *
 * `erDiagram` is its **only** header spelling, measured rather than assumed
 * by analogy with `classDiagram-v2`: mermaid 11.17.2 detects an ER document
 * with `/^\s*erDiagram/` and its lexer's keyword rule is `erDiagram\b`, so
 * there is no `-v2` alias to collapse. `erDiagram-v2` *is* accepted, and not
 * as a spelling of the header — the prefix detector fires, the keyword token
 * ends at the `\b`, and the trailing `-v2` is read as an **entity named
 * `-v2`** beside whatever else the document declares.
 *
 */
/**
 * A `subgraph <name> ... end` block in an ER document, as written — the
 * counterpart of a flowchart's `SirenSubgraph`, and measured to be a
 * genuinely different construct rather than the same one re-read.
 *
 * Three differences from `SirenSubgraph`, each measured against mermaid
 * 11.17.2 with `scripts/mermaid-probe.mjs` and each costing a document if
 * carried across:
 *
 * - **The name is mandatory.** A bare `subgraph` with no name is a parse
 *   error here ("Expecting 'UNICODE_TEXT', 'NUM', 'ENTITY_NAME',
 *   'DECIMAL_NUM', 'ENTITY_ONE', got 'NEWLINE'"), where a flowchart mints
 *   `subGraph0` for it. So this field is a `string` and not
 *   `string | null`.
 * - **The header owns its line.** Mermaid's rule is `SUBGRAPH entityName
 *   separator`, and the separator has to be a newline: `subgraph s1 A end`
 *   and `subgraph s1; A` are both parse errors. `end` is the opposite —
 *   an ordinary statement in the line's stream, so `A end` closes the
 *   block after declaring `A` and `end B` declares `B` outside it.
 * - **The name alphabet is an ER entity name**, either spelling: `a.b` is
 *   a legal block name and `subgraph "My Cluster"` keys the block on
 *   `My Cluster` with the quotes stripped, while `subgraph My Cluster`
 *   unquoted is a parse error.
 */
export interface ErSubgraph {
  /**
   * The author's own handle for the block, quotes stripped. Not the id
   * anything downstream addresses the frame by — that is generated, see
   * `ResolvedErSubgraph` — but the word an author would type, which is
   * what a `style` or a relationship endpoint naming a cluster reaches for
   * and therefore what the refusals for those two are spelled against.
   *
   * Two blocks may share it: measured, `subgraph s1 ... end` twice reports
   * **two** clusters both keyed `s1`, so this is not unique and nothing may
   * treat it as a key.
   */
  name: string;
  /**
   * The text drawn on the frame: the bracketed title if the header wrote
   * one, otherwise the name again (measured — `subgraph s1` answers
   * `title:"s1"`).
   *
   * The brackets take either spelling and the quotes are optional:
   * `s1["My Title"]` and `s1 [Bracket Title]` both answer with the text
   * between them. Mermaid's `subgraphTitle` is a *list of words* joined
   * with a single space, so `s1[a   b]` answers `"a b"` — measured, which
   * is why the run of spaces is collapsed rather than carried.
   *
   * Read by `readLabel` in the full `html` dialect once the spaces are
   * collapsed (ADR-0015): measured (mermaid 11.17.2, `--html`),
   * `s1["My<br/>Title <b>x</b>"]` is the cluster label
   * `<p>My<br>Title <b>x</b></p>`. The name standing in for an unwritten
   * title is a plain label of itself, never read for tags.
   */
  label: Label;
  /**
   * This block's own rank direction, or `null` when it wrote none and its
   * members lay out along the document's.
   *
   * ⚠️ **Independent of the document's, measured.** `subgraph s1 /
   * direction LR / ... / end` answers `dir:"LR"` on the cluster while
   * `getDirection()` stays `TB` — Mermaid's `direction` action is
   * `if (!yy.subgraphDepth) setDirection(...) else pass it up`, so the same
   * statement means two different things depending on where it is written.
   * **Last wins inside a block too**, measured: two `direction`s in one
   * block answer with the second.
   */
  direction: Direction | null;
  /**
   * The entities declared directly inside this block, in source order and
   * de-duplicated — **relationship endpoints included**, which is measured
   * rather than assumed: `subgraph sales / CUSTOMER ||--o{ ORDER : places /
   * end` answers `nodes:["CUSTOMER","ORDER"]`.
   *
   * A name claimed by two blocks is still listed by both here; which block
   * keeps it is `buildErModel`'s, because Mermaid settles it in *closing*
   * order and the parser reads in opening order.
   */
  entityNames: string[];
  /** Blocks opened inside this one, in source order. */
  subgraphs: ErSubgraph[];
}

export interface ErDocument {
  kind: "er";
  /**
   * The whole diagram's rank direction: the `direction LR` (or
   * `TB`/`BT`/`RL`) the author wrote, or `TB` when they wrote none.
   *
   * Non-null, the way `ClassDocument.direction` and
   * `StateDocument.direction` are: measured, Mermaid's ER database
   * initializes `this.direction = "TB"` and `getDirection()` returns it, so
   * "the author named none" is not a third answer downstream could do
   * anything with.
   *
   * ⚠️ **Last wins, and this had to be measured because the two kinds
   * already here disagree.** `direction LR` then `direction RL` reports
   * `RL`, and the reverse pair reports `LR` (mermaid 11.17.2): its
   * `setDirection(dir)` is a plain assignment, so every statement overwrites
   * the one before. That is `ClassDocument.direction`'s rule and the
   * **opposite** of `StateDocument.direction`'s first-wins, which answers
   * `getDirection()` with `rootDoc.find((doc) => doc.stmt === "dir")`.
   * Deriving this from either would have drawn one of the two documents the
   * wrong way round.
   *
   * Position on the page does not matter: a `direction` written after the
   * first relationship governs just the same (measured).
   *
   * ⚠️ **Four spellings and `TD` is not one of them.** Mermaid's ER lexer
   * writes `TB`/`BT`/`RL`/`LR` out literally and the flowchart's `TD` alias
   * does not reach this grammar — measured, `direction TD` is **two
   * entities**, `direction` and `TD`. So the `TD` normalization
   * `Direction`'s own doc describes belongs to the kinds that accept it, and
   * not to this one.
   */
  direction: Direction;
  /**
   * The entities declared, in source order — by a bare name on a line of its
   * own **and** by either end of a relationship, interleaved.
   *
   * One list rather than two, and that is measured rather than tidy:
   * `erDiagram / ZZZ / A ||--o{ B : first / B / A` reports three entities in
   * the order `ZZZ`, `A`, `B`, so Mermaid's table is in first-mention order
   * across *both* kinds of statement. Keeping relationship endpoints in
   * `relationships` alone would leave nothing able to say that `ZZZ` came
   * before `A` and after nothing. De-duplication is still `buildErModel`'s,
   * so a name appears here once per mention.
   */
  entities: ErEntityDecl[];
  /** The relationships declared, in source order. */
  relationships: ErRelationshipDecl[];
  /**
   * The `subgraph <name> ... end` blocks written at the **top level** of the
   * document, in source order; a block opened inside another is in that
   * one's own `subgraphs` instead.
   *
   * ⚠️ **ER really has clusters** — `getSubGraphs()` answers with an entry
   * per block while `getEntities()` stays flat (measured, mermaid 11.17.2),
   * so membership lives on the *cluster* here and not on the entity, which
   * is the opposite of where `GraphNode.parentId` puts a flowchart's. It
   * moves to the entity one stage later, in `buildErModel`, for the reason
   * `ResolvedSubgraph` gives: two statements of one fact are free to
   * disagree. The parser cannot be that stage, because an entity is
   * declared once per *mention* here and a member is claimed once.
   */
  subgraphs: ErSubgraph[];
  /**
   * The `style`, `classDef`, `class` and `:::` statements the author wrote,
   * in written order, as the same kind-agnostic `StyleDecl` a flowchart, a
   * class diagram and a state diagram already parse to — so `resolveStyles`
   * pairs a definition with the directive applying it here exactly as it
   * does there.
   *
   * **Four spellings, three roles, and this kind is the first to write all
   * of them.** `class X name` and `X:::name` are one `apply` in two
   * spellings (measured, mermaid 11.17.2: both reach `setClass`, and both
   * leave the entity's `cssClasses` reading `"default name"`), with the
   * author's own keyword kept in `StyleDecl.authoredAs` so a diagnostic
   * quotes the line they wrote.
   *
   * ⚠️ **Only an entity can be a target, measured from Mermaid's own
   * database rather than inferred.** `addCssStyles(ids, styles)` and
   * `setClass(ids, classNames)` each look up `this.entities.get(id)` and
   * `this.subGraphLookup.get(id)` and nothing else, so **no relationship
   * can ever be styled** — `style CUSTOMER:ORDER fill:#f96` parses, reaches
   * `addCssStyles`, and paints nothing. That is why `buildErModel` hands
   * `resolveStyles` the entity ids alone and not the `addressable` list the
   * timeline gets.
   */
  styles: StyleDecl[];
  /**
   * The `timeline:` block as written, or `null` when the document declares
   * none — the same field, with the same two meanings, that
   * `FlowchartDocument`, `ClassDocument`, `SequenceDocument` and
   * `StateDocument` already carry.
   *
   * `null` and `{ entries: [] }` are deliberately different answers: the
   * first says the author wrote no block at all, the second that they opened
   * one and put no step in it. `resolveTimeline` short-circuits on the
   * first, which is what keeps a document with no animation free of every
   * timeline diagnostic.
   *
   * Not Mermaid syntax and so nothing here is measured against it: the block
   * is Siren's own (ADR-0002), read by the one shared grammar
   * `parseTimelineBlock` rather than by a fifth copy of it.
   */
  timeline: SirenTimeline | null;
  /**
   * The diagram's screen-reader-only title — Mermaid's `accTitle:`
   * statement. Draws nothing on the canvas and declares no entity
   * (measured, mermaid 11.17.2: the document that writes it beside
   * `CUSTOMER ||--o{ ORDER : places` still reports exactly two entities);
   * it reaches only the rendered SVG's `<title>`.
   *
   * ER has no visible `title` statement of its own for this to be distinct
   * from, so — exactly as in `FlowchartDocument` — this field carries the
   * whole of the construct.
   */
  accTitle: string | null;
  /**
   * The diagram's screen-reader-only description — Mermaid's `accDescr:`
   * statement, `accTitle`'s twin. Draws nothing on the canvas either, and
   * reaches only the rendered SVG's `<desc>`.
   */
  accDescr: string | null;
}

/**
 * How many of one entity take part at one end of a relationship.
 *
 * Four values, and a fifth that is deliberately absent. Mermaid's
 * `Cardinality` enum (11.17.2) has five members — `ONLY_ONE`,
 * `ZERO_OR_ONE`, `ONE_OR_MORE`, `ZERO_OR_MORE` and `MD_PARENT`, the last
 * spelled `u` (`A u--o{ B : x`, measured: it parses, and Mermaid then draws
 * **no marker at all** on that end). Since nothing in the document says what
 * a missing marker means, `u` is refused by name in `parseErDiagram` rather
 * than guessed at, and it is not in this union.
 *
 * Each value is one *figure*, measured from Mermaid's own marker defs and
 * decomposing cleanly into two glyphs — the one touching the entity box and
 * the one further out along the line:
 *
 * | value | inner glyph | outer glyph |
 * | --- | --- | --- |
 * | `onlyOne` | bar | bar |
 * | `zeroOrOne` | bar | circle |
 * | `oneOrMore` | crow's foot | bar |
 * | `zeroOrMore` | crow's foot | circle |
 *
 * So the inner glyph says *one or many* and the outer says *mandatory or
 * optional* — which is the classic crow's-foot reading, and it is what the
 * renderer builds its four markers out of.
 */
export type ErCardinality = "onlyOne" | "zeroOrOne" | "oneOrMore" | "zeroOrMore";

/**
 * Which of the two lines a relationship is drawn with. Measured: `--` is
 * Mermaid's `IDENTIFYING` and each of `..`, `.-` and `-.` is
 * `NON_IDENTIFYING` — three spellings of one value, not three values — and
 * the word forms agree (`to` identifying, `optionally to` not). Mermaid
 * draws the second with `stroke-dasharray: 8,8`.
 */
export type ErRelationshipLine = "identifying" | "nonIdentifying";

/**
 * One relationship as the author wrote it, described **left to right in the
 * source's own order**.
 *
 * ⚠️ **Mermaid's own record of this is crossed over, and these field names
 * deliberately are not.** Measured (mermaid 11.17.2,
 * `scripts/mermaid-probe.mjs`), `CUSTOMER ||--o{ ORDER : places` reports
 * `cardA="ZERO_OR_MORE" cardB="ONLY_ONE"` — `cardA` is the marker written
 * next to `entityB`, and `cardB` the one next to `entityA`. (Mermaid's
 * *picture* is right: its renderer reads `arrowTypeStart` out of `cardB`,
 * undoing the swap.) `leftCardinality` here means the marker next to
 * `left`, with nothing to undo, because a field whose name says the
 * opposite of what it holds draws every relationship backwards exactly once
 * and then looks fine.
 *
 * Three of the sixteen cardinality pairs are symmetric — `||--||`,
 * `}|--|{`, `|o--o|` — so a test written on one of them passes with the
 * sides swapped. Every test and every corpus row for this construct uses an
 * asymmetric pair for that reason.
 */
export interface ErRelationshipDecl {
  /** The entity named first on the line. */
  left: string;
  /** The marker written next to `left` — **not** Mermaid's `cardA`. */
  leftCardinality: ErCardinality;
  line: ErRelationshipLine;
  /** The marker written next to `right` — **not** Mermaid's `cardB`. */
  rightCardinality: ErCardinality;
  /** The entity named second on the line. */
  right: string;
  /**
   * The text after the colon. **Required**, measured rather than assumed:
   * `CUSTOMER ||--o{ ORDER` with no colon is a Mermaid parse error
   * ("Expecting 'COLON', 'STYLE_SEPARATOR', got 'NEWLINE'"), so there is no
   * such thing as an unlabelled ER relationship and this is not nullable.
   *
   * Read by `readLabel` in the full `html` dialect (ADR-0015): measured
   * (mermaid 11.17.2, `--html`), `: "places<br/>many"` is the edge label
   * `<p>places<br>many</p>` — two rows.
   */
  label: Label;
}

// ---------------------------------------------------------------------------
// ER diagram — graph-model (post `buildErModel`) types
// ---------------------------------------------------------------------------

/**
 * An entity after model resolution: what addresses it, and what is drawn in
 * its box.
 *
 * **Two fields where the parser had one, and the split is not cosmetic.**
 * Today both hold the name the author wrote — measured, Mermaid keys its
 * entity table on that name and reports `label="CUSTOMER"` for it. An
 * **alias** is what pulls them apart: `CUSTOMER["Customer Account"]` records
 * `label="CUSTOMER" alias="Customer Account"` on one entity (measured), so
 * the ticket that implements it changes what is drawn and must not change
 * what a transition or a `timeline:` entry names. ADR-0009 makes a timeline
 * target an *id*, and this is the field that keeps it stable across a
 * rename.
 */
export interface ResolvedErEntity {
  /** The authored name: `data-siren-id`, and the handle everything addresses. */
  id: string;
  /**
   * What the box draws: the alias the author gave it, or a plain label of
   * its name, which has no tag in it to read.
   */
  label: Label;
  /**
   * Every attribute this entity declared, in source order and **joined
   * across blocks** — measured, an entity that opens two blocks carries both
   * their attributes, in the order the blocks appeared. Empty when the
   * entity declared none, which is the case that draws the plain labelled
   * rectangle a box with no table is.
   *
   * Not de-duplicated, and that is measured too: `PK,PK` reports two keys
   * and two attributes of the same name are both recorded, so there is no
   * rule here to apply beyond concatenation.
   */
  attributes: ErAttribute[];
  /**
   * The id of the `subgraph` cluster this entity was claimed by, or `null`
   * when no block claimed it.
   *
   * A `ResolvedErSubgraph.id` — generated (`subgraph:1`) and never the
   * author's word — for the reason that type gives. `null` rather than
   * absent, and on **every** entity including those in a document with no
   * block at all, so nothing downstream has to tell "no parent" from "this
   * kind does not have parents".
   *
   * ⚠️ **Membership lives here and on nothing else.** The parser reads it
   * the other way round, because Mermaid does — `getSubGraphs()` carries a
   * node list while `getEntities()` stays flat — and this stage turns it
   * over, exactly as `ResolvedSubgraph` explains for a flowchart: a frame
   * and the box inside it must not be able to disagree about which holds
   * which.
   */
  parentId: string | null;
}

/**
 * A `subgraph` cluster after model resolution: given the id the renderer
 * and a `timeline:` entry address it by, and pointed at the block enclosing
 * it.
 *
 * **The id is generated, not authored**, exactly as `ResolvedSubgraph`'s
 * and `ResolvedClassNamespace`'s are, and for this kind the argument is
 * sharper than for those: measured (mermaid 11.17.2), two blocks may be
 * written with the *same* name and both are recorded, so the author's word
 * is not even unique among clusters. ADR-0010 settles the spelling —
 * `${kind}:${n}`, minted by `generatedId`.
 *
 * ⚠️ **And ADR-0010's separating argument does not reach this kind**, which
 * is why `reportIdCollisions` exists: a *quoted* ER entity name may contain
 * anything, so `"subgraph:1"` is a legal entity id (measured) and can
 * collide with this one. The check is what holds the invariant that the
 * spelling holds for the other four kinds. That is the registration
 * `ResolvedSubgraph`'s own doc comment asks a future ER cluster to make,
 * and this is it.
 *
 * Flat and in **pre-order** — the order the author wrote the `subgraph`
 * keywords down the page — for the two reasons `ResolvedSubgraph` gives:
 * layout wants one cluster per entry with a parent to point at, and an
 * author counting keywords is what numbers them. Note that Mermaid's own
 * `getSubGraphs()` is in *closing* order instead; the two differ the moment
 * a block nests, and only the membership rule below reads that order.
 *
 * Membership is not here: it is on `ResolvedErEntity.parentId`.
 */
export interface ResolvedErSubgraph {
  id: string;
  /** What the frame draws — the block's title, carried through. */
  label: Label;
  /** The cluster this one is nested in, or `null` at the top level. */
  parentId: string | null;
  /**
   * This cluster's own rank direction, carried straight through from
   * `ErSubgraph.direction`, or `null` when it wrote none.
   *
   * ⚠️ **`null` is not "the document's direction" and must not be turned
   * into one here.** `layoutDirectedGraph` gives a cluster with no
   * direction of its own but a *directed* ancestor the graph's own
   * `rankdir` (`rankdirFor`), which is both what Mermaid means and what
   * makes the engine expand it; writing the document's direction in at this
   * stage would hand every cluster a `rankdir` and lose that distinction.
   */
  direction: Direction | null;
}

/**
 * A relationship after model resolution: an id of its own, its two
 * endpoints, and the marker drawn at **each** of them.
 *
 * `from`/`to` are the source's left and right, and `fromCardinality` is the
 * marker drawn against `from`. Mermaid's own record crosses those two —
 * see `ErRelationshipDecl` for the measurement — and the crossing is undone
 * once, in the parser, so that nothing downstream has to remember it.
 */
export interface ResolvedErRelationship {
  /**
   * **`${from}:${to}`** — a colon, and this is the only kind that uses one.
   * Then `#2`, `#3`, ... for repeats of the same ordered pair, which *is*
   * the shared convention: measured, `A ||--o{ B : first` and `A }o--|| B :
   * second` report **two** relationships, so the suffix is load-bearing
   * rather than defensive. Reproducible, too — the id is a function of the
   * source's own names and order, so two renders of one document mint it
   * identically.
   *
   * ⚠️ **A flowchart edge, a class relationship, a sequence message and a
   * state transition all keep `${from}-${to}`, and must.** Their authored
   * ids are `\w+`, which cannot contain a hyphen, so the collision below is
   * unconstructible there; changing them would move three kinds' public
   * `data-siren-id` surface to fix a problem only this kind has.
   *
   * ⚠️ **Why this kind is different, and why the colon is an improvement
   * rather than a proof.** ADR-0010's argument — a connector id cannot
   * spell anything else, because every authored id is `\w+` — fails here.
   * An unquoted ER entity name is `([^\x00-\x7F]|\w|-|\*|\.)+` (measured
   * from Mermaid's own lexer), so it may contain `-`: under the old
   * spelling `erDiagram / LINE-ITEM / LINE ||--o{ ITEM : x` drew an entity
   * and a relationship **both** wearing `data-siren-id="LINE-ITEM"`, with
   * no diagnostic. The picture was right; the ambiguous thing was a
   * `timeline:` entry naming that id, which `createAnimationController`
   * applies to every element wearing it (ADR-0009).
   *
   * A colon is measured to be refused everywhere an **unquoted** ER name is
   * read — each of `erDiagram / A:B`, `A:B ||--o{ C : has`, `A ||--o{ C:D :
   * has`, `A { str:ing x }` and `A { string x:y }` is a parse error in
   * mermaid 11.17.2 (`scripts/mermaid-probe.mjs`). But it is **not**
   * impossible in an ER name outright, and a comment that said so would be
   * wrong: a *quoted* name takes any character at all, and both
   * `erDiagram / "CUSTOMER:ORDER" ||--|| X : y` and
   * `erDiagram / "subgraph:1" ||--|| B : y` parse. Siren refuses quoted
   * names today (`er-entity-name-quoted`), which is the only reason this
   * spelling cannot be collided with from a source document right now.
   *
   * So the invariant is **not** held by the separator. It is held by
   * `reportIdCollisions` in `buildErModel`, which compares the ids actually
   * minted and warns when two drawn elements share one — a check rather
   * than an argument, because no choice of separator survives a name
   * alphabet that has no forbidden characters left. The corpus row
   * `er-relationship-id-space` is what pins it.
   */
  id: string;
  /** The entity at the left-hand end, as the source wrote it. */
  from: string;
  /** The entity at the right-hand end. */
  to: string;
  /** The marker drawn against `from`. */
  fromCardinality: ErCardinality;
  /** The marker drawn against `to`. */
  toCardinality: ErCardinality;
  line: ErRelationshipLine;
  /** What the relationship's label draws, carried through from `ErRelationshipDecl.label`. */
  label: Label;
}

/**
 * The normalized in-memory ER diagram produced by `buildErModel`: the
 * entities, de-duplicated, the relationships with their ids, and the
 * resolved timeline.
 */
export interface ErModel {
  /**
   * The whole diagram's rank direction, carried straight through from
   * `ErDocument.direction` — `TB` unless the author named one. Non-null for
   * the reason that field gives, and `layoutErDiagram` hands it to
   * `layoutDirectedGraph` as `rankdir` with nothing to map, since the four
   * values are dagre's own.
   */
  direction: Direction;
  /**
   * The entities, in the order they were first named and **once each**.
   * Measured: `CUSTOMER / ORDER / CUSTOMER` reports two entities with
   * `CUSTOMER` still first, because Mermaid's table is keyed on the name and
   * a second mention finds the entry already there. Two boxes sharing a
   * `data-siren-id` would make a timeline entry naming it ambiguous, so this
   * is a rule the model owes rather than a tidy-up.
   */
  entities: ResolvedErEntity[];
  /** The relationships, in source order and each with an id of its own. */
  relationships: ResolvedErRelationship[];
  /**
   * Every `subgraph` cluster the document declared, flattened into the
   * order the author wrote the keywords — outermost before the blocks
   * nested inside it, which is also the order the frames must be drawn in,
   * a frame being painted behind what it groups.
   */
  subgraphs: ResolvedErSubgraph[];
  /**
   * Each styled entity's accepted declarations, already flattened by the
   * shared `resolveStyles` — one entry per entity that ended up with at
   * least one, and none for an entity the author styled with nothing.
   *
   * ⚠️ **Only an entity can be a target, and a relationship deliberately
   * cannot.** Measured from Mermaid's own database: `addCssStyles` and
   * `setClass` reach `entities` and `subGraphs` and nothing else, so
   * `style CUSTOMER:ORDER fill:#f96` paints nothing there — and
   * `CUSTOMER:ORDER` is exactly the id this model gives that relationship,
   * so the two lists are not interchangeable however alike they look.
   */
  styles: ResolvedStyle[];
  /**
   * The `timeline:` block resolved against this kind's two target kinds —
   * an **entity**, by the id its author wrote whatever an alias renamed it
   * to on screen, and a **relationship**, by the id `buildErModel` assigned
   * it. An **attribute** is neither: its cells are drawn inside the entity's
   * `<g>` with no `data-siren-id` of their own, so the box that owns a row
   * is what animates it.
   *
   * `{ totalSteps: 0, entries: [] }` for a document that opened no block,
   * which is still what `render()` needs: it builds an
   * `AnimationController` for **every** kind
   * (`SirenRenderResult.controller` is null only when rendering failed), so
   * something has to be handed to it either way.
   */
  timeline: ResolvedTimeline;
  /** Carried through unchanged from `ErDocument.accTitle` — no resolution needed for plain text with no target to validate against. */
  accTitle: string | null;
  /** Carried through unchanged from `ErDocument.accDescr` — no resolution needed for plain text with no target to validate against. */
  accDescr: string | null;
}

/**
 * Result of `buildErModel` — `model` non-nullable, exactly as the other four
 * builders' results are and for the reason `GraphModelResult` gives: there
 * is no failure path here, so a nullable payload would be a state no caller
 * can reach.
 */
export interface ErModelResult {
  model: ErModel;
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// ER diagram — layout (post `layoutErDiagram`) types
// ---------------------------------------------------------------------------

/**
 * An entity with a layout-assigned box. `x`/`y` are the box's top-left
 * corner, matching `PositionedNode`, `PositionedClass` and `PositionedState`.
 *
 * The box is a plain rectangle and there is no field saying so, because
 * there is nothing else it could be: measured with `--markup`, mermaid
 * 11.17.2 draws an entity as a `rect.basic.label-container` carrying no `rx`
 * at all, with the name in a `<text>` inside it. The corner radius that
 * *is* a decoration stays the theme's, exactly as a flowchart rectangle's
 * does.
 */
export interface PositionedErEntity {
  id: string;
  /** What the box draws, carried through from `ResolvedErEntity.label`. */
  label: Label;
  /**
   * The label as `layoutLabel` measured it — the box the name row was sized
   * around. The renderer centres it in that row and hands it `drawLabel`.
   */
  labelBox: LabelBox;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Author declarations to emit as this entity's inline `style` attributes:
   * the frame's on the box it is drawn as, the text's on the name **and on
   * every attribute cell**.
   *
   * That reach is measured rather than chosen. With `--markup`, mermaid
   * 11.17.2 puts an author's `color` on the entity's name label *and* on
   * every `attribute-type` / `attribute-name` / `attribute-keys` /
   * `attribute-comment` label in the same box — one `<text style="fill:#fff
   * !important">` apiece. A `class` names the entity and not one of its
   * rows, so recolouring a box means its whole table.
   *
   * Both halves are empty rather than absent for an entity the author styled
   * with nothing, so the renderer asks one question instead of two —
   * `PositionedState.style` and `PositionedClass.style` carry theirs the
   * same way.
   */
  style: AuthorStyle;
  /**
   * The attribute table inside the box, or `null` when the entity declared
   * no attributes.
   *
   * `null` rather than an empty table, because the two are **different
   * pictures** and not two amounts of the same one. Measured with
   * `--markup`: an entity with no attributes is a `rect.basic
   * .label-container` with its name centred in it, while one with
   * attributes is a name row, a rule, and a grid — Mermaid's `erBox` takes
   * an early return for the first. An empty table would draw a rule across
   * a box with nothing under it.
   *
   * When it is present, the name is centred in the band between the box's
   * top edge and `headerDividerY` rather than in the box, exactly as a
   * class's name is centred above its first compartment divider.
   */
  attributeTable: PositionedErAttributeTable | null;
}

/** Which of an attribute's four fields a drawn cell holds. */
export type ErAttributeColumn = "type" | "name" | "keys" | "comment";

/**
 * One attribute's table inside an entity box, in diagram coordinates.
 *
 * The geometry is Siren's (ADR-0004) and the *structure* is Mermaid's,
 * measured from its `erBox` renderer and its `--markup`: a full-width rule
 * under the name row, a vertical rule at every internal column boundary,
 * and one row per attribute with the cells left-aligned in their columns.
 *
 * **There is no rule between attribute rows, and that is measured too.**
 * Mermaid's horizontal-rule loop runs over `yOffsets`, which holds a single
 * `0` — so the only horizontal rule it ever draws is the one under the name.
 * It separates the rows by filling them in alternating shades instead. Siren
 * draws no such fill: a row's shade is a *paint*, and paint is the theme's
 * (ADR-0008, the rule a flowchart rectangle's corner radius already
 * follows), while the rules are the figure.
 */
export interface PositionedErAttributeTable {
  /** y of the full-width rule between the name row and the first attribute. */
  headerDividerY: number;
  /**
   * x of each vertical rule, left to right — one at every boundary
   * *between* two drawn columns, and none at the box's own edges.
   *
   * So two columns make one rule and four make three, and a column an
   * entity wrote nothing in takes its rule with it when it goes: measured,
   * Mermaid's `keysPresent`/`commentPresent` flags skip the rule and zero
   * the width together.
   */
  columnDividerXs: number[];
  /** One per attribute, in source order. */
  rows: PositionedErAttributeRow[];
}

/** One attribute's drawn cells — the columns this entity uses, and no others. */
export interface PositionedErAttributeRow {
  cells: PositionedErAttributeCell[];
}

/**
 * One cell of the attribute table: what it says, and where its text starts —
 * a **text cell** for the type, name and keys, which are drawn as written,
 * or a **comment cell**, whose comment is a label (ADR-0015). Told apart by
 * `column`.
 *
 * `x` is the text's **left edge**, not its centre — cells are left-aligned
 * in their columns, which is measured (Mermaid places each label at its
 * column's left plus half the padding) and is what keeps a column of types
 * reading as a column.
 */
export type PositionedErAttributeCell = PositionedErAttributeTextCell | PositionedErAttributeCommentCell;

/** A type, name or keys cell: one line of literal text, never read for tags. */
export interface PositionedErAttributeTextCell {
  column: Exclude<ErAttributeColumn, "comment">;
  /**
   * The text drawn. For `keys` this is the list **re-joined with a comma** —
   * `attribute.keys.join()` is what Mermaid draws, so `UK,PK` reads back as
   * the author wrote it even though the model holds two keys. The split is
   * not undone: three keys make `PK,FK,UK`, and a single name containing a
   * comma could never reach this field, because the key list admits only
   * `PK`, `FK` and `UK`.
   */
  text: string;
  x: number;
  /** Vertical centre of the text, the way `PositionedClass`'s member lines are. */
  y: number;
}

/**
 * A comment cell: the comment as a label. `labelBox` is what `layoutLabel`
 * measured, which the row's height and the column's width were sized from,
 * and `anchor` the centre the renderer hands `drawLabel`: the band the
 * label's widest row fills starts at `x`, so a one-row comment's text starts
 * where every cell's in the column does.
 */
export interface PositionedErAttributeCommentCell {
  column: "comment";
  x: number;
  /** Vertical centre of the label, as a text cell's `y` is. */
  y: number;
  label: Label;
  labelBox: LabelBox;
  anchor: Point;
}

/**
 * A relationship with a route. `points` runs **from `from` to `to`** — the
 * source's own left-to-right order — so the renderer hangs
 * `fromCardinality` on `marker-start` and `toCardinality` on `marker-end`
 * with nothing to reverse. Reversing the route somewhere in here and the
 * markers somewhere else would cancel out on the three symmetric
 * cardinality pairs and draw every other relationship backwards.
 */
export interface PositionedErRelationship {
  id: string;
  from: string;
  to: string;
  fromCardinality: ErCardinality;
  toCardinality: ErCardinality;
  line: ErRelationshipLine;
  /** What the label draws, carried through from `ResolvedErRelationship.label`. */
  label: Label;
  /**
   * The label as `layoutLabel` measured it — the size the layout kept clear
   * around `labelAnchor`, and what the renderer hands `drawLabel`.
   */
  labelBox: LabelBox;
  points: Point[];
  /**
   * Centre of the space the layout kept clear for the label, or `null` when
   * the shared layout core reserved none. Nullable on the same terms as
   * `PositionedClassRelationship.labelAnchor`, rather than because an ER
   * relationship can be unlabelled — measured, it cannot be.
   */
  labelAnchor: Point | null;
}

/**
 * The ER diagram after layout: positioned entities and routed
 * relationships plus the resolved timeline, ready for
 * `renderErDiagramToSVG`.
 */
/**
 * An ER `subgraph` cluster with a layout-assigned frame enclosing everything
 * inside it — its own entity boxes and, when it nests, the whole of each
 * frame beneath it, title strip included.
 *
 * The shape `PositionedSubgraph` and `PositionedClassNamespace` already
 * have, because it is the same figure: a labelled box drawn *behind* what it
 * groups, which is exactly what `--markup` reports Mermaid drawing for an ER
 * cluster too — a `g.cluster` holding a `<rect>` and a `g.cluster-label`.
 * A type of its own rather than a shared one, for the reason
 * `PositionedSubgraph` gives about the class diagram's: these kinds do not
 * share types across the boundary, and collapsing them would be the first
 * time.
 */
export interface PositionedErSubgraph {
  id: string;
  /** What the frame's title draws, carried through from `ResolvedErSubgraph.label`. */
  label: Label;
  /**
   * The title as `layoutLabel` measured it — the strip along the frame's
   * top was sized from it, and the renderer hands it `drawLabel`.
   */
  labelBox: LabelBox;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where the frame's title is drawn: centred in the strip above its contents. */
  labelAnchor: Point;
}

export interface PositionedErDiagram {
  entities: PositionedErEntity[];
  relationships: PositionedErRelationship[];
  /**
   * The cluster frames, in the model's order — outermost before the frames
   * nested inside them, which is also the order they must be drawn in: a
   * frame is painted behind what it groups, so an inner frame drawn first
   * would be hidden by the outer one.
   */
  subgraphs: PositionedErSubgraph[];
  timeline: ResolvedTimeline;
  width: number;
  height: number;
  /** Carried through unchanged from `ErModel.accTitle`. Takes no space on the canvas, so layout places nothing for it — it becomes the rendered root's `<title>`. */
  accTitle: string | null;
  /** Carried through unchanged from `ErModel.accDescr`. Takes no space either, and becomes the rendered root's `<desc>`. */
  accDescr: string | null;
}
