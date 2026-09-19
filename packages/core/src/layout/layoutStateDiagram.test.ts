import { describe, expect, it } from "vitest";
import type { StateModel, TextMeasurer } from "../contracts";
import { layoutStateDiagram } from "./layoutStateDiagram";

/** Deterministic fake measurer, the fixture pattern every layout test here uses. */
const fakeMeasurer: TextMeasurer = {
  measure(text: string) {
    return { width: text.length * 8, height: 24 };
  },
};

const options = { measureText: fakeMeasurer };

/** Width the fake measurer reports for `text` — the tests' independent yardstick. */
const measuredWidth = (text: string) => fakeMeasurer.measure(text).width;

function model(
  transitions: { from: string; to: string; label?: string | null }[],
  stateIds?: string[],
): StateModel {
  const ids =
    stateIds ??
    transitions
      .flatMap(({ from, to }) => [from, to])
      .filter((id, index, all) => all.indexOf(id) === index);
  return {
    states: ids.map((id) => ({
      id,
      kind: "state" as const,
      descriptions: [],
      parentId: null,
      direction: null,
    })),
    transitions: transitions.map(({ from, to, label }) => ({
      id: `${from}-${to}`,
      from,
      to,
      label: label ?? null,
    })),
    timeline: { totalSteps: 0, entries: [] },
  };
}

describe("layoutStateDiagram", () => {
  it("sizes each state's box around its own measured label", () => {
    const laid = layoutStateDiagram(model([{ from: "Idle", to: "Processing" }]), options);

    expect(laid.states.map((state) => state.id)).toEqual(["Idle", "Processing"]);
    for (const state of laid.states) {
      expect(state.width, state.id).toBeGreaterThan(measuredWidth(state.id));
      expect(state.height, state.id).toBeGreaterThan(fakeMeasurer.measure(state.id).height);
    }
    // The wider label gets the wider box — the property that says the box was
    // measured rather than given a fixed size.
    const [idle, processing] = laid.states;
    expect(processing.width).toBeGreaterThan(idle.width);
  });

  it("lays the diagram out top to bottom, Mermaid's own default for this kind", () => {
    const laid = layoutStateDiagram(model([{ from: "Idle", to: "Running" }]), options);

    const [idle, running] = laid.states;
    expect(running.y).toBeGreaterThan(idle.y);
  });

  it("routes every transition between its two states, and reports where a label goes", () => {
    const laid = layoutStateDiagram(
      model([
        { from: "Idle", to: "Running", label: "start" },
        { from: "Running", to: "Idle" },
      ]),
      options,
    );

    expect(laid.transitions.map((t) => t.id)).toEqual(["Idle-Running", "Running-Idle"]);
    for (const transition of laid.transitions) {
      expect(transition.points.length, transition.id).toBeGreaterThanOrEqual(2);
    }

    // A labelled transition asks the core to keep space for the text and
    // reports back where that space ended up; an unlabelled one asks for
    // none and reports no anchor at all, rather than a point nothing is
    // drawn at.
    expect(laid.transitions[0].label).toBe("start");
    expect(laid.transitions[0].labelAnchor).not.toBeNull();
    expect(laid.transitions[1].label).toBeNull();
    expect(laid.transitions[1].labelAnchor).toBeNull();
  });

  it("routes a self-transition as a loop on its one state, inside the canvas", () => {
    // The "stays in this state" loop: one state, one route, and the route has
    // to be somewhere a reader can see it — a loop routed outside the
    // reported width/height is clipped away by the `viewBox`.
    const laid = layoutStateDiagram(
      model([{ from: "Running", to: "Running", label: "retry" }]),
      options,
    );

    expect(laid.states.map((state) => state.id)).toEqual(["Running"]);
    expect(laid.transitions).toHaveLength(1);

    const loop = laid.transitions[0];
    expect(loop.points.length).toBeGreaterThanOrEqual(2);
    for (const point of loop.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(laid.width);
      expect(point.y).toBeLessThanOrEqual(laid.height);
    }
  });

  it("reports a canvas covering every box and every routed point", () => {
    const laid = layoutStateDiagram(
      model([
        { from: "Idle", to: "Running", label: "start" },
        { from: "Running", to: "Running", label: "retry" },
        { from: "Running", to: "Done" },
      ]),
      options,
    );

    for (const state of laid.states) {
      expect(state.x + state.width, state.id).toBeLessThanOrEqual(laid.width);
      expect(state.y + state.height, state.id).toBeLessThanOrEqual(laid.height);
    }
    for (const transition of laid.transitions) {
      for (const point of transition.points) {
        expect(point.x, transition.id).toBeLessThanOrEqual(laid.width);
        expect(point.y, transition.id).toBeLessThanOrEqual(laid.height);
      }
    }
  });

  it("gives each pseudo-state a square box of its own size, not one measured around its generated id", () => {
    // A pseudo-state draws a disc and a ring, neither of which holds text —
    // so sizing it the way a state is sized would reserve room for
    // `start:1`, a string nothing draws, and push the whole diagram apart
    // around empty space. The box has to be square, too: an ellipse is not
    // the figure UML draws here.
    const laid = layoutStateDiagram(
      {
        states: [
          { id: "start:1", kind: "start", descriptions: [], parentId: null, direction: null },
          { id: "Idle", kind: "state", descriptions: [], parentId: null, direction: null },
          { id: "end:1", kind: "end", descriptions: [], parentId: null, direction: null },
        ],
        transitions: [
          { id: "start:1-Idle", from: "start:1", to: "Idle", label: null },
          { id: "Idle-end:1", from: "Idle", to: "end:1", label: null },
        ],
        timeline: { totalSteps: 0, entries: [] },
      },
      options,
    );

    const byId = new Map(laid.states.map((state) => [state.id, state]));
    for (const id of ["start:1", "end:1"]) {
      const disc = byId.get(id)!;
      expect(disc.width, id).toBe(disc.height);
      expect(disc.width, id).toBeLessThan(measuredWidth(id));
    }
    // Both discs are the same size as each other: a start and an end are
    // the same figure differently filled.
    expect(byId.get("start:1")!.width).toBe(byId.get("end:1")!.width);

    // And the kind survives layout, because it is the only thing that says
    // which of the three figures the renderer draws.
    expect(laid.states.map((state) => state.kind)).toEqual(["start", "state", "end"]);

    // Top to bottom, which is where the start belongs.
    expect(byId.get("start:1")!.y).toBeLessThan(byId.get("Idle")!.y);
    expect(byId.get("end:1")!.y).toBeGreaterThan(byId.get("Idle")!.y);
  });

  it("sizes a described state's box around its description, and an undescribed one's around its id", () => {
    // Measured (mermaid 11.17.2): once `s : text` is written, `s` is not
    // drawn at all — the description is what the box holds, so it is what
    // the box must be measured from, and the id becomes addressing-only.
    // A one-character id under a long description is the case that tells a
    // box measured from the right string from one measured from the wrong
    // one.
    const laid = layoutStateDiagram(
      {
        states: [
          { id: "s", kind: "state", descriptions: ["waiting for work"], parentId: null, direction: null },
          { id: "Undescribed", kind: "state", descriptions: [], parentId: null, direction: null },
        ],
        transitions: [{ id: "s-Undescribed", from: "s", to: "Undescribed", label: null }],
        timeline: { totalSteps: 0, entries: [] },
      },
      options,
    );

    const [described, plain] = laid.states;
    expect(described.width).toBeGreaterThan(measuredWidth("waiting for work"));
    expect(described.rows.map((row) => row.text)).toEqual(["waiting for work"]);
    expect(plain.rows.map((row) => row.text)).toEqual(["Undescribed"]);

    // One description draws no divider: measured, Mermaid gives it the same
    // plain rounded rect an undescribed state gets, the description simply
    // standing where the id would have.
    expect(described.dividerY).toBeNull();
    expect(plain.dividerY).toBeNull();

    // Every row is somewhere inside the box that was sized for it.
    for (const state of laid.states) {
      for (const row of state.rows) {
        expect(row.y, `${state.id}: ${row.text}`).toBeGreaterThan(state.y);
        expect(row.y, `${state.id}: ${row.text}`).toBeLessThan(state.y + state.height);
      }
    }
  });

  it("gives a state with two or more descriptions a divider under its title row, with the rest stacked below", () => {
    // Measured (mermaid 11.17.2, `mermaid-probe.mjs --markup`): two
    // descriptions are drawn as `rect.outer.title-state` *plus* a
    // `line.divider`, the first description standing as the title row above
    // the line and the rest sitting below it. The divider never separates
    // the id from the descriptions — the id is not drawn at all once a
    // description exists.
    const laid = layoutStateDiagram(
      {
        states: [
          { id: "s", kind: "state", descriptions: ["first", "second", "third"], parentId: null, direction: null },
          { id: "t", kind: "state", descriptions: ["only"], parentId: null, direction: null },
        ],
        transitions: [{ id: "s-t", from: "s", to: "t", label: null }],
        timeline: { totalSteps: 0, entries: [] },
      },
      options,
    );

    const [titled, plain] = laid.states;
    expect(titled.rows.map((row) => row.text)).toEqual(["first", "second", "third"]);
    expect(titled.dividerY).not.toBeNull();
    // Inside its own box, which is what makes it a divider rather than a
    // line drawn across the canvas.
    expect(titled.dividerY!).toBeGreaterThan(titled.y);
    expect(titled.dividerY!).toBeLessThan(titled.y + titled.height);
    // The first description titles the box; every other one is below the
    // line. This is the half most easily got backwards.
    expect(titled.rows[0].y).toBeLessThan(titled.dividerY!);
    for (const row of titled.rows.slice(1)) {
      expect(row.y, row.text).toBeGreaterThan(titled.dividerY!);
    }
    // Three rows and a divider need more room than one row: a box sized
    // for one line would draw the other two outside itself.
    expect(titled.height).toBeGreaterThan(plain.height);
  });

  it("carries the resolved timeline through untouched", () => {
    const source = model([{ from: "Idle", to: "Running" }]);

    expect(layoutStateDiagram(source, options).timeline).toBe(source.timeline);
  });
  it("draws a composite as a frame around the states inside it, with a strip for its title", () => {
    // The figure measured off mermaid 11.17.2 with `--markup`: a
    // `g.statediagram-cluster` is a frame with a title strip along its top
    // and its members inside it. Siren grows that frame from the cluster box
    // the shared layout core placed, exactly as `layoutGraph` grows a
    // subgraph's.
    const laid = layoutStateDiagram(
      {
        states: [
          { id: "Outer", kind: "composite", descriptions: [], parentId: null, direction: null },
          { id: "Idle", kind: "state", descriptions: [], parentId: "Outer", direction: null },
          { id: "Busy", kind: "state", descriptions: [], parentId: "Outer", direction: null },
        ],
        transitions: [{ id: "Idle-Busy", from: "Idle", to: "Busy", label: null }],
        timeline: { totalSteps: 0, entries: [] },
      },
      options,
    );

    const placed = (id: string) => laid.states.find((state) => state.id === id)!;
    const frame = placed("Outer");

    // Around, as geometry: every member lies strictly inside the frame.
    for (const id of ["Idle", "Busy"]) {
      const member = placed(id);
      expect(member.x, id).toBeGreaterThan(frame.x);
      expect(member.y, id).toBeGreaterThan(frame.y);
      expect(member.x + member.width, id).toBeLessThan(frame.x + frame.width);
      expect(member.y + member.height, id).toBeLessThan(frame.y + frame.height);
    }

    // The title strip: the frame's own row is above everything it holds,
    // which is what leaves room for the text rather than drawing it over a
    // member's box.
    expect(frame.rows.map((row) => row.text)).toEqual(["Outer"]);
    expect(frame.rows[0].y).toBeLessThan(Math.min(placed("Idle").y, placed("Busy").y));
    expect(frame.dividerY).toBeNull();

    // A frame grows up and left of the corner the core laid the graph out
    // from, so the whole diagram is shifted rather than drawn off-canvas.
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.y).toBeGreaterThanOrEqual(0);
    expect(laid.width).toBeGreaterThanOrEqual(frame.x + frame.width);
    expect(laid.height).toBeGreaterThanOrEqual(frame.y + frame.height);
  });
  it("nests a frame inside a frame, each clearing the one below it", () => {
    // A composite's block may open another, and an outer frame must clear
    // the whole of an inner one — title strip included, since that strip is
    // the part that reaches highest.
    const laid = layoutStateDiagram(
      {
        states: [
          { id: "Outer", kind: "composite", descriptions: [], parentId: null, direction: null },
          { id: "Inner", kind: "composite", descriptions: [], parentId: "Outer", direction: null },
          { id: "Deep", kind: "state", descriptions: [], parentId: "Inner", direction: null },
          { id: "Beside", kind: "state", descriptions: [], parentId: "Outer", direction: null },
        ],
        transitions: [{ id: "Deep-Beside", from: "Deep", to: "Beside", label: null }],
        timeline: { totalSteps: 0, entries: [] },
      },
      options,
    );

    const placed = (id: string) => laid.states.find((state) => state.id === id)!;
    const encloses = (outer: { x: number; y: number; width: number; height: number }, inner: typeof outer) =>
      inner.x > outer.x &&
      inner.y > outer.y &&
      inner.x + inner.width < outer.x + outer.width &&
      inner.y + inner.height < outer.y + outer.height;

    expect(encloses(placed("Outer"), placed("Inner")), "Outer encloses Inner").toBe(true);
    expect(encloses(placed("Inner"), placed("Deep")), "Inner encloses Deep").toBe(true);
    expect(encloses(placed("Outer"), placed("Beside")), "Outer encloses Beside").toBe(true);
    // And `Deep` is *not* a member of `Outer` directly — it is inside it by
    // way of `Inner`, which is what nesting means.
    expect(encloses(placed("Outer"), placed("Deep")), "Outer encloses Deep").toBe(true);

    // The half that an enclosure check alone would let through: an outer
    // frame must clear an inner one's **title strip**, which is the part
    // that reaches highest. Said as the whole of the outer title row — not
    // just its centre line — lying above what the frame holds, because a
    // frame grown around an inner *cluster box* rather than an inner
    // *frame* still encloses it, and draws its own title across it.
    const rowHalf = fakeMeasurer.measure("Outer").height / 2;
    expect(placed("Outer").rows[0].y + rowHalf).toBeLessThanOrEqual(placed("Inner").y);
    expect(placed("Inner").rows[0].y + rowHalf).toBeLessThanOrEqual(placed("Deep").y);
  });

  it("lands a transition naming a composite on that frame's own boundary", () => {
    // dagre throws on an edge whose endpoint is a cluster, so the shared
    // core proxies a member and clips the route back to the frame. The frame
    // this module draws is bigger than the cluster box the core placed — by
    // the padding and the title strip — so the route is clipped a second
    // time, against the frame that is actually drawn.
    const laid = layoutStateDiagram(
      {
        states: [
          { id: "start:1", kind: "start", descriptions: [], parentId: null, direction: null },
          { id: "Outer", kind: "composite", descriptions: [], parentId: null, direction: null },
          { id: "Inner", kind: "state", descriptions: [], parentId: "Outer", direction: null },
          { id: "Done", kind: "state", descriptions: [], parentId: null, direction: null },
        ],
        transitions: [
          { id: "start:1-Outer", from: "start:1", to: "Outer", label: null },
          { id: "Outer-Done", from: "Outer", to: "Done", label: null },
        ],
        timeline: { totalSteps: 0, entries: [] },
      },
      options,
    );

    const placed = (id: string) => laid.states.find((state) => state.id === id)!;
    const frame = placed("Outer");
    const onBoundary = (point: { x: number; y: number }) => {
      const tolerance = 1e-6;
      const withinX = point.x >= frame.x - tolerance && point.x <= frame.x + frame.width + tolerance;
      const withinY = point.y >= frame.y - tolerance && point.y <= frame.y + frame.height + tolerance;
      const onAnEdge =
        Math.abs(point.x - frame.x) < tolerance ||
        Math.abs(point.x - (frame.x + frame.width)) < tolerance ||
        Math.abs(point.y - frame.y) < tolerance ||
        Math.abs(point.y - (frame.y + frame.height)) < tolerance;
      return withinX && withinY && onAnEdge;
    };

    const arriving = laid.transitions.find((t) => t.id === "start:1-Outer")!;
    const leaving = laid.transitions.find((t) => t.id === "Outer-Done")!;

    // The arrowhead lands on the frame, not on the member the core routed
    // through and not short of the frame in the title strip.
    const arrivesAt = arriving.points[arriving.points.length - 1];
    expect(onBoundary(arrivesAt), `arrives at ${JSON.stringify(arrivesAt)} for frame ${JSON.stringify(frame)}`).toBe(true);
    const leavesFrom = leaving.points[0];
    expect(onBoundary(leavesFrom), `leaves from ${JSON.stringify(leavesFrom)} for frame ${JSON.stringify(frame)}`).toBe(true);

    // And the member inside is untouched by either route: an edge that
    // reached the member's own box would pass straight through the frame.
    const inner = placed("Inner");
    for (const point of [arrivesAt, leavesFrom]) {
      const insideMember =
        point.x > inner.x &&
        point.x < inner.x + inner.width &&
        point.y > inner.y &&
        point.y < inner.y + inner.height;
      expect(insideMember, JSON.stringify(point)).toBe(false);
    }
  });

  it("lays a composite's own `direction LR` out sideways while the diagram stays top to bottom", () => {
    // dagre's `recursiveClusterLayout`, reached through the one field it
    // reads per cluster. Verified as coordinates: the members of the block
    // are side by side, while the diagram's own two ranks stay stacked.
    const laid = layoutStateDiagram(
      {
        states: [
          { id: "Before", kind: "state", descriptions: [], parentId: null, direction: null },
          { id: "Outer", kind: "composite", descriptions: [], parentId: null, direction: "LR" },
          { id: "First", kind: "state", descriptions: [], parentId: "Outer", direction: null },
          { id: "Second", kind: "state", descriptions: [], parentId: "Outer", direction: null },
        ],
        transitions: [
          { id: "Before-Outer", from: "Before", to: "Outer", label: null },
          { id: "First-Second", from: "First", to: "Second", label: null },
        ],
        timeline: { totalSteps: 0, entries: [] },
      },
      options,
    );

    const centre = (id: string) => {
      const state = laid.states.find((s) => s.id === id)!;
      return { x: state.x + state.width / 2, y: state.y + state.height / 2 };
    };

    // Sideways inside the block: `Second` is to the right of `First` and on
    // the same row, which is what `LR` means and `TB` does not.
    expect(centre("Second").x).toBeGreaterThan(centre("First").x);
    expect(Math.abs(centre("Second").y - centre("First").y)).toBeLessThan(1);
    // Top to bottom outside it: the document's own direction is untouched.
    expect(centre("Outer").y).toBeGreaterThan(centre("Before").y);

    // dagre drops the *routing* for every edge touching a cluster that
    // carries a `rankdir`; the shared core falls back to a boundary-clipped
    // straight segment, and this is the assertion that the fallback reaches
    // a state diagram's shapes too.
    for (const transition of laid.transitions) {
      expect(transition.points.length, transition.id).toBeGreaterThanOrEqual(2);
      const [head, ...rest] = transition.points;
      expect(
        rest.some((point) => point.x !== head.x || point.y !== head.y),
        transition.id,
      ).toBe(true);
    }
  });
});
