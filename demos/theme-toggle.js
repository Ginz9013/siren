/*
 * The demos' theme switch, shared by every page with a #theme-btn. Loaded as
 * a plain script in <head>, so the pin lands before the first paint and a
 * dark system never flashes the light palette.
 *
 * It only pins <html data-theme>. That attribute is the demos' own convention,
 * read only by the demos' own CSS — theme-dark.css for Siren's tokens,
 * demo-chrome.css and gallery.html's inline styles for the page's. Neither
 * siren-core nor siren-board knows it exists: each ships one palette and
 * switches nothing by itself (ADR-0014), which is why the second theme is a
 * file in this directory. Pinned on load from the system preference rather
 * than left unset, so the button always states the theme actually showing. A
 * page labels the button in its own language with data-labels="<light>|<dark>".
 */
(() => {
  const root = document.documentElement;
  root.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("theme-btn");
    if (button === null) return;
    const [light, dark] = (button.dataset.labels ?? "Theme: Light|Theme: Dark").split("|");
    const label = () => (root.dataset.theme === "dark" ? dark : light);

    button.textContent = label();
    button.addEventListener("click", () => {
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      button.textContent = label();
    });
  });
})();
