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
 * and a participant, autonumbering, `create`/`destroy`, a dotted message, the
 * cross and open arrowheads, all six framed block kinds plus `rect`, and a
 * title. Kept inline rather than read from `examples/`: what these tests need
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

note for Duck "Ducks are birds"
note "Drawn from the keeper's ledger"

click Duck href "https://example.com/duck" "Ducks are birds"

timeline:
step 1: enter Duck fade
step 2: enter Animal-Duck slide-left
step 3: enter namespace:1 fade, enter note:1 fade
step 4: highlight Duck outline
step 5: highlight Animal-Duck glow
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
 * anything — the checks below cannot see a class nothing renders. A
 * subroutine matters most of the three: it is the first node to draw more
 * than one element, and a second element is where a second class gets
 * invented. It emits none (its bars wear `siren-node-frame` like everything
 * else), and this fixture is what keeps that true rather than merely
 * claimed. Whoever lands the cylinder, the circles and the Markdown label
 * adds them here for the same reason.
 */
const EVERY_FLOWCHART_FEATURE = `flowchart TB
A[Start]
A --> B[Fetch data]
B --> C[Publish]
C --> D(Round)
D --> E([Stadium])
E --> F[[Subroutine]]

timeline:
step 1: enter B fade, enter A-B fade
step 2: highlight B outline
step 3: highlight C glow
`;

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

describe("default theme's design tokens", () => {
  /** The `:root` block's body — where ADR-0004 says every literal belongs. */
  const tokenBlock = /:root\s*\{([\s\S]*?)\}/.exec(themeRules)?.[1] ?? "";

  it("keeps every color literal inside the token declarations", () => {
    expect(tokenBlock).not.toBe("");
    const rules = themeRules.replace(/:root\s*\{[\s\S]*?\}/, "");

    // Per ADR-0004 the tokens are the single source of truth for the diagram's
    // colors; a literal in a rule is a value no consumer can override.
    const literals = rules.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g) ?? [];
    expect(literals).toEqual([]);
  });

  it("declares every token it references", () => {
    const declared = new Set(tokenBlock.match(/--siren-[\w-]+(?=\s*:)/g) ?? []);
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
