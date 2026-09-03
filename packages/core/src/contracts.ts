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

/** A single enter effect. v1 defines exactly one: `fade`. */
export type EnterEffect = "fade";

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

/** One `step N: enter <id> <effect>` entry from the `timeline:` block. */
export interface TimelineEntry {
  step: number;
  targetId: string;
  effect: EnterEffect;
  line?: number;
  column?: number;
}

/** The raw `timeline:` block as declared in source, before resolution. */
export interface SirenTimeline {
  entries: TimelineEntry[];
}

/**
 * The parsed document: a flowchart header, its nodes/edges, and an
 * optional timeline block. Produced by `parseSiren`.
 */
export interface SirenDocument {
  direction: Direction;
  nodes: SirenNode[];
  edges: SirenEdge[];
  timeline: SirenTimeline | null;
}

/** Result of `parseSiren`. */
export interface ParseResult {
  document: SirenDocument | null;
  diagnostics: Diagnostic[];
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

/** One resolved timeline entry, referencing a validated graph node/edge id. */
export interface ResolvedTimelineEntry {
  step: number;
  targetId: string;
  effect: EnterEffect;
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

/** Result of `buildGraphModel`. */
export interface GraphModelResult {
  graph: GraphModel | null;
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

/** A node with layout-assigned position and size. */
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
 * `reset()` restores the initial pending state.
 */
export interface AnimationController {
  totalSteps: number;
  currentStep: number;
  next(): void;
  reset(): void;
}

/** Result of the public `render()` entry point. */
export interface SirenRenderResult {
  svg: SVGSVGElement | null;
  controller: AnimationController | null;
  diagnostics: Diagnostic[];
}
