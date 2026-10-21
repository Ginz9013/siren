/**
 * Test support for the theme stylesheets: read one off disk, parse it once
 * through jsdom's CSSOM, and answer the structural questions the theme tests
 * ask of it. Test support only — never imported by `src/index.ts`, and kept
 * out of the published declarations by `tsconfig.build.json`'s exclude.
 */
import { readFileSync } from "node:fs";

/**
 * A file beside the test, read off disk.
 *
 * `importMetaUrl` must be a binding of `import.meta.url` (see
 * `src/index.test.ts`'s `TEST_FILE_URL`): Vite rewrites the *literal*
 * `new URL("…", import.meta.url)` form into a dev-server asset URL
 * (`http://localhost:3000/@fs/…`), which `readFileSync` rejects with "The URL
 * must be of scheme file". Passed through a binding it stays the real `file:`
 * URL.
 *
 * Off disk rather than through Vite's `?raw` import, which cannot read CSS
 * here: vitest's `vitest:css-disable` plugin rewrites any module id matching
 * `\.css($|\?)` to an empty string while `test.css` is false (this package's
 * default), `?raw` included — and a stylesheet that is silently empty makes a
 * check against it vacuous rather than failing (the note this replaces sat at
 * the top of `default.test.ts`).
 */
export function readBeside(importMetaUrl: string, relativePath: string): string {
  return readFileSync(new URL(relativePath, importMetaUrl), "utf8");
}

export interface Declaration {
  property: string;
  value: string;
  important: boolean;
}

export interface StyleRule {
  /** `selectorText` as the CSSOM reports it. */
  selector: string;
  declarations: readonly Declaration[];
  /** `style.cssText`: `prop: value; prop: value !important;` — what a body assertion matches against. */
  cssText: string;
  /** True when the rule sits inside an at-rule (`@media`, …). */
  nested: boolean;
}

export interface StylesheetOptions {
  /** `--siren-` for core, `--siren-board-` for board. */
  tokenPrefix: string;
  /** `:root` for core, `:where(:root)` for board: the one selector a token block may use (ADR-0014 / 01M3VYFBX). */
  rootSelector: string;
}

export interface Stylesheet {
  /** The text as read — for `<style>` injection and the few assertions on raw text (`@keyframes`, "no `data-theme`"). */
  text: string;
  /** Every style rule, in sheet order, at-rules walked; `@keyframes` blocks are not style rules. */
  rules: readonly StyleRule[];
  /** The one rule whose selector is exactly `selector`; `undefined` when none (throws when more than one). */
  rule(selector: string): StyleRule | undefined;
  /** Selectors of every rule declaring `property` (the old `cssRulesDeclaring`). */
  rulesDeclaring(property: string): string[];
  /**
   * Whether some selector names `.name` as a whole class token (`.siren-box` is not covered by `.siren-box-background`).
   *
   * The whole-token rule is `default.test.ts`'s ("The class must appear as a
   * whole selector token, so `.siren-box` is not considered covered by a
   * `.siren-box-background` rule"), applied there to the comment-stripped
   * text and here to selectors alone, so a class named only in a comment
   * never counts.
   */
  selectsClass(name: string): boolean;
  /** Rules whose every comma-separated selector part is `rootSelector` — where tokens may be declared. */
  tokenBlocks(): readonly StyleRule[];
  /** Every `${tokenPrefix}*` custom property declared anywhere in the sheet. */
  declaredTokens(): Set<string>;
  /** Every `${tokenPrefix}*` custom property declared in `tokenBlocks()`. */
  rootTokens(): Set<string>;
  /** Every `${tokenPrefix}*` name read through `var(` anywhere in a declaration value. */
  referencedTokens(): Set<string>;
  /** Every `var(--name[, fallback])` read of exactly `name` (not a longer name), as written. */
  readsOf(name: string): string[];
  /**
   * Colour literals (`#hex`, `rgb(a)(`, `hsl(a)(`) in declaration values of rules that are not token blocks.
   *
   * Narrower than the regex readers this replaces, which scanned all the text
   * left after cutting the token blocks out — selectors included, so an id
   * selector such as `#cafe` counted. This scans declaration values only.
   */
  literalsOutsideTokenBlocks(): string[];
}

/**
 * `text` parsed once through jsdom's CSSOM — the walk `default.test.ts`'s
 * `cssRulesDeclaring` already proved — so comments and `@media` nesting are
 * the parser's business, not a regex's.
 */
export function readStylesheet(text: string, options: StylesheetOptions): Stylesheet {
  const rules = parseRules(text);
  // A token block — where ADR-0004 says every literal belongs — selects the
  // root and nothing else. Splitting on every comma also splits inside
  // `:is(…)`, but such a part can never equal `rootSelector`, so a rule with
  // one is (correctly) not a token block.
  const tokenBlocks = rules.filter((rule) =>
    rule.selector.split(",").every((part) => part.trim() === options.rootSelector),
  );
  const tokensDeclaredIn = (from: readonly StyleRule[]) =>
    new Set(
      from.flatMap((rule) =>
        rule.declarations
          .map((declaration) => declaration.property)
          .filter((property) => property.startsWith(options.tokenPrefix)),
      ),
    );
  const values = rules.flatMap((rule) => rule.declarations.map((declaration) => declaration.value));
  return {
    text,
    rules,
    rule(selector) {
      const exact = rules.filter((rule) => rule.selector === selector);
      if (exact.length > 1) {
        throw new Error(`readStylesheet: ${exact.length} rules select exactly "${selector}"; rule() answers for one`);
      }
      return exact[0];
    },
    rulesDeclaring(property) {
      return rules
        .filter((rule) => rule.declarations.some((declaration) => declaration.property === property))
        .map((rule) => rule.selector);
    },
    selectsClass(name) {
      const token = new RegExp(`\\.${escapeRegExp(name)}(?![\\w-])`);
      return rules.some((rule) => token.test(rule.selector));
    },
    tokenBlocks: () => tokenBlocks,
    declaredTokens: () => tokensDeclaredIn(rules),
    rootTokens: () => tokensDeclaredIn(tokenBlocks),
    referencedTokens() {
      const read = /var\(\s*(--[\w-]+)/g;
      return new Set(
        values
          .flatMap((value) => Array.from(value.matchAll(read), (match) => match[1]))
          .filter((name) => name.startsWith(options.tokenPrefix)),
      );
    },
    readsOf(name) {
      const start = new RegExp(`var\\(\\s*${escapeRegExp(name)}(?![\\w-])`, "g");
      return values.flatMap((value) =>
        Array.from(value.matchAll(start), (match) => value.slice(match.index, closingParen(value, match.index) + 1)),
      );
    },
    literalsOutsideTokenBlocks() {
      // Per ADR-0004 the tokens are the single source of truth for colour; a
      // literal in any other rule is a value no consumer can override.
      const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g;
      return rules
        .filter((rule) => !tokenBlocks.includes(rule))
        .flatMap((rule) => rule.declarations.flatMap((declaration) => declaration.value.match(literal) ?? []));
    },
  };
}

/**
 * Every style rule in `text`, in sheet order. The `<style>` is attached only
 * long enough for jsdom to parse it, and removed before anything else runs,
 * so it never styles a document a test renders into.
 */
function parseRules(text: string): StyleRule[] {
  const style = document.createElement("style");
  style.textContent = text;
  document.head.appendChild(style);
  const sheet = style.sheet;
  style.remove();
  if (sheet === null) throw new Error("readStylesheet: the injected <style> has no sheet; jsdom did not parse it");

  const rules: StyleRule[] = [];
  const walk = (list: CSSRuleList, nested: boolean) => {
    for (const rule of Array.from(list)) {
      // Told apart by shape, not `instanceof`: vitest's jsdom environment
      // does not expose `CSSStyleRule` or `CSSKeyframesRule` as globals.
      if ("selectorText" in rule) {
        const style = (rule as CSSStyleRule).style;
        rules.push({
          selector: (rule as CSSStyleRule).selectorText,
          declarations: declarationsOf(style),
          cssText: style.cssText,
          nested,
        });
      } else if ("cssRules" in rule) {
        // `@media`, `@supports`, … — and `@keyframes`, whose children are
        // keyframes (`to`, `50%`) with a `keyText` and no `selectorText`, so
        // the branch above never takes them for style rules.
        walk((rule as CSSGroupingRule).cssRules, true);
      }
    }
  };
  walk(sheet.cssRules, false);
  return rules;
}

function declarationsOf(style: CSSStyleDeclaration): Declaration[] {
  const declarations: Declaration[] = [];
  for (let i = 0; i < style.length; i++) {
    const property = style[i];
    declarations.push({
      property,
      value: style.getPropertyValue(property).trim(),
      important: style.getPropertyPriority(property) === "important",
    });
  }
  return declarations;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The index of the `)` closing the `(` first found at or after `from`, so a
 * read whose fallback itself holds a `var(…)` is taken whole.
 */
function closingParen(text: string, from: number): number {
  let depth = 0;
  for (let i = text.indexOf("(", from); i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  throw new Error(`readStylesheet: unbalanced parentheses in "${text}"`);
}
