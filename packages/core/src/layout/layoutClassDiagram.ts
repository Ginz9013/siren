import type {
  Direction,
  ClassMember,
  ClassModel,
  LayoutOptions,
  Point,
  PositionedClass,
  PositionedClassCompartment,
  PositionedClassDiagram,
  PositionedClassNamespace,
  PositionedClassNote,
  PositionedClassRelationship,
  ResolvedClass,
  ResolvedClassRelationship,
  ResolvedInteraction,
  Label,
  LabelBox,
} from "../contracts";
import { type Curve, curveCornerRadius } from "../curve/curve";
import { atConnectorLabelSize, plainLabel } from "../label/label";
import { layoutLabel } from "../label/layoutLabel";
import { wrapConnectorLabel } from "../label/wrapLabel";
import {
  layoutDirectedGraph,
  type DirectedGraphNodeBox,
  type DirectedGraphTerminalLabel,
} from "./directedGraph/layoutDirectedGraph";

/**
 * The curve every relationship and note link is drawn with: `rounded`, the
 * orthogonal route's corners cut back and rounded with a radius of 5 —
 * Mermaid 12.2.0's, whose `applyElkEdgeLayout` (`elk-V4PLJRSU.mjs`, line
 * 100401) sets `curve = "rounded"` on every edge ELK routed, class
 * relations and note links among them (nook decision
 * `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 6). A class diagram has no
 * `linkStyle … interpolate` to choose another. Exported for the renderer,
 * which draws with it: the radius the line hops keep clear of (handed to the
 * core below) and the corners drawn are one decision.
 */
export const CLASS_CONNECTOR_CURVE: Curve = "rounded";

/** The core's `cornerRadius` for a class connector: the radius `CLASS_CONNECTOR_CURVE` rounds its corners with. */
const CONNECTOR_CORNER_RADIUS = curveCornerRadius(CLASS_CONNECTOR_CURVE);

/** Horizontal padding between a class box's edge and its widest text line. */
const CLASS_PADDING_X = 12;
/** Vertical padding between a compartment's edge and its first/last text line. */
const CLASS_PADDING_Y = 8;
/** Gap between a namespace frame and the member boxes it encloses. */
const NAMESPACE_PADDING = 12;
/** Horizontal padding between a note box's edge and its text. */
const NOTE_PADDING_X = 10;
/** Vertical padding between a note box's edge and its text. */
const NOTE_PADDING_Y = 8;
/**
 * Padding around a lollipop's interface label, reserving just enough room
 * for the layout core to keep the label clear of its neighbours — the label
 * draws no frame (measured against real Mermaid: its box is invisible), so
 * this is breathing room only, not a border to inset text from.
 */
const INTERFACE_LABEL_PADDING_X = 4;
const INTERFACE_LABEL_PADDING_Y = 2;
/**
 * The room Mermaid keeps around a multiplicity at an end that carries a
 * marker, so the label clears the arrowhead or diamond: its
 * `TERMINAL_LABEL_MARKER_CLEARANCE` (`elk-V4PLJRSU.mjs`, line 99826), on
 * every side.
 */
const MULTIPLICITY_MARKER_CLEARANCE = 6;

/**
 * The text a member is drawn as, rebuilt from the parts the parser kept:
 * `+int age` for an attribute, `+swim() bool` for a method. The classifier
 * goes last, as Mermaid writes it (`-id$`, `#quack(int times)*`), so one
 * rule covers both member kinds whether or not a return type follows.
 */
function memberText(member: ClassMember): string {
  const visibility = member.visibility ?? "";
  const classifier = member.classifier ?? "";
  if (member.memberKind === "method") {
    const returnType =
      member.returnType === null ? "" : ` ${angleBrackets(member.returnType)}`;
    const parameters = angleBrackets(member.parameters ?? "");
    return `${visibility}${member.name}(${parameters})${returnType}${classifier}`;
  }
  const type = member.type === null ? "" : `${angleBrackets(member.type)} `;
  return `${visibility}${type}${member.name}${classifier}`;
}

/**
 * Whether `ch` can begin a generic's argument — the first character of a type
 * name. Deliberately not whitespace-tolerant: see `angleBrackets`.
 */
function opensTypeName(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

/**
 * A type as drawn, with the author's `~T~` generic delimiters turned into
 * the `<T>` Mermaid draws.
 *
 * `~` is its own closing delimiter, so which role a given tilde plays has to
 * be read off its surroundings. The rule is a single left-to-right scan: a
 * tilde immediately followed by a character that could start a type name
 * *opens* a generic and is pushed on a stack; any other tilde *closes* the
 * innermost open one. Both directions of the problem fall out of that:
 *
 * - Nested — `Map~String, List~int~~` draws as `Map<String, List<int>>`. The
 *   tilde after `List` is followed by `i`, so it opens rather than closing
 *   the one after `Map`.
 * - Sibling — `List~int~ a, Map~String,int~ b` draws as
 *   `List<int> a, Map<String,int> b`. The tilde after `int` is followed by a
 *   space, so it closes, and the second generic starts fresh.
 *
 * (An earlier version paired tildes outside-in — first with last, then
 * inward. That is right for nesting and wrong for siblings, which it
 * interleaves into `List<int< a, Map>String,int> b`. Depth, not distance from
 * the ends, is what tells the two apart.)
 *
 * A tilde left over — an open that never closed, or a close with nothing
 * open — is drawn as itself, so an author's typo costs that one character
 * rather than the rest of the line. That is also what leaves a
 * package-visibility `~` written inside a parameter list alone: in
 * `~run(~int a, ~int b)` both parameter tildes read as opens and neither ever
 * closes, so both survive to the canvas. It is a consequence of the rule, not
 * a special case, and it is not fully decidable from the text — a leading
 * `~` on a parameter *would* be consumed by a later closing tilde, as in
 * `~int a, b~`.
 *
 * The lookahead is strict about adjacency: `List~ int ~`, with spaces inside
 * the delimiters, leaves both tildes literal rather than converting. Skipping
 * whitespace there would make the space in `List~int~ a, ...` look like the
 * start of a nested argument and break siblings again, which is the case that
 * matters more.
 *
 * Applied to a type, never to a whole member line: a member's own
 * package-visibility marker is a separate field on the model, so converting
 * types only leaves it untouched by construction rather than by heuristic.
 */
function angleBrackets(type: string): string {
  const chars = [...type];
  const openIndices: number[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] !== "~") continue;
    if (opensTypeName(chars[i + 1])) {
      openIndices.push(i);
      continue;
    }
    const open = openIndices.pop();
    if (open === undefined) continue;
    chars[open] = "<";
    chars[i] = ">";
  }
  return chars.join("");
}

/**
 * The name text a class box draws: its id, carrying its generic parameter in
 * angle brackets. `~T~` is Mermaid's *authoring* delimiter — what Mermaid
 * draws is `<T>` — and this board's premise is parity with what Mermaid
 * draws, so the tildes never reach the canvas. A member's type is converted
 * by the same rule, so a generic reads the same everywhere on the box.
 *
 * The generic the parser captured runs to the last tilde on the line, so a
 * nested one (`class Map~String, List~int~~`) still arrives spelled with
 * tildes inside; `angleBrackets` converts those too.
 */
function classNameText(cls: ResolvedClass): string {
  return cls.generic === null
    ? cls.id
    : `${cls.id}<${angleBrackets(cls.generic)}>`;
}

/**
 * The label a class box draws in its name band: the one the author wrote
 * in brackets when there is one — which replaces the whole name, generic
 * included (measured, mermaid 11.17.2: `class A~T~["Lab"]` draws "Lab") —
 * and otherwise `classNameText` as one plain run. Never read as markup
 * there: the composed `<T>` is the generic Mermaid draws, not a tag.
 */
function classLabel(cls: ResolvedClass): Label {
  return cls.label ?? plainLabel(classNameText(cls));
}

/**
 * A compartment's geometry in box-local coordinates: `dividerY` is measured
 * from the box's top edge, as is each member's line center.
 */
interface CompartmentPlan {
  dividerY: number;
  members: { text: string; y: number }[];
}

/**
 * A class box measured but not yet placed: its size, and where its
 * compartments and member lines sit relative to its own top edge. Computed
 * before the shared core runs, because the core needs the size; translated
 * into diagram coordinates once the core has placed the box.
 */
interface ClassBoxPlan {
  width: number;
  height: number;
  label: Label;
  labelBox: LabelBox;
  attributes: CompartmentPlan | null;
  methods: CompartmentPlan | null;
}

/**
 * Measures a class box from its own lines: as wide as its widest measured
 * line plus padding, and as tall as its name line and every member line
 * stacked, each compartment padded and preceded by a divider.
 */
function planClassBox(
  cls: ResolvedClass,
  options: LayoutOptions,
): ClassBoxPlan {
  const measure = (text: string) => options.measureText.measure(text);
  const widths: number[] = [];
  let bottom = CLASS_PADDING_Y;

  // An annotation takes a line of its own above the class name. It is
  // measured as the model stores it — without the `«»` the renderer draws
  // around it — so the box is a couple of characters narrower than the
  // decorated text; the horizontal padding absorbs that.
  if (cls.annotation !== null) {
    const annotation = measure(cls.annotation);
    widths.push(annotation.width);
    bottom += annotation.height;
  }

  // The name is a label, so it is measured row by row: a `<br>` in a
  // written label makes the band one line taller per row it adds.
  const label = classLabel(cls);
  const labelBox = layoutLabel(label, options.measureText);
  widths.push(labelBox.width);
  bottom += labelBox.height + CLASS_PADDING_Y;

  /**
   * Stacks one group of members below everything placed so far, preceded by
   * its divider. Returns `null` for an empty group, which is how a class
   * with no attributes (or no methods) ends up with no divider drawn.
   */
  function planCompartment(members: ClassMember[]): CompartmentPlan | null {
    if (members.length === 0) return null;
    const dividerY = bottom;
    bottom += CLASS_PADDING_Y;
    const planned = members.map((member) => {
      const text = memberText(member);
      const measured = measure(text);
      widths.push(measured.width);
      const y = bottom + measured.height / 2;
      bottom += measured.height;
      return { text, y };
    });
    bottom += CLASS_PADDING_Y;
    return { dividerY, members: planned };
  }

  const attributes = planCompartment(
    cls.members.filter((member) => member.memberKind === "attribute"),
  );
  const methods = planCompartment(
    cls.members.filter((member) => member.memberKind === "method"),
  );

  return {
    width: Math.max(...widths) + CLASS_PADDING_X * 2,
    height: bottom,
    label,
    labelBox,
    attributes,
    methods,
  };
}

/**
 * A multiplicity as the core's terminal label: the size its text measures at
 * the 12px it is drawn at (`.siren-multiplicity` takes the connector label's
 * font size, so it is measured the way a connector's label is,
 * `atConnectorLabelSize`), and Mermaid's clearance where its end draws a
 * marker.
 */
function multiplicityLabel(
  text: string,
  end: ResolvedClassRelationship["fromEnd"],
  options: LayoutOptions,
): DirectedGraphTerminalLabel {
  const size = atConnectorLabelSize(options.measureText).measure(text);
  return {
    width: size.width,
    height: size.height,
    ...(end === "none" ? {} : { margin: MULTIPLICITY_MARKER_CLEARANCE }),
  };
}

/** The center of a box — where a lollipop's interface label is drawn, since it has no frame of its own to sit beside. */
function boxCenter(box: DirectedGraphNodeBox): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * The id a namespace's cluster is known by inside the shared layout core.
 * Namespace ids and class ids are separate id spaces in a `ClassModel`, so a
 * namespace may legitimately be named after a class; prefixing keeps the two
 * from colliding as graph nodes. Class nodes keep their own id unprefixed, so
 * a diagram with no namespaces is laid out exactly as before.
 */
function namespaceNodeId(id: string): string {
  return `namespace:${id}`;
}

/**
 * The id a note is known by inside the shared layout core. Prefixed for the
 * same reason a namespace's is: note ids and class ids are separate id spaces
 * in a `ClassModel`.
 */
function noteNodeId(id: string): string {
  return `note:${id}`;
}

/**
 * The id of the edge joining an attached note to its class. Prefixed away
 * from the `${from}-${to}` ids relationships carry, so a note's connector is
 * never mistaken for one of them.
 */
function noteLinkEdgeId(id: string): string {
  return `note-link:${id}`;
}

/**
 * Computes class boxes and relationship paths for a resolved `ClassModel`.
 *
 * This is the class-diagram adapter over the shared ELK layout core
 * (`directedGraph/layoutDirectedGraph`): it measures every line a class box
 * draws, hands the resulting sizes to the core — namespaces as clusters,
 * multiplicities as terminal labels, in Mermaid 12.2.0's order — and
 * reattaches the class diagram's own data to the coordinates that come back.
 * All graph-layout math lives in the core; nothing here moves a box, a frame
 * or a label afterwards. What follows Mermaid and where Siren departs from it
 * is nook decision `01M4VHSY2W1Q9E5QCA51F1TCJM`.
 */
export function layoutClassDiagram(
  model: ClassModel,
  options: LayoutOptions,
): PositionedClassDiagram {
  const planById = new Map(
    model.classes.map((cls) => [cls.id, planClassBox(cls, options)]),
  );

  const knownClassIds = new Set(model.classes.map((cls) => cls.id));

  // Membership is read from each namespace's own class list, filtered to the
  // classes this model actually has. That one list drives both the cluster
  // parentage and the frame, so the two cannot disagree. A namespace left
  // with no members is dropped entirely: it has nothing to enclose, and the
  // shared core lays a childless cluster out as an ordinary box, which would
  // put a stray frame in the middle of the diagram.
  const groups = model.namespaces
    .map((ns) => ({
      ns,
      memberIds: ns.classIds.filter((id) => knownClassIds.has(id)),
    }))
    .filter((group) => group.memberIds.length > 0);

  const namespaceIdByClassId = new Map<string, string>();
  for (const group of groups) {
    for (const id of group.memberIds) {
      namespaceIdByClassId.set(id, group.ns.id);
    }
  }

  // A note counts as attached only when the class it names is one this model
  // has. `buildClassModel` diagnoses a note pointing at an unknown class, so
  // this is the layout declining to invent a connector to nothing.
  const attachedNotes = model.notes.filter(
    (note) => note.targetId !== null && knownClassIds.has(note.targetId),
  );

  /**
   * Each framed namespace's label as `layoutLabel` measured it, by the
   * namespace's id — measured once, so the title band the core keeps in the
   * frame and the box the renderer draws in are the same box. Never wrapped,
   * as a subgraph's title is not.
   */
  const namespaceLabelBoxById = new Map(
    groups.map(({ ns }) => [ns.id, layoutLabel(ns.label, options.measureText)] as const),
  );

  /**
   * Each note's label as `layoutLabel` measured it, by the note's id — the
   * box its own is padded around, and the box the renderer draws in.
   */
  const noteLabelBoxById = new Map(
    model.notes.map((note) => [note.id, layoutLabel(note.label, options.measureText)] as const),
  );

  /**
   * Each labelled relationship's label wrapped and measured at the 12px it
   * is drawn at (`wrapConnectorLabel`: 150px of text, Mermaid's 200 scaled
   * to that size, by the label-wrap ADR, nook `01M4R4WDZ`), by the
   * relationship's id — once, so the box the core keeps clear and the box
   * the renderer draws in are the same box, and the rows drawn are the
   * wrapped label's.
   */
  const wrappedRelationshipLabelById = new Map(
    model.relationships.flatMap((rel) =>
      rel.label === null
        ? []
        : [[rel.id, wrapConnectorLabel(rel.label, options.measureText)] as const],
    ),
  );

  const laidOut = layoutDirectedGraph({
    direction: model.direction,
    // In the order Mermaid 12.2.0 hands a class diagram to ELK — its
    // `ClassDB.getData` (`classDiagram-v2-K6ZTA64I.mjs`, line 1808): every
    // namespace, then every class in the order it was first mentioned, then
    // every note, then every lollipop's interface. The core keeps the order
    // it is handed (ELK's `considerModelOrder`), so this order is a decision
    // about the picture: measured in headless Chrome, `class X` written
    // before `namespace N1 { P }` and `namespace N2 { Q }` draws N1, N2, X
    // from left to right.
    nodes: [
      // Each framed namespace goes to the core as a cluster: the core sizes
      // and places the frame — around its members, its padding and a band
      // for its title — and nothing here moves a box or a frame afterwards
      // (nook decision `01M4VANRC6B2C14NHVC2KRZ9Y8`, rule 2).
      ...groups.map((group) => ({
        id: namespaceNodeId(group.ns.id),
        width: 0,
        height: 0,
        cluster: {
          padding: NAMESPACE_PADDING,
          title: namespaceLabelBoxById.get(group.ns.id)!,
        },
      })),
      ...model.classes.map((cls) => {
        const plan = planById.get(cls.id)!;
        const namespaceId = namespaceIdByClassId.get(cls.id);
        return {
          id: cls.id,
          width: plan.width,
          height: plan.height,
          ...(namespaceId === undefined
            ? {}
            : { parentId: namespaceNodeId(namespaceId) }),
        };
      }),
      // A note is a box the layout places like any other, which is what keeps
      // it from landing on top of a class.
      ...model.notes.map((note) => {
        const labelBox = noteLabelBoxById.get(note.id)!;
        return {
          id: noteNodeId(note.id),
          width: labelBox.width + NOTE_PADDING_X * 2,
          height: labelBox.height + NOTE_PADDING_Y * 2,
        };
      }),
      // A lollipop's interface label (`buildClassModel` already minted its
      // id onto `rel.from`/`rel.to`) is placed the same way a note is: its
      // own node in the layout graph, sized from its measured text, so two
      // relationships that happen to write the same interface name still
      // get their own, independently positioned, label.
      ...model.relationships.flatMap((rel) => {
        const ends: Array<{ id: string; label: string }> = [];
        if (rel.fromInterfaceLabel !== null) {
          ends.push({ id: rel.from, label: rel.fromInterfaceLabel });
        }
        if (rel.toInterfaceLabel !== null) {
          ends.push({ id: rel.to, label: rel.toInterfaceLabel });
        }
        return ends.map(({ id, label }) => {
          const text = options.measureText.measure(label);
          return {
            id,
            width: text.width + INTERFACE_LABEL_PADDING_X * 2,
            height: text.height + INTERFACE_LABEL_PADDING_Y * 2,
          };
        });
      }),
    ],
    // Note links first, then relationships, each in model order — the order
    // `ClassDB.getData` builds its edges in.
    edges: [
      // An attached note is joined to its class by an edge that is never
      // drawn as a relationship: it is what puts the note beside the class it
      // annotates, and its route is the note's connector. From the note to
      // the class, as Mermaid's runs (`start: note.id, end: noteClassId`):
      // measured, `note for B` under TB sits a layer above B.
      ...attachedNotes.map((note) => ({
        id: noteLinkEdgeId(note.id),
        from: noteNodeId(note.id),
        to: note.targetId!,
        cornerRadius: CONNECTOR_CORNER_RADIUS,
      })),
      ...model.relationships.map((rel) => ({
        id: rel.id,
        from: rel.from,
        to: rel.to,
        // A labelled relationship asks the core to keep its ranks far enough
        // apart for the text, and reports back where that space ended up.
        ...(rel.label === null
          ? {}
          : { label: wrappedRelationshipLabelById.get(rel.id)!.labelBox }),
        // The radius the line hops keep clear of: the connector is drawn
        // rounded (`CLASS_CONNECTOR_CURVE`).
        cornerRadius: CONNECTOR_CORNER_RADIUS,
        // The multiplicities, as Mermaid 12.2.0's `ClassDB.getData` hands
        // them over (`classDiagram-v2-K6ZTA64I.mjs`, line 1910): the from
        // end's as `startLabelRight`, the to end's as `endLabelLeft`. ELK
        // keeps room for each beside its own end, and the core moves it off
        // frames and onto its own hand of the line.
        ...(rel.fromMultiplicity === null && rel.toMultiplicity === null
          ? {}
          : {
              terminalLabels: {
                ...(rel.fromMultiplicity === null
                  ? {}
                  : { startRight: multiplicityLabel(rel.fromMultiplicity, rel.fromEnd, options) }),
                ...(rel.toMultiplicity === null
                  ? {}
                  : { endLeft: multiplicityLabel(rel.toMultiplicity, rel.toEnd, options) }),
              },
            }),
      })),
    ],
  });

  const boxById = new Map(laidOut.nodes.map((box) => [box.id, box]));
  const routeById = new Map(laidOut.edges.map((route) => [route.id, route]));

  // Back into the model's own order, each frame and its title where the core
  // put them.
  const namespaces = groups.map<PositionedClassNamespace>(({ ns }) => {
    const frame = boxById.get(namespaceNodeId(ns.id))!;
    return {
      id: ns.id,
      label: { label: ns.label, labelBox: namespaceLabelBoxById.get(ns.id)!, anchor: frame.title! },
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
    };
  });

  /**
   * Each styled class's declarations, keyed for lookup below.
   *
   * `buildClassModel` has already merged everything one class was styled by —
   * its `style` statements and every `classDef` a `cssClass` applied to it —
   * into a single entry with no repeated property, and omits a class that
   * ended up with none. So there is nothing to reconcile here: this carries
   * the model's answer through, and a class absent from the map is one the
   * renderer must give no `style` attribute at all.
   */
  const styleByClassId = new Map(
    model.styles.map(({ targetId, style }) => [targetId, style]),
  );

  /**
   * The one interaction each class ends up with.
   *
   * Unlike a style, an interaction does not merge: a class is drawn either as
   * a link or as a click hook, so two `click` statements naming it are a
   * disagreement, not a set. The later one wins — the same answer a second
   * `style` statement on one class already gets, so an author who repeats
   * themselves gets one rule to remember rather than two.
   *
   * Written as an explicit overwriting loop rather than a `new Map(...)` over
   * the list, because that spelling would make the policy an artifact of how
   * the map happens to be built: silently reversible, and nothing in the code
   * would say which end was meant to win.
   */
  const interactionByClassId = new Map<string, ResolvedInteraction>();
  for (const interaction of model.interactions) {
    interactionByClassId.set(interaction.targetId, interaction);
  }

  const classes = model.classes.map<PositionedClass>((cls) => {
    const box = boxById.get(cls.id)!;
    const plan = planById.get(cls.id)!;

    /** Moves a compartment's box-local geometry into diagram coordinates. */
    const place = (
      compartment: CompartmentPlan | null,
    ): PositionedClassCompartment | null =>
      compartment === null
        ? null
        : {
            dividerY: box.y + compartment.dividerY,
            members: compartment.members.map((member) => ({
              text: member.text,
              x: box.x + CLASS_PADDING_X,
              y: box.y + member.y,
            })),
          };

    return {
      id: cls.id,
      label: plan.label,
      labelBox: plan.labelBox,
      annotation: cls.annotation,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      attributes: place(plan.attributes),
      methods: place(plan.methods),
      style: styleByClassId.get(cls.id) ?? { frame: [], text: [] },
      interaction: interactionByClassId.get(cls.id) ?? null,
    };
  });

  const relationships = model.relationships.map<PositionedClassRelationship>(
    (rel) => {
      const route = routeById.get(rel.id)!;
      return {
        id: rel.id,
        from: rel.from,
        to: rel.to,
        line: rel.line,
        fromEnd: rel.fromEnd,
        toEnd: rel.toEnd,
        points: route.points,
        hops: route.hops,
        label:
          rel.label === null || route.labelAnchor === undefined
            ? null
            : {
                ...wrappedRelationshipLabelById.get(rel.id)!,
                anchor: route.labelAnchor,
              },
        fromMultiplicity: rel.fromMultiplicity,
        fromMultiplicityAnchor:
          rel.fromMultiplicity === null ? null : (route.terminalLabelCenters?.startRight ?? null),
        toMultiplicity: rel.toMultiplicity,
        toMultiplicityAnchor:
          rel.toMultiplicity === null ? null : (route.terminalLabelCenters?.endLeft ?? null),
        fromInterfaceLabel: rel.fromInterfaceLabel,
        fromInterfaceLabelAnchor:
          rel.fromInterfaceLabel === null ? null : boxCenter(boxById.get(rel.from)!),
        toInterfaceLabel: rel.toInterfaceLabel,
        toInterfaceLabelAnchor:
          rel.toInterfaceLabel === null ? null : boxCenter(boxById.get(rel.to)!),
      };
    },
  );

  const attachedNoteIds = new Set(attachedNotes.map((note) => note.id));

  const notes = model.notes.map<PositionedClassNote>((note) => {
    const box = boxById.get(noteNodeId(note.id))!;
    // The joining edge was routed from the note to the class, the way the
    // connector is drawn.
    const link = attachedNoteIds.has(note.id) ? routeById.get(noteLinkEdgeId(note.id))!.points : null;
    return {
      id: note.id,
      label: note.label,
      labelBox: noteLabelBoxById.get(note.id)!,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      linkPoints: link,
      ...(link === null ? {} : { linkHops: routeById.get(noteLinkEdgeId(note.id))!.hops }),
    };
  });

  const bounds = diagramBounds(
    classes,
    relationships,
    namespaces,
    notes,
    options,
  );

  return {
    direction: model.direction,
    classes,
    relationships,
    namespaces,
    notes,
    width: Math.max(laidOut.width, bounds.width),
    height: Math.max(laidOut.height, bounds.height),
  };
}

/**
 * The extent every drawn thing fits inside: class boxes, relationship paths,
 * and the text anchored along them. The shared core reports the extent ELK
 * gave the graph, multiplicities included where ELK put them; but the core
 * moves a multiplicity afterwards (off a frame or a line, onto its own hand
 * of the line — `placeTerminalLabels`), which can take it past that extent,
 * so the diagram measures its own extent and takes the larger.
 */
function diagramBounds(
  classes: PositionedClass[],
  relationships: PositionedClassRelationship[],
  namespaces: PositionedClassNamespace[],
  notes: PositionedClassNote[],
  options: LayoutOptions,
): { width: number; height: number } {
  let right = 0;
  let bottom = 0;

  const cover = (x: number, y: number) => {
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  };

  /** Covers a box of `size` centered on `anchor`. */
  const coverCentered = (size: { width: number; height: number }, anchor: Point) => {
    cover(anchor.x + size.width / 2, anchor.y + size.height / 2);
  };

  /** Covers a centered run of text drawn at `anchor`. */
  const coverText = (text: string, anchor: Point) => {
    coverCentered(options.measureText.measure(text), anchor);
  };

  for (const box of [...classes, ...namespaces, ...notes]) {
    cover(box.x + box.width, box.y + box.height);
  }

  for (const note of notes) {
    for (const point of note.linkPoints ?? []) cover(point.x, point.y);
  }

  for (const rel of relationships) {
    for (const point of rel.points) cover(point.x, point.y);
    if (rel.label !== null) {
      coverCentered(rel.label.labelBox, rel.label.anchor);
    }
    if (rel.fromMultiplicity !== null && rel.fromMultiplicityAnchor !== null) {
      coverText(rel.fromMultiplicity, rel.fromMultiplicityAnchor);
    }
    if (rel.toMultiplicity !== null && rel.toMultiplicityAnchor !== null) {
      coverText(rel.toMultiplicity, rel.toMultiplicityAnchor);
    }
  }

  return { width: right, height: bottom };
}
