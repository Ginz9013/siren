import type { ResolvedInteraction } from "../contracts";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Applies a target's resolved interaction, returning whatever should be
 * appended to the diagram in the group's place: an `href` interaction
 * returns an `<a class="siren-link">` wrapping the group, anything else
 * returns the group itself.
 *
 * The group is wrapped rather than turned into a link so that
 * `data-siren-id`, the animation classes and the theme's rules for the
 * target's own class all keep landing on the same element whether or not
 * the author made it clickable.
 *
 * The URL is written verbatim: `resolveInteractions` has already checked it
 * against the `http`/`https`/`mailto` allowlist and dropped anything else
 * with an error diagnostic, so a `javascript:` URL never reaches this
 * function.
 *
 * **A `linkTarget` becomes a static `target` attribute, always paired with
 * `rel="noopener noreferrer"`.** Mermaid's own rendered SVG never puts a
 * `target` attribute on the `<a>` it draws, for any of the four values
 * (measured, `scripts/mermaid-probe.mjs`) — its `_blank`-etc. semantics live
 * in a JS bind-time layer (`mermaid.bindFunctions`) that a static SVG string
 * never carries. Siren's `<a href>` here has no such layer: it is a real,
 * self-contained anchor, so the only way to actually deliver "opens in a new
 * tab" is the attribute itself. That makes `rel="noopener noreferrer"` not
 * optional once a target is present: an author-controlled URL opening in a
 * new tab without it is a known reverse-tabnabbing vector, and this
 * pipeline's own URL gate (`resolveInteractions`) already treats that URL as
 * untrusted input checked against an allowlist — this is the same posture
 * applied to the tab it opens in.
 *
 * Only a flowchart's `click X href "url" ["tip"] [target]` ever sets
 * `linkTarget` (`CLICK_HREF_RE` in `parseFlowchart.ts`) — a class diagram's
 * and a sequence diagram's own `href`-kind spellings never reach this
 * branch with it present, since Mermaid has no target concept there.
 */
export function wrapInteraction(
  group: SVGGElement,
  interaction: ResolvedInteraction | null,
): SVGElement {
  if (interaction === null) {
    return group;
  }

  if (interaction.interactionKind === "href") {
    const link = document.createElementNS(SVG_NS, "a");
    link.setAttribute("class", "siren-link");
    link.setAttribute("href", interaction.action);
    if (interaction.linkTarget) {
      link.setAttribute("target", interaction.linkTarget);
      link.setAttribute("rel", "noopener noreferrer");
    }
    link.appendChild(group);
    return link;
  }

  // A callback is a hook, not navigation: the renderer attaches no listener
  // of its own (that is `render()`'s job) and emits no `<a>`, which with no
  // href would still take focus and show a link cursor while going nowhere.
  group.setAttribute("data-siren-click", interaction.action);
  if (interaction.argument !== null) {
    group.setAttribute("data-siren-click-arg", interaction.argument);
  }
  return group;
}
