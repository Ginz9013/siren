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
