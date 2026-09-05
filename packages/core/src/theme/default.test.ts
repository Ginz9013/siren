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
    const shapeOf = (markerId: string): SVGElement => {
      const shape = svg.querySelector(`#${markerId} path`);
      if (shape === null) {
        throw new Error(`no endpoint shape in <marker id="${markerId}">`);
      }
      return shape as SVGElement;
    };
    const filledDiamond = shapeOf("siren-class-diamond-filled");
    const hollowDiamond = shapeOf("siren-class-diamond-hollow");
    const triangle = shapeOf("siren-class-triangle");
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
    const cases: [string, string][] = [
      [".siren-class", ".siren-class-frame"],
      [".siren-relationship", ".siren-relationship-line"],
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
