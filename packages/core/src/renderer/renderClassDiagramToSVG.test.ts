import { describe, expect, it } from "vitest";
import { renderClassDiagramToSVG } from "./renderClassDiagramToSVG";
import type {
  ClassRelationshipEnd,
  ClassRelationshipLine,
  PositionedClass,
  PositionedClassDiagram,
  PositionedClassNamespace,
  PositionedClassNote,
  PositionedClassRelationship,
} from "../contracts";

/**
 * Hand-built class box with no compartments — a bare `class Animal`, laid
 * out at a known box. Every field a test does not care about is given a
 * neutral value here so each test reads as the one thing it exercises.
 */
function buildClass(overrides: Partial<PositionedClass> = {}): PositionedClass {
  return {
    id: "Animal",
    name: "Animal",
    annotation: null,
    x: 10,
    y: 20,
    width: 120,
    height: 60,
    attributes: null,
    methods: null,
    style: [],
    interaction: null,
    ...overrides,
  };
}

/**
 * A class with both compartments populated: two attributes under a divider
 * at y=50, one method under a divider at y=90, inside a box spanning
 * y=20..140.
 */
const COMPARTMENTED_CLASS: Partial<PositionedClass> = {
  height: 120,
  attributes: {
    dividerY: 50,
    members: [
      { text: "+int age", x: 18, y: 64 },
      { text: "-String name", x: 18, y: 82 },
    ],
  },
  methods: {
    dividerY: 90,
    members: [{ text: "+isMammal() bool", x: 18, y: 104 }],
  },
};

/**
 * Hand-built relationship between the two fixture classes, defaulting to
 * Mermaid's `Animal --> Duck` association; each test overrides the axes and
 * text it is about.
 */
function buildRelationship(
  overrides: Partial<PositionedClassRelationship> = {},
): PositionedClassRelationship {
  return {
    id: "Animal-Duck",
    from: "Animal",
    to: "Duck",
    line: "solid",
    fromEnd: "none",
    toEnd: "arrow",
    points: [
      { x: 70, y: 80 },
      { x: 70, y: 160 },
      { x: 260, y: 160 },
    ],
    label: null,
    labelAnchor: null,
    fromMultiplicity: null,
    fromMultiplicityAnchor: null,
    toMultiplicity: null,
    toMultiplicityAnchor: null,
    ...overrides,
  };
}

/**
 * Mermaid's eight class relationship forms as the `{ line, fromEnd, toEnd }`
 * triples contracts.ts models them by, with the rendering each one is
 * expected to get. Written from Mermaid's class-diagram syntax (the marker
 * always sits on the end the author put it on: `Animal <|-- Duck` decorates
 * the `from` end), not from this renderer's output.
 */
const MERMAID_RELATIONSHIP_TYPES = [
  {
    mermaid: "<|--",
    type: "inheritance",
    line: "solid",
    fromEnd: "triangle",
    toEnd: "none",
    dashed: false,
    startMarked: true,
    endMarked: false,
  },
  {
    mermaid: "*--",
    type: "composition",
    line: "solid",
    fromEnd: "diamondFilled",
    toEnd: "none",
    dashed: false,
    startMarked: true,
    endMarked: false,
  },
  {
    mermaid: "o--",
    type: "aggregation",
    line: "solid",
    fromEnd: "diamondHollow",
    toEnd: "none",
    dashed: false,
    startMarked: true,
    endMarked: false,
  },
  {
    mermaid: "-->",
    type: "association",
    line: "solid",
    fromEnd: "none",
    toEnd: "arrow",
    dashed: false,
    startMarked: false,
    endMarked: true,
  },
  {
    mermaid: "--",
    type: "link",
    line: "solid",
    fromEnd: "none",
    toEnd: "none",
    dashed: false,
    startMarked: false,
    endMarked: false,
  },
  {
    mermaid: "..>",
    type: "dependency",
    line: "dashed",
    fromEnd: "none",
    toEnd: "arrow",
    dashed: true,
    startMarked: false,
    endMarked: true,
  },
  {
    mermaid: "..|>",
    type: "realization",
    line: "dashed",
    fromEnd: "none",
    toEnd: "triangle",
    dashed: true,
    startMarked: false,
    endMarked: true,
  },
  {
    mermaid: "..",
    type: "dashedLink",
    line: "dashed",
    fromEnd: "none",
    toEnd: "none",
    dashed: true,
    startMarked: false,
    endMarked: false,
  },
] as const satisfies readonly {
  mermaid: string;
  type: string;
  line: ClassRelationshipLine;
  fromEnd: ClassRelationshipEnd;
  toEnd: ClassRelationshipEnd;
  dashed: boolean;
  startMarked: boolean;
  endMarked: boolean;
}[];

/**
 * Hand-built namespace frame, laid out around the class fixtures above with
 * its label centered on the strip along its top edge — `labelAnchor` is the
 * label's center point, as `layoutClassDiagram` computes it.
 */
function buildNamespace(
  overrides: Partial<PositionedClassNamespace> = {},
): PositionedClassNamespace {
  return {
    id: "Zoo",
    label: "Zoo",
    x: 4,
    y: 6,
    width: 300,
    height: 200,
    labelAnchor: { x: 154, y: 20 },
    ...overrides,
  };
}

/** Hand-built free note — a box with text and no connector; each test attaches its own. */
function buildNote(overrides: Partial<PositionedClassNote> = {}): PositionedClassNote {
  return {
    id: "note-1",
    text: "Ducks are birds",
    x: 200,
    y: 40,
    width: 160,
    height: 40,
    linkPoints: null,
    ...overrides,
  };
}

/** Hand-built diagram carrying the given classes and relationships, and no timeline. */
function buildDiagram(
  classes: PositionedClass[],
  relationships: PositionedClassRelationship[] = [],
): PositionedClassDiagram {
  return {
    direction: "TB",
    classes,
    relationships,
    namespaces: [],
    notes: [],
    timeline: { totalSteps: 0, entries: [] },
    width: 400,
    height: 300,
  };
}

describe("renderClassDiagramToSVG", () => {
  it("sizes the root svg from the diagram's own dimensions", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([buildClass()]));

    expect(svg.getAttribute("width")).toBe("400");
    expect(svg.getAttribute("height")).toBe("300");
    expect(svg.getAttribute("viewBox")).toBe("0 0 400 300");
  });

  it("renders one identified group per class, holding a frame rect at the class's box", () => {
    const svg = renderClassDiagramToSVG(
      buildDiagram([buildClass(), buildClass({ id: "Duck", name: "Duck", x: 200, y: 20 })]),
    );

    const groups = svg.querySelectorAll("g.siren-class");
    expect(groups.length).toBe(2);
    expect(Array.from(groups).map((g) => g.getAttribute("data-siren-id"))).toEqual([
      "Animal",
      "Duck",
    ]);

    const frame = groups[0].querySelector("rect.siren-class-frame");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("x")).toBe("10");
    expect(frame?.getAttribute("y")).toBe("20");
    expect(frame?.getAttribute("width")).toBe("120");
    expect(frame?.getAttribute("height")).toBe("60");
  });

  it("renders the class name centered in the box when the class has no compartments", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([buildClass({ name: "Square~Shape~" })]));

    const name = svg.querySelector("g.siren-class text.siren-class-name");
    expect(name?.textContent).toBe("Square~Shape~");
    expect(name?.getAttribute("x")).toBe("70");
    expect(name?.getAttribute("y")).toBe("50");
  });

  it("renders one divider per compartment the layout recorded, spanning the frame", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([buildClass(COMPARTMENTED_CLASS)]));

    const dividers = svg.querySelectorAll("g.siren-class line.siren-class-divider");
    expect(dividers.length).toBe(2);
    expect(Array.from(dividers).map((line) => line.getAttribute("y1"))).toEqual(["50", "90"]);
    expect(Array.from(dividers).map((line) => line.getAttribute("y2"))).toEqual(["50", "90"]);
    expect(dividers[0].getAttribute("x1")).toBe("10");
    expect(dividers[0].getAttribute("x2")).toBe("130");
  });

  it("renders one member text per member line, at the position the layout assigned it", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([buildClass(COMPARTMENTED_CLASS)]));

    const members = svg.querySelectorAll("g.siren-class text.siren-member");
    expect(Array.from(members).map((text) => text.textContent)).toEqual([
      "+int age",
      "-String name",
      "+isMammal() bool",
    ]);
    expect(members[0].getAttribute("x")).toBe("18");
    expect(members[0].getAttribute("y")).toBe("64");
    expect(members[2].getAttribute("x")).toBe("18");
    expect(members[2].getAttribute("y")).toBe("104");
  });

  it("centers the class name above the first divider when the class has compartments", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([buildClass(COMPARTMENTED_CLASS)]));

    // The name compartment runs from the box's top edge (20) to the first
    // divider (50), so its center sits at 35 rather than the whole box's 80.
    expect(svg.querySelector("text.siren-class-name")?.getAttribute("y")).toBe("35");
  });

  it("renders one identified group per relationship, with its line along the layout's points", () => {
    const svg = renderClassDiagramToSVG(
      buildDiagram(
        [buildClass(), buildClass({ id: "Duck", name: "Duck", x: 200, y: 140 })],
        [buildRelationship()],
      ),
    );

    const groups = svg.querySelectorAll("g.siren-relationship");
    expect(groups.length).toBe(1);
    expect(groups[0].getAttribute("data-siren-id")).toBe("Animal-Duck");

    const line = groups[0].querySelector("path.siren-relationship-line");
    expect(line?.getAttribute("d")).toBe("M70,80 L70,160 L260,160");
    // A multi-segment path must never be painted as a filled polygon, however
    // it is themed — same reasoning as the sequence renderer's frames.
    expect(line?.getAttribute("fill")).toBe("none");
  });

  it("defines all four endpoint markers as distinct marker defs", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([], []));

    const markers = svg.querySelectorAll("defs > marker");
    const ids = Array.from(markers).map((marker) => marker.getAttribute("id"));
    expect(markers.length).toBe(4);
    expect(new Set(ids).size).toBe(4);
    // Each def must actually draw something, or a "distinct marker" is an
    // empty box on screen.
    for (const marker of Array.from(markers)) {
      expect(marker.querySelector("path")?.getAttribute("d")).toBeTruthy();
    }
  });

  it.each(MERMAID_RELATIONSHIP_TYPES)(
    "renders $mermaid ($type) with its own markers and line style",
    ({ type, line, fromEnd, toEnd, dashed, startMarked, endMarked }) => {
      const svg = renderClassDiagramToSVG(
        buildDiagram([], [buildRelationship({ line, fromEnd, toEnd })]),
      );

      const group = svg.querySelector("g.siren-relationship");
      expect(group?.getAttribute("data-siren-relationship")).toBe(type);

      const path = group?.querySelector("path.siren-relationship-line");
      expect(path?.hasAttribute("marker-start")).toBe(startMarked);
      expect(path?.hasAttribute("marker-end")).toBe(endMarked);
      expect(path?.hasAttribute("stroke-dasharray")).toBe(dashed);

      // Every marker reference has to resolve to a def in this same document,
      // or the endpoint silently renders as nothing.
      const references = [path?.getAttribute("marker-start"), path?.getAttribute("marker-end")];
      for (const reference of references) {
        if (reference !== null && reference !== undefined) {
          expect(reference).toMatch(/^url\(#.+\)$/);
          const id = reference.slice("url(#".length, -1);
          expect(svg.querySelector(`defs > marker#${id}`)).not.toBeNull();
        }
      }
    },
  );

  it("gives each of the eight Mermaid relationship types a distinguishable rendering", () => {
    const signatures = MERMAID_RELATIONSHIP_TYPES.map(({ line, fromEnd, toEnd }) => {
      const svg = renderClassDiagramToSVG(
        buildDiagram([], [buildRelationship({ line, fromEnd, toEnd })]),
      );
      const path = svg.querySelector("path.siren-relationship-line");
      return [
        path?.getAttribute("marker-start"),
        path?.getAttribute("marker-end"),
        path?.getAttribute("stroke-dasharray"),
      ].join("|");
    });

    expect(new Set(signatures).size).toBe(MERMAID_RELATIONSHIP_TYPES.length);
  });

  it("renders a relationship's label and both multiplicity strings at their anchors", () => {
    const svg = renderClassDiagramToSVG(
      buildDiagram(
        [],
        [
          buildRelationship({
            label: "owns",
            labelAnchor: { x: 150, y: 148 },
            fromMultiplicity: "1",
            fromMultiplicityAnchor: { x: 80, y: 96 },
            toMultiplicity: "*",
            toMultiplicityAnchor: { x: 244, y: 152 },
          }),
        ],
      ),
    );

    const group = svg.querySelector("g.siren-relationship");
    const label = group?.querySelector("text.siren-relationship-label");
    expect(label?.textContent).toBe("owns");
    expect(label?.getAttribute("x")).toBe("150");
    expect(label?.getAttribute("y")).toBe("148");

    const multiplicities = group?.querySelectorAll("text.siren-multiplicity") ?? [];
    expect(Array.from(multiplicities).map((text) => text.textContent)).toEqual(["1", "*"]);
    expect(multiplicities[0].getAttribute("x")).toBe("80");
    expect(multiplicities[0].getAttribute("y")).toBe("96");
    expect(multiplicities[1].getAttribute("x")).toBe("244");
    expect(multiplicities[1].getAttribute("y")).toBe("152");
  });

  it("renders no label or multiplicity text when the relationship carries none", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([], [buildRelationship()]));

    expect(svg.querySelectorAll("text.siren-relationship-label").length).toBe(0);
    expect(svg.querySelectorAll("text.siren-multiplicity").length).toBe(0);
  });

  it("renders only the multiplicity that is present", () => {
    const svg = renderClassDiagramToSVG(
      buildDiagram(
        [],
        [buildRelationship({ toMultiplicity: "0..1", toMultiplicityAnchor: { x: 244, y: 152 } })],
      ),
    );

    const multiplicities = svg.querySelectorAll("text.siren-multiplicity");
    expect(multiplicities.length).toBe(1);
    expect(multiplicities[0].textContent).toBe("0..1");
  });

  it("starts classes and relationships with an enter action as siren-pending", () => {
    const diagram = buildDiagram(
      [buildClass(), buildClass({ id: "Duck", name: "Duck", x: 200, y: 140 })],
      [buildRelationship()],
    );
    diagram.timeline = {
      totalSteps: 2,
      entries: [
        { kind: "enter", step: 1, targetId: "Duck", effect: "fade" },
        { kind: "enter", step: 2, targetId: "Animal-Duck", effect: "fade" },
      ],
    };
    const svg = renderClassDiagramToSVG(diagram);

    expect(svg.querySelector('g.siren-class[data-siren-id="Animal"]')?.getAttribute("class")).toBe(
      "siren-class",
    );
    expect(svg.querySelector('g.siren-class[data-siren-id="Duck"]')?.getAttribute("class")).toBe(
      "siren-class siren-pending",
    );
    expect(svg.querySelector("g.siren-relationship")?.getAttribute("class")).toBe(
      "siren-relationship siren-pending",
    );
  });

  it("leaves an element whose only actions are exit or highlight visible from the start", () => {
    const diagram = buildDiagram(
      [buildClass(), buildClass({ id: "Duck", name: "Duck", x: 200, y: 140 })],
      [buildRelationship()],
    );
    diagram.timeline = {
      totalSteps: 2,
      entries: [
        { kind: "exit", step: 1, targetId: "Animal", effect: "fade" },
        { kind: "highlight", step: 1, targetId: "Duck", effect: "glow" },
        { kind: "unhighlight", step: 2, targetId: "Animal-Duck" },
      ],
    };
    const svg = renderClassDiagramToSVG(diagram);

    expect(svg.querySelectorAll(".siren-pending").length).toBe(0);
  });

  // Guard for the hard invariant every Siren renderer holds: author text is
  // set with textContent, never innerHTML, so markup-looking input renders as
  // characters instead of becoming elements.
  it("renders markup-looking author text literally, never as markup", () => {
    const markup = '<script>alert("x")</script>';
    const svg = renderClassDiagramToSVG(
      buildDiagram(
        [
          buildClass({
            name: markup,
            methods: { dividerY: 50, members: [{ text: markup, x: 18, y: 64 }] },
          }),
        ],
        [
          buildRelationship({
            label: markup,
            labelAnchor: { x: 150, y: 148 },
            toMultiplicity: markup,
            toMultiplicityAnchor: { x: 244, y: 152 },
          }),
        ],
      ),
    );

    expect(svg.querySelector("text.siren-class-name")?.textContent).toBe(markup);
    expect(svg.querySelector("text.siren-member")?.textContent).toBe(markup);
    expect(svg.querySelector("text.siren-relationship-label")?.textContent).toBe(markup);
    expect(svg.querySelector("text.siren-multiplicity")?.textContent).toBe(markup);
    expect(svg.querySelectorAll("script").length).toBe(0);
    for (const text of Array.from(svg.querySelectorAll("text"))) {
      expect(text.children.length).toBe(0);
    }
  });

  // Characterization: this passed before the ticket that added it. A generic
  // is composed into `PositionedClass.name` by `layoutClassDiagram` (which
  // measures the box from the composed text and turns Mermaid's authoring
  // `~T~` into the `<T>` Mermaid draws), so the renderer has nothing to do
  // beyond drawing the name it is handed — pinned here so the composed
  // spelling cannot be lost at this seam, and asserted as text rather than as
  // markup for the same reason every label in this file is.
  it("draws a generic as part of the class name, in the spelling the layout composed", () => {
    const svg = renderClassDiagramToSVG(
      buildDiagram([buildClass({ id: "Registry", name: "Registry<T>" })]),
    );

    const name = svg.querySelector("g.siren-class text.siren-class-name");
    expect(name?.textContent).toBe("Registry<T>");
    expect(name?.children.length).toBe(0);
  });

  it("renders an annotation above the class name, sharing the name band with it", () => {
    // The name band runs from the box's top edge (20) to the first divider
    // (60), and `layoutClassDiagram` reserved a line in it for the annotation
    // above the name — so the two lines take half the band each: the
    // annotation centered at 30, the name pushed down to 50.
    const svg = renderClassDiagramToSVG(
      buildDiagram([
        buildClass({
          annotation: "interface",
          height: 120,
          attributes: { dividerY: 60, members: [{ text: "+int age", x: 18, y: 74 }] },
        }),
      ]),
    );

    const annotation = svg.querySelector("g.siren-class text.siren-class-annotation");
    // Mermaid draws `<<interface>>` in guillemets, and `layoutClassDiagram`
    // measures the annotation without them precisely because this renderer
    // adds them.
    expect(annotation?.textContent).toBe("«interface»");
    expect(annotation?.getAttribute("x")).toBe("70");
    expect(annotation?.getAttribute("y")).toBe("30");
    expect(svg.querySelector("text.siren-class-name")?.getAttribute("y")).toBe("50");
  });

  it("renders no annotation text for a class that carries none", () => {
    const svg = renderClassDiagramToSVG(buildDiagram([buildClass(COMPARTMENTED_CLASS)]));

    expect(svg.querySelectorAll("text.siren-class-annotation").length).toBe(0);
    // The name keeps the whole band to itself, exactly as before.
    expect(svg.querySelector("text.siren-class-name")?.getAttribute("y")).toBe("35");
  });

  it("renders one identified group per namespace, holding its frame and label", () => {
    const svg = renderClassDiagramToSVG({
      ...buildDiagram([buildClass()]),
      namespaces: [buildNamespace()],
    });

    const groups = svg.querySelectorAll("g.siren-namespace");
    expect(groups.length).toBe(1);
    expect(groups[0].getAttribute("data-siren-id")).toBe("Zoo");

    const frame = groups[0].querySelector("rect.siren-namespace-frame");
    expect(frame?.getAttribute("x")).toBe("4");
    expect(frame?.getAttribute("y")).toBe("6");
    expect(frame?.getAttribute("width")).toBe("300");
    expect(frame?.getAttribute("height")).toBe("200");

    const label = groups[0].querySelector("text.siren-namespace-label");
    expect(label?.textContent).toBe("Zoo");
    expect(label?.getAttribute("x")).toBe("154");
    expect(label?.getAttribute("y")).toBe("20");
  });

  it("renders every namespace before the classes, so a frame paints behind its members", () => {
    const svg = renderClassDiagramToSVG({
      ...buildDiagram([buildClass(), buildClass({ id: "Duck", name: "Duck", x: 200, y: 20 })]),
      namespaces: [buildNamespace(), buildNamespace({ id: "Aviary", label: "Aviary" })],
    });

    // SVG has no z-index: what paints behind is whatever comes first in
    // document order, so a frame drawn after its members would hide them.
    const drawn = Array.from(svg.children).map((child) => child.getAttribute("class"));
    expect(drawn).toEqual([
      null,
      "siren-namespace",
      "siren-namespace",
      "siren-class",
      "siren-class",
    ]);
  });

  it("renders one identified group per note, holding its frame and its text", () => {
    const svg = renderClassDiagramToSVG({
      ...buildDiagram([buildClass()]),
      notes: [buildNote()],
    });

    const groups = svg.querySelectorAll("g.siren-note");
    expect(groups.length).toBe(1);
    expect(groups[0].getAttribute("data-siren-id")).toBe("note-1");

    const frame = groups[0].querySelector("rect.siren-note-frame");
    expect(frame?.getAttribute("x")).toBe("200");
    expect(frame?.getAttribute("y")).toBe("40");
    expect(frame?.getAttribute("width")).toBe("160");
    expect(frame?.getAttribute("height")).toBe("40");

    // The layout pads the box around the text it measured, so the text sits
    // at the box's center in both axes.
    const text = groups[0].querySelector("text.siren-note-text");
    expect(text?.textContent).toBe("Ducks are birds");
    expect(text?.getAttribute("x")).toBe("280");
    expect(text?.getAttribute("y")).toBe("60");
  });

  it("renders a connector along the layout's points for an attached note", () => {
    const svg = renderClassDiagramToSVG({
      ...buildDiagram([buildClass()]),
      notes: [
        buildNote({
          linkPoints: [
            { x: 200, y: 60 },
            { x: 160, y: 60 },
            { x: 130, y: 50 },
          ],
        }),
      ],
    });

    const link = svg.querySelector("g.siren-note path.siren-note-link");
    expect(link?.getAttribute("d")).toBe("M200,60 L160,60 L130,50");
    // An open, multi-segment path, exactly like a relationship line: a default
    // fill would paint it as a polygon across the diagram.
    expect(link?.getAttribute("fill")).toBe("none");
  });

  it("renders no connector for a free note", () => {
    const svg = renderClassDiagramToSVG({
      ...buildDiagram([buildClass()]),
      notes: [buildNote()],
    });

    expect(svg.querySelectorAll("path.siren-note-link").length).toBe(0);
  });

  it("renders a single divider for a class that only has methods", () => {
    const methodsOnly = buildClass({
      attributes: null,
      methods: COMPARTMENTED_CLASS.methods,
    });
    const svg = renderClassDiagramToSVG(buildDiagram([methodsOnly]));

    const dividers = svg.querySelectorAll("line.siren-class-divider");
    expect(dividers.length).toBe(1);
    expect(dividers[0].getAttribute("y1")).toBe("90");
    expect(svg.querySelector("text.siren-class-name")?.getAttribute("y")).toBe("55");
  });
});
