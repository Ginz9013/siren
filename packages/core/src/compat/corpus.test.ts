/**
 * The corpus runner and its two ratchets.
 *
 * Three checks, one per state a `CompatCase` can declare, plus the rule that
 * separates a real measurement from an inflated one: a `supported` row must
 * assert *meaning*, and a row that claims support without an assert fails
 * here as a defect in the corpus. "Parsed with no diagnostics" is exactly
 * what a silent mis-render looks like — reading that as support is how this
 * codebase's first measurement scored 10/39 where the truth was 5/39.
 *
 * Every case goes through `render()` rather than through a parser, for the
 * same reason: a wrong picture is only visible in the result.
 */
import { describe, expect, it } from "vitest";
import type { Diagnostic, SirenRenderResult } from "../contracts";
import { render } from "../index";
import { COMPAT_CASES, type CompatCase } from "./corpus";

const SVG_NS = "http://www.w3.org/2000/svg";

/** A `SirenRenderResult` as a successful render produces one: an `<svg>`, no diagnostics. */
function rendered(diagnostics: Diagnostic[] = []): SirenRenderResult {
  return {
    svg: document.createElementNS(SVG_NS, "svg") as SVGSVGElement,
    controller: null,
    diagnostics,
  };
}

const anyCase = (over: Partial<CompatCase>): CompatCase => ({
  id: "probe",
  kind: "flowchart",
  source: "flowchart TB",
  status: "supported",
  meaning: "a probe entry, used to test the runner itself",
  ...over,
});

/**
 * The runner. Reports what is wrong with `entry` given what `render()`
 * actually produced, or `null` when the entry's declared status is the
 * truth.
 *
 * It returns a message rather than asserting, so that the rule "a
 * `supported` entry without an `assert` is a defect *in the corpus*" is
 * itself testable — that rule is the whole reason the first measurement of
 * this codebase was wrong by a factor of two, and a rule nothing exercises
 * is a comment.
 */
function violationOf(entry: CompatCase, result: SirenRenderResult): string | null {
  if (entry.status === "supported") {
    if (entry.assert === undefined) {
      return (
        `${entry.id} claims "supported" with no \`assert\`. A corpus defect: ` +
        `"parsed with no diagnostics" is exactly what a silent mis-render looks ` +
        `like, so support has to be claimed against meaning. Add an assert, or ` +
        `move the case to the status it deserves.`
      );
    }
    const noise = describeDiagnostics(result);
    if (noise !== null) {
      return `${entry.id} claims "supported" but ${noise}`;
    }
    if (result.svg === null) {
      return `${entry.id} claims "supported" but render() produced no <svg>.`;
    }
    return assertFailure(entry, result);
  }

  if (entry.status === "rejected") {
    if (!result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return (
        `${entry.id} claims "rejected" but render() reported no error-severity ` +
        `diagnostic. Either the construct now works — move it to "supported" and ` +
        `give it an assert — or it is being swallowed, which is worse than the ` +
        `rejection it replaced.`
      );
    }
    return null;
  }

  if (entry.assert === undefined) {
    return (
      `${entry.id} claims "silently-wrong" with no \`assert\`. A corpus defect: ` +
      `the status is a claim about the wrong picture this draws, and without an ` +
      `assert spelling that picture out the entry is a label rather than a fact.`
    );
  }
  const noise = describeDiagnostics(result);
  if (noise !== null) {
    return (
      `${entry.id} claims "silently-wrong" but is no longer silent — ${noise}. ` +
      `If you just made this construct honest, move the case to "rejected".`
    );
  }
  if (result.svg === null) {
    return `${entry.id} claims "silently-wrong" but render() produced no <svg>.`;
  }
  return assertFailure(entry, result);
}

/** The entry's own `assert`, run for its verdict; its message, or `null`. */
function assertFailure(entry: CompatCase, result: SirenRenderResult): string | null {
  if (entry.assert === undefined) return null;
  try {
    entry.assert(result);
  } catch (error) {
    return `${entry.id} rendered, but ${(error as Error).message}`;
  }
  return null;
}

/** The diagnostics a silent render must not have, as prose — or `null` when there were none. */
function describeDiagnostics(result: SirenRenderResult): string | null {
  if (result.diagnostics.length === 0) return null;
  return `render() reported ${result.diagnostics
    .map((d) => `${d.severity}: ${d.message}`)
    .join("; ")}`;
}

describe("the runner's verdict on a `supported` entry", () => {
  it("calls a `supported` entry with no `assert` a defect in the corpus", () => {
    expect(violationOf(anyCase({ status: "supported", assert: undefined }), rendered())).toMatch(
      /assert/,
    );
  });

  it("passes a `supported` entry that renders silently and satisfies its own assert", () => {
    expect(
      violationOf(
        anyCase({ status: "supported", assert: () => {} }),
        rendered(),
      ),
    ).toBeNull();
  });

  it("fails a `supported` entry that produced a diagnostic", () => {
    const violation = violationOf(
      anyCase({ status: "supported", assert: () => {} }),
      rendered([{ severity: "error", message: "Unrecognized flowchart line" }]),
    );
    expect(violation).toMatch(/Unrecognized flowchart line/);
  });

  it("fails a `supported` entry whose assert throws, quoting what the assert said", () => {
    const violation = violationOf(
      anyCase({
        status: "supported",
        assert: () => {
          throw new Error("node labels: expected [\"Start\"], got [\"(Start)\"]");
        },
      }),
      rendered(),
    );
    expect(violation).toMatch(/expected \["Start"\], got \["\(Start\)"\]/);
  });
});

describe("the runner's verdict on a `rejected` entry", () => {
  it("passes an entry that drew at least one error-severity diagnostic", () => {
    expect(
      violationOf(
        anyCase({ status: "rejected" }),
        rendered([{ severity: "error", message: "Unrecognized flowchart line" }]),
      ),
    ).toBeNull();
  });

  it("fails an entry that rendered silently — the construct now works, or fails silently", () => {
    const violation = violationOf(anyCase({ status: "rejected" }), rendered());
    expect(violation).toMatch(/no error-severity diagnostic/);
  });

  it("does not count a warning as a rejection", () => {
    const violation = violationOf(
      anyCase({ status: "rejected" }),
      rendered([{ severity: "warning", message: "Node redeclared" }]),
    );
    expect(violation).toMatch(/no error-severity diagnostic/);
  });
});

describe("the runner's verdict on a `silently-wrong` entry", () => {
  it("calls an entry with no `assert` a defect in the corpus", () => {
    expect(violationOf(anyCase({ status: "silently-wrong" }), rendered())).toMatch(/assert/);
  });

  it("passes an entry that renders silently and whose assert documents that output", () => {
    expect(
      violationOf(anyCase({ status: "silently-wrong", assert: () => {} }), rendered()),
    ).toBeNull();
  });

  it("fails an entry that has started reporting a diagnostic — it is no longer silent", () => {
    const violation = violationOf(
      anyCase({ status: "silently-wrong", assert: () => {} }),
      rendered([{ severity: "error", message: "Unrecognized flowchart line" }]),
    );
    expect(violation).toMatch(/no longer silent/);
  });

  it("fails an entry whose assert no longer describes what is produced", () => {
    const violation = violationOf(
      anyCase({
        status: "silently-wrong",
        assert: () => {
          throw new Error('node labels: expected ["(DB)"], got ["DB"]');
        },
      }),
      rendered(),
    );
    expect(violation).toMatch(/expected \["\(DB\)"\], got \["DB"\]/);
  });
});

describe("the corpus, case by case", () => {
  it.each(COMPAT_CASES.map((entry) => [entry.id, entry] as const))(
    "%s",
    (_id, entry) => {
      const container = document.createElement("div");
      document.body.appendChild(container);

      // Through `render()`, not through the parser: a silently mis-rendered
      // document has nothing wrong with its diagnostics, only with its
      // picture, so the parser cannot see the class of bug this exists to
      // catch.
      const violation = violationOf(entry, render(entry.source, container));

      if (violation !== null) {
        expect.fail(violation);
      }
    },
  );
});

/**
 * The number of `silently-wrong` cases. A **policy**, not a backlog: a valid
 * Mermaid document that draws the wrong picture with no diagnostic is the
 * worst failure mode this repo has, and this number's destination is zero.
 *
 * Both that are left cannot get there by being rejected, and are named so
 * that nobody mistakes them for the board failing to finish: `seq-loop` and
 * `seq-alt-else`. Siren never draws a control-flow block's **keyword** — the
 * frame, the label and the divider are all there, but `loop`, `alt`, `else`,
 * `opt`, `par` and `critical` all render identically, and those mean different
 * things. `data-siren-block-kind` carries the kind, but an attribute is not the
 * picture. The construct is supported, so refusing it would be absurd; the only
 * exit is drawing the keyword, which is renderer work and a later board's.
 *
 * They were classified `supported` when this corpus was seeded, on the argument
 * that the attribute preserved the meaning. That was the one boundary the
 * seeding worker drew by judgement rather than by reading, it flagged it as
 * such, and it was overturned on review — which is why this number went **up**
 * by two after the corpus landed, the one time it legitimately may. A number
 * that rises because a measurement was corrected is not a regression; a number
 * that rises because code got worse is. Only a human can tell those apart, so
 * say which in the commit.
 *
 * It fell to **2** when the sequence parser stopped swallowing the activation
 * shorthand's `+`/`-`: `seq-activation-shorthand` drew both messages, drew no
 * bar, and said nothing; it is now told which construct is missing. That is
 * the floor this board can reach — what remains is the two named above, and
 * their exit is drawing a keyword, not refusing a construct. A board that
 * lowers this number further has either implemented one of them or
 * miscounted.
 *
 * It rose to **3** as the board closed, for the one reason a rise is
 * legitimate: a measurement was corrected, not code made worse.
 * `fc-text-label-whitespace` has always drawn this way — Mermaid trims the
 * whitespace around a label, quoted or unquoted (measured in mermaid 11.17.2
 * with `scripts/mermaid-probe.mjs`), and Siren keeps it, so `A[  x  ]` is a
 * wider box with its text off-centre and no diagnostic. Nothing said so until
 * the quoted-label work went looking. A gap this board found and could not
 * close belongs in the instrument rather than in a note, which is the whole
 * argument the corpus was built on.
 *
 * So the board closes at three, all three named, and none of them exits by
 * being rejected. `A["  x  "]` is valid Mermaid that Mermaid draws correctly,
 * so refusing it would break the absolute condition rather than serve it; its
 * exit is a trim in the flowchart parser, which is implementation, and the
 * closing ticket's write ownership deliberately stops short of the parser.
 * That is the same shape as `seq-loop` and `seq-alt-else`, one board earlier
 * in its life: named, measured, and waiting on code rather than on a policy.
 *
 * The node shapes board left it at three, and left the same three: every
 * shape it landed was **refused** before and renders correctly now, so
 * nothing became honest and nothing became wrong. A board that moves eleven
 * constructs and does not touch this number is the ordinary case, not a
 * suspicious one — and none of these three is a flowchart node shape, so a
 * board about node shapes was never going to be the one that closes them.
 *
 * `seq-loop`/`seq-alt-else` then closed the way this comment always said
 * they would: a keyword drawn, not a construct refused. 3 - 2 = 1, leaving
 * only `fc-text-label-whitespace` — a flowchart parser trim, out of scope
 * for the sequence board that closed the other two.
 *
 * `fc-text-label-whitespace` closed the same way: `labelIn` trims after the
 * fence is removed, so a padded label draws exactly as Mermaid draws it.
 * 1 - 1 = 0. Every case this constant has ever named is now either
 * `supported` or `rejected` — the destination this policy always pointed at.
 *
 * It rose to **1** again when `fc-subgraph-edge` landed, and the rise is the
 * legitimate kind twice over: the construct it belongs to drew *no* picture
 * at all before that board, and the case was found and written down by the
 * board that caused it rather than by the next one to trip over it.
 * **`fc-subgraph-self-edge`** is the one named case: `one --> one`, where
 * `one` is a subgraph, draws the loop around the member standing in for the
 * frame instead of around the frame itself. Its exit is implementation —
 * frame-level self-loop geometry — and not refusal, because Mermaid draws
 * this document and refusing it would cost the whole picture. Until then it
 * is a wrong figure with the right edge on it, and this number is the thing
 * that will not let it be forgotten.
 *
 * **1 → 0, by implementation, which is the only exit that paragraph left
 * open.** `fc-subgraph-self-edge` is `supported`: a frame's self-loop is
 * drawn outside the frame with both ends on its own outline, and the row's
 * assert spells out that picture instead of the wrong one it used to
 * record. The fix was not frame-shaped, though, and that is the part worth
 * keeping. The cause was the layout engine's self-edge route, which is
 * detached from its box for *every* self-loop — measured against
 * `@dagrejs/dagre@3.1.1`, a 24x32 box at x 0..24 gets its loop routed at
 * x 52..76, clear of the node and past the graph width the engine itself
 * reports — so a plain `A --> A` drew an arrow floating beside its node, in
 * a flowchart and in a state diagram, in silence, and no row said so. This
 * number was reading 1 for a class of four (`01M2SVA30`). It is at 0
 * because the geometry is synthesised now (`selfLoopAroundBox`), and the
 * cases that were never written down are written down: `fc-self-edge`,
 * `fc-self-edge-lr` and `st-composite-self-transition`, with
 * `st-self-transition` strengthened from "a loop was drawn" to where it is
 * drawn. A ratchet only counts what someone measured, which is the argument
 * for measuring the whole class the moment one member of it is found.
 */
const SILENTLY_WRONG = 0;

/**
 * The number of `rejected` cases. The **backlog**: constructs an author is
 * honestly told are not implemented.
 *
 * Measured, not transcribed. `.dev/mermaid-compatibility-gaps.md` totals 35
 * across its three tables; its flowchart table's "rejected" column says 29
 * while the prose under it enumerates 27, and 27 is what running the cases
 * gives.
 *
 * It went **up** by five, from 33, when the flowchart parser stopped
 * swallowing the bracket shapes it does not draw — the one rise this number
 * is allowed, and `silently-wrong` fell by the same five. Those five drew a
 * rectangle labelled with the shape's own punctuation and said nothing; they
 * now say which shape Siren cannot draw yet. Worse numbers, honest ones.
 *
 * It went up by one again, to 39, for the same reason and on the same trade:
 * `seq-activation-shorthand` left `silently-wrong` when `MESSAGE_RE` stopped
 * matching the `+`/`-` marker and throwing it away.
 *
 * It fell by two, to 37 — the first fall, and the direction this number is
 * supposed to travel. `fc-header-graph-tb` and `fc-header-graph-lr` are now
 * `supported`: `graph` is read as the spelling of `flowchart` it has always
 * been, so both documents draw, in the direction their header named.
 *
 * It fell by three more, to 34, when a line stopped being one statement.
 * `fc-edge-chained`, `fc-stmt-ampersand` and `fc-stmt-semicolon` are all
 * `supported`: an edge line is read as the chain of endpoints it may be
 * rather than as exactly two, either end of an arrow may name several nodes
 * with `&`, and `;` ends a statement so a line may carry more than one.
 * Three rows, one change — how an edge line is read.
 *
 * It fell by one more, to 33. `fc-text-quoted` is `supported`: the quotes
 * that fence a label are syntax, so they are stripped rather than drawn, and
 * the punctuation they were fencing survives. `silently-wrong` is untouched
 * at 2 — this row had already been made honest by the refusal it is now
 * replacing, so the fall is a construct starting to work, not a measurement
 * being corrected.
 *
 * The board closes where it opened, at **33**, having travelled 33 → 39 → 33:
 * six constructs stopped lying and six started working, and the two happen to
 * cancel. That is not a board that achieved nothing, and reading this one
 * number alone would say it was. The 33 it started with counted six documents
 * that Siren drew wrongly and silently; the 33 it ends with does not, and six
 * documents that used to be refused now render. Whoever moves this number next
 * should expect the same: it is a backlog, and a backlog's size is a poor
 * summary of a day's work.
 *
 * It fell by one, to **32**, when a node stopped being only ever a
 * rectangle. `fc-shape-rhombus` is `supported`: `A{text}` parses as the
 * decision diamond Mermaid means by it, is given enough bounding box that
 * its label fits *inside* the diamond rather than inside the box the
 * diamond is inscribed in, and is drawn as a `<path>` still named
 * `siren-node-frame` — so an author's `style A fill:#f00` and the timeline
 * both reach it exactly as they reach a rectangle. `silently-wrong` is
 * untouched at 3: this construct was refused before and renders correctly
 * now, so nothing became honest and nothing became wrong. Ten shape rows
 * remain, and each of them exits the same way — parser, layout and renderer
 * together, because a shape that parsed and drew a rectangle would be a
 * silent mis-render by this instrument's own definition.
 *
 * It fell by four more, to **28**, as four spellings stopped being only a
 * rectangle's punctuation: `fc-shape-hexagon`, `fc-shape-parallelogram`,
 * `fc-shape-trapezoid` and `fc-shape-asymmetric` are `supported`, each
 * asserting the outline it draws rather than the shape it claims.
 *
 * **Four, where the ticket that moved them expected seven**, and the
 * arithmetic is worth writing down because the number alone reads like an
 * unfinished job. Six shapes landed — the four above plus both of their
 * mirror images — and three rows were added `supported` that were never in
 * this backlog to leave it: `fc-shape-parallelogram-alt` and
 * `fc-shape-trapezoid-alt` had no row at all (the corpus has always carried
 * eleven rows for Mermaid's thirteen bracket spellings, and those were the
 * two it was missing), and `fc-text-brace-arrow` is a construct nothing had
 * ever measured — `A{a-->b}`, a diamond labelled with an arrow, refused
 * because the statement splitter counted brackets and not braces. A
 * construct that was never counted as backlog cannot make the backlog fall
 * by starting to work, and giving it a row is still what turns it from a
 * memory into a measurement. `silently-wrong` is untouched at 3: all seven
 * were refused before and render correctly now, so nothing became honest
 * and nothing became wrong.
 *
 * Six shape rows remain — round, stadium, subroutine, circle, double circle
 * and cylinder — and each exits the same way: parser, layout and renderer
 * together.
 *
 * It fell by three more, to **25**, when the three shapes drawn with a
 * `<rect>` landed: `fc-shape-round`, `fc-shape-stadium` and
 * `fc-shape-subroutine` are `supported`. Three, exactly as their ticket
 * expected, because all three already had rows here to leave — no
 * construct had to be added to the backlog to measure one.
 *
 * Each asserts what the *renderer* drew and not what the node claims to
 * be, which for these three is a subtler question than it was for the six
 * before them: all three are still a `<rect>`, so `frame.tagName` names
 * none of them and `nodeOutline` had to learn to read a corner radius and
 * a pair of inner bars (see `rectOutline`). Reverting either drawing while
 * leaving `data-siren-shape` in place fails all three rows, which is how
 * they were checked. `silently-wrong` is untouched at 3: all three were
 * refused before and render correctly now, so nothing became honest and
 * nothing became wrong.
 *
 * It fell by three more, to **22**, when the three shapes drawn with a
 * curve landed: `fc-shape-circle`, `fc-shape-double-circle` and
 * `fc-shape-cylinder` are `supported`. Three, exactly as their ticket
 * expected, and for the same reason the last three were: all three already
 * had rows here to leave, so no construct had to be added to the backlog to
 * measure one. `silently-wrong` is untouched at 3 — all three were refused
 * before and render correctly now, so nothing became honest and nothing
 * became wrong.
 *
 * **No `fc-shape-*` row is rejected any more.** All thirteen of Mermaid's
 * bracket spellings for a node are `supported`, which is what closes the
 * board rather than the number 22 doing it: the backlog that is left is
 * edges, subgraphs, clicks, accessibility titles, the class lollipop, three
 * sequence constructs — and `fc-text-markdown`, which sits among the
 * flowchart text rows because it is a *label* form and not a shape. That
 * one row is why the parser's refusal mechanism outlives every shape it was
 * written for; it belongs to a later board.
 *
 * Each of the three asserts what the renderer drew. Two of them needed the
 * reader to grow to say it: `nodeOutline` named any non-`<rect>`,
 * non-`<path>` frame by its tag, so it called a double circle "circle" —
 * the same collapse `rectOutline` was written to stop, one element over —
 * and `outlineCycle` reads coordinate pairs, so it read a cylinder's arc
 * radii as vertices and produced nonsense. Rings are now counted and a
 * curved path is read as segments (`ringOutline`, `curvedOutline`).
 * Reverting the drawing while leaving `data-siren-shape` in place fails all
 * three rows, which is how they were checked.
 *
 * **The node shapes board closes here, at 22.** It opened at 33, and the
 * three counts moved 32/33/3 supported/rejected/silently-wrong to
 * 46/22/3 — measured at `f0b2296` and at this commit, not transcribed.
 * The two numbers do not balance against each other and are not meant to:
 * eleven shape rows left this backlog, while `supported` rose by fourteen
 * because three rows were *added* already working (both `-alt`
 * parallelogram/trapezoid spellings, which this corpus had never carried,
 * and `fc-text-brace-arrow`, which nothing had ever measured). Fourteen
 * shapes behind eleven rows behind fourteen `supported`, and none of the
 * three totals is a summary of the others. What closes the board is the
 * sentence above rather than any of them: no `fc-shape-*` row is rejected.
 *
 * The backlog that is left is edges (nine rows), `subgraph`, `click`,
 * `accTitle`, the class lollipop, three sequence constructs, and
 * `fc-text-markdown` — which is now the *only* row keeping the flowchart
 * parser's refusal machinery alive (`UNIMPLEMENTED_LABEL_FORMS`,
 * `unimplementedFormIn`, `BRACKET_FORM_RE`, `refuseUnimplementedForm`).
 * Whoever lands it deletes all four together.
 *
 * It fell by **seven, to 15**, when an arrow token stopped being one
 * spelling and became a decomposition. `fc-edge-open`, `fc-edge-dotted`,
 * `fc-edge-thick`, `fc-edge-circle-end`, `fc-edge-cross-end`,
 * `fc-edge-bidirectional` and `fc-edge-long` are all `supported`: an edge
 * now says which of three lines it is drawn with, what sits on each of its
 * two ends, and how many ranks apart it holds them.
 *
 * Seven, exactly as the ticket expected, and **all seven fell because code
 * changed** — every one of them already had a row here to leave, and each
 * was honestly refused before and renders correctly now, so nothing became
 * honest and nothing became wrong. `silently-wrong` is untouched at 3.
 *
 * Two rows were **added** alongside them, and they are the other kind of
 * movement: `fc-edge-dotted-open` (`A -.- B`) and `fc-edge-thick-open`
 * (`A === B`) had no row at all, so neither can make this number fall by
 * starting to work. They are here because they are what a decomposition
 * predicts and an enumeration does not — Mermaid tells `-.-` from `-.->`
 * (`arrow_open` versus `arrow_point`, measured), and a corpus that only
 * carried the arrowheaded spelling could not tell whether Siren did too.
 * A construct that was never counted as backlog cannot lower this number,
 * and giving it a row is still what turns it from a memory into a
 * measurement.
 *
 * `fc-edge-long`'s row also grew a second chain (`A --> B` beside
 * `C ----> D`). A long arrow's meaning is comparative — *further apart* than
 * a plain one — and an assert sees one render, so the only way to state it
 * without smuggling in a number from outside the picture is to put both
 * arrows in the picture.
 *
 * Two edge rows remain, both labels (`fc-edge-pipe-label`,
 * `fc-edge-inline-label`), and they are the next ticket's.
 *
 * It then fell by **two, to 13**, when an edge started carrying a label.
 * `fc-edge-pipe-label` (`A -->|yes| B`) and `fc-edge-inline-label`
 * (`A -- yes --> B`) are `supported`: both spellings parse to the same
 * label on the same edge, dagre keeps space for it, and the text is drawn
 * in that space. Two, exactly as the ticket expected, and **both fell
 * because code changed** — each already had a row here to leave, each was
 * honestly refused before and renders correctly now. `silently-wrong` is
 * untouched at 3.
 *
 * **And then it rose by one, to 14, which is a third kind of movement and
 * needs saying plainly.** `fc-edge-dotted-short` (`A .-> B`) is a
 * construct Mermaid draws and Siren refuses, and it had no row at all —
 * measured while landing the labels, because the same missing spelling is
 * what stops `A -. yes .-> B` closing an inline label. **Nothing
 * regressed**: no construct that used to render stopped, and the sum of
 * `rejected` and `silently-wrong` grew only because the backlog was
 * *undercounted* before, not because the code got worse. That is the
 * reading the message below would otherwise send someone chasing, so it is
 * written here instead: this rise is the instrument catching up, and the
 * alternative — knowing a valid Mermaid document fails and not writing it
 * down — is the exact blindness this corpus exists to remove.
 *
 * The construct is an *arrow spelling*, which belongs to the ticket that
 * decomposed the arrow token rather than to the one that added labels, so
 * it was recorded rather than fixed in passing.
 *
 * **Then `subgraph` landed, and the number moved three ways at once — one
 * down and two up — so all three are written out rather than netted.**
 *
 * Down by one: `fc-stmt-subgraph` (`subgraph one / A --> B / end`) is
 * `supported`. The block parses, the nodes inside it belong to it, dagre
 * places the group as a cluster, and the frame is drawn with its title
 * around the boxes it holds — asserted as enclosure off the rendered SVG,
 * not as "it parsed". That fall is code changing: the construct was honestly
 * refused before and renders correctly now.
 *
 * Up by two, and **neither rise is a regression** — nothing that used to
 * render stopped, and both are constructs that were *already* refused with
 * no row of their own, because until now the whole `subgraph` block was
 * refused and took them down with it. This is the instrument catching up,
 * the same movement `fc-edge-dotted-short` was one ticket earlier:
 *
 * - `fc-subgraph-direction` (`direction LR` inside a subgraph). Measured:
 *   mermaid 11.17.2 records it as `dir="LR"` on that subgraph alone and
 *   leaves the document's own direction alone, so it is a *per-cluster* rank
 *   direction, honored by laying each group out as its own diagram. dagre
 *   carries one `rankdir` per graph, so that is recursive sub-layout and a
 *   layout feature of its own size. Refused **by name** rather than read and
 *   dropped: a group drawn top-to-bottom where the author wrote
 *   left-to-right would be a `silently-wrong` row, and this file's other
 *   ratchet says where those are going.
 * - `fc-subgraph-edge` (`one --> two`, both subgraphs). Measured: Mermaid
 *   joins the two frames. Siren would have declared two ordinary nodes and
 *   drawn a box labelled `one` beside the frame of the same name, with no
 *   diagnostic — a `silently-wrong` case this ticket would have *created*.
 *   Refused by name, so it is backlog rather than a wrong picture.
 *
 * So `rejected + silently-wrong` grew by one, which the failure message
 * below reads as a regression and which this is not. The message is right to
 * make someone say why, and the why is that two valid Mermaid documents Siren
 * refuses had never been written down. Knowing that and not recording it is
 * the exact blindness this corpus exists to remove.
 *
 * **And now down to 14, paying the row this board itself wrote.**
 * `fc-edge-dotted-short` is `supported`: the leading dash of a dotted body
 * is decoration, so `A .-> B`, `A .- B` and the inline `A -. yes .-> B` all
 * draw the picture their long spellings draw, asserted as the drawn line
 * and ends rather than as "it parsed". That is code changing — the ordinary
 * fall, and the one the board predicted when it recorded the row two
 * tickets ago rather than fixing it in passing.
 *
 * **And back to 15 in the same ticket, for the fourth instrument-catching-up
 * rise this file records.** `fc-node-id-dot` (`a.b --> c`) is a construct
 * Mermaid draws and Siren refuses, and it had no row: a `.` is in Mermaid's
 * node-id alphabet, so `a.b` and `a.-b` are each *one* node with the dot
 * inside the name, while Siren's ids are `\w+`. **Nothing regressed** — no
 * construct that used to render stopped, and this one never rendered. It
 * was *found* by widening the dotted arrow body, because "what else in this
 * grammar can contain a `.`?" is the question that widening had to answer,
 * and the answer turned out to name a document nobody had written down.
 *
 * It is deliberately not fixed here, for the reason `fc-edge-dotted-short`
 * was not fixed by the ticket that found it: an id alphabet is not an arrow
 * spelling. Widening `BARE_ENDPOINT_RE` reaches every endpoint reader, the
 * `:::` shorthand and the styling directives' target lists, which is a
 * ticket rather than a passing edit. The guard that keeps `a.-b --> c`
 * *refused* rather than cut at its `.-` is what makes this row honest
 * backlog instead of a `silently-wrong` chain of three nodes.
 *
 * **And to 16 at the board's close, for the fifth instrument-catching-up
 * rise.** `fc-stmt-bare-node` (`Orphan` on a line of its own) is a statement
 * form Mermaid reads as a vertex declaration and Siren answers with
 * `Unrecognized flowchart line`, throwing away the whole document over a
 * line that declares one node. **Nothing regressed** — the bracketed
 * `Orphan[Orphan]` has always parsed, a bare id inside a `subgraph` block
 * has parsed since the block did, and this spelling has never rendered.
 *
 * It was found by *mutating* `examples/flowchart-edges.srn`: moving a bare
 * node out of the frame that held it, to prove the frame-membership
 * assertion bites, stopped the example rendering at all. Which is the same
 * shape as the four rises above — a question nobody had asked, answered by
 * measuring rather than by a construct getting worse.
 *
 * **So this board's `rejected` reads 22 → 15 → 14 → 15 → 16, and the number
 * that describes it is `supported` 46 → 60.** Four of this board's five
 * tickets wrote a `rejected` row for a valid Mermaid document they had
 * measured and chosen not to implement — `fc-edge-dotted-short`,
 * `fc-subgraph-direction`, `fc-subgraph-edge`, `fc-node-id-dot`,
 * `fc-stmt-bare-node` — and one of those was paid off inside the same
 * board. A backlog that grows because someone looked is the instrument
 * working.
 *
 * **A later board moved it again, to 17, on the same shape of trade this
 * one closed on: two rows left and three arrived.** `fc-click-href` and
 * `fc-click-call` are `supported` — a flowchart's `click ... href`/`click
 * ... call` now parse, resolve through the same shared `resolveInteractions`
 * a class diagram already used, and render an `<a class="siren-link">` or a
 * `data-siren-click` hook exactly as a class diagram's own click does. That
 * fall is code changing: both were honestly refused before and render
 * correctly now.
 *
 * Three rows arrived beside them, and **none of the three can make this
 * number fall by starting to work** — they were never counted as backlog,
 * so recording them is the instrument catching up rather than a construct
 * getting worse: `fc-click-target` (the href target attribute, `_blank`),
 * `fc-click-bare-callback` (`click A myFn`, a different semantic from `call
 * fn()` and not merely a shorter spelling of it) and `fc-click-tooltip-only`
 * (`click A "tip"` with no href or call). All three are valid flowchart
 * Mermaid, measured with `scripts/mermaid-probe.mjs`, and all three are
 * named rather than fixed in passing — the same board's own argument for
 * why `fc-edge-dotted-short` was recorded rather than implemented on sight.
 * Net: two rows left, three rows arrived, so 16 - 2 + 3 = 17.
 *
 * `cls-lollipop` (`A ()-- B`) then moved from `rejected` to `supported`:
 * 17 - 1 = 16.
 *
 * `seq-acc-title` (`accTitle:`) then moved from `rejected` to `supported`:
 * 16 - 1 = 15.
 *
 * `seq-link` then moved from `rejected` to `supported`: 15 - 1 = 14.
 *
 * `seq-activation-shorthand` and `seq-activate` then both moved from
 * `rejected` to `supported`: 14 - 2 = 12.
 *
 * `seq-note-over` and `seq-note-right-of` then both moved from `rejected`
 * to `supported`: 12 - 2 = 10.
 *
 * `fc-stmt-bare-node` (a bare id on its own line, outside any subgraph) then
 * moved from `rejected` to `supported`: 8 - 1 = 7.
 *
 * `fc-node-id-dot` (a `.` in a node id) then moved from `rejected` to
 * `supported`: 7 - 1 = 6.
 *
 * `fc-click-target` (`click A href "url" "tip" _blank`) then moved from
 * `rejected` to `supported`: 6 - 1 = 5.
 *
 * `fc-click-bare-callback` (`click A myFn`, the bare callback-name
 * shorthand) then moved from `rejected` to `supported`: a planning-stage
 * investigation corrected the earlier record of it as a different semantic
 * from `call fn()` — `render()`'s `onClick` already reports the clicked
 * node's own id for every `call` interaction regardless of click spelling,
 * so the bare form parses into the same `Interaction` shape as `call fn()`
 * with no runtime-model change needed. Two further click rows moved the
 * same way in the tickets right after (the bare-href `"url"` shorthand
 * among them), landing this board's `rejected` at its baseline for this
 * one, 3.
 *
 * `fc-text-markdown` (`` A["`**bold**`"] ``) then moved from `rejected` to
 * `supported`, and the parser's last named-refusal mechanism
 * (`UNIMPLEMENTED_LABEL_FORMS`/`unimplementedFormIn`/`BRACKET_FORM_RE`/
 * `refuseUnimplementedForm`) was deleted with it, per the doc comment that
 * had named it as the row to delete them on. The ticket's own scope was the
 * full measured shape of a Markdown label — bold, italic and an embedded
 * line break, all independent axes — so two rows arrived beside it that
 * neither can make this number fall by starting to work, the same
 * instrument-catching-up shape `fc-edge-dotted-open` and
 * `fc-edge-thick-open` were: `fc-text-italic` (`` A["`*italic*`"] ``) and
 * `fc-text-multiline` (a label whose Markdown fence closes on a later
 * physical source line than it opened on). Net: one row left `rejected`,
 * two rows arrived already `supported`: 3 - 1 = 2.
 *
 * `fc-subgraph-direction` (`direction LR` inside a `subgraph` block) then
 * moved from `rejected` to `supported`: `@dagrejs/dagre@3.1.1`'s pinned
 * version turned out to already carry `recursiveClusterLayout`, a per-cluster
 * `rankdir` — verified directly against dagre before any of this board's code
 * changed — so honoring the block's own direction needed no new layout math,
 * only threading the field through: 2 - 1 = 1.
 *
 * `fc-subgraph-edge` (`one --> two`, both subgraphs) then moved from
 * `rejected` to `supported`: **1 - 1 = 0, and this file has no `rejected`
 * flowchart row left.** Unlike the row above it, this one dagre could not be
 * talked into: an edge whose endpoint *is* a cluster node makes
 * `dagre.layout()` throw outright (`Cannot set properties of undefined
 * (setting 'rank')`, verified directly against `@dagrejs/dagre@3.1.1`), and
 * there is no flag to turn the behavior on. What closed it is Mermaid's own
 * strategy for the same construct, arrived at independently and confined to
 * `layoutDirectedGraph`: hand dagre a member of the frame in the cluster's
 * place, then clip the route it returns back to the frame's own boundary.
 *
 * **Zero is where this number was always going, and reaching it is not the
 * end of the instrument.** It means every construct written down here either
 * renders or renders correctly — not that nothing is missing. The rises
 * recorded above are what finding a missing one looks like, and the next one
 * found will put this back above zero without anything having regressed.
 *
 * **0 → 6, and this is the sentence the paragraph above predicted.** The
 * State Diagram board added a fourth diagram kind, and its closing ticket
 * wrote down the six Mermaid constructs the board deliberately left out of
 * scope: `st-stereotype-choice` (`<<choice>>`/`<<fork>>`/`<<join>>`),
 * `st-note` (`note right of X : text`), `st-concurrency-divider` (`--`
 * inside a composite), `st-author-style` (`classDef` plus the apply-
 * directive), `st-direction-document` (`direction LR` at the document's own
 * level) and `st-composite-quoted-description` (`state "Label" as Outer {`).
 *
 * **Nothing regressed, and nothing that used to render stopped.** These six
 * never rendered here; before this ticket they were simply not written down,
 * which is precisely the blindness this file exists to remove — the flowchart
 * gap reached 34/39 because unmeasured meant unnoticed. Each row is valid
 * Mermaid, measured against 11.17.2 with `scripts/mermaid-probe.mjs`, and
 * each is now refused **by name** by `parseStateDiagram`'s `UNIMPLEMENTED`
 * table rather than reported as a malformed line, which is CONTEXT.md's
 * opening policy carried out rather than merely restated. `silently-wrong`
 * did not move, because none of the six ever drew a wrong picture: the sum
 * of the two counts grew, and it grew by *measuring more*, not by breaking
 * anything.
 *
 * The rule above the literal still holds for every case already listed: a row
 * here may only leave by starting to work. What this rise records is the
 * instrument catching up with the language, the same shape as
 * `fc-edge-dotted-open` and `fc-text-italic` arriving already measured —
 * except that those arrived `supported` and these arrive as the honest
 * backlog they are. Each has a route out: implement the construct, move the
 * row to `supported` with an assert, and lower this number by one.
 *
 * **6 → 7, and this rise is the one the rule below does not describe: it is
 * the same "measuring more" as 0 → 6, not a case trading `silently-wrong`
 * for honesty.** `fc-subgraph-direction-nested` — a `subgraph` carrying its
 * own `direction` with another `subgraph` inside it — was never written down
 * here, so `silently-wrong` has nothing to give back. Before this ticket the
 * document drew a picture with `NaN` in 29 of its attributes — 26 across the
 * figures plus the `<svg>` root's own `width`, `height` and `viewBox`, the
 * three that decide whether there is a picture at all — and reported no
 * diagnostic at all: not a wrong figure, an absent one, and invisible to
 * both ratchets because no row named it. `silently-wrong` is deliberately
 * left at 1 rather than moved through — it was never 2, and inventing the
 * intermediate step to make the arithmetic tidy would be recording a
 * measurement that was never taken.
 *
 * **7 → 6, the row above leaving the way the rule says a row may leave: it
 * started working.** `fc-subgraph-direction-nested` is `supported`, with an
 * assert that pins the arrangement mermaid 11.17.2 draws rather than the
 * absence of a diagnostic — a nested frame with no `direction` of its own
 * lays out in the *document's* direction, so `A` and `B` share a column while
 * the enclosing frame's `LR` puts `C` beside them (`01M2XJWM4`). Drawing it
 * did not cost the guard that made it honest: that guard is a finiteness
 * check on whatever the layout engine hands back, and it still stands — this
 * construct simply no longer reaches it. `silently-wrong` does not move,
 * because this row was never silent.
 *
 * **6 → 5, a row leaving the same way: it started working.**
 * `st-direction-document` is `supported` — `direction LR` at a state
 * diagram's own level now reaches dagre as the whole graph's rank direction,
 * with an assert that reads the successor's coordinates off the rendered SVG
 * rather than the absence of a diagnostic (`01M368FXB`). The document-level
 * and composite-level spellings of `direction` are now both implemented and
 * stay independent, so `st-composite-direction` is untouched.
 * `silently-wrong` does not move: this row was a named refusal, never a
 * wrong picture.
 *
 * **5 → 4, and this one fell without a line of drawing code being written.**
 * `st-composite-quoted-description` is `supported`: `state "the outer block"
 * as Outer { ... }` is read as the composite it is, carrying the quoted text
 * in the same `descriptions` list both description statements write to
 * (`01M368GZJ`). The gap was a *parser* one and nothing else — each half was
 * implemented already and no pattern spanned them — so the exit was an
 * optional group on `COMPOSITE_OPEN_RE`, with no new contract field and no
 * new figure. **Where the description is drawn was measured before that was
 * relied on**, with `--markup`: mermaid 11.17.2 puts it in the frame's
 * `g.cluster-label`, the strip along the top, in place of the title that
 * would have read `Outer` — which is where Siren's layout already draws a
 * composite's rows, because it plans that strip from a composite's
 * descriptions when it has any and from its id when it has none. The row's
 * assert reads the drawn text and its y out of the SVG and pins the title
 * *above* every member, so a description drawn level with what it encloses
 * would not pass for one drawn over it. `silently-wrong` does not move: this
 * row, too, was a named refusal.
 *
 * **4 → 3, and this one fell almost entirely by reuse.**
 * `st-author-style` is `supported`: `classDef urgent fill:#f96` plus
 * `class Busy urgent` now paints the state's own rect (`01M368GZR`). The
 * construct needed no new resolution rules at all — `resolveStyles` already
 * pairs a definition with the directive applying it, already settles a
 * property declared twice, already runs the value gate that refuses `url(`,
 * `expression(`, `;` and `\`, and already translates the author's `color`
 * into the `fill` SVG paints text with — so `buildStateModel` makes the same
 * call `buildClassModel` and `buildFlowchartModel` make and a third copy of
 * those rules was never written. What this ticket did add is the renderer
 * half the two spellings needed: `PositionedState.style` and an inline
 * `style` attribute on the drawn rect and on every row of text, which is why
 * **the row's assert reads an attribute value off the rendered SVG** rather
 * than a `classes` array. The reservation `01M2ZPJKH` made — `class` and
 * `classDef` cannot name a state — is what let both words become statement
 * keywords without ambiguity, and it is still in force: a bare `class` or
 * `classDef` on a line of its own is a whole-document parse error in mermaid
 * 11.17.2 (measured) and stays an error here.
 *
 * **What was measured and deliberately not implemented**, because no row
 * covers it: mermaid 11.17.2 *does* accept `style Busy fill:#f00` in a state
 * diagram and paints the rect with it (`--markup`: the drawn
 * `rect.basic.label-container` comes back `fill:#f00 !important`). That is a
 * seventh construct, not part of this one — it reaches the picture through a
 * different statement and appears in no `classes` array — so it stays
 * refused and is reported rather than quietly added. Two smaller divergences
 * were measured in the same pass and left alone for the same reason: `class`
 * with a single operand (`class Busy`) and a class name mermaid reads as one
 * word but no `classDef` defines (`class Busy a,b`) both render in mermaid,
 * unstyled, while Siren refuses them — the second through the shared
 * `resolveStyles` rule that a flowchart and a class diagram already have.
 * `silently-wrong` does not move: this row was a named refusal, never a
 * wrong picture.
 *
 * **3 → 2, and this one turned entirely on measuring the *shape* before
 * choosing it.** `st-note` is `supported`: `note right of Idle : waiting for
 * work` is drawn as a box of text joined to its state by a dashed,
 * arrowhead-less connector (`01M368J2Y`). The obvious template was
 * `ClassDocument.notes: ClassNote[]`, a separate collection whose entries may
 * float free or attach — and it is the wrong shape. Measured (mermaid
 * 11.17.2): the note hangs off the state's own record, and a second
 * `note ... of` on one state **replaces** the first whichever sides the two
 * were written on, so the field is `StateNote | null` on the state and there
 * is no document in which one state carries two notes. Copying the class
 * diagram's collection would have built a model Mermaid does not have and
 * then diverged on exactly that document.
 *
 * Two more things were measured rather than assumed, and both changed what
 * was built. **`left of`/`right of` are rank-relative, not literal sides**:
 * mermaid makes the note a node of its layout graph and spends the position
 * as the *direction of the edge* joining the two (`right of` → state → note,
 * `left of` → note → state), so the words mean left and right under
 * `direction LR` and above and below under the default `TB`. Siren gets the
 * same behaviour for free by doing the same thing — the note is a node handed
 * to the shared layout core and the connector is its edge — rather than by
 * placing the box beside the state itself, which is what a reading of the two
 * keywords alone would have produced. And **the note has no id**: mermaid
 * names the drawn one after its state (`state-Idle----note-1`), the author
 * writes none, so it is *not* a timeline target (ADR-0009 — a target is an
 * id) and none was minted for it. It is drawn inside the annotated state's
 * own group instead, which is also what animates it: the timeline's classes
 * land on that group, so a note enters and exits with the state it belongs
 * to.
 *
 * **What was measured and deliberately left refused**, each still valid
 * Mermaid and each now refused *by name* rather than as the whole construct:
 * `note right of [*] : x` (mermaid attaches it to the level's start
 * pseudo-state, whose id here is generated) and the multi-line
 * `note ... end note` (mermaid reads the body as one string with newlines
 * in it, which needs a box of several rows). Three spellings mermaid itself
 * refuses stay refused and are pinned as such — `note over X : t`, a second
 * colon in the text, and an empty text. One was measured and made to *work*
 * that no row covers: `note "floating" as N` parses in mermaid and records
 * nothing at all, so it is accepted and ignored here exactly as `state X` is,
 * rather than costing a document that renders its picture.
 * `silently-wrong` does not move: this row was a named refusal, never a
 * wrong picture.
 *
 * **2 → 1, and this one was a change of figure rather than of structure.**
 * `st-stereotype-choice` is `supported`: `state Choice <<choice>>`,
 * `<<fork>>` and `<<join>>` now draw the diamond and the bar mermaid draws
 * (`01M368J34`). The measurement that shaped it is that mermaid records this
 * as a `type` field on the state's own record while the *same* field reads
 * `"default"` on the start and end pseudo-states — so it is a second axis
 * and not three more `StateKind` values, and a state can be both stereotyped
 * and a composite (measured: `state X <<choice>>` then `state X { A --> B }`
 * is one state, `type="choice"`, holding two members, drawn as the frame).
 * The state keeps its authored id and its place in the relations, so the
 * parser and the model gained one carried field each and the work was in
 * layout and the renderer: a 28 × 28 diamond, a 70 × 10 bar turned to
 * 10 × 70 where its **own level** runs `LR`, and no label on any of the
 * three.
 *
 * **What was measured and deliberately not implemented**, because no row
 * covers it, and each still refused by name rather than half-drawn:
 * `[[fork]]`/`[[join]]`/`[[choice]]` is a **second authored spelling** of
 * the same marker (measured: `state X [[fork]]` reports `type="fork"`);
 * `<<end>>`, `<<start>>` and any other word are **accepted and ignored** by
 * mermaid, the statement declaring nothing at all, where Siren refuses the
 * line; and mermaid's own looseness about the id — `state Foo Bar
 * <<choice>>` reports a state whose id is literally `Foo Bar`, and
 * `state "desc" as X <<choice>>` one called `"desc" as X` beside a separate
 * `X` — is not copied, since ids here are `\w+`. One measured behaviour
 * *was* copied rather than diverged from, and it is the one worth flagging:
 * a stereotype written **below** its state's first mention is inert
 * (`addState` guards the field with `if (!state.type)`), so
 * `A --> X` then `state X <<choice>>` draws a box in mermaid and draws a box
 * here. `silently-wrong` does not move: this row was a named refusal, never
 * a wrong picture.
 *
 * **1 → 0, and the state diagram's backlog is empty.**
 * `st-concurrency-divider` is `supported`: `--` inside a composite now
 * draws the concurrent regions mermaid draws (`01M368K24`). The only
 * *structural* one of the six — the previous five added a field or a
 * figure, this one changed what members are parented to. Measured:
 * mermaid synthesises a `divider`-typed state **per region** and re-parents
 * that region's members under it, so `n` dividers make `n + 1` levels, each
 * with a `[*]` pair of its own; an empty region is a region; `--` is one
 * lexer token, so `----` is two dividers while an odd run (`-`, `---`) is a
 * lexical error; and a `--` outside every composite is a parse error, which
 * Siren refuses by name.
 *
 * The trap this row carried, and the reason it was worth writing down: the
 * ids mermaid gives those dividers are **not reproducible** — the second
 * came back `id-wjxqkl6axch-1`, `id-g8d8ncxe8va-1` and `id-kql3sfhyxu-1` on
 * three runs of one document. Copying them would have made `data-siren-id`
 * different every render. Siren mints `region:1` through `generatedId`
 * (ADR-0010) instead, which is the same on every run and, carrying a colon,
 * cannot collide with an authored `\w+` id.
 *
 * **What was measured and deliberately not implemented**, neither covered
 * by a row: a transition **crossing** two regions is legal in both, and
 * mermaid answers it by flattening the block into one column with the
 * region frames drawn empty, where Siren keeps each state in the region
 * that first named it (the rule `StateDecl.parentId` already states) and
 * routes the transition between the two frames — a different arrangement of
 * the same two states and the same arrow, recorded rather than matched.
 * And one divergence is **inherited rather than introduced**: under a
 * document-level `LR`, mermaid lays an undirected nested frame's members
 * out top-to-bottom while Siren follows the document — already filed as
 * `01M36SJDN` for an undirected composite, and a region is exactly such a
 * frame. Nothing here made it worse and nothing here fixes it; the fix
 * lives in the shared layout core.
 *
 * `silently-wrong` does not move: this row was a named refusal, never a
 * wrong picture.
 *
 * **0 → 4, and it is the State board's 0 → 6 again, one diagram kind later.**
 * The ER Diagram board added Siren's fifth kind, and the ticket that stood
 * the pipeline up wrote down the four Mermaid constructs it deliberately left
 * out of scope: `er-relationship` (`CUSTOMER ||--o{ ORDER : places`, and the
 * `one to zero or more` word spelling that is measured to be the *same*
 * construct), `er-attributes` (the brace block of `type name` pairs),
 * `er-alias` (`CUSTOMER["Customer Account"]`) and `er-direction`
 * (`direction LR` at the document's own level).
 *
 * **This rise is writing down deliberately excluded constructs — honest
 * backlog, not a regression.** Case (2) in the failure message below, exactly:
 * nothing that used to render stopped, because none of these four has ever
 * rendered here. Before this ticket they were not written down at all, which
 * is the blindness this file exists to remove — the flowchart gap reached
 * 34/39 because unmeasured meant unnoticed. `silently-wrong` does not move
 * and has nothing to give back: none of the four ever drew a wrong picture,
 * so the sum of the two counts grows, and it grew by **measuring more**.
 *
 * Each is valid Mermaid, measured against 11.17.2 with
 * `scripts/mermaid-probe.mjs`, and each is now refused **by name** by
 * `parseErDiagram` rather than reported as a malformed line — CONTEXT.md's
 * opening policy carried out rather than merely restated. The attribute block
 * is named *once*, at the line that opens it, with its body swallowed: its
 * body is good ER, so three messages where one is true would make two untrue
 * claims.
 *
 * Each has a route out, and each has a ticket on the same board: implement
 * the construct, move the row to `supported` with an assert that reads the
 * drawn SVG, and lower this number by one. The `supported` row that landed
 * beside them — `er-entities` — is not in this count and never was: a
 * construct that arrives already working cannot make a backlog fall.
 *
 * **4 → 3: `er-relationship` is drawn.** All four cardinalities in both the
 * punctuation and the word spelling, both line types, the label, and the
 * entities a relationship declares along the way — the row now asserts the
 * drawn SVG end by end, which is what a construct whose two cardinalities
 * Mermaid reports *crossed over* needs (`cardA` is the marker next to
 * `entityB`). `silently-wrong` does not move: this was a named refusal, and
 * what replaced it is a picture the row reads back.
 *
 * One piece of it is **not** drawn and is not written down here yet:
 * Mermaid's fifth cardinality `u` (`MD_PARENT`, `A u--o{ B : x`), which it
 * parses and then renders with no marker at all on that end.
 * `parseErDiagram` refuses it by name — it named it as a malformed line
 * before, so this is strictly better than the state it inherited — but it
 * has no row of its own, and it needs one. Writing it down would be case (2)
 * above and would raise this number back to 4, which is why it belongs to a
 * ticket of its own rather than to the one that lowered it.
 *
 * **3 → 2: `er-attributes` is drawn.** An entity's `{ ... }` block is read
 * as `type name [keys] [comment]` and drawn as a table — the name on a row
 * of its own, a rule under it, and left-aligned cells in the columns the
 * entity actually uses. The row asserts the drawn SVG, row by row and cell
 * by cell, and it carries both cases: an entity that writes keys and
 * comments gets four columns, one that writes neither gets two.
 * `silently-wrong` does not move — this was a named refusal, and what
 * replaced it is a picture the row reads back.
 *
 * Three pieces of the block are **not** drawn and have no row here yet, all
 * three of them valid Mermaid: a `~`-delimited generic type
 * (`list~int~ xs`), a backticked word (`` `odd name` ``), and a block opened
 * and closed on one line (`E { string a }`). Each is refused — the document
 * costs, and no picture is drawn — but by the generic unrecognized-line
 * message rather than by name, which is the state every unimplemented
 * attribute detail was already in. Writing them down would be case (2)
 * above and would raise this number again, so they belong to tickets of
 * their own rather than to the one that lowered it.
 */
const REJECTED = 2;

function countOf(status: CompatCase["status"]): number {
  return COMPAT_CASES.filter((entry) => entry.status === status).length;
}

describe("the ratchet", () => {
  it("holds `silently-wrong` at its literal, and that literal only falls", () => {
    const measured = countOf("silently-wrong");
    if (measured !== SILENTLY_WRONG) {
      expect.fail(
        `silently-wrong is ${measured}; the literal above says ${SILENTLY_WRONG}. ` +
          `This number is a policy, not a backlog: it may only fall, and where it ` +
          `is going is zero. FELL? You made a construct honest (it rejects now) or ` +
          `correct (it renders right now) — that is progress: lower the literal. If ` +
          `a case moved to "supported", check that its assert was rewritten to ` +
          `Mermaid's meaning rather than left documenting the wrong output it used ` +
          `to draw. ROSE? A valid Mermaid document now renders into the wrong ` +
          `picture with no diagnostic. Fix the code, not the number.`,
      );
    }
  });

  it("holds `rejected` at its literal, and that literal only falls", () => {
    const measured = countOf("rejected");
    if (measured !== REJECTED) {
      expect.fail(
        `rejected is ${measured}; the literal above says ${REJECTED}. This number ` +
          `is the backlog, and its direction is down: it falls when a construct ` +
          `starts working. It may RISE in two cases, and the difference between ` +
          `them is whether a row was already here. (1) A row LEAVING ` +
          `"silently-wrong" for an honest rejection — silently-wrong falls by the ` +
          `same amount, and the sum of the two is unchanged. (2) A construct ` +
          `written down here for the FIRST time, as the honest backlog it already ` +
          `was: nothing falls to compensate, the sum grows, and it grew by ` +
          `measuring more rather than by breaking anything. Both have happened ` +
          `(0 → 6 when the State board wrote down what it excluded; 6 → 7 when a ` +
          `construct that drew NaN with no diagnostic was finally named). What is ` +
          `NOT allowed is a row moving from "supported" to "rejected": that is a ` +
          `construct that used to render and no longer does. So ask which it is — ` +
          `if the rise came with an id that was not in this file before, say in ` +
          `the comment above why the construct was never measured until now and ` +
          `raise the literal; if an existing "supported" row moved, fix the code, ` +
          `not the number.`,
      );
    }
  });

  it("counts each case once — no id appears twice", () => {
    const ids = COMPAT_CASES.map((entry) => entry.id);
    expect(ids).toEqual([...new Set(ids)]);
  });
});
