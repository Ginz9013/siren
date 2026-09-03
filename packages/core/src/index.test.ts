import { describe, expect, it } from "vitest";
import { render } from "./index";
import type { SirenRenderResult } from "./contracts";

/** A minimal valid document: a two-node, one-edge flowchart with a 2-step timeline. */
const VALID_SOURCE = `flowchart TD
A[Start] --> B[End]
timeline:
step 1: enter A fade
step 2: enter B fade
`;

describe("render", () => {
  it("mounts an SVG into the container with one siren-node group per node and one siren-edge path per edge, each carrying data-siren-id", () => {
    const container = document.createElement("div");

    const result = render(VALID_SOURCE, container);

    expect(result.svg).not.toBeNull();
    expect(container.contains(result.svg!)).toBe(true);

    const nodeGroups = result.svg!.querySelectorAll("g.siren-node");
    const edgePaths = result.svg!.querySelectorAll("path.siren-edge");
    expect(nodeGroups).toHaveLength(2);
    expect(edgePaths).toHaveLength(1);

    expect(
      Array.from(nodeGroups)
        .map((g) => g.getAttribute("data-siren-id"))
        .sort(),
    ).toEqual(["A", "B"]);
    expect(
      Array.from(edgePaths).map((p) => p.getAttribute("data-siren-id")),
    ).toEqual(["A-B"]);
  });

  it("marks elements referenced anywhere in timeline: as siren-pending, leaves never-mentioned elements unmarked, and reports totalSteps as the highest declared step", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
step 1: enter B fade
step 2: enter C fade
`;

    const result = render(source, container);

    const nodeA = result.svg!.querySelector('g.siren-node[data-siren-id="A"]')!;
    const nodeB = result.svg!.querySelector('g.siren-node[data-siren-id="B"]')!;
    const nodeC = result.svg!.querySelector('g.siren-node[data-siren-id="C"]')!;

    expect(nodeA.classList.contains("siren-pending")).toBe(false);
    expect(nodeB.classList.contains("siren-pending")).toBe(true);
    expect(nodeC.classList.contains("siren-pending")).toBe(true);
    expect(result.controller!.totalSteps).toBe(2);
  });

  it("reports totalSteps of 0 and renders every element immediately visible when there is no timeline: block", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[End]
`;

    const result = render(source, container);

    const nodeA = result.svg!.querySelector('g.siren-node[data-siren-id="A"]')!;
    const nodeB = result.svg!.querySelector('g.siren-node[data-siren-id="B"]')!;

    expect(nodeA.classList.contains("siren-pending")).toBe(false);
    expect(nodeB.classList.contains("siren-pending")).toBe(false);
    expect(result.controller!.totalSteps).toBe(0);
  });

  it("does not throw on unparseable source, and returns a null svg/controller with the parse diagnostics", () => {
    const container = document.createElement("div");
    const source = `this is not a valid siren document`;

    let result: SirenRenderResult | undefined;
    expect(() => {
      result = render(source, container);
    }).not.toThrow();

    expect(result!.svg).toBeNull();
    expect(result!.controller).toBeNull();
    expect(result!.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("produces an error diagnostic for a timeline: entry referencing an undeclared id, without throwing, and still renders the rest of the diagram", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[End]
timeline:
step 1: enter GHOST fade
`;

    let result: SirenRenderResult | undefined;
    expect(() => {
      result = render(source, container);
    }).not.toThrow();

    expect(
      result!.diagnostics.some(
        (d) => d.severity === "error" && d.message.includes("GHOST"),
      ),
    ).toBe(true);
    expect(result!.svg).not.toBeNull();
    expect(result!.svg!.querySelectorAll("g.siren-node")).toHaveLength(2);
    expect(result!.svg!.querySelectorAll("path.siren-edge")).toHaveLength(1);
  });

  it("uses a jsdom-safe default TextMeasurer that sizes labels by length, so longer labels lay out wider than shorter ones", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Hi] --> B[A very long descriptive label]
`;

    const result = render(source, container);

    const rectA = result.svg!.querySelector('g[data-siren-id="A"] rect')!;
    const rectB = result.svg!.querySelector('g[data-siren-id="B"] rect')!;

    const widthA = Number(rectA.getAttribute("width"));
    const widthB = Number(rectB.getAttribute("width"));

    expect(widthA).toBeGreaterThan(0);
    expect(widthB).toBeGreaterThan(widthA);
  });

  it("honors an injected options.measureText override instead of the default measurer", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Same] --> B[Same]
`;

    const result = render(source, container, {
      measureText: { measure: () => ({ width: 123, height: 45 }) },
    });

    const rectA = result.svg!.querySelector('g[data-siren-id="A"] rect')!;
    expect(rectA.getAttribute("width")).toBe("123");
    expect(rectA.getAttribute("height")).toBe("45");
  });

  it("controller.next() reveals exactly the newly-current step's elements, is a no-op past the last step, and reset() restores the initial pending state", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
step 1: enter B fade
step 2: enter C fade
`;

    const result = render(source, container);
    const controller = result.controller!;
    const svg = result.svg!;
    const nodeB = () => svg.querySelector('g[data-siren-id="B"]')!;
    const nodeC = () => svg.querySelector('g[data-siren-id="C"]')!;

    controller.next();
    expect(nodeB().classList.contains("siren-pending")).toBe(false);
    expect(nodeB().classList.contains("siren-enter-fade")).toBe(true);
    expect(nodeC().classList.contains("siren-pending")).toBe(true);
    expect(controller.currentStep).toBe(1);

    controller.next();
    expect(nodeC().classList.contains("siren-pending")).toBe(false);
    expect(nodeC().classList.contains("siren-enter-fade")).toBe(true);
    expect(controller.currentStep).toBe(2);

    controller.next();
    expect(controller.currentStep).toBe(2);

    controller.reset();
    expect(nodeB().classList.contains("siren-pending")).toBe(true);
    expect(nodeB().classList.contains("siren-enter-fade")).toBe(false);
    expect(nodeC().classList.contains("siren-pending")).toBe(true);
    expect(nodeC().classList.contains("siren-enter-fade")).toBe(false);
    expect(controller.currentStep).toBe(0);
  });

  it("renders a label containing markup-looking text as literal visible text, never as parsed markup", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[<script>alert(1)</script>] --> B[End]
`;

    const result = render(source, container);

    const nodeA = result.svg!.querySelector('g[data-siren-id="A"]')!;
    const text = nodeA.querySelector("text")!;

    expect(text.textContent).toBe("<script>alert(1)</script>");
    expect(result.svg!.querySelectorAll("script")).toHaveLength(0);
  });

  it("renders end to end through the real pipeline for a document using all four timeline verbs and a slide-* effect", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
step 1: enter A slide-left
step 2: enter B fade
step 3: highlight A outline
step 4: exit A fade
step 5: unhighlight B
`;

    const result = render(source, container);

    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(false);
    expect(result.svg).not.toBeNull();
    expect(result.controller).not.toBeNull();
    expect(result.controller!.totalSteps).toBe(5);
    expect(result.svg!.querySelectorAll("g.siren-node")).toHaveLength(3);
    expect(result.svg!.querySelectorAll("path.siren-edge")).toHaveLength(2);
  });

  it("calling controller.next() several times then controller.prev() once produces the same DOM class state, per element, as one fewer next() call, through the real pipeline", () => {
    const source = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
step 1: enter A slide-left
step 2: enter B fade
step 3: highlight A outline
step 4: exit A fade
step 5: unhighlight B
`;

    const forwardThenBackContainer = document.createElement("div");
    const forwardThenBack = render(source, forwardThenBackContainer);
    const controller = forwardThenBack.controller!;
    controller.next();
    controller.next();
    controller.next();
    controller.prev();

    const referenceContainer = document.createElement("div");
    const reference = render(source, referenceContainer);
    reference.controller!.next();
    reference.controller!.next();

    const ids = ["A", "B", "C"];
    for (const id of ids) {
      const actual = forwardThenBack.svg!.querySelector(`[data-siren-id="${id}"]`)!;
      const expected = reference.svg!.querySelector(`[data-siren-id="${id}"]`)!;
      expect(Array.from(actual.classList).sort()).toEqual(
        Array.from(expected.classList).sort(),
      );
    }
    expect(controller.currentStep).toBe(2);
  });

  it("produces an error diagnostic (and drops the action, without throwing) for a highlight action referencing an element before it becomes visible, while the rest of the diagram still renders", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[End]
timeline:
step 1: highlight B outline
step 2: enter B fade
`;

    let result: SirenRenderResult | undefined;
    expect(() => {
      result = render(source, container);
    }).not.toThrow();

    expect(
      result!.diagnostics.some(
        (d) => d.severity === "error" && d.message.includes("B") && d.message.includes("highlight"),
      ),
    ).toBe(true);
    expect(result!.svg).not.toBeNull();
    expect(result!.svg!.querySelectorAll("g.siren-node")).toHaveLength(2);
    expect(result!.svg!.querySelectorAll("path.siren-edge")).toHaveLength(1);
  });
});
