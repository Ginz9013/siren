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

/**
 * Kept identical to demos/sequence-diagram.html's third fetched example,
 * examples/sequence-full.srn — duplicated inline for the same reason as the
 * two constants above (no `node:fs` typings in this package).
 *
 * The board's closing example: every in-scope feature in one document —
 * `participant` and `actor` declarations, a `box` grouping, `title`,
 * `autonumber`/`autonumber off`, all ten arrow forms, a self-message, all
 * seven block kinds with `alt` nested inside `loop`, and `create`/`destroy`
 * both at the top level (`Ledger`) and inside a block body (`Retry`,
 * destroyed from inside the nested `alt`; `Auditor`, created inside `opt`
 * and never destroyed).
 */
const SEQUENCE_FULL_EXAMPLE_SOURCE = `sequenceDiagram
title Checkout — every sequence feature
box Blue Storefront
  actor Shopper
  participant Web
end
participant Orders
participant Payments

autonumber
Shopper->>Web: Open checkout
Web->>Orders: Create draft order
Orders->>Orders: Validate line items
Orders-->>Web: Draft ready
autonumber off

create participant Ledger
Web->>Ledger: Open ledger entry
Web->Payments: Quote fees
Web-->Payments: Re-quote after tax
Web<<->>Payments: Agree currency
Web<<-->>Payments: Confirm currency

loop Every authorization attempt
  Web->>Payments: Authorize
  create participant Retry
  Web->>Retry: Schedule a retry
  alt approved
    Payments-->>Web: Approved
    destroy Retry
  else declined
    Payments-xWeb: Declined
  else timed out
    Payments--xWeb: No response
  end
end
opt Shopper opted into the audit trail
  create actor Auditor
  Web-)Auditor: Notify audit trail
end
par Settle
  Orders->>Payments: Capture funds
and Record
  Orders->>Auditor: Record capture
end
critical Reserve stock
  Orders->>Ledger: Post reservation
option Warehouse offline
  Ledger--)Orders: Deferred
end
break Fraud detected
  Payments--xOrders: Hard decline
end
rect rgb(240, 248, 255)
  Web-->>Shopper: Show confirmation
end
destroy Ledger
Web-->>Shopper: Email receipt
`;

/**
 * Kept identical to demos/class-diagram.html's fetched example,
 * examples/class-core.srn — duplicated inline for the same reason as the
 * sequence constants above (no `node:fs` typings in this package). If the
 * two ever drift, this test and the demo page stop exercising the same
 * source.
 *
 * Exercises the class-diagram features that are in scope up to this ticket:
 * all three declaration forms (`class X`, the block form, and the inline
 * `X : +member` form), implicit declaration from a relationship (`Habitat`
 * and `Keeper` are named nowhere else), every visibility marker and both
 * classifiers, attributes and methods with types and return types, and all
 * eight relationship kinds — one of them with multiplicity at both ends.
 * Annotations, generics, namespaces and notes are deliberately absent: they
 * parse, but nothing downstream draws them until later tickets on this board.
 */
const CLASS_CORE_EXAMPLE_SOURCE = `classDiagram
class Animal {
  +int age
  +String gender
  #bool warmBlooded
  ~String tag
  +isMammal() bool
  +mate(Animal partner) Animal
}
class Duck {
  -String beakColor
  +swim()
  +quack() String
}
class Fish {
  -int sizeInFeet
  #canEat() bool
}
class Zebra {
  +bool isWild
  +run()*
}
class Flyer {
  +fly() bool
}
class Registry {
  -int cachedCount$
  +lookup(String name) Animal$
}

Feather : +String color
Feather : +float lengthInCm

Animal <|-- Duck
Animal <|-- Fish
Animal <|-- Zebra
Duck ..|> Flyer : implements
Habitat *-- Animal : houses
Duck o-- Feather : plumage
Keeper "1" --> "*" Animal : cares for
Keeper -- Habitat
Registry ..> Animal : looks up
Zebra .. Habitat
`;

/**
 * Kept identical to demos/class-diagram.html's second fetched example,
 * examples/class-structure.srn — duplicated inline for the same reason as the
 * constants above (no `node:fs` typings in this package). If the two ever
 * drift, this test and the demo page stop exercising the same source.
 *
 * Where CLASS_CORE_EXAMPLE_SOURCE covers declarations, members and the eight
 * relationship kinds, this one covers the structural features layered on top:
 * a `direction` statement, a `namespace` frame, an `<<interface>>` and an
 * `<<abstract>>` annotation, a generic class (with a nested generic member
 * type), a free note and a note attached to a class.
 */
const CLASS_STRUCTURE_EXAMPLE_SOURCE = `classDiagram
direction LR

namespace Shapes {
  class Shape {
    <<interface>>
    +String name
    +area() float
  }
  class Square {
    +float side
    +area() float
  }
  class Circle {
    +float radius
    +area() float
  }
}

class Registry~T~ {
  -Map~String, List~T~~ entries
  +register(String name, T item)
  +lookup(String name) T
}

class Renderer {
  <<abstract>>
  +draw(Shape shape)*
}

Square ..|> Shape
Circle ..|> Shape
Registry ..> Shape : caches
Renderer ..> Shape : draws

note "Every structural feature in one document"
note for Registry "One registry per shape kind"
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
    expect(box.getAttribute("data-siren-id")).toBe("box-1");
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

    const result = render(SEQUENCE_FULL_EXAMPLE_SOURCE, container);

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.controller).toBeNull();
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
      "alt-1",
      "break-1",
      "critical-1",
      "loop-1",
      "opt-1",
      "par-1",
      "rect-1",
    ]);
    const block = (id: string) =>
      svg.querySelector(`g.siren-block[data-siren-id="${id}"]`)!;
    expect(block("loop-1").contains(block("alt-1"))).toBe(true);
    expect(
      block("alt-1").querySelectorAll(":scope > line.siren-block-divider"),
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

  it("returns a working animation controller for a classDiagram — unlike a sequence diagram's null one — reporting totalSteps 0 when the document declares no timeline: block", () => {
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

  it("renders demos/class-diagram.html's example source (examples/class-core.srn) end to end with no error diagnostics, every declaration form, member text verbatim, and all eight relationship kinds", () => {
    const container = document.createElement("div");

    const result = render(CLASS_CORE_EXAMPLE_SOURCE, container);

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

    const result = render(CLASS_STRUCTURE_EXAMPLE_SOURCE, container);

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
});
