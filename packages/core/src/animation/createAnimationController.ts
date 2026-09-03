import type { AnimationController, ResolvedTimeline } from "../contracts";

/**
 * Builds a caller-driven step-reveal controller over a rendered SVG.
 *
 * Reads the elements already tagged `data-siren-id` in `svg` and drives
 * them through the frozen SVG conventions: `next()` removes `siren-pending`
 * and adds `siren-enter-fade` on the elements assigned to the newly
 * revealed step; `reset()` restores the initial pending state.
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

      for (const entry of timeline.entries) {
        if (entry.step !== nextStep) continue;
        const el = svg.querySelector(`[data-siren-id="${entry.targetId}"]`);
        if (!el) continue;
        el.classList.remove("siren-pending");
        el.classList.add("siren-enter-fade");
      }

      controller.currentStep = nextStep;
    },
    reset() {
      for (const entry of timeline.entries) {
        const el = svg.querySelector(`[data-siren-id="${entry.targetId}"]`);
        if (!el) continue;
        el.classList.add("siren-pending");
        el.classList.remove("siren-enter-fade");
      }

      controller.currentStep = 0;
    },
  };

  return controller;
}
