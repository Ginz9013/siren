/**
 * How the scripts beside this one load Mermaid 12.2.0 under Node: jsdom
 * globals first, then the module. Shared by `mermaid-probe.mjs` and
 * `check-examples.mjs` so that both measure the same Mermaid the same way.
 *
 * Lives under `scripts/`, never `src/`: ADR-0001 says this repo builds its own
 * renderer, and Mermaid is a measuring instrument here, not a dependency.
 */
/**
 * Install the browser globals Mermaid's module-load path needs, before it
 * loads, and hand back the jsdom the SVG will later be read out of.
 *
 * `CSSStyleSheet` is only reached by the render path — `createCssStyles`
 * builds the stylesheet Mermaid emits inside the SVG — but it is installed
 * for both, because a global that appears only under a flag is a global that
 * is missing the first time someone else needs it.
 */
export async function installDomGlobals() {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  const names = [
    "window",
    "document",
    "navigator",
    "DOMParser",
    "Node",
    "Element",
    "SVGElement",
    "HTMLElement",
    "MutationObserver",
    "requestAnimationFrame",
    "getComputedStyle",
    "CSSStyleSheet",
    // A sequence `box` line's color is tested by assigning it to a fresh
    // `new Option().style` (Mermaid's `parseBoxData`, where `window.CSS` is
    // missing, as it is in jsdom), so every `box` line threw "Option is not
    // defined" without it. That fallback compares the value with what jsdom
    // serializes it as, so write a box color in lower case (`box aqua Grp`):
    // `box Aqua Grp` reads `Aqua` as part of the label here, where a browser's
    // `CSS.supports` reads it as a color.
    "Option",
  ];
  for (const name of names) {
    if (globalThis[name] === undefined) globalThis[name] = dom.window[name];
  }
  return dom;
}

/**
 * The layout primitives jsdom does not implement, stubbed so that Mermaid's
 * renderer runs to completion.
 *
 * jsdom parses and cascades but never lays anything out, so `getBBox` on an
 * SVG element does not exist at all and Mermaid's measuring pass throws on
 * the first label it sizes. A fixed box gets it past that, at the price named
 * in the header: **every coordinate this mode produces is this stub's answer
 * and not Mermaid's.** That is an acceptable price for a paint question and
 * not for any other, which is why the stubs are installed only for the modes
 * that render (`--paint`, `--markup`, `--html`) rather than beside the globals
 * above — the parse path must stay a measurement of Mermaid with nothing of
 * ours in it.
 */
export function installLayoutStubs(dom) {
  const box = () => ({ x: 0, y: 0, width: 40, height: 20 });
  for (const proto of [dom.window.SVGElement.prototype, dom.window.Element.prototype]) {
    if (proto.getBBox === undefined) proto.getBBox = box;
    if (proto.getComputedTextLength === undefined) proto.getComputedTextLength = () => box().width;
  }
}

/**
 * Mermaid itself, imported after the globals it needs exist and initialized
 * the way every caller wants it (`startOnLoad: false`), plus the jsdom the
 * render modes read the SVG out of. `layoutStubs` installs
 * `installLayoutStubs` before the import, for the modes that render.
 */
export async function loadMermaid({ layoutStubs = false } = {}) {
  const dom = await installDomGlobals();
  if (layoutStubs) installLayoutStubs(dom);
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false });
  const { version } = (await import("mermaid/package.json", { with: { type: "json" } })).default;
  return { mermaid, dom, version };
}
