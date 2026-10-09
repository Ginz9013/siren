const TRIGGER_CLASS = "siren-board-controls__trigger";
const LISTBOX_CLASS = "siren-board-controls__listbox";
const OPTION_CLASS = "siren-board-controls__option";

/** One choice a dropdown offers: what picking it hands back, and what the reader sees. */
export interface DropdownOption<T> {
  value: T;
  label: string;
}

/**
 * A control-bar dropdown: a trigger showing the current option's label, and a
 * listbox of every option that opens directly above it rather than leaving a
 * native select's list to the OS, which places it above or below at will.
 */
export interface Dropdown<T> {
  /** The dropdown's root, holding the trigger and, while open, the listbox. */
  element: HTMLElement;
  /** The button that opens the listbox; disable it to disable the dropdown. */
  trigger: HTMLButtonElement;
  /**
   * Shows `options`, marks `current` selected and puts its label on the
   * trigger. `current` must be one of the options' values. Rebuilds the
   * options only when their values or labels changed, so calling this on
   * every board update never pulls an option out from under the reader's focus.
   */
  sync(options: readonly DropdownOption<T>[], current: T): void;
  /** Closes the listbox, handing focus back to the trigger when `refocus`. */
  close(refocus?: boolean): void;
  /** Closes an open listbox, which takes its document listener with it. */
  destroy(): void;
}

/**
 * Builds a dropdown that calls `onPick` with the value the reader picks — by
 * click, or Enter / Space on a focused option — after closing onto its
 * trigger. It knows nothing about what its values mean; `label` names it for
 * assistive technology on both the trigger and the listbox, and `icon` is
 * drawn after the trigger's text.
 */
export function createDropdown<T>(config: {
  label: string;
  className: string;
  icon: SVGElement;
  onPick(value: T): void;
}): Dropdown<T> {
  /** The options last synced, in the listbox's order. */
  let shown: readonly DropdownOption<T>[] = [];

  const element = document.createElement("div");
  element.className = config.className;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = TRIGGER_CLASS;
  trigger.setAttribute("aria-label", config.label);
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const triggerText = document.createElement("span");
  trigger.append(triggerText, config.icon);
  element.append(trigger);
  /** The dropdown's options, in the DOM only while it is open. */
  const listbox = document.createElement("div");
  listbox.className = LISTBOX_CLASS;
  listbox.setAttribute("role", "listbox");
  listbox.setAttribute("aria-label", config.label);
  listbox.addEventListener("keydown", (event) => {
    const options = optionElements();
    const at = options.indexOf(document.activeElement as HTMLElement);
    const to = { ArrowUp: at - 1, ArrowDown: at + 1, Home: 0, End: options.length - 1 }[event.key];
    if (to !== undefined) {
      // Stops at either end rather than wrapping, like a native select.
      options[Math.min(options.length - 1, Math.max(0, to))]?.focus();
    } else if ((event.key === "Enter" || event.key === " ") && at !== -1) {
      pick(shown[at].value);
    } else if (event.key === "Escape") {
      close(true);
    } else {
      // Not handled, so not prevented: Tab, after focus goes back to the
      // trigger, moves on from there as it would from a closed dropdown.
      if (event.key === "Tab") close(true);
      return;
    }
    claimKey(event);
  });
  // A press on the listbox's own padding would otherwise drop focus to the
  // page, leaving the arrows and Escape with nothing to act on; an option
  // still picks on the click that follows.
  listbox.addEventListener("mousedown", (event) => event.preventDefault());
  trigger.addEventListener("click", () => {
    if (listbox.isConnected) close();
    else open();
  });
  trigger.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "Enter", " "].includes(event.key)) return;
    // Handled here rather than left to the button's own click: Space would
    // scroll the page, and the click that follows would shut it again.
    claimKey(event);
    open();
  });

  function sync(options: readonly DropdownOption<T>[], current: T): void {
    const changed =
      options.length !== shown.length ||
      options.some((option, i) => !Object.is(option.value, shown[i].value) || option.label !== shown[i].label);
    if (changed) {
      // Rebuilding drops the focused option from the DOM; keep the reader on
      // the same value in the new list.
      const focusedAt = optionElements().indexOf(document.activeElement as HTMLElement);
      const focusedValue = focusedAt === -1 ? undefined : { value: shown[focusedAt].value };
      shown = [...options];
      listbox.replaceChildren(...shown.map((option) => makeOption(option)));
      if (focusedValue !== undefined) {
        optionElements()[shown.findIndex((option) => Object.is(option.value, focusedValue.value))]?.focus();
      }
    }
    const optionEls = optionElements();
    shown.forEach((option, i) => {
      const selected = Object.is(option.value, current);
      optionEls[i].setAttribute("aria-selected", String(selected));
      if (selected) triggerText.textContent = option.label;
    });
  }

  /** Opens the listbox above its trigger, focusing the selected option. */
  function open(): void {
    element.append(listbox);
    trigger.setAttribute("aria-expanded", "true");
    // Capture phase: the canvas's own mousedown handler prevents the default
    // and blurs, so this must hear the press before anything else can.
    document.addEventListener("mousedown", onOutsideMouseDown, true);
    optionElements()
      .find((option) => option.getAttribute("aria-selected") === "true")
      ?.focus();
  }

  function close(refocus = false): void {
    listbox.remove();
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onOutsideMouseDown, true);
    if (refocus) trigger.focus();
  }

  /** A press anywhere but the dropdown itself closes its listbox, as a click away from a native select would. */
  function onOutsideMouseDown(event: MouseEvent): void {
    if (!element.contains(event.target as Node)) close();
  }

  /** Closes the listbox onto its trigger, then hands `value` to `onPick`. */
  function pick(value: T): void {
    close(true);
    config.onPick(value);
  }

  function optionElements(): HTMLElement[] {
    return Array.from(listbox.children as HTMLCollectionOf<HTMLElement>);
  }

  /** The listbox's option for `option`: a click picks it and closes the listbox. */
  function makeOption(option: DropdownOption<T>): HTMLElement {
    const el = document.createElement("div");
    el.className = OPTION_CLASS;
    el.setAttribute("role", "option");
    el.tabIndex = -1;
    el.textContent = option.label;
    el.addEventListener("click", () => pick(option.value));
    return el;
  }

  return {
    element,
    trigger,
    sync,
    close,
    destroy() {
      close();
    },
  };
}

/** A key the dropdown handles is its alone: no default, and no page shortcut on the same key (Home, the arrows). */
function claimKey(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}
