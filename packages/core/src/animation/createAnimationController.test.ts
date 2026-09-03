import { describe, expect, it } from "vitest";
import { createAnimationController } from "./createAnimationController";
import type { ResolvedTimeline } from "../contracts";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Builds a hand-made SVG fixture matching the frozen SVG conventions from
 * spec.md:
 * - node A: no `siren-pending` (visible from the start, step 0)
 * - node B: `siren-pending`, `data-siren-id="B"` (assigned to step 1)
 * - node C: `siren-pending`, `data-siren-id="C"` (assigned to step 2)
 */
function buildFixtureSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;

  const nodeA = document.createElementNS(SVG_NS, "g");
  nodeA.setAttribute("class", "siren-node");
  nodeA.setAttribute("data-siren-id", "A");
  svg.appendChild(nodeA);

  const nodeB = document.createElementNS(SVG_NS, "g");
  nodeB.setAttribute("class", "siren-node siren-pending");
  nodeB.setAttribute("data-siren-id", "B");
  svg.appendChild(nodeB);

  const nodeC = document.createElementNS(SVG_NS, "g");
  nodeC.setAttribute("class", "siren-node siren-pending");
  nodeC.setAttribute("data-siren-id", "C");
  svg.appendChild(nodeC);

  return svg;
}

function buildTimeline(): ResolvedTimeline {
  return {
    totalSteps: 2,
    entries: [
      { kind: "enter", step: 1, targetId: "B", effect: "fade" },
      { kind: "enter", step: 2, targetId: "C", effect: "fade" },
    ],
  };
}

function getNode(svg: SVGSVGElement, id: string): Element {
  const el = svg.querySelector(`[data-siren-id="${id}"]`);
  if (!el) throw new Error(`fixture missing node ${id}`);
  return el;
}

function classesOf(svg: SVGSVGElement, id: string): string[] {
  return Array.from(getNode(svg, id).classList).sort();
}

/**
 * Fixture exercising all four action kinds across three steps, matching
 * the ticket's acceptance example: enter B fade (step 1), highlight B
 * outline (step 1), exit A fade (step 2), highlight A-B glow (step 2),
 * unhighlight A-B (step 3).
 */
function buildAllKindsFixture(): { svg: SVGSVGElement; timeline: ResolvedTimeline } {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;

  const nodeA = document.createElementNS(SVG_NS, "g");
  nodeA.setAttribute("class", "siren-node");
  nodeA.setAttribute("data-siren-id", "A");
  svg.appendChild(nodeA);

  const nodeB = document.createElementNS(SVG_NS, "g");
  nodeB.setAttribute("class", "siren-node siren-pending");
  nodeB.setAttribute("data-siren-id", "B");
  svg.appendChild(nodeB);

  const edgeAB = document.createElementNS(SVG_NS, "g");
  edgeAB.setAttribute("class", "siren-edge");
  edgeAB.setAttribute("data-siren-id", "A-B");
  svg.appendChild(edgeAB);

  const timeline: ResolvedTimeline = {
    totalSteps: 3,
    entries: [
      { kind: "enter", step: 1, targetId: "B", effect: "fade" },
      { kind: "highlight", step: 1, targetId: "B", effect: "outline" },
      { kind: "exit", step: 2, targetId: "A", effect: "fade" },
      { kind: "highlight", step: 2, targetId: "A-B", effect: "glow" },
      { kind: "unhighlight", step: 3, targetId: "A-B" },
    ],
  };

  return { svg, timeline };
}

describe("createAnimationController", () => {
  it("reports totalSteps and starts at step 0", () => {
    const svg = buildFixtureSvg();
    const timeline = buildTimeline();

    const controller = createAnimationController(svg, timeline);

    expect(controller.totalSteps).toBe(2);
    expect(controller.currentStep).toBe(0);
  });

  it("reveals only step 1's elements on the first next() call", () => {
    const svg = buildFixtureSvg();
    const timeline = buildTimeline();
    const controller = createAnimationController(svg, timeline);

    controller.next();

    const nodeB = getNode(svg, "B");
    const nodeC = getNode(svg, "C");
    expect(nodeB.classList.contains("siren-pending")).toBe(false);
    expect(nodeB.classList.contains("siren-enter-fade")).toBe(true);
    expect(nodeC.classList.contains("siren-pending")).toBe(true);
    expect(nodeC.classList.contains("siren-enter-fade")).toBe(false);
    expect(controller.currentStep).toBe(1);
  });

  it("reveals step 2's elements on the second next() call", () => {
    const svg = buildFixtureSvg();
    const timeline = buildTimeline();
    const controller = createAnimationController(svg, timeline);

    controller.next();
    controller.next();

    const nodeC = getNode(svg, "C");
    expect(nodeC.classList.contains("siren-pending")).toBe(false);
    expect(nodeC.classList.contains("siren-enter-fade")).toBe(true);
    expect(controller.currentStep).toBe(2);
  });

  it("is a no-op when next() is called past the last step", () => {
    const svg = buildFixtureSvg();
    const timeline = buildTimeline();
    const controller = createAnimationController(svg, timeline);

    controller.next();
    controller.next();
    expect(() => controller.next()).not.toThrow();

    const nodeB = getNode(svg, "B");
    const nodeC = getNode(svg, "C");
    expect(nodeB.classList.contains("siren-enter-fade")).toBe(true);
    expect(nodeB.classList.contains("siren-pending")).toBe(false);
    expect(nodeC.classList.contains("siren-enter-fade")).toBe(true);
    expect(nodeC.classList.contains("siren-pending")).toBe(false);
    expect(controller.currentStep).toBe(2);
  });

  it("applies a highlight action alongside an enter action in the same step", () => {
    const svg = buildFixtureSvg();
    const timeline: ResolvedTimeline = {
      totalSteps: 1,
      entries: [
        { kind: "enter", step: 1, targetId: "B", effect: "fade" },
        { kind: "highlight", step: 1, targetId: "B", effect: "outline" },
      ],
    };
    const controller = createAnimationController(svg, timeline);

    controller.next();

    const nodeB = getNode(svg, "B");
    expect(nodeB.classList.contains("siren-pending")).toBe(false);
    expect(nodeB.classList.contains("siren-enter-fade")).toBe(true);
    expect(nodeB.classList.contains("siren-highlight-outline")).toBe(true);
  });

  it("applies an exit action, keeping the element in the DOM", () => {
    const svg = buildFixtureSvg();
    const timeline: ResolvedTimeline = {
      totalSteps: 1,
      entries: [{ kind: "exit", step: 1, targetId: "A", effect: "fade" }],
    };
    const controller = createAnimationController(svg, timeline);

    controller.next();

    const nodeA = getNode(svg, "A");
    expect(svg.contains(nodeA)).toBe(true);
    expect(nodeA.classList.contains("siren-exit-fade")).toBe(true);
    expect(nodeA.classList.contains("siren-pending")).toBe(false);
  });

  it("removes the active highlight class on an unhighlight action", () => {
    const svg = buildFixtureSvg();
    const timeline: ResolvedTimeline = {
      totalSteps: 2,
      entries: [
        { kind: "highlight", step: 1, targetId: "A", effect: "glow" },
        { kind: "unhighlight", step: 2, targetId: "A" },
      ],
    };
    const controller = createAnimationController(svg, timeline);

    controller.next();
    controller.next();

    const nodeA = getNode(svg, "A");
    expect(nodeA.classList.contains("siren-highlight-glow")).toBe(false);
  });

  it("replaces an earlier highlight effect with a later one, never stacking", () => {
    const svg = buildFixtureSvg();
    const timeline: ResolvedTimeline = {
      totalSteps: 2,
      entries: [
        { kind: "highlight", step: 1, targetId: "A", effect: "outline" },
        { kind: "highlight", step: 2, targetId: "A", effect: "glow" },
      ],
    };
    const controller = createAnimationController(svg, timeline);

    controller.next();
    controller.next();

    const nodeA = getNode(svg, "A");
    expect(nodeA.classList.contains("siren-highlight-outline")).toBe(false);
    expect(nodeA.classList.contains("siren-highlight-glow")).toBe(true);
  });

  it("is a no-op when prev() is called at currentStep 0", () => {
    const svg = buildFixtureSvg();
    const timeline = buildTimeline();
    const controller = createAnimationController(svg, timeline);

    expect(() => controller.prev()).not.toThrow();

    expect(controller.currentStep).toBe(0);
    const nodeB = getNode(svg, "B");
    expect(nodeB.classList.contains("siren-pending")).toBe(true);
  });

  it("prev() after N next() calls matches the DOM state of N-1 next() calls from fresh, across all four action kinds", () => {
    const forward = buildAllKindsFixture();
    const forwardController = createAnimationController(forward.svg, forward.timeline);
    forwardController.next();
    forwardController.next();
    forwardController.next();

    const reference = buildAllKindsFixture();
    const referenceController = createAnimationController(reference.svg, reference.timeline);
    referenceController.next();
    referenceController.next();

    forwardController.prev();

    expect(forwardController.currentStep).toBe(2);
    expect(classesOf(forward.svg, "A")).toEqual(classesOf(reference.svg, "A"));
    expect(classesOf(forward.svg, "B")).toEqual(classesOf(reference.svg, "B"));
    expect(classesOf(forward.svg, "A-B")).toEqual(classesOf(reference.svg, "A-B"));
  });

  it("prev() clears a stale effect class from a target whose only action is at a step being reverted past, even though that target has no enter action", () => {
    // A has no `enter` action anywhere in buildAllKindsFixture's timeline —
    // it's visible from the start (step 0) and only gets `exit A fade` at
    // step 2. Stepping back to step 1 (before A's own action fires) must
    // leave A with no effect classes at all, not a stale siren-exit-fade
    // held over from having been at step 2 or later.
    const { svg, timeline } = buildAllKindsFixture();
    const controller = createAnimationController(svg, timeline);

    controller.next(); // step 1
    controller.next(); // step 2: A gets siren-exit-fade
    expect(classesOf(svg, "A")).toContain("siren-exit-fade");

    controller.prev(); // back to step 1, before A's exit ever fires

    expect(controller.currentStep).toBe(1);
    expect(classesOf(svg, "A")).toEqual(["siren-node"]);
  });

  it("reset() restores initial pending state after two next() calls", () => {
    const svg = buildFixtureSvg();
    const timeline = buildTimeline();
    const controller = createAnimationController(svg, timeline);

    controller.next();
    controller.next();
    controller.reset();

    const nodeA = getNode(svg, "A");
    const nodeB = getNode(svg, "B");
    const nodeC = getNode(svg, "C");
    expect(nodeB.classList.contains("siren-pending")).toBe(true);
    expect(nodeB.classList.contains("siren-enter-fade")).toBe(false);
    expect(nodeC.classList.contains("siren-pending")).toBe(true);
    expect(nodeC.classList.contains("siren-enter-fade")).toBe(false);
    expect(nodeA.classList.contains("siren-pending")).toBe(false);
    expect(nodeA.classList.contains("siren-enter-fade")).toBe(false);
    expect(controller.currentStep).toBe(0);
  });
});
