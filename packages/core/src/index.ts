import { parseSiren } from "./parser/parseSiren";
import { buildGraphModel } from "./graph-model/buildGraphModel";
import { layoutGraph } from "./layout/layoutGraph";
import { layoutSequence } from "./layout/layoutSequence";
import { renderToSVG } from "./renderer/renderToSVG";
import { renderSequenceToSVG } from "./renderer/renderSequenceToSVG";
import { createAnimationController } from "./animation/createAnimationController";
import type { Diagnostic, SirenRenderResult, TextMeasurer } from "./contracts";

export type { AnimationController, Diagnostic, SirenRenderResult, TextMeasurer } from "./contracts";

/** Options accepted by the public `render()` entry point. */
export interface RenderOptions {
  /**
   * Overrides the text-measurement strategy `layoutGraph` uses for label
   * sizing. Defaults to a jsdom-safe fixed-width-per-character estimate
   * (jsdom implements no real text metrics); a real canvas/DOM-based
   * measurer is wired in by the browser demo instead.
   */
  measureText?: TextMeasurer;
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
 * Runs parse -> buildGraphModel end to end, then dispatches on the parsed
 * document's `kind`: a flowchart runs layoutGraph -> renderToSVG ->
 * createAnimationController; a sequence diagram runs layoutSequence ->
 * renderSequenceToSVG and returns `controller: null` (no animation
 * integration for sequence diagrams yet). Mounts the resulting SVG into
 * `container` on success, and always returns the aggregated diagnostics
 * from every stage.
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

  if (parseResult.document.kind === "sequence") {
    if (graphResult.model === null) {
      return { svg: null, controller: null, diagnostics };
    }

    const positionedSequence = layoutSequence(graphResult.model, { measureText });
    const sequenceSvg = renderSequenceToSVG(positionedSequence);

    container.replaceChildren(sequenceSvg);

    return { svg: sequenceSvg, controller: null, diagnostics };
  }

  if (graphResult.graph === null) {
    return { svg: null, controller: null, diagnostics };
  }

  const positioned = layoutGraph(graphResult.graph, { measureText });
  const svg = renderToSVG(positioned);

  container.replaceChildren(svg);

  const controller = createAnimationController(svg, positioned.timeline);

  return { svg, controller, diagnostics };
}
