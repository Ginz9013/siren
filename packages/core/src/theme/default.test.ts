import { describe, expect, it } from "vitest";
import { render } from "../index";
import { BASE_FONT_SIZE_PX } from "../label/label";
import { FRAME_PAINT } from "../layout/shapes/shape";
import { NODE_DATA_SHAPES } from "../parser/flowchartNodeData";

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
Web->>Retry: Schedule a retry
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
    Web-xRetry: Stop
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
Q ~~~ U[Invisibly linked]
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

describe("default theme's sequence link menu (01M3NM3BZ)", () => {
  const LINK_MENU = `sequenceDiagram
participant A
participant B
A->>B: hi
links A: {"Home": "https://x.com", "Docs": "https://d.com"}
link B: Docs @ https://d.com
link B: Wiki @ https://w.com
`;

  it("has a rule selecting every class the menu emits, and paints every part of it", () => {
    const svg = renderThemedSVG(LINK_MENU);
    const menuClasses = emittedSirenClasses(svg).filter((name) => name.startsWith("siren-link"));
    expect(menuClasses).toContain("siren-link-menu-items");

    const unthemed = menuClasses.filter((name) => !new RegExp(`\\.${name}(?![\\w-])`).test(themeRules));
    expect(unthemed).toEqual([]);
    expect(paintlessElements(svg).filter((d) => d.includes("link"))).toEqual([]);
  });

  it("hides every menu until it is hovered or holds focus", () => {
    const svg = renderThemedSVG(LINK_MENU);
    const menus = Array.from(svg.querySelectorAll<SVGGElement>("g.siren-link-menu"));
    expect(menus.length).toBeGreaterThan(0);
    for (const menu of menus) {
      expect(getComputedStyle(menu.querySelector(".siren-link-menu-items")!).visibility).toBe("hidden");
    }

    // Keyboard: focusing the menu's group reveals its own items, and only
    // those. A fresh render, because jsdom caches computed styles until the
    // document changes and a change of focus does not count as one.
    const focusable = Array.from(
      renderThemedSVG(LINK_MENU).querySelectorAll<SVGGElement>("g.siren-link-menu"),
    );
    focusable[0]!.focus();
    expect(document.activeElement).toBe(focusable[0]);
    expect(getComputedStyle(focusable[0]!.querySelector(".siren-link-menu-items")!).visibility).toBe("visible");
    expect(getComputedStyle(focusable[1]!.querySelector(".siren-link-menu-items")!).visibility).toBe("hidden");
    focusable[0]!.blur();

    // Pointer: jsdom cannot hover, so the rule itself is what is checked.
    expect(themeRules).toMatch(/\.siren-link-menu:hover\s+\.siren-link-menu-items/);
  });
});

describe("default theme's outline on sequence-diagram targets", () => {
  it("outlines a participant everywhere it is drawn: both rows, the lifeline, and a destroyed one's closing box", () => {
    const svg = renderThemedSVG(EVERY_FEATURE);

    // Web is a box participant; Shopper an actor (circle and lines); Retry is
    // created and destroyed, so its second box is its closing box.
    expect(outlineFailures(svg, "Web")).toEqual([]);
    expect(outlineFailures(svg, "Shopper")).toEqual([]);
    expect(outlineFailures(svg, "Retry")).toEqual([]);
  });

  it("styles no destroy mark: a destroyed participant ends with its closing box, a participant box like any other", () => {
    expect(themeRules).not.toMatch(/siren-destroy-mark/);
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

  it("paints an author-colored arrowhead with its line's stroke too, and keeps the author's color for a browser without `context-stroke`", () => {
    // This rewrites what pinned an author-colored head as an inline `fill`
    // outranking `.siren-arrow-fill`. That was right while a head could not
    // see its line: the color had to be written on the marker. It is wrong
    // now that a head is painted with its line's stroke, because an inline
    // `fill` would outrank that rule too — and the line's stroke is what a
    // highlight changes, so a coloured head would stay the author's color
    // under every highlight (backlog 01M598E4W907957JB9H2JFG7QG).
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

    // Both heads take the stroke of the line they are drawn for: the theme's
    // token at the unstyled one, the author's inline `stroke` at the other.
    expect(getComputedStyle(headFor("B-C")).fill).toBe("context-stroke");
    expect(getComputedStyle(headFor("A-B")).fill).toBe("context-stroke");

    // A browser that does not know the keyword drops it and falls back to
    // `.siren-arrow-fill`, which paints through the token. The coloured
    // head's marker carries the author's color *as* that token, so the
    // fallback still draws the whole arrow red; the unstyled head carries
    // nothing and takes the diagram's token, as before.
    expect(themeRules).toMatch(/\.siren-arrow-fill\s*\{\s*fill:\s*var\(--siren-edge-stroke\);\s*\}/);
    expect(getComputedStyle(headFor("A-B")).getPropertyValue("--siren-edge-stroke")).toBe("#f00");
    expect(headFor("B-C").getAttribute("style")).toBeNull();
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

  it("fills a subgraph's frame through `--siren-subgraph-fill`, unfilled by default, and lets an author's fill win", () => {
    // A token at the point of use, so a theme redeclaring it on one
    // subgraph's `data-siren-id` group repaints that frame alone; `none`, so
    // the default picture is the outlined frame it has always been.
    expect(themeRules).toMatch(/:root\s*\{[^}]*--siren-subgraph-fill:\s*none;/);
    const svg = renderThemedSVG("flowchart TB\nsubgraph s1 [Box]\nA\nend\n");
    const frame = svg.querySelector("g.siren-subgraph rect.siren-subgraph-frame")!;
    expect(getComputedStyle(frame).fill).toBe("var(--siren-subgraph-fill)");

    frame.setAttribute("style", "fill: rgb(255, 153, 102)");
    expect(getComputedStyle(frame).fill).toBe("rgb(255, 153, 102)");
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

  it("sets the theme's type on every connector's label group, which no longer sits inside the connector's own group (ADR-0016)", () => {
    // The class diagram's label group is drawn today, so it is checked as
    // drawn. The state and ER label groups are named by the same decision and
    // join the same rule now, so those renderers can split their connectors
    // without touching the theme; until they do, a bare group of each class
    // stands in for what they will draw.
    const svg = renderThemedSVG(EVERY_CLASS_FEATURE);
    const drawn = Array.from(svg.querySelectorAll("g.siren-relationship-labels"));
    expect(drawn.length).toBeGreaterThan(0);

    const standIns = ["siren-transition-labels", "siren-er-relationship-labels"].map((name) => {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("class", name);
      svg.appendChild(group);
      return group;
    });

    const untyped = [...drawn, ...standIns].filter((group) => {
      const style = getComputedStyle(group);
      return style.fontFamily === "" || style.fontSize === "";
    });
    expect(untyped.map(describeElement)).toEqual([]);
  });
});

/*
 * The palette checks below have a twin in siren-board's src/styles.test.ts,
 * which asks the same questions of board's chrome tokens: one palette, one
 * `:root` block, no light/dark switch (ADR-0014). The two packages share no
 * test utilities, so a change to how one reads a token block belongs in the
 * other too.
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
 * The five color tokens as the root itself resolves them. The root, and not
 * some element inside the diagram, because jsdom resolves a custom property
 * only on the element that declares it and does not inherit one to a child —
 * and since ADR-0014 the one token block selects `:root` and nothing else.
 */
function colorTokensOnRoot(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
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

/** The one palette, copied from siren-website's decision 01M3BY1GPP. */
const PALETTE = {
  "--siren-node-fill": "#f3efff",
  "--siren-node-stroke": "#6d3fd6",
  "--siren-node-text": "#1d1730",
  "--siren-edge-stroke": "#6f6a84",
  "--siren-highlight-color": "#0d9488",
};

describe("default theme's color palette", () => {
  it("resolves the violet palette on the root", () => {
    attachDefaultTheme();
    expect(colorTokensOnRoot()).toEqual(PALETTE);
  });

  it("names no light/dark switch anywhere in the stylesheet", () => {
    // ADR-0014: the theme is one palette with one entry point. A consumer who
    // wants a second one redeclares these tokens under a selector of their own
    // choosing, so nothing here may read `data-theme` or
    // `prefers-color-scheme` — reading either would make Siren pick a palette
    // on the consumer's behalf again, which is the mechanism that was removed.
    // Asserted against the whole file, comments included: the words naming a
    // switch that no longer exists belong nowhere in it.
    expect(defaultThemeCss).not.toMatch(/data-theme/);
    expect(defaultThemeCss).not.toMatch(/prefers-color-scheme/);
  });
});

describe("default theme's label paint", () => {
  // Mermaid's default HTML labels draw `<mark>` black on yellow `#ff0`
  // (measured, the board's table) — the browser's default stylesheet, which
  // ADR-0015 turns into two tokens a consumer can repaint.
  it("paints a marked run's background and text through the two mark tokens", () => {
    const svg = renderThemedSVG(`flowchart TB
A[x <mark>m</mark>]`);

    const rect = svg.querySelector("rect.siren-label-mark");
    const run = svg.querySelector("tspan.siren-label-mark-text");
    if (rect === null || run === null) {
      throw new Error("no marked run drawn");
    }
    expect(getComputedStyle(rect).fill).toBe("var(--siren-label-mark-fill)");
    expect(getComputedStyle(run).fill).toBe("var(--siren-label-mark-text)");

    const root = getComputedStyle(document.documentElement);
    expect(root.getPropertyValue("--siren-label-mark-fill").trim()).toBe("#ff0");
    expect(root.getPropertyValue("--siren-label-mark-text").trim()).toBe("#000");
  });

  // Mermaid's default HTML labels draw a link `#0000ee` and underlined
  // (measured, the board's table) — the browser's default link color, which
  // ADR-0015 turns into a token a consumer can repaint.
  it("paints a linked run through the link token", () => {
    const svg = renderThemedSVG(`flowchart TB
A["x <a href='https://e.x'>l</a>"]`);

    const run = svg.querySelector("a tspan.siren-label-link");
    if (run === null) {
      throw new Error("no linked run drawn");
    }
    expect(getComputedStyle(run).fill).toBe("var(--siren-label-link)");
    expect(getComputedStyle(document.documentElement).getPropertyValue("--siren-label-link").trim()).toBe("#0000ee");
  });

  // The innermost of a link and a mark paints the text (measured): a mark
  // inside a link draws the mark's black, and nothing in the theme may
  // repaint it with the link's blue.
  it("paints a mark inside a link with the mark text token", () => {
    const svg = renderThemedSVG(`flowchart TB
A["x <a href='https://e.x'><mark>m</mark></a>"]`);

    const run = svg.querySelector("a tspan.siren-label-mark-text");
    if (run === null) {
      throw new Error("no marked linked run drawn");
    }
    expect(getComputedStyle(run).fill).toBe("var(--siren-label-mark-text)");
  });

  // ADR-0014: a second theme is the consumer's, declared by redeclaring
  // tokens under a selector of their own. The label-paint tokens must answer
  // to that exactly as the palette does. jsdom does not inherit custom
  // properties into descendants (measured: a value redeclared on the
  // container reads back on the container and as "" on any child), so this
  // pins the two halves CSS joins: the theme's value lands on the diagram's
  // container, and every drawn element paints with a `var()` reference to
  // the token rather than a literal — which a browser resolves from that
  // ancestor.
  it("lets a theme scoped to the diagram's container repaint the three label-paint tokens", () => {
    const svg = renderThemedSVG(`flowchart TB
A["x <mark>m</mark> <a href='https://e.x'>l</a>"]`);
    const container = svg.parentElement;
    if (container === null) {
      throw new Error("the svg has no container");
    }
    const theme = document.createElement("style");
    theme.textContent = `[data-label-paint-test] {
  --siren-label-mark-fill: #123456;
  --siren-label-mark-text: #abcdef;
  --siren-label-link: #9cc7ff;
}`;
    document.head.appendChild(theme);
    container.setAttribute("data-label-paint-test", "");
    try {
      const rect = svg.querySelector("rect.siren-label-mark");
      const marked = svg.querySelector("tspan.siren-label-mark-text");
      const linked = svg.querySelector("a tspan.siren-label-link");
      if (rect === null || marked === null || linked === null) {
        throw new Error("no marked or linked run drawn");
      }
      expect(getComputedStyle(rect).fill).toBe("var(--siren-label-mark-fill)");
      expect(getComputedStyle(marked).fill).toBe("var(--siren-label-mark-text)");
      expect(getComputedStyle(linked).fill).toBe("var(--siren-label-link)");
      const theirs = getComputedStyle(container);
      expect(theirs.getPropertyValue("--siren-label-mark-fill").trim()).toBe("#123456");
      expect(theirs.getPropertyValue("--siren-label-mark-text").trim()).toBe("#abcdef");
      expect(theirs.getPropertyValue("--siren-label-link").trim()).toBe("#9cc7ff");
    } finally {
      theme.remove();
      container.removeAttribute("data-label-paint-test");
    }
  });

  // demos/theme-dark.css is the second theme the README tells consumers to
  // copy. It must redeclare every color token core's `:root` declares — the
  // palette and the label paint alike — or a consumer who copies it inherits
  // a light color on a dark node (the link blue measured 1.6:1 on its node
  // fill before this test existed).
  it("has the demos' dark theme redeclare every color token core declares", () => {
    const darkThemeCss = (
      process as unknown as {
        getBuiltinModule(id: "node:fs"): { readFileSync(path: string, encoding: "utf8"): string };
      }
    )
      .getBuiltinModule("node:fs")
      .readFileSync(
        `${(import.meta as unknown as { dirname: string }).dirname}/../../../../demos/theme-dark.css`,
        "utf8",
      );
    const colorTokens = [...Object.keys(PALETTE), "--siren-label-mark-fill", "--siren-label-mark-text", "--siren-label-link"];
    const missing = colorTokens.filter((token) => !new RegExp(`${token}\\s*:`).test(darkThemeCss));
    expect(missing).toEqual([]);
  });

  // `layoutLabel` measures an author's px size, and an `em` spacing, against
  // a base it cannot read off the stylesheet; that base is this token's
  // default, and the two may not drift apart.
  it("declares the font size label measurement takes as its base", () => {
    const declared = /--siren-font-size:\s*(\d*\.?\d+)px;/.exec(defaultThemeCss);

    expect(declared?.[1]).toBeDefined();
    expect(Number(declared![1])).toBe(BASE_FONT_SIZE_PX);
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
   * selecting `:root` and nothing else. ADR-0014 left exactly one selector
   * able to be one, so this no longer has to know about theme pins.
   */
  const isTokenSelector = (part: string) => part === ":root";
  const tokenBlocks = rules.filter((rule) =>
    rule.selector.split(",").every((part) => isTokenSelector(part.trim())),
  );

  it("declares every token in one block, so a consumer has one entry point", () => {
    // ADR-0014: colors used to be declared apart from the rest so a theme pin
    // could redeclare them alone. With the pin gone there is no reason for a
    // second block, and a consumer reading this file to find what they may
    // override should find all of it in one place.
    expect(tokenBlocks.map((block) => block.selector)).toEqual([":root"]);

    const declared = tokenBlocks[0].body.match(/--siren-[\w-]+(?=\s*:)/g) ?? [];
    for (const token of Object.keys(PALETTE)) {
      expect(declared).toContain(token);
    }
    // The non-color tokens live there too, not in a block of their own.
    for (const token of ["--siren-font-family", "--siren-node-border-radius", "--siren-fade-duration"]) {
      expect(declared).toContain(token);
    }
  });

  it("keeps every color literal inside the token declarations", () => {
    // Not vacuous: every color token is declared in some token block.
    const declaredInBlocks = tokenBlocks.map((block) => block.body).join("\n");
    for (const token of Object.keys(PALETTE)) {
      expect(declaredInBlocks).toContain(`${token}:`);
    }
    const outside = tokenBlocks.reduce((css, block) => css.replace(block.whole, ""), themeRules);

    // Per ADR-0004 the tokens are the single source of truth for the diagram's
    // colors; a literal in a rule is a value no consumer can override.
    const literals = outside.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g) ?? [];
    expect(literals).toEqual([]);
  });

  it("declares every token it references", () => {
    // Declared anywhere a rule sets it: a token in its block, and an internal
    // hook such as `--siren-edge-march`, which is no token block's (decision
    // 01M59N4KXRKK7R9Y55K64R4013), in the core rule that sets it. A name
    // nothing sets is still caught, fallback or not.
    const declared = new Set(themeRules.match(/--siren-[\w-]+(?=\s*:)/g) ?? []);
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

/**
 * The background behind a connector's label, read through this stylesheet:
 * its color comes only from `--siren-edge-label-fill`, and a highlight —
 * which reaches the background, since it wears the edge's id — leaves that
 * fill alone, as highlight only ever restyles lines and frames.
 */
describe("default theme's paint for a connector label's background", () => {
  /** `source` rendered into the document with the default theme attached, with its controller. */
  function renderThemed(source: string) {
    attachDefaultTheme();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const result = render(source, container);
    expect(result.diagnostics).toEqual([]);
    return { svg: result.svg!, controller: result.controller! };
  }

  it("fills it from --siren-edge-label-fill, a translucent canvas white, unchanged by a highlight", () => {
    const { svg, controller } = renderThemed(
      "flowchart TD\nA -->|yes| B\ntimeline:\nhighlight A-B outline\nhighlight A-B glow\n",
    );
    const background = svg.querySelector("rect.siren-connector-label-background")!;

    expect(getComputedStyle(background).fill).toBe("var(--siren-edge-label-fill)");
    expect(
      getComputedStyle(document.documentElement).getPropertyValue("--siren-edge-label-fill").trim(),
    ).toBe("rgb(255 255 255 / 0.8)");

    controller.next();
    expect(background.classList.contains("siren-highlight-outline")).toBe(true);
    expect(getComputedStyle(background).fill).toBe("var(--siren-edge-label-fill)");
    controller.next();
    expect(background.classList.contains("siren-highlight-glow")).toBe(true);
    expect(getComputedStyle(background).fill).toBe("var(--siren-edge-label-fill)");
  });
  /** The drop-shadow `filter` `element` is drawn with, or `""` when it has none. */
  const shadowOf = (element: Element): string => {
    const filter = getComputedStyle(element).filter;
    return filter.includes("drop-shadow") ? filter : "";
  };

  // `glow` is a drop-shadow, which on a rect draws a halo around the
  // rectangle — a lit box around the label rather than a lit label. The
  // label's text and the line keep their glow; the background takes none.
  it("draws no glow halo around a flowchart edge label's background, while its text and line still glow", () => {
    const { svg, controller } = renderThemed("flowchart TD\nA -->|yes| B\ntimeline:\nhighlight A-B glow\n");

    controller.next();
    const background = svg.querySelector("rect.siren-connector-label-background")!;
    expect(background.classList.contains("siren-highlight-glow")).toBe(true);
    expect(shadowOf(background)).toBe("");
    expect(shadowOf(svg.querySelector("text.siren-edge-label")!)).not.toBe("");
    expect(shadowOf(svg.querySelector("path.siren-edge")!)).not.toBe("");
  });

  // In the other three kinds the highlight lands on the label's group, and a
  // filter on a group shadows its whole subtree as one picture — background
  // included. So the group takes no shadow and its text takes it instead.
  it.each([
    ["class", "classDiagram\nAnimal <|-- Duck : inherits\ntimeline:\nhighlight Animal-Duck glow\n", "g.siren-relationship-labels", "text.siren-relationship-label"],
    ["state", "stateDiagram-v2\nIdle --> Running : start\ntimeline:\nhighlight Idle-Running glow\n", "g.siren-transition-labels", "text.siren-transition-label"],
    ["ER", "erDiagram\nCUSTOMER ||--o{ ORDER : places\ntimeline:\nhighlight CUSTOMER:ORDER glow\n", "g.siren-er-relationship-labels", "text.siren-er-relationship-label"],
  ])("draws no glow halo around a %s connector label's background, while its text still glows", (_kind, source, groupSelector, textSelector) => {
    const { svg, controller } = renderThemed(source);

    controller.next();
    const group = svg.querySelector(groupSelector)!;
    expect(group.classList.contains("siren-highlight-glow")).toBe(true);
    expect(shadowOf(group)).toBe("");
    expect(shadowOf(group.querySelector("rect.siren-connector-label-background")!)).toBe("");
    expect(shadowOf(group.querySelector(textSelector)!)).not.toBe("");
  });
});

/**
 * The paints a shape-table frame can wear beside `siren-node-frame`. Each is a class rather than an inline
 * declaration, so the highlight rules — which select more classes — still
 * outline the frame, and an author's inline `style` still wins.
 */
describe("default theme's paint for a node's shape-table frames", () => {
  /** The first frame `id` draws in `source`, themed. */
  const frameOf = (source: string, id: string) => {
    const svg = renderThemedSVG(source);
    const group = svg.querySelector(`g.siren-node[data-siren-id="${id}"]`)!;
    return { group, frame: group.querySelector(".siren-node-frame")! };
  };

  it("leaves a text block's frame without fill or stroke, but outlines it when highlighted", () => {
    const { group, frame } = frameOf('flowchart TB\n  A@{ shape: text, label: "Words" }', "A");
    expect(getComputedStyle(frame).fill).toBe("none");
    expect(getComputedStyle(frame).stroke).toBe("none");

    group.classList.add("siren-highlight-outline");
    expect(getComputedStyle(frame).stroke).toContain("--siren-highlight-color");
    group.classList.remove("siren-highlight-outline");

    frame.setAttribute("style", "stroke: rgb(204, 0, 0)");
    expect(getComputedStyle(frame).stroke).toBe("rgb(204, 0, 0)");
  });

  it("paints a composite's frame as a subgraph's frame is painted: stroked like a node, never filled", () => {
    const { frame } = frameOf('flowchart TB\n  A@{ shape: composite, label: "Group" }', "A");
    expect(getComputedStyle(frame).fill).toBe("none");
    expect(getComputedStyle(frame).stroke).toBe("var(--siren-node-stroke)");
    // A subgraph's frame is unfilled through its token, which defaults to `none`.
    expect(themeRules).toMatch(/\.siren-subgraph-frame\s*\{[^}]*fill:\s*var\(--siren-subgraph-fill\)/);
    expect(themeRules).toMatch(/--siren-subgraph-fill:\s*none;/);
  });

  it("paints a note node as the class and state diagrams paint a note", () => {
    // Mermaid 12.2.0 asks for its note colours on a flowchart `note` and
    // then paints it with the node's (measured in Chrome: its stylesheet's
    // node rule outranks the colours it set); Siren's notes already take
    // the node surface, so a flowchart note takes the same paint as a
    // class diagram's — through a class of its own a theme can repaint.
    const { frame } = frameOf('flowchart TB\n  A@{ shape: note, label: "Remember" }', "A");
    expect(getComputedStyle(frame).fill).toBe("var(--siren-node-fill)");
    expect(getComputedStyle(frame).stroke).toBe("var(--siren-node-stroke)");
    expect(themeRules).toMatch(/\.siren-node-frame\.siren-node-note\s*\{/);
  });

  it("gives each paint a frame can name a rule: none unfilled, line filled with the line colour", () => {
    // No shape in the table wears the line paint yet; it is the filled
    // figure of a shape drawn in its line colour alone (a fork bar, a filled
    // dot), and a frame wearing it must not be left to the node fill.
    const { frame } = frameOf("flowchart TB\n  A[x]", "A");
    frame.setAttribute("class", ["siren-node-frame", ...FRAME_PAINT.line].join(" "));
    expect(getComputedStyle(frame).fill).toBe("var(--siren-node-stroke)");
    frame.setAttribute("class", ["siren-node-frame", ...FRAME_PAINT.none].join(" "));
    expect(getComputedStyle(frame).fill).toBe("none");
    frame.setAttribute("class", ["siren-node-frame", ...FRAME_PAINT.node].join(" "));
    expect(getComputedStyle(frame).fill).toBe("var(--siren-node-fill)");
  });

  it("fills a filled circle with the line colour, and lets an author's fill repaint it as Mermaid does", () => {
    // Mermaid 12.2.0 draws `f-circ` in its line colour and, under
    // `style A fill:#f00`, red (measured in Chrome): the author's fill wins
    // over the shape's own paint, as it does on every other frame.
    const plain = frameOf("flowchart TB\n  A@{ shape: f-circ }", "A").frame;
    expect(getComputedStyle(plain).fill).toBe("var(--siren-node-stroke)");
    const styled = frameOf("flowchart TB\n  A@{ shape: f-circ }\n  style A fill:#f00", "A").frame;
    expect(getComputedStyle(styled).fill).toBe("#f00");
  });
});

describe("default theme's invisible edge", () => {
  it("draws an invisible edge with no width, and keeps it so under an outline highlight", () => {
    // A timeline's `highlight … outline` does not make an invisible edge
    // visible: an author shows one with `linkStyle`, which is inline and
    // wins over every rule here.
    const svg = renderThemedSVG(EVERY_FLOWCHART_FEATURE);
    const path = svg.querySelector('path.siren-edge[data-siren-id="Q-U"]')!;

    expect(path.classList.contains("siren-edge-invisible")).toBe(true);
    expect(getComputedStyle(path).strokeWidth).toBe("0");
    path.classList.add("siren-highlight-outline");
    const highlighted = getComputedStyle(path).strokeWidth;
    path.classList.remove("siren-highlight-outline");
    expect(highlighted).toBe("0");

    // jsdom's cascade is not specificity-aware (see above), so the cascade
    // alone cannot show that a browser agrees: `.siren-edge.siren-highlight-outline`
    // outranks a one-class `.siren-edge-invisible` there. The rule that keeps
    // the edge invisible has to outrank it by itself.
    expect(themeRules).toMatch(
      /\.siren-edge\.siren-edge-invisible\.siren-highlight-outline\s*\{[^}]*stroke-width:\s*0;/,
    );
  });
});

describe("default theme's animated edge", () => {
  /** The declarations of the one rule whose selector is exactly `selector`. */
  const ruleBody = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return themeRules.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  };

  it.each([
    ["fast", "20s"],
    ["slow", "50s"],
  ])("marches a %s edge's dashes once every %s, as Mermaid draws it", (speed, duration) => {
    // Mermaid 12.2.0's own rule, measured in headless Chrome:
    // `stroke-dasharray: 9,5 !important; stroke-dashoffset: 900;
    // animation: dash 20s linear infinite; stroke-linecap: round`, its
    // `dash` keyframes taking the offset to 0. The dash is `!important`
    // there, so it beats a dotted line and a `linkStyle` dash alike; this
    // theme writes no `!important`, so it beats a line's class by
    // specificity, and the model leaves an animated edge no author dash.
    const body = ruleBody(".siren-edge:is(.siren-edge-animation-fast, .siren-edge-animation-slow)");

    expect(body).toMatch(/stroke-dasharray:\s*var\(--siren-edge-march-dash\);/);
    expect(body).toMatch(/stroke-dashoffset:\s*var\(--siren-edge-march-offset\);/);
    expect(body).toMatch(/animation:\s*var\(--siren-edge-march,\s*none\);/);
    expect(body).toMatch(/stroke-linecap:\s*round;/);
    expect(ruleBody(`.siren-edge-animation-${speed}`)).toMatch(
      new RegExp(`--siren-edge-march:\\s*siren-edge-march\\s+var\\(--siren-edge-march-${speed}-duration\\)\\s+linear\\s+infinite;`),
    );
    expect(themeRules).toMatch(new RegExp(`--siren-edge-march-${speed}-duration:\\s*${duration};`));
    expect(themeRules).toMatch(/--siren-edge-march-dash:\s*9 5;/);
    expect(themeRules).toMatch(/--siren-edge-march-offset:\s*900;/);
    expect(defaultThemeCss).toMatch(/@keyframes siren-edge-march\s*\{\s*to\s*\{\s*stroke-dashoffset:\s*0;\s*\}\s*\}/);
  });

  it("leaves the march hook out of :root, which holds only design tokens", () => {
    // `--siren-edge-march` passes the march from a speed class to the rules
    // that run it; a value on `:root` never reaches an animated edge, so it
    // is no token a theme could redeclare (ADR-0014: `:root` is the whole
    // styling interface; decision 01M59N4KXRKK7R9Y55K64R4013: `:root` holds
    // only design tokens). Its four numbers are.
    const root = themeRules.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(root).not.toMatch(/--siren-edge-march:/);
    expect(root).toMatch(/--siren-edge-march-dash:\s*9 5;/);
    expect(root).toMatch(/--siren-edge-march-offset:\s*900;/);
    expect(root).toMatch(/--siren-edge-march-fast-duration:\s*20s;/);
    expect(root).toMatch(/--siren-edge-march-slow-duration:\s*50s;/);
  });

  it("reads the march hook with its own none fallback wherever it runs the march", () => {
    // With no `:root` value the hook has a default only where it is read:
    // the march's own rule and the nine that run a timeline effect beside it.
    const reads = themeRules.match(/var\(--siren-edge-march(?![\w-])[^)]*\)/g) ?? [];

    expect(reads).toHaveLength(10);
    for (const read of reads) expect(read).toMatch(/^var\(--siren-edge-march,\s*none\)$/);
  });

  it("stops the march for a reader who asked for reduced motion", () => {
    expect(defaultThemeCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.siren-edge:is\(\.siren-edge-animation-fast, \.siren-edge-animation-slow\)\s*\{\s*--siren-edge-march:\s*none;\s*\}\s*\}/,
    );
  });
});

describe("default theme's animated edge under a timeline", () => {
  it.each([
    ["fast", "siren-exit-fade", "siren-fade-out"],
    ["slow", "siren-exit-slide-left", "siren-slide-out-left"],
    ["fast", "siren-enter-slide-top", "siren-slide-in-top"],
    ["slow", "siren-exit-slide-bottom", "siren-slide-out-bottom"],
  ])("runs a %s edge's timeline effect %s, still marching beside it", (speed, effect, keyframes) => {
    // An `exit e1 fade` must take the edge away: the march is an animation
    // of its own, and an edge carries one `animation` shorthand, so the
    // effect's keyframes and the march are run together rather than the
    // march's rule taking the property from the effect.
    const svg = renderThemedSVG(`flowchart LR\nA e1@--> B\ne1@{ animation: ${speed} }`);
    const path = svg.querySelector('path.siren-edge[data-siren-id="e1"]')!;

    path.classList.add(effect);
    const animation = getComputedStyle(path).animation;
    path.classList.remove(effect);

    expect(animation).toContain(keyframes);
    expect(animation).toContain("siren-edge-march");
  });
});

describe("default theme's highlight over an author's stroke", () => {
  /**
   * Renders `source` under a one-step timeline with the theme attached, as
   * `renderThemedSVG` does (which it calls once to attach it), and hands
   * back the controller too: lifting the author's stroke is the controller's
   * half of the bargain, so the cascade is read after a step.
   */
  function renderThemedWithController(source: string, step: string) {
    renderThemedSVG("flowchart TB\n  A");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const { svg, controller, diagnostics } = render(`${source}\ntimeline:\n${step}`, container);
    expect(diagnostics).toEqual([]);
    if (svg === null || controller === null) throw new Error("render() drew nothing");
    return { svg, controller };
  }

  const KINDS = [
    ["a node", "flowchart TB\n  A --> B\n  style A stroke:#f00 !important", "A", '[data-siren-id="A"] .siren-node-frame'],
    ["an edge", "flowchart TB\n  A --> B\n  linkStyle 0 stroke:#f00 !important", "A-B", 'path.siren-edge[data-siren-id="A-B"]'],
    [
      "a subgraph",
      "flowchart TB\n  subgraph s1 [Box]\n    A\n  end\n  style s1 stroke:#f00 !important",
      "subgraph:1",
      '[data-siren-id="subgraph:1"] .siren-subgraph-frame',
    ],
    ["a class", "classDiagram\n  class Duck\n  style Duck stroke:#f00 !important", "Duck", '[data-siren-id="Duck"] .siren-class-frame'],
    ["a state", "stateDiagram-v2\n  [*] --> Idle\n  style Idle stroke:#f00 !important", "Idle", '[data-siren-id="Idle"] .siren-state-frame'],
    [
      "a composite state",
      "stateDiagram-v2\n  state Outer {\n    Inner\n  }\n  style Outer stroke:#f00 !important",
      "Outer",
      '[data-siren-id="Outer"] .siren-composite-frame',
    ],
    [
      "an ER entity",
      "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  style CUSTOMER stroke:#f00",
      "CUSTOMER",
      '[data-siren-id="CUSTOMER"] .siren-er-entity-frame',
    ],
  ] as const;

  it.each(KINDS.flatMap(([what, source, id, selector]) =>
    (["outline", "glow"] as const).map((effect) => [what, effect, source, id, selector] as const),
  ))("draws %s's border in the highlight color under `%s`, and the author's again after", (_what, effect, source, id, selector) => {
    // The author's `stroke:#f00` (`!important` wherever the kind accepts it)
    // must not hide the highlight: a highlight is Siren's own state, and the
    // whole point of one is that it is seen. `glow` recolors the stroke as
    // `outline` does, at its own width, so the same holds under both.
    const { svg, controller } = renderThemedWithController(source, `highlight ${id} ${effect}`);
    const drawn = svg.querySelector(selector)!;
    expect(getComputedStyle(drawn).stroke).toBe("#f00");

    controller.next();
    expect(getComputedStyle(drawn).stroke).toContain("--siren-highlight-color");

    controller.prev();
    expect(getComputedStyle(drawn).stroke).toBe("#f00");
  });

  it.each(
    (["outline", "glow"] as const).flatMap((effect) =>
      [
        ["theme's", ""],
        ["author's", "\n  linkStyle 0 stroke:#f00 !important"],
      ].map(([whose, style]) => [effect, whose, style] as const),
    ),
  )("draws an edge's head in its line's color under `%s`, from the %s color and back", (effect, _whose, style) => {
    // The head is painted with its line's stroke, whatever the line wears, so
    // it follows the highlight there and back with the line: no rule, lift or
    // timer of its own. jsdom paints nothing, so what it can show is that no
    // declaration on the head outranks that paint at any point in the step;
    // `scripts/edge-arrowhead-colour.mjs` reads the colours Chrome draws.
    const { svg, controller } = renderThemedWithController(
      `flowchart TB\n  A --> B${style}`,
      `highlight A-B ${effect}`,
    );
    const line = svg.querySelector('path.siren-edge[data-siren-id="A-B"]')!;
    const reference = line.getAttribute("marker-end")!;
    const head = svg.querySelector(`defs > marker#${reference.slice("url(#".length, -1)} > path`)!;
    const paints = () => [getComputedStyle(line).stroke, getComputedStyle(head).fill];

    const before = paints();
    expect(before[1]).toBe("context-stroke");

    controller.next();
    expect(paints()).toEqual(["var(--siren-highlight-color)", "context-stroke"]);

    controller.prev();
    expect(paints()).toEqual(before);
  });
});

/**
 * Token reach: a caller recolours one styleable target by redeclaring the
 * colour tokens on the elements wearing its `data-siren-id`, and nothing
 * else moves. Two facts make that true, and jsdom — which does not resolve
 * `var()` — can read both:
 *
 * - every colour the theme gives the target's frame and text is a token
 *   named at that element, never a literal and never a value resolved
 *   higher up, so a redeclaration on the target reaches it;
 * - no element wearing an id sits inside another one wearing an id, so a
 *   redeclaration on a subgraph, a composite or an ER block cannot leak
 *   into the targets drawn within it.
 */
describe("default theme's token reach", () => {
  /** One document per kind that styles, each nesting what it can nest. */
  const STYLEABLE = [
    'flowchart TB\nsubgraph s1 [Outer]\nsubgraph s2 [Inner]\nA -->|go| B((Round))\nend\nC{Choice}\nend\nA --> C\nD([Stadium]) --> s1\n',
    "classDiagram\nnamespace Shop {\nclass Cart {\n+int items\n+add()\n}\nclass Item\n}\nCart --> Item\n",
    "stateDiagram-v2\nstate Outer {\nstate Mid {\nI1 --> I2\nnote right of I1 : on a state\n}\nnote left of Mid : on a composite\n}\n[*] --> Outer\n",
    "erDiagram\nsubgraph s1\nA {\nstring name\n}\nend\nB\nA ||--o{ B : has\n",
  ];

  /** The groups and lone elements a styling statement can reach, by the class each is drawn with. */
  const TARGET = [
    "g.siren-node",
    "g.siren-subgraph",
    "path.siren-edge",
    "text.siren-edge-label",
    "g.siren-class",
    "g.siren-state",
    "g.siren-er-entity",
    "g.siren-er-subgraph",
  ].join(", ");

  const TOKEN = /^var\(--siren-[\w-]+\)$/;

  it.each(STYLEABLE)("paints every styleable target's frame and text through a token at the element: %s", (source) => {
    const svg = renderThemedSVG(source);
    const targets = Array.from(svg.querySelectorAll(TARGET));
    expect(targets.length).toBeGreaterThan(0);

    const untokened: string[] = [];
    for (const target of targets) {
      const id = target.getAttribute("data-siren-id");
      const drawn = [target, ...Array.from(target.querySelectorAll("*"))];
      for (const element of drawn) {
        const style = getComputedStyle(element);
        const classes = (element.getAttribute("class") ?? "").split(/\s+/);
        const paints: Array<"fill" | "stroke"> =
          element.tagName === "text"
            ? ["fill"]
            : classes.includes("siren-edge")
              ? ["stroke"]
              : classes.some((name) => name.endsWith("-frame"))
                ? ["fill", "stroke"]
                : [];
        for (const paint of paints) {
          if (!TOKEN.test(style[paint])) {
            untokened.push(`${id} ${describeElement(element)} ${paint}: ${style[paint]}`);
          }
        }
      }
    }
    expect(untokened).toEqual([]);
  });

  it("leaves out of token reach only a frame unfilled by design, a bare or a hollow one, which paints `none`", () => {
    // Every flowchart shape that needs no data beyond its label: the text
    // block and the composite are two of them, and the parts of a figure a
    // shape draws hollow (a brace, a bucket's rim) wear the same paint.
    // One spelling per shape, as an author writes it.
    const spellingOf = new Map<string, string>();
    for (const [spelling, shape] of NODE_DATA_SHAPES) {
      if (!spellingOf.has(shape)) spellingOf.set(shape, spelling);
    }
    const shapes = [...spellingOf.keys()].filter((shape) => shape !== "icon" && shape !== "image");
    const svg = renderThemedSVG(
      `flowchart TB\n${shapes.map((shape, i) => `N${i}@{ shape: ${spellingOf.get(shape)} }`).join("\n")}\n`,
    );
    const UNFILLED_BY_DESIGN = ["siren-node-bare", "siren-node-hollow"];

    const untokened: string[] = [];
    const exempt = new Set<string>();
    const exemptShapes = new Set<string>();
    for (const node of Array.from(svg.querySelectorAll("g.siren-node"))) {
      const shape = shapes[Number(node.getAttribute("data-siren-id")!.slice(1))]!;
      for (const frame of Array.from(node.querySelectorAll(".siren-node-frame"))) {
        const style = getComputedStyle(frame);
        const paintClass = UNFILLED_BY_DESIGN.find((name) => frame.classList.contains(name));
        for (const paint of ["fill", "stroke"] as const) {
          // A paint the shape writes inline (a browser's dots, kept unstroked
          // whatever the author says) is the renderer's, not the theme's.
          if (TOKEN.test(style[paint]) || (frame as SVGElement).style.getPropertyValue(paint) !== "") continue;
          if (paintClass === undefined) {
            untokened.push(`${shape} ${describeElement(frame)} ${paint}: ${style[paint]}`);
          } else {
            exempt.add(`${paintClass} ${paint}: ${style[paint]}`);
            exemptShapes.add(shape);
          }
        }
      }
    }

    expect(untokened).toEqual([]);
    // A bare frame is neither filled nor stroked; a hollow one is stroked
    // through the token and left unfilled.
    expect([...exempt].sort()).toEqual([
      "siren-node-bare fill: none",
      "siren-node-bare stroke: none",
      "siren-node-hollow fill: none",
    ]);
    expect(exemptShapes).toContain("text");
    expect(exemptShapes).toContain("composite");
  });

  /**
   * What `value` paints `element` with, substituted the way a custom property
   * is: a `var()` is looked up from the element upward and replaced by the
   * value declared on the nearest element that declares it, itself
   * substituted against *that* element. jsdom neither inherits a custom
   * property nor resolves a `var()`, but it does report the ones an element
   * declares, which is all this walk needs.
   */
  function resolvePaint(element: Element, value: string): string {
    const reference = /^var\((--[\w-]+)\)$/.exec(value.trim());
    if (reference === null) return value.trim();
    for (let at: Element | null = element; at !== null; at = at.parentElement) {
      const declared = getComputedStyle(at).getPropertyValue(reference[1]!).trim();
      if (declared !== "") return resolvePaint(at, declared);
    }
    return "";
  }

  /** The selector of every rule in the default theme that declares `property`. */
  function cssRulesDeclaring(property: string): string[] {
    const style = document.createElement("style");
    style.textContent = defaultThemeCss;
    document.head.appendChild(style);
    const selectors: string[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if ("selectorText" in rule && (rule as CSSStyleRule).style.getPropertyValue(property) !== "") {
          selectors.push((rule as CSSStyleRule).selectorText);
        }
        if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    walk(style.sheet!.cssRules);
    style.remove();
    return selectors;
  }

  it.each([
    ["a state", "stateDiagram-v2\nA --> B\nnote right of A : about A\nstyle A fill:#f00,color:#0f0\n", "A"],
    ["a composite state", "stateDiagram-v2\nstate Outer {\nI\n}\nnote right of Outer : about Outer\n", "Outer"],
  ])("keeps %s's note out of a recolour of its state, and in a recolour of the diagram", (_what, source, id) => {
    // A state's note is drawn inside the state's group, since it has no id of
    // its own — so the state's tokens are inherited by its note unless the
    // note's paint is substituted above that group. An author's `style` leaves
    // the note alone (measured, mermaid 11.17.2), and a token redeclared on the
    // state must too; one redeclared on the container reaches it as before.
    const svg = renderThemedSVG(source);
    const state = svg.querySelector(`g.siren-state[data-siren-id="${id}"]`)!;
    const frame = state.querySelector(".siren-note-frame")!;
    const text = state.querySelector(".siren-note-text")!;
    const paints = () => [
      resolvePaint(frame, getComputedStyle(frame).fill),
      resolvePaint(frame, getComputedStyle(frame).stroke),
      resolvePaint(text, getComputedStyle(text).fill),
    ];

    // The default theme's own colours, unchanged.
    expect(paints()).toEqual(["#f3efff", "#6d3fd6", "#1d1730"]);

    const container = svg.parentElement as HTMLElement;
    for (const [token, value] of [["fill", "#000080"], ["stroke", "#008000"], ["text", "#800000"]]) {
      container.style.setProperty(`--siren-node-${token}`, value);
      (state as SVGElement).style.setProperty(`--siren-node-${token}`, "#ff00ff");
    }
    // The redeclaration lands on the state itself…
    expect(resolvePaint(state, "var(--siren-node-fill)")).toBe("#ff00ff");
    // …and stops there: the note takes the container's colours.
    expect(paints()).toEqual(["#000080", "#008000", "#800000"]);
  });

  it("paints a state's note from the diagram when its state is not a child of the <svg>", () => {
    // The capture of the diagram's colours must not hang on where the states
    // sit: a caller (or a later renderer) may wrap them in a group of its own,
    // and a browser without `:has()` must still paint the note — without the
    // capture the note's paint is invalid and it draws black and unstroked.
    const svg = renderThemedSVG("stateDiagram-v2\nA --> B\nnote right of A : about A\n");
    const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "g");
    for (const state of Array.from(svg.querySelectorAll(":scope > .siren-state"))) {
      wrapper.appendChild(state);
    }
    svg.appendChild(wrapper);
    const frame = svg.querySelector('g.siren-state[data-siren-id="A"] .siren-note-frame')!;
    const text = svg.querySelector('g.siren-state[data-siren-id="A"] .siren-note-text')!;

    expect(frame.parentElement?.closest("svg")).toBe(svg);
    expect([
      resolvePaint(frame, getComputedStyle(frame).fill),
      resolvePaint(frame, getComputedStyle(frame).stroke),
      resolvePaint(text, getComputedStyle(text).fill),
    ]).toEqual(["#f3efff", "#6d3fd6", "#1d1730"]);
  });

  it("weighs nothing in the rule that hands a state note the diagram's colours", () => {
    // A caller who recolours notes names the note's parts — `.siren-note-frame`
    // and `.siren-note-text`, one class each — and redeclares `--siren-node-*`
    // there. The theme's redeclaration on the same parts must not outrank
    // that, so it sits wholly inside `:where()`. jsdom cannot show this through
    // the cascade: it lets an earlier sheet's custom property beat a later,
    // more specific one, so the selector is held instead.
    const redeclarations = cssRulesDeclaring("--siren-node-fill").filter((selector) =>
      selector.includes("siren-note-"),
    );
    expect(redeclarations.length).toBeGreaterThan(0);
    for (const selector of redeclarations) expect(selector).toMatch(/^:where\([^()]*\)$/);
  });

  it("captures a state note's colours without :has()", () => {
    // jsdom supports `:has()`, so the previous test cannot take it away; this
    // one holds the rule that captures the diagram's colours to a selector
    // every browser in the support range matches.
    const captures = cssRulesDeclaring("--_siren-state-note-fill");
    expect(captures.length).toBeGreaterThan(0);
    for (const selector of captures) expect(selector).not.toContain(":has(");
  });

  /**
   * The head an edge's path points at by `marker-end`, followed into this
   * same SVG's `<defs>` rather than named: marker ids are minted per render.
   */
  function headOf(svg: SVGSVGElement, edgeId: string): SVGElement {
    const reference = svg.querySelector(`path.siren-edge[data-siren-id="${edgeId}"]`)?.getAttribute("marker-end");
    const head = reference == null ? null : svg.querySelector(`defs > marker#${reference.slice("url(#".length, -1)} > *`);
    if (head === null) throw new Error(`no head for edge ${edgeId}`);
    return head as SVGElement;
  }

  it("paints each edge head with its own edge's stroke, so a token redeclared on the edge reaches it", () => {
    // A head lives in `<defs>` and inherits from there, never from the path
    // that points at it, so a token redeclared on the path stopped at the
    // line. `context-stroke` is the paint SVG gives a marker for exactly this:
    // the stroke of the element it is drawn for. jsdom paints nothing, so the
    // keyword is what it reads; `scripts/edge-arrowhead-colour.mjs` reads the
    // colour Chrome draws with it.
    const svg = renderThemedSVG("flowchart LR\nA --> B\nA --o C\nA --x D\n");
    const arrow = getComputedStyle(headOf(svg, "A-B"));
    const ring = getComputedStyle(headOf(svg, "A-C"));
    const cross = getComputedStyle(headOf(svg, "A-D"));

    // Each shape takes the line's colour where it shows it…
    expect([arrow.fill, ring.stroke, cross.stroke]).toEqual(["context-stroke", "context-stroke", "context-stroke"]);
    // …and the ring is still filled with the surface, so the line does not
    // show through its middle.
    expect(ring.fill).toBe("var(--siren-node-fill)");
    // The line itself is painted through the token at the path, which is
    // where a redeclaration lands.
    expect(getComputedStyle(svg.querySelector('path.siren-edge[data-siren-id="A-B"]')!).stroke).toBe(
      "var(--siren-edge-stroke)",
    );
  });

  it("hands an author-colored edge's head back to the token with its line, once `stroke` is omitted", () => {
    // A host that omits the author's `stroke` recolours an edge by its token:
    // the line drops the inline color, the head is minted from no color, and
    // both are painted from the token at the path.
    renderThemedSVG("flowchart TB\n  A");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const { svg } = render("flowchart TB\n  A --> B\n  linkStyle 0 stroke:#f00\n", container, {
      omitAuthorStyles: ["stroke"],
    });
    const head = headOf(svg as SVGSVGElement, "A-B");
    const line = svg!.querySelector('path.siren-edge[data-siren-id="A-B"]')!;

    expect(line.getAttribute("style")).toBeNull();
    expect(head.getAttribute("style")).toBeNull();
    expect([getComputedStyle(line).stroke, getComputedStyle(head).fill]).toEqual([
      "var(--siren-edge-stroke)",
      "context-stroke",
    ]);
  });

  it.each(STYLEABLE)("draws no element wearing an id inside another one: %s", (source) => {
    const svg = renderThemedSVG(source);
    const nested = Array.from(svg.querySelectorAll("[data-siren-id] [data-siren-id]")).map(
      (element) => `${element.parentElement?.closest("[data-siren-id]")?.getAttribute("data-siren-id")} > ${element.getAttribute("data-siren-id")}`,
    );
    expect(nested).toEqual([]);
  });
});
