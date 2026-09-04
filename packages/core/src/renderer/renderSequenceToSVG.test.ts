import { describe, expect, it } from "vitest";
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
} from "../contracts";

/** Hand-built fixture: one `participant` box lane, one `actor` stick-figure lane, no messages. */
function buildParticipantsFixture(): PositionedSequenceDiagram {
  const alice: PositionedParticipant = {
    id: "Alice",
    label: "Alice",
    participantKind: "participant",
    origin: "declared",
    x: 60,
    top: 0,
    bottom: 300,
    width: 100,
    height: 40,
  };
  const bob: PositionedParticipant = {
    id: "Bob",
    label: "Bob",
    participantKind: "actor",
    origin: "declared",
    x: 220,
    top: 0,
    bottom: 300,
    width: 60,
    height: 50,
  };
  return {
    title: null,
    participants: [alice, bob],
    boxes: [],
    elements: [],
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
    text: "hello",
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

    const groups = svg.querySelectorAll("g.siren-participant");
    expect(groups).toHaveLength(2);

    const aliceGroup = svg.querySelector('g.siren-participant[data-siren-id="Alice"]')!;
    expect(aliceGroup).not.toBeNull();
    const rect = aliceGroup.querySelector("rect")!;
    const text = aliceGroup.querySelector("text")!;
    expect(rect).not.toBeNull();
    expect(text.textContent).toBe("Alice");
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

    // bidirectionalFilled is the only head with both ends arrowed, using the
    // same filled marker at both ends.
    expect(markerStartByHead.get("bidirectionalFilled")).toBe(markerEndByHead.get("filled"));
    expect(markerEndByHead.get("bidirectionalFilled")).toBe(markerEndByHead.get("filled"));
    for (const head of ["none", "filled", "cross", "open"] as const) {
      expect(markerStartByHead.get(head)).toBeNull();
    }

    // filled/cross/open are visually distinct markers.
    const distinctIds = new Set(
      [markerEndByHead.get("filled"), markerEndByHead.get("cross"), markerEndByHead.get("open")].map(
        (ref) => extractMarkerId(ref),
      ),
    );
    expect(distinctIds.size).toBe(3);
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

  it("renders message labels, participant labels, and the title via textContent only, never as parsed markup", () => {
    const diagram = buildMessageFixture({ line: "solid", head: "filled" });
    diagram.title = "<script>alert(1)</script>";
    (diagram.elements[0] as { kind: "message"; message: PositionedMessage }).message.text =
      "<b>hi</b>";
    diagram.participants[0]!.label = "<i>Alice</i>";

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
      id: "loop-1",
      kind: "loop",
      label: "n < 5",
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

    const group = svg.querySelector('g.siren-block[data-siren-id="loop-1"]')!;
    expect(group).not.toBeNull();
    expect(group.getAttribute("data-siren-block-kind")).toBe("loop");

    const frame = group.querySelector("rect.siren-block-frame")!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("x")).toBe("40");
    expect(frame.getAttribute("y")).toBe("50");
    expect(frame.getAttribute("width")).toBe("200");
    expect(frame.getAttribute("height")).toBe("80");

    const label = group.querySelector("text.siren-block-label")!;
    expect(label).not.toBeNull();
    expect(label.textContent).toBe("n < 5");
    // Top-left per Mermaid's convention: inside the frame, hugging its top edge.
    const labelX = Number(label.getAttribute("x"));
    const labelY = Number(label.getAttribute("y"));
    expect(labelX).toBeGreaterThanOrEqual(block.x);
    expect(labelX).toBeLessThan(block.x + block.width);
    expect(labelY).toBeGreaterThanOrEqual(block.y);
    expect(labelY).toBeLessThan(block.y + 20);
  });

  it("renders one divider line + branch label per branch after the first, for an alt with three branches", () => {
    const block: PositionedBlock = {
      id: "alt-1",
      kind: "alt",
      label: "x == 1",
      x: 20,
      y: 30,
      width: 240,
      height: 180,
      dividers: [
        { label: "x == 2", y: 90 },
        { label: "else", y: 140 },
      ],
      children: [],
    };
    const svg = renderSequenceToSVG(buildBlockFixture(block));

    const group = svg.querySelector('g.siren-block[data-siren-id="alt-1"]')!;
    const dividers = group.querySelectorAll("line.siren-block-divider");
    expect(dividers).toHaveLength(2);
    expect(dividers[0]!.getAttribute("y1")).toBe("90");
    expect(dividers[0]!.getAttribute("y2")).toBe("90");
    expect(dividers[0]!.getAttribute("x1")).toBe("20");
    expect(dividers[0]!.getAttribute("x2")).toBe("260");
    expect(dividers[1]!.getAttribute("y1")).toBe("140");

    // Header condition label plus one label per divider branch.
    const labels = Array.from(group.querySelectorAll("text.siren-block-label")).map(
      (label) => label.textContent,
    );
    expect(labels).toEqual(["x == 1", "x == 2", "else"]);
  });

  it("renders a rect block as a filled background rect using its color, with no frame border, behind its contained message in paint order", () => {
    const message: PositionedMessage = {
      id: "Alice-Bob",
      from: "Alice",
      to: "Bob",
      text: "hi",
      arrow: { line: "solid", head: "filled" },
      autonumber: null,
      y: 100,
      fromX: 60,
      toX: 220,
    };
    const block: PositionedBlock = {
      id: "rect-1",
      kind: "rect",
      label: "rgb(191, 223, 255)",
      x: 20,
      y: 60,
      width: 240,
      height: 100,
      dividers: [],
      children: [{ kind: "message", message }],
    };
    const svg = renderSequenceToSVG(buildBlockFixture(block));

    const group = svg.querySelector('g.siren-block[data-siren-id="rect-1"]')!;

    // No outlined frame, no header/branch labels — distinct from the other
    // six block kinds.
    expect(group.querySelector("rect.siren-block-frame")).toBeNull();
    expect(group.querySelectorAll("text.siren-block-label")).toHaveLength(0);

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
      id: "alt-1",
      kind: "alt",
      label: "y > 0",
      x: 60,
      y: 80,
      width: 160,
      height: 60,
      dividers: [],
      children: [],
    };
    const outerBlock: PositionedBlock = {
      id: "loop-1",
      kind: "loop",
      label: "n < 5",
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

    const outerGroup = svg.querySelector('g.siren-block[data-siren-id="loop-1"]')!;
    const innerGroup = outerGroup.querySelector('g.siren-block[data-siren-id="alt-1"]');
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
      id: "loop-1",
      kind: "loop",
      label: "retrying",
      x: 40,
      y: 60,
      width: 220,
      height: 120,
      dividers: [],
      children: [{ kind: "destroyMark", mark }],
    };
    const svg = renderSequenceToSVG(buildBlockFixture(block));

    expect(svg.querySelectorAll("path.siren-destroy-mark")).toHaveLength(1);
    const group = svg.querySelector('g.siren-block[data-siren-id="loop-1"]')!;
    expect(group.querySelector('path.siren-destroy-mark[data-siren-id="Bob"]')).not.toBeNull();
  });

  it("renders a box as a siren-box group with a background rect at its bounding box, painted before every participant, lifeline and message it groups", () => {
    const box: PositionedBox = {
      id: "box-1",
      color: "rgb(200, 220, 240)",
      label: "Service Layer",
      x: 10,
      y: 4,
      width: 280,
      height: 292,
    };
    const svg = renderSequenceToSVG(buildBoxFixture([box]));

    const groups = svg.querySelectorAll("g.siren-box");
    expect(groups).toHaveLength(1);

    const group = svg.querySelector('g.siren-box[data-siren-id="box-1"]')!;
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

  it("renders a box's label as text inside its group when given, none when absent, and via textContent only", () => {
    const labelled: PositionedBox = {
      id: "box-1",
      color: null,
      label: "<b>Service Layer</b>",
      x: 10,
      y: 4,
      width: 280,
      height: 292,
    };
    const unlabelled: PositionedBox = { ...labelled, id: "box-2", label: null };

    const labelledSvg = renderSequenceToSVG(buildBoxFixture([labelled]));
    const unlabelledSvg = renderSequenceToSVG(buildBoxFixture([unlabelled]));

    const labelledGroup = labelledSvg.querySelector('g.siren-box[data-siren-id="box-1"]')!;
    const texts = labelledGroup.querySelectorAll("text");
    expect(texts).toHaveLength(1);
    expect(texts[0]!.textContent).toBe("<b>Service Layer</b>");
    expect(labelledSvg.querySelectorAll("b")).toHaveLength(0);

    const unlabelledGroup = unlabelledSvg.querySelector('g.siren-box[data-siren-id="box-2"]')!;
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
      id: "box-1",
      color: null,
      label: null,
      x: 10,
      y: 4,
      width: 140,
      height: 292,
    };
    const colored: PositionedBox = { ...uncolored, id: "box-2", color: "#eef", x: 150 };

    const svg = renderSequenceToSVG(buildBoxFixture([uncolored, colored]));

    expect(svg.querySelectorAll("g.siren-box")).toHaveLength(2);
    const uncoloredRect = svg.querySelector('g.siren-box[data-siren-id="box-1"] rect')!;
    const coloredRect = svg.querySelector('g.siren-box[data-siren-id="box-2"] rect')!;
    expect(uncoloredRect.getAttribute("fill")).toBeNull();
    expect(coloredRect.getAttribute("fill")).toBe("#eef");
  });

  it("renders block header labels and branch divider labels via textContent only, never as parsed markup", () => {
    const block: PositionedBlock = {
      id: "alt-1",
      kind: "alt",
      label: "<b>x == 1</b>",
      x: 20,
      y: 30,
      width: 240,
      height: 180,
      dividers: [{ label: "<i>else</i>", y: 120 }],
      children: [],
    };
    const svg = renderSequenceToSVG(buildBlockFixture(block));

    expect(svg.querySelectorAll("b, i")).toHaveLength(0);

    const labels = Array.from(svg.querySelectorAll("text.siren-block-label")).map(
      (label) => label.textContent,
    );
    expect(labels).toEqual(["<b>x == 1</b>", "<i>else</i>"]);
  });
});
