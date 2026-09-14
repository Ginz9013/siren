import { parseSiren } from "./parser/parseSiren";
import { buildGraphModel } from "./graph-model/buildGraphModel";
import { layoutGraph } from "./layout/layoutGraph";
import { layoutSequence } from "./layout/layoutSequence";
import { layoutClassDiagram } from "./layout/layoutClassDiagram";
import { renderToSVG } from "./renderer/renderToSVG";
import { renderSequenceToSVG } from "./renderer/renderSequenceToSVG";
import { renderClassDiagramToSVG } from "./renderer/renderClassDiagramToSVG";
import { createAnimationController } from "./animation/createAnimationController";
import type {
  AnimationController,
  Diagnostic,
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

/**
 * Runs parse -> buildGraphModel end to end, then dispatches on the parsed
 * document's `kind`: a flowchart runs layoutGraph -> renderToSVG ->
 * createAnimationController; a class diagram runs layoutClassDiagram ->
 * renderClassDiagramToSVG -> createAnimationController; a sequence diagram
 * runs layoutSequence -> renderSequenceToSVG -> createAnimationController.
 * All three return a working controller — one with `totalSteps: 0` when the
 * document declares no `timeline:` block. Mounts the resulting SVG into
 * `container` on success, and always returns the aggregated diagnostics
 * from every stage. A class diagram and a flowchart both have
 * `options.onClick`, if one was given, attached to whichever of their
 * classes or nodes the author made clickable with a `call` interaction; a
 * sequence diagram accepts no interaction directives at all, so it wires
 * nothing.
 */
export function render(
  source: string,
  container: HTMLElement,
  options: RenderOptions = {},
): SirenRenderResult {
  const measureText = options.measureText ?? defaultMeasurer;
  const diagnostics: Diagnostic[] = [];

  const parseResult = parseSiren(source);
  diagnostics.push(...parseResult.diagnostics);

  if (parseResult.document === null) {
    return { svg: null, controller: null, diagnostics };
  }

  const graphResult = buildGraphModel(parseResult.document);
  diagnostics.push(...graphResult.diagnostics);

  if (parseResult.document.kind === "class") {
    if (graphResult.classModel === null) {
      return { svg: null, controller: null, diagnostics };
    }

    const positionedClassDiagram = layoutClassDiagram(graphResult.classModel, { measureText });
    const classSvg = renderClassDiagramToSVG(positionedClassDiagram);

    container.replaceChildren(classSvg);

    if (options.onClick !== undefined) {
      attachClickHooks(classSvg, options.onClick);
    }

    // A class diagram animates: its classes and relationships carry
    // `data-siren-id`, so the same controller that drives flowchart nodes and
    // edges — and sequence participants — drives them unchanged.
    const classController = createAnimationController(
      classSvg,
      positionedClassDiagram.timeline,
    );
    establishStepZero(classController);

    return { svg: classSvg, controller: classController, diagnostics };
  }

  if (parseResult.document.kind === "sequence") {
    if (graphResult.model === null) {
      return { svg: null, controller: null, diagnostics };
    }

    const positionedSequence = layoutSequence(graphResult.model, { measureText });
    const sequenceSvg = renderSequenceToSVG(positionedSequence);

    container.replaceChildren(sequenceSvg);

    // A sequence diagram animates on the same terms as the other two kinds:
    // its participants, lifelines, destroy marks, messages, control-flow
    // blocks and box groupings all carry `data-siren-id`, and the controller drives every
    // element wearing a named id (ADR-0009) — so a participant's two boxes
    // and its lifeline move together under one timeline entry.
    const sequenceController = createAnimationController(
      sequenceSvg,
      positionedSequence.timeline,
    );
    establishStepZero(sequenceController);

    return { svg: sequenceSvg, controller: sequenceController, diagnostics };
  }

  if (graphResult.graph === null) {
    return { svg: null, controller: null, diagnostics };
  }

  const positioned = layoutGraph(graphResult.graph, { measureText });
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

  const controller = createAnimationController(svg, positioned.timeline);
  establishStepZero(controller);

  return { svg, controller, diagnostics };
}
