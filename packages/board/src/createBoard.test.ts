import { describe, expect, it } from "vitest";
import { createBoard } from "./createBoard";

/** A minimal valid document: two nodes, one edge, no timeline. */
const VALID_SOURCE = `flowchart TD
A[Start] --> B[End]
`;

const FAKE_MEASURER = { measure: () => ({ width: 80, height: 32 }) };

describe("createBoard", () => {
  it("mounts a rendered SVG into the container when constructed with a source", () => {
    const container = document.createElement("div");

    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll("g.siren-node")).toHaveLength(2);
  });

  it("marks the container with the siren-board class, so board's injected chrome CSS (full-bleed sizing, SVG scale-to-fit) applies to it", () => {
    const container = document.createElement("div");

    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });

    expect(container.classList.contains("siren-board")).toBe(true);
  });

  it("injects its chrome stylesheet into document.head exactly once, no matter how many boards are created on the page", () => {
    document.head.querySelectorAll("style#siren-board-styles").forEach((el) => el.remove());

    createBoard(document.createElement("div"), { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    createBoard(document.createElement("div"), { source: VALID_SOURCE, measureText: FAKE_MEASURER });

    expect(document.head.querySelectorAll("style#siren-board-styles")).toHaveLength(1);
  });

  it("mounts nothing until setSource is called, when constructed with no initial source", () => {
    const container = document.createElement("div");

    const board = createBoard(container, { measureText: FAKE_MEASURER });

    expect(container.querySelector("svg")).toBeNull();
    expect(board.controller).toBeNull();
    expect(board.diagnostics).toEqual([]);
  });

  it("setSource re-renders synchronously and updates controller/diagnostics", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { measureText: FAKE_MEASURER });

    board.setSource(VALID_SOURCE);

    expect(container.querySelector("svg")).not.toBeNull();
    expect(board.controller).not.toBeNull();
    expect(board.diagnostics).toEqual([]);
  });

  it("keeps the last successful diagram and controller visible when a later setSource fails to parse, and shows an error banner", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    const svgBeforeFailure = container.querySelector("svg");
    const controllerBeforeFailure = board.controller;

    board.setSource("this is not a valid siren document");

    expect(container.querySelector("svg")).toBe(svgBeforeFailure);
    expect(board.controller).toBe(controllerBeforeFailure);
    expect(board.diagnostics.some((d) => d.severity === "error")).toBe(true);
    expect(container.querySelector(".siren-board-error")).not.toBeNull();
  });

  it("clears a previous error banner once a later setSource succeeds again", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });
    board.setSource("this is not a valid siren document");
    expect(container.querySelector(".siren-board-error")).not.toBeNull();

    board.setSource(VALID_SOURCE);

    expect(container.querySelector(".siren-board-error")).toBeNull();
  });

  it("calls onDiagnostics on every setSource, including a successful render that only produced warnings", () => {
    const container = document.createElement("div");
    const seen: Array<{ severity: string }[]> = [];
    const board = createBoard(container, {
      measureText: FAKE_MEASURER,
      onDiagnostics: (diagnostics) => seen.push(diagnostics),
    });

    const sourceWithWarningOnly = `flowchart TD
A[Start] --> B[End]
A[Different] --> B[End]
`;
    board.setSource(sourceWithWarningOnly);

    expect(seen).toHaveLength(1);
    expect(seen[0].some((d) => d.severity === "warning")).toBe(true);
    expect(board.diagnostics.some((d) => d.severity === "error")).toBe(false);
  });

  it("destroy() clears the container's mounted content and siren-board class", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });

    board.destroy();

    expect(container.children).toHaveLength(0);
    expect(container.classList.contains("siren-board")).toBe(false);
  });

  it("destroy() does not remove the shared injected stylesheet, and calling it twice does not throw", () => {
    const container = document.createElement("div");
    const board = createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });

    board.destroy();

    expect(document.head.querySelector("style#siren-board-styles")).not.toBeNull();
    expect(() => board.destroy()).not.toThrow();
  });

  it("renders a default Prev/Next/Reset control bar unless controls: false is passed", () => {
    const container = document.createElement("div");

    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER });

    const bar = container.querySelector(".siren-board-controls")!;
    expect(bar).not.toBeNull();
    const buttonLabels = Array.from(bar.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttonLabels).toEqual(["Prev", "Next", "Reset"]);
  });

  it("controls: false renders no control bar", () => {
    const container = document.createElement("div");

    createBoard(container, { source: VALID_SOURCE, measureText: FAKE_MEASURER, controls: false });

    expect(container.querySelector(".siren-board-controls")).toBeNull();
  });

  it("clicking the default bar's Next button advances board.controller.currentStep", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[End]
timeline:
step 1: enter B fade
`;
    const board = createBoard(container, { source, measureText: FAKE_MEASURER });

    const nextButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Next",
    )!;
    nextButton.click();

    expect(board.controller!.currentStep).toBe(1);
  });

  it("controls: <factory> renders the factory's element instead of the built-in bar, and calls its destroy() when the board is destroyed", () => {
    const container = document.createElement("div");
    const customElement = document.createElement("div");
    customElement.className = "my-custom-controls";
    const destroySpy = { called: false };

    const board = createBoard(container, {
      source: VALID_SOURCE,
      measureText: FAKE_MEASURER,
      controls: () => ({
        element: customElement,
        destroy: () => {
          destroySpy.called = true;
        },
      }),
    });

    expect(container.querySelector(".siren-board-controls")).toBeNull();
    expect(container.contains(customElement)).toBe(true);

    board.destroy();
    expect(destroySpy.called).toBe(true);
  });

  it("onStepChange fires once per step change, from either the built-in bar or a direct board.controller call, but not on construction or a no-op call", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
step 1: enter B fade
step 2: enter C fade
`;
    const calls: Array<[number, number]> = [];
    const board = createBoard(container, {
      source,
      measureText: FAKE_MEASURER,
      onStepChange: (current, total) => calls.push([current, total]),
    });

    expect(calls).toEqual([]); // no synthetic call on construction

    const nextButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Next",
    )!;
    nextButton.click(); // built-in bar trigger
    expect(calls).toEqual([[1, 2]]);

    board.controller!.next(); // direct controller trigger
    expect(calls).toEqual([[1, 2], [2, 2]]);

    board.controller!.next(); // already at the last step: no-op, no callback
    expect(calls).toEqual([[1, 2], [2, 2]]);

    board.controller!.reset();
    expect(calls).toEqual([[1, 2], [2, 2], [0, 2]]);
  });
});
