import { describe, expect, it } from "vitest";
import { plainLabel, plainRun } from "../label/label";
import { renderSequenceToSVG } from "./renderSequenceToSVG";
import type {
  PositionedSequenceDiagram,
  PositionedParticipant,
  PositionedMessage,
  PositionedBlock,
  PositionedBox,
  PositionedDestroyMark,
  PositionedSequenceElement,
  SequenceArrow,
  SequenceArrowLine,
  SequenceArrowHead,
  Label,
  LabelBox,
} from "../contracts";

/** A label of these rows, each one plain run — what `a<br/>b` reads as. */
const rowsLabel = (...rows: string[]): Label => ({
  text: rows.join("\n"),
  rows: rows.map((row) => [plainRun(row)]),
});

/**
 * A box for `rowsLabel(...rows)` as a measurer answering 8px a character
 * and 24px a row, with no padding, would measure it — written out here so
 * no measurer is involved: the renderer draws what layout reported.
 */
const boxOf = (...rows: string[]): LabelBox => ({
  width: Math.max(...rows.map((row) => row.length * 8)),
  height: rows.length * 24,
  rows: rows.map((row, index) => ({
    y: index * 24 + 12,
    height: 24,
    width: row.length * 8,
    runs: [{ x: 0, width: row.length * 8 }],
  })),
});

/**
 * Where `layoutSequence` anchors a block's condition of this `box`, for a
 * frame whose top-left corner is (`x`, `y`): its box 8 in and past the 64
 * reserved for the keyword, its first row centred 14 below the top.
 */
const headerAnchor = (box: LabelBox, x: number, y: number) => ({
  x: x + 8 + 64 + box.width / 2,
  y: y + 14 - box.rows[0]!.y + box.height / 2,
});

/** The same for a divider's condition, its line at `y` in a frame whose left edge is `x`: no keyword. */
const dividerAnchor = (box: LabelBox, x: number, y: number) => ({
  x: x + 8 + box.width / 2,
  y: y + 14 - box.rows[0]!.y + box.height / 2,
});

/** Hand-built fixture: one `participant` box lane, one `actor` stick-figure lane, no messages. */
function buildParticipantsFixture(): PositionedSequenceDiagram {
  const alice: PositionedParticipant = {
    id: "Alice",
    label: plainLabel("Alice"),
    labelBox: boxOf("Alice"),
    participantKind: "participant",
    origin: "declared",
    x: 60,
    top: 0,
    bottom: 300,
    width: 100,
    height: 40,
    interaction: null,
  };
  const bob: PositionedParticipant = {
    id: "Bob",
    label: plainLabel("Bob"),
    labelBox: boxOf("Bob"),
    participantKind: "actor",
    origin: "declared",
    x: 220,
    top: 0,
    bottom: 300,
    width: 60,
    height: 50,
    interaction: null,
  };
  return {
    title: null,
    accTitle: null,
    participants: [alice, bob],
    boxes: [],
    elements: [],
    activations: [],
    timeline: { totalSteps: 0, entries: [] },
    width: 300,
    height: 300,
  };
}

/** Hand-built fixture: two lanes and a single message using the given arrow. */
function buildMessageFixture(arrow: SequenceArrow): PositionedSequenceDiagram {
  const diagram = buildParticipantsFixture();
  const message: PositionedMessage = {
    id: "Alice-Bob",
    from: "Alice",
    to: "Bob",
    label: { label: plainLabel("hello"), labelBox: boxOf("hello"), anchor: { x: 140, y: 84 } },
    arrow,
    autonumber: null,
    y: 100,
    fromX: 60,
    toX: 220,
  };
  return {
    ...diagram,
    elements: [{ kind: "message", message }],
  };
}

/**
 * Hand-built fixture: two lanes and one message per given arrow, all in a
 * single diagram — so a test can compare marker references *within* one
 * render. Ids are minted per render (`mintIdScope`), so two renders never
 * share one and any question about which heads share a marker has to be
 * asked of one SVG.
 */
function buildMessagesFixture(arrows: SequenceArrow[]): PositionedSequenceDiagram {
  const diagram = buildParticipantsFixture();
  return {
    ...diagram,
    elements: arrows.map((arrow, index) => ({
      kind: "message" as const,
      message: {
        id: `Alice-Bob-${index}`,
        from: "Alice",
        to: "Bob",
        label: { label: plainLabel("hello"), labelBox: boxOf("hello"), anchor: { x: 140, y: 84 + index * 20 } },
        arrow,
        autonumber: null,
        y: 100 + index * 20,
        fromX: 60,
        toX: 220,
      },
    })),
  };
}

/**
 * Hand-built fixture: two lanes and a single top-level block, given the
 * block's fields directly (per contracts.ts's frozen `PositionedBlock`
 * shape) so each test controls exactly which block-kind/branch/nesting
 * shape it exercises.
 */
function buildBlockFixture(block: PositionedBlock): PositionedSequenceDiagram {
  const diagram = buildParticipantsFixture();
  const element: PositionedSequenceElement = { kind: "block", block };
  return {
    ...diagram,
    elements: [element],
  };
}

/**
 * Every coordinate pair in a path's `d`, in order. Lets a test describe an
 * X-mark's geometry (where its strokes cross, how symmetric its arms are)
 * without hard-coding the arm length the renderer happens to pick.
 */
function extractPathPoints(d: string): { x: number; y: number }[] {
  return Array.from(d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)).map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));
}

/**
 * Hand-built fixture: the two standard lanes plus one message, grouped by
 * the given boxes (per contracts.ts's frozen `PositionedBox` shape), so a
 * test can check both the box's own shape and where it lands in paint order
 * relative to the participants/lifelines/messages it groups.
 */
function buildBoxFixture(boxes: PositionedBox[]): PositionedSequenceDiagram {
  const diagram = buildMessageFixture({ line: "solid", head: "filled" });
  return { ...diagram, boxes };
}

/**
 * The vertical extent an actor's stick-figure strokes actually occupy: the
 * head circle's top and bottom plus every body/arm/leg line endpoint. Lets a
 * test say "the label sits below the figure" without hard-coding which stroke
 * happens to be the lowest one.
 */
function iconExtentY(participantGroup: Element): { min: number; max: number } {
  const ys: number[] = [];

  for (const circle of Array.from(participantGroup.querySelectorAll("circle"))) {
    const cy = Number(circle.getAttribute("cy"));
    const r = Number(circle.getAttribute("r"));
    ys.push(cy - r, cy + r);
  }
  for (const line of Array.from(participantGroup.querySelectorAll("line"))) {
    ys.push(Number(line.getAttribute("y1")), Number(line.getAttribute("y2")));
  }

  return { min: Math.min(...ys), max: Math.max(...ys) };
}

function extractMarkerId(urlRef: string | null | undefined): string | null {
  if (urlRef === null || urlRef === undefined) {
    return null;
  }
  const match = /url\(#([^)]+)\)/.exec(urlRef);
  return match ? match[1]! : null;
}

const LINES: SequenceArrowLine[] = ["solid", "dotted"];
const HEADS: SequenceArrowHead[] = ["none", "filled", "bidirectionalFilled", "cross", "open"];

describe("renderSequenceToSVG", () => {
  it("renders one siren-participant group per participant, with a rect+text for a participant lane", () => {
    const svg = renderSequenceToSVG(buildParticipantsFixture());

    // Two groups per lane: both fixture participants are preamble-declared and
    // never destroyed, so each is drawn again at the bottom row.
    const groups = svg.querySelectorAll("g.siren-participant");
    expect(groups).toHaveLength(4);

    const aliceGroup = svg.querySelector('g.siren-participant[data-siren-id="Alice"]')!;
    expect(aliceGroup).not.toBeNull();
    const rect = aliceGroup.querySelector("rect")!;
    const text = aliceGroup.querySelector("text")!;
    expect(rect).not.toBeNull();
    expect(text.textContent).toBe("Alice");
  });

  it("repeats a declared, never-destroyed participant at the bottom of the diagram, with the same id and shape as its top box", () => {
    const svg = renderSequenceToSVG(buildParticipantsFixture());

    const aliceGroups = svg.querySelectorAll('g.siren-participant[data-siren-id="Alice"]');
    expect(aliceGroups).toHaveLength(2);

    const topRect = aliceGroups[0]!.querySelector("rect")!;
    const bottomRect = aliceGroups[1]!.querySelector("rect")!;
    expect(topRect.getAttribute("y")).toBe("0");
    // Same lane, same size — only the row differs, and the bottom row sits at
    // the far end of the lifeline.
    expect(bottomRect.getAttribute("x")).toBe(topRect.getAttribute("x"));
    expect(bottomRect.getAttribute("width")).toBe(topRect.getAttribute("width"));
    expect(bottomRect.getAttribute("height")).toBe(topRect.getAttribute("height"));
    expect(
      Number(bottomRect.getAttribute("y")) + Number(bottomRect.getAttribute("height")),
    ).toBe(300);
    expect(aliceGroups[1]!.querySelector("text")!.textContent).toBe("Alice");

    // An actor repeats as a stick figure, not as a box.
    const bobGroups = svg.querySelectorAll('g.siren-participant[data-siren-id="Bob"]');
    expect(bobGroups).toHaveLength(2);
    const bobBottom = bobGroups[1]!;
    expect(bobBottom.querySelector("rect")).toBeNull();
    expect(bobBottom.querySelector("circle")).not.toBeNull();
    expect(bobBottom.querySelectorAll("line").length).toBeGreaterThanOrEqual(4);
    expect(bobBottom.querySelector("text")!.textContent).toBe("Bob");
    expect(Number(bobBottom.querySelector("circle")!.getAttribute("cy"))).toBeGreaterThan(
      Number(bobGroups[0]!.querySelector("circle")!.getAttribute("cy")),
    );

    // The added row leaves each lifeline's own extent untouched.
    const lifelines = svg.querySelectorAll("line.siren-lifeline");
    expect(lifelines).toHaveLength(2);
    const aliceLifeline = svg.querySelector('line.siren-lifeline[data-siren-id="Alice"]')!;
    expect(aliceLifeline.getAttribute("y1")).toBe("0");
    expect(aliceLifeline.getAttribute("y2")).toBe("300");
  });

  it("renders an actor lane as a stick-figure group (head circle + body/arm/leg lines) plus a text label, not a rect", () => {
    const svg = renderSequenceToSVG(buildParticipantsFixture());

    const bobGroup = svg.querySelector('g.siren-participant[data-siren-id="Bob"]')!;
    expect(bobGroup).not.toBeNull();
    expect(bobGroup.querySelector("rect")).toBeNull();

    const head = bobGroup.querySelector("circle")!;
    expect(head).not.toBeNull();

    // Body + at least an arm line + two leg lines.
    const lines = bobGroup.querySelectorAll("line");
    expect(lines.length).toBeGreaterThanOrEqual(4);

    const text = bobGroup.querySelector("text")!;
    expect(text.textContent).toBe("Bob");
  });

  it("draws an actor's label clear of its stick figure, in the band the figure leaves free at the bottom of the participant's row", () => {
    const svg = renderSequenceToSVG(buildParticipantsFixture());

    // Bob's reserved row band is `[top, top + height]` at the top of his
    // lifeline, and `[bottom - height, bottom]` at the bottom row.
    const rows: { group: Element; bandTop: number }[] = Array.from(
      svg.querySelectorAll('g.siren-participant[data-siren-id="Bob"]'),
    ).map((group, index) => ({ group, bandTop: index === 0 ? 0 : 300 - 50 }));
    expect(rows).toHaveLength(2);

    for (const { group, bandTop } of rows) {
      const bandBottom = bandTop + 50;
      const icon = iconExtentY(group);
      const label = group.querySelector("text")!;
      const labelY = Number(label.getAttribute("y"));

      // The whole figure sits inside the row's reserved band...
      expect(icon.min).toBeGreaterThanOrEqual(bandTop);
      expect(icon.max).toBeLessThanOrEqual(bandBottom);
      // ...ending far enough above the band's bottom edge to leave the label a
      // band of its own (the bottom 40% of the row, per buildActorIcon).
      expect(bandBottom - icon.max).toBeGreaterThanOrEqual(0.4 * 50);

      // And the label lives in that free band, below every icon stroke —
      // centred in it, the same way a participant box centres its own label.
      expect(labelY).toBeGreaterThan(icon.max);
      expect(labelY).toBeLessThanOrEqual(bandBottom);
      expect(label.getAttribute("dominant-baseline")).toBe("middle");
      expect(labelY).toBe((icon.max + bandBottom) / 2);
    }
  });

  it("leaves a participant lane's label centred in its own box (characterization: unchanged by the actor-label fix)", () => {
    const svg = renderSequenceToSVG(buildParticipantsFixture());

    const aliceGroup = svg.querySelector('g.siren-participant[data-siren-id="Alice"]')!;
    const text = aliceGroup.querySelector("text")!;
    // Alice's box is `[0, 40]` tall at x 60, so her label sits at its centre.
    expect(text.getAttribute("x")).toBe("60");
    expect(text.getAttribute("y")).toBe("20");
    expect(text.getAttribute("text-anchor")).toBe("middle");
    expect(text.getAttribute("dominant-baseline")).toBe("middle");
  });

  it("renders one siren-lifeline per participant, spanning the participant's full computed extent", () => {
    const svg = renderSequenceToSVG(buildParticipantsFixture());

    const lifelines = svg.querySelectorAll("line.siren-lifeline");
    expect(lifelines).toHaveLength(2);

    const aliceLifeline = svg.querySelector('line.siren-lifeline[data-siren-id="Alice"]')!;
    expect(aliceLifeline).not.toBeNull();
    expect(aliceLifeline.getAttribute("x1")).toBe("60");
    expect(aliceLifeline.getAttribute("x2")).toBe("60");
    expect(aliceLifeline.getAttribute("y1")).toBe("0");
    expect(aliceLifeline.getAttribute("y2")).toBe("300");
  });

  it("renders a siren-message group with a siren-message-arrow path and a siren-message-label text carrying the message text", () => {
    const svg = renderSequenceToSVG(buildMessageFixture({ line: "solid", head: "filled" }));

    const group = svg.querySelector('g.siren-message[data-siren-id="Alice-Bob"]')!;
    expect(group).not.toBeNull();

    const path = group.querySelector("path.siren-message-arrow")!;
    expect(path).not.toBeNull();

    const label = group.querySelector("text.siren-message-label")!;
    expect(label.textContent).toBe("hello");
  });

  it("gives a solid line no stroke-dasharray and a dotted line a stroke-dasharray", () => {
    const solidSvg = renderSequenceToSVG(buildMessageFixture({ line: "solid", head: "none" }));
    const dottedSvg = renderSequenceToSVG(buildMessageFixture({ line: "dotted", head: "none" }));

    const solidPath = solidSvg.querySelector("path.siren-message-arrow")!;
    const dottedPath = dottedSvg.querySelector("path.siren-message-arrow")!;

    expect(solidPath.getAttribute("stroke-dasharray")).toBeNull();
    expect(dottedPath.getAttribute("stroke-dasharray")).not.toBeNull();
  });

  it("gives each of the five arrowhead styles a distinct, correctly-placed marker configuration, all backed by <marker> defs", () => {
    const svg = renderSequenceToSVG(buildMessageFixture({ line: "solid", head: "none" }));
    // "none" carries no marker at all.
    const nonePath = svg.querySelector("path.siren-message-arrow")!;
    expect(nonePath.getAttribute("marker-start")).toBeNull();
    expect(nonePath.getAttribute("marker-end")).toBeNull();

    const markerEndByHead = new Map<SequenceArrowHead, string | null>();
    const markerStartByHead = new Map<SequenceArrowHead, string | null>();

    for (const head of HEADS) {
      const headSvg = renderSequenceToSVG(buildMessageFixture({ line: "solid", head }));
      const path = headSvg.querySelector("path.siren-message-arrow")!;
      markerEndByHead.set(head, path.getAttribute("marker-end"));
      markerStartByHead.set(head, path.getAttribute("marker-start"));

      // Every non-none marker reference must resolve to a real <marker> def.
      const markerId = extractMarkerId(path.getAttribute("marker-end"));
      if (markerId !== null) {
        expect(headSvg.querySelector(`defs marker#${markerId}`)).not.toBeNull();
      }
    }

    expect(markerEndByHead.get("none")).toBeNull();

    // filled/bidirectionalFilled/cross/open all carry a marker-end.
    expect(markerEndByHead.get("filled")).not.toBeNull();
    expect(markerEndByHead.get("bidirectionalFilled")).not.toBeNull();
    expect(markerEndByHead.get("cross")).not.toBeNull();
    expect(markerEndByHead.get("open")).not.toBeNull();

    for (const head of ["none", "filled", "cross", "open"] as const) {
      expect(markerStartByHead.get(head)).toBeNull();
    }

    // Which heads *share* a marker, and which are distinct, is a question
    // about one render and can only be asked of one: ids are minted per
    // render, so two SVGs deliberately never share one. Every head in one
    // diagram, then, read by following each path's own reference.
    const oneOfEach = renderSequenceToSVG(
      buildMessagesFixture(HEADS.map((head) => ({ line: "solid" as const, head }))),
    );
    const arrowFor = (head: SequenceArrowHead): Element =>
      oneOfEach.querySelectorAll("path.siren-message-arrow")[HEADS.indexOf(head)]!;

    // bidirectionalFilled is the only head with both ends arrowed, using the
    // same filled marker at both ends.
    const filledEnd = arrowFor("filled").getAttribute("marker-end");
    expect(arrowFor("bidirectionalFilled").getAttribute("marker-end")).toBe(filledEnd);
    expect(arrowFor("bidirectionalFilled").getAttribute("marker-start")).toBe(filledEnd);

    // filled/cross/open are visually distinct markers, each with a def of
    // its own — three defs for five heads.
    const distinctIds = new Set(
      (["filled", "cross", "open"] as const).map((head) =>
        extractMarkerId(arrowFor(head).getAttribute("marker-end")),
      ),
    );
    expect(distinctIds.size).toBe(3);
    expect(oneOfEach.querySelectorAll("defs > marker")).toHaveLength(3);
  });

  it("covers every one of the ten { line, head } combinations without throwing, each producing a path with the matching marker/dasharray shape", () => {
    for (const line of LINES) {
      for (const head of HEADS) {
        const svg = renderSequenceToSVG(buildMessageFixture({ line, head }));
        const path = svg.querySelector("path.siren-message-arrow")!;
        expect(path).not.toBeNull();
        expect(path.getAttribute("stroke-dasharray") !== null).toBe(line === "dotted");
        expect(path.getAttribute("marker-end") !== null).toBe(head !== "none");
        expect(path.getAttribute("marker-start") !== null).toBe(head === "bidirectionalFilled");
      }
    }
  });

  it("renders an adjacent siren-autonumber text when autonumbering is present, and none when it is absent", () => {
    const withNumber = buildMessageFixture({ line: "solid", head: "filled" });
    (withNumber.elements[0] as { kind: "message"; message: PositionedMessage }).message.autonumber = 3;
    const withoutNumber = buildMessageFixture({ line: "solid", head: "filled" });

    const svgWithNumber = renderSequenceToSVG(withNumber);
    const svgWithoutNumber = renderSequenceToSVG(withoutNumber);

    const numberText = svgWithNumber.querySelector(
      'g.siren-message[data-siren-id="Alice-Bob"] text.siren-autonumber',
    );
    expect(numberText).not.toBeNull();
    expect(numberText!.textContent).toBe("3");

    const noNumberText = svgWithoutNumber.querySelector(
      'g.siren-message[data-siren-id="Alice-Bob"] text.siren-autonumber',
    );
    expect(noNumberText).toBeNull();
  });

  it("renders each activation bar as an identified siren-activation-bar rect at its assigned span", () => {
    const diagram: PositionedSequenceDiagram = {
      ...buildParticipantsFixture(),
      activations: [
        { id: "activation:1", participantId: "Alice", x: 55, y: 40, width: 10, height: 120 },
      ],
    };

    const svg = renderSequenceToSVG(diagram);

    const bars = svg.querySelectorAll("rect.siren-activation-bar");
    expect(bars).toHaveLength(1);
    const bar = bars[0]!;
    expect(bar.getAttribute("data-siren-id")).toBe("activation:1");
    expect(bar.getAttribute("x")).toBe("55");
    expect(bar.getAttribute("y")).toBe("40");
    expect(bar.getAttribute("width")).toBe("10");
    expect(bar.getAttribute("height")).toBe("120");
  });

  it("renders no activation bar when the diagram has none", () => {
    const svg = renderSequenceToSVG(buildParticipantsFixture());
    expect(svg.querySelectorAll("rect.siren-activation-bar")).toHaveLength(0);
  });

  it("renders exactly one siren-title text when a title is present, and none when absent", () => {
    const withTitle: PositionedSequenceDiagram = { ...buildParticipantsFixture(), title: "My Diagram" };
    const withoutTitle = buildParticipantsFixture();

    const svgWithTitle = renderSequenceToSVG(withTitle);
    const svgWithoutTitle = renderSequenceToSVG(withoutTitle);

    const titles = svgWithTitle.querySelectorAll("text.siren-title");
    expect(titles).toHaveLength(1);
    expect(titles[0]!.textContent).toBe("My Diagram");

    expect(svgWithoutTitle.querySelectorAll("text.siren-title")).toHaveLength(0);
  });

  it("gives the svg root an aria-labelled <title> (its first child) when accTitle is present, and adds nothing when it is absent", () => {
    const withAccTitle: PositionedSequenceDiagram = {
      ...buildParticipantsFixture(),
      accTitle: "A short accessible title",
    };
    const withoutAccTitle = buildParticipantsFixture();

    const svgWithAccTitle = renderSequenceToSVG(withAccTitle);
    const svgWithoutAccTitle = renderSequenceToSVG(withoutAccTitle);

    // Measured against real Mermaid: accTitle becomes the SVG's own <title>
    // (screen-reader metadata, never drawn on the canvas), its first child,
    // with role/aria-labelledby wired to it on the root.
    const title = svgWithAccTitle.firstElementChild!;
    expect(title.tagName.toLowerCase()).toBe("title");
    expect(title.textContent).toBe("A short accessible title");
    expect(title.getAttribute("id")).toBeTruthy();
    expect(svgWithAccTitle.getAttribute("role")).toBe("img");
    expect(svgWithAccTitle.getAttribute("aria-labelledby")).toBe(title.getAttribute("id"));

    expect(svgWithoutAccTitle.querySelector("title")).toBeNull();
    expect(svgWithoutAccTitle.getAttribute("role")).toBeNull();
    expect(svgWithoutAccTitle.getAttribute("aria-labelledby")).toBeNull();
  });

  it("wraps a participant carrying an href interaction (from a link statement) in a link, at both its top and bottom boxes", () => {
    const diagram = buildParticipantsFixture();
    diagram.participants[0] = {
      ...diagram.participants[0]!,
      interaction: {
        targetId: "Alice",
        interactionKind: "href",
        action: "https://example.com/dashboard",
        argument: null,
        tooltip: "Dashboard",
      },
    };

    const svg = renderSequenceToSVG(diagram);

    const links = svg.querySelectorAll("a.siren-link");
    // Alice is drawn twice (top row + bottom row, per the existing "second
    // box at the diagram's bottom row" convention) and both wrap in a link.
    expect(links).toHaveLength(2);
    for (const link of Array.from(links)) {
      expect(link.getAttribute("href")).toBe("https://example.com/dashboard");
      const group = link.querySelector('g.siren-participant[data-siren-id="Alice"]');
      expect(group).not.toBeNull();
      // A link's `Label` (`link A: Dashboard @ url`) reaches the reader as
      // the participant's tooltip — the class diagram precedent for a
      // `click`/`link` tooltip: a `<title>` as the group's first child,
      // which is the only position SVG shows as a hover tooltip.
      const title = group!.querySelector("title");
      expect(title?.textContent).toBe("Dashboard");
      expect(group!.firstElementChild).toBe(title);
    }

    // Bob carries no interaction, so he wraps in nothing extra.
    const bobGroups = svg.querySelectorAll('g.siren-participant[data-siren-id="Bob"]');
    for (const bobGroup of Array.from(bobGroups)) {
      expect(bobGroup.closest("a.siren-link")).toBeNull();
    }
  });

  it("renders message labels, participant labels, and the title via textContent only, never as parsed markup", () => {
    const diagram = buildMessageFixture({ line: "solid", head: "filled" });
    diagram.title = "<script>alert(1)</script>";
    const message = (diagram.elements[0] as { kind: "message"; message: PositionedMessage }).message;
    message.label = { ...message.label, label: plainLabel("<b>hi</b>") };
    diagram.participants[0]!.label = plainLabel("<i>Alice</i>");

    const svg = renderSequenceToSVG(diagram);

    expect(svg.querySelectorAll("script, b, i")).toHaveLength(0);
    expect(svg.querySelector("text.siren-title")!.textContent).toBe("<script>alert(1)</script>");
    expect(svg.querySelector("text.siren-message-label")!.textContent).toBe("<b>hi</b>");
    expect(svg.querySelector('g.siren-participant[data-siren-id="Alice"] text')!.textContent).toBe(
      "<i>Alice</i>",
    );
  });

  it("renders a loop block as a siren-block group with a frame rect at its exact bounding box and a top-left condition label", () => {
    const block: PositionedBlock = {
      id: "loop:1",
      kind: "loop",
      label: { label: plainLabel("[n < 5]"), labelBox: boxOf("[n < 5]"), anchor: headerAnchor(boxOf("[n < 5]"), 40, 50) },
      color: null,
      x: 40,
      y: 50,
      width: 200,
      height: 80,
      dividers: [],
      children: [],
    };
    const svg = renderSequenceToSVG(buildBlockFixture(block));

    const groups = svg.querySelectorAll("g.siren-block");
    expect(groups).toHaveLength(1);

    const group = svg.querySelector('g.siren-block[data-siren-id="loop:1"]')!;
    expect(group).not.toBeNull();
    expect(group.getAttribute("data-siren-block-kind")).toBe("loop");

    const frame = group.querySelector("rect.siren-block-frame")!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("x")).toBe("40");
    expect(frame.getAttribute("y")).toBe("50");
    expect(frame.getAttribute("width")).toBe("200");
    expect(frame.getAttribute("height")).toBe("80");

    // Mermaid wraps a block's condition text in brackets when it draws it
    // (measured: `loop n < 5` renders as `[n < 5]`); layout hands the
    // condition over already bracketed, and this is drawn as given.
    const label = group.querySelector("text.siren-block-label")!;
    expect(label).not.toBeNull();
    expect(label.textContent).toBe("[n < 5]");
    // Top-left per Mermaid's convention: inside the frame, hugging its top edge.
    const labelX = Number(label.getAttribute("x"));
    const labelY = Number(label.getAttribute("y"));
    expect(labelX).toBeGreaterThanOrEqual(block.x);
    expect(labelX).toBeLessThan(block.x + block.width);
    expect(labelY).toBeGreaterThanOrEqual(block.y);
    expect(labelY).toBeLessThan(block.y + 20);

    // Only the header draws a keyword — never a divider (see the alt/else
    // test below) — and a `loop` block's is the literal word "loop".
    const keywords = group.querySelectorAll("text.siren-block-keyword");
    expect(keywords).toHaveLength(1);
    expect(keywords[0]!.textContent).toBe("loop");
  });

  it("renders one divider line + branch label per branch after the first, for an alt with three branches", () => {
    const block: PositionedBlock = {
      id: "alt:1",
      kind: "alt",
      label: { label: plainLabel("[x == 1]"), labelBox: boxOf("[x == 1]"), anchor: headerAnchor(boxOf("[x == 1]"), 20, 30) },
      color: null,
      x: 20,
      y: 30,
      width: 240,
      height: 180,
      dividers: [
        {
          label: { label: plainLabel("[x == 2]"), labelBox: boxOf("[x == 2]"), anchor: dividerAnchor(boxOf("[x == 2]"), 20, 90) },
          y: 90,
        },
        {
          label: { label: plainLabel("[else]"), labelBox: boxOf("[else]"), anchor: dividerAnchor(boxOf("[else]"), 20, 140) },
          y: 140,
        },
      ],
      children: [],
    };
    const svg = renderSequenceToSVG(buildBlockFixture(block));

    const group = svg.querySelector('g.siren-block[data-siren-id="alt:1"]')!;
    const dividers = group.querySelectorAll("line.siren-block-divider");
    expect(dividers).toHaveLength(2);
    expect(dividers[0]!.getAttribute("y1")).toBe("90");
    expect(dividers[0]!.getAttribute("y2")).toBe("90");
    expect(dividers[0]!.getAttribute("x1")).toBe("20");
    expect(dividers[0]!.getAttribute("x2")).toBe("260");
    expect(dividers[1]!.getAttribute("y1")).toBe("140");

    // Header condition label plus one label per divider branch, every one
    // bracket-wrapped the way Mermaid draws a block's condition text.
    const labels = Array.from(group.querySelectorAll("text.siren-block-label")).map(
      (label) => label.textContent,
    );
    expect(labels).toEqual(["[x == 1]", "[x == 2]", "[else]"]);

    // Measured against real Mermaid: only the header's keyword ("alt") is
    // ever drawn — a divider branch (`else` here, `and`/`option` for
    // par/critical) draws no keyword of its own, however many there are.
    const keywords = Array.from(group.querySelectorAll("text.siren-block-keyword")).map(
      (keyword) => keyword.textContent,
    );
    expect(keywords).toEqual(["alt"]);
  });

  it("renders a rect block as a filled background rect using its color, with no frame border, behind its contained message in paint order", () => {
    const message: PositionedMessage = {
      id: "Alice-Bob",
      from: "Alice",
      to: "Bob",
      label: { label: plainLabel("hi"), labelBox: boxOf("hi"), anchor: { x: 140, y: 84 } },
      arrow: { line: "solid", head: "filled" },
      autonumber: null,
      y: 100,
      fromX: 60,
      toX: 220,
    };
    const block: PositionedBlock = {
      id: "rect:1",
      kind: "rect",
      label: null,
      color: "rgb(191, 223, 255)",
      x: 20,
      y: 60,
      width: 240,
      height: 100,
      dividers: [],
      children: [{ kind: "message", message }],
    };
    const svg = renderSequenceToSVG(buildBlockFixture(block));

    const group = svg.querySelector('g.siren-block[data-siren-id="rect:1"]')!;

    // No outlined frame, no header/branch labels, no keyword — distinct from
    // the other six block kinds (measured: Mermaid draws a `rect` block with
    // no label and no corner tag at all).
    expect(group.querySelector("rect.siren-block-frame")).toBeNull();
    expect(group.querySelectorAll("text.siren-block-label")).toHaveLength(0);
    expect(group.querySelectorAll("text.siren-block-keyword")).toHaveLength(0);

    const fill = group.querySelector("rect.siren-block-fill")!;
    expect(fill).not.toBeNull();
    expect(fill.getAttribute("fill")).toBe("rgb(191, 223, 255)");
    expect(fill.getAttribute("x")).toBe("20");
    expect(fill.getAttribute("y")).toBe("60");
    expect(fill.getAttribute("width")).toBe("240");
    expect(fill.getAttribute("height")).toBe("100");

    // Paint order: the fill rect comes before the contained message group,
    // so it's drawn behind it.
    const children = Array.from(group.children);
    const fillIndex = children.indexOf(fill);
    const messageIndex = children.findIndex((child) => child.classList.contains("siren-message"));
    expect(fillIndex).toBeGreaterThanOrEqual(0);
    expect(messageIndex).toBeGreaterThan(fillIndex);
  });

  it("renders a nested block as a nested siren-block group, visually enclosed by its parent's un-obscuring frame", () => {
    const innerBlock: PositionedBlock = {
      id: "alt:1",
      kind: "alt",
      label: { label: plainLabel("y > 0"), labelBox: boxOf("y > 0"), anchor: headerAnchor(boxOf("y > 0"), 60, 80) },
      color: null,
      x: 60,
      y: 80,
      width: 160,
      height: 60,
      dividers: [],
      children: [],
    };
    const outerBlock: PositionedBlock = {
      id: "loop:1",
      kind: "loop",
      label: { label: plainLabel("[n < 5]"), labelBox: boxOf("[n < 5]"), anchor: headerAnchor(boxOf("[n < 5]"), 40, 50) },
      color: null,
      x: 40,
      y: 50,
      width: 200,
      height: 120,
      dividers: [],
      children: [{ kind: "block", block: innerBlock }],
    };
    const svg = renderSequenceToSVG(buildBlockFixture(outerBlock));

    const allBlocks = svg.querySelectorAll("g.siren-block");
    expect(allBlocks).toHaveLength(2);

    const outerGroup = svg.querySelector('g.siren-block[data-siren-id="loop:1"]')!;
    const innerGroup = outerGroup.querySelector('g.siren-block[data-siren-id="alt:1"]');
    expect(innerGroup).not.toBeNull();

    // The outer frame is unfilled, so it never paints over the nested
    // content regardless of DOM order.
    const outerFrame = outerGroup.querySelector(":scope > rect.siren-block-frame")!;
    expect(outerFrame.getAttribute("fill")).toBe("none");
  });

  it("renders a destroy mark as a siren-destroy-mark path whose two strokes cross at the lifeline's truncation point", () => {
    const mark: PositionedDestroyMark = { participantId: "Bob", x: 220, y: 180 };
    const diagram: PositionedSequenceDiagram = {
      ...buildParticipantsFixture(),
      elements: [{ kind: "destroyMark", mark }],
    };

    const svg = renderSequenceToSVG(diagram);

    const marks = svg.querySelectorAll("path.siren-destroy-mark");
    expect(marks).toHaveLength(1);

    const path = svg.querySelector('path.siren-destroy-mark[data-siren-id="Bob"]')!;
    expect(path).not.toBeNull();
    // An X: two separate strokes (two subpaths), four endpoints, centered on
    // the truncation point — never a filled quad.
    expect(path.getAttribute("fill")).toBe("none");
    const d = path.getAttribute("d")!;
    expect(d.match(/M/g)).toHaveLength(2);

    const points = extractPathPoints(d);
    expect(points).toHaveLength(4);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    expect(Math.min(...xs)).toBeLessThan(mark.x);
    expect(Math.max(...xs)).toBeGreaterThan(mark.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(mark.x);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBe(mark.y);
  });

  it("renders a destroy mark that sits inside a block as a mark nested in that block's group", () => {
    const mark: PositionedDestroyMark = { participantId: "Bob", x: 220, y: 120 };
    const block: PositionedBlock = {
      id: "loop:1",
      kind: "loop",
      label: { label: plainLabel("retrying"), labelBox: boxOf("retrying"), anchor: headerAnchor(boxOf("retrying"), 40, 60) },
      color: null,
      x: 40,
      y: 60,
      width: 220,
      height: 120,
      dividers: [],
      children: [{ kind: "destroyMark", mark }],
    };
    const svg = renderSequenceToSVG(buildBlockFixture(block));

    expect(svg.querySelectorAll("path.siren-destroy-mark")).toHaveLength(1);
    const group = svg.querySelector('g.siren-block[data-siren-id="loop:1"]')!;
    expect(group.querySelector('path.siren-destroy-mark[data-siren-id="Bob"]')).not.toBeNull();
  });

  it("renders a box as a siren-box group with a background rect at its bounding box, painted before every participant, lifeline and message it groups", () => {
    const box: PositionedBox = {
      id: "box:1",
      color: "rgb(200, 220, 240)",
      label: { label: plainLabel("Service Layer"), labelBox: boxOf("Service Layer"), anchor: { x: 150, y: 16 } },
      x: 10,
      y: 4,
      width: 280,
      height: 292,
    };
    const svg = renderSequenceToSVG(buildBoxFixture([box]));

    const groups = svg.querySelectorAll("g.siren-box");
    expect(groups).toHaveLength(1);

    const group = svg.querySelector('g.siren-box[data-siren-id="box:1"]')!;
    expect(group).not.toBeNull();

    const background = group.querySelector("rect")!;
    expect(background).not.toBeNull();
    expect(background.getAttribute("x")).toBe("10");
    expect(background.getAttribute("y")).toBe("4");
    expect(background.getAttribute("width")).toBe("280");
    expect(background.getAttribute("height")).toBe("292");
    expect(background.getAttribute("fill")).toBe("rgb(200, 220, 240)");

    // Paint order: the box group precedes everything it groups, so the
    // background never covers the members drawn inside it.
    const topLevel = Array.from(svg.children);
    const boxIndex = topLevel.indexOf(group);
    expect(boxIndex).toBeGreaterThanOrEqual(0);
    const memberIndexes = topLevel
      .map((child, index) => ({ child, index }))
      .filter(
        ({ child }) =>
          child.classList.contains("siren-participant") ||
          child.classList.contains("siren-lifeline") ||
          child.classList.contains("siren-message"),
      )
      .map(({ index }) => index);
    expect(memberIndexes.length).toBeGreaterThan(0);
    for (const memberIndex of memberIndexes) {
      expect(memberIndex).toBeGreaterThan(boxIndex);
    }
  });

  it("renders a note as a siren-note group with a frame at its layout-assigned box and centered text", () => {
    const diagram: PositionedSequenceDiagram = {
      ...buildParticipantsFixture(),
      elements: [
        {
          kind: "note",
          note: { id: "note:1", label: plainLabel("they agree"), labelBox: boxOf("they agree"), x: 40, y: 60, width: 120, height: 30 },
        },
      ],
    };

    const svg = renderSequenceToSVG(diagram);

    const group = svg.querySelector('g.siren-note[data-siren-id="note:1"]')!;
    expect(group).not.toBeNull();

    const frame = group.querySelector("rect.siren-note-frame")!;
    expect(frame.getAttribute("x")).toBe("40");
    expect(frame.getAttribute("y")).toBe("60");
    expect(frame.getAttribute("width")).toBe("120");
    expect(frame.getAttribute("height")).toBe("30");

    const text = group.querySelector("text.siren-note-text")!;
    expect(text.textContent).toBe("they agree");
  });

  it("renders a box's label as text inside its group when given, none when absent, and via textContent only", () => {
    const labelled: PositionedBox = {
      id: "box:1",
      color: null,
      label: { label: plainLabel("<b>Service Layer</b>"), labelBox: boxOf("<b>Service Layer</b>"), anchor: { x: 150, y: 16 } },
      x: 10,
      y: 4,
      width: 280,
      height: 292,
    };
    const unlabelled: PositionedBox = { ...labelled, id: "box:2", label: null };

    const labelledSvg = renderSequenceToSVG(buildBoxFixture([labelled]));
    const unlabelledSvg = renderSequenceToSVG(buildBoxFixture([unlabelled]));

    const labelledGroup = labelledSvg.querySelector('g.siren-box[data-siren-id="box:1"]')!;
    const texts = labelledGroup.querySelectorAll("text");
    expect(texts).toHaveLength(1);
    expect(texts[0]!.textContent).toBe("<b>Service Layer</b>");
    expect(labelledSvg.querySelectorAll("b")).toHaveLength(0);

    const unlabelledGroup = unlabelledSvg.querySelector('g.siren-box[data-siren-id="box:2"]')!;
    expect(unlabelledGroup.querySelectorAll("text")).toHaveLength(0);
  });

  it("renders a destroyed participant with a truncated lifeline, an X at the truncation point, and no second participant group at the bottom", () => {
    const diagram = buildParticipantsFixture();
    // Alice is destroyed at y=180: her lifeline stops there and the mark sits
    // at the truncation point.
    diagram.participants[0]!.bottom = 180;
    diagram.elements = [{ kind: "destroyMark", mark: { participantId: "Alice", x: 60, y: 180 } }];

    const svg = renderSequenceToSVG(diagram);

    const groups = svg.querySelectorAll('g.siren-participant[data-siren-id="Alice"]');
    expect(groups).toHaveLength(1);
    // The one group is the top one; nothing is drawn at the truncated end.
    expect(groups[0]!.querySelector("rect")!.getAttribute("y")).toBe("0");

    const lifeline = svg.querySelector('line.siren-lifeline[data-siren-id="Alice"]')!;
    expect(lifeline.getAttribute("y2")).toBe("180");

    const mark = svg.querySelector('path.siren-destroy-mark[data-siren-id="Alice"]')!;
    expect(mark).not.toBeNull();
    const points = extractPathPoints(mark.getAttribute("d")!);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(60);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBe(180);
  });

  it("gives no bottom box to a participant destroyed inside a block, whose destroy mark is nested rather than top-level", () => {
    const diagram = buildParticipantsFixture();
    // Alice is destroyed inside a loop, so her mark is a child of the block
    // element rather than a top-level one.
    diagram.participants[0]!.bottom = 180;
    const block: PositionedBlock = {
      id: "loop:1",
      kind: "loop",
      label: { label: plainLabel("each retry"), labelBox: boxOf("each retry"), anchor: headerAnchor(boxOf("each retry"), 20, 60) },
      color: null,
      x: 20,
      y: 60,
      width: 240,
      height: 160,
      dividers: [],
      children: [{ kind: "destroyMark", mark: { participantId: "Alice", x: 60, y: 180 } }],
    };
    diagram.elements = [{ kind: "block", block }];

    const svg = renderSequenceToSVG(diagram);

    const aliceGroups = svg.querySelectorAll('g.siren-participant[data-siren-id="Alice"]');
    expect(aliceGroups).toHaveLength(1);
    expect(aliceGroups[0]!.querySelector("rect")!.getAttribute("y")).toBe("0");

    // Bob survives, so he still gets his bottom box.
    expect(svg.querySelectorAll('g.siren-participant[data-siren-id="Bob"]')).toHaveLength(2);
  });

  it("renders a created participant exactly once, at its creation point rather than the diagram's top", () => {
    const diagram = buildParticipantsFixture();
    // Bob is introduced by `create participant Bob` partway down the diagram.
    diagram.participants[1] = {
      ...diagram.participants[1]!,
      participantKind: "participant",
      origin: "created",
      top: 140,
      bottom: 300,
    };

    const svg = renderSequenceToSVG(diagram);

    const groups = svg.querySelectorAll('g.siren-participant[data-siren-id="Bob"]');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.querySelector("rect")!.getAttribute("y")).toBe("140");

    const lifeline = svg.querySelector('line.siren-lifeline[data-siren-id="Bob"]')!;
    expect(lifeline.getAttribute("y1")).toBe("140");
  });

  it("leaves an uncolored box's background fill to the theme while honouring an explicit box color", () => {
    const uncolored: PositionedBox = {
      id: "box:1",
      color: null,
      label: null,
      x: 10,
      y: 4,
      width: 140,
      height: 292,
    };
    const colored: PositionedBox = { ...uncolored, id: "box:2", color: "#eef", x: 150 };

    const svg = renderSequenceToSVG(buildBoxFixture([uncolored, colored]));

    expect(svg.querySelectorAll("g.siren-box")).toHaveLength(2);
    const uncoloredRect = svg.querySelector('g.siren-box[data-siren-id="box:1"] rect')!;
    const coloredRect = svg.querySelector('g.siren-box[data-siren-id="box:2"] rect')!;
    expect(uncoloredRect.getAttribute("fill")).toBeNull();
    expect(coloredRect.getAttribute("fill")).toBe("#eef");
  });

  it("renders block header labels and branch divider labels via textContent only, never as parsed markup", () => {
    const block: PositionedBlock = {
      id: "alt:1",
      kind: "alt",
      label: { label: plainLabel("[<b>x == 1</b>]"), labelBox: boxOf("[<b>x == 1</b>]"), anchor: headerAnchor(boxOf("[<b>x == 1</b>]"), 20, 30) },
      color: null,
      x: 20,
      y: 30,
      width: 240,
      height: 180,
      dividers: [
        {
          label: { label: plainLabel("[<i>else</i>]"), labelBox: boxOf("[<i>else</i>]"), anchor: dividerAnchor(boxOf("[<i>else</i>]"), 20, 120) },
          y: 120,
        },
      ],
      children: [],
    };
    const svg = renderSequenceToSVG(buildBlockFixture(block));

    expect(svg.querySelectorAll("b, i")).toHaveLength(0);

    const labels = Array.from(svg.querySelectorAll("text.siren-block-label")).map(
      (label) => label.textContent,
    );
    expect(labels).toEqual(["[<b>x == 1</b>]", "[<i>else</i>]"]);
  });

  it("draws no bracketed label and no keyword-adjacent shift for a block with no condition text", () => {
    // Measured against real Mermaid: `loop` with no condition draws an
    // (invisible) placeholder rather than literal brackets around nothing —
    // for a renderer with no equivalent placeholder need, that means: draw
    // no visible bracket text, the same as today's "no label at all" case.
    const block: PositionedBlock = {
      id: "loop:1",
      kind: "loop",
      label: null,
      color: null,
      x: 40,
      y: 50,
      width: 200,
      height: 80,
      dividers: [],
      children: [],
    };
    const svg = renderSequenceToSVG(buildBlockFixture(block));

    const group = svg.querySelector('g.siren-block[data-siren-id="loop:1"]')!;
    const label = group.querySelector("text.siren-block-label")!;
    expect(label.textContent).toBe("");

    const keyword = group.querySelector("text.siren-block-keyword")!;
    expect(keyword.textContent).toBe("loop");
  });

  it.each(["opt", "par", "critical", "break"] as const)(
    "draws the literal keyword %s for that block kind",
    (kind) => {
      const block: PositionedBlock = {
        id: `${kind}:1`,
        kind,
        label: { label: plainLabel("condition"), labelBox: boxOf("condition"), anchor: headerAnchor(boxOf("condition"), 40, 50) },
        color: null,
        x: 40,
        y: 50,
        width: 200,
        height: 80,
        dividers: [],
        children: [],
      };
      const svg = renderSequenceToSVG(buildBlockFixture(block));

      const group = svg.querySelector(`g.siren-block[data-siren-id="${kind}:1"]`)!;
      const keyword = group.querySelector("text.siren-block-keyword")!;
      expect(keyword.textContent).toBe(kind);
    },
  );
});

describe("renderSequenceToSVG's labels", () => {
  /** The text of each row a `<text>` draws: its row tspans', or its own when it has none. */
  const rowsOf = (text: Element | null): string[] => {
    const rows = Array.from(text?.querySelectorAll("tspan.siren-label-row") ?? []);
    return rows.length === 0 ? [text?.textContent ?? ""] : rows.map((row) => row.textContent ?? "");
  };

  it("draws a participant's label row by row, in its box and under an actor's figure alike", () => {
    const diagram = buildParticipantsFixture();
    for (const participant of diagram.participants) {
      participant.label = rowsLabel("Web", "Client");
      participant.labelBox = boxOf("Web", "Client");
    }

    const svg = renderSequenceToSVG(diagram);

    const texts = Array.from(svg.querySelectorAll("g.siren-participant text"));
    // Alice and Bob, each drawn at the top and at the bottom row.
    expect(texts).toHaveLength(4);
    for (const text of texts) {
      expect(rowsOf(text)).toEqual(["Web", "Client"]);
    }
  });

  it("draws an actor's label of several rows below its figure, every row inside the actor's row, the figure no taller than for one row", () => {
    const diagram = buildParticipantsFixture();
    const bob = diagram.participants[1]!;
    const oneRowIcon = iconExtentY(
      renderSequenceToSVG(buildParticipantsFixture()).querySelector('g.siren-participant[data-siren-id="Bob"]')!,
    );
    // Layout's row for a label of three 24px rows: each row a one-row
    // label's row adds is that row's height (50 for one row, so 98 for three).
    bob.label = rowsLabel("one", "two", "three");
    bob.labelBox = boxOf("one", "two", "three");
    bob.height = 50 + 2 * 24;

    const svg = renderSequenceToSVG(diagram);

    const group = svg.querySelector('g.siren-participant[data-siren-id="Bob"]')!;
    const icon = iconExtentY(group);
    expect(icon).toEqual(oneRowIcon);
    const rows = Array.from(group.querySelectorAll("text tspan.siren-label-row"));
    expect(rows.map((row) => row.textContent)).toEqual(["one", "two", "three"]);
    for (const row of rows) {
      const centre = Number(row.getAttribute("y"));
      expect(centre - 12).toBeGreaterThanOrEqual(icon.max);
      expect(centre + 12).toBeLessThanOrEqual(bob.height);
    }
  });

  it("draws a message's label row by row, centred on the anchor layout gave it", () => {
    const diagram = buildMessageFixture({ line: "solid", head: "filled" });
    const message = (diagram.elements[0] as { kind: "message"; message: PositionedMessage }).message;
    message.label = { label: rowsLabel("first", "second"), labelBox: boxOf("first", "second"), anchor: { x: 140, y: 70 } };

    const text = renderSequenceToSVG(diagram).querySelector("text.siren-message-label");

    expect(rowsOf(text)).toEqual(["first", "second"]);
    expect([text?.getAttribute("x"), text?.getAttribute("y")]).toEqual(["140", "70"]);
  });

  it("draws a note's label row by row, centred in its frame", () => {
    const diagram: PositionedSequenceDiagram = {
      ...buildParticipantsFixture(),
      elements: [
        {
          kind: "note",
          note: {
            id: "note:1",
            label: rowsLabel("a", "b"),
            labelBox: boxOf("a", "b"),
            x: 40,
            y: 60,
            width: 120,
            height: 64,
          },
        },
      ],
    };

    const text = renderSequenceToSVG(diagram).querySelector("text.siren-note-text");

    expect(rowsOf(text)).toEqual(["a", "b"]);
    expect([text?.getAttribute("x"), text?.getAttribute("y")]).toEqual(["100", "92"]);
  });

  it("draws a block's and a divider's condition as layout gave it, row by row, starting where a one-row condition starts", () => {
    // Layout hands over the condition already bracketed (`PositionedBlock.label`),
    // so the renderer draws exactly that.
    const block: PositionedBlock = {
      id: "alt:1",
      kind: "alt",
      label: { label: rowsLabel("[every", "day]"), labelBox: boxOf("[every", "day]"), anchor: headerAnchor(boxOf("[every", "day]"), 10, 40) },
      color: null,
      x: 10,
      y: 40,
      width: 300,
      height: 200,
      dividers: [
        {
          label: { label: rowsLabel("[e1", "e2]"), labelBox: boxOf("[e1", "e2]"), anchor: dividerAnchor(boxOf("[e1", "e2]"), 10, 140) },
          y: 140,
        },
      ],
      children: [],
    };

    const texts = Array.from(
      renderSequenceToSVG(buildBlockFixture(block)).querySelectorAll("text.siren-block-label"),
    );

    expect(texts.map(rowsOf)).toEqual([
      ["[every", "day]"],
      ["[e1", "e2]"],
    ]);
    // Each is centred on its box, whose left edge is where the condition
    // always began: past the keyword in the header, at the inset in a divider.
    const [header, divider] = texts;
    expect(Number(header!.getAttribute("x")) - "[every".length * 4).toBe(10 + 8 + 64);
    expect(Number(divider!.getAttribute("x")) - "[e1".length * 4).toBe(10 + 8);
  });

  it("draws a block's and a divider's condition centred on the anchor layout gave each", () => {
    const block: PositionedBlock = {
      id: "alt:1",
      kind: "alt",
      label: { label: plainLabel("[c]"), labelBox: boxOf("[c]"), anchor: { x: 123, y: 77 } },
      color: null,
      x: 10,
      y: 40,
      width: 300,
      height: 200,
      dividers: [{ label: { label: plainLabel("[e]"), labelBox: boxOf("[e]"), anchor: { x: 45, y: 161 } }, y: 140 }],
      children: [],
    };

    const texts = Array.from(
      renderSequenceToSVG(buildBlockFixture(block)).querySelectorAll("text.siren-block-label"),
    );

    expect(texts.map((text) => [text.getAttribute("x"), text.getAttribute("y")])).toEqual([
      ["123", "77"],
      ["45", "161"],
    ]);
  });

  it("centres a block's keyword on the same line as its condition's first row", () => {
    const block: PositionedBlock = {
      id: "loop:1",
      kind: "loop",
      label: { label: rowsLabel("[every", "day]"), labelBox: boxOf("[every", "day]"), anchor: headerAnchor(boxOf("[every", "day]"), 10, 40) },
      color: null,
      x: 10,
      y: 40,
      width: 300,
      height: 200,
      dividers: [],
      children: [],
    };

    const group = renderSequenceToSVG(buildBlockFixture(block)).querySelector("g.siren-block")!;
    const keyword = group.querySelector("text.siren-block-keyword")!;
    const firstRow = group.querySelector("text.siren-block-label tspan.siren-label-row")!;

    expect(keyword.getAttribute("dominant-baseline")).toBe("middle");
    expect(keyword.getAttribute("y")).toBe(firstRow.getAttribute("y"));
  });

  it("draws a box's label row by row across the top of its background, in the band layout left for it", () => {
    const diagram: PositionedSequenceDiagram = {
      ...buildParticipantsFixture(),
      boxes: [
        {
          id: "box:1",
          color: null,
          label: { label: rowsLabel("Grp", "two"), labelBox: boxOf("Grp", "two"), anchor: { x: 150, y: 24 } },
          x: 0,
          y: 0,
          width: 300,
          height: 400,
        },
      ],
    };

    const text = renderSequenceToSVG(diagram).querySelector("text.siren-box-label");

    expect(rowsOf(text)).toEqual(["Grp", "two"]);
    // Centred across the box, and its two 24-tall rows filling the top 48.
    expect([text?.getAttribute("x"), text?.getAttribute("y")]).toEqual(["150", "24"]);
  });
});

