import { describe, expect, it } from "vitest";
import { render } from "../index";

/**
 * `default.css`'s own text — the artifact these tests are about.
 *
 * Read off disk rather than through Vite's `?raw` import, which cannot work
 * here: vitest's `vitest:css-disable` plugin rewrites *any* module id matching
 * `\.css($|\?)` to an empty string while `test.css` is false (this package's
 * default), `?raw` included. `import css from "./default.css?raw"` therefore
 * yields `""`, and a stylesheet that is silently empty makes the checks below
 * vacuous rather than failing loudly. Node's builtin is reached via
 * `process.getBuiltinModule` instead of `import "node:fs"` because this
 * package deliberately carries no `@types/node`; both shapes are narrowed
 * inline. `import.meta.dirname` rather than `new URL("./default.css",
 * import.meta.url)`, which Vite rewrites into a served asset URL.
 */
const defaultThemeCss = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: "node:fs"): { readFileSync(path: string, encoding: "utf8"): string };
    };
  }
).process
  .getBuiltinModule("node:fs")
  .readFileSync(`${(import.meta as unknown as { dirname: string }).dirname}/default.css`, "utf8");

/**
 * A Siren document exercising every sequence feature the renderer has a
 * distinct class or shape for: a colored box and an uncolored one, an actor
 * and a participant, autonumbering, an activation bar, `create`/`destroy`, a
 * dotted message, the cross and open arrowheads, all six framed block kinds
 * plus `rect`, and a title. Kept inline rather than read from `examples/`: what these tests need
 * is exhaustive *class* coverage, which is a different thing from what a demo
 * example is for, and an example edited for the demo's sake should not
 * quietly narrow what the theme is checked against.
 */
const EVERY_FEATURE = `sequenceDiagram
title Checkout
box Blue Storefront
  actor Shopper
  participant Web
end
box Ledgers
  participant Ledger
end
participant Payments

autonumber
Shopper->>Web: Open checkout
Web-->>Shopper: Draft ready
autonumber off

activate Web
Web->>Payments: Check balance
deactivate Web

create participant Retry
Web->Payments: Quote fees
Web-)Payments: Notify
Web-xPayments: Cancel
Web--xPayments: No response
Web<<->>Payments: Agree currency

loop Every attempt
  Web->>Payments: Authorize
  alt approved
    Payments-->>Web: Approved
    destroy Retry
  else declined
    Payments->>Web: Declined
  end
end
opt Audit
  Web->>Ledger: Notify
end
par Settle
  Web->>Payments: Capture
and Record
  Web->>Ledger: Record
end
critical Reserve stock
  Web->>Ledger: Post reservation
option Offline
  Ledger--)Web: Deferred
end
break Fraud detected
  Payments--xWeb: Hard decline
end
rect rgb(240, 248, 255)
  Web-->>Shopper: Show confirmation
end
`;

/**
 * A Siren document exercising every class-diagram feature the renderer has a
 * distinct class or shape for: a class with attributes *and* methods (so both
 * compartment dividers are drawn), every visibility marker and both
 * classifiers, an annotation, a generic, a namespace, an attached and a free
 * note, all eight relationship kinds — so every endpoint marker and both line
 * styles appear — a relationship label, and multiplicity at both ends.
 *
 * Inline rather than read from `examples/class-core.srn`, for the same reason
 * `EVERY_FEATURE` is: exhaustive *class* coverage is a different goal from a
 * demo example's, and an example narrowed for the demo's sake must not
 * quietly narrow what the theme is checked against. It is deliberately wider
 * than what the renderer draws today — the later tickets that start emitting
 * namespace frames, notes and annotations then fail this file until they
 * theme what they added.
 */
const EVERY_CLASS_FEATURE = `classDiagram
direction TB
namespace Zoo {
  class Animal {
    <<abstract>>
    +int age
    #bool warmBlooded
    ~String tag
    +isMammal() bool
    +run()*
  }
  class Duck {
    -String beakColor
    +quack() String
  }
}
class Flyer {
  <<interface>>
  +fly() bool
}
class Registry~T~ {
  -int cachedCount$
  +lookup(String name) Animal$
}
Feather : +String color

Animal <|-- Duck
Animal <|-- Fish
Duck ..|> Flyer : implements
Habitat *-- Animal : houses
Duck o-- Feather : plumage
Keeper "1" --> "*" Animal : cares for
Keeper -- Habitat
Registry ..> Animal : looks up
Fish .. Habitat
Duck --() Swims

note for Duck "Ducks are birds"
note "Drawn from the keeper's ledger"

click Duck href "https://example.com/duck" "Ducks are birds"

timeline:
enter Duck fade
enter Animal-Duck slide-left
enter namespace:1 fade, enter note:1 fade
highlight Duck outline
highlight Animal-Duck glow
`;

/**
 * Renders `source` with `default.css` applied to the document, and returns
 * the `<svg>`. Attached to the document on purpose: `getComputedStyle` only
 * reports a cascade for an element that is actually in a document with the
 * stylesheet loaded.
 *
 * jsdom resolves selectors and the cascade but not `var()` (a themed property
 * reads back as the literal `"var(--siren-edge-stroke)"`) and ignores SVG
 * presentation attributes entirely. That second limitation is what makes it
 * the right instrument here: what `getComputedStyle` reports is exactly and
 * only what *the theme* declares, which is precisely the question these tests
 * ask — a real browser then layers the renderer's presentation attributes
 * *underneath* that.
 */
function renderThemedSVG(source: string): SVGSVGElement {
  if (document.getElementById("siren-default-theme") === null) {
    const style = document.createElement("style");
    style.id = "siren-default-theme";
    style.textContent = defaultThemeCss;
    document.head.appendChild(style);
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const { diagnostics } = render(source, container);
  expect(diagnostics).toEqual([]);

  const svg = container.querySelector("svg");
  if (svg === null) {
    throw new Error("render() produced no <svg>");
  }
  return svg as SVGSVGElement;
}

/**
 * A human-readable name for an element in a failure message. Falls back to
 * the nearest classed ancestor, because the shapes most at risk of going
 * unthemed are exactly the ones carrying no class of their own (a
 * participant's box and label, an actor's stick figure).
 */
function describeElement(element: Element): string {
  const own = element.getAttribute("class");
  if (own !== null) {
    return `<${element.tagName} class="${own}">`;
  }

  let ancestor = element.parentElement;
  while (ancestor !== null && ancestor.getAttribute("class") === null) {
    ancestor = ancestor.parentElement;
  }
  return `<${element.tagName}> inside .${ancestor?.getAttribute("class") ?? "(unknown)"}`;
}

/**
 * The stylesheet with its comments removed. Every check here asks what the
 * theme *declares*; a class name merely discussed in a comment (this file is
 * heavily commented by design) must never count as coverage.
 */
const themeRules = defaultThemeCss.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Every drawn element in `svg` that neither the theme nor the renderer gives
 * a visible paint, described for a failure message. An unstroked, unfilled
 * shape is simply not there (SVG's initial `stroke: none`), and a `<text>`
 * left to SVG's initial `fill: black` is invisible on a dark theme and on a
 * dark-filled box.
 *
 * The sequence block below does this inline; it predates this helper and is
 * left as it stands rather than churned — the safety net stays where it is.
 */
function paintlessElements(svg: SVGSVGElement): string[] {
  const paintless: string[] = [];
  for (const element of Array.from(svg.querySelectorAll("rect, circle, line, path, text"))) {
    const style = getComputedStyle(element);

    if (element.tagName === "text") {
      if (style.fill === "") {
        paintless.push(describeElement(element));
      }
      continue;
    }

    // Either the theme strokes it, or *something* fills it — the theme, or a
    // `fill` attribute the renderer set itself.
    const stroked = style.stroke !== "" && style.stroke !== "none";
    const themeFill = style.fill !== "" && style.fill !== "none";
    const rendererFill =
      element.getAttribute("fill") !== null && element.getAttribute("fill") !== "none";
    if (!stroked && !themeFill && !rendererFill) {
      paintless.push(describeElement(element));
    }
  }
  return [...new Set(paintless)].sort();
}

/** Every `siren-*` class the renderer put on an element in `svg`. */
function emittedSirenClasses(svg: SVGSVGElement): string[] {
  const classes = new Set<string>();
  for (const element of Array.from(svg.querySelectorAll("[class]"))) {
    for (const name of element.getAttribute("class")?.split(/\s+/) ?? []) {
      if (name.startsWith("siren-")) {
        classes.add(name);
      }
    }
  }
  return [...classes].sort();
}

describe("default theme coverage of the sequence renderer", () => {
  it("has a rule selecting every class the sequence renderer emits", () => {
    const emitted = emittedSirenClasses(renderThemedSVG(EVERY_FEATURE));
    expect(emitted.length).toBeGreaterThan(0);

    const unthemed = emitted.filter(
      // The class must appear as a whole selector token, so `.siren-box` is
      // not considered covered by a `.siren-box-background` rule.
      (name) => !new RegExp(`\\.${name}(?![\\w-])`).test(themeRules),
    );
    expect(unthemed).toEqual([]);
  });

  it("gives every drawn element a paint, including the ones carrying no class", () => {
    const svg = renderThemedSVG(EVERY_FEATURE);

    const unpainted: string[] = [];
    for (const element of Array.from(svg.querySelectorAll("rect, circle, line, path, text"))) {
      const style = getComputedStyle(element);

      if (element.tagName === "text") {
        // Left to SVG's initial `fill: black`, a label is invisible on a
        // participant box and unreadable on any dark theme.
        if (style.fill === "") {
          unpainted.push(describeElement(element));
        }
        continue;
      }

      // A shape is drawn if the theme strokes it, or if *something* fills it —
      // either the theme, or a `fill` attribute the renderer set itself (the
      // author's own `rect rgb(...)` color). SVG's initial `stroke: none`
      // means an unstroked, unfilled shape is simply not there.
      const stroked = style.stroke !== "" && style.stroke !== "none";
      const themeFill = style.fill !== "" && style.fill !== "none";
      const rendererFill =
        element.getAttribute("fill") !== null && element.getAttribute("fill") !== "none";
      if (!stroked && !themeFill && !rendererFill) {
        unpainted.push(describeElement(element));
      }
    }

    expect([...new Set(unpainted)].sort()).toEqual([]);
  });

  it("draws lifelines dashed", () => {
    const svg = renderThemedSVG(EVERY_FEATURE);

    const lifelines = Array.from(svg.querySelectorAll(".siren-lifeline"));
    expect(lifelines.length).toBeGreaterThan(0);

    // The renderer sets no `stroke-dasharray` on a lifeline (see
    // `buildLifeline`), so a dashed lifeline can only come from the theme.
    const solid = lifelines.filter((line) => getComputedStyle(line).strokeDasharray === "");
    expect(solid).toEqual([]);
  });

  it("never overrides a paint or dash the renderer set per element", () => {
    const svg = renderThemedSVG(EVERY_FEATURE);

    // In a real browser an author stylesheet rule beats an SVG presentation
    // attribute, so any of these declared in the theme would silently discard
    // what the renderer decided for that one element: the author's own
    // `box <color>` and `rect rgb(...)` fills, and the `4,3` dash that is the
    // *only* thing distinguishing a `-->>` message from a `->>` one.
    //
    // `none` is exempt: it is a structural choice the renderer makes for every
    // element of its kind (an unfilled frame, an open arrowhead), never
    // per-element information, and a theme cannot change its meaning by
    // restating it.
    const overridden: string[] = [];
    for (const element of Array.from(svg.querySelectorAll("*"))) {
      const style = getComputedStyle(element);
      for (const property of ["fill", "stroke", "stroke-dasharray"] as const) {
        const rendererValue = element.getAttribute(property);
        if (rendererValue === null || rendererValue === "none") {
          continue;
        }
        const themeValue = style.getPropertyValue(property);
        if (themeValue !== "") {
          overridden.push(
            `${describeElement(element)} ${property}="${rendererValue}" overridden by ${themeValue}`,
          );
        }
      }
    }

    expect([...new Set(overridden)].sort()).toEqual([]);
  });

  it("fills a box the author gave no color, and only that one", () => {
    const svg = renderThemedSVG(EVERY_FEATURE);

    // `box Blue Storefront` carries a color; `box Ledgers` does not, and the
    // renderer writes no `fill` attribute at all in that case.
    const backgrounds = Array.from(svg.querySelectorAll(".siren-box-background"));
    const colored = backgrounds.filter((rect) => rect.getAttribute("fill") !== null);
    const uncolored = backgrounds.filter((rect) => rect.getAttribute("fill") === null);
    expect(colored.map((rect) => rect.getAttribute("fill"))).toEqual(["Blue"]);
    expect(uncolored).toHaveLength(1);

    // Without a theme fill an uncolored box group is invisible; with one
    // applied indiscriminately, the author's "Blue" would be repainted.
    expect(getComputedStyle(uncolored[0]).fill).not.toBe("");
    expect(getComputedStyle(colored[0]).fill).toBe("");
  });
});

/**
 * A flowchart exercising every class the flowchart renderer emits — node
 * groups, node frames, edges, the shared arrowhead, and (from the `timeline:`
 * block) `siren-pending`. The `highlight` steps stamp nothing at step 0, which
 * is the controller's business rather than the renderer's; they are here so
 * that a renderer which one day *did* stamp highlight state would be caught by
 * the coverage check below rather than shipping unthemed.
 *
 * **Shapes belong in here, not only rectangles.** This fixture drew nothing
 * but `A[text]` while ten bracket spellings had landed, so a `siren-*` class
 * that only a shape emitted would have shipped unthemed without failing
 * anything — the checks below cannot see a class nothing renders. The
 * multi-element shapes matter most: a subroutine is the first node to draw
 * more than one element and a double circle is the second, and a second
 * element is where a second class gets invented. Neither emits one (a
 * subroutine's bars and a double circle's inner ring both wear
 * `siren-node-frame` like everything else), and this fixture is what keeps
 * that true rather than merely claimed — it was measured: inventing a
 * `siren-node-ring` on the inner ring left every check here green while the
 * fixture drew no double circle, and fails them now.
 *
 * All thirteen bracket spellings are drawn now, and the fixture carries one
 * of each family rather than all thirteen: a rectangle, the three drawn
 * with a `<rect>`, and the three drawn with a curve — the `<circle>` and
 * the arc-bearing `<path>` are elements nothing else here renders. The six
 * straight-sided `<path>` shapes are the same element and the same class as
 * the diamond, so adding them would widen the fixture without widening what
 * it can see. Whoever lands the Markdown label adds it for the original
 * reason.
 *
 * **And edges belong in here for exactly the same reason shapes did.** It
 * drew nothing but `-->`, so a dotted or thick line's class would have
 * shipped unthemed without failing anything — measured: adding
 * `.siren-edge-dotted` and `.siren-edge-thick` to the renderer left every
 * check here green until these lines were added, and fails them now. One
 * edge per line style, and one per end shape: the hollow ring and the open
 * cross are the two markers whose *paint* comes from a class the flowchart
 * had never emitted (`siren-arrow-hollow`, `siren-arrow-stroke`), so an
 * unfilled ring or an unstroked cross — a marker that is simply not there —
 * is caught here rather than in a picture.
 *
 * **And a labelled edge belongs in here for the third time, for the third
 * time for the same reason.** It drew no edge label, so `.siren-edge-label`
 * would have shipped unthemed — an edge label left to SVG's initial
 * `fill: black` is invisible on a dark theme — without failing anything.
 * Both spellings are written, though they draw the same element, because
 * this fixture is also the one place the two are seen end to end.
 *
 * **And a subgraph belongs in here for the fourth time, for the same reason
 * a fourth time.** It drew no frame, so `.siren-subgraph-frame` and
 * `.siren-subgraph-label` would have shipped unthemed without failing
 * anything — an unstroked frame is not there at all (SVG's initial
 * `stroke: none`) and a title left to the initial `fill: black` is invisible
 * on a dark theme. Nested, because the outer frame and the inner one are the
 * same two classes and one drawn example would not have caught a rule that
 * only reached the top level. It is drawn last so that the arrow chain above
 * it is left exactly as it was.
 */
const EVERY_FLOWCHART_FEATURE = `flowchart TB
A[Start]
A --> B[Fetch data]
B --> C[Publish]
C --> D(Round)
D --> E([Stadium])
E --> F[[Subroutine]]
F --> G((Circle))
G --> H(((Double)))
H --> I[(DB)]
I -.-> J[Dotted]
J ==> K[Thick]
K --- L[Open]
L --o M[Circle end]
M --x N[Cross end]
N <--> O[Both ends]
O -->|pipe label| P[Labelled]
P -- inline label --> Q[Labelled too]
subgraph Outer
  subgraph Inner
    R[Grouped] --> S[Grouped too]
  end
  S --> T[Beside the group]
end

timeline:
enter B fade, enter A-B fade
highlight B outline
highlight C glow
`;

/**
 * Every stroked shape that belongs to one timeline target: the carrier itself
 * when it is a shape, otherwise the shapes inside it that no nested target
 * claims (a block's frame and dividers, not the messages it wraps).
 */
function strokedShapesOf(carrier: Element): Element[] {
  const shapes = "rect, circle, line, path";
  if (carrier.matches(shapes)) {
    return [carrier];
  }
  return Array.from(carrier.querySelectorAll(shapes)).filter(
    (shape) => shape.closest("[data-siren-id]") === carrier,
  );
}

/**
 * What `highlight <id> outline` does to every shape of that target, as a list
 * of the shapes it failed on — empty when every one of them takes the
 * highlight color and width, and gets its own stroke back once the class is
 * removed.
 */
function outlineFailures(svg: SVGSVGElement, id: string): string[] {
  const carriers = Array.from(svg.querySelectorAll(`[data-siren-id="${id}"]`));
  if (carriers.length === 0) {
    return [`no element carries data-siren-id="${id}"`];
  }

  const failures: string[] = [];
  for (const carrier of carriers) {
    const shapes = strokedShapesOf(carrier);
    if (shapes.length === 0) {
      failures.push(`${describeElement(carrier)}: no stroked shape`);
    }
    for (const shape of shapes) {
      const before = getComputedStyle(shape);
      const beforeStroke = before.stroke;
      const beforeDash = before.strokeDasharray;

      carrier.classList.add("siren-highlight-outline");
      const after = getComputedStyle(shape);
      const afterStroke = after.stroke;
      const afterWidth = after.strokeWidth;
      const afterDash = after.strokeDasharray;
      carrier.classList.remove("siren-highlight-outline");

      if (!afterStroke.includes("--siren-highlight-color")) {
        failures.push(`${describeElement(shape)}: stroke ${JSON.stringify(afterStroke)}`);
      }
      if (!afterWidth.includes("--siren-highlight-stroke-width")) {
        failures.push(`${describeElement(shape)}: stroke-width ${JSON.stringify(afterWidth)}`);
      }
      if (afterDash !== beforeDash) {
        failures.push(`${describeElement(shape)}: dash changed to ${JSON.stringify(afterDash)}`);
      }
      if (getComputedStyle(shape).stroke !== beforeStroke) {
        failures.push(`${describeElement(shape)}: stroke not restored`);
      }
    }
  }
  return failures;
}

describe("default theme's outline on sequence-diagram targets", () => {
  it("outlines a participant everywhere it is drawn: both rows, the lifeline, and the destroy mark", () => {
    const svg = renderThemedSVG(EVERY_FEATURE);

    // Web is a box participant; Shopper an actor (circle and lines); Retry is
    // created and destroyed, so it also wears a destroy mark.
    expect(outlineFailures(svg, "Web")).toEqual([]);
    expect(outlineFailures(svg, "Shopper")).toEqual([]);
    expect(outlineFailures(svg, "Retry")).toEqual([]);
  });

  it("outlines a message's line, solid or dotted, keeping its dash", () => {
    const svg = renderThemedSVG(EVERY_FEATURE);

    expect(outlineFailures(svg, "Shopper-Web")).toEqual([]);
    expect(outlineFailures(svg, "Web-Shopper")).toEqual([]);
  });

  it("outlines a framed block's frame and dividers, not the messages it wraps", () => {
    const svg = renderThemedSVG(EVERY_FEATURE);

    // alt:1 has an `else` divider; loop:1 wraps it, and neither outline may
    // reach the messages inside (strokedShapesOf leaves nested targets out,
    // and this checks the nested message is untouched).
    expect(outlineFailures(svg, "alt:1")).toEqual([]);
    expect(outlineFailures(svg, "loop:1")).toEqual([]);

    const loop = svg.querySelector('[data-siren-id="loop:1"]')!;
    const nested = [
      loop.querySelector(".siren-message-arrow")!,
      loop.querySelector('[data-siren-id="alt:1"] .siren-block-frame')!,
    ];
    const before = nested.map((shape) => getComputedStyle(shape).stroke);
    loop.classList.add("siren-highlight-outline");
    const during = nested.map((shape) => getComputedStyle(shape).stroke);
    loop.classList.remove("siren-highlight-outline");
    expect(during).toEqual(before);
  });

  it("outlines a rect block, which has no frame, by stroking its fill", () => {
    const svg = renderThemedSVG(EVERY_FEATURE);

    const fill = svg.querySelector('[data-siren-id="rect:1"] > .siren-block-fill')!;
    expect(getComputedStyle(fill).stroke).toBe("none");
    expect(outlineFailures(svg, "rect:1")).toEqual([]);
  });

  it("outlines a box grouping's background and an activation bar", () => {
    const svg = renderThemedSVG(EVERY_FEATURE);

    expect(outlineFailures(svg, "box:1")).toEqual([]);
    expect(outlineFailures(svg, "activation:1")).toEqual([]);
  });

  it("takes every outlined shape's stroke to the highlight color under glow too, at its own width", () => {
    // The glow half of commit 37ea2c5, for the sequence targets: left at its
    // base color, a frame sits under the glow as a pale ring. A rect block is
    // left out: it has no stroke to recolor, and the glow alone marks it.
    const svg = renderThemedSVG(EVERY_FEATURE);

    const failures: string[] = [];
    for (const id of ["Web", "Shopper", "Retry", "Shopper-Web", "alt:1", "box:1", "activation:1"]) {
      for (const carrier of Array.from(svg.querySelectorAll(`[data-siren-id="${id}"]`))) {
        for (const shape of strokedShapesOf(carrier)) {
          const width = getComputedStyle(shape).strokeWidth;
          carrier.classList.add("siren-highlight-glow");
          const after = getComputedStyle(shape);
          const afterStroke = after.stroke;
          const afterWidth = after.strokeWidth;
          carrier.classList.remove("siren-highlight-glow");
          if (!afterStroke.includes("--siren-highlight-color")) {
            failures.push(`${id} ${describeElement(shape)}: stroke ${JSON.stringify(afterStroke)}`);
          }
          if (afterWidth !== width) {
            failures.push(`${id} ${describeElement(shape)}: width changed to ${JSON.stringify(afterWidth)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("default theme coverage of the flowchart renderer", () => {
  it("has a rule selecting every class the flowchart renderer emits", () => {
    const emitted = emittedSirenClasses(renderThemedSVG(EVERY_FLOWCHART_FEATURE));
    expect(emitted.length).toBeGreaterThan(0);

    const unthemed = emitted.filter(
      (name) => !new RegExp(`\\.${name}(?![\\w-])`).test(themeRules),
    );
    expect(unthemed).toEqual([]);
  });

  it("gives every drawn element a paint, including the ones carrying no class", () => {
    expect(paintlessElements(renderThemedSVG(EVERY_FLOWCHART_FEATURE))).toEqual([]);
  });

  it("reaches a node's frame by its own class, never as an anonymous rect descendant", () => {
    const svg = renderThemedSVG(EVERY_FLOWCHART_FEATURE);

    // ADR-0008's placement argument is written in terms of the element the
    // theme styles: an author's `style` directive is emitted onto that
    // element, so which element it is has to be something an author can name.
    // The class diagram already answers that with `.siren-class-frame`; a
    // flowchart frame reachable only as `.siren-node rect` gives the same
    // question a different answer for no reason a reader could see.
    //
    // Checked against the stylesheet's text as well as the cascade, because
    // the cascade alone cannot tell the two selectors apart — today both match
    // the same single `<rect>`, and the whole point of the change is that they
    // stop being interchangeable once an author can name one of them.
    expect(themeRules).toMatch(/\.siren-node-frame(?![\w-])/);
    expect(themeRules).not.toMatch(/\.siren-node(?![\w-])[^,{}]*\brect\b/);

    const frames = Array.from(svg.querySelectorAll(".siren-node-frame"));
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(getComputedStyle(frame).fill).not.toBe("");
      expect(getComputedStyle(frame).stroke).not.toBe("");
    }
  });

  it("keeps a consumer's existing `.siren-node rect` rule working", () => {
    // Naming the frame is a *public CSS surface* change: `.siren-node rect` is
    // what a consumer's own stylesheet has been written against since the
    // first release, and it must not quietly stop applying.
    const svg = renderThemedSVG(EVERY_FLOWCHART_FEATURE);

    const frame = svg.querySelector(".siren-node-frame");
    if (frame === null) {
      throw new Error("no node frame to restyle");
    }

    // What could actually have broken is *matching*: the theme no longer
    // writes `.siren-node rect`, so the question is whether that selector
    // still selects anything. It does — the frame is still a `<rect>` inside
    // `.siren-node`, it merely gained a class — and this asserts it rather
    // than assuming it.
    //
    // Specificity is deliberately not asserted here: jsdom's cascade is not
    // specificity-aware (verified — a bare `rect { ... }` rule overrides
    // `.siren-node-frame` from either side of the theme), so any such
    // assertion would pass vacuously. It is arithmetic instead:
    // `.siren-node rect` is (0,1,1) and the theme's `.siren-node-frame` is
    // (0,1,0), so an existing consumer override wins from anywhere in the
    // document, where before the two tied at (0,1,1) and source order decided.
    // The change can only make such an override more reliable, never less.
    const consumer = document.createElement("style");
    consumer.textContent = ".siren-node rect { fill: rgb(1, 2, 3); }";
    document.head.appendChild(consumer);
    try {
      expect(getComputedStyle(frame).fill).toBe("rgb(1, 2, 3)");
    } finally {
      consumer.remove();
    }

    // The negative control, so the assertion above cannot pass by accident:
    // the same declaration behind a selector that does *not* describe the
    // frame leaves the theme's own paint in place.
    const decoy = document.createElement("style");
    decoy.textContent = ".siren-node > circle { fill: rgb(1, 2, 3); }";
    document.head.appendChild(decoy);
    try {
      expect(getComputedStyle(frame).fill).not.toBe("rgb(1, 2, 3)");
    } finally {
      decoy.remove();
    }
  });

  it("still gives a highlighted node the outline effect after the frame is named", () => {
    // Characterization: the outline rule was written as
    // `.siren-node.siren-highlight-outline rect` and now names
    // `.siren-node-frame`, matching the same element and matching how the
    // class diagram's own outline rule is written. Behaviour is meant to be
    // identical, which is exactly why it needs pinning — a selector edit that
    // silently stops matching turns `highlight X outline` into a step on
    // which nothing visibly happens, the same defect the class-diagram
    // outline test above exists to catch.
    const svg = renderThemedSVG(EVERY_FLOWCHART_FEATURE);

    const group = svg.querySelector(".siren-node");
    const shape = group?.querySelector(".siren-node-frame");
    if (group === null || group === undefined || shape === null || shape === undefined) {
      throw new Error("no .siren-node-frame inside .siren-node");
    }

    const before = getComputedStyle(shape).stroke;
    group.classList.add("siren-highlight-outline");
    const after = getComputedStyle(shape).stroke;
    group.classList.remove("siren-highlight-outline");

    expect(after).not.toBe(before);
    expect(after).toContain("--siren-highlight-color");
  });

  it("lets an author's inline style win over its node-frame rule", () => {
    // The premise of the board's flowchart `style`/`classDef` support, and the
    // reason the frame is the element that carries the attribute: an inline
    // declaration on the drawn shape outranks the theme without `!important`.
    // The same guard the class diagram already has, one kind over.
    const svg = renderThemedSVG(EVERY_FLOWCHART_FEATURE);

    const frame = svg.querySelector(".siren-node-frame");
    if (frame === null) {
      throw new Error("no node frame to style");
    }

    frame.setAttribute("style", "fill: rgb(255, 221, 221); stroke: rgb(204, 0, 0)");
    expect(getComputedStyle(frame).fill).toBe("rgb(255, 221, 221)");
    expect(getComputedStyle(frame).stroke).toBe("rgb(204, 0, 0)");
  });

  it("lets `--siren-node-border-radius` round a rectangle and a subroutine, and leaves a round node and a stadium out of its reach", () => {
    // **The decision this board's rect-drawn shapes forced, asserted.** The
    // theme rounds `.siren-node-frame` with a documented token, and two of
    // those shapes are named for the very corners it sets. The rule chosen:
    // *a shape named for its corners owns them; the token rounds the shapes
    // whose corners are only decoration.*
    //
    // So what a consumer redeclaring `--siren-node-border-radius` gets,
    // shape by shape:
    //
    // - `A[text]` and `A[[text]]` — the new radius, on every corner. The
    //   renderer writes them no radius at all, so the theme's rule is the
    //   only writer and the token is the whole story, exactly as it was
    //   before shapes existed.
    // - `A(text)` and `A([text])` — nothing. Their radius is the renderer's,
    //   computed from the node's own height and written as an inline
    //   declaration, which is the level of the cascade an author stylesheet
    //   cannot reach without `!important`.
    //
    // The asymmetry is deliberate and is the point. A stadium whose ends
    // stopped being semicircles because someone retuned a token would not be
    // a stadium, and a round node flattened to `0` alongside every rectangle
    // would have lost the one thing that distinguishes it — while the board's
    // decision 1 makes a shape's *kind* the compatibility contract and only
    // its proportions the theme's. The price is that the token has no say in
    // *how* round `A(Round)` is; that is a shape's proportion, and it is
    // `SHAPE_LEAN`'s to name.
    const svg = renderThemedSVG(EVERY_FLOWCHART_FEATURE);
    const frameOf = (id: string) =>
      svg.querySelector(`g.siren-node[data-siren-id="${id}"] rect.siren-node-frame`)!;
    const inlineRx = (id: string) =>
      (frameOf(id).getAttribute("style") ?? "").match(/rx:\s*([^;]+)/)?.[1] ?? null;

    // The theme's half of the rule, read off the stylesheet: the token is
    // what rounds a frame, and it is declared once for all of them.
    expect(themeRules).toMatch(/\.siren-node-frame(?![\w-])[^{]*\{[^}]*rx:\s*var\(--siren-node-border-radius\)/);

    // A rectangle and a subroutine declare no radius of their own, so
    // nothing outranks that rule for them.
    expect(inlineRx("A")).toBeNull();
    expect(inlineRx("F")).toBeNull();

    // A round node and a stadium do, and a stadium's is exactly half its
    // drawn height — the semicircular ends, in the picture rather than in a
    // `data-siren-shape` attribute.
    expect(inlineRx("D")).not.toBeNull();
    expect(inlineRx("E")).toBe(`${Number(frameOf("E").getAttribute("height")) / 2}px`);
    expect(Number.parseFloat(inlineRx("D")!)).toBeGreaterThan(0);
    expect(Number.parseFloat(inlineRx("D")!)).toBeLessThan(Number.parseFloat(inlineRx("E")!));

    // And a consumer actually redeclaring the token, run rather than argued.
    // jsdom implements no `rx` property at all (`getComputedStyle(rect).rx`
    // is `""` whatever any rule says — verified), so the cascade cannot be
    // read out of it here the way `fill` is elsewhere in this file. What can
    // be read is the mechanism, and the mechanism is not specificity but the
    // cascade *origin*: an inline declaration beats every rule in every
    // author stylesheet, so a consumer cannot flatten these two however
    // hard they select. The rect and the subroutine, carrying no inline
    // declaration, have nothing standing between them and the new value.
    const consumer = document.createElement("style");
    consumer.textContent =
      ":root { --siren-node-border-radius: 0px; } .siren-node-frame { rx: 0px; }";
    document.head.appendChild(consumer);
    try {
      expect(inlineRx("E")).toBe(`${Number(frameOf("E").getAttribute("height")) / 2}px`);
      expect(inlineRx("D")).not.toBeNull();
      expect(inlineRx("A")).toBeNull();
      expect(inlineRx("F")).toBeNull();
    } finally {
      consumer.remove();
    }

    // The negative control on the reading above: `rx` is an inline
    // *declaration*, not a presentation attribute. As an attribute it would
    // sit below every stylesheet in the cascade, so the theme's own rule
    // would silently flatten the stadium back to 6px — the failure this
    // whole arrangement exists to prevent, and one that would leave nothing
    // in the picture to say why.
    expect(frameOf("E").getAttribute("rx")).toBeNull();
    expect(frameOf("D").getAttribute("rx")).toBeNull();
  });

  it("leaves an unstyled arrowhead resolving through `--siren-edge-stroke`, and lets an author-colored one win over that rule", () => {
    // Per-edge arrowheads must not quietly take the arrow out of the theme's
    // hands. An edge nobody styled keeps pointing at a marker whose fill is
    // still the *token*, so a consumer redeclaring `--siren-edge-stroke`
    // recolors it exactly as before; only the edge that named a color of its
    // own stops following.
    const svg = renderThemedSVG(`flowchart TD
A[Start] --> B[Middle]
B --> C[End]
linkStyle 0 stroke:#f00
`);

    const headFor = (edgeId: string): SVGElement => {
      const reference = svg
        .querySelector(`path.siren-edge[data-siren-id="${edgeId}"]`)
        ?.getAttribute("marker-end");
      const head =
        reference == null
          ? null
          : svg.querySelector(`defs > marker#${reference.slice("url(#".length, -1)} path`);
      if (head === null) {
        throw new Error(`no arrowhead for edge ${edgeId}`);
      }
      return head as SVGElement;
    };

    // jsdom does not resolve `var()`, which is what makes this readable: the
    // unstyled head's fill *is* the token, so redeclaring the token is what
    // paints it.
    expect(getComputedStyle(headFor("B-C")).fill).toContain("--siren-edge-stroke");

    // The author's color is an inline declaration on the drawn shape, so it
    // outranks the theme's `.siren-arrow-fill` rule without `!important` —
    // ADR-0008's cascade argument, one element further in.
    expect(getComputedStyle(headFor("A-B")).fill).toBe("#f00");
    expect(getComputedStyle(headFor("A-B")).fill).not.toContain("--siren-edge-stroke");
  });

  it("orders the four writers of an edge's stroke-width: base, line style, highlight, author", () => {
    // **The collision this ticket had to decide, asserted rather than
    // commented.** A thick line is a `stroke-width`, and so are the base
    // edge rule, the highlight, and an author's `linkStyle 0
    // stroke-width:6px`. The renderer writes the line style as a *class*
    // precisely to land in the middle of that order (see `EDGE_LINE_CLASS`);
    // written inline it would have beaten the highlight too, and an edge is
    // a timeline target, so `highlight X outline` would have silently
    // stopped thickening thick edges.
    //
    // jsdom resolves the cascade but not `var()`, which is what makes each
    // winner readable by name: what comes back is the declaration that won,
    // verbatim.
    const svg = renderThemedSVG(EVERY_FLOWCHART_FEATURE);
    const edge = (id: string) => svg.querySelector(`path.siren-edge[data-siren-id="${id}"]`)!;

    // A plain edge takes the base rule; a thick one takes its own, which is
    // derived from the base token so retuning that token cannot flatten the
    // difference between the two.
    expect(getComputedStyle(edge("A-B")).strokeWidth).toContain("--siren-stroke-width");
    expect(getComputedStyle(edge("J-K")).strokeWidth).toContain(
      "--siren-edge-thick-stroke-width",
    );
    expect(getComputedStyle(edge("I-J")).strokeDasharray).toContain("--siren-edge-dash");

    // Highlighting a thick edge still thickens it: two classes beat one.
    const thick = edge("J-K");
    thick.classList.add("siren-highlight-outline");
    expect(getComputedStyle(thick).strokeWidth).toContain("--siren-highlight-stroke-width");
    thick.classList.remove("siren-highlight-outline");

    // And the author beats all of them for the property they name — while
    // the one they did not name survives, so a recoloured dotted edge is
    // still dotted.
    const dotted = edge("I-J");
    dotted.setAttribute("style", "stroke-width: 6px; stroke: rgb(255, 0, 0)");
    expect(getComputedStyle(dotted).strokeWidth).toBe("6px");
    expect(getComputedStyle(dotted).stroke).toBe("rgb(255, 0, 0)");
    expect(getComputedStyle(dotted).strokeDasharray).toContain("--siren-edge-dash");
  });
});

describe("default theme coverage of the class renderer", () => {
  it("has a rule selecting every class the class renderer emits", () => {
    const emitted = emittedSirenClasses(renderThemedSVG(EVERY_CLASS_FEATURE));
    expect(emitted.length).toBeGreaterThan(0);

    const unthemed = emitted.filter(
      (name) => !new RegExp(`\\.${name}(?![\\w-])`).test(themeRules),
    );
    expect(unthemed).toEqual([]);
  });

  it("gives every drawn element a paint, including the ones carrying no class", () => {
    expect(paintlessElements(renderThemedSVG(EVERY_CLASS_FEATURE))).toEqual([]);
  });

  it("fills a hollow endpoint with the surface color, not with nothing", () => {
    const svg = renderThemedSVG(EVERY_CLASS_FEATURE);

    // The two diamonds are one shape drawn twice; `siren-arrow-fill` versus
    // `siren-arrow-hollow` is the *whole* difference between composition and
    // aggregation on screen, and the triangle is shared outright between
    // inheritance and realization. A hollow shape left unfilled is not a
    // hollow shape: it falls back to SVG's initial `fill: black` — the same
    // picture as the filled diamond — and if a theme were to say
    // `fill: none` instead, the relationship line would run visibly through
    // the middle of the head.
    //
    // Found by following the relationship that uses each shape rather than by
    // naming a marker id: ids are minted per render now (`mintIdScope`), so
    // the durable handle on "the filled diamond" is "whatever a composition
    // points at".
    const shapeOf = (relationshipType: string): SVGElement => {
      const line = svg.querySelector(
        `g.siren-relationship[data-siren-relationship="${relationshipType}"] path`,
      );
      const reference = line?.getAttribute("marker-start") ?? line?.getAttribute("marker-end");
      const shape =
        reference == null
          ? null
          : svg.querySelector(`#${reference.slice("url(#".length, -1)} path`);
      if (shape === null) {
        throw new Error(`no endpoint shape for a ${relationshipType} relationship`);
      }
      return shape as SVGElement;
    };
    const filledDiamond = shapeOf("composition");
    const hollowDiamond = shapeOf("aggregation");
    const triangle = shapeOf("inheritance");
    expect(hollowDiamond.getAttribute("d")).toBe(filledDiamond.getAttribute("d"));

    for (const hollow of [hollowDiamond, triangle]) {
      const fill = getComputedStyle(hollow).fill;
      expect(fill).not.toBe("");
      expect(fill).not.toBe("none");
      expect(fill).not.toBe(getComputedStyle(filledDiamond).fill);
    }
  });

  it("leaves each relationship the dash the renderer gave it", () => {
    const svg = renderThemedSVG(EVERY_CLASS_FEATURE);

    // In a real browser an author stylesheet rule beats a presentation
    // attribute, so a `stroke-dasharray` (or a `stroke-dasharray: none`) in
    // the theme would silently discard the renderer's per-relationship dash —
    // and that dash is the only difference between a dependency and an
    // association, and between a dashed link and a link. Both spellings are
    // in this document, so both are checked.
    const dashed = Array.from(
      svg.querySelectorAll('[data-siren-relationship="dependency"] .siren-relationship-line'),
    );
    const solid = Array.from(
      svg.querySelectorAll('[data-siren-relationship="association"] .siren-relationship-line'),
    );
    expect(dashed.length).toBeGreaterThan(0);
    expect(solid.length).toBeGreaterThan(0);

    for (const line of [...dashed, ...solid]) {
      expect(getComputedStyle(line).strokeDasharray).toBe("");
    }
    expect(dashed[0].getAttribute("stroke-dasharray")).not.toBeNull();
    expect(solid[0].getAttribute("stroke-dasharray")).toBeNull();
  });

  it("lets an author's inline style win over its rules", () => {
    const svg = renderThemedSVG(EVERY_CLASS_FEATURE);

    // The premise of the board's `style`/`classDef`/`cssClass` support: those
    // directives are emitted as an inline `style` attribute, so the theme is
    // the global default and an author directive is a local override, with no
    // competition between them. That only holds while no rule here is
    // `!important` — one such declaration would make the author's own
    // emphasis silently unreachable.
    //
    // Which is why the stylesheet's own text is checked as well as the
    // cascade: jsdom does not model `!important` at all (verified — an inline
    // style wins over an `!important` rule there), so the `getComputedStyle`
    // assertions below would go on passing after exactly the change they
    // exist to catch. The text check is the one with teeth; the cascade
    // assertions state what the text check is protecting.
    expect(themeRules).not.toMatch(/!\s*important/);

    const frame = svg.querySelector(".siren-class-frame");
    const line = svg.querySelector(".siren-relationship-line");
    if (frame === null || line === null) {
      throw new Error("no class frame or relationship line to style");
    }

    frame.setAttribute("style", "fill: rgb(255, 221, 221); stroke: rgb(204, 0, 0)");
    line.setAttribute("style", "stroke: rgb(204, 0, 0)");

    expect(getComputedStyle(frame).fill).toBe("rgb(255, 221, 221)");
    expect(getComputedStyle(frame).stroke).toBe("rgb(204, 0, 0)");
    expect(getComputedStyle(line).stroke).toBe("rgb(204, 0, 0)");
  });

  it("gives a highlighted class and relationship the outline effect, not just the glow one", () => {
    const svg = renderThemedSVG(EVERY_CLASS_FEATURE);

    // `siren-highlight-outline` is one of the four verbs' effects, and the
    // controller lands it on a `.siren-class`/`.siren-relationship` group
    // exactly as it lands it on a flowchart node or edge. The flowchart rules
    // are written as `.siren-node ... rect` and `.siren-edge`, so neither
    // selects anything in a class diagram: without a rule of its own,
    // `highlight X outline` in a class document is a step on which nothing
    // visibly happens — the same defect the coverage test above exists to
    // catch, one level down.
    // Every element kind a `timeline:` block can name, not just the two that
    // happened to have rules. Enumerating only the working ones is how this
    // guard missed that `highlight namespace:1 outline` resolved to nothing:
    // the verb parsed, the model accepted it, the controller set the class,
    // and the picture did not change.
    const cases: [string, string][] = [
      [".siren-class", ".siren-class-frame"],
      [".siren-relationship", ".siren-relationship-line"],
      [".siren-namespace", ".siren-namespace-frame"],
      [".siren-note", ".siren-note-frame"],
    ];

    for (const [groupSelector, shapeSelector] of cases) {
      const group = svg.querySelector(groupSelector);
      const shape = group?.querySelector(shapeSelector);
      if (group === null || group === undefined || shape === null || shape === undefined) {
        throw new Error(`no ${shapeSelector} inside ${groupSelector}`);
      }

      const before = getComputedStyle(shape).stroke;
      group.classList.add("siren-highlight-outline");
      const after = getComputedStyle(shape).stroke;
      group.classList.remove("siren-highlight-outline");

      expect(after).not.toBe(before);
      expect(after).toContain("--siren-highlight-color");
    }
  });

  it("sets the theme's type on the class-diagram groups", () => {
    const svg = renderThemedSVG(EVERY_CLASS_FEATURE);

    // The `<text>` children carry no font of their own and inherit the
    // group's, exactly as a sequence diagram's do — so a group left out of
    // the shared font rule renders every member line in the browser's default
    // serif at the browser's default size, while `layoutClassDiagram` sized
    // the box from the theme's font. The box and its text would disagree.
    const groups = Array.from(svg.querySelectorAll(".siren-class, .siren-relationship"));
    expect(groups.length).toBeGreaterThan(0);

    const untyped = groups.filter((group) => {
      const style = getComputedStyle(group);
      return style.fontFamily === "" || style.fontSize === "";
    });
    expect(untyped.map(describeElement)).toEqual([]);
  });
});

/*
 * The palette checks below have a twin in siren-board's src/styles.test.ts,
 * which asks the same questions of board's chrome tokens. The two packages
 * share no test utilities, so a change to how one reads a token block
 * belongs in the other too.
 */

/**
 * Puts `default.css` on the document, once, under the same id
 * `renderThemedSVG` uses, so the two never stack a second copy.
 */
function attachDefaultTheme(): void {
  if (document.getElementById("siren-default-theme") === null) {
    const style = document.createElement("style");
    style.id = "siren-default-theme";
    style.textContent = defaultThemeCss;
    document.head.appendChild(style);
  }
}

/**
 * The five color tokens as `element` itself resolves them. jsdom resolves a
 * custom property only on the element that declares it — it neither inherits
 * one to a child nor evaluates `@media` — so `element` has to be the one a
 * token block selects: the root, or an element carrying `data-theme`.
 */
function colorTokensOn(element: Element): Record<string, string> {
  const style = getComputedStyle(element);
  return Object.fromEntries(
    [
      "--siren-node-fill",
      "--siren-node-stroke",
      "--siren-node-text",
      "--siren-edge-stroke",
      "--siren-highlight-color",
    ].map((token) => [token, style.getPropertyValue(token).trim().toLowerCase()]),
  );
}

/** The light palette, copied from siren-website's decision 01M3BY1GPP. */
const LIGHT_PALETTE = {
  "--siren-node-fill": "#f3efff",
  "--siren-node-stroke": "#6d3fd6",
  "--siren-node-text": "#1d1730",
  "--siren-edge-stroke": "#6f6a84",
  "--siren-highlight-color": "#0d9488",
};

/** The dark palette, from the same decision. */
const DARK_PALETTE = {
  "--siren-node-fill": "#2a2144",
  "--siren-node-stroke": "#b69cff",
  "--siren-node-text": "#ece8f8",
  "--siren-edge-stroke": "#8e88a3",
  "--siren-highlight-color": "#2dd4bf",
};

describe("default theme's color palette", () => {
  it("resolves the light violet palette on the root", () => {
    attachDefaultTheme();
    expect(colorTokensOn(document.documentElement)).toEqual(LIGHT_PALETTE);
  });

  it("lets an element pinned with data-theme=\"light\" resolve the light palette itself", () => {
    attachDefaultTheme();
    // A subtree pinned light inside a dark page (siren-website's PPT export)
    // only stays light if the pin redeclares the palette on itself.
    const pinned = document.createElement("div");
    pinned.dataset.theme = "light";
    document.body.appendChild(pinned);
    try {
      expect(colorTokensOn(pinned)).toEqual(LIGHT_PALETTE);
    } finally {
      pinned.remove();
    }
  });

  it("resolves the dark violet palette on a root pinned with data-theme=\"dark\"", () => {
    attachDefaultTheme();
    document.documentElement.dataset.theme = "dark";
    try {
      expect(colorTokensOn(document.documentElement)).toEqual(DARK_PALETTE);
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });

  it("keeps a subtree pinned light inside a dark root light", () => {
    attachDefaultTheme();
    document.documentElement.dataset.theme = "dark";
    const pinned = document.createElement("div");
    pinned.dataset.theme = "light";
    document.body.appendChild(pinned);
    try {
      expect(colorTokensOn(pinned)).toEqual(LIGHT_PALETTE);
    } finally {
      pinned.remove();
      delete document.documentElement.dataset.theme;
    }
  });

  it("follows a dark system preference with the same dark palette, unless the page pins itself light", () => {
    // jsdom evaluates no `@media`, so this reads the stylesheet: exactly one
    // rule inside `prefers-color-scheme: dark`, selecting the root when it is
    // not pinned light, declaring what the data-theme="dark" rule declares.
    const declarations = (body: string) =>
      body
        .split(";")
        .map((declaration) => declaration.trim().replace(/\s+/g, " "))
        .filter((declaration) => declaration !== "")
        .sort();
    const media = /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{([\s\S]*?\})\s*\}/.exec(themeRules);
    expect(media).not.toBeNull();
    const inner = [...media![1].matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    expect(inner.map(([, selector]) => selector.trim())).toEqual([':root:not([data-theme="light"])']);

    const pinnedDark = /:root\[data-theme="dark"\]\s*\{([^{}]*)\}/.exec(themeRules);
    expect(pinnedDark).not.toBeNull();
    expect(declarations(inner[0][2])).toEqual(declarations(pinnedDark![1]));
    expect(declarations(pinnedDark![1])).toHaveLength(Object.keys(DARK_PALETTE).length);
  });
});

describe("default theme's design tokens", () => {
  /**
   * Every rule, as selector and body. A rule nested in `@media` is picked up
   * with its own selector: the pattern matches innermost braces only.
   */
  const rules = [...themeRules.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([whole, selector, body]) => ({
    whole,
    selector: selector.trim(),
    body,
  }));

  /**
   * A token block — where ADR-0004 says every literal belongs — is a rule
   * selecting the root or a data-theme pin and nothing else. There is more
   * than one: the colors are declared apart from the rest so that a pin can
   * redeclare them.
   */
  const isTokenSelector = (part: string) =>
    /^(?::root)?(?:\[data-theme="(?:light|dark)"\]|:not\(\[data-theme="light"\]\))?$/.test(part) &&
    part !== "";
  const tokenBlocks = rules.filter((rule) =>
    rule.selector.split(",").every((part) => isTokenSelector(part.trim())),
  );

  it("keeps every color literal inside the token declarations", () => {
    // Not vacuous: every color token is declared in some token block.
    const declaredInBlocks = tokenBlocks.map((block) => block.body).join("\n");
    for (const token of Object.keys(LIGHT_PALETTE)) {
      expect(declaredInBlocks).toContain(`${token}:`);
    }
    const outside = tokenBlocks.reduce((css, block) => css.replace(block.whole, ""), themeRules);

    // Per ADR-0004 the tokens are the single source of truth for the diagram's
    // colors; a literal in a rule is a value no consumer can override.
    const literals = outside.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g) ?? [];
    expect(literals).toEqual([]);
  });

  it("declares every token it references", () => {
    const declared = new Set(
      tokenBlocks.flatMap((block) => block.body.match(/--siren-[\w-]+(?=\s*:)/g) ?? []),
    );
    const referenced = new Set(
      (themeRules.match(/var\(\s*(--siren-[\w-]+)/g) ?? []).map((use) =>
        use.replace(/^var\(\s*/, ""),
      ),
    );

    // A `var()` naming a token that was never declared silently resolves to
    // nothing — for `stroke` or `fill` that means an invisible element, which
    // is the exact class of defect this file's sequence rules exist to fix.
    const dangling = [...referenced].filter((token) => !declared.has(token)).sort();
    expect(dangling).toEqual([]);
  });
});

/**
 * A state diagram exercising every class the state renderer emits: two
 * states, a labelled transition, an unlabelled one, the self-loop —
 * which is the one figure whose line is drawn beside a box rather than
 * between two, and so the one most likely to be left unpainted by a rule
 * written for the straight case — both pseudo-states, whose discs are
 * the one figure here that has no stroke to fall back on: a `<circle>` the
 * theme forgets to fill is not a faint shape, it is nothing at all — and a
 * composite, whose frame and title are painted by rules of their own
 * because a frame encloses boxes drawn over it and so must not be filled —
 * and a **note**, whose box, text and connector are drawn inside the state's
 * own group through the three classes a class diagram's note already uses,
 * so this is what says those rules reach a note drawn here too — and the
 * three **stereotyped** states, whose diamond and bar are the two figures
 * here with no text inside them to give the reader a clue when nothing
 * paints them: an unpainted bar is not a faint slab, it is a gap in the
 * picture, exactly as an unpainted disc is.
 *
 * Inline rather than read from `examples/`, for the reason `EVERY_FEATURE`
 * and `EVERY_CLASS_FEATURE` are: exhaustive *class* coverage is a different
 * goal from a demo example's, and an example narrowed for the demo's sake
 * must not quietly narrow what the theme is checked against.
 */
const EVERY_STATE_FEATURE = `stateDiagram-v2
[*] --> Idle
Idle --> Running : start
Running --> Running : retry
Running --> Idle
Running --> [*]
Running : working
state "on the current job" as Running
note right of Idle : waiting for work
state Choice <<choice>>
state Split <<fork>>
state Merge <<join>>
Idle --> Choice
Choice --> Split
Split --> Merge
state Grouped {
direction LR
Held --> Beside
}
state Concurrent {
Reading --> Parsing
--
Logging --> Flushed
}
`;

describe("default theme coverage of the state renderer", () => {
  it("has a rule selecting every class the state renderer emits", () => {
    const emitted = emittedSirenClasses(renderThemedSVG(EVERY_STATE_FEATURE));
    expect(emitted.length).toBeGreaterThan(0);

    const unthemed = emitted.filter(
      (name) => !new RegExp(`\\.${name}(?![\\w-])`).test(themeRules),
    );
    expect(unthemed).toEqual([]);
  });

  it("gives every drawn element a paint, including the ones carrying no class", () => {
    expect(paintlessElements(renderThemedSVG(EVERY_STATE_FEATURE))).toEqual([]);
  });

  it("gives a highlighted state and transition the outline effect, not just the glow one", () => {
    // Both are addressable by id in the rendered SVG, which is what a
    // `timeline:` block will name once this kind reads one — and the
    // flowchart's and class diagram's outline rules name their own classes,
    // so without rules of its own `highlight X outline` here would be a step
    // on which nothing visibly happens.
    const svg = renderThemedSVG(EVERY_STATE_FEATURE);

    // Named by id rather than by "the first `.siren-state`": the three
    // figures a state group can hold are highlighted through three
    // different inner elements, and a pseudo-state has no frame for a rule
    // written against one to land on.
    const cases: [string, string][] = [
      ['g.siren-state[data-siren-id="Idle"]', ".siren-state-frame"],
      ['g.siren-state[data-siren-id="start:1"]', ".siren-state-start"],
      ['g.siren-state[data-siren-id="end:1"]', ".siren-state-end"],
      // A composite is the kind's third timeline target, addressed under the
      // author's own name, and its frame is a fourth figure again: a
      // `.siren-composite-frame` rather than the `.siren-state-frame` the
      // first case covers, so a rule written for the box misses it and
      // `highlight Grouped outline` is a step on which nothing happens.
      ['g.siren-state[data-siren-id="Grouped"]', ".siren-composite-frame"],
      // A stereotyped state is a timeline target under the author's own
      // name like any other, and its bar is a fifth figure again — solid,
      // with no stroke of its own, so a rule written for the box leaves
      // `highlight Split outline` doing nothing at all. The `<<choice>>`
      // diamond needs no case beside it: it wears `.siren-state-frame`,
      // which the first case already covers, and this asks the question of
      // the figure that does not.
      ['g.siren-state[data-siren-id="Split"]', ".siren-state-bar"],
      // And a concurrent region, which is addressable under the generated
      // id `buildStateModel` minted for it (`region:1`) and drawn with a
      // sixth figure again — a dashed frame, `.siren-state-region`, which
      // neither the box rule nor the composite rule reaches.
      ['g.siren-state[data-siren-id="region:1"]', ".siren-state-region"],
      [".siren-transition", ".siren-transition-line"],
    ];

    for (const [groupSelector, shapeSelector] of cases) {
      const group = svg.querySelector(groupSelector);
      const shape = group?.querySelector(shapeSelector);
      if (group === null || group === undefined || shape === null || shape === undefined) {
        throw new Error(`no ${shapeSelector} inside ${groupSelector}`);
      }

      const before = getComputedStyle(shape).stroke;
      group.classList.add("siren-highlight-outline");
      const after = getComputedStyle(shape).stroke;
      group.classList.remove("siren-highlight-outline");

      expect(after).not.toBe(before);
      expect(after).toContain("--siren-highlight-color");
    }
  });

  it("sets the theme's type on the state-diagram groups", () => {
    // The `<text>` children carry no font of their own and inherit the
    // group's, exactly as a class diagram's do — so a group left out of the
    // shared font rule renders its labels in the browser's default serif at
    // the browser's default size, while `layoutStateDiagram` sized every box
    // from the theme's font. The box and its text would disagree.
    const svg = renderThemedSVG(EVERY_STATE_FEATURE);

    const groups = Array.from(svg.querySelectorAll(".siren-state, .siren-transition"));
    expect(groups.length).toBeGreaterThan(0);

    const untyped = groups.filter((group) => {
      const style = getComputedStyle(group);
      return style.fontFamily === "" || style.fontSize === "";
    });
    expect(untyped.map(describeElement)).toEqual([]);
  });
});

/**
 * An ER diagram exercising every class the ER renderer emits: entity boxes,
 * their frames, and their names; relationships, their lines, their labels
 * and all three cardinality glyphs. Three entities rather than one, and one
 * of them hyphenated, so a rule written against a single box or against a
 * `\w+` name would still be seen here.
 *
 * The two relationships between them cover all four cardinalities and both
 * line types: `||--o{` is `onlyOne`/`zeroOrMore` on a solid line, `|o..|{`
 * is `zeroOrOne`/`oneOrMore` on a dashed one. Both are asymmetric, which
 * matters even here — an unthemed marker is invisible, and a theme test on
 * a symmetric relationship can be satisfied by half the markers.
 *
 * `CUSTOMER` carries an attribute table, which is a second figure for an
 * entity and not a decoration of the first: the name row's rule, the column
 * rules and all four cell kinds appear only here. Its attributes are chosen
 * so that every column is drawn — one writes keys, one writes a comment —
 * because a column no attribute uses is dropped from the picture entirely,
 * and an unthemed cell class in a dropped column would go unseen.
 *
 * Inline rather than read from `examples/`, for the reason `EVERY_FEATURE`,
 * `EVERY_CLASS_FEATURE` and `EVERY_STATE_FEATURE` are: exhaustive *class*
 * coverage is a different goal from a demo example's, and an example
 * narrowed for the demo's sake must not quietly narrow what the theme is
 * checked against. It is deliberately the whole of what this kind draws
 * today — the ticket that lands aliases adds a figure here and then has to
 * theme what it added.
 *
 * A `subgraph` block wraps two of the three entities, because a cluster is
 * a third figure and not a decoration of the box: its frame and its title
 * carry classes no other element does, and an unthemed frame is simply not
 * drawn (SVG's initial `stroke: none`). Its `direction` is written too, so
 * that the block this file renders is the one the ER corpus rows draw.
 */
const EVERY_ER_FEATURE = `erDiagram
subgraph sales
  direction LR
  CUSTOMER {
    string name
    int age PK "the age"
    string c UK,PK "both"
  }
  ORDER
end
LINE-ITEM
CUSTOMER ||--o{ ORDER : places
ORDER |o..|{ LINE-ITEM : contains
`;

describe("default theme coverage of the ER renderer", () => {
  it("has a rule selecting every class the ER renderer emits", () => {
    const emitted = emittedSirenClasses(renderThemedSVG(EVERY_ER_FEATURE));
    expect(emitted.length).toBeGreaterThan(0);

    const unthemed = emitted.filter(
      (name) => !new RegExp(`\\.${name}(?![\\w-])`).test(themeRules),
    );
    expect(unthemed).toEqual([]);
  });

  it("gives every drawn element a paint, including the ones carrying no class", () => {
    expect(paintlessElements(renderThemedSVG(EVERY_ER_FEATURE))).toEqual([]);
  });

  it("gives a highlighted entity the outline effect, not just the glow one", () => {
    // An entity is addressable by id in the rendered SVG (ADR-0009), so it is
    // this kind's timeline target the moment the kind reads a `timeline:`
    // block. Every other kind's outline rule names its own classes, so
    // without one of its own `highlight CUSTOMER outline` would be a step on
    // which nothing visibly happens — the defect this check exists to catch,
    // one kind over.
    const svg = renderThemedSVG(EVERY_ER_FEATURE);

    const group = svg.querySelector("g.siren-er-entity");
    const shape = group?.querySelector(".siren-er-entity-frame");
    if (group === null || group === undefined || shape === null || shape === undefined) {
      throw new Error("no .siren-er-entity-frame inside .siren-er-entity");
    }

    const before = getComputedStyle(shape).stroke;
    group.classList.add("siren-highlight-outline");
    const after = getComputedStyle(shape).stroke;
    group.classList.remove("siren-highlight-outline");

    expect(after).not.toBe(before);
    expect(after).toContain("--siren-highlight-color");
  });

  it("gives a highlighted relationship the outline effect, not just the glow one", () => {
    // The entity's own check, one figure over. A relationship is addressable
    // by id in the rendered SVG (ADR-0009) — `CUSTOMER:ORDER` — so it is this
    // kind's second timeline target the moment the kind reads a `timeline:`
    // block, and every outline selector in the theme names some other kind's
    // classes. Without one of its own, `highlight CUSTOMER:ORDER outline`
    // would be a step on which nothing visibly happens.
    //
    // ⚠️ The **colon** is this kind's own connector separator and not a typo
    // for the `-` the other four use: an ER entity name may contain a
    // hyphen, so `${from}-${to}` could spell a legal entity name and put two
    // drawn elements under one id (see `ResolvedErRelationship`).
    const svg = renderThemedSVG(EVERY_ER_FEATURE);

    const group = svg.querySelector("g.siren-er-relationship");
    const shape = group?.querySelector(".siren-er-relationship-line");
    if (group === null || group === undefined || shape === null || shape === undefined) {
      throw new Error("no .siren-er-relationship-line inside .siren-er-relationship");
    }

    const before = getComputedStyle(shape).stroke;
    group.classList.add("siren-highlight-outline");
    const after = getComputedStyle(shape).stroke;
    group.classList.remove("siren-highlight-outline");

    expect(after).not.toBe(before);
    expect(after).toContain("--siren-highlight-color");
  });

  it("gives a highlighted cluster the outline effect, not just the glow one", () => {
    // The entity's own check, one figure over. A cluster is addressable by
    // id in the rendered SVG (ADR-0009) — the generated `subgraph:1` — so
    // it is this kind's third timeline target, and every outline selector
    // in the theme names some other kind's classes. Without one of its own,
    // `highlight subgraph:1 outline` would be a step on which nothing
    // visibly happens.
    const svg = renderThemedSVG(EVERY_ER_FEATURE);

    const group = svg.querySelector("g.siren-er-subgraph");
    const shape = group?.querySelector(".siren-er-subgraph-frame");
    if (group === null || group === undefined || shape === null || shape === undefined) {
      throw new Error("no .siren-er-subgraph-frame inside .siren-er-subgraph");
    }

    const before = getComputedStyle(shape).stroke;
    group.classList.add("siren-highlight-outline");
    const after = getComputedStyle(shape).stroke;
    group.classList.remove("siren-highlight-outline");

    expect(after).not.toBe(before);
    expect(after).toContain("--siren-highlight-color");
  });

  it("sets the theme's type on the ER-diagram groups", () => {
    // The `<text>` children carry no font of their own and inherit the
    // group's, exactly as a state diagram's do — so a group left out of the
    // shared font rule renders its names in the browser's default serif at
    // the browser's default size, while `layoutErDiagram` sized every box
    // from the theme's font. The box and its name would disagree.
    const svg = renderThemedSVG(EVERY_ER_FEATURE);

    const groups = Array.from(svg.querySelectorAll(".siren-er-entity"));
    expect(groups.length).toBeGreaterThan(0);

    const untyped = groups.filter((group) => {
      const style = getComputedStyle(group);
      return style.fontFamily === "" || style.fontSize === "";
    });
    expect(untyped.map(describeElement)).toEqual([]);
  });
});
