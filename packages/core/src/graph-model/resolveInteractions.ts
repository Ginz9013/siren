import type { Diagnostic, Interaction, ResolvedInteraction } from "../contracts";

/**
 * The URL schemes a `click X href "..."` may navigate to. An allowlist, not
 * a blocklist: `javascript:`, `data:` and `vbscript:` are the famous
 * script-bearing schemes, but they are not the only ones a browser or an
 * OS handler will act on, and a list of the ones we happen to know about
 * would silently admit the next one.
 */
const ALLOWED_URL_SCHEMES = new Set<string>(["http:", "https:", "mailto:"]);

/** The allowlist as a diagnostic reads it. */
const ALLOWED_SCHEMES_PHRASE = "only http:, https: and mailto: are allowed";

/**
 * A URL's scheme grammar, per RFC 3986: a letter, then letters, digits and
 * `+`, `-`, `.`.
 */
const URL_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*$/;

/**
 * A URL that names no scheme of its own and adopts the page's: `//host`, and
 * the `/\`, `\/`, `\\` spellings a browser reads the same way.
 */
const URL_SCHEME_RELATIVE_RE = /^[/\\][/\\]/;

/**
 * The characters removed from a URL before it is judged: every ASCII control
 * character, plus space and DEL. Built via a `RegExp` constructor with hex
 * escapes rather than a literal character class, so this file's own bytes
 * hold no control characters.
 */
const URL_STRIPPED_RE = new RegExp("[\\x00-\\x20\\x7f]", "g");

/**
 * Decides whether an author-written `href` may be emitted, returning `null`
 * when it may and the clause a diagnostic should carry when it may not.
 *
 * **This is the board's security boundary for URLs.** The parser records
 * whatever the author typed and judges none of it, and the renderer puts
 * the survivors into a live `href`, so a URL this function admits is a URL
 * a reader can be made to navigate to.
 *
 * The rules, in the order they apply:
 *
 * - Whitespace and control characters are removed from the whole URL, once,
 *   *before* any of the rules below read it. A browser does the same, so a
 *   `javascript:` URL with a tab, a newline or a NUL wedged into the word —
 *   or leading spaces in front of it — navigates exactly like the plain
 *   spelling. Matching on the raw text is the classic way an allowlist is
 *   walked past, and matching *some* rules on the stripped text and others
 *   on the raw text is the same hole with extra steps: a control character
 *   wedged into a scheme would walk past a version that stripped only for
 *   the scheme rule.
 * - A URL beginning `//` — or the `\\` a browser reads as `//` — is
 *   rejected. It carries no scheme of its own, adopting instead whatever
 *   the page was served over, so it is an off-site navigation wearing the
 *   costume of a path.
 * - A URL with a scheme must have one from `ALLOWED_URL_SCHEMES`.
 * - Anything else has no scheme at all — `./docs/shape.html`, `#shape` —
 *   and resolves against the document. The allowlist rejects dangerous
 *   schemes; it does not demand absolute URLs.
 */
function rejectUrl(url: string): string | null {
  const stripped = url.replace(URL_STRIPPED_RE, "");

  if (URL_SCHEME_RELATIVE_RE.test(stripped)) {
    return `uses a scheme-relative URL ("${url}"), which adopts the page's scheme`;
  }

  const colon = stripped.indexOf(":");
  if (colon === -1) {
    return null;
  }

  const candidate = stripped.slice(0, colon);
  if (!URL_SCHEME_RE.test(candidate)) {
    // Not a scheme at all: the `:` belongs to a path or a fragment, as in
    // `./a:b`. A relative URL, and allowed.
    return null;
  }

  const scheme = `${candidate.toLowerCase()}:`;
  if (ALLOWED_URL_SCHEMES.has(scheme)) {
    return null;
  }
  return `uses the disallowed URL scheme "${scheme}"`;
}

/**
 * Resolves a document's `click`/`link`/`callback` statements into the
 * model's interactions.
 *
 * Written once and shared by every diagram kind that accepts interactions,
 * for the same reason `resolveStyles` is: its inputs are kind-agnostic.
 * Nothing here looks at a class or a node — it takes what the author
 * declared plus the set of ids that actually exist, and reports problems
 * into a diagnostics list, the same shape `resolveStyles` already has.
 * CONTEXT.md's "Compatibility corpus" entry records what duplicates made
 * for this same reason cost: Board 2 spent four tickets deleting copies of
 * `resolveTimeline`, which is the lesson behind sharing this resolver from
 * the day a second diagram kind needs one rather than after.
 *
 * Naming a target here does not declare it, exactly as naming one in a
 * `note for` does not: an interaction is about something that already
 * exists, so an unknown target is a typo. The interaction is dropped on its
 * own and the rest of the model still resolves.
 */
export function resolveInteractions(
  interactions: readonly Interaction[],
  validTargetIds: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): ResolvedInteraction[] {
  const resolved: ResolvedInteraction[] = [];

  for (const interaction of interactions) {
    if (!validTargetIds.has(interaction.targetId)) {
      diagnostics.push({
        severity: "error",
        message: `click "${interaction.targetId}" references a target that does not exist; dropping the interaction.`,
        line: interaction.line,
        column: interaction.column,
      });
      continue;
    }

    if (interaction.interactionKind === "href") {
      const rejection = rejectUrl(interaction.action);
      if (rejection !== null) {
        diagnostics.push({
          severity: "error",
          message: `click "${interaction.targetId}" ${rejection}; ${ALLOWED_SCHEMES_PHRASE}; dropping the interaction.`,
          line: interaction.line,
          column: interaction.column,
        });
        continue;
      }
    }

    resolved.push({
      targetId: interaction.targetId,
      interactionKind: interaction.interactionKind,
      action: interaction.action,
      argument: interaction.argument,
      tooltip: interaction.tooltip,
    });
  }

  return resolved;
}
