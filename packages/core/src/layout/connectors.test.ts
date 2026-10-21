import { describe, expect, it } from "vitest";
import type { Label, LineHop, TextMeasurer } from "../contracts";
import { plainLabel } from "../label/label";
import { type WrappedLabel, wrapConnectorLabel, wrapErRelationshipLabel } from "../label/wrapLabel";
import { type ConnectorRoute, placeConnectors } from "./connectors";

/** Deterministic fake measurer, the fixture pattern every layout test here uses. */
const fakeMeasurer: TextMeasurer = {
  measure(text: string) {
    return { width: text.length * 8, height: 24 };
  },
};

/**
 * A wrapped label the spy hands back, distinct per text so the tests can tell
 * them apart. Tolerates a `null` it should never be handed, so a wrongly
 * wrapped unlabelled connector shows up as a recorded call, not a crash.
 */
function cannedWrap(label: Label): WrappedLabel {
  return {
    label,
    labelBox: { width: (label as Label | null)?.text.length ?? -1, height: 7, rows: [] },
  };
}

/** A wrap function that records each label it is handed. */
function spyWrap() {
  const calls: Label[] = [];
  const wrap = (label: Label, measureText: TextMeasurer): WrappedLabel => {
    expect(measureText).toBe(fakeMeasurer);
    calls.push(label);
    return cannedWrap(label);
  };
  return { calls, wrap };
}

describe("placeConnectors — the wrap phase, before the core", () => {
  it("wraps each labelled connector once, with the wrap function it is handed", () => {
    const yes = plainLabel("yes");
    const no = plainLabel("no");
    const { calls, wrap } = spyWrap();

    const placement = placeConnectors(
      [
        { id: "a-b", from: "a", to: "b", label: yes },
        { id: "b-c", from: "b", to: "c", label: no },
      ],
      fakeMeasurer,
      wrap,
    );

    expect(calls).toEqual([yes, no]);
    expect(placement.labelBoxOf("a-b")).toEqual(cannedWrap(yes).labelBox);
    expect(placement.labelBoxOf("b-c")).toEqual(cannedWrap(no).labelBox);
  });

  it("wraps at the connector width, 150px, unless handed another wrap", () => {
    // Long enough that the 150px and ER ≈171.43px widths break it differently.
    const long = plainLabel("aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj");

    const placement = placeConnectors([{ id: "a-b", from: "a", to: "b", label: long }], fakeMeasurer);

    expect(placement.labelBoxOf("a-b")).toEqual(wrapConnectorLabel(long, fakeMeasurer).labelBox);
    expect(placement.labelBoxOf("a-b")).not.toEqual(wrapErRelationshipLabel(long, fakeMeasurer).labelBox);
  });

  it("leaves an unlabelled connector unwrapped", () => {
    const yes = plainLabel("yes");
    const { calls, wrap } = spyWrap();

    placeConnectors(
      [
        { id: "a-b", from: "a", to: "b", label: null },
        { id: "b-c", from: "b", to: "c", label: yes },
      ],
      fakeMeasurer,
      wrap,
    );

    expect(calls).toEqual([yes]);
  });

  it("answers the box it wrapped for a labelled connector, and none for an unlabelled one", () => {
    const yes = plainLabel("yes");

    const placement = placeConnectors(
      [
        { id: "a-b", from: "a", to: "b", label: null },
        { id: "b-c", from: "b", to: "c", label: yes },
      ],
      fakeMeasurer,
      spyWrap().wrap,
    );

    expect(placement.labelBoxOf("b-c")).toEqual(cannedWrap(yes).labelBox);
    expect(placement.labelBoxOf("a-b")).toBeUndefined();
  });
});

/** A hand-built shared-core route. */
function route(over: Partial<ConnectorRoute> = {}): ConnectorRoute {
  return {
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ],
    hops: [],
    ...over,
  };
}

describe("placeConnectors — the place phase, after the core", () => {
  it("places the wrapped label at the anchor the core reserved, on the route it drew", () => {
    const yes = plainLabel("yes");
    const points = [
      { x: 10, y: 20 },
      { x: 10, y: 60 },
      { x: 40, y: 60 },
    ];
    const { calls, wrap } = spyWrap();
    const placement = placeConnectors([{ id: "a-b", from: "a", to: "b", label: yes }], fakeMeasurer, wrap);

    const placed = placement.place(new Map([["a-b", route({ points, labelAnchor: { x: 10, y: 40 } })]]));

    // `place` reuses the label wrapped before the core and never wraps again:
    // a second wrap could break the rows differently from the box the core
    // kept clear.
    expect(calls).toEqual([yes]);
    expect(placed).toEqual([
      {
        id: "a-b",
        from: "a",
        to: "b",
        points,
        hops: [],
        label: { ...cannedWrap(yes), anchor: { x: 10, y: 40 } },
      },
    ]);
  });

  it("carries the line hops the core found on the route", () => {
    const hops: LineHop[] = [{ x: 0, y: 50, radius: 6, segment: 0 }];
    const placement = placeConnectors([{ id: "a-b", from: "a", to: "b", label: null }], fakeMeasurer);

    const [placed] = placement.place(new Map([["a-b", route({ hops })]]));

    expect(placed!.hops).toEqual([{ x: 0, y: 50, radius: 6, segment: 0 }]);
  });

  it("places no label on a connector the model gave none", () => {
    const placement = placeConnectors([{ id: "a-b", from: "a", to: "b", label: null }], fakeMeasurer);

    const [placed] = placement.place(new Map([["a-b", route({ labelAnchor: { x: 0, y: 50 } })]]));

    expect(placed!.label).toBeNull();
  });

  it("places no label where the core reserved no room for one", () => {
    const placement = placeConnectors(
      [{ id: "a-b", from: "a", to: "b", label: plainLabel("yes") }],
      fakeMeasurer,
      spyWrap().wrap,
    );

    const [placed] = placement.place(new Map([["a-b", route()]]));

    expect(placed!.label).toBeNull();
  });

  it("answers one placed connector per item, in the items' order, whatever order the routes came in", () => {
    const placement = placeConnectors(
      [
        { id: "c-a", from: "c", to: "a", label: null },
        { id: "a-b", from: "a", to: "b", label: null },
        { id: "b-c", from: "b", to: "c", label: null },
      ],
      fakeMeasurer,
    );

    const placed = placement.place(
      new Map([
        ["a-b", route()],
        ["b-c", route()],
        ["c-a", route()],
      ]),
    );

    expect(placed.map((connector) => connector.id)).toEqual(["c-a", "a-b", "b-c"]);
  });

  it("refuses to place a connector the core returned no route for", () => {
    const placement = placeConnectors([{ id: "a-b", from: "a", to: "b", label: null }], fakeMeasurer);

    expect(() => placement.place(new Map())).toThrow("placeConnectors: no route for connector a-b");
  });
});
