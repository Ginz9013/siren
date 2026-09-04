import { describe, expect, it } from "vitest";
import { render } from "./index";
import type { SirenRenderResult } from "./contracts";

/**
 * Kept identical to demos/sequence-diagram.html's fetched example,
 * examples/sequence-core.srn — duplicated inline here (rather than read via
 * `node:fs`) because this package has no `@types/node`/Node-built-in typings
 * configured (`tsc --noEmit` has no `lib`/`types` for them) and adding one is
 * outside this ticket's write scope (`packages/core/package.json` is not in
 * it). If the two ever drift, this test and the demo page stop exercising
 * the same source.
 */
const SEQUENCE_CORE_EXAMPLE_SOURCE = `sequenceDiagram
title Core sequence diagram feature tour
participant Client
actor User
participant Server

autonumber
User->Client: Open app
Client->>Server: Fetch profile
Server-->>Client: Profile data
autonumber off
Client->Server: Plain request
Client-->Server: Plain dotted request
Client->>Server: Solid filled arrowhead
Client-->>Server: Dotted filled arrowhead
Client<<->>Server: Solid bidirectional
Client<<-->>Server: Dotted bidirectional
Client-xServer: Solid cross (lost message)
Client--xServer: Dotted cross (lost message)
Client-)Server: Solid open (async)
Client--)Server: Dotted open (async)
`;

/**
 * Kept identical to demos/sequence-diagram.html's second fetched example,
 * examples/sequence-blocks.srn — duplicated inline for the same reason as
 * SEQUENCE_CORE_EXAMPLE_SOURCE above (no `node:fs` typings in this package).
 *
 * Exercises all seven control-flow block kinds, with `alt` nested inside
 * `loop`. Lane order is Client, Server, Cache, and the blocks deliberately
 * touch different lane spans: `loop` (with its nested `alt`) only ever
 * touches Client and Server, while `par` reaches across to Cache.
 */
const SEQUENCE_BLOCKS_EXAMPLE_SOURCE = `sequenceDiagram
title Control-flow block tour
participant Client
participant Server
participant Cache

loop Every minute
  Client->>Server: Poll for work
  alt is fresh
    Server-->>Client: Fresh data
  else is stale
    Server-->>Client: Stale marker
  else is missing
    Server--xClient: Not found
  end
end
opt Warm the cache
  Client->>Server: Prime hint
end
par Fan out
  Client->>Server: Task A
and Second branch
  Client->>Cache: Task B
end
critical Acquire lock
  Client->>Cache: Lock
option Timeout
  Cache-->>Client: Busy
end
break Fatal error
  Server--xClient: Abort
end
rect rgb(240, 248, 255)
  Client->>Cache: Highlighted exchange
end
`;

/** A minimal valid document: a two-node, one-edge flowchart with a 2-step timeline. */
const VALID_SOURCE = `flowchart TD
A[Start] --> B[End]
timeline:
step 1: enter A fade
step 2: enter B fade
`;

/** A document exercising all four timeline verbs plus a slide-* effect, across 5 steps. */
const ALL_VERBS_SOURCE = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
step 1: enter A slide-left
step 2: enter B fade
step 3: highlight A outline
step 4: exit A fade
step 5: unhighlight B
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

    const result = render(ALL_VERBS_SOURCE, container);

    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(false);
    expect(result.svg).not.toBeNull();
    expect(result.controller).not.toBeNull();
    expect(result.controller!.totalSteps).toBe(5);
    expect(result.svg!.querySelectorAll("g.siren-node")).toHaveLength(3);
    expect(result.svg!.querySelectorAll("path.siren-edge")).toHaveLength(2);
  });

  it("calling controller.next() several times then controller.prev() once produces the same DOM class state, per element, as one fewer next() call, through the real pipeline", () => {
    const forwardThenBackContainer = document.createElement("div");
    const forwardThenBack = render(ALL_VERBS_SOURCE, forwardThenBackContainer);
    const controller = forwardThenBack.controller!;
    controller.next();
    controller.next();
    controller.next();
    controller.prev();

    const referenceContainer = document.createElement("div");
    const reference = render(ALL_VERBS_SOURCE, referenceContainer);
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

  it("mounts an SVG for a real sequenceDiagram source with participant and message elements, and returns a null controller with no diagnostics", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant A
actor B
A->>B: Hello
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    expect(result.controller).toBeNull();
    expect(result.svg).not.toBeNull();
    expect(container.contains(result.svg!)).toBe(true);

    const participantGroups = result.svg!.querySelectorAll("g.siren-participant");
    const lifelines = result.svg!.querySelectorAll("line.siren-lifeline");
    const messageGroups = result.svg!.querySelectorAll("g.siren-message");
    // Two declared, never-destroyed participants, so each is drawn twice:
    // once at its lifeline's top and once at the bottom row (spec.md's SVG
    // conventions). One lifeline each, regardless.
    expect(participantGroups).toHaveLength(4);
    expect(lifelines).toHaveLength(2);
    expect(messageGroups).toHaveLength(1);
  });

  it("produces an error diagnostic for a sequenceDiagram message referencing an undeclared participant, without throwing", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant A
A->>GHOST: Hello
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
  });

  it("renders demos/sequence-diagram.html's example source (examples/sequence-core.srn) end to end with no error diagnostics, both participant kinds, all ten arrow forms, a title, and autonumber labels", () => {
    const container = document.createElement("div");

    const result = render(SEQUENCE_CORE_EXAMPLE_SOURCE, container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.controller).toBeNull();
    expect(result.svg).not.toBeNull();

    // Three declared, never-destroyed participants, each drawn at both the
    // top and the bottom row; still one lifeline apiece.
    expect(result.svg!.querySelectorAll("g.siren-participant")).toHaveLength(6);
    expect(result.svg!.querySelectorAll("line.siren-lifeline")).toHaveLength(3);
    expect(result.svg!.querySelectorAll("g.siren-message")).toHaveLength(13);
    expect(result.svg!.querySelectorAll("text.siren-title")).toHaveLength(1);
    expect(
      result.svg!.querySelectorAll("text.siren-autonumber").length,
    ).toBeGreaterThan(0);
  });

  it("renders demos/sequence-diagram.html's control-flow example (examples/sequence-blocks.srn) end to end with one siren-block group per block, nested inside its parent block, with a divider per extra branch", () => {
    const container = document.createElement("div");

    const result = render(SEQUENCE_BLOCKS_EXAMPLE_SOURCE, container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.controller).toBeNull();
    expect(result.svg).not.toBeNull();
    expect(container.contains(result.svg!)).toBe(true);

    const blocks = Array.from(result.svg!.querySelectorAll("g.siren-block"));
    expect(blocks.map((g) => g.getAttribute("data-siren-id")).sort()).toEqual([
      "alt-1",
      "break-1",
      "critical-1",
      "loop-1",
      "opt-1",
      "par-1",
      "rect-1",
    ]);
    for (const block of blocks) {
      const id = block.getAttribute("data-siren-id")!;
      expect(block.getAttribute("data-siren-block-kind")).toBe(id.split("-")[0]);
    }

    const byId = (id: string) =>
      result.svg!.querySelector(`g.siren-block[data-siren-id="${id}"]`)!;

    // `alt` is written inside `loop`, so its group is a descendant of loop's.
    expect(byId("loop-1").contains(byId("alt-1"))).toBe(true);
    expect(byId("alt-1").contains(byId("loop-1"))).toBe(false);

    // One divider per branch after the first: alt has if + 2 else, par has
    // 2 and-branches, critical has if + 1 option, the rest are single-branch.
    const dividerCount = (id: string) =>
      byId(id).querySelectorAll(":scope > line.siren-block-divider").length;
    expect(dividerCount("alt-1")).toBe(2);
    expect(dividerCount("par-1")).toBe(1);
    expect(dividerCount("critical-1")).toBe(1);
    expect(dividerCount("loop-1")).toBe(0);
    expect(dividerCount("opt-1")).toBe(0);
    expect(dividerCount("break-1")).toBe(0);
    expect(dividerCount("rect-1")).toBe(0);

    // Header and branch conditions come through as literal text.
    const labelsOf = (id: string) =>
      Array.from(byId(id).querySelectorAll(":scope > text.siren-block-label")).map(
        (t) => t.textContent,
      );
    expect(labelsOf("loop-1")).toEqual(["Every minute"]);
    expect(labelsOf("alt-1")).toEqual(["is fresh", "is stale", "is missing"]);
    expect(labelsOf("par-1")).toEqual(["Fan out", "Second branch"]);
    expect(labelsOf("critical-1")).toEqual(["Acquire lock", "Timeout"]);
    expect(labelsOf("break-1")).toEqual(["Fatal error"]);
    expect(labelsOf("opt-1")).toEqual(["Warm the cache"]);

    // A block spans the lanes its body touches: loop (and its nested alt)
    // only reach Server, par reaches all the way out to Cache.
    const frameWidth = (id: string) =>
      Number(
        byId(id).querySelector(":scope > rect")!.getAttribute("width"),
      );
    expect(frameWidth("par-1")).toBeGreaterThan(frameWidth("loop-1"));

    // Messages inside blocks still render, addressable by id.
    expect(
      result.svg!.querySelector('g.siren-message[data-siren-id="Client-Server"]'),
    ).not.toBeNull();
    expect(
      result.svg!.querySelector('g.siren-message[data-siren-id="Cache-Client"]'),
    ).not.toBeNull();
    for (const id of ["Client", "Server", "Cache"]) {
      expect(
        result.svg!.querySelector(`g.siren-participant[data-siren-id="${id}"]`),
      ).not.toBeNull();
    }
  });

  it("produces the parser's unterminated-block error diagnostic, without throwing, for a sequenceDiagram block missing its end", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant Client
participant Server

loop Every minute
  Client->>Server: Poll for work
`;

    let result: SirenRenderResult | undefined;
    expect(() => {
      result = render(source, container);
    }).not.toThrow();

    expect(
      result!.diagnostics.some(
        (d) =>
          d.severity === "error" &&
          d.message.includes("loop") &&
          d.message.includes("end"),
      ),
    ).toBe(true);
    expect(result!.controller).toBeNull();
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
