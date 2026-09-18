import { describe, expect, it } from "vitest";
import { wrapInteraction } from "./wrapInteraction";

const SVG_NS = "http://www.w3.org/2000/svg";

describe("wrapInteraction", () => {
  it("returns the group unchanged when there is no interaction", () => {
    const group = document.createElementNS(SVG_NS, "g");

    const result = wrapInteraction(group, null);

    expect(result).toBe(group);
  });

  it("wraps the group in a siren-link anchor for an href interaction", () => {
    const group = document.createElementNS(SVG_NS, "g");

    const result = wrapInteraction(group, {
      targetId: "Shape",
      interactionKind: "href",
      action: "https://example.com",
      argument: null,
      tooltip: null,
    });

    expect(result.tagName).toBe("a");
    expect(result.getAttribute("class")).toBe("siren-link");
    expect(result.getAttribute("href")).toBe("https://example.com");
    expect(result.firstChild).toBe(group);
  });

  it("sets target and rel=noopener noreferrer on the anchor when the interaction carries a linkTarget", () => {
    const group = document.createElementNS(SVG_NS, "g");

    const result = wrapInteraction(group, {
      targetId: "Shape",
      interactionKind: "href",
      action: "https://example.com",
      argument: null,
      tooltip: null,
      linkTarget: "_blank",
    });

    expect(result.getAttribute("target")).toBe("_blank");
    expect(result.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("sets no target or rel attribute when the interaction carries no linkTarget", () => {
    const group = document.createElementNS(SVG_NS, "g");

    const result = wrapInteraction(group, {
      targetId: "Shape",
      interactionKind: "href",
      action: "https://example.com",
      argument: null,
      tooltip: null,
      linkTarget: null,
    });

    expect(result.hasAttribute("target")).toBe(false);
    expect(result.hasAttribute("rel")).toBe(false);
  });

  it("stamps a data-siren-click hook on the group for a call interaction, with no wrapper", () => {
    const group = document.createElementNS(SVG_NS, "g");

    const result = wrapInteraction(group, {
      targetId: "Shape",
      interactionKind: "call",
      action: "showDetails",
      argument: null,
      tooltip: null,
    });

    expect(result).toBe(group);
    expect(group.getAttribute("data-siren-click")).toBe("showDetails");
    expect(group.hasAttribute("data-siren-click-arg")).toBe(false);
  });

  it("also stamps data-siren-click-arg when the call interaction carries an argument", () => {
    const group = document.createElementNS(SVG_NS, "g");

    wrapInteraction(group, {
      targetId: "Shape",
      interactionKind: "call",
      action: "showDetails",
      argument: "a",
      tooltip: null,
    });

    expect(group.getAttribute("data-siren-click-arg")).toBe("a");
  });
});
