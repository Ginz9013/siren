import { describe, expect, it } from "vitest";
import type { Diagnostic, StyleDecl } from "../contracts";
import { resolveStyles } from "./resolveStyles";

/**
 * A styling statement with the fields a test does not care about defaulted.
 *
 * `authoredAs` defaults to the kind, which is right for `style` and
 * `classDef`: every diagram kind spells those two the way they mean them.
 * `apply` is no author's word for anything, so the signature makes a test
 * about the apply-directive state the spelling it is about.
 */
function styleDecl(
  overrides: Partial<StyleDecl> &
    ({ styleKind: "style" | "classDef" } | { styleKind: "apply"; authoredAs: string }),
) {
  return {
    authoredAs: overrides.styleKind,
    targetIds: [],
    name: null,
    properties: [],
    ...overrides,
  } satisfies StyleDecl;
}

describe("resolveStyles", () => {
  /**
   * Characterization, written before the "unknown target" rule changed and
   * expected to pass unchanged after it.
   *
   * This module is shared by the flowchart, the class diagram and the state
   * diagram, and the only trace of which kind is asking is `authoredAs` —
   * the keyword the author actually typed. So "a target that *does* exist
   * is styled" is pinned once per spelling: a change aimed at the unknown
   * target must leave all three of these alone, and if it does not, the
   * failure names the kind that broke rather than a shared helper.
   *
   * Measured at the render seam too, before touching anything: `class A
   * urgent` over a flowchart, `cssClass "Animal" urgent` over a class
   * diagram and `class B urgent` over a state diagram each paint
   * `fill:#f96` onto that one element's rect, leave the other element's
   * `style` empty, and report no diagnostic.
   */
  describe("a target that exists (characterization)", () => {
    it.each([
      ["class", "flowchart"],
      ["cssClass", "classDiagram"],
      ["class", "stateDiagram"],
    ])("applies a definition through `%s`, as %s spells it, reporting nothing", (authoredAs) => {
      const diagnostics: Diagnostic[] = [];

      const styles = resolveStyles(
        [
          styleDecl({
            styleKind: "classDef",
            name: "urgent",
            properties: [{ property: "fill", value: "#f96" }],
          }),
          styleDecl({ styleKind: "apply", authoredAs, targetIds: ["Busy"], name: "urgent" }),
        ],
        new Set(["Idle", "Busy"]),
        diagnostics,
      );

      expect(styles).toEqual([
        { targetId: "Busy", style: { frame: [{ property: "fill", value: "#f96" }], text: [] } },
      ]);
      expect(diagnostics).toEqual([]);
    });

    it("styles every target of a list when every one of them exists", () => {
      const diagnostics: Diagnostic[] = [];

      const styles = resolveStyles(
        [
          styleDecl({
            styleKind: "classDef",
            name: "urgent",
            properties: [{ property: "fill", value: "#f96" }],
          }),
          styleDecl({
            styleKind: "apply",
            authoredAs: "class",
            targetIds: ["Idle", "Busy"],
            name: "urgent",
          }),
        ],
        new Set(["Idle", "Busy"]),
        diagnostics,
      );

      expect(styles).toEqual([
        { targetId: "Idle", style: { frame: [{ property: "fill", value: "#f96" }], text: [] } },
        { targetId: "Busy", style: { frame: [{ property: "fill", value: "#f96" }], text: [] } },
      ]);
      expect(diagnostics).toEqual([]);
    });
  });

  describe("resolution rules", () => {
    it("drops a target nothing declares, still applying the statement to the targets that exist", () => {
      const diagnostics: Diagnostic[] = [];

      const styles = resolveStyles(
        [
          styleDecl({
            styleKind: "style",
            targetIds: ["Shape", "Ghost"],
            properties: [{ property: "fill", value: "#fdd" }],
            line: 4,
            column: 1,
          }),
        ],
        new Set(["Shape"]),
        diagnostics,
      );

      expect(styles).toEqual([
        { targetId: "Shape", style: { frame: [{ property: "fill", value: "#fdd" }], text: [] } },
      ]);
      // Silently: Mermaid accepts the same statement and says nothing, so a
      // diagnostic here is one this repo invented. Measured across all three
      // kinds that share this module (mermaid 11.17.2, `scripts/mermaid-probe.mjs`):
      // `class A,Ghost urgent` in a flowchart reports `A` with
      // `classes=["urgent"]` and no vertex named `Ghost`; `cssClass "Ghost"`
      // in a class diagram adds no class; `class Ghost urgent` in a state
      // diagram does declare `Ghost` — a state-diagram construct gap filed
      // separately, and not a reason for this module to speak.
      expect(diagnostics).toEqual([]);
    });

    it("drops an apply-directive whose only target does not exist, silently and entirely", () => {
      const diagnostics: Diagnostic[] = [];

      const styles = resolveStyles(
        [
          styleDecl({
            styleKind: "classDef",
            name: "urgent",
            properties: [{ property: "fill", value: "#f96" }],
          }),
          styleDecl({
            styleKind: "apply",
            authoredAs: "class",
            targetIds: ["Ghost"],
            name: "urgent",
            line: 4,
            column: 3,
          }),
        ],
        new Set(["Idle", "Busy"]),
        diagnostics,
      );

      // Not "present and empty", and not present carrying the declarations
      // either: an id nothing declares must leave no entry at all, or a
      // renderer is handed a style for an element it will never draw.
      expect(styles).toEqual([]);
      expect(diagnostics).toEqual([]);
    });

    it("lets a nonexistent target drop itself without stopping the targets written after it", () => {
      // The order that tells "drop this target" apart from "stop reading
      // this statement". With the unknown name written last, both rules
      // draw the same picture; written first, only one of them still
      // styles `Shape`. Mermaid measured both orders (11.17.2): `class
      // A,Ghost emphasis` and `class Ghost,A emphasis` each report `A`
      // with `classes=["emphasis"]`.
      const diagnostics: Diagnostic[] = [];

      const styles = resolveStyles(
        [
          styleDecl({
            styleKind: "style",
            targetIds: ["Ghost", "Shape"],
            properties: [{ property: "fill", value: "#fdd" }],
            line: 4,
            column: 1,
          }),
        ],
        new Set(["Shape"]),
        diagnostics,
      );

      expect(styles).toEqual([
        { targetId: "Shape", style: { frame: [{ property: "fill", value: "#fdd" }], text: [] } },
      ]);
      expect(diagnostics).toEqual([]);
    });

    it("pairs an apply-directive with a definition written below it", () => {
      const diagnostics: Diagnostic[] = [];

      const styles = resolveStyles(
        [
          styleDecl({
            styleKind: "apply",
            authoredAs: "cssClass",
            targetIds: ["Shape"],
            name: "emphasis",
          }),
          styleDecl({
            styleKind: "classDef",
            name: "emphasis",
            properties: [{ property: "fill", value: "#fdd" }],
          }),
        ],
        new Set(["Shape"]),
        diagnostics,
      );

      expect(styles).toEqual([
        { targetId: "Shape", style: { frame: [{ property: "fill", value: "#fdd" }], text: [] } },
      ]);
      expect(diagnostics).toEqual([]);
    });

    it("errors when an apply-directive names a definition nothing defines, styling the target with nothing", () => {
      const diagnostics: Diagnostic[] = [];

      const styles = resolveStyles(
        [
          styleDecl({
            styleKind: "classDef",
            name: "emphasis",
            properties: [{ property: "fill", value: "#fdd" }],
          }),
          styleDecl({
            styleKind: "apply",
            authoredAs: "cssClass",
            targetIds: ["Shape"],
            name: "emphsis",
            line: 6,
            column: 1,
          }),
        ],
        new Set(["Shape"]),
        diagnostics,
      );

      expect(styles).toEqual([]);
      expect(diagnostics).toEqual([
        {
          severity: "error",
          message:
            'cssClass applies "emphsis", which no classDef defines; dropping the declaration.',
          line: 6,
          column: 1,
        },
      ]);
    });

    it("names the keyword the author wrote, not the canonical kind it parsed to", () => {
      // A flowchart spells the apply-directive `class` where a class diagram
      // spells it `cssClass`. Both parse to one kind, so the kind cannot be
      // what a diagnostic quotes: an author who wrote `class` and is told
      // about `cssClass` is being pointed at a line they did not write.
      //
      // The undefined *name* is the one remaining diagnostic this module
      // raises against an apply-directive, so it is also the only one left
      // that can get the spelling wrong. The unknown *target* used to be a
      // second; it is now silent, and a statement naming both an undefined
      // name and a nonexistent target must still report exactly the first.
      const diagnostics: Diagnostic[] = [];

      resolveStyles(
        [
          styleDecl({
            styleKind: "apply",
            authoredAs: "class",
            targetIds: ["Shape"],
            name: "nope",
            line: 3,
            column: 1,
          }),
          styleDecl({
            styleKind: "classDef",
            name: "emphasis",
            properties: [{ property: "fill", value: "#fdd" }],
          }),
          styleDecl({
            styleKind: "apply",
            authoredAs: "class",
            targetIds: ["Ghost"],
            name: "emphasis",
            line: 5,
            column: 1,
          }),
        ],
        new Set(["Shape"]),
        diagnostics,
      );

      expect(diagnostics.map((d) => d.message)).toEqual([
        'class applies "nope", which no classDef defines; dropping the declaration.',
      ]);
    });

    it("keeps a repeated property in its first-declared position and gives it its last value", () => {
      const diagnostics: Diagnostic[] = [];

      const styles = resolveStyles(
        [
          styleDecl({
            styleKind: "style",
            targetIds: ["Shape"],
            properties: [
              { property: "fill", value: "#fdd" },
              { property: "stroke", value: "#c00" },
            ],
          }),
          styleDecl({
            styleKind: "style",
            targetIds: ["Shape"],
            properties: [{ property: "fill", value: "#00f" }],
          }),
        ],
        new Set(["Shape"]),
        diagnostics,
      );

      expect(styles).toEqual([
        {
          targetId: "Shape",
          style: {
            frame: [
              { property: "fill", value: "#00f" },
              { property: "stroke", value: "#c00" },
            ],
            text: [],
          },
        },
      ]);
      expect(diagnostics).toEqual([]);
    });
  });

  /**
   * ADR-0008's amendment, and the reason `ResolvedStyle` has two halves
   * rather than one list: an author's `color` is about the label text and
   * every other declaration is about the drawn shape behind it.
   */
  describe("routing a declaration to the frame or to the label text", () => {
    it("splits one statement, translating the author's `color` into the `fill` that paints SVG text", () => {
      const diagnostics: Diagnostic[] = [];

      const styles = resolveStyles(
        [
          styleDecl({
            styleKind: "style",
            targetIds: ["Shape"],
            properties: [
              { property: "fill", value: "#111" },
              { property: "color", value: "#fff" },
            ],
            line: 4,
            column: 1,
          }),
        ],
        new Set(["Shape"]),
        diagnostics,
      );

      // `color` is what a Mermaid author writes and `fill` is what paints a
      // `<text>`; an inline `color` on one would sit in a different property
      // and never reach it. So the spelling is normalized here, once, exactly
      // as `TD` becomes `TB` and a `linkStyle` index becomes an edge id —
      // and nothing downstream of this module ever sees the word `color`.
      expect(styles).toEqual([
        {
          targetId: "Shape",
          style: {
            frame: [{ property: "fill", value: "#111" }],
            text: [{ property: "fill", value: "#fff" }],
          },
        },
      ]);
      expect(diagnostics).toEqual([]);
    });
  });
  /**
   * ADR-0008's security boundary. Whatever survives here becomes an inline
   * `style` attribute on a rendered element, and the renderer re-checks
   * nothing — so a declaration accepted here is one the browser will act on.
   */
  describe("the validation gate", () => {
    /** A `style Shape <properties>` statement over a target that exists. */
    function resolveStyleStatement(properties: { property: string; value: string }[]) {
      const diagnostics: Diagnostic[] = [];
      const styles = resolveStyles(
        [styleDecl({ styleKind: "style", targetIds: ["Shape"], properties, line: 4, column: 1 })],
        new Set(["Shape"]),
        diagnostics,
      );
      return { styles, diagnostics };
    }

    it("drops a property that is not a plain CSS identifier", () => {
      const { styles, diagnostics } = resolveStyleStatement([
        { property: "a;b", value: "red" },
        { property: "stroke", value: "#c00" },
      ]);

      expect(styles).toEqual([
        { targetId: "Shape", style: { frame: [{ property: "stroke", value: "#c00" }], text: [] } },
      ]);
      expect(diagnostics).toEqual([
        {
          severity: "error",
          message: 'Style property "a;b" is not a plain CSS identifier; dropping the declaration.',
          line: 4,
          column: 1,
        },
      ]);
    });

    it("drops a url( value, leaving the other declarations of the same statement", () => {
      const { styles, diagnostics } = resolveStyleStatement([
        { property: "fill", value: "url(#evil)" },
        { property: "stroke", value: "#c00" },
      ]);

      expect(styles).toEqual([
        { targetId: "Shape", style: { frame: [{ property: "stroke", value: "#c00" }], text: [] } },
      ]);
      expect(diagnostics).toEqual([
        {
          severity: "error",
          message:
            'Style value for "fill" uses "url(", which can fetch a remote resource; ' +
            "dropping the declaration.",
          line: 4,
          column: 1,
        },
      ]);
    });

    it("puts a `color` through the gate on the way to the text half, quoting the word the author wrote", () => {
      // Routing a declaration elsewhere must not route it around the gate:
      // the text half becomes an inline `style` attribute on a `<text>`
      // exactly as the frame half becomes one on a `<rect>`, so the same
      // values are the same danger. The message names `color`, not the
      // `fill` it would have been translated into — the author has to find
      // the line they wrote.
      const { styles, diagnostics } = resolveStyleStatement([
        { property: "color", value: "url(#evil)" },
        { property: "fill", value: "#111" },
      ]);

      expect(styles).toEqual([
        { targetId: "Shape", style: { frame: [{ property: "fill", value: "#111" }], text: [] } },
      ]);
      expect(diagnostics).toEqual([
        {
          severity: "error",
          message:
            'Style value for "color" uses "url(", which can fetch a remote resource; ' +
            "dropping the declaration.",
          line: 4,
          column: 1,
        },
      ]);
    });

        it("drops an expression( value", () => {
      const { styles, diagnostics } = resolveStyleStatement([
        { property: "width", value: "expression(alert(1))" },
      ]);

      expect(styles).toEqual([]);
      expect(diagnostics).toEqual([
        {
          severity: "error",
          message:
            'Style value for "width" uses "expression(", which can execute script; ' +
            "dropping the declaration.",
          line: 4,
          column: 1,
        },
      ]);
    });

    it("drops a value carrying a `;`, which would smuggle in a second declaration", () => {
      const { styles, diagnostics } = resolveStyleStatement([
        { property: "fill", value: "#fdd;position:fixed" },
      ]);

      expect(styles).toEqual([]);
      expect(diagnostics).toEqual([
        {
          severity: "error",
          message:
            'Style value for "fill" contains ";", which would smuggle in a second declaration; ' +
            "dropping the declaration.",
          line: 4,
          column: 1,
        },
      ]);
    });

    it("drops a value carrying a backslash, which can spell a rejected function as a CSS escape", () => {
      const { styles, diagnostics } = resolveStyleStatement([
        { property: "fill", value: "\\75 rl(#evil)" },
      ]);

      expect(styles).toEqual([]);
      expect(diagnostics).toEqual([
        {
          severity: "error",
          message:
            'Style value for "fill" contains "\\", which can spell a rejected function as a ' +
            "CSS escape; dropping the declaration.",
          line: 4,
          column: 1,
        },
      ]);
    });

    it("reports a rejected classDef declaration once, at the classDef, not once per target applying it", () => {
      const diagnostics: Diagnostic[] = [];

      const styles = resolveStyles(
        [
          styleDecl({
            styleKind: "classDef",
            name: "emphasis",
            properties: [
              { property: "fill", value: "url(#evil)" },
              { property: "stroke", value: "#c00" },
            ],
            line: 2,
            column: 1,
          }),
          styleDecl({
            styleKind: "apply",
            authoredAs: "cssClass",
            targetIds: ["Shape", "Duck"],
            name: "emphasis",
          }),
        ],
        new Set(["Shape", "Duck"]),
        diagnostics,
      );

      expect(styles).toEqual([
        { targetId: "Shape", style: { frame: [{ property: "stroke", value: "#c00" }], text: [] } },
        { targetId: "Duck", style: { frame: [{ property: "stroke", value: "#c00" }], text: [] } },
      ]);
      expect(diagnostics).toEqual([
        {
          severity: "error",
          message:
            'Style value for "fill" uses "url(", which can fetch a remote resource; ' +
            "dropping the declaration.",
          line: 2,
          column: 1,
        },
      ]);
    });
  });
});
