import { describe, expect, it } from "vitest";
import { render, type InteractionTarget } from "./index";
import type { SirenRenderResult, TextMeasurer } from "./contracts";
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
enter A fade
enter B fade
`;

/** A document exercising all four timeline verbs plus a slide-* effect, across 5 steps. */
const ALL_VERBS_SOURCE = `flowchart TD
A[Start] --> B[Middle]
B --> C[End]
timeline:
enter A slide-left
enter B fade
highlight A outline
exit A fade
unhighlight B
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
enter B fade
enter C fade
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
enter B fade
enter C fade
`,
      `classDiagram
Animal <|-- Duck
timeline:
enter Duck fade
enter Animal-Duck slide-left
`,
      `sequenceDiagram
participant A
participant B
A->>B: Hello
timeline:
  enter A fade
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
enter GHOST fade
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
enter B fade
enter C fade
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
    // Written as Mermaid's entity codes: a bare `<script>` is a tag, and is
    // removed with its content (ADR-0015); the codes draw its characters.
    const source = `flowchart TD
A[#lt;script#gt;alert(1)#lt;/script#gt;] --> B[End]
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

  it("creates the participant a sequenceDiagram message names without declaring it, as Mermaid does", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant A
A->>GHOST: Hello
`;

    let result: SirenRenderResult | undefined;
    expect(() => {
      result = render(source, container);
    }).not.toThrow();

    expect(result!.diagnostics).toEqual([]);
    expect(result!.svg!.querySelector('g.siren-participant[data-siren-id="GHOST"]')).not.toBeNull();
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

    // Header and branch conditions come through as literal text, bracketed
    // the way Mermaid itself draws a block's condition.
    const labelsOf = (id: string) =>
      Array.from(byId(id).querySelectorAll(":scope > text.siren-block-label")).map(
        (t) => t.textContent,
      );
    expect(labelsOf("loop:1")).toEqual(["[Every minute]"]);
    expect(labelsOf("alt:1")).toEqual(["[is fresh]", "[is stale]", "[is missing]"]);
    expect(labelsOf("par:1")).toEqual(["[Fan out]", "[Second branch]"]);
    expect(labelsOf("critical:1")).toEqual(["[Acquire lock]", "[Timeout]"]);
    expect(labelsOf("break:1")).toEqual(["[Fatal error]"]);
    expect(labelsOf("opt:1")).toEqual(["[Warm the cache]"]);

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
    // Mermaid's cleanupText rewrites `="…"` inside a tag-shaped stretch as `='…'` (measured, mermaid 11.17.2).
    expect(result.svg!.querySelector("text.siren-block-label")!.textContent).toBe(
      "[<img src=x onerror='alert(1)'>]",
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
    // The example's own `timeline:` block, eight steps of it. What those steps
    // drive is asserted by the timeline test at the end of this file; here it
    // is only pinned so that a structural change to the example cannot quietly
    // drop it.
    expect(result.controller!.totalSteps).toBe(8);
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
enter Duck fade
enter Animal-Duck slide-left
highlight Duck glow
unhighlight Duck
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

  it("lands a classDiagram relationship's highlight and exit on both its line group and its label group (ADR-0016)", () => {
    const container = document.createElement("div");
    const source = `classDiagram
Animal "1" --> "*" Duck : feeds
timeline:
highlight Animal-Duck glow
exit Animal-Duck fade
`;

    const result = render(source, container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const line = result.svg!.querySelector('g.siren-relationship[data-siren-id="Animal-Duck"]')!;
    const labels = result.svg!.querySelector(
      'g.siren-relationship-labels[data-siren-id="Animal-Duck"]',
    );
    expect(labels).not.toBeNull();

    result.controller!.next();
    expect(line.classList.contains("siren-highlight-glow")).toBe(true);
    expect(labels!.classList.contains("siren-highlight-glow")).toBe(true);

    result.controller!.next();
    expect(line.classList.contains("siren-exit-fade")).toBe(true);
    expect(labels!.classList.contains("siren-exit-fade")).toBe(true);
  });

  it("lands a classDiagram note's exit on both its box and its connector, though the connector paints under the classes (ADR-0016)", () => {
    const container = document.createElement("div");
    const source = `classDiagram
class Duck
note for Duck "can fly"
timeline:
exit note:1 fade
`;

    const result = render(source, container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const box = result.svg!.querySelector('g.siren-note[data-siren-id="note:1"]')!;
    const link = result.svg!.querySelector('path.siren-note-link[data-siren-id="note:1"]');
    expect(link).not.toBeNull();

    result.controller!.next();
    expect(box.classList.contains("siren-exit-fade")).toBe(true);
    expect(link!.classList.contains("siren-exit-fade")).toBe(true);
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
      'g.siren-relationship-labels[data-siren-id="Keeper-Animal"]',
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
    expect(result.svg!.querySelector('path.siren-note-link[data-siren-id="note:1"]')).toBeNull();
    expect(result.svg!.querySelector('path.siren-note-link[data-siren-id="note:2"]')).not.toBeNull();
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
highlight B outline
enter B fade
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
        result.svg!.querySelectorAll(`[data-siren-id="${id}"] ${selector}`),
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
    // `Smuggles` is `fill:red`, not a `#` color: a `#` would make it a Mermaid style line, whose last `;` is dropped before the gate sees it.
    const source = `classDiagram
class Fetches
class Executes
class Smuggles
class Escapes
Fetches -- Executes
Smuggles -- Escapes
style Fetches fill:url(#evil),stroke:#c00
style Executes fill:expression(alert(1)),stroke:#c00
style Smuggles fill:red;position:fixed,stroke:#c00
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
    // The relationship label and the note are labels, where a bare tag is
    // read (ADR-0015), so their markup is written as Mermaid's entity codes.
    // A namespace label is deliberately absent from this list: `namespace \w+`
    // is the whole grammar, so a namespace name cannot spell markup in the
    // first place. Every *other* free-text position in a classDiagram is here.
    const source = `classDiagram
class Sneaky {
  <<${injected}>>
  +<b>bold</b> field
}
class Plain
Sneaky "<i>1</i>" --> "<i>*</i>" Plain : #lt;svg onload=alert(1)#gt;
note for Plain "#lt;iframe src=javascript:alert(1)#gt;#lt;/iframe#gt;"
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
        result.svg!.querySelectorAll(`[data-siren-id="${id}"] ${selector}`),
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
    expect(result.svg!.querySelector('path.siren-note-link[data-siren-id="note:1"]')).toBeNull();
    expect(result.svg!.querySelector('path.siren-note-link[data-siren-id="note:2"]')).not.toBeNull();

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

    // Ids, not elements: an attached note's box and its connector are two
    // elements wearing one id (ADR-0016), and both start hidden.
    const pendingIds = () =>
      [
        ...new Set(
          Array.from(result.svg!.querySelectorAll(".siren-pending")).map((el) =>
            el.getAttribute("data-siren-id"),
          ),
        ),
      ].sort();

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

  it("lets a timeline name a sequence note, which starts hidden and enters on its step", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant A
participant B
A->>B: Hello
note right of B: Thinking
timeline:
  enter note:1 fade
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const controller = result.controller!;
    expect(controller.totalSteps).toBe(1);

    const note = () => Array.from(result.svg!.querySelectorAll('[data-siren-id="note:1"]'));
    expect(note().length).toBeGreaterThan(0);
    expect(note().map((el) => el.classList.contains("siren-pending"))).toEqual(note().map(() => true));

    controller.next();

    expect(note().map((el) => el.classList.contains("siren-enter-fade"))).toEqual(note().map(() => true));
    expect(note().map((el) => el.classList.contains("siren-pending"))).toEqual(note().map(() => false));
  });

  it("lets a timeline name a sequence activation bar by its generated id", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant A
participant B
A->>+B: Hello
B-->>-A: Hi
timeline:
  highlight activation:1 glow
`;

    const result = render(source, container);

    expect(result.diagnostics).toEqual([]);
    const bar = () => Array.from(result.svg!.querySelectorAll('[data-siren-id="activation:1"]'));
    expect(bar().length).toBeGreaterThan(0);
    expect(bar().map((el) => el.classList.contains("siren-highlight-glow"))).toEqual(bar().map(() => false));

    result.controller!.next();

    expect(bar().map((el) => el.classList.contains("siren-highlight-glow"))).toEqual(bar().map(() => true));
  });

  it("still reports a note or activation id the diagram does not have as unknown", () => {
    const source = `sequenceDiagram
participant A
participant B
A->>+B: Hello
note over A: Only one note
B-->>-A: Hi
timeline:
  enter note:9 fade
  highlight activation:9 glow
`;

    const result = render(source, document.createElement("div"));

    expect(result.diagnostics.map((d) => d.message)).toEqual([
      'timeline: references unknown id "note:9"',
      'timeline: references unknown id "activation:9"',
    ]);
  });

  it("drives every element carrying a sequence participant's id — both participant rows and the lifeline — from one timeline entry", () => {
    const container = document.createElement("div");
    const source = `sequenceDiagram
participant A
participant B
A->>B: Hello
timeline:
  enter A fade
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
  exit A fade
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
  highlight B outline
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
  enter box:1 fade
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
  highlight loop:1 outline
  highlight alt:1 glow
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
    expect(loopGroup.querySelector("text.siren-block-label")!.textContent).toBe("[retry]");
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


  it("drives examples/sequence-full.srn's timeline through five addressable kinds — a box grouping, a message, a control-flow block, a participant and a note — with zero diagnostics, next(), prev() and reset()", () => {
    const container = document.createElement("div");
    const source = readExample("sequence-full");

    // Drift guard: the source above is read from examples/sequence-full.srn
    // on disk, not from an inline copy, so editing the example changes what
    // this test renders. The marker is the example's own final timeline step.
    expect(source).toContain("enter note:1 fade");

    const result = render(source, container);

    // Zero diagnostics, not merely zero errors: the closing example has to be
    // clean against the advisory message-outlives-its-participant warning too,
    // which is why `Retry` and the one message touching it exit together.
    expect(result.diagnostics).toEqual([]);
    const controller = result.controller!;
    expect(controller.totalSteps).toBe(8);

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
      "note:1",
    ]);

    const boxGroup = result.svg!.querySelector('[data-siren-id="box:1"]')!;
    const openCheckout = result.svg!.querySelector('g.siren-message[data-siren-id="Shopper-Web"]')!;
    const createDraft = result.svg!.querySelector('g.siren-message[data-siren-id="Web-Orders"]')!;
    const loopBlock = result.svg!.querySelector('[data-siren-id="loop:1"]')!;
    const rectBlock = result.svg!.querySelector('[data-siren-id="rect:1"]')!;
    const scheduleRetry = result.svg!.querySelector('g.siren-message[data-siren-id="Web-Retry"]')!;
    const receiptNote = result.svg!.querySelector('[data-siren-id="note:1"]')!;
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
    expect(boxGroup.classList.contains("siren-exit-fade")).toBe(true);

    // Step 8: a note enters, named by its generated id.
    controller.next();
    expect(controller.currentStep).toBe(8);
    expect(receiptNote.classList.contains("siren-pending")).toBe(false);
    expect(receiptNote.classList.contains("siren-enter-fade")).toBe(true);

    // Stepping back undoes exactly the last step.
    controller.prev();
    expect(receiptNote.classList.contains("siren-pending")).toBe(true);
    expect(boxGroup.classList.contains("siren-exit-fade")).toBe(true);

    controller.prev();
    expect(boxGroup.classList.contains("siren-exit-fade")).toBe(false);
    expect(rectBlock.classList.contains("siren-highlight-outline")).toBe(true);

    // And reset returns all five kinds to their initial state.
    controller.reset();
    expect(controller.currentStep).toBe(0);
    expect(pendingIds()).toEqual([
      "Retry",
      "Retry",
      "Retry",
      "Shopper-Web",
      "Web-Retry",
      "box:1",
      "note:1",
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
enter A fade
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
   * translated into positions, with `pnpm --filter siren-core probe`
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
enter A fade
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
   * (`pnpm --filter siren-core probe`).
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
enter A fade
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

  /**
   * The three spellings drawn with a curve, each with the thing that makes
   * it that shape *in the picture* and the fit its label is owed inside it.
   *
   * Which spelling names which shape is measured, not remembered: mermaid
   * 11.17.2 reads `A((Circle))` as `type="circle"`, `A(((Double)))` as
   * `type="doublecircle"` and `A[(DB)]` as `type="cylinder"`
   * (`pnpm --filter siren-core probe`).
   *
   * `drawn` is handed the frame elements and the label's own measured box
   * and asserts both halves at once: the shape is there, and the label is
   * inside it. Splitting those would let a circle that draws itself and
   * then clips its own text pass.
   */
  const CURVED_SHAPES = [
    {
      shape: "circle",
      spelling: "A((Circle))",
      label: "Circle",
      drawn: (frames: Element[], label: { width: number; height: number }) => {
        expect(frames.map((f) => f.tagName)).toEqual(["circle"]);
        const r = Number(frames[0].getAttribute("r"));
        // The label's **corner** is inside the circle, not merely its
        // width: a circle sized to the width would clip all four corners,
        // and that is the whole difference this shape makes to layout.
        expect(Math.hypot(label.width / 2, label.height / 2)).toBeLessThanOrEqual(r);
        // And the cost of that, stated rather than hidden: the node is as
        // tall as it is wide, which for a label wider than it is tall means
        // a very large node. `Circle` is 6 characters — 64 wide, 32 tall
        // measured — so the circle is over twice as tall as the rectangle
        // holding the same text.
        expect(2 * r).toBeGreaterThan(2 * label.height);
      },
    },
    {
      shape: "double-circle",
      spelling: "A(((Double)))",
      label: "Double",
      drawn: (frames: Element[], label: { width: number; height: number }) => {
        expect(frames.map((f) => f.tagName)).toEqual(["circle", "circle"]);
        // Two rings and not one drawn twice: same centre, different radii.
        expect(frames.map((f) => [f.getAttribute("cx"), f.getAttribute("cy")])).toEqual([
          frames.map((f) => [f.getAttribute("cx"), f.getAttribute("cy")])[0],
          frames.map((f) => [f.getAttribute("cx"), f.getAttribute("cy")])[0],
        ]);
        const [outer, inner] = frames.map((f) => Number(f.getAttribute("r")));
        expect(inner).toBeLessThan(outer);
        // The label clears the **inner** ring, which is the only reason the
        // outer one is bigger than a plain circle's would be.
        expect(Math.hypot(label.width / 2, label.height / 2)).toBeLessThanOrEqual(inner);
      },
    },
    {
      shape: "cylinder",
      spelling: "A[(DB)]",
      label: "DB",
      drawn: (frames: Element[], label: { width: number; height: number }) => {
        expect(frames.map((f) => f.tagName)).toEqual(["path"]);
        const d = frames[0].getAttribute("d")!;
        // The lid is what makes this a cylinder rather than the rounded
        // rectangle a tube alone would be: two closed subpaths, four arcs.
        expect(d.match(/Z/g)).toHaveLength(2);
        expect(d.match(/A/g)).toHaveLength(4);

        // Read the figure back off the path: the arcs' radii, and the four
        // corner points where the straight sides meet the curves.
        const [rx, ry] = [...d.matchAll(/A([\d.]+),([\d.]+)/g)][0].slice(1).map(Number);
        const points = [...d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((m) => [
          Number(m[1]),
          Number(m[2]),
        ]);
        const ys = points.map(([, y]) => y);
        const lid = Math.min(...ys);
        const base = Math.max(...ys);
        // The lid spans the tube, so it is the top of the shape rather than
        // an ellipse floating inside it.
        const xs = points.map(([x]) => x);
        expect(Math.max(...xs) - Math.min(...xs)).toBe(2 * rx);

        // The label is centred on the box — `lid - ry` to `base + ry` — and
        // clears the lowest point of the lid and the top of the bulge.
        const middle = (lid - ry + base + ry) / 2;
        expect(middle - label.height / 2).toBeGreaterThanOrEqual(lid + ry);
        expect(middle + label.height / 2).toBeLessThanOrEqual(base);
      },
    },
  ] as const;

  it.each(CURVED_SHAPES.map((spec) => [spec.spelling, spec.shape, spec] as const))(
    "draws `%s` end to end as a styleable, animatable %s",
    (_spelling, _shape, { shape, spelling, label, drawn }) => {
      // The whole vertical slice through one public call, for the last
      // three spellings Mermaid has: it parses, the thing that makes it
      // that shape is drawn, the label fits inside it, and the two things a
      // rectangle already had — an author's `style` and a place on the
      // timeline — reach it unchanged.
      const container = document.createElement("div");
      const result = render(
        `flowchart TD
${spelling} --> B[Ship it]
style A fill:#f00
timeline:
enter A fade
`,
        container,
      );

      expect([shape, result.diagnostics]).toEqual([shape, []]);

      const group = result.svg!.querySelector('g.siren-node[data-siren-id="A"]')!;
      const frames = Array.from(group.querySelectorAll(".siren-node-frame"));

      // The picture first. `data-siren-shape` is checked after and never
      // instead: board 4 reclassified two corpus rows on exactly that
      // point, and an attribute is not the picture.
      drawn(frames, { width: label.length * 8 + 16, height: 24 + 8 });
      expect([shape, group.getAttribute("data-siren-shape")]).toEqual([shape, shape]);

      // The punctuation was syntax, so the label is the text inside it.
      expect([shape, group.querySelector("text")!.textContent]).toEqual([shape, label]);

      // ADR-0008's placement, on every element the frame is drawn with — so
      // a double circle's author `fill` paints both rings rather than
      // leaving a white disc inside a coloured one.
      for (const frame of frames) {
        expect([shape, frame.getAttribute("style")]).toEqual([shape, "fill:#f00"]);
      }

      // And it animates: the id and the animation classes are on the `<g>`,
      // so the controller drives these three without knowing shapes exist.
      expect([shape, group.classList.contains("siren-pending")]).toEqual([shape, true]);
      result.controller!.next();
      expect([shape, group.classList.contains("siren-pending")]).toEqual([shape, false]);
      expect([shape, group.classList.contains("siren-enter-fade")]).toEqual([shape, true]);
      for (const frame of frames) {
        expect([shape, frame.getAttribute("style")]).toEqual([shape, "fill:#f00"]);
      }
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
    // fill class used to be in this list, because the theme's one
    // `<marker>` was minted into `<defs>` whether or not anything referenced
    // it. It no longer is: a marker is minted per (end shape, colour) pair
    // an edge actually draws, and these documents draw no edge at all. A
    // fact about the renderer rather than about these six, and it was on
    // both sides of the comparison above either way.
    expect(shaped).toEqual(["siren-node", "siren-node-frame"]);
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
    expect(shaped).toEqual(["siren-node", "siren-node-frame"]);

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

  it("gives the three curved shapes no `siren-*` class of their own either — including a double circle's second ring", () => {
    // The question asked of ticket 02's six and ticket 03's three, asked a
    // last time where a new class was most likely: a double circle draws
    // two elements, and a second element is where a `siren-node-ring` gets
    // invented. It is not one — both rings wear `siren-node-frame` — so the
    // answer to "do these shapes emit a class a rectangle does not" is no,
    // and `theme/default.test.ts`'s coverage net needs no new rule. It does
    // still need these shapes *in its fixture*: a net can only see classes
    // something it renders emits, and a claim and a fixture that could
    // disprove it are not the same thing.
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
A((Circle))
B(((Double)))
C[(DB)]
`);
    const rectangles = sirenClasses(`flowchart TD
A[Circle]
B[Double]
C[DB]
`);

    expect(shaped).toEqual(rectangles);
    expect(shaped).toEqual(["siren-node", "siren-node-frame"]);

    // And a double circle's rings both wear the frame's own name rather
    // than one of them going unnamed, which is what puts them in one
    // styling story — the theme fills the inner ring because it fills a
    // frame, and so does an author's `style B fill:#fdd`.
    const container = document.createElement("div");
    const result = render(`flowchart TD\nB(((Double)))\n`, container);
    const parts = Array.from(
      result.svg!.querySelectorAll('g.siren-node[data-siren-id="B"] > *'),
    ).filter((element) => element.tagName !== "text");
    expect(parts.map((element) => [element.tagName, element.getAttribute("class")])).toEqual([
      ["circle", "siren-node-frame"],
      ["circle", "siren-node-frame"],
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

  it("says nothing about a `style` on an id that does not exist, whichever diagram kind wrote it", () => {
    // One resolver, one rule, one silence. Mermaid accepts this statement in
    // both kinds and reports nothing (measured, 11.17.2): a flowchart makes
    // no vertex called `Ghost` and a class diagram no class. The two kinds
    // are compared as whole diagnostics lists so that a future divergence —
    // one kind starting to speak again — fails here rather than being found
    // by an author.
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

    expect(flowchart.diagnostics).toEqual([]);
    expect(flowchart.diagnostics).toEqual(classDiagram.diagnostics);
    // And the silence is a rendered document, not a swallowed one: each kind
    // still draws the element the author did declare, and neither conjures
    // one for the name it did not.
    expect(
      Array.from(flowchart.svg!.querySelectorAll("g.siren-node"), (g) =>
        g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["A"]);
    expect(
      Array.from(classDiagram.svg!.querySelectorAll("g.siren-class"), (g) =>
        g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["Shape"]);
  });

  it("holds the style-value gate identically for a flowchart: the refused value never reaches the attribute, its sibling does, and the message is word-for-word the class diagram's", () => {
    const container = document.createElement("div");
    // `Smuggles` is `fill:red`, not a `#` color: a `#` would make it a Mermaid style line, whose last `;` is dropped before the gate sees it.
    const source = `flowchart TD
Fetches[Fetches] --> Executes[Executes]
Smuggles[Smuggles] --> Escapes[Escapes]
style Fetches fill:url(#evil),stroke:#c00
style Executes fill:expression(alert(1)),stroke:#c00
style Smuggles fill:red;position:fixed,stroke:#c00
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
enter B fade
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

  it("drops only the unknown target of a flowchart `class A,Ghost name` and says nothing about it, while still naming the keyword the author actually typed when no classDef defines the name", () => {
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
      // Nothing between these two for `Ghost` on line 5: a *target* that does
      // not exist is dropped in silence, exactly as Mermaid drops it. An
      // undefined classDef *name* still speaks — the two are different
      // mistakes, and only the first is one Mermaid also tolerates.
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
    // An **unlabelled** edge is one `<path class="siren-edge">` and draws no
    // text at all, so the author's `color` has nowhere to land here.
    // `resolveStyles` routes it into the text half anyway — the rule is
    // about what a declaration *means*, and a resolver that asked "is this
    // an edge?" would be the per-kind opinion the split exists to prevent —
    // and this document simply has no element to apply it to. An edge that
    // carries a label does, and takes it; that is the test further down
    // ("paints an edge's label with `linkStyle`'s `color`"), and the two
    // together are the whole of where the text half goes.
    //
    // What must not happen either way is the declaration landing on the
    // drawn shape instead, where `color` paints nothing and the author is
    // told nothing.
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
enter A-B fade
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

    // Eleven green edges, all pointing at one marker; the twelfth is blue
    // and has its own. Two, not three: the theme's own marker used to be
    // defined unconditionally, and is now minted only when an edge actually
    // draws it — every edge here is coloured, so nothing references it.
    expect(svg.querySelectorAll("defs > marker")).toHaveLength(2);

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
    // Three distinct strokes, so three minted markers — and no fourth: the
    // theme's own is minted only when an edge draws it, and `linkStyle
    // default` here colours every edge in the document.
    expect(svg.querySelectorAll("defs > marker")).toHaveLength(3);
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

  it("renders examples/flowchart-shapes.srn end to end with zero diagnostics — all fourteen of Mermaid's bracket spellings for a node, each drawing the figure it names", () => {
    const container = document.createElement("div");

    const result = render(readExample("flowchart-shapes"), container);

    // Zero diagnostics of *any* severity, as every closing example before
    // this one asserts: the `examples/` enumeration test above filters to
    // error severity, so a warning would slip through it.
    expect(result.diagnostics).toEqual([]);
    expect(container.contains(result.svg!)).toBe(true);
    const svg = result.svg!;

    // --- the fourteen spellings, in the document itself ---
    //
    // **Asserted against the file's own text, and not only against its
    // picture.** The picture below catches a rewrite into fourteen
    // rectangles — that much was checked by doing it — but it cannot catch
    // a rewrite into a *different spelling of the same figures*, and there
    // is a known one coming: Mermaid v11's `A@{ shape: cyl }` is this
    // board's named non-goal and its own board later. A document rewritten
    // that way would draw an identical picture and quietly cost the
    // repository its only example of the bracket layer, with every
    // assertion below still green. Board 4's closing ticket found the same
    // hole in the same place, one board earlier.
    //
    // The patterns match punctuation only. Renaming a node or retitling a
    // label is an edit to this example nobody should have to defend to a
    // test; deleting the `[[…]]` that makes one a subroutine is not.
    const declarations = readExample("flowchart-shapes")
      .split("\n")
      .map((line) => line.replace(/%%.*$/, "").trim())
      .filter((line) => line.length > 0);
    const declares = (shape: string, spelling: string, pattern: RegExp): void => {
      const written = declarations.filter((line) => pattern.test(line));
      expect(
        written,
        `examples/flowchart-shapes.srn no longer declares the ${shape}, \`${spelling}\``,
      ).not.toEqual([]);
    };
    expect(declarations[0]).toBe("flowchart LR");
    declares("rectangle", "A[text]", /\w\[[^[(/\\][^\]]*\]/);
    declares("round node", "A(text)", /\w\([^([][^)]*\)/);
    declares("stadium", "A([text])", /\(\[[^\]]*\]\)/);
    declares("subroutine", "A[[text]]", /\[\[[^\]]*\]\]/);
    declares("cylinder", "A[(text)]", /\[\([^)]*\)\]/);
    declares("circle", "A((text))", /\w\(\([^(][^)]*\)\)/);
    declares("double circle", "A(((text)))", /\(\(\([^)]*\)\)\)/);
    declares("asymmetric flag", "A>text]", /\w>[^\]]*\]/);
    declares("rhombus", "A{text}", /\w\{[^{][^}]*\}/);
    declares("hexagon", "A{{text}}", /\{\{[^}]*\}\}/);
    declares("parallelogram", "A[/text/]", /\[\/[^\\]*\/\]/);
    declares("parallelogram-alt", "A[\\text\\]", /\[\\[^/]*\\\]/);
    declares("trapezoid", "A[/text\\]", /\[\/[^\\]*\\\]/);
    declares("trapezoid-alt", "A[\\text/]", /\[\\[^/]*\/\]/);

    /**
     * What the renderer *drew* for one node, named by the technique it was
     * drawn with rather than by what the node claims to be.
     *
     * Six answers across fourteen shapes, which is the honest reach of this
     * reader and is deliberately not more: `src/compat/corpus.ts` already
     * names each of the fourteen outlines exactly (`nodeOutline`), and the
     * three `it.each` blocks above already walk every spelling's vertices.
     * A third copy of that reading here would pin the example against the
     * renderer twice over and tell nobody anything new. What this one is
     * for is the failure a *document* can have: losing the shapes it exists
     * to demonstrate. Rewriting all fourteen nodes as `X[label]` collapses
     * every entry below onto one answer, which is what it has to catch.
     */
    const drawnAs = (group: Element): string => {
      const frames = Array.from(group.querySelectorAll(".siren-node-frame"));
      if (frames.length === 0) return "nothing named siren-node-frame";
      if (frames.every((f) => f.tagName === "circle")) {
        const centres = new Set(
          frames.map((f) => `${f.getAttribute("cx")},${f.getAttribute("cy")}`),
        );
        // Concentric, and counted. A double circle's first frame is a
        // `<circle>` exactly as a plain circle's is, so stopping at the
        // first element would name both of them the same thing.
        return frames.length === 1
          ? "one <circle>"
          : `${frames.length} <circle>s about ${centres.size} centre`;
      }
      if (frames[0].tagName === "path") return "a <path>";
      if (frames[0].tagName !== "rect") return `an unnamed <${frames[0].tagName}> frame`;

      // Four of the fourteen are a `<rect>`, so the tag name names none of
      // them. What separates them is the corner radius the *renderer* gave
      // the box — written inline, or not written at all when the corners
      // are `--siren-node-border-radius`'s business — and the inner bars a
      // subroutine draws beside it.
      const height = Number(frames[0].getAttribute("height"));
      const declared = (frames[0].getAttribute("style") ?? "").match(/rx:\s*([\d.]+)px/);
      const corners =
        declared === null
          ? "the theme's corners"
          : Number(declared[1]) === height / 2
            ? "semicircular ends"
            : "a corner radius of its own";
      const bars = group.querySelectorAll("line.siren-node-frame").length;
      return bars === 0
        ? `a <rect> with ${corners}`
        : `a <rect> with ${corners} and ${bars} inner bars`;
    };

    // Every expectation below is what **mermaid 11.17.2 itself** records for
    // this document, read out with `packages/core/scripts/mermaid-probe.mjs`
    // — fourteen vertices, in this order, with these types. Mermaid's names
    // for them are its own (`square`, `lean_right`, `lean_left`, `odd`,
    // `doublecircle`, `inv_trapezoid`); the middle column is Siren's
    // `NodeShape` spelling of the same figure, and the mapping is the whole
    // of what "the same diagram" means here — the board's decision 1 leaves
    // the proportions to the theme and holds only the kind.
    const nodes = Array.from(svg.querySelectorAll("g.siren-node")).map((g) => [
      g.getAttribute("data-siren-id"),
      // The picture first, and `data-siren-shape` after it and never
      // instead: board 4 reclassified two corpus rows on exactly that
      // point, and an attribute is not the picture.
      drawnAs(g),
      g.getAttribute("data-siren-shape"),
    ]);
    expect(nodes).toEqual([
      // Mermaid: type="stadium"
      ["Start", "a <rect> with semicircular ends", "stadium"],
      // Mermaid: type="lean_right"
      ["Intake", "a <path>", "parallelogram"],
      // Mermaid: type="hexagon"
      ["Prep", "a <path>", "hexagon"],
      // Mermaid: type="diamond"
      ["Check", "a <path>", "rhombus"],
      // Mermaid: type="square" — the one shape Siren has always drawn.
      ["Parse", "a <rect> with the theme's corners", "rect"],
      // Mermaid: type="cylinder"
      ["Store", "a <path>", "cylinder"],
      // Mermaid: type="subroutine"
      ["Render", "a <rect> with the theme's corners and 2 inner bars", "subroutine"],
      // Mermaid: type="lean_left"
      ["Log", "a <path>", "parallelogram-alt"],
      // Mermaid: type="doublecircle"
      ["Done", "2 <circle>s about 1 centre", "double-circle"],
      // Mermaid: type="trapezoid"
      ["Review", "a <path>", "trapezoid"],
      // Mermaid: type="inv_trapezoid"
      ["Entry", "a <path>", "trapezoid-alt"],
      // Mermaid: type="circle"
      ["Hop", "one <circle>", "circle"],
      // Mermaid: type="round"
      ["Retry", "a <rect> with a corner radius of its own", "round"],
      // Mermaid: type="odd"
      ["Flag", "a <path>", "asymmetric"],
    ]);

    // Fourteen distinct shapes, not fourteen nodes that happen to include a
    // few: this is the file's whole reason to exist, and the assertion above
    // would still pass with a shape drawn twice and another one missing if
    // someone edited both columns to agree.
    const shapes = nodes.map(([, , shape]) => shape);
    expect(new Set(shapes).size).toBe(14);

    // --- and every one of them animates, whatever element draws it ---
    //
    // The board's outcome claim, made by a document rather than by a unit
    // test: a `<path>` frame, a `<circle>` frame and a `<rect>` frame all
    // animate exactly as a rectangle already did, because the id and the
    // animation classes are on the enclosing `<g>` and the controller has
    // never known that shapes exist (the board's decision 3). A shape that
    // could be drawn but not revealed would be half a feature, and nothing
    // in the picture above would say so.
    expect(result.controller!.totalSteps).toBe(9);
    const pending = () =>
      Array.from(svg.querySelectorAll("g.siren-node.siren-pending"))
        .map((g) => g.getAttribute("data-siren-id"))
        .sort();
    // Every one of the fourteen is a timeline target, so at step 0 the
    // whole diagram is waiting — including the four the timeline would
    // reach by accident if it named only the `<path>`-drawn ones.
    expect(pending()).toEqual(nodes.map(([id]) => id).sort());
    for (let step = 0; step < result.controller!.totalSteps; step += 1) {
      result.controller!.next();
    }
    expect(pending()).toEqual([]);
  });
  it("renders examples/flowchart-edges.srn end to end with zero diagnostics — every arrow form, both label spellings, a long arrow, a nested subgraph, and `linkStyle` reaching a label", () => {
    const container = document.createElement("div");

    const result = render(readExample("flowchart-edges"), container);

    // Zero diagnostics of *any* severity, as every closing example before
    // this one asserts: the `examples/` enumeration test above filters to
    // error severity, so a warning would slip through it. That the
    // enumeration test picks this file up at all with no wiring was checked
    // rather than assumed — a `direction LR` planted inside its nested
    // subgraph made it fail, by name.
    expect(result.diagnostics).toEqual([]);
    expect(container.contains(result.svg!)).toBe(true);
    const svg = result.svg!;

    // --- the seventeen spellings, in the document's own text ---
    //
    // **Asserted against the file's text, and not only against its
    // picture.** The picture below cannot see the difference between two
    // spellings of one drawing, and this file carries three such pairs by
    // construction: `A -.-> B` and `A .-> B` are one dotted arrow,
    // `A -->|x| B` and `A -- x --> B` are one labelled edge, and
    // `A -. x .-> B` and `A -.->|x| B` are one labelled dotted edge.
    // Rewriting either half of any pair into the other leaves every picture
    // assertion below green — checked, by doing it — and quietly costs the
    // repository its only example of the spelling that went. Board 4's
    // closing ticket found this hole and board 5's found it again, both
    // against a *hypothetical* second spelling; here the second spelling
    // already exists.
    //
    // Each arrow is anchored as the **whole separator** between two
    // endpoints rather than matched loosely, which is what makes a single
    // deletion bite: ` --> ` occurs inside `Unit -- pass --> Integration`
    // too, so an unanchored pattern for the plain arrow would still pass
    // after the plain arrow itself was deleted. Every one of these was
    // checked by mutating this file one spelling at a time.
    const declarations = readExample("flowchart-edges")
      .split("\n")
      .map((line) => line.replace(/%%.*$/, "").trim())
      .filter((line) => line.length > 0);
    const declares = (what: string, pattern: RegExp): void => {
      const written = declarations.filter((line) => pattern.test(line));
      expect(written, `examples/flowchart-edges.srn no longer declares ${what}`).not.toEqual([]);
    };
    /** One arrow token, written as the entire run between two endpoints. */
    const declaresArrow = (what: string, token: string): void =>
      declares(
        `${what}, \`${token}\``,
        new RegExp(`^\\S+\\s${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s\\S+$`),
      );
    expect(declarations[0]).toBe("flowchart TB");

    // The three lines, each with an arrowhead and each without one — six
    // spellings that are two axes rather than six names.
    declaresArrow("the plain arrow", "-->");
    declaresArrow("the open link", "---");
    declaresArrow("the thick arrow", "==>");
    declaresArrow("the thick open link", "===");
    declaresArrow("the dotted arrow", "-.->");
    declaresArrow("the dotted open link", "-.-");
    // The four end shapes, on the target end and then on both ends. `<-->`
    // is the only doubled spelling that is not its marker written twice.
    declaresArrow("a circle on the target end", "--o");
    declaresArrow("a cross on the target end", "--x");
    declaresArrow("an arrow on both ends", "<-->");
    declaresArrow("a circle on both ends", "o--o");
    declaresArrow("a cross on both ends", "x--x");
    // Line and ends compose freely, which is the decomposition's whole
    // claim: a dotted line with an arrow on each end is not an eighteenth
    // arrow name.
    declaresArrow("a dotted line with an arrow on both ends", "<-.->");
    // The dotted arrow's short spelling, which draws exactly what `-.->`
    // draws and so is invisible to every picture assertion below.
    declaresArrow("the dotted arrow without its leading dash", ".->");
    // The length, which is the one part of an arrow token that is not
    // about drawing. Its effect is asserted against coordinates further
    // down; that it is still *written* is asserted here.
    declaresArrow("the long arrow", "---->");
    // The two label spellings, plus the dotted stroke's, whose closer may
    // drop the dash its opener may not.
    declares("a pipe-spelled edge label, `A -->|text| B`", /^\S+\s-->\|[^|]+\|\s\S+$/);
    declares("an inline-spelled edge label, `A -- text --> B`", /^\S+\s--\s[^-]+\s-->\s\S+$/);
    declares("a dotted inline-spelled edge label, `A -. text .-> B`", /^\S+\s-\.\s[^.]+\s\.->\s\S+$/);
    // `linkStyle` with a `color` beside a `stroke` — the declaration this
    // board left open and ticket 04 settled by measurement. Without the
    // `color` the label paint below has nothing to prove.
    declares("`linkStyle` carrying a `color`", /^linkStyle\s+\d+\s+.*\bcolor:/);

    // A subgraph opened **inside** another, read off the text rather than
    // off the frames: one level of grouping can be made to work by an
    // implementation that cannot nest, so a file that stopped nesting would
    // still draw two frames and satisfy the enclosure check below.
    let depth = 0;
    let deepest = 0;
    for (const line of declarations) {
      if (/^subgraph\s/.test(line)) {
        depth += 1;
        deepest = Math.max(deepest, depth);
      } else if (line === "end") {
        depth -= 1;
      }
    }
    expect(deepest, "examples/flowchart-edges.srn no longer nests a subgraph").toBe(2);

    /**
     * What one edge was **drawn** as: its line, then the figure at its
     * source end and the figure at its target end.
     *
     * The ends are read as geometry rather than off the marker's name —
     * a closed outline is the arrowhead, a `<circle>` is the circle, and
     * two subpaths crossing are the cross — so reverting a drawing while
     * leaving its name in place fails here. `src/compat/corpus.ts` reads
     * an edge exactly this way, and for the same reason.
     */
    const drawnAs = (id: string): string => {
      const path = svg.querySelector(`path.siren-edge[data-siren-id="${id}"]`);
      if (path === null) throw new Error(`no edge "${id}" was drawn`);
      const classes = (path.getAttribute("class") ?? "").split(/\s+/);
      const line = classes.includes("siren-edge-dotted")
        ? "dotted"
        : classes.includes("siren-edge-thick")
          ? "thick"
          : "solid";
      const endAt = (side: "start" | "end"): string => {
        const reference = path.getAttribute(`marker-${side}`);
        if (reference === null) return "none";
        const marker = svg.querySelector(`defs > marker#${reference.slice("url(#".length, -1)}`);
        const drawn = marker?.firstElementChild;
        if (drawn == null) throw new Error(`edge "${id}"'s ${side} marker draws nothing`);
        if (drawn.tagName === "circle") return "circle";
        const d = drawn.getAttribute("d") ?? "";
        if (d.includes("Z")) return "arrow";
        if ((d.match(/M/g) ?? []).length === 2) return "cross";
        throw new Error(`edge "${id}" ends in an unrecognized figure: "${d}"`);
      };
      return `${line} ${endAt("start")} ${endAt("end")}`;
    };
    const labelOfEdge = (id: string): string | null =>
      svg.querySelector(`text.siren-edge-label[data-siren-id="${id}"]`)?.textContent ?? null;

    // The seventeen vertices mermaid 11.17.2 records for this document, in
    // its own order. Their shapes are examples/flowchart-shapes.srn's story
    // and not this one's, so only the roll-call is pinned here — but it is
    // pinned, because every edge assertion below names two of these and a
    // renamed endpoint would otherwise only show up as a missing edge.
    expect(
      Array.from(svg.querySelectorAll("g.siren-node")).map((g) => g.getAttribute("data-siren-id")),
    ).toEqual([
      "Commit",
      "Compile",
      "Artifact",
      "Unit",
      "Lint",
      "Integration",
      "Gate",
      "Halt",
      "Deploy",
      "Notify",
      "Audit",
      "Monitor",
      "Archive",
      "Cleanup",
      "Digest",
      "Dashboard",
      "Rollback",
    ]);

    // Every expectation below is what **mermaid 11.17.2 itself** records for
    // this document, read out with `packages/core/scripts/mermaid-probe.mjs`
    // — nineteen edges, in this order, with these types. Mermaid's names are
    // its own (`arrow_point`, `arrow_open`, `arrow_circle`, `arrow_cross`,
    // and a `double_` prefix for the doubled spellings, beside a `stroke` of
    // `normal`/`thick`/`dotted`); the middle column is Siren's
    // line/from-end/to-end spelling of the same arrow, and the mapping is
    // the whole of what "the same diagram" means here.
    const edges = Array.from(svg.querySelectorAll("path.siren-edge")).map((path) => {
      const id = path.getAttribute("data-siren-id")!;
      return [id, drawnAs(id), labelOfEdge(id)];
    });
    expect(edges).toEqual([
      // Mermaid: arrow_point / normal / length=1
      ["Commit-Compile", "solid none arrow", null],
      // Mermaid: arrow_point / thick / length=1
      ["Compile-Artifact", "thick none arrow", null],
      ["Artifact-Unit", "thick none arrow", null],
      // Mermaid: arrow_open / normal
      ["Unit-Lint", "solid none none", null],
      // Mermaid: arrow_point / normal, text="pass" — the inline spelling
      ["Unit-Integration", "solid none arrow", "pass"],
      // Mermaid: arrow_open / dotted
      ["Lint-Integration", "dotted none none", null],
      // Mermaid: arrow_point / normal, text="green" — the pipe spelling,
      // and the same drawing as the inline one two rows up.
      ["Integration-Gate", "solid none arrow", "green"],
      // Mermaid: arrow_cross / normal
      ["Integration-Halt", "solid none cross", null],
      ["Gate-Deploy", "thick none arrow", null],
      // Mermaid: arrow_point / dotted
      ["Gate-Notify", "dotted none arrow", null],
      // Mermaid: arrow_circle / normal
      ["Gate-Audit", "solid none circle", null],
      // Mermaid: double_arrow_point / normal — the from-end axis
      ["Deploy-Monitor", "solid arrow arrow", null],
      // Mermaid: arrow_point / normal / **length=3**
      ["Deploy-Archive", "solid none arrow", null],
      // Mermaid: arrow_point / dotted, text="nightly"
      ["Deploy-Cleanup", "dotted none arrow", "nightly"],
      // Mermaid: arrow_point / dotted — written `.->`, and drawn as the
      // `-.->` six rows up draws. Only the text assertion above can tell
      // these two apart, which is why it exists.
      ["Notify-Digest", "dotted none arrow", null],
      // Mermaid: double_arrow_circle / normal
      ["Monitor-Dashboard", "solid circle circle", null],
      // Mermaid: double_arrow_cross / normal
      ["Halt-Rollback", "solid cross cross", null],
      // Mermaid: arrow_open / thick
      ["Halt-Audit", "thick none none", null],
      // Mermaid: double_arrow_point / dotted — three axes, freely combined
      ["Digest-Dashboard", "dotted arrow arrow", null],
    ]);

    // Twelve distinct decompositions out of nineteen edges, and all three
    // lines and all four end figures among them. The table above would
    // still pass with one form drawn twice and another missing if someone
    // edited both columns to agree; this is what says the file covers the
    // axes rather than merely listing nineteen rows.
    const drawings = edges.map(([, drawing]) => drawing!);
    expect(new Set(drawings).size).toBe(12);
    expect(new Set(drawings.map((d) => d.split(" ")[0]))).toEqual(
      new Set(["solid", "thick", "dotted"]),
    );
    expect(new Set(drawings.flatMap((d) => d.split(" ").slice(1)))).toEqual(
      new Set(["none", "arrow", "circle", "cross"]),
    );

    // --- the length, which no drawing of one edge can show ---
    //
    // `Deploy ----> Archive` is `length=3` to Mermaid and reaches dagre as
    // `minlen`, so the archive sits further down the rank order than the
    // monitor a plain `<-->` put one rank below the same node. A comparison
    // inside one picture, between two edges leaving one node, so no number
    // from outside it is involved.
    const nodeBox = (
      id: string,
    ): { left: number; top: number; right: number; bottom: number } => {
      const frame = svg.querySelector(`g.siren-node[data-siren-id="${id}"] .siren-node-frame`)!;
      const x = Number(frame.getAttribute("x"));
      const y = Number(frame.getAttribute("y"));
      return {
        left: x,
        top: y,
        right: x + Number(frame.getAttribute("width")),
        bottom: y + Number(frame.getAttribute("height")),
      };
    };
    const long = nodeBox("Archive").top - nodeBox("Deploy").bottom;
    const plain = nodeBox("Monitor").top - nodeBox("Deploy").bottom;
    expect(long).toBeGreaterThan(plain);

    // --- the group the endpoints live in ---
    //
    // Three frames, drawn in the order the `subgraph` keywords open, each
    // under a **generated** id. `subgraph:2`'s frame holds `subgraph:3`'s
    // whole frame, which is the nesting claim read off the picture; the
    // text assertion above is what says the file still writes it.
    const frames = Array.from(svg.querySelectorAll("g.siren-subgraph")).map((g) => {
      const rect = g.querySelector("rect.siren-subgraph-frame")!;
      const x = Number(rect.getAttribute("x"));
      const y = Number(rect.getAttribute("y"));
      return {
        id: g.getAttribute("data-siren-id"),
        title: g.querySelector("text.siren-subgraph-label")!.textContent,
        left: x,
        top: y,
        right: x + Number(rect.getAttribute("width")),
        bottom: y + Number(rect.getAttribute("height")),
      };
    });
    expect(frames.map((f) => [f.id, f.title])).toEqual([
      ["subgraph:1", "Build"],
      ["subgraph:2", "Checks"],
      ["subgraph:3", "Fast"],
    ]);
    const encloses = (
      outer: { left: number; top: number; right: number; bottom: number },
      inner: { left: number; top: number; right: number; bottom: number },
    ): boolean =>
      outer.left <= inner.left &&
      outer.top <= inner.top &&
      outer.right >= inner.right &&
      outer.bottom >= inner.bottom;
    const [build, checks, fast] = frames;
    expect(encloses(checks, fast)).toBe(true);
    expect(encloses(fast, nodeBox("Unit"))).toBe(true);
    expect(encloses(fast, nodeBox("Lint"))).toBe(true);
    expect(encloses(build, nodeBox("Compile"))).toBe(true);
    // ...and the nodes an edge reached *into* a frame from outside it stay
    // where the frame that named them first put them: `Artifact ==> Unit`
    // crosses two boundaries and moves nothing.
    expect(encloses(checks, nodeBox("Integration"))).toBe(true);
    expect(encloses(build, nodeBox("Unit"))).toBe(false);

    // **The author's title is not an id.** A subgraph may legitimately be
    // named after a node, so the frame is addressed by the generated
    // `subgraph:N` (ADR-0010) and by nothing else — which is also why a
    // `style` directive cannot reach one: there is no authored name to
    // write in it.
    expect(svg.querySelectorAll('[data-siren-id="Build"]')).toHaveLength(0);
    expect(svg.querySelectorAll('[data-siren-id="Checks"]')).toHaveLength(0);
    expect(svg.querySelectorAll('[data-siren-id="Fast"]')).toHaveLength(0);

    // --- `linkStyle`'s two halves land on two elements ---
    //
    // `linkStyle 6 stroke:#15803d,color:#15803d` names the seventh edge
    // declared, `Integration -->|green| Gate`. The `stroke` paints the line
    // *and* the arrowhead — a marker is minted per (shape, colour) pair, so
    // this edge points at a different `<marker>` from the plain ones — and
    // the `color` paints the label, translated once in the model to the
    // `fill` that actually paints SVG text (ADR-0008). Measured with the
    // probe's `--paint` mode: mermaid 11.17.2 writes `fill` onto the very
    // same `<text>`, so dropping it would have been a silent mis-render.
    const styled = svg.querySelector('path.siren-edge[data-siren-id="Integration-Gate"]')!;
    expect(styled.getAttribute("style")).toContain("stroke:#15803d");
    const styledLabel = svg.querySelector('text.siren-edge-label[data-siren-id="Integration-Gate"]')!;
    expect(styledLabel.getAttribute("style")).toContain("fill:#15803d");
    const plainArrowhead = svg
      .querySelector('path.siren-edge[data-siren-id="Commit-Compile"]')!
      .getAttribute("marker-end");
    expect(styled.getAttribute("marker-end")).not.toBe(plainArrowhead);

    // --- and every one of them animates, frames included ---
    //
    // Seventeen nodes, nineteen edges and three frames, all named by the
    // `timeline:` block, so at step 0 the whole diagram is waiting. A
    // subgraph is a timeline target under its generated id, and an edge's
    // label moves with its line without the controller knowing there are
    // two elements (ADR-0009).
    expect(result.controller!.totalSteps).toBe(15);
    const pending = () =>
      [
        ...new Set(
          Array.from(svg.querySelectorAll(".siren-pending")).map((el) =>
            el.getAttribute("data-siren-id"),
          ),
        ),
      ].sort();
    expect(pending()).toHaveLength(17 + 19 + 3);
    expect(pending()).toContain("subgraph:3");
    for (let step = 0; step < result.controller!.totalSteps; step += 1) {
      result.controller!.next();
    }
    expect(pending()).toEqual([]);
  });

  it("carries an author's style, its arrowheads' colour and a timeline step onto an edge that is not a plain arrow", () => {
    // **The composition check.** Every one of these worked for `A --> B`
    // before this ticket, and each of them lands somewhere the arrow's
    // decomposition also touches: `linkStyle` writes the one inline `style`
    // the line style has to share the element with, the marker colour is
    // now minted per (shape, colour) pair rather than per colour, and the
    // animation classes go on the same `<path>` the line's own class does.
    // A dotted two-headed edge is where all three meet.
    const container = document.createElement("div");
    const result = render(
      `flowchart TD
A[Start] <-.-> B[End]
linkStyle 0 stroke:#f00
timeline:
enter A-B fade
`,
      container,
    );

    expect(result.diagnostics).toEqual([]);
    const svg = result.svg!;
    const path = svg.querySelector('path.siren-edge[data-siren-id="A-B"]')!;

    // The line style and the author's declaration on one element, neither
    // displacing the other.
    expect(path.getAttribute("class")).toContain("siren-edge-dotted");
    expect(path.getAttribute("style")).toBe("stroke:#f00");

    // One def, referenced from both ends, carrying the author's colour —
    // the head at the *from*-end is as much the author's arrow as the one
    // at the to-end, and a marker inherits nothing from the path that
    // references it.
    expect(svg.querySelectorAll("defs > marker")).toHaveLength(1);
    const reference = path.getAttribute("marker-end")!;
    expect(path.getAttribute("marker-start")).toBe(reference);
    expect(
      svg.querySelector(`defs > marker#${reference.slice("url(#".length, -1)} path`)!
        .getAttribute("style"),
    ).toBe("fill:#f00");

    // And it still animates: the classes land on the same `<path>`, beside
    // the line's own class rather than instead of it.
    expect(path.classList.contains("siren-pending")).toBe(true);
    result.controller!.next();
    expect(path.classList.contains("siren-pending")).toBe(false);
    expect(path.classList.contains("siren-edge-dotted")).toBe(true);
  });
});

/**
 * The two edge-label spellings end to end: source in, drawn label out.
 *
 * Everything below was measured against mermaid 11.17.2 with
 * `scripts/mermaid-probe.mjs`, which prints the `text` its own flowchart
 * database recorded for each edge.
 */
describe("an edge's label, from source to picture", () => {
  /** Each drawn edge label in `svg`, as the edge id it belongs to and its text. */
  const drawnLabels = (svg: SVGSVGElement) =>
    Array.from(svg.querySelectorAll("text.siren-edge-label")).map((text) => [
      text.getAttribute("data-siren-id"),
      text.textContent,
    ]);

  it("draws the label both spellings write, on the edge both spellings mean", () => {
    // Measured: both record `text="yes"` on an otherwise identical
    // `arrow_point`/`normal`/`length=1` edge. Two rows drawn from one
    // document, so the comparison is between two edges of one picture.
    const svg = renderThemed(`flowchart TB
A --> B
B -->|yes| C
C -- no --> D
`);

    expect(drawnLabels(svg)).toEqual([
      ["B-C", "yes"],
      ["C-D", "no"],
    ]);
  });

  it("puts the label between the boxes it belongs to, not on top of one", () => {
    // The end-to-end half of the layout claim: the reserved space is real
    // in the finished picture, so the drawn text sits in the gap rather
    // than over either endpoint. Read off the rendered SVG rather than
    // from layout, because this is the one assertion that spans both.
    const svg = renderThemed(`flowchart TB
A[Start] -->|yes| B[End]
`);

    const boxOf = (id: string) => {
      const rect = svg.querySelector(`g.siren-node[data-siren-id="${id}"] rect`)!;
      const y = Number(rect.getAttribute("y"));
      return { top: y, bottom: y + Number(rect.getAttribute("height")) };
    };
    const labelY = Number(
      svg.querySelector("text.siren-edge-label")!.getAttribute("y"),
    );

    expect(labelY).toBeGreaterThan(boxOf("A").bottom);
    expect(labelY).toBeLessThan(boxOf("B").top);
  });

  it("paints an edge's label with `linkStyle`'s `color`, as the `fill` an SVG text takes", () => {
    // **This replaces a test that pinned the opposite**, and it is the
    // measurement that turned it over rather than a change of taste. The
    // pin said what happened while an edge label was new: the `color` was
    // resolved, reached this renderer in `style.text`, and was dropped —
    // recorded so that whoever took the decision would meet a fact rather
    // than a surprise.
    //
    // The fact, measured with `pnpm --filter siren-core probe --paint`
    // against mermaid 11.17.2: Mermaid paints the label. It emits
    // `<text style="fill:#ff0000 !important">` on the label of the edge
    // `linkStyle 0 color:#ff0000` names when it draws labels as SVG text,
    // and `style="color:#ff0000 !important"` on the `<span>` when it draws
    // them as HTML. So dropping it was a *silent* mis-render — a directive
    // an author wrote, accepted without complaint, and then not drawn —
    // which is the one thing this project's absolute condition does not
    // allow.
    //
    // Nothing new is minted to fix it. ADR-0008 settled that the author
    // writes `color` and an SVG label carries `fill`, and `resolveStyles`
    // has performed that translation since board 3; the edge's label is
    // simply given the text half a node's label has taken all along.
    const svg = renderThemed(`flowchart TB
A -->|yes| B
linkStyle 0 stroke:#f00,color:#0f0
`);

    const label = svg.querySelector("text.siren-edge-label")!;
    // `fill`, not `color`: an inline `color` on a `<text>` sits in a
    // property nothing in an SVG document reads, which is the bug this
    // would otherwise have shipped one element over.
    expect(label.getAttribute("style")).toBe("fill:#0f0");
    expect(getComputedStyle(label).fill).toBe("#0f0");

    // The halves still go to different elements: the line takes everything
    // that is not `color`, and takes no `color`.
    expect(
      svg.querySelector('path.siren-edge[data-siren-id="A-B"]')!.getAttribute("style"),
    ).toBe("stroke:#f00");

    // And an edge the directive did not name keeps the theme's colour, so
    // this is a local override and not a new default.
    const plain = renderThemed(`flowchart TB
A -->|yes| B
B -->|no| C
linkStyle 0 stroke:#f00,color:#0f0
`);
    expect(
      plain.querySelector('text.siren-edge-label[data-siren-id="B-C"]')!.getAttribute("style"),
    ).toBeNull();
  });

  it("animates the label with the line it is written on", () => {
    // ADR-0009: a timeline target is an id, not an element. `enter A-B` has
    // to take both, or a step reveals a line with its label already
    // floating beside it.
    const container = document.createElement("div");
    const result = render(
      `flowchart TB
A -->|yes| B

timeline:
enter A-B fade
`,
      container,
    );
    expect(result.diagnostics).toEqual([]);

    const drawn = () => Array.from(result.svg!.querySelectorAll('[data-siren-id="A-B"]'));
    expect(drawn().map((el) => el.tagName)).toEqual(["path", "text"]);
    expect(drawn().every((el) => el.classList.contains("siren-pending"))).toBe(true);

    result.controller!.next();
    expect(drawn().some((el) => el.classList.contains("siren-pending"))).toBe(false);
  });
});

/**
 * A subgraph, from the source string to the picture — the one place the
 * parser's block, the model's generated id, the layout's cluster and the
 * renderer's frame are all seen at once.
 */
describe("render() — a subgraph groups the nodes inside it", () => {
  /** One drawn subgraph frame's box, read off the rendered SVG. */
  const frameBox = (svg: SVGSVGElement, id: string) => {
    const rect = svg.querySelector(
      `g.siren-subgraph[data-siren-id="${id}"] rect.siren-subgraph-frame`,
    );
    if (rect === null) throw new Error(`no subgraph "${id}" was drawn`);
    const x = Number(rect.getAttribute("x"));
    const y = Number(rect.getAttribute("y"));
    return {
      left: x,
      top: y,
      right: x + Number(rect.getAttribute("width")),
      bottom: y + Number(rect.getAttribute("height")),
    };
  };

  /** One drawn node's box. */
  const nodeBox = (svg: SVGSVGElement, id: string) => {
    const rect = svg.querySelector(`g.siren-node[data-siren-id="${id}"] rect.siren-node-frame`);
    if (rect === null) throw new Error(`no node "${id}" was drawn`);
    const x = Number(rect.getAttribute("x"));
    const y = Number(rect.getAttribute("y"));
    return {
      left: x,
      top: y,
      right: x + Number(rect.getAttribute("width")),
      bottom: y + Number(rect.getAttribute("height")),
    };
  };

  const holds = (
    outer: { left: number; top: number; right: number; bottom: number },
    inner: { left: number; top: number; right: number; bottom: number },
  ) =>
    outer.left <= inner.left &&
    outer.top <= inner.top &&
    outer.right >= inner.right &&
    outer.bottom >= inner.bottom;

  it("draws a titled frame around the nodes declared inside it", () => {
    const svg = renderThemed(`flowchart TB
subgraph Ingest
  A[Fetch] --> B[Parse]
end
B --> C[Publish]
`);

    expect(
      svg.querySelector('g.siren-subgraph[data-siren-id="subgraph:1"] text.siren-subgraph-label')!
        .textContent,
    ).toBe("Ingest");

    const frame = frameBox(svg, "subgraph:1");
    expect(holds(frame, nodeBox(svg, "A"))).toBe(true);
    expect(holds(frame, nodeBox(svg, "B"))).toBe(true);
    expect(holds(frame, nodeBox(svg, "C"))).toBe(false);

    // The edge leaving the group is still drawn, and still named the way
    // every other edge is: grouping changes where a node goes, not what an
    // edge is called.
    expect(
      Array.from(svg.querySelectorAll("path.siren-edge")).map((p) =>
        p.getAttribute("data-siren-id"),
      ),
    ).toEqual(["A-B", "B-C"]);
  });

  it("nests two levels, with the outer frame holding the inner one whole", () => {
    const svg = renderThemed(`flowchart TB
subgraph Outer
  subgraph Inner
    A --> B
  end
  C --> A
end
B --> D
`);

    expect(
      Array.from(svg.querySelectorAll("g.siren-subgraph")).map((g) => [
        g.getAttribute("data-siren-id"),
        g.querySelector("text")!.textContent,
      ]),
    ).toEqual([
      ["subgraph:1", "Outer"],
      ["subgraph:2", "Inner"],
    ]);

    expect(holds(frameBox(svg, "subgraph:1"), frameBox(svg, "subgraph:2"))).toBe(true);
    expect(holds(frameBox(svg, "subgraph:2"), nodeBox(svg, "A"))).toBe(true);
    expect(holds(frameBox(svg, "subgraph:1"), nodeBox(svg, "C"))).toBe(true);
    expect(holds(frameBox(svg, "subgraph:2"), nodeBox(svg, "C"))).toBe(false);
    expect(holds(frameBox(svg, "subgraph:1"), nodeBox(svg, "D"))).toBe(false);
  });

  it("does not collide with a node the author gave the same name", () => {
    // mermaid 11.17.2 accepts this and records both a vertex `A` and a
    // subgraph `A` (measured). Here the frame's id is generated, so the two
    // are different names and a lookup for `A` finds exactly one element —
    // the node — which is the whole of ADR-0010's argument, applied.
    const svg = renderThemed(`flowchart TB
A[Alpha]
subgraph A
  B --> C
end
`);

    expect(
      Array.from(svg.querySelectorAll('[data-siren-id="A"]')).map((el) => el.getAttribute("class")),
    ).toEqual(["siren-node"]);
    expect(svg.querySelector('g.siren-subgraph[data-siren-id="subgraph:1"] text')!.textContent).toBe(
      "A",
    );
  });

  it("routes an edge between two groups without either frame swallowing the other", () => {
    const svg = renderThemed(`flowchart TB
subgraph One
  A --> B
end
subgraph Two
  C --> D
end
B --> C
`);

    const one = frameBox(svg, "subgraph:1");
    const two = frameBox(svg, "subgraph:2");

    const overlapping =
      one.left < two.right && one.right > two.left && one.top < two.bottom && one.bottom > two.top;
    expect(overlapping).toBe(false);
    expect(holds(one, nodeBox(svg, "C"))).toBe(false);
    expect(holds(two, nodeBox(svg, "B"))).toBe(false);

    const crossing = svg.querySelector('path.siren-edge[data-siren-id="B-C"]');
    expect(crossing).not.toBeNull();
    expect(crossing!.getAttribute("d")).toMatch(/^M/);
  });

  it("animates a subgraph named in a timeline block, frame and title together", () => {
    // A frame nobody can name would be a decision by omission. This is
    // board 2's rule for the flowchart's grouping construct, and ADR-0009's
    // "a target is an id" is what takes the title with the frame.
    const container = document.createElement("div");
    const result = render(
      `flowchart TB
subgraph Ingest
  A --> B
end

timeline:
enter subgraph:1 fade
highlight subgraph:1 outline
`,
      container,
    );
    expect(result.diagnostics).toEqual([]);

    const drawn = () => Array.from(result.svg!.querySelectorAll('[data-siren-id="subgraph:1"]'));
    expect(drawn().map((el) => el.tagName)).toEqual(["g"]);
    expect(drawn()[0].classList.contains("siren-pending")).toBe(true);

    result.controller!.next();
    expect(drawn()[0].classList.contains("siren-pending")).toBe(false);

    result.controller!.next();
    expect(drawn()[0].classList.contains("siren-highlight-outline")).toBe(true);
  });

  it("leaves the id space unchanged for a document that groups nothing", () => {
    // The grouping construct adds an id space to the document; a document
    // that uses none must not gain one. Nothing here draws a frame, and
    // `subgraph:1` names nothing an author could reach.
    const svg = renderThemed(`flowchart TB
A --> B
`);

    expect(svg.querySelectorAll("g.siren-subgraph")).toHaveLength(0);
    expect(svg.querySelectorAll('[data-siren-id="subgraph:1"]')).toHaveLength(0);
  });
});

/**
 * A flowchart's `click` statements, from source to picture — mirroring the
 * class diagram's own interaction tests above one diagram kind over: the
 * seam (`render()`'s `options.onClick`) and the markup it reads
 * (`data-siren-click`, `data-siren-link`) are shared, so what changes here
 * is only which diagram kind is under test.
 */
describe("render() — a flowchart node's click interaction", () => {
  it("wraps a node with an href interaction in an <a class=\"siren-link\">, carrying the URL verbatim", () => {
    const container = document.createElement("div");
    const result = render(
      `flowchart TB
A[Start]
click A href "https://example.com/docs"
`,
      container,
    );

    expect(result.diagnostics).toEqual([]);
    const link = result.svg!.querySelector('a.siren-link > g.siren-node[data-siren-id="A"]');
    expect(link).not.toBeNull();
    expect(link!.parentElement!.getAttribute("href")).toBe("https://example.com/docs");
  });

  it("invokes options.onClick with the clicked node's id, callback name and literal argument when a real click lands inside a node the author gave a `call` interaction", () => {
    const container = document.createElement("div");
    const source = `flowchart TB
A[Start] --> B[Finish]
click B call showDetails("finish line") "Finish details"
`;

    const clicks: InteractionTarget[] = [];
    const result = render(source, container, {
      onClick: (target) => clicks.push(target),
    });

    expect(result.diagnostics).toEqual([]);
    const finish = result.svg!.querySelector('g.siren-node[data-siren-id="B"]');
    expect(finish).not.toBeNull();
    finish!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(clicks).toEqual([{ id: "B", action: "showDetails", argument: "finish line" }]);
  });

  it("invokes onClick for no other click in the diagram — not on a node the author left alone, and not on one whose interaction is an href", () => {
    const container = document.createElement("div");
    const source = `flowchart TB
A[Start] --> B[Middle] --> C[Finish]
click B call showDetails()
click C href "https://example.com/finish"
`;

    const clicks: InteractionTarget[] = [];
    const result = render(source, container, {
      onClick: (target) => clicks.push(target),
    });

    expect(result.diagnostics).toEqual([]);
    const nodeGroup = (id: string): Element => {
      const group = result.svg!.querySelector(`g.siren-node[data-siren-id="${id}"]`);
      if (group === null) throw new Error(`no rendered node ${id}`);
      return group;
    };

    // A is hooked by nothing at all; C is a *link*, which the browser
    // navigates — reporting it as a callback would invite a host to act on a
    // click the reader already spent on going somewhere.
    nodeGroup("A").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    nodeGroup("C").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual([]);

    // The same document does still deliver the node that has a callback, so
    // this is a test about which clicks are reported, not a broken wiring.
    nodeGroup("B").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual([{ id: "B", action: "showDetails", argument: null }]);
  });

  it("renders examples/flowchart-interaction.srn end to end with zero diagnostics — click href and click call, each with and without a tooltip", () => {
    const container = document.createElement("div");

    const result = render(readExample("flowchart-interaction"), container);

    expect(result.diagnostics).toEqual([]);
    expect(container.contains(result.svg!)).toBe(true);
    const svg = result.svg!;

    // --- asserted against the file's own text, not only against its
    // picture — the same reason `flowchart-shapes.srn`'s test reads its
    // source rather than only its render: a rewrite to a different valid
    // spelling of the same four statements would leave every picture-level
    // assertion below green while costing the repository its only example
    // of this ticket's grammar.
    const statements = readExample("flowchart-interaction")
      .split("\n")
      .map((line) => line.replace(/%%.*$/, "").trim())
      .filter((line) => line.length > 0);
    const declares = (what: string, pattern: RegExp): void => {
      expect(
        statements.filter((line) => pattern.test(line)),
        `examples/flowchart-interaction.srn no longer declares ${what}`,
      ).not.toEqual([]);
    };
    declares("a click href with no tooltip", /^click \w+ href "[^"]*"$/);
    declares("a click href with a tooltip", /^click \w+ href "[^"]*" "[^"]*"$/);
    declares("a click call with no tooltip", /^click \w+ call \w+\([^)]*\)$/);
    declares("a click call with a tooltip", /^click \w+ call \w+\([^)]*\) "[^"]*"$/);

    // --- and against the picture itself ---
    expect(
      svg.querySelector('a.siren-link > g.siren-node[data-siren-id="Docs"]'),
    ).not.toBeNull();
    expect(
      svg
        .querySelector('a.siren-link > g.siren-node[data-siren-id="Support"]')!
        .parentElement!.getAttribute("href"),
    ).toBe("https://example.com/support");
    expect(
      svg.querySelector('g.siren-node[data-siren-id="Details"]')!.getAttribute("data-siren-click"),
    ).toBe("showDetails");
    const confirm = svg.querySelector('g.siren-node[data-siren-id="Confirm"]')!;
    expect(confirm.getAttribute("data-siren-click")).toBe("confirmOrder");
    expect(confirm.getAttribute("data-siren-click-arg")).toBe("42");
  });

  it("draws a click tooltip as the node group's leading <title>, for href and call alike", () => {
    const result = render(
      `flowchart TB
A --> B --> C
click A href "https://example.com/docs" "Open the <docs>"
click B call showDetails("b") "Show details"
click C href "https://example.com"
`,
      document.createElement("div"),
    );

    expect(result.diagnostics).toEqual([]);
    const leadingTitle = (id: string) => {
      const first = result.svg!.querySelector(`g.siren-node[data-siren-id="${id}"]`)!.firstElementChild;
      return first?.tagName === "title" ? first.textContent : null;
    };
    // The text is the author's, verbatim: `<docs>` stays text, not markup.
    expect(leadingTitle("A")).toBe("Open the <docs>");
    expect(leadingTitle("B")).toBe("Show details");
    // No tooltip written, no <title> drawn.
    expect(result.svg!.querySelector('g.siren-node[data-siren-id="C"] title')).toBeNull();
  });

  it("reads the bare-URL shorthand with a tooltip, a target, or both, exactly as the href form", () => {
    const linkOf = (clickLine: string) => {
      const result = render(`flowchart TB\nB\n${clickLine}\n`, document.createElement("div"));
      const link = result.svg?.querySelector("a.siren-link");
      const group = link?.querySelector('g.siren-node[data-siren-id="B"]');
      return {
        diagnostics: result.diagnostics.map((d) => d.message),
        href: link?.getAttribute("href") ?? null,
        target: link?.getAttribute("target") ?? null,
        rel: link?.getAttribute("rel") ?? null,
        tooltip: group?.querySelector("title")?.textContent ?? null,
      };
    };

    for (const [shorthand, full] of [
      [`click B "https://x.com" "tip"`, `click B href "https://x.com" "tip"`],
      [`click B "https://x.com" _blank`, `click B href "https://x.com" _blank`],
      [`click B "https://x.com" "tip" _blank`, `click B href "https://x.com" "tip" _blank`],
    ]) {
      const expected = linkOf(full);
      expect(expected.diagnostics).toEqual([]);
      expect(expected.href).toBe("https://x.com");
      expect(linkOf(shorthand)).toEqual(expected);
    }
  });

  it("still refuses a shorthand whose quoted value is not a link, tooltip and target or not", () => {
    const result = render(`flowchart TB\nB\nclick B "javascript:alert(1)" "tip" _blank\n`, document.createElement("div"));

    expect(result.svg?.querySelector("a.siren-link") ?? null).toBeNull();
    expect(result.diagnostics.map((d) => d.severity)).toContain("error");
  });
});

describe("render() — a state diagram, end to end", () => {
  /** Renders `source` into a fresh attached container and hands back the result. */
  const renderState = (source: string) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    return { container, result: render(source, container) };
  };

  it("draws a state diagram written with either header spelling, identically", () => {
    // Measured (mermaid 11.17.2): both spellings report the diagram type
    // `stateDiagram`, so the two documents are the same document and must
    // draw the same picture.
    const pictureOf = (header: string) => {
      const { result } = renderState(`${header}\n  Idle --> Running : start\n`);
      expect(result.diagnostics, header).toEqual([]);
      return result.svg!.innerHTML.replace(/__[A-Za-z0-9]{8}/g, "__scope");
    };

    expect(pictureOf("stateDiagram")).toBe(pictureOf("stateDiagram-v2"));
  });

  it("mounts one siren-state group per state and one siren-transition per transition, each carrying its id", () => {
    const { container, result } = renderState(
      "stateDiagram-v2\n  Idle --> Running : start\n  Running --> Idle\n",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.svg).not.toBeNull();
    expect(container.contains(result.svg!)).toBe(true);

    const svg = result.svg!;
    expect(
      Array.from(svg.querySelectorAll("g.siren-state")).map((g) =>
        g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["Idle", "Running"]);
    expect(
      Array.from(svg.querySelectorAll("g.siren-transition")).map((g) =>
        g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["Idle-Running", "Running-Idle"]);
    expect(
      svg.querySelector('g.siren-transition-labels[data-siren-id="Idle-Running"] text')!
        .textContent,
    ).toBe("start");
  });

  it("draws the self-loop `A --> A : retry` as one state with one transition onto itself", () => {
    const { result } = renderState("stateDiagram-v2\n  Running --> Running : retry\n");

    expect(result.diagnostics).toEqual([]);
    const svg = result.svg!;
    expect(svg.querySelectorAll("g.siren-state")).toHaveLength(1);

    const loop = svg.querySelector('g.siren-transition[data-siren-id="Running-Running"]')!;
    const path = loop.querySelector("path.siren-transition-line")!;
    // A drawn loop, not a point: a route that collapsed onto one coordinate
    // would draw nothing at all and still have a `<path>` to find.
    const points = (path.getAttribute("d") ?? "").split(" ");
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(new Set(points).size).toBeGreaterThanOrEqual(2);
    // The label is a group of its own wearing the same id, drawn after every
    // line (ADR-0016).
    expect(
      svg.querySelector('g.siren-transition-labels[data-siren-id="Running-Running"] text')!
        .textContent,
    ).toBe("retry");
  });

  it("still draws a state a transition names, even when a `state X` line names it too", () => {
    // Characterization, pinned before `state X` on a line of its own stopped
    // declaring anything. Measured (mermaid 11.17.2): `state Skipped` plus
    // `A --> Skipped` reports both states and the relation between them —
    // the *transition* declares `Skipped`, so narrowing the `state` line
    // must leave this picture exactly as it is.
    const { result } = renderState("stateDiagram-v2\n  state Skipped\n  A --> Skipped\n");

    expect(result.diagnostics).toEqual([]);
    const svg = result.svg!;
    // Membership rather than draw order: which line first mentions `Skipped`
    // is what the narrowing moves, and pinning that would pin the defect.
    expect(
      Array.from(svg.querySelectorAll("g.siren-state"))
        .map((g) => g.getAttribute("data-siren-id"))
        .sort(),
    ).toEqual(["A", "Skipped"]);
    expect(
      svg.querySelector('g.siren-state[data-siren-id="Skipped"] text.siren-state-label')!
        .textContent,
    ).toBe("Skipped");
    expect(
      Array.from(svg.querySelectorAll("g.siren-transition")).map((g) =>
        g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["A-Skipped"]);
  });

  it("returns a working controller for a state diagram, as every other kind does", () => {
    // `SirenRenderResult.controller` is null *only* when rendering failed, so
    // a kind that returned none would break that promise for its callers.
    const { result } = renderState("stateDiagram-v2\n  Idle --> Running\n");

    expect(result.controller).not.toBeNull();
    expect(result.controller!.totalSteps).toBe(0);
  });

  it("draws a composite state as a titled frame around the states written inside it", () => {
    // End to end: the construct that was refused by name until this ticket.
    // Measured (mermaid 11.17.2, `--markup`): a composite is drawn as a
    // `g.statediagram-cluster` — a frame with the composite's name on a
    // strip along its top — and the states inside it as ordinary boxes
    // within it.
    const { result } = renderState(
      "stateDiagram-v2\n  state Outer {\n    Idle --> Busy\n  }\n",
    );

    expect(result.diagnostics).toEqual([]);
    const svg = result.svg!;

    const frame = svg.querySelector(
      'g.siren-state[data-siren-id="Outer"] rect.siren-composite-frame',
    )!;
    expect(frame).not.toBeNull();
    expect(
      svg.querySelector('g.siren-state[data-siren-id="Outer"] text.siren-composite-label')!
        .textContent,
    ).toBe("Outer");

    // "Around", verified as geometry rather than as document structure: both
    // member boxes lie strictly inside the frame's own rectangle.
    const box = (id: string) => {
      const rect = svg.querySelector(
        `g.siren-state[data-siren-id="${id}"] rect.siren-state-frame`,
      )!;
      const number = (name: string) => Number(rect.getAttribute(name));
      return {
        left: number("x"),
        top: number("y"),
        right: number("x") + number("width"),
        bottom: number("y") + number("height"),
      };
    };
    const frameNumber = (name: string) => Number(frame.getAttribute(name));
    for (const id of ["Idle", "Busy"]) {
      const member = box(id);
      expect(member.left, id).toBeGreaterThan(frameNumber("x"));
      expect(member.top, id).toBeGreaterThan(frameNumber("y"));
      expect(member.right, id).toBeLessThan(frameNumber("x") + frameNumber("width"));
      expect(member.bottom, id).toBeLessThan(frameNumber("y") + frameNumber("height"));
    }
  });

  it("draws `[*]` as a start disc and an end ring, one of each however often it is written", () => {
    // Measured (mermaid 11.17.2): two `[*] -->` lines at one level both come
    // back from a single `root_start`, and two `--> [*]` lines both reach a
    // single `root_end` — one per level, not one per occurrence. Start and
    // end are two different pseudo-states.
    const { result } = renderState(
      "stateDiagram-v2\n  [*] --> Idle\n  [*] --> Busy\n  Idle --> [*]\n  Busy --> [*]\n",
    );

    expect(result.diagnostics).toEqual([]);
    const svg = result.svg!;

    expect(
      Array.from(svg.querySelectorAll("g.siren-state")).map((g) =>
        g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["start:1", "Idle", "Busy", "end:1"]);
    expect(
      Array.from(svg.querySelectorAll("g.siren-transition")).map((g) =>
        g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["start:1-Idle", "start:1-Busy", "Idle-end:1", "Busy-end:1"]);

    // The figures, not just the ids: a disc for the start, a ring around a
    // disc for the end, and no label on either.
    expect(svg.querySelectorAll("circle.siren-state-start")).toHaveLength(1);
    expect(svg.querySelectorAll("circle.siren-state-end")).toHaveLength(1);
    expect(svg.querySelectorAll("circle.siren-state-end-inner")).toHaveLength(1);
    expect(
      Array.from(svg.querySelectorAll("text.siren-state-label")).map((t) => t.textContent),
    ).toEqual(["Idle", "Busy"]);
  });

  it("joins `[*] --> [*]` from the start pseudo-state to the end one", () => {
    const { result } = renderState("stateDiagram-v2\n  [*] --> [*]\n");

    expect(result.diagnostics).toEqual([]);
    const svg = result.svg!;
    expect(
      Array.from(svg.querySelectorAll("g.siren-state")).map((g) =>
        g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["start:1", "end:1"]);
    expect(
      svg.querySelector('g.siren-transition[data-siren-id="start:1-end:1"]'),
    ).not.toBeNull();
  });

  it("draws a described state's description where its id would have gone, and draws the identical picture for either spelling", () => {
    // Measured (mermaid 11.17.2): `Idle : waiting for work` and
    // `state "waiting for work" as Idle` both land in the same
    // `descriptions` array on a state whose id is still `Idle` — one
    // construct written two ways, so nothing downstream, the picture
    // included, may be able to tell which the author wrote. The transition
    // below still names the state `Idle`, which is what makes the second
    // spelling a description rather than the rename `as` suggests.
    const pictureOf = (description: string) => {
      const { result } = renderState(
        `stateDiagram-v2\n  ${description}\n  Idle --> Running\n`,
      );
      expect(result.diagnostics, description).toEqual([]);
      return result.svg!.innerHTML.replace(/__[A-Za-z0-9]{8}/g, "__scope");
    };

    expect(pictureOf('state "waiting for work" as Idle')).toBe(
      pictureOf("Idle : waiting for work"),
    );

    const { result } = renderState(
      "stateDiagram-v2\n  Idle : waiting for work\n  Idle --> Running\n",
    );
    const svg = result.svg!;

    // The description stands where the id used to, and the id is left
    // addressing the state — the split `A[label]` already draws in a
    // flowchart.
    expect(
      svg.querySelector('g.siren-state[data-siren-id="Idle"] text.siren-state-label')!
        .textContent,
    ).toBe("waiting for work");
    expect(
      svg.querySelector('g.siren-transition[data-siren-id="Idle-Running"]'),
    ).not.toBeNull();
    // An undescribed state in the same diagram still draws its id.
    expect(
      svg.querySelector('g.siren-state[data-siren-id="Running"] text.siren-state-label')!
        .textContent,
    ).toBe("Running");
  });

  it("draws two descriptions as a titled box: the first above the divider, the rest below it", () => {
    // Measured (11.17.2, `mermaid-probe.mjs --markup`): one description is
    // a plain rounded rect, while two or more are drawn as
    // `rect.outer.title-state` plus a `line.divider` — the first
    // description titling the box and the rest sitting under the line.
    const { result } = renderState(
      "stateDiagram-v2\n  Idle : waiting for work\n  Idle : nothing queued\n",
    );

    expect(result.diagnostics).toEqual([]);
    const group = result.svg!.querySelector('g.siren-state[data-siren-id="Idle"]')!;

    expect(Array.from(group.querySelectorAll("text")).map((t) => t.textContent)).toEqual([
      "waiting for work",
      "nothing queued",
    ]);
    expect(group.querySelector("text.siren-state-label")!.textContent).toBe(
      "waiting for work",
    );

    // The divider, between the two rows rather than merely present: a line
    // drawn at the top or the bottom of the box would satisfy a
    // "was a divider drawn?" check and be the wrong picture.
    const divider = group.querySelector("line.siren-state-divider");
    expect(divider).not.toBeNull();
    const yOf = (element: Element) => Number(element.getAttribute("y"));
    const rows = Array.from(group.querySelectorAll("text"));
    const dividerY = Number(divider!.getAttribute("y1"));
    expect(dividerY).toBeGreaterThan(yOf(rows[0]));
    expect(dividerY).toBeLessThan(yOf(rows[1]));
    // And the box grew to hold both rows rather than clipping the second.
    const frame = group.querySelector("rect.siren-state-frame")!;
    expect(yOf(rows[1])).toBeLessThan(
      Number(frame.getAttribute("y")) + Number(frame.getAttribute("height")),
    );
  });

  it("leaves the start pseudo-state alone when the author declares a state named `root_start`", () => {
    // Siren diverging from Mermaid, and removing a bug by doing so.
    // Measured, 11.17.2: this document means three nodes and two edges, and
    // Mermaid draws two nodes with the relations `root_start → root_start`
    // and `root_start → B` — the start pseudo-state swallowed by the
    // author's own state, its edge turned into a self-loop nobody wrote,
    // and no diagnostic. Siren's generated ids carry a colon that an
    // authored `\w+` id cannot, so there is nothing to collide.
    const { result } = renderState(
      "stateDiagram-v2\n  [*] --> root_start\n  root_start --> B\n",
    );

    expect(result.diagnostics).toEqual([]);
    const svg = result.svg!;

    expect(
      Array.from(svg.querySelectorAll("g.siren-state")).map((g) =>
        g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["start:1", "root_start", "B"]);
    expect(
      Array.from(svg.querySelectorAll("g.siren-transition")).map((g) =>
        g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["start:1-root_start", "root_start-B"]);
    // The author's state is a box with its own name in it, and the disc is
    // still the disc.
    expect(
      svg.querySelector('g.siren-state[data-siren-id="root_start"] text.siren-state-label')!
        .textContent,
    ).toBe("root_start");
    expect(svg.querySelectorAll("circle.siren-state-start")).toHaveLength(1);
  });

  it("returns a controller with totalSteps 0 — not null — for a stateDiagram with no timeline block", () => {
    const { result } = renderState("stateDiagram-v2\n  Idle --> Running\n");

    expect(result.diagnostics).toEqual([]);
    expect(result.controller).not.toBeNull();
    expect(result.controller!.totalSteps).toBe(0);
    expect(result.controller!.currentStep).toBe(0);
  });

  it("drives a state diagram's timeline through all three target kinds — a state, a transition and a composite frame — with next(), prev() and reset()", () => {
    const { result } = renderState(
      "stateDiagram-v2\n" +
        "  [*] --> Idle\n" +
        "  Idle --> Outer : begin\n" +
        "  state Outer {\n" +
        "    Working --> Done\n" +
        "  }\n" +
        "timeline:\n" +
        "  enter Idle fade\n" +
        "  enter Idle-Outer fade, enter Outer slide-top\n" +
        "  highlight Outer outline, highlight Idle-Outer glow\n" +
        "  unhighlight Outer, exit Idle-Outer fade\n",
    );

    expect(result.diagnostics).toEqual([]);
    const controller = result.controller!;
    expect(controller.totalSteps).toBe(4);

    const svg = result.svg!;
    const byId = (id: string) => svg.querySelector(`[data-siren-id="${id}"]`)!;
    const idle = byId("Idle");
    const outer = byId("Outer");
    const transition = byId("Idle-Outer");

    // Step 0 is the controller's, established by `reset()` in `render()` —
    // the renderer stamps no `siren-pending` of its own. Exactly the three
    // ids with an `enter` action start hidden; the start pseudo-state and
    // the composite's members, which the block never names, are visible.
    // Ids, not elements: a labelled transition's line and label are two
    // groups wearing one id (ADR-0016), and both start hidden.
    const pendingIds = () =>
      [
        ...new Set(
          Array.from(svg.querySelectorAll(".siren-pending")).map((el) =>
            el.getAttribute("data-siren-id"),
          ),
        ),
      ].sort();
    expect(pendingIds()).toEqual(["Idle", "Idle-Outer", "Outer"]);

    controller.next();
    expect(idle.classList.contains("siren-pending")).toBe(false);
    expect(idle.classList.contains("siren-enter-fade")).toBe(true);
    expect(outer.classList.contains("siren-pending")).toBe(true);

    // Step 2: the composite frame — addressed under the author's own name,
    // unlike a flowchart subgraph's generated `subgraph:1` — and the
    // transition beside it.
    controller.next();
    expect(outer.classList.contains("siren-pending")).toBe(false);
    expect(outer.classList.contains("siren-enter-slide-top")).toBe(true);
    expect(transition.classList.contains("siren-enter-fade")).toBe(true);

    controller.next();
    expect(outer.classList.contains("siren-highlight-outline")).toBe(true);
    expect(transition.classList.contains("siren-highlight-glow")).toBe(true);

    controller.next();
    expect(controller.currentStep).toBe(4);
    expect(outer.classList.contains("siren-highlight-outline")).toBe(false);
    expect(transition.classList.contains("siren-exit-fade")).toBe(true);

    // Stepping back undoes exactly the last step.
    controller.prev();
    expect(transition.classList.contains("siren-exit-fade")).toBe(false);
    expect(outer.classList.contains("siren-highlight-outline")).toBe(true);

    controller.reset();
    expect(controller.currentStep).toBe(0);
    expect(pendingIds()).toEqual(["Idle", "Idle-Outer", "Outer"]);
    expect(outer.classList.contains("siren-highlight-outline")).toBe(false);
  });

  it("lands a transition's highlight and exit on both its line group and its label group (ADR-0016)", () => {
    const { result } = renderState(
      "stateDiagram-v2\n" +
        "  Idle --> Running : start\n" +
        "timeline:\n" +
        "  highlight Idle-Running outline\n" +
        "  exit Idle-Running fade\n",
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const line = result.svg!.querySelector('g.siren-transition[data-siren-id="Idle-Running"]')!;
    const labels = result.svg!.querySelector(
      'g.siren-transition-labels[data-siren-id="Idle-Running"]',
    );
    expect(labels).not.toBeNull();

    result.controller!.next();
    expect(line.classList.contains("siren-highlight-outline")).toBe(true);
    expect(labels!.classList.contains("siren-highlight-outline")).toBe(true);

    result.controller!.next();
    expect(line.classList.contains("siren-exit-fade")).toBe(true);
    expect(labels!.classList.contains("siren-exit-fade")).toBe(true);
  });

  it("animates a pseudo-state under the generated id it already carries", () => {
    // Not a fourth target kind: `start:1` is an id like any other by the
    // time the timeline is resolved, so it is addressable for free.
    const { result } = renderState(
      "stateDiagram-v2\n  [*] --> Idle\ntimeline:\n  enter start:1 fade\n",
    );

    expect(result.diagnostics).toEqual([]);
    const disc = result.svg!.querySelector('g.siren-state[data-siren-id="start:1"]')!;
    expect(disc.classList.contains("siren-pending")).toBe(true);
    result.controller!.next();
    expect(disc.classList.contains("siren-enter-fade")).toBe(true);
  });

  it("warns — without dropping anything — when a transition stays visible after a state it joins exits", () => {
    const { result } = renderState(
      "stateDiagram-v2\n  Idle --> Running\ntimeline:\n  exit Running fade\n",
    );

    expect(result.diagnostics.map((d) => d.severity)).toEqual(["warning"]);
    expect(result.diagnostics[0].message).toContain('transition "Idle-Running"');
    expect(result.svg).not.toBeNull();
    expect(result.controller!.totalSteps).toBe(1);
  });

  it("reports a timeline entry naming an id no state or transition carries, and renders nothing", () => {
    const { result } = renderState(
      "stateDiagram-v2\n  Idle --> Running\ntimeline:\n  enter Ghost fade\n",
    );

    // An unresolvable target is error-severity, and `render()` returns no
    // SVG once any stage reports one — the same answer every other kind
    // gives.
    expect(result.diagnostics.map((d) => d.severity)).toEqual(["error"]);
    expect(result.diagnostics[0].message).toContain("Ghost");
  });

  it("renders examples/state-core.srn end to end with zero diagnostics — both description spellings, an accumulating pair, a self-transition, both pseudo-states, a nested composite with its own direction and its own `[*]`, and a state nothing points at", () => {
    // Zero diagnostics of *any* severity, which is the claim the `examples/`
    // enumeration test above does not make: that one filters to error
    // severity, so a warning — the connector-outliving-its-endpoint one this
    // kind can now raise — would slip past it.
    const { result } = renderState(readExample("state-core"));
    expect(result.diagnostics).toEqual([]);
    const svg = result.svg!;

    const idsOf = (selector: string) =>
      Array.from(svg.querySelectorAll(selector)).map((g) => g.getAttribute("data-siren-id"));
    const rowsOf = (id: string) =>
      Array.from(
        svg.querySelectorAll(
          `g.siren-state[data-siren-id="${id}"] text.siren-state-label,` +
            ` g.siren-state[data-siren-id="${id}"] text.siren-state-description`,
        ),
      ).map((text) => text.textContent);

    // The example's own text, asserted — every state it writes, in the order
    // it first names them, with both levels' pseudo-states numbered by the
    // level that opened them.
    expect(idsOf("g.siren-state")).toEqual([
      "start:1",
      "Idle",
      "Dispatching",
      "Running",
      "start:2",
      "Fetching",
      "Transforming",
      "Mapping",
      "Reducing",
      "Publishing",
      "end:2",
      "Failed",
      "end:1",
      "Cancelled",
    ]);

    expect(idsOf("g.siren-transition")).toEqual([
      "start:1-Idle",
      "Idle-Dispatching",
      "Dispatching-Running",
      "Running-Running",
      "start:2-Fetching",
      "Fetching-Transforming",
      "Mapping-Reducing",
      "Transforming-Publishing",
      "Publishing-end:2",
      "Running-Idle",
      "Running-Failed",
      "Failed-end:1",
    ]);

    // The labels the example writes on its transitions, and only those.
    expect(
      Array.from(svg.querySelectorAll("text.siren-transition-label")).map((t) => t.textContent),
    ).toEqual(["job arrives", "heartbeat", "finished", "error"]);

    // Both description spellings land in one list on one state, in written
    // order — `Idle : waiting for work` then `state "nothing is queued" as
    // Idle` — and neither renames it, which is why `Idle` is still what the
    // transitions above name.
    expect(rowsOf("Idle")).toEqual(["waiting for work", "nothing is queued"]);
    // Two colon-spelled descriptions accumulate rather than replace.
    expect(rowsOf("Failed")).toEqual(["the run stopped early", "nothing was published"]);
    // An undescribed state draws its own id and no divider.
    expect(rowsOf("Cancelled")).toEqual(["Cancelled"]);
    expect(
      svg.querySelectorAll('g.siren-state[data-siren-id="Cancelled"] line.siren-state-divider'),
    ).toHaveLength(0);
    // A described one gets the divider closing its title row.
    expect(
      svg.querySelectorAll('g.siren-state[data-siren-id="Idle"] line.siren-state-divider'),
    ).toHaveLength(1);

    // Two composite frames, the inner one drawn inside the outer.
    expect(idsOf("g.siren-state:has(rect.siren-composite-frame)")).toEqual([
      "Running",
      "Transforming",
    ]);
    const box = (id: string) => {
      const rect = svg.querySelector(`g.siren-state[data-siren-id="${id}"] rect`)!;
      const read = (name: string) => Number(rect.getAttribute(name));
      return { x: read("x"), y: read("y"), w: read("width"), h: read("height") };
    };
    const outer = box("Running");
    const inner = box("Transforming");
    expect(inner.x).toBeGreaterThanOrEqual(outer.x);
    expect(inner.y).toBeGreaterThanOrEqual(outer.y);
    expect(inner.x + inner.w).toBeLessThanOrEqual(outer.x + outer.w);
    expect(inner.y + inner.h).toBeLessThanOrEqual(outer.y + outer.h);

    // `direction LR` inside `state Transforming { ... }` turns that block
    // alone sideways — `Reducing` beside `Mapping`, on one row — while both
    // the composite holding it and the document outside that still run top
    // to bottom.
    const centre = (id: string) => {
      const b = box(id);
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    };
    expect(centre("Reducing").x).toBeGreaterThan(centre("Mapping").x);
    expect(Math.abs(centre("Reducing").y - centre("Mapping").y)).toBeLessThan(1);
    expect(centre("Publishing").y).toBeGreaterThan(centre("Fetching").y);
    expect(centre("Running").y).toBeGreaterThan(centre("Idle").y);

    // Exactly one start disc per level, and one end ring per level — the
    // document's and the outer composite's.
    expect(svg.querySelectorAll("circle.siren-state-start")).toHaveLength(2);
    expect(svg.querySelectorAll("circle.siren-state-end")).toHaveLength(2);

    // `Running --> Running` loops a *composite*, and this file is the only
    // shipped document that does. The corpus pins the same construct from an
    // inline source; this pins it on the real one, where the frame is 542
    // tall — large enough that the run along the side is clamped, which the
    // small inline sources never exercise. Both ends land on the frame's own
    // outline, nothing lies inside it, and the whole loop is inside the
    // `viewBox`: a loop drawn correctly but off the canvas is invisible, and
    // that is how this construct shipped before `01M2SVA30`.
    const running = box("Running");
    const loop = svg.querySelector(
      'g.siren-transition[data-siren-id="Running-Running"] path.siren-transition-line',
    );
    expect(loop).not.toBeNull();
    const loopPoints = [
      ...new Set((loop!.getAttribute("d") ?? "").split(" ")),
    ]
      .map((step) => step.replace(/^[ML]/, "").split(",").map(Number))
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    expect(loopPoints.length).toBeGreaterThan(1);

    const insideFrame = loopPoints.filter(
      ([x, y]) =>
        x > running.x && x < running.x + running.w && y > running.y && y < running.y + running.h,
    );
    expect(insideFrame).toEqual([]);

    const onFrameOutline = ([x, y]: number[]) =>
      Math.abs(x - running.x) < 0.5 ||
      Math.abs(x - (running.x + running.w)) < 0.5 ||
      Math.abs(y - running.y) < 0.5 ||
      Math.abs(y - (running.y + running.h)) < 0.5;
    expect(loopPoints.filter(onFrameOutline).length).toBeGreaterThanOrEqual(2);

    const [vx, vy, vw, vh] = (svg.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
    expect(
      loopPoints.filter(([x, y]) => x < vx || x > vx + vw || y < vy || y > vy + vh),
    ).toEqual([]);
  });

  it("drives examples/state-reveal.srn's timeline through all three target kinds — a state, a transition and a composite frame — with next(), prev() and reset()", () => {
    const { result } = renderState(readExample("state-reveal"));

    // Zero diagnostics of any severity: in particular no
    // connector-outliving-its-endpoint warning, which the example avoids by
    // exiting `start:1-Idle` and `Idle-Working` in the same step `Idle`
    // leaves.
    expect(result.diagnostics).toEqual([]);
    const controller = result.controller!;
    expect(controller.totalSteps).toBe(7);

    const svg = result.svg!;
    const byId = (id: string) => svg.querySelector(`[data-siren-id="${id}"]`)!;
    // Ids, not elements: a labelled transition's line and label are two
    // groups wearing one id (ADR-0016), and both start hidden.
    const pendingIds = () =>
      [
        ...new Set(
          Array.from(svg.querySelectorAll(".siren-pending")).map((el) =>
            el.getAttribute("data-siren-id"),
          ),
        ),
      ].sort();

    // The example's own structure, asserted — the frame is addressed by the
    // author's own name `Working`, unlike a flowchart subgraph's generated
    // `subgraph:1`.
    expect(
      Array.from(svg.querySelectorAll("g.siren-state")).map((g) =>
        g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["start:1", "Idle", "Working", "Fetching", "Saving", "Done", "end:1"]);
    // And `Working` really is the frame, not a box that happens to share the
    // name: it is drawn with `.siren-composite-frame` and the two members
    // the block holds are inside it. Without this the example could lose its
    // `state Working { ... }` block entirely and every assertion below would
    // still pass — mutation found exactly that.
    expect(
      Array.from(svg.querySelectorAll("g.siren-state:has(rect.siren-composite-frame)")).map(
        (g) => g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["Working"]);
    const frame = svg.querySelector('g.siren-state[data-siren-id="Working"] rect')!;
    const span = (el: Element) => ({
      x: Number(el.getAttribute("x")),
      y: Number(el.getAttribute("y")),
      w: Number(el.getAttribute("width")),
      h: Number(el.getAttribute("height")),
    });
    const outer = span(frame);
    for (const member of ["Fetching", "Saving"]) {
      const inner = span(svg.querySelector(`g.siren-state[data-siren-id="${member}"] rect`)!);
      expect(inner.x, member).toBeGreaterThanOrEqual(outer.x);
      expect(inner.y, member).toBeGreaterThanOrEqual(outer.y);
      expect(inner.x + inner.w, member).toBeLessThanOrEqual(outer.x + outer.w);
      expect(inner.y + inner.h, member).toBeLessThanOrEqual(outer.y + outer.h);
    }

    // Step 0 is the controller's: exactly the ids the block gives an `enter`
    // start hidden, and the start disc — which the example never enters —
    // is visible from the first frame.
    expect(pendingIds()).toEqual([
      "Done",
      "Done-end:1",
      "Fetching",
      "Fetching-Saving",
      "Idle",
      "Idle-Working",
      "Saving",
      "Working",
      "Working-Done",
    ]);
    expect(byId("start:1").classList.contains("siren-pending")).toBe(false);

    controller.next(); // step 1 — a state
    expect(byId("Idle").classList.contains("siren-enter-fade")).toBe(true);

    controller.next(); // step 2 — a transition and the composite frame
    expect(byId("Idle-Working").classList.contains("siren-enter-fade")).toBe(true);
    expect(byId("Working").classList.contains("siren-enter-slide-top")).toBe(true);

    controller.next(); // step 3 — the frame's own members
    expect(byId("Fetching-Saving").classList.contains("siren-enter-fade")).toBe(true);

    controller.next(); // step 4 — the composite highlighted by name
    expect(byId("Working").classList.contains("siren-highlight-outline")).toBe(true);

    controller.next(); // step 5 — highlight lifted, the tail enters
    expect(byId("Working").classList.contains("siren-highlight-outline")).toBe(false);
    expect(byId("Done").classList.contains("siren-enter-slide-right")).toBe(true);

    controller.next(); // step 6 — a transition highlighted
    expect(byId("Idle-Working").classList.contains("siren-highlight-glow")).toBe(true);

    controller.next(); // step 7 — the head of the diagram leaves
    expect(controller.currentStep).toBe(7);
    expect(byId("Idle").classList.contains("siren-exit-slide-left")).toBe(true);
    expect(byId("start:1-Idle").classList.contains("siren-exit-slide-left")).toBe(true);
    expect(byId("Idle-Working").classList.contains("siren-highlight-glow")).toBe(false);

    // Stepping back undoes exactly the last step.
    controller.prev();
    expect(byId("Idle").classList.contains("siren-exit-slide-left")).toBe(false);
    expect(byId("Idle-Working").classList.contains("siren-highlight-glow")).toBe(true);

    controller.reset();
    expect(controller.currentStep).toBe(0);
    expect(pendingIds()).toEqual([
      "Done",
      "Done-end:1",
      "Fetching",
      "Fetching-Saving",
      "Idle",
      "Idle-Working",
      "Saving",
      "Working",
      "Working-Done",
    ]);
    expect(byId("Working").classList.contains("siren-highlight-outline")).toBe(false);
  });
});

/**
 * Whether the layout stage ever hands the renderer a coordinate that is not a
 * number — the failure this group of tests is about, read where an author
 * would see it rather than off an intermediate structure.
 *
 * Every attribute of every element, because the damage spreads: one unplaced
 * node puts `NaN` into its own `<rect x>`, into the `d` of every path routed
 * to it, and into the `<svg>`'s own `width`/`height`/`viewBox` by way of the
 * bounds computed over it.
 */
function nanAttributes(svg: SVGSVGElement): string[] {
  const found: string[] = [];
  const visit = (element: Element): void => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.value.includes("NaN")) {
        found.push(`<${element.tagName} ${attribute.name}="${attribute.value}">`);
      }
    }
    for (const child of Array.from(element.children)) {
      visit(child);
    }
  };
  visit(svg);
  return found;
}

/** `render()` into a throwaway container — the seam, with nothing else attached. */
function renderInto(source: string) {
  return render(source, document.createElement("div"));
}

/**
 * Every node's drawn centre, keyed by the id the author wrote — the arrangement
 * of a picture, read off the picture.
 *
 * Centres rather than corners because two nodes of different widths share a
 * *column* only by their centres, and "these two are in one column" is exactly
 * what distinguishes a `TB` sub-layout from an `LR` one.
 */
function nodeCentres(result: SirenRenderResult): Record<string, { x: number; y: number }> {
  const entries = Array.from(
    result.svg!.querySelectorAll("g.siren-node[data-siren-id]"),
  ).map((group) => {
    const frame = group.querySelector("rect.siren-node-frame")!;
    const x = Number(frame.getAttribute("x"));
    const y = Number(frame.getAttribute("y"));
    return [
      group.getAttribute("data-siren-id")!,
      {
        x: x + Number(frame.getAttribute("width")) / 2,
        y: y + Number(frame.getAttribute("height")) / 2,
      },
    ] as const;
  });
  return Object.fromEntries(entries);
}

/** Every state box's drawn centre, the state diagram's spelling of `nodeCentres`. */
function stateCentres(result: SirenRenderResult): Record<string, { x: number; y: number }> {
  const entries = Array.from(
    result.svg!.querySelectorAll("g.siren-state[data-siren-id]"),
  ).flatMap((group) => {
    const frame = group.querySelector("rect.siren-state-frame");
    if (frame === null) return [];
    const x = Number(frame.getAttribute("x"));
    const y = Number(frame.getAttribute("y"));
    return [
      [
        group.getAttribute("data-siren-id")!,
        {
          x: x + Number(frame.getAttribute("width")) / 2,
          y: y + Number(frame.getAttribute("height")) / 2,
        },
      ] as const,
    ];
  });
  return Object.fromEntries(entries);
}

/** One subgraph frame's four sides, found by the title the author wrote on it. */
function subgraphFrame(
  result: SirenRenderResult,
  title: string,
): { top: number; bottom: number; left: number; right: number } {
  const group = Array.from(result.svg!.querySelectorAll("g.siren-subgraph")).find(
    (g) => g.querySelector("text.siren-subgraph-label")?.textContent === title,
  );
  const frame = group?.querySelector("rect.siren-subgraph-frame");
  if (frame === undefined || frame === null) {
    throw new Error(`no subgraph titled "${title}" was drawn`);
  }
  const x = Number(frame.getAttribute("x"));
  const y = Number(frame.getAttribute("y"));
  return {
    top: y,
    bottom: y + Number(frame.getAttribute("height")),
    left: x,
    right: x + Number(frame.getAttribute("width")),
  };
}

/** Whether `frame` contains `point` — "this node is drawn inside that frame". */
function holds(
  frame: { top: number; bottom: number; left: number; right: number },
  point: { x: number; y: number },
): boolean {
  return (
    point.x >= frame.left &&
    point.x <= frame.right &&
    point.y >= frame.top &&
    point.y <= frame.bottom
  );
}

/**
 * The three rows of `01M2XJWM4`'s matrix that already draw the right picture,
 * pinned as **coordinates** rather than as "no diagnostic" — characterization,
 * written before the rankdir-propagation step exists and expected green on
 * arrival.
 *
 * "It still renders" is not the guarantee these need. Giving every cluster a
 * direction unconditionally would keep all three rendering while moving the
 * last one off dagre's ordinary compound path onto the per-cluster one, which
 * is a different placement of the same document. Only exact centres can say
 * that did not happen.
 */
describe("render() — the nested-subgraph rows that already lay out correctly", () => {
  const nested = (outer: string, inner: string): string =>
    `flowchart TB
  subgraph Outer
${outer}
    subgraph Inner
${inner}
      A --> B
    end
    Inner --> C
  end`;

  it("places the same boxes for `direction LR` on both frames", () => {
    // Both frames left-to-right: `A`, `B` and `C` in one row, on one baseline.
    expect(nodeCentres(renderInto(nested("    direction LR", "      direction LR")))).toEqual({
      A: { x: 36, y: 128 },
      B: { x: 110, y: 128 },
      C: { x: 175, y: 128 },
    });
  });

  it("places the same boxes for `direction LR` outside and `direction TB` inside", () => {
    // Each frame keeps its own direction: `A` over `B` in one column, `C`
    // beside the frame holding them.
    expect(nodeCentres(renderInto(nested("    direction LR", "      direction TB")))).toEqual({
      A: { x: 52, y: 128 },
      B: { x: 52, y: 210 },
      C: { x: 154, y: 169 },
    });
  });

  it("places the same boxes for no direction anywhere", () => {
    // No frame carries a direction, so this document goes through the layout
    // engine's ordinary compound path and must keep doing so.
    expect(nodeCentres(renderInto(nested("", "")))).toEqual({
      A: { x: 141, y: 128 },
      B: { x: 151, y: 210 },
      C: { x: 47, y: 210 },
    });
  });
});

/**
 * The three combinations around the one that breaks, pinned before the
 * coordinate guard exists so that the guard cannot quietly take them with it.
 *
 * Dagre's limitation is narrow and was measured narrowly (`01M2WQV0`): a
 * cluster carrying a `rankdir` of its own expands its children exactly one
 * level, so a *direct child that is itself a cluster* is left as an
 * unexpanded box and everything below it is never positioned at all. Every
 * neighbouring combination — nesting without a direction, a direction on the
 * innermost frame whose children are all leaves, a direction with no nesting
 * under it — lays out correctly today, in both the kinds that share this
 * layout core. A guard that fires on any of these is a wrong guard, not a
 * newly discovered defect.
 */
describe("render() — the layout combinations around per-cluster direction that do lay out", () => {
  const cases: Array<[string, string]> = [
    [
      "nested subgraphs, no direction anywhere",
      `flowchart TB
  subgraph Outer
    subgraph Inner
      A --> B
    end
    Inner --> C
  end`,
    ],
    [
      "direction on the innermost subgraph, whose children are all leaves",
      `flowchart TB
  subgraph Outer
    subgraph Inner
      direction LR
      A --> B
    end
    Inner --> C
  end`,
    ],
    [
      "direction on a subgraph with no nesting under it",
      `flowchart TB
  subgraph one
    direction LR
    A --> B
  end`,
    ],
    [
      "nested composite states, no direction anywhere",
      `stateDiagram-v2
  [*] --> Outer
  state Outer {
    state Inner {
      A --> B
    }
    Inner --> C
  }`,
    ],
    [
      "direction on the innermost composite, whose children are all leaves",
      `stateDiagram-v2
  [*] --> Outer
  state Outer {
    state Inner {
      direction LR
      A --> B
    }
    Inner --> C
  }`,
    ],
    [
      "direction on a composite with no nesting under it",
      `stateDiagram-v2
  [*] --> Outer
  state Outer {
    direction LR
    A --> B
  }`,
    ],
  ];

  for (const [name, source] of cases) {
    it(`draws a picture and says nothing: ${name}`, () => {
      const result = renderInto(source);

      expect(result.diagnostics).toEqual([]);
      expect(result.svg).not.toBeNull();
      expect(nanAttributes(result.svg!)).toEqual([]);
    });
  }
});

/**
 * A cluster carrying its own direction with another cluster as a direct child
 * — the construct that drew `NaN` into 29 attributes (`01M2WQV0`), was made to
 * refuse honestly (`01M2XJVPX`), and now draws (`01M2XJWM4`).
 *
 * **Which direction the inner frame uses is the whole of this group, and it is
 * measured, not reasoned.** `scripts/mermaid-probe.mjs --markup` on this exact
 * document under mermaid 11.17.2 places `A` at `translate(63, 68)`, `B` at
 * `translate(63, 208)` and `C` at `translate(220.5, 53)`: `A` and `B` share an
 * x **exactly**, with `B` below `A`, and `C` is off to their right. So the
 * inner frame — the one with no `direction` of its own — lays out in the
 * *document's* `TB`, and it is the outer frame's `LR` that puts `C` beside it.
 * An inner frame that inherited its parent's `LR` would put `B` to the right
 * of `A` instead, render just as cleanly, and be the wrong picture; the
 * equality of those two x's is the only thing that tells the two apart, so it
 * is asserted rather than a "no diagnostic" check.
 */
describe("render() — a cluster with its own direction holding a cluster with none", () => {
  const flowchart = `flowchart TB
  subgraph Outer
    direction LR
    subgraph Inner
      A --> B
    end
    Inner --> C
  end`;

  const stateDiagram = `stateDiagram-v2
  [*] --> Outer
  state Outer {
    direction LR
    state Inner {
      A --> B
    }
    Inner --> C
  }`;

  it("draws the flowchart spelling with the inner frame in the document's direction", () => {
    const result = renderInto(flowchart);

    expect(result.diagnostics).toEqual([]);
    expect(result.svg).not.toBeNull();
    expect(nanAttributes(result.svg!)).toEqual([]);

    const { A, B, C } = nodeCentres(result);
    expect(A.x).toBe(B.x);
    expect(B.y).toBeGreaterThan(A.y);
    expect(C.x).toBeGreaterThan(A.x);
  });

  it("draws it exactly as writing the document's own direction inside that frame does", () => {
    // The same claim as above, stated as the equivalence it is: an inner frame
    // with no `direction` is the inner frame that wrote down the document's.
    // `direction LR` inside `Inner` instead produces a different picture, which
    // the row above pins as its own characterization.
    const written = `flowchart TB
  subgraph Outer
    direction LR
    subgraph Inner
      direction TB
      A --> B
    end
    Inner --> C
  end`;

    expect(nodeCentres(renderInto(flowchart))).toEqual(nodeCentres(renderInto(written)));
  });

  it("keeps every node inside the frame that holds it", () => {
    const result = renderInto(flowchart);
    const centres = nodeCentres(result);
    const inner = subgraphFrame(result, "Inner");
    const outer = subgraphFrame(result, "Outer");

    for (const id of ["A", "B"]) {
      expect(holds(inner, centres[id])).toBe(true);
    }
    expect(holds(outer, centres.C)).toBe(true);
    expect(holds(outer, { x: inner.left, y: inner.top })).toBe(true);
    expect(holds(outer, { x: inner.right, y: inner.bottom })).toBe(true);
  });

  it("draws the state-diagram spelling on the same terms", () => {
    const result = renderInto(stateDiagram);

    expect(result.diagnostics).toEqual([]);
    expect(result.svg).not.toBeNull();
    expect(nanAttributes(result.svg!)).toEqual([]);

    const { A, B, C } = stateCentres(result);
    expect(A.x).toBe(B.x);
    expect(B.y).toBeGreaterThan(A.y);
    expect(C.x).toBeGreaterThan(A.x);
  });
});

/**
 * One valid document of each kind, used below to hand the *same* source to a
 * working measurer and a broken one.
 *
 * Each of these is asserted to render cleanly first, in every test that uses
 * it. That is not ceremony: a sequence document whose participants are never
 * declared is rejected in the graph-model stage and never reaches layout at
 * all, so a measurement guard tested with one would look like it worked
 * without the measurer having been called once.
 */
const measurableSources = {
  flowchart: `flowchart TD
  A[Start] --> B[End]
`,
  class: `classDiagram
  Animal <|-- Duck
`,
  state: `stateDiagram-v2
  state "Waiting for input" as Idle
  [*] --> Idle
  Idle --> Running
  Running --> [*]
`,
  sequence: `sequenceDiagram
  participant C as Client
  participant S as Server
  C->>S: Fetch
`,
} as const;

/**
 * Three of these four name their drawn text differently from the id that text
 * belongs to — `A[Start]`, `state "Waiting for input" as Idle`, `participant C
 * as Client` — and that separation is load-bearing rather than decorative.
 *
 * The assertion these sources feed is "the diagnostic names the text that
 * could not be measured". Where a label happens to *be* an id, that assertion
 * also passes for a diagnostic naming ids instead of text — and this pipeline
 * has one of those: `UnplacedNodesError` lists node ids. A source whose label
 * and id are the same string cannot tell the two messages apart, so it would
 * pass whichever one arrived. Only `class` still has that shape, because
 * Mermaid's class syntax has no alias form to separate them with; the other
 * three discriminate, on the same code path.
 */

/**
 * A consumer measurer that answers every string with the same given size, and
 * keeps the strings it was asked about. The answer is `unknown` because the
 * measurers being stood in for here are the ones that break the contract.
 *
 * The asked-for list is what makes "the diagnostic names the offending text"
 * checkable without copying the answer out of the implementation: the text
 * that broke is the first one this was asked to measure, which is a fact about
 * the *document and the measurer*, decided before `render()` chose any wording.
 */
function measurerAnswering(answer: unknown): TextMeasurer & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    measure(text: string) {
      asked.push(text);
      return answer as { width: number; height: number };
    },
  };
}

/** The reported fault itself: every string measured as `NaN` by `NaN`. */
const unmeasurable = (): TextMeasurer & { asked: string[] } =>
  measurerAnswering({ width: NaN, height: NaN });

/**
 * `measureText` is the consumer's code, and a real one can fail: `siren-board`
 * measures with a live `<canvas>` 2D context, which answers `NaN` when the
 * context could not be obtained or the font is not loaded yet. Whatever that
 * answer is, it arrives here as a size, and `Diagnostic`'s contract — returned
 * from `render()`, never thrown — has to survive it.
 */
describe("render() — a consumer measurer that cannot measure text", () => {
  for (const kind of ["flowchart", "class", "state"] as const) {
    it(`reports an unmeasurable label as a diagnostic rather than throwing: ${kind}`, () => {
      const source = measurableSources[kind];

      // The document itself is sound: everything below is the measurer's doing.
      const measured = render(source, document.createElement("div"));
      expect(measured.diagnostics).toEqual([]);
      expect(measured.svg).not.toBeNull();

      const measurer = unmeasurable();
      const result = render(source, document.createElement("div"), {
        measureText: measurer,
      });

      expect(result.svg).toBeNull();
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).not.toEqual([]);

      // The fault is in measuring *that string*, so that string is what the
      // author and the consumer need read back to them.
      expect(measurer.asked).not.toEqual([]);
      expect(errors.some((d) => d.message.includes(measurer.asked[0]))).toBe(true);
    });
  }

  /**
   * The kind that did not throw. `layoutSequence` reaches no shared layout
   * core, so neither dagre's own collapse nor the coordinate guard
   * `layoutDirectedGraph` grew (`01M2XJVPX`) ever fired for it: a `NaN` size
   * flowed all the way through to the markup and came back as a finished
   * `<svg>` full of `NaN` attributes with nothing said about it — a completely
   * broken picture reported as a success, which is the failure `01M2WQV0` was
   * filed for, in a fourth kind.
   */
  it("draws no sequence diagram at all rather than one full of NaN, and says why", () => {
    const source = measurableSources.sequence;

    const measured = render(source, document.createElement("div"));
    expect(measured.diagnostics).toEqual([]);
    expect(measured.svg).not.toBeNull();
    expect(nanAttributes(measured.svg!)).toEqual([]);

    const measurer = unmeasurable();
    const container = document.createElement("div");
    const result = render(source, container, { measureText: measurer });

    // Stated as "no NaN reached the markup" rather than left implied by the
    // null below, because drawing NaN is the specific harm here.
    expect(result.svg === null ? [] : nanAttributes(result.svg)).toEqual([]);
    expect(result.svg).toBeNull();
    expect(container.children.length).toBe(0);

    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).not.toEqual([]);
    expect(measurer.asked).not.toEqual([]);
    expect(errors.some((d) => d.message.includes(measurer.asked[0]))).toBe(true);
  });

  it("lets nothing escape render() for any of the four kinds", () => {
    // `Diagnostic`'s contract, stated directly: a consumer calling `render()`
    // handles a returned diagnostic, and `siren-board`'s `setSource` has no
    // `try` around this call at all — a throw here bypasses its own error
    // banner entirely and reaches the page as an unhandled exception.
    for (const source of Object.values(measurableSources)) {
      expect(() =>
        render(source, document.createElement("div"), { measureText: unmeasurable() }),
      ).not.toThrow();
    }
  });
});

/**
 * `NaN` is the answer that was reported, but it is not the question. What
 * layout needs from a measurer is **two finite numbers**, and every other way
 * of not being that is just as fatal: an infinity propagates into bounds and a
 * `viewBox` exactly as `NaN` does, a missing dimension becomes `NaN` at the
 * first subtraction, and a numeric string survives arithmetic just long enough
 * to be wrong. A guard written as "not `NaN`" would pass all four of these
 * through, so the predicate is stated positively and checked that way here.
 */
describe("render() — a measurer whose answer is not two finite numbers", () => {
  const answers: Array<[string, unknown]> = [
    ["an infinite width", { width: Infinity, height: 32 }],
    ["a negatively infinite height", { width: 120, height: -Infinity }],
    ["a dimension it left out", { width: 120 }],
    ["dimensions written as strings", { width: "120", height: "32" }],
  ];

  for (const [description, answer] of answers) {
    for (const kind of ["flowchart", "class", "state", "sequence"] as const) {
      it(`refuses ${description}, naming the text: ${kind}`, () => {
        const source = measurableSources[kind];

        const measured = render(source, document.createElement("div"));
        expect(measured.diagnostics).toEqual([]);
        expect(measured.svg).not.toBeNull();

        const measurer = measurerAnswering(answer);
        let result!: SirenRenderResult;
        expect(() => {
          result = render(source, document.createElement("div"), { measureText: measurer });
        }).not.toThrow();

        expect(result.svg).toBeNull();
        const errors = result.diagnostics.filter((d) => d.severity === "error");
        expect(measurer.asked).not.toEqual([]);
        expect(errors.some((d) => d.message.includes(measurer.asked[0]))).toBe(true);
      });
    }
  }
});

describe("render() — an ER diagram, end to end", () => {
  /** Renders `source` into a fresh attached container and hands back the result. */
  const renderEr = (source: string) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    return { container, result: render(source, container) };
  };

  it("mounts one box per standalone entity, each carrying its id and its name", () => {
    // The whole of this ticket, read off the picture. Measured (mermaid
    // 11.17.2): `erDiagram / CUSTOMER / ORDER` reports two entities and no
    // relationships, and draws a box apiece — an entity nothing points at is
    // legal ER, not an empty diagram.
    const { container, result } = renderEr("erDiagram\n  CUSTOMER\n  ORDER\n");

    expect(result.diagnostics).toEqual([]);
    expect(result.svg).not.toBeNull();
    expect(container.contains(result.svg!)).toBe(true);

    const svg = result.svg!;
    const groups = Array.from(svg.querySelectorAll("g.siren-er-entity"));
    expect(groups.map((g) => g.getAttribute("data-siren-id"))).toEqual([
      "CUSTOMER",
      "ORDER",
    ]);
    expect(
      groups.map((g) => g.querySelector("text.siren-er-entity-label")!.textContent),
    ).toEqual(["CUSTOMER", "ORDER"]);
    // A box apiece, and each name inside the box that names it — a label
    // drawn anywhere in the picture would pass a text-only check.
    for (const group of groups) {
      const frame = group.querySelector("rect.siren-er-entity-frame")!;
      const label = group.querySelector("text.siren-er-entity-label")!;
      const [x, y, width, height] = ["x", "y", "width", "height"].map((name) =>
        Number(frame.getAttribute(name)),
      );
      expect(Number(label.getAttribute("x"))).toBeGreaterThan(x);
      expect(Number(label.getAttribute("x"))).toBeLessThan(x + width);
      expect(Number(label.getAttribute("y"))).toBeGreaterThan(y);
      expect(Number(label.getAttribute("y"))).toBeLessThan(y + height);
    }
  });

  it("draws a hyphenated entity name, which a flowchart id still cannot carry", () => {
    // `LINE-ITEM` is ordinary ER (measured: one entity) and is the reason
    // this kind reads its own name alphabet rather than borrowing `\w+`.
    const { result } = renderEr("erDiagram\n  LINE-ITEM\n");

    expect(result.diagnostics).toEqual([]);
    expect(
      result.svg!.querySelector('g.siren-er-entity[data-siren-id="LINE-ITEM"] text')!
        .textContent,
    ).toBe("LINE-ITEM");
  });

  it("returns a working controller for an ER diagram, as every other kind does", () => {
    // `SirenRenderResult.controller` is null *only* when rendering failed, so
    // a kind that returned none would break that promise for its callers.
    const { result } = renderEr("erDiagram\n  CUSTOMER\n");

    expect(result.controller).not.toBeNull();
    expect(result.controller!.totalSteps).toBe(0);
  });

  it("draws a header-only document as an empty picture, with nothing said", () => {
    // Measured: `erDiagram` alone is not an error in Mermaid — it reports
    // the diagram type with an empty entity table. Refusing it would cost a
    // document Mermaid renders.
    const { result } = renderEr("erDiagram\n");

    expect(result.diagnostics).toEqual([]);
    expect(result.svg).not.toBeNull();
    expect(result.svg!.querySelectorAll("g.siren-er-entity")).toHaveLength(0);
  });

  it("refuses each unimplemented construct by name, and draws nothing", () => {
    // CONTEXT.md's opening policy, end to end: an author reaching for a
    // construct this kind has not implemented is told *which* is missing,
    // rather than that their document is malformed — and gets no picture,
    // rather than a partial one with the construct drawn away.
    //
    // `CUSTOMER ||--o{ ORDER : places` used to head this list and no longer
    // does: relationships are drawn. What remains of that construct is
    // Mermaid's fifth cardinality, `u` (`MD_PARENT`) — measured, it parses
    // and then renders with no marker at all on that end, so nothing in the
    // document says what it means.
    //
    // An entity's attribute block has left this list the same way, and for
    // the same reason: `CUSTOMER { string name }` is drawn as a table now,
    // so naming it here would be a refusal of a construct this kind reads.
    //
    // `direction LR` has left it outright — it ranks the diagram now — and
    // **the alias has now left it in both spellings**: `A[Unquoted]` records
    // the same `alias` field the quoted one does and is read here too, so
    // what is left of that construct is a *narrower alphabet* rather than a
    // missing feature. `CUSTOMER[Customer Account]` — two words — is a
    // Mermaid parse error, and the honest answer to it is the generic
    // unrecognized-line message rather than a refusal by name, which would
    // tell an author a construct is unimplemented when their document is
    // simply malformed.
    //
    // The `u` case is spelled in **both** cases, because Mermaid's lexer
    // rules are all `/i` and a refusal that read only the small one told an
    // author of the shouted document the wrong thing.
    const cases: [string, string][] = [
      ["A u--o{ B : x", 'the "u" (MD_PARENT) relationship cardinality'],
      ["A U--o{ B : x", 'the "u" (MD_PARENT) relationship cardinality'],
    ];

    for (const [line, name] of cases) {
      const { result } = renderEr(`erDiagram\n  ${line}\n`);

      expect(result.svg, line).toBeNull();
      expect(
        result.diagnostics.map((d) => `${d.severity}: ${d.message}`),
        line,
      ).toEqual([
        `error: Unimplemented erDiagram construct: ${name}, in "${line.split("\n")[0].trim()}"`,
      ]);
    }
  });

  it("renders examples/er-core.srn end to end with zero diagnostics \u2014 every construct this kind reads: a standalone entity, both line types, all four cardinalities in both spellings, an alias, an attribute table, a document direction and a subgraph cluster with a direction of its own", () => {
    // Zero diagnostics of *any* severity, which is a stronger claim than the
    // `examples/` enumeration test above makes: that one filters to error
    // severity, so a warning would slip past it unremarked.
    const { result } = renderEr(readExample("er-core"));

    expect(result.diagnostics).toEqual([]);
    const svg = result.svg!;

    // Drift guards first: the assertions below are only worth their ink
    // while the document still declares what it claims to. Read off the
    // source rather than trusted, so deleting a line from the example fails
    // here instead of quietly shrinking the coverage.
    const source = readExample("er-core");
    for (const [what, spelling] of [
      ["a standalone entity", "\nPRODUCT\n"],
      ["an alias", 'CUSTOMER["Customer Account"]'],
      ["a document direction", "direction LR"],
      ["an attribute with a key list and a comment", 'string id PK "the account number"'],
      ["an attribute with two keys", "string email UK,FK"],
      ["a solid relationship", "||--o{"],
      ["a dashed relationship", "|o..o|"],
      ["the third dashed spelling", "}|.-|{"],
      ["the word spelling of a relationship", "one to zero or many"],
      ["a subgraph cluster", "subgraph fulfilment"],
      ["a per-cluster direction", "\n  direction TB\n"],
    ] as [string, string][]) {
      expect(source.includes(spelling), `examples/er-core.srn no longer declares ${what}`).toBe(
        true,
      );
    }

    // Six entities: the four declared by name and the two a relationship
    // brought in (`ADDRESS`, and `WAREHOUSE` which is also declared). The
    // order is first mention across both kinds of statement, which is
    // Mermaid's own table order (measured).
    const entities = Array.from(svg.querySelectorAll("g.siren-er-entity"));
    expect(entities.map((g) => g.getAttribute("data-siren-id"))).toEqual([
      "CUSTOMER",
      "ORDER",
      "LINE-ITEM",
      "PRODUCT",
      "WAREHOUSE",
      "ADDRESS",
    ]);

    // The cluster: one frame, titled by the author's own word, holding
    // exactly the two entities the block named and neither of the two
    // beside it. Read as containment rather than as coordinates — measured
    // against mermaid, `getSubGraphs()` for this document answers
    // `[{id:"fulfilment", nodes:["ORDER","LINE-ITEM"], dir:"TB"}]` while
    // `getDirection()` stays `LR`, so the frame's own direction is not the
    // document's.
    const box = (element: Element | null) => {
      if (element === null) throw new Error("nothing to measure");
      const number = (name: string) => Number(element.getAttribute(name));
      return {
        left: number("x"),
        top: number("y"),
        right: number("x") + number("width"),
        bottom: number("y") + number("height"),
      };
    };
    const holds = (
      outer: ReturnType<typeof box>,
      inner: ReturnType<typeof box>,
    ) =>
      outer.left <= inner.left &&
      outer.top <= inner.top &&
      outer.right >= inner.right &&
      outer.bottom >= inner.bottom;
    const entityRect = (id: string) =>
      box(svg.querySelector(`g.siren-er-entity[data-siren-id="${id}"] rect.siren-er-entity-frame`));

    const clusters = Array.from(svg.querySelectorAll("g.siren-er-subgraph"));
    expect(clusters).toHaveLength(1);
    expect(clusters[0].querySelector("text.siren-er-subgraph-label")!.textContent).toBe(
      "fulfilment",
    );
    const frame = box(clusters[0].querySelector("rect.siren-er-subgraph-frame"));
    expect(holds(frame, entityRect("ORDER"))).toBe(true);
    expect(holds(frame, entityRect("LINE-ITEM"))).toBe(true);
    expect(holds(frame, entityRect("PRODUCT"))).toBe(false);
    expect(holds(frame, entityRect("CUSTOMER"))).toBe(false);
    // The block's own `TB` against the document's `LR`, read as geometry:
    // its two members stack rather than standing side by side. Nothing but
    // this line tells that picture from the one a cluster silently taking
    // the document's direction would draw.
    expect(entityRect("ORDER").bottom).toBeLessThanOrEqual(entityRect("LINE-ITEM").top);

    // The alias renames the box and nothing else: `CUSTOMER` is still the id
    // above, and "Customer Account" is what is drawn.
    expect(
      svg.querySelector('g.siren-er-entity[data-siren-id="CUSTOMER"] text.siren-er-entity-label')!
        .textContent,
    ).toBe("Customer Account");

    // Every relationship, with the marker drawn at each end — the end-by-end
    // reading a crossed `cardA`/`cardB` needs, since three of the pairs are
    // symmetric and would pass a swapped implementation.
    const markerName = (line: Element, which: "marker-start" | "marker-end") =>
      (line.getAttribute(which) ?? "")
        .replace(/^url\(#siren-er-/, "")
        // The render's own id scope (`mintIdScope`), stripped so the claim
        // reads as which marker is at which end rather than as a token
        // nothing can predict.
        .replace(/__[a-z0-9]+\)$/, "");
    expect(
      Array.from(svg.querySelectorAll("g.siren-er-relationship")).map((g) => {
        const line = g.querySelector("path.siren-er-relationship-line")!;
        const dashed = line.getAttribute("stroke-dasharray") !== null;
        return (
          `${g.getAttribute("data-siren-id")}: ${markerName(line, "marker-start")}` +
          `-${dashed ? "dashed" : "solid"}-${markerName(line, "marker-end")}`
        );
      }),
    ).toEqual([
      "CUSTOMER:ORDER: only-one-solid-zero-or-more",
      "CUSTOMER:ADDRESS: zero-or-one-dashed-zero-or-one",
      "ORDER:LINE-ITEM: only-one-solid-one-or-more",
      "LINE-ITEM:PRODUCT: zero-or-more-solid-only-one",
      "PRODUCT:WAREHOUSE: one-or-more-dashed-one-or-more",
      "PRODUCT:LINE-ITEM: only-one-solid-zero-or-more",
    ]);

    // ⚠️ `LINE-ITEM:PRODUCT` is the reason this kind joins with a colon and
    // the other four keep `-`. Under the old spelling that id was
    // `LINE-ITEM-PRODUCT`, which is a name `LINE-ITEM-PRODUCT` could have
    // been declared under — `-` is inside this kind's name alphabet — and
    // the two elements would have worn one `data-siren-id` with nothing
    // said. A colon cannot be written in an unquoted ER name at all.

    // And the attribute table is drawn, cell by cell, in the columns the
    // entity actually uses — four for `CUSTOMER`, which writes keys and a
    // comment, and two for `LINE-ITEM`, which writes neither.
    const cellsOf = (id: string) =>
      Array.from(
        svg.querySelectorAll(`g.siren-er-entity[data-siren-id="${id}"] text.siren-er-attribute`),
      ).map((cell) => `${cell.getAttribute("class")!.split(" ")[1]}=${cell.textContent}`);
    expect(cellsOf("CUSTOMER")).toEqual([
      "siren-er-attribute-type=string",
      "siren-er-attribute-name=id",
      "siren-er-attribute-keys=PK",
      "siren-er-attribute-comment=the account number",
      "siren-er-attribute-type=string",
      "siren-er-attribute-name=name",
      "siren-er-attribute-keys=",
      "siren-er-attribute-comment=",
      "siren-er-attribute-type=string",
      "siren-er-attribute-name=email",
      "siren-er-attribute-keys=UK,FK",
      "siren-er-attribute-comment=",
    ]);
    expect(cellsOf("LINE-ITEM")).toEqual([
      "siren-er-attribute-type=int",
      "siren-er-attribute-name=quantity",
      "siren-er-attribute-type=int",
      "siren-er-attribute-name=price",
    ]);

    // The direction is `LR`, which nothing but where the boxes landed can
    // say: a direction read and dropped leaves every diagnostic empty. Under
    // `LR` the first rank is left of the second; under the default `TB` it
    // would be above it.
    const boxOf = (id: string) =>
      svg.querySelector(`g.siren-er-entity[data-siren-id="${id}"] rect.siren-er-entity-frame`)!;
    expect(Number(boxOf("CUSTOMER").getAttribute("x"))).toBeLessThan(
      Number(boxOf("ORDER").getAttribute("x")),
    );
  });

  it("drives examples/er-reveal.srn's timeline through all three of this kind's addressable targets \u2014 an entity, a relationship and a `subgraph` cluster \u2014 with next(), prev() and reset()", () => {
    const { result } = renderEr(readExample("er-reveal"));

    // Zero diagnostics of any severity: a relationship left drawn after an
    // endpoint exits is a *warning*, so an example that got this wrong would
    // still pass the enumeration test above.
    expect(result.diagnostics).toEqual([]);
    const controller = result.controller!;
    expect(controller.totalSteps).toBe(6);

    const svg = result.svg!;
    // Ids, not elements: a labelled relationship's line and label are two
    // groups wearing one id (ADR-0016), and both start hidden.
    const pendingIds = () =>
      [
        ...new Set(
          Array.from(svg.querySelectorAll(".siren-pending")).map((el) =>
            el.getAttribute("data-siren-id"),
          ),
        ),
      ].sort();

    // Exactly the six ids with an `enter` action start hidden, across all
    // three kinds an author can address here.
    expect(pendingIds()).toEqual([
      "CUSTOMER",
      "CUSTOMER:ORDER",
      "LINE-ITEM",
      "ORDER",
      "ORDER:LINE-ITEM",
      "subgraph:1",
    ]);

    const entity = (id: string) =>
      svg.querySelector(`g.siren-er-entity[data-siren-id="${id}"]`)!;
    const relationship = (id: string) =>
      svg.querySelector(`g.siren-er-relationship[data-siren-id="${id}"]`)!;
    const customer = entity("CUSTOMER");
    const order = entity("ORDER");
    const lineItem = entity("LINE-ITEM");
    const places = relationship("CUSTOMER:ORDER");
    const contains = relationship("ORDER:LINE-ITEM");
    const cluster = svg.querySelector('g.siren-er-subgraph[data-siren-id="subgraph:1"]')!;

    // \u26a0\ufe0f **A cluster's id is not its name** (ADR-0010), and the document's
    // own text is what says so: the frame is *titled* `fulfilment` and is
    // *addressed* as `subgraph:1`. Asserted here rather than left to the
    // enumeration test above, which only filters `error` \u2014 a target that
    // resolved to nothing would be a warning and would slip through it.
    expect(cluster.querySelector("text.siren-er-subgraph-label")!.textContent).toBe(
      "fulfilment",
    );

    // Step 1: an entity enters — under the name its **author** wrote, while
    // its box draws the alias. The two parting is the whole point of
    // `ResolvedErEntity`'s two fields.
    controller.next();
    expect(customer.classList.contains("siren-pending")).toBe(false);
    expect(customer.classList.contains("siren-enter-fade")).toBe(true);
    expect(customer.querySelector("text.siren-er-entity-label")!.textContent).toBe(
      "Customer Account",
    );
    expect(order.classList.contains("siren-pending")).toBe(true);

    // Step 2: a relationship enters beside the entity it points at — the
    // second target kind, and the one whose id nothing in the document
    // spells out.
    controller.next();
    expect(order.classList.contains("siren-enter-slide-top")).toBe(true);
    expect(places.classList.contains("siren-pending")).toBe(false);
    expect(places.classList.contains("siren-enter-fade")).toBe(true);

    // Step 3: the **third** target kind — the frame itself enters, beside
    // the entity it comes to hold and the relationship into it. A cluster is
    // a drawn element with an id of its own, so it animates exactly as the
    // other two do.
    controller.next();
    expect(cluster.classList.contains("siren-pending")).toBe(false);
    expect(cluster.classList.contains("siren-enter-fade")).toBe(true);
    expect(lineItem.classList.contains("siren-enter-slide-right")).toBe(true);

    // Step 4: a highlight on an entity that is already on screen.
    controller.next();
    expect(customer.classList.contains("siren-highlight-outline")).toBe(true);

    // Step 5: the highlight moves to the relationship, in the other effect.
    controller.next();
    expect(places.classList.contains("siren-highlight-glow")).toBe(true);
    expect(customer.classList.contains("siren-highlight-outline")).toBe(false);

    // Step 6: both ends of the tail leave together, which is what keeps this
    // document free of the connector-outlives-its-endpoint warning.
    controller.next();
    expect(controller.currentStep).toBe(6);
    expect(contains.classList.contains("siren-exit-fade")).toBe(true);
    expect(lineItem.classList.contains("siren-exit-slide-right")).toBe(true);

    // Stepping back undoes exactly the last step.
    controller.prev();
    expect(contains.classList.contains("siren-exit-fade")).toBe(false);
    expect(places.classList.contains("siren-highlight-glow")).toBe(true);

    // And reset returns both kinds to the state step 0 established.
    controller.reset();
    expect(controller.currentStep).toBe(0);
    expect(pendingIds()).toEqual([
      "CUSTOMER",
      "CUSTOMER:ORDER",
      "LINE-ITEM",
      "ORDER",
      "ORDER:LINE-ITEM",
      "subgraph:1",
    ]);
    expect(places.classList.contains("siren-highlight-glow")).toBe(false);
  });

  it("lands a relationship's highlight and exit on both its line group and its label group (ADR-0016)", () => {
    const { result } = renderEr(
      "erDiagram\n" +
        "  CUSTOMER ||--o{ ORDER : places\n" +
        "timeline:\n" +
        "  highlight CUSTOMER:ORDER outline\n" +
        "  exit CUSTOMER:ORDER fade\n",
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const line = result.svg!.querySelector('g.siren-er-relationship[data-siren-id="CUSTOMER:ORDER"]')!;
    const labels = result.svg!.querySelector(
      'g.siren-er-relationship-labels[data-siren-id="CUSTOMER:ORDER"]',
    );
    expect(labels).not.toBeNull();

    result.controller!.next();
    expect(line.classList.contains("siren-highlight-outline")).toBe(true);
    expect(labels!.classList.contains("siren-highlight-outline")).toBe(true);

    result.controller!.next();
    expect(line.classList.contains("siren-exit-fade")).toBe(true);
    expect(labels!.classList.contains("siren-exit-fade")).toBe(true);
  });

  it("stamps the same data-siren-id on every figure when one document is rendered twice", () => {
    // ADR-0009 makes a timeline target an id, so an id that differed between
    // two renders would make a `timeline:` block mean one thing on the first
    // paint and another on the second — a board re-rendering on every source
    // change does exactly that. Every id this kind mints is a function of the
    // source's own names and order, and nothing here counts renders or reads
    // a clock; this is what says so.
    const source = readExample("er-core");
    const idsOf = () =>
      Array.from(renderEr(source).result.svg!.querySelectorAll("[data-siren-id]")).map(
        (el) => `${el.getAttribute("class")}#${el.getAttribute("data-siren-id")}`,
      );

    const first = idsOf();
    expect(first.length).toBeGreaterThan(0);
    expect(idsOf()).toEqual(first);

    // The repeated ordered pair, whose id is the one thing here that is
    // *counted* rather than read: `#2` has to fall on the same relationship
    // both times, so the count must restart per render.
    const repeated = "erDiagram\n  A ||--o{ B : first\n  A }o--|| B : second\n";
    const repeatedIds = () =>
      Array.from(
        renderEr(repeated).result.svg!.querySelectorAll("g.siren-er-relationship"),
      ).map((el) => el.getAttribute("data-siren-id"));

    expect(repeatedIds()).toEqual(["A:B", "A:B#2"]);
    expect(repeatedIds()).toEqual(["A:B", "A:B#2"]);
  });

  it("animates an ER cluster named in a timeline block, frame and title together", () => {
    // **ER's third timeline target**, beside the entity and the
    // relationship. A frame nobody can name would be a decision by
    // omission, and ADR-0009's "a target is an id" is what takes the title
    // with the frame — the very rule the flowchart's own subgraph follows.
    // The id is the generated `subgraph:1`, never the author's `sales`.
    const { result } = renderEr(`erDiagram
subgraph sales
  CUSTOMER ||--o{ ORDER : places
end

timeline:
enter subgraph:1 fade
highlight subgraph:1 outline
`);
    expect(result.diagnostics).toEqual([]);

    const drawn = () => Array.from(result.svg!.querySelectorAll('[data-siren-id="subgraph:1"]'));
    expect(drawn().map((el) => el.tagName)).toEqual(["g"]);
    expect(drawn()[0].classList.contains("siren-pending")).toBe(true);

    result.controller!.next();
    expect(drawn()[0].classList.contains("siren-pending")).toBe(false);

    result.controller!.next();
    expect(drawn()[0].classList.contains("siren-highlight-outline")).toBe(true);
  });

  it("leaves the cluster id space unchanged for a document that groups nothing", () => {
    // The grouping construct adds an id space to the document; a document
    // that uses none must not gain one. Nothing here draws a frame, and
    // `subgraph:1` names nothing an author could reach — which also keeps
    // `reportIdCollisions` quiet for every ER document written before this
    // construct existed.
    const { result } = renderEr("erDiagram\n  CUSTOMER ||--o{ ORDER : places\n");

    expect(result.diagnostics).toEqual([]);
    expect(result.svg!.querySelectorAll("g.siren-er-subgraph")).toHaveLength(0);
    expect(result.svg!.querySelectorAll('[data-siren-id="subgraph:1"]')).toHaveLength(0);
  });

  it("warns when a quoted entity name collides with a relationship id, and still draws both", () => {
    // **The check `01M3977716` left aimed at this ticket, now reachable from
    // source for the first time.** A relationship's id is `${from}:${to}`,
    // and a colon is refused everywhere an *unquoted* ER name is read — but
    // a quoted one takes anything (measured: `"CUSTOMER:ORDER" ||--|| X : y`
    // parses and is keyed on exactly that string). So this document mints
    // `CUSTOMER:ORDER` twice: once for the box, once for the line.
    //
    // The whole point of the warning is that it is **not** a refusal.
    // Mermaid draws this document, so Siren draws it — the picture was never
    // the ambiguous part. What is ambiguous is a `timeline:` entry naming
    // the shared id, which `createAnimationController` resolves with
    // `querySelectorAll` and so applies to every element wearing it
    // (ADR-0009).
    const { result } = renderEr(
      'erDiagram\n  "CUSTOMER:ORDER"\n  CUSTOMER ||--o{ ORDER : places\n',
    );

    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        message:
          'id collision: "CUSTOMER:ORDER" is drawn on an entity and a relationship — a ' +
          "`timeline:` entry naming it addresses every one of them (ADR-0009)",
      },
    ]);

    // Drawn, and drawn whole: three boxes and one line. A refusal here would
    // be a Mermaid-renders-Siren-doesn't case, which is the thing this
    // project exists to prevent.
    const svg = result.svg!;
    expect(
      Array.from(svg.querySelectorAll("g.siren-er-entity")).map((g) =>
        g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["CUSTOMER:ORDER", "CUSTOMER", "ORDER"]);
    expect(
      Array.from(svg.querySelectorAll("g.siren-er-relationship")).map((g) =>
        g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["CUSTOMER:ORDER"]);

    // And the control: the same document with the quotes taken off the first
    // line is three separate ids and no warning at all, so the diagnostic is
    // a fact about the collision rather than about quoted names.
    const clean = renderEr(
      "erDiagram\n  CUSTOMER_ORDER\n  CUSTOMER ||--o{ ORDER : places\n",
    ).result;
    expect(clean.diagnostics).toEqual([]);
  });

  it("names the keyword an ER author actually typed when a class nothing defines is applied", () => {
    // `class X name` and `X:::name` are **one construct in two spellings**
    // (measured: both reach `setClass` and leave `cssClasses="default
    // name"`), so both arrive at `resolveStyles` as the same `apply`. What
    // must not be shared is the word the diagnostic quotes: telling an
    // author who wrote `:::` that their `class` is wrong points at a line
    // they never wrote.
    //
    // ⚠️ This is also what keeps `er-style-class-shorthand` a **refusal**
    // while `er-style-class-shorthand-defined` is supported. Mermaid draws
    // this document and paints nothing; Siren reports the undefined class
    // name, a rule settled for every kind that styles (`01M36C2S4`), so
    // Siren is the stricter of the two here. The corpus row records that
    // divergence but can only say "some error-severity diagnostic" — the
    // message itself is this test's.
    const { result } = renderEr(
      "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER:::urgent\n  class CUSTOMER missing\n",
    );

    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        message: '::: applies "urgent", which no classDef defines; dropping the declaration.',
        line: 3,
        column: 3,
      },
      {
        severity: "error",
        message: 'class applies "missing", which no classDef defines; dropping the declaration.',
        line: 4,
        column: 3,
      },
    ]);
    // The picture is still drawn — a dropped declaration costs itself, not
    // the diagram.
    expect(
      Array.from(result.svg!.querySelectorAll("g.siren-er-entity")).map((g) =>
        g.getAttribute("data-siren-id"),
      ),
    ).toEqual(["CUSTOMER", "ORDER"]);

    // The control: an unknown **target** is dropped in silence, exactly as
    // Mermaid drops it — measured, `class A,Ghost urgent` in a flowchart
    // gives `A` the class and never makes a vertex called `Ghost`. Two
    // different mistakes, and only one of them speaks.
    const quiet = renderEr(
      "erDiagram\n  classDef urgent fill:#f96\n  CUSTOMER\n  class CUSTOMER,Ghost urgent\n",
    ).result;
    expect(quiet.diagnostics).toEqual([]);
    expect(
      quiet
        .svg!.querySelector('g.siren-er-entity[data-siren-id="CUSTOMER"] rect.siren-er-entity-frame')!
        .getAttribute("style"),
    ).toBe("fill:#f96");
  });
});

describe("render() — sequence-diagram keywords are case-insensitive, as in Mermaid", () => {
  /**
   * The drawn picture as data: every element's tag, classes, timeline id and
   * own text. Marker ids are left out on purpose — they are minted fresh per
   * render (mintIdScope), so two renders of one document differ there and
   * nowhere else.
   */
  function picture(source: string): { diagnostics: string[]; elements: string[] } {
    const result = render(source, document.createElement("div"));
    const elements = Array.from(result.svg?.querySelectorAll("*") ?? []).map((el) => {
      const ownText = Array.from(el.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent)
        .join("");
      return [
        el.tagName,
        el.getAttribute("class") ?? "",
        el.getAttribute("data-siren-id") ?? "",
        ["x", "y", "x1", "x2", "width"].map((a) => el.getAttribute(a) ?? "").join(","),
        ownText,
      ].join(" | ");
    });
    return { diagnostics: result.diagnostics.map((d) => d.message), elements };
  }

  function expectSamePicture(upper: string, lower: string): void {
    const expected = picture(lower);
    expect(expected.diagnostics).toEqual([]);
    expect(expected.elements.length).toBeGreaterThan(0);
    expect(picture(upper)).toEqual(expected);
  }

  it("reads Note and its position words in any case, on the side they name", () => {
    expectSamePicture(
      `sequenceDiagram
participant A
participant B
A->>B: hi
Note LEFT OF A: left
NOTE Right Of B: right
note Over A,B: both`,
      `sequenceDiagram
participant A
participant B
A->>B: hi
note left of A: left
note right of B: right
note over A,B: both`,
    );
  });

  it("reads Participant, Actor and AS in any case, keeping the id's and label's own case", () => {
    expectSamePicture(
      `sequenceDiagram
Participant Alice AS Al
ACTOR Bob as Bobby
Alice->>Bob: hi`,
      `sequenceDiagram
participant Alice as Al
actor Bob as Bobby
Alice->>Bob: hi`,
    );
  });

  it("reads activate, deactivate, autonumber, create and destroy in any case", () => {
    const doc = (activate: string, deactivate: string, autonumber: string, off: string, create: string, destroy: string) =>
      `sequenceDiagram
participant A
participant B
${autonumber}
A->>B: one
${activate} B
B-->>A: two
${deactivate} B
${off}
${create} participant C
A->>C: three
${destroy} C`;
    expectSamePicture(
      doc("ACTIVATE", "Deactivate", "AutoNumber", "AUTONUMBER OFF", "Create", "DESTROY"),
      doc("activate", "deactivate", "autonumber", "autonumber off", "create", "destroy"),
    );
  });

  it("reads title, accTitle and link in any case, keeping their text's own case", () => {
    const doc = (title: string, accTitle: string, link: string) =>
      `sequenceDiagram
${title} Checkout Flow
${accTitle}: Screen Reader Title
participant A
${link} A: Home Page @ https://example.com
A->>A: self`;
    expectSamePicture(doc("TITLE", "AccTitle", "Link"), doc("title", "accTitle", "link"));
  });

  it("reads every block keyword and its terminators in any case", () => {
    expectSamePicture(
      `sequenceDiagram
BOX Aqua Front
  participant Z
End
participant A
participant B
Loop every minute
  A->>B: poll
  ALT fresh
    B-->>A: data
  Else stale
    B-->>A: marker
  End
End
OPT warm
  A->>B: hint
End
Par one
  A->>B: task
AND two
  B->>A: task
End
Critical lock
  A->>B: take
OPTION timeout
  B-->>A: busy
End
Break fatal
  B--xA: abort
End
RECT rgb(240, 248, 255)
  A->>B: shaded
End`,
      `sequenceDiagram
box Aqua Front
  participant Z
end
participant A
participant B
loop every minute
  A->>B: poll
  alt fresh
    B-->>A: data
  else stale
    B-->>A: marker
  end
end
opt warm
  A->>B: hint
end
par one
  A->>B: task
and two
  B->>A: task
end
critical lock
  A->>B: take
option timeout
  B-->>A: busy
end
break fatal
  B--xA: abort
end
rect rgb(240, 248, 255)
  A->>B: shaded
end`,
    );
  });
});

describe("render() — a sequence participant is created on first mention, as in Mermaid", () => {
  /** The lanes left to right, read off the lifelines' x positions. */
  function lanes(source: string): { diagnostics: string[]; lanes: string[]; labels: Record<string, string> } {
    const result = render(source, document.createElement("div"));
    const lifelines = Array.from(result.svg?.querySelectorAll("line.siren-lifeline") ?? []);
    const labels: Record<string, string> = {};
    for (const group of Array.from(result.svg?.querySelectorAll("g.siren-participant") ?? [])) {
      labels[group.getAttribute("data-siren-id")!] = group.querySelector("text")?.textContent ?? "";
    }
    return {
      diagnostics: result.diagnostics.map((d) => d.message),
      lanes: lifelines
        .sort((a, b) => Number(a.getAttribute("x1")) - Number(b.getAttribute("x1")))
        .map((line) => line.getAttribute("data-siren-id")!),
      labels,
    };
  }

  it("draws a diagram that declares no participant at all, in the order they are mentioned", () => {
    const result = render(
      `sequenceDiagram
A->>B: hi
B-->>A: ok`,
      document.createElement("div"),
    );

    expect(result.diagnostics).toEqual([]);
    expect(lanes(`sequenceDiagram\nA->>B: hi\nB-->>A: ok`).lanes).toEqual(["A", "B"]);
    expect(
      Array.from(result.svg!.querySelectorAll("g.siren-message")).map((g) => g.getAttribute("data-siren-id")),
    ).toEqual(["A-B", "B-A"]);
  });

  it("orders lanes by first mention, declared or not, block bodies included", () => {
    // Measured against Mermaid 11.17.2: `participant B` then `A->>B` gives
    // B, A; a first mention inside a loop or alt is placed where it occurs.
    expect(lanes(`sequenceDiagram\nparticipant B\nA->>B: hi`)).toMatchObject({ diagnostics: [], lanes: ["B", "A"] });
    expect(
      lanes(`sequenceDiagram
participant P
loop again
  Q->>R: x
end
alt yes
  S->>P: y
else no
  T->>P: z
end
participant U`),
    ).toMatchObject({ diagnostics: [], lanes: ["P", "Q", "R", "S", "T", "U"] });
  });

  it("creates a participant first named by a note, activate, deactivate or destroy", () => {
    // Measured against Mermaid 11.17.2: a note on an undeclared Z creates Z,
    // `activate Z` creates Z, and `destroy X` on an only-mentioned X is kept.
    const result = lanes(`sequenceDiagram
participant A
note right of Z: aside
activate Y
A->>Y: call
deactivate Y
A->>X: bye
destroy X`);

    expect(result).toMatchObject({ diagnostics: [], lanes: ["A", "Z", "Y", "X"] });
  });

  it("applies a later declaration's label and kind without moving the lane", () => {
    // Measured against Mermaid 11.17.2: `A->>B` then `participant B as Bee`
    // keeps A, B and labels B `Bee`; `actor B as Bee` also makes it an actor.
    expect(lanes(`sequenceDiagram\nA->>B: x\nparticipant B as Bee`)).toMatchObject({
      diagnostics: [],
      lanes: ["A", "B"],
      labels: { A: "A", B: "Bee" },
    });

    const result = render(`sequenceDiagram\nA->>B: x\nactor B as Bee`, document.createElement("div"));
    expect(result.diagnostics).toEqual([]);
    expect(result.svg!.querySelector('g.siren-participant[data-siren-id="B"] circle')).not.toBeNull();
  });

  it("still refuses to create a participant that was already mentioned", () => {
    // Measured against Mermaid 11.17.2: `A->>X` then `create participant X`
    // is a parse error — an id cannot name two actors.
    const result = render(`sequenceDiagram\nA->>X: x\ncreate participant X\nA->>X: y`, document.createElement("div"));

    expect(result.diagnostics).toMatchObject([
      { severity: "error", line: 3 },
    ]);
    expect(result.diagnostics[0].message).toContain('"X"');
  });

  it("lets the timeline name an implicitly created participant", () => {
    const result = render(`sequenceDiagram\nA->>B: hi\n\ntimeline:\n  enter B fade, enter A-B fade`, document.createElement("div"));

    expect(result.diagnostics).toEqual([]);
    const b = () => Array.from(result.svg!.querySelectorAll('[data-siren-id="B"]'));
    expect(b().every((el) => el.classList.contains("siren-pending"))).toBe(true);
    result.controller!.next();
    expect(b().every((el) => el.classList.contains("siren-enter-fade"))).toBe(true);
  });
});
