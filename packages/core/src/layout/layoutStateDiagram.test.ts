import { describe, expect, it } from "vitest";
import type { Direction, Label, StateModel, TextMeasurer } from "../contracts";
import { plainLabel, plainRun } from "../label/label";
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
      stereotype: null,
      descriptions: [],
      parentId: null,
      direction: null,
      note: null,
    })),
    transitions: transitions.map(({ from, to, label }) => ({
      id: `${from}-${to}`,
      from,
      to,
      // A fixture's label is one plain run — what `readLabel` reads any
      // label with no tag in it as.
      label: label === undefined || label === null ? null : plainLabel(label),
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
    expect(laid.transitions[0].label).toEqual(plainLabel("start"));
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
    noted.states[0].note = { position: "right of", label: plainLabel("waiting for work") };

    const laid = layoutStateDiagram(noted, options);

    const [idle, busy] = laid.states;
    expect(busy.note).toBeNull();
    expect(idle.note).not.toBeNull();
    expect(idle.note!.label).toEqual(plainLabel("waiting for work"));
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
      noted.states[0].note = { position, label: plainLabel("why") };
      const laid = layoutStateDiagram(noted, options);
      return laid.states[0];
    };

    const right = sideways("right of");
    expect(right.note!.x).toBeGreaterThan(right.x + right.width);

    const left = sideways("left of");
    expect(left.note!.x + left.note!.width).toBeLessThan(left.x);

    // Top to bottom, the same two words rank the note below and above.
    const downward = model([{ from: "Idle", to: "Busy" }]);
    downward.states[0].note = { position: "right of", label: plainLabel("why") };
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
      noted.states[0].note = { position, label: plainLabel("why") };

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
        { id: "Outer", kind: "composite", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
        {
          id: "Inner",
          kind: "state",
          stereotype: null,
          descriptions: [],
          parentId: "Outer",
          direction: null,
          note: { position: "right of", label: plainLabel("a long note about the inner state") },
        },
        { id: "Done", kind: "state", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
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
        { id: "Outer", kind: "composite", stereotype: null, descriptions: [], parentId: null, direction: "LR", note: null },
        { id: "Inner", kind: "composite", stereotype: null, descriptions: [], parentId: "Outer", direction: "LR", note: null },
        {
          id: "Deep",
          kind: "state",
          stereotype: null,
          descriptions: [],
          parentId: "Inner",
          direction: null,
          note: { position: "right of", label: plainLabel("a very long note about the deep state") },
        },
        { id: "Beside", kind: "state", stereotype: null, descriptions: [], parentId: "Inner", direction: null, note: null },
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
        { id: "Before", kind: "state", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
        {
          id: "Outer",
          // A title of its own, which is what grows the frame upward past
          // the cluster box the core placed — the growth the clip pays for.
          kind: "composite",
          stereotype: null,
          descriptions: [plainLabel("a very long composite title")],
          parentId: null,
          direction: null,
          note: { position: "left of", label: plainLabel("about the block") },
        },
        { id: "Inner", kind: "state", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
        { id: "Done", kind: "state", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
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
          { id: "start:1", kind: "start", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
          { id: "Idle", kind: "state", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
          { id: "end:1", kind: "end", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
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

  it("sizes a stereotyped state from its figure rather than its label, and gives it no rows to draw", () => {
    // Measured (mermaid 11.17.2, scripts/mermaid-probe.mjs --markup, and
    // again with a script reading each path's extent): under the default
    // `TB`,
    //
    //   <<choice>>  a diamond spanning x[-14,14] y[-14,14] — 28 × 28
    //   <<fork>>    a bar spanning x[-35,35] y[-5,5]       — 70 × 10
    //   <<join>>    the same bar, path for path
    //
    // and none of the three is drawn with a label: Mermaid's `forkJoin`
    // shape sets `node.label = ""`, and the `<g>` for each comes back with
    // no `g.label` child at all, while `Idle`'s beside it has one. So the
    // box is sized from the figure, and the id — which stays the author's
    // and stays what a transition names — is addressing-only here, exactly
    // as it is for a described state.
    const laid = layoutStateDiagram(
      {
        direction: "TB",
        states: [
          { id: "Choice", kind: "state", stereotype: "choice", descriptions: [], parentId: null, direction: null, note: null },
          { id: "Split", kind: "state", stereotype: "fork", descriptions: [], parentId: null, direction: null, note: null },
          { id: "Merge", kind: "state", stereotype: "join", descriptions: [], parentId: null, direction: null, note: null },
        ],
        transitions: [
          { id: "Choice-Split", from: "Choice", to: "Split", label: null },
          { id: "Split-Merge", from: "Split", to: "Merge", label: null },
        ],
        styles: [],
        timeline: { totalSteps: 0, entries: [] },
      },
      options,
    );

    const byId = new Map(laid.states.map((state) => [state.id, state]));
    expect([byId.get("Choice")!.width, byId.get("Choice")!.height]).toEqual([28, 28]);
    expect([byId.get("Split")!.width, byId.get("Split")!.height]).toEqual([70, 10]);
    expect([byId.get("Merge")!.width, byId.get("Merge")!.height]).toEqual([70, 10]);

    // No text, so nothing for the renderer to draw — and nothing measured
    // from the id, which is why `Merge` and `Split` are the same size
    // despite being different lengths.
    expect(laid.states.map((state) => state.labels)).toEqual([[], [], []]);
    expect(laid.states.map((state) => state.dividerY)).toEqual([null, null, null]);

    // The stereotype survives layout, because it is the only thing left that
    // says which figure the renderer draws — `kind` says `state` for all
    // three.
    expect(laid.states.map((state) => [state.kind, state.stereotype])).toEqual([
      ["state", "choice"],
      ["state", "fork"],
      ["state", "join"],
    ]);
  });

  it("turns a fork's bar through a right angle when its own level runs left to right", () => {
    // Measured (mermaid 11.17.2): the bar is 70 × 10 under `TB`, `BT`, `RL`
    // and `TD`, and 10 × 70 under `LR` alone — Mermaid's `forkJoin` shape
    // tests `dir === "LR"` exactly, so `RL` gets the horizontal bar despite
    // also being a left-right direction. That is Mermaid's drawing and Siren
    // follows it: the document says nothing about which way the bar points,
    // so there is nothing here for it to contradict.
    //
    // **Its own level's direction, and no other's.** Measured four ways: a
    // fork inside `state Outer { direction LR }` is vertical while the
    // document is `TB`; one inside `{ direction TB }` is horizontal while
    // the document is `LR`; and one inside a composite naming *no*
    // direction is horizontal even under a document-level `direction LR` —
    // Mermaid lays that composite out top-to-bottom too, so the level's own
    // statement is the whole of the answer and nothing cascades.
    const forkIn = (documentDirection: Direction, compositeDirection: Direction | null) =>
      layoutStateDiagram(
        {
          direction: documentDirection,
          states: [
            { id: "Outer", kind: "composite", stereotype: null, descriptions: [], parentId: null, direction: compositeDirection, note: null },
            { id: "Split", kind: "state", stereotype: "fork", descriptions: [], parentId: "Outer", direction: null, note: null },
            { id: "A", kind: "state", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
          ],
          transitions: [{ id: "A-Split", from: "A", to: "Split", label: null }],
          styles: [],
          timeline: { totalSteps: 0, entries: [] },
        },
        options,
      ).states.find((state) => state.id === "Split")!;

    // The level's own `LR`, wherever it came from.
    expect([forkIn("TB", "LR").width, forkIn("TB", "LR").height]).toEqual([10, 70]);
    // And the level's own anything-else, including a document `LR` the
    // composite never repeated.
    expect([forkIn("TB", "TB").width, forkIn("TB", "TB").height]).toEqual([70, 10]);
    expect([forkIn("LR", "TB").width, forkIn("LR", "TB").height]).toEqual([70, 10]);
    expect([forkIn("LR", null).width, forkIn("LR", null).height]).toEqual([70, 10]);

    // At the document's own level there is no composite to ask, so the
    // document's direction is that level's.
    const atRoot = (direction: Direction) =>
      layoutStateDiagram(
        {
          direction,
          states: [
            { id: "Split", kind: "state", stereotype: "fork", descriptions: [], parentId: null, direction: null, note: null },
            { id: "A", kind: "state", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
          ],
          transitions: [{ id: "A-Split", from: "A", to: "Split", label: null }],
          styles: [],
          timeline: { totalSteps: 0, entries: [] },
        },
        options,
      ).states.find((state) => state.id === "Split")!;

    expect([atRoot("LR").width, atRoot("LR").height]).toEqual([10, 70]);
    for (const direction of ["TB", "BT", "RL"] as const) {
      expect(
        [atRoot(direction).width, atRoot(direction).height],
        `under direction ${direction}`,
      ).toEqual([70, 10]);
    }

    // A choice is a diamond whichever way the level runs — measured: the
    // path's extent is x[-14,14] y[-14,14] under `TB` and under `LR` alike.
    const choiceAt = (direction: Direction) =>
      layoutStateDiagram(
        {
          direction,
          states: [
            { id: "Choice", kind: "state", stereotype: "choice", descriptions: [], parentId: null, direction: null, note: null },
            { id: "A", kind: "state", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
          ],
          transitions: [{ id: "A-Choice", from: "A", to: "Choice", label: null }],
          styles: [],
          timeline: { totalSteps: 0, entries: [] },
        },
        options,
      ).states.find((state) => state.id === "Choice")!;

    expect([choiceAt("TB").width, choiceAt("TB").height]).toEqual([28, 28]);
    expect([choiceAt("LR").width, choiceAt("LR").height]).toEqual([28, 28]);
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
          { id: "s", kind: "state", stereotype: null, descriptions: [plainLabel("waiting for work")], parentId: null, direction: null, note: null },
          { id: "Undescribed", kind: "state", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
        ],
        transitions: [{ id: "s-Undescribed", from: "s", to: "Undescribed", label: null }],
        styles: [],
        timeline: { totalSteps: 0, entries: [] },
      },
      options,
    );

    const [described, plain] = laid.states;
    expect(described.width).toBeGreaterThan(measuredWidth("waiting for work"));
    expect(described.labels.map((planned) => planned.label.text)).toEqual(["waiting for work"]);
    expect(plain.labels.map((planned) => planned.label.text)).toEqual(["Undescribed"]);

    // One description draws no divider: measured, Mermaid gives it the same
    // plain rounded rect an undescribed state gets, the description simply
    // standing where the id would have.
    expect(described.dividerY).toBeNull();
    expect(plain.dividerY).toBeNull();

    // Every row is somewhere inside the box that was sized for it.
    for (const state of laid.states) {
      for (const row of state.labels) {
        expect(row.y, `${state.id}: ${row.label.text}`).toBeGreaterThan(state.y);
        expect(row.y, `${state.id}: ${row.label.text}`).toBeLessThan(state.y + state.height);
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
          { id: "s", kind: "state", stereotype: null, descriptions: [plainLabel("first"), plainLabel("second"), plainLabel("third")], parentId: null, direction: null, note: null },
          { id: "t", kind: "state", stereotype: null, descriptions: [plainLabel("only")], parentId: null, direction: null, note: null },
        ],
        transitions: [{ id: "s-t", from: "s", to: "t", label: null }],
        styles: [],
        timeline: { totalSteps: 0, entries: [] },
      },
      options,
    );

    const [titled, plain] = laid.states;
    expect(titled.labels.map((planned) => planned.label.text)).toEqual(["first", "second", "third"]);
    expect(titled.dividerY).not.toBeNull();
    // Inside its own box, which is what makes it a divider rather than a
    // line drawn across the canvas.
    expect(titled.dividerY!).toBeGreaterThan(titled.y);
    expect(titled.dividerY!).toBeLessThan(titled.y + titled.height);
    // The first description titles the box; every other one is below the
    // line. This is the half most easily got backwards.
    expect(titled.labels[0].y).toBeLessThan(titled.dividerY!);
    for (const row of titled.labels.slice(1)) {
      expect(row.y, row.label.text).toBeGreaterThan(titled.dividerY!);
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
          { id: "Outer", kind: "composite", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
          { id: "Idle", kind: "state", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
          { id: "Busy", kind: "state", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
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
    expect(frame.labels.map((planned) => planned.label.text)).toEqual(["Outer"]);
    expect(frame.labels[0].y).toBeLessThan(Math.min(placed("Idle").y, placed("Busy").y));
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
          { id: "Outer", kind: "composite", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
          { id: "Inner", kind: "composite", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
          { id: "Deep", kind: "state", stereotype: null, descriptions: [], parentId: "Inner", direction: null, note: null },
          { id: "Beside", kind: "state", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
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
    expect(placed("Outer").labels[0].y + rowHalf).toBeLessThanOrEqual(placed("Inner").y);
    expect(placed("Inner").labels[0].y + rowHalf).toBeLessThanOrEqual(placed("Deep").y);
  });

  it("draws each concurrent region as a frame of its own, side by side inside the block", () => {
    // `state Active { A --> B  --  C --> D }` after the model has minted the
    // region ids. Two facts, both measured off mermaid 11.17.2 by rendering
    // the document and reading the node transforms out of the SVG:
    //
    // - each region holds its own members and nothing else, inside the
    //   block's frame;
    // - the two regions sit **side by side** under the default `TB` — their
    //   group transforms came back `translate(35, 37.5)` and
    //   `translate(125, 37.5)`, one y and two x — while each region's own
    //   members stack in a column (A at y 68, B at y 208).
    //
    // The second is what falls out of the graph rather than being arranged
    // here: two clusters with no edge between them share a rank, and a rank
    // runs across the flow.
    const laid = layoutStateDiagram(
      {
        direction: "TB",
        states: [
          { id: "Active", kind: "composite", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
          { id: "region:1", kind: "region", stereotype: null, descriptions: [], parentId: "Active", direction: null, note: null },
          { id: "region:2", kind: "region", stereotype: null, descriptions: [], parentId: "Active", direction: null, note: null },
          { id: "A", kind: "state", stereotype: null, descriptions: [], parentId: "region:1", direction: null, note: null },
          { id: "B", kind: "state", stereotype: null, descriptions: [], parentId: "region:1", direction: null, note: null },
          { id: "C", kind: "state", stereotype: null, descriptions: [], parentId: "region:2", direction: null, note: null },
          { id: "D", kind: "state", stereotype: null, descriptions: [], parentId: "region:2", direction: null, note: null },
        ],
        transitions: [
          { id: "A-B", from: "A", to: "B", label: null },
          { id: "C-D", from: "C", to: "D", label: null },
        ],
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

    for (const [regionId, memberIds] of [
      ["region:1", ["A", "B"]],
      ["region:2", ["C", "D"]],
    ] as const) {
      expect(encloses(placed("Active"), placed(regionId)), `Active encloses ${regionId}`).toBe(true);
      for (const memberId of memberIds) {
        expect(encloses(placed(regionId), placed(memberId)), `${regionId} encloses ${memberId}`).toBe(true);
      }
    }

    // And each region holds *only* its own: the other region's members lie
    // outside it, which is the half an enclosure check on the right pairs
    // alone would let through.
    expect(encloses(placed("region:1"), placed("C")), "region:1 encloses C").toBe(false);
    expect(encloses(placed("region:2"), placed("A")), "region:2 encloses A").toBe(false);

    // Side by side, not stacked: the two frames overlap in y and are
    // disjoint in x, which is what "concurrent" looks like under `TB`.
    const [one, two] = [placed("region:1"), placed("region:2")];
    const disjointInX =
      one.x + one.width <= two.x || two.x + two.width <= one.x;
    expect(disjointInX, "the two regions are side by side").toBe(true);
    expect(one.y).toBe(two.y);

    // A region draws no title: it has no name to draw, and mermaid's own
    // divider group comes back with no label element in it at all.
    expect(placed("region:1").labels).toEqual([]);
    expect(placed("region:1").dividerY).toBeNull();
  });

  it("places every node of a region carrying a direction that holds a nested composite", () => {
    // **The shape that produced `01M2WQV0`**: a cluster carrying a
    // `rankdir` whose direct child is another cluster. The layout engine
    // expands such a cluster exactly one level, leaving the nested frame
    // unexpanded and everything inside it without coordinates — which used
    // to be a whole board of NaN with no diagnostic and is now
    // `UnplacedNodesError`.
    //
    // A concurrent region reaches that shape on ordinary input, because a
    // region may both declare a `direction` of its own (measured — the
    // statement belongs to the region it sits in) and hold a `state Inner {`
    // block. The compensation in the shared core (`rankdirFor`) gives a
    // cluster with a *directed ancestor* the graph's own rankdir, at any
    // depth, so the nested frame is expanded too; this is what says that
    // compensation reaches a region and that nothing here has to change it.
    //
    // Both directions of nesting, because they fail differently: a region
    // that declares the direction and holds a frame, and a composite that
    // declares one and holds the divided block.
    const regionHoldingAFrame = () =>
      layoutStateDiagram(
        {
          direction: "TB",
          states: [
            { id: "Active", kind: "composite", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
            { id: "region:1", kind: "region", stereotype: null, descriptions: [], parentId: "Active", direction: "LR", note: null },
            { id: "region:2", kind: "region", stereotype: null, descriptions: [], parentId: "Active", direction: null, note: null },
            { id: "Inner", kind: "composite", stereotype: null, descriptions: [], parentId: "region:1", direction: null, note: null },
            { id: "X", kind: "state", stereotype: null, descriptions: [], parentId: "Inner", direction: null, note: null },
            { id: "Y", kind: "state", stereotype: null, descriptions: [], parentId: "Inner", direction: null, note: null },
            { id: "C", kind: "state", stereotype: null, descriptions: [], parentId: "region:2", direction: null, note: null },
            { id: "D", kind: "state", stereotype: null, descriptions: [], parentId: "region:2", direction: null, note: null },
          ],
          transitions: [
            { id: "X-Y", from: "X", to: "Y", label: null },
            { id: "C-D", from: "C", to: "D", label: null },
          ],
          styles: [],
          timeline: { totalSteps: 0, entries: [] },
        },
        options,
      );

    const compositeHoldingADividedBlock = () =>
      layoutStateDiagram(
        {
          direction: "TB",
          states: [
            { id: "Outer", kind: "composite", stereotype: null, descriptions: [], parentId: null, direction: "LR", note: null },
            { id: "Active", kind: "composite", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
            { id: "region:1", kind: "region", stereotype: null, descriptions: [], parentId: "Active", direction: null, note: null },
            { id: "region:2", kind: "region", stereotype: null, descriptions: [], parentId: "Active", direction: null, note: null },
            { id: "A", kind: "state", stereotype: null, descriptions: [], parentId: "region:1", direction: null, note: null },
            { id: "B", kind: "state", stereotype: null, descriptions: [], parentId: "region:1", direction: null, note: null },
            { id: "C", kind: "state", stereotype: null, descriptions: [], parentId: "region:2", direction: null, note: null },
            { id: "D", kind: "state", stereotype: null, descriptions: [], parentId: "region:2", direction: null, note: null },
          ],
          transitions: [
            { id: "A-B", from: "A", to: "B", label: null },
            { id: "C-D", from: "C", to: "D", label: null },
          ],
          styles: [],
          timeline: { totalSteps: 0, entries: [] },
        },
        options,
      );

    for (const [name, run] of [
      ["a region carrying the direction", regionHoldingAFrame],
      ["a composite carrying it above the regions", compositeHoldingADividedBlock],
    ] as const) {
      expect(run, name).not.toThrow();
      const laid = run();
      // Not merely "it did not throw": every box has four finite numbers,
      // which is what `UnplacedNodesError` is a guard against, and the
      // canvas covers them.
      for (const state of laid.states) {
        for (const value of [state.x, state.y, state.width, state.height]) {
          expect(Number.isFinite(value), `${name}: ${state.id}`).toBe(true);
        }
        expect(state.x, `${name}: ${state.id}`).toBeGreaterThanOrEqual(0);
        expect(state.y, `${name}: ${state.id}`).toBeGreaterThanOrEqual(0);
        expect(state.x + state.width, `${name}: ${state.id}`).toBeLessThanOrEqual(laid.width);
        expect(state.y + state.height, `${name}: ${state.id}`).toBeLessThanOrEqual(laid.height);
      }
    }

    // And the direction a region declares governs **its own** members and
    // stops there — the rule `rankdirFor` already states for a cluster
    // inside a directed one, and a prediction this test overturned on the
    // way in: `Inner` names no direction of its own, so `X` and `Y` stack
    // down the column even though the region holding `Inner` runs `LR`.
    // That is the core's documented meaning and Mermaid's (a frame that
    // says nothing takes the document's direction, not its parent's).
    const nested = regionHoldingAFrame();
    const inNested = (id: string) => nested.states.find((state) => state.id === id)!;
    expect(inNested("X").x).toBe(inNested("Y").x);

    // Said directly, on a region whose own members are ordinary states:
    // `LR` puts them in a row, where the undirected region beside it keeps
    // its column.
    const laid = layoutStateDiagram(
      {
        direction: "TB",
        states: [
          { id: "Active", kind: "composite", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
          { id: "region:1", kind: "region", stereotype: null, descriptions: [], parentId: "Active", direction: "LR", note: null },
          { id: "region:2", kind: "region", stereotype: null, descriptions: [], parentId: "Active", direction: null, note: null },
          { id: "A", kind: "state", stereotype: null, descriptions: [], parentId: "region:1", direction: null, note: null },
          { id: "B", kind: "state", stereotype: null, descriptions: [], parentId: "region:1", direction: null, note: null },
          { id: "C", kind: "state", stereotype: null, descriptions: [], parentId: "region:2", direction: null, note: null },
          { id: "D", kind: "state", stereotype: null, descriptions: [], parentId: "region:2", direction: null, note: null },
        ],
        transitions: [
          { id: "A-B", from: "A", to: "B", label: null },
          { id: "C-D", from: "C", to: "D", label: null },
        ],
        styles: [],
        timeline: { totalSteps: 0, entries: [] },
      },
      options,
    );
    const placed = (id: string) => laid.states.find((state) => state.id === id)!;
    expect(placed("A").y, "the LR region lays its members out in a row").toBe(placed("B").y);
    expect(placed("A").x).toBeLessThan(placed("B").x);
    expect(placed("C").x, "the undirected region keeps its column").toBe(placed("D").x);
    expect(placed("C").y).toBeLessThan(placed("D").y);
  });

  it("lays an undirected region out along the document's direction, inheriting 01M36SJDN", () => {
    // **A divergence recorded, not introduced.** `01M36SJDN` says that
    // under a document-level `LR` a composite naming no direction of its
    // own lays out left-to-right here and top-to-bottom in mermaid, with no
    // diagnostic. A concurrent region is exactly such an undirected nested
    // frame, so it sits on top of that divergence and inherits it whole.
    //
    // Measured (mermaid 11.17.2, rendering `direction LR` above
    // `state Active { A --> B -- C --> D }` and reading the transforms): the
    // region groups came back `translate(35, 37.5)` and
    // `translate(125, 37.5)` and their members at y 68 and y 208 —
    // **identical, coordinate for coordinate, to the same document with no
    // `direction` at all.** Mermaid's document-level `LR` reaches neither
    // the regions' arrangement nor their contents.
    //
    // Siren's shared core gives an undirected cluster the graph's own
    // `rankdir` (see `rankdirFor`), so here `LR` reaches both. This pins
    // that difference so it is a measured fact rather than a surprise, and
    // so that a fix to `01M36SJDN` — which lives in the shared core and is
    // not this construct's to make — turns up here as a red test rather
    // than as silence.
    const laid = layoutStateDiagram(
      {
        direction: "LR",
        states: [
          { id: "Active", kind: "composite", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
          { id: "region:1", kind: "region", stereotype: null, descriptions: [], parentId: "Active", direction: null, note: null },
          { id: "region:2", kind: "region", stereotype: null, descriptions: [], parentId: "Active", direction: null, note: null },
          { id: "A", kind: "state", stereotype: null, descriptions: [], parentId: "region:1", direction: null, note: null },
          { id: "B", kind: "state", stereotype: null, descriptions: [], parentId: "region:1", direction: null, note: null },
          { id: "C", kind: "state", stereotype: null, descriptions: [], parentId: "region:2", direction: null, note: null },
          { id: "D", kind: "state", stereotype: null, descriptions: [], parentId: "region:2", direction: null, note: null },
        ],
        transitions: [
          { id: "A-B", from: "A", to: "B", label: null },
          { id: "C-D", from: "C", to: "D", label: null },
        ],
        styles: [],
        timeline: { totalSteps: 0, entries: [] },
      },
      options,
    );
    const placed = (id: string) => laid.states.find((state) => state.id === id)!;

    // A region's members run along the document's `LR` here; mermaid keeps
    // them in a column.
    expect(placed("A").y, "Siren turns an undirected region with the document").toBe(
      placed("B").y,
    );
    expect(placed("A").x).toBeLessThan(placed("B").x);

    // And the regions themselves are stacked rather than side by side,
    // because a rank runs across the flow and the flow is now horizontal —
    // where mermaid keeps them side by side whatever the document says.
    const [one, two] = [placed("region:1"), placed("region:2")];
    expect(one.x, "the regions stack once the flow turns").toBe(two.x);
    expect(one.y + one.height).toBeLessThanOrEqual(two.y);
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
          { id: "start:1", kind: "start", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
          { id: "Outer", kind: "composite", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
          { id: "Inner", kind: "state", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
          { id: "Done", kind: "state", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
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
          { id: "Before", kind: "state", stereotype: null, descriptions: [], parentId: null, direction: null, note: null },
          { id: "Outer", kind: "composite", stereotype: null, descriptions: [], parentId: null, direction: "LR", note: null },
          { id: "First", kind: "state", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
          { id: "Second", kind: "state", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
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

/**
 * A label is measured by `layoutLabel` wherever a state diagram draws one,
 * so a `<br>` (ADR-0015) costs its box a row. The fake measurer answers 24
 * for every row's height and adds no padding (it measures `""` as 0 wide),
 * so every expected size below is arithmetic on those two numbers and on
 * this module's own paddings.
 */
describe("layoutStateDiagram — labels", () => {
  /** A label of these rows, each one plain run — what `a<br/>b` reads as. */
  const rowsLabel = (...rows: string[]): Label => ({
    text: rows.join("\n"),
    rows: rows.map((row) => [plainRun(row)]),
  });

  /** One state `s` carrying these descriptions, alone in the diagram. */
  const described = (...descriptions: Label[]): StateModel => ({
    ...model([], ["s"]),
    states: [
      { id: "s", kind: "state", stereotype: null, descriptions, parentId: null, direction: null, note: null },
    ],
  });

  it("gives a description of two rows a box two rows tall, sized to its widest row", () => {
    const [state] = layoutStateDiagram(described(rowsLabel("ab", "wxyz")), options).states;

    // STATE_PADDING_Y (8) above and below two 24px rows.
    expect(state.height).toBe(8 + 24 + 24 + 8);
    // STATE_PADDING_X (14) either side of the widest row, "wxyz" (32).
    expect(state.width).toBe(14 + 32 + 14);
    expect(state.labels).toHaveLength(1);
    expect(state.labels[0].labelBox.rows).toHaveLength(2);
    // Centred on the box, which is what the label's two rows share.
    expect(state.labels[0].y).toBe(state.y + state.height / 2);
  });

  it("puts the divider under every row of the first description, when each description has rows of its own", () => {
    // Measured (mermaid 11.17.2, `--markup`): `s1 : a<br/>b` then
    // `s1 : c<br>d` draws two label groups of two rows each, with
    // `line.divider` between the groups.
    const [state] = layoutStateDiagram(
      described(rowsLabel("a", "b"), rowsLabel("c", "d")),
      options,
    ).states;

    // Padding, the first label's two rows, padding: the line.
    expect(state.dividerY).toBe(state.y + 8 + 48 + 8);
    // Padding below the line, then the second label's two rows centred.
    expect(state.labels.map((planned) => planned.y)).toEqual([
      state.y + 8 + 24,
      state.y + 8 + 48 + 8 + 8 + 24,
    ]);
    expect(state.height).toBe(8 + 48 + 8 + 8 + 48 + 8);
  });

  it("gives a composite's title strip a row for every row of its title", () => {
    const laid = layoutStateDiagram(
      {
        ...model([], ["Outer", "Inner"]),
        states: [
          { id: "Outer", kind: "composite", stereotype: null, descriptions: [rowsLabel("c", "d")], parentId: null, direction: null, note: null },
          { id: "Inner", kind: "state", stereotype: null, descriptions: [], parentId: "Outer", direction: null, note: null },
        ],
      },
      options,
    );
    const [outer, inner] = laid.states;

    expect(outer.labels).toHaveLength(1);
    expect(outer.labels[0].labelBox.rows).toHaveLength(2);
    // COMPOSITE_PADDING (12) above a title two rows tall.
    expect(outer.labels[0].y).toBe(outer.y + 12 + 24);
    // And the member starts below both rows, not below the first.
    expect(inner.y).toBeGreaterThanOrEqual(outer.y + 12 + 48);
  });

  it("gives a note of two rows a box two rows tall", () => {
    const noted = described(rowsLabel("s"));
    noted.states[0].note = { position: "right of", label: rowsLabel("ab", "wxyz") };

    const note = layoutStateDiagram(noted, options).states[0].note!;

    // NOTE_PADDING_Y (8) above and below, NOTE_PADDING_X (10) either side.
    expect(note.height).toBe(8 + 48 + 8);
    expect(note.width).toBe(10 + 32 + 10);
    expect(note.labelBox.rows).toHaveLength(2);
  });

  it("measures a transition label of two rows, and keeps the canvas around both", () => {
    const labelled = model([{ from: "a", to: "b" }]);
    labelled.transitions[0].label = rowsLabel("ab", "wxyz");

    const laid = layoutStateDiagram(labelled, options);
    const [transition] = laid.transitions;

    expect(transition.labelBox).not.toBeNull();
    expect(transition.labelBox!.height).toBe(48);
    expect(transition.labelBox!.width).toBe(32);
    // The anchor is the box's centre, so its lower row ends 24 below it.
    expect(laid.height).toBeGreaterThanOrEqual(transition.labelAnchor!.y + 24);
  });
});
