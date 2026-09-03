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
      { step: 1, targetId: "B", effect: "fade" },
      { step: 2, targetId: "C", effect: "fade" },
    ],
  };
}

function getNode(svg: SVGSVGElement, id: string): Element {
  const el = svg.querySelector(`[data-siren-id="${id}"]`);
  if (!el) throw new Error(`fixture missing node ${id}`);
  return el;
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
