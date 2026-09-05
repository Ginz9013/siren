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
    classIds: [],
    name: null,
    properties: [],
    ...overrides,
  } satisfies StyleDecl;
}

describe("resolveStyles", () => {
  describe("resolution rules", () => {
    it("drops a target nothing declares, still applying the statement to the targets that exist", () => {
      const diagnostics: Diagnostic[] = [];

      const styles = resolveStyles(
        [
          styleDecl({
            styleKind: "style",
            classIds: ["Shape", "Ghost"],
            properties: [{ property: "fill", value: "#fdd" }],
            line: 4,
            column: 1,
          }),
        ],
        new Set(["Shape"]),
        diagnostics,
      );

      expect(styles).toEqual([
        { targetId: "Shape", properties: [{ property: "fill", value: "#fdd" }] },
      ]);
      expect(diagnostics).toEqual([
        {
          severity: "error",
          message: 'style "Ghost" references an id that does not exist; dropping the declaration.',
          line: 4,
          column: 1,
        },
      ]);
    });

    it("pairs an apply-directive with a definition written below it", () => {
      const diagnostics: Diagnostic[] = [];

      const styles = resolveStyles(
        [
          styleDecl({
            styleKind: "apply",
            authoredAs: "cssClass",
            classIds: ["Shape"],
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
        { targetId: "Shape", properties: [{ property: "fill", value: "#fdd" }] },
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
            classIds: ["Shape"],
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
      const diagnostics: Diagnostic[] = [];

      resolveStyles(
        [
          styleDecl({
            styleKind: "apply",
            authoredAs: "class",
            classIds: ["Shape"],
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
            classIds: ["Ghost"],
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
        'class "Ghost" references an id that does not exist; dropping the declaration.',
      ]);
    });

    it("keeps a repeated property in its first-declared position and gives it its last value", () => {
      const diagnostics: Diagnostic[] = [];

      const styles = resolveStyles(
        [
          styleDecl({
            styleKind: "style",
            classIds: ["Shape"],
            properties: [
              { property: "fill", value: "#fdd" },
              { property: "stroke", value: "#c00" },
            ],
          }),
          styleDecl({
            styleKind: "style",
            classIds: ["Shape"],
            properties: [{ property: "fill", value: "#00f" }],
          }),
        ],
        new Set(["Shape"]),
        diagnostics,
      );

      expect(styles).toEqual([
        {
          targetId: "Shape",
          properties: [
            { property: "fill", value: "#00f" },
            { property: "stroke", value: "#c00" },
          ],
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
        [styleDecl({ styleKind: "style", classIds: ["Shape"], properties, line: 4, column: 1 })],
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
        { targetId: "Shape", properties: [{ property: "stroke", value: "#c00" }] },
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
        { targetId: "Shape", properties: [{ property: "stroke", value: "#c00" }] },
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
            classIds: ["Shape", "Duck"],
            name: "emphasis",
          }),
        ],
        new Set(["Shape", "Duck"]),
        diagnostics,
      );

      expect(styles).toEqual([
        { targetId: "Shape", properties: [{ property: "stroke", value: "#c00" }] },
        { targetId: "Duck", properties: [{ property: "stroke", value: "#c00" }] },
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
