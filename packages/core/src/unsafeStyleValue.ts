/**
 * The one test of whether an author's CSS value is safe to hand a browser —
 * shared by the two places an author's value reaches an inline `style`: the
 * styling statements (`graph-model/resolveStyles.ts`, the board's security
 * boundary for styling) and a label's `<span style>` and `<font>` values
 * (`label/readLabel.ts`). A module of neither, so that a label does not
 * reach into the graph model and the two cannot drift apart: a change to the
 * rule is a change here.
 *
 * Each caller decides what a refusal costs. The styling statements turn it
 * into an error naming the reason; a label drops the value silently, as a
 * browser drawing Mermaid's label drops a value it cannot use.
 */

/** Why a value is refused. */
export type UnsafeStyleValue =
  | { kind: "function"; name: string; why: string }
  | { kind: "semicolon" }
  | { kind: "backslash" };

/**
 * The CSS functions an author's style value may not use, with why.
 *
 * `url(` fetches: it turns a diagram into a beacon that reports every reader
 * to whoever wrote the document, and in some contexts loads code.
 * `expression(` is legacy IE and executes script outright. Both are matched
 * case-insensitively and with optional space before the paren — the value is
 * refused, not sanitized, so being broader than the CSS grammar costs a
 * refusal of an unusable value and nothing else.
 *
 * A deliberately short list. It is not "every way CSS can fetch" — the
 * board named these two — so a future value-bearing sink (`image-set(`,
 * `-moz-binding`) belongs here, and this is the one place to add it. Note
 * that these patterns match *text*: an author can spell any of them with a
 * CSS escape, which is why `unsafeStyleValue` refuses a value carrying a
 * backslash before it can reach one of these names in disguise.
 */
const REJECTED_VALUE_FUNCTIONS: { pattern: RegExp; name: string; why: string }[] = [
  { pattern: /url\s*\(/i, name: "url(", why: "can fetch a remote resource" },
  { pattern: /expression\s*\(/i, name: "expression(", why: "can execute script" },
];

/**
 * Why `value` may not be emitted into an inline `style`, or `null` when it
 * may.
 */
export function unsafeStyleValue(value: string): UnsafeStyleValue | null {
  for (const { pattern, name, why } of REJECTED_VALUE_FUNCTIONS) {
    if (pattern.test(value)) {
      return { kind: "function", name, why };
    }
  }

  // A value is one declaration's worth of CSS. A `;` inside it can only be
  // an attempt at a second one — the parser splits on the first `:`, so
  // `fill:#fdd;position:fixed` arrives here as a single value. Whether it
  // would actually smuggle depends on how the renderer serializes the
  // attribute; refusing it here means the answer does not matter.
  if (value.includes(";")) {
    return { kind: "semicolon" };
  }

  // A `\` is refused outright, because the list above matches literal text
  // and literal text is not what CSS reads: `\75 rl(...)`, `u\72 l(...)` and
  // `\65 xpression(...)` are `url(` and `expression(` by the time a browser
  // has resolved the escapes, and each one walked straight past the list.
  //
  // The alternative — resolving escapes here and matching the result — means
  // owning a piece of the CSS tokenizer (hex escapes with an optional
  // trailing space, `\0` becoming U+FFFD, escapes inside strings versus
  // idents), and every corner of it got subtly wrong reopens exactly this
  // hole. Refusing is cruder, and it is the option whose failure mode is a
  // refusal rather than a bypass: no value an author styles with — colors,
  // lengths, keywords, `rgb()`, `color-mix()` — contains a backslash, so
  // nothing legitimate is lost by not spending that complexity here.
  if (value.includes("\\")) {
    return { kind: "backslash" };
  }

  return null;
}
