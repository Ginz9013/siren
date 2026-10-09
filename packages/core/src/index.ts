import { parseSiren } from "./parser/parseSiren";
import { buildGraphModel } from "./graph-model/buildGraphModel";
import { layoutGraph } from "./layout/layoutGraph";
import { layoutSequence } from "./layout/layoutSequence";
import { layoutClassDiagram } from "./layout/layoutClassDiagram";
import { layoutStateDiagram } from "./layout/layoutStateDiagram";
import { layoutErDiagram } from "./layout/layoutErDiagram";
import { UnplacedNodesError } from "./layout/layoutDirectedGraph";
import { renderToSVG } from "./renderer/renderToSVG";
import { renderSequenceToSVG } from "./renderer/renderSequenceToSVG";
import { renderClassDiagramToSVG } from "./renderer/renderClassDiagramToSVG";
import { renderStateDiagramToSVG } from "./renderer/renderStateDiagramToSVG";
import { renderErDiagramToSVG } from "./renderer/renderErDiagramToSVG";
import { createAnimationController } from "./animation/createAnimationController";
import type {
  AnimationController,
  Diagnostic,
  ResolvedTimeline,
  SirenRenderResult,
  TextMeasurer,
} from "./contracts";

export type { AnimationController, Diagnostic, SirenRenderResult, TextMeasurer } from "./contracts";

/**
 * The class a reader clicked, handed to `RenderOptions.onClick`.
 *
 * Only a class the author gave a *callback* interaction (`click X call fn()`,
 * `callback X "fn"`) is ever reported. An `href` interaction is a link: the
 * browser navigates it, and `render()` neither intercepts nor reports it.
 *
 * `action` and `argument` are kept apart rather than handed over as the one
 * string `fn(arg)` the author wrote. Re-parsing that string is not reliably
 * possible — an author's argument may itself contain brackets, commas and
 * quotes — and it is the renderer's own split: it emits `data-siren-click`
 * and `data-siren-click-arg` as two attributes for exactly that reason.
 */
export interface InteractionTarget {
  /** The clicked class's id — its `data-siren-id`. */
  id: string;
  /** The callback name the author wrote: `showDetails` for `call showDetails("a")`. */
  action: string;
  /** The literal argument the author wrote, or `null` when they wrote none. */
  argument: string | null;
}

/** Options accepted by the public `render()` entry point. */
export interface RenderOptions {
  /**
   * Overrides the text-measurement strategy `layoutGraph` uses for label
   * sizing. Defaults to a jsdom-safe fixed-width-per-character estimate
   * (jsdom implements no real text metrics); a real canvas/DOM-based
   * measurer is wired in by the browser demo instead.
   */
  measureText?: TextMeasurer;

  /**
   * Called when a reader clicks a class the author made clickable with a
   * callback interaction. Omitting it leaves those elements with no listener
   * at all — the markup is identical either way, and a click does nothing.
   *
   * The callback names a function in *the caller's* code, never one this
   * package looks up and invokes: a diagram is untrusted text, so what it can
   * ask for is a name, and what happens next stays the host's decision.
   */
  onClick?: (target: InteractionTarget) => void;

  /**
   * Whether to apply the document's `timeline:` block. Defaults to `true`.
   *
   * `false` draws the **full diagram** — the picture Mermaid draws for the
   * same document: every element visible, no enter / exit / highlight state,
   * and a controller with `totalSteps: 0`. It is not the timeline's last
   * step, which still hides whatever exited and still wears its highlights.
   *
   * The block is still parsed and validated, so `diagnostics` are exactly the
   * default render's, timeline errors included, and the render succeeds or
   * fails exactly when the default one does. Drawing a document with or
   * without its timeline therefore never makes a problem in it appear or vanish.
   */
  timeline?: boolean;
}

const DEFAULT_CHAR_WIDTH = 8;
const DEFAULT_LINE_HEIGHT = 24;
const DEFAULT_PADDING_X = 16;
const DEFAULT_PADDING_Y = 8;

/**
 * jsdom-safe fallback `TextMeasurer`: a fixed-width-per-character estimate,
 * since jsdom's `getBBox`/`measureText` return zeros. Callers needing real
 * text metrics (e.g. a browser demo) should pass `options.measureText`.
 */
const defaultMeasurer: TextMeasurer = {
  measure(text: string) {
    return {
      width: text.length * DEFAULT_CHAR_WIDTH + DEFAULT_PADDING_X,
      height: DEFAULT_LINE_HEIGHT + DEFAULT_PADDING_Y,
    };
  },
};

/**
 * Thrown when the `TextMeasurer` a consumer supplied answered a string with
 * something other than a usable size.
 *
 * **It names the text, not the node that holds it.** The measurement of that
 * string is what went wrong — the same string measured from a different node
 * fails identically, and a consumer whose measurer is a `<canvas>` context
 * debugs it by asking what that context returns for *that text*. A node id
 * would point at the one place the fault is not.
 *
 * A thrown error rather than a diagnostic for the reason `UnplacedNodesError`
 * is: a size that is not a number is not a local problem. It propagates
 * through every box, bound and route computed from it and takes the whole
 * picture with it, so the layout module it is raised inside has no partial
 * answer left to hand back. `render()` converts it to the error-severity
 * diagnostic an author sees at each of its five layout call sites, which is
 * what keeps `Diagnostic`'s contract — returned from `render()`, never thrown
 * — true of a measurer that misbehaves as well as of an engine that does.
 */
class UnmeasurableTextError extends Error {
  /** The string whose measurement failed. */
  readonly text: string;

  constructor(text: string, size: { width: unknown; height: unknown }) {
    super(
      `Measuring the text ${JSON.stringify(text)} produced no usable size ` +
        `(width ${String(size.width)}, height ${String(size.height)}). ` +
        `\`measureText\` is supplied by the caller and must answer every ` +
        `string with two finite numbers. This document cannot be drawn.`,
    );
    this.name = "UnmeasurableTextError";
    this.text = text;
  }
}

/**
 * Wraps the measurer `render()` is going to hand to layout so that a bad
 * answer is refused at the moment it is given, by the one party that knows it
 * is bad.
 *
 * **One decorator here rather than a check in each layout module.**
 * `measureText` is called only inside the five layout modules and nowhere else
 * in the pipeline, and all five receive it from this one resolution — so
 * wrapping it once covers every call any of them will ever make, including
 * calls in modules written later, and there is no fifth copy of the predicate
 * to drift. It is the input-side twin of the check `layoutDirectedGraph` makes
 * on the engine's answer: one guards what we are told, the other what we are
 * given back.
 */
function refusingBadMeasurements(measureText: TextMeasurer): TextMeasurer {
  return {
    measure(text: string) {
      const size = measureText.measure(text);
      // "Two finite numbers", stated positively — not "not `NaN`". `NaN` is
      // the answer that was reported, but an infinity, a dimension left out
      // and a number written as a string are all equally unusable, and a
      // negation written the other way round lets every one of them past.
      if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) {
        throw new UnmeasurableTextError(text, size);
      }
      return size;
    },
  };
}

/**
 * Attaches `onClick` to every element the class renderer marked with a click
 * hook, reading the target's identity back off the attributes it put there.
 *
 * One listener per hooked element rather than one delegated listener on the
 * `<svg>`: a click anywhere else in the diagram then reaches no handler of
 * ours at all, instead of reaching one that decides to do nothing. The
 * listeners need no removing — the whole tree is dropped when the container's
 * children are next replaced.
 */
function attachClickHooks(
  svg: SVGSVGElement,
  onClick: (target: InteractionTarget) => void,
): void {
  for (const element of Array.from(svg.querySelectorAll("[data-siren-click]"))) {
    const id = element.getAttribute("data-siren-id");
    const action = element.getAttribute("data-siren-click");
    // The renderer writes both attributes onto the same element, so this
    // skips nothing it produced; it is here because the DOM cannot say so.
    if (id === null || action === null) continue;
    const argument = element.getAttribute("data-siren-click-arg");

    element.addEventListener("click", () => {
      onClick({ id, action, argument });
    });
  }
}

/**
 * Puts a freshly rendered diagram into step 0 — the initial `siren-pending`
 * state — for whichever kind just rendered.
 *
 * `reset()` is by definition "the initial pending state", computed from
 * `computeClassStateAtStep(timeline, 0)`, and it is a no-op for a diagram
 * with no timeline. That is why no renderer stamps `siren-pending` itself:
 * two of them used to, each with a private copy of the "elements with an
 * `enter` action start hidden" rule, and a third copy for sequence would
 * have been three answers to a question `computeClassStateAtStep` already
 * answers. One call site, one rule, no drift.
 *
 * Every caller must invoke this in the *same synchronous task* as its
 * `container.replaceChildren(...)`, which is why this takes a controller
 * rather than doing the mounting itself: nothing is painted between the two,
 * so the reader never sees a frame of a to-be-hidden element.
 */
function establishStepZero(controller: AnimationController): void {
  controller.reset();
}

/** The timeline a document with no `timeline:` block resolves to. */
const NO_TIMELINE: ResolvedTimeline = { totalSteps: 0, entries: [] };

/**
 * The timeline `render()` hands the controller: the document's own, or none
 * at all when the caller asked for the full diagram.
 *
 * Substituted here, at the controller, rather than by dropping the block
 * before parsing: the block still has to be read for its diagnostics, and no
 * renderer reads the timeline (step 0 is the controller's, see
 * `establishStepZero`), so the controller is the one place it takes effect.
 */
function timelineToApply(timeline: ResolvedTimeline, options: RenderOptions): ResolvedTimeline {
  return options.timeline === false ? NO_TIMELINE : timeline;
}

/**
 * The controller `render()` returns for a mounted diagram of any kind, already
 * showing step 0.
 *
 * One function rather than the same two calls in each of the five branches so
 * that a controller-level option — `timeline: false` was the first — is
 * decided in one place instead of five that must agree. Every kind gets a
 * controller, even a document declaring no `timeline:` block (it gets
 * `totalSteps: 0`), because `SirenRenderResult.controller` is null *only* when
 * rendering failed: a caller that has checked `svg` has already checked this.
 *
 * Callers must invoke this in the *same synchronous task* as their
 * `container.replaceChildren(svg)` — it ends in `establishStepZero`, whose
 * whole point is that nothing is painted between mounting the SVG and hiding
 * the elements step 0 says are pending. That is also why it takes an already
 * rendered `svg` rather than mounting it: the branch keeps the mount, and any
 * click hooks it attaches, visible at its own call site.
 */
function controllerAtStepZero(
  svg: SVGSVGElement,
  timeline: ResolvedTimeline,
  options: RenderOptions,
): AnimationController {
  const controller = createAnimationController(svg, timelineToApply(timeline, options));
  establishStepZero(controller);
  return controller;
}

/** What one layout call produced: a positioned diagram, or the reason there is none. */
type LayoutAttempt<T> =
  | { placed: true; value: T }
  | { placed: false; diagnostic: Diagnostic };

/**
 * Runs one layout stage, turning the two failures it is allowed to have into
 * the error-severity diagnostic an author sees: `UnplacedNodesError`, the
 * engine not placing a node, and `UnmeasurableTextError`, the caller's
 * measurer not sizing a string (see both types). They are the two ends of the
 * same stage — what layout was told, and what layout was told back — and
 * neither leaves a partial picture behind, so both convert here.
 *
 * **Everything else is rethrown, deliberately.** A bare `catch` here would
 * report this package's own bugs as if they were defects in the author's
 * document, which is the same disguise CONTEXT.md's opening policy exists to
 * remove, only pointed the other way: a `TypeError` in a renderer is not
 * something an author can route around. Matching by type keeps the
 * conversion to the two cases that have a meaning for them, and adding a
 * second type to match is not the same as ceasing to match.
 *
 * It wraps a thunk rather than living at each call site because there are
 * five of them — flowchart, class, state and ER reach the same shared layout
 * core, and sequence has its own — and five copies of a `catch` that must not
 * be bare is five chances for one of them to become bare.
 */
function attemptLayout<T>(run: () => T): LayoutAttempt<T> {
  try {
    return { placed: true, value: run() };
  } catch (error) {
    if (error instanceof UnplacedNodesError || error instanceof UnmeasurableTextError) {
      return { placed: false, diagnostic: { severity: "error", message: error.message } };
    }
    throw error;
  }
}

/**
 * Runs parse -> buildGraphModel end to end, then dispatches on the parsed
 * document's `kind`: a flowchart runs layoutGraph -> renderToSVG ->
 * createAnimationController; a class diagram runs layoutClassDiagram ->
 * renderClassDiagramToSVG -> createAnimationController; a sequence diagram
 * runs layoutSequence -> renderSequenceToSVG -> createAnimationController;
 * a state diagram runs layoutStateDiagram -> renderStateDiagramToSVG ->
 * createAnimationController; an ER diagram runs layoutErDiagram ->
 * renderErDiagramToSVG -> createAnimationController. All five return a working controller — one with
 * `totalSteps: 0` when the document declares no `timeline:` block. Mounts the resulting SVG into
 * `container` on success, and always returns the aggregated diagnostics
 * from every stage. A class diagram and a flowchart both have
 * `options.onClick`, if one was given, attached to whichever of their
 * classes or nodes the author made clickable with a `call` interaction. A
 * sequence diagram's only interaction directive is `link`, which resolves
 * to an `href` (never a `call`), so its participants come back already
 * wrapped in a live `<a>` from `renderSequenceToSVG` itself — nothing here
 * needs to call `attachClickHooks` for it, the same reason a class's own
 * `href` interactions never do either.
 *
 * `options.timeline: false` hands every kind's controller an empty timeline
 * instead of the document's, so the picture is the full diagram and there
 * are no steps. Everything before that point runs unchanged — the block is
 * parsed and validated as usual — which is why the diagnostics, and whether
 * the render succeeds at all, never depend on the option.
 */
export function render(
  source: string,
  container: HTMLElement,
  options: RenderOptions = {},
): SirenRenderResult {
  const measureText = refusingBadMeasurements(options.measureText ?? defaultMeasurer);
  const diagnostics: Diagnostic[] = [];

  const parseResult = parseSiren(source);
  diagnostics.push(...parseResult.diagnostics);

  if (parseResult.document === null) {
    return { svg: null, controller: null, diagnostics };
  }

  const graphResult = buildGraphModel(parseResult.document);
  diagnostics.push(...graphResult.diagnostics);

  // Dispatch on the *result's* tag rather than on the document's. They are
  // the same word — `buildGraphModel` carries the document's kind out
  // unchanged — but only the result's tag is what narrows `model` to the type
  // this branch is about to lay out.
  if (graphResult.kind === "er") {
    // The fifth layout call site, held to the same terms as the four below
    // it: it reaches the shared core, so `UnplacedNodesError` is possible in
    // principle, and a consumer's measurer can refuse a name here exactly as
    // it can refuse a label anywhere else.
    const erModel = graphResult.model;
    const erLayout = attemptLayout(() => layoutErDiagram(erModel, { measureText }));
    if (!erLayout.placed) {
      diagnostics.push(erLayout.diagnostic);
      return { svg: null, controller: null, diagnostics };
    }

    const positionedErDiagram = erLayout.value;
    const erSvg = renderErDiagramToSVG(positionedErDiagram);

    container.replaceChildren(erSvg);

    // An ER diagram animates on the same terms as every other kind: its
    // entities and relationships carry `data-siren-id`.
    const erController = controllerAtStepZero(erSvg, positionedErDiagram.timeline, options);

    return { svg: erSvg, controller: erController, diagnostics };
  }

  if (graphResult.kind === "state") {
    const stateModel = graphResult.model;
    const stateLayout = attemptLayout(() => layoutStateDiagram(stateModel, { measureText }));
    if (!stateLayout.placed) {
      diagnostics.push(stateLayout.diagnostic);
      return { svg: null, controller: null, diagnostics };
    }

    const positionedStateDiagram = stateLayout.value;
    const stateSvg = renderStateDiagramToSVG(positionedStateDiagram);

    container.replaceChildren(stateSvg);

    // A state diagram animates on the same terms as every other kind: its
    // states, its composite frames and its transitions all carry
    // `data-siren-id`, so the one controller drives them unchanged.
    const stateController = controllerAtStepZero(
      stateSvg,
      positionedStateDiagram.timeline,
      options,
    );

    return { svg: stateSvg, controller: stateController, diagnostics };
  }

  if (graphResult.kind === "class") {
    // The third of the three layout stages that reach the shared core, held
    // to the same terms as the other two. **No document reaches this branch's
    // failure path today** — the construct that defeats the engine is a
    // cluster carrying its own direction, and a class diagram's only cluster
    // is a namespace, which Mermaid neither nests nor gives a direction to.
    // It is written anyway because the guard it is catching is a check on the
    // *shape of the engine's answer*, not on that one construct: leaving this
    // site bare would mean a future source of a missing coordinate escapes
    // `render()` as a thrown error here while the other two kinds report it,
    // and `Diagnostic`'s contract is that it is returned and never thrown.
    const classModel = graphResult.model;
    const classLayout = attemptLayout(() => layoutClassDiagram(classModel, { measureText }));
    if (!classLayout.placed) {
      diagnostics.push(classLayout.diagnostic);
      return { svg: null, controller: null, diagnostics };
    }

    const positionedClassDiagram = classLayout.value;
    const classSvg = renderClassDiagramToSVG(positionedClassDiagram);

    container.replaceChildren(classSvg);

    if (options.onClick !== undefined) {
      attachClickHooks(classSvg, options.onClick);
    }

    // A class diagram animates: its classes and relationships carry
    // `data-siren-id`, so the same controller that drives flowchart nodes and
    // edges — and sequence participants — drives them unchanged.
    const classController = controllerAtStepZero(
      classSvg,
      positionedClassDiagram.timeline,
      options,
    );

    return { svg: classSvg, controller: classController, diagnostics };
  }

  if (graphResult.kind === "sequence") {
    // The one layout call site that is unlike the rest, and the reason these
    // terms are held to at every one of them. It reaches no shared layout core — a sequence diagram is placed
    // by columns and rows, not by the graph engine — so nothing upstream of
    // here ever refused a size on its behalf: an unusable measurement used to
    // travel the whole way into the markup and come back as a finished `<svg>`
    // whose width, height and viewBox were all `NaN`, with nothing said. That
    // is the failure `01M2WQV0` named, and the reason a bare call site is not
    // a smaller version of a wrapped one.
    const model = graphResult.model;
    const sequenceLayout = attemptLayout(() => layoutSequence(model, { measureText }));
    if (!sequenceLayout.placed) {
      diagnostics.push(sequenceLayout.diagnostic);
      return { svg: null, controller: null, diagnostics };
    }

    const positionedSequence = sequenceLayout.value;
    const sequenceSvg = renderSequenceToSVG(positionedSequence);

    container.replaceChildren(sequenceSvg);

    // A sequence diagram animates on the same terms as the other two kinds:
    // its participants, lifelines, destroy marks, messages, control-flow
    // blocks and box groupings all carry `data-siren-id`, and the controller drives every
    // element wearing a named id (ADR-0009) — so a participant's two boxes
    // and its lifeline move together under one timeline entry.
    const sequenceController = controllerAtStepZero(
      sequenceSvg,
      positionedSequence.timeline,
      options,
    );

    return { svg: sequenceSvg, controller: sequenceController, diagnostics };
  }

  // Bound to a local here, and in the three branches above, to give the model
  // the name its own layout stage knows it by. The binding used to be
  // load-bearing and no longer is: a *property* narrowing (`graphResult.graph
  // !== null`) is discarded inside the function expression below, which is
  // what forced a local rather than a `!`, but narrowing a `const` on its own
  // discriminant survives into one — so `graphResult.model` would read
  // correctly there too. One more hand-written step the tag took over.
  const graph = graphResult.model;
  const flowchartLayout = attemptLayout(() => layoutGraph(graph, { measureText }));
  if (!flowchartLayout.placed) {
    diagnostics.push(flowchartLayout.diagnostic);
    return { svg: null, controller: null, diagnostics };
  }

  const positioned = flowchartLayout.value;
  const svg = renderToSVG(positioned);

  container.replaceChildren(svg);

  // A flowchart's `call` interactions are hooked on the same terms as a
  // class diagram's: `wrapInteraction` stamped `data-siren-click` (and, when
  // there is one, `data-siren-click-arg`) onto whichever nodes the author
  // made callbacks, and this reads it back exactly as `attachClickHooks`
  // already does for the other kind.
  if (options.onClick !== undefined) {
    attachClickHooks(svg, options.onClick);
  }

  const controller = controllerAtStepZero(svg, positioned.timeline, options);

  return { svg, controller, diagnostics };
}
