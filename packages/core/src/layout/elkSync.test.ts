import { describe, expect, it } from "vitest";
import { LayoutEngineError, layoutWithElk } from "./elkSync";

describe("layoutWithElk, the synchronous ELK wrapper", () => {
  // The alarm for an elkjs upgrade. `render()` is synchronous, and the only
  // thing standing between it and elkjs's Promise is this wrapper driving the
  // engine's internal dispatcher directly. If a new elkjs answers through a
  // queue instead, the result would arrive after a microtask or a timer —
  // and both of those are still pending here when the call returns.
  it("returns the laid-out graph before a queued microtask or a zero-delay timer has run", () => {
    let microtaskRan = false;
    let timerRan = false;
    queueMicrotask(() => {
      microtaskRan = true;
    });
    const timer = setTimeout(() => {
      timerRan = true;
    }, 0);

    const laidOut = layoutWithElk({
      id: "root",
      layoutOptions: { "elk.algorithm": "layered", "elk.direction": "DOWN" },
      children: [
        { id: "A", width: 40, height: 20 },
        { id: "B", width: 40, height: 20 },
      ],
      edges: [{ id: "A-B", sources: ["A"], targets: ["B"] }],
    });

    expect(microtaskRan).toBe(false);
    expect(timerRan).toBe(false);
    clearTimeout(timer);

    const [a, b] = laidOut.children!;
    expect(Number.isFinite(a.x) && Number.isFinite(b.y)).toBe(true);
    // DOWN: the edge's target is laid out below its source.
    expect(b.y!).toBeGreaterThan(a.y! + a.height!);
  });

  // ELK throws a GWT exception for a graph it cannot read — here an edge to a
  // node that does not exist — and it reaches the dispatcher's reply rather
  // than the caller's stack. What the caller gets is Siren's own error, so
  // `render()` can turn it into a diagnostic by type.
  it("throws LayoutEngineError, naming what the engine said, for a graph ELK rejects", () => {
    const attempt = () =>
      layoutWithElk({
        id: "root",
        children: [{ id: "A", width: 40, height: 20 }],
        edges: [{ id: "A-ghost", sources: ["A"], targets: ["ghost"] }],
      });

    expect(attempt).toThrow(LayoutEngineError);
    expect(attempt).toThrow(/ghost/);
  });
});
