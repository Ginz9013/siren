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
 */
const SILENTLY_WRONG = 3;

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
 * Three shape rows remain — circle, double circle and cylinder — plus the
 * Markdown string label, which is a label form rather than a shape.
 */
const REJECTED = 25;

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
          `starts working. It may RISE in exactly one case — a case leaving ` +
          `"silently-wrong" for an honest rejection — and then silently-wrong falls ` +
          `by the same amount, so rejected + silently-wrong never grows. If that ` +
          `sum grew, you regressed a construct that used to render: fix the code, ` +
          `not the number.`,
      );
    }
  });

  it("counts each case once — no id appears twice", () => {
    const ids = COMPAT_CASES.map((entry) => entry.id);
    expect(ids).toEqual([...new Set(ids)]);
  });
});
