import { parseSiren } from "./parser/parseSiren";
import { buildGraphModel } from "./graph-model/buildGraphModel";
import { layoutGraph } from "./layout/layoutGraph";
import { layoutSequence } from "./layout/layoutSequence";
import { layoutClassDiagram } from "./layout/layoutClassDiagram";
import { layoutStateDiagram } from "./layout/layoutStateDiagram";
import { layoutErDiagram } from "./layout/layoutErDiagram";
import {
  LayoutEngineError,
  UnroutableMemberEdgeError,
  unroutableMemberEdgeMessage,
} from "./layout/layoutDirectedGraph";
import { renderToSVG } from "./renderer/renderToSVG";
import { renderSequenceToSVG } from "./renderer/renderSequenceToSVG";
import { renderClassDiagramToSVG } from "./renderer/renderClassDiagramToSVG";
import { renderStateDiagramToSVG } from "./renderer/renderStateDiagramToSVG";
import { renderErDiagramToSVG } from "./renderer/renderErDiagramToSVG";
import { createAnimationController } from "./animation/createAnimationController";
import { type IconifyJSON, resolveIcon } from "./icon/iconPacks";
import { mintIdScope } from "./renderer/mintIdScope";
import { DEFAULT_TYPOGRAPHY } from "./label/label";
import type { DiagramKind } from "./parser/parseDirection";
import type {
  AnimationController,
  AuthorStyle,
  ClassModel,
  Diagnostic,
  ErModel,
  GraphModel,
  GraphModelResult,
  LayoutOptions,
  PositionedClassDiagram,
  PositionedErDiagram,
  PositionedGraph,
  PositionedSequenceDiagram,
  PositionedStateDiagram,
  ResolvedState,
  ResolvedTimeline,
  SequenceModel,
  SirenRenderResult,
  StateModel,
  TextMeasurer,
  Typography,
} from "./contracts";

export type {
  AnimationController,
  Diagnostic,
  SirenRenderResult,
  StyleFact,
  StyleSource,
  TextMeasurer,
  Typography,
} from "./contracts";
export { DEFAULT_TYPOGRAPHY } from "./label/label";
export type { IconifyIcon, IconifyJSON } from "./icon/iconPacks";

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
   * Which of the document's timeline blocks to apply. Defaults to `true`.
   *
   * **A document may declare several timelines, and by default only the first
   * applies.** `true` (or leaving this out) applies the unnamed `timeline:`
   * block, or else the first `timeline <name>:` block; a viewer that never
   * passes a name therefore still shows the first block, just never the
   * others. A string applies the named block of that name — the names are
   * `SirenRenderResult.timelines`, which is how a viewer offers the rest. A
   * name the document does not declare throws a `RangeError`: it is the
   * caller's mistake, not the author's, so it is not a diagnostic, and the
   * container is left untouched. A document that fails to render reports its
   * diagnostics instead, whatever name was asked for.
   *
   * `false` draws the **full diagram** — the picture Mermaid draws for the
   * same document: every element visible, no enter / exit / highlight state,
   * and a controller with `totalSteps: 0`. It is not the timeline's last
   * step, which still hides whatever exited and still wears its highlights.
   *
   * Every block is still parsed and validated, whichever is applied or none,
   * so `diagnostics` are exactly the default render's, timeline errors
   * included, and the render succeeds or fails exactly when the default one
   * does. Choosing a timeline therefore never makes a problem in the document
   * appear or vanish.
   */
  timeline?: boolean | string;

  /**
   * The icon packs a flowchart's icon nodes (`A@{ icon: "fa:user" }`) are
   * drawn from: Iconify JSON — a `prefix`, its `icons` — handed over as
   * data. Nothing is loaded or fetched: an icon whose pack is not here is
   * an error diagnostic naming it. Packs are searched in order, so two
   * sharing a prefix add to each other.
   *
   * An icon's SVG is drawn through an allowlist — shapes, groups, gradients,
   * clips and masks, with their geometry and paint — so a pack's script,
   * event handlers, links and anything that fetches are never drawn.
   */
  iconPacks?: readonly IconifyJSON[];

  /**
   * Author style properties not to draw, named as the author spells them:
   * `fill`, `stroke`, `stroke-width`, and `color` for label text (which is
   * painted with `fill`, so `color` is what leaves a label's colour out and
   * `fill` leaves only the frame's). Matched case-insensitively, as CSS
   * matches property names.
   *
   * **It can only take an author's declaration away, never add one**, so it
   * is not a JS theme object of the kind ADR-0004 and ADR-0008 rule out: an
   * omitted property is simply not written, and the element falls back to
   * whatever the theme's design tokens give it — which is how a host that
   * owns the colours (by redeclaring tokens on a target's `data-siren-id`
   * element) keeps the author's from covering its own. Properties left off
   * the list are drawn as written. An edge whose `stroke` is omitted takes
   * the theme's arrowhead again rather than one minted in that colour.
   *
   * It changes the drawing and nothing else: the document is parsed and
   * validated exactly as without it, so `diagnostics` and
   * `SirenRenderResult.styles` — which state what the author wrote — are
   * identical either way. A name no declaration uses omits nothing and is
   * not an error, and an empty list is the same as leaving this out.
   */
  omitAuthorStyles?: readonly string[];

  /**
   * The px sizes the diagram's text is drawn at — the theme's
   * `--siren-font-size`, `--siren-label-font-size` and
   * `--siren-title-font-size` — so the boxes, connector label backgrounds
   * and title bands are sized for the text the theme actually draws. A field
   * left out takes `DEFAULT_TYPOGRAPHY`'s, so leaving it all out, passing
   * `{}`, and passing `DEFAULT_TYPOGRAPHY` draw the same picture.
   *
   * **`measureText` has to measure at `fontSize`.** The measurer is asked
   * about a string and nothing else; layout takes its answer as text at
   * `fontSize` and scales it for a connector label (`labelFontSize` over
   * `fontSize`). The default measurer is an estimate and reads none of this.
   *
   * Read here rather than from the computed style because core cannot:
   * jsdom computes no custom property (nook decision `01M5KT454`). A value
   * that is not a finite positive number is the caller's mistake, not the
   * author's, so it throws a `RangeError` naming the field before the
   * container is touched, as an undeclared `timeline` name does.
   */
  typography?: Partial<Typography>;
}

/**
 * `options.typography` with every field it leaves out filled in from
 * `DEFAULT_TYPOGRAPHY`, or a `RangeError` naming the first field that is
 * not a finite positive number. Run before anything else in `render()`, so
 * a refused typography leaves the container as it was.
 */
function resolveTypography(typography: Partial<Typography> = {}): Typography {
  const resolved: Typography = {
    fontSize: typography.fontSize ?? DEFAULT_TYPOGRAPHY.fontSize,
    labelFontSize: typography.labelFontSize ?? DEFAULT_TYPOGRAPHY.labelFontSize,
    titleFontSize: typography.titleFontSize ?? DEFAULT_TYPOGRAPHY.titleFontSize,
  };
  for (const field of ["fontSize", "labelFontSize", "titleFontSize"] as const) {
    const value = resolved[field];
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`typography.${field} must be a finite positive number of px; got ${String(value)}`);
    }
  }
  return resolved;
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
 * A thrown error rather than a diagnostic for the reason `LayoutEngineError`
 * is: a size that is not a number is not a local problem. It propagates
 * through every box, bound and route computed from it and takes the whole
 * picture with it, so the layout module it is raised inside has no partial
 * answer left to hand back. `render()` converts it to the error-severity
 * diagnostic an author sees at its one layout call site, in `render()`
 * through `attemptLayout`, which is what keeps `Diagnostic`'s contract —
 * returned from `render()`, never thrown — true of a measurer that misbehaves
 * as well as of an engine that does.
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
 * to drift. It is the input-side twin of `LayoutEngineError`, which the
 * layout core raises when the engine refuses the graph: one guards what we
 * are told, the other what we are given back.
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
 * Attaches `onClick` to every element a renderer marked with a click hook,
 * reading the target's identity back off the attributes it put there.
 *
 * `render()` calls this for every kind whenever `onClick` is given, though
 * only two kinds ever stamp `data-siren-click`: the class renderer
 * (`renderClassDiagramToSVG`) and the flowchart's (`wrapInteraction`), each
 * onto whichever classes or nodes the author made callbacks, with
 * `data-siren-click-arg` when there is an argument. For any other kind the
 * query finds nothing and this is a no-op — the markup is byte-for-byte the
 * same with and without `onClick`. A sequence diagram's only interaction
 * directive is `link`, which resolves to an `href` (never a `call`), so its
 * participants come back already wrapped in a live `<a>` from
 * `renderSequenceToSVG` itself — the same reason a class's own `href`
 * interactions are never hooked here either.
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

/** The timeline a document with no `timeline:` block resolves to. */
const NO_TIMELINE: ResolvedTimeline = { totalSteps: 0, entries: [] };

/**
 * The timeline `render()` hands the controller: the current timeline — the
 * one the caller named, or by default the model's own (the unnamed block, else
 * the first named one) — or none at all when the caller asked for the full
 * diagram.
 *
 * Chosen from the *model*, once: layout and the renderers never see a
 * timeline, since no renderer needs one (step 0 is the controller's, see
 * `mountAtStepZero`).
 * Substituting at the controller rather than dropping blocks before parsing is
 * what keeps every block read and validated whichever one applies.
 */
function timelineToApply(model: TimelineChoices, options: RenderOptions): ResolvedTimeline {
  if (options.timeline === false) return NO_TIMELINE;
  if (typeof options.timeline === "string") {
    const name = options.timeline;
    const named = model.namedTimelines ?? [];
    const chosen = named.find((block) => block.name === name);
    if (chosen === undefined) {
      const declared =
        named.length > 0
          ? `this document declares: ${named.map((block) => block.name).join(", ")}`
          : "this document declares no named timelines";
      throw new RangeError(`No timeline named ${JSON.stringify(name)}; ${declared}`);
    }
    return chosen.timeline;
  }
  return model.timeline;
}

/** The part of every kind's model that `render()` chooses a timeline from. */
type TimelineChoices = Pick<GraphModel, "timeline" | "namedTimelines">;

/**
 * Mounts a freshly rendered diagram of any kind into `container` and returns
 * its controller, already showing step 0 of the timeline the caller chose.
 *
 * One function, called once by `render()` for every kind, for two orderings
 * that must hold whichever kind rendered:
 *
 * - **The timeline is chosen before the container is touched.** A name the
 *   document does not declare throws, and it must throw with the caller's
 *   container exactly as it was. Choosing only *after* layout succeeded is
 *   what lets a document that fails to render report its diagnostics instead
 *   of throwing, whatever name was asked for: the author's problem is
 *   reported first, since the caller cannot see it any other way.
 * - **Mounting and step 0 happen in the same synchronous task.** The
 *   `controller.reset()` comes straight after `container.replaceChildren(...)`
 *   so nothing is painted between mounting the SVG and hiding the elements
 *   step 0 says are pending: the reader never sees a frame of a to-be-hidden
 *   element.
 *
 * Step 0 — the initial `siren-pending` state — is the controller's, not any
 * renderer's. `reset()` is by definition "the initial pending state",
 * computed from `computeClassStateAtStep(timeline, 0)`, and it is a no-op for
 * a diagram with no timeline. That is why no renderer stamps `siren-pending`
 * itself: two of them used to, each with a private copy of the "elements with
 * an `enter` action start hidden" rule, and a third copy for sequence would
 * have been three answers to a question `computeClassStateAtStep` already
 * answers. One call site, one rule, no drift.
 *
 * Every kind gets a controller, even a document declaring no `timeline:`
 * block (it gets `totalSteps: 0`), because `SirenRenderResult.controller` is
 * null *only* when rendering failed: a caller that has checked `svg` has
 * already checked this. `render()` attaches any click hooks before calling
 * this, so a diagram is complete when it is mounted.
 */
function mountAtStepZero(
  container: HTMLElement,
  svg: SVGSVGElement,
  model: TimelineChoices,
  options: RenderOptions,
): AnimationController {
  const timeline = timelineToApply(model, options);
  container.replaceChildren(svg);
  const controller = createAnimationController(svg, timeline);
  controller.reset();
  return controller;
}

/** What one layout call produced: a positioned diagram, or the reason there is none. */
type LayoutAttempt<T> =
  | { placed: true; value: T }
  | { placed: false; diagnostic: Diagnostic };

/**
 * Runs one layout stage, turning the failures it is allowed to have into
 * the error-severity diagnostic an author sees: `LayoutEngineError`, ELK
 * rejecting the graph it was handed (see `layout/elkSync.ts`), and
 * `UnmeasurableTextError`, the caller's measurer not sizing a string (see
 * each type). They are the two ends of the same stage — what layout was told,
 * and what layout was told back — and neither leaves a partial picture
 * behind, so both convert here.
 *
 * **Everything else is rethrown, deliberately.** A bare `catch` here would
 * report this package's own bugs as if they were defects in the author's
 * document, which is the same disguise CONTEXT.md's opening policy exists to
 * remove, only pointed the other way: a `TypeError` in a renderer is not
 * something an author can route around. Matching by type keeps the
 * conversion to the cases that have a meaning for them, and adding a
 * type to match is not the same as ceasing to match.
 *
 * It wraps a thunk, called from one call site with each kind's row of
 * `RENDER_KIND`, so the `catch` that must not be bare is written once for all
 * five kinds — flowchart, class, state and ER reach the same shared layout
 * core, and sequence has its own — rather than once per kind, where every
 * copy is another chance for one of them to become bare.
 */
function attemptLayout<T>(
  run: () => T,
  nameOf: (layoutId: string) => string = (layoutId) => layoutId,
): LayoutAttempt<T> {
  try {
    return { placed: true, value: run() };
  } catch (error) {
    // The one refusal the layout core says plainly carries its parts by the
    // layout's ids; `nameOf` turns each into the word the author knows it by.
    if (error instanceof UnroutableMemberEdgeError) {
      const message = unroutableMemberEdgeMessage({
        edge: error.edgeId,
        cluster: nameOf(error.clusterId),
        member: nameOf(error.memberId),
        directedCluster: nameOf(error.directedClusterId),
        direction: error.direction,
      });
      return { placed: false, diagnostic: { severity: "error", message } };
    }
    if (
      error instanceof LayoutEngineError ||
      error instanceof UnmeasurableTextError
    ) {
      return { placed: false, diagnostic: { severity: "error", message: error.message } };
    }
    throw error;
  }
}

/**
 * `graph` with each icon node's icon looked up in the packs the caller
 * registered, or the reason one cannot be drawn — an error at the node's
 * `@{ … }` block for each icon no registered pack holds. A pack is the
 * caller's data, not the document's, so this is the first point an icon
 * can be found: nothing before `render()` knows the packs.
 *
 * Each icon's ids are renamed with a scope of its own, minted per drawing
 * as the renderer mints its markers' (`mintIdScope`), so neither two icons
 * nor two diagrams on one page answer each other's references.
 */
function withIcons(
  graph: GraphModel,
  packs: readonly IconifyJSON[],
): { graph: GraphModel; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const nodes = graph.nodes.map((node, index) => {
    const icon = node.icon;
    if (icon === undefined || icon.name === null) {
      return node;
    }
    const resolved = resolveIcon(icon.name, packs, `siren-icon${mintIdScope()}-${index}-`);
    if ("problem" in resolved) {
      diagnostics.push({
        severity: "error",
        message: resolved.problem,
        ...(icon.line === undefined ? {} : { line: icon.line }),
        ...(icon.column === undefined ? {} : { column: icon.column }),
      });
      return node;
    }
    return { ...node, icon: { ...icon, glyph: resolved.glyph } };
  });
  return { graph: { ...graph, nodes }, diagnostics };
}

/**
 * What `render()` returns when there is no diagram to mount: no SVG, no
 * controller (the two are null together), and no timelines or style facts
 * to offer — but the frontmatter's `siren`, which the diagram's failure does
 * not touch. One place, so a field the result gains is added to every
 * failure at once.
 */
function failedRender(diagnostics: Diagnostic[], siren: unknown): SirenRenderResult {
  return { svg: null, controller: null, diagnostics, timelines: [], styles: [], siren };
}

/**
 * What `render()` does to one kind after `buildGraphModel`, as one row of
 * `RENDER_KIND`.
 *
 * `render` is written as a method, not a function-typed property, and that is
 * load-bearing: TypeScript checks a method's parameter bivariantly, so a row
 * whose `render` takes a `P` is assignable to one whose `render` takes
 * `unknown`. That is what lets `pipeline` erase `P` without a cast. `M` stays
 * on function-typed properties, checked strictly, so it cannot be erased the
 * same way by accident. The price is that a row's own `layout`-to-`render`
 * pair is checked bivariantly too: a `render` taking a subtype of what
 * `layout` returns would pass. The five kinds' positioned types are unrelated
 * to one another, so a `render` from another kind's row is still an error.
 */
interface Pipeline<M, P> {
  /** Flowchart only today: resolves icons from the caller's packs; a diagnostic here stops the render. */
  prepare?: (model: M, options: RenderOptions) => { model: M; diagnostics: Diagnostic[] };
  layout: (model: M, options: LayoutOptions) => P;
  render(positioned: P): SVGSVGElement;
  /**
   * The author's word for a layout id in the unroutable-connector diagnostic
   * (`UnroutableMemberEdgeError`); identity when absent.
   */
  nameOf?: (model: M) => (layoutId: string) => string;
}

/**
 * A `nameOf` that puts each subgraph's title for its generated id and leaves
 * every other id as it is; a flowchart's and an ER diagram's subgraphs share
 * this shape.
 */
function bySubgraphTitle(
  subgraphs: readonly { id: string; label: { text: string } }[],
): (layoutId: string) => string {
  const titleById = new Map(subgraphs.map((subgraph) => [subgraph.id, subgraph.label.text]));
  return (layoutId) => titleById.get(layoutId) ?? layoutId;
}

/**
 * A `nameOf` that puts each concurrent region's place in its composite for its
 * generated id. A region is a frame the author never named: it is laid out by
 * a generated id (`region:1`, ADR-0010) counted across the whole document, and
 * the author wrote only the `--` that divides its composite. So it is named by
 * its place there, `region 2 of A`, counted within that composite from 1 in
 * `states` order. A composite's and a plain state's ids are the author's own
 * and pass through. A region always has a composite; the `parentId === null`
 * check is for `ResolvedState`'s type only, which allows a top level.
 */
function byRegionPlace(states: readonly ResolvedState[]): (layoutId: string) => string {
  const regionNames = new Map<string, string>();
  const regionCounts = new Map<string, number>();
  for (const state of states) {
    if (state.kind !== "region" || state.parentId === null) continue;
    const regionNumber = (regionCounts.get(state.parentId) ?? 0) + 1;
    regionCounts.set(state.parentId, regionNumber);
    regionNames.set(state.id, `region ${regionNumber} of ${state.parentId}`);
  }
  return (layoutId) => regionNames.get(layoutId) ?? layoutId;
}

/** The model `buildGraphModel` hands back for a document of kind `K`. */
type ModelOf<K extends DiagramKind> = Extract<GraphModelResult, { kind: K }>["model"];

/**
 * Builds one row of `RENDER_KIND` with its stages checked against each other
 * — `prepare` hands `layout` an `M`, `layout` hands `render` a `P` — and then
 * forgets `P`, so five rows with five positioned shapes fit one record. `M` is
 * kept: `RENDER_KIND`'s type holds it to the row's key.
 *
 * Forgetting `P` needs no cast (see `Pipeline.render`) and loses nothing: only
 * this row's `layout` makes a `P`, and `render()` hands it to nothing but this
 * row's `render`.
 */
function pipeline<M, P>(row: Pipeline<M, P>): Pipeline<M, unknown> {
  return row;
}

/**
 * How `render()` lays out and draws each kind, one row per kind as
 * `PARSE_KIND` (`parser/parseSiren.ts`) says who parses it. Everything the
 * kinds share — `attemptLayout`, `attachClickHooks`, `mountAtStepZero` —
 * lives in `render()`, written once; a row holds only what differs. A kind
 * without a row is a type error.
 *
 * The table's type pins each row's `M` to its key's model, so a row written
 * for one kind's model under another kind's key is a type error. It does not
 * pin `P`, which `pipeline` checks within the row and then forgets.
 *
 * Every kind animates on the same terms: each renderer stamps `data-siren-id`
 * on what an author can name, and the one controller drives every element
 * wearing a named id (ADR-0009).
 */
const RENDER_KIND: { [K in DiagramKind]: Pipeline<ModelOf<K>, unknown> } = {
  flowchart: pipeline<GraphModel, PositionedGraph>({
    // Icon packs are the caller's data, so this is the first point an icon can
    // be found; an icon no pack holds stops the render (see `withIcons`).
    prepare: (graph, options) => {
      const iconed = withIcons(graph, options.iconPacks ?? []);
      return { model: iconed.graph, diagnostics: iconed.diagnostics };
    },
    layout: layoutGraph,
    render: renderToSVG,
    // A subgraph is laid out by its generated id (`subgraph:2`); the author
    // knows it by its title. A node's and an edge's ids are the author's own.
    nameOf: (graph) => bySubgraphTitle(graph.subgraphs),
  }),
  // The one layout stage that is unlike the rest, and the reason
  // `attemptLayout`'s terms are held to for every kind. It reaches no shared
  // layout core — a sequence diagram is placed by columns and rows, not by the
  // graph engine — so nothing upstream of it ever refused a size on its
  // behalf: an unusable measurement used to travel the whole way into the
  // markup and come back as a finished `<svg>` whose width, height and viewBox
  // were all `NaN`, with nothing said. That is the failure `01M2WQV0` named,
  // and the reason a bare call is not a smaller version of a wrapped one.
  // Participants, lifelines, messages, control-flow blocks and box groupings
  // carry `data-siren-id`. A participant's two boxes (its top and bottom ones,
  // or its top one and its closing box) and its lifeline share its id, so they
  // move together under one timeline entry.
  sequence: pipeline<SequenceModel, PositionedSequenceDiagram>({
    layout: layoutSequence,
    render: renderSequenceToSVG,
  }),
  // **No class document reaches the layout failure path today** — the
  // construct that defeats the engine is a cluster carrying its own direction,
  // and a class diagram's only cluster is a namespace, which Mermaid never
  // gives a direction to. It goes through `attemptLayout` anyway because the
  // guard there is a check on the *shape of the engine's answer*, not on that
  // one construct: leaving it bare would mean a future source of a missing
  // coordinate escapes `render()` as a thrown error for this kind while the
  // others report it, and `Diagnostic`'s contract is that it is returned and
  // never thrown. Classes and relationships carry `data-siren-id`.
  class: pipeline<ClassModel, PositionedClassDiagram>({
    layout: layoutClassDiagram,
    render: renderClassDiagramToSVG,
  }),
  // States, composite frames and transitions all carry `data-siren-id`.
  state: pipeline<StateModel, PositionedStateDiagram>({
    layout: layoutStateDiagram,
    render: renderStateDiagramToSVG,
    // A concurrent region is laid out by a generated id (`region:1`); the
    // author knows it by its place in its composite (`region 2 of A`).
    nameOf: (model) => byRegionPlace(model.states),
  }),
  // Reaches the shared core, so `LayoutEngineError` is possible in principle,
  // and a consumer's measurer can refuse an entity's name here exactly as it
  // can refuse a label anywhere else. Entities and relationships carry
  // `data-siren-id`.
  er: pipeline<ErModel, PositionedErDiagram>({
    layout: layoutErDiagram,
    render: renderErDiagramToSVG,
    // A relationship may name an ER subgraph (`clusterEndpointIds`), so an ER
    // subgraph can be either cluster in the diagnostic; it is laid out by its
    // generated id (`subgraph:1`), and the author knows it by its title. An
    // entity's and a relationship's ids are the author's own.
    nameOf: (model) => bySubgraphTitle(model.subgraphs),
  }),
};

/**
 * Runs parse -> buildGraphModel end to end, then the parsed document's kind's
 * row of `RENDER_KIND` along one path for every kind: `prepare` when the row
 * has one (a flowchart's icons), layout through `attemptLayout`, the kind's
 * renderer, `attachClickHooks`, and `mountAtStepZero`. Every kind returns a
 * working controller — one with `totalSteps: 0` when the document declares no
 * `timeline:` block. Mounts the resulting SVG into `container` on success, and
 * always returns the aggregated diagnostics from every stage.
 *
 * `options.onClick`, if one was given, is attached to whichever classes or
 * nodes the author made clickable with a `call` interaction — today only
 * class diagrams and flowcharts have any (see `attachClickHooks`).
 *
 * `options.timeline` chooses what every kind's controller is handed — the
 * current timeline: the first block when nothing names one, the named block a
 * string names, or an empty timeline for `false`, so the picture is the full
 * diagram and there are no steps. Everything before that point runs unchanged — every block is parsed
 * and validated as usual — which is why the diagnostics, and whether the
 * render succeeds at all, never depend on the option. The one way the option
 * changes the outcome is a name the document does not declare, which throws a
 * `RangeError` once the diagram is otherwise ready to mount (see
 * `mountAtStepZero`).
 */
export function render(
  source: string,
  container: HTMLElement,
  options: RenderOptions = {},
): SirenRenderResult {
  const typography = resolveTypography(options.typography);
  const measureText = refusingBadMeasurements(options.measureText ?? defaultMeasurer);
  const diagnostics: Diagnostic[] = [];

  const parseResult = parseSiren(source);
  diagnostics.push(...parseResult.diagnostics);
  // Handed back on every outcome, a failed render's included: it is the
  // frontmatter's, and a refusal of the diagram below does not touch it.
  const { siren } = parseResult;

  if (parseResult.document === null) {
    return failedRender(diagnostics, siren);
  }

  const graphResult = buildGraphModel(parseResult.document, { omitAuthorStyles: options.omitAuthorStyles });
  diagnostics.push(...graphResult.diagnostics);

  const timelines = (graphResult.model.namedTimelines ?? []).map((block) => block.name);
  // Every kind's model has the field — a sequence model's is never written —
  // and each builder took its facts before striking what the caller omits,
  // so they state what the author wrote either way (see
  // `RenderOptions.omitAuthorStyles`).
  const styles = graphResult.model.styleFacts ?? [];

  // The file's one cast. The lookup yields a union of rows whose `layout`s take
  // different models, so the cast erases the pairing `RENDER_KIND`'s type
  // holds, for this single path. It is safe because `graphResult.kind` chose
  // the row and `graphResult.model` is that same arm's model: `buildGraphModel`
  // carries the document's kind out unchanged, so the row is only ever handed
  // its own `M` — what a `switch` on `kind` would narrow to, once per branch.
  const row = RENDER_KIND[graphResult.kind] as Pipeline<unknown, unknown>;
  let model: unknown = graphResult.model;

  if (row.prepare !== undefined) {
    const prepared = row.prepare(model, options);
    diagnostics.push(...prepared.diagnostics);
    if (prepared.diagnostics.length > 0) {
      return failedRender(diagnostics, siren);
    }
    model = prepared.model;
  }

  const laidOut = attemptLayout(() => row.layout(model, { measureText, typography }), row.nameOf?.(model));
  if (!laidOut.placed) {
    diagnostics.push(laidOut.diagnostic);
    return failedRender(diagnostics, siren);
  }

  const svg = row.render(laidOut.value);

  if (options.onClick !== undefined) {
    attachClickHooks(svg, options.onClick);
  }

  const controller = mountAtStepZero(container, svg, graphResult.model, options);

  return { svg, controller, diagnostics, timelines, styles, siren };
}
