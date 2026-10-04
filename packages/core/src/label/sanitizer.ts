/**
 * What the sanitizer takes out of an `html`-dialect label, and what Siren
 * refuses in it: the content DOMPurify removes with its tag, and the
 * error-severity problem for a tag in one of ADR-0015's refused layers.
 * Which tag does which is the vocabulary's (`TagRule.removesContent`,
 * `TagRule.refused`); where in the label it is, and what is open around
 * it, is `readLabel`'s.
 */
import type { LabelProblem } from "./label";
import type { Attributes, RefusedKind, TagRule } from "./vocabulary";

/** Whether a tag in `stack` removes its content as elements, so nothing inside it is drawn. */
export function removed(stack: readonly { rule: TagRule }[]): boolean {
  return stack.some(({ rule }) => rule.removesContent === "elements");
}

/**
 * For a start tag `<name>` ending at `after` in `source`, read by `rule`,
 * whose content DOMPurify removes as raw text or as the rest of the label:
 * where in `source` reading resumes — past the tag's own end tag, as the
 * parser ends raw text, or at the end of `source` when there is none or
 * nothing ends it. `null` for any other tag: its content is read as tags
 * like any other.
 */
export function removedThrough(source: string, name: string, after: number, rule: TagRule): number | null {
  if (rule.removesContent === "rest") {
    return source.length;
  }
  if (rule.removesContent !== "raw text") {
    return null;
  }
  const end = new RegExp(`</${name}(?:[\\s/][^>]*)?>`, "gi");
  end.lastIndex = after;
  return end.exec(source) === null ? source.length : end.lastIndex;
}

/**
 * The error-severity problem a start tag `<name>` at `offset`, read by
 * `rule` with `attributes`, costs the label, or `null` when it costs none: a
 * tag in a refused layer does, and one refused only with an attribute the
 * browser shows it by does when that attribute is there.
 */
export function refusalOf(name: string, offset: number, rule: TagRule, attributes: Attributes): LabelProblem | null {
  const { refused } = rule;
  if (refused === undefined || (refused.withAttribute !== undefined && !attributes.has(refused.withAttribute))) {
    return null;
  }
  return { severity: "error", message: refusal(name, refused.kind), offset };
}

/**
 * How the error-severity problem for a refused tag names its kind — a
 * plural noun, after "does not draw" — and what to write instead, when
 * Mermaid has a way.
 */
const REFUSED_KINDS: Readonly<Record<RefusedKind, { phrase: string; instead?: string }>> = {
  table: { phrase: "tables" },
  ruby: { phrase: "ruby annotations" },
  image: { phrase: "images", instead: 'Draw an image with Mermaid\'s image shape, A@{ img: "…" }, instead.' },
  embedded: { phrase: "embedded content" },
  form: { phrase: "form controls" },
  media: { phrase: "media" },
  interactive: { phrase: "interactive content" },
};

/** The error-severity problem's message for a start tag `<name>` of a refused `kind`. */
function refusal(name: string, kind: RefusedKind): string {
  const { phrase, instead } = REFUSED_KINDS[kind];
  const message = `<${name}> cannot be drawn: Siren draws labels as SVG text, not HTML, and does not draw ${phrase}.`;
  return instead === undefined ? message : `${message} ${instead}`;
}
