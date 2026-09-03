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
});
