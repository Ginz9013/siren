import { describe, expect, it } from "vitest";
import { renderSequenceToSVG } from "./renderSequenceToSVG";
import type {
  PositionedSequenceDiagram,
  PositionedParticipant,
  PositionedMessage,
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
});
