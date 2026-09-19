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
    states: ids.map((id) => ({ id, kind: "state" as const, descriptions: [] })),
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
          { id: "start:1", kind: "start", descriptions: [] },
          { id: "Idle", kind: "state", descriptions: [] },
          { id: "end:1", kind: "end", descriptions: [] },
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
          { id: "s", kind: "state", descriptions: ["waiting for work"] },
          { id: "Undescribed", kind: "state", descriptions: [] },
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
          { id: "s", kind: "state", descriptions: ["first", "second", "third"] },
          { id: "t", kind: "state", descriptions: ["only"] },
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
});
