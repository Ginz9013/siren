import { describe, expect, it } from "vitest";
import type { PlacedConnector } from "../contracts";
import { plainLabel } from "../label/label";
import { buildConnectorLabels, buildConnectorLine } from "./connector";

/**
 * A connector as layout hands one over, with no hops and no label. Its route
 * is `connectorCurve.test.ts`'s worked example: every segment beside a corner
 * is 10 long, so each rounded corner is cut back by 5.
 */
const connector = (overrides: Partial<PlacedConnector> = {}): PlacedConnector => ({
  id: "A-B",
  from: "A",
  to: "B",
  points: [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 200, y: 10 },
    { x: 200, y: 20 },
  ],
  hops: [],
  label: null,
  ...overrides,
});

describe("buildConnectorLine", () => {
  it("draws one unfilled line in a group wearing the connector's id", () => {
    const g = buildConnectorLine(connector(), { className: "siren-transition", scope: "__s" });

    expect(g.getAttribute("class")).toBe("siren-transition");
    expect(g.getAttribute("data-siren-id")).toBe("A-B");
    expect(g.children).toHaveLength(1);
    const path = g.children[0]!;
    expect(path.tagName).toBe("path");
    expect(path.getAttribute("class")).toBe("siren-transition-line");
    // An open multi-segment route a default fill would paint as a polygon.
    expect(path.getAttribute("fill")).toBe("none");
    expect(path.getAttribute("d")).toBe("M0,0 L0,5 Q0,10 5,10 L195,10 Q200,10 200,15 L200,20");
  });

  it("points each end at the marker it is given, inside this render's scope", () => {
    const path = buildConnectorLine(connector(), {
      className: "siren-er-relationship",
      scope: "__abc12345",
      markerStart: "siren-er-only-one",
      markerEnd: "siren-er-zero-or-more",
    }).querySelector("path")!;

    expect(path.getAttribute("marker-start")).toBe("url(#siren-er-only-one__abc12345)");
    expect(path.getAttribute("marker-end")).toBe("url(#siren-er-zero-or-more__abc12345)");
  });

  it("leaves an end with no marker, or a null one, bare", () => {
    const omitted = buildConnectorLine(connector(), { className: "siren-transition", scope: "__s" });
    const nulled = buildConnectorLine(connector(), {
      className: "siren-relationship",
      scope: "__s",
      markerStart: null,
      markerEnd: "siren-class-arrow",
    });

    expect(omitted.querySelector("path")!.hasAttribute("marker-start")).toBe(false);
    expect(omitted.querySelector("path")!.hasAttribute("marker-end")).toBe(false);
    expect(nulled.querySelector("path")!.hasAttribute("marker-start")).toBe(false);
    expect(nulled.querySelector("path")!.getAttribute("marker-end")).toBe("url(#siren-class-arrow__s)");
  });

  it("dashes the line with the pattern it is given, written as given", () => {
    const path = buildConnectorLine(connector(), {
      className: "siren-er-relationship",
      scope: "__s",
      dashArray: "8,8",
    }).querySelector("path")!;

    expect(path.getAttribute("stroke-dasharray")).toBe("8,8");
  });

  it("draws a solid line when no pattern, or a null one, is given", () => {
    for (const dashArray of [undefined, null]) {
      const path = buildConnectorLine(connector(), {
        className: "siren-relationship",
        scope: "__s",
        dashArray,
      }).querySelector("path")!;

      expect(path.hasAttribute("stroke-dasharray")).toBe(false);
    }
  });

  it("jumps the line over the hops layout found, on the rounded curve", () => {
    const path = buildConnectorLine(connector({ hops: [{ x: 100, y: 10, radius: 6, segment: 1 }] }), {
      className: "siren-relationship",
      scope: "__s",
    }).querySelector("path")!;

    // `connectorCurve.test.ts`'s worked example of a hop on a rounded route.
    expect(path.getAttribute("d")).toBe(
      "M0,0 L0,5 Q0,10 5,10 L94,10 A6,6 0 0 1 106,10 L195,10 Q200,10 200,15 L200,20",
    );
  });
});

/**
 * A placed one-row label "go" centred on (100, 30): the box a measurer
 * answering 8px a character and 24px a row would give it, no padding.
 */
const placedGo = {
  label: plainLabel("go"),
  labelBox: { width: 16, height: 24, rows: [{ y: 12, height: 24, width: 16, runs: [{ x: 0, width: 16 }] }] },
  anchor: { x: 100, y: 30 },
};

describe("buildConnectorLine's serialised form", () => {
  it("writes its attributes in the order every renderer wrote them before it existed", () => {
    // `outerHTML` follows `setAttribute` order, so the order is part of the
    // output. This is the shape the ER renderer serialised before the helper
    // (group: class, id; path: class, d, points, fill, markers, dash).
    const g = buildConnectorLine(connector(), {
      className: "siren-er-relationship",
      scope: "__s",
      markerStart: "siren-er-only-one",
      markerEnd: "siren-er-zero-or-one",
      dashArray: "8,8",
    });

    expect(g.outerHTML).toBe(
      '<g class="siren-er-relationship" data-siren-id="A-B">' +
        '<path class="siren-er-relationship-line" d="M0,0 L0,5 Q0,10 5,10 L195,10 Q200,10 200,15 L200,20" ' +
        'data-siren-points="0,0 0,10 200,10 200,20" fill="none" marker-start="url(#siren-er-only-one__s)" ' +
        'marker-end="url(#siren-er-zero-or-one__s)" stroke-dasharray="8,8"></path></g>',
    );
  });
});

describe("buildConnectorLabels", () => {
  it("wears the same id as the line group, so a timeline step on the id reaches both (ADR-0009, ADR-0016)", () => {
    const labelled = connector({ label: placedGo });

    const line = buildConnectorLine(labelled, { className: "siren-transition", scope: "__s" });
    const labels = buildConnectorLabels(labelled, "siren-transition");

    expect(labels.getAttribute("class")).toBe("siren-transition-labels");
    expect(labels.getAttribute("data-siren-id")).toBe("A-B");
    expect(labels.getAttribute("data-siren-id")).toBe(line.getAttribute("data-siren-id"));
  });

  it("draws the label centred on its anchor, over the background every connector label is painted on", () => {
    const labels = buildConnectorLabels(connector({ label: placedGo }), "siren-er-relationship");

    const text = labels.querySelector("text.siren-er-relationship-label");
    expect(text).not.toBeNull();
    expect(text!.textContent).toBe("go");
    expect(text!.getAttribute("x")).toBe("100");
    expect(text!.getAttribute("y")).toBe("30");
    // The background is the label box, centred on the same anchor, under the text.
    const background = labels.querySelector("rect.siren-connector-label-background")!;
    expect(Array.from(labels.children).indexOf(background)).toBeLessThan(Array.from(labels.children).indexOf(text!));
    expect(background.getAttribute("x")).toBe("92");
    expect(background.getAttribute("y")).toBe("18");
    expect(background.getAttribute("width")).toBe("16");
    expect(background.getAttribute("height")).toBe("24");
  });

  it("draws no text for a connector with no label", () => {
    const labels = buildConnectorLabels(connector({ label: null }), "siren-relationship");

    expect(labels.getAttribute("data-siren-id")).toBe("A-B");
    expect(labels.querySelector("text")).toBeNull();
    expect(labels.childNodes).toHaveLength(0);
  });
});
