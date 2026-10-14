const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Writes a diagram's `accTitle` and `accDescr` onto its root, as Mermaid
 * 12.2.0 does for every kind (`addSVGa11yTitleDescription`, in the
 * `render()` all kinds share): a `<title>` and a `<desc>` as the root's
 * first children, named by `aria-labelledby` and `aria-describedby`. Each
 * only when the document wrote it — two statements, two stores, and a
 * document may write either alone. Nothing is drawn on the canvas.
 *
 * Call it before anything else is appended, because Mermaid puts these
 * first and an accessible name is read from the first `<title>` a consumer
 * finds. `scope` is the renderer's `mintIdScope()` token, so two diagrams on
 * one page do not share an id.
 *
 * No `role`: Mermaid writes `role="graphics-document document"` on every
 * root, unconditionally and unrelated to these statements, and Siren draws
 * that attribute for no kind. `renderSequenceToSVG` and `renderToSVG` keep
 * their own older copies of this (the sequence one with `role="img"`).
 */
export function appendAccessibleText(
  svg: SVGSVGElement,
  scope: string,
  accTitle: string | null,
  accDescr: string | null,
): void {
  if (accTitle !== null) {
    const id = `chart-title${scope}`;
    const title = document.createElementNS(SVG_NS, "title");
    title.setAttribute("id", id);
    title.textContent = accTitle;
    svg.appendChild(title);
    svg.setAttribute("aria-labelledby", id);
  }
  if (accDescr !== null) {
    const id = `chart-desc${scope}`;
    const desc = document.createElementNS(SVG_NS, "desc");
    desc.setAttribute("id", id);
    desc.textContent = accDescr;
    svg.appendChild(desc);
    svg.setAttribute("aria-describedby", id);
  }
}
