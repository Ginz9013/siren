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
  ResolvedInteraction,
  ResolvedClassNamespace,
  Label,
  LabelBox,
} from "../contracts";
import { plainLabel } from "../label/label";
import { layoutLabel } from "../label/layoutLabel";
import {
  layoutDirectedGraph,
  type DirectedGraphLayoutNodeBox,
} from "./layoutDirectedGraph";

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
/** How far along the line from its own end a multiplicity string is anchored. */
const MULTIPLICITY_OFFSET_ALONG = 12;
/** How far to the side of the line a multiplicity string is anchored, so it never sits on it. */
const MULTIPLICITY_OFFSET_ACROSS = 10;
/** The gap kept between a multiplicity string and the class frame it is drawn beside. */
const MULTIPLICITY_CLEARANCE = 4;

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

/** Any axis-aligned rectangle in diagram coordinates — here, a class box. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How far along `direction` from `origin` the ray is still inside `rect`, or
 * `0` when it never enters it. The standard slab test: each axis gives the
 * interval of `t` for which the ray is within that pair of edges, and the ray
 * is inside the rectangle exactly where the two intervals overlap.
 *
 * A ray parallel to an axis has no crossing on it — either it is within that
 * slab for every `t` or for none — so the axis contributes no bound in the
 * first case and rules the rectangle out entirely in the second.
 */
function exitDistance(origin: Point, direction: Point, rect: Rect): number {
  let enter = -Infinity;
  let exit = Infinity;
  for (const [at, step, from, span] of [
    [origin.x, direction.x, rect.x, rect.width],
    [origin.y, direction.y, rect.y, rect.height],
  ] as const) {
    if (Math.abs(step) < 1e-9) {
      if (at < from || at > from + span) return 0;
      continue;
    }
    const near = (from - at) / step;
    const far = (from + span - at) / step;
    enter = Math.max(enter, Math.min(near, far));
    exit = Math.min(exit, Math.max(near, far));
  }
  if (!Number.isFinite(exit) || enter > exit || exit <= 0) return 0;
  return exit;
}

/** The total length of a routed path, walked segment by segment. */
function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  }
  return total;
}

/**
 * Anchors a multiplicity string beside one end of a routed relationship:
 * a step along the line away from the class box it belongs to, then a step
 * to the side of it, so the text clears both the box and the line itself.
 *
 * The step to the side fixes which ray the anchor lives on — the relationship
 * line shifted sideways by `MULTIPLICITY_OFFSET_ACROSS` — and the anchor only
 * ever slides *along* that ray. That is what keeps this correction from
 * changing what the label reads as: the two multiplicities of one relationship
 * stay on opposite sides of it, and each stays the same distance off the
 * stroke as before.
 *
 * How far along is where the class box comes in, and it has to: the routed
 * endpoint sits *on* the box's boundary, and the step back along the line runs
 * toward the other class, so it is parallel to the edge it has to escape. For
 * a line arriving square-on, a fixed step clears the box; for one arriving at
 * a corner or at a shallow angle it does not, and a real diagram drew `*` on
 * `Animal`'s corner, over the frame stroke. So the anchor is pushed out to
 * wherever its ray leaves the box — grown by half the text's own size, since
 * the text is drawn centered on the anchor, plus a clearance so the glyph does
 * not touch the frame. Enlarging the fixed offsets instead would only move the
 * angle at which it fails.
 *
 * Never past the midpoint of the line, so a multiplicity that cannot be fitted
 * beside a very large box stops rather than drifting into the label at the
 * other end.
 */
function multiplicityAnchor(
  points: Point[],
  atStart: boolean,
  text: string,
  box: Rect,
  options: LayoutOptions,
): Point {
  const end = atStart ? points[0] : points[points.length - 1];
  const neighbour = atStart ? points[1] : points[points.length - 2];
  const towards = neighbour ?? end;
  const dx = towards.x - end.x;
  const dy = towards.y - end.y;
  const length = Math.hypot(dx, dy) || 1;
  const along = { x: dx / length, y: dy / length };

  const origin = {
    x: end.x - along.y * MULTIPLICITY_OFFSET_ACROSS,
    y: end.y + along.x * MULTIPLICITY_OFFSET_ACROSS,
  };

  const size = options.measureText.measure(text);
  const padX = size.width / 2 + MULTIPLICITY_CLEARANCE;
  const padY = size.height / 2 + MULTIPLICITY_CLEARANCE;
  const keepOut: Rect = {
    x: box.x - padX,
    y: box.y - padY,
    width: box.width + padX * 2,
    height: box.height + padY * 2,
  };

  const distance = Math.min(
    Math.max(MULTIPLICITY_OFFSET_ALONG, exitDistance(origin, along, keepOut)),
    pathLength(points) / 2,
  );
  return {
    x: origin.x + along.x * distance,
    y: origin.y + along.y * distance,
  };
}

/** The center of a box — where a lollipop's interface label is drawn, since it has no frame of its own to sit beside. */
function boxCenter(box: DirectedGraphLayoutNodeBox): Point {
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
 * A namespace's frame: the cluster box the shared core placed, widened until
 * it clears every member box by `NAMESPACE_PADDING` and has a strip along its
 * top for its own label — whichever is larger at each edge.
 *
 * **Taking the union with the member boxes is required, not merely
 * conservative**, which is worth saying here even though this is the one of
 * the three frame builders whose diagram kind cannot currently reach the case
 * that proves it. The core's cluster box is not promised to have been sized
 * from the members or to enclose them: nested inside a cluster that carries a
 * direction it comes back at exactly the size it was handed, with its members
 * outside it (measured; the table is on `isCluster` in
 * `layoutDirectedGraph.ts`). A class diagram neither nests namespaces nor
 * gives one a direction of its own, so today only `layoutGraph`'s
 * `subgraphFrames` and `layoutStateDiagram`'s `compositeFrames` are standing
 * on the union for correctness rather than for the label strip. That is a
 * property of this diagram kind, not of the seam — the day a namespace may
 * sit inside a namespace, this function is already right, and nobody should
 * arrive at that day having deleted the `memberBoxes` terms below as
 * arithmetic the core had already done.
 *
 * The result can extend past the core's own top-left corner, which is why
 * `layoutClassDiagram` translates the diagram afterwards.
 */
function namespaceFrame(
  ns: ResolvedClassNamespace,
  memberBoxes: DirectedGraphLayoutNodeBox[],
  clusterBox: DirectedGraphLayoutNodeBox,
  labelBox: LabelBox,
): PositionedClassNamespace {
  const left = Math.min(
    clusterBox.x,
    ...memberBoxes.map((box) => box.x - NAMESPACE_PADDING),
  );
  const top = Math.min(
    clusterBox.y,
    // The label strip: padding, the label's rows, then padding again before the
    // first member box starts.
    ...memberBoxes.map(
      (box) => box.y - NAMESPACE_PADDING * 2 - labelBox.height,
    ),
  );
  const right = Math.max(
    clusterBox.x + clusterBox.width,
    left + labelBox.width + NAMESPACE_PADDING * 2,
    ...memberBoxes.map((box) => box.x + box.width + NAMESPACE_PADDING),
  );
  const bottom = Math.max(
    clusterBox.y + clusterBox.height,
    ...memberBoxes.map((box) => box.y + box.height + NAMESPACE_PADDING),
  );

  return {
    id: ns.id,
    label: {
      label: ns.label,
      labelBox,
      anchor: {
        x: (left + right) / 2,
        y: top + NAMESPACE_PADDING + labelBox.height / 2,
      },
    },
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * Computes class boxes and relationship paths for a resolved `ClassModel`.
 *
 * This is the class-diagram adapter over `layoutDirectedGraph`: it measures
 * every line a class box draws, hands the resulting sizes to the shared
 * layout core, and reattaches the class diagram's own data to the
 * coordinates that come back. All graph-layout math lives in the core.
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
   * namespace's id — measured once, so the smallest box the core is handed,
   * the strip `namespaceFrame` reserves and the box the renderer draws in
   * are all the same box.
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
   * Each labelled relationship's label as `layoutLabel` measured it, by the
   * relationship's id — measured once, so the box the core keeps clear and
   * the box the renderer draws in are the same box.
   */
  const relationshipLabelBoxById = new Map(
    model.relationships.flatMap((rel) =>
      rel.label === null
        ? []
        : [[rel.id, layoutLabel(rel.label, options.measureText)] as const],
    ),
  );

  const laidOut = layoutDirectedGraph({
    rankdir: model.direction,
    nodes: [
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
      ...groups.map((group) => {
        // What the core hands back for a cluster is the box it placed, which
        // is *not* promised to have been computed from the children or to
        // enclose them — see `isCluster` in `layoutDirectedGraph.ts` for the
        // measured table. It does size a cluster from its children here,
        // because a namespace is never nested inside another namespace and
        // the divergence is confined to a cluster nested under one carrying a
        // direction; but that is a property of this diagram kind rather than
        // a promise the seam makes, so `namespaceFrame` unions the box with
        // its members regardless and this comment must not be read as saying
        // it needn't. The label's own size is passed anyway, as the smallest
        // the frame could sensibly be.
        const label = namespaceLabelBoxById.get(group.ns.id)!;
        return {
          id: namespaceNodeId(group.ns.id),
          isCluster: true,
          width: label.width + NAMESPACE_PADDING * 2,
          height: label.height + NAMESPACE_PADDING * 2,
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
    edges: [
      ...model.relationships.map((rel) => ({
        id: rel.id,
        from: rel.from,
        to: rel.to,
        // A labelled relationship asks the core to keep its ranks far enough
        // apart for the text, and reports back where that space ended up.
        ...(rel.label === null
          ? {}
          : { label: relationshipLabelBoxById.get(rel.id)! }),
      })),
      // An attached note is joined to its class by an edge that is never
      // drawn as a relationship: it is what puts the note beside the class it
      // annotates, and its route is the note's connector.
      ...attachedNotes.map((note) => ({
        id: noteLinkEdgeId(note.id),
        from: note.targetId!,
        to: noteNodeId(note.id),
      })),
    ],
  });

  // Boxes as the shared core placed them, in *core* coordinates: the frames
  // below are measured in this space, and the translation that follows is
  // what moves everything out of it. Nothing outside the frame code may read
  // this map — see `boxInDiagramSpaceById` for the space the diagram is
  // described in.
  const boxInCoreSpaceById = new Map(
    laidOut.nodes.map((box) => [box.id, box]),
  );

  const frames = groups.map((group) =>
    namespaceFrame(
      group.ns,
      group.memberIds.map((id) => boxInCoreSpaceById.get(id)!),
      boxInCoreSpaceById.get(namespaceNodeId(group.ns.id))!,
      namespaceLabelBoxById.get(group.ns.id)!,
    ),
  );

  // A frame is grown outward from the boxes it encloses, so it can reach
  // above or left of the corner the core laid the graph out from. Everything
  // is shifted by however far it did, rather than letting a frame be drawn at
  // a negative coordinate — off the canvas.
  const shift = {
    x: Math.max(0, ...frames.map((frame) => -frame.x)),
    y: Math.max(0, ...frames.map((frame) => -frame.y)),
  };
  const shifted = (point: Point): Point => ({
    x: point.x + shift.x,
    y: point.y + shift.y,
  });

  // The same boxes in *diagram* coordinates — translated, non-negative, and
  // the only space anything returned from here is described in.
  const boxInDiagramSpaceById = new Map(
    laidOut.nodes.map((box) => [box.id, { ...box, ...shifted(box) }]),
  );
  const routeById = new Map(
    laidOut.edges.map((route) => [
      route.id,
      {
        ...route,
        points: route.points.map(shifted),
        labelAnchor:
          route.labelAnchor === undefined
            ? undefined
            : shifted(route.labelAnchor),
      },
    ]),
  );
  const namespaces = frames.map((frame) => ({
    ...frame,
    ...shifted(frame),
    label: { ...frame.label, anchor: shifted(frame.label.anchor) },
  }));

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
    const box = boxInDiagramSpaceById.get(cls.id)!;
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
        label:
          rel.label === null || route.labelAnchor === undefined
            ? null
            : {
                label: rel.label,
                labelBox: relationshipLabelBoxById.get(rel.id)!,
                anchor: route.labelAnchor,
              },
        fromMultiplicity: rel.fromMultiplicity,
        fromMultiplicityAnchor:
          rel.fromMultiplicity === null
            ? null
            : multiplicityAnchor(
                route.points,
                true,
                rel.fromMultiplicity,
                boxInDiagramSpaceById.get(rel.from)!,
                options,
              ),
        toMultiplicity: rel.toMultiplicity,
        toMultiplicityAnchor:
          rel.toMultiplicity === null
            ? null
            : multiplicityAnchor(
                route.points,
                false,
                rel.toMultiplicity,
                boxInDiagramSpaceById.get(rel.to)!,
                options,
              ),
        fromInterfaceLabel: rel.fromInterfaceLabel,
        fromInterfaceLabelAnchor:
          rel.fromInterfaceLabel === null ? null : boxCenter(boxInDiagramSpaceById.get(rel.from)!),
        toInterfaceLabel: rel.toInterfaceLabel,
        toInterfaceLabelAnchor:
          rel.toInterfaceLabel === null ? null : boxCenter(boxInDiagramSpaceById.get(rel.to)!),
      };
    },
  );

  const attachedNoteIds = new Set(attachedNotes.map((note) => note.id));

  const notes = model.notes.map<PositionedClassNote>((note) => {
    const box = boxInDiagramSpaceById.get(noteNodeId(note.id))!;
    // The joining edge was routed from the class to the note; the connector
    // is drawn the other way round, out of the note it belongs to.
    const link = attachedNoteIds.has(note.id)
      ? [...routeById.get(noteLinkEdgeId(note.id))!.points].reverse()
      : null;
    return {
      id: note.id,
      label: note.label,
      labelBox: noteLabelBoxById.get(note.id)!,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      linkPoints: link,
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
    width: Math.max(laidOut.width + shift.x, bounds.width),
    height: Math.max(laidOut.height + shift.y, bounds.height),
  };
}

/**
 * The extent every drawn thing fits inside: class boxes, relationship paths,
 * and the text anchored along them. The shared core reports bounds for the
 * graph it placed, but it never saw the multiplicity strings this module
 * anchors afterwards — a multiplicity sits beside its end of a routed path,
 * which can put it outside the core's figure — so the diagram measures its
 * own extent and takes the larger.
 *
 * (An earlier version of this comment also claimed the core under-reports a
 * self-relationship's routing. That was checked afterwards across four graph
 * shapes in both axes and does not reproduce: dagre's reported bounds covered
 * every node box every time. The multiplicity reason above is the real one,
 * and it stands on its own.)
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
