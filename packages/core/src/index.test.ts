import { describe, expect, it } from "vitest";
import { render, type InteractionTarget } from "./index";
import type { SirenRenderResult } from "./contracts";
import { readdirSync, readFileSync } from "node:fs";

/**
 * This test file's own URL.
 *
 * It is read into a binding rather than used inline below on purpose: Vite
 * rewrites the *literal* `new URL("...", import.meta.url)` form into a
 * dev-server asset URL (`http://localhost:3000/@fs/...`), which `readFileSync`
 * rejects with "The URL must be of scheme file". Going through a binding keeps
 * it the real `file:` URL that resolution against disk needs.
 */
const TEST_FILE_URL = import.meta.url;

/**
 * The repository's `examples/` directory, resolved relative to *this file*
 * rather than to `process.cwd()`, so the suite reads the same documents
 * whether it is run from the repo root (`pnpm -r test`) or from
 * `packages/core` (`npx vitest run`).
 */
const EXAMPLES_DIR = new URL("../../../examples/", TEST_FILE_URL);

/**
 * Reads one of the repository's `examples/*.srn` documents straight from disk,
 * so that every example test exercises the same bytes the demo pages fetch —
 * there is no inline copy left to drift from them.
 */
const readExample = (name: string): string =>
  readFileSync(new URL(`${name}.srn`, EXAMPLES_DIR), "utf8");

/**
 * Renders `source` into a container attached to a document carrying the
 * default theme, and hands back the `<svg>`.
 *
 * Attached, and themed, because the tests using it ask what a declaration
 * *computes to* rather than which attribute carries it — and an author
 * declaration only means anything against the theme it is overriding.
 * `getComputedStyle` on a detached element has no stylesheet to consult, so
 * it could not tell the two answers apart.
 *
 * The stylesheet is read off disk rather than imported: vitest rewrites any
 * `.css` module id to an empty string while `test.css` is false (this
 * package's default), `?raw` included, and a silently empty theme would make
 * every precedence assertion below vacuous instead of failing.
 */
function renderThemed(source: string): SVGSVGElement {
  if (document.getElementById("siren-default-theme") === null) {
    const style = document.createElement("style");
    style.id = "siren-default-theme";
    style.textContent = readFileSync(new URL("./theme/default.css", TEST_FILE_URL), "utf8");
    document.head.appendChild(style);
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const { svg, diagnostics } = render(source, container);
  expect(diagnostics).toEqual([]);
  if (svg === null) {
    throw new Error("render() produced no <svg>");
  }
  return svg;
}

/**
 * `markup` with every minted id scope collapsed to a fixed token.
 *
 * Marker ids are namespaced per render (`renderer/mintIdScope.ts`, which all
 * three renderers mint from), because `url(#id)` resolves against the whole
 * document rather than against the SVG it is written in. The direct cost is
 * that markup is no longer byte-reproducible across renders — so a comparison
 * asking "are these two the same *drawing*?" has to collapse exactly those
 * tokens, and nothing else: every other byte is still compared verbatim, and
 * the `__` prefix no `siren-*` class name contains is what makes the
 * substitution unambiguous.
 */
const sameDrawing = (markup: string): string =>
  markup.replace(/__[0-9a-z]{8}(?![0-9a-z])/g, "__SCOPE");

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
  it("renders a flowchart declared with any of the four directions, and with the TD alias", () => {
    for (const header of ["TB", "BT", "LR", "RL", "TD"]) {
      const container = document.createElement("div");

      const result = render(`flowchart ${header}\nA[Start] --> B[End]\n`, container);

      expect(result.diagnostics).toEqual([]);
      expect(result.svg).not.toBeNull();
      expect(result.svg!.querySelectorAll("g.siren-node")).toHaveLength(2);
    }
  });

  it("carries the header's direction all the way through to node coordinates", () => {
    const boxesFor = (header: string) => {
      const result = render(`flowchart ${header}\nA[Start] --> B[End]\n`, document.createElement("div"));
      const entries = Array.from(result.svg!.querySelectorAll("g.siren-node")).map((group) => {
        const rect = group.querySelector("rect")!;
        return [
          group.getAttribute("data-siren-id")!,
          { x: Number(rect.getAttribute("x")), y: Number(rect.getAttribute("y")) },
        ] as const;
      });
      return Object.fromEntries(entries);
    };

    const tb = boxesFor("TB");
    expect(tb.B.y).toBeGreaterThan(tb.A.y);

    const bt = boxesFor("BT");
    expect(bt.B.y).toBeLessThan(bt.A.y);

    const lr = boxesFor("LR");
    expect(lr.B.x).toBeGreaterThan(lr.A.x);

    const rl = boxesFor("RL");
    expect(rl.B.x).toBeLessThan(rl.A.x);
  });

  it("lays out flowchart TD identically to flowchart TB, because TD is an alias and not a direction of its own", () => {
    const geometryFor = (header: string) => {
      const result = render(`flowchart ${header}\nA[Start] --> B[End]\n`, document.createElement("div"));
      return Array.from(result.svg!.querySelectorAll("g.siren-node")).map((group) => {
        const rect = group.querySelector("rect")!;
        return {
          id: group.getAttribute("data-siren-id"),
          x: rect.getAttribute("x"),
          y: rect.getAttribute("y"),
          width: rect.getAttribute("width"),
          height: rect.getAttribute("height"),
        };
      });
    };

    expect(geometryFor("TD")).toEqual(geometryFor("TB"));
  });

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

  it("hands back every diagram kind already in the exact class state reset() produces", () => {
    // The one rule behind step 0, asserted as one rule: what a reader sees
    // before touching the controller *is* `reset()`'s output, for all three
    // kinds. `computeClassStateAtStep(timeline, 0)` decides it and nothing
    // else recomputes it, so a second opinion cannot quietly grow back — this
    // test fails the moment a rendered diagram and `reset()` disagree.
    const classStateById = (svg: SVGSVGElement): string[] =>
      Array.from(svg.querySelectorAll("[data-siren-id]")).map(
        (el) =>
          `${el.getAttribute("data-siren-id")}: ${Array.from(el.classList).sort().join(" ")}`,
      );

    const sources = [
      `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
step 1: enter B fade
step 2: enter C fade
`,
      `classDiagram
Animal <|-- Duck
timeline:
step 1: enter Duck fade
step 2: enter Animal-Duck slide-left
`,
      `sequenceDiagram
participant A
participant B
A->>B: Hello
timeline:
  step 1: enter A fade
`,
    ];

    for (const source of sources) {
      const container = document.createElement("div");
      const result = render(source, container);

      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      const asRendered = classStateById(result.svg!);

      // Guards the comparison against passing vacuously: each source names an
      // `enter`, so something must actually start pending for there to be a
      // step-0 state worth agreeing about.
      expect(asRendered.some((entry) => entry.includes("siren-pending"))).toBe(true);

      result.controller!.reset();

      expect(classStateById(result.svg!)).toEqual(asRendered);
    }
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

  it("mounts an SVG for a real sequenceDiagram source with participant and message elements, and returns an empty controller with no diagnostics", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant A
actor B
A->>B: Hello
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    expect(result.controller!.totalSteps).toBe(0);
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

  it("draws the top participant row above the first message rather than over it, with each lifeline still hanging from its own box", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant A
participant B
A->>B: first message
`;

    const result = render(source, container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const messageY = Number(
      result
        .svg!.querySelector("g.siren-message path.siren-message-arrow")!
        .getAttribute("d")!
        .match(/^M[\d.-]+,([\d.-]+)/)![1],
    );

    const bands = Array.from(
      result.svg!.querySelectorAll('g.siren-participant[data-siren-id="A"] rect'),
    ).map((rect) => ({
      top: Number(rect.getAttribute("y")),
      bottom: Number(rect.getAttribute("y")) + Number(rect.getAttribute("height")),
    }));
    // Declared and never destroyed, so A is drawn twice: top row and bottom row.
    expect(bands).toHaveLength(2);
    const [topBand, bottomBand] = bands;

    // The message runs between the two rows, inside neither box.
    expect(topBand.bottom).toBeLessThanOrEqual(messageY);
    expect(bottomBand.top).toBeGreaterThanOrEqual(messageY);

    // The lifeline still spans box to box, top edge to bottom edge.
    const lifeline = result.svg!.querySelector('line.siren-lifeline[data-siren-id="A"]')!;
    expect(Number(lifeline.getAttribute("y1"))).toBe(topBand.top);
    expect(Number(lifeline.getAttribute("y2"))).toBe(bottomBand.bottom);
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

  it("renders every .srn document in examples/ with no error diagnostics, naming the offending file when one fails", () => {
    const files = readdirSync(EXAMPLES_DIR)
      .filter((name) => name.endsWith(".srn"))
      .sort();

    // Guard against the enumeration silently finding nothing: an empty list
    // would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(new URL(file, EXAMPLES_DIR), "utf8");
      const result = render(source, document.createElement("div"));

      expect(
        result.diagnostics.filter((d) => d.severity === "error"),
        `examples/${file} produced error diagnostics`,
      ).toEqual([]);
      expect(result.svg, `examples/${file} rendered no SVG`).not.toBeNull();
    }
  });

  it("renders demos/sequence-diagram.html's example source (examples/sequence-core.srn) end to end with no error diagnostics, both participant kinds, all ten arrow forms, a title, and autonumber labels", () => {
    const container = document.createElement("div");

    const result = render(readExample("sequence-core"), container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.controller!.totalSteps).toBe(0);
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

    const result = render(readExample("sequence-blocks"), container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.controller!.totalSteps).toBe(0);
    expect(result.svg).not.toBeNull();
    expect(container.contains(result.svg!)).toBe(true);

    const blocks = Array.from(result.svg!.querySelectorAll("g.siren-block"));
    expect(blocks.map((g) => g.getAttribute("data-siren-id")).sort()).toEqual([
      "alt:1",
      "break:1",
      "critical:1",
      "loop:1",
      "opt:1",
      "par:1",
      "rect:1",
    ]);
    for (const block of blocks) {
      const id = block.getAttribute("data-siren-id")!;
      expect(block.getAttribute("data-siren-block-kind")).toBe(id.split(":")[0]);
    }

    const byId = (id: string) =>
      result.svg!.querySelector(`g.siren-block[data-siren-id="${id}"]`)!;

    // `alt` is written inside `loop`, so its group is a descendant of loop's.
    expect(byId("loop:1").contains(byId("alt:1"))).toBe(true);
    expect(byId("alt:1").contains(byId("loop:1"))).toBe(false);

    // One divider per branch after the first: alt has if + 2 else, par has
    // 2 and-branches, critical has if + 1 option, the rest are single-branch.
    const dividerCount = (id: string) =>
      byId(id).querySelectorAll(":scope > line.siren-block-divider").length;
    expect(dividerCount("alt:1")).toBe(2);
    expect(dividerCount("par:1")).toBe(1);
    expect(dividerCount("critical:1")).toBe(1);
    expect(dividerCount("loop:1")).toBe(0);
    expect(dividerCount("opt:1")).toBe(0);
    expect(dividerCount("break:1")).toBe(0);
    expect(dividerCount("rect:1")).toBe(0);

    // Header and branch conditions come through as literal text.
    const labelsOf = (id: string) =>
      Array.from(byId(id).querySelectorAll(":scope > text.siren-block-label")).map(
        (t) => t.textContent,
      );
    expect(labelsOf("loop:1")).toEqual(["Every minute"]);
    expect(labelsOf("alt:1")).toEqual(["is fresh", "is stale", "is missing"]);
    expect(labelsOf("par:1")).toEqual(["Fan out", "Second branch"]);
    expect(labelsOf("critical:1")).toEqual(["Acquire lock", "Timeout"]);
    expect(labelsOf("break:1")).toEqual(["Fatal error"]);
    expect(labelsOf("opt:1")).toEqual(["Warm the cache"]);

    // A block spans the lanes its body touches: loop (and its nested alt)
    // only reach Server, par reaches all the way out to Cache.
    const frameWidth = (id: string) =>
      Number(
        byId(id).querySelector(":scope > rect")!.getAttribute("width"),
      );
    expect(frameWidth("par:1")).toBeGreaterThan(frameWidth("loop:1"));

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

  it("starts a `create`d participant's lifeline at its create statement with no top-row box, and ends a `destroy`ed one at its destroy statement with an X mark and no bottom-row box", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant Client
participant Server
Client->>Server: Start
create participant Worker
Server->>Worker: Spawn
Worker-->>Server: Done
destroy Worker
Server-->>Client: Finished
`;

    const result = render(source, container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const groupsFor = (id: string) =>
      result.svg!.querySelectorAll(`g.siren-participant[data-siren-id="${id}"]`);
    // Client and Server are declared and survive, so each is drawn at both the
    // top and the bottom row; Worker is created and then destroyed, so it is
    // drawn exactly once, at its `create` statement's row.
    expect(groupsFor("Client")).toHaveLength(2);
    expect(groupsFor("Server")).toHaveLength(2);
    expect(groupsFor("Worker")).toHaveLength(1);

    const lifeline = (id: string) =>
      result.svg!.querySelector(`line.siren-lifeline[data-siren-id="${id}"]`)!;
    const y1 = (id: string) => Number(lifeline(id).getAttribute("y1"));
    const y2 = (id: string) => Number(lifeline(id).getAttribute("y2"));

    // Created later than the diagram's top row, destroyed before its bottom.
    expect(y1("Worker")).toBeGreaterThan(y1("Client"));
    expect(y2("Worker")).toBeLessThan(y2("Client"));

    // Worker's one box sits at the top of its own (truncated) lifeline.
    const workerBoxY = Number(groupsFor("Worker")[0]!.querySelector("rect")!.getAttribute("y"));
    expect(workerBoxY).toBeGreaterThanOrEqual(y1("Client"));
    expect(workerBoxY).toBeLessThanOrEqual(y1("Worker"));

    const destroyMarks = result.svg!.querySelectorAll("path.siren-destroy-mark");
    expect(
      Array.from(destroyMarks).map((p) => p.getAttribute("data-siren-id")),
    ).toEqual(["Worker"]);
  });

  it("renders a `box <color> <label> ... end` grouping as one siren-box background spanning only its member lanes, painted before (behind) the participants it groups", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
box Blue Storefront
  actor Shopper
  participant Web
end
participant Orders
Shopper->>Web: Browse catalogue
Web->>Orders: Create order
`;

    const result = render(source, container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const boxes = result.svg!.querySelectorAll("g.siren-box");
    expect(boxes).toHaveLength(1);
    const box = boxes[0]!;
    expect(box.getAttribute("data-siren-id")).toBe("box:1");
    expect(box.querySelector("text.siren-box-label")!.textContent).toBe("Storefront");

    const laneX = (id: string) =>
      Number(
        result
          .svg!.querySelector(`line.siren-lifeline[data-siren-id="${id}"]`)!
          .getAttribute("x1"),
      );
    const background = box.querySelector("rect.siren-box-background")!;
    const left = Number(background.getAttribute("x"));
    const right = left + Number(background.getAttribute("width"));

    // Spans its two members' lanes, and stops short of the ungrouped one.
    expect(left).toBeLessThan(laneX("Shopper"));
    expect(right).toBeGreaterThan(laneX("Web"));
    expect(right).toBeLessThan(laneX("Orders"));

    // SVG paints in document order, so the background must come first.
    const children = Array.from(result.svg!.children);
    const firstParticipantIndex = children.findIndex((child) =>
      child.classList.contains("siren-participant"),
    );
    expect(children.indexOf(box)).toBeLessThan(firstParticipantIndex);
  });

  it("keeps a box grouping's generated id out of the message id space, so a `box`-to-`1` message cannot spell the first box's id", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
box Blue Storefront
  participant box
end
participant 1
box->>1: hi
`;

    const result = render(source, container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const idOf = (selector: string) =>
      result.svg!.querySelector(selector)!.getAttribute("data-siren-id");

    // The message keeps the connector convention, `${from}-${to}`; the box
    // grouping moves out of its way with a separator no participant id can
    // contain.
    expect(idOf("g.siren-message")).toBe("box-1");
    expect(idOf("g.siren-box")).toBe("box:1");

    // Where both spellings were `box-1`, each id now addresses one element.
    expect(result.svg!.querySelectorAll('[data-siren-id="box-1"]')).toHaveLength(1);
    expect(result.svg!.querySelectorAll('[data-siren-id="box:1"]')).toHaveLength(1);
  });

  it("renders exactly one siren-title carrying the title text, and no title element at all when the document declares none", () => {
    const body = `participant A
participant B
A->>B: Hello
`;

    const titled = render(
      `sequenceDiagram
title Handshake overview
${body}`,
      document.createElement("div"),
    );
    const titles = titled.svg!.querySelectorAll("text.siren-title");
    expect(titles).toHaveLength(1);
    expect(titles[0]!.textContent).toBe("Handshake overview");

    const untitled = render(`sequenceDiagram\n${body}`, document.createElement("div"));
    expect(untitled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(untitled.svg!.querySelectorAll("text.siren-title")).toHaveLength(0);
  });

  it("numbers every message after `autonumber` sequentially in document order — including messages nested inside blocks — and leaves messages before it and after `autonumber off` unnumbered", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant A
participant B
A->>B: before numbering
autonumber
A->>B: first numbered
loop Retry
  A->>B: second numbered
  alt ok
    B-->>A: third numbered
  end
end
autonumber off
A->>B: after numbering
`;

    const result = render(source, container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const numbering = Array.from(
      result.svg!.querySelectorAll("g.siren-message"),
    ).map((g) => [
      g.querySelector("text.siren-message-label")!.textContent,
      g.querySelector("text.siren-autonumber")?.textContent ?? null,
    ]);

    expect(numbering).toEqual([
      ["before numbering", null],
      ["first numbered", "1"],
      ["second numbered", "2"],
      ["third numbered", "3"],
      ["after numbering", null],
    ]);
  });

  it("renders markup-looking title, box, participant, block-condition and message text in a sequenceDiagram as literal visible text, never as parsed markup", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
title <script>alert("title")</script>
box Blue <b>Team</b>
  participant A as <i>Alpha</i>
end
participant B
loop <img src=x onerror="alert(1)">
  A->>B: <script>alert("message")</script>
end
`;

    const result = render(source, container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.svg!.querySelector("text.siren-title")!.textContent).toBe(
      '<script>alert("title")</script>',
    );
    expect(result.svg!.querySelector("text.siren-box-label")!.textContent).toBe("<b>Team</b>");
    expect(
      result.svg!.querySelector('g.siren-participant[data-siren-id="A"] text')!.textContent,
    ).toBe("<i>Alpha</i>");
    expect(result.svg!.querySelector("text.siren-block-label")!.textContent).toBe(
      '<img src=x onerror="alert(1)">',
    );
    expect(result.svg!.querySelector("text.siren-message-label")!.textContent).toBe(
      '<script>alert("message")</script>',
    );

    expect(result.svg!.querySelectorAll("script")).toHaveLength(0);
    expect(result.svg!.querySelectorAll("img")).toHaveLength(0);
    expect(result.svg!.querySelectorAll("b")).toHaveLength(0);
    expect(result.svg!.querySelectorAll("i")).toHaveLength(0);
  });

  it("renders demos/sequence-diagram.html's comprehensive example (examples/sequence-full.srn) end to end — box grouping, both participant kinds, all ten arrow forms, a self-message, all seven block kinds nested, and create/destroy inside and outside blocks", () => {
    const container = document.createElement("div");

    const result = render(readExample("sequence-full"), container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // The example's own `timeline:` block, seven steps of it. What those steps
    // drive is asserted by the timeline test at the end of this file; here it
    // is only pinned so that a structural change to the example cannot quietly
    // drop it.
    expect(result.controller!.totalSteps).toBe(7);
    expect(result.svg).not.toBeNull();
    expect(container.contains(result.svg!)).toBe(true);
    const svg = result.svg!;

    expect(svg.querySelector("text.siren-title")!.textContent).toBe(
      "Checkout — every sequence feature",
    );

    // Four declared, never-destroyed participants (two rows each), plus three
    // `create`d ones (one row each): Ledger and Retry are destroyed, Auditor
    // survives — a created participant never gets a bottom row either way.
    const groupCount = (id: string) =>
      svg.querySelectorAll(`g.siren-participant[data-siren-id="${id}"]`).length;
    expect(groupCount("Shopper")).toBe(2);
    expect(groupCount("Web")).toBe(2);
    expect(groupCount("Orders")).toBe(2);
    expect(groupCount("Payments")).toBe(2);
    expect(groupCount("Ledger")).toBe(1);
    expect(groupCount("Retry")).toBe(1);
    expect(groupCount("Auditor")).toBe(1);
    expect(svg.querySelectorAll("g.siren-participant")).toHaveLength(11);

    // `actor` renders a stick figure, `participant` a box.
    expect(
      svg.querySelector('g.siren-participant[data-siren-id="Shopper"] circle'),
    ).not.toBeNull();
    expect(
      svg.querySelector('g.siren-participant[data-siren-id="Web"] rect'),
    ).not.toBeNull();

    // Lane order is preamble declaration order, then `create` order; `create`
    // moves a lifeline's start down the page, never its lane sideways.
    const lifelines = Array.from(svg.querySelectorAll("line.siren-lifeline"));
    expect(lifelines).toHaveLength(7);
    const lanes = ["Shopper", "Web", "Orders", "Payments", "Ledger", "Retry", "Auditor"];
    const laneX = (id: string) =>
      Number(
        svg.querySelector(`line.siren-lifeline[data-siren-id="${id}"]`)!.getAttribute("x1"),
      );
    for (let i = 1; i < lanes.length; i += 1) {
      expect(laneX(lanes[i]!)).toBeGreaterThan(laneX(lanes[i - 1]!));
    }

    // All ten arrow forms: two line styles x five arrowheads, each a distinct
    // marker/dash combination on the rendered path.
    const messages = Array.from(svg.querySelectorAll("g.siren-message"));
    expect(messages).toHaveLength(22);
    const arrowForms = new Set(
      messages.map((g) => {
        const path = g.querySelector("path.siren-message-arrow")!;
        return [
          path.getAttribute("stroke-dasharray") ?? "solid",
          path.getAttribute("marker-start") ?? "none",
          path.getAttribute("marker-end") ?? "none",
        ].join("|");
      }),
    );
    expect(arrowForms.size).toBe(10);

    // A self-message stays on its own lane.
    const selfMessage = svg.querySelector('g.siren-message[data-siren-id="Orders-Orders"]')!;
    expect(selfMessage).not.toBeNull();
    expect(selfMessage.querySelector("text.siren-message-label")!.textContent).toBe(
      "Validate line items",
    );

    // Autonumbering covers exactly the four messages between `autonumber` and
    // `autonumber off`.
    expect(
      Array.from(svg.querySelectorAll("text.siren-autonumber")).map((t) => t.textContent),
    ).toEqual(["1", "2", "3", "4"]);

    // All seven block kinds, with `alt` nested inside `loop`.
    const blocks = Array.from(svg.querySelectorAll("g.siren-block"));
    expect(blocks.map((g) => g.getAttribute("data-siren-id")).sort()).toEqual([
      "alt:1",
      "break:1",
      "critical:1",
      "loop:1",
      "opt:1",
      "par:1",
      "rect:1",
    ]);
    const block = (id: string) =>
      svg.querySelector(`g.siren-block[data-siren-id="${id}"]`)!;
    expect(block("loop:1").contains(block("alt:1"))).toBe(true);
    expect(
      block("alt:1").querySelectorAll(":scope > line.siren-block-divider"),
    ).toHaveLength(2);

    // One box background, behind the two lanes it groups.
    const boxes = svg.querySelectorAll("g.siren-box");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.querySelector("text.siren-box-label")!.textContent).toBe("Storefront");

    // Destroy marks for the two destroyed lifelines only — `destroy Ledger` at
    // the top level, `destroy Retry` from inside the nested `alt`.
    expect(
      Array.from(svg.querySelectorAll("path.siren-destroy-mark"))
        .map((p) => p.getAttribute("data-siren-id"))
        .sort(),
    ).toEqual(["Ledger", "Retry"]);
    // Both created lifelines start below the top row; both destroyed ones end
    // above the bottom row.
    const y1 = (id: string) =>
      Number(
        svg.querySelector(`line.siren-lifeline[data-siren-id="${id}"]`)!.getAttribute("y1"),
      );
    const y2 = (id: string) =>
      Number(
        svg.querySelector(`line.siren-lifeline[data-siren-id="${id}"]`)!.getAttribute("y2"),
      );
    for (const created of ["Ledger", "Retry", "Auditor"]) {
      expect(y1(created)).toBeGreaterThan(y1("Web"));
    }
    for (const destroyed of ["Ledger", "Retry"]) {
      expect(y2(destroyed)).toBeLessThan(y2("Web"));
    }
    expect(y2("Auditor")).toBe(y2("Web"));
  });

  it("gives every one of the ten source arrow forms its own line style and arrowhead through render(): dotted forms dash, `<<->>`/`<<-->>` arrow both ends, and filled/cross/open resolve to three distinct <marker> defs", () => {
    const container = document.createElement("div");
    // spec.md's two-axis arrow model: line style x arrowhead, written in the
    // ten Mermaid token spellings.
    const forms = [
      { token: "->", line: "solid", head: "none" },
      { token: "-->", line: "dotted", head: "none" },
      { token: "->>", line: "solid", head: "filled" },
      { token: "-->>", line: "dotted", head: "filled" },
      { token: "<<->>", line: "solid", head: "bidirectionalFilled" },
      { token: "<<-->>", line: "dotted", head: "bidirectionalFilled" },
      { token: "-x", line: "solid", head: "cross" },
      { token: "--x", line: "dotted", head: "cross" },
      { token: "-)", line: "solid", head: "open" },
      { token: "--)", line: "dotted", head: "open" },
    ] as const;
    const source = `sequenceDiagram
participant A
participant B
${forms.map((form) => `A${form.token}B: ${form.line} ${form.head}`).join("\n")}
`;

    const result = render(source, container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const messages = Array.from(result.svg!.querySelectorAll("g.siren-message"));
    expect(messages).toHaveLength(forms.length);

    const markerIdByHead = new Map<string, string>();
    forms.forEach((form, index) => {
      const group = messages[index]!;
      const path = group.querySelector("path.siren-message-arrow")!;
      const where = `${form.token} (${form.line} ${form.head})`;

      expect(group.querySelector("text.siren-message-label")!.textContent).toBe(
        `${form.line} ${form.head}`,
      );
      expect([where, path.getAttribute("stroke-dasharray") !== null]).toEqual([
        where,
        form.line === "dotted",
      ]);
      expect([where, path.getAttribute("marker-end") !== null]).toEqual([
        where,
        form.head !== "none",
      ]);
      expect([where, path.getAttribute("marker-start") !== null]).toEqual([
        where,
        form.head === "bidirectionalFilled",
      ]);

      const markerEnd = path.getAttribute("marker-end");
      if (markerEnd !== null) {
        const markerId = markerEnd.replace(/^url\(#/, "").replace(/\)$/, "");
        expect(result.svg!.querySelector(`defs marker#${markerId}`)).not.toBeNull();
        markerIdByHead.set(form.head, markerId);
      }
    });

    // `<<->>` reuses the filled head at both ends; cross and open are their
    // own marker shapes.
    expect(markerIdByHead.get("bidirectionalFilled")).toBe(markerIdByHead.get("filled"));
    expect(
      new Set([
        markerIdByHead.get("filled"),
        markerIdByHead.get("cross"),
        markerIdByHead.get("open"),
      ]).size,
    ).toBe(3);
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

  it("mounts an SVG for a classDiagram whose classes are declared only by a relationship, with one siren-class group per class and one siren-relationship group, and no diagnostics", () => {
    const container = document.createElement("div");
    // Mermaid's canonical class-diagram example: no `class` statement at all,
    // both classes declared by being named in the relationship.
    const source = `classDiagram
Animal <|-- Duck
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    expect(result.svg).not.toBeNull();
    expect(container.contains(result.svg!)).toBe(true);

    const classGroups = result.svg!.querySelectorAll("g.siren-class");
    const relationshipGroups = result.svg!.querySelectorAll("g.siren-relationship");
    expect(
      Array.from(classGroups)
        .map((g) => g.getAttribute("data-siren-id"))
        .sort(),
    ).toEqual(["Animal", "Duck"]);
    expect(
      Array.from(relationshipGroups).map((g) => g.getAttribute("data-siren-id")),
    ).toEqual(["Animal-Duck"]);
    expect(
      relationshipGroups[0].getAttribute("data-siren-relationship"),
    ).toBe("inheritance");
  });

  it("returns a working animation controller for a classDiagram, reporting totalSteps 0 when the document declares no timeline: block", () => {
    const container = document.createElement("div");
    const source = `classDiagram
Animal <|-- Duck
`;

    const result = render(source, container);

    expect(result.controller).not.toBeNull();
    expect(result.controller!.totalSteps).toBe(0);
    expect(result.controller!.currentStep).toBe(0);
    // Nothing is animated, so nothing starts hidden.
    expect(
      result.svg!.querySelectorAll("g.siren-class.siren-pending"),
    ).toHaveLength(0);
  });

  it("drives a classDiagram's classes and relationships through the same class transitions a flowchart's nodes and edges get", () => {
    const container = document.createElement("div");
    const source = `classDiagram
Animal <|-- Duck
timeline:
step 1: enter Duck fade
step 2: enter Animal-Duck slide-left
step 3: highlight Duck glow
step 4: unhighlight Duck
`;

    const result = render(source, container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const controller = result.controller!;
    expect(controller.totalSteps).toBe(4);

    const animal = result.svg!.querySelector('g.siren-class[data-siren-id="Animal"]')!;
    const duck = result.svg!.querySelector('g.siren-class[data-siren-id="Duck"]')!;
    const relationship = result.svg!.querySelector(
      'g.siren-relationship[data-siren-id="Animal-Duck"]',
    )!;

    // Only the two elements with an `enter` action start hidden.
    expect(animal.classList.contains("siren-pending")).toBe(false);
    expect(duck.classList.contains("siren-pending")).toBe(true);
    expect(relationship.classList.contains("siren-pending")).toBe(true);

    controller.next();
    expect(duck.classList.contains("siren-pending")).toBe(false);
    expect(duck.classList.contains("siren-enter-fade")).toBe(true);
    expect(relationship.classList.contains("siren-pending")).toBe(true);

    controller.next();
    expect(relationship.classList.contains("siren-pending")).toBe(false);
    expect(relationship.classList.contains("siren-enter-slide-left")).toBe(true);

    controller.next();
    expect(duck.classList.contains("siren-highlight-glow")).toBe(true);

    controller.next();
    expect(duck.classList.contains("siren-highlight-glow")).toBe(false);
    expect(controller.currentStep).toBe(4);

    controller.prev();
    expect(duck.classList.contains("siren-highlight-glow")).toBe(true);

    controller.reset();
    expect(controller.currentStep).toBe(0);
    expect(duck.classList.contains("siren-pending")).toBe(true);
    expect(duck.classList.contains("siren-enter-fade")).toBe(false);
    expect(relationship.classList.contains("siren-pending")).toBe(true);
  });

  it("renders demos/class-diagram.html's example source (examples/class-core.srn) end to end with no error diagnostics, every declaration form, member text verbatim, and all eight relationship kinds", () => {
    const container = document.createElement("div");

    const result = render(readExample("class-core"), container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.svg).not.toBeNull();

    const classIds = Array.from(result.svg!.querySelectorAll("g.siren-class"))
      .map((g) => g.getAttribute("data-siren-id"))
      .sort();
    // Six block/bare declarations, one declared only by inline members
    // (Feather), and two declared only by being named in a relationship
    // (Habitat, Keeper).
    expect(classIds).toEqual([
      "Animal",
      "Duck",
      "Feather",
      "Fish",
      "Flyer",
      "Habitat",
      "Keeper",
      "Registry",
      "Zebra",
    ]);

    // Members print back as the author wrote them, attributes above methods
    // with a divider over each populated compartment.
    const animal = result.svg!.querySelector('g.siren-class[data-siren-id="Animal"]')!;
    expect(
      Array.from(animal.querySelectorAll("text.siren-member")).map((t) => t.textContent),
    ).toEqual([
      "+int age",
      "+String gender",
      "#bool warmBlooded",
      "~String tag",
      "+isMammal() bool",
      "+mate(Animal partner) Animal",
    ]);
    expect(animal.querySelectorAll("line.siren-class-divider")).toHaveLength(2);

    const registryMembers = Array.from(
      result
        .svg!.querySelector('g.siren-class[data-siren-id="Registry"]')!
        .querySelectorAll("text.siren-member"),
    ).map((t) => t.textContent);
    expect(registryMembers).toEqual(["-int cachedCount$", "+lookup(String name) Animal$"]);

    // All eight Mermaid relationship kinds, over ten statements.
    const relationships = Array.from(
      result.svg!.querySelectorAll("g.siren-relationship"),
    );
    expect(relationships).toHaveLength(10);
    expect(
      new Set(relationships.map((g) => g.getAttribute("data-siren-relationship"))),
    ).toEqual(
      new Set([
        "inheritance",
        "realization",
        "composition",
        "aggregation",
        "association",
        "link",
        "dependency",
        "dashedLink",
      ]),
    );

    // The one relationship carrying both a label and multiplicity at each end.
    const cares = result.svg!.querySelector(
      'g.siren-relationship[data-siren-id="Keeper-Animal"]',
    )!;
    expect(
      cares.querySelector("text.siren-relationship-label")!.textContent,
    ).toBe("cares for");
    expect(
      Array.from(cares.querySelectorAll("text.siren-multiplicity")).map(
        (t) => t.textContent,
      ),
    ).toEqual(["1", "*"]);
  });

  it("renders demos/class-diagram.html's second example source (examples/class-structure.srn) end to end, drawing the namespace frame behind the class boxes it encloses, both annotations, the generic class name in angle brackets, and both notes", () => {
    const container = document.createElement("div");

    const result = render(readExample("class-structure"), container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.svg).not.toBeNull();
    expect(container.contains(result.svg!)).toBe(true);

    const classGroups = Array.from(result.svg!.querySelectorAll("g.siren-class"));
    expect(classGroups.map((g) => g.getAttribute("data-siren-id")).sort()).toEqual([
      "Circle",
      "Registry",
      "Renderer",
      "Shape",
      "Square",
    ]);

    // One namespace, addressed by the model's generated id, painted before
    // (behind) every class box so its frame cannot cover them.
    const namespaceGroups = Array.from(result.svg!.querySelectorAll("g.siren-namespace"));
    expect(namespaceGroups.map((g) => g.getAttribute("data-siren-id"))).toEqual([
      "namespace:1",
    ]);
    expect(namespaceGroups[0].querySelector("text.siren-namespace-label")!.textContent).toBe(
      "Shapes",
    );
    const painted = Array.from(result.svg!.querySelectorAll("g.siren-namespace, g.siren-class"));
    expect(painted[0]).toBe(namespaceGroups[0]);

    // The frame encloses each of its three member boxes, and none of the two
    // classes declared outside it.
    const box = (element: Element) => {
      const rect = element.querySelector("rect")!;
      const x = Number(rect.getAttribute("x"));
      const y = Number(rect.getAttribute("y"));
      return {
        left: x,
        top: y,
        right: x + Number(rect.getAttribute("width")),
        bottom: y + Number(rect.getAttribute("height")),
      };
    };
    const frame = box(namespaceGroups[0]);
    const encloses = (id: string) => {
      const inner = box(
        result.svg!.querySelector(`g.siren-class[data-siren-id="${id}"]`)!,
      );
      return (
        inner.left >= frame.left &&
        inner.top >= frame.top &&
        inner.right <= frame.right &&
        inner.bottom <= frame.bottom
      );
    };
    expect(["Shape", "Square", "Circle"].map(encloses)).toEqual([true, true, true]);
    expect(["Registry", "Renderer"].map(encloses)).toEqual([false, false]);

    // Annotations render in Mermaid's guillemets, alongside the class name.
    const shape = result.svg!.querySelector('g.siren-class[data-siren-id="Shape"]')!;
    expect(shape.querySelector("text.siren-class-annotation")!.textContent).toBe("«interface»");
    expect(shape.querySelector("text.siren-class-name")!.textContent).toBe("Shape");
    expect(
      result
        .svg!.querySelector('g.siren-class[data-siren-id="Renderer"]')!
        .querySelector("text.siren-class-annotation")!.textContent,
    ).toBe("«abstract»");
    // An unannotated class emits no annotation text at all.
    expect(
      result
        .svg!.querySelector('g.siren-class[data-siren-id="Square"]')!
        .querySelector("text.siren-class-annotation"),
    ).toBeNull();

    // The generic is part of the drawn name, in angle brackets; the id it is
    // addressed by stays the bare class name. Nested generics in a member's
    // type are converted by the same rule.
    const registry = result.svg!.querySelector('g.siren-class[data-siren-id="Registry"]')!;
    expect(registry.querySelector("text.siren-class-name")!.textContent).toBe("Registry<T>");
    expect(
      Array.from(registry.querySelectorAll("text.siren-member")).map((t) => t.textContent),
    ).toEqual([
      "-Map<String, List<T>> entries",
      "+register(String name, T item)",
      "+lookup(String name) T",
    ]);

    // Both notes, numbered by source order. The free one is a box on its own;
    // the attached one also draws a connector to the class it annotates.
    const noteGroups = Array.from(result.svg!.querySelectorAll("g.siren-note"));
    expect(noteGroups.map((g) => g.getAttribute("data-siren-id"))).toEqual([
      "note:1",
      "note:2",
    ]);
    expect(noteGroups.map((g) => g.querySelector("text.siren-note-text")!.textContent)).toEqual([
      "Every structural feature in one document",
      "One registry per shape kind",
    ]);
    expect(noteGroups[0].querySelector("path.siren-note-link")).toBeNull();
    expect(noteGroups[1].querySelector("path.siren-note-link")).not.toBeNull();
  });

  it("lays a classDiagram out left-to-right for `direction LR` — subclasses beside their parent rather than below it — where the same document without the statement stacks them top-to-bottom", () => {
    const body = `
Animal <|-- Duck
Animal <|-- Fish
`;
    const positions = (source: string) => {
      const container = document.createElement("div");
      const result = render(source, container);
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      const frames = new Map<string, { x: number; y: number }>();
      for (const group of Array.from(result.svg!.querySelectorAll("g.siren-class"))) {
        const rect = group.querySelector("rect.siren-class-frame")!;
        frames.set(group.getAttribute("data-siren-id")!, {
          x: Number(rect.getAttribute("x")),
          y: Number(rect.getAttribute("y")),
        });
      }
      return frames;
    };

    const topToBottom = positions(`classDiagram${body}`);
    const leftToRight = positions(`classDiagram\ndirection LR${body}`);

    // Default (TB): each subclass sits below Animal, all three on one column
    // band — the rank axis is vertical.
    expect(topToBottom.get("Duck")!.y).toBeGreaterThan(topToBottom.get("Animal")!.y);
    expect(topToBottom.get("Fish")!.y).toBeGreaterThan(topToBottom.get("Animal")!.y);

    // LR: the same edges now run along x instead — subclasses are to the
    // right of Animal and at the same rank, not below it.
    expect(leftToRight.get("Duck")!.x).toBeGreaterThan(leftToRight.get("Animal")!.x);
    expect(leftToRight.get("Fish")!.x).toBeGreaterThan(leftToRight.get("Animal")!.x);

    // The two axes swap roles: siblings share the rank coordinate and spread
    // along the cross axis, so TB puts Duck and Fish on one row and LR puts
    // them in one column.
    expect(topToBottom.get("Duck")!.y).toBe(topToBottom.get("Fish")!.y);
    expect(topToBottom.get("Duck")!.x).not.toBe(topToBottom.get("Fish")!.x);
    expect(leftToRight.get("Duck")!.x).toBe(leftToRight.get("Fish")!.x);
    expect(leftToRight.get("Duck")!.y).not.toBe(leftToRight.get("Fish")!.y);
  });

  it("surfaces the model's error diagnostic — without throwing, and still rendering the rest — for a classDiagram whose `note for` names a class that does not exist", () => {
    const container = document.createElement("div");
    // `Dcuk` is a typo for `Duck`: naming a class in a `note for` does not
    // declare it, so the note is dropped rather than conjuring a sixth box.
    const source = `classDiagram
Animal <|-- Duck
note for Dcuk "can fly, can swim"
note "the rest of the document still renders"
`;

    let result: SirenRenderResult | undefined;
    expect(() => {
      result = render(source, container);
    }).not.toThrow();

    expect(
      result!.diagnostics.some(
        (d) => d.severity === "error" && d.message.includes("Dcuk"),
      ),
    ).toBe(true);

    expect(result!.svg).not.toBeNull();
    expect(result!.svg!.querySelectorAll("g.siren-class")).toHaveLength(2);
    expect(result!.svg!.querySelectorAll("g.siren-relationship")).toHaveLength(1);
    // Only the surviving note is drawn, and it keeps the id its source
    // position gave it — dropping the first note does not renumber it.
    const notes = Array.from(result!.svg!.querySelectorAll("g.siren-note"));
    expect(notes.map((g) => g.getAttribute("data-siren-id"))).toEqual(["note:2"]);
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

  it("invokes options.onClick with the clicked class's id, callback name and literal argument when a real click lands inside a class the author gave a `call` interaction", () => {
    const container = document.createElement("div");
    const source = `classDiagram
Animal <|-- Duck
click Duck call showDetails("mallard") "Duck facts"
`;

    const clicks: InteractionTarget[] = [];
    const result = render(source, container, {
      onClick: (target) => clicks.push(target),
    });

    expect(result.diagnostics).toEqual([]);
    const duck = result.svg!.querySelector('g.siren-class[data-siren-id="Duck"]');
    expect(duck).not.toBeNull();

    // Clicked on the class *name*, not on the group: a reader aims at what
    // they can see, and the event has to reach the handler by bubbling out of
    // whichever child they hit.
    const name = duck!.querySelector("text.siren-class-name");
    expect(name).not.toBeNull();
    name!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(clicks).toEqual([
      { id: "Duck", action: "showDetails", argument: "mallard" },
    ]);
  });

  it("invokes onClick for no other click in the diagram — not on a class the author left alone, and not on one whose interaction is an href", () => {
    const container = document.createElement("div");
    const source = `classDiagram
Animal <|-- Duck
class Fish
click Duck call showDetails()
click Fish href "https://example.com/fish"
`;

    const clicks: InteractionTarget[] = [];
    const result = render(source, container, {
      onClick: (target) => clicks.push(target),
    });

    expect(result.diagnostics).toEqual([]);
    const classGroup = (id: string): Element => {
      const group = result.svg!.querySelector(`g.siren-class[data-siren-id="${id}"]`);
      if (group === null) throw new Error(`no rendered class ${id}`);
      return group;
    };

    // Animal is styled and hooked by nothing at all; Fish is a *link*, which
    // the browser navigates — reporting it as a callback would invite a host
    // to act on a click the reader already spent on going somewhere.
    classGroup("Animal").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    classGroup("Fish").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual([]);

    // The same document does still deliver the class that has a callback, so
    // this is a test about which clicks are reported, not a broken wiring.
    classGroup("Duck").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual([{ id: "Duck", action: "showDetails", argument: null }]);
  });

  it("renders byte-for-byte the same SVG with and without an onClick handler, and clicking a hooked class throws nothing when none was given", () => {
    const source = `classDiagram
Animal <|-- Duck
click Duck call showDetails("mallard")
`;

    const withHandler = document.createElement("div");
    render(source, withHandler, { onClick: () => {} });

    const withoutHandler = document.createElement("div");
    const result = render(source, withoutHandler);

    // The hook is markup either way: `render()` attaches a listener to it or
    // does not, and nothing about the document a consumer gets back changes.
    expect(sameDrawing(withoutHandler.innerHTML)).toBe(sameDrawing(withHandler.innerHTML));
    expect(
      result.svg!.querySelector('g.siren-class[data-siren-id="Duck"]')!
        .getAttribute("data-siren-click"),
    ).toBe("showDetails");

    expect(() => {
      result.svg!
        .querySelector('g.siren-class[data-siren-id="Duck"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }).not.toThrow();
  });

  it("carries an author's styling and interaction all the way to the DOM: inline style on the frame, an <a class=\"siren-link\"> around a linked class, and a tooltip as a <title>", () => {
    const container = document.createElement("div");
    const source = `classDiagram
Animal <|-- Duck
class Fish
style Duck fill:#fdd,stroke:#c00
click Fish href "https://example.com/fish" "Fish facts"
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);

    const duck = result.svg!.querySelector('g.siren-class[data-siren-id="Duck"]')!;
    expect(duck.querySelector("rect.siren-class-frame")!.getAttribute("style")).toBe(
      "fill:#fdd;stroke:#c00",
    );
    // An unstyled class is left without the attribute entirely, rather than
    // carrying an empty one.
    const animal = result.svg!.querySelector('g.siren-class[data-siren-id="Animal"]')!;
    expect(animal.querySelector("rect.siren-class-frame")!.getAttribute("style")).toBeNull();

    const fish = result.svg!.querySelector('g.siren-class[data-siren-id="Fish"]')!;
    const link = fish.parentElement;
    expect(link!.tagName).toBe("a");
    expect(link!.getAttribute("class")).toBe("siren-link");
    expect(link!.getAttribute("href")).toBe("https://example.com/fish");
    expect(fish.querySelector("title")!.textContent).toBe("Fish facts");
  });

  it("ignores `%%` comments in all three diagram kinds — whole-line, indented and trailing a line of real syntax — rendering the same diagram as the same document without them", () => {
    const commented = {
      flowchart: `%% a flowchart that counts
flowchart TD
  %% the first node
  A[Start] --> B[End] %% and the edge to it
`,
      sequence: `%% a sequence that counts
sequenceDiagram
  %% the caller
  participant Client %% trailing the declaration
  participant Server
  Client->>Server: Fetch %% trailing the message
`,
      class: `%% a class diagram that counts
classDiagram
  %% the base class
  Animal <|-- Duck %% trailing the relationship
`,
    };
    const uncommented = {
      flowchart: `flowchart TD
  A[Start] --> B[End]
`,
      sequence: `sequenceDiagram
  participant Client
  participant Server
  Client->>Server: Fetch
`,
      class: `classDiagram
  Animal <|-- Duck
`,
    };

    for (const kind of ["flowchart", "sequence", "class"] as const) {
      const withComments = document.createElement("div");
      const withoutComments = document.createElement("div");
      const commentedResult = render(commented[kind], withComments);
      const plainResult = render(uncommented[kind], withoutComments);

      expect([kind, commentedResult.diagnostics]).toEqual([kind, []]);
      expect([kind, plainResult.diagnostics]).toEqual([kind, []]);
      // The strongest statement available at this seam: a commented document
      // and its comment-free twin are the *same drawing*, so no comment text
      // survived into a label and no comment shifted the layout.
      expect([kind, sameDrawing(withComments.innerHTML)]).toEqual([
        kind,
        sameDrawing(withoutComments.innerHTML),
      ]);
      expect([kind, withComments.innerHTML.includes("counts")]).toEqual([kind, false]);
    }
  });

  it("reports the empty-document diagnostic, without throwing, for a document that is nothing but `%%` comments", () => {
    const container = document.createElement("div");
    const source = `%% classDiagram
%% Animal <|-- Duck
  %% nothing here is syntax
`;

    let result: SirenRenderResult | undefined;
    expect(() => {
      result = render(source, container);
    }).not.toThrow();

    expect(result!.svg).toBeNull();
    expect(result!.controller).toBeNull();
    expect(
      result!.diagnostics.some(
        (d) => d.severity === "error" && d.message.includes("Empty document"),
      ),
    ).toBe(true);
    expect(container.children).toHaveLength(0);
  });

  it("gives each of the eight relationship spellings its own line style and endpoint markers through render(), backed by four distinct <marker> defs whose two same-shaped diamonds are told apart by fill class", () => {
    // Expectations read off spec.md's relationship list, not off the
    // renderer: `{ line, decorated end }` per Mermaid spelling.
    const forms = [
      { statement: "Base <|-- Sub", type: "inheritance", dashed: false, start: "triangle", end: null },
      { statement: "Whole *-- Part", type: "composition", dashed: false, start: "diamondFilled", end: null },
      { statement: "Owner o-- Owned", type: "aggregation", dashed: false, start: "diamondHollow", end: null },
      { statement: "Source --> Target", type: "association", dashed: false, start: null, end: "arrow" },
      { statement: "Left -- Right", type: "link", dashed: false, start: null, end: null },
      { statement: "User ..> Used", type: "dependency", dashed: true, start: null, end: "arrow" },
      { statement: "Impl ..|> Iface", type: "realization", dashed: true, start: null, end: "triangle" },
      { statement: "One .. Two", type: "dashedLink", dashed: true, start: null, end: null },
    ] as const;

    const container = document.createElement("div");
    const source = `classDiagram\n${forms.map((f) => f.statement).join("\n")}\n`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const relationships = Array.from(result.svg!.querySelectorAll("g.siren-relationship"));
    expect(relationships).toHaveLength(8);

    // Which `<marker>` def each endpoint shape resolved to, learned from the
    // DOM rather than assumed, so the distinctness assertions below are about
    // the shapes and not about ids this test hard-coded.
    const markerIdByShape = new Map<string, string>();

    for (const form of forms) {
      const group = relationships.find(
        (g) => g.getAttribute("data-siren-relationship") === form.type,
      );
      expect([form.statement, group !== undefined]).toEqual([form.statement, true]);

      const line = group!.querySelector("path.siren-relationship-line")!;
      expect([form.statement, line.getAttribute("stroke-dasharray") !== null]).toEqual([
        form.statement,
        form.dashed,
      ]);

      for (const [attribute, shape] of [
        ["marker-start", form.start],
        ["marker-end", form.end],
      ] as const) {
        const reference = line.getAttribute(attribute);
        expect([form.statement, attribute, reference !== null]).toEqual([
          form.statement,
          attribute,
          shape !== null,
        ]);
        if (shape === null) continue;

        const markerId = reference!.replace(/^url\(#/, "").replace(/\)$/, "");
        // The def has to exist, or the endpoint silently draws nothing.
        expect([form.statement, result.svg!.querySelector(`defs marker#${markerId}`)]).not.toEqual(
          [form.statement, null],
        );
        const already = markerIdByShape.get(shape);
        if (already !== undefined) expect([shape, markerId]).toEqual([shape, already]);
        markerIdByShape.set(shape, markerId);
      }
    }

    // Four endpoint shapes, four distinct defs. Sharing one would make a
    // composition indistinguishable from an aggregation on screen.
    const shapes = ["triangle", "diamondFilled", "diamondHollow", "arrow"];
    expect(Array.from(markerIdByShape.keys()).sort()).toEqual([...shapes].sort());
    expect(new Set(markerIdByShape.values()).size).toBe(4);

    // The two diamonds are drawn from the same path shape on purpose, so the
    // *only* thing that separates a filled diamond from a hollow one is the
    // fill class the theme hangs its color off. Distinct ids alone would pass
    // while both rendered identically.
    const markerShapePath = (shape: string) =>
      result.svg!.querySelector(`defs marker#${markerIdByShape.get(shape)!} path`)!;
    expect(markerShapePath("diamondFilled").getAttribute("d")).toBe(
      markerShapePath("diamondHollow").getAttribute("d"),
    );
    expect(markerShapePath("diamondFilled").getAttribute("class")).not.toBe(
      markerShapePath("diamondHollow").getAttribute("class"),
    );
  });

  it("renders a label and both multiplicity strings on any relationship spelling, not only on the association it was first built for", () => {
    const container = document.createElement("div");
    // Multiplicity and a label on a decorated *from* end (composition) and on
    // a dashed one (dependency) — the two cases an implementation wired for
    // `A "1" --> "*" B` alone would miss.
    const source = `classDiagram
Fleet "1" *-- "0..*" Vehicle : owns
Report "*" ..> "1" Database : reads from
Plain -- Bare
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const textsOf = (id: string, selector: string) =>
      Array.from(
        result
          .svg!.querySelector(`g.siren-relationship[data-siren-id="${id}"]`)!
          .querySelectorAll(selector),
      ).map((t) => t.textContent);

    expect(textsOf("Fleet-Vehicle", "text.siren-relationship-label")).toEqual(["owns"]);
    expect(textsOf("Fleet-Vehicle", "text.siren-multiplicity")).toEqual(["1", "0..*"]);
    expect(textsOf("Report-Database", "text.siren-relationship-label")).toEqual(["reads from"]);
    expect(textsOf("Report-Database", "text.siren-multiplicity")).toEqual(["*", "1"]);

    // A relationship given neither renders neither, rather than empty <text>.
    expect(textsOf("Plain-Bare", "text.siren-relationship-label")).toEqual([]);
    expect(textsOf("Plain-Bare", "text.siren-multiplicity")).toEqual([]);
  });

  it("holds the href allowlist end to end: every disallowed URL spelling is dropped with an error diagnostic and reaches the DOM as no <a> at all, while the class itself still renders", () => {
    // One document per URL so a single rejection cannot be masked by another
    // statement's diagnostic, and so the "no <a> anywhere" check is total.
    const refused = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      // Scheme-relative: no scheme of its own, so it borrows the page's.
      '//evil.example/steal',
      '\\\\evil.example/steal',
      '/\\evil.example/steal',
    ];

    for (const url of refused) {
      const container = document.createElement("div");
      const source = `classDiagram\nAnimal <|-- Duck\nclick Duck href "${url}"\n`;

      const result = render(source, container);

      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect([url, errors.length]).toEqual([url, 1]);
      expect([url, errors[0].message.includes("Duck")]).toEqual([url, true]);

      // The interaction is gone, not merely inert: no link element, no href
      // attribute anywhere in the tree, and no click hook either.
      expect([url, result.svg!.querySelectorAll("a").length]).toEqual([url, 0]);
      expect([url, result.svg!.querySelectorAll("[href]").length]).toEqual([url, 0]);
      expect([url, result.svg!.querySelectorAll("[data-siren-click]").length]).toEqual([url, 0]);
      // Dropping the interaction drops only the interaction.
      expect([url, result.svg!.querySelectorAll("g.siren-class").length]).toEqual([url, 2]);
    }
  });

  it("still admits the URL forms the allowlist exists to allow — http, https, mailto and a relative path — writing each into the <a class=\"siren-link\"> href", () => {
    const allowed = [
      "https://example.com/duck",
      "http://example.com/duck",
      "mailto:keeper@example.com",
      "./docs/duck.html",
      "#duck",
    ];

    for (const url of allowed) {
      const container = document.createElement("div");
      const source = `classDiagram\nAnimal <|-- Duck\nclick Duck href "${url}"\n`;

      const result = render(source, container);

      expect([url, result.diagnostics]).toEqual([url, []]);
      const link = result.svg!.querySelector("a.siren-link");
      expect([url, link !== null]).toEqual([url, true]);
      expect([url, link!.getAttribute("href")]).toEqual([url, url]);
      expect([url, link!.querySelector('g.siren-class[data-siren-id="Duck"]') !== null]).toEqual([
        url,
        true,
      ]);
    }
  });

  it("puts a `link` statement's URL through the same allowlist as `click ... href`, rather than past it", () => {
    const good = document.createElement("div");
    const goodResult = render(
      `classDiagram\nAnimal <|-- Duck\nlink Duck "https://example.com/duck"\n`,
      good,
    );
    expect(goodResult.diagnostics).toEqual([]);
    expect(goodResult.svg!.querySelector("a.siren-link")!.getAttribute("href")).toBe(
      "https://example.com/duck",
    );

    const bad = document.createElement("div");
    const badResult = render(
      `classDiagram\nAnimal <|-- Duck\nlink Duck "javascript:alert(1)"\n`,
      bad,
    );
    expect(
      badResult.diagnostics.filter((d) => d.severity === "error").length,
    ).toBe(1);
    expect(badResult.svg!.querySelectorAll("a")).toHaveLength(0);
    expect(badResult.svg!.querySelectorAll("g.siren-class")).toHaveLength(2);
  });

  it("holds the style-value gate end to end: a refused value never reaches the inline style attribute, its siblings in the same statement still do, and each refusal is its own error diagnostic", () => {
    const container = document.createElement("div");
    // Every refused spelling in one statement per class, each paired with a
    // legitimate sibling declaration that must survive the rejection.
    const source = `classDiagram
class Fetches
class Executes
class Smuggles
class Escapes
Fetches -- Executes
Smuggles -- Escapes
style Fetches fill:url(#evil),stroke:#c00
style Executes fill:expression(alert(1)),stroke:#c00
style Smuggles fill:#fdd;position:fixed,stroke:#c00
style Escapes fill:u\\72 l(#evil),stroke:#c00
`;

    const result = render(source, container);

    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(4);

    const frameStyle = (id: string) =>
      result
        .svg!.querySelector(`g.siren-class[data-siren-id="${id}"] rect.siren-class-frame`)!
        .getAttribute("style");

    // Only the sibling survives, in each case.
    for (const id of ["Fetches", "Executes", "Smuggles", "Escapes"]) {
      expect([id, frameStyle(id)]).toEqual([id, "stroke:#c00"]);
    }

    // And nothing refused is anywhere in the serialized document, in any
    // attribute — the gate is about what the browser is handed, not about
    // which element it was handed on.
    const markup = container.innerHTML;
    for (const forbidden of ["url(", "expression(", "position:fixed", "\\"]) {
      expect([forbidden, markup.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it("carries `classDef` + `cssClass` through render() the same way a `style` statement is carried, with a later `style` overriding the declaration it shares", () => {
    const container = document.createElement("div");
    const source = `classDiagram
class Shape
class Square
class Circle
Square ..|> Shape
Circle ..|> Shape
classDef emphasis fill:#fdd,stroke:#c00
cssClass "Square,Circle" emphasis
style Circle fill:#dfd
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const frameStyle = (id: string) =>
      result
        .svg!.querySelector(`g.siren-class[data-siren-id="${id}"] rect.siren-class-frame`)!
        .getAttribute("style");

    expect(frameStyle("Square")).toBe("fill:#fdd;stroke:#c00");
    // A property declared twice keeps its first position and its last value.
    expect(frameStyle("Circle")).toBe("fill:#dfd;stroke:#c00");
    // A `classDef` applies to nothing on its own.
    expect(frameStyle("Shape")).toBeNull();
  });

  it("lands a class diagram's `color` on every label the class draws, as the `fill` that paints them", () => {
    // ADR-0008's amendment, landing. `fill:#111` darkens the box; before
    // this, the theme went on painting dark text on it and no directive
    // could say otherwise. The author writes `color` because that is what
    // Mermaid's `classDef` documents, and the label carries `fill` because
    // that is what paints SVG text — the translation is `resolveStyles`'.
    const svg = renderThemed(`classDiagram
class Animal {
  <<abstract>>
  +int age
}
class Duck
Duck --|> Animal
classDef highlight fill:#111,color:#fff
cssClass "Animal" highlight
`);

    const animal = svg.querySelector('g.siren-class[data-siren-id="Animal"]')!;
    // The frame keeps everything that is not a text property, unchanged.
    expect(animal.querySelector("rect.siren-class-frame")!.getAttribute("style")).toBe("fill:#111");

    // All three of the texts a class draws, which is all three `style` and
    // `classDef` can name: `buildRelationshipText` draws the labels and
    // cardinalities of a relationship, which no styling statement targets.
    for (const selector of [".siren-class-name", ".siren-class-annotation", ".siren-member"]) {
      const label = animal.querySelector(selector)!;
      expect([selector, label.getAttribute("style")]).toEqual([selector, "fill:#fff"]);

      // Not just which element carries the attribute: what it computes to.
      // This is the whole of the bug — an inline `color` on a `<text>` sits
      // in a different property and leaves the computed `fill` exactly where
      // the theme put it, so a renderer emitting the author's spelling
      // verbatim would pass an attribute check and change nothing drawn.
      //
      // Sound only in a pair: jsdom does not model `!important` at all, so
      // it over-prefers an inline declaration, and this assertion would keep
      // passing if the theme ever grew one. `theme/default.test.ts` asserts
      // separately that the stylesheet contains no `!important` — that is
      // the check with teeth, and this one states what it protects.
      expect([selector, getComputedStyle(label).fill]).toEqual([selector, "#fff"]);
    }

    // A class the `cssClass` did not name is left to the theme entirely.
    const duckName = svg.querySelector(
      'g.siren-class[data-siren-id="Duck"] .siren-class-name',
    )!;
    expect(duckName.getAttribute("style")).toBeNull();
  });

  it("accepts Mermaid's `classDiagram-v2` header alias, rendering the identical diagram the `classDiagram` spelling does", () => {
    const body = `
Animal <|-- Duck
class Duck {
  +quack() String
}
`;
    const v1 = document.createElement("div");
    const v2 = document.createElement("div");

    const v1Result = render(`classDiagram${body}`, v1);
    const v2Result = render(`classDiagram-v2${body}`, v2);

    expect(v1Result.diagnostics).toEqual([]);
    expect(v2Result.diagnostics).toEqual([]);
    expect(sameDrawing(v2.innerHTML)).toBe(sameDrawing(v1.innerHTML));
  });

  it("renders markup-looking member, annotation, note, relationship-label, multiplicity and tooltip text as literal visible text, never as parsed markup", () => {
    const container = document.createElement("div");
    const injected = `<script>alert(1)</script>`;
    // A namespace label is deliberately absent from this list: `namespace \w+`
    // is the whole grammar, so a namespace name cannot spell markup in the
    // first place. Every *other* free-text position in a classDiagram is here.
    const source = `classDiagram
class Sneaky {
  <<${injected}>>
  +<b>bold</b> field
}
class Plain
Sneaky "<i>1</i>" --> "<i>*</i>" Plain : <svg onload=alert(1)>
note for Plain "<iframe src=javascript:alert(1)></iframe>"
click Sneaky call inspect() "<b>tooltip</b>"
`;

    const result = render(source, container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // Not one element of the injected markup exists as an element: every
    // author string went in through textContent, so it is text.
    for (const tag of ["script", "img", "b", "i", "svg", "iframe"]) {
      expect([tag, result.svg!.querySelectorAll(tag).length]).toEqual([tag, 0]);
    }

    const textOf = (selector: string) => result.svg!.querySelector(selector)!.textContent;
    expect(textOf("text.siren-class-annotation")).toBe(`«${injected}»`);
    expect(textOf("text.siren-member")).toBe("+<b>bold</b> field");
    expect(textOf("text.siren-relationship-label")).toBe("<svg onload=alert(1)>");
    expect(textOf("text.siren-note-text")).toBe("<iframe src=javascript:alert(1)></iframe>");
    expect(textOf("title")).toBe("<b>tooltip</b>");
    expect(
      Array.from(result.svg!.querySelectorAll("text.siren-multiplicity")).map((t) => t.textContent),
    ).toEqual(["<i>1</i>", "<i>*</i>"]);
  });

  it("renders demos/class-diagram.html's comprehensive example source (examples/class-full.srn) end to end with zero diagnostics — every declaration form, member form, annotation, generic, namespace, both notes, all eight relationship kinds, an interaction and an author style, in one document", () => {
    const container = document.createElement("div");
    const clicks: InteractionTarget[] = [];

    const result = render(readExample("class-full"), container, {
      onClick: (target) => clicks.push(target),
    });

    // Zero diagnostics of any severity: the closing example is the document
    // the demo page ships, so anything it makes the pipeline complain about
    // is a defect in one or the other.
    expect(result.diagnostics).toEqual([]);
    expect(container.contains(result.svg!)).toBe(true);

    // --- declarations: block, bare, inline, and implicit-from-relationship ---
    const classIds = Array.from(result.svg!.querySelectorAll("g.siren-class"))
      .map((g) => g.getAttribute("data-siren-id"))
      .sort();
    expect(classIds).toEqual([
      // Artwork is named only by two relationships; Listener only by inline
      // members; Player only by a bare `class Player`.
      "Artwork",
      "Listener",
      "Media",
      "Playable",
      "Player",
      "Podcast",
      "Shelf",
      "Track",
    ]);

    const classGroup = (id: string) =>
      result.svg!.querySelector(`g.siren-class[data-siren-id="${id}"]`)!;
    const membersOf = (id: string) =>
      Array.from(classGroup(id).querySelectorAll("text.siren-member")).map((t) => t.textContent);

    // --- members: all four visibility markers, both classifiers, types,
    // parameter lists and return types, verbatim and in declaration order ---
    expect(membersOf("Media")).toEqual([
      "+String title",
      "#int durationInSeconds",
      "-bool licensed",
      "~String catalogKey",
      "+play()*",
      "+describe() String",
    ]);
    expect(classGroup("Media").querySelectorAll("line.siren-class-divider")).toHaveLength(2);
    expect(membersOf("Listener")).toEqual([
      "+String name",
      "+rate(Media item, int stars) bool",
    ]);
    // A bare `class Player` has no members, so no compartment and no divider.
    expect(membersOf("Player")).toEqual([]);
    expect(classGroup("Player").querySelectorAll("line.siren-class-divider")).toHaveLength(0);

    // --- generics: angle brackets in the drawn name and in a nested member type ---
    expect(classGroup("Shelf").querySelector("text.siren-class-name")!.textContent).toBe(
      "Shelf<T>",
    );
    expect(membersOf("Shelf")).toEqual([
      "-Map<String, List<T>> byGenre",
      "-int loadedCount$",
      "+add(String genre, T item)",
      "+find(String genre) List<T>",
      "+clear()$",
    ]);

    // --- annotations ---
    expect(classGroup("Media").querySelector("text.siren-class-annotation")!.textContent).toBe(
      "«abstract»",
    );
    expect(classGroup("Playable").querySelector("text.siren-class-annotation")!.textContent).toBe(
      "«interface»",
    );
    expect(classGroup("Track").querySelector("text.siren-class-annotation")).toBeNull();

    // --- namespace: one frame, painted first, enclosing exactly its members ---
    const namespaceGroup = result.svg!.querySelector("g.siren-namespace")!;
    expect(namespaceGroup.getAttribute("data-siren-id")).toBe("namespace:1");
    expect(namespaceGroup.querySelector("text.siren-namespace-label")!.textContent).toBe("catalog");
    expect(
      Array.from(result.svg!.querySelectorAll("g.siren-namespace, g.siren-class"))[0],
    ).toBe(namespaceGroup);
    const box = (element: Element) => {
      const rect = element.querySelector("rect")!;
      const x = Number(rect.getAttribute("x"));
      const y = Number(rect.getAttribute("y"));
      return {
        left: x,
        top: y,
        right: x + Number(rect.getAttribute("width")),
        bottom: y + Number(rect.getAttribute("height")),
      };
    };
    const frame = box(namespaceGroup);
    const encloses = (id: string) => {
      const inner = box(classGroup(id));
      return (
        inner.left >= frame.left &&
        inner.top >= frame.top &&
        inner.right <= frame.right &&
        inner.bottom <= frame.bottom
      );
    };
    expect(["Media", "Track", "Podcast"].map(encloses)).toEqual([true, true, true]);
    expect(["Playable", "Shelf", "Player", "Listener", "Artwork"].map(encloses)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);

    // --- relationships: nine statements covering all eight kinds ---
    const relationships = Array.from(result.svg!.querySelectorAll("g.siren-relationship"));
    expect(relationships.map((g) => g.getAttribute("data-siren-id"))).toEqual([
      "Media-Track",
      "Media-Podcast",
      "Track-Playable",
      "Shelf-Media",
      "Media-Artwork",
      "Listener-Media",
      "Listener-Player",
      "Player-Shelf",
      "Artwork-Player",
    ]);
    expect(
      new Set(relationships.map((g) => g.getAttribute("data-siren-relationship"))),
    ).toEqual(
      new Set([
        "inheritance",
        "realization",
        "composition",
        "aggregation",
        "association",
        "link",
        "dependency",
        "dashedLink",
      ]),
    );
    // Both of the two relationships that carry a label and multiplicity —
    // one on a decorated from-end (composition), one on a to-end (association).
    const textsOf = (id: string, selector: string) =>
      Array.from(
        result
          .svg!.querySelector(`g.siren-relationship[data-siren-id="${id}"]`)!
          .querySelectorAll(selector),
      ).map((t) => t.textContent);
    expect(textsOf("Shelf-Media", "text.siren-relationship-label")).toEqual(["holds"]);
    expect(textsOf("Shelf-Media", "text.siren-multiplicity")).toEqual(["1", "0..*"]);
    expect(textsOf("Listener-Media", "text.siren-relationship-label")).toEqual(["rates"]);
    expect(textsOf("Listener-Media", "text.siren-multiplicity")).toEqual(["1", "0..*"]);

    // --- notes: free one has no connector, attached one does ---
    const notes = Array.from(result.svg!.querySelectorAll("g.siren-note"));
    expect(notes.map((g) => g.getAttribute("data-siren-id"))).toEqual(["note:1", "note:2"]);
    expect(notes.map((g) => g.querySelector("text.siren-note-text")!.textContent)).toEqual([
      "Every class-diagram feature Siren draws, in one document",
      "One shelf per media kind",
    ]);
    expect(notes[0].querySelector("path.siren-note-link")).toBeNull();
    expect(notes[1].querySelector("path.siren-note-link")).not.toBeNull();

    // --- direction LR: the realization runs along x, so the interface it
    // points at is to the right of the class implementing it ---
    const frameX = (id: string) =>
      Number(classGroup(id).querySelector("rect.siren-class-frame")!.getAttribute("x"));
    expect(frameX("Playable")).toBeGreaterThan(frameX("Track"));

    // --- interaction: one callback, one link, each with its tooltip ---
    expect(classGroup("Track").getAttribute("data-siren-click")).toBe("showDetails");
    expect(classGroup("Track").getAttribute("data-siren-click-arg")).toBe("track");
    expect(classGroup("Track").querySelector("title")!.textContent).toBe("Inspect this class");
    const link = classGroup("Playable").parentElement!;
    expect(link.tagName).toBe("a");
    expect(link.getAttribute("class")).toBe("siren-link");
    expect(link.getAttribute("href")).toBe("https://mermaid.js.org/syntax/classDiagram.html");
    classGroup("Track").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual([{ id: "Track", action: "showDetails", argument: "track" }]);

    // --- author styling: `style` on one class, `classDef` + `cssClass` on two ---
    const frameStyle = (id: string) =>
      classGroup(id).querySelector("rect.siren-class-frame")!.getAttribute("style");
    expect(frameStyle("Track")).toBe("fill:#f59e0b33;stroke:#f59e0b;stroke-width:2");
    expect(frameStyle("Player")).toBe("fill:#3b82f633;stroke:#3b82f6;stroke-width:2");
    // Applied to a class that only ever existed implicitly, too.
    expect(frameStyle("Artwork")).toBe("fill:#3b82f633;stroke:#3b82f6;stroke-width:2");
    expect(frameStyle("Media")).toBeNull();

    // --- `%%` comments: neither the header comment nor the trailing one
    // survives anywhere in the drawing ---
    expect(container.innerHTML).not.toContain("%%");
    expect(container.innerHTML).not.toContain("without either endpoint marker");
  });

  it("drives examples/class-full.srn's timeline through all four addressable kinds — a class, a relationship, the namespace and a note — with next(), prev() and reset()", () => {
    const container = document.createElement("div");
    const result = render(readExample("class-full"), container);

    expect(result.diagnostics).toEqual([]);
    const controller = result.controller!;
    expect(controller.totalSteps).toBe(7);

    const pendingIds = () =>
      Array.from(result.svg!.querySelectorAll(".siren-pending"))
        .map((el) => el.getAttribute("data-siren-id"))
        .sort();

    // Exactly the eight elements with an `enter` action start hidden, across
    // all four kinds an author can address. The free note (`note:1`) and
    // every class with no `enter` are visible from the start.
    expect(pendingIds()).toEqual([
      "Media-Podcast",
      "Media-Track",
      "Playable",
      "Podcast",
      "Track",
      "Track-Playable",
      "namespace:1",
      "note:2",
    ]);

    const namespaceGroup = result.svg!.querySelector('g.siren-namespace[data-siren-id="namespace:1"]')!;
    const attachedNote = result.svg!.querySelector('g.siren-note[data-siren-id="note:2"]')!;
    const freeNote = result.svg!.querySelector('g.siren-note[data-siren-id="note:1"]')!;
    const track = result.svg!.querySelector('g.siren-class[data-siren-id="Track"]')!;
    const shelf = result.svg!.querySelector('g.siren-class[data-siren-id="Shelf"]')!;
    const rates = result.svg!.querySelector(
      'g.siren-relationship[data-siren-id="Listener-Media"]',
    )!;

    expect(freeNote.classList.contains("siren-pending")).toBe(false);

    // Step 1: the namespace frame — an element that is neither a class nor a
    // relationship — enters on its own.
    controller.next();
    expect(namespaceGroup.classList.contains("siren-pending")).toBe(false);
    expect(namespaceGroup.classList.contains("siren-enter-fade")).toBe(true);
    expect(track.classList.contains("siren-pending")).toBe(true);

    // Step 2: a class, with a directional slide.
    controller.next();
    expect(track.classList.contains("siren-pending")).toBe(false);
    expect(track.classList.contains("siren-enter-slide-top")).toBe(true);

    controller.next(); // step 3 — the two inheritance relationships
    controller.next(); // step 4 — Playable and its realization

    // Step 5: a note enters, and a never-hidden class is highlighted.
    controller.next();
    expect(attachedNote.classList.contains("siren-pending")).toBe(false);
    expect(attachedNote.classList.contains("siren-enter-fade")).toBe(true);
    expect(shelf.classList.contains("siren-highlight-outline")).toBe(true);

    // Step 6: a relationship highlight, and the class highlight lifted.
    controller.next();
    expect(rates.classList.contains("siren-highlight-glow")).toBe(true);
    expect(shelf.classList.contains("siren-highlight-outline")).toBe(false);

    // Step 7: the note exits.
    controller.next();
    expect(controller.currentStep).toBe(7);
    expect(attachedNote.classList.contains("siren-exit-slide-right")).toBe(true);
    expect(rates.classList.contains("siren-highlight-glow")).toBe(false);

    // Stepping back undoes exactly the last step.
    controller.prev();
    expect(attachedNote.classList.contains("siren-exit-slide-right")).toBe(false);
    expect(rates.classList.contains("siren-highlight-glow")).toBe(true);

    // And reset returns every one of the four kinds to its initial state.
    controller.reset();
    expect(controller.currentStep).toBe(0);
    expect(pendingIds()).toEqual([
      "Media-Podcast",
      "Media-Track",
      "Playable",
      "Podcast",
      "Track",
      "Track-Playable",
      "namespace:1",
      "note:2",
    ]);
    expect(rates.classList.contains("siren-highlight-glow")).toBe(false);
    expect(shelf.classList.contains("siren-highlight-outline")).toBe(false);
  });
  it("returns a controller with totalSteps 0 — not null — for a sequenceDiagram with no timeline block", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant A
participant B
A->>B: Hello
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    // The same thing a flowchart with no timeline block returns: a working
    // controller that has nowhere to go, rather than no controller at all.
    expect(result.controller).not.toBeNull();
    expect(result.controller!.totalSteps).toBe(0);
    expect(result.controller!.currentStep).toBe(0);
  });

  it("drives every element carrying a sequence participant's id — both participant rows and the lifeline — from one timeline entry", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant A
participant B
A->>B: Hello
timeline:
  step 1: enter A fade
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const controller = result.controller!;
    expect(controller.totalSteps).toBe(1);

    // A is preamble-declared and never destroyed, so it is drawn three
    // times under one id: top-row box, bottom-row box, lifeline. The count
    // is asserted so a regression to first-match-only fails here.
    const elementsForA = () =>
      Array.from(result.svg!.querySelectorAll('[data-siren-id="A"]'));
    expect(elementsForA()).toHaveLength(3);
    expect(
      elementsForA().map((el) => el.classList.contains("siren-pending")),
    ).toEqual([true, true, true]);

    controller.next();

    expect(elementsForA()).toHaveLength(3);
    expect(
      elementsForA().map((el) => el.classList.contains("siren-enter-fade")),
    ).toEqual([true, true, true]);
    expect(
      elementsForA().map((el) => el.classList.contains("siren-pending")),
    ).toEqual([false, false, false]);

    // B was never named by the timeline, so it stays untouched throughout.
    for (const el of Array.from(result.svg!.querySelectorAll('[data-siren-id="B"]'))) {
      expect(el.classList.contains("siren-pending")).toBe(false);
      expect(el.classList.contains("siren-enter-fade")).toBe(false);
    }
  });

  it("keeps a message that outlives an exited participant purely advisory: the warning is a warning, the SVG and controller still work, and the exit still applies", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant A
participant B
A->>B: Hello
timeline:
  step 1: exit A fade
`;

    const result = render(source, container);

    // Advisory, not fatal: severity "warning", and no error alongside it.
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        message:
          'timeline: message "A-B" remains visible after its endpoint "A" exits at step 1 — ' +
          'add "exit A-B ..." at or before step 1',
      },
    ]);

    // The document still renders and still animates.
    expect(result.svg).not.toBeNull();
    expect(container.firstChild).toBe(result.svg);
    const controller = result.controller!;
    expect(controller.totalSteps).toBe(1);

    const elementsForA = () =>
      Array.from(result.svg!.querySelectorAll('[data-siren-id="A"]'));
    const message = result.svg!.querySelector('[data-siren-id="A-B"]')!;
    // A is preamble-declared and never destroyed: top-row box, bottom-row
    // box, lifeline.
    expect(elementsForA()).toHaveLength(3);
    expect(message).not.toBeNull();

    controller.next();

    // The exit still applies, to every element wearing A's id.
    expect(
      elementsForA().map((el) => el.classList.contains("siren-exit-fade")),
    ).toEqual([true, true, true]);
    // And the message is left exactly as drawn — which is the defect the
    // warning exists to describe, not one this package repairs.
    expect(message.classList.contains("siren-exit-fade")).toBe(false);
    expect(message.classList.contains("siren-pending")).toBe(false);

    controller.reset();
    expect(controller.currentStep).toBe(0);
    expect(
      elementsForA().map((el) => el.classList.contains("siren-exit-fade")),
    ).toEqual([false, false, false]);
  });

  it("reaches a destroyed participant's destroy mark too, since the mark carries the participant's id", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant A
participant B
A->>B: Hello
destroy B
timeline:
  step 1: highlight B outline
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const controller = result.controller!;

    // B is destroyed, so it has no bottom-row box: its top-row box, its
    // lifeline, and its destroy mark are the three elements wearing its id.
    const elementsForB = () =>
      Array.from(result.svg!.querySelectorAll('[data-siren-id="B"]'));
    expect(elementsForB()).toHaveLength(3);
    expect(
      result.svg!.querySelectorAll('path.siren-destroy-mark[data-siren-id="B"]'),
    ).toHaveLength(1);

    controller.next();

    expect(
      elementsForB().map((el) => el.classList.contains("siren-highlight-outline")),
    ).toEqual([true, true, true]);
  });

  it("fades a box grouping's background band from `enter box:1 fade`, without touching the participants it groups — they are siblings of the tagged group, not children", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
box Blue Storefront
  participant A
  participant B
end
A->>B: Hello
timeline:
  step 1: enter box:1 fade
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const controller = result.controller!;
    expect(controller.totalSteps).toBe(1);

    const boxElements = Array.from(result.svg!.querySelectorAll('[data-siren-id="box:1"]'));
    expect(boxElements).toHaveLength(1);
    const boxGroup = boxElements[0]!;
    expect(boxGroup.classList.contains("siren-box")).toBe(true);
    expect(boxGroup.classList.contains("siren-pending")).toBe(true);

    controller.next();

    expect(boxGroup.classList.contains("siren-enter-fade")).toBe(true);
    expect(boxGroup.classList.contains("siren-pending")).toBe(false);

    // The band and the label are inside the tagged group and carry no id of
    // their own, so they move with the box rather than being driven
    // separately — asserted as the renderer actually builds it.
    expect(boxGroup.querySelectorAll("rect.siren-box-background")).toHaveLength(1);
    const label = boxGroup.querySelector("text.siren-box-label")!;
    // `box Blue Storefront` splits into colour `Blue` and label
    // `Storefront` — the parser's existing rule, untouched here.
    expect(label.textContent).toBe("Storefront");
    expect(label.getAttribute("data-siren-id")).toBeNull();

    // The grouped participants are drawn beside the band, not within it, so
    // `enter box:1` leaves them alone.
    expect(boxGroup.querySelector('[data-siren-id="A"]')).toBeNull();
    for (const el of Array.from(result.svg!.querySelectorAll('[data-siren-id="A"]'))) {
      expect(el.classList.contains("siren-enter-fade")).toBe(false);
      expect(el.classList.contains("siren-pending")).toBe(false);
    }
  });

  it("outlines a control-flow block's frame from `highlight loop:1 outline`, carrying its label and dividers with it, while a nested block and message keep their own ids and their own classes", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant A
participant B
loop retry
  alt ok
    A->>B: yes
  else no
    B->>A: no
  end
end
timeline:
  step 1: highlight loop:1 outline
  step 2: highlight alt:1 glow
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const controller = result.controller!;
    expect(controller.totalSteps).toBe(2);

    const loopElements = Array.from(result.svg!.querySelectorAll('[data-siren-id="loop:1"]'));
    expect(loopElements).toHaveLength(1);
    const loopGroup = loopElements[0]!;
    const altGroup = result.svg!.querySelector('[data-siren-id="alt:1"]')!;
    const messageGroup = result.svg!.querySelector('[data-siren-id="A-B"]')!;

    // The renderer nests children inside their block's group, so the alt and
    // the message live inside the loop's tagged group while still wearing
    // ids of their own.
    expect(loopGroup.contains(altGroup)).toBe(true);
    expect(altGroup.contains(messageGroup)).toBe(true);

    controller.next();

    expect(loopGroup.classList.contains("siren-highlight-outline")).toBe(true);
    // The loop's own frame and header label are inside the tagged group and
    // hold no id, so they animate with it.
    expect(loopGroup.querySelectorAll("rect.siren-block-frame").length).toBeGreaterThan(0);
    expect(loopGroup.querySelector("text.siren-block-label")!.textContent).toBe("retry");
    // Having an id of its own is what makes an element separately driven:
    // the nested alt and message are inside the loop's group but do not take
    // the loop's class.
    expect(altGroup.classList.contains("siren-highlight-outline")).toBe(false);
    expect(messageGroup.classList.contains("siren-highlight-outline")).toBe(false);

    controller.next();

    expect(altGroup.classList.contains("siren-highlight-glow")).toBe(true);
    // The `else` divider is the alt's own, inside the alt's tagged group and
    // unlabelled by any id, so it rides along with `alt:1`.
    const dividers = Array.from(altGroup.querySelectorAll("line.siren-block-divider"));
    expect(dividers).toHaveLength(1);
    expect(dividers[0]!.getAttribute("data-siren-id")).toBeNull();
    expect(dividers[0]!.classList.contains("siren-highlight-glow")).toBe(false);
  });


  it("drives examples/sequence-full.srn's timeline through all four addressable kinds — a box grouping, a message, a control-flow block and a participant — with zero diagnostics, next(), prev() and reset()", () => {
    const container = document.createElement("div");
    const source = readExample("sequence-full");

    // Drift guard: the source above is read from examples/sequence-full.srn
    // on disk, not from an inline copy, so editing the example changes what
    // this test renders. The marker is the example's own final timeline step.
    expect(source).toContain("step 7: exit box:1 fade");

    const result = render(source, container);

    // Zero diagnostics, not merely zero errors: the closing example has to be
    // clean against the advisory message-outlives-its-participant warning too,
    // which is why `Retry` and the one message touching it exit together.
    expect(result.diagnostics).toEqual([]);
    const controller = result.controller!;
    expect(controller.totalSteps).toBe(7);

    const pendingIds = () =>
      Array.from(result.svg!.querySelectorAll(".siren-pending"))
        .map((el) => el.getAttribute("data-siren-id"))
        .sort();

    // Everything with an `enter` starts hidden. `Retry` is listed three times
    // because a created-then-destroyed participant is drawn three times under
    // one id — top-row box, lifeline, destroy mark — and all three are driven
    // by its single timeline entry (ADR-0009).
    expect(pendingIds()).toEqual([
      "Retry",
      "Retry",
      "Retry",
      "Shopper-Web",
      "Web-Retry",
      "box:1",
    ]);

    const boxGroup = result.svg!.querySelector('[data-siren-id="box:1"]')!;
    const openCheckout = result.svg!.querySelector('g.siren-message[data-siren-id="Shopper-Web"]')!;
    const createDraft = result.svg!.querySelector('g.siren-message[data-siren-id="Web-Orders"]')!;
    const loopBlock = result.svg!.querySelector('[data-siren-id="loop:1"]')!;
    const rectBlock = result.svg!.querySelector('[data-siren-id="rect:1"]')!;
    const scheduleRetry = result.svg!.querySelector('g.siren-message[data-siren-id="Web-Retry"]')!;
    const retryElements = () => Array.from(result.svg!.querySelectorAll('[data-siren-id="Retry"]'));
    expect(retryElements()).toHaveLength(3);

    // Step 1: the box grouping's band and the first arrow.
    controller.next();
    expect(boxGroup.classList.contains("siren-pending")).toBe(false);
    expect(boxGroup.classList.contains("siren-enter-fade")).toBe(true);
    expect(openCheckout.classList.contains("siren-enter-slide-left")).toBe(true);

    // Step 2: a message highlight on an arrow that was never hidden.
    controller.next();
    expect(createDraft.classList.contains("siren-highlight-glow")).toBe(true);

    // Step 3: that highlight lifted, and a control-flow block outlined.
    controller.next();
    expect(createDraft.classList.contains("siren-highlight-glow")).toBe(false);
    expect(loopBlock.classList.contains("siren-highlight-outline")).toBe(true);

    // Step 4: a participant enters — every element wearing its id at once.
    controller.next();
    expect(retryElements().map((el) => el.classList.contains("siren-enter-slide-top"))).toEqual([
      true,
      true,
      true,
    ]);
    expect(retryElements().map((el) => el.classList.contains("siren-pending"))).toEqual([
      false,
      false,
      false,
    ]);
    expect(scheduleRetry.classList.contains("siren-enter-slide-bottom")).toBe(true);

    // Step 5: the participant leaves, and the one message touching it leaves
    // with it — the pairing that keeps this example warning-free.
    controller.next();
    expect(retryElements().map((el) => el.classList.contains("siren-exit-slide-top"))).toEqual([
      true,
      true,
      true,
    ]);
    expect(scheduleRetry.classList.contains("siren-exit-slide-right")).toBe(true);

    // Step 6: the loop's outline lifted, the rect block's raised.
    controller.next();
    expect(loopBlock.classList.contains("siren-highlight-outline")).toBe(false);
    expect(rectBlock.classList.contains("siren-highlight-outline")).toBe(true);

    // Step 7: the box grouping exits.
    controller.next();
    expect(controller.currentStep).toBe(7);
    expect(boxGroup.classList.contains("siren-exit-fade")).toBe(true);

    // Stepping back undoes exactly the last step.
    controller.prev();
    expect(boxGroup.classList.contains("siren-exit-fade")).toBe(false);
    expect(rectBlock.classList.contains("siren-highlight-outline")).toBe(true);

    // And reset returns all four kinds to their initial state.
    controller.reset();
    expect(controller.currentStep).toBe(0);
    expect(pendingIds()).toEqual([
      "Retry",
      "Retry",
      "Retry",
      "Shopper-Web",
      "Web-Retry",
      "box:1",
    ]);
    expect(loopBlock.classList.contains("siren-highlight-outline")).toBe(false);
    expect(rectBlock.classList.contains("siren-highlight-outline")).toBe(false);
  });

  it("draws `A{Is it ready?}` end to end as a styleable, animatable diamond", () => {
    // The whole vertical slice through one public call: the brace spelling
    // parses, the box is sized so the label fits inside the diamond, the
    // diamond is drawn, and the two things a rectangle already had — an
    // author's `style` and a place on the timeline — reach it unchanged.
    //
    // Together they are what makes this a shape rather than an attribute.
    // Any one of them alone would leave a document Mermaid draws correctly
    // being drawn wrongly here.
    const container = document.createElement("div");
    const source = `flowchart TD
A{Is it ready?} --> B[Ship it]
style A fill:#f00
timeline:
step 1: enter A fade
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);

    const group = result.svg!.querySelector('g.siren-node[data-siren-id="A"]')!;
    const frame = group.querySelector(".siren-node-frame")!;

    // Drawn as a diamond, and said to be one.
    expect(frame.tagName).toBe("path");
    expect(group.getAttribute("data-siren-shape")).toBe("rhombus");
    // The braces were syntax, so the label is the text between them.
    expect(group.querySelector("text")!.textContent).toBe("Is it ready?");

    // The label fits *inside* the diamond, which is only true because
    // layout asked the shape how much box it needed. Read off the drawn
    // path so the claim is about the picture: the four vertices are the
    // midpoints of the node's box, and the default measurer's label box
    // (8px per character plus 16px padding, 24px plus 8px tall) sits inside
    // the diamond they describe.
    const vertices = frame
      .getAttribute("d")!
      .match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g)!
      .map((pair) => pair.split(",").map(Number));
    const xs = vertices.map(([x]) => x);
    const ys = vertices.map(([, y]) => y);
    const boxWidth = Math.max(...xs) - Math.min(...xs);
    const boxHeight = Math.max(...ys) - Math.min(...ys);
    const label = { width: "Is it ready?".length * 8 + 16, height: 24 + 8 };
    expect(label.width / boxWidth + label.height / boxHeight).toBeLessThanOrEqual(1);

    // ADR-0008's placement, unchanged by the element under it.
    expect(frame.getAttribute("style")).toBe("fill:#f00");

    // And it animates: the id and the animation classes are on the `<g>`,
    // so the controller drives a diamond without knowing shapes exist — and
    // the author's declaration is on a different element, so neither
    // overwrites the other.
    expect(group.classList.contains("siren-pending")).toBe(true);
    result.controller!.next();
    expect(group.classList.contains("siren-pending")).toBe(false);
    expect(group.classList.contains("siren-enter-fade")).toBe(true);
    expect(frame.getAttribute("style")).toBe("fill:#f00");
  });

  /**
   * One closed outline's vertices as a cycle with a canonical starting point
   * and direction, so two paths drawing the same figure compare equal
   * however each was written. A polygon has no first vertex and no preferred
   * winding — both are the path builder's private choice — so a test that
   * pinned them would fail on a rewrite that drew exactly the same picture.
   */
  const canonicalCycle = (names: readonly string[]): string[] => {
    const rotations = (list: readonly string[]): string[][] =>
      list.map((_, i) => [...list.slice(i), ...list.slice(0, i)]);
    return [...rotations(names), ...rotations([...names].reverse())].sort((a, b) =>
      a.join("|") < b.join("|") ? -1 : 1,
    )[0];
  };

  /**
   * The outline a node's frame draws, as the cycle of positions its vertices
   * occupy **inside the node's own bounding box** — `left,top`,
   * `right,mid`, `in-left,bottom`. `in-left` is strictly between the left
   * edge and the middle; `in-right` strictly between the middle and the
   * right edge.
   *
   * Positions rather than numbers, because the board's decision 1 makes a
   * shape's *kind* the compatibility contract and its proportions Siren's
   * own: how far a parallelogram leans belongs to the theme, and which way
   * it leans is the shape. A test written in coordinates would fail the day
   * the theme changed a number nobody ever promised, and would still pass a
   * parallelogram that leaned the wrong way by the promised amount.
   */
  const outlineCycle = (frame: Element): string[] => {
    const points = (frame.getAttribute("d") ?? "")
      .match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g)!
      .map((pair) => pair.split(",").map(Number));
    const position = (value: number, all: number[], low: string, high: string): string => {
      const min = Math.min(...all);
      const max = Math.max(...all);
      const middle = (min + max) / 2;
      if (value === min) return low;
      if (value === max) return high;
      if (value === middle) return "mid";
      return value < middle ? `in-${low}` : `in-${high}`;
    };
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return canonicalCycle(
      points.map(
        ([x, y]) => `${position(x, xs, "left", "right")},${position(y, ys, "top", "bottom")}`,
      ),
    );
  };

  /**
   * The six spellings drawn as a `<path>` of straight segments, each with
   * the outline **Mermaid** draws for it — read off mermaid 11.17.2's own
   * polygon vertices (`hexagon`, `lean_right`, `lean_left`, `trapezoid`,
   * `inv_trapezoid`, `rect_left_inv_arrow` in its shape sources) and
   * translated into positions, with `pnpm --filter @siren/core probe`
   * confirming which of those shapes each spelling names. Measured, not
   * remembered — the rule this repo's compatibility work runs on, and the
   * one thing ticket 02 was required to do and left no record of.
   *
   * The rhombus is not here: it is ticket 01's, and it already has a test of
   * its own above.
   */
  const PATH_SHAPES = [
    {
      shape: "hexagon",
      spelling: "A{{Hexagon}}",
      label: "Hexagon",
      // Flat top and bottom, inset equally at both ends, with a point at
      // mid-height on each side.
      outline: [
        "in-left,bottom",
        "in-right,bottom",
        "right,mid",
        "in-right,top",
        "in-left,top",
        "left,mid",
      ],
    },
    {
      shape: "parallelogram",
      spelling: "A[/Parallelogram/]",
      label: "Parallelogram",
      // Mermaid's `lean_right`: the top edge sits to the right of the
      // bottom one.
      outline: ["left,bottom", "in-right,bottom", "right,top", "in-left,top"],
    },
    {
      shape: "parallelogram-alt",
      spelling: "A[\\Parallelogram alt\\]",
      label: "Parallelogram alt",
      // `lean_left`, the mirror image — which is the whole reason there are
      // two spellings, and the one thing a test of these two must not let
      // through.
      outline: ["in-left,bottom", "right,bottom", "in-right,top", "left,top"],
    },
    {
      shape: "trapezoid",
      spelling: "A[/Trapezoid\\]",
      label: "Trapezoid",
      // Narrow top, wide bottom.
      outline: ["left,bottom", "right,bottom", "in-right,top", "in-left,top"],
    },
    {
      shape: "trapezoid-alt",
      spelling: "A[\\Trapezoid alt/]",
      label: "Trapezoid alt",
      // Mermaid's `inv_trapezoid`: wide top, narrow bottom.
      outline: ["in-left,bottom", "in-right,bottom", "right,top", "left,top"],
    },
    {
      shape: "asymmetric",
      spelling: "A>Asymmetric]",
      label: "Asymmetric",
      // A rectangle with a notch cut into its **left** edge, apex pointing
      // right at mid-height — the `>` of the spelling, drawn. Mermaid's
      // `rect_left_inv_arrow` puts its two left corners further left than
      // the mid-height vertex between them, so the notch eats into the
      // shape rather than sticking out of it; a flag pointing the other way
      // would put the corners at `in-left` and the apex at `left,mid`.
      outline: ["left,top", "in-left,mid", "left,bottom", "right,bottom", "right,top"],
    },
  ] as const;

  it.each(PATH_SHAPES.map((spec) => [spec.spelling, spec.shape, spec] as const))(
    "draws `%s` end to end as a styleable, animatable %s",
    (_spelling, _shape, { shape, spelling, label, outline }) => {
      // The whole vertical slice through one public call, for each of the
      // six shapes ticket 02 landed without one: the spelling parses, the
      // outline Mermaid names is drawn, and the two things a rectangle
      // already had — an author's `style` and a place on the timeline —
      // reach it unchanged.
      //
      // Any one of them alone would leave a document Mermaid draws
      // correctly being drawn wrongly here: an outline nobody styles is not
      // a node, and a node nothing animates is not a Siren one.
      const container = document.createElement("div");
      const result = render(
        `flowchart TD
${spelling} --> B[Ship it]
style A fill:#f00
timeline:
step 1: enter A fade
`,
        container,
      );

      expect([shape, result.diagnostics]).toEqual([shape, []]);

      const group = result.svg!.querySelector('g.siren-node[data-siren-id="A"]')!;
      const frame = group.querySelector(".siren-node-frame")!;

      // Drawn — the picture, first. `data-siren-shape` is checked after and
      // never instead: board 4 reclassified two corpus rows on exactly that
      // point, and an attribute is not the picture.
      expect([shape, frame.tagName]).toEqual([shape, "path"]);
      expect([shape, outlineCycle(frame)]).toEqual([shape, canonicalCycle(outline)]);
      expect([shape, group.getAttribute("data-siren-shape")]).toEqual([shape, shape]);

      // The punctuation was syntax, so the label is the text inside it.
      expect([shape, group.querySelector("text")!.textContent]).toEqual([shape, label]);

      // ADR-0008's placement, unchanged by the element under it: the
      // author's declaration lands on the `<path>` the theme paints.
      expect([shape, frame.getAttribute("style")]).toEqual([shape, "fill:#f00"]);

      // And it animates: the id and the animation classes are on the `<g>`,
      // so the controller drives these six without knowing shapes exist —
      // and the author's declaration is on a different element, so neither
      // overwrites the other.
      expect([shape, group.classList.contains("siren-pending")]).toEqual([shape, true]);
      result.controller!.next();
      expect([shape, group.classList.contains("siren-pending")]).toEqual([shape, false]);
      expect([shape, group.classList.contains("siren-enter-fade")]).toEqual([shape, true]);
      expect([shape, frame.getAttribute("style")]).toEqual([shape, "fill:#f00"]);
    },
  );

  /**
   * The three spellings drawn with a `<rect>` rather than a `<path>`, each
   * with what makes it that shape *in the picture* — a corner radius the
   * renderer computed, or a pair of inner bars — and the fit its label is
   * owed inside it.
   *
   * Which spelling names which shape is measured, not remembered: mermaid
   * 11.17.2 reads `A(Round)` as `type="round"`, `A([Stadium])` as
   * `type="stadium"` and `A[[Subroutine]]` as `type="subroutine"`
   * (`pnpm --filter @siren/core probe`).
   *
   * `drawn` is handed the frame elements and the label's own measured box,
   * and asserts both halves at once: the shape is there, and the label is
   * inside it. Splitting those would let a shape that draws its corners and
   * then clips its own text pass.
   */
  const RECT_SHAPES = [
    {
      shape: "round",
      spelling: "A(Round)",
      label: "Round",
      drawn: (frames: Element[], label: { width: number }) => {
        expect(frames.map((f) => f.tagName)).toEqual(["rect"]);
        const height = Number(frames[0].getAttribute("height"));
        const radius = inlineRadius(frames[0]);
        // Rounder than a square corner and less round than a semicircular
        // end — the two neighbours it would otherwise collapse into.
        expect(radius).toBeGreaterThan(0);
        expect(radius).toBeLessThan(height / 2);
        // And the label clears both corners.
        expect(Number(frames[0].getAttribute("width")) - 2 * radius).toBeGreaterThanOrEqual(
          label.width,
        );
      },
    },
    {
      shape: "stadium",
      spelling: "A([Stadium])",
      label: "Stadium",
      drawn: (frames: Element[], label: { width: number }) => {
        expect(frames.map((f) => f.tagName)).toEqual(["rect"]);
        const height = Number(frames[0].getAttribute("height"));
        // Half the height exactly, or the ends are not semicircles and it
        // is not a stadium.
        expect(inlineRadius(frames[0])).toBe(height / 2);
        expect(Number(frames[0].getAttribute("width")) - height).toBeGreaterThanOrEqual(
          label.width,
        );
      },
    },
    {
      shape: "subroutine",
      spelling: "A[[Subroutine]]",
      label: "Subroutine",
      drawn: (frames: Element[], label: { width: number }) => {
        // A box and an inner bar down each end — the first node on this
        // board to draw more than one element.
        expect(frames.map((f) => f.tagName)).toEqual(["rect", "line", "line"]);
        const box = frames[0];
        const left = Number(box.getAttribute("x"));
        const right = left + Number(box.getAttribute("width"));
        const top = Number(box.getAttribute("y"));
        const bottom = top + Number(box.getAttribute("height"));
        const bars = frames.slice(1).map((line) => Number(line.getAttribute("x1")));
        // Each bar runs the full height of the box, strictly inside it, and
        // one sits near each end rather than both near one.
        for (const line of frames.slice(1)) {
          expect([line.getAttribute("x1"), line.getAttribute("x2")]).toEqual([
            line.getAttribute("x1"),
            line.getAttribute("x1"),
          ]);
          expect([Number(line.getAttribute("y1")), Number(line.getAttribute("y2"))]).toEqual([
            top,
            bottom,
          ]);
        }
        expect(bars[0]).toBeGreaterThan(left);
        expect(bars[1]).toBeLessThan(right);
        expect(bars[0] - left).toBe(right - bars[1]);
        // The label goes *between* the bars, not across one.
        expect(bars[1] - bars[0]).toBeGreaterThanOrEqual(label.width);
      },
    },
  ] as const;

  /**
   * The corner radius a frame declares for itself, in user units — `0` when
   * it declares none and leaves its corners to the theme.
   *
   * Read out of the inline `style` attribute because that is where the
   * renderer writes it, and it writes it there rather than as an `rx`
   * attribute for a cascade reason: a presentation attribute loses to the
   * theme's own `.siren-node-frame { rx: var(--siren-node-border-radius) }`,
   * so a stadium written that way would come back a 6px-cornered box.
   */
  const inlineRadius = (frame: Element): number =>
    Number.parseFloat((frame.getAttribute("style") ?? "").match(/rx:\s*([\d.]+)px/)?.[1] ?? "0");

  it.each(RECT_SHAPES.map((spec) => [spec.spelling, spec.shape, spec] as const))(
    "draws `%s` end to end as a styleable, animatable %s",
    (_spelling, _shape, { shape, spelling, label, drawn }) => {
      // The whole vertical slice through one public call, for the three
      // shapes that stay a `<rect>`: the spelling parses, the thing that
      // makes it that shape is drawn, the label fits inside it, and the two
      // things a rectangle already had — an author's `style` and a place on
      // the timeline — reach it unchanged.
      const container = document.createElement("div");
      const result = render(
        `flowchart TD
${spelling} --> B[Ship it]
style A fill:#f00
timeline:
step 1: enter A fade
`,
        container,
      );

      expect([shape, result.diagnostics]).toEqual([shape, []]);

      const group = result.svg!.querySelector('g.siren-node[data-siren-id="A"]')!;
      const frames = Array.from(group.querySelectorAll(".siren-node-frame"));

      // The picture first. `data-siren-shape` is checked after and never
      // instead: board 4 reclassified two corpus rows on exactly that
      // point, and an attribute is not the picture.
      drawn(frames, { width: label.length * 8 + 16 });
      expect([shape, group.getAttribute("data-siren-shape")]).toEqual([shape, shape]);

      // The punctuation was syntax, so the label is the text inside it.
      expect([shape, group.querySelector("text")!.textContent]).toEqual([shape, label]);

      // ADR-0008's placement, unchanged by the shape over it — and on every
      // element the frame is drawn with, so a subroutine's bars cannot look
      // detached from the box they mark. A shape that names its own corners
      // writes them ahead of the author's declarations, so `fill:#f00` is
      // still there and still last.
      for (const frame of frames) {
        expect([shape, frame.getAttribute("style")!.endsWith("fill:#f00")]).toEqual([shape, true]);
      }

      // And it animates: the id and the animation classes are on the `<g>`,
      // so the controller drives these three without knowing shapes exist.
      expect([shape, group.classList.contains("siren-pending")]).toEqual([shape, true]);
      result.controller!.next();
      expect([shape, group.classList.contains("siren-pending")]).toEqual([shape, false]);
      expect([shape, group.classList.contains("siren-enter-fade")]).toEqual([shape, true]);
      expect([shape, frames[0].getAttribute("style")!.endsWith("fill:#f00")]).toEqual([shape, true]);
    },
  );

  it("gives the six path shapes no `siren-*` class of their own — what a rectangle emits is exactly what they emit", () => {
    // Asked because nothing else in the suite would notice the answer
    // changing. `theme/default.test.ts` checks that every class the
    // flowchart renderer emits has a rule in the default stylesheet, and
    // its coverage fixture draws rectangles only; a class emitted by a
    // hexagon and by nothing else would therefore ship unthemed — invisible
    // to the suite, plain in the picture — and the fixture would have to
    // widen to catch it.
    //
    // The two documents differ in their node spellings and in nothing else,
    // so the comparison is about the shapes rather than about the number of
    // nodes or the presence of an edge.
    const sirenClasses = (source: string): string[] => {
      const container = document.createElement("div");
      const result = render(source, container);
      expect(result.diagnostics).toEqual([]);
      const found = new Set<string>();
      for (const element of Array.from(result.svg!.querySelectorAll("*"))) {
        for (const name of (element.getAttribute("class") ?? "").split(/\s+/)) {
          if (name.startsWith("siren-")) found.add(name);
        }
      }
      return [...found].sort();
    };

    const shaped = sirenClasses(`flowchart TD
A{{Hexagon}}
B[/Parallelogram/]
C[\\Parallelogram alt\\]
D[/Trapezoid\\]
E[\\Trapezoid alt/]
F>Asymmetric]
`);
    const rectangles = sirenClasses(`flowchart TD
A[Hexagon]
B[Parallelogram]
C[Parallelogram alt]
D[Trapezoid]
E[Trapezoid alt]
F[Asymmetric]
`);

    expect(shaped).toEqual(rectangles);
    // Named as well as compared, so the failure of a future shape that
    // *adds* a class says what the theme now has to paint. The arrowhead's
    // fill class is in the list because the theme's one `<marker>` is
    // minted into `<defs>` whether or not anything references it — a fact
    // about the renderer rather than about these six, and it is on both
    // sides of the comparison above.
    expect(shaped).toEqual(["siren-arrow-fill", "siren-node", "siren-node-frame"]);
  });

  it("gives the three rect shapes no `siren-*` class of their own either — including a subroutine's two extra elements", () => {
    // The question ticket 02 was asked about its six, asked again where it
    // is most likely to have a different answer: a subroutine draws three
    // elements, and a second element is where a second class gets invented.
    // A `siren-node-bar` would ship unthemed without failing anything —
    // `theme/default.test.ts`'s coverage net can only see classes something
    // in its fixture renders — so this is the check that says whether the
    // net has to widen. (It also widened, for the same reason: a claim and
    // a fixture that could confirm it are not the same thing.)
    //
    // The two documents differ in their node spellings and in nothing else.
    const sirenClasses = (source: string): string[] => {
      const container = document.createElement("div");
      const result = render(source, container);
      expect(result.diagnostics).toEqual([]);
      const found = new Set<string>();
      for (const element of Array.from(result.svg!.querySelectorAll("*"))) {
        for (const name of (element.getAttribute("class") ?? "").split(/\s+/)) {
          if (name.startsWith("siren-")) found.add(name);
        }
      }
      return [...found].sort();
    };

    const shaped = sirenClasses(`flowchart TD
A(Round)
B([Stadium])
C[[Subroutine]]
`);
    const rectangles = sirenClasses(`flowchart TD
A[Round]
B[Stadium]
C[Subroutine]
`);

    expect(shaped).toEqual(rectangles);
    expect(shaped).toEqual(["siren-arrow-fill", "siren-node", "siren-node-frame"]);

    // And the subroutine's bars wear the frame's own name rather than none
    // at all, which is what puts them in the same styling story as the box
    // — the theme strokes them because it strokes a frame.
    const container = document.createElement("div");
    const result = render(`flowchart TD\nC[[Subroutine]]\n`, container);
    const parts = Array.from(
      result.svg!.querySelectorAll('g.siren-node[data-siren-id="C"] > *'),
    ).filter((element) => element.tagName !== "text");
    expect(parts.map((element) => [element.tagName, element.getAttribute("class")])).toEqual([
      ["rect", "siren-node-frame"],
      ["line", "siren-node-frame"],
      ["line", "siren-node-frame"],
    ]);
  });

  it("carries a flowchart author's `style` all the way to the DOM: inline style on the node's frame rect, and no attribute at all on a node nothing styled", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[End]
style A fill:#fdd,stroke:#c00
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const frame = (id: string) =>
      result.svg!.querySelector(`g.siren-node[data-siren-id="${id}"] rect.siren-node-frame`)!;

    expect(frame("A").getAttribute("style")).toBe("fill:#fdd;stroke:#c00");
    expect(frame("B").getAttribute("style")).toBeNull();
  });

  it("reports the identical diagnostic for a `style` on an id that does not exist, whichever diagram kind wrote it", () => {
    // One resolver, one gate, one wording. The two kinds put the statement on
    // the same line and column so the diagnostics must be equal objects — a
    // future divergence fails here rather than being found by an author.
    const flowchart = render(
      `flowchart TD
A[Start]
style Ghost fill:#fdd
`,
      document.createElement("div"),
    );
    const classDiagram = render(
      `classDiagram
class Shape
style Ghost fill:#fdd
`,
      document.createElement("div"),
    );

    expect(flowchart.diagnostics).toEqual([
      {
        severity: "error",
        message: 'style "Ghost" references an id that does not exist; dropping the declaration.',
        line: 3,
        column: 1,
      },
    ]);
    expect(flowchart.diagnostics).toEqual(classDiagram.diagnostics);
  });

  it("holds the style-value gate identically for a flowchart: the refused value never reaches the attribute, its sibling does, and the message is word-for-word the class diagram's", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
Fetches[Fetches] --> Executes[Executes]
Smuggles[Smuggles] --> Escapes[Escapes]
style Fetches fill:url(#evil),stroke:#c00
style Executes fill:expression(alert(1)),stroke:#c00
style Smuggles fill:#fdd;position:fixed,stroke:#c00
style Escapes fill:u\\72 l(#evil),stroke:#c00
`;

    const result = render(source, container);

    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(4);
    expect(errors.map((d) => d.message)).toEqual([
      'Style value for "fill" uses "url(", which can fetch a remote resource; dropping the declaration.',
      'Style value for "fill" uses "expression(", which can execute script; dropping the declaration.',
      'Style value for "fill" contains ";", which would smuggle in a second declaration; dropping the declaration.',
      'Style value for "fill" contains "\\", which can spell a rejected function as a CSS escape; dropping the declaration.',
    ]);

    const frameStyle = (id: string) =>
      result
        .svg!.querySelector(`g.siren-node[data-siren-id="${id}"] rect.siren-node-frame`)!
        .getAttribute("style");

    // Only the sibling survives, in each case.
    for (const id of ["Fetches", "Executes", "Smuggles", "Escapes"]) {
      expect([id, frameStyle(id)]).toEqual([id, "stroke:#c00"]);
    }

    // And nothing refused is anywhere in the serialized document, in any
    // attribute — the gate is about what the browser is handed, not about
    // which element it was handed on.
    const markup = container.innerHTML;
    for (const forbidden of ["url(#evil", "expression(", "position:fixed", "\\"]) {
      expect([forbidden, markup.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it("lets a styled flowchart node animate: the inline style rides on the frame while the group takes siren-pending and siren-enter-fade", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[End]
style B fill:#fdd
timeline:
step 1: enter B fade
`;

    const result = render(source, container);
    const group = () => result.svg!.querySelector('g.siren-node[data-siren-id="B"]')!;
    const frame = () => group().querySelector("rect.siren-node-frame")!;

    expect(result.diagnostics).toEqual([]);
    // The two live on different elements on purpose (ADR-0008): the frame
    // carries the author's declarations, the group carries the animation
    // classes, so neither can overwrite the other.
    expect(group().classList.contains("siren-pending")).toBe(true);
    expect(frame().getAttribute("style")).toBe("fill:#fdd");

    result.controller!.next();
    expect(group().classList.contains("siren-pending")).toBe(false);
    expect(group().classList.contains("siren-enter-fade")).toBe(true);
    expect(frame().getAttribute("style")).toBe("fill:#fdd");

    result.controller!.reset();
    expect(group().classList.contains("siren-pending")).toBe(true);
    expect(frame().getAttribute("style")).toBe("fill:#fdd");
  });

  it("gives a flowchart `classDef` its effect only through `class`: one definition reaches every node named, a node may carry two, and a definition nothing applies draws nothing", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[End]
B --> C[Ignored]
classDef emphasis fill:#fdd
classDef thick stroke-width:3px
class A,B emphasis
class B thick
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const frameStyle = (id: string) =>
      result
        .svg!.querySelector(`g.siren-node[data-siren-id="${id}"] rect.siren-node-frame`)!
        .getAttribute("style");

    expect(frameStyle("A")).toBe("fill:#fdd");
    expect(frameStyle("B")).toBe("fill:#fdd;stroke-width:3px");
    // `thick` is defined and applied to B only, so C — which no statement
    // names — keeps no attribute at all.
    expect(frameStyle("C")).toBeNull();
  });

  it("carries a `:::` shorthand to the DOM in both forms, including on a node that also appears in an edge", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
classDef emphasis fill:#fdd
A[Start]:::emphasis
A --> B[End]
B:::emphasis
B --> C[Plain]
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const frameStyle = (id: string) =>
      result
        .svg!.querySelector(`g.siren-node[data-siren-id="${id}"] rect.siren-node-frame`)!
        .getAttribute("style");

    expect(frameStyle("A")).toBe("fill:#fdd");
    expect(frameStyle("B")).toBe("fill:#fdd");
    expect(frameStyle("C")).toBeNull();
    // The shorthand styles the node without disturbing the graph: B still
    // carries the label its edge declaration gave it, and both edges exist.
    expect(
      result.svg!.querySelector('g.siren-node[data-siren-id="B"] text')!.textContent,
    ).toBe("End");
    expect(result.svg!.querySelectorAll("path.siren-edge")).toHaveLength(2);
  });

  it("resolves a flowchart `classDef` written after the statement that applies it, for both the `class` and the `:::` spelling", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start]:::emphasis
A --> B[End]
class B emphasis
classDef emphasis fill:#fdd
`;

    const result = render(source, container);

    // Collecting the definitions is a pass of its own in the shared
    // resolver, so a flowchart gets the class diagram's forward reference
    // rather than a parser-order restriction of its own.
    expect(result.diagnostics).toEqual([]);
    const frameStyle = (id: string) =>
      result
        .svg!.querySelector(`g.siren-node[data-siren-id="${id}"] rect.siren-node-frame`)!
        .getAttribute("style");

    expect(frameStyle("A")).toBe("fill:#fdd");
    expect(frameStyle("B")).toBe("fill:#fdd");
  });

  it("drops only the unknown target of a flowchart `class A,Ghost name`, and names the keyword the author actually typed when no classDef defines the name", () => {
    const result = render(
      `flowchart TD
A[Start] --> B[End]
B:::ghost
classDef emphasis fill:#fdd
class A,Ghost emphasis
class A missing
`,
      document.createElement("div"),
    );

    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        message: '::: applies "ghost", which no classDef defines; dropping the declaration.',
        line: 3,
        column: 1,
      },
      {
        severity: "error",
        message: 'class "Ghost" references an id that does not exist; dropping the declaration.',
        line: 5,
        column: 1,
      },
      {
        severity: "error",
        message: 'class applies "missing", which no classDef defines; dropping the declaration.',
        line: 6,
        column: 1,
      },
    ]);
    // One unknown target drops itself, not the statement: A is still styled.
    expect(
      result
        .svg!.querySelector('g.siren-node[data-siren-id="A"] rect.siren-node-frame')!
        .getAttribute("style"),
    ).toBe("fill:#fdd");
  });

  it("flattens a flowchart's `style` and `classDef` into one ordered list per node, last declaration of a property winning (ADR-0008)", () => {
    const result = render(
      `flowchart TD
Later[Later] --> Earlier[Earlier]
classDef emphasis fill:#fdd,stroke:#c00
class Later emphasis
style Later fill:#0f0
style Earlier fill:#0f0
class Earlier emphasis
`,
      document.createElement("div"),
    );

    expect(result.diagnostics).toEqual([]);
    const frameStyle = (id: string) =>
      result
        .svg!.querySelector(`g.siren-node[data-siren-id="${id}"] rect.siren-node-frame`)!
        .getAttribute("style");

    // Nothing about being a `classDef` or a `style` wins; writing last does.
    // The property keeps the position of its first declaration either way,
    // so `fill` stays ahead of `stroke` in both nodes.
    expect(frameStyle("Later")).toBe("fill:#0f0;stroke:#c00");
    expect(frameStyle("Earlier")).toBe("fill:#fdd;stroke:#c00");
  });

  it("lands a flowchart node's `color` on its label text, leaving the frame everything else", () => {
    // One rule, two diagram kinds: the same `classDef highlight
    // fill:#111,color:#fff` darkens the box and lightens the text on it here
    // exactly as it does in a class diagram, because the split is made once
    // in `resolveStyles` and neither renderer gets a say in it.
    const svg = renderThemed(`flowchart TD
A[Start] --> B[End]
classDef highlight fill:#111,color:#fff
class A highlight
`);

    const node = svg.querySelector('g.siren-node[data-siren-id="A"]')!;
    expect(node.querySelector("rect.siren-node-frame")!.getAttribute("style")).toBe("fill:#111");

    // The node's label carries no class of its own — the theme reaches it by
    // `.siren-node text` — and it needs none: an inline declaration outranks
    // a class *or* an element selector alike, so a `siren-node-label` class
    // added for symmetry with the class diagram would buy nothing here.
    const label = node.querySelector("text")!;
    expect(label.getAttribute("class")).toBeNull();
    expect(label.getAttribute("style")).toBe("fill:#fff");

    // The measurement this ticket turns on: `<text style="color:#fff">`
    // computes to the theme's fill, unchanged, and only `fill` moves it. See
    // the class-diagram test above for why a jsdom cascade assertion is
    // sound here (`theme/default.test.ts` pins that the theme carries no
    // `!important`, which is the half jsdom cannot model).
    expect(getComputedStyle(label).fill).toBe("#fff");

    const unstyled = svg.querySelector('g.siren-node[data-siren-id="B"] text')!;
    expect(unstyled.getAttribute("style")).toBeNull();
  });

  it("keeps a `linkStyle`'s `color` off the edge path, where it would be the same bug one element over", () => {
    // An edge is one `<path class="siren-edge">` and draws no text at all, so
    // the author's `color` has nowhere to land. `resolveStyles` routes it
    // into the text half anyway — the rule is about what a declaration
    // *means*, and a resolver that asked "is this an edge?" would be the
    // per-kind opinion the split exists to prevent — and this renderer
    // simply has no element to apply it to.
    //
    // What must not happen is the thing this whole ticket is about: the
    // declaration landing on the drawn shape instead, where `color` paints
    // nothing and the author is told nothing.
    const svg = renderThemed(`flowchart TD
A[Start] --> B[End]
linkStyle 0 stroke:#f00,color:#0f0
`);

    const path = svg.querySelector('path.siren-edge[data-siren-id="A-B"]')!;
    expect(path.getAttribute("style")).toBe("stroke:#f00");

    // And there is genuinely no text on an edge to have missed: every
    // `<text>` this diagram draws belongs to a node.
    for (const text of Array.from(svg.querySelectorAll("text"))) {
      expect(text.closest("g.siren-node")).not.toBeNull();
    }
  });

  it("carries a `:::` written inside an edge line to the frame of whichever endpoint wore it", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
classDef emphasis fill:#fdd
classDef cool stroke:#00f
A[Start]:::emphasis --> B[End]:::cool
B --> C[Plain]
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const frameStyle = (id: string) =>
      result
        .svg!.querySelector(`g.siren-node[data-siren-id="${id}"] rect.siren-node-frame`)!
        .getAttribute("style");

    expect(frameStyle("A")).toBe("fill:#fdd");
    expect(frameStyle("B")).toBe("stroke:#00f");
    expect(frameStyle("C")).toBeNull();
    // Styling an endpoint does not disturb the graph it is written in.
    const label = (id: string) =>
      result.svg!.querySelector(`g.siren-node[data-siren-id="${id}"] text`)!.textContent;
    expect([label("A"), label("B"), label("C")]).toEqual(["Start", "End", "Plain"]);
    expect(result.svg!.querySelectorAll("path.siren-edge")).toHaveLength(2);
  });

  it("reports a `:::` inside an edge line that names no classDef once per occurrence, quoting `:::`", () => {
    const result = render(
      `flowchart TD
A[Start]:::ghost --> B[End]:::ghost
`,
      document.createElement("div"),
    );

    // Two endpoints wore the typo, so the author is told twice — once per
    // thing that will not be styled — under the keyword they typed.
    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        message: '::: applies "ghost", which no classDef defines; dropping the declaration.',
        line: 2,
        column: 1,
      },
      {
        severity: "error",
        message: '::: applies "ghost", which no classDef defines; dropping the declaration.',
        line: 2,
        column: 1,
      },
    ]);
  });

  it("draws a chained `A --> B --> C` as the two edges it declares, with or without a `:::` on it", () => {
    // The deliberate reversal of board 3's pin, which refused these three
    // lines so that whoever widened them had to do it on purpose. Its
    // argument survives the reversal and is why this asserts ids rather
    // than a count: reading the first two nodes of three and dropping the
    // rest would draw a diagram the author never wrote, which is worse than
    // the refusal it replaced. A chain is read whole or refused whole.
    for (const line of [
      "A --> B --> C",
      "A[Start] --> B[Mid] --> C[End]",
      "A:::emphasis --> B --> C",
    ]) {
      const result = render(
        `flowchart TD\nclassDef emphasis fill:#fdd\n${line}\n`,
        document.createElement("div"),
      );

      expect([line, result.diagnostics]).toEqual([line, []]);
      const edgeIds = Array.from(result.svg!.querySelectorAll("path.siren-edge")).map((path) =>
        path.getAttribute("data-siren-id"),
      );
      expect([line, edgeIds]).toEqual([line, ["A-B", "B-C"]]);
      const nodeIds = Array.from(result.svg!.querySelectorAll("g.siren-node")).map((g) =>
        g.getAttribute("data-siren-id"),
      );
      expect([line, nodeIds]).toEqual([line, ["A", "B", "C"]]);
    }
  });

  it("lands a `:::` on both ends of a chain, and on every member of an `&` group, all the way in the DOM", () => {
    const result = render(
      `flowchart TD
classDef hot fill:#fdd
classDef cold fill:#ddf
A:::hot --> B --> C:::cold
D:::hot & E:::cold --> F
`,
      document.createElement("div"),
    );

    expect(result.diagnostics).toEqual([]);
    const frameStyle = (id: string) =>
      result
        .svg!.querySelector(`g.siren-node[data-siren-id="${id}"] rect.siren-node-frame`)!
        .getAttribute("style");

    // A line that names more endpoints applies at more of them; the one
    // that wore nothing still wears nothing.
    expect(["A", "B", "C", "D", "E", "F"].map(frameStyle)).toEqual([
      "fill:#fdd",
      null,
      "fill:#ddf",
      "fill:#fdd",
      "fill:#ddf",
      null,
    ]);
  });

  it("carries a flowchart author's `linkStyle` all the way to the DOM: the inline style lands on the path of the edge the index addresses, and on no other", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
C --> D[Done]
linkStyle 1 stroke:#f00,stroke-width:4px
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const path = (id: string) =>
      result.svg!.querySelector(`path.siren-edge[data-siren-id="${id}"]`)!;

    // Three edges, so an off-by-one paints a different arrow and fails here.
    expect(path("B-C").getAttribute("style")).toBe("stroke:#f00;stroke-width:4px");
    expect(path("A-B").getAttribute("style")).toBeNull();
    expect(path("C-D").getAttribute("style")).toBeNull();
  });

  it("applies a `linkStyle 0,2` to each edge in the list and to no edge between them", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
C --> D[Done]
linkStyle 0,2 stroke:#f00
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const styled = Array.from(result.svg!.querySelectorAll("path.siren-edge"))
      .filter((path) => path.getAttribute("style") === "stroke:#f00")
      .map((path) => path.getAttribute("data-siren-id"));
    expect(styled).toEqual(["A-B", "C-D"]);
  });

  it("paints every edge from one `linkStyle default`, and reads `default` as an address rather than as a number", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
linkStyle default stroke:#0f0
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    expect(
      Array.from(result.svg!.querySelectorAll("path.siren-edge")).map((path) => [
        path.getAttribute("data-siren-id"),
        path.getAttribute("style"),
      ]),
    ).toEqual([
      ["A-B", "stroke:#0f0"],
      ["B-C", "stroke:#0f0"],
    ]);
  });

  it("lets a specific `linkStyle N` beat `linkStyle default` on the way to the DOM, in both source orders", () => {
    // `linkStyle default` is Mermaid's fallback for the links nothing else
    // styles, so the specific line wins whichever order the two are written
    // in. That is not a specificity model between author directives, which
    // ADR-0008 refuses: its last-declaration-wins rule settles repeated
    // declarations on one target, and `default` names no target at all.
    // Asserted in both orders because the second one is where a fallback
    // implemented as an ordinary declaration diverges from Mermaid.
    const styles = (source: string) =>
      Array.from(
        render(source, document.createElement("div")).svg!.querySelectorAll("path.siren-edge"),
      ).map((path) => [path.getAttribute("data-siren-id"), path.getAttribute("style")]);

    const edges = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
`;

    expect(styles(`${edges}linkStyle default stroke:#0f0\nlinkStyle 0 stroke:#f00\n`)).toEqual([
      ["A-B", "stroke:#f00"],
      ["B-C", "stroke:#0f0"],
    ]);

    expect(styles(`${edges}linkStyle 0 stroke:#f00\nlinkStyle default stroke:#0f0\n`)).toEqual([
      ["A-B", "stroke:#f00"],
      ["B-C", "stroke:#0f0"],
    ]);
  });

  it("leaves an edge wearing both tiers: the specific `linkStyle` takes over the property it names and the `default` keeps the rest", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
linkStyle default stroke:#0f0,stroke-width:4px
linkStyle 0 stroke:#f00
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    // The 4px is written once in the whole document, on the fallback, so an
    // implementation where the specific statement replaces the default
    // wholesale loses it here — the arrow goes red and thin.
    expect(
      Array.from(result.svg!.querySelectorAll("path.siren-edge")).map((path) => [
        path.getAttribute("data-siren-id"),
        path.getAttribute("style"),
      ]),
    ).toEqual([
      ["A-B", "stroke:#f00;stroke-width:4px"],
      ["B-C", "stroke:#0f0;stroke-width:4px"],
    ]);
  });

  it("puts a `linkStyle` value through the one shared gate: the refused value never reaches the attribute, its sibling does, and the message is word-for-word the one a `style` gets", () => {
    const container = document.createElement("div");
    const result = render(
      `flowchart TD
A[Start] --> B[End]
linkStyle 0 stroke:url(#evil),stroke-width:4px
`,
      container,
    );

    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        message:
          'Style value for "stroke" uses "url(", which can fetch a remote resource; dropping the declaration.',
        line: 3,
        column: 1,
      },
    ]);
    expect(
      result.svg!.querySelector('path.siren-edge[data-siren-id="A-B"]')!.getAttribute("style"),
    ).toBe("stroke-width:4px");
    // Not merely off the attribute: nowhere in the document. The one
    // `url(` the markup may contain is the renderer's own marker reference.
    expect(container.innerHTML.includes("url(#evil")).toBe(false);
  });

  it("lets a styled edge animate: the author's declarations and the animation classes ride the same path element without disturbing each other", () => {
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[End]
linkStyle 0 stroke:#f00
timeline:
step 1: enter A-B fade
`;

    const result = render(source, container);
    const path = () => result.svg!.querySelector('path.siren-edge[data-siren-id="A-B"]')!;

    expect(result.diagnostics).toEqual([]);
    // Unlike a node — whose frame carries the style while its `<g>` carries
    // the classes — an edge is one element wearing both, so this is where a
    // renderer that wrote its animation state as an inline attribute would
    // eat the author's declarations.
    expect(path().classList.contains("siren-pending")).toBe(true);
    expect(path().getAttribute("style")).toBe("stroke:#f00");

    result.controller!.next();
    expect(path().classList.contains("siren-pending")).toBe(false);
    expect(path().classList.contains("siren-enter-fade")).toBe(true);
    expect(path().getAttribute("style")).toBe("stroke:#f00");

    result.controller!.reset();
    expect(path().classList.contains("siren-pending")).toBe(true);
    expect(path().getAttribute("style")).toBe("stroke:#f00");
  });
  it("scopes a flowchart's marker ids to the SVG that defines them, so two diagrams on one page share no id and each edge points at its own diagram's arrowhead", () => {
    // `url(#siren-arrow)` resolves against the whole *document*, not against
    // the SVG it is written in, so a fixed marker id means the browser hands
    // every diagram on the page the *first* diagram's marker. Measured before
    // this was fixed: two flowcharts rendered onto one page produced
    // ids = ["siren-arrow", "siren-arrow"]. Harmless only for as long as
    // every marker is identical — the moment one carries an author's color it
    // is a cross-diagram miscolor.
    const source = `flowchart TD
A[Start] --> B[End]
`;
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);

    try {
      const one = render(source, first);
      const two = render(source, second);
      expect([one.diagnostics, two.diagnostics]).toEqual([[], []]);

      // The probe that found this, asserted: every id in the page, checked
      // for duplicates.
      const ids = Array.from(document.querySelectorAll("[id]")).map((element) => element.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);

      // And the consequence that matters: the second diagram's edges point at
      // the second diagram's marker, not at the first's.
      for (const svg of [one.svg!, two.svg!]) {
        const edges = Array.from(svg.querySelectorAll("path.siren-edge"));
        expect(edges.length).toBeGreaterThan(0);
        for (const edge of edges) {
          const reference = edge.getAttribute("marker-end");
          expect(reference).toMatch(/^url\(#.+\)$/);
          const id = reference!.slice("url(#".length, -1);
          expect(svg.querySelector(`defs > marker#${id}`)).not.toBeNull();
          expect(document.querySelectorAll(`#${id}`)).toHaveLength(1);
        }
      }
    } finally {
      first.remove();
      second.remove();
    }
  });
  it("scopes a class diagram's marker ids the same way, so two class diagrams on one page share no id and each relationship's endpoints resolve inside its own SVG", () => {
    // The class diagram has the identical exposure — `siren-class-triangle`,
    // `siren-class-diamond-filled`, `siren-class-diamond-hollow` and
    // `siren-class-arrow` were all fixed ids — and four markers rather than
    // one, so fixing only the flowchart would be half a fix.
    const source = `classDiagram
Animal <|-- Duck
Habitat *-- Animal
Duck o-- Feather
Keeper --> Animal
`;
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);

    try {
      const one = render(source, first);
      const two = render(source, second);
      expect([one.diagnostics, two.diagnostics]).toEqual([[], []]);

      const ids = Array.from(document.querySelectorAll("[id]")).map((element) => element.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);

      for (const svg of [one.svg!, two.svg!]) {
        const lines = Array.from(svg.querySelectorAll("path.siren-relationship-line"));
        expect(lines.length).toBe(4);
        const referenced = lines.flatMap((line) => [
          line.getAttribute("marker-start"),
          line.getAttribute("marker-end"),
        ]);
        expect(referenced.filter((reference) => reference !== null).length).toBeGreaterThan(0);
        for (const reference of referenced) {
          if (reference === null) continue;
          expect(reference).toMatch(/^url\(#.+\)$/);
          const id = reference.slice("url(#".length, -1);
          expect(svg.querySelector(`defs > marker#${id}`)).not.toBeNull();
          expect(document.querySelectorAll(`#${id}`)).toHaveLength(1);
        }
      }
    } finally {
      first.remove();
      second.remove();
    }
  });
  it("colors a styled edge's arrowhead with the edge's own `stroke`, while an edge nothing styled keeps the theme's shared marker", () => {
    // Mermaid colors the whole arrow, line and head. Siren coloured only the
    // line, because one shared `<marker>` in `<defs>` cannot inherit from the
    // path that references it — so the head has to be a marker of its own,
    // carrying the author's color as an inline `fill` that outranks the
    // theme's `.siren-arrow-fill` rule without `!important` (ADR-0008's
    // cascade argument, applied to the one element the theme paints).
    const container = document.createElement("div");
    const source = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
linkStyle 0 stroke:#f00
`;

    const result = render(source, container);
    expect(result.diagnostics).toEqual([]);
    const svg = result.svg!;

    const markerFor = (edgeId: string): SVGElement => {
      const reference = svg
        .querySelector(`path.siren-edge[data-siren-id="${edgeId}"]`)!
        .getAttribute("marker-end")!;
      expect(reference).toMatch(/^url\(#.+\)$/);
      const marker = svg.querySelector(`defs > marker#${reference.slice("url(#".length, -1)}`);
      expect(marker).not.toBeNull();
      return marker as SVGElement;
    };

    // The styled edge's head is red — asserted as the marker's own fill, not
    // merely as "a second marker exists".
    const styledHead = markerFor("A-B").querySelector("path")!;
    expect(styledHead.getAttribute("style")).toBe("fill:#f00");

    // The unstyled edge still takes its head from the theme: no fill of its
    // own, just the class `--siren-edge-stroke` reaches it through.
    const themeHead = markerFor("B-C").querySelector("path")!;
    expect(themeHead.getAttribute("class")).toBe("siren-arrow-fill");
    expect(themeHead.getAttribute("style")).toBeNull();
    expect(themeHead.getAttribute("fill")).toBeNull();

    expect(markerFor("A-B")).not.toBe(markerFor("B-C"));
    // The line is still painted too: this replaces neither half of the arrow.
    expect(
      svg.querySelector('path.siren-edge[data-siren-id="A-B"]')!.getAttribute("style"),
    ).toBe("stroke:#f00");
  });
  it("mints one arrowhead per distinct color rather than per styled edge, so twelve edges sharing one `linkStyle default` share one marker", () => {
    // The decision this pins: a marker is a pure function of its color, so
    // fifty edges sharing a color want one def and not fifty identical ones.
    // Nothing observable is lost — two edges of the same color have the same
    // arrowhead by definition — and the DOM stops growing with the edge count.
    const container = document.createElement("div");
    const chain = Array.from({ length: 12 }, (_, index) => `N${index} --> N${index + 1}`);
    const source = `flowchart TD
${chain.join("\n")}
linkStyle default stroke:#0f0
linkStyle 3 stroke:#00f
`;

    const result = render(source, container);
    expect(result.diagnostics).toEqual([]);
    const svg = result.svg!;

    const markerIdOf = (edgeId: string): string =>
      svg
        .querySelector(`path.siren-edge[data-siren-id="${edgeId}"]`)!
        .getAttribute("marker-end")!;

    // Eleven green edges, all pointing at one marker; the twelfth is blue and
    // has its own. Plus the theme's own marker, which is always defined.
    expect(svg.querySelectorAll("defs > marker")).toHaveLength(3);

    const green = new Set(
      chain
        .map((_, index) => `N${index}-N${index + 1}`)
        .filter((edgeId) => edgeId !== "N3-N4")
        .map(markerIdOf),
    );
    expect(green.size).toBe(1);
    expect(markerIdOf("N3-N4")).not.toBe([...green][0]);

    const fillOf = (reference: string): string | null =>
      svg
        .querySelector(`defs > marker#${reference.slice("url(#".length, -1)} path`)!
        .getAttribute("style");
    expect(fillOf([...green][0]!)).toBe("fill:#0f0");
    expect(fillOf(markerIdOf("N3-N4"))).toBe("fill:#00f");
  });
  it("mints no arrowhead for a `linkStyle` that names no `stroke`, and leaves a document with no `linkStyle` emitting exactly the one marker it always did", () => {
    // There is no color to carry, so there is nothing a marker of this edge's
    // own could say that the theme's does not — and minting one anyway would
    // freeze the arrowhead at the token's value at render time, quietly
    // taking it out of the theme's hands.
    const widthOnly = document.createElement("div");
    const widthOnlyResult = render(
      `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
linkStyle 0 stroke-width:4px
`,
      widthOnly,
    );
    expect(widthOnlyResult.diagnostics).toEqual([]);
    expect(widthOnlyResult.svg!.querySelectorAll("defs > marker")).toHaveLength(1);
    expect(
      widthOnlyResult.svg!
        .querySelector('path.siren-edge[data-siren-id="A-B"]')!
        .getAttribute("marker-end"),
    ).toBe(
      widthOnlyResult.svg!
        .querySelector('path.siren-edge[data-siren-id="B-C"]')!
        .getAttribute("marker-end"),
    );

    const unstyled = document.createElement("div");
    const unstyledResult = render(
      `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
`,
      unstyled,
    );
    expect(unstyledResult.diagnostics).toEqual([]);
    expect(unstyledResult.svg!.querySelectorAll("defs > marker")).toHaveLength(1);
    expect(
      unstyledResult.svg!.querySelector("defs > marker path")!.getAttribute("style"),
    ).toBeNull();
  });
  it("leaves every sequence arrowhead the theme's to paint: each marker's shape carries only its theme class, and no sequence marker carries an author color", () => {
    // A characterization test, written before the sequence renderer's ids
    // were scoped and green from the moment it was written. Author styling
    // for sequence diagrams is a board non-goal, so the whole exposure being
    // fixed here is the *invisible* one: `--siren-*` reaches a sequence
    // arrowhead through the marker's shape class and through nothing else,
    // and scoping the marker's id must not put a color on it or take the
    // token's reach away. `fill="none"` on the open head is shape, not
    // color — an unclosed V that must never be filled in.
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant Alice
participant Bob
Alice->>Bob: filled
Alice<<->>Bob: bidirectional
Alice-xBob: cross
Alice-)Bob: open
`;

    const result = render(source, container);
    expect(result.diagnostics).toEqual([]);
    const svg = result.svg!;

    const markers = Array.from(svg.querySelectorAll("defs > marker"));
    expect(markers).toHaveLength(3);

    for (const marker of markers) {
      const shape = marker.querySelector("path")!;
      // The class is the whole mechanism: the theme selects it, so a
      // consumer's `--siren-*` redeclaration reaches the arrowhead.
      expect([marker.id, shape.getAttribute("class")]).toEqual([
        marker.id,
        expect.stringMatching(/^siren-arrow-(fill|stroke)$/),
      ]);
      // Nothing an author wrote lands here, and nothing freezes the
      // theme's value at render time.
      expect([marker.id, shape.getAttribute("style")]).toEqual([marker.id, null]);
      expect([marker.id, shape.getAttribute("stroke")]).toEqual([marker.id, null]);
      // `fill` is either absent or the literal `none` — the open head's
      // "never close this V", which is shape rather than color. No marker
      // names a color here at all.
      const fill = shape.getAttribute("fill");
      expect([marker.id, fill === null || fill === "none"]).toEqual([marker.id, true]);
    }

    // And every message that carries a head points at one of exactly those
    // three markers — no fourth, per-message marker was minted.
    const referenced = new Set(
      Array.from(svg.querySelectorAll("path.siren-message-arrow")).flatMap((path) =>
        [path.getAttribute("marker-start"), path.getAttribute("marker-end")].filter(
          (reference): reference is string => reference !== null,
        ),
      ),
    );
    expect(referenced.size).toBe(3);
  });
  it("scopes a sequence diagram's marker ids the same way, so two sequence diagrams on one page share no id and each message's arrowhead resolves inside its own SVG", () => {
    // The third and last renderer with fixed ids: `siren-arrow-filled`,
    // `siren-arrow-cross` and `siren-arrow-open`. The exposure here is the
    // pre-existing invisible one rather than one author styling activated —
    // a sequence marker carries no author color, by board non-goal — and it
    // becomes visible the moment two sequence diagrams sit in *different CSS
    // contexts*, which ADR-0004 invites by letting a consumer scope
    // `--siren-*` to a container: both define `siren-arrow-filled`, the
    // second diagram's `url(#siren-arrow-filled)` resolves to the first's
    // marker, and its arrowheads take the first container's theme.
    const source = `sequenceDiagram
participant Alice
participant Bob
Alice->>Bob: filled
Alice<<->>Bob: bidirectional
Alice-xBob: cross
Alice-)Bob: open
`;
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);

    try {
      const one = render(source, first);
      const two = render(source, second);
      expect([one.diagnostics, two.diagnostics]).toEqual([[], []]);

      const ids = Array.from(document.querySelectorAll("[id]")).map((element) => element.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);

      for (const svg of [one.svg!, two.svg!]) {
        const arrows = Array.from(svg.querySelectorAll("path.siren-message-arrow"));
        expect(arrows.length).toBe(4);
        const referenced = arrows.flatMap((arrow) => [
          arrow.getAttribute("marker-start"),
          arrow.getAttribute("marker-end"),
        ]);
        expect(referenced.filter((reference) => reference !== null).length).toBeGreaterThan(0);
        for (const reference of referenced) {
          if (reference === null) continue;
          expect(reference).toMatch(/^url\(#.+\)$/);
          const id = reference.slice("url(#".length, -1);
          expect(svg.querySelector(`defs > marker#${id}`)).not.toBeNull();
          expect(document.querySelectorAll(`#${id}`)).toHaveLength(1);
        }
      }

      // `filled` and `bidirectionalFilled` still share one marker inside a
      // render — deliberate sharing, since `orient="auto-start-reverse"`
      // makes the one def point outward at either end. Scoping the id must
      // not accidentally split them into two defs.
      expect(one.svg!.querySelectorAll("defs > marker")).toHaveLength(3);
      const arrowOf = (index: number): Element =>
        one.svg!.querySelectorAll("path.siren-message-arrow")[index]!;
      expect(arrowOf(1).getAttribute("marker-end")).toBe(arrowOf(0).getAttribute("marker-end"));
      expect(arrowOf(1).getAttribute("marker-start")).toBe(arrowOf(0).getAttribute("marker-end"));
    } finally {
      first.remove();
      second.remove();
    }
  });
  it("shares no id across a page holding two diagrams of each of the three kinds", () => {
    // The claim the three renderers only make together. 05c could assert it
    // of four flowchart/class diagrams; with the sequence renderer scoped it
    // holds for a page of every kind Siren draws, which is what "no duplicate
    // ids on a page" was supposed to mean all along.
    const sources = [
      `flowchart TD
A[Start] --> B[End]
`,
      `classDiagram
Animal <|-- Duck
Habitat *-- Animal
Duck o-- Feather
Keeper --> Animal
`,
      `sequenceDiagram
participant Alice
participant Bob
Alice->>Bob: filled
Alice-xBob: cross
Alice-)Bob: open
`,
    ];
    const containers = [...sources, ...sources].map(() => document.createElement("div"));
    document.body.append(...containers);

    try {
      const results = [...sources, ...sources].map((source, index) =>
        render(source, containers[index]!),
      );
      expect(results.map((result) => result.diagnostics)).toEqual(results.map(() => []));

      const ids = Array.from(document.querySelectorAll("[id]")).map((element) => element.id);
      // Six diagrams, each minting at least one marker id.
      expect(ids.length).toBeGreaterThanOrEqual(6);
      expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);

      // And every reference on the page resolves inside the SVG that wrote
      // it, which is the consequence a duplicate id would silently break.
      for (const result of results) {
        const svg = result.svg!;
        for (const element of Array.from(svg.querySelectorAll("[marker-start], [marker-end]"))) {
          for (const attribute of ["marker-start", "marker-end"]) {
            const reference = element.getAttribute(attribute);
            if (reference === null) continue;
            const id = reference.slice("url(#".length, -1);
            expect(svg.querySelector(`defs > marker#${id}`)).not.toBeNull();
            expect(document.querySelectorAll(`#${id}`)).toHaveLength(1);
          }
        }
      }
    } finally {
      for (const container of containers) container.remove();
    }
  });

  it("renders demos/flowchart-styling.html's example source (examples/flowchart-styling.srn) end to end with zero diagnostics — `style`, `classDef`, both spellings of the apply-directive, `linkStyle` by index, by list and by `default`, and a `color` beside a `fill`", () => {
    const container = document.createElement("div");

    const result = render(readExample("flowchart-styling"), container);

    // Zero diagnostics of *any* severity, which is a stronger claim than the
    // `examples/` enumeration test above makes: that one filters to error
    // severity, so a warning would slip through it. The closing example is
    // the document a demo page ships, so a warning in it is a defect in one
    // or the other.
    expect(result.diagnostics).toEqual([]);
    expect(container.contains(result.svg!)).toBe(true);
    const svg = result.svg!;

    // The document declares no `timeline:` block, so the controller is the
    // empty one — the styling this example is about needs no animation to
    // be visible.
    expect(result.controller!.totalSteps).toBe(0);

    const nodeIds = Array.from(svg.querySelectorAll("g.siren-node")).map((g) =>
      g.getAttribute("data-siren-id"),
    );
    expect(nodeIds).toEqual(["Source", "Parse", "Resolve", "Layout", "Render", "Output"]);

    const edgeIds = Array.from(svg.querySelectorAll("path.siren-edge")).map((p) =>
      p.getAttribute("data-siren-id"),
    );
    expect(edgeIds).toEqual([
      "Source-Parse",
      "Parse-Resolve",
      "Resolve-Layout",
      "Layout-Render",
      "Render-Output",
    ]);

    const frameStyleOf = (id: string): string | null =>
      svg
        .querySelector(`g.siren-node[data-siren-id="${id}"] rect.siren-node-frame`)!
        .getAttribute("style");
    const labelStyleOf = (id: string): string | null =>
      svg.querySelector(`g.siren-node[data-siren-id="${id}"] text`)!.getAttribute("style");

    // --- `classDef` + the two spellings of the apply-directive ---
    //
    // `classDef stage` reaches `Parse` and `Resolve` through `class
    // Parse,Resolve stage` and `Layout` through the standalone
    // `Layout:::stage`. All three frames are byte-identical, which is the
    // observable form of "the two spellings are one directive": nothing
    // downstream of the parser can tell which one an author wrote.
    const stageFrame = "fill:#3b82f633;stroke:#3b82f6;stroke-width:2";
    expect(frameStyleOf("Parse")).toBe(stageFrame);
    expect(frameStyleOf("Resolve")).toBe(stageFrame);
    expect(frameStyleOf("Layout")).toBe(stageFrame);
    // `stage` names no `color`, so none of the three labels is styled at all.
    expect(labelStyleOf("Parse")).toBeNull();
    expect(labelStyleOf("Resolve")).toBeNull();
    expect(labelStyleOf("Layout")).toBeNull();

    // --- the `A:::name` shorthand written inside an edge line, on both ends ---
    //
    // `Source[Source]:::terminal` is the source end of the first edge and
    // `Output[Output]:::terminal` the target end of the last, so the
    // shorthand is exercised on each side of a `-->`.
    const terminalFrame = "fill:#1e293b;stroke:#0f172a;stroke-width:2";
    expect(frameStyleOf("Source")).toBe(terminalFrame);
    expect(frameStyleOf("Output")).toBe(terminalFrame);

    // --- `color` beside a `fill`, in a `classDef` and in a `style` ---
    //
    // The author writes `color`; the label carries `fill`, because that is
    // what paints SVG text (ADR-0008's amendment). The frame keeps every
    // other property and never sees the word `color`.
    expect(labelStyleOf("Source")).toBe("fill:#f8fafc");
    expect(labelStyleOf("Output")).toBe("fill:#f8fafc");
    expect(frameStyleOf("Render")).toBe("fill:#f59e0b;stroke:#b45309;stroke-width:2");
    expect(labelStyleOf("Render")).toBe("fill:#1f2937");
    for (const id of nodeIds) {
      expect(frameStyleOf(id!)).not.toContain("color:");
    }

    // --- `linkStyle` by index, by list, and by `default` ---
    const edgeStyleOf = (id: string): string | null =>
      svg.querySelector(`path.siren-edge[data-siren-id="${id}"]`)!.getAttribute("style");

    // Edge 0 by index. It keeps the fallback's `stroke-width` and takes the
    // specific statement's `stroke`: the two tiers merge property by
    // property rather than one replacing the other.
    expect(edgeStyleOf("Source-Parse")).toBe("stroke:#f43f5e;stroke-width:2");
    // Edges 1 and 2 are named by no specific statement, so they are what
    // `linkStyle default` is for.
    expect(edgeStyleOf("Parse-Resolve")).toBe("stroke:#94a3b8;stroke-width:2");
    expect(edgeStyleOf("Resolve-Layout")).toBe("stroke:#94a3b8;stroke-width:2");
    // Edges 3 and 4 by one `linkStyle 3,4`, which overrides both fallback
    // properties.
    expect(edgeStyleOf("Layout-Render")).toBe("stroke:#3b82f6;stroke-width:3");
    expect(edgeStyleOf("Render-Output")).toBe("stroke:#3b82f6;stroke-width:3");

    // --- a styled edge's arrowhead takes its color ---
    //
    // Three distinct strokes, so three minted markers, plus the theme's own
    // — which stays defined whether or not any edge references it.
    expect(svg.querySelectorAll("defs > marker")).toHaveLength(4);
    const markerRefOf = (edgeId: string): string =>
      svg.querySelector(`path.siren-edge[data-siren-id="${edgeId}"]`)!.getAttribute("marker-end")!;
    const headFillOf = (edgeId: string): string | null =>
      svg
        .querySelector(`defs > marker#${markerRefOf(edgeId).slice("url(#".length, -1)} path`)!
        .getAttribute("style");

    expect(headFillOf("Source-Parse")).toBe("fill:#f43f5e");
    expect(headFillOf("Parse-Resolve")).toBe("fill:#94a3b8");
    expect(headFillOf("Layout-Render")).toBe("fill:#3b82f6");
    // One marker per distinct color, not per styled edge: the two edges
    // sharing a color share a def.
    expect(markerRefOf("Parse-Resolve")).toBe(markerRefOf("Resolve-Layout"));
    expect(markerRefOf("Layout-Render")).toBe(markerRefOf("Render-Output"));
    expect(markerRefOf("Source-Parse")).not.toBe(markerRefOf("Parse-Resolve"));
  });
  it("renders examples/flowchart-syntax.srn end to end with zero diagnostics — the `graph` header, a chained edge, `&` on either end of an arrow, `;` between two statements on one line, and a quoted label", () => {
    const container = document.createElement("div");

    const result = render(readExample("flowchart-syntax"), container);

    // Zero diagnostics of *any* severity, as the two closing examples before
    // this one assert: the `examples/` enumeration test above filters to
    // error severity, so a warning would slip through it.
    expect(result.diagnostics).toEqual([]);
    expect(container.contains(result.svg!)).toBe(true);
    const svg = result.svg!;

    // --- the four spellings, in the document itself ---
    //
    // The picture assertions below are deliberately the picture the *longhand*
    // spelling would draw too — that is what "a way of writing the same eight
    // edges" means, and it is why they cannot pin what this file exists for.
    // Rewriting it as eight ordinary `A --> B` lines would leave every one of
    // them green and quietly cost the repository its only example of the
    // syntax this board taught. So the file's job is asserted here, once,
    // against its own text.
    const declarations = readExample("flowchart-syntax")
      .split("\n")
      .map((line) => line.replace(/%%.*$/, "").trim())
      .filter((line) => line.length > 0);
    const declares = (what: string, pattern: RegExp): void => {
      const written = declarations.filter((line) => pattern.test(line));
      expect(written, `examples/flowchart-syntax.srn no longer declares ${what}`).not.toEqual([]);
    };
    // `graph`, not `flowchart` — Mermaid's original spelling of the keyword.
    expect(declarations[0]).toBe("graph LR");
    declares("a chained edge", /-->[^>]*-->/);
    declares("`&` on the target end of an arrow", /-->[^&]*&/);
    declares("`&` on the source end of an arrow", /&[^&]*-->/);
    declares("two statements on one line, separated by `;`", /-->.*;.*-->/);
    declares("a quoted label", /\["/);

    // Every expectation below is what **mermaid 11.17.2 itself** records for
    // this document, read out with `packages/core/scripts/mermaid-probe.mjs`
    // — eight vertices and eight edges, in this order. The example exists to
    // show the spellings this board taught the parser, so the thing worth
    // asserting is that Mermaid's reading of it and Siren's are the same
    // picture, not that some picture appeared.
    const nodeIds = Array.from(svg.querySelectorAll("g.siren-node")).map((g) =>
      g.getAttribute("data-siren-id"),
    );
    expect(nodeIds).toEqual([
      "Ingest",
      "Parse",
      "Check",
      "Model",
      "Style",
      "Layout",
      "Render",
      "Output",
    ]);

    const labelOf = (id: string): string | null =>
      svg.querySelector(`g.siren-node[data-siren-id="${id}"] text`)!.textContent;
    // The quoted labels: Mermaid says `text="Ingest, raw"` and
    // `text="Done, at last"`. The quotes are syntax and are not drawn; the
    // comma they were fencing survives.
    expect(labelOf("Ingest")).toBe("Ingest, raw");
    expect(labelOf("Output")).toBe("Done, at last");
    // An implicitly created node is labelled with its own id, quoted or not.
    expect(labelOf("Parse")).toBe("Parse");

    const edgeIds = Array.from(svg.querySelectorAll("path.siren-edge")).map((p) =>
      p.getAttribute("data-siren-id"),
    );
    expect(edgeIds).toEqual([
      // A chain: `Ingest --> Parse --> Check` is two edges, not one.
      "Ingest-Parse",
      "Parse-Check",
      // `&` on the target end: one arrow, two edges out of `Check`.
      "Check-Model",
      "Check-Style",
      // `&` on the source end: two edges into `Layout`.
      "Model-Layout",
      "Style-Layout",
      // `;` ends a statement, so this one line declares both of these.
      "Layout-Render",
      "Render-Output",
    ]);

    // An edge that no line declared on its own is still addressable by the
    // `${from}-${to}` id `timeline:` uses — which is the consequence of this
    // board that an author actually feels: the shorthand spellings are a way
    // of writing edges, not a different kind of edge.
    expect(result.controller!.totalSteps).toBe(6);
    const animatable = (id: string) =>
      svg.querySelectorAll(`[data-siren-id="${id}"]`).length;
    expect(animatable("Ingest-Parse")).toBe(1);
    expect(animatable("Check-Style")).toBe(1);
    expect(animatable("Render-Output")).toBe(1);
  });
});
