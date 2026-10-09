import { afterEach, describe, expect, it } from "vitest";
import { createDropdown } from "./dropdown";

/** A stand-in for the bar's chevron: the dropdown draws whatever icon it is handed. */
function icon(): SVGSVGElement {
  return document.createElementNS("http://www.w3.org/2000/svg", "svg");
}

function optionsOf(element: HTMLElement): HTMLElement[] {
  return Array.from(element.querySelectorAll<HTMLElement>('[role="option"]'));
}

describe("createDropdown", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("shows the current option's label on its trigger and opens a listbox of every option, the current one selected and focused", () => {
    const dropdown = createDropdown<string>({
      label: "Timeline",
      className: "siren-board-controls__timeline",
      icon: icon(),
      onPick: () => {},
    });
    document.body.append(dropdown.element);
    dropdown.sync(
      [
        { value: "card", label: "Card" },
        { value: "wallet", label: "Wallet" },
      ],
      "wallet",
    );

    expect(dropdown.element.classList.contains("siren-board-controls__timeline")).toBe(true);
    expect(dropdown.trigger.getAttribute("aria-label")).toBe("Timeline");
    expect(dropdown.trigger.textContent).toBe("Wallet");
    expect(optionsOf(dropdown.element)).toEqual([]);

    dropdown.trigger.click();

    const listbox = dropdown.element.querySelector('[role="listbox"]')!;
    expect(listbox.getAttribute("aria-label")).toBe("Timeline");
    expect(dropdown.trigger.getAttribute("aria-expanded")).toBe("true");
    const options = optionsOf(dropdown.element);
    expect(options.map((option) => option.textContent)).toEqual(["Card", "Wallet"]);
    expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(document.activeElement).toBe(options[1]);
  });

  it("carries a fixed root class of its own, with the caller's className only added beside it", () => {
    // The listbox opens above the trigger by the root's own class, so a
    // caller's className can name the dropdown without having to position it.
    const dropdown = createDropdown<string>({
      label: "Timeline",
      className: "siren-board-controls__timeline",
      icon: icon(),
      onPick: () => {},
    });

    expect(Array.from(dropdown.element.classList)).toEqual([
      "siren-board-controls__dropdown",
      "siren-board-controls__timeline",
    ]);
  });

  it("hands the picked option's own value to onPick, after closing onto its trigger", () => {
    const picked: number[] = [];
    const dropdown = createDropdown<number>({
      label: "Play interval",
      className: "siren-board-controls__interval",
      icon: icon(),
      onPick: (value) => {
        // Closed before onPick runs, so onPick may reopen or re-sync freely.
        expect(dropdown.trigger.getAttribute("aria-expanded")).toBe("false");
        picked.push(value);
      },
    });
    document.body.append(dropdown.element);
    dropdown.sync(
      [
        { value: 1000, label: "1s" },
        { value: 2500, label: "2.5s" },
      ],
      1000,
    );

    dropdown.trigger.click();
    optionsOf(dropdown.element)[1].click();

    expect(picked).toEqual([2500]);
    expect(optionsOf(dropdown.element)).toEqual([]);
    expect(document.activeElement).toBe(dropdown.trigger);
  });
});
