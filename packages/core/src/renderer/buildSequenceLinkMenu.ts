import type { PositionedParticipant, PositionedSequenceLinkMenu } from "../contracts";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Builds the `<g class="siren-link-menu">` for a participant with two or
 * more links (decision on 01M3NM3BZ): Mermaid's "click the participant for a
 * menu of links", without JavaScript.
 *
 * - A transparent `rect.siren-link-menu-trigger` lies exactly over the
 *   participant's box drawn with its top edge at `boxTop`. Hovering it, or
 *   focusing the group (`tabindex="0"`), is what the theme's `:hover` /
 *   `:focus-within` rules answer by showing `g.siren-link-menu-items`, which
 *   is hidden otherwise. The participant's own group stays where it is and
 *   unlinked, so its `data-siren-id`, animation classes and paint are
 *   untouched.
 * - One real `<a href>` per link, in the menu's order, each a row
 *   `rowHeight` tall and `menu.width` wide. Under the top box the rows hang
 *   from its bottom edge; over the bottom-row box (`opensUpward`) they end at
 *   its top edge — toward the diagram's interior either way, as `menu.x`
 *   already is horizontally.
 *
 * The caller appends it after everything else in the diagram: SVG paints in
 * document order, and a menu drawn before the messages would open under
 * them.
 *
 * Each URL is written verbatim, exactly as `wrapInteraction` writes one:
 * `resolveInteractions` has already dropped anything off its allowlist.
 */
export function buildSequenceLinkMenu(
  participant: PositionedParticipant,
  menu: PositionedSequenceLinkMenu,
  boxTop: number,
  opensUpward: boolean,
): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", "siren-link-menu");
  group.setAttribute("tabindex", "0");
  group.setAttribute("aria-label", `${participant.label.text}: ${menu.links.length} links`);

  const trigger = document.createElementNS(SVG_NS, "rect");
  trigger.setAttribute("class", "siren-link-menu-trigger");
  trigger.setAttribute("x", String(participant.x - participant.width / 2));
  trigger.setAttribute("y", String(boxTop));
  trigger.setAttribute("width", String(participant.width));
  trigger.setAttribute("height", String(participant.height));
  // Transparent, not `none`: an unfilled shape takes no pointer events by
  // default (`pointer-events: visiblePainted`), so it could not be hovered.
  trigger.setAttribute("fill", "transparent");
  group.appendChild(trigger);

  const items = document.createElementNS(SVG_NS, "g");
  items.setAttribute("class", "siren-link-menu-items");
  const firstRowTop = opensUpward
    ? boxTop - menu.rowHeight * menu.links.length
    : boxTop + participant.height;

  menu.links.forEach((link, index) => {
    const rowTop = firstRowTop + menu.rowHeight * index;

    const anchor = document.createElementNS(SVG_NS, "a");
    anchor.setAttribute("class", "siren-link siren-link-menu-item");
    anchor.setAttribute("href", link.action);

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(menu.x));
    rect.setAttribute("y", String(rowTop));
    rect.setAttribute("width", String(menu.width));
    rect.setAttribute("height", String(menu.rowHeight));
    anchor.appendChild(rect);

    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(menu.x + menu.width / 2));
    text.setAttribute("y", String(rowTop + menu.rowHeight / 2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    text.textContent = link.tooltip ?? link.action;
    anchor.appendChild(text);

    items.appendChild(anchor);
  });
  group.appendChild(items);

  return group;
}
