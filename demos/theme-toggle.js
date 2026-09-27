/*
 * The demos' theme switch, shared by every page with a #theme-btn. Loaded as
 * a plain script in <head>, so the pin lands before the first paint and a
 * dark system never flashes the light palette.
 *
 * It only pins <html data-theme>, the one attribute core's palette, board's
 * chrome tokens (both ADR-0011) and demo-chrome.css all read. Pinned on load
 * from the system preference rather than left unset, so the button always
 * states the theme actually showing. A page labels the button in its own
 * language with data-labels="<light>|<dark>".
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
