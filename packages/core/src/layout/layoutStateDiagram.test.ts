import { describe, expect, it } from "vitest";
import type { Direction, StateModel, TextMeasurer } from "../contracts";
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
  direction: Direction = "TB",
): StateModel {
  const ids =
    stateIds ??
    transitions
      .flatMap(({ from, to }) => [from, to])
      .filter((id, index, all) => all.indexOf(id) === index);
  return {
    direction,
    states: ids.map((id) => ({
      id,
      kind: "state" as const,
      descriptions: [],
      parentId: null,
      direction: null,
      note: null,
    })),
    transitions: transitions.map(({ from, to, label }) => ({
      id: `${from}-${to}`,
      from,
      to,
      label: label ?? null,
    })),
    styles: [],
    timeline: { totalSteps: 0, entries: [] },
  };
}

/**
 * Whether `point` sits on the outline of `box` — the check a routed
 * connector's ends are held to, since which of the four edges it leaves by
 * is the layout engine's business and being *on the figure* is not.
 */
function onBoundaryOf(
  box: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const withinX = point.x >= box.x - 0.5 && point.x <= box.x + box.width + 0.5;
  const withinY = point.y >= box.y - 0.5 && point.y <= box.y + box.height + 0.5;
  const onVerticalEdge = (near(point.x, box.x) || near(point.x, box.x + box.width)) && withinY;
  const onHorizontalEdge = (near(point.y, box.y) || near(point.y, box.y + box.height)) && withinX;
  return onVerticalEdge || onHorizontalEdge;
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

  it("lays the diagram out along the direction the document named", () => {
    // Measured (mermaid 11.17.2, `--markup`): with `direction LR` at the
    // document's own level, the three states of `Idle --> Busy --> Done` are
    // drawn at x = 28, 158, 288, every one of them at y = 18 — sideways, on
    // one row. The same document with no `direction` is the test above.
    const laid = layoutStateDiagram(
      model([{ from: "Idle", to: "Busy" }, { from: "Busy", to: "Done" }], undefined, "LR"),
      options,
    );

    const [idle, busy, done] = laid.states;
    expect(busy.x).toBeGreaterThan(idle.x);
    expect(done.x).toBeGreaterThan(busy.x);
    // On one row: a rank direction that had not reached dagre would leave
    // these three stacked, which is what the `x` comparisons alone could
    // still be satisfied by if the boxes merely differed in width.
    expect(busy.y).toBe(idle.y);
    expect(done.y).toBe(idle.y);
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

  it("gives a noted state a note box of its own, sized around the note's measured text", () => {
    // The note is a *figure*, not a second row inside the state's box —
    // measured (mermaid 11.17.2, `--markup`): it comes back as its own
    // `g.node.statediagram-note` with its own outline, beside the
    // `g.node.statediagram-state` it annotates, whose rect is untouched.
    // So the state keeps the box its own label earned, and the note gets
    // one measured around its own text.
    const noted = model([{ from: "Idle", to: "Busy" }]);
    noted.states[0].note = { position: "right of", text: "waiting for work" };

    const laid = layoutStateDiagram(noted, options);

    const [idle, busy] = laid.states;
    expect(busy.note).toBeNull();
    expect(idle.note).not.toBeNull();
    expect(idle.note!.text).toBe("waiting for work");
    expect(idle.note!.width).toBeGreaterThan(measuredWidth("waiting for work"));
    expect(idle.note!.height).toBeGreaterThan(
      fakeMeasurer.measure("waiting for work").height,
    );
    // The annotated state is sized from its own label and nothing else: a
    // note that widened the box it hangs off would be a row of the box
    // rather than a figure beside it.
    expect(idle.width).toBe(busy.width - (measuredWidth("Busy") - measuredWidth("Idle")));
  });

  it("puts a `right of` note after its state along the diagram's direction, and a `left of` one before", () => {
    // **What `left of` and `right of` actually decide**, measured from
    // mermaid 11.17.2's own construction: the note is a node of the layout
    // graph, and the position picks the *direction of the edge joining it to
    // its state* — `right of` builds `state → note`, `left of` builds
    // `note → state`. Everything else is the layout engine's rank order. So
    // under `direction LR` the two words are literally left and right, and
    // under the default `TB` they are above and below — which is Mermaid's
    // behaviour because it is Mermaid's mechanism, not a rule of Siren's.
    const sideways = (position: "left of" | "right of") => {
      const noted = model([{ from: "Idle", to: "Busy" }], undefined, "LR");
      noted.states[0].note = { position, text: "why" };
      const laid = layoutStateDiagram(noted, options);
      return laid.states[0];
    };

    const right = sideways("right of");
    expect(right.note!.x).toBeGreaterThan(right.x + right.width);

    const left = sideways("left of");
    expect(left.note!.x + left.note!.width).toBeLessThan(left.x);

    // Top to bottom, the same two words rank the note below and above.
    const downward = model([{ from: "Idle", to: "Busy" }]);
    downward.states[0].note = { position: "right of", text: "why" };
    const below = layoutStateDiagram(downward, options).states[0];
    expect(below.note!.y).toBeGreaterThan(below.y + below.height);
  });

  it("joins a note to its state with a connector, reported from the state to the note", () => {
    // Measured: Mermaid draws this connector as an edge of its own with
    // `arrowhead: "none"` (`path.note-edge`), so it is a real routed line
    // between the two figures rather than an implied adjacency.
    //
    // Always ordered state → note, whichever side the author wrote, so
    // nothing downstream has to re-read the position to know which end is
    // which: the edge itself runs the other way for `left of`.
    for (const position of ["left of", "right of"] as const) {
      const noted = model([{ from: "Idle", to: "Busy" }], undefined, "LR");
      noted.states[0].note = { position, text: "why" };

      const idle = layoutStateDiagram(noted, options).states[0];
      const connector = idle.note!.connector;

      expect(connector.length, position).toBeGreaterThanOrEqual(2);
      // The first point is on the state's own boundary and the last on the
      // note's — a connector reported the other way round fails here without
      // any coordinate changing, which is what makes the promised order a
      // fact rather than a comment.
      expect(onBoundaryOf(idle, connector[0]), `${position}: first point`).toBe(true);
      expect(
        onBoundaryOf(idle.note!, connector[connector.length - 1]),
        `${position}: last point`,
      ).toBe(true);
    }
  });

  it("keeps a note inside the frame of the composite whose state it annotates, and inside the canvas", () => {
    // A note is drawn at the level of the state it hangs off — so a note on
    // a state written inside `state Outer { }` belongs inside that frame,
    // and one that spilled out of it would read as annotating the block from
    // outside. The frame is grown here rather than by the shared core (see
    // `compositeFrames`), so the note box has to be grown into as well.
    const nested: StateModel = {
      direction: "TB",
      states: [
        { id: "Outer", kind: "composite", descriptions: [], parentId: null, direction: null, note: null },
        {
          id: "Inner",
          kind: "state",
          descriptions: [],
          parentId: "Outer",
          direction: null,
          note: { position: "right of", text: "a long note about the inner state" },
        },
        { id: "Done", kind: "state", descriptions: [], parentId: "Outer", direction: null, note: null },
      ],
      transitions: [{ id: "Inner-Done", from: "Inner", to: "Done", label: null }],
      styles: [],
      timeline: { totalSteps: 0, entries: [] },
    };

    const laid = layoutStateDiagram(nested, options);
    const [outer, inner] = laid.states;
    const note = inner.note!;

    expect(note.x).toBeGreaterThanOrEqual(outer.x);
    expect(note.y).toBeGreaterThanOrEqual(outer.y);
    expect(note.x + note.width).toBeLessThanOrEqual(outer.x + outer.width);
    expect(note.y + note.height).toBeLessThanOrEqual(outer.y + outer.height);

    // And the canvas covers it: a note placed outside the reported
    // width/height is clipped away by the `viewBox`, which is the same
    // invisible failure a loop routed off-canvas would be.
    expect(note.x + note.width).toBeLessThanOrEqual(laid.width);
    expect(note.y + note.height).toBeLessThanOrEqual(laid.height);
    for (const point of note.connector) {
      expect(point.x).toBeLessThanOrEqual(laid.width);
      expect(point.y).toBeLessThanOrEqual(laid.height);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("grows a frame around a note even where the shared core does not size the cluster from its members", () => {
    // The case `compositeFrames` documents and the one the test above is too
    // easy to catch it: a composite **nested inside one that carries a
    // `direction`** comes back from the shared core at exactly the size
    // handed in, with its members at coordinates outside it. A note is a
    // member like any other, so a frame grown from the states alone leaves
    // the note hanging out of the block — and, since the canvas is grown the
    // same way, off the edge of the picture entirely.
    const nested: StateModel = {
      direction: "TB",
      states: [
        { id: "Outer", kind: "composite", descriptions: [], parentId: null, direction: "LR", note: null },
        { id: "Inner", kind: "composite", descriptions: [], parentId: "Outer", direction: "LR", note: null },
        {
          id: "Deep",
          kind: "state",
          descriptions: [],
          parentId: "Inner",
          direction: null,
          note: { position: "right of", text: "a very long note about the deep state" },
        },
        { id: "Beside", kind: "state", descriptions: [], parentId: "Inner", direction: null, note: null },
      ],
      transitions: [{ id: "Deep-Beside", from: "Deep", to: "Beside", label: null }],
      styles: [],
      timeline: { totalSteps: 0, entries: [] },
    };

    const laid = layoutStateDiagram(nested, options);
    const [outer, inner, deep] = laid.states;
    const note = deep.note!;

    for (const frame of [inner, outer]) {
      expect(note.x, frame.id).toBeGreaterThanOrEqual(frame.x);
      expect(note.y, frame.id).toBeGreaterThanOrEqual(frame.y);
      expect(note.x + note.width, frame.id).toBeLessThanOrEqual(frame.x + frame.width);
      expect(note.y + note.height, frame.id).toBeLessThanOrEqual(frame.y + frame.height);
    }
    expect(note.x + note.width).toBeLessThanOrEqual(laid.width);
    expect(note.y + note.height).toBeLessThanOrEqual(laid.height);
  });

  it("lands a composite's own note on the frame's boundary, not inside it", () => {
    // A composite carries a note exactly as a state does — measured: mermaid
    // records it on the composite's own record. What differs is where the
    // connector has to stop: the shared core clipped the route to the
    // *cluster box* it placed, and a frame is grown outward from that box,
    // so a connector left where the core put it starts inside the frame by
    // exactly the padding and title strip this module added.
    const withNote: StateModel = {
      direction: "TB",
      states: [
        { id: "Before", kind: "state", descriptions: [], parentId: null, direction: null, note: null },
        {
          id: "Outer",
          // A title of its own, which is what grows the frame upward past
          // the cluster box the core placed — the growth the clip pays for.
          kind: "composite",
          descriptions: ["a very long composite title"],
          parentId: null,
          direction: null,
          note: { position: "left of", text: "about the block" },
        },
        { id: "Inner", kind: "state", descriptions: [], parentId: "Outer", direction: null, note: null },
        { id: "Done", kind: "state", descriptions: [], parentId: "Outer", direction: null, note: null },
      ],
      transitions: [
        { id: "Before-Outer", from: "Before", to: "Outer", label: null },
        { id: "Inner-Done", from: "Inner", to: "Done", label: null },
      ],
      styles: [],
      timeline: { totalSteps: 0, entries: [] },
    };

    const laid = layoutStateDiagram(withNote, options);
    const outer = laid.states[1];
    const note = outer.note!;

    expect(onBoundaryOf(outer, note.connector[0])).toBe(true);
    // And the note is a figure beside the block rather than one of the boxes
    // inside it: it does not overlap the frame at all, so it is never drawn
    // over the states the block holds. (Which *side* of the frame it lands on
    // is the layout engine's, as it is for every other figure here — this
    // fixture happens to put it to the left.)
    const overlaps =
      note.x < outer.x + outer.width &&
      outer.x < note.x + note.width &&
      note.y < outer.y + outer.height &&
      outer.y < note.y + note.height;
    expect(overlaps).toBe(false);
  });

  it("gives each pseudo-state a square box of its own size, not one measured around its generated id", () => {
    // A pseudo-state draws a disc and a ring, neither of which holds text —
    // so sizing it the way a state is sized would reserve room for
    // `start:1`, a string nothing draws, and push the whole diagram apart
    // around empty space. The box has to be square, too: an ellipse is not
    // the figure UML draws here.
    const laid = layoutStateDiagram(
      {
        direction: "TB",
        states: [
          { id: "start:1", kind: "start", descriptions: [], parentId: null, direction: null, note: null },
          { id: "Idle", kind: "state", descriptions: [], parentId: null, direction: null, note: null },
          { id: "end:1", kind: "end", descriptions: [], parentId: null, direction: null, note: null },
        ],
        transitions: [
          { id: "start:1-Idle", from: "start:1", to: "Idle", label: null },
          { id: "Idle-end:1", from: "Idle", to: "end:1", label: null },
        ],
        styles: [],
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
        direction: "TB",
        states: [
          { id: "s", kind: "state", descriptions: ["waiting for work"], parentId: null, direction: null, note: null },
          { id: "Undescribed", kind: "state", descriptions: [], parentId: null, direction: null, note: null },
        ],
        transitions: [{ id: "s-Undescribed", from: "s", to: "Undescribed", label: null }],
        styles: [],
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
        direction: "TB",
        states: [
          { id: "s", kind: "state", descriptions: ["first", "second", "third"], parentId: null, direction: null, note: null },
          { id: "t", kind: "state", descriptions: ["only"], parentId: null, direction: null, note: null },
        ],
        transitions: [{ id: "s-t", from: "s", to: "t", label: null }],
        styles: [],
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
        direction: "TB",
        states: [
          { id: "Outer", kind: "composite", descriptions: [], parentId: null, direction: null, note: null },
          { id: "Idle", kind: "state", descriptions: [], parentId: "Outer", direction: null, note: null },
          { id: "Busy", kind: "state", descriptions: [], parentId: "Outer", direction: null, note: null },
        ],
        transitions: [{ id: "Idle-Busy", from: "Idle", to: "Busy", label: null }],
        styles: [],
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
        direction: "TB",
        states: [
          { id: "Outer", kind: "composite", descriptions: [], parentId: null, direction: null, note: null },
          { id: "Inner", kind: "composite", descriptions: [], parentId: "Outer", direction: null, note: null },
          { id: "Deep", kind: "state", descriptions: [], parentId: "Inner", direction: null, note: null },
          { id: "Beside", kind: "state", descriptions: [], parentId: "Outer", direction: null, note: null },
        ],
        transitions: [{ id: "Deep-Beside", from: "Deep", to: "Beside", label: null }],
        styles: [],
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
        direction: "TB",
        states: [
          { id: "start:1", kind: "start", descriptions: [], parentId: null, direction: null, note: null },
          { id: "Outer", kind: "composite", descriptions: [], parentId: null, direction: null, note: null },
          { id: "Inner", kind: "state", descriptions: [], parentId: "Outer", direction: null, note: null },
          { id: "Done", kind: "state", descriptions: [], parentId: null, direction: null, note: null },
        ],
        transitions: [
          { id: "start:1-Outer", from: "start:1", to: "Outer", label: null },
          { id: "Outer-Done", from: "Outer", to: "Done", label: null },
        ],
        styles: [],
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
        direction: "TB",
        states: [
          { id: "Before", kind: "state", descriptions: [], parentId: null, direction: null, note: null },
          { id: "Outer", kind: "composite", descriptions: [], parentId: null, direction: "LR", note: null },
          { id: "First", kind: "state", descriptions: [], parentId: "Outer", direction: null, note: null },
          { id: "Second", kind: "state", descriptions: [], parentId: "Outer", direction: null, note: null },
        ],
        transitions: [
          { id: "Before-Outer", from: "Before", to: "Outer", label: null },
          { id: "First-Second", from: "First", to: "Second", label: null },
        ],
        styles: [],
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

  it("carries each state's resolved author style onto the box, and leaves an unstyled one empty", () => {
    // Layout carries the model's answer rather than reconciling anything:
    // `resolveStyles` has already merged everything one state was styled by
    // and dropped the rejected values, and a state absent from `styles` is
    // one the renderer must give no `style` attribute at all. The empty
    // halves are what let it ask without testing for `undefined`.
    const base = model([{ from: "Idle", to: "Busy" }]);
    const laid = layoutStateDiagram(
      {
        ...base,
        styles: [
          {
            targetId: "Busy",
            style: {
              frame: [{ property: "fill", value: "#f96" }],
              text: [{ property: "fill", value: "#fff" }],
            },
          },
        ],
      },
      options,
    );

    expect(laid.states.find((s) => s.id === "Busy")!.style).toEqual({
      frame: [{ property: "fill", value: "#f96" }],
      text: [{ property: "fill", value: "#fff" }],
    });
    expect(laid.states.find((s) => s.id === "Idle")!.style).toEqual({ frame: [], text: [] });
  });
});
