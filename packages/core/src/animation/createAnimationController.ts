import type {
  AnimationController,
  ResolvedTimeline,
  ResolvedTimelineEntry,
} from "../contracts";

const EFFECT_CLASS_PREFIXES = ["siren-enter-", "siren-exit-", "siren-highlight-"];

function isEffectClass(className: string): boolean {
  if (className === "siren-pending") return true;
  return EFFECT_CLASS_PREFIXES.some((prefix) => className.startsWith(prefix));
}

/**
 * Computes the canonical effect-related class set every timeline target
 * should carry after exactly `targetStep` `next()` calls from a fresh
 * controller — the element's cumulative history, not a diff against
 * whatever's currently in the DOM.
 */
function computeClassStateAtStep(
  timeline: ResolvedTimeline,
  targetStep: number,
): Map<string, Set<string>> {
  const state = new Map<string, Set<string>>();

  const classesFor = (targetId: string): Set<string> => {
    let classes = state.get(targetId);
    if (!classes) {
      classes = new Set<string>();
      state.set(targetId, classes);
    }
    return classes;
  };

  // Ensure every target mentioned anywhere in the timeline gets an entry in
  // the map, even if it stays empty at this step — otherwise applyClassState
  // has no way to know a target's effect classes should be cleared (it only
  // touches targets present in this map). An element with only exit/
  // highlight/unhighlight actions (no enter) would otherwise be silently
  // skipped whenever targetStep falls before its first action, leaving a
  // stale effect class from a later step behind after prev()/reset().
  for (const entry of timeline.entries) {
    const classes = classesFor(entry.targetId);
    // Every element with an `enter` action starts pending, before any entry
    // (including its own) has fired.
    if (entry.kind === "enter") classes.add("siren-pending");
  }

  const inOrder: ResolvedTimelineEntry[] = [...timeline.entries].sort(
    (a, b) => a.step - b.step,
  );

  for (const entry of inOrder) {
    if (entry.step > targetStep) continue;
    const classes = classesFor(entry.targetId);

    switch (entry.kind) {
      case "enter":
        classes.delete("siren-pending");
        classes.add(`siren-enter-${entry.effect}`);
        break;
      case "exit":
        classes.add(`siren-exit-${entry.effect}`);
        break;
      case "highlight":
        for (const c of [...classes]) {
          if (c.startsWith("siren-highlight-")) classes.delete(c);
        }
        classes.add(`siren-highlight-${entry.effect}`);
        break;
      case "unhighlight":
        for (const c of [...classes]) {
          if (c.startsWith("siren-highlight-")) classes.delete(c);
        }
        break;
    }
  }

  return state;
}

/**
 * The author declarations a highlight lifted off each drawn element — value
 * and priority per property — keyed by the element so that whichever
 * controller is driving the SVG can put them back.
 */
const liftedAuthorStrokes = new WeakMap<Element, [property: string, value: string, priority: string][]>();

/**
 * The author properties a highlight lifts: the ones the theme's highlight
 * rules paint. `stroke-width` goes with `stroke`, or a hairline the author
 * drew would stay a hairline in the highlight color.
 */
const LIFTED_PROPERTIES = ["stroke", "stroke-width"] as const;

/**
 * Makes a highlight beat the author's stroke on the elements one target
 * draws: lifted while `el` carries a `siren-highlight-*` class, put back
 * once it does not.
 *
 * An author's `stroke` is an inline declaration on the drawn frame
 * (ADR-0008), which outranks every normal stylesheet rule, and an author may
 * write it `!important`, which outranks an `!important` one too — so no rule
 * in the theme can win, and the theme declares none (`default.css` keeps its
 * rules un-`!important` so an author's own emphasis stays reachable
 * everywhere else). Lifting the declaration instead leaves the theme's
 * highlight rule as the only paint. A highlight is Siren's own state, which
 * Mermaid does not have, so letting it win costs no compatibility: with no
 * timeline the picture is Mermaid's. Only `LIFTED_PROPERTIES` are lifted,
 * and only they are put back, each with its own priority: the rest of the
 * attribute — the author's other declarations, and anything a host wrote
 * on the element while it was highlighted, such as a design token it
 * recolors that target with — is never rewritten.
 *
 * Synchronous and part of the same class change, so it adds no timing of its
 * own: a `prev()` that removes the class puts the stroke back in the same
 * frame, and with no effect class left there is nothing to transition.
 */
function liftAuthorStroke(el: Element, highlighted: boolean): void {
  const drawn = [el, ...Array.from(el.querySelectorAll("[style]"))];
  for (const element of drawn) {
    const style = (element as SVGElement).style;
    const lifted = liftedAuthorStrokes.get(element);
    if (!highlighted) {
      if (lifted !== undefined) {
        for (const [property, value, priority] of lifted) style.setProperty(property, value, priority);
        liftedAuthorStrokes.delete(element);
      }
      continue;
    }
    if (lifted !== undefined) continue;
    const declared = LIFTED_PROPERTIES.filter((property) => style.getPropertyValue(property) !== "").map(
      (property) => [property, style.getPropertyValue(property), style.getPropertyPriority(property)] as [string, string, string],
    );
    if (declared.length === 0) continue;
    liftedAuthorStrokes.set(element, declared);
    for (const [property] of declared) style.removeProperty(property);
  }
}

/**
 * Applies a computed class state directly to the DOM: adds classes the
 * target step requires but the element doesn't yet have, and removes
 * effect-related classes the element has but the target step doesn't
 * require. Never touches non-effect classes (e.g. `siren-node`). The one
 * thing it touches besides classes is a highlighted target's author stroke,
 * which `liftAuthorStroke` lifts and puts back in the same pass.
 *
 * Because only the classes that actually differ are touched, an unchanged
 * class is never removed-then-readded — so a class the shipped stylesheet
 * doesn't give a `transition` (per this ticket's guidance) never
 * retriggers one it already carried.
 */
function applyClassState(svg: SVGSVGElement, state: Map<string, Set<string>>): void {
  for (const [targetId, targetClasses] of state) {
    // Every element carrying the id, not the first one: a timeline target is
    // the authored thing, and how many elements draw it is a layout detail.
    // A sequence participant is drawn twice (top row and bottom) alongside
    // its lifeline, all three under one id -- see ADR-0009.
    const elements = svg.querySelectorAll(`[data-siren-id="${targetId}"]`);

    // `Array.from` rather than iterating the NodeList: this package's `lib` is
    // ["ES2022", "DOM"] without "DOM.Iterable", so a NodeList is not iterable
    // here.
    for (const el of Array.from(elements)) {
      for (const c of Array.from(el.classList)) {
        if (isEffectClass(c) && !targetClasses.has(c)) el.classList.remove(c);
      }
      for (const c of targetClasses) {
        if (!el.classList.contains(c)) el.classList.add(c);
      }
      liftAuthorStroke(
        el,
        Array.from(el.classList).some((c) => c.startsWith("siren-highlight-")),
      );
    }
  }
}

/**
 * Builds a caller-driven step-reveal controller over a rendered SVG.
 *
 * Reads the elements already tagged `data-siren-id` in `svg` and drives
 * them through the frozen SVG conventions: `next()` applies whichever
 * action(s) (`enter`/`exit`/`highlight`/`unhighlight`) are assigned to the
 * newly-current step; `prev()` moves back one step and snaps instantly to
 * that step's canonical class state; `reset()` restores the initial
 * pending state.
 */
export function createAnimationController(
  svg: SVGSVGElement,
  timeline: ResolvedTimeline,
): AnimationController {
  const controller: AnimationController = {
    totalSteps: timeline.totalSteps,
    currentStep: 0,
    next() {
      const nextStep = controller.currentStep + 1;
      if (nextStep > controller.totalSteps) return;

      applyClassState(svg, computeClassStateAtStep(timeline, nextStep));
      controller.currentStep = nextStep;
    },
    prev() {
      if (controller.currentStep === 0) return;

      const prevStep = controller.currentStep - 1;
      applyClassState(svg, computeClassStateAtStep(timeline, prevStep));
      controller.currentStep = prevStep;
    },
    reset() {
      applyClassState(svg, computeClassStateAtStep(timeline, 0));
      controller.currentStep = 0;
    },
  };

  return controller;
}
