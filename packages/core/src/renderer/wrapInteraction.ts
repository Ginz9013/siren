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
